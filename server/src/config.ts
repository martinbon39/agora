import os from "node:os";
import path from "node:path";

const home = os.homedir();

/** ARGOS_* with ORBIT_* fallback. The systemd unit on the current VPS still
 *  sets ORBIT_HOST/PORT/ORIGIN (renaming it needs root) — drop the fallback
 *  once the unit is migrated to argos.service. */
export const env = (name: string) =>
  process.env[`ARGOS_${name}`] ?? process.env[`ORBIT_${name}`];

export const config = {
  host: env("HOST") ?? "127.0.0.1",
  port: Number(env("PORT") ?? 4560),
  /** Root for argos's own state: sqlite db, session output logs.
   *  Stays `~/.orbit` on purpose: live db + per-session hook files reference
   *  absolute paths inside it — renaming would break every running session. */
  dataDir: env("DATA_DIR") ?? path.join(home, ".orbit"),
  /** Where user projects live; sessions default their cwd here. */
  projectsDir: env("PROJECTS_DIR") ?? path.join(home, "projects"),
  /** Dedicated tmux server socket so argos never collides with a human's tmux.
   *  Also kept as `orbit`: live sessions exist on that socket, a new socket
   *  name would orphan them all. */
  tmuxSocket: env("TMUX_SOCKET") ?? "orbit",
  /** Flow control: pause the pty above this many un-acked bytes in flight. */
  flowHighWater: 512 * 1024,
  /** Resume the pty once un-acked bytes drop below this. */
  flowLowWater: 128 * 1024,
} as const;

export const logsDir = () => path.join(config.dataDir, "logs");
export const dbPath = () => path.join(config.dataDir, "orbit.db");
