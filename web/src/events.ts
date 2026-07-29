/** In-page fan-out of the /ws/events server socket: App owns the single
 *  connection and re-emits every parsed message here so feature views
 *  (canvas sync, presence…) can listen — and now also SEND (cursor, focus,
 *  hello) — without opening their own socket. */

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

/** One id per tab: presence identity AND canvas echo suppression share it
 *  (a canvas save and the cursor stream must be attributable to the same
 *  peer, and it must survive canvas remounts on project switch). */
export const tabClientId = crypto.randomUUID();

type Listener = (msg: ServerEvent) => void;

const listeners = new Set<Listener>();
let sender: ((msg: object) => void) | null = null;

export const serverEvents = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(msg: ServerEvent) {
    for (const fn of listeners) fn(msg);
  },
  /** App wires this to the live socket (null while disconnected). */
  setSender(fn: ((msg: object) => void) | null) {
    sender = fn;
  },
  /** Fire-and-forget toward the server; dropped while disconnected. */
  send(msg: object) {
    sender?.(msg);
  },
};
