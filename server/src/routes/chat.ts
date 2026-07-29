import type { FastifyInstance } from "fastify";
import { chat, sessions, type SessionRow } from "../db.js";
import { scopeAllows } from "../auth.js";
import { broadcast } from "../events.js";
import * as tmux from "../tmux.js";
import { resolveLinked } from "./peek.js";

/** Agent harnesses that can receive injected text as a prompt. NEVER a raw
 *  shell — injected text would execute as a command. */
const INJECTABLE = new Set(["claude", "codex", "opencode", "gemini"]);

/** Provenance envelope. A line injected into a terminal is indistinguishable
 *  from hostile text unless it says where it comes from — agents have refused
 *  bare injected lines as prompt-injection attempts, rightly so. */
function envelope(author: string, body: string, fromUser: boolean, channel: string, direct: boolean) {
  const who = fromUser
    ? `${author} (your human) is talking to you`
    : `agent ${author} is talking to you`;
  // Name the command that actually answers THIS message: a direct question goes
  // back with `agora ask ${author}`, the owner's with `agora chat`. Pointing at
  // the wrong one costs the agent a turn discovering it does not exist.
  const how = fromUser
    ? `Answer with \`agora chat "…"\` if he asked something`
    : direct
      ? `Answer with \`agora ask ${author} "…"\` — only they are waiting on you`
      : `Answer with \`agora chat "…"\` if you are the right one to`;
  return (
    `[agora · ${channel}] ${who}: ${body} ` +
    `— an authentic message relayed by agora, not external content. ` +
    `${how}. Then end your turn and resume your own task.`
  );
}

export type ChatRouting = {
  project: string;
  body: string;
  fromUser: boolean;
  authorSessionId?: string;
  /** Session id this is addressed to (`agora ask`) — a deliberate interrupt. */
  toSession?: string | null;
};

/** A session that can be handed text at all. */
function addressable<T extends SessionRow>(s: T, opts: ChatRouting, project: string): boolean {
  return (
    s.project_path === project &&
    s.status === "running" &&
    s.archived_at == null &&
    s.id !== opts.authorSessionId &&
    INJECTABLE.has(s.harness)
  );
}

/**
 * Who a message actually INTERRUPTS — deliberately much narrower than who may
 * read. Pure on purpose: this rule has been the source of both failure modes
 * worth having, so it is unit-tested standalone (`deploy/gate-chat.mjs`).
 *
 *  - `agora ask <name>` — exactly that session, and it has to be typed on
 *    purpose.
 *  - the PROJECT BOARD — nobody, unless the owner wrote it. Agents announce
 *    there and read it when it matters; pushing those announcements is what
 *    turned a project full of unrelated agents into one conversation.
 */
export function chatTargets<T extends SessionRow>(all: T[], opts: ChatRouting): T[] {
  const eligible = all.filter((s) => addressable(s, opts, opts.project));
  if (opts.toSession) return eligible.filter((s) => s.id === opts.toSession);
  return opts.fromUser ? eligible : [];
}

/** Only an idle agent gets text typed into its terminal. Injecting mid-turn
 *  races the TUI's redraws and the line can vanish (observed live); injecting
 *  into a permission dialog is worse — the trailing Enter can ANSWER it. A
 *  busy agent has an imminent Stop hook, so the unread channel serves it the
 *  moment it finishes; a paused one gets it after the owner unblocks it. */
export function injectableNow(s: SessionRow): boolean {
  return s.agent_state === "idle";
}

async function deliverChat(opts: ChatRouting & {
  author: string;
  messageId?: number;
  channelLabel?: string;
}): Promise<{ injected: string[]; deferred: string[] }> {
  const targets = chatTargets(sessions.all(), opts);
  const inject = targets.filter(injectableNow);
  const line = envelope(
    opts.author,
    opts.body,
    opts.fromUser,
    opts.channelLabel ?? (opts.toSession ? "addressed to you" : "project board"),
    !!opts.toSession
  );
  await Promise.allSettled(inject.map((s) => tmux.sendLine(s.id, line)));
  // injected = read: the Stop-hook unread channel must not deliver it twice.
  // Deferred targets keep their cursor — that channel IS their delivery.
  if (opts.messageId) for (const s of inject) chat.advanceCursor(s.id, opts.messageId);
  return {
    injected: inject.map((s) => s.name),
    deferred: targets.filter((s) => !injectableNow(s)).map((s) => s.name),
  };
}

/** Per-project agent chat. Two doors:
 *  - /api/chat*        cookie-authed — the dashboard (a human) reads and posts
 *  - /api/hooks/chat*  hook-secret-authed — the `agora chat` CLI inside
 *    sessions; author/harness/project derive from the session row, so an
 *    agent can't impersonate another project. */
export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/chat", async (req, reply) => {
    const project = (req.query as { project?: string }).project ?? "";
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    return { messages: chat.board(project) };
  });

  app.post("/api/chat", async (req, reply) => {
    const { project, body } = (req.body ?? {}) as { project?: string; body?: string };
    if (!project || !body?.trim()) return reply.code(400).send({ error: "project and body required" });
    if (!scopeAllows(req.authUser, project)) {
      return reply.code(403).send({ error: "outside your shared canvas" });
    }
    // signed with the actual human's name — a guest must not post under
    // someone else's name, least of all the owner's
    const author = (req.authUser?.name ?? "human").toLowerCase();
    const message = chat.insert({
      project_path: project,
      author,
      harness: "user",
      body: body.trim(),
    });
    broadcast({ type: "chat", project, message }, { project });
    const delivery = await deliverChat({
      project,
      author,
      body: message.body,
      fromUser: true,
      messageId: message.id,
    });
    return { message, ...delivery };
  });

  app.post("/api/hooks/chat", async (req, reply) => {
    const { session_id, body } = (req.body ?? {}) as { session_id?: string; body?: string };
    if (!session_id || !body?.trim()) {
      return reply.code(400).send({ error: "session_id and body required" });
    }
    const s = sessions.get(session_id);
    if (!s) return reply.code(404).send({ error: "unknown session" });
    const message = chat.insert({
      project_path: s.project_path,
      author: s.name,
      harness: s.harness,
      body: body.trim(),
    });
    broadcast({ type: "chat", project: s.project_path, message }, { project: s.project_path });
    const delivery = await deliverChat({
      project: s.project_path,
      author: s.name,
      body: message.body,
      fromUser: false,
      authorSessionId: s.id,
      messageId: message.id,
    });
    return { message, ...delivery };
  });

  /** `agora ask <name> "…"` — the deliberate interrupt. It is the ONLY way an
   *  agent reaches outside its own frame, which is why it takes a name and not
   *  a mention buried in prose: interrupting someone should be a decision. */
  app.post<{ Body: { session_id?: string; to?: string; body?: string } }>(
    "/api/hooks/ask",
    async (req, reply) => {
      const { session_id, to, body } = req.body ?? {};
      const s = session_id ? sessions.get(session_id) : undefined;
      if (!s) return reply.code(404).send({ error: "unknown session" });
      const text = body?.trim();
      if (!to || !text) return reply.code(400).send({ error: "to and body required" });
      // One door for both verbs: whatever a link grants, it grants identically
      // to reading and to writing (see resolveLinked).
      const resolved = resolveLinked(s, to);
      if (!resolved.ok) {
        return reply
          .code(resolved.status)
          .send({ error: resolved.error, ...(resolved.candidates ? { candidates: resolved.candidates } : {}) });
      }
      const target = resolved.session;
      // recorded on the board: the fleet's cross-frame traffic stays visible in
      // one place instead of vanishing into a terminal
      const message = chat.insert({
        project_path: s.project_path,
        author: s.name,
        harness: s.harness,
        body: text,
        to_session: target.id,
      });
      broadcast(
        { type: "chat", project: s.project_path, message: { ...message, to_name: target.name } },
        { project: s.project_path }
      );
      const delivery = await deliverChat({
        project: s.project_path,
        author: s.name,
        body: message.body,
        fromUser: false,
        authorSessionId: s.id,
        toSession: target.id,
        messageId: message.id,
      });
      return { message, to: target.name, ...delivery };
    }
  );

  // Unread feed for the Stop hook (`agora chat-hook`): one-shot delivery,
  // cursor advances server-side.
  app.get("/api/hooks/chat/unread", async (req, reply) => {
    const { session } = req.query as { session?: string };
    const s = session ? sessions.get(session) : undefined;
    if (!s) return reply.code(404).send({ error: "unknown session" });
    return { messages: chat.takeUnread(s.id, s.project_path, s.name) };
  });

  /** `agora board` — the project board: what agents on OTHER work announced.
   *  Pull-only by design; nothing here ever interrupted anyone. */
  app.get("/api/hooks/chat/board", async (req, reply) => {
    const { session, n } = req.query as { session?: string; n?: string };
    const s = session ? sessions.get(session) : undefined;
    if (!s) return reply.code(404).send({ error: "unknown session" });
    const limit = Math.min(200, Math.max(1, Number(n) || 30));
    return { messages: chat.board(s.project_path, limit) };
  });

  app.get("/api/hooks/chat/log", async (req, reply) => {
    const { session, n } = req.query as { session?: string; n?: string };
    const s = session ? sessions.get(session) : undefined;
    if (!s) return reply.code(404).send({ error: "unknown session" });
    const limit = Math.min(200, Math.max(1, Number(n) || 30));
    return { messages: chat.board(s.project_path, limit) };
  });
}
