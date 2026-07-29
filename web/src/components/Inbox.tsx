import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InboxIcon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { AgoraNotification } from "@/api";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Inbox for agent messages (`agora notify`): bell + panel in the top bar. */
export function Inbox({
  notifications,
  unread,
  onMarkRead,
  onOpenSession,
}: {
  notifications: AgoraNotification[];
  unread: number;
  onMarkRead: () => void;
  onOpenSession: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) onMarkRead();
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Agent messages"
              className="relative"
              onClick={toggle}
            >
              <HugeiconsIcon icon={InboxIcon} size={16} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>
          }
        />
        <TooltipPopup>Agent messages</TooltipPopup>
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
              // top-full: the bell lives in the TOP bar now — bottom-full (its
              // old sidebar-footer anchoring) opened the panel off-screen
              className="absolute right-0 top-full z-50 mt-2 max-h-[380px] w-[290px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg"
            >
              {notifications.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No messages — agents write here via{" "}
                  <code className="font-mono">agora notify</code>.
                </p>
              )}
              {notifications.map((n) => {
                const clickable = Boolean(n.link || n.session_id);
                return (
                  <button
                    key={n.id}
                    disabled={!clickable}
                    onClick={() => {
                      if (n.link) window.open(n.link, "_blank");
                      else if (n.session_id) onOpenSession(n.session_id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg p-2 text-left",
                      clickable && "transition-colors hover:bg-accent/70"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.read_at === null ? "bg-primary" : "bg-border"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-3 block text-xs leading-snug text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[10px] text-muted-foreground/70">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                    {n.link && (
                      <HugeiconsIcon
                        icon={ArrowUpRight01Icon}
                        size={13}
                        className="mt-1 shrink-0 text-muted-foreground"
                      />
                    )}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
