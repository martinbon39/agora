import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  allowedEmail,
  expectedOrigin,
  invites,
  issueSessionFor,
  ownerDisplayName,
  openSignup,
  requestOrigin,
} from "./auth.js";
import { env } from "./config.js";

/**
 * "Sign in with Google". Three ways in, checked in this order:
 *   - AGORA_ALLOWED_EMAIL      the self-hoster
 *   - an active invite         a guest, inside one project of somebody else's
 *   - AGORA_OPEN_SIGNUP        anyone verified, as a tenant of their own
 * Everyone else bounces to /#denied.
 *
 * Config: AGORA_GOOGLE_CLIENT_ID, AGORA_GOOGLE_CLIENT_SECRET, and either
 * AGORA_ALLOWED_EMAIL or AGORA_OPEN_SIGNUP. The id_token is validated
 * server-side through Google's tokeninfo endpoint (signature + expiry checked
 * by Google).
 */

const clientId = () => env("GOOGLE_CLIENT_ID") ?? "";
const clientSecret = () => env("GOOGLE_CLIENT_SECRET") ?? "";

// An install running open signup has no single owner address, so requiring one
// here would hide the only way in.
export const googleConfigured = () =>
  !!(clientId() && clientSecret() && (allowedEmail() || openSignup()));

// Per-request: the callback must return to the domain the user browsed in on
// (both are registered in the Google OAuth client).
const redirectUri = (req: FastifyRequest) => `${requestOrigin(req)}/api/auth/google/callback`;

export async function googleAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/google", async (req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: "google auth not configured" });
    const state = crypto.randomBytes(16).toString("base64url");
    reply.setCookie("agora_oauth_state", state, {
      path: "/api/auth/google",
      httpOnly: true,
      sameSite: "lax",
      secure: expectedOrigin().startsWith("https"),
      maxAge: 600,
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", redirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/api/auth/google/callback",
    async (req, reply) => {
      if (!googleConfigured()) return reply.code(503).send({ error: "google auth not configured" });
      const { code, state } = req.query;
      const cookieState = req.cookies?.agora_oauth_state;
      if (!code || !state || !cookieState || state !== cookieState) {
        return reply.code(400).send({ error: "invalid oauth state" });
      }
      reply.clearCookie("agora_oauth_state", { path: "/api/auth/google" });

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId(),
          client_secret: clientSecret(),
          redirect_uri: redirectUri(req),
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        return reply.code(502).send({ error: `token exchange failed: ${await tokenRes.text()}` });
      }
      const { id_token } = (await tokenRes.json()) as { id_token?: string };
      if (!id_token) return reply.code(502).send({ error: "no id_token" });

      // Google validates signature/expiry; we validate audience + email
      const infoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`
      );
      if (!infoRes.ok) return reply.code(403).send({ error: "id_token rejected" });
      const info = (await infoRes.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string;
        name?: string;
      };
      const email = (info.email ?? "").toLowerCase();
      if (info.aud !== clientId() || info.email_verified !== "true" || !email) {
        return reply.code(403).send({ error: "google account not allowed" });
      }
      const displayName = (info.name ?? "").trim() || email.split("@")[0];
      if (email === allowedEmail()) {
        issueSessionFor(reply, { email, name: ownerDisplayName(), role: "owner" });
      } else if (invites.isActive(email)) {
        // an invite is a pass into somebody else's project, not an account
        issueSessionFor(reply, { email, name: displayName, role: "guest" });
      } else if (openSignup()) {
        // Open signup: a verified Google account becomes a tenant of its own,
        // with its own workspace and nothing else. This is only safe because
        // authorization stopped keying off the role — under argos's rule, every
        // account created here would have been an owner of the whole box.
        issueSessionFor(reply, { email, name: displayName, role: "owner" });
      } else {
        // known Google account, no invite, signup closed: land on the SPA's
        // "not invited" screen instead of raw JSON — this URL is what a friend
        // will see
        return reply.redirect("/#denied");
      }
      reply.redirect("/");
    }
  );
}
