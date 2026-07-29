import type { FastifyInstance } from "fastify";
import { notifications, sessions } from "../db.js";
import { classify } from "../claudeHooks.js";
import { broadcast, addEventClient } from "../events.js";
import { allowedEmail, colorForEmail, ownerDisplayName } from "../auth.js";
import { sendPush } from "../push.js";

export async function hookRoutes(app: FastifyInstance) {
  // Claude Code hook payloads arrive here (see claudeHooks.ts).
  app.post<{
    Params: { id: string; event: string };
    Body: { message?: string; session_id?: string };
  }>("/api/hooks/:id/:event", async (req, reply) => {
    const row = sessions.get(req.params.id);
    if (!row) return reply.code(404).send({ error: "unknown session" });
    // hook payloads carry Claude Code's own session id — remember it so
    // archived tmux sessions can be revived with `claude --resume`
    const claudeId = req.body?.session_id;
    if (claudeId && claudeId !== row.claude_session_id) {
      sessions.setClaudeSessionId(row.id, claudeId);
    }
    const state = classify(req.params.event, req.body ?? {});
    if (state && state !== row.agent_state) {
      sessions.setAgentState(row.id, state);
      broadcast(
        { type: "session_state", id: row.id, agent_state: state },
        { project: row.project_path }
      );
      if (state === "needs_approval") {
        sendPush({
          title: `${row.name} is waiting for your approval`,
          body: (req.body?.message ?? "").slice(0, 120) || "A session is waiting for an answer.",
          url: `/#/session/${row.id}`,
        });
      }
    }
    return { ok: true };
  });

  // Agents running inside sessions message the owner here (`agora notify` CLI).
  // Under /api/hooks/ on purpose: authenticated by the hook secret, not a cookie.
  app.post<{ Body: { title?: string; body?: string; link?: string; session_id?: string } }>(
    "/api/hooks/notify",
    async (req, reply) => {
      const title = (req.body?.title ?? "").trim().slice(0, 120);
      if (!title) return reply.code(400).send({ error: "missing title" });
      const body = (req.body?.body ?? "").trim().slice(0, 1000);
      const link = (req.body?.link ?? "").trim().slice(0, 500) || null;
      if (link && !/^(https?:\/\/|\/)/.test(link)) {
        return reply.code(400).send({ error: "link must be an URL or an absolute path" });
      }
      const session = req.body?.session_id ? sessions.get(req.body.session_id) : undefined;
      const row = notifications.insert({
        session_id: session?.id ?? null,
        title,
        body,
        link,
      });
      // the inbox is the owner's — agents message THEM, not visiting guests
      broadcast({ type: "notification", notification: row }, { ownerOnly: true });
      sendPush({
        title: session ? `${session.name} — ${title}` : title,
        body: body || "Message from an agent.",
        url: link ?? (session ? `/#/session/${session.id}` : "/"),
      });
      return { ok: true, id: row.id };
    }
  );

  // Inbox for the dashboard (cookie-authenticated like the rest of /api).
  // Owner-only content: guests get an empty inbox, not the owner's messages.
  app.get("/api/notifications", async (req) => {
    if (req.authUser?.role !== "owner") return { notifications: [], unread: 0 };
    return {
      notifications: notifications.recent(),
      unread: notifications.unreadCount(),
    };
  });

  app.post("/api/notifications/read", async (req) => {
    if (req.authUser?.role !== "owner") return { ok: true };
    notifications.markAllRead();
    broadcast({ type: "notifications_read" }, { ownerOnly: true });
    return { ok: true };
  });

  // Dashboards subscribe here for live state changes + presence.
  app.get("/ws/events", { websocket: true }, (socket, req) => {
    // requireAuth attached the identity on the upgrade request; the fallback
    // (never expected — the gate 401s first) keeps the socket owner-safe
    const user = req.authUser ?? {
      email: allowedEmail(),
      name: ownerDisplayName(),
      role: "owner" as const,
      color: colorForEmail(allowedEmail()),
      project: null,
    };
    addEventClient(socket, user);
  });
}
