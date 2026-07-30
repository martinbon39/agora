import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canvas, sessions, type SessionRow } from "../db.js";
import { actingSession } from "../auth.js";
import * as tmux from "../tmux.js";

/**
 * Reading another agent's context — nodeterm's model, ported.
 *
 * In nodeterm, drawing an edge between two agent nodes means "these two may
 * READ each other". No message flows: the link is a permission, and the agent
 * pulls what it wants when it wants it. That is the opposite of pushing a brief
 * at launch, and it is the half worth keeping — a pull costs the reader a turn
 * and nobody else anything, while a push costs everyone their train of thought.
 *
 * So: the canvas edges ARE the permission. `agora peek <name>` answers only for
 * sessions whose terminal nodes are joined by a link a human drew.
 */

/** Terminal nodes on a canvas carry the session id they display. */
interface NodeLike {
  id: string;
  type?: string;
  data?: { sessionId?: string };
}
interface EdgeLike {
  source: string;
  target: string;
}

/** Session ids linked to this one by a canvas edge, in either direction. */
export function linkedSessionIds(project: string, sessionId: string): Set<string> {
  const out = new Set<string>();
  const { data } = canvas.get(project);
  if (!data) return out;
  let doc: { nodes?: NodeLike[]; edges?: EdgeLike[] };
  try {
    doc = JSON.parse(data);
  } catch {
    return out;
  }
  const sessionOfNode = new Map<string, string>();
  for (const n of doc.nodes ?? []) {
    if (n?.type === "terminal" && typeof n.data?.sessionId === "string") {
      sessionOfNode.set(n.id, n.data.sessionId);
    }
  }
  // the node(s) showing me — the same session can be on the canvas twice
  const mine = new Set(
    [...sessionOfNode].filter(([, sid]) => sid === sessionId).map(([nodeId]) => nodeId)
  );
  for (const e of doc.edges ?? []) {
    if (!e?.source || !e?.target) continue;
    const other = mine.has(e.source) ? e.target : mine.has(e.target) ? e.source : null;
    if (!other) continue;
    const sid = sessionOfNode.get(other);
    if (sid && sid !== sessionId) out.add(sid);
  }
  // A canvas doc is whatever the client PUT: a node may carry the sessionId of
  // a session in ANOTHER project, and drawing an edge to it would then grant
  // peek and ask across the scope boundary — a guest confined to one project
  // could read a stranger's agent. The link expresses permission, but only the
  // session row says which project a session really belongs to.
  for (const sid of [...out]) {
    if (sessions.get(sid)?.project_path !== project) out.delete(sid);
  }
  return out;
}

/**
 * Resolve a name to the session it may act on, or say why not.
 *
 * ONE function for both verbs. `read` and `send` were each filtering the linked
 * set and each handling "no match" and "ambiguous" their own way — which meant
 * send was safe only because it happened to call the same helper, an
 * implementation fact rather than a guarantee (hecate's point). Nothing stopped
 * the two from drifting at the next refactor. Now there is one door: a verb that
 * does not come through here has no target at all.
 */
export type Resolution =
  | { ok: true; session: SessionRow }
  | { ok: false; status: 403 | 409; error: string; candidates?: string[] };

export function resolveLinked(me: SessionRow, name: string): Resolution {
  const linked = linkedSessionIds(me.project_path, me.id);
  const want = name.replace(/^@/, "").toLowerCase();
  const matches = [...linked]
    .map((id) => sessions.get(id))
    .filter(
      (s): s is SessionRow =>
        !!s && s.status === "running" && s.archived_at == null && s.name.toLowerCase().startsWith(want)
    );
  if (!matches.length) {
    // Deliberately the same answer whether the session does not exist, is dead,
    // or is simply not linked: "draw a link" is the actionable half either way,
    // and it keeps the canvas the single place permission is expressed.
    return {
      ok: false,
      status: 403,
      error: `not linked to '${name}' — draw a link between the two terminals on the canvas first`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      error: `'${name}' is ambiguous`,
      candidates: matches.map((m) => m.name),
    };
  }
  return { ok: true, session: matches[0] };
}

/** Where Claude Code writes a session's transcript: one JSONL per conversation,
 *  under a directory named after the project path with slashes flattened. */
function transcriptPath(s: SessionRow): string | null {
  if (!s.claude_session_id) return null;
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const slug = s.project_path.replace(/[/.]/g, "-");
  const file = path.join(configDir, "projects", slug, `${s.claude_session_id}.jsonl`);
  return fs.existsSync(file) ? file : null;
}

/** Flatten a Claude transcript into readable turns, newest last.
 *
 *  `summary` drops turns that are nothing but tool calls: they render as
 *  "[Bash]" with no content, and in a real session they are most of the lines —
 *  so a 20-line summary spent half its budget saying that work happened without
 *  saying what. `full` keeps them: there, knowing which tools ran is the point. */
function readTranscript(file: string, maxLines: number, toolsOnly: boolean): string {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: string[] = [];
  for (const raw of lines) {
    let ev: {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    try {
      ev = JSON.parse(raw);
    } catch {
      continue;
    }
    const role = ev.message?.role;
    if (ev.type !== "user" && ev.type !== "assistant") continue;
    const content = ev.message?.content;
    let text = "";
    let prose = "";
    if (typeof content === "string") {
      text = content;
      prose = content;
    } else if (Array.isArray(content)) {
      const blocks = content as { type?: string; text?: string; name?: string }[];
      prose = blocks
        .filter((b) => b?.type === "text")
        .map((b) => b.text ?? "")
        .join(" ");
      text = blocks
        .map((b) => (b?.type === "text" ? (b.text ?? "") : b?.type === "tool_use" ? `[${b.name}]` : ""))
        .filter(Boolean)
        .join(" ");
    }
    prose = prose.replace(/\s+/g, " ").trim();
    text = text.replace(/\s+/g, " ").trim();
    if (toolsOnly && !prose) continue; // a turn that only ran tools says nothing
    const line = toolsOnly ? prose : text;
    if (line) out.push(`${role === "user" ? "user" : "agent"}: ${line}`);
  }
  return out.slice(-maxLines).join("\n");
}

const stripAnsi = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, "");

export async function peekRoutes(app: FastifyInstance) {
  /** `agora peek` with no target: who am I allowed to read? */
  app.get("/api/hooks/peek", async (req, reply) => {
    const { session, target, mode, lines } = req.query as {
      session?: string;
      target?: string;
      mode?: string;
      lines?: string;
    };
    // "me" decides which links apply, so a caller naming someone else would
    // borrow their neighbours — read AND send
    const me = actingSession(req, session);
    if (!me) return reply.code(404).send({ error: "unknown session" });
    const linked = linkedSessionIds(me.project_path, me.id);

    if (!target) {
      return {
        linked: [...linked]
          .map((id) => sessions.get(id))
          .filter((s): s is SessionRow => !!s)
          .map((s) => ({
            name: s.name,
            harness: s.harness,
            state: s.agent_state,
            status: s.status,
            summary: s.last_summary,
          })),
      };
    }

    const resolved = resolveLinked(me, target);
    if (!resolved.ok) {
      return reply
        .code(resolved.status)
        .send({ error: resolved.error, ...(resolved.candidates ? { candidates: resolved.candidates } : {}) });
    }
    const s = resolved.session;
    const n = Math.min(400, Math.max(1, Number(lines) || (mode === "transcript" ? 200 : 20)));

    if (mode === "terminal") {
      const pane = await tmux.capturePane(s.id, 200).catch(() => "");
      const text = stripAnsi(pane)
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .filter((l) => l.trim())
        .slice(-n)
        .join("\n");
      return { name: s.name, mode: "terminal", text };
    }

    const file = transcriptPath(s);
    if (!file) {
      return {
        name: s.name,
        mode: "transcript",
        text: "",
        note: `no transcript for ${s.name} yet (its harness is ${s.harness}); try --terminal`,
      };
    }
    const summary = mode !== "transcript";
    return {
      name: s.name,
      mode: summary ? "summary" : "transcript",
      text: readTranscript(file, n, summary),
    };
  });
}
