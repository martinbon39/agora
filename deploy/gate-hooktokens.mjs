// Per-session hook tokens — node deploy/gate-hooktokens.mjs
//
// Before this, the hook channel had exactly one credential: a global secret in a
// 0600 file. Every caller then NAMED ITSELF, with AGORA_SESSION_ID or a
// session_id in the body. So any process running as the server's unix user could
// post to a project's board under another agent's name, read that agent's linked
// neighbours, report state for a session it did not own, or plant a sub-agent
// under someone else's parent. True in the upstream cockpit too, where one
// compromised dependency in one project was enough.
//
// Worse, the secret was not even hard to reach: claudeHooks.ts embedded it in a
// curl command inside the per-session settings file, and that file is handed to
// the session via `claude --settings`. The agent could read its own credential
// and escalate to all of them.
//
// So the token is the identity, and a claimed id is honoured only for the global
// secret. Every refusal below is paired with the same call succeeding for its
// rightful owner — a server that ignored the claim by ignoring everything would
// otherwise look identical.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-tokens-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";
const GATE_SOCKET = `agora-gate-tokens-${process.pid}`;
process.env.AGORA_TMUX_SOCKET = GATE_SOCKET;

const { initDb, sessions, projects, chat } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, hookSecret } = await import("../server/dist/auth.js");
initAuthDb(db);
const { chatRoutes } = await import("../server/dist/routes/chat.js");
const { hookRoutes } = await import("../server/dist/routes/hooks.js");
const { sessionRoutes } = await import("../server/dist/routes/sessions.js");
const { requireAuth } = await import("../server/dist/auth.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const P = path.join(tmp, "projects", "shared");
fs.mkdirSync(P, { recursive: true });
projects.insert({ path: P, name: "shared", owner_email: "owner@example.com" });

// Both sessions live in the SAME project, so nothing here is being caught by
// tenant scoping — the only thing under test is which session the caller is.
const mk = (id, name) => {
  sessions.insert({
    id,
    name,
    project_path: P,
    harness: "claude",
    command: "claude",
    status: "running",
    agent_state: "idle",
    created_at: Date.now(),
    last_activity: Date.now(),
  });
  return sessions.get(id).hook_token;
};
const tokenA = mk("s-a", "athena");
const tokenB = mk("s-b", "hermes");

check("every session is minted a hook token", !!tokenA && !!tokenB);
check("REFUSED: and two sessions never share one", tokenA !== tokenB);
check(
  "REFUSED: a session's token is not the global secret",
  tokenA !== hookSecret() && tokenB !== hookSecret()
);

const app = Fastify();
await app.register(cookie);
requireAuth(app);
await app.register(chatRoutes);
await app.register(hookRoutes);
await app.register(sessionRoutes);

const withToken = (token, opts) =>
  app.inject({ ...opts, headers: { ...(opts.headers ?? {}), "x-agora-hook": token } });

// ---- posting to the board -----------------------------------------------
const post = (token, claimedId, body) =>
  withToken(token, {
    method: "POST",
    url: "/api/hooks/chat",
    payload: { session_id: claimedId, body },
  });
const authorsOf = () => chat.board(P, 50).map((m) => `${m.author}:${m.body}`);

check(
  "a session posts to the board under its own name — the positive control",
  (await post(tokenA, "s-a", "mine")).statusCode === 200 &&
    authorsOf().includes("athena:mine")
);
const impersonation = await post(tokenA, "s-b", "signed as hermes?");
check(
  "REFUSED: presenting A's token while claiming B posts as A, never as B",
  impersonation.statusCode === 200 &&
    authorsOf().includes("athena:signed as hermes?") &&
    !authorsOf().includes("hermes:signed as hermes?"),
  authorsOf().join(" | ")
);
check(
  "REFUSED: a garbage token is not a caller at all",
  (await post("not-a-real-token", "s-a", "nope")).statusCode === 401
);
check(
  "REFUSED: and no header means no access",
  (await app.inject({ method: "POST", url: "/api/hooks/chat", payload: { body: "x" } })).statusCode ===
    401
);

// ---- reporting agent state ----------------------------------------------
// State matters beyond cosmetics: "idle" is what makes a session eligible to be
// interrupted by a delivered message.
const report = (token, id) =>
  withToken(token, { method: "POST", url: `/api/hooks/${id}/UserPromptSubmit`, payload: {} });

sessions.setAgentState("s-a", "idle");
sessions.setAgentState("s-b", "idle");
await report(tokenA, "s-a");
check(
  "a session reports its own state — the positive control",
  sessions.get("s-a").agent_state === "working",
  sessions.get("s-a").agent_state
);
sessions.setAgentState("s-a", "idle");
await report(tokenA, "s-b");
check(
  "REFUSED: A's token cannot report state for B — it lands on A instead",
  sessions.get("s-b").agent_state === "idle" && sessions.get("s-a").agent_state === "working",
  `a=${sessions.get("s-a").agent_state} b=${sessions.get("s-b").agent_state}`
);

// ---- spawning a sub-agent ----------------------------------------------
// harness 'shell' on purpose: 'claude' would start a real agent and bill a real
// account from inside a test.
const spawn = (token, claimedId) =>
  withToken(token, {
    method: "POST",
    url: "/api/hooks/spawn",
    payload: { session_id: claimedId, harness: "shell", name: `child-${claimedId}` },
  });

const ownChild = await spawn(tokenA, "s-a");
check(
  "a session spawns a child under itself — the positive control",
  ownChild.statusCode === 200 && JSON.parse(ownChild.body).session.parent_id === "s-a",
  `${ownChild.statusCode}`
);
const stolenChild = await spawn(tokenA, "s-b");
check(
  "REFUSED: claiming B as the parent still parents the child to A",
  stolenChild.statusCode === 200 && JSON.parse(stolenChild.body).session.parent_id === "s-a",
  `parent=${stolenChild.statusCode === 200 ? JSON.parse(stolenChild.body).session.parent_id : stolenChild.statusCode}`
);

// ---- the global secret still works -------------------------------------
// The server writes it into nothing now, but the dashboard and the operator's
// own tooling still use it, and a change that quietly broke it would be a
// regression rather than a hardening.
check(
  "the global secret may still name a session — it is the server's own credential",
  (await post(hookSecret(), "s-b", "from the server")).statusCode === 200 &&
    authorsOf().includes("hermes:from the server"),
  authorsOf().slice(-2).join(" | ")
);

// ---- and it is no longer readable from inside a session ----------------
const { writeHookSettings } = await import("../server/dist/claudeHooks.js");
const settingsFile = writeHookSettings("s-a", tokenA);
const settings = fs.readFileSync(settingsFile, "utf8");
check(
  "the settings file handed to the agent carries its OWN token",
  settings.includes(tokenA)
);
check(
  "REFUSED: and not the global secret — an agent reading its own settings must not escalate to every session",
  !settings.includes(hookSecret()),
  "this file is passed to `claude --settings`, so the agent can read it"
);

await app.close();
spawnSync("tmux", ["-L", GATE_SOCKET, "kill-server"], { stdio: "ignore" });
// kill-server stops the server but leaves the socket FILE in /tmp/tmux-<uid>/.
// Harmless, but it is where the ~30 stale argos-gate-* entries on the reference
// box come from, so unlink it too.
fs.rmSync(path.join(os.tmpdir(), `tmux-${process.getuid()}`, GATE_SOCKET), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
