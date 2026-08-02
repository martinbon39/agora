// Claude Code, as it actually renders in a terminal (reference: a live agora
// session captured with `argos read --terminal`). The recognizable furniture:
// round bullets on messages and tool calls, `⎿` result lines, the spinner verb
// with elapsed time and a token counter, the framed prompt with `❯`, and the
// status line underneath.
//
// Purely presentational. `frame` only picks discrete states: how many lines
// have appeared (one step per beat, 24 frames) and which spinner glyph shows.

import React from 'react';
import { c, font, term } from '../brand/tokens';

const SPINNER = ['·', '✢', '✳', '✻', '✽', '✻', '✳', '✢'] as const;
const STEP = 24;

type Row = { kind: 'msg' | 'tool' | 'result'; text: string; tool?: string };

const ROWS: Row[] = [
  { kind: 'msg', text: 'The reaper test is flaky because the timeout races the socket close. Fixing it.' },
  { kind: 'tool', tool: 'Bash', text: 'npx vitest run server/test/socket.test.ts' },
  { kind: 'result', text: '1 failed · 41 passed (reaper escalation timed out)' },
  { kind: 'tool', tool: 'Edit', text: 'server/src/socket/reaper.ts' },
  { kind: 'result', text: 'Updated reaper.ts with 2 additions and 1 removal' },
];

export const TuiClaude: React.FC<{
  width: number;
  height: number;
  frame?: number;
  fontSize?: number;
}> = ({ width, height, frame = 0, fontSize = 13.5 }) => {
  const step = Math.floor(frame / STEP);
  const spin = SPINNER[Math.floor(frame / 6) % SPINNER.length];
  const mins = Math.floor(frame / 3600);
  const secs = Math.floor(frame / 60) % 60;
  const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const tokens = (0.4 + frame * 0.012).toFixed(1);

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
      <div style={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {ROWS.slice(0, step + 1).map((row, i) => {
          if (row.kind === 'result') {
            return (
              <div key={i} style={{ color: term.brightBlack, whiteSpace: 'pre' }}>
                {'  ⎿  '}
                {row.text}
              </div>
            );
          }
          if (row.kind === 'tool') {
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
                <span style={{ color: term.green }}>● </span>
                <span style={{ fontWeight: 700 }}>{row.tool}</span>
                <span style={{ color: term.brightBlack }}>({row.text})</span>
              </div>
            );
          }
          return (
            <div key={i} style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
              <span style={{ color: term.foreground }}>● </span>
              {row.text}
            </div>
          );
        })}

        <div style={{ marginTop: 8 }}>
          <span style={{ color: c.claude }}>
            {spin} Forging…{' '}
          </span>
          <span style={{ color: term.brightBlack }}>
            ({elapsed} · ↓ {tokens}k tokens · esc to interrupt)
          </span>
        </div>
      </div>

      {/* the framed prompt, always pinned at the bottom */}
      <div
        style={{
          flexShrink: 0,
          border: `1px solid ${term.brightBlack}`,
          borderRadius: 6,
          padding: '5px 10px',
          whiteSpace: 'pre',
        }}
      >
        <span style={{ color: c.violet }}>❯ </span>
        <span
          style={{
            display: 'inline-block',
            width: '0.6em',
            height: '1.05em',
            verticalAlign: '-0.15em',
            background: term.cursor,
            opacity: Math.floor(frame / 30) % 2 === 0 ? 1 : 0.15,
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
