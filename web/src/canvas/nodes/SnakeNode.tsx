import { memo, useEffect, useRef } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasApi } from "../context";

const HIGH_KEY = "orbit.snake.high";
const CELL = 18;

/** Snake, canvas-node edition. Arrows/WASD; the grid adapts to the node size;
 *  high score shared across nodes via localStorage. */
export const SnakeNode = memo(function SnakeNode({ id, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const g = canvas.getContext("2d")!;

    let W = 0;
    let H = 0;
    let cols = 10;
    let rows = 10;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(8, Math.floor(W / CELL));
      rows = Math.max(8, Math.floor(H / CELL));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    type Phase = "ready" | "running" | "dead";
    let phase: Phase = "ready";
    let snake: { x: number; y: number }[] = [];
    let dir = { x: 1, y: 0 };
    let nextDir = dir;
    let food = { x: 5, y: 5 };
    let score = 0;
    let high = Number(localStorage.getItem(HIGH_KEY) ?? 0);
    let stepMs = 140;
    let acc = 0;
    let last = 0;

    const placeFood = () => {
      do {
        food = {
          x: Math.floor(Math.random() * cols),
          y: Math.floor(Math.random() * rows),
        };
      } while (snake.some((s) => s.x === food.x && s.y === food.y));
    };

    const reset = () => {
      const cx = Math.floor(cols / 2);
      const cy = Math.floor(rows / 2);
      snake = [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy },
      ];
      dir = { x: 1, y: 0 };
      nextDir = dir;
      score = 0;
      stepMs = 140;
      placeFood();
    };

    const step = () => {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (
        head.x < 0 ||
        head.y < 0 ||
        head.x >= cols ||
        head.y >= rows ||
        snake.some((s) => s.x === head.x && s.y === head.y)
      ) {
        phase = "dead";
        high = Math.max(high, score);
        localStorage.setItem(HIGH_KEY, String(high));
        return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 1;
        stepMs = Math.max(60, stepMs - 3);
        placeFood();
      } else {
        snake.pop();
      }
    };

    const draw = () => {
      g.clearRect(0, 0, W, H);
      const ox = Math.floor((W - cols * CELL) / 2);
      const oy = Math.floor((H - rows * CELL) / 2);

      g.fillStyle = "#f26d78";
      g.beginPath();
      g.arc(ox + food.x * CELL + CELL / 2, oy + food.y * CELL + CELL / 2, CELL / 2 - 4, 0, 7);
      g.fill();

      snake.forEach((s, i) => {
        g.fillStyle = i === 0 ? "#a78bfa" : "#8fd968";
        const pad = i === 0 ? 1.5 : 2.5;
        g.beginPath();
        g.roundRect(ox + s.x * CELL + pad, oy + s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 4);
        g.fill();
      });

      g.fillStyle = "#5c574d";
      g.font = "600 11px 'JetBrains Mono', monospace";
      g.textAlign = "right";
      g.fillText(`HI ${high}  ${score}`, W - 10, 18);

      if (phase !== "running") {
        g.textAlign = "center";
        g.fillStyle = "#a8a49c";
        g.font = "600 13px 'JetBrains Mono', monospace";
        g.fillText(phase === "dead" ? "game over" : "snake", W / 2, H / 2 - 12);
        g.fillStyle = "#5c574d";
        g.font = "500 11px 'JetBrains Mono', monospace";
        g.fillText("arrows / wasd to " + (phase === "dead" ? "retry" : "slither"), W / 2, H / 2 + 8);
      }
    };

    const loop = (t: number) => {
      if (phase === "running") {
        acc += t - last;
        while (acc > stepMs) {
          acc -= stepMs;
          step();
        }
      }
      last = t;
      draw();
      raf = requestAnimationFrame(loop);
    };
    let raf = requestAnimationFrame((t) => {
      last = t;
      loop(t);
    });

    const DIRS: Record<string, { x: number; y: number }> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };
    const onKey = (e: KeyboardEvent) => {
      const d = DIRS[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation(); // arrows steer the snake, never the canvas/node
      if (phase !== "running") {
        reset();
        phase = "running";
        acc = 0;
        return;
      }
      // no instant 180° turns
      if (d.x !== -dir.x || d.y !== -dir.y) nextDir = d;
    };
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      canvas.focus();
      if (phase !== "running") {
        reset();
        phase = "running";
        acc = 0;
      }
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
        minWidth={280}
        minHeight={220}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <span className="text-xs font-medium text-muted-foreground">snake</span>
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
            aria-label="Snake game — arrows or WASD"
          />
        </div>
      </div>
    </>
  );
});
