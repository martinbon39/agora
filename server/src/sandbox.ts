import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env, socketPath } from "./config.js";

/**
 * Wrap a session's command in bwrap, so an agent cannot read the operator's home.
 *
 * WHAT THIS CLOSES. Without it a session is a plain process under the server's
 * unix user: it can read agora's own database, its env file, the global hook
 * secret (the one that authenticates as ANY session), and every other tenant's
 * Claude credentials. Those are the jewels, and a tmpfs over /home takes all of
 * them away in one move.
 *
 * WHAT IT DOES NOT CLOSE, and this is documented rather than implied: the network
 * namespace is shared, so a session still reaches every service on loopback —
 * including, on a typical box, a reverse proxy's unauthenticated admin API. That
 * is a separate change (an outbound CONNECT proxy restricted to the model API,
 * reached through a socat relay inside the sandbox, because undici's HTTPS_PROXY
 * takes no unix path) and it belongs in its own commit. Shipping the filesystem
 * half and calling the result "sandboxed" would be the decorative version.
 *
 * Opt-in via AGORA_SANDBOX=bwrap. Not the default: on a single-user install this
 * removes things the operator relies on, and preparing a multi-tenant product is
 * no reason to change how somebody's own cockpit behaves.
 */

export type SandboxMode = "off" | "bwrap";

export function sandboxMode(): SandboxMode {
  return env("SANDBOX") === "bwrap" ? "bwrap" : "off";
}

/** Directories the session must keep, resolved rather than assumed.
 *
 *  The one that is easy to miss: `claude` on PATH is a symlink into a versioned
 *  install directory under $HOME. A tmpfs over /home keeps the PATH entry and
 *  deletes the binary, so `command -v claude` fails while $PATH still looks
 *  perfect — verified, not reasoned about. `bash -lc` cannot rescue it either,
 *  since ~/.profile is gone with the same tmpfs. */
function harnessPaths(): string[] {
  const home = os.homedir();
  const out = new Set<string>([path.join(home, ".local", "bin")]);
  for (const bin of ["claude", "codex", "opencode", "gemini", "agora"]) {
    const link = path.join(home, ".local", "bin", bin);
    try {
      out.add(path.dirname(fs.realpathSync(link)));
    } catch {
      // not installed — nothing to bind
    }
  }
  return [...out].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

const roBind = (p: string) => ["--ro-bind", p, p];

export interface SandboxOpts {
  /** The session's working directory. Bound at its REAL path: project_path in the
   *  database has to mean the same thing inside and outside. */
  cwd: string;
  /** The tenant's CLAUDE_CONFIG_DIR, if it has one. Writable — the CLI writes
   *  credentials there after a /login. */
  claudeConfigDir?: string | null;
}

/**
 * bwrap arguments for a session, or null when sandboxing is off.
 *
 * Order matters: the tmpfs over /home goes down first, and everything the session
 * keeps is bound back on top of it. bwrap creates missing parents inside the
 * tmpfs, which is what lets a single file — the unix socket — be handed over
 * without exposing the directory it lives in.
 */
export function bwrapArgs(opts: SandboxOpts): string[] | null {
  if (sandboxMode() !== "bwrap") return null;
  const args: string[] = [];

  // the system, read-only
  for (const p of ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"]) {
    if (fs.existsSync(p)) args.push(...roBind(p));
  }
  // /dev must be real: the pty arrives on fd 0/1/2 so termios works either way,
  // but anything that reopens /dev/tty breaks on an empty /dev
  args.push("--dev", "/dev");
  // a private PID namespace, so /proc/<pid>/environ of another session — which
  // holds its ANTHROPIC_API_KEY — is not merely protected by a host sysctl
  // (ptrace_scope) but structurally absent
  args.push("--unshare-pid", "--proc", "/proc");
  // a private /tmp: shared /tmp between tenants running as the same unix user is
  // a channel, not a detail. TMPDIR is set by the caller to match.
  args.push("--tmpfs", "/tmp");

  // the home disappears, then only what this session needs comes back
  args.push("--tmpfs", os.homedir());
  for (const p of harnessPaths()) args.push(...roBind(p));
  args.push("--bind", opts.cwd, opts.cwd);
  if (opts.claudeConfigDir && fs.existsSync(opts.claudeConfigDir)) {
    args.push("--bind", opts.claudeConfigDir, opts.claudeConfigDir);
  }
  // The socket's DIRECTORY, not the socket. A bind mount pins an inode, and the
  // server unlinks and recreates the socket on every boot — so a session handed
  // the file keeps a door onto a deleted inode across a restart and fails with
  // ECONNREFUSED forever, while the session itself survives via reconciliation.
  // The directory holds only the socket; the database and secrets are a level up
  // and stay behind the tmpfs.
  const sockDir = path.dirname(socketPath());
  if (fs.existsSync(sockDir)) args.push("--bind", sockDir, sockDir);

  args.push("--chdir", opts.cwd);
  // die-with-parent: when tmux kills the pane, nothing survives it
  args.push("--die-with-parent");
  return args;
}

/** Environment additions a sandboxed session needs. */
export function sandboxEnv(): Record<string, string> {
  if (sandboxMode() !== "bwrap") return {};
  // TMPDIR follows the private /tmp; HOME stays as it was — the tmpfs is mounted
  // AT the home path, so $HOME still resolves, it is simply nearly empty
  return { TMPDIR: "/tmp" };
}

/** Single-quote for the bash launcher, matching sessions.ts. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command a session's launcher should exec. */
export function wrapCommand(command: string, opts: SandboxOpts): string {
  const args = bwrapArgs(opts);
  if (!args) return command;
  // bash -c, not -lc: ~/.profile is gone with the tmpfs, so a login shell buys
  // nothing and only makes the failure mode harder to read
  return `bwrap ${args.map(q).join(" ")} -- /bin/bash -c ${q(command)}`;
}
