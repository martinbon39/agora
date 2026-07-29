import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ExternalLink, Globe, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

/** `localhost:5173`, `:5173`, `5173` → the orbit server proxies to that port
 *  ON THE VPS (where agents run their dev servers). Anything else → https. */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return "";
  const local = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)?:?(\d{2,5})(\/.*)?$/i.exec(t);
  if (local) return `/proxy/${local[1]}${local[2] ?? "/"}`;
  if (t.startsWith("/proxy/")) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return `https://${t}`;
  return "";
}

/** Pretty form for the address bar: /proxy/5173/x → localhost:5173/x */
function displayUrl(url: string): string {
  const m = /^\/proxy\/(\d+)(\/.*)?$/.exec(url);
  if (m) return `localhost:${m[1]}${m[2] === "/" ? "" : (m[2] ?? "")}`;
  return url;
}

/** Web pane in an iframe. localhost URLs are proxied through the VPS; public
 *  sites load only if they allow embedding (the ⧉ button always works). */
export const BrowserNode = memo(function BrowserNode({ id, data, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const url = (data.url as string) ?? "";
  const [draft, setDraft] = useState(displayUrl(url));
  const [nonce, setNonce] = useState(0);

  const navigate = (input: string) => {
    const next = normalizeUrl(input);
    if (!next) return;
    setDraft(displayUrl(next));
    if (next === url) setNonce((n) => n + 1);
    else ctx.updateNodeData(id, { url: next });
  };

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={360}
        minHeight={260}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate(draft)}
            placeholder="localhost:5173 · a URL…"
            spellCheck={false}
            className="nodrag min-w-0 flex-1 rounded-md bg-accent/40 px-2 py-1 text-[11px] outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            title="Reload"
            onClick={() => setNonce((n) => n + 1)}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCw className="size-3.5" />
          </button>
          <button
            title="Open in a new tab"
            onClick={() => url && window.open(url, "_blank", "noopener")}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </button>
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>
        {url ? (
          /* NO allow-same-origin: proxied localhost apps are untrusted code
             served from orbit's origin — the opaque origin keeps them away from
             the auth cookie and /api (plus the Sec-Fetch-Site check in auth.ts) */
          <iframe
            key={nonce}
            src={url}
            title="browser"
            sandbox="allow-scripts allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
            className="nodrag nowheel min-h-0 w-full flex-1 border-0 bg-white"
          />
        ) : (
          <div className="nodrag flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe className="size-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              Type <span className="font-medium text-foreground">localhost:5173</span> to see a
              server running on this machine (proxied by argos),
              <br />
              or a full URL — if the site allows being embedded.
            </p>
          </div>
        )}
      </div>
    </>
  );
});
