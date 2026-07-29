// Canvas-link permission gate — node deploy/gate-peek.mjs (build the server first).
//
// A link drawn between two terminal nodes is what lets their agents deal with
// each other at all, and it grants BOTH halves: `argos read` (see what they are
// doing) and `argos send` (write into their terminal). nodeterm's model, where
// the graph IS the authorisation — extended to writing, because one capability
// without the other made no sense: an agent could interrupt anyone on the
// project while only being allowed to read the ones it was linked to.
//
// So the thing to pin is the negative: no link, no read. A rule that only ever
// says yes is not a rule, so every refusal here is paired with the link that
// makes it succeed.
//
// Hermetic: its own data dir, no server, no tmux.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argos-peek-"));
process.env.ARGOS_DATA_DIR = path.join(tmp, "data");
process.env.ARGOS_PROJECTS_DIR = path.join(tmp, "projects");

const { initDb, canvas, sessions } = await import("../server/dist/db.js");
const { linkedSessionIds } = await import("../server/dist/routes/peek.js");
initDb();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const P = path.join(tmp, "projects", "demo");
const OTHER = path.join(tmp, "projects", "other");
const mk = (id, project = P) =>
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
["alpha", "beta", "gamma"].forEach((id) => mk(id));
mk("stranger", OTHER);

/** Lay out a canvas: terminal nodes for the given sessions, plus edges. */
const layout = (project, nodes, edges) =>
  canvas.put(
    project,
    JSON.stringify({
      nodes: nodes.map(([nodeId, sessionId]) => ({
        id: nodeId,
        type: "terminal",
        data: { sessionId },
      })),
      edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
    })
  );

const NODES = [
  ["n-alpha", "alpha"],
  ["n-beta", "beta"],
  ["n-gamma", "gamma"],
];

// --- no link, nothing to read ----------------------------------------------
layout(P, NODES, []);
check(
  "with no links drawn, an agent may read nobody",
  linkedSessionIds(P, "alpha").size === 0,
  "the default is closed: peek is opt-in per pair"
);

// --- a link opens exactly one pair, both ways -------------------------------
layout(P, NODES, [["n-alpha", "n-beta"]]);
check(
  "a link lets the source read the target",
  [...linkedSessionIds(P, "alpha")].join(",") === "beta"
);
check(
  "and the target read the source — a link is mutual, as in nodeterm",
  [...linkedSessionIds(P, "beta")].join(",") === "alpha"
);
check(
  "an unlinked third agent is still shut out",
  linkedSessionIds(P, "gamma").size === 0,
  "gamma sits on the same canvas and must gain nothing from it"
);
check(
  "and cannot be read by the linked pair either",
  !linkedSessionIds(P, "alpha").has("gamma") && !linkedSessionIds(P, "beta").has("gamma")
);

// --- links do not chain -----------------------------------------------------
layout(P, NODES, [
  ["n-alpha", "n-beta"],
  ["n-beta", "n-gamma"],
]);
check(
  "permission does not chain: alpha—beta—gamma does NOT let alpha read gamma",
  [...linkedSessionIds(P, "alpha")].join(",") === "beta",
  "transitive trust would make one link across a hub open everything"
);
check("beta, linked to both, reads both", [...linkedSessionIds(P, "beta")].sort().join(",") === "alpha,gamma");

// --- a link to something that is not a terminal grants nothing --------------
canvas.put(
  P,
  JSON.stringify({
    nodes: [
      { id: "n-alpha", type: "terminal", data: { sessionId: "alpha" } },
      { id: "n-note", type: "sticky", data: { text: "hello" } },
      { id: "n-beta", type: "terminal", data: { sessionId: "beta" } },
    ],
    edges: [{ id: "e", source: "n-alpha", target: "n-note" }],
  })
);
check(
  "a link to a sticky note grants no session access",
  linkedSessionIds(P, "alpha").size === 0
);

// --- the canvas of another project cannot grant anything -------------------
layout(OTHER, [["n-x", "alpha"], ["n-y", "stranger"]], [["n-x", "n-y"]]);
check(
  "a link drawn on ANOTHER project's canvas does not apply here",
  linkedSessionIds(P, "alpha").size === 0,
  "permission is read from the canvas of the project being asked about"
);

// --- malformed docs fail closed --------------------------------------------
canvas.put(P, "{not json");
check("a corrupt canvas grants nothing", linkedSessionIds(P, "alpha").size === 0);
canvas.put(P, JSON.stringify({ nodes: null, edges: [{ source: "a" }] }));
check("a doc with junk nodes/edges grants nothing", linkedSessionIds(P, "alpha").size === 0);
check("an unknown project grants nothing", linkedSessionIds("/nope", "alpha").size === 0);

// --- self-links are not a way to read yourself into a loop ------------------
layout(P, NODES, [["n-alpha", "n-alpha"]]);
check("a node linked to itself yields nothing", linkedSessionIds(P, "alpha").size === 0);

// --- the link grants BOTH halves ------------------------------------------
// `linkedSessionIds` is the single source both `read` and `send` consult, so
// what is pinned here is that they cannot drift apart: the same set decides
// who may be read and who may be written to.
layout(P, NODES, [["n-alpha", "n-beta"]]);
const readable = linkedSessionIds(P, "alpha");
check(
  "read and send consult the same set — one link, both capabilities",
  readable.has("beta") && !readable.has("gamma"),
  "beta may be read AND messaged; gamma neither"
);
check(
  "an agent linked to nobody can neither read nor message anyone",
  linkedSessionIds(P, "gamma").size === 0,
  "it can still announce on the board, which wakes no one"
);

// --- the shape the UI actually saves ---------------------------------------
// The rule above was verified against a hand-written doc, which is exactly how
// this shipped broken: the canvas never SAVED edges and terminals had no
// grabbable handles, so `doc.edges` was always empty and no link could ever be
// drawn. A permission model nobody can reach refuses everyone, and every test of
// the rule still passes. So: replay a document in the shape the client writes.
const clientDoc = {
  nodes: [
    { id: "term-alpha", type: "terminal", x: 0, y: 0, w: 640, h: 420, data: { sessionId: "alpha" } },
    { id: "term-beta", type: "terminal", x: 700, y: 0, w: 640, h: 420, data: { sessionId: "beta" } },
    { id: "note-1", type: "sticky", x: 0, y: 500, w: 230, h: 200, data: { text: "hi" } },
  ],
  edges: [{ id: "3f2b1c-uuid", source: "term-alpha", target: "term-beta" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};
canvas.put(P, JSON.stringify(clientDoc));
check(
  "a document saved in the client's own shape grants the link",
  [...linkedSessionIds(P, "alpha")].join(",") === "beta",
  "nodes carry x/y/w/h and data.sessionId; edges carry id/source/target"
);
check(
  "and the doc round-trips: edges survive being read back",
  (JSON.parse(canvas.get(P).data).edges ?? []).length === 1,
  "edges used to be dropped on every save, silently revoking every permission"
);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
