import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { HarnessIcon } from "./HarnessIcon";

type WallEntry = Awaited<ReturnType<typeof api.wall>>["sessions"][number];

const STATE_DOT: Record<string, string> = {
  needs_approval: "bg-amber-400",
  working: "bg-sky-400 animate-status-pulse",
  idle: "bg-emerald-400",
  unknown: "bg-zinc-500",
};

function projectName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? "~";
}

/** Full-screen Panoptes view: every live session on the server as a live pane
 *  preview, grouped by project. Click a card → jump to that session on its
 *  project canvas. The hundred eyes, half of them always open. */
export function WallView({
  onOpenSession,
  onClose,
}: {
  onOpenSession: (id: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<WallEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      api
        .wall()
        .then(({ sessions }) => !cancelled && setEntries(sessions))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const byProject = new Map<string, WallEntry[]>();
  for (const e of entries) {
    const list = byProject.get(e.project_path);
    if (list) list.push(e);
    else byProject.set(e.project_path, [e]);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 top-11 z-30 overflow-y-auto bg-background/95 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-6">
        {entries.length === 0 && (
          <p className="pt-24 text-center text-sm text-muted-foreground">
            no live sessions — the watcher is bored
          </p>
        )}
        {[...byProject.entries()].map(([project, list]) => (
          <section key={project}>
            <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold tracking-tight">
              {projectName(project)}
              <span className="text-[11px] font-normal text-muted-foreground/70">
                {list.length} session{list.length > 1 ? "s" : ""}
              </span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {list.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    onOpenSession(e.id);
                    onClose();
                  }}
                  className="group flex h-52 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/60 text-left shadow-sm transition-all hover:border-ring/60 hover:shadow-md"
                >
                  <span className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
                    <HarnessIcon harness={e.harness} size={13} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{e.name}</span>
                    <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[e.agent_state])} />
                  </span>
                  <pre className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-all p-2.5 font-mono text-[9px] leading-[1.4] text-muted-foreground transition-colors group-hover:text-foreground/80">
                    {e.preview || "…"}
                  </pre>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </motion.div>
  );
}
