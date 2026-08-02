// README loop 1: the canvas. A cursor grabs a sticky note, moves it, puts it
// back, returns to rest. Frame 119 chains onto frame 0 with nothing moving.
//
// GIF discipline: static camera, static dot grid, flat surfaces, no shadows,
// no springs. The only pixels that change are the sticky and the cursor.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, font, term } from '../brand/tokens';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Cursor } from '../ui/Cursor';
import { StickyNode } from '../ui/StickyNode';
import { TerminalNode } from '../ui/TerminalNode';
import { TuiClaude, type TuiEvent } from '../ui/TuiClaude';
import { TuiCodex } from '../ui/TuiCodex';

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const seg = (f: number, a: number, b: number) => clamp01((f - a) / (b - a));
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const HERMES: TuiEvent[] = [
  { kind: 'tool', name: 'Bash', args: 'npx vitest run', result: '41 passed' },
];
const ATHENA: TuiEvent[] = [{ kind: 'user', text: 'mirror the webhook tests' }];

// cursor rest, sticky origin, and the round trip
const REST = { x: 880, y: 480 };
const STICKY = { x: 430, y: 340 };
const GRAB = { x: STICKY.x + 60, y: STICKY.y + 12 };
const DRAG = { x: 230, y: -30 };

export const LoopCanvas: React.FC = () => {
  const frame = useCurrentFrame();

  // approach 3..24, grab, drag out 27..57, hold, drag back 69..99, return 100..117
  const approach = ease(seg(frame, 3, 24));
  const out = ease(seg(frame, 27, 57));
  const back = ease(seg(frame, 69, 99));
  const leave = ease(seg(frame, 100, 117));
  const offset = { x: DRAG.x * (out - back), y: DRAG.y * (out - back) };
  const grabbed = frame >= 24 && frame < 100;

  const cursor =
    frame < 27
      ? { x: lerp(REST.x, GRAB.x, approach), y: lerp(REST.y, GRAB.y, approach) }
      : frame < 100
        ? { x: GRAB.x + offset.x, y: GRAB.y + offset.y }
        : { x: lerp(GRAB.x, REST.x, leave), y: lerp(GRAB.y, REST.y, leave) };

  return (
    <AbsoluteFill style={{ background: c.background }}>
      <CanvasBackground opacity={0.7} />

      <div style={{ position: 'absolute', left: 60, top: 70 }}>
        <TerminalNode
          name="hermes"
          harness="claude"
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={370}
          height={230}
          noShadow
        >
          <TuiClaude width={370} height={194} fontSize={10} events={HERMES} spinnerFrame={2040} caretOn />
        </TerminalNode>
      </div>

      <div style={{ position: 'absolute', left: 560, top: 90 }}>
        <TerminalNode
          name="athena"
          harness="codex"
          state="idle"
          stateLabel="idle"
          path="~/projects/checkout"
          width={360}
          height={220}
          noShadow
        >
          <TuiCodex width={360} height={184} fontSize={10} events={ATHENA} status="idle" caretOn />
        </TerminalNode>
      </div>

      <div style={{ position: 'absolute', left: 70, top: 360 }}>
        <TerminalNode
          name="iris"
          harness="gemini"
          state="idle"
          stateLabel="idle"
          path="~/projects/checkout"
          width={300}
          height={160}
          noShadow
        >
          <div
            style={{
              width: 300,
              height: 124,
              background: term.background,
              color: term.brightBlack,
              fontFamily: font.mono,
              fontSize: 11,
              padding: 10,
              boxSizing: 'border-box',
            }}
          >
            <span style={{ color: term.green }}>✓</span> vitest watching · 41 passed
          </div>
        </TerminalNode>
      </div>

      {/* the dragged note */}
      <div
        style={{
          position: 'absolute',
          left: STICKY.x + offset.x,
          top: STICKY.y + offset.y,
          outline: grabbed ? `2px solid ${c.primary}b3` : undefined,
          outlineOffset: 2,
          borderRadius: 8,
        }}
      >
        <StickyNode
          width={180}
          height={150}
          color="amber"
          text="demo at 18:00, freeze main at 17:30"
          author="martin"
          noShadow
        />
      </div>

      <Cursor x={cursor.x} y={cursor.y} name="martin" color="#7dd3fc" />
    </AbsoluteFill>
  );
};
