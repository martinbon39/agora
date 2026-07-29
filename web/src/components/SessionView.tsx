import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { api, type Session } from "@/api";
import { HarnessAvatar } from "./HarnessAvatar";
import { TerminalView } from "@/terminal/TerminalView";
import { Button } from "./ui/button";

const STATE_LABEL: Record<Session["agent_state"], string> = {
  unknown: "",
  idle: "idle",
  working: "working",
  needs_approval: "needs approval",
};

export function SessionView({
  session,
  onBack,
  onClose,
}: {
  session: Session;
  onBack: () => void;
  onClose: () => void;
}) {
  const label = STATE_LABEL[session.agent_state];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);

  const commitRename = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== session.name) api.renameSession(session.id, name).catch(() => {});
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="workspace-topbar gap-2 border-b border-border px-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onBack}
          aria-label="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={17} />
        </Button>
        <HarnessAvatar harness={session.harness} size="sm" className="ml-1" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-64 rounded-md border border-input bg-transparent px-2 py-0.5 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(session.name);
              setEditing(true);
            }}
            title="Rename"
            className="truncate rounded-md px-1.5 py-0.5 text-[13px] font-medium transition-colors hover:bg-accent max-sm:py-1.5"
          >
            {session.name}
          </button>
        )}
        {label && (
          <span
            className={cn(
              "ml-1 hidden items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium sm:inline-flex",
              session.agent_state === "needs_approval"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : session.agent_state === "working"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {label}
          </span>
        )}
      </header>

      <div className="terminal-surface min-h-0 flex-1">
        <TerminalView sessionId={session.id} onClose={onClose} />
      </div>
    </div>
  );
}
