// Spectator mode — node deploy/gate-spectate.mjs
//
// This is the only endpoint in agora that answers without a session cookie, so
// the interesting assertions are all about what it REFUSES to say.
//
// The temptation with a public wall display is to show the terminals — that is
// the visually impressive part. It is also where secrets live: an agent prints an
// env var, pastes a token into a shell, or is handed a key in a board message,
// and none of that is visible to whoever set the link up. So panes, files, the
// board and transcripts are out, and this gate plants a recognisable secret in
// each of those places and greps the public payload for it.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-spectate-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";

const SECRET = "sk-ant-SUPER-SECRET-DO-NOT-PUBLISH";

const { initDb, projects, sessions, plan, chat, canvas } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb, invites, issueSessionFor, requireAuth } = await import("../server/dist/auth.js");
initAuthDb(db);
const { spectateRoutes } = await import("../server/dist/routes/spectate.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const P = path.join(tmp, "projects", "hackathon");
const OTHER = path.join(tmp, "projects", "private");
fs.mkdirSync(P, { recursive: true });
fs.mkdirSync(OTHER, { recursive: true });
projects.insert({ path: P, name: "hackathon", owner_email: "owner@example.com" });
projects.insert({ path: OTHER, name: "private", owner_email: "owner@example.com" });
projects.setClock(P, { deadline: Date.now() + 7_200_000 });

sessions.insert({
  id: "s1", name: "athena", project_path: P, harness: "claude", command: "claude",
  status: "running", agent_state: "working", created_at: Date.now(), last_activity: Date.now(),
  last_summary: `I exported ${SECRET} to the environment`,
});
sessions.insert({
  id: "s2", name: "hermes", project_path: OTHER, harness: "codex", command: "codex",
  status: "running", agent_state: "idle", created_at: Date.now(), last_activity: Date.now(),
});
// a secret in each place a naive implementation would leak from
chat.insert({ project_path: P, author: "athena", harness: "claude", body: `key is ${SECRET}` });
canvas.put(P, JSON.stringify({ nodes: [{ id: "n1", type: "sticky", data: { text: SECRET } }] }), 0);
fs.writeFileSync(path.join(P, ".env"), `ANTHROPIC_API_KEY=${SECRET}\n`);
const t1 = plan.add(P, "ship the demo");
plan.claim(t1.id, "s1", "athena");
plan.add(P, "write the README");

const app = Fastify();
await app.register(cookie);
app.get("/test-login/:who", async (req, reply) => {
  if (req.params.who === "owner") issueSessionFor(reply);
  else issueSessionFor(reply, { email: "guest@example.com", name: "guest", role: "guest" });
  return { ok: true };
});
requireAuth(app);
await app.register(spectateRoutes);
const cookieFor = async (who) => {
  const res = await app.inject({ method: "GET", url: `/test-login/${who}` });
  return res.cookies.find((c) => c.name === "agora_session").value;
};
const owner = await cookieFor("owner");
const as = (token, opts) => app.inject({ ...opts, cookies: { agora_session: token } });

// ---- publishing is opt-in and owner-only --------------------------------
check(
  "a room starts unpublished",
  JSON.parse((await as(owner, { method: "GET", url: `/api/spectate?project=${encodeURIComponent(P)}` })).body).token === null
);
check(
  "REFUSED: an unpublished room is not reachable by guessing",
  (await app.inject({ method: "GET", url: "/api/spectate/anything" })).statusCode === 404
);
check(
  "REFUSED: nor by the empty token, which would otherwise match every unpublished room",
  (await app.inject({ method: "GET", url: "/api/spectate/" })).statusCode === 404
);

invites.add("guest@example.com", P);
const guest = await cookieFor("guest");
const guestPub = await as(guest, { method: "PUT", url: "/api/spectate", payload: { project: P, enabled: true } });
check(
  "REFUSED: a guest cannot publish a room to the open internet",
  guestPub.statusCode === 403,
  `got ${guestPub.statusCode}`
);
check("REFUSED: and it stayed unpublished", projects.get(P).spectator_token == null);

const pub = await as(owner, { method: "PUT", url: "/api/spectate", payload: { project: P, enabled: true } });
const token = JSON.parse(pub.body).token;
check("the owner can publish — the positive control", pub.statusCode === 200 && !!token, `${pub.statusCode}`);
check("REFUSED: and the token is not guessable", token.length >= 20, `${token.length} chars`);

// ---- the public view, with no cookie at all -----------------------------
const res = await app.inject({ method: "GET", url: `/api/spectate/${token}` });
check("the published room answers with no session cookie", res.statusCode === 200, `${res.statusCode}`);
const body = res.body;
const room = JSON.parse(body);
check("it shows the room name and clock", room.name === "hackathon" && room.remainingMs > 7_000_000);
check(
  "and the agents, by name and state — the point of a wall display",
  room.agents.length === 1 && room.agents[0].name === "athena" && room.agents[0].state === "working",
  JSON.stringify(room.agents)
);
check(
  "and the plan, with who holds what",
  room.plan.length === 2 && room.plan.some((t) => t.holder === "athena"),
  JSON.stringify(room.plan)
);
check("and one cost figure", typeof room.usd === "number");
check(
  "REFUSED: no agent from another room appears",
  !body.includes("hermes"),
  "hermes is in a different project"
);

// ---- what must never appear --------------------------------------------
check(
  "REFUSED: the secret planted in a session summary is absent",
  !body.includes(SECRET),
  "session.last_summary is not published"
);
check("REFUSED: the secret planted on the board is absent", !body.includes("key is"));
check("REFUSED: the secret planted on the canvas is absent", !body.includes("sticky"));
check(
  "REFUSED: no field carries a filesystem path",
  !body.includes(tmp) && !body.includes("projects/hackathon"),
  "a path tells a reader where the box keeps things"
);
check(
  "REFUSED: no owner email, no session ids, no tokens",
  !body.includes("owner@example.com") && !body.includes('"s1"') && !body.includes(token),
  body.slice(0, 160)
);
check(
  "the payload has exactly the five documented fields and nothing else",
  JSON.stringify(Object.keys(room).sort()) ===
    JSON.stringify(["agents", "name", "plan", "remainingMs", "usd"]),
  Object.keys(room).join(",")
);
check(
  "a public URL is never cached — a revoked room must not survive in a CDN",
  res.headers["cache-control"] === "no-store",
  String(res.headers["cache-control"])
);

// ---- the wall page ------------------------------------------------------
const page = await app.inject({ method: "GET", url: `/s/${token}` });
check("the wall page is served at /s/:token", page.statusCode === 200, `${page.statusCode}`);
check(
  "it is self-contained — no external script, style or font",
  !/src=["']https?:|href=["']https?:|@import/.test(page.body),
  "a wall URL in a room of strangers should load nothing else"
);
check(
  "REFUSED: no HTML is ever assigned from data — task titles are somebody else's text",
  // the USE, not the word: the page's own comment says "never innerHTML", and an
  // assertion that greps for the word fails on the comment that promises it
  !/\.innerHTML\s*=|insertAdjacentHTML|document\.write|outerHTML\s*=/.test(page.body),
  "textContent only"
);
check(
  "REFUSED: and the page itself carries no room data — it fetches, so a revoked room goes blank",
  !page.body.includes("hackathon") && !page.body.includes(SECRET),
  "only the token is interpolated"
);
check(
  "REFUSED: an unknown token gets no page",
  (await app.inject({ method: "GET", url: "/s/not-a-real-token-at-all" })).statusCode === 404
);
check(
  "REFUSED: and a token-shaped path that is not ours does not render either",
  (await app.inject({ method: "GET", url: "/s/AAAAAAAAAAAAAAAAAAAAAA" })).statusCode === 404
);

// ---- revocation ---------------------------------------------------------
await as(owner, { method: "PUT", url: "/api/spectate", payload: { project: P, enabled: false } });
check(
  "REFUSED: revoking the link closes it immediately",
  (await app.inject({ method: "GET", url: `/api/spectate/${token}` })).statusCode === 404
);
check("and the room is unpublished on the row too", projects.get(P).spectator_token == null);

// ---- the wall is not a way past the auth wall ---------------------------
check(
  "REFUSED: minting a token still requires a session",
  (await app.inject({ method: "PUT", url: "/api/spectate", payload: { project: P, enabled: true } })).statusCode === 401
);
check(
  "REFUSED: and reading which token a room has does too",
  (await app.inject({ method: "GET", url: `/api/spectate?project=${encodeURIComponent(P)}` })).statusCode === 401,
  "the /api/spectate/ prefix exception must not cover /api/spectate itself"
);

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
