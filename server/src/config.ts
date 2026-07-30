import os from "node:os";
import path from "node:path";

const home = os.homedir();

export const env = (name: string) => process.env[`AGORA_${name}`];

export const config = {
  host: env("HOST") ?? "127.0.0.1",
  /** 4570, not 4560: agora is forked from argos and the two are routinely run
   *  on the same machine. Colliding defaults would make a dev run of one
   *  silently fail against the other's server. */
  port: Number(env("PORT") ?? 4570),
  /** Root for agora's own state: sqlite db, session output logs. */
  dataDir: env("DATA_DIR") ?? path.join(home, ".agora"),
  /** Where user projects live; sessions default their cwd here. */
  projectsDir: env("PROJECTS_DIR") ?? path.join(home, "projects"),
  /** Dedicated tmux server socket, so agora's sessions are invisible both to a
   *  human's own tmux and to any other cockpit sharing the box. */
  tmuxSocket: env("TMUX_SOCKET") ?? "agora",
  /** Flow control: pause the pty above this many un-acked bytes in flight. */
  flowHighWater: 512 * 1024,
  /** Resume the pty once un-acked bytes drop below this. */
  flowLowWater: 128 * 1024,
} as const;

export const logsDir = () => path.join(config.dataDir, "logs");

/** The agents' unix socket, in a directory OF ITS OWN.
 *
 *  The directory is not decoration. The server unlinks and recreates the socket
 *  on every boot, which gives it a new inode — and a bind mount pins an inode.
 *  A sandboxed session handed the FILE keeps a door onto the deleted socket
 *  after a restart and fails with ECONNREFUSED forever, silently, while the
 *  session itself survives the restart via the reconciliation path. Handing over
 *  the DIRECTORY makes the recreate visible through the bind, and still exposes
 *  nothing else: the database, the env file and the global hook secret stay one
 *  level up. */
export const socketDir = () => path.join(config.dataDir, "sock");
export const socketPath = () => env("SOCKET") ?? path.join(socketDir(), "agora.sock");
export const dbPath = () => path.join(config.dataDir, "agora.db");

/** Open signup: any verified Google account becomes a tenant with its own
 *  workspace and its own Claude credentials. Off by default — a self-hosted
 *  install must not start accepting strangers because someone configured OAuth.
 *
 *  This flag is also what "multi-tenant mode" means everywhere else: with it on,
 *  a session may only run as a tenant's own Claude identity, never the server's.
 *  It lives in config rather than auth so that the credential resolver can read
 *  it without importing the auth module. */
export const openSignup = () => /^(1|true|yes)$/i.test(env("OPEN_SIGNUP") ?? "");
