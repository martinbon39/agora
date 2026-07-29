#!/usr/bin/env node
// agora-bridge — run this on YOUR machine (Windows/macOS/Linux, node >= 22).
// It opens an OUTBOUND WebSocket to agora, so nothing is exposed on your side;
// agents on the VPS can then list/fetch files from this machine via
// `agora pc ls <path>` and `agora pc get <path>`.
//
//   node agora-bridge.mjs https://agora.example.com <token>
//   (token: `cat ~/.agora/bridge-secret` on the VPS)
//
// Scope: read-only (ls + get), 25 MB max per file. Kill it to cut access.

import fs from "node:fs/promises";
import path from "node:path";

const rawOrigin = process.argv[2] ?? process.env.AGORA_ORIGIN ?? "";
const token = process.argv[3] ?? process.env.AGORA_BRIDGE_TOKEN ?? "";
const origin = rawOrigin.replace(/^http/, "ws").replace(/\/$/, "");
if (!origin || !token) {
  console.error("usage: node agora-bridge.mjs <https://agora.example.com> <token>");
  process.exit(1);
}

const MAX_FILE = 25 * 1024 * 1024;
const CHUNK = 256 * 1024;

async function handle(ws, msg) {
  const { id, op, path: p } = msg;
  const send = (o) => ws.send(JSON.stringify({ id, ...o }));
  try {
    if (op === "ls") {
      const dirents = await fs.readdir(p, { withFileTypes: true });
      const entries = [];
      for (const e of dirents.slice(0, 500)) {
        let size = 0;
        if (e.isFile()) {
          try {
            size = (await fs.stat(path.join(p, e.name))).size;
          } catch {}
        }
        entries.push({ name: e.name, dir: e.isDirectory(), size });
      }
      send({ entries });
      console.log(`[agora-bridge] ls ${p} (${entries.length} entries)`);
    } else if (op === "get") {
      const st = await fs.stat(p);
      if (st.size > MAX_FILE) {
        send({ error: `file too large (${st.size} bytes, max ${MAX_FILE})` });
        return;
      }
      const buf = await fs.readFile(p);
      for (let i = 0; i < buf.length; i += CHUNK) {
        send({ chunk: buf.subarray(i, i + CHUNK).toString("base64") });
      }
      send({ done: true, name: path.basename(p) });
      console.log(`[agora-bridge] sent ${p} (${st.size} bytes)`);
    } else {
      send({ error: `unknown op: ${op}` });
    }
  } catch (e) {
    send({ error: String(e?.message ?? e) });
  }
}

function connect() {
  const ws = new WebSocket(`${origin}/ws/bridge?token=${encodeURIComponent(token)}`);
  ws.onopen = () => console.log(`[agora-bridge] connected to ${origin}`);
  ws.onmessage = (ev) => {
    try {
      handle(ws, JSON.parse(ev.data));
    } catch {}
  };
  ws.onclose = (ev) => {
    console.log(`[agora-bridge] disconnected (${ev.code || "?"}) — retrying in 5s`);
    setTimeout(connect, 5000);
  };
  ws.onerror = () => {};
}
connect();
