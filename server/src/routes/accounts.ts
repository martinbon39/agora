import type { FastifyInstance } from "fastify";
import path from "node:path";
import { config } from "../config.js";
import { projectSettings } from "../db.js";
import { scopeAllows } from "../auth.js";
import { broadcast } from "../events.js";
import * as accounts from "../accounts.js";
import { spawnSession } from "./sessions.js";

/** Which Claude Code account a project's agents sign in as.
 *
 *  Per PROJECT, not per terminal: an identity belongs to a body of work. Two
 *  agents on the same repo billed to different accounts would be a mistake
 *  waiting to happen, and choosing it at every launch is a question nobody
 *  wants asked five times a day. */
export async function accountRoutes(app: FastifyInstance) {
  // The account list is the owner's own identities — a scoped guest has no
  // business enumerating them, let alone signing terminals in as one.
  app.get("/api/accounts", async (req, reply) => {
    if (req.authUser?.role !== "owner") return reply.code(403).send({ error: "owner only" });
    return { accounts: accounts.list(), byProject: projectSettings.all() };
  });

  app.post<{ Body: { label?: string } }>("/api/accounts", async (req, reply) => {
    if (req.authUser?.role !== "owner") return reply.code(403).send({ error: "owner only" });
    const label = req.body?.label?.trim();
    if (!label) return reply.code(400).send({ error: "label required" });
    try {
      return { account: accounts.create(label) };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    if (req.authUser?.role !== "owner") return reply.code(403).send({ error: "owner only" });
    // a project still pointing at it would silently fall back to the default
    const used = Object.entries(projectSettings.all())
      .filter(([, a]) => a === req.params.id)
      .map(([p]) => path.basename(p));
    if (used.length) {
      return reply.code(409).send({ error: `still used by ${used.join(", ")}`, projects: used });
    }
    try {
      accounts.remove(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Point a project at an account. Takes effect on the NEXT session opened
   *  there: a running agent already holds its credentials. */
  app.put<{ Body: { project?: string; account?: string | null } }>(
    "/api/projects/account",
    async (req, reply) => {
      if (req.authUser?.role !== "owner") return reply.code(403).send({ error: "owner only" });
      const { project, account } = req.body ?? {};
      if (!project) return reply.code(400).send({ error: "project required" });
      if (!scopeAllows(req.authUser, project)) {
        return reply.code(403).send({ error: "outside your shared canvas" });
      }
      const id = account || null;
      if (id && !accounts.list().some((a) => a.id === id)) {
        return reply.code(400).send({ error: `unknown account '${id}'` });
      }
      projectSettings.setAccount(project, id);
      broadcast({ type: "accounts_changed", project }, { project });
      return { ok: true, account: id };
    }
  );

  /** Sign an account in. argos cannot do the OAuth dance for you, so it opens a
   *  terminal already pointed at that account's config dir — `claude` there
   *  starts the login flow, and the tokens land in the right place. */
  app.post<{ Params: { id: string } }>("/api/accounts/:id/login", async (req, reply) => {
    if (req.authUser?.role !== "owner") return reply.code(403).send({ error: "owner only" });
    const account = accounts.list().find((a) => a.id === req.params.id);
    if (!account) return reply.code(404).send({ error: "unknown account" });
    const session = await spawnSession({
      cwd: config.projectsDir,
      harness: "shell",
      name: `login-${account.id || "default"}`.slice(0, 40),
      accountConfigDir: account.configDir,
    });
    return { session, label: account.label };
  });
}
