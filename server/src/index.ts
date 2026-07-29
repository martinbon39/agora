import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { ensureTmuxServer } from "./tmux.js";
import { sessionRoutes } from "./routes/sessions.js";
import { projectRoutes } from "./routes/projects.js";
import { hookRoutes } from "./routes/hooks.js";
import { canvasRoutes } from "./routes/canvas.js";
import { dictateRoutes } from "./routes/dictate.js";
import { chatRoutes } from "./routes/chat.js";
import { accountRoutes } from "./routes/accounts.js";
import { peekRoutes } from "./routes/peek.js";
import { fileRoutes } from "./routes/files.js";
import { proxyRoutes } from "./routes/proxy.js";
import { githubRoutes } from "./routes/github.js";
import { uploadRoutes, uploadsDir } from "./routes/uploads.js";
import { inviteRoutes } from "./routes/invites.js";
import { bridgeRoutes, bridgeSecret } from "./bridge.js";
import { initAuthDb, authRoutes, requireAuth, hookSecret } from "./auth.js";
import { googleAuthRoutes } from "./googleAuth.js";
import { initPush, pushRoutes } from "./push.js";

const app = Fastify({ logger: true });

async function main() {
  const db = initDb();
  initAuthDb(db);
  initPush(db);
  hookSecret(); // ensure the secret exists so the `agora` CLI works from turn one
  bridgeSecret(); // same for the PC bridge token (the owner copies it to their machine)
  await ensureTmuxServer();

  await app.register(cookie);
  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
    allowList: (req) => !(req.raw.url ?? "").startsWith("/api/auth/"),
  });
  requireAuth(app);
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });
  await app.register(authRoutes);
  await app.register(googleAuthRoutes);
  await app.register(sessionRoutes);
  await app.register(projectRoutes);
  await app.register(hookRoutes);
  await app.register(canvasRoutes);
  await app.register(dictateRoutes);
  await app.register(chatRoutes);
  await app.register(accountRoutes);
  await app.register(peekRoutes);
  await app.register(fileRoutes);
  await app.register(proxyRoutes);
  await app.register(pushRoutes);
  await app.register(githubRoutes);
  await app.register(uploadRoutes);
  await app.register(inviteRoutes);
  await app.register(bridgeRoutes);

  // pasted/dropped files (auth-gated in requireAuth, like /artifacts)
  fs.mkdirSync(uploadsDir(), { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsDir(),
    prefix: "/uploads/",
    decorateReply: false,
  });

  // HTML/doc artifacts produced by agent sessions (auth-gated in requireAuth)
  const artifactsDir = path.join(config.dataDir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: artifactsDir,
    prefix: "/artifacts/",
    decorateReply: false,
  });

  // Serve the built web UI when present (single-process deploy).
  const webDist = path.resolve(fileURLToPath(import.meta.url), "../../../web/dist");
  // Build fingerprint = index.html content (its hashed asset URLs change every
  // build). Clients compare it on WS reconnect — a deploy restarts the server,
  // the socket reconnects, the version differs, the page reloads itself.
  let buildId = "dev";
  try {
    buildId = crypto
      .createHash("sha1")
      .update(fs.readFileSync(path.join(webDist, "index.html")))
      .digest("hex")
      .slice(0, 12);
  } catch {}
  app.get("/api/version", async () => ({ build: buildId }));
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "/";
      if (url.startsWith("/api/") || url.startsWith("/ws/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      // absolute asset paths requested from inside a proxied iframe
      // (/assets/x.js with Referer /proxy/5173/…) belong to the proxied app
      const ref = req.headers.referer ?? "";
      const viaProxy = /\/proxy\/(\d+)\//.exec(ref);
      if (viaProxy && !url.startsWith("/proxy/")) {
        reply.redirect(`/proxy/${viaProxy[1]}${url}`, 307);
        return;
      }
      reply.sendFile("index.html");
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
