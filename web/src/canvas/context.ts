import { createContext, useContext } from "react";
import type { PresencePeer, Session } from "@/api";
import type { TerminalHandle } from "@/terminal/TerminalView";

/** Runtime services the node components need. Kept OUT of React Flow node
 *  `data` so persisted docs stay pure JSON and callbacks never go stale. */
export interface CanvasApi {
  /** Project path this canvas belongs to. */
  canvasId: string;
  /** Ctrl is held: nodes overlay a shield so wheel = canvas zoom, not scroll. */
  ctrlHeld: boolean;
  /** OTHER humans connected to this project right now (multiplayer). */
  peers: PresencePeer[];
  /** Animate the viewport to a node at zoom 1 (crisp xterm hit-testing). */
  zoomToNode: (nodeId: string) => void;
  sessions: Session[];
  archiveSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  registerTerminal: (sessionId: string, handle: TerminalHandle | null) => void;
  setFocusedSession: (sessionId: string) => void;
  /** Open any session, any project (Panoptes wall). */
  openSession: (sessionId: string) => void;
  /** Inject a task into an idle agent's terminal; false if it was busy. */
  sendToSession: (sessionId: string, text: string) => Promise<boolean>;
  /** Flag a todo item as dispatched to an agent. */
  markTodoSent: (nodeId: string, index: number) => void;
  /** Fork a terminal: same project, and for claude the same conversation. */
  forkSession: (sessionId: string) => void;
  /** Open (or focus) a file-viewer node linked to the given explorer node. */
  openFile: (fromNodeId: string, path: string) => void;
}

export const CanvasCtx = createContext<CanvasApi | null>(null);

export function useCanvasApi(): CanvasApi {
  const ctx = useContext(CanvasCtx);
  if (!ctx) throw new Error("useCanvasApi outside CanvasCtx");
  return ctx;
}
