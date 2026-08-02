import type { WebSocket } from "ws";
import { scopeAllows, type AuthUser } from "./auth.js";
import { keepAlive } from "./heartbeat.js";

/**
 * Event bus + presence. Every dashboard holds one /ws/events socket; besides
 * the historical server->client broadcasts it now carries multiplayer:
 *  - client -> server: {type:"hello", clientId, project} (join/switch project),
 *    {type:"cursor", x, y} (flow coords), {type:"focus", sessionId|null}
 *  - server -> same-project peers: {type:"cursor", clientId, user, x, y}
 *    relayed as-is, and a full {type:"presence", project, peers} snapshot on
 *    every join/leave/focus change (snapshots are tiny and never drift).
 */

interface EventClient {
  user: AuthUser;
  clientId: string | null;
  project: string | null;
  focus: string | null;
}

export interface PresencePeer {
  clientId: string;
  user: Pick<AuthUser, "email" | "name" | "color" | "role">;
  focus: string | null;
}

const clients = new Map<WebSocket, EventClient>();

// Every authenticated socket a user holds — events AND terminal attaches —
// so revoking an invite cuts the live connections, not just future logins.
const userSockets = new Map<string, Set<WebSocket>>();

export function trackUserSocket(email: string, ws: WebSocket) {
  let set = userSockets.get(email);
  if (!set) userSockets.set(email, (set = new Set()));
  set.add(ws);
  const drop = () => {
    const s = userSockets.get(email);
    if (!s) return;
    s.delete(ws);
    if (s.size === 0) userSockets.delete(email);
  };
  ws.on("close", drop);
  ws.on("error", drop);
}

export function closeUserSockets(email: string) {
  for (const ws of [...(userSockets.get(email) ?? [])]) {
    try {
      ws.close(4403, "access revoked");
    } catch {
      /* already dying */
    }
  }
}

function peersOf(project: string): PresencePeer[] {
  const peers: PresencePeer[] = [];
  for (const meta of clients.values()) {
    if (meta.project !== project || !meta.clientId) continue;
    const { email, name, color, role } = meta.user;
    peers.push({ clientId: meta.clientId, user: { email, name, color, role }, focus: meta.focus });
  }
  return peers;
}

function sendPresence(project: string | null) {
  if (!project) return;
  const payload = JSON.stringify({ type: "presence", project, peers: peersOf(project) });
  for (const [ws, meta] of clients) {
    if (meta.project === project && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

export function addEventClient(ws: WebSocket, user: AuthUser) {
  const meta: EventClient = { user, clientId: null, project: null, focus: null };
  clients.set(ws, meta);
  trackUserSocket(user.email, ws);
  // Presence is only true if the sockets behind it are: a peer whose connection
  // died without a FIN would otherwise stay in every other peer's cursor list.
  keepAlive(ws);

  ws.on("message", (raw) => {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") {
      // an answer the page's JavaScript can actually observe — see heartbeat.ts
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "hello") {
      const prev = meta.project;
      meta.clientId = typeof msg.clientId === "string" ? msg.clientId.slice(0, 64) : null;
      let project = typeof msg.project === "string" && msg.project ? msg.project : null;
      // a scoped guest only ever joins their own project's room
      // `user.project &&` used to be part of this test, which waved through the
      // one case that should never pass: a guest with NO scope. Such rows exist
      // (an invite could once be created with a null project) and they matched
      // nothing in scopeAllows, so those guests were refused every HTTP route
      // while being admitted to any presence room they named.
      if (project && user.role === "guest" && user.project !== project) {
        project = null;
      }
      meta.project = project;
      meta.focus = null;
      if (prev && prev !== meta.project) sendPresence(prev);
      sendPresence(meta.project);
    } else if (msg.type === "cursor") {
      if (!meta.project || !meta.clientId) return;
      if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
      // relay raw — no server throttle, senders self-throttle to ~25/s
      const payload = JSON.stringify({
        type: "cursor",
        clientId: meta.clientId,
        user: { name: meta.user.name, color: meta.user.color },
        x: msg.x,
        y: msg.y,
      });
      for (const [peer, m] of clients) {
        if (peer !== ws && m.project === meta.project && peer.readyState === peer.OPEN)
          peer.send(payload);
      }
    } else if (msg.type === "node_pos") {
      // live node drag/resize: ephemeral relay to the room, exactly like
      // cursors — the debounced canvas save stays the persisted truth
      if (!meta.project || !meta.clientId) return;
      const nodes = (Array.isArray(msg.nodes) ? msg.nodes : [])
        .slice(0, 100)
        .filter(
          (n): n is { id: string; x?: number; y?: number; w?: number; h?: number } =>
            !!n &&
            typeof (n as { id?: unknown }).id === "string" &&
            ["x", "y", "w", "h"].some((k) => typeof (n as Record<string, unknown>)[k] === "number")
        )
        .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
      if (!nodes.length) return;
      const payload = JSON.stringify({ type: "node_pos", clientId: meta.clientId, nodes });
      for (const [peer, m] of clients) {
        if (peer !== ws && m.project === meta.project && peer.readyState === peer.OPEN)
          peer.send(payload);
      }
    } else if (msg.type === "focus") {
      meta.focus = typeof msg.sessionId === "string" ? msg.sessionId : null;
      sendPresence(meta.project);
    }
  });

  const bye = () => {
    const gone = clients.get(ws);
    clients.delete(ws);
    if (gone?.project) sendPresence(gone.project);
  };
  ws.on("close", bye);
  ws.on("error", bye);
}

/** Broadcast to every dashboard — optionally restricted so scoped guests
 *  never see other projects' traffic (chat/canvas) or the owner's inbox. */
export function broadcast(event: object, scope?: { project?: string; ownerOnly?: boolean }) {
  const payload = JSON.stringify(event);
  for (const [ws, meta] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (scope) {
      const u = meta.user;
      if (scope.ownerOnly && u.role !== "owner") continue;
      // Ask the same function every HTTP route asks, rather than re-deriving
      // the answer from `role` here. This filter used to constrain guests only,
      // so with open signup every tenant — all of them role "owner" — received
      // every other tenant's chat and canvas traffic, which is the cross-tenant
      // hole the projects table exists to close, reopened on the realtime path.
      // It also skipped guests whose scope was null, admitting them to
      // everything.
      if (scope.project && !scopeAllows(u, scope.project)) continue;
    }
    ws.send(payload);
  }
}
