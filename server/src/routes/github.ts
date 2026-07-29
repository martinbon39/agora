import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * GitHub via the `gh` CLI: Martin authenticates once with `gh auth login`
 * inside an agora terminal session, then agora can list and clone his repos.
 */
export async function githubRoutes(app: FastifyInstance) {
  app.get("/api/github/repos", async (_req, reply) => {
    try {
      const { stdout } = await exec(
        "gh",
        ["repo", "list", "--limit", "100", "--json", "nameWithOwner,description,updatedAt,isPrivate,url"],
        { timeout: 20_000 }
      );
      return { repos: JSON.parse(stdout) };
    } catch (err) {
      const msg = String(err);
      if (/not logged|auth|ENOENT/i.test(msg)) {
        return reply.code(409).send({
          error: "gh not authenticated — run `gh auth login` in a terminal session",
        });
      }
      return reply.code(502).send({ error: msg.slice(0, 300) });
    }
  });
}
