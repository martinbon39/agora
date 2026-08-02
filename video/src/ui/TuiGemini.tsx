// Google Gemini CLI. The recognizable furniture, from its documented terminal
// UI: the big GEMINI banner over the whole width, the "Tips for getting
// started" list, the framed `>` input, and the one-line footer with the
// working directory, sandbox state, model name and context percentage.
//
// The real banner is gradient ASCII art; the film's style rules ban blue
// gradients, so the banner is flat term.blue here, which still reads as the
// tool at a glance.
//
// Same content contract as TuiClaude (events / visibleCount / status), same
// top-clipping rule. Purely presentational; `frame`/`spinnerFrame` only pick
// discrete states.

import React from 'react';
import { font, term } from '../brand/tokens';
import { estimateTuiLines, type TuiEvent, type TuiStatus } from './TuiClaude';

const STEP = 24;

const DEFAULT_EVENTS: TuiEvent[] = [
  { kind: 'user', text: 'keep main green, rerun on every push' },
  { kind: 'note', text: '✓ vitest watching · 41 passed', color: term.green },
];

export const TuiGemini: React.FC<{
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
    visibleCount ?? (events === undefined && frame !== undefined ? Math.floor(frame / STEP) - 1 : all.length);
  const shown = all.slice(0, Math.max(0, count));
  const blink = caretOn ?? Math.floor(sf / 30) % 2 === 0;

  const lineH = fontSize * 1.5;
  // banner + tips + input box + footer
  const chromeH = fontSize * 2.4 * 1.15 + 8 + lineH * 3 + lineH + 12 + 2 + fontSize * 0.85 * 1.5 + 8;
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
                <span style={{ color: term.blue }}>&gt; </span>
                {e.text}
              </div>
            );
          case 'assistant':
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
                <span style={{ color: term.blue }}>✦ </span>
                {e.text}
              </div>
            );
          case 'tool':
            return (
              <div key={i} style={{ marginTop: 4 }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: term.blue, fontWeight: 700 }}>{e.name} </span>
                  <span style={{ color: term.brightBlack }}>{e.args}</span>
                </div>
                {e.result && <div style={{ color: term.green }}>{'  ' + e.result}</div>}
              </div>
            );
          case 'note':
            return (
              <div
                key={i}
                style={{ color: e.color ?? term.brightBlack, whiteSpace: 'pre-wrap', marginTop: 4 }}
              >
                {e.text}
              </div>
            );
        }
      })}
      {status === 'working' && (
        <div style={{ color: term.blue, marginTop: 4 }}>
          ✦ thinking…
        </div>
      )}
      {status === 'waiting' && (
        <div style={{ color: term.red, marginTop: 4 }}>
          ? waiting for confirmation
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
            fontSize: fontSize * 2.4,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: term.blue,
            lineHeight: 1.15,
          }}
        >
          GEMINI
        </div>
        <div style={{ marginTop: 8, color: term.brightBlack }}>
          <div>Tips for getting started:</div>
          <div>1. Ask questions, edit files, or run commands.</div>
          <div>2. Be specific for the best results.</div>
        </div>
      </div>

      <div style={{ position: 'relative', minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {anchorBottom ? (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{body}</div>
        ) : (
          body
        )}
      </div>

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
        <span style={{ color: term.blue }}>&gt; </span>
        {promptText ? (
          <>
            {promptText}
            <span
              style={{
                display: 'inline-block',
                width: '0.6em',
                height: '1.05em',
                verticalAlign: '-0.15em',
                background: term.foreground,
                opacity: blink ? 1 : 0.15,
              }}
            />
          </>
        ) : (
          <span style={{ color: term.brightBlack }}>Type your message or @path/to/file</span>
        )}
      </div>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          color: term.brightBlack,
          fontSize: fontSize * 0.85,
          paddingTop: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span>~/projects/checkout</span>
        <span>no sandbox (see /docs)</span>
        <span style={{ color: term.blue }}>gemini-2.5-pro (96% context left)</span>
      </div>
    </div>
  );
};
