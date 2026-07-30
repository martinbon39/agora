import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Claude Code reports its own state through lifecycle hooks — far more
 * reliable than scraping terminal output. Per session we generate a settings
 * file whose hooks POST the event payload to agora, and launch
 * `claude --settings <file>`.
 */
const FORWARDED_EVENTS = ["UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd"];

export function hooksDir() {
  return path.join(config.dataDir, "hooks");
}

/** The settings file is handed to `claude --settings`, so the SESSION can read
 *  it. That is why the header below carries the session's own token and not the
 *  global secret: with the global secret in here, an agent could read its own
 *  settings file and then act as any session on the box, which is exactly what
 *  per-session tokens exist to prevent. */
export function writeHookSettings(sessionId: string, hookToken: string): string {
  const hooks: Record<string, unknown> = {};
  for (const event of FORWARDED_EVENTS) {
    const url = `http://127.0.0.1:${config.port}/api/hooks/${sessionId}/${event}`;
    hooks[event] = [
      {
        hooks: [
          {
            type: "command",
            // -m 3: never let a dead agora server stall Claude's turn
            command: `curl -s -m 3 -X POST -H 'Content-Type: application/json' -H 'X-Agora-Hook: ${hookToken}' --data-binary @- ${url} >/dev/null 2>&1 || true`,
          },
        ],
      },
    ];
  }
  // Chat delivery: at end of turn, `agora chat-hook` fetches this session's
  // unread project-chat messages; if any, it blocks the stop with them as
  // reason so the agent reads them immediately. The server-side read cursor
  // guarantees single delivery — no infinite continue loops.
  (hooks.Stop as { hooks: unknown[] }[])[0].hooks.push({
    type: "command",
    command: "agora chat-hook || true",
  });
  fs.mkdirSync(hooksDir(), { recursive: true });
  const file = path.join(hooksDir(), `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify({ hooks }, null, 2));
  return file;
}

export function removeHookSettings(sessionId: string) {
  fs.rmSync(path.join(hooksDir(), `${sessionId}.json`), { force: true });
}

/** Map a hook event (+ payload) to the session's agent state. */
export function classify(
  event: string,
  payload: { message?: string }
): "idle" | "working" | "needs_approval" | null {
  switch (event) {
    case "UserPromptSubmit":
    case "PreToolUse":
      return "working";
    case "Stop":
    case "SessionEnd":
      return "idle";
    case "Notification": {
      const msg = payload.message ?? "";
      if (/permission|approv|autoris/i.test(msg)) return "needs_approval";
      if (/waiting for (your )?input|idle/i.test(msg)) return "idle";
      return null;
    }
    default:
      return null;
  }
}
