import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { sessions } from "../db.js";
import { getAuthUser, scopeAllows } from "../auth.js";

export const uploadsDir = () => path.join(config.dataDir, "uploads");
export const clipboardDir = () => path.join(config.dataDir, "clipboard");

const EXT_OK = /^\.(png|jpe?g|gif|webp|svg|pdf|txt|md|csv|json)$/i;

// Formats Claude Code accepts from a clipboard paste (its xclip probe greps
// image/(png|jpeg|jpg|gif|webp|bmp)). svg/pdf/… stay on the typed-path flow.
const PASTEABLE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function uploadRoutes(app: FastifyInstance) {
  // Images pasted straight onto a canvas (no terminal involved) — stored
  // under uploads/canvas/ and rendered by ImageNode via the static mount.
  app.post<{ Body: { project?: string; name?: string; data?: string } }>(
    "/api/canvas-image",
    { bodyLimit: 40 * 1024 * 1024 },
    async (req, reply) => {
      const { project, name, data } = req.body ?? {};
      if (!project || !data) return reply.code(400).send({ error: "project and data required" });
      if (!scopeAllows(getAuthUser(req) ?? undefined, project))
        return reply.code(403).send({ error: "outside your scope" });
      let ext = path.extname(name ?? "").toLowerCase();
      if (!/^\.(png|jpe?g|gif|webp)$/.test(ext)) ext = ".png";
      const dir = path.join(uploadsDir(), "canvas");
      fs.mkdirSync(dir, { recursive: true });
      const file = `${nanoid(10)}${ext}`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(data, "base64"));
      return { src: `/uploads/canvas/${file}` };
    }
  );

  // Images/files pasted or dropped into a session. Body is JSON+base64 so we
  // don't need a multipart dependency; the route accepts up to ~30 MB.
  app.post<{ Params: { id: string }; Body: { name?: string; data?: string } }>(
    "/api/uploads/:id",
    { bodyLimit: 40 * 1024 * 1024 },
    async (req, reply) => {
      const row = sessions.get(req.params.id);
      if (!row) return reply.code(404).send({ error: "unknown session" });
      // same gate as /api/canvas-image: a guest must not write into a session
      // outside their scope — this route also overwrites the paste clipboard
      if (!scopeAllows(getAuthUser(req) ?? undefined, row.project_path))
        return reply.code(403).send({ error: "outside your scope" });
      const { name, data } = req.body ?? {};
      if (!data) return reply.code(400).send({ error: "missing data" });
      let ext = path.extname(name ?? "").toLowerCase();
      if (!EXT_OK.test(ext)) ext = ".png"; // pasted screenshots arrive nameless
      const dir = path.join(uploadsDir(), row.id);
      fs.mkdirSync(dir, { recursive: true });
      const file = `${nanoid(8)}${ext}`;
      const bytes = Buffer.from(data, "base64");
      fs.writeFileSync(path.join(dir, file), bytes);
      // Pasteable images also become the machine's "clipboard": the xclip shim
      // (deploy/xclip, installed in ~/.local/bin) serves these two files, so
      // sending Ctrl+V to the pane makes Claude Code ingest the actual image.
      const mime = PASTEABLE[ext];
      if (mime) {
        fs.mkdirSync(clipboardDir(), { recursive: true });
        fs.writeFileSync(path.join(clipboardDir(), "image"), bytes);
        fs.writeFileSync(path.join(clipboardDir(), "mime"), mime);
      }
      return {
        path: path.join(dir, file), // absolute path — what Claude reads
        url: `/uploads/${row.id}/${file}`, // served URL — what the UI shows
        pasteable: Boolean(mime), // true → client sends Ctrl+V instead of the path
      };
    }
  );
}
