import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/** Canvas dictation. Preferred path: record the mic (MediaRecorder) and let
 *  the server transcribe via Groq Whisper (whisper-large-v3-turbo) — fast,
 *  accurate, any browser. Fallback when no Groq key is configured: the Web
 *  Speech API (Chrome/Edge/Safari). Final text streams to `onText`. */
export function useDictation(onText: (text: string) => void) {
  const [mode, setMode] = useState<"groq" | "webspeech" | "none">("none");
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing" | "listening">(
    "idle"
  );
  const [interim, setInterim] = useState("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const WebSpeechCtor =
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
      : undefined;

  useEffect(() => {
    let cancelled = false;
    api
      .dictateStatus()
      .then(({ available }) => {
        if (cancelled) return;
        const canRecord =
          typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
        setMode(
          available && canRecord
            ? "groq"
            : typeof WebSpeechCtor === "function"
              ? "webspeech"
              : "none"
        );
      })
      .catch(() => {
        if (!cancelled) setMode(typeof WebSpeechCtor === "function" ? "webspeech" : "none");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- groq: record → POST → transcript ----------------------------------
  const recorderRef = useRef<MediaRecorder | null>(null);

  const startGroq = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) {
          setPhase("idle");
          return; // sub-second tap, nothing to transcribe
        }
        setPhase("transcribing");
        try {
          const { text } = await api.dictate(await blobToBase64(blob), blob.type);
          const t = text.trim();
          if (t) onTextRef.current(t + " ");
        } catch (e) {
          toast.error("Transcription failed", { description: String(e) });
        }
        setPhase("idle");
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");
    } catch (e) {
      toast.error("Microphone unavailable", { description: String(e) });
      setPhase("idle");
    }
  }, []);

  // ---- web speech fallback ------------------------------------------------
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);

  const stopWebSpeech = useCallback(() => {
    listeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterim("");
    setPhase("idle");
  }, []);

  const startWebSpeech = useCallback(() => {
    const rec = new (WebSpeechCtor as SpeechRecognitionCtor)();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) onTextRef.current(r[0].transcript.trim() + " ");
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onend = () => {
      // Chrome stops on silence — keep listening until the user toggles off
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          stopWebSpeech();
        }
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") stopWebSpeech();
    };
    recognitionRef.current = rec;
    listeningRef.current = true;
    setPhase("listening");
    rec.start();
  }, [WebSpeechCtor, stopWebSpeech]);

  const toggle = useCallback(() => {
    if (phase === "recording") recorderRef.current?.stop();
    else if (phase === "listening") stopWebSpeech();
    else if (phase === "idle") {
      if (mode === "groq") startGroq();
      else if (mode === "webspeech") startWebSpeech();
    }
    // "transcribing": ignore, it resolves on its own
  }, [phase, mode, startGroq, startWebSpeech, stopWebSpeech]);

  // teardown on unmount
  useEffect(
    () => () => {
      recorderRef.current?.stop();
      listeningRef.current = false;
      recognitionRef.current?.stop();
    },
    []
  );

  const status =
    phase === "recording"
      ? "recording — click the mic again to transcribe"
      : phase === "transcribing"
        ? "transcribing…"
        : interim || "listening — speaking types into the focused terminal";

  return {
    supported: mode !== "none",
    active: phase !== "idle",
    interim: status,
    toggle,
  };
}

// Minimal typings — lib.dom's SpeechRecognition is still behind a flag.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
