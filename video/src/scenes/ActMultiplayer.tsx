// Act five: invite anyone.
//
// The previous act was agents coordinating with each other. This one is about
// people, and it is a separate act on purpose — the two were stacked into one
// and the ideas blurred together, so neither promise landed.
//
// It escalates in three steps, each a stronger claim than the last:
//   1. humans arrive, and you can see where each of them is looking
//   2. they act on the canvas itself rather than watching it
//   3. they type into an agent's session that is not theirs

import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, term, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rise, sp } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Terminal, type TermLine } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { StickyNode } from '../ui/StickyNode';
import { Cursor } from '../ui/Cursor';
import { BOARD, HERMES_SESSION, HYPNOS_SESSION, PEERS } from '../content';
import { ATHENA_AFTER } from './ActAgentTalk';

const HUMANS = BAR; // 96, the first person arrives
const CANVAS_ACT = BAR * 3; // 288, somebody puts something on the canvas
const TAKEOVER = BAR * 5; // 480, and then takes a keyboard that is not theirs
const SECOND = BAR * 7; // 672, and a second person does the same, elsewhere

/** athena's session once martin steps into it */
const ATHENA_TAKEN: TermLine[] = [
  ...ATHENA_AFTER,
  { spans: [{ text: '' }] },
  {
    spans: [
      { text: '← ', color: term.brightBlack },
      { text: 'martin', color: term.cyan, bold: true },
      { text: ' joined this session', color: term.brightBlack },
    ],
  },
  {
    spans: [
      { text: '› ', color: term.brightBlack },
      { text: 'hold on, add a test for the double refund case first' },
    ],
  },
];

/** hypnos's session once lea steps into it */
const HYPNOS_TAKEN: TermLine[] = [
  ...HYPNOS_SESSION,
  { spans: [{ text: '' }] },
  {
    spans: [
      { text: '← ', color: term.brightBlack },
      { text: 'lea', color: term.green, bold: true },
      { text: ' joined this session', color: term.brightBlack },
    ],
  },
  { spans: [{ text: '› ', color: term.brightBlack }, { text: 'write the backup step first' }] },
];

type Leg = { at: number; x: number; y: number };
const ARRIVALS: {
  peer: (typeof PEERS)[number];
  at: number;
  from: { x: number; y: number };
  legs: Leg[];
}[] = [
  {
    peer: PEERS[0], // martin: hermes, then into athena's session
    at: HUMANS,
    from: { x: -80, y: 980 },
    legs: [
      { at: HUMANS, x: 452, y: 424 },
      { at: TAKEOVER, x: 1372, y: 382 },
    ],
  },
  {
    peer: PEERS[1], // lea: athena, then into hypnos's session
    at: HUMANS + BEAT,
    from: { x: 2040, y: 900 },
    legs: [
      { at: HUMANS + BEAT, x: 1462, y: 428 },
      { at: SECOND, x: 356, y: 728 },
    ],
  },
  {
    peer: PEERS[2], // sam: the board, then drops a note onto the canvas
    at: HUMANS + BEAT * 2,
    from: { x: 900, y: 1160 },
    legs: [
      { at: HUMANS + BEAT * 2, x: 962, y: 812 },
      { at: CANVAS_ACT, x: 1452, y: 648 },
    ],
  },
];

export const ActMultiplayer: React.FC = () => {
  const frame = useCurrentFrame();

  const watchHermes = rise(frame, HUMANS + 12, 20);
  const watchAthena = rise(frame, HUMANS + BEAT + 12, 20);

  const takenOver = frame >= TAKEOVER + 16;
  const secondHuman = frame >= SECOND + 16;
  const takeoverPunch = takenOver ? Math.max(0, 1 - (frame - TAKEOVER - 16) / 16) : 0;

  // sam pulls a note onto the canvas: it flies in under the cursor and settles
  const noteIn = sp(frame, CANVAS_ACT, 'glide');
  const noteX = interpolate(noteIn, [0, 1], [1560, 1330]);
  const noteY = interpolate(noteIn, [0, 1], [900, 632]);

  const viewer = (i: number) => ({ name: PEERS[i].name, color: PEERS[i].color });

  return (
    <Stage>
      <CanvasBackground opacity={0.75} offsetX={frame * 0.3} offsetY={-frame * 0.1} />

      <SectionLabel kicker="multiplayer" title="Invite anyone into the room" y={78} />

      {/* hermes */}
      <div style={{ position: 'absolute', left: 110, top: 244 }}>
        <TerminalNode
          name="hermes"
          harness={AGENTS.hermes.harness}
          state="idle"
          stateLabel="idle"
          path="~/projects/checkout"
          width={700}
          height={336}
          glowColor={PEERS[0].color}
          glowStrength={takenOver ? 0 : watchHermes}
          viewers={watchHermes > 0.4 && !takenOver ? [viewer(0)] : []}
        >
          <Terminal lines={HERMES_SESSION} showCursor fontSize={14.5} />
        </TerminalNode>
      </div>

      {/* athena, whose keyboard martin takes halfway through */}
      <div
        style={{
          position: 'absolute',
          left: 1110,
          top: 244,
          transform: `scale(${1 + takeoverPunch * 0.02})`,
        }}
      >
        <TerminalNode
          name="athena"
          harness={AGENTS.athena.harness}
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={700}
          height={336}
          glowColor={takenOver ? PEERS[0].color : PEERS[1].color}
          glowStrength={takenOver ? 1 : watchAthena}
          viewers={[
            ...(watchAthena > 0.4 && !takenOver ? [viewer(1)] : []),
            ...(takenOver ? [viewer(0)] : []),
          ]}
        >
          <Terminal lines={takenOver ? ATHENA_TAKEN : ATHENA_AFTER} showCursor fontSize={14.5} />
        </TerminalNode>
      </div>

      {/* hypnos, whose keyboard lea takes at the end */}
      <div style={{ position: 'absolute', left: 110, top: 608 }}>
        <TerminalNode
          name="hypnos"
          harness={AGENTS.hypnos.harness}
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={560}
          height={268}
          glowColor={PEERS[1].color}
          glowStrength={secondHuman ? 1 : 0}
          viewers={secondHuman ? [viewer(1)] : []}
        >
          <Terminal lines={secondHuman ? HYPNOS_TAKEN : HYPNOS_SESSION} showCursor fontSize={13} />
        </TerminalNode>
      </div>

      {/* the board, carried over from the act before */}
      <div style={{ position: 'absolute', left: 712, top: 596, zIndex: 5 }}>
        <ChatNode width={560} height={404} messages={BOARD} visibleCount={BOARD.length} />
      </div>

      {/* a human putting something ON the canvas, not just reading it */}
      {frame >= CANVAS_ACT && (
        <div
          style={{
            position: 'absolute',
            left: noteX,
            top: noteY,
            transform: `rotate(${interpolate(noteIn, [0, 1], [-7, -2])}deg)`,
            opacity: interpolate(noteIn, [0, 0.25], [0, 1], { extrapolateRight: 'clamp' }),
            zIndex: 6,
          }}
        >
          <StickyNode
            width={250}
            height={210}
            color="lime"
            text="judging at 19:00. freeze main at 18:30."
            author="sam"
          />
        </div>
      )}

      {ARRIVALS.map(({ peer, at, from, legs }) => {
        if (frame < at) return null;
        const t = frame - at;
        let x = from.x;
        let y = from.y;
        let prev = from;
        for (const leg of legs) {
          if (frame < leg.at) break;
          const move = sp(frame, leg.at, 'glide');
          x += (leg.x - prev.x) * move;
          y += (leg.y - prev.y) * move;
          prev = leg;
        }
        const drift = Math.max(0, t - 40);
        return (
          <Cursor
            key={peer.name}
            x={x + Math.sin(drift / 29) * 20}
            y={y + Math.cos(drift / 37) * 14}
            name={peer.name}
            color={peer.color}
            opacity={interpolate(t, [0, 8], [0, 1], { extrapolateRight: 'clamp' })}
          />
        );
      })}

      <Caption from={HUMANS + BEAT * 2} until={CANVAS_ACT} x={120} y={900} size={26} width={520}>
        Invite someone and scope them to one project. You see their cursor, and a badge on
        whatever terminal they are looking at.
      </Caption>
      <Caption from={CANVAS_ACT + 20} until={TAKEOVER} x={120} y={900} size={26} width={520}>
        They are <span style={{ color: c.foreground }}>on the canvas with you</span>: move a
        node, pin a note, answer on the board. Everyone sees it happen.
      </Caption>
      <Caption from={TAKEOVER + 22} until={SECOND} x={120} y={900} size={26} width={520}>
        And they can walk into an agent&apos;s terminal and{' '}
        <span style={{ color: c.foreground }}>take the keyboard</span>. Same pty, not a
        screenshare.
      </Caption>
      <Caption from={SECOND + 22} x={120} y={900} size={26} width={520}>
        <span style={{ color: c.foreground }}>Three people and three agents</span>, one
        workspace, at the same time. Nobody waiting for a turn.
      </Caption>
    </Stage>
  );
};
