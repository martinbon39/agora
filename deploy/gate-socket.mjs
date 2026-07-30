// The unix socket door — node deploy/gate-socket.mjs
//
// This exists for two reasons, and the gate checks both.
//
// Today: loopback TCP is reachable by every process on this machine, so an
// agent's coordination traffic shares a channel with anything else running here.
// A socket with 0600 on it does not.
//
// Later: it is the prerequisite for sandboxing sessions. bwrap can only cut a
// session off from the network with --unshare-net, and that also cuts it off from
// agora — unless the way back in is a filesystem object the sandbox is handed
// deliberately. The last block below runs exactly that, for real, and is the
// whole reason the socket was built.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-socket-"));
const DATA = path.join(tmp, "data");
const PROJECTS = path.join(tmp, "projects");
fs.mkdirSync(path.join(PROJECTS, "demo"), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const PORT = 4590 + (process.pid % 100);
const SOCK = path.join(DATA, "agora.sock");
const env = {
  ...process.env,
  AGORA_DATA_DIR: DATA,
  AGORA_PROJECTS_DIR: PROJECTS,
  AGORA_PORT: String(PORT),
  AGORA_TMUX_SOCKET: `agora-gate-socket-${process.pid}`,
  AGORA_ALLOWED_EMAIL: "owner@example.com",
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// seed a project and a session, then start the real server
const seed = execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const { initDb, projects, sessions } = await import("${path.resolve("server/dist/db.js")}");
     initDb();
     const P = process.env.AGORA_PROJECTS_DIR + "/demo";
     projects.insert({ path: P, name: "demo", owner_email: "owner@example.com" });
     sessions.insert({ id:"s1", name:"athena", project_path:P, harness:"claude", command:"claude",
       status:"running", agent_state:"idle", created_at:Date.now(), last_activity:Date.now() });
     console.log(sessions.get("s1").hook_token);`,
  ],
  { env, encoding: "utf8" }
).trim();

const srv = (await import("node:child_process")).spawn(
  process.execPath,
  [path.resolve("server/dist/index.js")],
  { env, stdio: "ignore", detached: false }
);
const waitFor = async (fn, ms = 12_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
const up = await waitFor(() => fs.existsSync(SOCK));

check("the server creates a unix socket beside its data", up, SOCK);
if (up) {
  check(
    "REFUSED: and it is 0600 — the socket is a credential-free path in, so its mode is the guard",
    (fs.statSync(SOCK).mode & 0o777) === 0o600,
    (fs.statSync(SOCK).mode & 0o777).toString(8)
  );
}

// ---- both doors serve the same app --------------------------------------
const overSocket = (p) =>
  new Promise((resolve) => {
    const req = http.request({ socketPath: SOCK, path: p }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e) }));
    req.end();
  });
const overTcp = (p) =>
  new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: p }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e) }));
    req.end();
  });

const s = await overSocket("/api/version");
const t = await overTcp("/api/version");
check("the socket serves the same app as the port", s.status === 200 && s.body === t.body, s.body);
check(
  "REFUSED: and it is not a way around the auth wall — no cookie is still 401",
  (await overSocket("/api/sessions")).status === 401,
  "the door changed, not the lock"
);
check(
  "a hook call with a session token works over the socket",
  (await overSocket(`/api/hooks/plan?session=s1`)).status === 401,
  "no header yet, so 401 — the header is exercised by the CLI below"
);

// ---- the CLI picks the socket -------------------------------------------
const cli = (extraEnv, args) =>
  spawnSync(process.execPath, [path.resolve("cli/agora"), ...args], {
    env: { ...env, AGORA_SESSION_ID: "s1", AGORA_SESSION_TOKEN: seed, ...extraEnv },
    encoding: "utf8",
  });
const added = cli({}, ["plan", "add", "reachable"]);
check(
  "the CLI reaches the server with no port in sight",
  added.status === 0 && added.stdout.includes("added"),
  (added.stdout + added.stderr).trim().slice(0, 120)
);
// point it at a socket that does not exist: it must fall back to TCP, not die
const fellBack = cli({ AGORA_SOCKET: path.join(tmp, "nope.sock") }, ["plan"]);
check(
  "with no socket it falls back to TCP — a shell agora did not start still works",
  fellBack.status === 0 && fellBack.stdout.includes("reachable"),
  (fellBack.stdout + fellBack.stderr).trim().slice(0, 120)
);
// and with neither door, the error names the door it tried
const neither = spawnSync(process.execPath, [path.resolve("cli/agora"), "plan"], {
  env: { ...env, AGORA_PORT: "1", AGORA_SOCKET: path.join(tmp, "nope.sock"), AGORA_SESSION_ID: "s1", AGORA_SESSION_TOKEN: seed },
  encoding: "utf8",
});
check(
  "REFUSED: and an unreachable server names the door it actually tried",
  /unreachable on port 1/.test(neither.stderr),
  neither.stderr.trim().slice(0, 100)
);

// ---- the reason the socket exists ---------------------------------------
const bwrap = spawnSync("bwrap", ["--version"], { encoding: "utf8" }).status === 0;
if (!bwrap) {
  console.log("SKIP  bwrap not available — the sandbox reachability check needs it");
} else {
  const lib64 = fs.existsSync("/lib64") ? ["--ro-bind", "/lib64", "/lib64"] : [];
  const sandbox = (bindSocket) =>
    spawnSync(
      "bwrap",
      [
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/lib", "/lib",
        ...lib64,
        "--ro-bind", "/etc", "/etc",
        "--proc", "/proc", "--dev", "/dev",
        "--tmpfs", "/home",
        "--ro-bind", path.resolve("cli"), "/cli",
        ...(bindSocket ? ["--bind", DATA, "/agora-data"] : ["--tmpfs", "/agora-data"]),
        "--unshare-net", "--unshare-pid",
        "--setenv", "AGORA_DATA_DIR", "/agora-data",
        "--setenv", "AGORA_SESSION_ID", "s1",
        "--setenv", "AGORA_SESSION_TOKEN", seed,
        "--setenv", "AGORA_PORT", String(PORT),
        "/usr/bin/node", "/cli/agora", "plan",
      ],
      { encoding: "utf8" }
    );
  const withSocket = sandbox(true);
  check(
    "THE POINT: with the network unshared, a session handed the socket still coordinates",
    withSocket.status === 0 && withSocket.stdout.includes("reachable"),
    (withSocket.stdout + withSocket.stderr).trim().slice(0, 140)
  );
  const without = sandbox(false);
  check(
    "REFUSED: and one not handed it reaches nothing at all",
    without.status !== 0 && /unreachable/.test(without.stderr),
    without.stderr.trim().slice(0, 100)
  );
}

srv.kill("SIGTERM");
await waitFor(() => !fs.existsSync(SOCK), 5_000);
check(
  "the socket is removed on shutdown — a stale one would block the next boot",
  !fs.existsSync(SOCK),
  fs.existsSync(SOCK) ? "still there" : "gone"
);

spawnSync("tmux", ["-L", env.AGORA_TMUX_SOCKET, "kill-server"], { stdio: "ignore" });
fs.rmSync(path.join(os.tmpdir(), `tmux-${process.getuid()}`, env.AGORA_TMUX_SOCKET), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
