// README loop 4: it runs without you. A session keeps printing work at a
// steady pace next to a "your server" card with a pulsing green dot.
//
// The seamless-loop trick: the log is a strict two-line pattern (test pass,
// then next file), the terminal is bottom-anchored (TuiClaude clips from the
// top once full), and exactly four lines appear per 120 frames. Four lines is
// two full periods of the pattern, so the visible window at frame 0 and at
// frame 119 is pixel-identical: the scroll is a treadmill.
//
// GIF discipline: static camera, no shadows, no gradients. The changing
// pixels are one new log line at a time, the caret, and the pulsing dot.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, font, term } from '../brand/tokens';
import { CanvasBackground } from '../ui/CanvasBackground';
import { TerminalNode } from '../ui/TerminalNode';
import { TuiClaude, type TuiEvent } from '../ui/TuiClaude';

const TAU = Math.PI * 2;

// a strict period-2 pattern: adding two lines leaves the picture identical
const LOG: TuiEvent[] = Array.from({ length: 24 }, (_, i) =>
  i % 2 === 0
    ? { kind: 'note', text: '✓ 58 passed · payments suite · 1.8s', color: term.green }
    : { kind: 'note', text: 'reading src/payments/refund.ts' },
);

export const LoopPersist: React.FC = () => {
  const frame = useCurrentFrame();

  // reveals at frames 15, 45, 75, 105: four lines per loop, two full periods,
  // and the seam (count 16 at f119, count 12 at f0) lands on the same parity
  const visible = 12 + Math.floor((frame + 15) / 30);
  const caretOn = frame % 60 < 30;
  const dot = 0.55 + 0.45 * Math.sin(TAU * (2 * frame) / 120);

  return (
    <AbsoluteFill style={{ background: c.background }}>
      <CanvasBackground opacity={0.7} />

      <div style={{ position: 'absolute', left: 60, top: 100 }}>
        <TerminalNode
          name="hermes"
          harness="claude"
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={560}
          height={350}
          noShadow
        >
          <TuiClaude
            width={560}
            height={314}
            fontSize={12}
            events={LOG}
            visibleCount={visible}
            spinnerFrame={22320}
            caretOn={caretOn}
          />
        </TerminalNode>
      </div>

      {/* your server, still on */}
      <div
        style={{
          position: 'absolute',
          left: 690,
          top: 190,
          width: 240,
          boxSizing: 'border-box',
          border: `1px solid ${c.border}`,
          borderRadius: 14,
          background: c.card,
          padding: '18px 20px',
          fontFamily: font.sans,
          color: c.foreground,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ position: 'relative', width: 12, height: 12, flexShrink: 0 }}>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: c.idle,
                opacity: dot,
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: -4,
                borderRadius: '50%',
                border: `1.5px solid ${c.idle}`,
                opacity: (1 - dot) * 0.7,
              }}
            />
          </span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>your server</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: c.muted, lineHeight: 1.6 }}>
          <div>tmux · 3 detached sessions</div>
          <div>laptop closed since 11:04</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
