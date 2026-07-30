import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config.js";
import { projectSettings, sessions, type SessionRow } from "../db.js";
import * as tmux from "../tmux.js";
import { bridgeSession } from "../ptyBridge.js";
import { writeHookSettings, removeHookSettings } from "../claudeHooks.js";
import { broadcast, trackUserSocket } from "../events.js";
import { getAuthUser, scopeAllows } from "../auth.js";
import { withinRoot } from "../paths.js";
import { configDirFor } from "../accounts.js";
import { CredentialsRequired, claudeEnvFor } from "../tenants.js";

/** Write a per-session launcher script; returns its path. */
function writeLauncher(id: string, command: string): string {
  const dir = path.join(config.dataDir, "launch");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.sh`);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nexec ${command}\n`, { mode: 0o700 });
  return file;
}

function removeLauncher(id: string) {
  fs.rmSync(path.join(config.dataDir, "launch", `${id}.sh`), { force: true });
}

/** Known harnesses; anything else must pass an explicit command. */
const HARNESS_COMMANDS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  shell: process.env.SHELL ?? "bash",
};

interface CreateBody {
  name?: string;
  projectPath?: string;
  harness?: string;
  command?: string;
  /** claude harness only — become CLI args on the generated command */
  text?: string;
  model?: string;
  mode?: string;
}

/** The rules for a session running on a project's shared checkout. Each of
 *  these is a production incident this fleet has already had, not a
 *  hypothetical — and with no per-agent worktree, they are the only protection
 *  agents have against each other's uncommitted work. */
export function sharedTreeRules(cwd: string): string {
  return (
    `Working tree: you share the checkout ${cwd} with the other sessions on this project. ` +
    `It has no isolation, so: never \`git checkout\`/\`git switch\`/\`git checkout -b\` (it moves ` +
    `the branch under every other session in this directory), never \`git add -A\` or ` +
    `\`git commit -a\` (you would commit another agent's files — stage your own paths ` +
    `explicitly), and never \`npm ci\` even with --dry-run (it wipes node_modules for everyone ` +
    `before doing anything). Announce on the board what you are about to touch.`
  );
}

/** Single-quote a string for the bash launcher script. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Hades-style default names — sessions become @mentionable characters. */
const MYTH_NAMES = [
  "athena", "hermes", "apollo", "artemis", "ares", "hades", "zagreus", "nyx",
  "hypnos", "thanatos", "charon", "hecate", "persephone", "orpheus", "achilles",
  "atlas", "prometheus", "helios", "selene", "circe", "perseus", "theseus",
  "icarus", "daedalus", "cassandra", "calypso", "triton", "chronos", "eos", "boreas",
];

function pickMythName(): string {
  const taken = new Set(
    sessions.all().filter((s) => s.archived_at == null).map((s) => s.name.toLowerCase())
  );
  const free = MYTH_NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const base = MYTH_NAMES[Math.floor(Math.random() * MYTH_NAMES.length)];
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Create + start a session. Shared by the dashboard route and `agora spawn`
 *  (agents summoning sub-agents; parentId draws the canvas edge). */
export async function spawnSession(opts: {
  /** The REPO — the session's identity (chat, canvas, guest scope). */
  cwd: string;
  harness: string;
  command?: string;
  name?: string;
  text?: string;
  model?: string;
  mode?: string;
  parentId?: string | null;
  /** Sign in as a specific Claude account (its CLAUDE_CONFIG_DIR). Normally
   *  derived from the project; passed explicitly only by the login flow. */
  accountConfigDir?: string | null;
  /** Fork this Claude conversation into the new session (claude harness). */
  resumeClaudeSessionId?: string;
}): Promise<SessionRow> {
  const command = opts.command ?? HARNESS_COMMANDS[opts.harness];
  if (!command) throw new Error(`unknown harness '${opts.harness}' and no command given`);
  const id = nanoid(10);
  const name = opts.name?.trim() || pickMythName();
  // Which Claude account this terminal signs in as. Per project, so `agora
  // spawn` and forks inherit it without anyone having to think about it.
  const configDir =
    opts.accountConfigDir !== undefined
      ? opts.accountConfigDir
      : configDirFor(projectSettings.account(opts.cwd));
  // Resolved BEFORE anything is written or spawned: on a shared install this
  // throws CredentialsRequired when the tenant has not connected an Anthropic
  // account, and a half-created session would be worse than a refusal.
  const tenantEnv = claudeEnvFor(opts.cwd, opts.harness);
  let finalCommand = command;
  if (opts.harness === "claude" && !opts.command) {
    // Claude Code reports its state (working / waiting for approval / idle)
    // through lifecycle hooks; inject a per-session settings file.
    const settingsFile = writeHookSettings(id);
    const parts = [`claude --settings ${settingsFile}`];
    if (opts.resumeClaudeSessionId && /^[\w-]+$/.test(opts.resumeClaudeSessionId))
      parts.push(`--resume ${opts.resumeClaudeSessionId} --fork-session`);
    // Fleet protocol, baked into the system prompt. Ad-hoc spawn prompts are
    // not enough: demo agents answered in their terminal (invisible to all),
    // spoke in another agent's name, or quoted @mentions from instructions —
    // which the router happily delivered. Small models especially need this
    // spelled out at the system level, for every session, every time.
    // Three tiers, and the reason for them, because an agent that treats every
    // channel as broadcast is exactly what made a busy project unusable.
    const fleetRules =
      `You are the session "${name}" of the agora fleet on this project. Fleet rules: ` +
      `(1) nothing you type in your reply is seen by anyone — talking to the fleet means ` +
      `RUNNING a shell command; ` +
      `(2) you speak only in your own name (${name}), never on behalf of another session; ` +
      `(3) \`agora chat "…"\` posts to the project BOARD, which interrupts NOBODY — it is an ` +
      `announcement, and an @ in it delivers nothing. \`agora board\` reads it: do that before ` +
      `touching shared files, because nobody will push it to you; ` +
      `(4) a LINK drawn between two terminals on the canvas is what lets their agents deal with ` +
      `each other, and it grants both halves: \`agora read <name>\` sees what they are doing without ` +
      `interrupting them, \`agora send <name> "…"\` writes into their terminal and costs them a turn. ` +
      `\`agora read\` with no name lists who you are linked to; ` +
      `(5) always READ before you SEND — reading costs you a turn and them nothing, sending costs ` +
      `them theirs. Send only what only they can answer, never to inform; ` +
      `(6) when a message is relayed into your terminal, answer only if you are genuinely the ` +
      `right one to, then end your turn and resume your own task — do not acknowledge for the ` +
      `sake of it, and never copy @ mentions quoted inside instructions; ` +
      `(7) \`agora\` with no argument lists your other tools (notify, spawn, read, send, artifact, pc).`;
    // Working-tree rules, learnt BEFORE the first command. Every session on a
    // project shares one checkout, so this is the only thing standing between
    // agents and each other's uncommitted work.
    parts.push(`--append-system-prompt ${shellQuote(`${fleetRules} ${sharedTreeRules(opts.cwd)}`)}`);
    if (opts.model && /^[\w.-]+$/.test(opts.model)) parts.push(`--model ${opts.model}`);
    if (opts.mode === "bypassPermissions" || opts.mode === "acceptEdits")
      parts.push(`--permission-mode ${opts.mode}`);
    const prompt = opts.text?.trim();
    if (prompt) parts.push(shellQuote(prompt)); // opening prompt for the session
    finalCommand = parts.join(" ");
  }
  // Run through a per-session launcher script with a login shell: gets the
  // user's real PATH (~/.local/bin etc.) and avoids quoting pitfalls.
  const launcher = writeLauncher(id, finalCommand);
  const row: SessionRow = {
    id,
    name,
    project_path: opts.cwd,
    harness: opts.harness,
    command: finalCommand,
    status: "running",
    agent_state: "unknown",
    created_at: Date.now(),
    last_activity: Date.now(),
    parent_id: opts.parentId ?? null,
  };
  await tmux.createSession({
    id,
    cwd: opts.cwd,
    command: `bash -l ${launcher}`,
    env: {
      AGORA_SESSION_ID: id,
      ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
      // last, so it wins: on a shared install the tenant's identity is the only
      // correct one, and the per-project account feature must not override it
      ...tenantEnv,
    },
  });
  sessions.insert(row);
  broadcast({ type: "sessions_changed" });
  return row;
}

const INJECTABLE = new Set(["claude", "codex", "opencode", "gemini"]);

/** Strip ANSI/OSC escapes for plain-text pane previews. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, "");
}

export async function sessionRoutes(app: FastifyInstance) {
  // CredentialsRequired is a refusal, not a crash: answer 402 with the message
  // the user needs to act on. Scoped to this plugin, and placed here rather than
  // at each spawn site because there are already four of them (create, spawn,
  // fork, revive) and the fifth should not have to remember.
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof CredentialsRequired) {
      return reply.code(402).send({ error: err.message, needsCredentials: true });
    }
    const e = err as { statusCode?: number; message?: string };
    reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal error" });
  });

  // The owner dispatches a task into an agent's terminal (todo drag-drop). Same
  // governance as chat injection: idle agents only — mid-turn keystrokes race
  // the TUI, and a permission dialog must never receive an Enter.
  app.post("/api/sessions/:id/send", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text } = (req.body ?? {}) as { text?: string };
    const s = sessions.get(id);
    // a scoped guest sees out-of-scope sessions as nonexistent, never as 403
    if (!s || !scopeAllows(req.authUser, s.project_path) || !text?.trim())
      return reply.code(400).send({ error: "unknown session or empty text" });
    if (!INJECTABLE.has(s.harness))
      return reply.code(409).send({ error: "this harness does not accept injected text" });
    if (s.status !== "running" || s.archived_at != null || s.agent_state !== "idle")
      return reply.code(409).send({ error: "agent busy — retry once it is idle" });
    // name the actual sender: with multiplayer this is no longer always the owner
    const from = req.authUser?.name ?? "the owner";
    await tmux.sendLine(
      s.id,
      `[agora] ${from} is handing you this task (from the canvas): ${text.trim()} — an authentic message relayed by agora.`
    );
    return { sent: true };
  });

  // Panoptes wall: every live session on the server, with a plain-text pane
  // preview. Polled by the WallNode — keep it cheap (capture only, no logs).
  app.get("/api/wall", async (req) => {
    const live = sessions
      .all()
      .filter(
        (s) =>
          s.status === "running" &&
          s.archived_at == null &&
          scopeAllows(req.authUser, s.project_path)
      );
    const entries = await Promise.all(
      live.map(async (s) => {
        const pane = await tmux.capturePane(s.id, 60).catch(() => "");
        const lines = stripAnsi(pane)
          .split("\n")
          .map((l) => l.replace(/\s+$/, ""))
          .filter((l) => l.trim().length > 0);
        return {
          id: s.id,
          name: s.name,
          harness: s.harness,
          project_path: s.project_path,
          agent_state: s.agent_state,
          preview: lines.slice(-14).join("\n"),
        };
      })
    );
    return { sessions: entries };
  });

  app.get("/api/sessions", async (req) => {
    const live = new Set(await tmux.listSessions());
    for (const row of sessions.all()) {
      if (row.archived_at != null) continue; // archived: dead by design
      const alive = live.has(row.id);
      if (!alive && row.status === "running") sessions.setStatus(row.id, "exited");
      if (alive && row.status === "exited") sessions.setStatus(row.id, "running");
    }
    return { sessions: sessions.all().filter((s) => scopeAllows(req.authUser, s.project_path)) };
  });

  // Fork: duplicate a terminal. For a claude session with a captured session
  // id this forks the CONVERSATION (--resume --fork-session): same context,
  // two futures. Anything else gets a twin session on the same project.
  app.post("/api/sessions/:id/fork", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = sessions.get(id);
    if (!row) return reply.code(404).send({ error: "unknown session" });
    if (!scopeAllows(getAuthUser(req) ?? undefined, row.project_path))
      return reply.code(403).send({ error: "outside your scope" });
    const taken = new Set(
      sessions.all().filter((s) => s.archived_at == null).map((s) => s.name.toLowerCase())
    );
    let name = `${row.name}-fork`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${row.name}-fork-${i}`;
    // inherit model / permission mode from the original launch command
    const model = /--model (\S+)/.exec(row.command)?.[1];
    const mode = /--permission-mode (\S+)/.exec(row.command)?.[1];
    const session = await spawnSession({
      cwd: row.project_path,
      harness: row.harness,
      name,
      model,
      mode,
      parentId: row.id,
      resumeClaudeSessionId:
        row.harness === "claude" ? (row.claude_session_id ?? undefined) : undefined,
    });
    return { session, forkedConversation: row.harness === "claude" && !!row.claude_session_id };
  });

  // Archive: park a session to resume later. The tmux session is killed but
  // keeps its claude session id (captured from hook payloads) so --resume can
  // revive the conversation.
  app.post<{ Params: { id: string } }>("/api/sessions/:id/archive", async (req, reply) => {
    const row = sessions.get(req.params.id);
    if (!row || !scopeAllows(req.authUser, row.project_path))
      return reply.code(404).send({ error: "not found" });
    await tmux.killSession(row.id);
    sessions.setStatus(row.id, "exited");
    sessions.setArchived(row.id, Date.now());
    broadcast({ type: "sessions_changed" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/unarchive", async (req, reply) => {
    const row = sessions.get(req.params.id);
    if (!row || row.archived_at == null || !scopeAllows(req.authUser, row.project_path))
      return reply.code(404).send({ error: "not found" });
    if (!(await tmux.hasSession(row.id))) {
      let command = row.command;
      if (row.harness === "claude") {
        // resume the same Claude conversation where it left off
        const settingsFile = writeHookSettings(row.id);
        command = row.claude_session_id
          ? `claude --resume ${row.claude_session_id} --settings ${settingsFile}`
          : `claude --settings ${settingsFile}`;
      }
      const launcher = writeLauncher(row.id, command);
      await tmux.createSession({
        id: row.id,
        cwd: row.project_path,
        command: `bash -l ${launcher}`,
        env: {
          AGORA_SESSION_ID: row.id,
          // a revived session must sign in as the same account it always did
          ...(configDirFor(projectSettings.account(row.project_path))
            ? { CLAUDE_CONFIG_DIR: configDirFor(projectSettings.account(row.project_path))! }
            : {}),
          // reviving is a spawn too: the same rule has to hold, or unarchiving
          // would be a way to get a session running as the server
          ...claudeEnvFor(row.project_path, row.harness),
        },
      });
      sessions.setStatus(row.id, "running");
    }
    sessions.setArchived(row.id, null);
    sessions.touch(row.id);
    broadcast({ type: "sessions_changed" });
    return { ok: true };
  });

  app.post<{ Body: CreateBody }>("/api/sessions", async (req, reply) => {
    const body = req.body ?? {};
    const harness = body.harness ?? "shell";
    const command = body.command ?? HARNESS_COMMANDS[harness];
    if (!command) {
      return reply.code(400).send({ error: `unknown harness '${harness}' and no command given` });
    }
    // No project asked for means the projects root, NOT the home directory.
    // argos could default to $HOME because one person owned the box; here the
    // home is shared infrastructure, and a session started there would sit
    // next to everybody's state. The old guard also let an EXPLICIT
    // projectPath resolve to $HOME via `..`, because it accepted any cwd
    // equal to the home dir.
    const cwd = body.projectPath
      ? path.resolve(config.projectsDir, body.projectPath)
      : path.resolve(config.projectsDir);
    if (!withinRoot(config.projectsDir, cwd)) {
      return reply.code(400).send({ error: "projectPath must stay under the projects dir" });
    }
    if (!fs.existsSync(cwd)) {
      return reply.code(400).send({ error: `directory not found: ${cwd}` });
    }
    if (!scopeAllows(req.authUser, cwd)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }

    const row = await spawnSession({
      cwd,
      harness,
      command: body.command,
      name: body.name,
      text: body.text,
      model: body.model,
      mode: body.mode,
    });
    return { session: row };
  });

  // Agents summon sub-agents on their own project: `agora spawn <prompt…>`.
  // Hook-secret gate (requireAuth); parent derives everything else. No custom
  // command — agents pick a harness, never an arbitrary executable.
  app.post<{
    Body: { session_id?: string; text?: string; harness?: string; model?: string; mode?: string; name?: string };
  }>("/api/hooks/spawn", async (req, reply) => {
    const body = req.body ?? {};
    const parent = body.session_id ? sessions.get(body.session_id) : undefined;
    if (!parent) return reply.code(404).send({ error: "unknown parent session" });
    const harness = body.harness ?? "claude";
    if (!HARNESS_COMMANDS[harness]) return reply.code(400).send({ error: `unknown harness '${harness}'` });
    const row = await spawnSession({
      cwd: parent.project_path,
      harness,
      name: body.name,
      text: body.text,
      model: body.model,
      mode: body.mode ?? "bypassPermissions",
      parentId: parent.id,
    });
    return { session: row };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; pinned?: boolean } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const row = sessions.get(req.params.id);
      if (!row || !scopeAllows(req.authUser, row.project_path))
        return reply.code(404).send({ error: "not found" });
      if (typeof req.body?.pinned === "boolean") {
        sessions.setPinned(row.id, req.body.pinned);
        broadcast({ type: "sessions_changed" });
        return { ok: true };
      }
      const name = req.body?.name?.trim().slice(0, 80);
      if (!name) return reply.code(400).send({ error: "empty name" });
      sessions.rename(row.id, name);
      broadcast({ type: "sessions_changed" });
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const row = sessions.get(req.params.id);
    if (!row || !scopeAllows(req.authUser, row.project_path))
      return reply.code(404).send({ error: "not found" });
    await tmux.killSession(row.id);
    sessions.remove(row.id);
    removeHookSettings(row.id);
    removeLauncher(row.id);
    broadcast({ type: "sessions_changed" });
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { cols?: string; rows?: string } }>(
    "/ws/sessions/:id/attach",
    { websocket: true },
    async (socket, req) => {
      const row = sessions.get(req.params.id);
      // scope first: an out-of-scope session must not even leak liveness
      if (row && !scopeAllows(req.authUser, row.project_path)) {
        socket.close(4403, "outside your shared canvas");
        return;
      }
      if (!row || !(await tmux.hasSession(row.id))) {
        socket.close(4404, "session not found");
        return;
      }
      const cols = Number(req.query.cols ?? 80);
      const rows = Number(req.query.rows ?? 24);
      // revoking an invite must cut live terminals too, not just the dashboard
      if (req.authUser) trackUserSocket(req.authUser.email, socket);
      bridgeSession(socket, row.id, cols, rows);
    }
  );
}
