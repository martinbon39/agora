export interface Session {
  id: string;
  name: string;
  project_path: string;
  harness: string;
  command: string;
  status: "running" | "exited";
  agent_state: "unknown" | "idle" | "working" | "needs_approval";
  created_at: number;
  last_activity: number;
  archived_at?: number | null;
  pinned?: number;
  total_cost?: number;
  last_summary?: string | null;
  /** Session that spawned this one via `agora spawn` (canvas edge). */
  parent_id?: string | null;
}

/** A Claude Code identity: its own CLAUDE_CONFIG_DIR, sharing the harness. */
export interface ClaudeAccount {
  /** "" is the default account (the plain ~/.claude). */
  id: string;
  label: string;
  email: string | null;
  organization: string | null;
  plan: string | null;
  loggedIn: boolean;
  configDir: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface Project {
  name: string;
  path: string;
  git: string | null;
  branch: string | null;
  dirty: boolean;
}

/** Per-project agent chat message (agents post via `agora chat`). */
/** One task on the shared plan. The same rows the agents read with `agora plan`. */
export interface PlanTask {
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

export interface ChatMessage {
  id: number;
  project_path: string;
  author: string;
  harness: string;
  body: string;
  created_at: number;
  /** Set when this was addressed to one session (`agora ask`). */
  to_session?: string | null;
  to_name?: string | null;
}

/** Who is signed in: the owner, or an invited guest. */
export interface AuthUser {
  email: string;
  name: string;
  role: "owner" | "guest";
  color: string;
  /** Project path this user is confined to; null = the whole cockpit. */
  project: string | null;
}

/** A guest email on the allowlist (revoked entries kept for re-invite). */
export interface Invite {
  email: string;
  created_at: number;
  revoked_at: number | null;
  /** Project the invite is scoped to; null = full access. */
  project: string | null;
}

/** A connected human on the same project (from `presence` WS snapshots). */
export interface PresencePeer {
  clientId: string;
  user: AuthUser;
  /** Session id whose terminal they last focused, if any. */
  focus: string | null;
}

/** Message sent by an agent via `agora notify` (inbox + push). */
export interface AgoraNotification {
  id: number;
  session_id: string | null;
  title: string;
  body: string;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

export const api = {
  listFiles: (project: string, dir = "") =>
    fetch(
      `/api/files?project=${encodeURIComponent(project)}&dir=${encodeURIComponent(dir)}`
    ).then((r) => json<{ entries: { name: string; dir: boolean; size: number }[] }>(r)),
  readFile: (project: string, path: string) =>
    fetch(
      `/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`
    ).then((r) =>
      json<{ content: string; binary: boolean; truncated: boolean; size: number }>(r)
    ),
  uploadCanvasImage: (project: string, name: string, data: string) =>
    fetch("/api/canvas-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, name, data }),
    }).then((r) => json<{ src: string }>(r)),
  forkSession: (id: string) =>
    fetch(`/api/sessions/${id}/fork`, { method: "POST" }).then((r) =>
      json<{ session: Session; forkedConversation: boolean }>(r)
    ),
  sendToSession: (id: string, text: string) =>
    fetch(`/api/sessions/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => json<{ sent: boolean }>(r)),
  wall: () =>
    fetch("/api/wall").then((r) =>
      json<{
        sessions: {
          id: string;
          name: string;
          harness: string;
          project_path: string;
          agent_state: Session["agent_state"];
          preview: string;
        }[];
      }>(r)
    ),

  authMe: () =>
    fetch("/api/auth/me").then((r) =>
      json<{ authed: boolean; enrolled: boolean; google?: boolean; user?: AuthUser | null }>(r)
    ),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  listInvites: () => fetch("/api/invites").then((r) => json<{ invites: Invite[] }>(r)),
  addInvite: (email: string, project?: string | null) =>
    fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, project: project ?? null }),
    }).then((r) => json<{ ok: true; invites: Invite[] }>(r)),
  revokeInvite: (email: string) =>
    fetch(`/api/invites/${encodeURIComponent(email)}`, { method: "DELETE" }).then((r) =>
      json<{ ok: true; invites: Invite[] }>(r)
    ),
  listProjects: () =>
    fetch("/api/projects").then((r) => json<{ projects: Project[] }>(r)),
  createProject: (body: {
    name?: string;
    cloneUrl?: string;
    createRepo?: boolean;
    isPrivate?: boolean;
  }) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ project: Project }>(r)),
  listSessions: () =>
    fetch("/api/sessions").then((r) => json<{ sessions: Session[] }>(r)),
  createSession: (body: {
    name?: string;
    projectPath?: string;
    harness?: string;
    command?: string;
    text?: string;
    model?: string;
    mode?: string;
  }) =>
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ session: Session }>(r)),
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  renameSession: (id: string, name: string) =>
    fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<{ ok: true }>(r)),
  archiveSession: (id: string) =>
    fetch(`/api/sessions/${id}/archive`, { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  unarchiveSession: (id: string) =>
    fetch(`/api/sessions/${id}/unarchive`, { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  pinSession: (id: string, pinned: boolean) =>
    fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).then((r) => json<{ ok: true }>(r)),
  githubRepos: () =>
    fetch("/api/github/repos").then((r) =>
      json<{ repos: { nameWithOwner: string; description: string; updatedAt: string; isPrivate: boolean; url: string }[] }>(r)
    ),
  upload: (id: string, name: string, dataBase64: string) =>
    fetch(`/api/uploads/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: dataBase64 }),
    }).then((r) => json<{ path: string; url: string; pasteable?: boolean }>(r)),
  getCanvas: (id: string) =>
    fetch(`/api/canvas?id=${encodeURIComponent(id)}`).then((r) =>
      json<{ doc: import("./canvas/types").CanvasDoc | null; rev: number }>(r)
    ),
  putCanvas: (
    id: string,
    doc: import("./canvas/types").CanvasDoc,
    clientId: string,
    // ids this client touched/deleted since its last save — the server merges
    // per node instead of clobbering concurrent editors; omit = full replace
    dirty?: string[],
    removed?: string[]
  ) =>
    fetch("/api/canvas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, doc, clientId, dirty, removed }),
    }).then((r) => json<{ rev: number }>(r)),
  dictateStatus: () =>
    fetch("/api/dictate/status").then((r) => json<{ available: boolean }>(r)),
  dictate: (audioBase64: string, mime: string) =>
    fetch("/api/dictate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: audioBase64, mime }),
      signal: AbortSignal.timeout(45000), // a hung transcription must not wedge the mic UI
    }).then((r) => json<{ text: string }>(r)),
  spectateToken: (project: string) =>
    fetch(`/api/spectate?project=${encodeURIComponent(project)}`).then((r) =>
      json<{ token: string | null }>(r)
    ),
  setSpectate: (project: string, enabled: boolean) =>
    fetch("/api/spectate", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, enabled }),
    }).then((r) => json<{ token: string | null }>(r)),
  room: (project: string) =>
    fetch(`/api/room?project=${encodeURIComponent(project)}`).then((r) =>
      json<{
        deadline: number | null;
        remainingMs: number | null;
        expiresAt: number | null;
        expiredAt: number | null;
      }>(r)
    ),
  cost: (project: string) =>
    fetch(`/api/cost?project=${encodeURIComponent(project)}`).then((r) =>
      json<{
        total: {
          usd: number;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          unpricedTokens: number;
          unpricedModels: string[];
        };
        sessions: { id: string; name: string; usd: number }[];
      }>(r)
    ),
  planList: (project: string) =>
    fetch(`/api/plan?project=${encodeURIComponent(project)}`).then((r) =>
      json<{ tasks: PlanTask[] }>(r)
    ),
  planAdd: (project: string, title: string) =>
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, title }),
    }).then((r) => json<{ task: PlanTask }>(r)),
  planRemove: (project: string, id: number) =>
    fetch(`/api/plan/${id}?project=${encodeURIComponent(project)}`, { method: "DELETE" }).then((r) =>
      json<{ ok: true }>(r)
    ),
  chatList: (project: string) =>
    fetch(`/api/chat?project=${encodeURIComponent(project)}`).then((r) =>
      json<{ messages: ChatMessage[] }>(r)
    ),
  chatPost: (project: string, body: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, body }),
    }).then((r) => json<{ message: ChatMessage }>(r)),

  listAccounts: () =>
    fetch("/api/accounts").then((r) =>
      json<{ accounts: ClaudeAccount[]; byProject: Record<string, string | null> }>(r)
    ),
  createAccount: (label: string) =>
    fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }).then((r) => json<{ account: ClaudeAccount }>(r)),
  deleteAccount: (id: string) =>
    fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      json<{ ok: true }>(r)
    ),
  loginAccount: (id: string) =>
    fetch(`/api/accounts/${encodeURIComponent(id)}/login`, { method: "POST" }).then((r) =>
      json<{ session: Session; label: string }>(r)
    ),
  setProjectAccount: (project: string, account: string | null) =>
    fetch("/api/projects/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, account }),
    }).then((r) => json<{ ok: true; account: string | null }>(r)),
  listNotifications: () =>
    fetch("/api/notifications").then((r) =>
      json<{ notifications: AgoraNotification[]; unread: number }>(r)
    ),
  markNotificationsRead: () =>
    fetch("/api/notifications/read", { method: "POST" }).then((r) => json<{ ok: true }>(r)),
};
