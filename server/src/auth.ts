import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import Database from "better-sqlite3";
import { config, env } from "./config.js";
import { projects, sessions, users, type SessionRow } from "./db.js";

const SESSION_COOKIE = "agora_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const ENROLL_TTL_MS = 15 * 60 * 1000;

// ---- identity ------------------------------------------------------------
// agora historically had exactly one human (anonymous "the owner is in"
// sessions). Multiplayer attaches an identity to each session: the owner
// (passkey or AGORA_ALLOWED_EMAIL via Google) or an invited guest (Google
// account on the invites allowlist).

export type AuthRole = "owner" | "guest";
export interface AuthUser {
  email: string;
  name: string;
  role: AuthRole;
  color: string;
  /** Project path this user is confined to; null = the whole cockpit.
   *  Owners are always null; guests inherit it live from their invite. */
  project: string | null;
}

/** May this user touch that project's resources?
 *
 *  The single door. Twenty-six call sites across eight route files consult this
 *  and nothing else, which is why tenancy could be introduced by changing the
 *  answer rather than by editing twenty-six places.
 *
 *  What changed from argos: `role === "owner"` used to short-circuit to true,
 *  meaning the owner could reach every project on the box. That is correct for
 *  a cockpit with one human and it is precisely the cross-tenant hole here, so
 *  the role no longer carries any authority over projects. It now only
 *  distinguishes a full account (may create projects, has a workspace) from a
 *  guest (invited into somebody else's project, may not create).
 *
 *  Authority moved to the projects table. A directory nobody registered belongs
 *  to nobody and is refused — the lesson this repo already learned twice: the
 *  path is a string the client sent, only the row says who owns it. */
export function scopeAllows(user: AuthUser | undefined, project: string): boolean {
  if (!user || !project) return false;
  const target = path.resolve(project);
  const row = projects.get(target);
  if (!row) return false;
  if (row.owner_email === user.email.toLowerCase()) return true;
  // a guest reaches exactly the one project their live invite names
  const invite = invites.get(user.email);
  return !!invite && invite.revoked_at == null && invite.project === target;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export const allowedEmail = () => (env("ALLOWED_EMAIL") ?? "").toLowerCase();

export function ownerDisplayName(): string {
  const explicit = env("OWNER_NAME");
  if (explicit) return explicit;
  const local = allowedEmail().split("@")[0];
  return local || "owner";
}

/** Cursor/badge colors — bright enough to read on the dark canvas. */
const USER_COLORS = [
  "#fbbf24", "#38bdf8", "#a78bfa", "#34d399",
  "#fb7185", "#f472b6", "#4ade80", "#fb923c",
];
export function colorForEmail(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

/** Origin agora is served from, e.g. https://agora.example.com */
export function expectedOrigin(): string {
  return env("ORIGIN") ?? `http://localhost:${config.port}`;
}

/** Every origin agora answers on: AGORA_ORIGIN plus AGORA_EXTRA_ORIGINS (comma-separated). */
export function allowedOrigins(): string[] {
  const extra = (env("EXTRA_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [expectedOrigin(), ...extra];
}

/** The origin the request actually came through, if it's one of ours —
 *  so OAuth redirects land back on the domain the user is browsing. */
export function requestOrigin(req: FastifyRequest): string {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const candidate = `${proto}://${req.headers.host ?? ""}`;
  return allowedOrigins().includes(candidate) ? candidate : expectedOrigin();
}
function rpID(): string {
  return new URL(expectedOrigin()).hostname;
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

let db: Database.Database;
// WebAuthn challenges are short-lived and single-process: keep them in memory.
const challenges = new Map<string, { challenge: string; expires: number }>();

function putChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}
function takeChallenge(key: string): string | null {
  const c = challenges.get(key);
  challenges.delete(key);
  return c && c.expires > Date.now() ? c.challenge : null;
}

export function initAuthDb(database: Database.Database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enroll_tokens (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      email TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
  `);
  // pre-multiplayer sessions have no identity columns; NULL email = owner
  for (const ddl of [
    `ALTER TABLE auth_sessions ADD COLUMN email TEXT`,
    `ALTER TABLE auth_sessions ADD COLUMN name TEXT`,
    `ALTER TABLE auth_sessions ADD COLUMN role TEXT`,
    `ALTER TABLE invites ADD COLUMN project TEXT`,
    // sha256 of the invite link's token. Invites predating links have NULL and
    // keep working through Google — the owner mints a link when they want one.
    `ALTER TABLE invites ADD COLUMN token_hash TEXT`,
  ]) {
    try {
      db.exec(ddl);
    } catch {
      // column already exists
    }
  }
}

/** Guest allowlist. Revoking keeps the row (audit + easy re-invite) but kills
 *  every session of that email; live sockets are closed by the route. */
export const invites = {
  list(): {
    email: string;
    created_at: number;
    revoked_at: number | null;
    project: string | null;
    hasLink: boolean;
  }[] {
    return (
      db
        .prepare(
          `SELECT email, created_at, revoked_at, project, token_hash FROM invites ORDER BY created_at DESC`
        )
        .all() as {
        email: string;
        created_at: number;
        revoked_at: number | null;
        project: string | null;
        token_hash: string | null;
      }[]
    ).map(({ token_hash, ...rest }) => ({ ...rest, hasLink: !!token_hash }));
  },
  get(email: string): { revoked_at: number | null; project: string | null } | undefined {
    return db.prepare(`SELECT revoked_at, project FROM invites WHERE email = ?`).get(email.toLowerCase()) as
      | { revoked_at: number | null; project: string | null }
      | undefined;
  },
  isActive(email: string): boolean {
    const row = this.get(email);
    return !!row && row.revoked_at == null;
  },
  add(email: string, project: string | null = null) {
    db.prepare(
      `INSERT INTO invites (email, created_at, revoked_at, project) VALUES (?, ?, NULL, ?)
       ON CONFLICT(email) DO UPDATE SET revoked_at = NULL, project = excluded.project`
    ).run(email.toLowerCase(), Date.now(), project);
  },
  revoke(email: string) {
    const e = email.toLowerCase();
    // Drop the token with the same statement that revokes. A link is a bearer
    // credential: leaving a usable one behind a revoked invite is the whole
    // risk of having links at all, and a second UPDATE is a second thing to
    // forget.
    db.prepare(`UPDATE invites SET revoked_at = ?, token_hash = NULL WHERE email = ?`).run(
      Date.now(),
      e
    );
    db.prepare(`DELETE FROM auth_sessions WHERE email = ?`).run(e);
  },

  /**
   * Mint (or replace) this invite's link token and return it in the clear —
   * the only time it is ever readable. Only the hash is stored, so a leaked
   * database does not hand out working invitations, and re-minting is how the
   * owner rotates a link they sent to the wrong place.
   */
  mintToken(email: string): string {
    const token = crypto.randomBytes(24).toString("base64url");
    const changed = db
      .prepare(`UPDATE invites SET token_hash = ? WHERE email = ? AND revoked_at IS NULL`)
      .run(sha256(token), email.toLowerCase()).changes;
    if (!changed) throw new Error("no active invite for that address");
    return token;
  },

  /** The live invite a link token belongs to, if it is still good.
   *
   *  The type says string; the caller's is parsed from an unauthenticated JSON
   *  body, so it can be an object, a number or null. createHash().update()
   *  throws on those, and the throw surfaced as a 500 — an error page handed to
   *  anyone who posts `{"token":{}}`. This is the boundary, so it checks here. */
  byToken(token: string): { email: string; project: string | null } | undefined {
    if (typeof token !== "string" || !token) return undefined;
    return db
      .prepare(
        `SELECT email, project FROM invites WHERE token_hash = ? AND revoked_at IS NULL`
      )
      .get(sha256(token)) as { email: string; project: string | null } | undefined;
  },
}

/** Called by the CLI (on the server, over the filesystem — never via HTTP). */
export function createEnrollToken(database: Database.Database): string {
  const token = crypto.randomBytes(24).toString("base64url");
  database
    .prepare(`INSERT INTO enroll_tokens (token_hash, expires_at) VALUES (?, ?)`)
    .run(sha256(token), Date.now() + ENROLL_TTL_MS);
  return token;
}

function consumeEnrollToken(token: string): boolean {
  const row = db
    .prepare(`SELECT expires_at FROM enroll_tokens WHERE token_hash = ?`)
    .get(sha256(token)) as { expires_at: number } | undefined;
  if (!row) return false;
  db.prepare(`DELETE FROM enroll_tokens WHERE token_hash = ?`).run(sha256(token));
  return row.expires_at > Date.now();
}

function credentialCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM credentials`).get() as { n: number }).n;
}

/** Session cookie -> identity. NULL email (pre-multiplayer rows, passkey
 *  logins) means the owner. Also does the sliding renewal. */
export function getAuthUser(req: FastifyRequest): AuthUser | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(`SELECT expires_at, email, name, role FROM auth_sessions WHERE token_hash = ?`)
    .get(sha256(token)) as
    | { expires_at: number; email: string | null; name: string | null; role: string | null }
    | undefined;
  if (!row || row.expires_at <= Date.now()) return null;
  // sliding expiration: active users never get logged out
  if (row.expires_at - Date.now() < SESSION_TTL_MS - 24 * 3600 * 1000) {
    db.prepare(`UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?`).run(
      Date.now() + SESSION_TTL_MS,
      sha256(token)
    );
  }
  const role: AuthRole = row.role === "guest" ? "guest" : "owner";
  const email = row.email ?? allowedEmail();
  const name = row.name ?? (role === "owner" ? ownerDisplayName() : email.split("@")[0] || "guest");
  let project: string | null = null;
  if (role === "guest") {
    // scope is read LIVE from the invite: re-scoping or revoking applies to
    // existing sessions instantly, not at next login
    const invite = invites.get(email);
    if (!invite || invite.revoked_at != null) return null;
    project = invite.project;
  }
  return { email, name, role, color: colorForEmail(email || name), project };
}

function isAuthed(req: FastifyRequest): boolean {
  return getAuthUser(req) !== null;
}

/** Shared with googleAuth.ts. */
export function issueSessionFor(
  reply: FastifyReply,
  identity?: { email: string; name: string; role: AuthRole }
) {
  issueSession(reply, identity);
}

function issueSession(
  reply: FastifyReply,
  identity?: { email: string; name: string; role: AuthRole }
) {
  // Every login path funnels through here, so this is where a tenant comes into
  // existence — first sign-in creates the row, later ones bump last_seen. Doing
  // it in the Google callback instead would have missed the passkey path, and
  // the next auth method after that.
  if (identity?.email) users.seen(identity.email, identity.name);
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, created_at, expires_at, email, name, role) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    sha256(token),
    Date.now(),
    Date.now() + SESSION_TTL_MS,
    identity?.email ?? null,
    identity?.name ?? null,
    identity?.role ?? null
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: expectedOrigin().startsWith("https"),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * Global gate. Public: auth endpoints and the SPA's static assets (the login
 * screen itself). Everything else — /api and /ws — needs a session cookie.
 * Claude Code hooks POST with a secret header instead of a cookie; the secret
 * persists on disk so hook settings survive agora restarts.
 */
let hookSecretCache: string | null = null;
export function hookSecret(): string {
  if (hookSecretCache) return hookSecretCache;
  const file = path.join(config.dataDir, "hook-secret");
  try {
    hookSecretCache = fs.readFileSync(file, "utf8").trim();
  } catch {
    hookSecretCache = crypto.randomBytes(24).toString("base64url");
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, hookSecretCache, { mode: 0o600 });
  }
  return hookSecretCache;
}

/** The path every prefix test below must run on.
 *
 *  NOT `req.raw.url`: that is the raw request target, while the router
 *  percent-decodes before matching. `/%61pi/sessions` therefore reached the
 *  /api route with `startsWith("/api/")` false — the gate opened for every
 *  protected prefix at once. Prefer the pattern the router actually matched,
 *  which no encoding can disguise, and fall back to a decoded path when
 *  nothing matched (undecodable input counts as protected). */
function gatePath(req: FastifyRequest): string {
  const matched = req.routeOptions?.url;
  if (matched) return matched;
  const raw = (req.raw.url ?? "/").split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function requireAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const url = gatePath(req);
    const isProtected =
      url.startsWith("/api/") ||
      url.startsWith("/ws/") ||
      url.startsWith("/artifacts") ||
      url.startsWith("/uploads") ||
      url.startsWith("/proxy/");
    if (!isProtected) return; // SPA assets: public, they contain no secrets
    if (url.startsWith("/api/auth/")) return;
    if (url === "/api/version") return; // build hash — harmless, needed pre-reload
    // The one endpoint that answers without a session: an opt-in, owner-minted,
    // read-only room view. What it may expose is fixed in routes/spectate.ts —
    // this line only says the cookie is not required. The prefix is exact so
    // /api/spectate itself (mint/read the token) stays behind the wall.
    if (url.startsWith("/api/spectate/")) return;
    if (url.startsWith("/ws/bridge")) return; // token-checked in its own handler
    if (url.startsWith("/api/hooks/") && hookCaller(req)) return;
    // CSRF hardening: content in sandboxed/proxied iframes (opaque origin) and
    // third-party pages report Sec-Fetch-Site: cross-site — they must never
    // reach the API even if the browser attached the session cookie
    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite === "cross-site") {
      reply.code(403).send({ error: "cross-site request refused" });
      return;
    }
    const user = getAuthUser(req);
    if (!user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    req.authUser = user;
    // guests collaborate (canvas, terminals, chat) but never administer:
    // invites (self-escalation), push subs and GitHub tokens are the owner's
    if (user.role === "guest" && GUEST_BLOCKED.some((p) => url.startsWith(p))) {
      reply.code(403).send({ error: "owner only" });
    }
  });
}

// /proxy/<port>/ reaches anything listening on the VPS loopback and carries no
// project of its own, so it cannot be scoped — a guest allowed through it would
// see every other project's dev server (and any local-only admin UI).
const GUEST_BLOCKED = ["/api/invites", "/api/push", "/api/github", "/proxy/"];

export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (req) => {
    const { googleConfigured } = await import("./googleAuth.js");
    const user = getAuthUser(req);
    return {
      authed: user !== null,
      enrolled: credentialCount() > 0,
      google: googleConfigured(),
      user,
    };
  });

  app.post<{ Body: { token?: string } }>("/api/auth/register/options", async (req, reply) => {
    const token = req.body?.token ?? "";
    if (!consumeEnrollToken(token)) {
      return reply.code(403).send({ error: "invalid or expired enrollment token" });
    }
    const options = await generateRegistrationOptions({
      rpName: "agora",
      rpID: rpID(),
      userName: "owner",
      userDisplayName: "agora owner",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    // key the challenge on itself: registration is a two-step dance
    putChallenge(`reg`, options.challenge);
    return options;
  });

  app.post<{ Body: { response: any } }>("/api/auth/register/verify", async (req, reply) => {
    const challenge = takeChallenge("reg");
    if (!challenge) return reply.code(400).send({ error: "no pending registration" });
    try {
      const verification = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpID(),
      });
      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: "verification failed" });
      }
      const { credential } = verification.registrationInfo;
      db.prepare(
        `INSERT INTO credentials (id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        Date.now()
      );
      issueSession(reply);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.post("/api/auth/login/options", async (_req, reply) => {
    if (credentialCount() === 0) {
      return reply.code(403).send({ error: "no passkey enrolled" });
    }
    const options = await generateAuthenticationOptions({
      rpID: rpID(),
      userVerification: "preferred",
    });
    putChallenge("login", options.challenge);
    return options;
  });

  app.post<{ Body: { response: any } }>("/api/auth/login/verify", async (req, reply) => {
    const challenge = takeChallenge("login");
    if (!challenge) return reply.code(400).send({ error: "no pending login" });
    const credId = req.body?.response?.id;
    const row = db
      .prepare(`SELECT * FROM credentials WHERE id = ?`)
      .get(credId) as
      | { id: string; public_key: Buffer; counter: number; transports: string }
      | undefined;
    if (!row) return reply.code(403).send({ error: "unknown credential" });
    try {
      const verification = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpID(),
        credential: {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: row.counter,
          transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[],
        },
      });
      if (!verification.verified) return reply.code(403).send({ error: "verification failed" });
      db.prepare(`UPDATE credentials SET counter = ? WHERE id = ?`).run(
        verification.authenticationInfo.newCounter,
        row.id
      );
      issueSession(reply);
      return { ok: true };
    } catch (err) {
      return reply.code(403).send({ error: String(err) });
    }
  });

  /**
   * Redeem an invite link.
   *
   * Before this, the only way a second human could get in was Google OAuth, so
   * a fresh clone with no OAuth client could not invite anybody at all — the
   * invite list was an allowlist waiting for a sign-in method that did not
   * exist yet. A link needs nothing configured.
   *
   * The token arrives in a POST body, and the link that carries it puts it in a
   * URL FRAGMENT (`/#/join/<token>`), exactly as enrolment already does. A
   * fragment is never sent to a server, so the token stays out of this app's
   * request log — `logger: true` records req.url for every request — out of any
   * reverse proxy's access log, and out of the Referer of whatever the page
   * loads next. A GET route with the token in the path would have written a
   * working credential to disk on every redemption.
   *
   * It is a bearer credential otherwise and is treated as one: only its hash is
   * stored, revoking destroys it, and re-minting rotates it. It stays usable
   * until then rather than burning on first use, because the person you invited
   * opens it on their laptop and then on their phone, and a one-shot link makes
   * that a support request. Sharing the link shares the access — which is the
   * same bargain as any "anyone with the link" URL, and is what the UI says.
   */
  app.post<{ Body: { token?: string } }>("/api/auth/invite", async (req, reply) => {
    const invite = invites.byToken(req.body?.token ?? "");
    if (!invite) return reply.code(403).send({ error: "invalid or revoked invitation" });
    issueSession(reply, {
      email: invite.email,
      name: invite.email.split("@")[0] || "guest",
      role: "guest",
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(sha256(token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}

/** Constant-time string compare, so a wrong secret leaks nothing by timing. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export type HookCaller = { global: true } | { global: false; session: SessionRow };

/**
 * Who is calling the hook channel.
 *
 * Two kinds of bearer. The global secret belongs to the server itself and to the
 * Claude Code hook settings it writes; a per-session token belongs to exactly
 * one session and is handed to it through its environment.
 *
 * This distinction is the point. Before it, the only credential was the global
 * secret in a 0600 file, and every caller named itself with AGORA_SESSION_ID —
 * so any process running as this unix user could post to any project's board
 * under another agent's name, read that agent's neighbours, or spawn children
 * under someone else's parent. Presenting a token now settles identity, and the
 * claimed id is only honoured for the global secret.
 */
export function hookCaller(req: FastifyRequest): HookCaller | null {
  const presented = String(req.headers["x-agora-hook"] ?? "");
  if (!presented) return null;
  if (sameSecret(presented, hookSecret())) return { global: true };
  const session = sessions.byToken(presented);
  return session ? { global: false, session } : null;
}

/**
 * The session a hook request acts AS.
 *
 * A token-bearing caller is pinned to its own session and `claimedId` is
 * ignored — not rejected on mismatch, ignored, because there is no reason for a
 * session to name anything but itself and treating the claim as a request to
 * verify would be one more thing to get wrong.
 */
export function actingSession(
  req: FastifyRequest,
  claimedId?: string | null
): SessionRow | undefined {
  const caller = hookCaller(req);
  if (!caller) return undefined;
  if (!caller.global) return caller.session;
  return claimedId ? sessions.get(claimedId) : undefined;
}
