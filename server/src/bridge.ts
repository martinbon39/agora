import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { uploadsDir } from "./routes/uploads.js";

/**
 * PC bridge: Martin's machine runs deploy/agora-bridge.mjs, which opens an
 * OUTBOUND WebSocket to agora (no port to open at home). Agents on the VPS can
 * then list/fetch files from the PC via `agora pc ls|get` -> /api/hooks/pc.
 * Fetched files land in ~/.agora/uploads/pc/ so agents read them locally.
 */

let secretCache: string | null = null;
export function bridgeSecret(): string {
  if (secretCache) return secretCache;
  const file = path.join(config.dataDir, "bridge-secret");
  try {
    secretCache = fs.readFileSync(file, "utf8").trim();
  } catch {
    secretCache = crypto.randomBytes(24).toString("base64url");
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, secretCache, { mode: 0o600 });
  }
  return secretCache;
}

let bridge: WebSocket | null = null;
export const bridgeConnected = () => bridge !== null;

interface Pending {
  resolve: (v: BridgeReply) => void;
  reject: (e: Error) => void;
  chunks: Buffer[];
  timer: NodeJS.Timeout;
}
interface BridgeReply {
  entries?: { name: string; dir: boolean; size: number }[];
  file?: Buffer;
  name?: string;
}
const pending = new Map<string, Pending>();

function fail(id: string, message: string) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.reject(new Error(message));
}

export async function bridgeRoutes(app: FastifyInstance) {
  // The PC client connects here (token-authenticated, newest connection wins).
  app.get<{ Querystring: { token?: string } }>(
    "/ws/bridge",
    { websocket: true },
    (socket, req) => {
      if (req.query.token !== bridgeSecret()) {
        socket.close(4401, "bad token");
        return;
      }
      bridge?.close(4000, "replaced");
      bridge = socket;
      app.log.info("pc bridge connected");
      socket.on("message", (raw: Buffer) => {
        let msg: {
          id?: string;
          error?: string;
          entries?: BridgeReply["entries"];
          name?: string;
          chunk?: string;
          done?: boolean;
        };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const id = msg.id ?? "";
        const p = pending.get(id);
        if (!p) return;
        if (msg.error) return fail(id, msg.error);
        if (msg.entries) {
          pending.delete(id);
          clearTimeout(p.timer);
          return p.resolve({ entries: msg.entries });
        }
        if (msg.chunk) p.chunks.push(Buffer.from(msg.chunk, "base64"));
        if (msg.done) {
          pending.delete(id);
          clearTimeout(p.timer);
          p.resolve({ file: Buffer.concat(p.chunks), name: msg.name });
        }
      });
      socket.on("close", () => {
        if (bridge === socket) bridge = null;
        for (const id of [...pending.keys()]) fail(id, "bridge disconnected");
      });
    }
  );

  // Agents call this (hook-secret auth, like /api/hooks/notify).
  app.post<{ Body: { op?: string; path?: string } }>("/api/hooks/pc", async (req, reply) => {
    const { op, path: pcPath } = req.body ?? {};
    if (!bridge) {
      return reply
        .code(503)
        .send({ error: "PC bridge not connected — run agora-bridge on the PC" });
    }
    if ((op !== "ls" && op !== "get") || !pcPath) {
      return reply.code(400).send({ error: "expected { op: ls|get, path }" });
    }
    const id = nanoid(8);
    const result = await new Promise<BridgeReply>((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        chunks: [],
        timer: setTimeout(() => fail(id, "PC bridge timeout (60s)"), 60_000),
      });
      bridge!.send(JSON.stringify({ id, op, path: pcPath }));
    }).catch((e: Error) => e);
    if (result instanceof Error) return reply.code(502).send({ error: result.message });
    if (result.entries) return { entries: result.entries };
    const safe = (result.name ?? "file").replace(/[^A-Za-z0-9._-]/g, "-");
    const dir = path.join(uploadsDir(), "pc");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, safe);
    fs.writeFileSync(dest, result.file ?? Buffer.alloc(0));
    return { path: dest, size: result.file?.length ?? 0, url: `/uploads/pc/${safe}` };
  });

  app.get("/api/pc/status", async () => ({ connected: bridgeConnected() }));
}
