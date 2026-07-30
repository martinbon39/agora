import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, openSignup } from "./config.js";
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
import { tenantRoutes } from "./routes/tenant.js";
import { planRoutes } from "./routes/plan.js";
import { sweep } from "./rooms.js";
import { initAuthDb, authRoutes, requireAuth, hookSecret } from "./auth.js";
import { googleAuthRoutes } from "./googleAuth.js";
import { initPush, pushRoutes } from "./push.js";

const app = Fastify({ logger: true });

/**
 * Open signup means strangers run processes on this machine. Per-tenant
 * credentials and per-tenant projects are in place, but a session is still a
 * plain process under the server's own unix user, and two things follow from
 * that which no amount of application-level scoping fixes:
 *
 *   1. The filesystem. An agent can read the operator's home — including
 *      agora's own database, its env file and its secrets. bwrap can close this
 *      (verified working unprivileged on the reference box: a tmpfs over /home
 *      with the tenant's workspace bound back makes the rest of the home
 *      disappear), but it is not wired in yet.
 *   2. The network. Sharing the network namespace leaves every loopback service
 *      reachable — on the reference box that included Caddy's admin API on
 *      :2019, unauthenticated, which is enough to rewrite the machine's routing.
 *      Unsharing it instead cuts the agent off from agora's own hook endpoint,
 *      so this needs a unix socket, not a flag.
 *
 * There is also the shared hook secret: one value, readable by anything running
 * as the user, so a sandboxed agent handed that file could act as any session.
 * Per-session tokens are the fix.
 *
 * So this refuses to boot rather than warn. A warning in a log is exactly what
 * gets missed, and the failure mode here is a stranger reading the operator's
 * credentials. AGORA_SANDBOX=none is the deliberate override, for a trusted
 * group where "strangers" are colleagues.
 */
function assertSignupIsSafe() {
  if (!openSignup()) return;
  if (process.env.AGORA_SANDBOX) return;
  // stderr and exit, not throw: thrown here it goes through pino and the
  // operator gets the explanation as one JSON-escaped line with \n in it, which
  // is precisely the moment they most need to be able to read it.
  process.stderr.write(
    [
      "",
      "  agora refuses to start.",
      "",
      "  AGORA_OPEN_SIGNUP is on, but sessions are not sandboxed yet.",
      "",
      "  A tenant's agent runs as this server's unix user. It can read the",
      "  operator's home directory — agora's own database, its env file and its",
      "  secrets — and it can reach every service on loopback. Per-tenant",
      "  credentials and per-tenant projects do not change either of those.",
      "",
      "  Set AGORA_SANDBOX=none to accept that and start anyway. That is a",
      "  reasonable choice for a team where the strangers are colleagues, and",
      "  not one for a public URL.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

async function main() {
  assertSignupIsSafe();
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
  await app.register(tenantRoutes);
  await app.register(planRoutes);

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

  // Release the compute of rooms whose clock has run out. Nothing is deleted —
  // see rooms.ts. Every minute is plenty: the latch makes it idempotent, so a
  // missed tick costs a minute of runtime, never a double release.
  setInterval(() => {
    sweep().catch((err) => app.log.error({ err }, "room sweep failed"));
  }, 60_000).unref();

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
