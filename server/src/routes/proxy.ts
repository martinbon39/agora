import type { FastifyInstance } from "fastify";

/** Reverse proxy to localhost ports ON THE VPS, so browser canvas nodes can
 *  show dev servers agents start here (`localhost:5173` in the address bar →
 *  /proxy/5173/ → 127.0.0.1:5173). Auth-gated in requireAuth like /api.
 *
 *  Frame-blocking headers are stripped so the target renders in the iframe.
 *  Cookies are dropped in BOTH directions: the argos session cookie must not
 *  leak into arbitrary local apps, and their Set-Cookie must not clobber ours.
 *  Absolute asset paths (/assets/x.js) are caught by the not-found handler in
 *  index.ts via the Referer and redirected back under /proxy/<port>/. */

const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "accept-encoding", // fetch decompresses; forwarding this would double-encode
  "cookie",
  "content-length",
]);

const SKIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "set-cookie",
]);

export async function proxyRoutes(app: FastifyInstance) {
  // encapsulated: the raw-buffer body parser must not affect /api JSON routes
  await app.register(async (sub) => {
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) =>
      done(null, body)
    );

    sub.all("/proxy/:port", async (req, reply) => {
      const { port } = req.params as { port: string };
      return reply.redirect(`/proxy/${port}/`);
    });

    sub.all("/proxy/:port/*", async (req, reply) => {
      const params = req.params as { port: string; "*": string };
      const port = Number(params.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return reply.code(400).send({ error: "bad port" });
      }
      const rawUrl = req.raw.url ?? "";
      const search = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
      const target = `http://127.0.0.1:${port}/${params["*"] ?? ""}${search}`;

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && !SKIP_REQUEST_HEADERS.has(k.toLowerCase())) {
          headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
      }
      headers.host = `127.0.0.1:${port}`;

      let res: Response;
      try {
        res = await fetch(target, {
          method: req.method,
          headers,
          body:
            req.method === "GET" || req.method === "HEAD" || req.body == null
              ? undefined
              : new Uint8Array(req.body as Buffer),
          redirect: "manual",
        });
      } catch {
        return reply
          .code(502)
          .type("text/html")
          .send(
            `<body style="font-family:system-ui;background:#131110;color:#a8a49c;display:grid;place-items:center;height:100vh;margin:0"><p>Nothing listening on <b style="color:#ded9ce">127.0.0.1:${port}</b> (VPS)</p></body>`
          );
      }

      reply.code(res.status);
      for (const [k, v] of res.headers) {
        if (!SKIP_RESPONSE_HEADERS.has(k)) reply.header(k, v);
      }
      // keep redirects inside the proxy namespace (relative AND absolute-to-self)
      const loc = res.headers.get("location");
      if (loc) {
        const abs = new RegExp(`^https?://(?:127\\.0\\.0\\.1|localhost):${port}(/.*)?$`, "i").exec(
          loc
        );
        if (abs) reply.header("location", `/proxy/${port}${abs[1] ?? "/"}`);
        else if (loc.startsWith("/") && !loc.startsWith("/proxy/")) {
          reply.header("location", `/proxy/${port}${loc}`);
        }
      }
      return reply.send(Buffer.from(await res.arrayBuffer()));
    });
  });
}
