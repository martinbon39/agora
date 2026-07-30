import crypto from "node:crypto";
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
  /** Session that spawned this one via `agora spawn` (canvas edge). */
  parent_id?: string | null;
  /** Per-session bearer for the hook channel. The `agora` CLI presents this
   *  instead of the one global secret, so a session can only act as itself. */
  hook_token?: string | null;
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
    -- Tenancy. argos had no users table: it had one owner, defined by an env
    -- var, plus an allowlist of guests. agora has tenants, so a project stops
    -- being "a directory whose name the client sent" and becomes a row with an
    -- owner. The path is still the key — every other table already scopes by
    -- project_path — but the row is now what says who it belongs to.
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_email);
    -- The shared plan: the one object humans and agents both read and write.
    -- The board is prose and append-only, which makes it easy to ignore; the
    -- failure it does not prevent is two agents independently building the same
    -- thing. A task can be HELD, by exactly one session, and that is the whole
    -- point of the table.
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      claimed_by_name TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plan_project ON plan_tasks(project_path);
  `);
  for (const ddl of [
    `ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`,
    `ALTER TABLE sessions ADD COLUMN archived_at INTEGER`,
    `ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN total_cost REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN last_summary TEXT`,
    `ALTER TABLE sessions ADD COLUMN parent_id TEXT`,
    // set = a deliberate one-to-one interruption (`agora ask`), null = the board
    `ALTER TABLE chat_messages ADD COLUMN to_session TEXT`,
    `ALTER TABLE sessions ADD COLUMN hook_token TEXT`,
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
      `INSERT INTO sessions (id, name, project_path, harness, command, status, agent_state, created_at, last_activity, claude_session_id, parent_id, hook_token)
       VALUES (@id, @name, @project_path, @harness, @command, @status, @agent_state, @created_at, @last_activity, @claude_session_id, @parent_id, @hook_token)`
    ).run({
      claude_session_id: null,
      parent_id: null,
      // minted here rather than at the call sites: every session must have one,
      // and a session created down some path that forgot would silently be
      // unable to use the fleet CLI
      hook_token: crypto.randomBytes(24).toString("base64url"),
      ...row,
    });
  },
  setHookToken(id: string, token: string) {
    db.prepare(`UPDATE sessions SET hook_token = ? WHERE id = ?`).run(token, id);
  },
  /** The session's hook bearer, minting one for rows that predate the column. */
  ensureHookToken(id: string): string {
    const row = this.get(id);
    if (row?.hook_token) return row.hook_token;
    const token = crypto.randomBytes(24).toString("base64url");
    this.setHookToken(id, token);
    return token;
  },
  /** Resolve a session from its hook bearer. The token IS the identity — no
   *  client-supplied session id is consulted. */
  byToken(token: string): SessionRow | undefined {
    if (!token) return undefined;
    return db.prepare(`SELECT * FROM sessions WHERE hook_token = ?`).get(token) as
      | SessionRow
      | undefined;
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
  /** Session this was addressed to (`agora ask`); null = a board message. */
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
  /** The project board — announcements plus the trace of every `agora ask`.
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

export interface UserRow {
  email: string;
  name: string;
  created_at: number;
  last_seen: number;
}

export interface ProjectRow {
  path: string;
  name: string;
  owner_email: string;
  created_at: number;
}

export const users = {
  /** Called on every successful sign-in: first one creates the tenant. */
  seen(email: string, name: string): UserRow {
    const now = Date.now();
    const e = email.toLowerCase();
    db.prepare(
      `INSERT INTO users (email, name, created_at, last_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen,
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END`
    ).run(e, name ?? "", now, now);
    return this.get(e)!;
  },
  get(email: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as
      | UserRow
      | undefined;
  },
  all(): UserRow[] {
    return db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as UserRow[];
  },
  count(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  },
};

export const projects = {
  /** The registry. A directory nobody registered belongs to nobody, and
   *  authorization refuses it — which is the point of the table existing. */
  insert(p: { path: string; name: string; owner_email: string }): ProjectRow {
    const row = { ...p, owner_email: p.owner_email.toLowerCase(), created_at: Date.now() };
    db.prepare(
      `INSERT INTO projects (path, name, owner_email, created_at)
       VALUES (@path, @name, @owner_email, @created_at)`
    ).run(row);
    return row;
  },
  get(projectPath: string): ProjectRow | undefined {
    return db.prepare(`SELECT * FROM projects WHERE path = ?`).get(projectPath) as
      | ProjectRow
      | undefined;
  },
  forOwner(email: string): ProjectRow[] {
    return db
      .prepare(`SELECT * FROM projects WHERE owner_email = ? ORDER BY created_at DESC`)
      .all(email.toLowerCase()) as ProjectRow[];
  },
  remove(projectPath: string) {
    db.prepare(`DELETE FROM projects WHERE path = ?`).run(projectPath);
  },
};

export interface PlanTaskRow {
  id: number;
  project_path: string;
  title: string;
  status: "open" | "claimed" | "done" | "blocked";
  claimed_by: string | null;
  claimed_by_name: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export const plan = {
  list(project_path: string): PlanTaskRow[] {
    return db
      .prepare(
        `SELECT * FROM plan_tasks WHERE project_path = ?
         ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'claimed' THEN 1
                              WHEN 'open' THEN 2 ELSE 3 END, id`
      )
      .all(project_path) as PlanTaskRow[];
  },
  get(id: number): PlanTaskRow | undefined {
    return db.prepare(`SELECT * FROM plan_tasks WHERE id = ?`).get(id) as PlanTaskRow | undefined;
  },
  add(project_path: string, title: string): PlanTaskRow {
    const now = Date.now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO plan_tasks (project_path, title, status, created_at, updated_at)
         VALUES (?, ?, 'open', ?, ?)`
      )
      .run(project_path, title, now, now);
    return this.get(Number(lastInsertRowid))!;
  },
  /**
   * Take a task, if it is takeable. One statement, and the caller checks whether
   * it changed a row.
   *
   * This is the only interesting query in the file. Read-then-write would let two
   * agents polling a second apart both see 'open' and both start working — which
   * is the exact failure the plan exists to prevent, so the check and the write
   * cannot be two statements. Re-claiming a task you already hold succeeds, so a
   * retry after a lost connection is not an error.
   */
  /** Take a task AND collect what the previous holder left behind, in one
   *  transaction.
   *
   *  Reading the note and clearing it have to be atomic with the claim itself.
   *  Doing the read just before the update happens to work — better-sqlite3 is
   *  synchronous and nothing awaits in between — but that is the code's shape
   *  holding the guarantee rather than the database, and the next edit breaks it
   *  without a sound. */
  claimWith(
    id: number,
    sessionId: string,
    sessionName: string
  ): { ok: boolean; inherited: string | null } {
    const run = db.transaction(() => {
      const before = this.get(id);
      const ok = this.claim(id, sessionId, sessionName);
      return { ok, inherited: ok ? (before?.note ?? null) : null };
    });
    return run();
  },
  claim(id: number, sessionId: string, sessionName: string): boolean {
    const { changes } = db
      .prepare(
        // Parenthesised deliberately. Without the inner brackets, AND binding
        // tighter than OR still happens to give the right answer here, which is
        // the worst kind of correct: the next edit breaks it silently.
        // A blocked task IS claimable by someone else — blocked means the holder
        // cannot proceed, so being taken over is the useful outcome.
        `UPDATE plan_tasks
            SET status = 'claimed', claimed_by = @sid, claimed_by_name = @name,
                note = NULL, updated_at = @now
          WHERE id = @id
            AND status != 'done'
            AND (status IN ('open', 'blocked') OR claimed_by = @sid)`
      )
      .run({ id, sid: sessionId, name: sessionName, now: Date.now() });
    return changes > 0;
  },
  /** Release a claim without finishing. */
  drop(id: number, sessionId: string): boolean {
    const { changes } = db
      .prepare(
        `UPDATE plan_tasks SET status = 'open', claimed_by = NULL, claimed_by_name = NULL,
                updated_at = ? WHERE id = ? AND claimed_by = ?`
      )
      .run(Date.now(), id, sessionId);
    return changes > 0;
  },
  /** Finish a task, optionally leaving behind what the next person needs to know.
   *
   *  The note lives on the TASK rather than being sent to somebody, because the
   *  reader usually does not exist yet: `agora send` needs a live linked session,
   *  and what a holder learned has to survive its own session ending. Whoever
   *  claims this task next inherits it. */
  finish(id: number, sessionId: string, note?: string): boolean {
    const { changes } = db
      .prepare(
        `UPDATE plan_tasks
            SET status = 'done', updated_at = @now,
                note = COALESCE(@note, note)
          WHERE id = @id AND claimed_by = @sid`
      )
      .run({ id, sid: sessionId, now: Date.now(), note: note?.slice(0, 500) ?? null });
    return changes > 0;
  },
  block(id: number, sessionId: string, note: string): boolean {
    const { changes } = db
      .prepare(
        `UPDATE plan_tasks SET status = 'blocked', note = ?, updated_at = ?
          WHERE id = ? AND claimed_by = ?`
      )
      .run(note.slice(0, 500), Date.now(), id, sessionId);
    return changes > 0;
  },
  remove(id: number, project_path: string) {
    db.prepare(`DELETE FROM plan_tasks WHERE id = ? AND project_path = ?`).run(id, project_path);
  },
};
