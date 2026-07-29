import { memo, useCallback, useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ChevronRight, FileIcon, FolderIcon, FolderTree, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { useCanvasApi } from "../context";

type Entry = { name: string; dir: boolean; size: number };

const DIMMED = new Set(["node_modules", ".git", "dist", ".next", "__pycache__"]);

function sizeShort(n: number) {
  if (n < 1024) return `${n}o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}k`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

/** One directory level; folders expand lazily in place. */
function Dir({
  project,
  rel,
  depth,
  onOpenFile,
}: {
  project: string;
  rel: string;
  depth: number;
  onOpenFile: (path: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    api
      .listFiles(project, rel)
      .then(({ entries }) => setEntries(entries))
      .catch(() => setError(true));
  }, [project, rel]);
  useEffect(load, [load]);

  if (error)
    return <p className="px-2 py-1 text-[10px] text-red-400/80">couldn't read</p>;
  if (!entries)
    return <p className="px-2 py-1 text-[10px] text-muted-foreground/50">…</p>;

  return (
    <div>
      {entries.map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const dimmed = DIMMED.has(e.name);
        return (
          <div key={e.name}>
            <button
              onClick={() => (e.dir ? setOpen((o) => ({ ...o, [e.name]: !o[e.name] })) : onOpenFile(childRel))}
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-[11px] leading-tight transition-colors hover:bg-accent/60",
                dimmed && "opacity-40"
              )}
            >
              {e.dir ? (
                <>
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground/60 transition-transform",
                      open[e.name] && "rotate-90"
                    )}
                  />
                  <FolderIcon className="size-3 shrink-0 text-sky-400/80" />
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <FileIcon className="size-3 shrink-0 text-muted-foreground/70" />
                </>
              )}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {!e.dir && (
                <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/40">
                  {sizeShort(e.size)}
                </span>
              )}
            </button>
            {e.dir && open[e.name] && (
              <Dir project={project} rel={childRel} depth={depth + 1} onOpenFile={onOpenFile} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Repo explorer: the project tree, folders unfold in place, clicking a file
 *  opens a linked viewer node right next to this one. */
export const FilesNode = memo(function FilesNode({ id, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={220}
        minHeight={240}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <FolderTree className="size-3.5 text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {ctx.canvasId.split("/").pop()}
          </span>
          <button
            title="Refresh"
            onClick={() => setReloadKey((k) => k + 1)}
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
        <div className="nodrag nowheel min-h-0 flex-1 overflow-y-auto p-1">
          <Dir
            key={reloadKey}
            project={ctx.canvasId}
            rel=""
            depth={0}
            onOpenFile={(path) => ctx.openFile(id, path)}
          />
        </div>
      </div>
    </>
  );
});
