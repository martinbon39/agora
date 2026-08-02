import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { allowedEmail, invites, requestOrigin } from "../auth.js";
import { config } from "../config.js";
import { withinRoot } from "../paths.js";
import { closeUserSockets } from "../events.js";

/** Guest allowlist management — owner only (requireAuth also blocks the
 *  prefix for guests; the handler check is defense in depth). */
function ownerOnly(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.authUser?.role === "owner") return true;
  reply.code(403).send({ error: "owner only" });
  return false;
}

/** Built from the origin the owner is actually browsing, not AGORA_ORIGIN: on
 *  an install answering on several hostnames, a link pinned to the canonical
 *  one lands the guest somewhere the owner never sees.
 *
 *  The token goes in the FRAGMENT, which browsers never send to a server — so
 *  it stays out of the request log, out of a reverse proxy's access log and out
 *  of the next Referer. The SPA reads it back and posts it. Enrolment links are
 *  built the same way, for the same reason. */
const inviteLink = (req: FastifyRequest, token: string) =>
  `${requestOrigin(req)}/#/join/${token}`;

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
      // Scope: a real project directory. An invite MUST name one.
      //
      // A null scope was offered as "the whole cockpit" and granted nothing at
      // all: scopeAllows ends in `invite.project === target`, and null equals no
      // path, so such a guest saw an empty project list and was refused
      // everywhere. The option was in the UI and in the README, and it produced
      // an account that could do nothing — which reads as agora being broken
      // rather than as a scope that was never implemented.
      //
      // It is refused rather than implemented because "every project" has no
      // safe meaning here. Authority deliberately moved off `role` and onto the
      // projects table to close a cross-tenant hole (see scopeAllows); a guest
      // who matched every project would reopen exactly it, seeing the projects
      // of owners who never invited them. Deciding whose projects a blanket
      // invite covers is a product call, not a patch.
      if (typeof req.body?.project !== "string" || !req.body.project) {
        return reply.code(400).send({ error: "an invite must name a project" });
      }
      const project = path.resolve(req.body.project);
      if (!withinRoot(config.projectsDir, project) || !fs.existsSync(project)) {
        return reply.code(400).send({ error: "unknown project" });
      }
      const before = invites.get(email);
      invites.add(email, project);
      // scope changed for someone already connected: cut their sockets so the
      // client reconnects and the server re-derives what they may see
      if (before && before.project !== project) closeUserSockets(email);
      // The link is returned once, here. Storing only its hash means this is
      // the single moment it can be read, so the owner gets it with the
      // response that created it rather than having to go looking.
      // Mint before listing: the list reports whether a link exists, and
      // evaluating it first would describe the invite as it was a line ago.
      const link = inviteLink(req, invites.mintToken(email));
      return { ok: true, invites: invites.list(), link };
    }
  );

  /** Rotate the link — the old one stops working immediately. */
  app.post<{ Params: { email: string } }>("/api/invites/:email/link", async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    let link: string;
    try {
      link = inviteLink(req, invites.mintToken(email));
    } catch {
      return reply.code(404).send({ error: "no active invite for that address" });
    }
    return { ok: true, invites: invites.list(), link };
  });

  app.delete<{ Params: { email: string } }>("/api/invites/:email", async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    invites.revoke(email); // marks revoked + deletes their cookie sessions
    closeUserSockets(email); // cuts live dashboards AND attached terminals
    return { ok: true, invites: invites.list() };
  });
}
