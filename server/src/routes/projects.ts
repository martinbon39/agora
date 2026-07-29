import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { scopeAllows } from "../auth.js";
import { projects as registry } from "../db.js";
import { workspaceRoot } from "../paths.js";

const exec = promisify(execFile);

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function gitRemote(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", dir, "remote", "get-url", "origin"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gitInfo(dir: string): Promise<{ branch: string | null; dirty: boolean }> {
  let branch: string | null = null;
  let dirty = false;
  try {
    // symbolic-ref works even before the first commit; rev-parse doesn't
    branch = (await exec("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"])).stdout.trim();
  } catch {
    try {
      // detached HEAD: show the short sha instead
      branch = (await exec("git", ["-C", dir, "rev-parse", "--short", "HEAD"])).stdout.trim();
    } catch {
      // not a git repo
    }
  }
  try {
    dirty = (await exec("git", ["-C", dir, "status", "--porcelain"])).stdout.trim().length > 0;
  } catch {
    // not a git repo
  }
  return { branch, dirty };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async (req) => {
    // The registry lists, not the filesystem. argos read the projects root with
    // readdirSync and asked permission per entry, which is fine when every
    // directory belongs to the one person browsing. Here, scanning a shared
    // root means the answer starts as "everybody's projects" and narrows —
    // one forgotten filter and it leaks. Starting from rows owned by the caller
    // means a leak needs a wrong query, not a missing one.
    const rows = req.authUser ? registry.forOwner(req.authUser.email) : [];
    // a guest owns nothing and sees exactly the project their invite names
    if (req.authUser?.project && scopeAllows(req.authUser, req.authUser.project)) {
      const invited = registry.get(path.resolve(req.authUser.project));
      if (invited && !rows.some((r) => r.path === invited.path)) rows.push(invited);
    }
    const projects = await Promise.all(
      rows
        .filter((r) => fs.existsSync(r.path))
        .map(async (r) => {
          const [git, info] = await Promise.all([gitRemote(r.path), gitInfo(r.path)]);
          return { name: r.name, path: r.path, git, ...info };
        })
    );
    return { projects };
  });

  app.post<{ Body: { name?: string; cloneUrl?: string; createRepo?: boolean; isPrivate?: boolean } }>(
    "/api/projects",
    async (req, reply) => {
      // a guest is a visitor inside somebody else's project: no workspace of
      // their own, so nowhere to put a new project even if they were allowed
      if (!req.authUser || req.authUser.role === "guest") {
        return reply.code(403).send({ error: "guests cannot create projects" });
      }
      const { name, cloneUrl, createRepo, isPrivate } = req.body ?? {};
      const owner = req.authUser.email.toLowerCase();
      const root = workspaceRoot(owner);
      fs.mkdirSync(root, { recursive: true });

      if (cloneUrl) {
        if (!/^(https?:\/\/|git@)[\w.@:/~-]+$/.test(cloneUrl)) {
          return reply.code(400).send({ error: "invalid clone URL" });
        }
        const inferred = cloneUrl.split("/").pop()?.replace(/\.git$/, "") ?? "";
        const dirName = name ?? inferred;
        if (!NAME_RE.test(dirName)) return reply.code(400).send({ error: "invalid project name" });
        const dest = path.join(root, dirName);
        if (fs.existsSync(dest)) return reply.code(409).send({ error: "project already exists" });
        try {
          await exec("git", ["clone", "--", cloneUrl, dest], { timeout: 120_000 });
        } catch (err) {
          return reply.code(502).send({ error: `git clone failed: ${String(err)}` });
        }
        registry.insert({ path: dest, name: dirName, owner_email: owner });
        return { project: { name: dirName, path: dest, git: cloneUrl } };
      }

      if (!name || !NAME_RE.test(name)) {
        return reply.code(400).send({ error: "invalid project name" });
      }
      const dest = path.join(root, name);
      if (fs.existsSync(dest)) return reply.code(409).send({ error: "project already exists" });
      fs.mkdirSync(dest);
      // registered before any git work: an unregistered directory is
      // unreachable by design, so a failure below must not leave one orphaned
      registry.insert({ path: dest, name, owner_email: owner });

      // fresh project: init git so sessions can commit right away — with an
      // explicit identity, the agora user has no global git config
      try {
        await exec("git", ["-C", dest, "init", "-b", "main"]);
        fs.writeFileSync(path.join(dest, "README.md"), `# ${name}\n`);
        await exec("git", ["-C", dest, "add", "-A"]);
        await exec("git", [
          "-C",
          dest,
          "-c",
          "user.name=agora",
          "-c",
          "user.email=agora@localhost",
          "commit",
          "-m",
          "init",
        ]);
      } catch {
        // git missing/misconfigured: plain directory is still usable
      }

      // optionally create the GitHub repo and push (needs `gh auth login`)
      if (createRepo) {
        try {
          await exec(
            "gh",
            [
              "repo",
              "create",
              name,
              isPrivate === false ? "--public" : "--private",
              "--source",
              dest,
              "--remote",
              "origin",
              "--push",
            ],
            { timeout: 60_000 }
          );
        } catch (err) {
          return reply.code(502).send({
            error: `project created locally, but GitHub repo failed: ${String(err).slice(0, 300)}`,
          });
        }
      }
      return { project: { name, path: dest, git: await gitRemote(dest) } };
    }
  );
}
