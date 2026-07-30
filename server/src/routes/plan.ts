import type { FastifyInstance } from "fastify";
import path from "node:path";
import { plan, sessions } from "../db.js";
import { actingSession, scopeAllows } from "../auth.js";
import { broadcast } from "../events.js";
import { costOfTranscript, sumCosts } from "../cost.js";
import { projects as registry } from "../db.js";
import { remaining } from "../rooms.js";
import { transcriptPath } from "./peek.js";

/**
 * The shared plan.
 *
 * A project board is prose, append-only, and easy to ignore; what it cannot
 * express is that a piece of work is HELD. That gap is the most expensive
 * failure of running a fleet — not merge conflicts but design conflicts, two
 * agents independently inventing overlapping mechanisms for the same job.
 *
 * So a task has exactly one holder, taking one is a single atomic statement, and
 * the same list is readable by the humans on the canvas and by every agent
 * through the CLI. Anthropic's own Agent Teams has a shared task list, but it
 * belongs to one lead's session tree, is Claude-only, and no human can see it —
 * this one is none of those things.
 *
 * Two surfaces, one authority. /api/plan is for the dashboard and authorises
 * with the session cookie through scopeAllows. /api/hooks/plan is for agents and
 * authorises with the per-session token, so a session acts as itself and its
 * project comes from its own row rather than from anything it sends.
 */
export async function planRoutes(app: FastifyInstance) {
  // ---- agents -------------------------------------------------------------
  app.get("/api/hooks/plan", async (req, reply) => {
    const me = actingSession(req, (req.query as { session?: string }).session);
    if (!me) return reply.code(404).send({ error: "unknown session" });
    return { tasks: plan.list(me.project_path), me: { id: me.id, name: me.name } };
  });

  app.post<{
    Body: { session?: string; action?: string; id?: number; title?: string; note?: string };
  }>("/api/hooks/plan", async (req, reply) => {
    const body = req.body ?? {};
    const me = actingSession(req, body.session);
    if (!me) return reply.code(404).send({ error: "unknown session" });

    const touched = () => broadcast({ type: "plan_changed" }, { project: me.project_path });

    if (body.action === "add") {
      const title = (body.title ?? "").trim().slice(0, 300);
      if (!title) return reply.code(400).send({ error: "title required" });
      const task = plan.add(me.project_path, title);
      touched();
      return { task };
    }

    const id = Number(body.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "id required" });
    const task = plan.get(id);
    // A task from another project is reported as unknown rather than forbidden:
    // "forbidden" would confirm it exists.
    if (!task || task.project_path !== me.project_path) {
      return reply.code(404).send({ error: "unknown task" });
    }

    switch (body.action) {
      case "claim": {
        const { ok, inherited } = plan.claimWith(id, me.id, me.name);
        if (!ok) {
          return reply.code(409).send({
            error: `task ${id} is held by ${plan.get(id)?.claimed_by_name ?? "someone else"}`,
            task: plan.get(id),
          });
        }
        touched();
        // `inherited` is what the previous holder left on the task — a blocked
        // reason, or a handoff written when they finished it. It is returned
        // here rather than pushed to anyone, because the reader is whoever
        // happens to claim next and may not have existed at the time.
        return { task: plan.get(id), inherited };
      }
      case "done":
      case "drop":
      case "block": {
        const note = (body.note ?? "").trim();
        if (body.action === "block" && !note) {
          return reply.code(400).send({ error: "say why it is blocked" });
        }
        const ok =
          body.action === "done"
            ? plan.finish(id, me.id, note || undefined)
            : body.action === "drop"
              ? plan.drop(id, me.id)
              : plan.block(id, me.id, note);
        if (!ok) {
          // every one of these requires holding the task, so the honest answer
          // names that rather than pretending the task does not exist
          return reply.code(409).send({
            error: `you do not hold task ${id}${
              task.claimed_by_name ? ` — ${task.claimed_by_name} does` : ""
            }`,
            task,
          });
        }
        touched();
        return { task: plan.get(id) };
      }
      default:
        return reply.code(400).send({ error: "action must be add, claim, done, drop or block" });
    }
  });

  /**
   * What this project has spent, derived from its sessions' transcripts.
   *
   * Recomputed on request rather than accumulated in a counter — the transcripts
   * are the ledger, so the answer is idempotent and can never drift. Archived
   * sessions count: money spent is spent whether or not the terminal is still on
   * the canvas.
   */
  app.get("/api/cost", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const root = path.resolve(project);
    const rows = sessions.all().filter((s) => s.project_path === root);
    const per = rows.map((s) => {
      const file = transcriptPath(s);
      const cost = file ? costOfTranscript(file) : null;
      return { id: s.id, name: s.name, usd: cost?.usd ?? 0, cost };
    });
    const total = sumCosts(per.map((p) => p.cost).filter((c): c is NonNullable<typeof c> => !!c));
    return {
      total,
      sessions: per
        .map(({ id, name, usd }) => ({ id, name, usd }))
        .sort((a, b) => b.usd - a.usd),
    };
  });

  /** The room's clock. GET reports it; PUT sets it. */
  app.get("/api/room", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const row = registry.get(path.resolve(project));
    if (!row) return reply.code(404).send({ error: "unknown project" });
    return {
      deadline: row.deadline ?? null,
      remainingMs: remaining(row),
      expiresAt: row.expires_at ?? null,
      expiredAt: row.expired_at ?? null,
    };
  });

  app.put<{ Body: { project?: string; deadline?: number | null; expiresAt?: number | null } }>(
    "/api/room",
    async (req, reply) => {
      const { project = "", deadline, expiresAt } = req.body ?? {};
      if (!scopeAllows(req.authUser, project)) {
        return reply.code(403).send({ error: "outside your shared canvas" });
      }
      // Setting an expiry stops this room's agents when it passes. Only the
      // owner may do that — a guest is a visitor, and "the room shut down" is
      // not a visitor's decision to make.
      if (expiresAt !== undefined && req.authUser?.role === "guest") {
        return reply.code(403).send({ error: "only the owner sets a room's expiry" });
      }
      const root = path.resolve(project);
      if (!registry.get(root)) return reply.code(404).send({ error: "unknown project" });
      registry.setClock(root, {
        ...(deadline !== undefined ? { deadline } : {}),
        ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
      });
      const row = registry.get(root)!;
      broadcast({ type: "plan_changed" }, { project: root });
      return { deadline: row.deadline ?? null, remainingMs: remaining(row), expiresAt: row.expires_at ?? null };
    }
  );

  // ---- the dashboard ------------------------------------------------------
  app.get("/api/plan", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    return { tasks: plan.list(path.resolve(project)) };
  });

  app.post<{ Body: { project?: string; title?: string } }>("/api/plan", async (req, reply) => {
    const { project = "", title = "" } = req.body ?? {};
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const clean = title.trim().slice(0, 300);
    if (!clean) return reply.code(400).send({ error: "title required" });
    const task = plan.add(path.resolve(project), clean);
    broadcast({ type: "plan_changed" }, { project: path.resolve(project) });
    return { task };
  });

  app.delete<{ Params: { id: string }; Querystring: { project?: string } }>(
    "/api/plan/:id",
    async (req, reply) => {
      const project = req.query.project ?? "";
      if (!scopeAllows(req.authUser, project)) {
        return reply.code(403).send({ error: "outside your shared canvas" });
      }
      plan.remove(Number(req.params.id), path.resolve(project));
      broadcast({ type: "plan_changed" }, { project: path.resolve(project) });
      return { ok: true };
    }
  );
}
