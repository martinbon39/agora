import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

/** A pasted/dropped image, FigJam-style: no chrome, drag anywhere, aspect
 *  ratio locked while resizing, X appears on hover. */
export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        keepAspectRatio
        minWidth={80}
        minHeight={60}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div
        className={cn(
          "group relative h-full w-full overflow-hidden rounded-xl border border-border/60 bg-card/40",
          selected && "ring-2 ring-ring/60"
        )}
      >
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <img
          src={data.src as string}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
        <button
          title="Remove"
          onClick={() => ctx.removeNode(id)}
          className="nodrag absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-black/50 text-white/80 opacity-0 backdrop-blur transition-opacity hover:text-white group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </>
  );
});
