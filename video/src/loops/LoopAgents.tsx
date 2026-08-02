// README loop 3: agents talking to each other. The project board on the left,
// athena's session on the right, and an @athena pill that flies from the board
// into the terminal header. The pill fades in at departure and out at arrival,
// so frame 119 (empty air) chains onto frame 0 (empty air) with no jump; the
// arrival is marked by a thin magenta outline pulse on the node.
//
// GIF discipline: static camera, static nodes, no shadows, flat colors. The
// only pixels that change are the pill and the outline pulse.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, font, term } from '../brand/tokens';
import { CanvasBackground } from '../ui/CanvasBackground';
import { ChatNode, type ChatMessage } from '../ui/ChatNode';
import { TerminalNode } from '../ui/TerminalNode';
import { TuiCodex } from '../ui/TuiCodex';
import { type TuiEvent } from '../ui/TuiClaude';

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const seg = (f: number, a: number, b: number) => clamp01((f - a) / (b - a));
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

const BOARD: ChatMessage[] = [
  {
    author: 'hermes',
    harness: 'claude',
    time: '18:34',
    to: 'athena',
    text: '@athena billing.ts is yours. Pushed, tests green.',
  },
  { author: 'athena', harness: 'codex', time: '18:35', text: 'taking it. refund path next.' },
];

const ATHENA: TuiEvent[] = [
  { kind: 'user', text: 'refund path, mirror the webhook tests' },
  { kind: 'note', text: '@hermes: billing.ts is yours. Pushed, tests green.', color: term.magenta },
];

// the pill's trip: board edge to terminal header
const FROM = { x: 396, y: 250 };
const TO = { x: 600, y: 146 };

export const LoopAgents: React.FC = () => {
  const frame = useCurrentFrame();

  const t = ease(seg(frame, 18, 78));
  const x = FROM.x + (TO.x - FROM.x) * t;
  const y = FROM.y + (TO.y - FROM.y) * t - 36 * Math.sin(Math.PI * t);
  const pillOpacity = Math.min(seg(frame, 18, 28), 1 - seg(frame, 74, 84));
  const pulse = frame >= 84 ? 1 - ease(seg(frame, 84, 112)) : 0;

  return (
    <AbsoluteFill style={{ background: c.background }}>
      <CanvasBackground opacity={0.7} />

      <div style={{ position: 'absolute', left: 50, top: 130 }}>
        <ChatNode width={380} height={300} messages={BOARD} visibleCount={2} noShadow />
      </div>

      <div style={{ position: 'absolute', left: 500, top: 130 }}>
        {/* the outline pulse rides an overlay so the node itself never changes */}
        <TerminalNode
            name="athena"
            harness="codex"
            state="working"
            stateLabel="working"
            path="~/projects/checkout"
            width={450}
            height={300}
            noShadow
          >
            <TuiCodex width={450} height={264} fontSize={11.5} events={ATHENA} status="working" caretOn />
        </TerminalNode>
        {pulse > 0.02 && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 14,
              outline: `2px solid ${term.magenta}`,
              outlineOffset: 3,
              opacity: pulse,
            }}
          />
        )}
      </div>

      {pillOpacity > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: x,
            top: y,
            fontFamily: font.mono,
            fontSize: 15,
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: 999,
            background: term.magenta,
            color: '#1c1917',
            opacity: pillOpacity,
          }}
        >
          @athena
        </div>
      )}
    </AbsoluteFill>
  );
};
