// 0:03–0:08 — the hackathon claim, one word per beat.
//
// The line is the product's own: "Forty teams, one afternoon, nothing to
// install" (web/src/marketing/Landing.tsx). Words arrive on the beat and the
// phrase clears on the bar, so the type is doing the counting for you.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { sp } from '../lib/motion';
import { Bloom, Stage } from '../lib/Stage';

type Phrase = { bar: number; words: string[]; accent?: number; size: number };

// Sized per phrase so each one stays on a single line. At 168px "NOTHING TO
// INSTALL" is ~1790px wide against 1620px of usable width and wraps, which
// breaks the rhythm the other two set up.
const PHRASES: Phrase[] = [
  { bar: 0, words: ['FORTY', 'TEAMS'], accent: 0, size: 168 },
  { bar: 1, words: ['ONE', 'AFTERNOON'], size: 168 },
  { bar: 2, words: ['NOTHING', 'TO', 'INSTALL'], accent: 2, size: 126 },
];

const Word: React.FC<{
  text: string;
  at: number;
  frame: number;
  accent?: boolean;
}> = ({ text, at, frame, accent }) => {
  const s = sp(frame, at, 'punch');
  // comes in oversized and slams down to size — the overshoot is the impact
  const scale = interpolate(s, [0, 1], [1.35, 1]);
  const blur = interpolate(s, [0, 0.4], [18, 0], { extrapolateRight: 'clamp' });
  return (
    <span
      style={{
        display: 'inline-block',
        transform: `scale(${scale})`,
        opacity: frame < at ? 0 : interpolate(s, [0, 0.25], [0, 1], { extrapolateRight: 'clamp' }),
        filter: blur > 0.4 ? `blur(${blur}px)` : undefined,
        color: accent ? c.primary : c.foreground,
        marginRight: 28,
      }}
    >
      {text}
    </span>
  );
};

export const Slams: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Stage>
      <Bloom
        x="30%"
        y="55%"
        size={1100}
        opacity={interpolate(frame, [0, 60], [0.08, 0.18], {
          extrapolateRight: 'clamp',
        })}
        blur={140}
      />

      {/* the eyebrow the landing page uses, held for the whole section */}
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 300,
          fontFamily: font.mono,
          fontSize: 22,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: c.primary,
          opacity: interpolate(frame, [4, 20], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        For hackathons
      </div>

      {PHRASES.map((p) => {
        const start = p.bar * BAR;
        const end = start + BAR;
        if (frame < start || frame >= end) return null;
        // hard exit: the phrase is gone before the next one lands
        const out = interpolate(frame, [end - 7, end], [1, 0], {
          extrapolateLeft: 'clamp',
        });
        return (
          <AbsoluteFill
            key={p.bar}
            style={{
              justifyContent: 'center',
              paddingLeft: 150,
              paddingRight: 150,
              opacity: out,
              transform: `translateX(${interpolate(frame, [end - 7, end], [0, -40], {
                extrapolateLeft: 'clamp',
              })}px)`,
            }}
          >
            <div
              style={{
                fontSize: p.size,
                fontWeight: 700,
                letterSpacing: -5,
                lineHeight: 0.98,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {p.words.map((w, i) => (
                <Word
                  key={w}
                  text={w}
                  at={start + i * BEAT}
                  frame={frame}
                  accent={p.accent === i}
                />
              ))}
            </div>
          </AbsoluteFill>
        );
      })}
    </Stage>
  );
};
