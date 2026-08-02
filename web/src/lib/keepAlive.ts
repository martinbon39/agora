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
 * answers visibly, and gives up when a probe goes unanswered.
 *
 * Unanswered PROBE, not "quiet for a while" — the distinction is the whole
 * design. Browsers clamp setInterval to roughly once a minute in a background
 * tab, so a timer measuring silence against a fixed deadline fires late and
 * concludes that a perfectly healthy idle session is dead. Every backgrounded
 * tab would then reconnect on a loop, dropping presence each time. Measuring
 * from the moment a probe was actually sent is immune to that: a late tick
 * sends a late probe, the answer clears it, and nothing is declared dead. A
 * black hole is still caught, just as late as the browser is running us.
 */
const PING_MS = 10_000;
/** How long an unanswered probe may stand before the connection is dead. */
const DEAD_MS = 25_000;

export interface KeepAlive {
  /** Call on every frame received — any traffic is proof of life. */
  seen(): void;
  /** Call when the socket is replaced or the view unmounts. */
  stop(): void;
}

/**
 * @param ping   the probe to send; the server answers it on the same socket
 * @param onDead called once when a probe goes unanswered. The socket is closed
 *               by then, but callers must reconnect from HERE rather than
 *               waiting for `onclose`: closing a black-holed socket starts a
 *               handshake with a peer that will never reply, and the browser
 *               may take minutes to give up on it.
 */
export function keepAlive(ws: WebSocket, ping: object, onDead: () => void): KeepAlive {
  let lastSeen = Date.now();
  /** When the outstanding probe was sent, or null if none is outstanding. */
  let probedAt: number | null = null;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const now = Date.now();

    if (probedAt !== null) {
      if (now - probedAt <= DEAD_MS) return; // still within its grace period
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

    if (now - lastSeen < PING_MS) return; // a busy socket needs no probing
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(ping));
      probedAt = now;
    } catch {
      /* the close/error path will pick it up */
    }
  }, PING_MS);

  return {
    seen() {
      lastSeen = Date.now();
      probedAt = null; // any answer at all clears the outstanding probe
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
