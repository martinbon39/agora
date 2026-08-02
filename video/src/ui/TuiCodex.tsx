// OpenAI Codex CLI. The recognizable furniture, from its documented terminal
// UI: the `>_ OpenAI Codex` header card, the model and directory line, dim
// italic thinking summaries, `exec` command lines with their result, the
// magenta `codex` answer label, and the key-hint footer with the context
// percentage on the right.
//
// Purely presentational. `frame` only picks discrete states (one reveal step
// per beat, 24 frames).

import React from 'react';
import { font, term } from '../brand/tokens';

const STEP = 24;

export const TuiCodex: React.FC<{
  width: number;
  height: number;
  frame?: number;
  fontSize?: number;
}> = ({ width, height, frame = 0, fontSize = 13.5 }) => {
  const step = Math.floor(frame / STEP);

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

        {step >= 1 && (
          <div style={{ marginTop: 8 }}>
            <span style={{ color: term.brightBlack }}>› </span>
            mirror the webhook tests for the refund path
          </div>
        )}
        {step >= 2 && (
          <div style={{ color: term.brightBlack, fontStyle: 'italic', marginTop: 4 }}>
            • thinking: reuse the webhook fixtures, keep billing.ts untouched
          </div>
        )}
        {step >= 3 && (
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
            <span style={{ color: term.magenta, fontWeight: 700 }}>exec </span>
            <span style={{ color: term.brightBlack }}>
              npx vitest run tests/webhooks.spec.ts
            </span>
          </div>
        )}
        {step >= 4 && (
          <div style={{ color: term.green }}>{'  ✓ 41 passed in 1.8s'}</div>
        )}
        {step >= 5 && (
          <>
            <div style={{ color: term.brightMagenta, fontWeight: 700, marginTop: 8 }}>
              codex
            </div>
            <div>Refund tests mirrored. The write to billing.ts needs your approval.</div>
          </>
        )}
      </div>

      <div style={{ flexShrink: 0, whiteSpace: 'pre', paddingTop: 4 }}>
        <span
          style={{
            display: 'inline-block',
            width: '0.55em',
            height: '1.1em',
            verticalAlign: '-0.18em',
            background: term.foreground,
            opacity: Math.floor(frame / 30) % 2 === 0 ? 1 : 0.2,
          }}
        />
        <span style={{ color: term.brightBlack }}> Ask Codex to do anything</span>
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
