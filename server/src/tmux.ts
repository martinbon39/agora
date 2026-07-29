import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config, logsDir } from "./config.js";

const exec = promisify(execFile);

const PREFIX = "agora-";

function tmux(args: string[]) {
  return exec("tmux", ["-L", config.tmuxSocket, ...args]);
}

/** Exact-match target for a session (tmux prefix-matches bare names). */
const target = (id: string) => `=${PREFIX}${id}`;

export const sessionLogPath = (id: string) => path.join(logsDir(), `${id}.log`);

/**
 * Start agora's dedicated tmux server (idempotent) and set global options.
 * status off: agora's UI is the chrome, no tmux status bar inside the terminal.
 * mouse on: wheel scrolls tmux history, giving real scrollback in the browser.
 * exit-empty off: keep the server alive with zero sessions, so options persist.
 */
export async function ensureTmuxServer(): Promise<void> {
  const globals: [string, string][] = [
    ["exit-empty", "off"], // first: keeps the server alive once this command ends
    ["status", "off"],
    ["mouse", "on"],
    ["history-limit", "50000"],
    ["window-size", "latest"],
    ["default-terminal", "tmux-256color"],
    ["escape-time", "10"],
    ["focus-events", "on"],
    // copy-mode selections reach the browser clipboard via OSC 52
    // (xterm.js ClipboardAddon decodes it client-side)
    ["set-clipboard", "on"],
  ];
  // One tmux invocation: a bare start-server exits immediately (exit-empty on
  // by default), so chain the set-options while the client keeps it alive.
  const args = ["start-server"];
  for (const [key, value] of globals) {
    args.push(";", "set-option", "-g", key, value);
  }
  // xterm-256color terminfo lacks the Ms capability: declare clipboard
  // support explicitly or tmux never emits OSC 52 to our client.
  args.push(";", "set-option", "-as", "terminal-features", "xterm*:clipboard");
  await tmux(args);
}

export async function createSession(opts: {
  id: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
}): Promise<void> {
  const args = ["new-session", "-d", "-s", `${PREFIX}${opts.id}`, "-c", opts.cwd];
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    args.push("-e", `${k}=${v}`);
  }
  // Run through a login shell so the command sees the user's normal PATH,
  // and keep the pane open on exit so crashes stay readable (remain-on-exit).
  args.push(opts.command);
  await tmux(args);
  // remain-on-exit is a window option: target the session's current window.
  await tmux(["set-option", "-w", "-t", `${target(opts.id)}:`, "remain-on-exit", "on"]);
  // Tee everything the pane outputs to a per-session log for durable scrollback.
  await tmux([
    "pipe-pane",
    "-o",
    "-t",
    `${target(opts.id)}:`,
    `cat >> ${sessionLogPath(opts.id)}`,
  ]);
}

export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await tmux(["list-sessions", "-F", "#{session_name}"]);
    return stdout
      .split("\n")
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length));
  } catch {
    // tmux exits non-zero when the server has no sessions / is not running.
    return [];
  }
}

export async function hasSession(id: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", target(id)]);
    return true;
  } catch {
    return false;
  }
}

export async function killSession(id: string): Promise<void> {
  await tmux(["kill-session", "-t", target(id)]).catch(() => {});
}

/** Args for attaching a pty to a session — spawned via node-pty, not exec'd. */
export function attachArgs(id: string): { file: string; args: string[] } {
  return {
    file: "tmux",
    args: ["-L", config.tmuxSocket, "attach-session", "-t", target(id)],
  };
}

/** Type a line into a session's pane as if the user wrote it (used to push
 *  @mentioned chat messages into agent REPLs). `-l` sends the text literally;
 *  Enter submits it as a prompt. Newlines collapse to spaces — one message,
 *  one turn. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendLine(id: string, text: string): Promise<void> {
  const line = text.replace(/\s*\n\s*/g, " ").trim();
  if (!line) return;
  // NB the trailing colon: bare `=session` fails pane resolution on this tmux
  // ("can't find pane") while `=session:` resolves to its active pane. Every
  // server-side injection silently failed on this until it was probed live.
  await tmux(["send-keys", "-t", `${target(id)}:`, "-l", line]);
  // A burst of literal keys trips the TUI's paste detection; an Enter glued to
  // it is treated as a pasted newline, NOT a submit — the message then sits in
  // the composer forever (observed on narrow canvas panes). Let the paste
  // window close before pressing Enter, then verify the composer emptied.
  await sleep(200);
  await tmux(["send-keys", "-t", `${target(id)}:`, "Enter"]);
  const probe = line.slice(0, 24);
  for (let retry = 0; retry < 2; retry++) {
    await sleep(400);
    // plain capture (no -e): ANSI escapes would split the probe text
    const pane = await tmux(["capture-pane", "-p", "-t", `${target(id)}:`, "-S", "-50"])
      .then((r) => r.stdout)
      .catch(() => "");
    // collapse whitespace: the composer re-wraps at pane width mid-probe
    if (!pane.replace(/\s+/g, " ").includes(`❯ ${probe}`)) return;
    await tmux(["send-keys", "-t", `${target(id)}:`, "Enter"]);
  }
}

/** Current pane content with escapes, for future replay use (M2+). */
export async function capturePane(id: string, lines = 2000): Promise<string> {
  const { stdout } = await tmux([
    "capture-pane",
    "-p",
    "-e",
    "-t",
    `${target(id)}:`,
    "-S",
    `-${lines}`,
  ]);
  return stdout;
}
