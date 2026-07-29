import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { allowedEmail, invites } from "../auth.js";
import { config } from "../config.js";
import { closeUserSockets } from "../events.js";

/** Guest allowlist management — owner only (requireAuth also blocks the
 *  prefix for guests; the handler check is defense in depth). */
function ownerOnly(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.authUser?.role === "owner") return true;
  reply.code(403).send({ error: "owner only" });
  return false;
}

export async function inviteRoutes(app: FastifyInstance) {
  app.get("/api/invites", async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    return { invites: invites.list() };
  });

  app.post<{ Body: { email?: string; project?: string | null } }>(
    "/api/invites",
    async (req, reply) => {
      if (!ownerOnly(req, reply)) return;
      const email = (req.body?.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: "invalid email" });
      }
      if (email === allowedEmail()) {
        return reply.code(400).send({ error: "that address is already the owner" });
      }
      // scope: a real project directory, or null = whole cockpit
      let project: string | null = null;
      if (typeof req.body?.project === "string" && req.body.project) {
        const p = path.resolve(req.body.project);
        const root = path.resolve(config.projectsDir);
        if (!p.startsWith(root + path.sep) || !fs.existsSync(p)) {
          return reply.code(400).send({ error: "unknown project" });
        }
        project = p;
      }
      const before = invites.get(email);
      invites.add(email, project);
      // scope changed for someone already connected: cut their sockets so the
      // client reconnects and the server re-derives what they may see
      if (before && before.project !== project) closeUserSockets(email);
      return { ok: true, invites: invites.list() };
    }
  );

  app.delete<{ Params: { email: string } }>("/api/invites/:email", async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    invites.revoke(email); // marks revoked + deletes their cookie sessions
    closeUserSockets(email); // cuts live dashboards AND attached terminals
    return { ok: true, invites: invites.list() };
  });
}
