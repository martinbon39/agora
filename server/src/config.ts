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
export const dbPath = () => path.join(config.dataDir, "agora.db");
