// Four bars: close the laptop, it keeps running.
//
// The act only works if the laptop is a physical object, so it is one: CSS 3D,
// a lid hinged on the back edge of a base, a deck lit by its own screen, and a
// contact shadow that tightens as the lid comes down.
//
// The staging is the argument. The session DETACHES from the screen before the
// lid ever reaches it and settles on the right of frame, where it keeps
// printing with the lid shut and the clock running. Nothing about the machine
// was ever in the laptop — so when the lid comes back up, the same session is
// simply further along than you left it.
//
// Grid: lid starts closing on bar 1 (96) and lands on bar 1 beat 3 (168); the
// session detaches on beat 96+24 and lands with the lid; new output prints on
// every beat while it is shut; it opens again on bar 3 (288).

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { AGENTS, c, font, term } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rise, sp, springTo } from '../lib/motion';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { Terminal, type TermLine } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';
import { HERMES_SESSION } from '../content';

// ── the grid ────────────────────────────────────────────────────────────────
const CLOSE_FROM = BAR; // 96
const CLOSE_DUR = BEAT * 3; // 72
const SHUT = CLOSE_FROM + CLOSE_DUR; // 168
const DETACH = BAR + BEAT; // 120 — the session leaves the screen
const OPEN_FROM = BAR * 3; // 288

// ── the laptop, in millimetres of nothing ───────────────────────────────────
const W = 720; // lid + base width
const H = 460; // lid height
const D = 470; // base depth
const HINGE_X = 700;
const HINGE_Y = 720;
const LID_LIFT = 10; // the closed lid rests this far above the deck
const OPEN_ANGLE = 12; // leaning back, the way an open lid does
const SHUT_ANGLE = -90;

const BEZEL_X = 14;
const BEZEL_TOP = 14;
const BEZEL_CHIN = 24;
const SCREEN_W = W - BEZEL_X * 2;
const SCREEN_H = H - BEZEL_TOP - BEZEL_CHIN;

// ── the other machine ───────────────────────────────────────────────────────
const NODE_W = 600;
const NODE_H = 400;
const NODE_X = 1180;
const NODE_Y = 350;
// where it starts: sitting on the laptop's screen, at screen scale
const NODE_X0 = 569;
const NODE_Y0 = 300;
const NODE_S0 = 0.5;

// ── content ─────────────────────────────────────────────────────────────────
const s = (text: string, color?: string): TermLine['spans'][number] => ({ text, color });
const dim = (text: string) => s(text, term.brightBlack);
const ok = (text: string) => s(text, term.green);
const file = (text: string) => s(text, term.blue);

/** What hermes does while nobody is watching. One new line per beat. */
const CONTINUED: { at: number; line: TermLine }[] = [
  { at: SHUT + BEAT, line: { spans: [dim('reading '), file('src/payments/refund.ts')] } },
  { at: SHUT + BEAT * 2, line: { spans: [ok('✓'), s(' idempotency keys + 11 tests')] } },
  { at: SHUT + BEAT * 3, line: { spans: [dim('running vitest…')] } },
  { at: SHUT + BEAT * 4, line: { spans: [ok('✓'), s(' 58 passed')] } },
  {
    at: OPEN_FROM,
    line: {
      spans: [s('@athena', AGENTS.athena.color), s(' billing.ts is yours, pushed')],
    },
  },
  {
    at: OPEN_FROM + BEAT,
    line: { spans: [ok('✓'), s(' 12 commits'), dim('   6h 12m in session')] },
  },
];

const TYPED_CHARS = HERMES_SESSION.reduce(
  (n, l) => n + l.spans.reduce((m, sp2) => m + sp2.text.length, 0),
  0,
);

const CLOCK_FROM = 9 * 60 + 14;
const CLOCK_TO = 15 * 60 + 26;
const clock = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ── the deck ────────────────────────────────────────────────────────────────
const KEY_ROWS = [14, 14, 14, 13, 8];

const Deck: React.FC<{ spill: number }> = ({ spill }) => (
  <div
    style={{
      position: 'absolute',
      left: -W / 2,
      top: 0,
      width: W,
      height: D,
      boxSizing: 'border-box',
      transformOrigin: 'center top',
      transform: 'rotateX(90deg)',
      borderRadius: '3px 3px 16px 16px',
      border: '1px solid rgb(255 255 255 / 7%)',
      background: 'linear-gradient(180deg, #252525 0%, #1c1c1c 45%, #141414 100%)',
      overflow: 'hidden',
    }}
  >
    {/* the hinge well */}
    <div
      style={{
        position: 'absolute',
        left: '9%',
        top: 0,
        width: '82%',
        height: 12,
        background: '#0b0b0b',
        borderRadius: '0 0 8px 8px',
      }}
    />
    {/* keyboard */}
    <div
      style={{
        position: 'absolute',
        left: '7%',
        top: 34,
        width: '86%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {KEY_ROWS.map((count, row) => (
        <div key={row} style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                flex: row === KEY_ROWS.length - 1 && i === 3 ? 5 : 1,
                height: 26,
                borderRadius: 4,
                background: 'rgb(255 255 255 / 4.5%)',
                borderTop: '1px solid rgb(255 255 255 / 5%)',
                boxShadow: '0 1px 0 rgb(0 0 0 / 45%)',
              }}
            />
          ))}
        </div>
      ))}
    </div>
    {/* trackpad */}
    <div
      style={{
        position: 'absolute',
        left: '35%',
        width: '30%',
        bottom: 26,
        height: D * 0.24,
        borderRadius: 8,
        background: 'rgb(255 255 255 / 2.5%)',
        border: '1px solid rgb(255 255 255 / 5%)',
      }}
    />
    {/* what the screen throws onto the deck */}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: spill,
        background:
          'radial-gradient(90% 130% at 50% -10%, rgb(255 255 255 / 20%), rgb(255 255 255 / 0%) 62%)',
      }}
    />
  </div>
);

export const ActLaptop: React.FC = () => {
  const frame = useCurrentFrame();

  // the lid. One spring, ending exactly on the beat it is cut to.
  const closeT = sp(frame, CLOSE_FROM, 'snappy', CLOSE_DUR);
  const openT = sp(frame, OPEN_FROM, 'punch');
  const lidAngle =
    OPEN_ANGLE + (SHUT_ANGLE - OPEN_ANGLE) * closeT + (OPEN_ANGLE - SHUT_ANGLE) * openT * 0.98;

  // how much of the screen is still pointed at us, roughly
  const lit = clamp01((lidAngle - SHUT_ANGLE) / (OPEN_ANGLE - SHUT_ANGLE));
  const glow = lit * lit;

  // camera: drifts left and looks further down as the lid comes down, then
  // pushes back in when it opens.
  const dx = 260 - 260 * closeT + 130 * openT;
  const scale = 1.02 - 0.1 * closeT + 0.09 * openT;
  const tilt = 13 + 7 * closeT - 8 * openT;
  const yaw = 13 - 7 * closeT + 3 * openT;
  // the thump: a damped settle on the frame the lid lands
  const thump = (1 - sp(frame, SHUT, 'punch')) * 5 * closeT;

  // the session, detaching from the screen and landing with the lid
  const nodeX = springTo(frame, DETACH, NODE_X0, NODE_X, 'glide');
  const nodeY = springTo(frame, DETACH, NODE_Y0, NODE_Y, 'glide');
  const nodeS = springTo(frame, DETACH, NODE_S0, 1, 'glide');
  const nodeIn = rise(frame, DETACH, BEAT);

  // output. The laptop screen is the same session, so it catches up on reopen.
  const grown = CONTINUED.filter((l) => frame >= l.at).map((l) => l.line);
  const lines: TermLine[] = [...HERMES_SESSION, ...grown];
  const typing = frame < CLOSE_FROM ? Math.round(rise(frame, 6, 78) * TYPED_CHARS) : undefined;
  // switched while the lid is shut, so nothing pops
  const lidLines = frame < SHUT + BEAT * 2 ? HERMES_SESSION : lines;

  const mins = CLOCK_FROM + (CLOCK_TO - CLOCK_FROM) * rise(frame, SHUT, BEAT * 4.5);

  const titleA = rise(frame, 10, 24);
  const titleB = sp(frame, SHUT, 'punch');
  const handoff = rise(frame, SHUT, 20); // part one steps back, part two arrives

  return (
    <Stage>
      <CanvasBackground opacity={0.4} offsetY={frame * 0.18} />

      {/* title */}
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 96,
          fontFamily: font.sans,
          fontSize: 58,
          fontWeight: 700,
          letterSpacing: -1.8,
          lineHeight: 1.08,
          maxWidth: 700,
        }}
      >
        <div
          style={{
            color: handoff > 0 ? c.muted : c.foreground,
            opacity: titleA * (1 - handoff * 0.35),
            transform: `translateY(${(1 - titleA) * 14}px)`,
          }}
        >
          Close the laptop.
        </div>
        {frame >= SHUT && (
          <div
            style={{
              color: c.foreground,
              transformOrigin: 'left center',
              transform: `scale(${1.18 - 0.18 * titleB})`,
              opacity: clamp01(titleB * 2),
            }}
          >
            It keeps running.
          </div>
        )}
      </div>

      {/* the other machine, printing with the lid shut */}
      <div
        style={{
          position: 'absolute',
          left: nodeX,
          top: nodeY,
          width: NODE_W,
          opacity: nodeIn,
          transform: `scale(${nodeS})`,
          transformOrigin: 'center center',
        }}
      >
        <TerminalNode
          name="hermes"
          harness={AGENTS.hermes.harness}
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={NODE_W}
          height={NODE_H}
        >
          <Terminal lines={lines} fontSize={14} padding={14} showCursor />
        </TerminalNode>
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            fontFamily: font.sans,
            fontSize: 20,
            color: c.muted,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: c.idle,
              alignSelf: 'center',
            }}
          />
          your server
          <span style={{ fontFamily: font.mono, fontSize: 22, color: c.foreground }}>
            {clock(mins)}
          </span>
        </div>
      </div>

      {/* contact shadow — tightens and darkens as the lid comes down */}
      <div
        style={{
          position: 'absolute',
          left: HINGE_X + dx - (W * 0.62 * scale),
          top: HINGE_Y + 118 * scale,
          width: W * 1.24 * scale * (1 - 0.2 * closeT + 0.16 * openT),
          height: 120 * scale,
          borderRadius: '50%',
          background: '#000000',
          opacity: 0.5 + 0.22 * closeT - 0.14 * openT,
          filter: `blur(${(58 - 26 * closeT + 20 * openT) * scale}px)`,
        }}
      />

      {/* the white the screen puts into the room */}
      {glow > 0.02 && (
        <div
          style={{
            position: 'absolute',
            left: HINGE_X + dx - 520 * scale,
            top: HINGE_Y - 640 * scale,
            width: 1040 * scale,
            height: 720 * scale,
            borderRadius: '50%',
            background: '#ffffff',
            opacity: 0.055 * glow,
            filter: `blur(${150 * scale}px)`,
          }}
        />
      )}

      {/* the laptop */}
      <AbsoluteFill style={{ perspective: 1900, perspectiveOrigin: '48% 44%' }}>
        <div
          style={{
            position: 'absolute',
            left: HINGE_X + dx,
            top: HINGE_Y + thump,
            transformStyle: 'preserve-3d',
            transform: `scale(${scale}) rotateX(${tilt}deg) rotateY(${yaw}deg)`,
          }}
        >
          <Deck spill={glow} />

          {/* the front lip of the base, so it has thickness */}
          <div
            style={{
              position: 'absolute',
              left: -W / 2,
              top: 0,
              width: W,
              height: 20,
              boxSizing: 'border-box',
              transform: `translateZ(${D}px)`,
              borderRadius: '0 0 12px 12px',
              background: 'linear-gradient(180deg, #202020, #101010)',
              borderLeft: '1px solid rgb(255 255 255 / 5%)',
              borderRight: '1px solid rgb(255 255 255 / 5%)',
              borderBottom: '1px solid rgb(255 255 255 / 5%)',
            }}
          />

          {/* the lid */}
          <div
            style={{
              position: 'absolute',
              left: -W / 2,
              top: -H,
              width: W,
              height: H,
              transformOrigin: 'center bottom',
              transformStyle: 'preserve-3d',
              transform: `translateY(${-LID_LIFT}px) rotateX(${lidAngle}deg)`,
            }}
          >
            {/* the screen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                boxSizing: 'border-box',
                transform: 'translateZ(3px)',
                backfaceVisibility: 'hidden',
                borderRadius: 16,
                border: '1px solid rgb(255 255 255 / 9%)',
                background: '#0b0b0b',
                padding: `${BEZEL_TOP}px ${BEZEL_X}px ${BEZEL_CHIN}px`,
                boxShadow: `0 0 ${70 * glow}px rgb(255 255 255 / ${9 * glow}%)`,
              }}
            >
              <div style={{ opacity: 0.25 + 0.75 * lit }}>
                <TerminalNode
                  name="hermes"
                  harness={AGENTS.hermes.harness}
                  state="working"
                  stateLabel="working"
                  path="~/projects/checkout"
                  width={SCREEN_W}
                  height={SCREEN_H}
                >
                  <Terminal
                    lines={lidLines}
                    visibleChars={typing}
                    fontSize={16}
                    padding={16}
                    showCursor
                  />
                </TerminalNode>
              </div>
            </div>

            {/* the back of the lid, which is all you see once it is shut */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                transform: 'translateZ(-3px) rotateY(180deg)',
                backfaceVisibility: 'hidden',
                borderRadius: 16,
                border: '1px solid rgb(255 255 255 / 6%)',
                background: 'linear-gradient(155deg, #262626 0%, #1a1a1a 55%, #131313 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  transform: 'rotate(180deg)',
                  fontFamily: font.sans,
                  fontSize: 40,
                  fontWeight: 600,
                  letterSpacing: -1.4,
                  color: 'rgb(255 255 255 / 7%)',
                }}
              >
                agora
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
