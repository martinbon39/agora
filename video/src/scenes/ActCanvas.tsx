// 0:28.8–0:36.8 — act two: the canvas.
//
// One long camera move. We start inside a single terminal and pull back until
// it turns out to be one node on a workspace, with the others arriving on the
// beat. The point is spatial: these are not tabs, they are laid out.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { sp, springTo } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Terminal } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';
import { StickyNode } from '../ui/StickyNode';
import { ChatNode } from '../ui/ChatNode';
import {
  ATHENA_SESSION,
  BOARD,
  HERMES_SESSION,
  HYPNOS_SESSION,
  IRIS_SESSION,
} from '../content';

type Placed = {
  key: string;
  x: number;
  y: number;
  at: number;
  render: () => React.ReactNode;
};

const NODES: Placed[] = [
  {
    key: 'hermes',
    x: 0,
    y: 0,
    at: 0,
    render: () => (
      <TerminalNode
        name="hermes"
        harness={AGENTS.hermes.harness}
        state="working"
        stateLabel="working"
        path="~/projects/checkout"
        width={720}
        height={430}
      >
        <Terminal lines={HERMES_SESSION} showCursor fontSize={13.5} />
      </TerminalNode>
    ),
  },
  {
    key: 'athena',
    x: 790,
    y: 120,
    at: BEAT * 2,
    render: () => (
      <TerminalNode
        name="athena"
        harness={AGENTS.athena.harness}
        state="needs_approval"
        stateLabel="needs approval"
        path="~/projects/checkout"
        width={660}
        height={380}
      >
        <Terminal lines={ATHENA_SESSION} showCursor fontSize={13.5} />
      </TerminalNode>
    ),
  },
  {
    key: 'note',
    x: 830,
    y: -230,
    at: BEAT * 3,
    render: () => (
      <StickyNode
        width={250}
        height={210}
        color="rose"
        text="do not run migration 0042 until hypnos signs off"
        author="martin"
      />
    ),
  },
  {
    key: 'hypnos',
    x: -120,
    y: 500,
    at: BEAT * 4,
    render: () => (
      <TerminalNode
        name="hypnos"
        harness={AGENTS.hypnos.harness}
        state="working"
        stateLabel="working"
        path="~/projects/checkout"
        width={640}
        height={360}
      >
        <Terminal lines={HYPNOS_SESSION} showCursor fontSize={13.5} />
      </TerminalNode>
    ),
  },
  {
    key: 'board',
    x: 600,
    y: 560,
    at: BEAT * 5,
    render: () => <ChatNode width={420} height={400} messages={BOARD} visibleCount={4} />,
  },
  {
    key: 'iris',
    x: 1120,
    y: 590,
    at: BEAT * 6,
    render: () => (
      <TerminalNode
        name="iris"
        harness={AGENTS.iris.harness}
        state="idle"
        stateLabel="idle"
        path="~/projects/checkout"
        width={520}
        height={300}
      >
        <Terminal lines={IRIS_SESSION} fontSize={13} />
      </TerminalNode>
    ),
  },
  {
    key: 'note2',
    x: -560,
    y: 180,
    at: BEAT * 7,
    render: () => (
      <StickyNode
        width={230}
        height={200}
        color="amber"
        text="demo at 18:00 — freeze main at 17:30"
        author="lea"
      />
    ),
  },
];

// where the camera starts (inside hermes) and where it ends up
const START = { x: 300, y: 180, s: 2.35 };
const END = { x: 430, y: 250, s: 0.66 };

export const ActCanvas: React.FC = () => {
  const frame = useCurrentFrame();

  const s = springTo(frame, 0, START.s, END.s, 'glide');
  const cx = springTo(frame, 0, START.x, END.x, 'glide') + frame * 0.12;
  const cy = springTo(frame, 0, START.y, END.y, 'glide');

  return (
    <Stage>
      <CanvasBackground opacity={0.9} offsetX={-cx * s * 0.5} offsetY={-cy * s * 0.5} />

      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 960,
            top: 540,
            transform: `scale(${s}) translate(${-cx}px, ${-cy}px)`,
            transformOrigin: '0 0',
          }}
        >
          {NODES.map((n) => {
            const pop = sp(frame, n.at, n.at === 0 ? 'glide' : 'punch');
            if (frame < n.at) return null;
            return (
              <div
                key={n.key}
                style={{
                  position: 'absolute',
                  left: n.x,
                  top: n.y,
                  transform: `scale(${interpolate(pop, [0, 1], [0.82, 1])})`,
                  opacity: interpolate(pop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
                }}
              >
                {n.render()}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* the frame darkens at the edges as we pull out, so the eye stays inside */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(22,22,22,0.92) 0%, rgba(22,22,22,0) 22%, rgba(22,22,22,0) 74%, rgba(22,22,22,0.94) 100%)',
        }}
      />

      <SectionLabel index="02 — the canvas" title="An infinite canvas per project" from={BEAT} />

      <Caption from={BAR * 3} y={906}>
        Terminals, notes, checklists and live previews on one spatial workspace —{' '}
        <span style={{ color: c.foreground }}>and it persists</span>.
      </Caption>
    </Stage>
  );
};
