import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getAuthUser, scopeAllows } from "../auth.js";

/** Read-only repo browsing for the canvas file explorer. Everything is
 *  double-anchored: the project must live under projectsDir, the target must
 *  stay inside the project — and guests only reach their scoped project. */
function resolveProject(project: string | undefined): string | null {
  if (!project) return null;
  const abs = path.resolve(project);
  const root = path.resolve(config.projectsDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(abs).isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

/** Containment has to survive symlinks: `..` is caught by the textual check,
 *  but a symlink planted inside the project (agents write files here) points
 *  anywhere on the box, and statSync/readSync follow it. So the REAL path of
 *  the target must also sit under the REAL path of the project — which keeps
 *  working when projectsDir itself contains symlinked project dirs. */
function resolveInside(projectAbs: string, rel: string): string | null {
  const abs = path.resolve(projectAbs, rel || ".");
  if (abs !== projectAbs && !abs.startsWith(projectAbs + path.sep)) return null;
  let realTarget: string;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(projectAbs);
    // a not-yet-existing path can't be read anyway; let the caller 404 on it
    realTarget = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
  return abs;
}

const MAX_FILE_BYTES = 256 * 1024;

export async function fileRoutes(app: FastifyInstance) {
  app.get("/api/files", async (req, reply) => {
    const { project, dir = "" } = req.query as { project?: string; dir?: string };
    const projectAbs = resolveProject(project);
    if (!projectAbs) return reply.code(400).send({ error: "unknown project" });
    if (!scopeAllows(getAuthUser(req) ?? undefined, project!))
      return reply.code(403).send({ error: "outside your scope" });
    const target = resolveInside(projectAbs, dir);
    if (!target) return reply.code(400).send({ error: "path escapes the project" });
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      return reply.code(404).send({ error: "not a directory" });
    }
    const entries = dirents
      .filter((e) => e.isDirectory() || e.isFile())
      .map((e) => {
        let size = 0;
        if (e.isFile()) {
          try {
            size = fs.statSync(path.join(target, e.name)).size;
          } catch {}
        }
        return { name: e.name, dir: e.isDirectory(), size };
      })
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
    return { entries };
  });

  app.get("/api/file", async (req, reply) => {
    const { project, path: rel } = req.query as { project?: string; path?: string };
    const projectAbs = resolveProject(project);
    if (!projectAbs || !rel) return reply.code(400).send({ error: "project and path required" });
    if (!scopeAllows(getAuthUser(req) ?? undefined, project!))
      return reply.code(403).send({ error: "outside your scope" });
    const target = resolveInside(projectAbs, rel);
    if (!target) return reply.code(400).send({ error: "path escapes the project" });
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return reply.code(404).send({ error: "no such file" });
    }
    if (!stat.isFile()) return reply.code(400).send({ error: "not a file" });
    const fd = fs.openSync(target, "r");
    try {
      const len = Math.min(stat.size, MAX_FILE_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      const binary = buf.subarray(0, 8192).includes(0);
      return {
        content: binary ? "" : buf.toString("utf8"),
        binary,
        truncated: stat.size > MAX_FILE_BYTES,
        size: stat.size,
      };
    } finally {
      fs.closeSync(fd);
    }
  });
}
