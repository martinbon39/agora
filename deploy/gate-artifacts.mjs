// Artifact-link gate — node deploy/gate-artifacts.mjs (build the server first).
//
// An artifact is a page an agent made for the owner, and the owner opens it
// where his session cookie is not: a phone, a Slack webview, another browser.
// Three refusals used to fire there and every one of them looked like the app
// being broken — 401 without the cookie, 403 for a click coming from another
// site, and a download instead of a page when the name had no extension.
//
// So this gate is written around what must still be refused. A link that opens
// one file must open NOTHING else: not another artifact, not /api, not after
// it expires, not with a byte of the signature changed, and never a write.
// Every refusal is paired with the request that must still succeed, or a gate
// that only ever says no would pass just as well with the door welded shut.
//
// Hermetic: its own data dir, its own in-memory db, no network, no tmux.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-artifacts-"));
const dataDir = path.join(tmp, "data");
fs.mkdirSync(path.join(dataDir, "artifacts"), { recursive: true });
fs.writeFileSync(path.join(dataDir, "hook-secret"), "s3cret-for-the-gate\n");
fs.writeFileSync(path.join(dataDir, "env"), "AGORA_ORIGIN=https://agora.example.com\n");
process.env.AGORA_DATA_DIR = dataDir;
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");

const Database = (await import("better-sqlite3")).default;
const Fastify = (await import("fastify")).default;
const cookie = (await import("@fastify/cookie")).default;
const { requireAuth, initAuthDb, artifactToken, artifactTokenValid, artifactRead } = await import(
  "../server/dist/auth.js"
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// --- an app with the real gate in front of stand-in routes ------------------
const db = new Database(":memory:");
initAuthDb(db);
const COOKIE = "a-live-session";
db.prepare(
  `INSERT INTO auth_sessions (token_hash, created_at, expires_at, email, name, role) VALUES (?,?,?,?,?,?)`
).run(
  crypto.createHash("sha256").update(COOKIE).digest("hex"),
  Date.now(),
  Date.now() + 3600_000,
  "owner@example.com",
  "Martin",
  "owner"
);

const app = Fastify();
await app.register(cookie);
requireAuth(app);
app.all("/artifacts/*", async () => "the page");
app.all("/api/sessions", async () => ({ ok: true }));
app.get("/index.html", async () => "the login screen");
await app.ready();

const get = (url, headers = {}) => app.inject({ method: "GET", url, headers });
const withCookie = { cookie: `agora_session=${COOKIE}` };
const CROSS = { "sec-fetch-site": "cross-site" };

// --- the bug: a link that leaves the logged-in browser ----------------------
check(
  "an unsigned artifact link 401s outside the session's browser",
  (await get("/artifacts/report.html")).statusCode === 401,
  "the cookie has no domain attribute: one hostname, one browser"
);
const token = artifactToken("report.html");
check(
  "the same link, signed, opens with no cookie at all",
  (await get(`/artifacts/report.html?t=${token}`)).statusCode === 200
);
check(
  "and a signed link still opens when the click comes from another site",
  (await get(`/artifacts/report.html?t=${token}`, CROSS)).statusCode === 200,
  "Slack, mail, a QR code — every real way an artifact link is opened"
);
check(
  "a plain navigation from another site works too, once logged in",
  (await get("/artifacts/report.html", { ...withCookie, ...CROSS })).statusCode === 200,
  "a GET mutates nothing; refusing it only ever refused the owner"
);

// --- what the token must NOT open ------------------------------------------
check(
  "a token for one artifact does not open another",
  (await get(`/artifacts/secrets.html?t=${token}`)).statusCode === 401,
  "it is a capability for one file, not a session"
);
check(
  "and opens nothing outside /artifacts",
  (await get(`/api/sessions?t=${artifactToken("sessions")}`)).statusCode === 401
);
check(
  "an expired token is refused",
  (await get(`/artifacts/report.html?t=${artifactToken("report.html", Date.now() - 1000)}`))
    .statusCode === 401
);
const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
check(
  "a token with one byte changed is refused",
  (await get(`/artifacts/report.html?t=${tampered}`)).statusCode === 401
);
check(
  "garbage in ?t= is refused, not crashed on",
  (await get("/artifacts/report.html?t=not-a-token")).statusCode === 401 &&
    (await get("/artifacts/report.html?t=")).statusCode === 401 &&
    (await get(`/artifacts/report.html?t=zzzz.${"A".repeat(32)}`)).statusCode === 401
);
check(
  "a signed link is read-only: the same token does not authorise a write",
  (await app.inject({ method: "POST", url: `/artifacts/report.html?t=${token}` })).statusCode === 401
);
check(
  "an expiry far in the future is still only as good as its signature",
  !artifactTokenValid("report.html", `${(Date.now() + 1e12).toString(36)}.${"A".repeat(32)}`)
);

// --- the CSRF rule the exemption must not have widened ---------------------
check(
  "a cross-site write to the API is still refused",
  (await app.inject({ method: "POST", url: "/api/sessions", headers: { ...withCookie, ...CROSS } }))
    .statusCode === 403
);
check(
  "a cross-site READ of the API is still refused too",
  (await get("/api/sessions", { ...withCookie, ...CROSS })).statusCode === 403,
  "the exemption is for artifacts, not for safe methods in general"
);
check(
  "the API still needs the cookie",
  (await get("/api/sessions")).statusCode === 401 &&
    (await get("/api/sessions", withCookie)).statusCode === 200
);
check(
  "the SPA's own assets stay public",
  (await get("/index.html")).statusCode === 200
);

// --- path shapes -----------------------------------------------------------
check(
  "a percent-encoded prefix is still recognised as an artifact read",
  artifactRead("GET", "/%61rtifacts/report.html?t=x")?.name === "report.html",
  "the router decodes before matching; the gate must see what it will serve"
);
check(
  "an encoded traversal is not an artifact name",
  artifactRead("GET", "/artifacts/..%2f..%2fetc%2fpasswd?t=x") === null &&
    artifactRead("GET", "/artifacts/sub/dir.html") === null
);
check(
  "an undecodable path is not an artifact read either",
  artifactRead("GET", "/artifacts/%E0%A4%A.html") === null
);
check(
  "the token travels in the query and not in the name",
  artifactRead("GET", "/artifacts/report.html?t=abc.def")?.token === "abc.def" &&
    artifactRead("GET", "/artifacts/report.html")?.token === undefined
);

// --- the CLI half: it signs, the server verifies ---------------------------
const src = path.join(tmp, "page.html");
fs.writeFileSync(src, "<h1>hi</h1>");
const cli = (args) =>
  execFileSync("node", [path.join(root, "cli", "agora"), "artifact", ...args], {
    env: { ...process.env, AGORA_DATA_DIR: dataDir },
    encoding: "utf8",
  }).trim();

const printed = cli([src, "--name", "push-livrables-maquette"]);
const [printedPath, printedQuery] = printed.split("?");
check(
  "the CLI gives a --name without extension the source file's",
  printedPath === "https://agora.example.com/artifacts/push-livrables-maquette.html",
  "no extension means octet-stream, and nosniff turns the page into a download"
);
check(
  "and the file lands on disk under that name",
  fs.existsSync(path.join(dataDir, "artifacts", "push-livrables-maquette.html"))
);
check(
  "the URL the CLI prints is one the server accepts",
  artifactTokenValid("push-livrables-maquette.html", new URLSearchParams(printedQuery).get("t")),
  "two implementations of one token: the drift is what this pins"
);
check(
  "and it opens for real, through the gate, with no cookie",
  (await get(`/artifacts/push-livrables-maquette.html?${printedQuery}`)).statusCode === 200
);
check(
  "an explicit extension is left alone",
  cli([src, "--name", "report.htm"]).split("?")[0].endsWith("/artifacts/report.htm")
);
check(
  "--private prints a bare URL for the logged-in browser only",
  cli([src, "--private"]) === "https://agora.example.com/artifacts/page.html"
);
check(
  "--ttl shortens the life of the link",
  (() => {
    const t = new URLSearchParams(cli([src, "--ttl", "1"]).split("?")[1]).get("t");
    const exp = Number.parseInt(t.split(".")[0], 36);
    return exp > Date.now() && exp < Date.now() + 2 * 86400000;
  })()
);
let rejected = "";
try {
  cli([src, "--ttl", "-3"]);
} catch (e) {
  rejected = String(e.stderr ?? "");
}
check("a nonsense --ttl is refused instead of signing a dead link", rejected.includes("--ttl"));

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
