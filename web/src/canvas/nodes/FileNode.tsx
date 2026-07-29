import { memo, useCallback, useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { FileIcon, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { useCanvasApi } from "../context";

/** Read-only file viewer, spawned by clicking a file in the explorer — the
 *  edge back to its explorer says where it came from. */
export const FileNode = memo(function FileNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const path = data.path as string;
  const [state, setState] = useState<{
    content: string;
    binary: boolean;
    truncated: boolean;
    size: number;
  } | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    api
      .readFile(ctx.canvasId, path)
      .then(setState)
      .catch(() => setError(true));
  }, [ctx.canvasId, path]);
  useEffect(load, [load]);

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={300}
        minHeight={200}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <FileIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={path}>
            {path}
          </span>
          {state?.truncated && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-[9px] text-amber-400">
              truncated
            </span>
          )}
          <button
            title="Refresh"
            onClick={load}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3" />
          </button>
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="nodrag nowheel min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="p-3 text-[11px] text-red-400/80">file unreadable (moved? deleted?)</p>
          ) : !state ? (
            <p className="p-3 text-[11px] text-muted-foreground/60">…</p>
          ) : state.binary ? (
            <p className="p-3 text-[11px] text-muted-foreground">
              binary file ({Math.round(state.size / 1024)} KB)
            </p>
          ) : (
            <pre className="min-w-max p-2.5 font-mono text-[10.5px] leading-[1.5] text-foreground/90">
              {state.content}
            </pre>
          )}
        </div>
      </div>
    </>
  );
});
