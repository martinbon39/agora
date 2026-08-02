/**
 * Client half of the websocket keep-alive (server half: server/src/heartbeat.ts).
 *
 * A browser cannot see pongs — the WebSocket API answers protocol-level pings
 * itself and never surfaces them to JavaScript. So a server ping proves the
 * client is alive and tells the client nothing. When the connection is
 * black-holed rather than closed (a closed lid, a NAT or proxy idle timeout, a
 * wifi handover), no FIN arrives, `readyState` stays OPEN, `onclose` never
 * fires, and every reconnect path in the app is keyed on `onclose`. The page
 * then sits on a dead socket indefinitely.
 *
 * So the client probes too, with an application-level message the server
 * answers visibly, and gives up when the answers stop.
 */
const PING_MS = 15_000;
/** Silence beyond this is a dead connection. Matches DEAD_MS on the server. */
const DEAD_MS = 40_000;

export interface KeepAlive {
  /** Call on every frame received — any traffic is proof of life. */
  seen(): void;
  /** Call when the socket is replaced or the view unmounts. */
  stop(): void;
}

/**
 * @param ping   the probe to send; the server answers it on the same socket
 * @param onDead called once when the peer stops answering. The socket is
 *               already closed by then, but callers must reconnect from HERE
 *               rather than waiting for `onclose`: closing a black-holed socket
 *               starts a handshake with a peer that will never reply, and the
 *               browser may take minutes to give up on it.
 */
export function keepAlive(ws: WebSocket, ping: object, onDead: () => void): KeepAlive {
  let last = Date.now();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    if (Date.now() - last > DEAD_MS) {
      stopped = true;
      clearInterval(timer);
      try {
        ws.close(4001, "unresponsive");
      } catch {
        /* already gone */
      }
      onDead();
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(ping));
      } catch {
        /* the close/error path will pick it up */
      }
    }
  }, PING_MS);

  return {
    seen() {
      last = Date.now();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
