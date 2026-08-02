// The filesystem sandbox — node deploy/gate-sandbox.mjs
//
// AGORA_SANDBOX=bwrap is opt-in, and an opt-in path nobody exercises rots. Five
// mounts all have to stay true — the harness install directory, ~/.local/bin,
// /dev, /tmp and the socket — and the day this becomes the default is the worst
// possible day to discover which one lapsed. So this gate starts a REAL session
// under the real launcher and interrogates it from outside, rather than asserting
// against an argument list.
//
// Three properties, each an exit code read out of the live pane:
//   1. `claude` resolves inside. A tmpfs over the home keeps $PATH and deletes
//      the binary, so a sandbox that "works" can still contain no harness.
//   2. agora's database is NOT readable. That is the whole point.
//   3. The socket door is present, so a sandboxed agent can still coordinate.
//
// Reading answers back through capture-pane also exercises the claim the design
// rests on: send-keys and capture-pane are served by the tmux SERVER over its own
// socket, and never cross the pane's namespace.
//
// A SANDBOX BREAKS IN BOTH DIRECTIONS, and an earlier version of this gate could
// only see one of them. Almost every assertion was "must be ABSENT", so the
// failure mode "everything correctly forbidden and the work impossible" passed in
// green — which is exactly what shipped: /etc/resolv.conf is a symlink into /run,
// /run was not bound, and the sandbox had no DNS at all. `claude` resolved, the
// gate was happy, and a session would have died on its first API call. So the
// egress block at the end asserts what must still WORK, per mode, and it is
// written to survive the network commit: with bwrap alone the model API must be
// reachable from inside; once --unshare-net lands it must be unreachable
// directly and reachable through the relay. The same probe pins both halves, and
// the day the network is cut on purpose, that will be distinguishable from
// cutting it by accident.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

if (spawnSync("bwrap", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.log("SKIP  bwrap not available — the whole point of this gate needs it");
  console.log("0/0 pass");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-sbx-"));
const DATA = path.join(tmp, "data");
const PROJECTS = path.join(tmp, "projects");
const PROJ = path.join(PROJECTS, "demo");
fs.mkdirSync(PROJ, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
// the server creates this on boot; this gate never starts one, so it stands in
fs.mkdirSync(path.join(DATA, "sock"), { recursive: true, mode: 0o700 });
const SOCKET_NAME = `agora-gate-sbx-${process.pid}`;

// Set BEFORE importing sandbox.js. config.ts resolves its paths at module load,
// so assigning afterwards leaves wrapCommand binding the operator's real
// ~/.agora — which is both wrong and the kind of wrong that still passes.
process.env.AGORA_DATA_DIR = DATA;
process.env.AGORA_PROJECTS_DIR = PROJECTS;
process.env.AGORA_PORT = String(4400 + (process.pid % 100));
process.env.AGORA_TMUX_SOCKET = SOCKET_NAME;
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";
delete process.env.AGORA_SANDBOX;

const { wrapCommand, sandboxMode } = await import("../server/dist/sandbox.js");

// ---- the mode is opt-in -------------------------------------------------
check(
  "REFUSED: with AGORA_SANDBOX unset the command is untouched — a personal install is not changed",
  wrapCommand("claude", { cwd: PROJ }) === "claude" && sandboxMode() === "off"
);
process.env.AGORA_SANDBOX = "bwrap";
const wrapped = wrapCommand("claude", { cwd: PROJ });
check("with it set, the command is wrapped", wrapped.startsWith("bwrap "));

// ---- the inode point, as an assertion rather than an argument -----------
check(
  "REFUSED: the socket is handed over as a DIRECTORY, not a file whose inode a restart invalidates",
  wrapped.includes("'--bind' '" + path.join(DATA, "sock") + "'"),
  "the server unlinks and recreates the socket on boot; a file bind would pin the dead inode"
);
check(
  "REFUSED: and agora's data directory itself is never bound",
  !wrapped.includes("'" + DATA + "' '" + DATA + "'"),
  "the database, the env file and the global hook secret live there"
);
check(
  "the harness is bound by its versions directory, not one version — an upgrade must not break the sandbox",
  /versions'/.test(wrapped) && !/versions\/[0-9.]+'/.test(wrapped),
  (wrapped.match(/'[^']*claude[^']*'/g) ?? ["no claude path bound"]).join(" ")
);

// ---- a real session, interrogated from outside --------------------------
const spawned = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    'const db = await import("' +
      path.resolve("server/dist/db.js") +
      '"); db.initDb();' +
      'db.projects.insert({ path: "' +
      PROJ +
      '", name: "demo", owner_email: "owner@example.com" });' +
      'const { initAuthDb } = await import("' +
      path.resolve("server/dist/auth.js") +
      '"); initAuthDb(db.initDb());' +
      'const { spawnSession } = await import("' +
      path.resolve("server/dist/routes/sessions.js") +
      '");' +
      'const row = await spawnSession({ cwd: "' +
      PROJ +
      '", harness: "shell" }); console.log(row.id);',
  ],
  { env: { ...process.env }, encoding: "utf8" }
);
const sid = (spawned.stdout || "").trim().split("\n").pop();
check("a sandboxed session starts", spawned.status === 0 && !!sid, (spawned.stderr || "").slice(0, 160));

const dbFile = path.join(DATA, "agora.db");
check("agora's database exists outside, so 'cannot read it' means something", fs.existsSync(dbFile));

const tmux = (...args) => spawnSync("tmux", ["-L", SOCKET_NAME, ...args], { encoding: "utf8" });
const target = "=agora-" + sid + ":";
const sleep = (s) => spawnSync("sleep", [String(s)]);
sleep(2); // let the pane become a shell

/** Run a probe in the live pane and read its exit code back out. */
const inPane = (script, marker) => {
  tmux("send-keys", "-t", target, "-l", script + "; echo " + marker + "$?");
  sleep(0.3);
  tmux("send-keys", "-t", target, "Enter");
  // tmux pads captured lines, so the pattern has to tolerate trailing space
  const re = new RegExp("^" + marker + "([0-9]+)[ ]*$", "m");
  for (let i = 0; i < 40; i++) {
    sleep(0.25);
    const m = (tmux("capture-pane", "-p", "-t", target).stdout ?? "").match(re);
    if (m) return Number(m[1]);
  }
  return -1;
};

/** A probe that never landed returns -1, and -1 satisfies every "must not be 0"
 *  assertion — which is exactly how a broken gate reports a secure sandbox. So
 *  each refusal is guarded on the probe having actually run. */
const ran = (code) => code >= 0;

if (sid) {
  const harness = inPane("command -v claude >/dev/null", "H");
  check(
    "1. the harness resolves inside — $PATH surviving is not the same as the binary surviving",
    harness === 0,
    "exit " + harness
  );

  const readable = inPane("test -r /etc/hostname", "R");
  check(
    "the probe works and something IS readable — without this every refusal below is vacuous",
    readable === 0,
    "exit " + readable
  );

  const dbRead = inPane("test -r " + dbFile, "D");
  check(
    "2. REFUSED: agora's database is not readable from inside — the whole point",
    ran(dbRead) && dbRead !== 0,
    "exit " + dbRead + " (0 = readable; -1 = the probe never ran, so this proves nothing)"
  );

  // The point is that the tmpfs hides the WHOLE home, not just agora's own
  // files: a session must not reach a sibling app's database, an ssh key or a
  // cloud credential sitting beside them. This used to probe one hardcoded
  // path from the author's machine, which does not exist anywhere else — so on
  // every other machine `test -r` returned 1 and the assertion passed without
  // testing anything. A decoy this gate plants itself is true everywhere.
  const decoy = path.join(os.homedir(), `.agora-gate-sandbox-decoy-${process.pid}`);
  fs.writeFileSync(decoy, "a neighbour's secret", { mode: 0o600 });
  const outside = fs.existsSync(decoy);
  const otherFile = inPane("test -r " + decoy, "O");
  fs.rmSync(decoy, { force: true });
  check(
    "the decoy really is readable outside — otherwise the refusal below is vacuous",
    outside
  );
  check(
    "REFUSED: nor anything else in the same home — a neighbour's file is gone too",
    ran(otherFile) && otherFile !== 0,
    "exit " + otherFile
  );

  const secret = inPane("test -r " + path.join(DATA, "hook-secret"), "K");
  check(
    "REFUSED: nor the global hook secret, which would let it act as any session",
    ran(secret) && secret !== 0,
    "exit " + secret
  );

  const sock = inPane("test -d " + path.join(DATA, "sock"), "S");
  check(
    "3. the socket door is present inside, so a sandboxed agent can still coordinate",
    sock === 0,
    "exit " + sock
  );

  const workspace = inPane("test -w " + PROJ, "W");
  check(
    "the workspace is writable at its REAL path — project_path must mean the same inside and out",
    workspace === 0,
    "exit " + workspace
  );

  const tmpdir = inPane('test "$TMPDIR" = /tmp', "T");
  check("TMPDIR follows the private /tmp", tmpdir === 0, "exit " + tmpdir);

  const tty = inPane("test -c /dev/tty", "Y");
  check(
    "/dev/tty exists — an empty /dev breaks anything that reopens the terminal",
    tty === 0,
    "exit " + tty
  );
  // ---- egress: what must still WORK ------------------------------------
  // Compared against the HOST, so this tests the sandbox rather than the
  // internet: if the box itself cannot resolve, there is nothing to conclude.
  const hostResolves =
    spawnSync("getent", ["hosts", "api.anthropic.com"], { encoding: "utf8" }).status === 0;
  if (!hostResolves) {
    console.log("SKIP  the host itself cannot resolve api.anthropic.com — egress is untestable here");
  } else {
    const dns = inPane("getent hosts api.anthropic.com >/dev/null", "N");
    check(
      "EGRESS: names resolve inside — /etc/resolv.conf is a symlink into /run, and binding /etc alone leaves it dangling",
      dns === 0,
      "exit " + dns + " (this shipped broken once: DNS dead, `claude` still resolving, gate green)"
    );
    const https = inPane(
      'test -n "$(curl -s -o /dev/null -w %{http_code} --max-time 15 https://api.anthropic.com/v1/messages | grep -E \'^[1-5][0-9][0-9]$\')"',
      "P"
    );
    check(
      "EGRESS: and the model API answers over TLS — an agent that cannot reach it is not doing work",
      https === 0,
      "exit " + https + " (any HTTP status proves TLS and connectivity; the CAs come from /usr)"
    );
    check(
      "REFUSED: /run is not handed over wholesale — only the resolver directory",
      (() => {
        const listed = inPane("test -z \"$(ls /run | grep -v \'^systemd$\')\"", "U");
        return listed === 0;
      })(),
      "dbus, credentials, log and a docker socket live in /run"
    );
  }
}

tmux("kill-server");
fs.rmSync(path.join(os.tmpdir(), "tmux-" + process.getuid(), SOCKET_NAME), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(results.length - failed + "/" + results.length + " pass");
process.exit(failed ? 1 : 0);
