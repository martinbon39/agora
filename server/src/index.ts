import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { config, openSignup, socketDir, socketPath } from "./config.js";
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
import { spectateRoutes } from "./routes/spectate.js";
import { reelRoutes } from "./routes/reel.js";
import { sweep } from "./rooms.js";
import { initAuthDb, authRoutes, requireAuth, hookSecret, gatePath } from "./auth.js";
import { googleAuthRoutes } from "./googleAuth.js";
import { initPush, pushRoutes } from "./push.js";

const app = Fastify({ logger: true });

/**
 * Open signup means strangers run processes on this machine, so the operator has
 * to say which isolation they are accepting. AGORA_SANDBOX is that statement:
 *
 *   bwrap  the filesystem is isolated. A tmpfs over the home removes agora's
 *          database, its env file, the global hook secret and every other
 *          tenant's credentials. The NETWORK is still shared — a session reaches
 *          every service on loopback, which on a typical box includes a reverse
 *          proxy's unauthenticated admin API. Better, not finished.
 *   none   no isolation at all. Reasonable for a team where the strangers are
 *          colleagues; not for a public URL.
 *
 * Unset, it refuses to boot rather than warning. A warning in a log is exactly
 * what gets missed, and the failure mode is a stranger reading the operator's
 * credentials.
 */
function assertSignupIsSafe() {
  if (!openSignup()) return;
  const mode = process.env.AGORA_SANDBOX;
  if (mode === "bwrap") {
    // Loud, because "sandboxed" reads as finished and this one is not.
    app.log.warn(
      "AGORA_SANDBOX=bwrap: sessions are filesystem-isolated, but the network " +
        "namespace is shared — a session can still reach every service on loopback."
    );
    return;
  }
  if (mode) return; // an explicit choice, including "none"
  // stderr and exit, not throw: thrown here it goes through pino and the
  // operator gets the explanation as one JSON-escaped line with \n in it, which
  // is precisely the moment they most need to be able to read it.
  process.stderr.write(
    [
      "",
      "  agora refuses to start.",
      "",
      "  AGORA_OPEN_SIGNUP is on, but AGORA_SANDBOX says nothing about how",
      "  sessions are isolated. Pick one:",
      "",
      "    AGORA_SANDBOX=bwrap   isolate the filesystem. A session can no longer",
      "                          read this account's home — agora's database, env",
      "                          file, hook secret, other tenants' credentials.",
      "                          The network is still shared: a session can reach",
      "                          every service on loopback. Better, not finished.",
      "",
      "    AGORA_SANDBOX=none    no isolation. A session runs as this unix user",
      "                          and can read everything it can. Reasonable for a",
      "                          team where the strangers are colleagues, and not",
      "                          for a public URL.",
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
    // Rate limit the authentication endpoints and nothing else (allowList is
    // the EXEMPT list, so this reads inverted).
    //
    // gatePath, not req.raw.url: the router percent-decodes before matching, so
    // `/%61pi/auth/invite` reached the handler while a prefix test on the raw
    // target saw no match and exempted it — 45 of 45 attempts unthrottled,
    // measured. Every login endpoint, and invite redemption with it, was
    // reachable at full speed by anyone who encoded one letter. This is the
    // same decoding gap the auth gate itself was fixed for; sharing gatePath is
    // what stops the two from drifting apart again.
    allowList: (req) => !gatePath(req).startsWith("/api/auth/"),
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
  await app.register(spectateRoutes);
  await app.register(reelRoutes);

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

  // A second door on a unix socket, for the agents' own traffic.
  //
  // Two reasons, one of which pays off today. Today: loopback TCP is reachable
  // by every process on the box, so `agora chat` competing for :4570 shares a
  // channel with anything else running here — a socket with 0600 on it does not.
  // Later: it is the prerequisite for sandboxing sessions. bwrap can only cut a
  // session off from the network with --unshare-net, and that also cuts it off
  // from agora itself unless the way back in is a filesystem object the sandbox
  // can be handed deliberately.
  //
  // Fastify listens once, so this is a second http.Server re-emitting onto the
  // first. `request` only: the hook API is plain HTTP, and the websocket
  // endpoints are the dashboard's, which arrives over TCP.
  const sockPath = socketPath();
  // A unix socket path is a fixed-size field in the kernel — sun_path, 108
  // bytes on Linux including the terminator. Past that, bind() takes a
  // TRUNCATED path and reports success: listen() fires its callback, no socket
  // exists where agora believes one does, and the chmod below dies with a bare
  // ENOENT naming a path that looks perfectly fine. The server then exits at
  // boot having explained nothing. Two deep data dirs sharing a 107-byte prefix
  // collide with EADDRINUSE instead, which reads as "already running".
  //
  // Refuse first, and say which setting to change. The 0600 below is the only
  // guard on a credential-free door, and it cannot be applied to a file whose
  // real name we no longer know.
  if (Buffer.byteLength(sockPath) > 107) {
    process.stderr.write(
      [
        "",
        "  agora refuses to start.",
        "",
        `  Its unix socket path is ${Buffer.byteLength(sockPath)} bytes:`,
        `    ${sockPath}`,
        "",
        "  The kernel allows 107. Past that the path is silently truncated and",
        "  the socket ends up somewhere nobody is listening.",
        "",
        "  Point AGORA_DATA_DIR at a shorter path, or set AGORA_SOCKET directly",
        "  to somewhere short (e.g. /run/agora.sock).",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
  // 0700 on the directory: a sandboxed session is handed this directory, so it
  // must contain the socket and nothing else
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
  // a stale socket from a killed process would make bind fail with EADDRINUSE
  try {
    fs.unlinkSync(sockPath);
  } catch {}
  const local = http.createServer((req, res) => app.server.emit("request", req, res));
  await new Promise<void>((resolve, reject) => {
    local.once("error", reject);
    local.listen(sockPath, () => resolve());
  });
  // 0600 before anyone can connect: the socket is the credential-free path in,
  // so its permissions are the only thing standing on it
  fs.chmodSync(sockPath, 0o600);
  app.log.info({ sockPath }, "listening on unix socket");
  // Registering a signal handler REPLACES the default terminate action, so a
  // handler that only cleans up leaves the process alive and unkillable by
  // SIGTERM. That shipped: `kill` stopped working, a deploy could not restart,
  // and every gate that SIGTERMs its own server leaked a node process. Clean up,
  // then exit — and do it once, since a second signal must not re-enter.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      local.close();
    } catch {}
    try {
      fs.unlinkSync(sockPath);
    } catch {}
    app.log.info({ signal }, "shutting down");
    // 128 + signal number is the conventional exit status for "killed by signal"
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
