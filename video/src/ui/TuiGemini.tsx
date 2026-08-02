// Google Gemini CLI. The recognizable furniture, from its documented terminal
// UI: the big GEMINI banner over the whole width, the "Tips for getting
// started" list, the framed `>` input, and the one-line footer with the
// working directory, sandbox state, model name and context percentage.
//
// The real banner is gradient ASCII art; the film's style rules ban blue
// gradients, so the banner is flat term.blue here, which still reads as the
// tool at a glance.
//
// Purely presentational. `frame` only picks discrete states (one reveal step
// per beat, 24 frames).

import React from 'react';
import { font, term } from '../brand/tokens';

const STEP = 24;

export const TuiGemini: React.FC<{
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
            fontSize: fontSize * 2.4,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: term.blue,
            lineHeight: 1.15,
          }}
        >
          GEMINI
        </div>

        {step >= 1 && (
          <div style={{ marginTop: 8, color: term.brightBlack }}>
            <div>Tips for getting started:</div>
            <div>1. Ask questions, edit files, or run commands.</div>
            <div>2. Be specific for the best results.</div>
          </div>
        )}

        {step >= 2 && (
          <div style={{ marginTop: 8 }}>
            <span style={{ color: term.blue }}>&gt; </span>
            keep main green, rerun on every push
          </div>
        )}
        {step >= 3 && (
          <div style={{ color: term.green }}>✓ vitest watching · 41 passed</div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          border: `1px solid ${term.brightBlack}`,
          borderRadius: 6,
          padding: '5px 10px',
          whiteSpace: 'pre',
        }}
      >
        <span style={{ color: term.blue }}>&gt; </span>
        <span style={{ color: term.brightBlack }}>Type your message or @path/to/file</span>
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
