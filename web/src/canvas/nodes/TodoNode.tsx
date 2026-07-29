import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { GripVertical, ListTodo, Plus, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

interface TodoItem {
  t: string;
  d: boolean;
  /** dispatched to an agent (drag-dropped onto a terminal) */
  s?: boolean;
}

/** Checklist node — a sticky note that keeps score. */
export const TodoNode = memo(function TodoNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const items = (data.items as TodoItem[] | undefined) ?? [];
  const [draft, setDraft] = useState("");

  const setItems = (next: TodoItem[]) => ctx.updateNodeData(id, { items: next });
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    setItems([...items, { t, d: false }]);
  };
  const done = items.filter((i) => i.d).length;

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={220}
        minHeight={200}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <ListTodo className="size-3.5 text-sky-400" />
          <span className="text-xs font-medium">todo</span>
          <span className="flex-1 text-right text-[10px] tabular-nums text-muted-foreground/60">
            {items.length ? `${done}/${items.length}` : ""}
          </span>
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="nodrag nowheel min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <div
              key={i}
              draggable={!item.d}
              onDragStart={(e) => {
                // drop it on a terminal node to dispatch the task to that agent
                e.dataTransfer.setData(
                  "application/x-agora-todo",
                  JSON.stringify({ nodeId: id, index: i, text: item.t })
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="group nodrag flex cursor-grab items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50 active:cursor-grabbing"
            >
              <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              <input
                type="checkbox"
                checked={item.d}
                onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, d: !x.d } : x)))}
                className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 break-words leading-snug",
                  item.d && "text-muted-foreground/60 line-through"
                )}
                style={{ fontSize: "clamp(12px, 4.5cqw, 24px)" }}
              >
                {item.t}
                {item.s && !item.d && (
                  <Send className="ml-1 inline size-2.5 text-violet-400" aria-label="sent to an agent" />
                )}
              </span>
              <button
                aria-label="Remove item"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border p-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a task…"
            className="nodrag min-w-0 flex-1 rounded-md bg-accent/40 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            onClick={add}
            aria-label="Add"
            className="nodrag flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
    </>
  );
});
