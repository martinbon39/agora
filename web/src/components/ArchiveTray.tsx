import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import type { Session } from "@/api";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { HarnessIcon } from "./HarnessIcon";

function projectName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? "~";
}

function timeAgoShort(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The archived/dead sessions' home. Archiving hides a session from the
 *  canvas — without this tray it was findable only through the ⌘K palette,
 *  which nobody thinks of. Restore puts the node back at its saved spot;
 *  delete (the only delete door in the UI) forgets it for good. */
export function ArchiveTray({
  sessions,
  activeProject,
  onRestore,
  onDelete,
}: {
  sessions: Session[];
  activeProject: string | null;
  /** Unarchive + focus its node on the project canvas. */
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const archived = useMemo(
    () =>
      [...sessions]
        .filter((s) => s.archived_at != null)
        .sort((a, b) => {
          // active project first, then most recently archived
          const ap = (a.project_path === activeProject ? 0 : 1) -
            (b.project_path === activeProject ? 0 : 1);
          return ap !== 0 ? ap : (b.archived_at ?? 0) - (a.archived_at ?? 0);
        }),
    [sessions, activeProject]
  );

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Archived sessions"
              className="relative"
              onClick={() => {
                setOpen((o) => !o);
                setConfirmId(null);
              }}
            >
              <ArchiveIcon className="size-4" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Archived sessions</TooltipPopup>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="absolute right-0 top-full z-50 mt-2 max-h-[420px] w-[320px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg"
            >
              {archived.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing here — archiving a session (from its node on the canvas)
                  files it in this drawer, restorable exactly as it was.
                </p>
              )}
              {archived.map((s) => (
                <div
                  key={s.id}
                  className="group flex w-full items-center gap-2 rounded-lg p-2 transition-colors hover:bg-accent/60"
                >
                  <HarnessIcon harness={s.harness} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-tight">
                      {s.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground/80">
                      {projectName(s.project_path)} · archived{" "}
                      {timeAgoShort(s.archived_at!)} ago
                    </span>
                  </span>
                  {confirmId === s.id ? (
                    <button
                      onClick={() => {
                        onDelete(s.id);
                        setConfirmId(null);
                      }}
                      className="shrink-0 rounded-md bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/25"
                    >
                      Delete?
                    </button>
                  ) : (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              onClick={() => {
                                onRestore(s.id);
                                setOpen(false);
                              }}
                              aria-label="Restore"
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <ArchiveRestoreIcon className="size-3.5" />
                            </button>
                          }
                        />
                        <TooltipPopup side="bottom">Restore to the canvas</TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              onClick={() => setConfirmId(s.id)}
                              aria-label="Delete forever"
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                            >
                              <Trash2Icon className="size-3.5" />
                            </button>
                          }
                        />
                        <TooltipPopup side="bottom">Delete permanently</TooltipPopup>
                      </Tooltip>
                    </span>
                  )}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
