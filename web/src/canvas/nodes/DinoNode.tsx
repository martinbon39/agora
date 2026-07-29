import { memo, useEffect, useRef } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

const HIGH_KEY = "agora.dino.high";

interface Cactus {
  x: number;
  w: number;
  h: number;
}

/** Chrome-dino-style runner, written from scratch for agora. Space / tap to
 *  jump; the high score survives across nodes via localStorage. */
export const DinoNode = memo(function DinoNode({ id, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const g = canvas.getContext("2d")!;

    // logical size follows the node; the ground sits at a fixed offset from it
    let W = 400;
    let H = 240;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    type Phase = "ready" | "running" | "dead";
    let phase: Phase = "ready";
    let y = 0; // dino height above ground, px
    let vy = 0;
    let speed = 4.5;
    let score = 0;
    let high = Number(localStorage.getItem(HIGH_KEY) ?? 0);
    let cacti: Cactus[] = [];
    let nextGap = 0;
    let legT = 0;

    const GRAVITY = 0.55;
    const JUMP = 10.5;
    const DINO_X = 34;
    const DINO_W = 26;
    const DINO_H = 30;

    const reset = () => {
      y = 0;
      vy = 0;
      speed = 4.5;
      score = 0;
      cacti = [];
      nextGap = 60;
    };

    const jump = () => {
      if (phase === "running") {
        if (y === 0) vy = JUMP;
        return;
      }
      // ready or dead → (re)start
      reset();
      phase = "running";
    };

    const ground = () => H - 34;

    const step = () => {
      if (phase === "running") {
        vy -= GRAVITY;
        y = Math.max(0, y + vy);
        if (y === 0) vy = 0;
        speed += 0.0012;
        score += speed / 30;
        legT += 1;

        nextGap -= speed;
        if (nextGap <= 0) {
          const h = 18 + Math.floor(Math.random() * 22);
          cacti.push({ x: W + 20, w: 10 + Math.floor(Math.random() * 12), h });
          nextGap = 160 + Math.random() * 220;
        }
        for (const c of cacti) c.x -= speed;
        cacti = cacti.filter((c) => c.x + c.w > -10);

        // AABB with a little forgiveness
        const dTop = ground() - DINO_H - y;
        for (const c of cacti) {
          const cTop = ground() - c.h;
          if (
            DINO_X + DINO_W - 4 > c.x &&
            DINO_X + 4 < c.x + c.w &&
            dTop + DINO_H - 2 > cTop
          ) {
            phase = "dead";
            high = Math.max(high, Math.floor(score));
            localStorage.setItem(HIGH_KEY, String(high));
          }
        }
      }

      // ---- draw ----
      g.clearRect(0, 0, W, H);
      const ink = "#a8a49c";
      const dim = "#5c574d";

      g.strokeStyle = dim;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, ground() + 0.5);
      g.lineTo(W, ground() + 0.5);
      g.stroke();

      // dino: body + head + eye + legs
      const dy = ground() - DINO_H - y;
      g.fillStyle = ink;
      g.fillRect(DINO_X, dy + 8, DINO_W - 8, DINO_H - 8); // body
      g.fillRect(DINO_X + 10, dy, DINO_W - 10, 14); // head
      g.fillStyle = "#101010";
      g.fillRect(DINO_X + DINO_W - 7, dy + 4, 3, 3); // eye
      g.fillStyle = ink;
      const legUp = phase === "running" && y === 0 && Math.floor(legT / 6) % 2 === 0;
      g.fillRect(DINO_X + 2, dy + DINO_H - 8, 5, legUp ? 6 : 8);
      g.fillRect(DINO_X + 12, dy + DINO_H - 8, 5, legUp ? 8 : 6);

      for (const c of cacti) {
        g.fillRect(c.x, ground() - c.h, c.w, c.h);
        g.fillRect(c.x - 4, ground() - c.h * 0.6, 4, 4);
        g.fillRect(c.x + c.w, ground() - c.h * 0.7, 4, 4);
      }

      g.fillStyle = dim;
      g.font = "600 11px 'JetBrains Mono', monospace";
      g.textAlign = "right";
      g.fillText(`HI ${high}  ${Math.floor(score)}`, W - 10, 18);

      if (phase !== "running") {
        g.textAlign = "center";
        g.fillStyle = ink;
        g.font = "600 13px 'JetBrains Mono', monospace";
        g.fillText(phase === "dead" ? "game over" : "dino", W / 2, H / 2 - 12);
        g.fillStyle = dim;
        g.font = "500 11px 'JetBrains Mono', monospace";
        g.fillText("space / tap to " + (phase === "dead" ? "retry" : "run"), W / 2, H / 2 + 8);
      }

      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation(); // the game owns its keys
        jump();
      }
    };
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      canvas.focus();
      jump();
    };
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointer);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={320}
        minHeight={200}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <span className="text-xs font-medium text-muted-foreground">dino</span>
          <span className="flex-1" />
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div ref={wrapRef} className="nodrag min-h-0 flex-1">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="block h-full w-full outline-none"
            aria-label="Dino runner game — space or tap to jump"
          />
        </div>
      </div>
    </>
  );
});
