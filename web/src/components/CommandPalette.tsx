import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Gamepad2, Globe, Joystick, ListTodo, Maximize, MessagesSquare, StickyNote } from "lucide-react";
import { type Session } from "@/api";
import { HarnessAvatar, HARNESSES } from "./HarnessAvatar";
import { HarnessIcon } from "./HarnessIcon";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

export function CommandPalette({
  open,
  sessions,
  onOpenChange,
  onOpenSession,
  onNewSession,
  onCanvas,
}: {
  open: boolean;
  sessions: Session[];
  onOpenChange: (open: boolean) => void;
  onOpenSession: (id: string) => void;
  onNewSession: (harness?: string) => void;
  /** Desktop only: canvas actions (add nodes, fit view). */
  onCanvas?: (action: "sticky" | "browser" | "dino" | "snake" | "chat" | "todo" | "fit") => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const live = sessions.filter((s) => s.status === "running" && s.archived_at == null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" className="outline-none">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search sessions, actions…"
            className="h-12 w-full border-b border-border/60 bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results
            </Command.Empty>

            {live.length > 0 && (
              <Command.Group heading="Sessions">
                {live.map((s) => (
                  <Command.Item
                    key={s.id}
                    value={`session ${s.name} ${s.harness} ${s.project_path}`}
                    onSelect={() => run(() => onOpenSession(s.id))}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
                  >
                    <HarnessAvatar harness={s.harness} state={s.agent_state} size="sm" />
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.agent_state === "needs_approval" && (
                      <span className="text-[11px] font-medium text-rose-500">approval</span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="New session">
              {HARNESSES.map((h) => (
                <Command.Item
                  key={h}
                  value={`new session ${h}`}
                  onSelect={() => run(() => onNewSession(h))}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
                >
                  <span className="flex size-7 items-center justify-center">
                    <HarnessIcon harness={h} size={15} />
                  </span>
                  Launch {h}
                </Command.Item>
              ))}
              <Command.Item
                value="new session dialog"
                onSelect={() => run(() => onNewSession())}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <span className="flex size-7 items-center justify-center">
                  <HugeiconsIcon icon={PlusSignIcon} size={15} />
                </span>
                New session…
              </Command.Item>
            </Command.Group>

            {onCanvas && (
              <Command.Group heading="Canvas">
                {(
                  [
                    { action: "chat", label: "Agent chat", icon: <MessagesSquare className="size-[15px] text-violet-400" /> },
                    { action: "todo", label: "Todo list", icon: <ListTodo className="size-[15px] text-sky-400" /> },
                    { action: "sticky", label: "New sticky note", icon: <StickyNote className="size-[15px] text-amber-400" /> },
                    { action: "browser", label: "New browser", icon: <Globe className="size-[15px] text-sky-400" /> },
                    { action: "dino", label: "Dino game", icon: <Gamepad2 className="size-[15px] text-emerald-400" /> },
                    { action: "snake", label: "Snake", icon: <Joystick className="size-[15px] text-lime-400" /> },
                    { action: "fit", label: "Fit view", icon: <Maximize className="size-[15px] text-muted-foreground" /> },
                  ] as const
                ).map((c) => (
                  <Command.Item
                    key={c.action}
                    value={`canvas ${c.label}`}
                    onSelect={() => run(() => onCanvas(c.action))}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
                  >
                    <span className="flex size-7 items-center justify-center">{c.icon}</span>
                    {c.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
