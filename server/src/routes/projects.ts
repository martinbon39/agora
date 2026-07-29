import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { scopeAllows } from "../auth.js";

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
    fs.mkdirSync(config.projectsDir, { recursive: true });
    const entries = fs
      .readdirSync(config.projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      // a scoped guest's world is exactly one project
      .filter((e) => scopeAllows(req.authUser, path.join(config.projectsDir, e.name)));
    const projects = await Promise.all(
      entries.map(async (e) => {
        const dir = path.join(config.projectsDir, e.name);
        const [git, info] = await Promise.all([gitRemote(dir), gitInfo(dir)]);
        return { name: e.name, path: dir, git, ...info };
      })
    );
    return { projects };
  });

  app.post<{ Body: { name?: string; cloneUrl?: string; createRepo?: boolean; isPrivate?: boolean } }>(
    "/api/projects",
    async (req, reply) => {
      // creating projects (git clone, gh repo create) stays the owner's move
      if (req.authUser?.role === "guest") {
        return reply.code(403).send({ error: "owner only" });
      }
      const { name, cloneUrl, createRepo, isPrivate } = req.body ?? {};
      fs.mkdirSync(config.projectsDir, { recursive: true });

      if (cloneUrl) {
        if (!/^(https?:\/\/|git@)[\w.@:/~-]+$/.test(cloneUrl)) {
          return reply.code(400).send({ error: "invalid clone URL" });
        }
        const inferred = cloneUrl.split("/").pop()?.replace(/\.git$/, "") ?? "";
        const dirName = name ?? inferred;
        if (!NAME_RE.test(dirName)) return reply.code(400).send({ error: "invalid project name" });
        const dest = path.join(config.projectsDir, dirName);
        if (fs.existsSync(dest)) return reply.code(409).send({ error: "project already exists" });
        try {
          await exec("git", ["clone", "--", cloneUrl, dest], { timeout: 120_000 });
        } catch (err) {
          return reply.code(502).send({ error: `git clone failed: ${String(err)}` });
        }
        return { project: { name: dirName, path: dest, git: cloneUrl } };
      }

      if (!name || !NAME_RE.test(name)) {
        return reply.code(400).send({ error: "invalid project name" });
      }
      const dest = path.join(config.projectsDir, name);
      if (fs.existsSync(dest)) return reply.code(409).send({ error: "project already exists" });
      fs.mkdirSync(dest);

      // fresh project: init git so sessions can commit right away — with an
      // explicit identity, the argos user has no global git config
      try {
        await exec("git", ["-C", dest, "init", "-b", "main"]);
        fs.writeFileSync(path.join(dest, "README.md"), `# ${name}\n`);
        await exec("git", ["-C", dest, "add", "-A"]);
        await exec("git", [
          "-C",
          dest,
          "-c",
          "user.name=argos",
          "-c",
          "user.email=argos@localhost",
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
