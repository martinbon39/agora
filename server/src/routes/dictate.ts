import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/** Groq Whisper transcription for canvas dictation. The key lives OUTSIDE the
 *  repo: GROQ_API_KEY env var, or ~/.agora/groq.key (chmod 600). */
function groqKey(): string | null {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const key = fs.readFileSync(path.join(config.dataDir, "groq.key"), "utf8").trim();
    return key || null;
  } catch {
    return null;
  }
}

const EXT_BY_MIME: [RegExp, string][] = [
  [/webm/, "webm"],
  [/ogg/, "ogg"],
  [/mp4|m4a|aac/, "m4a"],
  [/mpeg|mp3/, "mp3"],
  [/wav/, "wav"],
];

export async function dictateRoutes(app: FastifyInstance) {
  app.get("/api/dictate/status", async () => ({ available: !!groqKey() }));

  app.post(
    "/api/dictate",
    { bodyLimit: 25 * 1024 * 1024 },
    async (req, reply) => {
      const key = groqKey();
      if (!key) return reply.code(503).send({ error: "no Groq key configured" });
      const { audio, mime } = (req.body ?? {}) as { audio?: string; mime?: string };
      if (!audio) return reply.code(400).send({ error: "audio (base64) required" });

      const buf = Buffer.from(audio, "base64");
      const ext = EXT_BY_MIME.find(([re]) => re.test(mime ?? ""))?.[1] ?? "webm";
      const form = new FormData();
      form.append(
        "file",
        new Blob([buf], { type: mime || "audio/webm" }),
        `dictation.${ext}`
      );
      form.append("model", "whisper-large-v3-turbo");

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        req.log.warn({ status: res.status, detail }, "groq transcription failed");
        return reply.code(502).send({ error: `transcription failed (${res.status})` });
      }
      const json = (await res.json()) as { text?: string };
      return { text: json.text ?? "" };
    }
  );
}
