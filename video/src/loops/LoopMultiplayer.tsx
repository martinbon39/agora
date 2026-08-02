// README loop 2: multiplayer. Two live sessions, three named cursors drifting
// on closed sine paths, presence badges in the headers, and one human visibly
// inside a session: "martin joined this session" plus a typed line waiting in
// the prompt box. Frame 119 chains onto frame 0 with nothing moving.
//
// GIF discipline: static camera, static terminals, no shadows, no glow. The
// only pixels that change are the three cursors and the caret blink.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c } from '../brand/tokens';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Cursor } from '../ui/Cursor';
import { TerminalNode } from '../ui/TerminalNode';
import { TuiClaude, type TuiEvent } from '../ui/TuiClaude';
import { TuiCodex } from '../ui/TuiCodex';

const TAU = Math.PI * 2;

const PEERS = [
  { name: 'martin', color: '#7dd3fc' },
  { name: 'lea', color: '#fca5a5' },
  { name: 'sam', color: '#86efac' },
] as const;

const HERMES: TuiEvent[] = [
  { kind: 'assistant', text: 'Webhooks green. Waiting on the refund path.' },
  { kind: 'note', text: '· martin joined this session', color: '#7dd3fc' },
];

const ATHENA: TuiEvent[] = [
  { kind: 'user', text: 'mirror the webhook tests' },
  { kind: 'tool', name: 'exec', args: 'npx vitest run tests/webhooks.spec.ts', result: '✓ 41 passed' },
];

// closed paths: integer numbers of sine cycles over the 120 frames
const orbit = (
  t: number,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  fx: number,
  fy: number,
  phase: number,
) => ({
  x: cx + ax * Math.sin(TAU * fx * t + phase),
  y: cy + ay * Math.sin(TAU * fy * t + phase * 1.7),
});

export const LoopMultiplayer: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 120;
  const caretOn = frame % 60 < 30;

  const martin = orbit(t, 250, 330, 42, 26, 1, 2, 0.6);
  const lea = orbit(t, 760, 210, 36, 20, 1, 2, 2.4);
  const sam = orbit(t, 490, 480, 150, 28, 1, 1, 4.2);

  return (
    <AbsoluteFill style={{ background: c.background }}>
      <CanvasBackground opacity={0.7} />

      <div style={{ position: 'absolute', left: 40, top: 110 }}>
        <TerminalNode
          name="hermes"
          harness="claude"
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={440}
          height={300}
          viewers={[{ name: PEERS[0].name, color: PEERS[0].color }]}
          noShadow
        >
          <TuiClaude
            width={440}
            height={264}
            fontSize={11.5}
            events={HERMES}
            spinnerFrame={2040}
            promptText="looks good, ship it"
            caretOn={caretOn}
          />
        </TerminalNode>
      </div>

      <div style={{ position: 'absolute', left: 520, top: 110 }}>
        <TerminalNode
          name="athena"
          harness="codex"
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={440}
          height={300}
          viewers={[{ name: PEERS[1].name, color: PEERS[1].color }]}
          noShadow
        >
          <TuiCodex width={440} height={264} fontSize={11.5} events={ATHENA} status="working" caretOn={caretOn} />
        </TerminalNode>
      </div>

      <Cursor x={martin.x} y={martin.y} name={PEERS[0].name} color={PEERS[0].color} />
      <Cursor x={lea.x} y={lea.y} name={PEERS[1].name} color={PEERS[1].color} />
      <Cursor x={sam.x} y={sam.y} name={PEERS[2].name} color={PEERS[2].color} />
    </AbsoluteFill>
  );
};
