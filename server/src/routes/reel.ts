import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { plan, projects, sessions } from "../db.js";
import { scopeAllows } from "../auth.js";
import { costOfTranscript, sumCosts } from "../cost.js";
import { remaining } from "../rooms.js";
import { transcriptPath } from "./peek.js";

const exec = promisify(execFile);

/**
 * The demo reel: what this room built, assembled from what it already recorded.
 *
 * At hour 35 of a hackathon every team has to present, and the thing they cannot
 * reconstruct under pressure is the story — which of the parallel tracks landed,
 * who did what, what was learned on the way. agora happens to have all of it
 * already: git says what was built, the plan says what was aimed at and what its
 * holders learned, the sessions say who was working, the transcripts say what it
 * cost. Nothing new has to be instrumented; it only has to be assembled.
 *
 * Deliberately NOT public. The spectator wall is the safe subset for a screen in
 * a room of strangers; this is the detailed version — commit subjects, handoff
 * notes, per-agent spend — and it stays behind the session cookie. A team shows
 * it to judges themselves.
 */

interface Commit {
  sha: string;
  when: number;
  author: string;
  subject: string;
}

/** Commit SUBJECTS only — never a diff. A diff is the contents of the repo, and
 *  a reel is a summary, not an export. */
async function history(dir: string): Promise<Commit[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", dir, "log", "--no-merges", "-n", "200", "--format=%H%x1f%at%x1f%an%x1f%s"],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, at, author, ...rest] = line.split("\x1f");
        return {
          sha: (sha ?? "").slice(0, 8),
          when: Number(at) * 1000,
          author: author ?? "",
          subject: rest.join("\x1f"),
        };
      });
  } catch {
    return []; // not a git repo, or git missing — a reel without a timeline is fine
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const when = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export async function reelRoutes(app: FastifyInstance) {
  app.get("/api/reel", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const root = path.resolve(project);
    const row = projects.get(root);
    if (!row) return reply.code(404).send({ error: "unknown project" });

    const all = sessions.all().filter((s) => s.project_path === root);
    const perAgent = all.map((s) => {
      const f = transcriptPath(s);
      return { s, cost: f ? costOfTranscript(f) : null };
    });
    const total = sumCosts(perAgent.map((p) => p.cost).filter((c): c is NonNullable<typeof c> => !!c));
    const tasks = plan.list(root);
    const done = tasks.filter((t) => t.status === "done");
    const commits = await history(root);
    const left = remaining(row);

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(row.name)} — what we built</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0d0b0c;color:#ece6df;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:5vh 24px 14vh}
h1{font-size:clamp(28px,5vw,44px);margin:0 0 4px;letter-spacing:-.02em}
.sub{color:#9a908c;margin:0}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d8a44a;margin:44px 0 12px}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 0}
.kpi div{flex:1 1 130px;background:#141112;border:1px solid #2a2426;border-radius:8px;padding:12px 14px}
.kpi b{display:block;font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi span{color:#9a908c;font-size:12px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
li{background:#141112;border:1px solid #2a2426;border-radius:8px;padding:9px 13px}
.row{display:flex;gap:10px;align-items:baseline}
.sha{font:12px ui-monospace,Menlo,monospace;color:#6d6360;white-space:nowrap}
.who{font-size:12px;color:#9a908c;margin-left:auto;white-space:nowrap}
.note{font-size:13px;color:#9a908c;margin-top:3px}
.done{color:#4a9d94}
footer{margin-top:56px;color:#5c5250;font-size:12px;border-top:1px solid #2a2426;padding-top:14px}
</style></head><body><div class="wrap">
<h1>${esc(row.name)}</h1>
<p class="sub">${commits.length ? `${esc(when(commits[commits.length - 1].when))} → ${esc(when(commits[0].when))}` : "no commits yet"}${
      left != null ? ` · ${left > 0 ? `${Math.floor(left / 3600000)}h ${Math.round((left % 3600000) / 60000)}m left` : "time up"}` : ""
    }</p>

<div class="kpi">
  <div><b>${commits.length}</b><span>commits</span></div>
  <div><b>${done.length}/${tasks.length}</b><span>tasks done</span></div>
  <div><b>${all.length}</b><span>agents</span></div>
  <div><b>$${total.usd.toFixed(2)}</b><span>spent</span></div>
</div>

<h2>What landed</h2>
<ul>${
      commits.length
        ? commits
            .map(
              (c) =>
                `<li><div class="row"><span class="sha">${esc(c.sha)}</span><span>${esc(c.subject)}</span><span class="who">${esc(c.author)}</span></div></li>`
            )
            .join("")
        : `<li class="note">No git history in this project.</li>`
    }</ul>

<h2>The plan</h2>
<ul>${
      tasks.length
        ? tasks
            .map(
              (t) =>
                `<li><div class="row"><span class="${t.status === "done" ? "done" : ""}">${esc(t.title)}</span><span class="who">${esc(
                  t.claimed_by_name ?? (t.status === "done" ? "done" : "unclaimed")
                )}</span></div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}</li>`
            )
            .join("")
        : `<li class="note">Nothing was planned here.</li>`
    }</ul>

<h2>Who was working</h2>
<ul>${
      perAgent.length
        ? perAgent
            .map(
              ({ s, cost }) =>
                `<li><div class="row"><span>${esc(s.name)}</span><span class="note">${esc(s.harness)}</span><span class="who">${
                  cost ? `$${cost.usd.toFixed(2)}` : "—"
                }</span></div></li>`
            )
            .join("")
        : `<li class="note">No sessions ran here.</li>`
    }</ul>

<footer>Assembled by agora from this room's git history, plan and session
transcripts. Commit subjects only — no diffs, no file contents, no terminal
output.${total.unpricedTokens > 0 ? ` The figure above excludes ${total.unpricedTokens.toLocaleString()} tokens on a model with no price on record.` : ""}</footer>
</div></body></html>`;

    reply.header("cache-control", "no-store").type("text/html");
    return html;
  });
}
