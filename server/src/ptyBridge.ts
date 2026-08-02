import type { WebSocket } from "ws";
import pty from "node-pty";
import { config } from "./config.js";
import { attachArgs } from "./tmux.js";
import { sessions } from "./db.js";
import { keepAlive } from "./heartbeat.js";

interface ClientMessage {
  t: "i" | "r" | "a" | "p";
  /** input data (t=i) */
  d?: string;
  /** resize (t=r) */
  cols?: number;
  rows?: number;
  /** acked byte count (t=a) */
  n?: number;
}

/**
 * Bridge one WebSocket client to a tmux session via a fresh pty running
 * `tmux attach`. Closing the socket kills only the attach client; the tmux
 * session (and the agent inside it) keeps running detached.
 *
 * Flow control (xterm.js guide): the browser acks bytes as xterm.js finishes
 * writing them. If too many bytes are in flight un-acked, pause the pty —
 * tmux stops reading, output buffers server-side instead of overflowing
 * xterm.js's 50MB write buffer, which silently drops data.
 */
export function bridgeSession(ws: WebSocket, sessionId: string, cols: number, rows: number) {
  const { file, args } = attachArgs(sessionId);
  const term = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: Math.max(2, Math.min(500, cols)),
    rows: Math.max(2, Math.min(300, rows)),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });

  let inFlight = 0;
  let paused = false;
  let closed = false;

  term.onData((data) => {
    if (closed) return;
    const buf = Buffer.from(data, "utf8");
    inFlight += buf.length;
    ws.send(buf);
    if (!paused && inFlight > config.flowHighWater) {
      term.pause();
      paused = true;
    }
  });

  term.onExit(() => {
    closed = true;
    try {
      ws.close(1000, "detached");
    } catch {}
  });

  ws.on("message", (raw, isBinary) => {
    if (closed) return;
    if (isBinary) return; // protocol is JSON text from client
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.t) {
      case "i":
        if (typeof msg.d === "string") {
          term.write(msg.d);
          sessions.touch(sessionId);
        }
        break;
      case "r":
        if (msg.cols && msg.rows) {
          term.resize(
            Math.max(2, Math.min(500, msg.cols)),
            Math.max(2, Math.min(300, msg.rows))
          );
        }
        break;
      case "a":
        inFlight = Math.max(0, inFlight - (msg.n ?? 0));
        if (paused && inFlight < config.flowLowWater) {
          term.resume();
          paused = false;
        }
        break;
      case "p":
        // Liveness probe from the browser. A protocol-level ping is answered by
        // the browser itself and so proves nothing to the page's JavaScript,
        // which cannot observe pongs — the client needs an answer it can see.
        // Text frame: the client reads binary as pty output.
        try {
          ws.send(JSON.stringify({ t: "p" }));
        } catch {}
        break;
    }
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      term.kill();
    } catch {}
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
  // A silently dead client would otherwise hold this pty — and its tmux attach
  // client — for as long as the server runs.
  keepAlive(ws);
}
