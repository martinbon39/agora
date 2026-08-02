// OpenAI Codex CLI. The recognizable furniture, from its documented terminal
// UI: the `>_ OpenAI Codex` header card, the model and directory line, dim
// italic thinking summaries, `exec` command lines with their result, the
// magenta `codex` answer label, and the key-hint footer with the context
// percentage on the right.
//
// Same content contract as TuiClaude (events / visibleCount / status), same
// top-clipping rule: when content overflows the body, the last lines win and
// the input line plus footer stay pinned to the bottom.
//
// Purely presentational. `frame`/`spinnerFrame` only pick discrete states.

import React from 'react';
import { font, term } from '../brand/tokens';
import { estimateTuiLines, type TuiEvent, type TuiStatus } from './TuiClaude';

const STEP = 24;

const DEFAULT_EVENTS: TuiEvent[] = [
  { kind: 'user', text: 'mirror the webhook tests for the refund path' },
  { kind: 'note', text: '• thinking: reuse the webhook fixtures, keep billing.ts untouched' },
  { kind: 'tool', name: 'exec', args: 'npx vitest run tests/webhooks.spec.ts', result: '✓ 41 passed in 1.8s' },
  { kind: 'assistant', text: 'Refund tests mirrored. The write to billing.ts needs your approval.' },
];

export const TuiCodex: React.FC<{
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
  status = 'idle',
  spinnerFrame,
  promptText,
  caretOn,
  frame,
}) => {
  const sf = spinnerFrame ?? frame ?? 0;
  const all = events ?? DEFAULT_EVENTS;
  const count =
    visibleCount ?? (events === undefined && frame !== undefined ? Math.floor(frame / STEP) : all.length);
  const shown = all.slice(0, Math.max(0, count));
  const blink = caretOn ?? Math.floor(sf / 30) % 2 === 0;

  const lineH = fontSize * 1.5;
  // header card + model line + input line + footer
  const chromeH = (lineH + 8) * 2 + lineH + fontSize * 0.85 * 1.5 + 12;
  const availLines = (height - 24 - chromeH) / lineH;
  const statusLines = status === 'idle' ? 0 : 1.3;
  const anchorBottom = estimateTuiLines(shown, width, fontSize) + statusLines > availLines;

  const body = (
    <>
      {shown.map((e, i) => {
        switch (e.kind) {
          case 'user':
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
                <span style={{ color: term.brightBlack }}>› </span>
                {e.text}
              </div>
            );
          case 'assistant':
            return (
              <div key={i} style={{ marginTop: 8 }}>
                <div style={{ color: term.brightMagenta, fontWeight: 700 }}>codex</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
              </div>
            );
          case 'tool':
            return (
              <div key={i} style={{ marginTop: 4 }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: term.magenta, fontWeight: 700 }}>{e.name} </span>
                  <span style={{ color: term.brightBlack }}>{e.args}</span>
                </div>
                {e.result && <div style={{ color: term.green }}>{'  ' + e.result}</div>}
              </div>
            );
          case 'note':
            return (
              <div
                key={i}
                style={{
                  color: e.color ?? term.brightBlack,
                  fontStyle: 'italic',
                  whiteSpace: 'pre-wrap',
                  marginTop: 4,
                }}
              >
                {e.text}
              </div>
            );
        }
      })}
      {status === 'working' && (
        <div style={{ color: term.brightBlack, fontStyle: 'italic', marginTop: 4 }}>
          • working…
        </div>
      )}
      {status === 'waiting' && (
        <div style={{ color: term.red, marginTop: 4 }}>
          • awaiting approval{' '}
          <span style={{ color: term.brightBlack }}>(a to approve · esc to deny)</span>
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
      <div style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'inline-block',
            border: `1px solid ${term.brightBlack}`,
            borderRadius: 4,
            padding: '3px 10px',
            marginBottom: 4,
          }}
        >
          <span style={{ fontWeight: 700 }}>&gt;_ </span>OpenAI Codex{' '}
          <span style={{ color: term.brightBlack }}>(v0.29.0)</span>
        </div>
        <div style={{ color: term.brightBlack }}>
          model: gpt-5-codex · /home/orbit/projects/checkout
        </div>
      </div>

      <div style={{ position: 'relative', minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {anchorBottom ? (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{body}</div>
        ) : (
          body
        )}
      </div>

      <div style={{ flexShrink: 0, whiteSpace: 'pre', paddingTop: 4, overflow: 'hidden' }}>
        <span
          style={{
            display: 'inline-block',
            width: '0.55em',
            height: '1.1em',
            verticalAlign: '-0.18em',
            background: term.foreground,
            opacity: blink ? 1 : 0.2,
          }}
        />
        <span style={{ color: promptText ? term.foreground : term.brightBlack }}>
          {' '}
          {promptText ?? 'Ask Codex to do anything'}
        </span>
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
        <span>⏎ send · ⌃J newline · ⌃T transcript · ⌃C quit</span>
        <span>62% context left</span>
      </div>
    </div>
  );
};
