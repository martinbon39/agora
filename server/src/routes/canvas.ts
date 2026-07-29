import type { FastifyInstance } from "fastify";
import { canvas } from "../db.js";
import { scopeAllows } from "../auth.js";
import { broadcast } from "../events.js";

interface NodeLike {
  id: string;
  [k: string]: unknown;
}
interface DocLike {
  nodes?: NodeLike[];
  /** Tombstones: node id -> deletion timestamp. A delete must OUTLIVE the
   *  stale `dirty` sets of other clients, or any of them re-adds the node on
   *  its next save and the deletion silently un-happens (as reported: "I
   *  delete a note and it doesn't delete"). Pruned after 7 days. */
  tomb?: Record<string, number>;
  [k: string]: unknown;
}

const TOMB_TTL = 7 * 24 * 3600 * 1000;

function pruneTomb(tomb: Record<string, number> | undefined): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(tomb ?? {}))
    if (typeof ts === "number" && now - ts < TOMB_TTL) out[id] = ts;
  return out;
}

/** Per-node merge: keep the stored doc, replace only the nodes this client
 *  actually touched (dirty), drop the ones it removed. Two people dragging
 *  different nodes at once both win — full-doc last-write-wins made the
 *  slower writer silently revert the faster one's work. */
function mergeDoc(base: DocLike, incoming: DocLike, dirty: string[], removed: string[]): DocLike {
  const inNodes = new Map((incoming.nodes ?? []).map((n) => [n.id, n]));
  const dirtySet = new Set(dirty);
  const removedSet = new Set(removed);
  const tomb = pruneTomb(base.tomb);
  for (const id of removed) tomb[id] = Date.now();
  const out: NodeLike[] = [];
  const seen = new Set<string>();
  for (const n of base.nodes ?? []) {
    if (!n || typeof n.id !== "string" || removedSet.has(n.id) || tomb[n.id]) continue;
    seen.add(n.id);
    const mine = dirtySet.has(n.id) ? inNodes.get(n.id) : undefined;
    out.push(mine ?? n);
  }
  for (const n of incoming.nodes ?? []) {
    if (!n || typeof n.id !== "string" || seen.has(n.id)) continue;
    // my additions — but a tombstoned id is a zombie from a stale dirty set,
    // NOT an addition: without this check any client that had touched the
    // node before someone deleted it resurrected it on its next save
    if (dirtySet.has(n.id) && !removedSet.has(n.id) && !tomb[n.id]) out.push(n);
  }
  // viewport is only read at mount, edges are unused: incoming wins for both
  return { ...incoming, nodes: out, tomb };
}

/** Canvas layout sync: one document PER PROJECT (id = project path), merged
 *  per node when the client says what it touched (dirty/removed), full
 *  replace otherwise; revision counter + `canvas` broadcast so other clients
 *  refetch (they ignore their own echo via clientId). */
export async function canvasRoutes(app: FastifyInstance) {
  app.get("/api/canvas", async (req, reply) => {
    const id = (req.query as { id?: string }).id || "default";
    if (!scopeAllows(req.authUser, id)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    const { data, rev } = canvas.get(id);
    // a corrupt row must not brick the canvas for every client — treat as empty
    let doc: unknown = null;
    if (data) {
      try {
        doc = JSON.parse(data);
      } catch {
        doc = null;
      }
    }
    return { doc, rev };
  });

  app.put("/api/canvas", async (req, reply) => {
    const { id, doc, clientId, dirty, removed } = (req.body ?? {}) as {
      id?: string;
      doc?: unknown;
      clientId?: string;
      dirty?: unknown;
      removed?: unknown;
    };
    if (!doc || typeof doc !== "object") {
      return reply.code(400).send({ error: "doc required" });
    }
    const canvasId = id || "default";
    if (!scopeAllows(req.authUser, canvasId)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    let toStore = doc as DocLike;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
    const dirtyIds = strings(dirty);
    const removedIds = strings(removed);
    if (!dirtyIds && !removedIds) {
      // full replace is authoritative (undo/redo): ids it reasserts come back
      // to life, other tombstones carry forward so stale clients stay unable
      // to resurrect deletions
      const { data } = canvas.get(canvasId);
      if (data) {
        try {
          const base = JSON.parse(data) as DocLike;
          const tomb = pruneTomb(base.tomb);
          for (const n of (toStore.nodes ?? [])) if (n?.id) delete tomb[n.id];
          toStore = { ...toStore, tomb };
        } catch {}
      }
    }
    if (dirtyIds || removedIds) {
      const { data } = canvas.get(canvasId);
      if (data) {
        try {
          const base = JSON.parse(data) as DocLike;
          toStore = mergeDoc(base, doc as DocLike, dirtyIds ?? [], removedIds ?? []);
        } catch {
          // corrupt stored doc: the incoming one replaces it wholesale
        }
      }
    }
    const rev = canvas.put(canvasId, JSON.stringify(toStore));
    broadcast({ type: "canvas", id: canvasId, rev, clientId: clientId ?? null }, { project: canvasId });
    return { rev };
  });
}
