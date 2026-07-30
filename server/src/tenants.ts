import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, openSignup, sessionsPerTenant } from "./config.js";
import { projects, sessions } from "./db.js";
import { workspaceSlug } from "./paths.js";

/**
 * Which Claude identity a session runs as.
 *
 * This exists because of what argos did when no identity was configured:
 * nothing. spawnSession set CLAUDE_CONFIG_DIR only if the project named an
 * account, and otherwise let the child inherit the server's environment — so
 * `claude` resolved $HOME/.claude, which is the operator's own account, with
 * their credentials, their CLAUDE.md and their skills. On a personal box that
 * is the correct and convenient answer. On a hosted one it means a stranger's
 * agent bills the operator's subscription and reads their files.
 *
 * So inheritance is not a fallback here, it is the bug. In multi-tenant mode the
 * resolver either returns the tenant's own identity or refuses to start the
 * session. There is no third branch.
 */

export class QuotaExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceeded";
  }
}

export class CredentialsRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsRequired";
  }
}

/** Per-tenant state, kept beside agora's own and never inside ~/.claude. */
export function tenantRoot(email: string): string {
  return path.join(config.dataDir, "tenants", workspaceSlug(email));
}

/** CLAUDE_CONFIG_DIR for this tenant. Deliberately NOT a symlink farm into the
 *  operator's ~/.claude the way the two-account feature builds one: a tenant
 *  gets an empty config dir of their own, so `claude` writes its credentials
 *  there and finds nothing of anybody else's. */
export function tenantClaudeDir(email: string): string {
  return path.join(tenantRoot(email), "claude");
}

function apiKeyPath(email: string): string {
  return path.join(tenantRoot(email), "anthropic.key");
}

export function ensureTenantDirs(email: string) {
  fs.mkdirSync(tenantClaudeDir(email), { recursive: true, mode: 0o700 });
}

export function tenantApiKey(email: string): string | null {
  try {
    const v = fs.readFileSync(apiKeyPath(email), "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function setTenantApiKey(email: string, key: string | null) {
  ensureTenantDirs(email);
  const p = apiKeyPath(email);
  if (!key) {
    fs.rmSync(p, { force: true });
    return;
  }
  // 0600, and written to disk rather than into sqlite: the DB is what gets
  // copied around for backups and debugging, a key should not ride along
  fs.writeFileSync(p, `${key.trim()}\n`, { mode: 0o600 });
}

/** Has this tenant given us a way to talk to Anthropic as themselves? Either an
 *  API key, or an interactive `/login` whose credentials landed in their config
 *  dir. */
export function hasClaudeCredentials(email: string): boolean {
  if (tenantApiKey(email)) return true;
  return fs.existsSync(path.join(tenantClaudeDir(email), ".credentials.json"));
}

/** Who owns the project a session is starting in. */
export function tenantOf(projectPath: string): string | null {
  return projects.get(path.resolve(projectPath))?.owner_email ?? null;
}

/**
 * The environment a session gets, so that it runs as its tenant and not as the
 * server. Throws CredentialsRequired rather than quietly falling back — a
 * session that starts with the wrong identity spends someone else's money, and
 * that failure is invisible from the UI.
 *
 * Returns an empty environment when multi-tenant mode is off: a self-hosted
 * install has one human whose credentials are the right ones, and the existing
 * per-project account feature still decides there.
 */
export function claudeEnvFor(projectPath: string, harness: string): Record<string, string> {
  if (!openSignup()) return {};
  // codex/gemini/opencode carry their own credentials and are not covered yet;
  // refusing them outright is the honest position until they are.
  if (harness !== "claude") {
    throw new CredentialsRequired(
      `harness '${harness}' has no per-tenant credentials yet — only 'claude' is supported on a shared install`
    );
  }
  const owner = tenantOf(projectPath);
  if (!owner) {
    throw new CredentialsRequired(
      "this project has no owner on record, so there is no identity to run as"
    );
  }
  if (!hasClaudeCredentials(owner)) {
    throw new CredentialsRequired(
      "connect your Anthropic account before starting an agent — add an API key in settings, or run `/login` inside a shell session first"
    );
  }
  ensureTenantDirs(owner);
  const env: Record<string, string> = { CLAUDE_CONFIG_DIR: tenantClaudeDir(owner) };
  const key = tenantApiKey(owner);
  if (key) env.ANTHROPIC_API_KEY = key;
  return env;
}

/**
 * Where a session's Claude config — and therefore its transcript — actually
 * lives.
 *
 * Upstream's transcript reader used `process.env.CLAUDE_CONFIG_DIR`, which is
 * the SERVER's environment, not the session's. That was right when every session
 * inherited the server's identity; now each one runs with its own
 * CLAUDE_CONFIG_DIR, so reading the server's env means looking in the wrong
 * directory and reporting "no transcript" for a session that has one. Resolve it
 * the same way the spawn does, in the same order.
 */
export function claudeConfigDirOf(projectPath: string, accountConfigDir: string | null): string {
  if (openSignup()) {
    const owner = tenantOf(projectPath);
    if (owner) return tenantClaudeDir(owner);
  }
  if (accountConfigDir) return accountConfigDir;
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/**
 * Refuse to start a session when its tenant already holds their allowance.
 *
 * /api/hooks/spawn pins the PARENT to the caller's token, so no one can plant a
 * sub-agent in someone else's project — but nothing limited the NUMBER, and the
 * rate limiter exempts every path outside /api/auth/ (measured: 40 spawns, no
 * 429). One loop takes the machine down for every other tenant, which makes this
 * the first thing that breaks on a shared box, well before anything adversarial.
 *
 * Counted across ALL of the tenant's projects, not per project: the constraint is
 * RAM on one machine, and a tenant with five projects has the same eight-session
 * ceiling as a tenant with one.
 *
 * Only in multi-tenant mode. A personal install runs as many agents as its owner
 * wants — capping their own cockpit to protect them from themselves is not this
 * feature's job.
 */
export function assertSessionQuota(projectPath: string) {
  if (!openSignup()) return;
  const owner = tenantOf(projectPath);
  if (!owner) return; // an unregistered project is refused elsewhere, on ownership
  const mine = new Set(projects.forOwner(owner).map((p) => p.path));
  const live = sessions
    .all()
    .filter((s) => s.status === "running" && s.archived_at == null && mine.has(s.project_path));
  const cap = sessionsPerTenant();
  if (live.length >= cap) {
    throw new QuotaExceeded(
      `you already have ${live.length} sessions running (limit ${cap}) — close one before starting another`
    );
  }
}
