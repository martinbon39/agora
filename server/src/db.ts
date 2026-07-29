import Database from "better-sqlite3";
import fs from "node:fs";
import { config, dbPath, logsDir } from "./config.js";

export interface SessionRow {
  id: string;
  name: string;
  /** Project this session belongs to: its working directory, its canvas, its
   *  chat board and the guest scope all key off this. */
  project_path: string;
  harness: string;
  command: string;
  status: "running" | "exited";
  agent_state: "unknown" | "idle" | "working" | "needs_approval";
  created_at: number;
  last_activity: number;
  claude_session_id?: string | null;
  archived_at?: number | null;
  pinned?: number;
  total_cost?: number;
  last_summary?: string | null;
  /** Session that spawned this one via `argos spawn` (canvas edge). */
  parent_id?: string | null;
}

let db: Database.Database;

export function initDb(): Database.Database {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      harness TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      agent_state TEXT NOT NULL DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      last_activity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_cursors (
      session_id TEXT PRIMARY KEY,
      last_id INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      author TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canvas (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_settings (
      project_path TEXT PRIMARY KEY,
      claude_account TEXT
    );
  `);
  for (const ddl of [
    `ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`,
    `ALTER TABLE sessions ADD COLUMN archived_at INTEGER`,
    `ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN total_cost REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN last_summary TEXT`,
    `ALTER TABLE sessions ADD COLUMN parent_id TEXT`,
    // set = a deliberate one-to-one interruption (`argos ask`), null = the board
    `ALTER TABLE chat_messages ADD COLUMN to_session TEXT`,
  ]) {
    try {
      db.exec(ddl);
    } catch {
      // column already exists
    }
  }
  dropChatFeature();
  return db;
}

/** The chat harness is gone: clear its sessions and tables from older DBs. */
function dropChatFeature() {
  db.exec(`
    DELETE FROM sessions WHERE harness = 'claude-chat';
    DROP TABLE IF EXISTS chat_events;
    DROP TABLE IF EXISTS chat_queue;
    DROP TABLE IF EXISTS chat_fts;
  `);
}

export const sessions = {
  insert(row: SessionRow) {
    db.prepare(
      `INSERT INTO sessions (id, name, project_path, harness, command, status, agent_state, created_at, last_activity, claude_session_id, parent_id)
       VALUES (@id, @name, @project_path, @harness, @command, @status, @agent_state, @created_at, @last_activity, @claude_session_id, @parent_id)`
    ).run({ claude_session_id: null, parent_id: null, ...row });
  },
  all(): SessionRow[] {
    return db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`).all() as SessionRow[];
  },
  get(id: string): SessionRow | undefined {
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  },
  setStatus(id: string, status: SessionRow["status"]) {
    db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(status, id);
  },
  setAgentState(id: string, state: SessionRow["agent_state"]) {
    db.prepare(`UPDATE sessions SET agent_state = ?, last_activity = ? WHERE id = ?`).run(
      state,
      Date.now(),
      id
    );
  },
  touch(id: string) {
    db.prepare(`UPDATE sessions SET last_activity = ? WHERE id = ?`).run(Date.now(), id);
  },
  remove(id: string) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  },
  setClaudeSessionId(id: string, claudeId: string) {
    db.prepare(`UPDATE sessions SET claude_session_id = ? WHERE id = ?`).run(claudeId, id);
  },
  rename(id: string, name: string) {
    db.prepare(`UPDATE sessions SET name = ? WHERE id = ?`).run(name, id);
  },
  clearClaudeSession(id: string) {
    db.prepare(`UPDATE sessions SET claude_session_id = NULL WHERE id = ?`).run(id);
  },
  setArchived(id: string, ts: number | null) {
    db.prepare(`UPDATE sessions SET archived_at = ? WHERE id = ?`).run(ts, id);
  },
  setPinned(id: string, pinned: boolean) {
    db.prepare(`UPDATE sessions SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id);
  },
  addCost(id: string, usd: number) {
    db.prepare(`UPDATE sessions SET total_cost = total_cost + ? WHERE id = ?`).run(usd, id);
  },
  setSummary(id: string, summary: string | null) {
    db.prepare(`UPDATE sessions SET last_summary = ? WHERE id = ?`).run(summary, id);
  },
};

/** Per-project preferences. Today: which Claude account its agents sign in as
 *  — an identity belongs to a body of work, not to one terminal. */
export const projectSettings = {
  account(project_path: string): string | null {
    const row = db
      .prepare(`SELECT claude_account FROM project_settings WHERE project_path = ?`)
      .get(project_path) as { claude_account: string | null } | undefined;
    return row?.claude_account ?? null;
  },
  setAccount(project_path: string, account: string | null) {
    db.prepare(
      `INSERT INTO project_settings (project_path, claude_account) VALUES (?, ?)
       ON CONFLICT(project_path) DO UPDATE SET claude_account = excluded.claude_account`
    ).run(project_path, account);
  },
  all(): Record<string, string | null> {
    const rows = db.prepare(`SELECT project_path, claude_account FROM project_settings`).all() as {
      project_path: string;
      claude_account: string | null;
    }[];
    return Object.fromEntries(rows.map((r) => [r.project_path, r.claude_account]));
  },
};


export interface ChatMessageRow {
  id: number;
  project_path: string;
  author: string;
  harness: string;
  body: string;
  created_at: number;
  /** Session this was addressed to (`argos ask`); null = a board message. */
  to_session?: string | null;
  /** Display name of that session, joined for the UI. */
  to_name?: string | null;
}

/** Agent messaging, because agents are not people in a Slack: every message
 *  they receive costs them a turn and pulls them off their task.
 *
 *  - PROJECT BOARD (to_session null) — announcements across the project. Read,
 *    never pushed. Pushing these is what used to derail everyone.
 *  - DIRECT (to_session set) — one named session, deliberately interrupted.
 *    Recorded on the board too, so the fleet's traffic has one visible trace. */
export const chat = {
  insert(m: {
    project_path: string;
    author: string;
    harness: string;
    body: string;
    to_session?: string | null;
  }): ChatMessageRow {
    const created_at = Date.now();
    const to_session = m.to_session ?? null;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO chat_messages (project_path, author, harness, body, created_at, to_session)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(m.project_path, m.author, m.harness, m.body, created_at, to_session);
    return { id: Number(lastInsertRowid), ...m, to_session, created_at };
  },
  /** Messages this session hasn't seen yet (its own excluded); advances the
   *  read cursor, so every message is delivered exactly once. */
  takeUnread(sessionId: string, project_path: string, author: string): ChatMessageRow[] {
    const cursor =
      (db.prepare(`SELECT last_id FROM chat_cursors WHERE session_id = ?`).get(sessionId) as
        | { last_id: number }
        | undefined)?.last_id ?? 0;
    // What may INTERRUPT this session when it finishes a turn. Deliberately
    // narrower than what it may read: another agent's board announcement is
    // never pushed here — pushing them is what turned a project full of
    // unrelated agents into one conversation that pulled everyone off task.
    const rows = db
      .prepare(
        `SELECT * FROM chat_messages
          WHERE project_path = ? AND id > ? AND author != ?
            AND (
                  to_session = ?                       -- addressed to me
              OR (to_session IS NULL AND harness = 'user')  -- the owner speaking
            )
          ORDER BY id ASC LIMIT 50`
      )
      .all(project_path, cursor, author, sessionId) as ChatMessageRow[];
    if (rows.length) this.advanceCursor(sessionId, rows[rows.length - 1].id);
    return rows;
  },
  advanceCursor(sessionId: string, lastId: number) {
    db.prepare(
      `INSERT INTO chat_cursors (session_id, last_id) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET last_id = MAX(chat_cursors.last_id, excluded.last_id)`
    ).run(sessionId, lastId);
  },
  /** The project board — announcements plus the trace of every `argos ask`.
   *  The recipient's name is joined in so it can render "eos -> hecate". */
  board(project_path: string, limit = 200): ChatMessageRow[] {
    return db
      .prepare(
        `SELECT * FROM (
           SELECT m.*, s.name AS to_name
             FROM chat_messages m LEFT JOIN sessions s ON s.id = m.to_session
            WHERE m.project_path = ?
            ORDER BY m.id DESC LIMIT ?
         ) ORDER BY id ASC`
      )
      .all(project_path, limit) as ChatMessageRow[];
  },
};

/** Canvas layout document (nodes, positions, viewport) — one JSON blob per id. */
export const canvas = {
  get(id = "default"): { data: string | null; rev: number } {
    const row = db.prepare(`SELECT data, rev FROM canvas WHERE id = ?`).get(id) as
      | { data: string; rev: number }
      | undefined;
    return row ?? { data: null, rev: 0 };
  },
  put(id: string, data: string): number {
    db.prepare(
      `INSERT INTO canvas (id, data, rev, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, rev = canvas.rev + 1, updated_at = excluded.updated_at`
    ).run(id, data, Date.now());
    return (db.prepare(`SELECT rev FROM canvas WHERE id = ?`).get(id) as { rev: number }).rev;
  },
};

export interface NotificationRow {
  id: number;
  session_id: string | null;
  title: string;
  body: string;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

export const notifications = {
  insert(n: { session_id: string | null; title: string; body: string; link: string | null }): NotificationRow {
    const created_at = Date.now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO notifications (session_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(n.session_id, n.title, n.body, n.link, created_at);
    return { id: Number(lastInsertRowid), ...n, created_at, read_at: null };
  },
  recent(limit = 100): NotificationRow[] {
    return db
      .prepare(`SELECT * FROM notifications ORDER BY id DESC LIMIT ?`)
      .all(limit) as NotificationRow[];
  },
  unreadCount(): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL`).get() as {
      n: number;
    };
    return row.n;
  },
  markAllRead() {
    db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`).run(Date.now());
  },
};
