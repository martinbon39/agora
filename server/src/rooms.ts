import { projects, sessions, type ProjectRow } from "./db.js";
import * as tmux from "./tmux.js";
import { broadcast } from "./events.js";

/**
 * Rooms: a project with a clock.
 *
 * A hackathon is time-boxed, and the box changes behaviour — an agent fleet with
 * six hours left should be told so. `deadline` is that clock, and it is purely
 * informational.
 *
 * `expires_at` is the other half, and it is the dangerous one, so read what it
 * does and does not do:
 *
 *   IT RELEASES COMPUTE. Expiring a room kills its tmux sessions. That is the
 *   cost-control mechanism: a room nobody is watching stops burning tokens and
 *   stops holding RAM on a 4-core box.
 *
 *   IT DOES NOT DELETE ANYTHING. Not the working tree, not the git history, not
 *   the canvas, not the plan, not the transcripts. The strategy note for this
 *   feature said "everything is deleted when the TTL expires", and writing that
 *   down as code made it obvious it should not be built: silently deleting a
 *   team's work on a timer is the single most destructive thing this product
 *   could do, and "the TTL was set by mistake" is not a recoverable state.
 *   Reclaiming disk is a separate, explicit, owner-initiated action.
 *
 * A project with no `expires_at` is never touched. Opting out is the default —
 * an owner should not have to remember to protect their own work.
 */

export interface Released {
  project: string;
  sessionsStopped: string[];
}

/** Release one room's compute. Idempotent: `expired_at` is the latch. */
export async function release(row: ProjectRow): Promise<Released> {
  const live = sessions
    .all()
    .filter((s) => s.project_path === row.path && s.status === "running");
  const stopped: string[] = [];
  for (const s of live) {
    // kill the pane, keep the row: the session's history, cost and transcript
    // are the record of what happened here and outlive the compute
    await tmux.killSession(s.id).catch(() => {});
    sessions.setStatus(s.id, "exited");
    stopped.push(s.id);
  }
  projects.markExpired(row.path);
  if (stopped.length) broadcast({ type: "sessions_changed" });
  return { project: row.path, sessionsStopped: stopped };
}

/** Release every room whose clock has run out. Returns what it touched. */
export async function sweep(now = Date.now()): Promise<Released[]> {
  const out: Released[] = [];
  for (const row of projects.due(now)) out.push(await release(row));
  return out;
}

/** How long a room has left, in ms. Null when it has no clock. */
export function remaining(row: ProjectRow, now = Date.now()): number | null {
  if (row.deadline == null) return null;
  return row.deadline - now;
}
