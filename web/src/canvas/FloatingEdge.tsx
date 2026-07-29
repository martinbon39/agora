import { BaseEdge, Position, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import type { InternalNode, Node } from "@xyflow/react";

/**
 * An edge that attaches to the nearest border of each node instead of to a
 * fixed handle.
 *
 * Handles are anchored to one side, so a plain edge between two terminals side
 * by side still left from the top and arrived at the top — "ça se branche qu'en
 * haut". Computing the intersection means the link leaves whichever side faces
 * the other node, and follows both as they move.
 */
function nodeCentre(node: InternalNode<Node>) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
  };
}

/** Where the line from one node's centre to the other's crosses the border. */
function borderPoint(node: InternalNode<Node>, towards: { x: number; y: number }) {
  const w = (node.measured.width ?? 0) / 2;
  const h = (node.measured.height ?? 0) / 2;
  const c = nodeCentre(node);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return c;
  // scale the direction until it touches whichever edge it reaches first
  const scale = Math.min(w / Math.abs(dx) || Infinity, h / Math.abs(dy) || Infinity);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Which side that point sits on — the curve needs it to leave perpendicular. */
function sideOf(node: InternalNode<Node>, p: { x: number; y: number }): Position {
  const c = nodeCentre(node);
  const w = (node.measured.width ?? 0) / 2;
  const h = (node.measured.height ?? 0) / 2;
  const dx = (p.x - c.x) / (w || 1);
  const dy = (p.y - c.y) / (h || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Position.Right : Position.Left;
  return dy > 0 ? Position.Bottom : Position.Top;
}

export function FloatingEdge({ id, source, target, style, selected }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;

  const sp = borderPoint(s, nodeCentre(t));
  const tp = borderPoint(t, nodeCentre(s));
  const [path] = getBezierPath({
    sourceX: sp.x,
    sourceY: sp.y,
    sourcePosition: sideOf(s, sp),
    targetX: tp.x,
    targetY: tp.y,
    targetPosition: sideOf(t, tp),
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      style={{ ...style, strokeWidth: selected ? 3 : 2 }}
      interactionWidth={24}
    />
  );
}
