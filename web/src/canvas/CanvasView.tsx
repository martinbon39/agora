import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FolderTree,
  Gamepad2,
  Globe,
  Joystick,
  ListTodo,
  MessagesSquare,
  SquareTerminal,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type PresencePeer, type Project, type Session } from "@/api";
import { serverEvents, tabClientId } from "@/events";
import { useCurrentUser } from "@/auth/userContext";
import type { TerminalHandle } from "@/terminal/TerminalView";
import { QuickKeys } from "@/terminal/QuickKeys";
import { type ComposerLaunchBody } from "@/components/Composer";
import { HarnessIcon } from "@/components/HarnessIcon";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Kbd } from "@/components/ui/kbd";
import { CanvasCtx, type CanvasApi } from "./context";
import { Dock } from "./Dock";
import { FloatingEdge } from "./FloatingEdge";
import { PresenceLayer } from "./PresenceLayer";
import { useDictation } from "./useDictation";
import { TerminalNode } from "./nodes/TerminalNode";
import { StickyNode, STICKY_COLORS } from "./nodes/StickyNode";
import { BrowserNode } from "./nodes/BrowserNode";
import { DinoNode } from "./nodes/DinoNode";
import { SnakeNode } from "./nodes/SnakeNode";
import { ChatNode } from "./nodes/ChatNode";
import { TodoNode } from "./nodes/TodoNode";
import { FilesNode } from "./nodes/FilesNode";
import { FileNode } from "./nodes/FileNode";
import { ImageNode } from "./nodes/ImageNode";
import type { CanvasDoc, CanvasNodeType, CanvasViewport, StoredEdge, StoredNode } from "./types";

const edgeTypes = { floating: FloatingEdge };

const nodeTypes = {
  terminal: TerminalNode,
  sticky: StickyNode,
  browser: BrowserNode,
  dino: DinoNode,
  snake: SnakeNode,
  chat: ChatNode,
  todo: TodoNode,
  files: FilesNode,
  file: FileNode,
  image: ImageNode,
};

const NODE_DEFAULTS: Record<Exclude<CanvasNodeType, "terminal">, { w: number; h: number; data: Record<string, unknown> }> = {
  sticky: { w: 230, h: 200, data: { text: "", color: "amber" } },
  browser: { w: 720, h: 520, data: { url: "" } },
  dino: { w: 480, h: 340, data: {} },
  snake: { w: 420, h: 380, data: {} },
  chat: { w: 380, h: 460, data: {} },
  todo: { w: 260, h: 320, data: { items: [] } },
  files: { w: 280, h: 420, data: {} },
  file: { w: 520, h: 420, data: { path: "" } },
  image: { w: 420, h: 300, data: { src: "" } },
};

const TERMINAL_SIZE = { w: 640, h: 420 };

export interface CanvasHandle {
  focusSession: (sessionId: string) => void;
  addNode: (type: Exclude<CanvasNodeType, "terminal">) => void;
  fitView: () => void;
  newSession: (harness: string) => void;
}

interface CanvasViewProps {
  /** One canvas per project — this is the session `project_path`. */
  canvasId: string;
  sessions: Session[];
  /** False until the FIRST session list has arrived. Reconciling against an
   *  empty not-yet-loaded list would delete every terminal node from the doc
   *  and re-create them later at random spots. */
  sessionsReady: boolean;
  projects: Project[];
  onProjectsChanged: () => void;
  onCreateSession: (body: ComposerLaunchBody | { harness: string }) => Promise<void>;
  onArchiveSession: (sessionId: string) => void;
  onOpenSession: (sessionId: string) => void;
  initialFocusSessionId?: string | null;
  /** Other humans live on this project (multiplayer presence). */
  peers: PresencePeer[];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function toStored(n: Node): StoredNode {
  // strip runtime-only fields; persisted data must round-trip as pure JSON.
  // NodeResizer writes top-level width/height (+ measured), NOT style — read
  // those first or resizes silently never persist.
  return {
    id: n.id,
    type: (n.type ?? "sticky") as CanvasNodeType,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    w: Math.round(num(n.width) ?? n.measured?.width ?? num(n.style?.width) ?? 400),
    h: Math.round(num(n.height) ?? n.measured?.height ?? num(n.style?.height) ?? 300),
    data: n.data as Record<string, unknown>,
  };
}

function fromStored(s: StoredNode): Node {
  return {
    id: s.id,
    type: s.type,
    position: { x: s.x, y: s.y },
    style: { width: s.w, height: s.h },
    dragHandle: ".node-drag-handle",
    data: s.data ?? {},
  };
}

function CanvasInner(
  {
    canvasId,
    sessions,
    sessionsReady,
    projects,
    onProjectsChanged,
    onCreateSession,
    onArchiveSession,
    onOpenSession,
    initialFocusSessionId,
    peers,
    handleRef,
  }: CanvasViewProps & { handleRef: React.ForwardedRef<CanvasHandle> }
) {
  const rf = useReactFlow();
  // tab-wide id: canvas echo suppression AND presence share one identity
  const clientId = tabClientId;
  const user = useCurrentUser();
  // touch: one finger on the pane pans (no marquee), pinch zooms
  const coarse = useMediaQuery({ pointer: "coarse" });

  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<StoredEdge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string[] | null>(null);
  // hand tool: left-drag pans instead of drawing a selection marquee
  const [handTool, setHandTool] = useState(false);
  // Link tool: click it, click one terminal, click another. Dragging a 13px
  // handle onto another 13px handle is a precision task on a canvas you are
  // usually zoomed out of — "c'est pas assez visible" was really "I should not
  // have to aim". The drag still works; this is the path that always does.
  const [linkTool, setLinkTool] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const viewportRef = useRef<CanvasViewport | undefined>(undefined);
  const initialViewportRef = useRef<CanvasViewport | undefined>(undefined);

  const terminalsRef = useRef(new Map<string, TerminalHandle>());
  const focusedRef = useRef<string | null>(null);
  const pendingSpotRef = useRef<{ x: number; y: number } | null>(null);
  const pendingFocusRef = useRef<string | null>(initialFocusSessionId ?? null);

  // history: coalesced snapshots of the whole doc (nodes only on apply)
  const pastRef = useRef<CanvasDoc[]>([]);
  const futureRef = useRef<CanvasDoc[]>([]);
  const lastDocRef = useRef<CanvasDoc | null>(null);
  const lastJsonRef = useRef<string>("");
  const lastPushRef = useRef(0);
  const skipHistoryRef = useRef(false);
  const skipSaveRef = useRef(false);

  // Links drawn by hand are part of the document — they are a PERMISSION (two
  // linked terminals may read each other via `agora peek`), so losing them on
  // the next save would silently revoke it. They used to be dropped here.
  const linksRef = useRef<StoredEdge[]>([]);
  linksRef.current = links;
  const makeDoc = useCallback(
    (): CanvasDoc => ({
      nodes: nodesRef.current.map(toStored),
      edges: linksRef.current,
      viewport: viewportRef.current,
    }),
    []
  );

  // ---- persistence -------------------------------------------------------
  // Multiplayer: saves declare WHICH nodes this client touched (dirty) or
  // deleted (removed) so the server merges per node — two people editing
  // different nodes never clobber each other. Undo/redo rewrites the whole
  // doc and falls back to a full replace.
  const dirtyRef = useRef(new Set<string>());
  const removedRef = useRef(new Set<string>());
  const fullSaveRef = useRef(false);
  const markDirty = useCallback((id: string) => {
    removedRef.current.delete(id);
    dirtyRef.current.add(id);
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // hand the pending sets to THIS request; edits arriving mid-flight
      // re-add themselves and ride the next save
      const dirty = [...dirtyRef.current];
      const removed = [...removedRef.current];
      dirtyRef.current.clear();
      removedRef.current.clear();
      const wasFull = fullSaveRef.current;
      fullSaveRef.current = false;
      try {
        await api.putCanvas(
          canvasId,
          makeDoc(),
          clientId,
          wasFull ? undefined : dirty,
          wasFull ? undefined : removed
        );
      } catch (e) {
        for (const id of dirty) dirtyRef.current.add(id);
        for (const id of removed) removedRef.current.add(id);
        if (wasFull) fullSaveRef.current = true;
        toast.error("Canvas save failed", { id: "canvas-save", description: String(e) });
      }
    }, 800);
  }, [canvasId, clientId, makeDoc]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Doc -> nodes, sessions-aware: a stored doc says nothing about archival, so
  // mapping it naively flashes archived (or killed) terminals for a frame on
  // every load / remote sync / undo until reconciliation catches up. Hide
  // terminal nodes whose session is archived or not (yet) known right away —
  // reconciliation unhides confirmed-live ones in the same pass it always ran.
  const hydrate = useCallback(
    (all: StoredNode[]) => {
      // A doc can outlive a node type — `frame` was removed, and a stale tab or
      // an older client can still send one. React Flow renders an unknown type
      // as an invisible, unselectable ghost that cannot even be deleted, so
      // drop them here rather than let the doc rot around them.
      const stored = all.filter((n) => n.type in nodeTypes);
      const byId = new Map(
        sessionsRef.current
          .filter((s) => s.project_path === canvasId)
          .map((s) => [s.id, s])
      );
      const bestBySession = new Map<string, StoredNode>();
      for (const n of stored) {
        if (n.type !== "terminal") continue;
        const sid = n.data?.sessionId as string;
        const cur = bestBySession.get(sid);
        if (!cur || n.id === `term-${sid}`) bestBySession.set(sid, n);
      }
      return stored
        .filter((n) => (n.type as string) !== "launcher" && (n.type as string) !== "wall")
        .filter((n) => n.type !== "terminal" || bestBySession.get(n.data?.sessionId as string) === n)
        .map(fromStored)
        .map((n) => {
          if (n.type !== "terminal") return n;
          const live = byId.get(n.data.sessionId as string);
          return { ...n, hidden: !live || live.archived_at != null };
        });
    },
    [canvasId]
  );

  // initial load
  useEffect(() => {
    let cancelled = false;
    api
      .getCanvas(canvasId)
      .then(({ doc }) => {
        if (cancelled) return;
        if (doc) {
          setNodes(hydrate(doc.nodes ?? []));
    setLinks(doc.edges ?? []);
          setLinks(doc.edges ?? []);
          viewportRef.current = doc.viewport;
          initialViewportRef.current = doc.viewport;
          lastDocRef.current = doc;
          lastJsonRef.current = JSON.stringify(doc);
        }
        setLoaded(true);
      })
      .catch((e) => {
        toast.error("Canvas load failed", { description: String(e) });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // canvasId is stable for a mounted instance (App keys the component on it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // nodes changed → history + save
  useEffect(() => {
    if (!loaded) return;
    // consume the skip flags no matter what — they only cover THIS run; a
    // no-op remote apply must not leak them onto the next local change
    const skipHistory = skipHistoryRef.current;
    skipHistoryRef.current = false;
    const skipSave = skipSaveRef.current;
    skipSaveRef.current = false;

    const doc = makeDoc();
    const json = JSON.stringify(doc);
    if (json === lastJsonRef.current) return;

    if (skipHistory) {
      // applied doc (undo/remote) — never a history entry
    } else if (lastDocRef.current) {
      const now = performance.now();
      // coalesce bursts (drags, typing) into one snapshot per ~second —
      // stamp only when we push, or a continuous stream would never snapshot
      if (now - lastPushRef.current > 1000) {
        pastRef.current.push(lastDocRef.current);
        if (pastRef.current.length > 100) pastRef.current.shift();
        futureRef.current = [];
        lastPushRef.current = now;
      }
    }
    lastDocRef.current = doc;
    lastJsonRef.current = json;
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);

    if (!skipSave) scheduleSave();
    // `links` in the deps: a link is a permission, so drawing or revoking one
    // has to reach the server as surely as moving a node does
  }, [nodes, links, loaded, makeDoc, scheduleSave]);

  // remote edits (other human/device/tab) → refetch, but keep OUR unsaved
  // edits on top: nodes still marked dirty keep their local version, nodes we
  // just deleted stay deleted — the next save reconciles both sides
  useEffect(
    () =>
      serverEvents.subscribe((msg) => {
        if (msg.type !== "canvas" || msg.id !== canvasId || msg.clientId === clientId) return;
        api
          .getCanvas(canvasId)
          .then(({ doc }) => {
            if (!doc) return;
            skipHistoryRef.current = true;
            skipSaveRef.current = true;
            setNodes((local) => {
              // a tombstoned id is deleted, PERIOD — even if this client still
              // holds it dirty (a failed save must not resurrect it forever)
              const tomb = doc.tomb ?? {};
              for (const id of Object.keys(tomb)) {
                dirtyRef.current.delete(id);
                removedRef.current.delete(id);
              }
              const remote = hydrate(doc.nodes ?? []).filter((n) => !tomb[n.id]);
              const localById = new Map(local.map((n) => [n.id, n]));
              const seen = new Set<string>();
              const merged = remote
                .filter((n) => !removedRef.current.has(n.id))
                .map((n) => {
                  seen.add(n.id);
                  return dirtyRef.current.has(n.id) ? (localById.get(n.id) ?? n) : n;
                });
              for (const n of local) {
                if (dirtyRef.current.has(n.id) && !seen.has(n.id) && !tomb[n.id]) merged.push(n);
              }
              return merged;
            });
          })
          .catch(() => {});
      }),
    [canvasId, clientId, hydrate]
  );

// ---- sessions ↔ nodes reconciliation -----------------------------------
  const findFreeSpot = useCallback(
    (existing: Node[], size: { w: number; h: number }) => {
      const pending = pendingSpotRef.current;
      if (pending) {
        pendingSpotRef.current = null;
        return pending;
      }
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const rects = existing
        .filter((n) => !n.hidden)
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          w: num(n.width) ?? n.measured?.width ?? num(n.style?.width) ?? 400,
          h: num(n.height) ?? n.measured?.height ?? num(n.style?.height) ?? 300,
        }));
      const overlaps = (x: number, y: number) =>
        rects.some(
          (r) =>
            x < r.x + r.w + 24 && x + size.w + 24 > r.x && y < r.y + r.h + 24 && y + size.h + 24 > r.y
        );
      // Spiral around the viewport center, CLAMPED to what's on screen: the old
      // diagonal walk (+64,+48 up to 60×) marched new nodes far outside the
      // viewport on a busy canvas — "where did my sticky go?".
      const { zoom } = rf.getViewport();
      const halfW = window.innerWidth / zoom / 2;
      const halfH = window.innerHeight / zoom / 2;
      const stepX = size.w * 0.55;
      const stepY = size.h * 0.55;
      const fits = (dx: number, dy: number) =>
        Math.abs(dx * stepX) + size.w / 2 <= halfW - 24 &&
        Math.abs(dy * stepY) + size.h / 2 <= halfH - 24;
      for (let ring = 0; ring <= 4; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || !fits(dx, dy)) continue;
            const x = center.x - size.w / 2 + dx * stepX;
            const y = center.y - size.h / 2 + dy * stepY;
            if (!overlaps(x, y)) return { x, y };
          }
        }
      }
      // everything visible is occupied: overlap dead-center rather than exile
      return { x: center.x - size.w / 2 + 32, y: center.y - size.h / 2 + 32 };
    },
    [rf]
  );

  useEffect(() => {
    if (!loaded || !sessionsReady) return;
    // this canvas only shows ITS project's sessions
    const mine = sessions.filter((s) => s.project_path === canvasId);
    setNodes((prev) => {
      const byId = new Map(mine.map((s) => [s.id, s]));
      let changed = false;
      // Duplicate terminal nodes for one session: clients discovering a new
      // session at the same time each created their own node, and the per-node
      // merge kept them ALL (one spawn, four nodes on screen). Keep the
      // deterministic `term-<sessionId>` node if present, else the first;
      // removals propagate so the shared doc heals too.
      const seenSession = new Map<string, Node>();
      for (const n of prev) {
        if (n.type !== "terminal") continue;
        const sid = n.data.sessionId as string;
        const cur = seenSession.get(sid);
        if (!cur) seenSession.set(sid, n);
        else if (n.id === `term-${sid}`) seenSession.set(sid, n);
      }
      // archived sessions HIDE their node (layout kept — unarchive restores it
      // at the exact same spot/size); only killed sessions drop the node
      let next = prev
        .filter((n) => {
          if (n.type !== "terminal") return true;
          const sid = n.data.sessionId as string;
          if (seenSession.get(sid) !== n) {
            changed = true;
            dirtyRef.current.delete(n.id);
            removedRef.current.add(n.id);
            return false;
          }
          const keep = byId.has(sid);
          if (!keep) {
            changed = true;
            // killed session: propagate the node removal to the shared doc
            dirtyRef.current.delete(n.id);
            removedRef.current.add(n.id);
          }
          return keep;
        })
        .map((n) => {
          if (n.type !== "terminal") return n;
          const hidden = byId.get(n.data.sessionId as string)!.archived_at != null;
          if (!!n.hidden === hidden) return n;
          changed = true;
          markDirty(n.id);
          return { ...n, hidden };
        });
      const placed = new Set(
        next.filter((n) => n.type === "terminal").map((n) => n.data.sessionId as string)
      );
      for (const s of mine) {
        if (s.archived_at != null || placed.has(s.id)) continue;
        changed = true;
        // deterministic: two clients racing to place this session produce the
        // SAME node id, so the server merge dedupes instead of accumulating
        const nodeId = `term-${s.id}`;
        markDirty(nodeId);
        next = [
          ...next,
          {
            id: nodeId,
            type: "terminal",
            position: findFreeSpot(next, TERMINAL_SIZE),
            style: { width: TERMINAL_SIZE.w, height: TERMINAL_SIZE.h },
            dragHandle: ".node-drag-handle",
            data: { sessionId: s.id },
          },
        ];
      }
      return changed ? next : prev;
    });
  }, [sessions, sessionsReady, canvasId, loaded, findFreeSpot]);

  // satisfy a deferred focus once the node exists
  useEffect(() => {
    const sid = pendingFocusRef.current;
    if (!sid) return;
    const node = nodes.find((n) => n.type === "terminal" && n.data.sessionId === sid);
    if (node) {
      pendingFocusRef.current = null;
      rf.fitView({ nodes: [{ id: node.id }], duration: 400, maxZoom: 1 });
    }
  }, [nodes, rf]);

  // ---- node ops ----------------------------------------------------------
  // Live drag/resize broadcast: peers see nodes MOVE, not teleport 1.5 s
  // later. Ephemeral (batched ~20/s over /ws/events, like cursors); the
  // debounced save stays the persisted truth.
  const livePosRef = useRef(new Map<string, { x?: number; y?: number; w?: number; h?: number }>());
  const livePosTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueLivePos = useCallback(
    (id: string, patch: { x?: number; y?: number; w?: number; h?: number }) => {
      livePosRef.current.set(id, { ...livePosRef.current.get(id), ...patch });
      if (livePosTimer.current) return;
      livePosTimer.current = setTimeout(() => {
        livePosTimer.current = undefined;
        const batch = [...livePosRef.current].map(([nid, p]) => ({ id: nid, ...p }));
        livePosRef.current.clear();
        if (batch.length) serverEvents.send({ type: "node_pos", nodes: batch });
      }, 50);
    },
    []
  );
  useEffect(() => () => clearTimeout(livePosTimer.current), []);

  // the first terminal picked with the link tool wears the outline the CSS
  // keys off, so it is obvious which one you are linking FROM
  const flowNodes = useMemo(
    () =>
      linkFrom
        ? nodes.map((n) => (n.id === linkFrom ? { ...n, className: "canvas-link-source" } : n))
        : nodes,
    [nodes, linkFrom]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position") {
          markDirty(c.id);
          if (c.position)
            queueLivePos(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        } else if (c.type === "dimensions") {
          // only user resizes: React Flow also emits dimensions on mount
          // measure, which must neither dirty nor broadcast the whole canvas
          if (c.resizing) {
            markDirty(c.id);
            if (c.dimensions)
              queueLivePos(c.id, {
                w: Math.round(c.dimensions.width),
                h: Math.round(c.dimensions.height),
              });
          }
        }
      }
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [markDirty, queueLivePos]
  );

  const updateNodeData = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      markDirty(nodeId);
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [markDirty]
  );

  // peers' drags land directly on the nodes — no refetch, no history, no save
  useEffect(
    () =>
      serverEvents.subscribe((msg) => {
        if (msg.type !== "node_pos" || msg.clientId === clientId) return;
        const list = msg.nodes as { id?: string; x?: number; y?: number; w?: number; h?: number }[];
        if (!Array.isArray(list) || !list.length) return;
        const byId = new Map(
          list.filter((n) => typeof n?.id === "string").map((n) => [n.id as string, n])
        );
        if (!byId.size) return;
        skipHistoryRef.current = true;
        skipSaveRef.current = true;
        setNodes((prev) =>
          prev.map((n) => {
            const p = byId.get(n.id);
            // never fight a local drag on the same node — last save reconciles
            if (!p || n.dragging) return n;
            let next = n;
            if (typeof p.x === "number" && typeof p.y === "number")
              next = { ...next, position: { x: p.x, y: p.y } };
            if (typeof p.w === "number" || typeof p.h === "number")
              next = {
                ...next,
                style: {
                  ...next.style,
                  ...(typeof p.w === "number" ? { width: p.w } : {}),
                  ...(typeof p.h === "number" ? { height: p.h } : {}),
                },
              };
            return next;
          })
        );
      }),
    [clientId]
  );

  /** Drawing a link between two terminals GRANTS a permission: from now on each
   *  of their agents may read the other with `agora peek`. Nothing is pushed —
   *  the link is only the authorisation, exactly as in nodeterm. */
  const onConnect = useCallback(
    (c: { source?: string | null; target?: string | null }) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const nodeOf = (id: string) => nodesRef.current.find((n) => n.id === id);
      const a = nodeOf(c.source);
      const b = nodeOf(c.target);
      if (a?.type !== "terminal" || b?.type !== "terminal") {
        toast.error("Links only mean something between two terminals");
        return;
      }
      setLinks((prev) => {
        // one link per pair, whichever way round it was drawn
        if (
          prev.some(
            (l) =>
              (l.source === c.source && l.target === c.target) ||
              (l.source === c.target && l.target === c.source)
          )
        )
          return prev;
        return [...prev, { id: crypto.randomUUID(), source: c.source!, target: c.target! }];
      });
      fullSaveRef.current = true; // edges are not part of per-node dirty tracking
      const names = [a, b].map(
        (n) => sessionsRef.current.find((s) => s.id === n?.data?.sessionId)?.name ?? "terminal"
      );
      toast.success(`${names[0]} and ${names[1]} can now read each other`, {
        description: "Either can run `agora peek <name>`. Double-click the link to revoke it.",
      });
    },
    []
  );

  /** Click-to-link: first terminal arms, second completes. */
  const onNodeClickLink = useCallback(
    (node: Node) => {
      if (!linkTool) return;
      if (node.type !== "terminal") {
        toast.error("Links only mean something between two terminals");
        return;
      }
      if (!linkFrom) {
        setLinkFrom(node.id);
        return;
      }
      if (linkFrom === node.id) {
        setLinkFrom(null); // clicking the same one again cancels
        return;
      }
      onConnect({ source: linkFrom, target: node.id });
      setLinkFrom(null);
      setLinkTool(false); // like Figma: the tool reverts once you have used it
    },
    [linkTool, linkFrom, onConnect]
  );

  const removeLink = useCallback((id: string) => {
    setLinks((prev) => {
      if (!prev.some((l) => l.id === id)) return prev; // a derived edge, not ours
      toast.success("Link removed — those agents can no longer read each other");
      return prev.filter((l) => l.id !== id);
    });
    fullSaveRef.current = true;
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    dirtyRef.current.delete(nodeId);
    removedRef.current.add(nodeId);
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }, []);

  const addNode = useCallback(
    (type: Exclude<CanvasNodeType, "terminal">, at?: { x: number; y: number }) => {
      const def = NODE_DEFAULTS[type];
      const id = crypto.randomUUID();
      // sticky notes are signed: everyone sees who left them
      const authored =
        type === "sticky" && user
          ? { ...def.data, author: user.name, authorColor: user.color }
          : { ...def.data };
      markDirty(id);
      setNodes((prev) => [
        ...prev,
        {
          id,
          type,
          position: at ?? findFreeSpot(prev, def),
          style: { width: def.w, height: def.h },
          ...(type === "image" ? {} : { dragHandle: ".node-drag-handle" }),
          data: authored,
        },
      ]);
      return id;
    },
    [findFreeSpot, markDirty, user]
  );


  // ---- undo / redo -------------------------------------------------------
  const applyDoc = useCallback((doc: CanvasDoc) => {
    skipHistoryRef.current = true;
    // a history snapshot rewrites the whole doc — per-node dirty tracking
    // can't describe it, so the next save is a full replace
    fullSaveRef.current = true;
    dirtyRef.current.clear();
    removedRef.current.clear();
    setNodes(hydrate(doc.nodes ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev || !lastDocRef.current) return;
    futureRef.current.push(lastDocRef.current);
    applyDoc(prev);
  }, [applyDoc]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next || !lastDocRef.current) return;
    pastRef.current.push(lastDocRef.current);
    applyDoc(next);
  }, [applyDoc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      // never steal Ctrl+Z from a terminal (job control) or a text field
      if (t && (t.closest(".xterm") || /^(input|textarea)$/i.test(t.tagName) || t.isContentEditable))
        return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Ctrl held → nodes raise a transparent shield so the wheel zooms the
  // canvas instead of scrolling the terminal / iframe under the cursor
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Control" && setCtrlHeld(true);
    const up = (e: KeyboardEvent) => e.key === "Control" && setCtrlHeld(false);
    const clear = () => setCtrlHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Delete/Backspace removes the selection: terminals archive their session
  // (revivable from the sidebar), other nodes just disappear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      // only act when the keydown comes from the pane itself (marquee/pane
      // focus) — clicking anywhere in a node focuses the node wrapper, and
      // deleting while "inside" a terminal/game/field must never happen
      if (
        t &&
        (t.closest(".react-flow__node") ||
          t.closest(".xterm") ||
          /^(input|textarea|canvas)$/i.test(t.tagName) ||
          t.isContentEditable)
      )
        return;
      const selected = nodesRef.current.filter((n) => n.selected);
      if (!selected.length) return;
      e.preventDefault();
      const terminals: string[] = [];
      for (const n of selected) {
        if (n.type === "terminal") terminals.push(n.data.sessionId as string);
        else removeNode(n.id);
      }
      // live sessions deserve a "sure?" — notes and games don't
      if (terminals.length) setConfirmArchive(terminals);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onArchiveSession, removeNode]);


  // ---- dictation ---------------------------------------------------------
  const dictation = useDictation((text) => {
    const sid = focusedRef.current;
    const handle = sid ? terminalsRef.current.get(sid) : undefined;
    if (handle) handle.sendText(text);
    else toast.info("Focus a terminal first — dictation types into it", { id: "dictation" });
  });

  // ---- context for node components ---------------------------------------
  const canvasApi = useMemo<CanvasApi>(
    () => ({
      canvasId,
      ctrlHeld,
      peers,
      zoomToNode: (nodeId) => {
        const n = nodesRef.current.find((x) => x.id === nodeId);
        if (!n) return;
        const w = num(n.width) ?? n.measured?.width ?? num(n.style?.width) ?? 400;
        const h = num(n.height) ?? n.measured?.height ?? num(n.style?.height) ?? 300;
        rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1, duration: 350 });
      },
      sessions,
      archiveSession: onArchiveSession,
      openSession: onOpenSession,
      sendToSession: async (sessionId, text) => {
        try {
          await api.sendToSession(sessionId, text);
          return true;
        } catch (e) {
          toast.error("Agent busy", { description: String(e) });
          return false;
        }
      },
      forkSession: async (sessionId) => {
        try {
          const { session, forkedConversation } = await api.forkSession(sessionId);
          toast.success(
            forkedConversation
              ? `${session.name} — same conversation, two futures`
              : `${session.name} — twin session created`
          );
        } catch (e) {
          toast.error("Fork failed", { description: String(e) });
        }
      },
      openFile: (fromNodeId, path) => {
        // the viewer must read the same tree as the explorer that opened it:
        // an isolated frame's file is NOT the repo's file of the same name
        const explorerFrame = (nodesRef.current.find((n) => n.id === fromNodeId)?.data
          ?.frameId as string | undefined) ?? null;
        const existing = nodesRef.current.find(
          (n) => n.type === "file" && n.data.path === path && (n.data.frame ?? null) === explorerFrame
        );
        if (existing) {
          rf.fitView({ nodes: [{ id: existing.id }], duration: 300, maxZoom: 1 });
          return;
        }
        const from = nodesRef.current.find((n) => n.id === fromNodeId);
        const fromW =
          num(from?.width) ?? from?.measured?.width ?? num(from?.style?.width) ?? 280;
        const siblings = nodesRef.current.filter(
          (n) => n.type === "file" && n.data.from === fromNodeId
        ).length;
        const def = NODE_DEFAULTS.file;
        setNodes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "file",
            position: from
              ? { x: from.position.x + fromW + 48, y: from.position.y + siblings * 56 }
              : findFreeSpot(prev, def),
            style: { width: def.w, height: def.h },
            dragHandle: ".node-drag-handle",
            data: { path, from: fromNodeId, frame: explorerFrame },
          },
        ]);
      },
      markTodoSent: (nodeId, index) => {
        markDirty(nodeId);
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            const items = [...((n.data.items as { t: string; d: boolean; s?: boolean }[]) ?? [])];
            if (items[index]) items[index] = { ...items[index], s: true };
            return { ...n, data: { ...n.data, items } };
          })
        );
      },
      renameSession: (id, name) => {
        api.renameSession(id, name).catch(() => {});
        onProjectsChanged(); // refreshes sessions list too (App.refresh)
      },
      removeNode,
      updateNodeData,
      registerTerminal: (sessionId, handle) => {
        if (handle) terminalsRef.current.set(sessionId, handle);
        else terminalsRef.current.delete(sessionId);
      },
      setFocusedSession: (sessionId) => {
        // tell the room which terminal this human is in (Figma-style
        // "last seen on"); dedupe — focusCapture refires constantly
        if (focusedRef.current !== sessionId) {
          serverEvents.send({ type: "focus", sessionId });
        }
        focusedRef.current = sessionId;
      },
    }),
    [canvasId, ctrlHeld, peers, rf, sessions, onArchiveSession, onOpenSession, onProjectsChanged, removeNode, updateNodeData, markDirty]
  );

  // no prompt popup: the session opens instantly and you type in the terminal
  const newSession = useCallback(
    (harness: string, at?: { x: number; y: number }) => {
      if (at) pendingSpotRef.current = at;
      onCreateSession({
        harness,
        text: "",
        mode: "bypassPermissions",
        projectPath: projects.find((p) => p.path === canvasId)?.name,
      });
    },
    [onCreateSession, projects, canvasId]
  );

  // ---- imperative handle -------------------------------------------------
  useImperativeHandle(
    handleRef,
    () => ({
      focusSession: (sessionId: string) => {
        const node = nodesRef.current.find(
          (n) => n.type === "terminal" && n.data.sessionId === sessionId
        );
        if (node) {
          rf.fitView({ nodes: [{ id: node.id }], duration: 400, maxZoom: 1 });
          terminalsRef.current.get(sessionId)?.focus();
        } else {
          pendingFocusRef.current = sessionId;
        }
      },
      addNode: (type) => addNode(type),
      fitView: () => rf.fitView({ duration: 400, padding: 0.15, maxZoom: 1 }),
      newSession: (harness) => newSession(harness),
    }),
    [rf, addNode, newSession]
  );

  // ---- minimap colors ----------------------------------------------------
  const miniColor = useCallback((n: Node) => {
    if (n.type === "terminal") {
      const s = sessionsRef.current.find((x) => x.id === n.data.sessionId);
      switch (s?.agent_state) {
        case "needs_approval":
          return "#fb7185";
        case "working":
          return "#fbbf24";
        case "idle":
          return "#34d399";
        default:
          return "#57534e";
      }
    }
    if (n.type === "sticky")
      return (STICKY_COLORS[(n.data.color as string) ?? "amber"] ?? STICKY_COLORS.amber).bg;
    if (n.type === "browser") return "#38bdf8";
    return "#57534e";
  }, []);


  // parent → child edges for spawned sub-agents (`agora spawn`).
  // Keyed on a SIGNATURE, not the sessions array: App refetches sessions every
  // 10s with fresh identity, and a new edges array makes React Flow remount
  // them — the animated dashes restarted visibly ("flickering links").
  const edgeSignature = sessions
    .filter((s) => s.parent_id)
    .map((s) => `${s.id}:${s.parent_id}`)
    .join("|");
  const edges = useMemo<Edge[]>(() => {
    const nodeBySession = new Map(
      nodes
        .filter((n) => n.type === "terminal" && !n.hidden)
        .map((n) => [n.data.sessionId as string, n.id])
    );
    const spawnEdges: Edge[] = sessionsRef.current
      .filter((s) => s.parent_id && nodeBySession.has(s.id) && nodeBySession.has(s.parent_id))
      .map((s) => ({
        id: `spawn-${s.id}`,
        type: "floating",
        source: nodeBySession.get(s.parent_id!)!,
        target: nodeBySession.get(s.id)!,
        animated: true,
        style: { stroke: "#8b5cf6", strokeWidth: 1.5, opacity: 0.5 },
      }));
    const ids = new Set(nodes.map((n) => n.id));
    const fileLinks: Edge[] = nodes
      .filter((n) => n.type === "file" && n.data.from && ids.has(n.data.from as string))
      .map((n) => ({
        id: `file-${n.id}`,
        type: "floating",
        source: n.data.from as string,
        target: n.id,
        style: { stroke: "#38bdf8", strokeWidth: 1.2, opacity: 0.45 },
      }));
    // hand-drawn links: solid and brighter than the derived ones, because
    // these are the only edges that MEAN something to the agents
    const drawn: Edge[] = links
      .filter((l) => ids.has(l.source) && ids.has(l.target))
      .map((l) => ({
        id: l.id,
        type: "floating",
        source: l.source,
        target: l.target,
        // no label: the line is the whole statement, and a badge floating in
        // the middle of the canvas was the opposite of clean
        style: { stroke: "#34d399", strokeWidth: 2 },
      }));
    return [...spawnEdges, ...fileLinks, ...drawn];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edgeSignature, links]);


  // ---- live cursor broadcast ---------------------------------------------
  // World coords so peers see the cursor pinned to the canvas whatever their
  // own pan/zoom. ~25 msg/s max; the server relays to same-project peers only.
  const lastCursorAt = useRef(0);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const now = performance.now();
      if (now - lastCursorAt.current < 40) return;
      lastCursorAt.current = now;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      serverEvents.send({ type: "cursor", x: Math.round(p.x), y: Math.round(p.y) });
    },
    [rf]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== "h" && k !== "l" && k !== "escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], .xterm")) return;
      if (k === "escape") {
        setLinkTool(false);
        setLinkFrom(null);
        return;
      }
      if (k === "l") {
        setLinkTool((v) => !v);
        setLinkFrom(null);
        setHandTool(false);
        return;
      }
      if (k !== "h") return;
      setHandTool((v) => !v);
      setLinkTool(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // paste or drop an image ANYWHERE on the canvas (terminals keep their own
  // paste flow — we ignore events aimed at them or at text inputs)
  const placeImage = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1] ?? "");
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        const { src } = await api.uploadCanvasImage(canvasId, file.name || "image.png", b64);
        const dims = await new Promise<{ w: number; h: number }>((res) => {
          const img = new Image();
          img.onload = () => res({ w: img.naturalWidth || 420, h: img.naturalHeight || 300 });
          img.onerror = () => res({ w: 420, h: 300 });
          img.src = src;
        });
        const scale = Math.min(1, 480 / dims.w, 480 / dims.h);
        const w = Math.max(80, Math.round(dims.w * scale));
        const h = Math.max(60, Math.round(dims.h * scale));
        const id = crypto.randomUUID();
        markDirty(id);
        setNodes((prev) => [
          ...prev,
          {
            id,
            type: "image",
            position: at ?? findFreeSpot(prev, { w, h }),
            style: { width: w, height: h },
            data: { src },
          },
        ]);
      } catch (e) {
        toast.error("Image rejected", { description: String(e) });
      }
    },
    [canvasId, findFreeSpot, markDirty]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable], .xterm")) return;
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!images.length) return;
      e.preventDefault();
      for (const f of images) placeImage(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [placeImage]);

  const menuFlowPos = menu ? rf.screenToFlowPosition({ x: menu.x, y: menu.y }) : null;

  const menuAdd = (type: Exclude<CanvasNodeType, "terminal">) => addNode(type, menuFlowPos ?? undefined);
  const menuSession = (harness: string) => newSession(harness, menuFlowPos ?? undefined);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
      </div>
    );
  }

  return (
    <CanvasCtx.Provider value={canvasApi}>
      <div
        className={cn("relative h-full w-full", linkTool && "canvas-linking")}
        onClick={() => menu && setMenu(null)}
        onPointerMove={onPointerMove}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.defaultPrevented) return; // a terminal already took it
          const images = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith("image/")
          );
          if (!images.length) return;
          e.preventDefault();
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          for (const f of images) placeImage(f, at);
        }}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodesConnectable={false}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => onNodeClickLink(node)}
          onEdgeDoubleClick={(_, edge) => removeLink(edge.id)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.08}
          maxZoom={2}
          defaultViewport={initialViewportRef.current}
          fitView={!initialViewportRef.current && nodes.length > 0}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          selectionOnDrag={!coarse && !handTool}
          panOnDrag={coarse ? true : handTool ? [0, 1, 2] : [1, 2]}
          disableKeyboardA11y
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const ev = e as unknown as MouseEvent;
            setMenu({ x: ev.clientX, y: ev.clientY });
          }}
          onPaneClick={() => setMenu(null)}
          onMoveEnd={(_, viewport) => {
            viewport = {
              x: Math.round(viewport.x),
              y: Math.round(viewport.y),
              zoom: Math.round(viewport.zoom * 1000) / 1000,
            };
            viewportRef.current = viewport;
            // viewport is not undo-worthy: fold it into the baseline so the
            // next node change doesn't snapshot a pan, and skip no-op saves
            const doc = makeDoc();
            const json = JSON.stringify(doc);
            if (json === lastJsonRef.current) return;
            lastDocRef.current = doc;
            lastJsonRef.current = json;
            scheduleSave();
          }}
          proOptions={{ hideAttribution: true }}
          className="canvas-flow"
        >
          {/* literal color: var() is not valid inside an SVG fill attribute,
              which is how the color prop is applied (app is dark-only) */}
          <Background variant={BackgroundVariant.Dots} gap={30} size={2.4} color="#77736b55" />
          {!coarse && (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={miniColor}
              nodeStrokeWidth={0}
              className="canvas-minimap"
              style={{ width: 140, height: 94 }}
            />
          )}
        </ReactFlow>

        {/* live cursors of the other humans in the room */}
        {peers.length > 0 && <PresenceLayer peers={peers} />}

        {/* current project chip */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-1.5 backdrop-blur-md">
          <span className="text-xs font-semibold">{canvasId.split("/").pop() || canvasId}</span>
          {(() => {
            const p = projects.find((x) => x.path === canvasId);
            return p?.branch ? (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {p.branch}
                {p.dirty && <span className="size-1.5 rounded-full bg-warning" title="Uncommitted changes" />}
              </span>
            ) : null;
          })()}
          </div>
        </div>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground/70">
            <p>Right-click to add a terminal or agent</p>
            <p className="flex items-center gap-1.5 text-xs">
              <Kbd>⌘K</Kbd> command palette · <Kbd>+</Kbd> in the dock below
            </p>
            <p className="text-[11px] text-muted-foreground/50">
              left-drag selects · middle-drag pans · wheel zooms
            </p>
          </div>
        )}

        {/* touch: one key bar for the whole canvas, floating above the dock,
            driving whichever terminal was touched last */}
        {coarse && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[4.75rem] z-10 flex justify-center px-3">
            <QuickKeys
              className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card/85 px-2 py-1.5 shadow-lg backdrop-blur-md [scrollbar-width:none]"
              onKey={(seq) => {
                const focused = focusedRef.current;
                if (focused) terminalsRef.current.get(focused)?.sendText(seq);
              }}
            />
          </div>
        )}
        <Dock
          onAdd={(type) => addNode(type)}
          onNewSession={(harness) => newSession(harness)}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          hand={handTool}
          link={linkTool}
          onToggleLink={() => {
            setLinkTool((v) => !v);
            setLinkFrom(null);
            setHandTool(false); // two pane modes cannot both be armed
          }}
          onToggleHand={() => setHandTool((v) => !v)}
          onFitView={() => rf.fitView({ duration: 400, padding: 0.15, maxZoom: 1 })}
          onZoom={(dir) => (dir > 0 ? rf.zoomIn({ duration: 150 }) : rf.zoomOut({ duration: 150 }))}
          dictation={dictation}
        />

        {menu && menuFlowPos && (
          <div
            className="fixed z-50 flex min-w-52 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(
              [
                {
                  icon: <HarnessIcon harness="claude" size={14} />,
                  label: "New Claude Code",
                  run: () => menuSession("claude"),
                },
                {
                  icon: <HarnessIcon harness="codex" size={14} />,
                  label: "New Codex",
                  run: () => menuSession("codex"),
                },
                {
                  icon: <HarnessIcon harness="opencode" size={14} />,
                  label: "New opencode",
                  run: () => menuSession("opencode"),
                },
                {
                  icon: <HarnessIcon harness="gemini" size={14} />,
                  label: "New Gemini",
                  run: () => menuSession("gemini"),
                },
                {
                  icon: <SquareTerminal className="size-3.5 text-muted-foreground" />,
                  label: "New terminal",
                  run: () => menuSession("shell"),
                },
                {
                  icon: <StickyNote className="size-3.5 text-amber-400" />,
                  label: "New sticky note",
                  run: () => menuAdd("sticky"),
                },
                {
                  icon: <Globe className="size-3.5 text-sky-400" />,
                  label: "New browser",
                  run: () => menuAdd("browser"),
                },
                {
                  icon: <FolderTree className="size-3.5 text-sky-400" />,
                  label: "File explorer",
                  run: () => menuAdd("files"),
                },
                {
                  icon: <Gamepad2 className="size-3.5 text-emerald-400" />,
                  label: "Dino game",
                  run: () => menuAdd("dino"),
                },
                {
                  icon: <Joystick className="size-3.5 text-lime-400" />,
                  label: "Snake",
                  run: () => menuAdd("snake"),
                },
                {
                  icon: <MessagesSquare className="size-3.5 text-violet-400" />,
                  label: "Agent chat",
                  run: () => menuAdd("chat"),
                },
                {
                  icon: <ListTodo className="size-3.5 text-sky-400" />,
                  label: "Todo list",
                  run: () => menuAdd("todo"),
                },
              ] as const
            ).map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}

        {confirmArchive && (
          <div className="absolute inset-x-0 bottom-20 z-40 flex justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/90 px-4 py-2.5 shadow-lg backdrop-blur-md">
              <span className="text-xs">
                Archive {confirmArchive.length > 1 ? `${confirmArchive.length} sessions` : "this session"}?
                <span className="ml-1 text-muted-foreground">(recoverable from the sidebar)</span>
              </span>
              <button
                autoFocus
                onClick={() => {
                  confirmArchive.forEach(onArchiveSession);
                  setConfirmArchive(null);
                }}
                onKeyDown={(e) => e.key === "Escape" && setConfirmArchive(null)}
                className="rounded-lg bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/25"
              >
                Archive
              </button>
              <button
                onClick={() => setConfirmArchive(null)}
                className="rounded-lg px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

      </div>
    </CanvasCtx.Provider>
  );
}

/** Desktop main view: an infinite canvas of terminal/agent sessions, sticky
 *  notes, browser panes… Layout syncs to the server (shared across devices). */
const CanvasView = forwardRef<CanvasHandle, CanvasViewProps>(function CanvasView(props, ref) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} handleRef={ref} />
    </ReactFlowProvider>
  );
});

export default CanvasView;
