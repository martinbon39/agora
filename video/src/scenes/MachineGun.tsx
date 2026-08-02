// 0:08–0:17.6 — the machine gun, then the hole.
//
// Cut density ramps from one shot per beat to one per 16th. Nothing here is
// meant to be read; it is meant to establish that there is a lot of product and
// that all of it is alive. The last beat is empty — the score goes silent too,
// and that hole is what makes the logo land.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term, AGENTS } from '../brand/tokens';
import { BEAT } from '../lib/beats';
import { rand } from '../lib/motion';
import { Bloom, Stage } from '../lib/Stage';
import { Session } from '../lib/Session';
import { TerminalNode } from '../ui/TerminalNode';
import { ChatNode } from '../ui/ChatNode';
import { StickyNode } from '../ui/StickyNode';
import { Cursor } from '../ui/Cursor';
import { CanvasBackground } from '../ui/CanvasBackground';
import { HarnessAvatar } from '../ui/HarnessAvatar';
import { BOARD, EVENT_SESSIONS, PEERS } from '../content';

// Shot lengths in frames, ramping a beat -> half -> quarter.
//
// The ramp itself is what works, so it is kept exactly: one shot per beat to
// open, then twice per beat, then the 6-frame burst that runs into the hole.
// What changed is the runtime, 6 bars down to 4 — the same acceleration, with
// the two bars handed to the canvas and multiplayer instead.
const PATTERN: number[] = [
  ...Array(6).fill(24),
  ...Array(8).fill(12),
  ...Array(20).fill(6),
];

const CUTS = PATTERN.reduce<{ at: number; dur: number }[]>((acc, dur) => {
  const at = acc.length ? acc[acc.length - 1].at + acc[acc.length - 1].dur : 0;
  acc.push({ at, dur });
  return acc;
}, []);

const HOLE = CUTS[CUTS.length - 1].at + CUTS[CUTS.length - 1].dur; // 552

const KEYWORDS = [
  'tmux',
  'pty',
  'xterm.js',
  'WebSocket',
  'detached',
  'canvas',
  'hooks',
  'presence',
  'bwrap',
  'passkey',
];

type ShotProps = { t: number; dur: number; seed: number };

/** A terminal pane, blown up past the frame so only a slab of it is visible. */
const ShotTerminal: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const lines = EVENT_SESSIONS[Math.floor(rand(seed) * EVENT_SESSIONS.length)];
  const scale = 2.6 + rand(seed + 1) * 1.2;
  const drift = interpolate(t, [0, dur], [0, -60]);
  return (
    <AbsoluteFill style={{ background: term.background, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: -200 + rand(seed + 2) * 300,
          top: 120 + drift,
          transform: `scale(${scale})`,
          transformOrigin: 'left top',
        }}
      >
        <Session harness="claude" width={760} height={520} events={lines} status="working" spinnerFrame={t} fontSize={13} />
      </div>
    </AbsoluteFill>
  );
};

/** A single status dot, the size of a face. */
const ShotStatus: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const states = [
    { color: c.working, label: 'working' },
    { color: c.idle, label: 'idle' },
    { color: c.needsApproval, label: 'needs approval' },
  ] as const;
  const st = states[Math.floor(rand(seed) * states.length)];
  const grow = interpolate(t, [0, dur], [1, 1.12]);
  const ring = interpolate(t, [0, dur], [0.9, 2.4]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Bloom size={700} color={st.color} opacity={0.16} blur={130} />
      <div style={{ position: 'relative', transform: `scale(${grow})` }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `3px solid ${st.color}`,
            transform: `scale(${ring})`,
            opacity: interpolate(t, [0, dur], [0.55, 0]),
          }}
        />
        <div style={{ width: 150, height: 150, borderRadius: '50%', background: st.color }} />
      </div>
      <div
        style={{
          marginTop: 46,
          fontFamily: font.sans,
          fontSize: 34,
          fontWeight: 500,
          letterSpacing: -0.4,
          color: st.color,
        }}
      >
        {st.label}
      </div>
    </AbsoluteFill>
  );
};

/** One board message, framed like a quote. */
const ShotChat: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const n = 2 + Math.floor(rand(seed) * (BOARD.length - 1));
  const slide = interpolate(t, [0, dur], [0, -26]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translateY(${slide}px) scale(1.55)` }}>
        <ChatNode width={620} height={420} messages={BOARD} visibleCount={n} />
      </div>
    </AbsoluteFill>
  );
};

/** A cursor crossing the frame with its name tag. */
const ShotCursor: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const peer = PEERS[Math.floor(rand(seed) * PEERS.length)];
  const x = interpolate(t, [0, dur], [420 + rand(seed + 3) * 500, 900 + rand(seed + 4) * 500]);
  const y = interpolate(t, [0, dur], [700, 380]);
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <CanvasBackground offsetX={t * 2} offsetY={-t} opacity={0.7} />
      <Cursor x={x} y={y} name={peer.name} color={peer.color} scale={3.4} />
    </AbsoluteFill>
  );
};

/** A whole node, small, floating on the canvas. */
const ShotNode: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const names = Object.keys(AGENTS) as (keyof typeof AGENTS)[];
  const name = names[Math.floor(rand(seed) * names.length)];
  const agent = AGENTS[name];
  const lines = EVENT_SESSIONS[Math.floor(rand(seed + 1) * EVENT_SESSIONS.length)];
  const glow = interpolate(t, [0, dur], [0, 1]);
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', background: c.background }}
    >
      <CanvasBackground offsetX={-t * 3} opacity={0.6} />
      <div style={{ transform: `scale(${interpolate(t, [0, dur], [1.05, 1.14])})` }}>
        <TerminalNode
          name={name}
          harness={agent.harness}
          state="working"
          stateLabel="working"
          path="~/projects/checkout"
          width={880}
          height={520}
          glowColor={agent.color}
          glowStrength={glow}
          viewers={[{ name: 'martin', color: PEERS[0].color }]}
        >
          <Session harness={agent.harness} width={880} height={520 - 36} events={lines} status="working" spinnerFrame={t} fontSize={13} />
        </TerminalNode>
      </div>
    </AbsoluteFill>
  );
};

/** One mono word, full frame. The film's punctuation. */
const ShotWord: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const w = KEYWORDS[Math.floor(rand(seed) * KEYWORDS.length)];
  const scale = interpolate(t, [0, dur], [1, 1.07]);
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        background: seed % 3 === 0 ? c.foreground : c.background,
      }}
    >
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 142,
          fontWeight: 700,
          letterSpacing: -5,
          color: seed % 3 === 0 ? c.background : c.foreground,
          transform: `scale(${scale})`,
        }}
      >
        {w}
      </div>
    </AbsoluteFill>
  );
};

/** A rank of agents with their status dots — the "room full of agents" idea. */
const ShotRoster: React.FC<ShotProps> = ({ t, dur }) => {
  const names = Object.keys(AGENTS) as (keyof typeof AGENTS)[];
  const states = ['working', 'idle', 'needs_approval', 'working', 'idle'] as const;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 60 }}>
      <div style={{ display: 'flex', gap: 64, transform: `scale(${interpolate(t, [0, dur], [1.5, 1.62])})` }}>
        {names.map((n, i) => (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <HarnessAvatar harness={AGENTS[n].harness} state={states[i]} size="md" />
            <span style={{ fontFamily: font.sans, fontSize: 13, fontWeight: 500, color: c.muted }}>{n}</span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** A sticky note, because the canvas is not only terminals. */
const ShotSticky: React.FC<ShotProps> = ({ t, dur, seed }) => {
  const notes = [
    { text: 'do not run 0042 until hypnos signs off', color: 'rose' as const, author: 'martin' },
    { text: 'demo at 18:00, freeze main at 17:30', color: 'amber' as const, author: 'lea' },
    { text: "refund path is athena's. hands off.", color: 'sky' as const, author: 'hermes' },
  ];
  const n = notes[Math.floor(rand(seed) * notes.length)];
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', background: c.background }}
    >
      <CanvasBackground opacity={0.6} offsetY={t * 2} />
      <div
        style={{
          transform: `rotate(${-3 + rand(seed + 1) * 6}deg) scale(${interpolate(t, [0, dur], [1.8, 1.9])})`,
        }}
      >
        <StickyNode width={300} height={250} text={n.text} color={n.color} author={n.author} />
      </div>
    </AbsoluteFill>
  );
};

// Seven distinct shots, and the index is strided by 3. Seven is prime, so the
// stride walks all seven before it repeats any of them: no shot type ever lands
// twice in a row, and none appears three times in the same handful of cuts.
// The list used to hold duplicates and the section read as the same four images
// looping.
const SHOTS = [
  ShotTerminal,
  ShotStatus,
  ShotNode,
  ShotWord,
  ShotChat,
  ShotCursor,
  ShotRoster,
];
const SHOT_STRIDE = 3;

export const MachineGun: React.FC = () => {
  const frame = useCurrentFrame();

  if (frame >= HOLE) {
    // the hole. Everything drains except one line of accent, which is the
    // only thing still on screen when the impact hits.
    const t = frame - HOLE;
    return (
      <Stage background="#000000">
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: interpolate(t, [0, BEAT], [900, 40]),
              height: 2,
              background: '#ffffff',
              opacity: interpolate(t, [0, BEAT - 4, BEAT], [0.9, 0.5, 0]),
              boxShadow: '0 0 40px rgba(255,255,255,0.85)',
            }}
          />
        </AbsoluteFill>
      </Stage>
    );
  }

  const idx = CUTS.findIndex((cut) => frame >= cut.at && frame < cut.at + cut.dur);
  const cut = CUTS[Math.max(0, idx)];
  const Shot = SHOTS[(Math.max(0, idx) * SHOT_STRIDE) % SHOTS.length];
  const t = frame - cut.at;

  return (
    <Stage>
      <Shot t={t} dur={cut.dur} seed={idx * 7 + 3} />
    </Stage>
  );
};
