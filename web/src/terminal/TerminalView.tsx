import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { useTheme } from "@/theme";
import { api } from "@/api";
import { keepAlive, type KeepAlive } from "@/lib/keepAlive";
import { QuickKeys } from "./QuickKeys";

const fileToBase64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(f);
  });

/** Send an ack once this many bytes have been written into xterm.js. */
const ACK_EVERY = 64 * 1024;

const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#3f3d38",
  cursor: "#8b5cf6",
  cursorAccent: "#ffffff",
  selectionBackground: "#8b5cf62e",
  black: "#3f3d38",
  red: "#dc3d31",
  green: "#3e8a38",
  yellow: "#b08800",
  blue: "#3b6ddf",
  magenta: "#a23dbf",
  cyan: "#08828f",
  white: "#a8a49c",
  brightBlack: "#77736b",
  brightRed: "#e4584e",
  brightGreen: "#52a34b",
  brightYellow: "#c79f1b",
  brightBlue: "#5b85e6",
  brightMagenta: "#b45cd0",
  brightCyan: "#2b9aa6",
  brightWhite: "#c9c5bd",
};

const DARK: ITheme = {
  background: "#101010",
  foreground: "#ded9ce",
  cursor: "#a78bfa",
  cursorAccent: "#101010",
  selectionBackground: "#a78bfa38",
  black: "#28241e",
  red: "#f26d78",
  green: "#8fd968",
  yellow: "#ffcc66",
  blue: "#73b8ff",
  magenta: "#d4a5ff",
  cyan: "#5ce6d5",
  white: "#dbd6cb",
  brightBlack: "#5c574d",
  brightRed: "#ff8a93",
  brightGreen: "#a6e685",
  brightYellow: "#ffd98c",
  brightBlue: "#94cbff",
  brightMagenta: "#e2c2ff",
  brightCyan: "#84f0e2",
  brightWhite: "#f3efe6",
};

interface Props {
  sessionId: string;
  onClose?: () => void;
  /** Inline key bar (mobile). Canvas nodes disable it — a single floating
   *  bar above the dock drives the focused terminal instead. */
  quickKeys?: boolean;
}

/** Imperative surface: upload a file through the terminal's own circuit (same
 *  path as drag-drop / paste — uploads to the VPS, types the path in), type
 *  text into the pty (dictation), or grab keyboard focus. */
export interface TerminalHandle {
  upload: (blob: Blob, name: string) => void;
  sendText: (text: string) => void;
  focus: () => void;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { sessionId, onClose, quickKeys = true },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sendInputRef = useRef<(d: string) => void>(() => {});
  const uploadRef = useRef<(blob: Blob, name: string) => void>(() => {});
  const [live, setLive] = useState(false);
  const [dropping, setDropping] = useState(false);
  const { dark } = useTheme();

  useImperativeHandle(
    ref,
    () => ({
      upload: (blob, name) => uploadRef.current(blob, name),
      sendText: (text) => sendInputRef.current(text),
      focus: () => termRef.current?.focus(),
    }),
    []
  );

  // hot-swap the palette on theme change, no reconnect
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  useEffect(() => {
    const container = containerRef.current!;
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, Consolas, monospace",
      fontSize: 13.5,
      lineHeight: 1.25,
      scrollback: 0, // scrollback lives in tmux (mouse wheel is forwarded)
      theme: document.documentElement.classList.contains("dark") ? DARK : LIGHT,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(container);
    // WebGL renders a silently-black canvas on some GPU/driver combos, with
    // no JS error to catch — keep it opt-in (?gl) until validated per device.
    if (new URLSearchParams(location.search).has("gl")) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // DOM renderer stays active
      }
    }
    // Paste rides the browser's NATIVE paste event (no async clipboard API —
    // Vivaldi rejects clipboard.read() silently, Firefox barely supports it,
    // and native paste needs no permission): xterm's hidden textarea receives
    // the text itself, and the textarea paste listener below picks out images.
    const uploadBlob = async (blob: Blob, name: string) => {
      try {
        const { path, pasteable } = await api.upload(sessionId, name, await fileToBase64(blob));
        // Images: the server just made them the VPS "clipboard" (served by the
        // xclip shim) — send Ctrl+V so Claude Code ingests the actual image
        // ([Image #1]), not a path. Other files keep the typed-path flow.
        if (pasteable) sendInputRef.current("\x16");
        else sendInputRef.current(`${path} `);
      } catch {
        term.write(`\r\n\x1b[31m[agora] upload failed: ${name}\x1b[0m\r\n`);
      }
    };
    uploadRef.current = uploadBlob;

    // Plain Ctrl+V must remain a NATIVE browser paste. xterm's default keydown
    // handling turns it into a literal \x16 sent to the pty (and preventDefaults
    // the browser paste) — Claude Code then reads the VPS xclip shim, i.e. it
    // re-ingests the LAST uploaded image forever instead of pasting what is on
    // the user's clipboard. Returning false makes xterm ignore the key, so the
    // browser pastes into the hidden textarea and the listener below runs.
    term.attachCustomKeyEventHandler((ev) => {
      if (
        ev.type === "keydown" &&
        (ev.key === "v" || ev.key === "V") &&
        ev.ctrlKey &&
        !ev.shiftKey &&
        !ev.altKey &&
        !ev.metaKey
      ) {
        return false;
      }
      return true;
    });

    // Image paste hooks the textarea itself: xterm's own paste handler calls
    // stopPropagation(), so a React onPaste higher up never fires while the
    // terminal is focused. One Ctrl+V for everything, text wins — many Windows
    // apps put a junk bitmap next to copied text, which must not be ingested.
    // Image-only pastes stop xterm's handler (capture phase) so it doesn't
    // also emit an empty bracketed paste.
    const onTextareaPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.getData("text/plain")) return; // xterm pastes the text
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!images.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      for (const f of images) uploadBlob(f, f.name || "clipboard.png");
    };
    term.textarea?.addEventListener("paste", onTextareaPaste, true);

    // OSC 52 by hand: tmux emits an empty selection field (`52;;<b64>`)
    // which @xterm/addon-clipboard ignores. Write-only — clipboard reads
    // ("?") are never answered.
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(";") + 1);
      if (!b64 || b64 === "?") return true;
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        if (text) navigator.clipboard?.writeText(text).catch(() => {});
      } catch {}
      return true;
    });
    fit.fit();

    // --- touch scroll --------------------------------------------------------
    // xterm keeps no local scrollback here (scrollback:0) — every scroll is
    // forwarded to tmux / the alt-screen app through wheel events. Touch never
    // emits wheel events, so on mobile a vertical swipe did nothing. Translate
    // swipes into synthetic wheel events dispatched on .xterm-viewport, exactly
    // where a real wheel lands: they bubble up to the .xterm root, so xterm's
    // own routing handles EVERY mode with no mode-detection here — tmux copy-mode
    // scroll, alt-screen arrow-key translation, and mouse-report sequences.
    const wheelTarget = container.querySelector<HTMLElement>(".xterm-viewport") ?? container;
    const LINE_PX = 16; // px of finger travel per emitted wheel "line"
    const emitWheelLines = (lines: number, x: number, y: number) => {
      const dir = lines < 0 ? -1 : 1;
      for (let i = 0; i < Math.abs(lines); i++) {
        wheelTarget.dispatchEvent(
          new WheelEvent("wheel", {
            deltaMode: WheelEvent.DOM_DELTA_LINE,
            deltaY: dir,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    };

    let touchId: number | null = null;
    let lastY = 0;
    let lastX = 0;
    let accum = 0; // undrained finger travel, px
    let velocity = 0; // lines per frame, for release inertia
    let lastMoveT = 0;
    let inertiaRaf = 0;
    const stopInertia = () => {
      if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
      inertiaRaf = 0;
    };
    const drain = () => {
      const lines = Math.trunc(accum / LINE_PX);
      if (lines) {
        emitWheelLines(lines, lastX, lastY);
        accum -= lines * LINE_PX;
      }
      return lines;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // leave pinch / multi-touch alone
      stopInertia();
      const t = e.changedTouches[0];
      touchId = t.identifier;
      lastY = t.clientY;
      lastX = t.clientX;
      accum = 0;
      velocity = 0;
      lastMoveT = e.timeStamp;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchId === null) return;
      const t = Array.from(e.touches).find((x) => x.identifier === touchId);
      if (!t) return;
      accum += lastY - t.clientY; // finger up => positive => scroll toward newer output
      lastY = t.clientY;
      lastX = t.clientX;
      const lines = drain();
      const dt = Math.max(1, e.timeStamp - lastMoveT);
      lastMoveT = e.timeStamp;
      if (lines) velocity = (lines / dt) * 16; // lines per ~16ms frame
      e.preventDefault(); // we own the gesture (backed by touch-action:none)
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchId === null) return;
      if (!Array.from(e.changedTouches).some((x) => x.identifier === touchId)) return;
      touchId = null;
      let v = velocity; // light, fast-decaying inertia so a flick keeps gliding
      velocity = 0;
      if (Math.abs(v) < 0.5) return;
      const tick = () => {
        v *= 0.9;
        accum += v * LINE_PX;
        drain();
        inertiaRaf = Math.abs(v) > 0.35 ? requestAnimationFrame(tick) : 0;
      };
      inertiaRaf = requestAnimationFrame(tick);
    };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });

    let ws: WebSocket | null = null;
    let disposed = false;
    let retry = 0;
    let unackedBytes = 0;
    let generation = 0;
    let heart: KeepAlive | null = null;

    const connect = () => {
      if (disposed) return;
      // Each attempt owns a generation, so a socket we gave up on cannot open a
      // second one when its onclose finally arrives.
      const mine = ++generation;
      const stale = () => disposed || mine !== generation;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(
        `${proto}://${location.host}/ws/sessions/${sessionId}/attach?cols=${term.cols}&rows=${term.rows}`
      );
      ws = sock;
      sock.binaryType = "arraybuffer";

      const reconnect = (delay: number, note: string) => {
        if (stale()) return;
        generation++;
        heart?.stop();
        heart = null;
        setLive(false);
        term.write(`\r\n\x1b[33m[agora] ${note} — reconnecting in ${delay}ms\x1b[0m\r\n`);
        setTimeout(connect, delay);
      };

      sock.onopen = () => {
        if (stale()) {
          sock.close();
          return;
        }
        retry = 0;
        // the server's own ping is answered by the browser and is invisible to
        // this code, so probe back — see lib/keepAlive.ts
        heart = keepAlive(sock, { t: "p" }, () =>
          reconnect(500, "connection went quiet")
        );
        sendResize();
      };

      sock.onmessage = (ev) => {
        heart?.seen();
        if (typeof ev.data === "string") return; // the heartbeat's answer
        setLive(true);
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        term.write(bytes, () => {
          unackedBytes += bytes.length;
          if (unackedBytes >= ACK_EVERY) {
            sock.readyState === WebSocket.OPEN &&
              sock.send(JSON.stringify({ t: "a", n: unackedBytes }));
            unackedBytes = 0;
          }
        });
      };

      sock.onclose = (ev) => {
        if (stale()) return;
        if (ev.code === 4404) {
          generation++;
          heart?.stop();
          term.write("\r\n\x1b[31m[agora] session not found\x1b[0m\r\n");
          onCloseRef.current?.();
          return;
        }
        if (ev.code === 4403) {
          // scope was revoked or narrowed. Retrying is pointless and the retry
          // loop would hammer the server forever with 401 upgrades.
          generation++;
          heart?.stop();
          term.write(`\r\n\x1b[31m[agora] ${ev.reason || "access revoked"}\x1b[0m\r\n`);
          onCloseRef.current?.();
          return;
        }
        reconnect(Math.min(500 * 2 ** retry++, 8000), "disconnected");
      };
    };

    const send = (msg: object) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const sendResize = () => send({ t: "r", cols: term.cols, rows: term.rows });

    // --- mobile IME ghost filter -------------------------------------------
    // Android keyboards (GBoard, voice dictation) drive xterm through IME
    // composition events, and xterm re-emits the same composed chunk through
    // several internal paths — typed text arrives 2-4× (xterm.js #3600, still
    // open in 6.0). A multi-char chunk identical to the previous one, arriving
    // within GHOST_MS while composition is active/recent, cannot be produced
    // by a human — drop it. Desktop keyboards never compose: zero effect there.
    const GHOST_MS = 300;
    let lastCompositionT = -Infinity;
    const markComposition = () => (lastCompositionT = performance.now());
    for (const ev of ["compositionstart", "compositionupdate", "compositionend"] as const)
      term.textarea?.addEventListener(ev, markComposition);
    let lastData = "";
    let lastDataT = -Infinity;
    const sendInput = (d: string) => {
      const now = performance.now();
      const ghost =
        d.length > 1 &&
        d === lastData &&
        now - lastDataT < GHOST_MS &&
        now - lastCompositionT < 1000;
      lastData = d;
      lastDataT = now; // ghosts refresh the window so a whole burst dies, not just its 2nd copy
      if (!ghost) send({ t: "i", d });
    };

    const dataSub = term.onData(sendInput);
    sendInputRef.current = (d) => send({ t: "i", d });
    const resizeSub = term.onResize(() => sendResize());

    // copy-on-select, Warp-style: any selection (incl. Shift+drag inside
    // full-screen TUIs) lands in the clipboard without an explicit Ctrl+C
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    const selSub = term.onSelectionChange(() => {
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        const sel = term.getSelection();
        if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
      }, 200);
    });

    // fit live during the drag, then once more after it settles: a fit against
    // mid-transition metrics leaves stale cell dimensions in the renderer, and
    // mouse hit-testing (hover underline, clicks) lands off by a cell or more.
    // The settle pass re-fits and forces a full repaint with final metrics.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      fit.fit();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          fit.fit();
          term.refresh(0, term.rows - 1);
        });
      }, 150);
    });
    observer.observe(container);

    connect();
    term.focus();

    return () => {
      disposed = true;
      stopInertia();
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      observer.disconnect();
      clearTimeout(settleTimer);
      dataSub.dispose();
      resizeSub.dispose();
      selSub.dispose();
      clearTimeout(copyTimer);
      term.textarea?.removeEventListener("paste", onTextareaPaste, true);
      for (const ev of ["compositionstart", "compositionupdate", "compositionend"] as const)
        term.textarea?.removeEventListener(ev, markComposition);
      osc52.dispose();
      heart?.stop();
      ws?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  // dropped files upload to the VPS; their path is typed into the terminal so
  // the agent inside (claude, shell…) can read them directly
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    for (const f of e.dataTransfer?.files ?? []) {
      await uploadRef.current(f, f.name);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {quickKeys && <QuickKeys onKey={(seq) => sendInputRef.current(seq)} />}
      <div
        className="relative min-h-0 flex-1 p-2.5"
        onClick={() => termRef.current?.focus()}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={onDrop}
        onPaste={(e) => {
          // the ONLY image-paste path (Ctrl+V, context menu, mobile) — text
          // falls through to xterm's own textarea paste handling.
          // Text always wins: many Windows sources put a junk bitmap next to
          // copied text, and uploading it injected a bogus [Image #1] on
          // every text paste. Images are ingested only on text-free pastes.
          if (e.clipboardData?.getData("text/plain")) return;
          const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
            f.type.startsWith("image/")
          );
          if (images.length) {
            e.preventDefault();
            for (const f of images) uploadRef.current(f, f.name || "clipboard.png");
          }
        }}
      >
        {/* fit() measures this element — it must have NO padding of its own,
            or the computed rows overflow the visible area */}
        <div className="terminal-container h-full w-full overflow-hidden" ref={containerRef} />
        {dropping && (
          <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5">
            <p className="text-sm font-medium text-primary">Drop files — images paste into the session</p>
          </div>
        )}
        <div
          aria-hidden
          className={
            "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 " +
            (live ? "opacity-0" : "opacity-100")
          }
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
            connecting…
          </span>
        </div>
      </div>
    </div>
  );
});
