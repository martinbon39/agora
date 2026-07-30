// Per-tenant Claude credentials — node deploy/gate-credentials.mjs
//
// The bug this exists for is an omission, not a mistake. argos set
// CLAUDE_CONFIG_DIR only when a project named an account, and otherwise let the
// child inherit the server's environment — so `claude` resolved $HOME/.claude,
// the operator's own account. On a personal box that is right. On a shared one,
// a stranger's agent bills the operator's subscription and reads their
// CLAUDE.md, skills and transcripts.
//
// So the assertion that matters most here is not that credentials work. It is
// that the resolver can NEVER answer with the server's own identity, and that it
// refuses rather than falling back when a tenant has connected nothing.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-creds-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
delete process.env.AGORA_ALLOWED_EMAIL;
// a refusal must happen before anything spawns, but a regression here would
// reach tmux for real — so this gate owns its socket and kills it on the way out
const GATE_SOCKET = `agora-gate-creds-${process.pid}`;
process.env.AGORA_TMUX_SOCKET = GATE_SOCKET;

const { initDb, projects, users } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, invites, issueSessionFor, requireAuth } = await import("../server/dist/auth.js");
initAuthDb(db);
const { workspaceRoot } = await import("../server/dist/paths.js");
const {
  claudeEnvFor,
  CredentialsRequired,
  setTenantApiKey,
  tenantApiKey,
  tenantClaudeDir,
  hasClaudeCredentials,
} = await import("../server/dist/tenants.js");
const { sessionRoutes } = await import("../server/dist/routes/sessions.js");
const { tenantRoutes } = await import("../server/dist/routes/tenant.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const refuses = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof CredentialsRequired ? e.message : `wrong error: ${e}`;
  }
};

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const GUEST = "guest@example.com";
const A = path.join(workspaceRoot(ALICE), "alpha");
const B = path.join(workspaceRoot(BOB), "beta");
fs.mkdirSync(A, { recursive: true });
fs.mkdirSync(B, { recursive: true });
users.seen(ALICE, "alice");
users.seen(BOB, "bob");
projects.insert({ path: A, name: "alpha", owner_email: ALICE });
projects.insert({ path: B, name: "beta", owner_email: BOB });
const ORPHAN = path.join(workspaceRoot(ALICE), "unregistered");
fs.mkdirSync(ORPHAN, { recursive: true });

// ---- multi-tenant mode: refuse, never inherit ----------------------------
process.env.AGORA_OPEN_SIGNUP = "1";

check(
  "REFUSED: a tenant who has connected nothing cannot start an agent",
  !!refuses(() => claudeEnvFor(A, "claude")),
  refuses(() => claudeEnvFor(A, "claude")) ?? "it returned instead of throwing"
);
check(
  "REFUSED: and the refusal says what to do about it",
  /connect your Anthropic account/i.test(refuses(() => claudeEnvFor(A, "claude")) ?? "")
);
check(
  "REFUSED: an unregistered directory has no owner, so there is no identity to run as",
  /no owner on record/i.test(refuses(() => claudeEnvFor(ORPHAN, "claude")) ?? "")
);
check(
  "REFUSED: a harness with no per-tenant credentials yet is refused outright, not run as the server",
  /has no per-tenant credentials/i.test(refuses(() => claudeEnvFor(A, "codex")) ?? "")
);

// ---- with a key: the identity is the tenant's own ------------------------
setTenantApiKey(ALICE, "sk-ant-alice-000000000000000000000000");
check("alice now counts as connected", hasClaudeCredentials(ALICE));
const envA = claudeEnvFor(A, "claude");
check(
  "a session in alice's project gets alice's config dir — the positive control the refusals need",
  envA.CLAUDE_CONFIG_DIR === tenantClaudeDir(ALICE),
  envA.CLAUDE_CONFIG_DIR
);
check("and her key", envA.ANTHROPIC_API_KEY === "sk-ant-alice-000000000000000000000000");

// The assertions this whole gate is for. Each one insists the variable is a
// non-empty string BEFORE comparing: "not equal to ~/.claude" is trivially true
// when the variable is absent, which is exactly the bug — an unset
// CLAUDE_CONFIG_DIR is how the agent inherits the operator's account. Without
// the isSet conjunct these two passed vacuously under the failure-verification.
const serverClaude = path.join(os.homedir(), ".claude");
const isSet = typeof envA.CLAUDE_CONFIG_DIR === "string" && envA.CLAUDE_CONFIG_DIR.length > 0;
check(
  "REFUSED: CLAUDE_CONFIG_DIR is always set — an unset one is how the server's own account leaks in",
  isSet,
  String(envA.CLAUDE_CONFIG_DIR)
);
check(
  "REFUSED: and it is NOT the server's own ~/.claude",
  isSet && envA.CLAUDE_CONFIG_DIR !== serverClaude,
  `${envA.CLAUDE_CONFIG_DIR} vs ${serverClaude}`
);
check(
  "REFUSED: nor anywhere inside it — no symlink farm into the operator's account",
  isSet && !envA.CLAUDE_CONFIG_DIR.startsWith(serverClaude + path.sep)
);

// ---- one tenant's key never reaches another's project -------------------
check(
  "REFUSED: bob has connected nothing, and alice's key does not cover him",
  !!refuses(() => claudeEnvFor(B, "claude"))
);
setTenantApiKey(BOB, "sk-ant-bob-1111111111111111111111111");
const envB = claudeEnvFor(B, "claude");
check("bob's project gets bob's key", envB.ANTHROPIC_API_KEY.includes("bob"));
check(
  "REFUSED: and never alice's",
  !envB.ANTHROPIC_API_KEY.includes("alice") && envB.CLAUDE_CONFIG_DIR !== tenantClaudeDir(ALICE),
  envB.CLAUDE_CONFIG_DIR
);

// ---- the key on disk ----------------------------------------------------
const keyFile = path.join(path.dirname(tenantClaudeDir(ALICE)), "anthropic.key");
check("the key lives on disk, not in the sqlite file that gets copied around", fs.existsSync(keyFile));
check(
  "and is 0600",
  (fs.statSync(keyFile).mode & 0o777) === 0o600,
  (fs.statSync(keyFile).mode & 0o777).toString(8)
);
const dbBytes = fs.readFileSync(path.join(tmp, "data", "agora.db"));
check(
  "REFUSED: the key does not appear anywhere in the database",
  !dbBytes.includes("sk-ant-alice")
);

// ---- self-hosting must not have been broken ----------------------------
delete process.env.AGORA_OPEN_SIGNUP;
check(
  "with multi-tenant mode off, the resolver stays out of the way — a personal install keeps working",
  Object.keys(claudeEnvFor(A, "claude")).length === 0
);
check(
  "and does not refuse an unregistered project either, since there are no tenants to protect",
  Object.keys(claudeEnvFor(ORPHAN, "shell")).length === 0
);
process.env.AGORA_OPEN_SIGNUP = "1";

// ---- routes -------------------------------------------------------------
const app = Fastify();
await app.register(cookie);
app.get("/test-login/:who", async (req, reply) => {
  const who = req.params.who;
  if (who === "alice") issueSessionFor(reply, { email: ALICE, name: "alice", role: "owner" });
  else issueSessionFor(reply, { email: GUEST, name: "guest", role: "guest" });
  return { ok: true };
});
requireAuth(app);
await app.register(tenantRoutes);
await app.register(sessionRoutes);
const cookieFor = async (who) => {
  const res = await app.inject({ method: "GET", url: `/test-login/${who}` });
  return res.cookies.find((c) => c.name === "agora_session").value;
};
const alice = await cookieFor("alice");
const as = (token, opts) => app.inject({ ...opts, cookies: { agora_session: token } });

const status = await as(alice, { method: "GET", url: "/api/tenant/claude" });
check("GET /api/tenant/claude reports connected", JSON.parse(status.body).connected === true);
check(
  "REFUSED: and never returns the key itself",
  !status.body.includes("sk-ant-alice"),
  status.body.slice(0, 100)
);

const badKey = await as(alice, { method: "PUT", url: "/api/tenant/claude", payload: { key: "nope" } });
check("REFUSED: a value that is not an API key", badKey.statusCode === 400);
const goodKey = await as(alice, {
  method: "PUT",
  url: "/api/tenant/claude",
  payload: { key: "sk-ant-alice-222222222222222222222222" },
});
check("a real-shaped key is accepted — the positive control", goodKey.statusCode === 200);
check("and it took effect", tenantApiKey(ALICE).includes("2222"));

// a guest has no billing of their own, and must not be able to write a key at all
// (the endpoint's subject is the cookie, so there is no other tenant to name).
// The invite is required for the guest to be an identity at all: getAuthUser
// returns null without a live one, and the answer would be 401 rather than the
// 403 under test.
invites.add(GUEST, A);
const guest = await cookieFor("guest");
const guestPut = await as(guest, {
  method: "PUT",
  url: "/api/tenant/claude",
  payload: { key: "sk-ant-guest-333333333333333333333333" },
});
check(
  "REFUSED: a guest cannot set credentials",
  guestPut.statusCode === 403,
  `got ${guestPut.statusCode}`
);
check("REFUSED: and alice's key is untouched by that attempt", tenantApiKey(ALICE).includes("2222"));

// The refusal must surface as an actionable status, not a 500.
//
// It has to be alice's OWN project: aiming at bob's returns 403 from the scope
// check, which runs first — an earlier version of this test asserted
// `402 || 403` and passed without ever reaching the credentials path.
setTenantApiKey(ALICE, null);
const ownProject = path.relative(process.env.AGORA_PROJECTS_DIR, A);
const noCreds = await as(alice, {
  method: "POST",
  url: "/api/sessions",
  payload: { harness: "claude", projectPath: ownProject },
});
check(
  "REFUSED: spawning without credentials answers 402, not 500 — the UI has to be able to say why",
  noCreds.statusCode === 402,
  `got ${noCreds.statusCode} ${noCreds.body.slice(0, 140)}`
);
check(
  "REFUSED: and flags itself so the client can route to the connect screen",
  JSON.parse(noCreds.body).needsCredentials === true
);
check(
  "REFUSED: nothing was spawned — a refusal must not leave a session row behind",
  !(await import("../server/dist/db.js")).sessions.all().some((r) => r.project_path === A)
);

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
spawnSync("tmux", ["-L", GATE_SOCKET, "kill-server"], { stdio: "ignore" });
// kill-server stops the server but leaves the socket FILE in /tmp/tmux-<uid>/.
// Harmless, but it is where the ~30 stale argos-gate-* entries on the reference
// box come from, so unlink it too.
fs.rmSync(path.join(os.tmpdir(), `tmux-${process.getuid()}`, GATE_SOCKET), { force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
