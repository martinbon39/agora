// Claude Code, as it actually renders in a terminal (reference: a live agora
// session captured with `argos read --terminal`). The recognizable furniture
// never moves: round bullets on messages and tool calls, `⎿` result lines,
// the spinner verb with elapsed time and a token counter, the framed prompt
// with `❯`, and the status line underneath.
//
// Content is driven by `events`; the scenes reveal them with `visibleCount`.
// Purely presentational: no Remotion hooks, no internal animation. `frame` and
// `spinnerFrame` only pick discrete states (spinner glyph, caret blink, token
// counter, and the default-content reveal when no events are passed).
//
// When the content is taller than the body, it clips from the TOP, like a real
// terminal that has scrolled: the last lines always stay visible, and the
// prompt box and footer stay pinned to the bottom. The top/bottom anchor is
// chosen from a deterministic line estimate (monospace, known width), never
// from DOM measurement.

import React from 'react';
import { c, font, term } from '../brand/tokens';

export type TuiEvent =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: string; result?: string }
  | { kind: 'note'; text: string; color?: string };

export type TuiStatus = 'working' | 'idle' | 'waiting';

const SPINNER = ['·', '✢', '✳', '✻', '✽', '✻', '✳', '✢'] as const;
const STEP = 24;

const DEFAULT_EVENTS: TuiEvent[] = [
  {
    kind: 'assistant',
    text: 'The reaper test is flaky because the timeout races the socket close. Fixing it.',
  },
  {
    kind: 'tool',
    name: 'Bash',
    args: 'npx vitest run server/test/socket.test.ts',
    result: '1 failed · 41 passed (reaper escalation timed out)',
  },
  {
    kind: 'tool',
    name: 'Edit',
    args: 'server/src/socket/reaper.ts',
    result: 'Updated reaper.ts with 2 additions and 1 removal',
  },
];

/** JetBrains Mono advance width is 0.6em; good enough to predict wrapping. */
export const estimateTuiLines = (
  events: TuiEvent[],
  width: number,
  fontSize: number,
): number => {
  const chars = Math.max(10, Math.floor((width - 24) / (fontSize * 0.6)));
  const linesFor = (text: string) => Math.max(1, Math.ceil(text.length / chars));
  return events.reduce((n, e) => {
    if (e.kind === 'tool')
      return n + linesFor(`x ${e.name}(${e.args})`) + (e.result ? linesFor(e.result) : 0);
    return n + linesFor(e.text) + 0.3;
  }, 0);
};

export const TuiClaude: React.FC<{
  width: number;
  height: number;
  fontSize?: number;
  events?: TuiEvent[];
  visibleCount?: number;
  status?: TuiStatus;
  spinnerFrame?: number;
  promptText?: string;
  caretOn?: boolean;
  frame?: number;
}> = ({
  width,
  height,
  fontSize = 13.5,
  events,
  visibleCount,
  status = 'working',
  spinnerFrame,
  promptText,
  caretOn,
  frame,
}) => {
  const sf = spinnerFrame ?? frame ?? 0;
  const all = events ?? DEFAULT_EVENTS;
  // legacy default-content reveal: one event per beat when only `frame` is set
  const count =
    visibleCount ?? (events === undefined && frame !== undefined ? Math.floor(frame / STEP) + 1 : all.length);
  const shown = all.slice(0, Math.max(0, count));

  const spin = SPINNER[Math.floor(sf / 6) % SPINNER.length];
  const mins = Math.floor(sf / 3600);
  const secs = Math.floor(sf / 60) % 60;
  const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const tokens = (0.4 + sf * 0.012).toFixed(1);
  const blink = caretOn ?? Math.floor(sf / 30) % 2 === 0;

  const lineH = fontSize * 1.5;
  const statusLines = status === 'idle' ? 0 : 1.6;
  const chromeH = lineH + 12 + 2 + fontSize * 0.85 * 1.5 + 8; // prompt box + footer
  const availLines = (height - 24 - chromeH) / lineH;
  const anchorBottom = estimateTuiLines(shown, width, fontSize) + statusLines > availLines;

  const body = (
    <>
      {shown.map((e, i) => {
        switch (e.kind) {
          case 'user':
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
                <span style={{ color: term.brightBlack }}>&gt; </span>
                {e.text}
              </div>
            );
          case 'assistant':
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
                <span style={{ color: term.foreground }}>● </span>
                {e.text}
              </div>
            );
          case 'tool':
            return (
              <div key={i}>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: term.green }}>● </span>
                  <span style={{ fontWeight: 700 }}>{e.name}</span>
                  <span style={{ color: term.brightBlack }}>({e.args})</span>
                </div>
                {e.result && (
                  <div style={{ color: term.brightBlack, whiteSpace: 'pre-wrap' }}>
                    {'  ⎿  '}
                    {e.result}
                  </div>
                )}
              </div>
            );
          case 'note':
            return (
              <div key={i} style={{ color: e.color ?? term.brightBlack, whiteSpace: 'pre-wrap' }}>
                {e.text}
              </div>
            );
        }
      })}

      {status === 'working' && (
        <div style={{ marginTop: 8 }}>
          <span style={{ color: c.claude }}>{spin} Forging… </span>
          <span style={{ color: term.brightBlack }}>
            ({elapsed} · ↓ {tokens}k tokens · esc to interrupt)
          </span>
        </div>
      )}
      {status === 'waiting' && (
        <div style={{ marginTop: 8, color: term.red }}>
          ? waiting for approval{' '}
          <span style={{ color: term.brightBlack }}>(y to allow · esc to deny)</span>
        </div>
      )}
    </>
  );

  return (
    <div
      style={{
        width,
        height,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: term.background,
        padding: 12,
        fontFamily: font.mono,
        fontSize,
        lineHeight: 1.5,
        color: term.foreground,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {anchorBottom ? (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{body}</div>
        ) : (
          body
        )}
      </div>

      {/* the framed prompt, always pinned at the bottom */}
      <div
        style={{
          flexShrink: 0,
          border: `1px solid ${term.brightBlack}`,
          borderRadius: 6,
          padding: '5px 10px',
          whiteSpace: 'pre',
          overflow: 'hidden',
        }}
      >
        <span style={{ color: c.violet }}>❯ </span>
        {promptText}
        <span
          style={{
            display: 'inline-block',
            width: '0.6em',
            height: '1.05em',
            verticalAlign: '-0.15em',
            background: term.cursor,
            opacity: blink ? 1 : 0.15,
          }}
        />
      </div>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          color: term.brightBlack,
          fontSize: fontSize * 0.85,
          paddingTop: 4,
        }}
      >
        <span>? for shortcuts</span>
        <span>agora · main · ctx 42%</span>
      </div>
    </div>
  );
};
