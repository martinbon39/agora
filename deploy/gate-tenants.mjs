// Tenant-isolation gate — node deploy/gate-tenants.mjs (build the server first).
//
// argos had one human. Its authorization function short-circuited on
// `role === "owner"` and returned true for every project on the box, which is
// correct for a personal cockpit and is the whole cross-tenant hole here.
// agora moves authority to the projects table: a project is a row with an
// owner, and a directory nobody registered belongs to nobody.
//
// This gate pins that two full accounts, each an "owner" by role, cannot see
// each other. Under argos's rule every single refusal below would have been a
// 200 — which is exactly why the failure-verification for this gate matters
// more than the pass.
//
// Every refusal is paired with the request that must still succeed. A server
// that 403s everything would otherwise score perfect.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-tenants-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
// no ALLOWED_EMAIL: this is the multi-tenant shape, where every identity is a
// real address and nobody is the ambient owner of the box
delete process.env.AGORA_ALLOWED_EMAIL;

const { initDb, sessions, projects, users } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, invites, issueSessionFor, requireAuth, scopeAllows } = await import(
  "../server/dist/auth.js"
);
initAuthDb(db);
const { workspaceRoot, workspaceSlug } = await import("../server/dist/paths.js");
const { canvasRoutes } = await import("../server/dist/routes/canvas.js");
const { chatRoutes } = await import("../server/dist/routes/chat.js");
const { fileRoutes } = await import("../server/dist/routes/files.js");
const { sessionRoutes } = await import("../server/dist/routes/sessions.js");
const { projectRoutes } = await import("../server/dist/routes/projects.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const GUEST = "guest@example.com";

// each tenant's project lives inside their own workspace root
const A = path.join(workspaceRoot(ALICE), "alpha");
const B = path.join(workspaceRoot(BOB), "beta");
fs.mkdirSync(A, { recursive: true });
fs.mkdirSync(B, { recursive: true });
fs.writeFileSync(path.join(A, "secret.txt"), "alice's private notes");
fs.writeFileSync(path.join(B, "secret.txt"), "bob's private notes");

// an unregistered directory, sitting right next to a real one
const ORPHAN = path.join(workspaceRoot(ALICE), "never-registered");
fs.mkdirSync(ORPHAN, { recursive: true });

users.seen(ALICE, "alice");
users.seen(BOB, "bob");
projects.insert({ path: A, name: "alpha", owner_email: ALICE });
projects.insert({ path: B, name: "beta", owner_email: BOB });

const mkSession = (id, projectPath, name) =>
  sessions.insert({
    id,
    name,
    project_path: projectPath,
    harness: "claude",
    command: "claude",
    status: "running",
    agent_state: "idle",
    created_at: Date.now(),
    last_activity: Date.now(),
  });
mkSession("s-alice", A, "athena");
mkSession("s-bob", B, "hermes");

const app = Fastify();
await app.register(cookie);
app.get("/test-login/:who", async (req, reply) => {
  const who = req.params.who;
  if (who === "alice") issueSessionFor(reply, { email: ALICE, name: "alice", role: "owner" });
  else if (who === "bob") issueSessionFor(reply, { email: BOB, name: "bob", role: "owner" });
  else issueSessionFor(reply, { email: GUEST, name: "guest", role: "guest" });
  return { ok: true };
});
requireAuth(app);
await app.register(canvasRoutes);
await app.register(chatRoutes);
await app.register(fileRoutes);
await app.register(sessionRoutes);
await app.register(projectRoutes);

const cookieFor = async (who) => {
  const res = await app.inject({ method: "GET", url: `/test-login/${who}` });
  return res.cookies.find((c) => c.name === "agora_session").value;
};
const alice = await cookieFor("alice");
const bob = await cookieFor("bob");

const as = (token, opts) => app.inject({ ...opts, cookies: { agora_session: token } });
const q = (p) => encodeURIComponent(p);

// ---- the projects table is the authority --------------------------------
check("alice owns her project", scopeAllows({ email: ALICE, name: "a", role: "owner", color: "", project: null }, A));
check(
  "REFUSED: bob does not, despite also being role 'owner' — the role grants nothing now",
  !scopeAllows({ email: BOB, name: "b", role: "owner", color: "", project: null }, B === A ? "" : A),
  "under argos's rule this was an unconditional true"
);
check(
  "REFUSED: a directory nobody registered belongs to nobody, even inside alice's own workspace",
  !scopeAllows({ email: ALICE, name: "a", role: "owner", color: "", project: null }, ORPHAN)
);

// ---- canvas -------------------------------------------------------------
const putCanvas = (token, id) =>
  as(token, { method: "PUT", url: "/api/canvas", payload: { id, doc: { nodes: [], edges: [] } } });
const getCanvas = (token, id) => as(token, { method: "GET", url: `/api/canvas?id=${q(id)}` });

check("alice can write her own canvas", (await putCanvas(alice, A)).statusCode === 200);
check("and read it back", (await getCanvas(alice, A)).statusCode === 200);
const bobReadsA = await getCanvas(bob, A);
check(
  "REFUSED: bob cannot read alice's canvas",
  bobReadsA.statusCode === 403,
  `got ${bobReadsA.statusCode}`
);
const bobWritesA = await putCanvas(bob, A);
check(
  "REFUSED: nor overwrite it",
  bobWritesA.statusCode === 403,
  `got ${bobWritesA.statusCode}`
);

// ---- the project board --------------------------------------------------
const postChat = (token, project) =>
  as(token, { method: "POST", url: "/api/chat", payload: { project, body: "hello" } });
const getChat = (token, project) => as(token, { method: "GET", url: `/api/chat?project=${q(project)}` });

check("alice can post on her own board", (await postChat(alice, A)).statusCode === 200);
check("and read it", (await getChat(alice, A)).statusCode === 200);
check(
  "REFUSED: bob cannot read alice's board — the agents' coordination channel is per tenant",
  (await getChat(bob, A)).statusCode === 403
);
check("REFUSED: nor post into it", (await postChat(bob, A)).statusCode === 403);

// ---- files -------------------------------------------------------------
const readFile = (token, project, p) =>
  as(token, { method: "GET", url: `/api/file?project=${q(project)}&path=${q(p)}` });

check("alice reads a file in her project", (await readFile(alice, A, "secret.txt")).statusCode === 200);
const bobReadsFile = await readFile(bob, A, "secret.txt");
check(
  "REFUSED: bob cannot read a file in alice's project",
  bobReadsFile.statusCode === 403,
  `got ${bobReadsFile.statusCode}`
);
check(
  "REFUSED: nor reach it by naming his own project and climbing out",
  (await readFile(bob, B, "../../" + path.basename(workspaceRoot(ALICE)) + "/alpha/secret.txt"))
    .statusCode !== 200
);

// ---- sessions: the list is global in the DB, so the filter is the boundary
const listSessions = async (token) => {
  const res = await as(token, { method: "GET", url: "/api/sessions" });
  return JSON.parse(res.body).sessions.map((s) => s.id);
};
const aliceSees = await listSessions(alice);
const bobSees = await listSessions(bob);
check("alice's session list contains her own", aliceSees.includes("s-alice"));
check(
  "REFUSED: and not bob's — sessions.all() returns every row, the scope filter is what divides them",
  !aliceSees.includes("s-bob"),
  `alice saw [${aliceSees}]`
);
check("bob's list contains his own", bobSees.includes("s-bob"));
check("REFUSED: and not alice's", !bobSees.includes("s-alice"), `bob saw [${bobSees}]`);

// The wall shows every live session on the server — the most tempting leak.
// GET /api/sessions above reconciles against tmux and marks anything without a
// live pane as exited, so these fixtures are "exited" by now and the wall
// filters on status === "running". Put them back rather than depend on the
// order of the two blocks.
sessions.setStatus("s-alice", "running");
sessions.setStatus("s-bob", "running");
const wall = async (token) => {
  const res = await as(token, { method: "GET", url: "/api/wall" });
  return res.statusCode === 200 ? JSON.stringify(JSON.parse(res.body)) : `status ${res.statusCode}`;
};
const aliceWall = await wall(alice);
check(
  "REFUSED: the wall does not show alice bob's terminal",
  !aliceWall.includes("s-bob") && !aliceWall.includes("hermes"),
  aliceWall.slice(0, 120)
);
check("the wall does show alice her own", aliceWall.includes("s-alice") || aliceWall.includes("athena"));

// ---- the project list ---------------------------------------------------
const listProjects = async (token) => {
  const res = await as(token, { method: "GET", url: "/api/projects" });
  return JSON.parse(res.body).projects.map((p) => p.path);
};
const aliceProjects = await listProjects(alice);
check("alice's project list has her project", aliceProjects.includes(A));
check(
  "REFUSED: and not bob's",
  !aliceProjects.includes(B),
  `alice saw [${aliceProjects}]`
);
check(
  "REFUSED: and not the unregistered directory sitting in her own workspace",
  !aliceProjects.includes(ORPHAN)
);

// ---- guests ------------------------------------------------------------
invites.add(GUEST, A);
const guest = await cookieFor("guest");
check("a guest invited into alice's project can read its canvas", (await getCanvas(guest, A)).statusCode === 200);
check("REFUSED: but not bob's", (await getCanvas(guest, B)).statusCode === 403);
const guestCreates = await as(guest, {
  method: "POST",
  url: "/api/projects",
  payload: { name: "guest-project" },
});
check(
  "REFUSED: a guest cannot create a project — they have no workspace to put one in",
  guestCreates.statusCode === 403,
  `got ${guestCreates.statusCode}`
);
invites.revoke(GUEST);
check(
  "REFUSED: revoking the invite closes the door on the existing cookie, not at next login",
  (await getCanvas(guest, A)).statusCode === 401
);

// ---- workspace roots are injective -------------------------------------
// readable slugs collide: a@b.c and a-b.c both reduce to a-b-c, and a collision
// here means two tenants sharing a directory
check(
  "REFUSED: two addresses that slugify alike still get different workspaces",
  workspaceSlug("a@b.c") !== workspaceSlug("a-b.c"),
  `${workspaceSlug("a@b.c")} vs ${workspaceSlug("a-b.c")}`
);
check(
  "the same address always maps to the same workspace — otherwise a tenant loses their projects on next login",
  workspaceRoot(ALICE) === workspaceRoot("Alice@Example.com")
);

fs.rmSync(tmp, { recursive: true, force: true });
await app.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
