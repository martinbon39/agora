import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { expectedOrigin } from "./auth.js";

let db: Database.Database;

interface Vapid {
  publicKey: string;
  privateKey: string;
}

function vapidKeys(): Vapid {
  const file = path.join(config.dataDir, "vapid.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}

export function initPush(database: Database.Database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  const keys = vapidKeys();
  webpush.setVapidDetails(`mailto:argos@${new URL(expectedOrigin()).hostname}`, keys.publicKey, keys.privateKey);
}

export async function pushRoutes(app: FastifyInstance) {
  app.get("/api/push/vapid", async () => ({ publicKey: vapidKeys().publicKey }));

  app.post<{ Body: { subscription?: { endpoint?: string } } }>(
    "/api/push/subscribe",
    async (req, reply) => {
      const sub = req.body?.subscription;
      if (!sub?.endpoint) return reply.code(400).send({ error: "missing subscription" });
      db.prepare(
        `INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?)`
      ).run(sub.endpoint, JSON.stringify(sub), Date.now());
      return { ok: true };
    }
  );
}

/** Fire-and-forget: notify every registered device; prune dead endpoints. */
export function sendPush(payload: { title: string; body: string; url?: string }) {
  const rows = db.prepare(`SELECT endpoint, subscription FROM push_subscriptions`).all() as {
    endpoint: string;
    subscription: string;
  }[];
  for (const row of rows) {
    webpush
      .sendNotification(JSON.parse(row.subscription), JSON.stringify(payload), { TTL: 600 })
      .catch((err: { statusCode?: number }) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(row.endpoint);
        }
      });
  }
}
