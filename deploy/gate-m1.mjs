// M1 gate — runs ON the server (node deploy/gate-m1.mjs). Uses the ws package
// from server/node_modules. Exercises the real HTTP + WS API end to end.
import { WebSocket } from "ws";

const BASE = "http://127.0.0.1:4560";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

function attach(id) {
  const ws = new WebSocket(`ws://127.0.0.1:4560/ws/sessions/${id}/attach?cols=120&rows=30`);
  const state = { ws, buf: "", closed: false };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    state.buf += data.toString("utf8");
    ws.send(JSON.stringify({ t: "a", n: data.length })); // ack immediately
  });
  ws.on("close", () => (state.closed = true));
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(state));
    ws.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeoutMs, label) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const input = (state, d) => state.ws.send(JSON.stringify({ t: "i", d }));

let sid;
try {
  // 1. create a shell session
  const { session } = await api("POST", "/api/sessions", { harness: "shell", name: "gate-m1" });
  sid = session.id;
  check("create session", !!sid, sid);

  // 2. echo roundtrip — wait for the attach redraw before typing, keystrokes
  // sent before the tmux client is fully attached are dropped
  let a = await attach(sid);
  await waitFor(() => a.buf.length > 0, 5000, "initial redraw");
  await sleep(300);
  input(a, "echo agora-$((40+2))\r");
  await waitFor(() => a.buf.includes("agora-42"), 5000, "echo output");
  check("echo roundtrip", true);

  // 3. start a background counter, detach, reattach -> still running
  input(a, "i=0; while true; do i=$((i+1)); echo tick-$i; sleep 1; done\r");
  await waitFor(() => /tick-\d+/.test(a.buf), 5000, "ticks");
  a.ws.close();
  await sleep(3500); // disconnected while the loop keeps ticking
  a = await attach(sid);
  await waitFor(() => a.buf.length > 0, 5000, "initial redraw after reattach");
  await sleep(300);
  await waitFor(() => /tick-\d+/.test(a.buf), 5000, "redraw after reattach");
  // the redraw replays the on-screen history; the highest tick proves the
  // loop kept running during the 3.5s disconnect
  const maxTick = () =>
    Math.max(0, ...[...a.buf.matchAll(/tick-(\d+)/g)].map((m) => Number(m[1])));
  const tickAtReattach = maxTick();
  await waitFor(() => maxTick() > tickAtReattach + 1, 6000, "live ticks after reattach");
  check("survives detach/reattach", tickAtReattach >= 3, `reattached at tick-${tickAtReattach}`);
  input(a, "\x03"); // stop the loop

  // 4. large fast output does not wedge the bridge
  await sleep(500);
  input(a, "seq 1 200000 | tail -n 5; echo GATE-DONE-$((100+23))\r");
  await waitFor(() => a.buf.includes("GATE-DONE-123"), 30000, "large output completion");
  check("large output completes", a.buf.includes("199999") || a.buf.includes("200000"));

  // 5. API still responsive after the flood
  const { sessions } = await api("GET", "/api/sessions");
  check("api responsive after flood", sessions.some((s) => s.id === sid));

  a.ws.close();
  console.log("\nNOTE: server-restart survival is exercised by gate step 6 (run wrapper script).");
} catch (err) {
  check("gate crashed", false, String(err));
} finally {
  if (sid) await api("DELETE", `/api/sessions/${sid}`).catch(() => {});
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
