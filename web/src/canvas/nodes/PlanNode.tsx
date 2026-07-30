import { memo, useCallback, useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { CircleDot, Clapperboard, Hand, ListChecks, OctagonX, Plus, Radio, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type PlanTask } from "@/api";
import { serverEvents } from "@/events";
import { useCanvasApi } from "../context";

/** Stable per-agent hue, matching the board's — one voice, one colour. */
function agentHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const STATUS: Record<PlanTask["status"], { icon: typeof CircleDot; className: string; label: string }> = {
  open: { icon: CircleDot, className: "text-muted-foreground/60", label: "nobody on it" },
  claimed: { icon: Hand, className: "text-amber-400", label: "held" },
  blocked: { icon: OctagonX, className: "text-rose-400", label: "stuck" },
  done: { icon: ListChecks, className: "text-emerald-400", label: "done" },
};

/**
 * The shared plan.
 *
 * The same list the agents read with `agora plan` — not a mirror of it, the same
 * rows. That is the point of the node existing: a human can see that three
 * agents are holding three different tasks and that a fourth is blocked on the
 * schema, without opening a single terminal.
 *
 * Adding is all a human does here. Claiming is deliberately NOT offered: a claim
 * means "I am doing this now", and a person clicking it on behalf of an agent
 * would be putting a name on work nobody is doing. Agents claim their own.
 */
export const PlanNode = memo(function PlanNode({ id, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const project = ctx.canvasId;
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [draft, setDraft] = useState("");
  const [spend, setSpend] = useState<number | null>(null);
  const [unpriced, setUnpriced] = useState(0);
  const [leftMs, setLeftMs] = useState<number | null>(null);
  const [share, setShare] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .planList(project)
      .then(({ tasks }) => setTasks(tasks))
      .catch(() => {});
  }, [project]);

  // What the room has cost so far. The research on running fleets is blunt about
  // this: the loudest objection to parallel agents is that it is "a very
  // expensive experiment". One number answers it, so it belongs where the work
  // is, not behind a settings page.
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      api
        .cost(project)
        .then(({ total }) => {
          if (cancelled) return;
          setSpend(total.usd);
          setUnpriced(total.unpricedTokens);
        })
        .catch(() => {});
    const pollRoom = () =>
      api
        .room(project)
        .then(({ remainingMs }) => !cancelled && setLeftMs(remainingMs))
        .catch(() => {});
    poll();
    pollRoom();
    api
      .spectateToken(project)
      .then(({ token }) => !cancelled && setShare(token))
      .catch(() => {});
    // derived from transcripts on disk, so a poll is a file read, not a counter
    const timer = setInterval(() => {
      poll();
      pollRoom();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [project]);

  useEffect(() => {
    refresh();
    // Agents change the plan from the CLI, so the node cannot rely on its own
    // writes to stay current — the server broadcasts on every mutation.
    const unsub = serverEvents.subscribe((msg) => {
      if (msg.type === "plan_changed") refresh();
    });
    return unsub;
  }, [project, refresh]);

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    api.planAdd(project, title).then(refresh).catch(() => {});
  };

  const open = tasks.filter((t) => t.status === "open").length;
  const held = tasks.filter((t) => t.status === "claimed").length;
  const stuck = tasks.filter((t) => t.status === "blocked").length;

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={300}
        minHeight={240}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <ListChecks className="size-3.5 shrink-0 text-emerald-400" />
          <span className="text-xs font-medium">Plan</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/60">
            {/* The clock first: at a hackathon it is the number that changes what
                the team does next. Red under an hour, because that is when it
                starts mattering. */}
            {leftMs !== null && (
              <span className={leftMs < 3_600_000 ? "text-rose-400" : "text-foreground/70"}>
                {leftMs <= 0
                  ? "time up"
                  : leftMs < 3_600_000
                    ? `${Math.ceil(leftMs / 60_000)}m left`
                    : `${Math.floor(leftMs / 3_600_000)}h ${Math.round((leftMs % 3_600_000) / 60_000)}m left`}
                {" · "}
              </span>
            )}
            {stuck > 0 && <span className="text-rose-400/80">{stuck} stuck · </span>}
            {held} held · {open} free
            {spend !== null && (
              <span
                className="text-foreground/70"
                title={
                  unpriced > 0
                    ? `plus ${unpriced.toLocaleString()} tokens on a model with no price on record — the real figure is higher`
                    : "spent so far, from the agents' own transcripts"
                }
              >
                {" · "}
                {spend < 0.01 ? "<$0.01" : `$${spend.toFixed(2)}`}
                {unpriced > 0 && <span className="text-amber-400">+</span>}
              </span>
            )}
          </span>
          {/* The reel: what this room built, assembled from git, the plan and the
              transcripts. Behind the session cookie — it is the detailed version,
              and the team shows it to judges themselves. */}
          <button
            title="What we built — commits, plan, who was working, spend"
            onClick={() =>
              window.open(`/api/reel?project=${encodeURIComponent(project)}`, "_blank", "noopener")
            }
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Clapperboard className="size-3.5" />
          </button>
          {/* Publishing puts the room's shape — agents, plan, clock, cost — on a
              public URL. Never its terminals; see routes/spectate.ts. */}
          <button
            title={
              share
                ? "Published. Click to revoke the public link."
                : "Publish a read-only view: agents, plan, clock and cost. Never the terminals."
            }
            onClick={() => {
              const next = !share;
              api
                .setSpectate(project, next)
                .then(({ token }) => {
                  setShare(token);
                  if (token) navigator.clipboard?.writeText(`${location.origin}/s/${token}`).catch(() => {});
                })
                .catch(() => {});
            }}
            className={cn(
              "nodrag flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent",
              share ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Radio className="size-3.5" />
          </button>
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="nodrag nowheel min-h-0 flex-1 overflow-y-auto p-1.5">
          {tasks.length === 0 && (
            <p className="px-1.5 py-3 text-xs leading-relaxed text-muted-foreground/60">
              Nothing planned yet. Add what needs doing — the agents on this project read the
              same list, and each one claims a task before it starts.
            </p>
          )}
          <ul className="space-y-px">
            {tasks.map((t) => {
              const s = STATUS[t.status];
              const Icon = s.icon;
              return (
                <li
                  key={t.id}
                  className="group flex items-start gap-2 rounded px-1.5 py-1 hover:bg-accent/40"
                >
                  <span title={s.label} className="mt-0.5 shrink-0">
                    <Icon className={cn("size-3.5", s.className)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "break-words text-xs leading-snug",
                        t.status === "done" && "text-muted-foreground/50 line-through"
                      )}
                    >
                      {t.title}
                    </p>
                    {t.claimed_by_name && t.status !== "done" && (
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: `hsl(${agentHue(t.claimed_by_name)} 70% 70%)` }}
                      >
                        {t.claimed_by_name}
                        {t.note && <span className="text-rose-300/70"> — {t.note}</span>}
                      </span>
                    )}
                    {/* A finished task's note is the handoff its holder left. It is
                        the most valuable line on the plan — what someone learned —
                        so it stays visible rather than being hidden with the row. */}
                    {t.status === "done" && t.note && (
                      <span className="text-[10px] text-muted-foreground/70">{t.note}</span>
                    )}
                  </div>
                  <button
                    title="Remove from the plan"
                    onClick={() => api.planRemove(project, t.id).then(refresh).catch(() => {})}
                    className="nodrag mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:bg-accent hover:!text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-border p-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            placeholder="what needs doing…"
            className="nodrag min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
          />
          <button
            title="Add to the plan"
            onClick={add}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
    </>
  );
});
