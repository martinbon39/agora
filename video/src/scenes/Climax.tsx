// 0:54.4–1:04 — the climax: the whole room at once, then the cuts tighten.
//
// The grid is held long enough to be understood, then broken into 12- and
// 6-frame fragments so the section accelerates into the second hole. Same
// device as the opening, one octave up.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rand, rise, sp } from '../lib/motion';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Session } from '../lib/Session';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { StickyNode } from '../ui/StickyNode';
import { Cursor } from '../ui/Cursor';
import { BOARD, EVENT_SESSIONS, PEERS } from '../content';

const FRAGMENTS = BAR * 3; // 288 — where the grid breaks up
const HOLE = 456; // TAIL is exactly 168 frames, so 288 + 168 lands here

const NAMES = Object.keys(AGENTS) as (keyof typeof AGENTS)[];
const STATES = ['working', 'idle', 'needs_approval', 'working', 'idle', 'working'] as const;

type Cell = { x: number; y: number; w: number; h: number; kind: 'term' | 'chat' | 'note'; i: number };

const GRID: Cell[] = [
  { x: 60, y: 120, w: 560, h: 320, kind: 'term', i: 0 },
  { x: 660, y: 90, w: 600, h: 340, kind: 'term', i: 1 },
  { x: 1300, y: 130, w: 560, h: 300, kind: 'term', i: 2 },
  { x: 40, y: 480, w: 520, h: 300, kind: 'term', i: 3 },
  { x: 600, y: 470, w: 440, h: 330, kind: 'chat', i: 4 },
  { x: 1080, y: 470, w: 520, h: 290, kind: 'term', i: 5 },
  { x: 1640, y: 470, w: 230, h: 200, kind: 'note', i: 6 },
  { x: 100, y: 820, w: 520, h: 250, kind: 'term', i: 7 },
  { x: 660, y: 840, w: 560, h: 240, kind: 'term', i: 8 },
  { x: 1270, y: 800, w: 580, h: 260, kind: 'term', i: 9 },
];

/** grid cell -> index into PEERS. One human per terminal, no doubling up. */
const WATCHERS: Record<number, number> = { 0: 0, 3: 1, 9: 2 };

const WORDS = [
  { at: 0, text: 'PARALLEL' },
  { at: BAR, text: 'SHARED' },
  { at: BAR * 2, text: 'YOURS' },
];

const Cellular: React.FC<{ cell: Cell; frame: number }> = ({ cell, frame }) => {
  const pop = rise(frame, Math.floor(cell.i / 2) * 6, 20);
  const style: React.CSSProperties = {
    position: 'absolute',
    left: cell.x,
    top: cell.y,
    transform: `scale(${interpolate(pop, [0, 1], [0.9, 1])})`,
    opacity: interpolate(pop, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' }),
  };
  if (cell.kind === 'chat') {
    return (
      <div style={style}>
        <ChatNode width={cell.w} height={cell.h} messages={BOARD} visibleCount={BOARD.length} />
      </div>
    );
  }
  if (cell.kind === 'note') {
    return (
      <div style={style}>
        <StickyNode width={cell.w} height={cell.h} color="lime" text="all green. ship it." author="sam" />
      </div>
    );
  }
  const name = NAMES[cell.i % NAMES.length];
  // One watcher per watched terminal. `cell.i % PEERS.length` looked fine but
  // the watched cells are 0, 3 and 9 — all ≡ 0 mod 3 — so martin ended up
  // watching three terminals at once while three distinct cursors were on
  // screen. Map them explicitly instead.
  const watcher = WATCHERS[cell.i];
  const watched = watcher !== undefined;
  const peer = PEERS[watcher ?? 0];
  return (
    <div style={style}>
      <TerminalNode
        name={name}
        harness={AGENTS[name].harness}
        state={STATES[cell.i % STATES.length]}
        stateLabel={STATES[cell.i % STATES.length].replace('_', ' ')}
        width={cell.w}
        height={cell.h}
        glowColor={peer.color}
        glowStrength={watched ? 0.85 : 0}
        viewers={watched ? [{ name: peer.name, color: peer.color }] : []}
      >
        <Session harness={AGENTS[name].harness} width={cell.w} height={cell.h - 36} events={EVENT_SESSIONS[cell.i % EVENT_SESSIONS.length]} status={STATES[cell.i % STATES.length] === 'idle' ? 'idle' : STATES[cell.i % STATES.length] === 'needs_approval' ? 'waiting' : 'working'} fontSize={10.5} />
      </TerminalNode>
    </div>
  );
};

// The blur has to live on this AbsoluteFill and not on a <div> wrapped around
// it. A `filter` makes an element the containing block for its absolutely
// positioned descendants; wrapping this in a plain div gave the grid a
// zero-height containing block, which moved its transform-origin from the
// centre of the frame to the top and made the whole layout slide down the
// moment a word faded in.
const Wide: React.FC<{ frame: number; push?: number; blur?: number }> = ({
  frame,
  push = 0,
  blur = 0,
}) => (
  <AbsoluteFill style={blur > 0.3 ? { filter: `blur(${blur}px)` } : undefined}>
    <CanvasBackground opacity={0.8} offsetX={frame * 0.5} />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `scale(${1 + push})`,
        transformOrigin: '50% 50%',
      }}
    >
      {GRID.map((cell) => (
        <Cellular key={cell.i} cell={cell} frame={frame} />
      ))}
    </div>
    {PEERS.map((p, i) => (
      <Cursor
        key={p.name}
        x={340 + i * 520 + Math.sin((frame + i * 40) / 30) * 120}
        y={420 + Math.cos((frame + i * 55) / 38) * 190}
        name={p.name}
        color={p.color}
      />
    ))}
  </AbsoluteFill>
);

// The tail: fragments cut out of the same material, but no longer a sprint.
// This was 12s and 6s and the ending read as the film running away from you;
// the score stopped accelerating here too. Still 168 frames in total.
const TAIL: number[] = [
  ...Array(4).fill(24),
  ...Array(6).fill(12),
];
const TAIL_CUTS = TAIL.reduce<{ at: number; dur: number }[]>((acc, dur) => {
  const at = acc.length ? acc[acc.length - 1].at + acc[acc.length - 1].dur : FRAGMENTS;
  acc.push({ at, dur });
  return acc;
}, []);

export const Climax: React.FC = () => {
  const frame = useCurrentFrame();

  if (frame >= HOLE) {
    const t = frame - HOLE;
    return (
      <Stage background="#000000">
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: interpolate(t, [0, BEAT], [1200, 30]),
              height: 2,
              background: c.foreground,
              opacity: interpolate(t, [0, BEAT - 3, BEAT], [0.85, 0.4, 0]),
              boxShadow: `0 0 50px ${c.foreground}`,
            }}
          />
        </AbsoluteFill>
      </Stage>
    );
  }

  if (frame < FRAGMENTS) {
    const word = [...WORDS].reverse().find((w) => frame >= w.at);
    const wordSp = word ? sp(frame, word.at, 'punch') : 0;
    const age = word ? frame - word.at : 0;
    // hold most of the bar, then clear so the grid is legible again before the
    // next word lands
    const ramp = (a: number, b: number, cc: number, d: number) =>
      interpolate(age, [0, 6, 50, 70], [a, b, cc, d], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    const wordOpacity = interpolate(age, [0, 5, 56, 72], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const defocus = ramp(0, 7, 7, 0);
    const scrim = ramp(0.25, 1, 1, 0.25);
    return (
      <Stage>
        {/* the room defocuses behind the word, otherwise 190px type sits on
            top of running terminal text and neither of them is readable */}
        <Wide
          frame={frame}
          push={interpolate(frame, [0, FRAGMENTS], [0, 0.07])}
          blur={defocus}
        />
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background:
              'radial-gradient(62% 46% at 50% 50%, rgba(0,0,0,0.92), rgba(0,0,0,0.22) 78%)',
            opacity: scrim,
          }}
        />
        {word && (
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                fontFamily: font.sans,
                fontSize: 190,
                fontWeight: 700,
                letterSpacing: -7,
                color: c.foreground,
                transform: `scale(${interpolate(wordSp, [0, 1], [1.3, 1])})`,
                opacity: wordOpacity,
                textShadow: '0 30px 90px rgba(0,0,0,0.9)',
              }}
            >
              {word.text}
            </div>
          </AbsoluteFill>
        )}
      </Stage>
    );
  }

  // fragments
  const idx = TAIL_CUTS.findIndex((cut) => frame >= cut.at && frame < cut.at + cut.dur);
  const cut = TAIL_CUTS[Math.max(0, idx)];
  const seed = Math.max(0, idx);
  const t = frame - cut.at;
  const cell = GRID[(seed * 7) % GRID.length];

  // Details only. The first three bars were the wide grid; cutting back to it
  // here made the climax read as the same shot scrolling past twice.
  const zoom = 2.1 + rand(seed) * 1.1;
  return (
    <Stage>
      <CanvasBackground opacity={0.5} />
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: 960 - (cell.x + cell.w / 2) * zoom,
            top: 540 - (cell.y + cell.h / 2) * zoom,
            transform: `scale(${zoom * (1 + t * 0.004)})`,
            transformOrigin: '0 0',
          }}
        >
          <div style={{ position: 'relative', left: cell.x, top: cell.y }}>
            <Cellular cell={{ ...cell, x: 0, y: 0 }} frame={frame} />
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
