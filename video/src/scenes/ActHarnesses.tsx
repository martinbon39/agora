// Act 02b — harnesses. Agora is not a Claude client; it is the cockpit, and the
// engine is a flag. Five avatars arrive on the rail one per beat, three of them
// open the same terminal chrome with different engines inside, and the section
// closes on the command that proves it: `agora spawn --harness codex`.
//
// Style rule for the v2: no blooms, no blue gradients. Blue is text and thin
// borders only; the surfaces are c.background + the dot grid.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font, term, AGENTS } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rise, sp } from '../lib/motion';
import { Caption, SectionLabel } from '../lib/Caption';
import { Stage } from '../lib/Stage';
import { CanvasBackground } from '../ui/CanvasBackground';
import { HarnessAvatar } from '../ui/HarnessAvatar';
import { Terminal, type TermLine } from '../ui/Terminal';
import { TerminalNode } from '../ui/TerminalNode';

const dim = (text: string) => ({ text, color: term.brightBlack });
const ok = (text: string) => ({ text, color: term.green });
const warn = (text: string) => ({ text, color: term.yellow });

// the rail: every engine agora can drive, one arrival per beat
const RAIL = [
  { harness: 'claude', at: BEAT },
  { harness: 'codex', at: BEAT * 2 },
  { harness: 'opencode', at: BEAT * 3 },
  { harness: 'gemini', at: BEAT * 4 },
  { harness: 'shell', at: BEAT * 5 },
] as const;

const RAIL_GAP = 78;
const RAIL_AVATAR = 72; // md avatar at scale 2
const RAIL_W = RAIL.length * RAIL_AVATAR + (RAIL.length - 1) * RAIL_GAP; // 672
const RAIL_X = 124; // aligned with the section label, not floating mid-frame
const RAIL_Y = 296;

const CLAUDE_LINES: TermLine[] = [
  { spans: [dim('agora session · hermes · claude')] },
  { spans: [{ text: '› ', color: term.brightBlack }, { text: 'fix the flaky socket test' }] },
  { spans: [ok('✓'), { text: ' reaper escalation covered' }] },
  { spans: [dim('running vitest…')] },
];

const CODEX_LINES: TermLine[] = [
  { spans: [dim('agora session · athena · codex')] },
  { spans: [{ text: '› ', color: term.brightBlack }, { text: 'mirror the webhook tests' }] },
  { spans: [warn('?'), { text: ' write to ' }, { text: 'billing.ts', color: term.blue }, { text: '? approve' }] },
  { spans: [dim('waiting for approval…')] },
];

const GEMINI_LINES: TermLine[] = [
  { spans: [dim('agora session · iris · gemini')] },
  { spans: [{ text: '› ', color: term.brightBlack }, { text: 'keep main green' }] },
  { spans: [ok('✓'), { text: ' 41 passed' }, dim('  ·  1.8s')] },
];

// same chrome three times, a different engine inside each
const TERMS = [
  {
    name: 'hermes',
    harness: AGENTS.hermes.harness,
    at: BAR + BEAT * 3, // 168
    x: 130,
    y: 430,
    w: 540,
    h: 300,
    state: 'working',
    label: 'working',
    lines: CLAUDE_LINES,
  },
  {
    name: 'athena',
    harness: AGENTS.athena.harness,
    at: BAR * 2, // 192
    x: 700,
    y: 460,
    w: 540,
    h: 300,
    state: 'needs_approval',
    label: 'needs approval',
    lines: CODEX_LINES,
  },
  {
    name: 'iris',
    harness: AGENTS.iris.harness,
    at: BAR * 2 + BEAT, // 216
    x: 1270,
    y: 430,
    w: 520,
    h: 290,
    state: 'idle',
    label: 'idle',
    lines: GEMINI_LINES,
  },
] as const;

// the closing command line
const SPAWN = BAR * 2 + BEAT * 3; // 264 — the box lands on the beat
const TYPE_FROM = SPAWN + 4; // 268
const CMD_SPANS = [
  dim('$ '),
  { text: 'agora ' },
  { text: 'spawn ' },
  dim('--harness '),
  { text: 'codex', color: term.magenta },
];
const CMD_CHARS = CMD_SPANS.reduce((n, s) => n + s.text.length, 0); // 29
const RESP = TYPE_FROM + CMD_CHARS * 2; // 326 — typed at 2 frames per char

export const ActHarnesses: React.FC = () => {
  const frame = useCurrentFrame();

  const spawnIn = sp(frame, SPAWN, 'punch');
  const typed = Math.max(0, Math.floor((frame - TYPE_FROM) / 2));
  const spawnLines: TermLine[] = [
    { spans: [...CMD_SPANS] },
    ...(frame >= RESP
      ? [{ spans: [ok('✓ '), { text: 'ajax' }, dim(' · codex · attached')] }]
      : []),
  ];

  return (
    <Stage>
      <CanvasBackground opacity={0.6} offsetY={-frame * 0.15} />

      <SectionLabel
        kicker="bring your own engine"
        title="Claude, Codex, Gemini, or a plain shell"
        size={54}
      />

      {/* the rail — one engine per beat */}
      {RAIL.map(({ harness, at }, i) => {
        const s = sp(frame, at, 'punch');
        const label = rise(frame, at + 6, 18);
        if (frame < at) return null;
        return (
          <div
            key={harness}
            style={{
              position: 'absolute',
              left: RAIL_X + i * (RAIL_AVATAR + RAIL_GAP),
              top: RAIL_Y,
              width: RAIL_AVATAR,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              transform: `scale(${interpolate(s, [0, 1], [0.5, 1])})`,
              opacity: interpolate(s, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
            }}
          >
            <span style={{ display: 'inline-flex', transform: 'scale(2)', transformOrigin: 'top center' }}>
              <HarnessAvatar harness={harness} state="idle" size="md" ringColor={c.background} />
            </span>
            <span
              style={{
                marginTop: RAIL_AVATAR - 36, // the scaled avatar does not take layout space
                fontFamily: font.sans,
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: 1.5,
                color: c.muted,
                opacity: label,
              }}
            >
              {harness}
            </span>
          </div>
        );
      })}

      {/* three sessions, same chrome, different engines */}
      {TERMS.map((t) => {
        const s = sp(frame, t.at, 'punch');
        if (frame < t.at) return null;
        return (
          <div
            key={t.name}
            style={{
              position: 'absolute',
              left: t.x,
              top: t.y,
              transform: `translateY(${(1 - s) * 26}px) scale(${interpolate(s, [0, 1], [0.88, 1])})`,
              opacity: interpolate(s, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
            }}
          >
            <TerminalNode
              name={t.name}
              harness={t.harness}
              state={t.state}
              stateLabel={t.label}
              path="~/projects/checkout"
              width={t.w}
              height={t.h}
            >
              <Terminal
                lines={[...t.lines]}
                visibleChars={Math.max(0, Math.floor((frame - t.at - 8) * 1.6))}
                showCursor
                fontSize={14}
              />
            </TerminalNode>
          </div>
        );
      })}

      {/* the proof: the engine is a flag */}
      {frame >= SPAWN && (
        <div
          style={{
            position: 'absolute',
            left: 640,
            top: 830,
            width: 640,
            borderRadius: 10,
            overflow: 'hidden',
            border: `1px solid ${c.primary}4d`,
            boxShadow: '0 10px 34px rgb(0 0 0 / 40%)',
            transform: `scale(${interpolate(spawnIn, [0, 1], [0.92, 1])})`,
            opacity: interpolate(spawnIn, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          <Terminal
            lines={spawnLines}
            visibleChars={frame < RESP ? typed : undefined}
            showCursor
            fontSize={22}
            padding={14}
          />
        </div>
      )}

      <Caption from={BAR * 3 + 12} y={940}>
        Same cockpit, same board.{' '}
        <span style={{ color: c.foreground }}>Pick the engine per session.</span>
      </Caption>
    </Stage>
  );
};
