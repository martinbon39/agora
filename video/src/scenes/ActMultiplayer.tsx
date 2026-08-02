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
const DELIVER = BAR * 5; // 480 — the mention lands
const HUMANS = BAR * 7; // 672
const WIDEN = BAR * 9; // 864

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
  { spans: [{ text: '✓', color: term.green }, { text: ' approved — writing refund path' }] },
];

// Each human flies in from off-frame and settles ON the thing they are
// watching — martin on hermes, lea on athena, sam on the board. A presence
// badge in a node header only means something if the cursor agrees with it, so
// when hypnos appears at WIDEN carrying sam's badge, sam moves there too.
//
// hypnos's box is (110..630, 690..980) in group space; the group is scaled 0.84
// about (960, 496.8) and lifted -40, which puts its centre near (464, 751) on
// screen. That is where sam's second leg lands.
const PEER_ARRIVALS = [
  { peer: PEERS[0], at: HUMANS, from: { x: -80, y: 980 }, to: { x: 470, y: 520 } },
  { peer: PEERS[1], at: HUMANS + BEAT, from: { x: 2040, y: 900 }, to: { x: 1430, y: 505 } },
  {
    peer: PEERS[2],
    at: HUMANS + BEAT * 2,
    from: { x: 900, y: 1160 },
    to: { x: 1180, y: 880 },
    then: { at: WIDEN, x: 470, y: 745 },
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

  // presence: who is watching what, and from when
  const watchHermes = rise(frame, HUMANS + BEAT, 20);
  const watchAthena = rise(frame, HUMANS + BEAT * 2, 20);

  return (
    <Stage>
      <CanvasBackground opacity={0.75} offsetX={frame * 0.3} offsetY={-frame * 0.12} />

      <SectionLabel
        index="03 — multiplayer"
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
            glowStrength={watchHermes}
            viewers={watchHermes > 0.4 ? [{ name: PEERS[0].name, color: PEERS[0].color }] : []}
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
            glowColor={delivered && landFlash > 0 ? term.magenta : PEERS[1].color}
            glowStrength={Math.max(landFlash, watchAthena)}
            viewers={watchAthena > 0.4 ? [{ name: PEERS[1].name, color: PEERS[1].color }] : []}
          >
            <Terminal
              lines={delivered ? ATHENA_AFTER : ATHENA_SESSION}
              visibleChars={delivered ? undefined : athenaTyped}
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
              glowColor={PEERS[2].color}
              glowStrength={rise(frame, WIDEN + BEAT, 20)}
              viewers={[{ name: PEERS[2].name, color: PEERS[2].color }]}
            >
              <Terminal lines={HYPNOS_SESSION} showCursor fontSize={13} />
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
      {PEER_ARRIVALS.map(({ peer, at, from, to, then }) => {
        if (frame < at) return null;
        const t = frame - at;
        // eased fly-in, then a small idle drift so nobody looks parked
        const arrive = sp(frame, at, 'glide');
        const drift = Math.max(0, t - 40);
        let x = from.x + (to.x - from.x) * arrive;
        let y = from.y + (to.y - from.y) * arrive;
        if (then && frame >= then.at) {
          // second leg: follow the session that just appeared
          const move = sp(frame, then.at, 'glide');
          x += (then.x - to.x) * move;
          y += (then.y - to.y) * move;
        }
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
        They announce what they are about to touch —{' '}
        <span style={{ color: c.foreground }}>coordination you can read</span>.
      </Caption>
      <Caption from={DELIVER + 20} until={HUMANS} x={120} y={886} size={26} width={500}>
        <span style={{ color: term.magenta }}>@mention</span> a session and the message lands{' '}
        <span style={{ color: c.foreground }}>inside its terminal</span>.
      </Caption>
      <Caption from={HUMANS + BEAT * 3} x={120} y={886} size={26} width={500}>
        Invite a human too. Live cursors, presence on the terminal someone is watching.
      </Caption>
    </Stage>
  );
};
