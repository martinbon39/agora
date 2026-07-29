import { cn } from "@/lib/utils";
import type { Session } from "@/api";
import { HarnessIcon } from "./HarnessIcon";

/** Circle tint per harness — brand-adjacent, subtle. */
const HARNESS_BG: Record<string, string> = {
  claude: "bg-[#D97757]/12",
  shell: "bg-stone-500/12 text-stone-600 dark:text-stone-300",
  codex: "bg-stone-500/10 text-foreground",
  opencode: "bg-stone-500/10 text-foreground",
  gemini: "bg-blue-500/10",
};

const STATUS_COLOR: Record<Session["agent_state"], string> = {
  unknown: "bg-stone-300 dark:bg-stone-600",
  idle: "bg-emerald-500",
  working: "bg-amber-500",
  needs_approval: "bg-rose-500",
};

export function HarnessAvatar({
  harness,
  state,
  exited,
  size = "md",
  className,
}: {
  harness: string;
  state?: Session["agent_state"];
  exited?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-full transition-colors",
          size === "md" ? "size-9" : "size-7",
          HARNESS_BG[harness] ?? HARNESS_BG.shell,
          exited && "opacity-40 grayscale"
        )}
      >
        <HarnessIcon harness={harness} size={size === "md" ? 18 : 14} />
      </span>
      {state && !exited && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-sidebar",
            size === "md" ? "size-3" : "size-2.5",
            STATUS_COLOR[state],
            state === "needs_approval" && "animate-pulse"
          )}
        >
          {state === "needs_approval" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/60" />
          )}
        </span>
      )}
    </span>
  );
}

export const HARNESSES = ["claude", "shell", "codex", "opencode", "gemini"];
export { HARNESS_BG };
