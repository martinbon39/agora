import { memo, useState } from "react";
import { toast } from "sonner";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Archive, GitFork, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { HarnessAvatar } from "@/components/HarnessAvatar";
import { TerminalView } from "@/terminal/TerminalView";
import { useCanvasApi } from "../context";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const STATE_LABEL = {
  unknown: "",
  idle: "idle",
  working: "working",
  needs_approval: "needs approval",
} as const;

/** A live agora session on the canvas. Drag by the title bar only; the body
 *  is `nodrag nowheel` so xterm owns the mouse (selection, tmux scroll). */
export const TerminalNode = memo(function TerminalNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const coarse = useMediaQuery({ pointer: "coarse" });
  const sessionId = data.sessionId as string;
  const session = ctx.sessions.find((s) => s.id === sessionId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commitRename = () => {
    setEditing(false);
    const name = draft.trim();
    if (session && name && name !== session.name) ctx.renameSession(sessionId, name);
  };

  const state = session?.agent_state ?? "unknown";
  const label = STATE_LABEL[state];
  const [dropReady, setDropReady] = useState(false);

  // multiplayer: peers whose focus is THIS terminal light it up in their color
  const viewers = ctx.peers.filter((p) => p.focus === sessionId);

  // todo items dragged from a TodoNode become the agent's next task
  const acceptsTodo = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("application/x-agora-todo");
  const onDrop = async (e: React.DragEvent) => {
    if (!acceptsTodo(e)) return;
    e.preventDefault();
    setDropReady(false);
    try {
      const { nodeId, index, text } = JSON.parse(
        e.dataTransfer.getData("application/x-agora-todo")
      );
      if (await ctx.sendToSession(sessionId, text)) {
        ctx.markTodoSent(nodeId, index);
        toast.success(`Task handed to ${session?.name ?? "the agent"}`);
      }
    } catch {}
  };

  return (
    <>
      {/* Link anchors, one per side. Terminals usually sit side by side, so a
          top/bottom-only pair meant dragging a link across a whole node. Styled
          in index.css (.react-flow__node-terminal .react-flow__handle): always
          faintly visible, because a handle that only exists on hover cannot
          announce that linking is possible at all. */}
      <Handle type="target" id="t" position={Position.Top} />
      <Handle type="source" id="r" position={Position.Right} />
      <Handle type="source" id="b" position={Position.Bottom} />
      <Handle type="target" id="l" position={Position.Left} />
      <NodeResizer
        isVisible={!!selected}
        minWidth={380}
        minHeight={260}
        maxWidth={1800}
        maxHeight={1100}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div
        className={cn(
          "canvas-node",
          `canvas-node-state-${state}`,
          selected && "canvas-node-selected",
          dropReady && "ring-2 ring-violet-400/80"
        )}
        style={
          viewers.length
            ? { boxShadow: `0 0 0 2.5px ${viewers[0].user.color}, 0 0 22px ${viewers[0].user.color}55` }
            : undefined
        }
        onFocusCapture={() => ctx.setFocusedSession(sessionId)}
        onDragOver={(e) => {
          if (!acceptsTodo(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropReady(true);
        }}
        onDragLeave={() => setDropReady(false)}
        onDrop={onDrop}
      >
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header
          className="node-drag-handle flex h-9 shrink-0 items-center gap-2 border-b border-border px-2"
          onDoubleClick={() => ctx.zoomToNode(id)}
          title="Double-click: zoom to 100%"
        >
          <HarnessAvatar
            harness={session?.harness ?? "shell"}
            state={session ? state : undefined}
            exited={session?.status === "exited"}
            size="sm"
            className="scale-90"
          />
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
              className="nodrag w-44 rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            />
          ) : (
            <button
              onDoubleClick={(e) => {
                e.stopPropagation(); // rename, not zoom-to-node
                setDraft(session?.name ?? "");
                setEditing(true);
              }}
              title="Double-click to rename"
              className="min-w-0 truncate text-left text-xs font-medium"
            >
              {session?.name ?? "session"}
            </button>
          )}
          {label && (
            <span
              className={cn(
                "rounded-full px-2 py-px text-[10px] font-medium",
                state === "needs_approval"
                  ? "bg-rose-500/10 text-rose-400"
                  : state === "working"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-emerald-500/10 text-emerald-400"
              )}
            >
              {label}
            </span>
          )}
          {viewers.map((v) => (
            <span
              key={v.clientId}
              title={`${v.user.name} is on this terminal`}
              className="max-w-24 truncate rounded-full px-1.5 py-px text-[9px] font-bold"
              style={{ background: v.user.color, color: "#1c1917" }}
            >
              {v.user.name}
            </span>
          ))}
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">
            {session?.project_path?.split("/").pop() ?? ""}
          </span>
          <button
            title="Fork — duplicates the terminal (same conversation for claude)"
            onClick={() => ctx.forkSession(sessionId)}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <GitFork className="size-3.5" />
          </button>
          <button
            title="Archive session"
            onClick={() => ctx.archiveSession(sessionId)}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Archive className="size-3.5" />
          </button>
        </header>
        <div className="nodrag nowheel terminal-surface min-h-0 flex-1">
          {session ? (
            <TerminalView
              ref={(h) => ctx.registerTerminal(sessionId, h)}
              sessionId={sessionId}
              quickKeys={!coarse}
              onClose={() => ctx.removeNode(id)}
            />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              session gone
              <button
                onClick={() => ctx.removeNode(id)}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent"
              >
                <X className="size-3" /> remove
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
});
