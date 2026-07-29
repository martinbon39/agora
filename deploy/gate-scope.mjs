// Guest-scope gate — node deploy/gate-scope.mjs (build the server first).
//
// A guest is invited to ONE project. Everything else on the box must stay out
// of reach. Three holes this pins shut:
//   1. /proxy/<port>/ carries no project, so it cannot be scoped — a guest
//      going through it would see every other dev server on the loopback.
//   2. POST /api/uploads/:id checked only that the session existed, never that
//      it was in the guest's project (and it overwrites the paste clipboard).
//   3. /api/file containment was textual, so a symlink planted inside the
//      project escaped it — statSync/readSync happily follow symlinks.
//
// Runs against the REAL routes via fastify.inject, with REAL session cookies
// (the routes read getAuthUser() off the cookie, not req.authUser).
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// isolated data + projects dirs: the gate must never touch the live agora.db
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-scope-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
// The owner's identity now has to be a real address: projects are owned by an
// email, and an identity-less session resolves its email from ALLOWED_EMAIL.
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";

const ALPHA = path.join(tmp, "projects", "alpha"); // the guest's project
const BETA = path.join(tmp, "projects", "beta"); // someone else's project
fs.mkdirSync(ALPHA, { recursive: true });
fs.mkdirSync(BETA, { recursive: true });
fs.writeFileSync(path.join(ALPHA, "readme.txt"), "public to the guest");

// the escape: a symlink inside alpha pointing at a file outside projectsDir
const SECRET = path.join(tmp, "secret.txt");
fs.writeFileSync(SECRET, "AGORA_HOOK_SECRET_LOOKALIKE");
fs.symlinkSync(SECRET, path.join(ALPHA, "innocent.txt"));

const { initDb, sessions, canvas, projects } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, invites, issueSessionFor, requireAuth, hookSecret } = await import(
  "../server/dist/auth.js"
);
initAuthDb(db);
const { fileRoutes } = await import("../server/dist/routes/files.js");
const { peekRoutes } = await import("../server/dist/routes/peek.js");
const { chatRoutes } = await import("../server/dist/routes/chat.js");
const { uploadRoutes } = await import("../server/dist/routes/uploads.js");
const { proxyRoutes } = await import("../server/dist/routes/proxy.js");
const { authRoutes } = await import("../server/dist/auth.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// the guest is scoped to alpha; the invite is what getAuthUser reads live
// tenancy: both fixture projects belong to the owner, and the guest is
// invited into exactly one of them. Registering them is what makes the owner's
// access real now — the role itself no longer grants anything.
projects.insert({ path: ALPHA, name: "alpha", owner_email: "owner@example.com" });
projects.insert({ path: BETA, name: "beta", owner_email: "owner@example.com" });
invites.add("guest@example.com", ALPHA);

const mkSession = (id, projectPath) =>
  sessions.insert({
    id,
    name: id,
    project_path: projectPath,
    harness: "shell",
    command: "bash",
    status: "running",
    agent_state: "idle",
    created_at: Date.now(),
    last_activity: Date.now(),
  });
mkSession("sess-alpha", ALPHA);
mkSession("sess-beta", BETA);

const app = Fastify();
await app.register(cookie);
// test-only login endpoints, on a path requireAuth leaves public
app.get("/test-login/owner", async (_req, reply) => {
  issueSessionFor(reply);
  return { ok: true };
});
app.get("/test-login/guest", async (_req, reply) => {
  issueSessionFor(reply, { email: "guest@example.com", name: "guest", role: "guest" });
  return { ok: true };
});
requireAuth(app);
await app.register(authRoutes);
await app.register(fileRoutes);
await app.register(uploadRoutes);
await app.register(proxyRoutes);

const cookieFor = async (who) => {
  const res = await app.inject({ method: "GET", url: `/test-login/${who}` });
  return res.cookies.find((c) => c.name === "agora_session").value;
};
const owner = await cookieFor("owner");
const guest = await cookieFor("guest");
const as = (token, opts) =>
  app.inject({ ...opts, cookies: { agora_session: token }, headers: { ...opts.headers } });
const readFile = (token, project, p) =>
  as(token, {
    method: "GET",
    url: `/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(p)}`,
  });

// --- baseline: the legitimate paths still work -----------------------------
let r = await readFile(owner, ALPHA, "readme.txt");
check("owner reads a normal file in a project", r.statusCode === 200, `got ${r.statusCode}`);

r = await as(guest, { method: "GET", url: `/api/files?project=${encodeURIComponent(ALPHA)}` });
check("guest lists the project they were invited to", r.statusCode === 200, `got ${r.statusCode}`);

r = await as(guest, { method: "GET", url: `/api/files?project=${encodeURIComponent(BETA)}` });
check("guest is refused another project", r.statusCode === 403, `got ${r.statusCode}`);

// --- 1. symlink escape -----------------------------------------------------
r = await readFile(owner, ALPHA, "innocent.txt");
check(
  "a symlink out of the project is not followed",
  r.statusCode === 400 && !String(r.body).includes("LOOKALIKE"),
  `got ${r.statusCode}`
);

// the same escape spelled with .. is still caught (regression guard)
r = await readFile(owner, ALPHA, "../../secret.txt");
check("a .. traversal is still refused", r.statusCode === 400, `got ${r.statusCode}`);

// --- 2. upload scope -------------------------------------------------------
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
).toString("base64");
const upload = (token, id) =>
  as(token, { method: "POST", url: `/api/uploads/${id}`, payload: { name: "x.png", data: png } });

r = await upload(guest, "sess-beta");
check("guest cannot upload into a session outside their scope", r.statusCode === 403, `got ${r.statusCode}`);

r = await upload(guest, "sess-alpha");
check("guest can still upload into their own session", r.statusCode === 200, `got ${r.statusCode}`);

// --- 3. proxy -------------------------------------------------------------
r = await as(guest, { method: "GET", url: "/proxy/45999/" });
check("guest cannot reach the loopback proxy", r.statusCode === 403, `got ${r.statusCode}`);

r = await as(owner, { method: "GET", url: "/proxy/45999/" });
check(
  "owner still reaches the proxy (502 = nothing listening, not blocked)",
  r.statusCode === 502,
  `got ${r.statusCode}`
);

// --- 4. the gate itself cannot be walked around with percent-encoding ------
// The router percent-decodes before matching, so a prefix test on the RAW
// url let `/%61pi/…` through the whole auth gate with no cookie at all.
const noCookie = (url) => app.inject({ method: "GET", url });
const FILE_Q = `?project=${encodeURIComponent(ALPHA)}&path=readme.txt`;

r = await noCookie(`/api/file${FILE_Q}`);
check("no cookie is refused", r.statusCode === 401, `got ${r.statusCode}`);

for (const [label, url] of [
  ["%61pi", `/%61pi/file${FILE_Q}`],
  ["fully encoded", `/%61%70%69/file${FILE_Q}`],
]) {
  r = await noCookie(url);
  // must be 401 — the GATE refusing. A 403 means the request reached the
  // handler and only the route's own scope check saved us, i.e. the gate was
  // walked around and every route without such a check is exposed.
  check(
    `an encoded path (${label}) is refused by the gate itself`,
    r.statusCode === 401,
    `got ${r.statusCode}${r.statusCode === 403 ? " (reached the handler!)" : ""}`
  );
}

r = await as(guest, { method: "GET", url: "/%70roxy/45999/" });
check("an encoded /proxy path is still blocked for a guest", r.statusCode === 403, `got ${r.statusCode}`);

// The static mounts are where this actually bled: they have no handler-level
// check at all, so the gate is the only thing standing in front of them.
const statics = Fastify();
await statics.register(cookie);
requireAuth(statics);
const artDir = path.join(tmp, "artifacts");
fs.mkdirSync(artDir, { recursive: true });
fs.writeFileSync(path.join(artDir, "secret.html"), "PRIVATE-ARTIFACT");
await statics.register(fastifyStatic, { root: artDir, prefix: "/artifacts/", decorateReply: false });
for (const [label, url] of [
  ["plain", "/artifacts/secret.html"],
  ["encoded", "/%61rtifacts/secret.html"],
]) {
  r = await statics.inject({ method: "GET", url });
  check(
    `the artifacts mount is not readable without a session (${label})`,
    r.statusCode === 401 && !String(r.body).includes("PRIVATE-ARTIFACT"),
    `got ${r.statusCode}`
  );
}

// --- 5. a canvas link is permission, so it must not cross projects --------
// `peek` and `ask` derive permission from canvas edges. But a canvas doc is
// whatever the client PUT, and a terminal node carries a sessionId — so a doc
// in one project can name a session in another. Only the session row decides
// which project a session is really in.
const peekApp = Fastify();
await peekApp.register(peekRoutes);
await peekApp.register(chatRoutes);
const hookHeaders = { "x-agora-hook": hookSecret() };
const peek = (query) =>
  peekApp.inject({ method: "GET", url: `/api/hooks/peek?${query}`, headers: hookHeaders });

canvas.put(
  ALPHA,
  JSON.stringify({
    nodes: [
      { id: "term-sess-alpha", type: "terminal", data: { sessionId: "sess-alpha" } },
      { id: "term-foreign", type: "terminal", data: { sessionId: "sess-beta" } },
    ],
    edges: [{ id: "e-cross", source: "term-sess-alpha", target: "term-foreign" }],
  })
);
r = await peek("session=sess-alpha");
check(
  "a link naming another project's session grants nothing",
  r.statusCode === 200 && r.json().linked.length === 0,
  `linked: ${JSON.stringify(r.json?.().linked ?? r.body)}`
);
r = await peek("session=sess-alpha&target=sess-beta&mode=terminal");
check("…and reading it by name is refused", r.statusCode === 403, `got ${r.statusCode}`);

// The link grants BOTH halves, so the write half needs the same proof as the
// read half — one function backs them, but only a test says so.
const send = (to, from = "sess-alpha") =>
  peekApp.inject({
    method: "POST",
    url: "/api/hooks/ask",
    headers: hookHeaders,
    payload: { session_id: from, to, body: "hello" },
  });
r = await send("sess-beta");
check("…and sending to it is refused too", r.statusCode === 403, `got ${r.statusCode}`);

// Positive control: an ordinary link inside one project must still grant peek,
// or the two refusals above would pass just as well with linking broken.
mkSession("sess-alpha2", ALPHA);
canvas.put(
  ALPHA,
  JSON.stringify({
    nodes: [
      { id: "term-sess-alpha", type: "terminal", data: { sessionId: "sess-alpha" } },
      { id: "term-peer", type: "terminal", data: { sessionId: "sess-alpha2" } },
    ],
    edges: [{ id: "e-ok", source: "term-sess-alpha", target: "term-peer" }],
  })
);
r = await peek("session=sess-alpha");
check(
  "a link inside the project DOES grant read",
  r.statusCode === 200 && r.json().linked.some((l) => l.name === "sess-alpha2"),
  `linked: ${JSON.stringify(r.json().linked)}`
);
r = await send("sess-alpha2");
check("…and DOES grant send", r.statusCode === 200, `got ${r.statusCode}`);

// Permission does not travel along a chain: linked to B, and B linked to C,
// must not reach C. Nothing enforces this beyond linkedSessionIds only walking
// edges that touch MY node — one graph traversal away from silently granting
// the whole connected component.
mkSession("sess-alpha3", ALPHA);
canvas.put(
  ALPHA,
  JSON.stringify({
    nodes: [
      { id: "term-sess-alpha", type: "terminal", data: { sessionId: "sess-alpha" } },
      { id: "term-peer", type: "terminal", data: { sessionId: "sess-alpha2" } },
      { id: "term-third", type: "terminal", data: { sessionId: "sess-alpha3" } },
    ],
    edges: [
      { id: "e-ok", source: "term-sess-alpha", target: "term-peer" },
      { id: "e-chain", source: "term-peer", target: "term-third" },
    ],
  })
);
r = await peek("session=sess-alpha");
check(
  "permission does not propagate down a chain of links",
  r.statusCode === 200 &&
    r.json().linked.length === 1 &&
    r.json().linked[0].name === "sess-alpha2",
  `linked: ${JSON.stringify(r.json().linked.map((l) => l.name))}`
);
r = await send("sess-alpha3");
check("…and the far end of the chain refuses send", r.statusCode === 403, `got ${r.statusCode}`);

// …and the exemptions still work, or nobody could ever log in
r = await noCookie("/api/auth/me");
check("the auth endpoints stay reachable without a cookie", r.statusCode === 200, `got ${r.statusCode}`);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
