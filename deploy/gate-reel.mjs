// The demo reel — node deploy/gate-reel.mjs
//
// At hour 35 every team has to present, and the thing they cannot reconstruct
// under pressure is the story. agora already holds all of it: git says what was
// built, the plan says what was aimed at and what its holders learned, the
// sessions say who was working, the transcripts say what it cost.
//
// A reel is a SUMMARY, not an export. So this gate plants a secret in the repo's
// file contents and a secret in a diff, and checks neither reaches the page —
// commit subjects are in, file contents are not. It also checks the boring
// failure modes that would break it on the day: a project with no git history, a
// project with no plan, and HTML metacharacters in a commit message.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-reel-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";

const SECRET = "sk-ant-NEVER-IN-A-REEL";

const { initDb, projects, sessions, plan } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, issueSessionFor, requireAuth } = await import("../server/dist/auth.js");
initAuthDb(db);
const { reelRoutes } = await import("../server/dist/routes/reel.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const P = path.join(tmp, "projects", "hackathon");
const BARE = path.join(tmp, "projects", "no-git");
fs.mkdirSync(P, { recursive: true });
fs.mkdirSync(BARE, { recursive: true });
projects.insert({ path: P, name: "vote-relay", owner_email: "owner@example.com" });
projects.insert({ path: BARE, name: "empty-room", owner_email: "owner@example.com" });

// a real repo, with a secret in a file — the file contents must not appear
const git = (...args) =>
  execFileSync("git", ["-C", P, ...args], {
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "athena", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "athena", GIT_COMMITTER_EMAIL: "a@x" },
  });
git("init", "-q", "-b", "main");
fs.writeFileSync(path.join(P, ".env"), `ANTHROPIC_API_KEY=${SECRET}\n`);
fs.writeFileSync(path.join(P, "relay.py"), `KEY = "${SECRET}"\n`);
git("add", "-A");
git("commit", "-q", "-m", "wire the relay to the vote stream");
fs.writeFileSync(path.join(P, "relay.py"), `KEY = "${SECRET}"\n# tuned\n`);
git("add", "-A");
// a commit subject with HTML metacharacters, which a team absolutely will write
git("commit", "-q", "-m", '<script>alert("xss")</script> & tune the backoff');

sessions.insert({
  id: "s1", name: "athena", project_path: P, harness: "claude", command: "claude",
  status: "exited", agent_state: "idle", created_at: Date.now(), last_activity: Date.now(),
});
sessions.insert({
  id: "s2", name: "hermes", project_path: P, harness: "codex", command: "codex",
  status: "running", agent_state: "working", created_at: Date.now(), last_activity: Date.now(),
});
const t1 = plan.add(P, "wire the relay");
plan.claim(t1.id, "s1", "athena");
plan.finish(t1.id, "s1", "the vote stream rate-limits at 20/s — back off");
plan.add(P, "write the README");

const app = Fastify();
await app.register(cookie);
app.get("/test-login/owner", async (_req, reply) => {
  issueSessionFor(reply);
  return { ok: true };
});
requireAuth(app);
await app.register(reelRoutes);
const login = await app.inject({ method: "GET", url: "/test-login/owner" });
const owner = login.cookies.find((c) => c.name === "agora_session").value;
const get = (project) =>
  app.inject({
    method: "GET",
    url: `/api/reel?project=${encodeURIComponent(project)}`,
    cookies: { agora_session: owner },
  });

// ---- it assembles the story ---------------------------------------------
const res = await get(P);
check("the reel renders", res.statusCode === 200, `${res.statusCode}`);
const html = res.body;
check("it names the room", html.includes("vote-relay"));
check("it lists what landed — commit subjects", html.includes("wire the relay to the vote stream"));
check("it counts the commits", /<b>2<\/b>/.test(html), "two commits");
check(
  "it shows the plan with its handoff, which is the part nobody reconstructs at hour 35",
  html.includes("the vote stream rate-limits at 20/s"),
  "the note a holder left on finishing"
);
check("it counts tasks done over total", html.includes("<b>1/2</b>"));
check("it names who was working, archived or not", html.includes("athena") && html.includes("hermes"));
check("and reports a spend figure", /\$\d+\.\d\d<\/b>/.test(html));

// ---- a summary, not an export -------------------------------------------
check(
  "REFUSED: the secret committed in a file does not appear",
  !html.includes(SECRET),
  "commit subjects are in, file contents are not"
);
check(
  "REFUSED: nor any diff or patch text",
  !html.includes("diff --git") && !html.includes("+++ b/") && !html.includes("relay.py"),
  "a reel summarises; it does not export the repo"
);
check(
  "REFUSED: no filesystem path leaks",
  !html.includes(tmp),
  "a path tells a reader where the box keeps things"
);

// ---- someone else's text, in an HTML page -------------------------------
check(
  "REFUSED: a commit subject with markup is escaped, not rendered",
  html.includes("&lt;script&gt;") && !html.includes("<script>alert"),
  "teams write angle brackets in commit messages"
);
check(
  "and the ampersand in it survives readably",
  html.includes("&amp; tune the backoff"),
  "escaped, not mangled"
);

// ---- the boring failure modes that would break it on the day -----------
const bare = await get(BARE);
check("a project with no git history still renders", bare.statusCode === 200, `${bare.statusCode}`);
check(
  "and says so rather than showing an empty page",
  bare.body.includes("No git history") && bare.body.includes("Nothing was planned"),
  "a blank reel at hour 35 reads as a broken tool"
);
check(
  "REFUSED: an unregistered project has no reel",
  (await get(path.join(tmp, "projects", "not-a-project"))).statusCode === 403,
  "scopeAllows refuses before anything is assembled"
);

// ---- not public ---------------------------------------------------------
check(
  "REFUSED: the reel is behind the session cookie — it is the detailed version",
  (await app.inject({ method: "GET", url: `/api/reel?project=${encodeURIComponent(P)}` })).statusCode === 401,
  "the spectator wall is the safe subset; this is not it"
);
check(
  "a public URL is never cached",
  res.headers["cache-control"] === "no-store",
  String(res.headers["cache-control"])
);

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
