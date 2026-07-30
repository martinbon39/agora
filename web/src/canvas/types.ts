export type CanvasNodeType =
  | "terminal"
  | "sticky"
  | "browser"
  | "dino"
  | "snake"
  | "chat"
  | "todo"
  | "plan"
  | "files"
  | "file"
  | "image";

/** Persisted shape of a canvas node — everything the server stores. Runtime
 *  extras (session object, callbacks) never land here. */
export interface StoredNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  data: Record<string, unknown>;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Manual FigJam-style link between two nodes, drawn by a human. */
export interface StoredEdge {
  id: string;
  source: string;
  target: string;
  sh?: string;
  th?: string;
}

export interface CanvasDoc {
  nodes: StoredNode[];
  /** Server-maintained deletion tombstones (id -> deleted-at). */
  tomb?: Record<string, number>;
  edges?: StoredEdge[];
  viewport?: CanvasViewport;
}
