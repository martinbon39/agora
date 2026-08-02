import type { WebSocket } from "ws";

/**
 * Keep-alive for a websocket whose peer may vanish without saying so.
 *
 * A TCP connection can stop delivering without ever sending a FIN or an RST: a
 * closed laptop lid, a NAT or load-balancer idle timeout, a wifi-to-cellular
 * handover. Nothing in the socket API reports that. The server's `close` event
 * never fires, so an attach keeps its pty and its tmux client forever, and the
 * browser leaves `readyState` at OPEN, so its own `onclose` reconnect never
 * runs. Both ends sit on a dead pipe believing it is live — which is what "the
 * websocket doesn't work" looks like from the outside.
 *
 * The only fix is to expect traffic. Ping on a timer and hang up when the
 * answers stop; browsers reply to a protocol-level ping on their own, so this
 * costs the client nothing. The client-side half of this lives in
 * web/src/lib/keepAlive.ts — a server ping proves the CLIENT is alive, and
 * cannot prove the reverse.
 *
 * terminate(), not close(): close() starts a handshake that waits for a reply
 * from the peer we have just concluded is not answering.
 */
const PING_MS = 15_000;
/** Silence beyond this is a dead peer. Two and a half missed pings — long
 *  enough to ride out a garbage-collection pause or a phone changing network,
 *  short enough that a leaked pty is measured in seconds. */
const DEAD_MS = 40_000;

export function keepAlive(ws: WebSocket): void {
  let lastSeen = Date.now();
  const seen = () => (lastSeen = Date.now());
  // any frame counts as proof of life, not just a pong: a busy terminal is
  // sending acks and input constantly and need not be probed at all
  ws.on("pong", seen);
  ws.on("message", seen);

  const timer = setInterval(() => {
    if (Date.now() - lastSeen > DEAD_MS) {
      ws.terminate();
      return;
    }
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }, PING_MS);
  // unref: a lingering socket's timer must never be the reason the process
  // refuses to exit — the gates SIGTERM their server and fail on escalation
  timer.unref?.();

  const stop = () => clearInterval(timer);
  ws.on("close", stop);
  ws.on("error", stop);
}
