import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

/**
 * Claude Code accounts.
 *
 * Claude Code keeps its identity in CLAUDE_CONFIG_DIR (default `~/.claude`):
 * `.credentials.json` for the OAuth tokens, `.claude.json` for the account it
 * belongs to. Point that variable at another directory and you get another
 * account — verified on 2.1.220: an empty dir reports no MCP servers and mints
 * its own `.claude.json`.
 *
 * But it moves EVERYTHING, not just the identity: a fresh dir has no CLAUDE.md,
 * no agents, no skills, no settings (hooks!), no past transcripts. An agent
 * launched there would lose the whole harness and answer as a stranger. So an
 * account directory is mostly symlinks back to the real one, and only the
 * identity is its own.
 */
const home = os.homedir();

/** The user's normal Claude config — the default account. */
export const defaultConfigDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");

export const accountsRoot = () => path.join(config.dataDir, "claude-accounts");

/** Configuration and knowledge: the same human, so these follow every account.
 *  Everything NOT listed here (credentials, .claude.json, caches, daemon
 *  state) stays private to the account, which is the point. */
const SHARED = [
  "CLAUDE.md",
  "settings.json",
  "agents",
  "skills",
  "plugins",
  "projects", // transcripts + memory: --resume must work across accounts
  "statusline-command.sh",
  "subagent-statusline.sh",
];

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export interface Account {
  /** Slug; "" is the default account (the plain ~/.claude). */
  id: string;
  label: string;
  /** Signed-in address, once the account has been logged into. */
  email: string | null;
  organization: string | null;
  plan: string | null;
  loggedIn: boolean;
  /** null for the default account — we leave CLAUDE_CONFIG_DIR unset there. */
  configDir: string | null;
}

/** Read the identity Claude Code wrote into a config dir. */
function identity(dir: string): Pick<Account, "email" | "organization" | "plan"> {
  // The in-dir file wins, ALWAYS. Claude Code writes `.claude.json` inside
  // CLAUDE_CONFIG_DIR when it is set (verified on 2.1.220) and only falls back
  // to the home root for a plain `~/.claude`. Looking at the home root first
  // labelled every account with the identity of whoever owns the home
  // directory — caught by the gate, which read the real address out of a run
  // that was supposed to be pointed at a fake config entirely.
  const candidates = [path.join(dir, ".claude.json")];
  if (dir === path.join(home, ".claude")) candidates.push(path.join(home, ".claude.json"));
  for (const file of candidates) {
    try {
      const acc = JSON.parse(fs.readFileSync(file, "utf8")).oauthAccount;
      if (acc?.emailAddress) {
        return {
          email: acc.emailAddress,
          organization: acc.organizationName ?? null,
          plan: acc.organizationType ?? null,
        };
      }
    } catch {
      // not written yet, or unreadable — treat as not logged in
    }
  }
  return { email: null, organization: null, plan: null };
}

const hasCredentials = (dir: string) => fs.existsSync(path.join(dir, ".credentials.json"));

export function list(): Account[] {
  const base = defaultConfigDir();
  const out: Account[] = [
    {
      id: "",
      label: "Default",
      ...identity(base),
      loggedIn: hasCredentials(base),
      configDir: null,
    },
  ];
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(accountsRoot(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // no accounts yet
  }
  for (const id of dirs.sort()) {
    const dir = path.join(accountsRoot(), id);
    out.push({
      id,
      label: readLabel(dir) ?? id,
      ...identity(dir),
      loggedIn: hasCredentials(dir),
      configDir: dir,
    });
  }
  return out;
}

/** A human-chosen name, kept beside the config so it survives a re-login. */
const labelFile = (dir: string) => path.join(dir, ".agora-label");
const readLabel = (dir: string): string | null => {
  try {
    return fs.readFileSync(labelFile(dir), "utf8").trim() || null;
  } catch {
    return null;
  }
};

/** Link the shared parts into an account dir, skipping anything already there. */
function linkShared(dir: string) {
  const base = defaultConfigDir();
  for (const name of SHARED) {
    const from = path.join(base, name);
    const to = path.join(dir, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.symlinkSync(from, to);
    } catch {
      // a link we cannot make is not worth failing the whole account over
    }
  }
}

export function create(label: string): Account {
  const id = slugify(label) || `account-${Date.now()}`;
  const dir = path.join(accountsRoot(), id);
  if (fs.existsSync(dir)) throw new Error(`an account named '${id}' already exists`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(labelFile(dir), label.trim().slice(0, 60));
  linkShared(dir);
  return {
    id,
    label: label.trim().slice(0, 60),
    ...identity(dir),
    loggedIn: false,
    configDir: dir,
  };
}

export function remove(id: string) {
  if (!id) throw new Error("the default account cannot be removed");
  const dir = path.join(accountsRoot(), slugify(id));
  if (!dir.startsWith(accountsRoot() + path.sep)) throw new Error("bad account id");
  // rmSync does not follow symlinks: the shared CLAUDE.md, agents/ and
  // projects/ of the real config dir are untouched, only the links die
  fs.rmSync(dir, { recursive: true, force: true });
}

/** The config dir a session should run with, or null to leave the env alone. */
export function configDirFor(accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const dir = path.join(accountsRoot(), slugify(accountId));
  if (!fs.existsSync(dir)) return null;
  // repair links every time: the shared set grows as the harness does, and an
  // account made before `skills/` existed should still get it
  linkShared(dir);
  return dir;
}
