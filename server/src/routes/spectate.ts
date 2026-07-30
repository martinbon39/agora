import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { projects, sessions, plan } from "../db.js";
import { scopeAllows } from "../auth.js";
import { costOfTranscript, sumCosts } from "../cost.js";
import { remaining } from "../rooms.js";
import { transcriptPath } from "./peek.js";

/**
 * Spectator mode: a public, read-only view of a room.
 *
 * This is a distribution feature — an organiser puts it on a screen, and 200
 * people ask what it is. It is also the only endpoint in agora that answers
 * without a session cookie, so what it shows is the whole design question.
 *
 * WHAT IT SHOWS: the shape of the work. The room's name and clock, each agent's
 * name / harness / state, the plan (titles, who holds what, what is stuck), and
 * one cost figure.
 *
 * WHAT IT DOES NOT SHOW, and why: terminal panes, file contents, the board, and
 * transcripts. Those are where secrets actually live — an agent prints an env
 * var, pastes a token into a shell, or is handed a key in a message, and none of
 * that is visible to whoever set the link up. A wall display does not need them:
 * "five agents, three tasks held, one stuck on the schema, $4.10" is the whole
 * appeal, and it is safe. Watching a live pane in public is not a feature to add
 * later either — it is the feature that turns one careless `echo $STRIPE_KEY`
 * into a public leak.
 *
 * The link is opt-in per room, owner-only, and revoked by clearing the token.
 */

/** Field-for-field, this is the entire public surface. */
interface PublicRoom {
  name: string;
  remainingMs: number | null;
  agents: { name: string; harness: string; state: string }[];
  plan: { title: string; status: string; holder: string | null; note: string | null }[];
  usd: number;
}

export async function spectateRoutes(app: FastifyInstance) {
  /** Owner-only: mint or revoke the link. */
  app.put<{ Body: { project?: string; enabled?: boolean } }>("/api/spectate", async (req, reply) => {
    const { project = "", enabled } = req.body ?? {};
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    // Publishing a room to the open internet is not a guest's decision.
    if (req.authUser?.role === "guest") {
      return reply.code(403).send({ error: "only the owner publishes a room" });
    }
    const root = path.resolve(project);
    if (!projects.get(root)) return reply.code(404).send({ error: "unknown project" });
    const token = enabled ? crypto.randomBytes(16).toString("base64url") : null;
    projects.setSpectatorToken(root, token);
    return { token };
  });

  app.get("/api/spectate", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const row = projects.get(path.resolve(project));
    if (!row) return reply.code(404).send({ error: "unknown project" });
    return { token: row.spectator_token ?? null };
  });

  /**
   * The wall itself: one self-contained page, no bundle, no auth, no framework.
   *
   * Served here rather than routed in the SPA on purpose — this URL goes on a
   * screen in a room full of strangers, and the less it loads the smaller its
   * surface. It renders only what /api/spectate/:token returns.
   */
  app.get<{ Params: { token: string } }>("/s/:token", async (req, reply) => {
    const row = projects.bySpectatorToken(req.params.token);
    if (!row) return reply.code(404).type("text/plain").send("not found");
    // The token is interpolated into a fetch URL, so it must be exactly the
    // shape we mint — base64url. Anything else never reaches the page.
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.params.token))
      return reply.code(404).type("text/plain").send("not found");
    reply.header("cache-control", "no-store").type("text/html");
    return WALL_HTML.replace("__TOKEN__", req.params.token);
  });

  /**
   * The public view. No cookie, no header, nothing but the token — which is why
   * the response is assembled field by field from a typed shape rather than by
   * spreading a row. A `...row` here is how the next column added to the
   * projects table ends up on the open internet.
   */
  app.get<{ Params: { token: string } }>("/api/spectate/:token", async (req, reply) => {
    const row = projects.bySpectatorToken(req.params.token);
    // an unknown token is 404, not 403: a 403 would confirm the room exists
    if (!row) return reply.code(404).send({ error: "not found" });

    const live = sessions
      .all()
      .filter((s) => s.project_path === row.path && s.archived_at == null);
    const cost = sumCosts(
      live
        .map((s) => transcriptPath(s))
        .filter((f): f is string => !!f)
        .map((f) => costOfTranscript(f))
    );
    const out: PublicRoom = {
      name: row.name,
      remainingMs: remaining(row),
      agents: live
        .filter((s) => s.status === "running")
        .map((s) => ({ name: s.name, harness: s.harness, state: s.agent_state })),
      plan: plan.list(row.path).map((t) => ({
        title: t.title,
        status: t.status,
        holder: t.claimed_by_name ?? null,
        note: t.note ?? null,
      })),
      usd: Math.round(cost.usd * 100) / 100,
    };
    // no-store: a public URL behind a CDN must not have a revoked room cached
    reply.header("cache-control", "no-store");
    return out;
  });
}

/** The wall page. Values are written with textContent, never innerHTML: a task
 *  title is text a stranger's team wrote, and this page has no session to steal
 *  but it does have a URL people trust. */
const WALL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agora</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0d0b0c;color:#ece6df;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:4vh 24px}
h1{font-size:clamp(24px,4vw,40px);margin:0;letter-spacing:-.02em}
.meta{color:#9a908c;font-variant-numeric:tabular-nums;margin-top:6px;font-size:15px}
.clock{color:#d8a44a;font-weight:600}
.clock.soon{color:#b8433a}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d8a44a;margin:40px 0 10px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
li{background:#141112;border:1px solid #2a2426;border-radius:8px;padding:10px 14px;display:flex;gap:12px;align-items:baseline}
.who{font-size:13px;font-weight:600;white-space:nowrap}
.state{font-size:12px;color:#9a908c;margin-left:auto;white-space:nowrap}
.working{color:#d8a44a}.needs_approval{color:#b8433a}.idle{color:#4a9d94}
.done{color:#6d6360;text-decoration:line-through}
.blocked{color:#e08a83}
.note{font-size:12px;color:#9a908c}
footer{margin-top:48px;color:#5c5250;font-size:12px;border-top:1px solid #2a2426;padding-top:14px}
</style></head><body><div class="wrap">
<h1 id="name">…</h1>
<p class="meta"><span id="clock" class="clock"></span><span id="spend"></span></p>
<h2>Agents</h2><ul id="agents"></ul>
<h2>Plan</h2><ul id="plan"></ul>
<footer>Read-only. Terminals, files and messages are never published.</footer>
</div><script>
const token = "__TOKEN__";
const el = (id) => document.getElementById(id);
function row(parts) {
  const li = document.createElement("li");
  for (const [cls, text] of parts) {
    if (!text) continue;
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;           // never innerHTML — this is someone else's text
    li.appendChild(s);
  }
  return li;
}
function clock(ms) {
  if (ms == null) return "";
  if (ms <= 0) return "time up";
  const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
  return h ? h + "h " + m + "m left" : m + "m left";
}
async function tick() {
  let r;
  try { r = await fetch("/api/spectate/" + token, { cache: "no-store" }); } catch { return; }
  if (!r.ok) { el("name").textContent = "this room is no longer published"; return; }
  const d = await r.json();
  el("name").textContent = d.name;
  el("clock").textContent = clock(d.remainingMs);
  el("clock").className = "clock" + (d.remainingMs != null && d.remainingMs < 3600000 ? " soon" : "");
  el("spend").textContent = (d.remainingMs != null ? " · " : "") + "$" + d.usd.toFixed(2) + " spent";
  el("agents").replaceChildren(
    ...(d.agents.length
      ? d.agents.map((a) => row([["who", a.name], ["note", a.harness], ["state " + a.state, a.state.replace("_", " ")]]))
      : [row([["note", "no agent running right now"]])])
  );
  el("plan").replaceChildren(
    ...(d.plan.length
      ? d.plan.map((t) =>
          row([
            ["who " + (t.status === "done" ? "done" : t.status === "blocked" ? "blocked" : ""), t.title],
            ["note", t.note],
            ["state", t.holder || (t.status === "done" ? "done" : "unclaimed")],
          ])
        )
      : [row([["note", "nothing planned yet"]])])
  );
}
tick();
setInterval(tick, 5000);
</script></body></html>`;
