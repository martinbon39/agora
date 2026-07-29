import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type AgoraNotification, type PresencePeer, type Project, type Session } from "./api";
import { serverEvents, tabClientId } from "./events";
import { useCurrentUser } from "./auth/userContext";
import { enablePush, pushEnabled, pushSupported, registerServiceWorker } from "./push";
import { TopBar } from "./components/TopBar";
import { WallView } from "./components/WallView";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { CommandPalette } from "./components/CommandPalette";
import { Home } from "./components/Home";
import { TooltipProvider } from "./components/ui/tooltip";
import type { CanvasHandle } from "./canvas/CanvasView";

// xterm + terminal chrome only load when a session is opened
const SessionView = lazy(() =>
  import("./components/SessionView").then((m) => ({ default: m.SessionView }))
);
// the canvas pulls react-flow + xterm — desktop only, loaded on demand
const CanvasView = lazy(() => import("./canvas/CanvasView"));

const STATE_RANK: Record<Session["agent_state"], number> = {
  needs_approval: 0,
  working: 1,
  idle: 2,
  unknown: 3,
};

function sessionIdFromHash(): string | null {
  return location.hash.match(/^#\/session\/([\w-]+)/)?.[1] ?? null;
}

export default function App() {
  const [sessionList, setSessionList] = useState<Session[]>([]);
  // canvas reconciliation must wait for the FIRST real session list
  const [sessionsReady, setSessionsReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(sessionIdFromHash());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifState, setNotifState] = useState<"off" | "on" | "unsupported">("unsupported");
  const [inbox, setInbox] = useState<AgoraNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  // one canvas PER PROJECT, every device — CanvasView adapts to touch
  const canvasRef = useRef<CanvasHandle>(null);
  const [activeCanvas, setActiveCanvasState] = useState<string | null>(() =>
    localStorage.getItem("agora.activeCanvas") ?? localStorage.getItem("agora.activeCanvas")
  );
  // session to center on right after a canvas switch (remount) settles
  const [canvasFocus, setCanvasFocus] = useState<string | null>(null);
  // multiplayer: who else is live on the ACTIVE project (self excluded)
  const user = useCurrentUser();
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const setActiveCanvas = useCallback((projectPath: string) => {
    setActiveCanvasState(projectPath);
    localStorage.setItem("agora.activeCanvas", projectPath);
  }, []);
  const activeCanvasRef = useRef(activeCanvas);
  activeCanvasRef.current = activeCanvas;

  // a scoped guest lives on ONE canvas: force it, whatever localStorage says
  const guestProject = user?.role === "guest" ? (user.project ?? null) : null;
  useEffect(() => {
    if (guestProject && activeCanvas !== guestProject) setActiveCanvas(guestProject);
  }, [guestProject, activeCanvas, setActiveCanvas]);

  // Virtual-keyboard-aware height: dvh does NOT shrink when the keyboard opens
  // (iOS especially), leaving the terminal's input line hidden behind it. Track
  // the visual viewport instead; the meta interactive-widget=resizes-content
  // covers Android, this covers the rest.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      document.documentElement.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    history.replaceState(null, "", id ? `/#/session/${id}` : "/");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [{ sessions }, { projects }] = await Promise.all([
        api.listSessions(),
        api.listProjects(),
      ]);
      setSessionList(sessions);
      setProjects(projects);
      setSessionsReady(true);
    } catch (e) {
      toast.error("Lost connection to the server", { id: "refresh", description: String(e) });
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    api.listNotifications()
      .then(({ notifications, unread }) => {
        setInbox(notifications);
        setUnread(unread);
      })
      .catch(() => {});
    const timer = setInterval(refresh, 10000);

    registerServiceWorker().then(async () => {
      if (!pushSupported()) return;
      setNotifState((await pushEnabled()) ? "on" : "off");
    });

    const onHash = () => setActiveIdState(sessionIdFromHash());
    window.addEventListener("hashchange", onHash);

    let ws: WebSocket | null = null;
    let closed = false;
    // Self-reloading UI: every deploy restarts the server, which drops and
    // re-opens this socket — compare the build fingerprint on each (re)connect
    // and reload when it changed. No more manual F5 after a deploy.
    let knownBuild: string | null = null;
    const checkVersion = async () => {
      try {
        const { build } = await (await fetch("/api/version")).json();
        if (knownBuild === null) knownBuild = build;
        else if (build !== knownBuild) {
          toast("agora updated — reloading…", { id: "reload" });
          setTimeout(() => location.reload(), 600);
        }
      } catch {}
    };
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          serverEvents.emit(msg); // fan out to feature views (canvas sync…)
          if (msg.type === "session_state") {
            setSessionList((list) =>
              list.map((s) => (s.id === msg.id ? { ...s, agent_state: msg.agent_state } : s))
            );
          } else if (msg.type === "sessions_changed") {
            refreshRef.current();
          } else if (msg.type === "notification") {
            const n = msg.notification as AgoraNotification;
            setInbox((list) => [n, ...list]);
            setUnread((u) => u + 1);
            toast(n.title, {
              description: n.body || undefined,
              action: n.link
                ? { label: "Open", onClick: () => window.open(n.link!, "_blank") }
                : undefined,
            });
          } else if (msg.type === "notifications_read") {
            // another tab/device: keep the badge in sync
            setUnread(0);
          } else if (msg.type === "presence") {
            if (msg.project === activeCanvasRef.current) {
              const all = (msg.peers as PresencePeer[]) ?? [];
              setPeers(all.filter((p) => p.clientId !== tabClientId));
            }
          }
        } catch {}
      };
      ws.onopen = () => {
        checkVersion();
        const sock = ws!;
        serverEvents.setSender((msg) => {
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
        });
        // join the presence room of the project on screen
        serverEvents.send({
          type: "hello",
          clientId: tabClientId,
          project: activeCanvasRef.current,
        });
      };
      ws.onclose = () => {
        serverEvents.setSender(null);
        setPeers([]);
        if (!closed) setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearInterval(timer);
      window.removeEventListener("hashchange", onHash);
      ws?.close();
    };
  }, [refresh]);

  // switching projects = switching presence rooms
  useEffect(() => {
    setPeers([]);
    serverEvents.send({ type: "hello", clientId: tabClientId, project: activeCanvas });
  }, [activeCanvas]);

  const createSession = async (body: {
    name?: string;
    projectPath?: string;
    harness: string;
    text?: string;
    model?: string;
    mode?: string;
  }) => {
    try {
      const { session } = await api.createSession(body);
      await refresh();
      openOnCanvas(session.id, session.project_path);
    } catch (e) {
      toast.error("Could not create the session", { description: String(e) });
    }
  };

  // desktop: land on the session's project canvas, centered on its node.
  // Same canvas → animate to it; other canvas → switch (remount) + deferred focus.
  const openOnCanvas = (sessionId: string, projectPath: string) => {
    if (projectPath !== activeCanvas) {
      setActiveCanvas(projectPath);
      setCanvasFocus(sessionId);
    } else {
      canvasRef.current?.focusSession(sessionId);
    }
  };

  // the ONLY delete door in the UI — lives in the ArchiveTray, behind a confirm
  const removeSession = async (id: string) => {
    await api.deleteSession(id).catch((e) =>
      toast.error("Delete failed", { description: String(e) })
    );
    if (activeId === id) setActiveId(null);
    refresh();
  };

  const archiveSession = async (id: string) => {
    await api
      .archiveSession(id)
      .catch((e) => toast.error("Archive failed", { description: String(e) }));
    if (activeId === id) setActiveId(null);
    refresh();
  };

  const unarchiveSession = async (id: string) => {
    await api.unarchiveSession(id).catch((e) =>
      toast.error("Could not restore the session", { description: String(e) })
    );
    refresh();
  };

  // opening an archived session revives it first (tmux is dead)
  const openSession = async (id: string) => {
    const s = sessionList.find((x) => x.id === id);
    if (s && s.archived_at != null) {
      await api.unarchiveSession(id).catch(() => {});
      await refresh();
    }
    if (s) openOnCanvas(id, s.project_path);
  };

  const markInboxRead = useCallback(() => {
    setUnread(0);
    setInbox((list) =>
      list.map((n) => (n.read_at === null ? { ...n, read_at: Date.now() } : n))
    );
    api.markNotificationsRead().catch(() => {});
  }, []);

  const enableNotifs = () =>
    enablePush()
      .then(() => {
        setNotifState("on");
        toast.success("Notifications enabled");
      })
      .catch((e) => toast.error("Notifications denied", { description: String(e) }));

  const active = sessionList.find((s) => s.id === activeId);

  // desktop: pick a canvas once data arrives — the #/session/… deep link wins
  // ONCE at load (later switches go through openSession), then the remembered
  // project, then the most recent session's project
  const hashHandledRef = useRef(false);
  useEffect(() => {
    if (guestProject) return; // forced above — nothing to auto-pick
    if (!hashHandledRef.current && activeId) {
      const hashSession = sessionList.find((s) => s.id === activeId);
      if (hashSession) {
        hashHandledRef.current = true;
        if (hashSession.project_path !== activeCanvas) {
          setActiveCanvas(hashSession.project_path);
          setCanvasFocus(hashSession.id);
        }
        return;
      }
    }
    // no canvas yet, or a remembered project that no longer exists anywhere
    const known = new Set<string>([
      ...sessionList.map((s) => s.project_path),
      ...projects.map((p) => p.path),
    ]);
    if (!activeCanvas || (known.size > 0 && !known.has(activeCanvas))) {
      const first =
        sessionList.find((s) => s.archived_at == null)?.project_path ?? projects[0]?.path;
      if (first) setActiveCanvas(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, projects, activeCanvas, setActiveCanvas]);

  // approvals first, then running by recent activity, exited last
  const sorted = useMemo(
    () =>
      [...sessionList].sort((a, b) => {
        if ((a.status === "exited") !== (b.status === "exited"))
          return a.status === "exited" ? 1 : -1;
        if (STATE_RANK[a.agent_state] !== STATE_RANK[b.agent_state])
          return STATE_RANK[a.agent_state] - STATE_RANK[b.agent_state];
        return b.last_activity - a.last_activity;
      }),
    [sessionList]
  );

  // tab title + favicon reflect attention state
  const pendingCount = sessionList.filter(
    (s) => s.status === "running" && s.archived_at == null && s.agent_state === "needs_approval"
  ).length;
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) agora` : (active?.name ?? "agora");
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = pendingCount > 0 ? "/icon-alert.svg" : "/icon.svg";
  }, [pendingCount, active?.name]);

  // "new session": launch directly, or open the composer (Home on mobile,
  // dialog on the canvas)
  const quickCreate = (harness?: string) => {
    canvasRef.current?.newSession(harness ?? "claude");
  };

  return (
    <TooltipProvider delay={350}>
      <div className="flex h-[var(--app-height,100dvh)] min-h-0 flex-col">
        <TopBar
          projects={projects}
          sessions={sessionList}
          activeProject={activeCanvas}
          notifications={inbox}
          unread={unread}
          onMarkRead={markInboxRead}
          onOpenProject={setActiveCanvas}
          onNewProject={() => setNewProjectOpen(true)}
          onOpenSession={openSession}
          onPalette={() => setPaletteOpen(true)}
          notifState={notifState}
          onEnableNotifs={enableNotifs}
          onRestoreSession={openSession}
          onDeleteSession={removeSession}
          wallOpen={wallOpen}
          onToggleWall={() => setWallOpen((o) => !o)}
          user={user}
          peers={peers}
        />

        <AnimatePresence>
          {wallOpen && (
            <WallView
              onOpenSession={openSession}
              onClose={() => setWallOpen(false)}
            />
          )}
        </AnimatePresence>

        <main className="min-h-0 min-w-0 flex-1">
          {activeCanvas ? (
              <Suspense fallback={null}>
                <CanvasView
                  key={activeCanvas}
                  ref={canvasRef}
                  canvasId={activeCanvas}
                  sessions={sessionList}
                  sessionsReady={sessionsReady}
                  projects={projects}
                  onProjectsChanged={refresh}
                  onCreateSession={(body) => createSession(body as Parameters<typeof createSession>[0])}
                  onArchiveSession={archiveSession}
                  onOpenSession={openSession}
                  initialFocusSessionId={canvasFocus}
                  peers={peers}
                />
              </Suspense>
          ) : (
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div
                key={active.id}
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <Suspense fallback={null}>
                  <SessionView
                    session={active}
                    onBack={() => setActiveId(null)}
                    onClose={() => {
                      setActiveId(null);
                      refresh();
                    }}
                  />
                </Suspense>
              </motion.div>
            ) : (
              <motion.div
                key="home"
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <Home
                  projects={projects}
                  onProjectsChanged={refresh}
                  onLaunch={({ projectPath, text, model, mode, harness }) =>
                    createSession({ harness, projectPath, text, model, mode })
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </main>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={(path) => {
          refresh();
          setActiveCanvas(path);
        }}
      />

      <CommandPalette
        open={paletteOpen}
        sessions={sorted}
        onOpenChange={setPaletteOpen}
        onOpenSession={openSession}
        onNewSession={quickCreate}
        onCanvas={
          !activeCanvas
            ? undefined
            : (action) => {
                if (action === "fit") canvasRef.current?.fitView();
                else canvasRef.current?.addNode(action);
              }
        }
      />
    </TooltipProvider>
  );
}
