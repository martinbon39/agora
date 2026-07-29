import {
  Bot,
  FolderTree,
  Gamepad2,
  Hand,
  Globe,
  Joystick,
  Link2,
  ListTodo,
  Maximize,
  MessagesSquare,
  Mic,
  Minus,
  Plus,
  Redo2,
  SquareTerminal,
  StickyNote,
  Undo2,
} from "lucide-react";
import { HarnessIcon } from "@/components/HarnessIcon";
import { useViewport, useReactFlow } from "@xyflow/react";
import { cn } from "@/lib/utils";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { CanvasNodeType } from "./types";

/** One icon button. `tone` says what an active state MEANS: a mode you are in
 *  (accent) versus something recording (rose) — they used to look the same. */
function DockButton({
  title,
  hint,
  onClick,
  disabled,
  active,
  tone = "mode",
  children,
}: {
  title: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "mode" | "live";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            disabled={disabled}
            aria-label={title}
            aria-pressed={active}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-all",
              "hover:bg-accent hover:text-foreground active:scale-95",
              "disabled:pointer-events-none disabled:opacity-25",
              active &&
                (tone === "live"
                  ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/20 hover:text-rose-400"
                  : "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")
            )}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup>
        {title}
        {hint && <span className="ml-1.5 text-muted-foreground">{hint}</span>}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Thin rule between groups — the dock used to be ten buttons in a row with no
 *  telling which belonged together. */
const Sep = () => <span className="mx-1 h-6 w-px shrink-0 bg-border" />;

/**
 * The canvas dock: create · tools · history · view.
 *
 * Grouped rather than lined up, and every group reads left to right in the
 * order you actually reach for it — make something, pick a tool, undo what the
 * tool did, then move the camera.
 */
export function Dock({
  onAdd,
  onNewSession,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onFitView,
  onZoom,
  dictation,
  hand,
  onToggleHand,
  link,
  onToggleLink,
}: {
  onAdd: (type: Exclude<CanvasNodeType, "terminal">) => void;
  onNewSession: (harness: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onFitView: () => void;
  onZoom: (dir: 1 | -1) => void;
  hand: boolean;
  onToggleHand: () => void;
  link: boolean;
  onToggleLink: () => void;
  dictation: { supported: boolean; active: boolean; interim: string; toggle: () => void };
}) {
  const { zoom } = useViewport();
  const rf = useReactFlow();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-2.5">
      {/* What an armed tool is waiting for. A mode with no visible instruction
          is a mode you forget you are in. */}
      {link && (
        <div className="pointer-events-none rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs text-foreground backdrop-blur">
          Click two terminals to let their agents read each other
          <span className="ml-2 text-muted-foreground">Esc to cancel</span>
        </div>
      )}
      {dictation.active && (
        <div className="pointer-events-auto max-w-xl rounded-full border border-rose-500/30 bg-card/90 px-4 py-1.5 text-xs text-foreground shadow-lg backdrop-blur">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-rose-500" />
          {dictation.interim || "listening — speaking types into the focused terminal"}
        </div>
      )}

      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border bg-card/80 p-1.5 shadow-[0_16px_48px_-12px_rgb(0_0_0/60%)] backdrop-blur-xl">
        {/* create */}
        <Menu>
          <MenuTrigger
            render={
              <button
                aria-label="Add to the canvas"
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary pl-2.5 pr-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 active:scale-95"
              >
                <Plus className="size-4" />
                New
              </button>
            }
          />
          <MenuPopup side="top" align="start" className="min-w-52">
            <MenuSub>
              <MenuSubTrigger>
                <Bot className="size-3.5 text-foreground" /> Agents
              </MenuSubTrigger>
              <MenuSubPopup>
                {(["claude", "codex", "opencode", "gemini"] as const).map((h) => (
                  <MenuItem key={h} onClick={() => onNewSession(h)}>
                    <HarnessIcon harness={h} size={14} /> {h === "claude" ? "Claude Code" : h}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
            <MenuItem onClick={() => onNewSession("shell")}>
              <SquareTerminal className="size-3.5 text-muted-foreground" /> Terminal
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => onAdd("chat")}>
              <MessagesSquare className="size-3.5 text-amber-400" /> Project board
            </MenuItem>
            <MenuItem onClick={() => onAdd("todo")}>
              <ListTodo className="size-3.5 text-sky-400" /> Todo list
            </MenuItem>
            <MenuItem onClick={() => onAdd("sticky")}>
              <StickyNote className="size-3.5 text-amber-400" /> Sticky note
            </MenuItem>
            <MenuItem onClick={() => onAdd("browser")}>
              <Globe className="size-3.5 text-sky-400" /> Browser
            </MenuItem>
            <MenuItem onClick={() => onAdd("files")}>
              <FolderTree className="size-3.5 text-sky-400" /> File explorer
            </MenuItem>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                <Gamepad2 className="size-3.5 text-emerald-400" /> Games
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuItem onClick={() => onAdd("dino")}>
                  <Gamepad2 className="size-3.5 text-emerald-400" /> Dino
                </MenuItem>
                <MenuItem onClick={() => onAdd("snake")}>
                  <Joystick className="size-3.5 text-lime-400" /> Snake
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
          </MenuPopup>
        </Menu>

        <Sep />

        {/* tools — the two modes that change what a drag or a click does */}
        <DockButton
          title={hand ? "Hand tool — on" : "Hand tool"}
          hint="H"
          onClick={onToggleHand}
          active={hand}
        >
          <Hand className="size-[18px]" />
        </DockButton>
        <DockButton
          title={link ? "Link tool — click two terminals" : "Link two terminals"}
          hint="L"
          onClick={onToggleLink}
          active={link}
        >
          <Link2 className="size-[18px]" />
        </DockButton>
        {dictation.supported && (
          <DockButton
            title={dictation.active ? "Stop dictation" : "Dictate into the focused terminal"}
            onClick={dictation.toggle}
            active={dictation.active}
            tone="live"
          >
            <Mic className="size-[18px]" />
          </DockButton>
        )}

        <Sep />

        {/* history */}
        <DockButton title="Undo" hint="Ctrl+Z" onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="size-[18px]" />
        </DockButton>
        <DockButton title="Redo" hint="Ctrl+Shift+Z" onClick={onRedo} disabled={!canRedo}>
          <Redo2 className="size-[18px]" />
        </DockButton>

        <Sep />

        {/* view */}
        <DockButton title="Zoom out" onClick={() => onZoom(-1)}>
          <Minus className="size-[18px]" />
        </DockButton>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => rf.zoomTo(1, { duration: 200 })}
                className="h-9 w-14 shrink-0 rounded-xl text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {Math.round(zoom * 100)}%
              </button>
            }
          />
          <TooltipPopup>Reset to 100%</TooltipPopup>
        </Tooltip>
        <DockButton title="Zoom in" onClick={() => onZoom(1)}>
          <Plus className="size-[18px]" />
        </DockButton>
        <DockButton title="Fit everything on screen" onClick={onFitView}>
          <Maximize className="size-[18px]" />
        </DockButton>
      </div>
    </div>
  );
}
