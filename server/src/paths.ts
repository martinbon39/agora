import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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

/** Every tenant gets a directory of their own under the projects root, and
 *  their projects live inside it.
 *
 *  The slug is readable on purpose — an operator looking at the filesystem
 *  should be able to tell whose workspace is whose — but readability alone
 *  collides: `a@b.c` and `a-b.c` both slugify to `a-b-c`, and a collision here
 *  means two tenants sharing a directory. So the email's hash is appended,
 *  which makes the mapping injective without making the path opaque. */
export function workspaceSlug(email: string): string {
  const e = email.toLowerCase();
  const readable = e.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = crypto.createHash("sha256").update(e).digest("hex").slice(0, 8);
  return `${readable || "user"}-${hash}`;
}

export function workspaceRoot(email: string): string {
  return path.join(config.projectsDir, workspaceSlug(email));
}
