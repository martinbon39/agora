import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

/** Classic post-it palette — bright paper + dark ink pops on the dark canvas. */
export const STICKY_COLORS: Record<string, { bg: string; ink: string }> = {
  amber: { bg: "#f6d365", ink: "#3f3413" },
  rose: { bg: "#f7a8c4", ink: "#4a1a2c" },
  sky: { bg: "#8fd3f4", ink: "#123a4d" },
  lime: { bg: "#b7e4a0", ink: "#25401a" },
};

export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const color = STICKY_COLORS[(data.color as string) ?? "amber"] ?? STICKY_COLORS.amber;

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={140}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-lg shadow-[0_10px_28px_rgb(0_0_0/40%)]",
          selected && "outline-2 outline-ring/70"
        )}
        style={{ background: color.bg, color: color.ink }}
      >
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <div className="node-drag-handle group flex h-7 shrink-0 items-center gap-1.5 px-2">
          {Object.entries(STICKY_COLORS).map(([name, c]) => (
            <button
              key={name}
              title={name}
              onClick={() => ctx.updateNodeData(id, { color: name })}
              className={cn(
                "nodrag size-3 rounded-full border border-black/20 opacity-0 transition-opacity group-hover:opacity-100",
                name === ((data.color as string) ?? "amber") && "opacity-100 ring-1 ring-black/40"
              )}
              style={{ background: c.bg }}
            />
          ))}
          <span className="flex-1" />
          <button
            title="Delete note"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <textarea
          value={(data.text as string) ?? ""}
          onChange={(e) => ctx.updateNodeData(id, { text: e.target.value })}
          placeholder="Note…"
          spellCheck={false}
          className="nodrag nowheel min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 font-medium outline-none placeholder:opacity-50"
          style={{ fontSize: "clamp(13px, 5.5cqw, 42px)", lineHeight: 1.4 }}
        />
        {typeof data.author === "string" && data.author && (
          <div className="pointer-events-none shrink-0 px-3 pb-1.5 text-right text-[10px] font-semibold italic opacity-55">
            — {data.author}
          </div>
        )}
      </div>
    </>
  );
});
