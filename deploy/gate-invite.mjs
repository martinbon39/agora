// The invitation gate — node deploy/gate-invite.mjs (build the server first).
//
// gate-scope proves a guest is confined to one project. It proves it by
// calling invites.add() and issueSessionFor() directly, which quietly assumes
// the part this file tests: that a second human can GET a session at all.
//
// They could not. The only sign-in for a non-owner was Google OAuth, so on a
// fresh clone with no OAuth client the invite list was an allowlist waiting for
// a door that did not exist — you could invite someone and they could never
// arrive. That is the whole multiplayer feature failing closed on exactly the
// install an open-source user has.
//
// So this runs the flow a real second person runs, over HTTP, end to end:
// the owner invites and gets a link, the guest opens the link and is signed in,
// sees their one project and nothing else, and the link dies when revoked.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-invite-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";
// Deliberately NOT set: AGORA_GOOGLE_CLIENT_ID / _SECRET. This gate must pass
// on an install that has never heard of Google, because that is the default.
delete process.env.AGORA_GOOGLE_CLIENT_ID;
delete process.env.AGORA_GOOGLE_CLIENT_SECRET;

const ALPHA = path.join(tmp, "projects", "alpha");
const BETA = path.join(tmp, "projects", "beta");
fs.mkdirSync(ALPHA, { recursive: true });
fs.mkdirSync(BETA, { recursive: true });

const { initDb, projects } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, invites, issueSessionFor, requireAuth, authRoutes, getAuthUser, scopeAllows } =
  await import("../server/dist/auth.js");
initAuthDb(db);
const { inviteRoutes } = await import("../server/dist/routes/invites.js");
const { projectRoutes } = await import("../server/dist/routes/projects.js");
const { googleAuthRoutes } = await import("../server/dist/googleAuth.js");

projects.insert({ path: ALPHA, name: "alpha", owner_email: "owner@example.com" });
projects.insert({ path: BETA, name: "beta", owner_email: "owner@example.com" });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const app = Fastify();
await app.register(cookie);
app.get("/test-login/owner", async (_req, reply) => {
  issueSessionFor(reply, { email: "owner@example.com", name: "owner", role: "owner" });
  return { ok: true };
});
requireAuth(app);
await app.register(authRoutes);
await app.register(googleAuthRoutes);
await app.register(inviteRoutes);
await app.register(projectRoutes);

const login = await app.inject({ method: "GET", url: "/test-login/owner" });
const owner = login.cookies.find((c) => c.name === "agora_session").value;
const as = (tok, opts) => app.inject({ ...opts, cookies: { agora_session: tok } });

// --- the state an open-source user actually starts in ----------------------
const me = await app.inject({ method: "GET", url: "/api/auth/me" });
check(
  "an install with no Google credentials reports google:false",
  me.json().google === false,
  "so the UI offers no sign-in the operator has not configured"
);

// --- the owner invites ------------------------------------------------------
let r = await as(owner, {
  method: "POST",
  url: "/api/invites",
  payload: { email: "guest@example.com", project: ALPHA },
});
check("the owner invites someone into one project", r.statusCode === 200, `got ${r.statusCode}`);
const link = r.json().link;
check(
  "THE POINT: inviting hands back a sign-in link, with no OAuth configured",
  typeof link === "string" && /\/api\/auth\/invite\/[\w-]{20,}$/.test(link),
  link ? String(link) : "no link in the response — the guest has no way in"
);
check(
  "the link is never listed afterwards, only its existence",
  r.json().invites[0].hasLink === true && !JSON.stringify(r.json().invites).includes(link.split("/").pop()),
  "only the hash is stored, so a leaked database hands out no invitations"
);

// --- the guest opens it -----------------------------------------------------
const tokenPath = new URL(link).pathname;
r = await app.inject({ method: "GET", url: tokenPath });
check(
  "opening the link signs the guest in and lands them in the app",
  r.statusCode === 302 && r.headers.location === "/",
  `got ${r.statusCode} -> ${r.headers.location}`
);
const guest = r.cookies.find((c) => c.name === "agora_session")?.value;
check("…and it sets a real session cookie", !!guest);

// --- who the server thinks they are ----------------------------------------
r = await as(guest, { method: "GET", url: "/api/auth/me" });
const who = r.json().user;
check(
  "the session is a guest scoped to the invited project",
  who?.role === "guest" && who?.email === "guest@example.com" && who?.project === ALPHA,
  JSON.stringify(who)
);
check(
  "REFUSED: a guest is not an owner — the link cannot mint one",
  who?.role !== "owner",
  "a link that granted ownership would hand the box to anyone it was forwarded to"
);

// --- and what they can see --------------------------------------------------
r = await as(guest, { method: "GET", url: "/api/projects" });
const seen = (r.json().projects ?? []).map((p) => p.path);
check(
  "the guest sees exactly the one project they were invited to",
  seen.length === 1 && seen[0] === ALPHA,
  JSON.stringify(seen)
);
check("REFUSED: and the owner's other project is not among them", !seen.includes(BETA));

r = await as(guest, { method: "POST", url: "/api/invites", payload: { email: "friend@example.com" } });
check(
  "REFUSED: a guest cannot invite anyone — no self-escalation through the link",
  r.statusCode === 403,
  `got ${r.statusCode}`
);

// --- rotation ---------------------------------------------------------------
r = await as(owner, { method: "POST", url: "/api/invites/guest%40example.com/link" });
const rotated = r.json().link;
check("the owner can mint a fresh link", r.statusCode === 200 && !!rotated && rotated !== link);
r = await app.inject({ method: "GET", url: tokenPath });
check(
  "REFUSED: and the previous link stops working the moment it is replaced",
  r.headers.location === "/#denied",
  `got ${r.statusCode} -> ${r.headers.location}`
);
r = await app.inject({ method: "GET", url: new URL(rotated).pathname });
check("…while the new one works", r.headers.location === "/", `-> ${r.headers.location}`);

// --- revocation kills the link, not just the sessions ----------------------
// The sessions were always cut. The link is a bearer credential that outlives
// them, so revoking has to destroy it too or "revoked" means nothing.
r = await as(owner, { method: "DELETE", url: "/api/invites/guest%40example.com" });
check("the owner revokes the invite", r.statusCode === 200);
r = await app.inject({ method: "GET", url: new URL(rotated).pathname });
check(
  "THE POINT: a revoked invite's link is dead — it cannot be redeemed again",
  r.headers.location === "/#denied",
  `got ${r.statusCode} -> ${r.headers.location}`
);
r = await as(guest, { method: "GET", url: "/api/projects" });
check("…and the session it already issued is refused", r.statusCode === 401, `got ${r.statusCode}`);

// --- garbage --------------------------------------------------------------
for (const [label, token] of [
  ["nonsense", "not-a-token"],
  ["empty", " "],
  ["a path traversal", "..%2F..%2Fetc"],
]) {
  r = await app.inject({ method: "GET", url: `/api/auth/invite/${token}` });
  check(
    `REFUSED: ${label} redeems nothing`,
    r.headers.location === "/#denied" || r.statusCode === 404,
    `got ${r.statusCode} -> ${r.headers.location}`
  );
}

// --- re-inviting a revoked guest gives a working link again ---------------
r = await as(owner, {
  method: "POST",
  url: "/api/invites",
  payload: { email: "guest@example.com", project: BETA },
});
const reLink = r.json().link;
r = await app.inject({ method: "GET", url: new URL(reLink).pathname });
const back = r.cookies.find((c) => c.name === "agora_session")?.value;
check("a re-invited guest gets in again", r.headers.location === "/" && !!back);
r = await as(back, { method: "GET", url: "/api/projects" });
check(
  "…scoped to the NEW project, not the one they were invited to before",
  (r.json().projects ?? []).every((p) => p.path === BETA),
  JSON.stringify((r.json().projects ?? []).map((p) => p.path))
);

// --- the owner's own address is not invitable -----------------------------
r = await as(owner, { method: "POST", url: "/api/invites", payload: { email: "owner@example.com" } });
check(
  "REFUSED: the owner cannot be invited as a guest of their own cockpit",
  r.statusCode === 400,
  `got ${r.statusCode}`
);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
