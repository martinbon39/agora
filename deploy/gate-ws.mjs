// The websocket gate — node deploy/gate-ws.mjs (build the server first).
//
// Nothing in the suite opened a real websocket before this file. gate-socket is
// about the UNIX socket (the second HTTP door for sandboxed sessions), and the
// two Playwright gates mock the attach socket with page.routeWebSocket, which
// is exactly the part that breaks. So the whole live path — upgrade, auth on
// upgrade, pty round-trip, resize, flow control, presence, revocation — could
// break under a green suite, and did.
//
// The last block is the one this file was written for. A TCP connection can
// stop delivering without a FIN or an RST: a closed laptop lid, a NAT or proxy
// idle timeout, a wifi handover. Neither end can notice without a heartbeat, so
// the server kept the pty and its tmux attach client forever, and the browser
// kept a socket at readyState OPEN whose `onclose` never fired — meaning every
// reconnect path in the UI, all of which hang off `onclose`, never ran. That is
// what "the websocket doesn't work" looked like.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { WebSocket } from "ws";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-ws-"));
const DATA = path.join(tmp, "data");
const PROJECTS = path.join(tmp, "projects");
const ALPHA = path.join(PROJECTS, "alpha");
fs.mkdirSync(ALPHA, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const PORT = 4600 + (process.pid % 90);
const RELAY = PORT + 100;
const TMUX = `agora-gate-ws-${process.pid}`;
const env = {
  ...process.env,
  AGORA_DATA_DIR: DATA,
  AGORA_PROJECTS_DIR: PROJECTS,
  AGORA_PORT: String(PORT),
  AGORA_TMUX_SOCKET: TMUX,
  AGORA_ALLOWED_EMAIL: "owner@example.com",
  AGORA_ORIGIN: `http://127.0.0.1:${PORT}`,
};

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const OWNER_TOK = crypto.randomBytes(32).toString("base64url");
const GUEST_TOK = crypto.randomBytes(32).toString("base64url");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(150);
  }
  return false;
};

// ---- seed: a project, two identities, a guest invited into that project ----
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const { initDb, projects } = await import("${path.resolve("server/dist/db.js")}");
     const { initAuthDb, invites } = await import("${path.resolve("server/dist/auth.js")}");
     const db = initDb(); initAuthDb(db);
     projects.insert({ path: ${JSON.stringify(ALPHA)}, name: "alpha", owner_email: "owner@example.com" });
     invites.add("guest@example.com", ${JSON.stringify(ALPHA)});
     const now = Date.now(), ttl = now + 30*24*3600*1000;
     const ins = db.prepare("INSERT INTO auth_sessions (token_hash, created_at, expires_at, email, name, role) VALUES (?,?,?,?,?,?)");
     ins.run(${JSON.stringify(sha256(OWNER_TOK))}, now, ttl, "owner@example.com", "owner", "owner");
     ins.run(${JSON.stringify(sha256(GUEST_TOK))}, now, ttl, "guest@example.com", "guest", "guest");`,
  ],
  { env, stdio: ["ignore", "pipe", "inherit"] }
);

const srv = spawn(process.execPath, [path.resolve("server/dist/index.js")], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
srv.stdout.on("data", (d) => (serverLog += d));
srv.stderr.on("data", (d) => (serverLog += d));

const BASE = `http://127.0.0.1:${PORT}`;
const api = async (method, p, body, tok = OWNER_TOK) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      cookie: `agora_session=${tok}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: text, json };
};

const cleanup = () => {
  try {
    srv.kill("SIGKILL");
  } catch {}
  spawnSync("tmux", ["-L", TMUX, "kill-server"], { stdio: "ignore" });
  fs.rmSync(tmp, { recursive: true, force: true });
};
const bail = async (why) => {
  console.log(`\n${why}\n--- server log ---\n${serverLog.slice(-3000)}`);
  cleanup();
  process.exit(1);
};

if (!(await waitFor(async () => (await fetch(BASE + "/api/version")).ok, 20_000)))
  await bail("the server never came up");

const created = await api("POST", "/api/sessions", {
  harness: "shell",
  name: "gate-ws",
  projectPath: ALPHA,
});
const sid = created.json?.session?.id;
if (!sid) await bail(`could not create a session: ${created.status} ${created.body.slice(0, 300)}`);

// ---- 1. the terminal socket ------------------------------------------------
function attach(tok, { port = PORT, query = "cols=120&rows=30" } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/sessions/${sid}/attach?${query}`, {
    headers: { cookie: `agora_session=${tok}` },
  });
  const st = { ws, buf: "", bytes: 0, opened: false, closed: null, err: null, http: null };
  ws.on("message", (d, isBinary) => {
    if (!isBinary) return;
    st.bytes += d.length;
    st.buf += d.toString("utf8");
    ws.send(JSON.stringify({ t: "a", n: d.length }));
  });
  ws.on("open", () => (st.opened = true));
  ws.on("close", (c, r) => (st.closed = { code: c, reason: String(r) }));
  ws.on("error", (e) => (st.err = String(e)));
  ws.on("unexpected-response", (_q, res) => (st.http = res.statusCode));
  return st;
}

const a = attach(OWNER_TOK);
await waitFor(() => a.opened || a.closed || a.err, 10_000);
check("the attach socket upgrades with a session cookie", a.opened, `http=${a.http} err=${a.err}`);
if (!a.opened) await bail("nothing else can be tested without an attach");

check("the pty sends its first redraw", await waitFor(() => a.bytes > 0, 10_000), `${a.bytes} bytes`);
await sleep(400);
a.ws.send(JSON.stringify({ t: "i", d: "echo agora-$((40+2))\r" }));
check(
  "keystrokes reach the pty and its output comes back",
  await waitFor(() => a.buf.includes("agora-42"), 10_000),
  JSON.stringify(a.buf.slice(-120))
);

a.ws.send(JSON.stringify({ t: "r", cols: 100, rows: 40 }));
await sleep(500);
a.buf = "";
a.ws.send(JSON.stringify({ t: "i", d: "tput cols\r" }));
check(
  "a resize reaches the pty — a wrong width corrupts every full-screen TUI",
  await waitFor(() => /\b100\b/.test(a.buf), 10_000),
  JSON.stringify(a.buf.slice(-120))
);

// Flow control: the server pauses the pty above flowHighWater and only resumes
// on acks. A bug here does not fail loudly, it wedges the terminal forever.
a.buf = "";
a.ws.send(JSON.stringify({ t: "i", d: "seq 1 200000 | tail -n 3; echo FLOOD-DONE\r" }));
check(
  "a flood larger than the flow-control window drains instead of wedging",
  await waitFor(() => a.buf.includes("FLOOD-DONE"), 60_000),
  `${a.bytes} bytes`
);
check(
  "the HTTP API is still responsive after the flood",
  (await api("GET", "/api/sessions")).status === 200
);

// ---- 2. the upgrade is behind the same wall as everything else -------------
const anon = attach("not-a-real-token");
await waitFor(() => anon.opened || anon.closed || anon.err, 8_000);
check(
  "REFUSED: an attach with a bad cookie never upgrades",
  !anon.opened,
  anon.opened ? "IT OPENED" : `http=${anon.http}`
);

const xsite = new WebSocket(`ws://127.0.0.1:${PORT}/ws/events`, {
  headers: {
    cookie: `agora_session=${OWNER_TOK}`,
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  },
});
const xs = { opened: false, http: null };
xsite.on("open", () => (xs.opened = true));
xsite.on("error", () => {});
xsite.on("unexpected-response", (_q, res) => (xs.http = res.statusCode));
await waitFor(() => xs.opened || xs.http, 8_000);
check(
  "REFUSED: a cross-site websocket is refused even carrying a valid cookie",
  !xs.opened && xs.http === 403,
  xs.opened ? "IT OPENED" : `http=${xs.http}`
);

// ---- 2b. the rate limiter cannot be stepped around with an encoding -------
// The auth endpoints are the only rate-limited prefix, and invite redemption is
// one of them — it is what stands between a link token and someone guessing at
// it. The predicate tested req.raw.url, the UNDECODED target, while the router
// percent-decodes before matching: `/%61pi/auth/...` reached the handler with
// the limiter exempting it, 45 of 45 attempts unthrottled. Exactly the gap the
// auth gate itself was fixed for, in the other direction. Needs a real server —
// fastify.inject does not run the plugin's keying the same way.
{
  const hammer = async (p) => {
    const codes = [];
    for (let i = 0; i < 40; i++) {
      const res = await fetch(BASE + p, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: `guess-${i}` }),
      });
      codes.push(res.status);
    }
    return codes;
  };
  const encoded = await hammer("/%61pi/auth/invite");
  const reached = encoded.filter((c) => c === 403).length;
  check(
    "REFUSED: a percent-encoded auth path is rate limited like the plain one",
    encoded.includes(429),
    reached === encoded.length
      ? `all ${reached} attempts reached the handler unthrottled`
      : `codes seen: ${[...new Set(encoded)].join(",")}`
  );
}

// ---- 3. two people on one canvas ------------------------------------------
function events(tok) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/events`, {
    headers: { cookie: `agora_session=${tok}` },
  });
  const st = { ws, msgs: [], opened: false, closed: null, err: null, http: null };
  ws.on("message", (d) => {
    try {
      st.msgs.push(JSON.parse(String(d)));
    } catch {}
  });
  ws.on("open", () => (st.opened = true));
  ws.on("close", (c) => (st.closed = c));
  ws.on("error", (e) => (st.err = String(e)));
  ws.on("unexpected-response", (_q, res) => (st.http = res.statusCode));
  return st;
}
const e1 = events(OWNER_TOK);
const e2 = events(GUEST_TOK);
await waitFor(() => (e1.opened || e1.err) && (e2.opened || e2.err), 10_000);
check("the owner's events socket opens", e1.opened, `http=${e1.http} err=${e1.err}`);
check("an invited guest's events socket opens too", e2.opened, `http=${e2.http} err=${e2.err}`);

e1.ws.send(JSON.stringify({ type: "hello", clientId: "owner-tab", project: ALPHA }));
await sleep(250);
e2.ws.send(JSON.stringify({ type: "hello", clientId: "guest-tab", project: ALPHA }));
check(
  "the owner sees the guest join the project's presence room",
  await waitFor(
    () =>
      e1.msgs.some(
        (m) => m.type === "presence" && (m.peers ?? []).some((p) => p.clientId === "guest-tab")
      ),
    8_000
  ),
  JSON.stringify(e1.msgs.slice(-2))
);
e2.ws.send(JSON.stringify({ type: "cursor", x: 12, y: 34 }));
check(
  "the guest's cursor is relayed to the owner",
  await waitFor(() => e1.msgs.some((m) => m.type === "cursor" && m.x === 12 && m.y === 34), 8_000)
);

const guestTerm = attach(GUEST_TOK);
await waitFor(() => guestTerm.opened || guestTerm.closed || guestTerm.err, 10_000);
check("the guest can attach a terminal inside their project", guestTerm.opened, `http=${guestTerm.http}`);

// ---- 4. revocation reaches connections that are already open --------------
check(
  "the owner revokes the invite",
  (await api("DELETE", `/api/invites/${encodeURIComponent("guest@example.com")}`)).status === 200
);
check(
  "revoking closes the guest's live events socket",
  await waitFor(() => e2.closed !== null, 8_000),
  `code ${e2.closed}`
);
check(
  "REFUSED: and their attached terminal too, not merely their next request",
  await waitFor(() => guestTerm.closed !== null, 8_000),
  JSON.stringify(guestTerm.closed)
);
check(
  "a revoked guest is refused by the HTTP API",
  (await api("GET", "/api/sessions", null, GUEST_TOK)).status === 401
);

// ---- 5. the black hole -----------------------------------------------------
// A relay that stops forwarding without closing: no FIN, no RST, just silence.
let blackhole = false;
const wires = [];
const relay = net.createServer((client) => {
  const upstream = net.connect(PORT, "127.0.0.1");
  wires.push(client, upstream);
  client.on("data", (d) => !blackhole && upstream.write(d));
  upstream.on("data", (d) => !blackhole && client.write(d));
  const bye = () => {
    if (blackhole) return; // a black hole must not propagate a close either
    client.destroy();
    upstream.destroy();
  };
  for (const s of [client, upstream]) {
    s.on("error", bye);
    s.on("close", bye);
  }
});
await new Promise((r) => relay.listen(RELAY, "127.0.0.1", r));

// The client half of the heartbeat is web/src/lib/keepAlive.ts. Transpile and
// drive the REAL module — a reimplementation here would pass while the shipped
// one was broken, which is the failure mode this whole file exists to catch.
const ts = (await import("typescript")).default;
const jsFile = path.join(tmp, "keepAlive.mjs");
fs.writeFileSync(
  jsFile,
  ts.transpileModule(fs.readFileSync(path.resolve("web/src/lib/keepAlive.ts"), "utf8"), {
    compilerOptions: { target: "es2022", module: "esnext" },
  }).outputText
);
const { keepAlive } = await import(`file://${jsFile}`);

const bh = attach(OWNER_TOK, { port: RELAY });
await waitFor(() => bh.opened || bh.closed || bh.err, 10_000);
check("a terminal attaches through the relay", bh.opened, `http=${bh.http} err=${bh.err}`);
let clientGaveUp = false;
const heart = keepAlive(bh.ws, { t: "p" }, () => (clientGaveUp = true));
bh.ws.on("message", () => heart.seen());
await waitFor(() => bh.bytes > 0, 10_000);

const tmuxClients = () => {
  const r = spawnSync("tmux", ["-L", TMUX, "list-clients", "-t", `=agora-${sid}`], {
    encoding: "utf8",
  });
  return (r.stdout || "").trim().split("\n").filter(Boolean).length;
};
// The healthy attach from block 1 is still connected, so this is 2. Counting
// the drop rather than expecting zero is the stronger assertion: it says the
// silent client was reclaimed AND the live one beside it was not — a heartbeat
// tuned too tight would hang up on a terminal that is merely idle.
const attachedBefore = tmuxClients();
check("tmux reports both attached clients", attachedBefore === 2, `${attachedBefore}`);

console.log("\n  … black-holing the connection: no FIN, no RST, just silence …\n");
blackhole = true;
// Worst case the server terminates at ~45s (it checks every 15s for 40s of
// silence) and the client gives up at ~40s (it probes 10s after the last frame
// and allows the probe 25s). Wait past both, with margin — timers run late on
// a loaded machine, and a flaky gate is worse than a slow one.
await sleep(52_000);

check(
  "THE POINT: the server reclaims the pty and tmux client of a peer gone silent",
  await waitFor(() => tmuxClients() === attachedBefore - 1, 8_000),
  tmuxClients() === attachedBefore
    ? `tmux still holds all ${attachedBefore} clients — the pty leaks for the life of the server`
    : `${tmuxClients()} left of ${attachedBefore}`
);
check(
  "…and the idle-but-live terminal beside it is untouched",
  a.closed === null,
  a.closed ? `it was hung up on: ${JSON.stringify(a.closed)}` : ""
);
check(
  "REFUSED: and the browser gives up on its end, so its reconnect can run at all",
  clientGaveUp,
  clientGaveUp
    ? ""
    : "readyState stayed OPEN — onclose never fires, and every reconnect path hangs off onclose"
);

// ---- teardown --------------------------------------------------------------
heart.stop();
blackhole = false;
for (const s of wires) {
  try {
    s.destroy();
  } catch {}
}
relay.close();
for (const st of [a, anon, e1, e2, guestTerm, bh]) {
  try {
    st.ws.terminate();
  } catch {}
}
await api("DELETE", `/api/sessions/${sid}`).catch(() => {});
srv.kill("SIGTERM");
const died = await waitFor(() => srv.exitCode !== null, 8_000);
if (!died) srv.kill("SIGKILL");
check("REFUSED: one SIGTERM stops the server — a gate that escalates hides a leak", died);
spawnSync("tmux", ["-L", TMUX, "kill-server"], { stdio: "ignore" });
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join(" | "));
  console.log("\n--- server log ---\n" + serverLog.slice(-3000));
}
process.exit(failed.length ? 1 : 0);
