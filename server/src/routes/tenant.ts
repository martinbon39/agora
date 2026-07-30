import type { FastifyInstance } from "fastify";
import { openSignup } from "../config.js";
import {
  hasClaudeCredentials,
  setTenantApiKey,
  tenantApiKey,
  tenantClaudeDir,
} from "../tenants.js";

/**
 * A tenant connects their own Anthropic account here.
 *
 * The subject is always the caller's own email, taken from the session cookie —
 * never a parameter. An endpoint that accepted "whose key" would be an endpoint
 * for writing somebody else's, and there is no legitimate reason for one tenant
 * to touch another's billing.
 */
export async function tenantRoutes(app: FastifyInstance) {
  app.get("/api/tenant/claude", async (req, reply) => {
    const me = req.authUser;
    if (!me) return reply.code(401).send({ error: "not signed in" });
    return {
      // never the value: this endpoint answers "is it set", nothing more
      hasKey: !!tenantApiKey(me.email),
      connected: hasClaudeCredentials(me.email),
      configDir: tenantClaudeDir(me.email),
      required: openSignup(),
    };
  });

  app.put<{ Body: { key?: string } }>("/api/tenant/claude", async (req, reply) => {
    const me = req.authUser;
    if (!me) return reply.code(401).send({ error: "not signed in" });
    // a guest is a visitor in someone else's project and has no billing of
    // their own to connect — the agents there run as that project's owner
    if (me.role === "guest") {
      return reply.code(403).send({ error: "guests do not have their own credentials" });
    }
    const key = (req.body?.key ?? "").trim();
    if (!key) return reply.code(400).send({ error: "key required" });
    // shape check only — whether it works is Anthropic's answer to give, and a
    // strict format would age badly
    if (!/^sk-[A-Za-z0-9._-]{20,}$/.test(key)) {
      return reply.code(400).send({ error: "that does not look like an Anthropic API key" });
    }
    setTenantApiKey(me.email, key);
    return { ok: true, connected: hasClaudeCredentials(me.email) };
  });

  app.delete("/api/tenant/claude", async (req, reply) => {
    const me = req.authUser;
    if (!me) return reply.code(401).send({ error: "not signed in" });
    if (me.role === "guest") {
      return reply.code(403).send({ error: "guests do not have their own credentials" });
    }
    setTenantApiKey(me.email, null);
    return { ok: true, connected: hasClaudeCredentials(me.email) };
  });
}
