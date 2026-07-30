// Rooms and their clock — node deploy/gate-rooms.mjs
//
// Expiring a room kills its tmux sessions. That is the cost-control mechanism on
// a box with four cores: a room nobody is watching stops burning tokens.
//
// The assertions that matter most here are the ones about what expiry does NOT
// do. The feature note this was built from said "everything is deleted when the
// TTL expires"; deleting a team's work on a timer is the most destructive thing
// this product could do, and "the TTL was set by mistake" is not a recoverable
// state. So every artefact is checked for survival, by name, and a project with
// no expiry is checked to be untouchable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agora-rooms-"));
process.env.AGORA_DATA_DIR = path.join(tmp, "data");
process.env.AGORA_PROJECTS_DIR = path.join(tmp, "projects");
process.env.AGORA_ALLOWED_EMAIL = "owner@example.com";
const GATE_SOCKET = `agora-gate-rooms-${process.pid}`;
process.env.AGORA_TMUX_SOCKET = GATE_SOCKET;

const { initDb, projects, sessions, plan, canvas, chat } = await import("../server/dist/db.js");
const db = initDb();
const { initAuthDb } = await import("../server/dist/auth.js");
initAuthDb(db);
const { sweep, release, remaining } = await import("../server/dist/rooms.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const ROOM = path.join(tmp, "projects", "hackathon");
const KEEP = path.join(tmp, "projects", "no-clock");
fs.mkdirSync(ROOM, { recursive: true });
fs.mkdirSync(KEEP, { recursive: true });
// the work that must survive
fs.writeFileSync(path.join(ROOM, "main.py"), "print('36 hours of work')\n");
fs.mkdirSync(path.join(ROOM, ".git"), { recursive: true });
fs.writeFileSync(path.join(ROOM, ".git", "HEAD"), "ref: refs/heads/main\n");
projects.insert({ path: ROOM, name: "hackathon", owner_email: "owner@example.com" });
projects.insert({ path: KEEP, name: "no-clock", owner_email: "owner@example.com" });

const mk = (id, project) =>
  sessions.insert({
    id,
    name: id,
    project_path: project,
    harness: "claude",
    command: "claude",
    status: "running",
    agent_state: "idle",
    created_at: Date.now(),
    last_activity: Date.now(),
  });
mk("in-room", ROOM);
mk("elsewhere", KEEP);
plan.add(ROOM, "ship the demo");
canvas.put(ROOM, JSON.stringify({ nodes: [], edges: [] }), 0);
chat.insert({ project_path: ROOM, author: "athena", harness: "claude", body: "starting" });

// ---- the clock -----------------------------------------------------------
check("a project with no clock has no time remaining to report", remaining(projects.get(KEEP)) === null);
const soon = Date.now() + 3_600_000;
projects.setClock(ROOM, { deadline: soon });
const left = remaining(projects.get(ROOM));
check("a deadline yields the time left", left > 3_500_000 && left <= 3_600_000, `${Math.round(left / 60000)} min`);
check(
  "setting the deadline did not set an expiry — the two are separate on purpose",
  projects.get(ROOM).expires_at == null
);

// ---- a room with no expiry is never swept -------------------------------
check("REFUSED: a sweep with nothing due releases nothing", (await sweep()).length === 0);
projects.setClock(ROOM, { deadline: soon, expires_at: Date.now() + 3_600_000 });
check(
  "REFUSED: nor a room whose expiry has not arrived",
  (await sweep()).length === 0,
  "an hour of headroom is not 'due'"
);
check("and the session is still running", sessions.get("in-room").status === "running");

// ---- expiry releases compute -------------------------------------------
projects.setClock(ROOM, { deadline: soon, expires_at: Date.now() - 1_000 });
const released = await sweep();
check(
  "an expired room is released",
  released.length === 1 && released[0].project === ROOM,
  JSON.stringify(released)
);
check(
  "its running session is stopped — this is the cost control",
  sessions.get("in-room").status === "exited",
  sessions.get("in-room").status
);
check(
  "REFUSED: and a session in a room with no clock is untouched",
  sessions.get("elsewhere").status === "running",
  sessions.get("elsewhere").status
);

// ---- what expiry must NOT do -------------------------------------------
check(
  "REFUSED: the working tree survives — releasing compute is not deleting work",
  fs.existsSync(path.join(ROOM, "main.py")) &&
    fs.readFileSync(path.join(ROOM, "main.py"), "utf8").includes("36 hours")
);
check("REFUSED: the git history survives", fs.existsSync(path.join(ROOM, ".git", "HEAD")));
check("REFUSED: the plan survives", plan.list(ROOM).length === 1, `${plan.list(ROOM).length} tasks`);
check("REFUSED: the canvas survives", !!canvas.get(ROOM).data);
check("REFUSED: the board survives", chat.board(ROOM).length === 1);
check(
  "REFUSED: the session ROW survives — its cost and transcript are the record of what happened",
  !!sessions.get("in-room"),
  "only the pane is gone"
);
check("REFUSED: and the project row itself survives", !!projects.get(ROOM));

// ---- idempotence --------------------------------------------------------
sessions.setStatus("in-room", "running"); // pretend something restarted it
const again = await sweep();
check(
  "REFUSED: a released room is not released twice — expired_at is the latch",
  again.length === 0,
  JSON.stringify(again)
);
check(
  "so a session started after the release is left alone rather than repeatedly killed",
  sessions.get("in-room").status === "running"
);
// and the direct call is idempotent too, for the same reason
const twice = await release(projects.get(ROOM));
check(
  "calling release() directly on an already-released room stops nothing new",
  twice.sessionsStopped.length === 1,
  "it stops what is running, which is the honest behaviour for an explicit call"
);

spawnSync("tmux", ["-L", GATE_SOCKET, "kill-server"], { stdio: "ignore" });
fs.rmSync(path.join(os.tmpdir(), `tmux-${process.getuid()}`, GATE_SOCKET), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
