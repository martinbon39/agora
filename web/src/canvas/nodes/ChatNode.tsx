import { memo, useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Megaphone, SendHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type ChatMessage } from "@/api";
import { serverEvents } from "@/events";
import { HarnessIcon } from "@/components/HarnessIcon";
import { useCanvasApi } from "../context";

/** Stable per-agent hue from the name — every voice gets its own color. */
function agentHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Body with @mentions highlighted (and colored like the mentioned agent). */
function ChatBody({ body }: { body: string }) {
  const parts = body.split(/(@[\w-]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground/90" style={{ fontSize: "clamp(12px, 3.2cqw, 17px)" }}>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span
            key={i}
            className="rounded bg-accent/70 px-1 py-px font-medium"
            style={{ color: `hsl(${agentHue(p.slice(1))} 70% 70%)` }}
          >
            {p}
          </span>
        ) : (
          p
        )
      )}
    </p>
  );
}

function timeShort(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The project board.
 *
 * Agents announce here with `argos chat` and read it with `argos board`, and
 * nothing posted here interrupts anyone — that is the whole point. A directed
 * question (`argos ask <name>`) shows up too, rendered "author -> recipient",
 * so the fleet's traffic has one visible trace.
 */
export const ChatNode = memo(function ChatNode({ id, selected }: NodeProps) {
  const ctx = useCanvasApi();
  const project = ctx.canvasId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .chatList(project)
      .then(({ messages }) => !cancelled && setMessages(messages))
      .catch(() => {});
    const unsub = serverEvents.subscribe((msg) => {
      if (msg.type !== "chat" || msg.project !== project) return;
      setMessages((list) =>
        list.some((m) => m.id === (msg.message as ChatMessage).id)
          ? list
          : [...list, msg.message as ChatMessage]
      );
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [project]);

  // pin the feed to the newest message
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    api.chatPost(project, body).catch(() => {});
  };


  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={300}
        minHeight={280}
        lineClassName="!border-ring/60"
        handleClassName="!size-2.5 !rounded-[3px] !border-ring !bg-card"
      />
      <div className={cn("canvas-node", selected && "canvas-node-selected")}>
        {ctx.ctrlHeld && <div aria-hidden className="absolute inset-0 z-20" />}
        <header className="node-drag-handle flex h-9 shrink-0 items-center gap-2 border-b border-border px-2.5">
          <Megaphone className="size-3.5 shrink-0 text-amber-400" />
          <span className="text-xs font-medium">Project board</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/60">
            read, never pushed
          </span>
          <button
            title="Close"
            onClick={() => ctx.removeNode(id)}
            className="nodrag flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div ref={feedRef} className="nodrag nowheel min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          {messages.length === 0 && (
            <p className="pt-6 text-center text-[11px] leading-relaxed text-muted-foreground/60">
              Nothing announced yet. Agents post here with
              <br />
              <code className="text-foreground/80">argos chat "touching db.ts"</code>
              <br />
              and read it with <code className="text-foreground/80">argos board</code>.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor:
                    m.harness === "user"
                      ? "rgb(139 92 246 / 0.25)"
                      : `hsl(${agentHue(m.author)} 60% 50% / 0.22)`,
                  boxShadow:
                    m.harness === "user"
                      ? undefined
                      : `inset 0 0 0 1px hsl(${agentHue(m.author)} 60% 55% / 0.5)`,
                }}
              >
                {m.harness === "user" ? (
                  <span className="text-[9px] font-semibold text-violet-300">M</span>
                ) : (
                  <HarnessIcon harness={m.harness} size={11} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-1.5">
                  <span
                    className="truncate text-[11px] font-semibold"
                    style={{
                      color:
                        m.harness === "user"
                          ? "rgb(167 139 250)"
                          : `hsl(${agentHue(m.author)} 65% 72%)`,
                    }}
                  >
                    {m.author}
                  </span>
                  {/* a directed question is not an announcement: say who it woke */}
                  {m.to_name && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      →{" "}
                      <span style={{ color: `hsl(${agentHue(m.to_name)} 65% 72%)` }}>
                        {m.to_name}
                      </span>
                    </span>
                  )}
                  <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/50">
                    {timeShort(m.created_at)}
                  </span>
                </p>
                <ChatBody body={m.body} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border p-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message every agent on the project…"
            className="nodrag min-w-0 flex-1 rounded-md bg-accent/40 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            onClick={send}
            aria-label="Send"
            className="nodrag flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <SendHorizontal className="size-3.5" />
          </button>
        </div>
      </div>
    </>
  );
});
