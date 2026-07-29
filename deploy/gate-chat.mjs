// Message-routing gate — node deploy/gate-chat.mjs (build the server first).
//
// Two failure modes, pulling in opposite directions, both of them real:
//
//   1. The owner's messages must never be silently stranded. They used to be
//      dropped unless they carried an @mention — and an idle agent has no
//      upcoming `Stop` hook to flush the unread channel, so the more an agent
//      rested, the less it heard.
//   2. Agents must not interrupt each other. A project running five agents on
//      two different tasks became ONE conversation: every announcement woke
//      everybody, and being woken pulls an agent off its task. Reported from real use: "they are working on different
//      things [...] so it is useless and it reorients them".
//
// So this gate pins WHO GETS INTERRUPTED, which is deliberately much narrower
// than who may read. Pure over `chatTargets`: no server, no tokens burnt on
// woken agents.
import { chatTargets, injectableNow } from "../server/dist/routes/chat.js";

const P = "/home/agora/projects/agora";
const OTHER = "/home/agora/projects/other";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const s = (over) => ({
  id: "x",
  name: "agent",
  project_path: P,
  harness: "claude",
  status: "running",
  agent_state: "idle",
  archived_at: null,
  ...over,
});

const FLEET = [
  s({ id: "a", name: "agora" }),
  s({ id: "b", name: "daedalus" }),
  s({ id: "c", name: "talos", status: "exited" }),
  s({ id: "d", name: "pythia", archived_at: 123 }),
  s({ id: "e", name: "shellbox", harness: "shell" }),
  s({ id: "f", name: "elsewhere", project_path: OTHER }),
];
const names = (rows) => rows.map((r) => r.name).sort();
const route = (over) => chatTargets(FLEET, { project: P, fromUser: false, body: "", ...over });

// The regression itself.
check(
  "an owner message with no @ reaches every live agent in the project",
  String(names(route({ fromUser: true, body: "how is it going?" }))) === "agora,daedalus",
  "this is THE bug: without it, an idle agent never hears it"
);

check(
  "an owner message skips the agent posting on their behalf",
  String(names(route({ fromUser: true, body: "hello", authorSessionId: "b" }))) === "agora"
);

// --- The project board interrupts NOBODY -----------------------------------
// This is failure mode 2. The board is where an agent says "I'm touching db.ts"
// to a project that may be running five agents on two unrelated tasks. Reading
// it is free; being woken by it costs a turn and derails whoever is woken. So
// an agent posting on the board reaches no one, however it phrases it.
check(
  "an agent's board post wakes nobody",
  route({ body: "refactor done" }).length === 0
);
check(
  "not even with @all — the board is an announcement, not a broadcast",
  route({ body: "@all sync up?" }).length === 0,
  "this is THE derail: five agents on two tasks became one conversation"
);
check(
  "not even by naming someone — that is what `agora ask` is for",
  route({ body: "@argo can you review?" }).length === 0
);
check(
  "the owner is the exception: his board message still reaches the fleet",
  String(names(route({ fromUser: true, body: "stop everything" }))) === "agora,daedalus",
  "he is the human talking to his own agents, and he writes rarely"
);

// Sessions that must never be injected into.
check(
  "a dead, archived, or other-project session is ignored",
  !names(route({ fromUser: true, body: "hello" })).some((n) =>
    ["talos", "pythia", "elsewhere"].includes(n)
  )
);
check(
  "a shell harness is NEVER injected (the text would run as a command)",
  !route({ fromUser: true, body: "rm -rf /" }).some((r) => r.harness === "shell")
);

// Injection timing: only idle agents get keystrokes. Injecting mid-turn races
// the TUI (line lost while cursor advanced = message gone forever — observed
// live), and a needs_approval agent's permission dialog could be ANSWERED by
// the trailing Enter.
check(
  "an idle agent is injected immediately",
  injectableNow(s({ agent_state: "idle" }))
);
check(
  "an agent mid-turn is not injected (the imminent Stop hook serves it)",
  !injectableNow(s({ agent_state: "working" }))
);
check(
  "an agent awaiting approval NEVER gets keystrokes (Enter would answer the dialog)",
  !injectableNow(s({ agent_state: "needs_approval" }))
);

// --- `agora ask <name>`: the deliberate interrupt ---------------------------
// The only way an agent reaches another. It takes a name rather than a mention
// buried in prose, because interrupting someone should be a decision.
check(
  "ask reaches exactly the addressed session",
  String(names(route({ toSession: "b", body: "does your change touch mergeDoc?" }))) === "daedalus"
);
check(
  "ask never sprays: mentions in the body must not widen it",
  route({ toSession: "b", body: "@all @agora everyone look" }).length === 1
);
check("ask cannot wake a dead or archived session", route({ toSession: "c" }).length === 0);
check(
  "ask cannot wake a shell (the text would run as a command)",
  route({ toSession: "e", body: "rm -rf /" }).length === 0
);
check("ask cannot cross projects", route({ toSession: "f" }).length === 0);
check(
  "an agent cannot ask itself into a loop",
  route({ toSession: "a", authorSessionId: "a" }).length === 0
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length ? 1 : 0);
