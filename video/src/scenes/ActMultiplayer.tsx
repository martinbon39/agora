// 0:36.8–0:54.4 — act three: multiplayer. The longest act, and the reason the
// film exists.
//
// It builds in four moves, one every two or three bars:
//   1. two agents working the same repo at once
//   2. the board — they announce what they are about to touch
//   3. an @mention actually being delivered into another session's terminal
//   4. humans arrive: live cursors, presence on the terminal being watched

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rise, sp, springTo } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Terminal, type TermLine } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { Cursor } from '../ui/Cursor';
import { ATHENA_SESSION, BOARD, HERMES_SESSION, HYPNOS_SESSION, PEERS } from '../content';

const BOARD_IN = BAR * 2; // 192
const DELIVER = BAR * 5; // 480, the mention lands
const HUMANS = BAR * 7; // 672
const WIDEN = BAR * 9; // 864
const TAKEOVER = BAR * 11; // 1056, a human walks into someone else's session
const SECOND_HUMAN = BAR * 13; // 1248, and a second one does the same, elsewhere

const countChars = (lines: TermLine[]) =>
  lines.reduce((n, l) => n + l.spans.reduce((m, s) => m + s.text.length, 0), 0);

const HERMES_CHARS = countChars(HERMES_SESSION);
const ATHENA_CHARS = countChars(ATHENA_SESSION);

// What athena's session shows once the mention reaches her.
//
// This has to be the message that was actually sent, attributed to the sender.
// It previously read "@hermes released billing.ts", which put the wrong name in
// the magenta mention slot right after a pill saying "@athena" flew across the
// screen — the two read as the same token and the delivery looked mis-addressed.
const ATHENA_AFTER: TermLine[] = [
  ...ATHENA_SESSION,
  { spans: [{ text: '' }] },
  {
    spans: [
      { text: '← message from ', color: term.brightBlack },
      { text: 'hermes', color: term.magenta, bold: true },
    ],
  },
  {
    spans: [
      { text: '  ' },
      { text: 'billing.ts', color: term.blue },
      { text: ' is yours. Pushed at 18:34, tests green.' },
    ],
  },
  { spans: [{ text: '✓', color: term.green }, { text: ' approved. writing refund path' }] },
];

// And what it shows when a human walks in and takes the keyboard. This is the
// thing agora does that a chat window cannot: athena is somebody else's session
// on somebody else's canvas, and martin can still type into it.
const ATHENA_TAKEOVER: TermLine[] = [
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

// hypnos's session once lea steps into it
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

// Each human flies in from off-frame and then moves between the things they are
// looking at. A presence badge in a node header only means something if the
// cursor agrees with it, so every badge in this scene has a cursor on it.
//
// Legs are absolute screen positions, applied in order. The nodes live inside a
// group that scales 0.84 about (960, 496.8) and lifts -40 at WIDEN, so these
// were read off the post-transform positions: hermes centres near (557, 436),
// athena near (1363, 436), hypnos near (464, 751).
type Leg = { at: number; x: number; y: number };
const PEER_ARRIVALS: {
  peer: (typeof PEERS)[number];
  at: number;
  from: { x: number; y: number };
  legs: Leg[];
}[] = [
  {
    peer: PEERS[0],
    at: HUMANS,
    from: { x: -80, y: 980 },
    legs: [
      { at: HUMANS, x: 470, y: 520 },
      // and then straight into athena's session, which is not his
      { at: TAKEOVER, x: 1315, y: 402 },
    ],
  },
  {
    peer: PEERS[1],
    at: HUMANS + BEAT,
    from: { x: 2040, y: 900 },
    legs: [
      { at: HUMANS + BEAT, x: 1430, y: 505 },
      // martin has athena, so lea goes to hypnos. Two humans, two sessions,
      // neither of which is theirs.
      { at: SECOND_HUMAN, x: 566, y: 806 },
    ],
  },
  {
    peer: PEERS[2],
    at: HUMANS + BEAT * 2,
    from: { x: 900, y: 1160 },
    legs: [
      { at: HUMANS + BEAT * 2, x: 1180, y: 880 },
      { at: WIDEN, x: 470, y: 745 },
    ],
  },
];

export const ActMultiplayer: React.FC = () => {
  const frame = useCurrentFrame();

  // the whole board pulls back a little for the last two bars
  const zoom = springTo(frame, WIDEN, 1, 0.84, 'glide');
  const lift = springTo(frame, WIDEN, 0, -40, 'glide');

  const hermesTyped = interpolate(frame, [10, 150], [0, HERMES_CHARS], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const athenaTyped = interpolate(frame, [40, 190], [0, ATHENA_CHARS], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // messages land one per beat once the board is in
  const visibleMessages = Math.max(
    0,
    Math.min(BOARD.length, Math.floor((frame - BOARD_IN) / BEAT) + 1),
  );

  const boardIn = sp(frame, BOARD_IN, 'snappy');

  // the mention travelling from the board to athena's header
  const travel = interpolate(frame, [DELIVER, DELIVER + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const delivered = frame >= DELIVER + 18;
  const landFlash = delivered
    ? Math.max(0, 1 - (frame - (DELIVER + 18)) / 16)
    : 0;

  // the takeover: martin's cursor reaches athena's node, then he types in it
  const takenOver = frame >= TAKEOVER + 14;
  const secondHuman = frame >= SECOND_HUMAN + 14;
  const takeoverTyped = interpolate(
    frame,
    [TAKEOVER + 14, TAKEOVER + 96],
    [countChars(ATHENA_AFTER), countChars(ATHENA_TAKEOVER)],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // presence: who is watching what, and from when
  const watchHermes = rise(frame, HUMANS + BEAT, 20);
  const watchAthena = rise(frame, HUMANS + BEAT * 2, 20);

  return (
    <Stage>
      <CanvasBackground opacity={0.75} offsetX={frame * 0.3} offsetY={-frame * 0.12} />

      <SectionLabel
        kicker="built for teams"
        title="Agents that talk to each other"
        x={120}
        y={78}
      />

      <AbsoluteFill
        style={{
          transform: `scale(${zoom}) translateY(${lift}px)`,
          transformOrigin: '50% 46%',
        }}
      >
        {/* hermes, left */}
        <div
          style={{
            position: 'absolute',
            left: 110,
            top: 268,
            transform: `translateY(${(1 - sp(frame, 0, 'glide')) * 40}px)`,
            opacity: sp(frame, 0, 'glide'),
          }}
        >
          <TerminalNode
            name="hermes"
            harness={AGENTS.hermes.harness}
            state={delivered ? 'idle' : 'working'}
            stateLabel={delivered ? 'idle' : 'working'}
            path="~/projects/checkout"
            width={740}
            height={392}
            glowColor={PEERS[0].color}
            glowStrength={takenOver ? 0 : watchHermes}
            viewers={
              watchHermes > 0.4 && !takenOver
                ? [{ name: PEERS[0].name, color: PEERS[0].color }]
                : []
            }
          >
            <Terminal lines={HERMES_SESSION} visibleChars={hermesTyped} showCursor fontSize={14.5} />
          </TerminalNode>
        </div>

        {/* athena, right — the one the mention is aimed at */}
        <div
          style={{
            position: 'absolute',
            left: 1070,
            top: 268,
            transform: `translateY(${(1 - sp(frame, BEAT, 'glide')) * 40}px) scale(${
              1 + landFlash * 0.02
            })`,
            opacity: sp(frame, BEAT, 'glide'),
          }}
        >
          <TerminalNode
            name="athena"
            harness={AGENTS.athena.harness}
            state={delivered ? 'working' : 'needs_approval'}
            stateLabel={delivered ? 'working' : 'needs approval'}
            path="~/projects/checkout"
            width={740}
            height={392}
            glowColor={
              takenOver
                ? PEERS[0].color
                : delivered && landFlash > 0
                  ? term.magenta
                  : PEERS[1].color
            }
            glowStrength={Math.max(landFlash, watchAthena, takenOver ? 1 : 0)}
            viewers={[
              ...(watchAthena > 0.4 ? [{ name: PEERS[1].name, color: PEERS[1].color }] : []),
              ...(takenOver ? [{ name: PEERS[0].name, color: PEERS[0].color }] : []),
            ]}
          >
            <Terminal
              lines={takenOver ? ATHENA_TAKEOVER : delivered ? ATHENA_AFTER : ATHENA_SESSION}
              visibleChars={
                takenOver ? takeoverTyped : delivered ? undefined : athenaTyped
              }
              showCursor
              fontSize={14.5}
            />
          </TerminalNode>
        </div>

        {/* hypnos joins for the wide shot */}
        {frame >= WIDEN && (
          <div
            style={{
              position: 'absolute',
              // left-aligned under hermes and stopping short of x=655, so it
              // clears the board rather than sitting underneath it
              left: 110,
              top: 690,
              transform: `scale(${interpolate(sp(frame, WIDEN, 'punch'), [0, 1], [0.85, 1])})`,
              opacity: sp(frame, WIDEN, 'punch'),
            }}
          >
            <TerminalNode
              name="hypnos"
              harness={AGENTS.hypnos.harness}
              state="working"
              stateLabel="working"
              path="~/projects/checkout"
              width={520}
              height={290}
              glowColor={secondHuman ? PEERS[1].color : PEERS[2].color}
              glowStrength={Math.max(rise(frame, WIDEN + BEAT, 20), secondHuman ? 1 : 0)}
              viewers={[
                { name: PEERS[2].name, color: PEERS[2].color },
                ...(secondHuman ? [{ name: PEERS[1].name, color: PEERS[1].color }] : []),
              ]}
            >
              <Terminal
                lines={secondHuman ? HYPNOS_TAKEN : HYPNOS_SESSION}
                showCursor
                fontSize={13}
              />
            </TerminalNode>
          </div>
        )}

        {/* the board */}
        {frame >= BOARD_IN && (
          <div
            style={{
              position: 'absolute',
              left: 655,
              top: 640,
              transform: `translateY(${(1 - boardIn) * 60}px)`,
              opacity: boardIn,
              zIndex: 5,
            }}
          >
            <ChatNode width={610} height={390} messages={BOARD} visibleCount={visibleMessages} />
          </div>
        )}

        {/* the mention in flight: board -> athena's header */}
        {frame >= DELIVER && !delivered && (
          <div
            style={{
              position: 'absolute',
              left: interpolate(travel, [0, 1], [900, 1420]),
              top: interpolate(travel, [0, 1], [800, 292]),
              zIndex: 20,
              transform: `scale(${interpolate(travel, [0, 0.5, 1], [0.6, 1.15, 0.9])})`,
              opacity: interpolate(travel, [0, 0.1, 0.9, 1], [0, 1, 1, 0.4]),
              fontFamily: font.mono,
              fontSize: 22,
              fontWeight: 700,
              padding: '6px 14px',
              borderRadius: 999,
              background: term.magenta,
              color: '#1c1917',
              boxShadow: `0 0 30px ${term.magenta}`,
              filter: `blur(${interpolate(travel, [0, 0.3, 0.8, 1], [0, 1.5, 1.5, 0])}px)`,
            }}
          >
            @athena
          </div>
        )}
      </AbsoluteFill>

      {/* live cursors */}
      {PEER_ARRIVALS.map(({ peer, at, from, legs }) => {
        if (frame < at) return null;
        const t = frame - at;
        // walk the legs in order: each one eases from where the previous left off
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
        // a small idle drift so nobody ever looks parked
        const drift = Math.max(0, t - 40);
        return (
          <Cursor
            key={peer.name}
            x={x + Math.sin(drift / 29) * 22}
            y={y + Math.cos(drift / 37) * 15}
            name={peer.name}
            color={peer.color}
            opacity={interpolate(t, [0, 8], [0, 1], { extrapolateRight: 'clamp' })}
          />
        );
      })}

      <Caption from={BAR} until={BOARD_IN + BEAT} x={120} y={886} size={26} width={500}>
        Several agents on one repo, each in its own session.
      </Caption>
      <Caption from={BOARD_IN + BEAT} until={DELIVER} x={120} y={886} size={26} width={500}>
        They announce what they are about to touch, so nobody overwrites anybody.{' '}
        <span style={{ color: c.foreground }}>Coordination you can read.</span>
      </Caption>
      <Caption from={DELIVER + 20} until={HUMANS} x={120} y={886} size={26} width={500}>
        <span style={{ color: term.magenta }}>@mention</span> a session and the message lands{' '}
        <span style={{ color: c.foreground }}>inside its terminal</span>.
      </Caption>
      <Caption from={HUMANS + BEAT * 3} until={TAKEOVER} x={120} y={886} size={26} width={500}>
        Invite a human too. Live cursors, presence on the terminal someone is watching.
      </Caption>
      <Caption from={TAKEOVER + 18} until={SECOND_HUMAN + 18} x={120} y={886} size={26} width={500}>
        And you can walk into someone else&apos;s terminal and{' '}
        <span style={{ color: c.foreground }}>take the keyboard</span>. It is the same
        pty, not a screenshare.
      </Caption>
      <Caption from={SECOND_HUMAN + 18} x={120} y={886} size={26} width={520}>
        <span style={{ color: c.foreground }}>Three people and four agents</span> in one
        workspace, at the same time, each one able to type into any of it.
      </Caption>
    </Stage>
  );
};
