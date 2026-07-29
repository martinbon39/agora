import { memo, useEffect, useState } from "react";
import { useViewport } from "@xyflow/react";
import { serverEvents } from "@/events";
import type { PresencePeer } from "@/api";

interface LiveCursor {
  /** Flow (world) coordinates — converted to screen at render time so the
   *  cursors stay glued to the canvas through pan/zoom. */
  x: number;
  y: number;
  name: string;
  color: string;
  seen: number;
}

/** Live cursors of everyone else on this project's canvas. Renders above the
 *  flow pane, never intercepts the pointer. */
export const PresenceLayer = memo(function PresenceLayer({ peers }: { peers: PresencePeer[] }) {
  const { x: vx, y: vy, zoom } = useViewport();
  const [cursors, setCursors] = useState<Record<string, LiveCursor>>({});

  useEffect(
    () =>
      serverEvents.subscribe((msg) => {
        if (msg.type !== "cursor") return;
        const { clientId, x, y } = msg as { clientId?: string; x?: number; y?: number };
        const user = (msg as { user?: { name?: string; color?: string } }).user;
        if (typeof clientId !== "string" || typeof x !== "number" || typeof y !== "number") return;
        setCursors((c) => ({
          ...c,
          [clientId]: {
            x,
            y,
            name: user?.name ?? "?",
            color: user?.color ?? "#94a3b8",
            seen: Date.now(),
          },
        }));
      }),
    []
  );

  // a peer that left (or went idle) must not haunt the canvas
  useEffect(() => {
    const alive = new Set(peers.map((p) => p.clientId));
    const prune = () =>
      setCursors((c) => {
        const now = Date.now();
        const entries = Object.entries(c).filter(
          ([id, cur]) => alive.has(id) && now - cur.seen < 8000
        );
        return entries.length === Object.keys(c).length ? c : Object.fromEntries(entries);
      });
    prune();
    const t = setInterval(prune, 2000);
    return () => clearInterval(t);
  }, [peers]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {Object.entries(cursors).map(([id, c]) => (
        <div
          key={id}
          className="absolute left-0 top-0 transition-transform duration-100 ease-linear will-change-transform"
          style={{ transform: `translate3d(${c.x * zoom + vx}px, ${c.y * zoom + vy}px, 0)` }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            className="drop-shadow-[0_1px_2px_rgb(0_0_0/50%)]"
            style={{ color: c.color }}
          >
            <path
              fill="currentColor"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth="1"
              d="M4 2l16 7.6-7.1 2L9.6 19 4 2z"
            />
          </svg>
          <span
            className="ml-3.5 -mt-0.5 block w-max max-w-40 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm"
            style={{ background: c.color, color: "#1c1917" }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
});
