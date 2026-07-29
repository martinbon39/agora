// Canvas-merge gate — node deploy/gate-canvas.mjs (build the server first).
//
// Replays the multiplayer bug seen in prod: a sticky was deleted and came
// back. mergeDoc treated any node in another client's stale `dirty` set as
// "my addition" — a delete could not outlive concurrent editors. Tombstones
// make deletions final until explicitly revived by a full replace (undo).
//
// Runs against the REAL routes via fastify.inject, with an owner stubbed in.
import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// isolated data dir: the gate must never touch the live agora.db
process.env.AGORA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agora-gate-"));
const { initDb } = await import("../server/dist/db.js");
initDb();
const { canvasRoutes } = await import("../server/dist/routes/canvas.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const app = Fastify();
app.addHook("onRequest", async (req) => {
  req.authUser = { email: "m@x", name: "owner", role: "owner", project: null, color: "#fff" };
});
await app.register(canvasRoutes);

const ID = "/tmp/gate-canvas-project";
const put = (body) =>
  app
    .inject({ method: "PUT", url: "/api/canvas", payload: { id: ID, ...body } })
    .then((r) => r.json());
const get = () =>
  app.inject({ method: "GET", url: `/api/canvas?id=${encodeURIComponent(ID)}` }).then((r) => r.json());

const node = (id, x = 0) => ({ id, type: "sticky", x, y: 0, w: 200, h: 200, data: { text: id } });
const names = (doc) => (doc.nodes ?? []).map((n) => n.id).sort().join(",");

// two clients, A and B — B holds a STALE doc throughout
const A = "client-A";
const B = "client-B";

// 1. A saves two stickies (full replace)
await put({ doc: { nodes: [node("n1"), node("n2")] }, clientId: A });
check("a full save stores both nodes", names((await get()).doc) === "n1,n2");

// 2. B moves n1 (dirty) with its stale copy — n2 untouched survives
await put({
  doc: { nodes: [{ ...node("n1", 99) }, node("n2")] },
  clientId: B,
  dirty: ["n1"],
  removed: [],
});
let d = (await get()).doc;
check(
  "the dirty update lands, the other node is untouched",
  d.nodes.find((n) => n.id === "n1").x === 99 && names(d) === "n1,n2"
);

// 3. A deletes n2
await put({ doc: { nodes: [node("n1", 99)] }, clientId: A, dirty: [], removed: ["n2"] });
d = (await get()).doc;
check("the delete applies and lays a tombstone", names(d) === "n1" && !!d.tomb?.n2);

// 4. THE bug: B (stale — n2 still in its doc AND in its dirty set after a
//    drag) saves. Before tombstones, n2 came back to life right here.
await put({
  doc: { nodes: [node("n1", 99), node("n2", 55)] },
  clientId: B,
  dirty: ["n2"],
  removed: [],
});
check("a stale dirty set NEVER resurrects a deleted node", names((await get()).doc) === "n1");

// 5. undo (full replace) reasserts n2: a LEGITIMATE revival, tombstone lifted
await put({ doc: { nodes: [node("n1", 99), node("n2")] }, clientId: A });
d = (await get()).doc;
check("a full-replace undo revives the node and lifts its tombstone", names(d) === "n1,n2" && !d.tomb?.n2);

// 6. and after that revival, an ordinary dirty update on n2 works again
await put({
  doc: { nodes: [node("n1", 99), node("n2", 7)] },
  clientId: B,
  dirty: ["n2"],
  removed: [],
});
check(
  "the revived node updates normally",
  (await get()).doc.nodes.find((n) => n.id === "n2").x === 7
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
