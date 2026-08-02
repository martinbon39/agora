// Act four: the agents coordinate with each other.
//
// Deliberately has no humans in it. This act and the multiplayer act that
// follows were one act, and stacking them meant neither idea landed: "agents
// talk to each other" and "invite anyone into the workspace" are two different
// promises and each one needs its own title card.
//
// So: two sessions on one repo, a board they both write to, and an @mention
// physically arriving inside the other one's terminal. Nobody human touches it.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { sp } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Session } from '../lib/Session';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { ATHENA_EVENTS, ATHENA_EVENTS_AFTER, BOARD, HERMES_EVENTS } from '../content';

const BOARD_IN = BAR * 2; // 192
const DELIVER = BAR * 3; // 288, the mention leaves the board
const LANDED = DELIVER + 18;

export const ActAgentTalk: React.FC = () => {
  const frame = useCurrentFrame();

  // one event per beat, the way a session actually fills up
  const hermesSeen = Math.floor((frame - 12) / BEAT) + 1;
  const athenaSeen = Math.floor((frame - 36) / BEAT) + 1;

  // one message per beat once the board is in
  const visibleMessages = Math.max(
    0,
    Math.min(BOARD.length, Math.floor((frame - BOARD_IN) / BEAT) + 1),
  );
  const boardIn = sp(frame, BOARD_IN, 'snappy');

  const travel = interpolate(frame, [DELIVER, LANDED], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const delivered = frame >= LANDED;
  const landFlash = delivered ? Math.max(0, 1 - (frame - LANDED) / 16) : 0;

  return (
    <Stage>
      <CanvasBackground opacity={0.75} offsetX={frame * 0.3} offsetY={-frame * 0.12} />

      <SectionLabel title="Agents that talk to each other" y={78} />

      {/* hermes */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 232,
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
          height={424}
        >
          <Session
            harness={AGENTS.hermes.harness}
            width={740}
            height={424 - 36}
            events={HERMES_EVENTS}
            visibleCount={hermesSeen}
            status={delivered ? 'idle' : 'working'}
            spinnerFrame={frame}
            fontSize={13}
          />
        </TerminalNode>
      </div>

      {/* athena, the one the message is aimed at */}
      <div
        style={{
          position: 'absolute',
          left: 1070,
          top: 232,
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
          height={424}
          glowColor={term.magenta}
          glowStrength={landFlash}
        >
          <Session
            harness={AGENTS.athena.harness}
            width={740}
            height={424 - 36}
            events={delivered ? ATHENA_EVENTS_AFTER : ATHENA_EVENTS}
            visibleCount={delivered ? undefined : athenaSeen}
            status={delivered ? 'working' : 'waiting'}
            spinnerFrame={frame}
            fontSize={13}
          />
        </TerminalNode>
      </div>

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
          <ChatNode width={610} height={360} messages={BOARD} visibleCount={visibleMessages} />
        </div>
      )}

      {/* the mention in flight, board -> athena's header */}
      {frame >= DELIVER && !delivered && (
        <div
          style={{
            position: 'absolute',
            left: interpolate(travel, [0, 1], [900, 1420]),
            top: interpolate(travel, [0, 1], [780, 256]),
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

      <Caption from={LANDED + 4} x={120} y={886} size={26} width={500}>
        <span style={{ color: term.magenta }}>@mention</span> a session and the message lands{' '}
        <span style={{ color: c.foreground }}>inside its terminal</span>, not in a notification.
      </Caption>
    </Stage>
  );
};
