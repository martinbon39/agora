import fs from "node:fs";
import path from "node:path";

/** Is `target` the root itself, or somewhere inside it?
 *
 *  The `path.sep` is the entire guard, and it is the easiest thing in this
 *  codebase to leave out: without it, "/srv/projects-evil" tests as inside
 *  "/srv/projects". agora gives each tenant its own root, so that difference
 *  is a tenant boundary — `workspaces/alice-bob` would read as inside
 *  `workspaces/alice`. Three call sites had the separator and one did not,
 *  which is exactly why the check lives in one function now. */
export function withinRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

/** Same question, but immune to symlinks planted inside the root.
 *
 *  The textual check above catches `..`; it cannot catch a symlink, and agents
 *  write files inside these directories all day. stat/read follow links
 *  straight off the box, so the REAL path of the target must also sit under
 *  the REAL path of the root. Resolving both sides is what keeps this working
 *  when the root is itself a symlink. */
export function withinRootReal(root: string, target: string): boolean {
  if (!withinRoot(root, target)) return false;
  try {
    return withinRoot(fs.realpathSync(root), fs.realpathSync(target));
  } catch {
    // a path that cannot be resolved cannot be read either — let the caller 404
    return false;
  }
}
