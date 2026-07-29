import { useMemo } from "react";
import { BellIcon, EyeIcon, FolderPlusIcon, LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type ArgosNotification, type AuthUser, type PresencePeer, type Project, type Session } from "@/api";
import { Logo } from "./Logo";
import { Inbox } from "./Inbox";
import { ArchiveTray } from "./ArchiveTray";
import { SharePanel } from "./SharePanel";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { AccountPicker } from "./AccountPicker";

function projectName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? "~";
}

/** Rolled-up state of a project: the loudest thing happening inside it.
 *  One dot per project replaces the per-session list — individual terminals
 *  live on the canvas, the bar only says which projects want attention. */
type Rollup = { dot: string; pulse: boolean; label: string };

function rollup(sessions: Session[]): Rollup {
  const live = sessions.filter((s) => s.status === "running" && s.archived_at == null);
  const n = (state: Session["agent_state"]) => live.filter((s) => s.agent_state === state).length;
  const pending = n("needs_approval");
  if (pending)
    return {
      dot: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
      label: `${pending} waiting on you`,
    };
  const working = n("working");
  if (working)
    return {
      dot: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
      label: `${working} working`,
    };
  if (live.length)
    return {
      dot: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
      label: `${live.length} idle`,
    };
  return { dot: "bg-muted-foreground/35", pulse: false, label: "no sessions" };
}

/** Minimal top bar: the product mark, one pill per project, nothing else.
 *  Replaces the session sidebar — the canvas owns the full viewport below. */
export function TopBar({
  projects,
  sessions,
  activeProject,
  notifications,
  unread,
  onMarkRead,
  onOpenProject,
  onNewProject,
  onOpenSession,
  onPalette,
  notifState,
  onEnableNotifs,
  onRestoreSession,
  onDeleteSession,
  wallOpen,
  onToggleWall,
  user,
  peers,
}: {
  projects: Project[];
  sessions: Session[];
  activeProject: string | null;
  notifications: ArgosNotification[];
  unread: number;
  onMarkRead: () => void;
  onOpenProject: (path: string) => void;
  onNewProject: () => void;
  onOpenSession: (id: string) => void;
  onPalette: () => void;
  notifState: "off" | "on" | "unsupported";
  onEnableNotifs: () => void;
  onRestoreSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  wallOpen: boolean;
  onToggleWall: () => void;
  user: AuthUser | null;
  peers: PresencePeer[];
}) {
  // scoped guest: one project is their whole world — no nav, no wall, no inbox
  const locked = user?.role === "guest" && !!user.project;
  // Pills = ACTIVE projects only (>=1 non-archived session) plus the one on
  // screen. Everything else waits in the + menu — the bar is a working set,
  // not a directory listing.
  const paths = useMemo(() => {
    const seen = new Set(
      sessions.filter((s) => s.archived_at == null).map((s) => s.project_path)
    );
    if (activeProject) seen.add(activeProject);
    return [...seen].sort((a, b) => projectName(a).localeCompare(projectName(b)));
  }, [sessions, activeProject]);

  // the rest of the projects on disk, openable on demand
  const dormant = useMemo(
    () =>
      projects
        .map((p) => p.path)
        .filter((p) => !paths.includes(p))
        .sort((a, b) => projectName(a).localeCompare(projectName(b))),
    [projects, paths]
  );

  const byProject = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const list = map.get(s.project_path);
      if (list) list.push(s);
      else map.set(s.project_path, [s]);
    }
    return map;
  }, [sessions]);

  return (
    <header className="relative z-40 flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-3 backdrop-blur-xl">
      <div className="flex shrink-0 items-center gap-2 pl-0.5 pr-1">
        <Logo className="size-4 text-foreground" />
        <span className="text-sm font-medium tracking-tight max-sm:sr-only">argos</span>
        {!locked && <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onToggleWall}
                aria-label="Panoptes"
                aria-pressed={wallOpen}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  wallOpen
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <EyeIcon className="size-4" />
              </button>
            }
          />
          <TooltipPopup side="bottom">Panoptes — every session, every project</TooltipPopup>
        </Tooltip>}
      </div>

      {locked ? (
        <div className="flex min-w-0 flex-1 items-center">
          <span className="flex items-center gap-2 rounded-full bg-accent/40 px-3 py-1 text-xs font-medium">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            {projectName(user!.project!)}
            <span className="text-[10px] font-normal text-muted-foreground">shared canvas</span>
          </span>
        </div>
      ) : (
      <nav
        aria-label="Projects"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent/40 p-1">
          {paths.map((path) => {
            const state = rollup(byProject.get(path) ?? []);
            const active = path === activeProject;
            return (
              <Tooltip key={path}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => onOpenProject(path)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          state.dot,
                          state.pulse && "animate-status-pulse"
                        )}
                      />
                      <span className={cn("max-w-40 truncate", active && "font-medium")}>
                        {projectName(path)}
                      </span>
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{state.label}</TooltipPopup>
              </Tooltip>
            );
          })}
        </div>

        {/* Which Claude identity this project bills to. Owner-only, and next
            to the project it applies to — it is a property of the project. */}
        {activeProject && user?.role === "owner" && (
          <AccountPicker project={activeProject} className="ml-1" />
        )}

        <Menu>
          <MenuTrigger
            aria-label="Open a project"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PlusIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup side="bottom" align="start" className="max-h-80 min-w-44 overflow-y-auto">
            {dormant.map((path) => (
              <MenuItem key={path} onClick={() => onOpenProject(path)}>
                <span className="truncate">{projectName(path)}</span>
              </MenuItem>
            ))}
            {dormant.length > 0 && <MenuSeparator />}
            <MenuItem onClick={onNewProject}>
              <FolderPlusIcon className="size-3.5" />
              New project…
            </MenuItem>
          </MenuPopup>
        </Menu>
      </nav>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {/* who else is in the room right now */}
        {peers.length > 0 && (
          <div className="flex items-center -space-x-1.5 pr-1.5">
            {peers.slice(0, 5).map((p) => (
              <Tooltip key={p.clientId}>
                <TooltipTrigger
                  render={
                    <span
                      className="flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold"
                      style={{ background: p.user.color, color: "#1c1917" }}
                    >
                      {(p.user.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                  }
                />
                <TooltipPopup side="bottom">
                  {p.user.name} — online on this project
                </TooltipPopup>
              </Tooltip>
            ))}
          </div>
        )}
        {user?.role === "owner" && (
          <SharePanel peers={peers} projects={projects} activeProject={activeProject} />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onPalette}
                aria-label="Search sessions"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <SearchIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="bottom">
            Search sessions — archived ones too (⌘K)
          </TooltipPopup>
        </Tooltip>
        {!locked && (
          <ArchiveTray
            sessions={sessions}
            activeProject={activeProject}
            onRestore={onRestoreSession}
            onDelete={onDeleteSession}
          />
        )}
        {/* only door left to opt into web push now that the sidebar is gone */}
        {!locked && notifState === "off" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onEnableNotifs}
                  aria-label="Enable notifications"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <BellIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="bottom">Enable push notifications</TooltipPopup>
          </Tooltip>
        )}
        {!locked && (
          <Inbox
            notifications={notifications}
            unread={unread}
            onMarkRead={onMarkRead}
            onOpenSession={onOpenSession}
          />
        )}
        {/* own identity + the only logout door (guests borrow machines) */}
        {user && (
          <Menu>
            <MenuTrigger
              aria-label={`${user.name} — account`}
              className="ml-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold transition-transform hover:scale-105"
              style={{ background: user.color, color: "#1c1917" }}
            >
              {(user.name || "?").slice(0, 1).toUpperCase()}
            </MenuTrigger>
            <MenuPopup side="bottom" align="end" className="min-w-48">
              <div className="px-2.5 py-1.5">
                <p className="truncate text-xs font-medium">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user.email}
                  {user.role === "guest" ? " · guest" : ""}
                </p>
              </div>
              <MenuSeparator />
              <MenuItem
                onClick={() =>
                  api.logout().finally(() => {
                    location.hash = "";
                    location.reload();
                  })
                }
              >
                <LogOutIcon className="size-3.5" />
                Sign out
              </MenuItem>
            </MenuPopup>
          </Menu>
        )}
      </div>
    </header>
  );
}
