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
import { expoOut, rise, sp } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Session } from '../lib/Session';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { StickyNode } from '../ui/StickyNode';
import { Cursor } from '../ui/Cursor';
import {
  ATHENA_EVENTS_AFTER,
  ATHENA_EVENTS_TAKEN,
  BOARD,
  HERMES_EVENTS,
  HYPNOS_EVENTS,
  HYPNOS_EVENTS_TAKEN,
  PEERS,
} from '../content';

// The act opens on the thing that lets any of this happen: an invite button.
// A cursor presses it, and the room fills. Martin's note was that the cut into
// this act was the weakest in the film and that the answer was fewer words, not
// more: the button IS the explanation.
const INVITE_AT = BEAT * 2; // 48, the press
const HUMANS = BAR; // 96, the room appears and everyone arrives at once
const CANVAS_ACT = BAR * 3; // 288, somebody puts something on the canvas
const TAKEOVER = BAR * 5; // 480, and then takes a keyboard that is not theirs
const SECOND = BAR * 7; // 672, and a second person does the same, elsewhere

// The camera. This act is the heart of the product, so the frame is not allowed
// to sit still and watch: it goes where the collaboration goes. Each keyframe is
// a world point to centre on and a zoom, and the move between two of them is a
// glide, so the camera drifts rather than snapping.
type Shot = { at: number; x: number; y: number; s: number };
const CAMERA: Shot[] = [
  { at: 0, x: 960, y: 540, s: 1 },
  { at: BAR, x: 960, y: 560, s: 0.94 }, // the room arrives, take it all in
  { at: BAR * 3, x: 1430, y: 690, s: 1.12 }, // somebody puts a note on the canvas
  { at: BAR * 5, x: 1450, y: 420, s: 1.18 }, // martin takes athena's keyboard
  { at: BAR * 7, x: 400, y: 720, s: 1.18 }, // lea takes hypnos'
  { at: BAR * 8 + BEAT * 2, x: 960, y: 560, s: 0.86 }, // and back out on everyone
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
    at: HUMANS,
    from: { x: 2040, y: 900 },
    legs: [
      { at: HUMANS, x: 1462, y: 428 },
      { at: SECOND, x: 356, y: 728 },
    ],
  },
  {
    peer: PEERS[2], // sam: the board, then drops a note onto the canvas
    at: HUMANS,
    from: { x: 900, y: 1160 },
    legs: [
      { at: HUMANS, x: 962, y: 812 },
      { at: CANVAS_ACT, x: 1452, y: 648 },
    ],
  },
];

/** Everyone who is in the room but not the subject of a beat. */
const EXTRAS = PEERS.slice(3).map((peer, i) => ({
  peer,
  at: BAR + BEAT * (i + 1),
  path: (t: number) => ({
    x: 420 + i * 520 + Math.sin((t + i * 90) / 47) * 210,
    y: 380 + Math.cos((t + i * 70) / 39) * 230,
  }),
}));

export const ActMultiplayer: React.FC = () => {
  const frame = useCurrentFrame();

  const watchHermes = rise(frame, HUMANS + 12, 20);
  const watchAthena = rise(frame, HUMANS + 12, 20);

  const takenOver = frame >= TAKEOVER + 16;
  const secondHuman = frame >= SECOND + 16;
  const takeoverPunch = takenOver ? Math.max(0, 1 - (frame - TAKEOVER - 16) / 16) : 0;

  // sam pulls a note onto the canvas: it flies in under the cursor and settles
  const noteIn = sp(frame, CANVAS_ACT, 'glide');
  const noteX = interpolate(noteIn, [0, 1], [1560, 1330]);
  const noteY = interpolate(noteIn, [0, 1], [900, 632]);

  const pressT = interpolate(frame, [INVITE_AT, INVITE_AT + 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const pressed = frame >= INVITE_AT;
  const ringT = interpolate(frame, [INVITE_AT, INVITE_AT + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: expoOut,
  });

  // Nothing exists before the button is pressed. The room is what the press
  // brings into being, so it scales up from the button's own position.
  const roomIn = sp(frame, HUMANS - BEAT, 'snappy');

  // walk the camera keyframes the same way the cursors walk their legs
  let cam = { x: CAMERA[0].x, y: CAMERA[0].y, s: CAMERA[0].s };
  let prevShot = CAMERA[0];
  for (const shot of CAMERA.slice(1)) {
    if (frame < shot.at) break;
    const m = sp(frame, shot.at, 'glide');
    cam = {
      x: cam.x + (shot.x - prevShot.x) * m,
      y: cam.y + (shot.y - prevShot.y) * m,
      s: cam.s + (shot.s - prevShot.s) * m,
    };
    prevShot = shot;
  }

  const viewer = (i: number) => ({ name: PEERS[i].name, color: PEERS[i].color });

  return (
    <Stage>
      <CanvasBackground opacity={0.75} offsetX={frame * 0.3} offsetY={-frame * 0.1} />

      <SectionLabel title="Invite anyone." then="Collaborate live." until={BAR * 2} y={78} />

      {/* the invite button, pressed on the beat before the room fills */}
      {frame < HUMANS + BEAT && (
        <div
          style={{
            position: 'absolute',
            left: 872,
            top: 476,
            opacity: interpolate(frame, [8, 20, HUMANS, HUMANS + BEAT], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            zIndex: 40,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 24px',
              borderRadius: 12,
              background: c.primary,
              color: '#ffffff',
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: -0.3,
              // it depresses on the press, the way a button does
              transform: `scale(${pressT > 0 && pressT < 1 ? 0.96 : 1})`,
              boxShadow: pressed
                ? `0 0 0 6px ${c.primary}22, 0 10px 30px rgb(0 0 0 / 45%)`
                : '0 10px 30px rgb(0 0 0 / 45%)',
            }}
          >
            Invite
          </div>
          {/* the ring that leaves the button when it is pressed */}
          {pressed && (
            <div
              style={{
                position: 'absolute',
                inset: -4,
                borderRadius: 16,
                border: `2px solid ${c.primary}`,
                transform: `scale(${1 + ringT * 0.9})`,
                opacity: 1 - ringT,
              }}
            />
          )}
        </div>
      )}

      {/* the cursor that presses it, before the others arrive */}
      {frame < HUMANS && (
        <Cursor
          x={interpolate(frame, [0, INVITE_AT], [1180, 1010], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: expoOut,
          })}
          y={interpolate(frame, [0, INVITE_AT], [700, 520], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: expoOut,
          })}
          name={PEERS[0].name}
          color={PEERS[0].color}
        />
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: roomIn,
          transform: `translate(${960 - cam.x * cam.s}px, ${540 - cam.y * cam.s}px) scale(${
            cam.s * interpolate(roomIn, [0, 1], [0.965, 1])
          })`,
          transformOrigin: '0 0',
        }}
      >
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
          <Session
            harness={AGENTS.hermes.harness}
            width={700}
            height={336 - 36}
            events={HERMES_EVENTS}
            status="idle"
            spinnerFrame={frame}
            fontSize={13}
          />
        </TerminalNode>
      </div>

      {/* athena, whose keyboard martin takes halfway through */}
      <div
        style={{
          position: 'absolute',
          left: 1110,
          top: 244,
          transform: 'none',
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
          <Session
            harness={AGENTS.athena.harness}
            width={700}
            height={336 - 36}
            events={takenOver ? ATHENA_EVENTS_TAKEN : ATHENA_EVENTS_AFTER}
            status="working"
            spinnerFrame={frame}
            promptText={takenOver ? 'hold on, add a test for the double refund case first' : undefined}
            fontSize={13}
          />
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
          <Session
            harness={AGENTS.hypnos.harness}
            width={560}
            height={268 - 36}
            events={secondHuman ? HYPNOS_EVENTS_TAKEN : HYPNOS_EVENTS}
            status="working"
            spinnerFrame={frame}
            fontSize={12}
          />
        </TerminalNode>
      </div>

      {/* the board, carried over from the act before */}
      <div style={{ position: 'absolute', left: 712, top: 596, zIndex: 5 }}>
        <ChatNode width={560} height={404} messages={BOARD} visibleCount={BOARD.length} />
      </div>

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
      {EXTRAS.map(({ peer, at, path }) => {
        if (frame < at) return null;
        const p = path(frame - at);
        return (
          <Cursor
            key={peer.name}
            x={p.x}
            y={p.y}
            name={peer.name}
            color={peer.color}
            opacity={interpolate(frame - at, [0, 10], [0, 0.85], { extrapolateRight: 'clamp' })}
          />
        );
      })}

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


      <Caption from={SECOND + 22} x={120} y={900} size={26} width={520}>
        <span style={{ color: c.foreground }}>Three people and three agents</span>, one
        workspace, at the same time. Nobody waiting for a turn.
      </Caption>
    </Stage>
  );
};
