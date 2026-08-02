// 0:03–0:08 — the hackathon claim, one word per beat.
//
// The line is the product's own: "Forty teams, one afternoon, nothing to
// install" (web/src/marketing/Landing.tsx). Words arrive on the beat and the
// phrase clears on the bar, so the type is doing the counting for you.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { reveal } from '../lib/motion';
import { Stage } from '../lib/Stage';

type Phrase = { bar: number; words: string[]; accent?: number; size: number };

// Sized per phrase so each one stays on a single line. At 168px "NOTHING TO
// INSTALL" is ~1790px wide against 1620px of usable width and wraps, which
// breaks the rhythm the other two set up.
const PHRASES: Phrase[] = [
  { bar: 0, words: ['MADE', 'FOR', 'HACKATHONS'], accent: 2, size: 130 },
  { bar: 1, words: ['MADE', 'FOR', 'TEAMS'], accent: 2, size: 168 },
  // "nothing to install" was the wrong claim for a self-hosted tool you clone
  // and run yourself. This one is both truer and the better reason to care.
  { bar: 2, words: ['OPEN', 'SOURCE'], accent: 0, size: 168 },
];

const Word: React.FC<{
  text: string;
  at: number;
  frame: number;
  accent?: boolean;
}> = ({ text, at, frame, accent }) => {
  // The word slides up from behind a mask and stops. It used to arrive at 135%
  // and spring down to size, which is a physical device applied to something
  // with no mass; this reads as authored instead of bouncy.
  const t = reveal(frame, at);
  return (
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        paddingBottom: '0.14em',
        marginBottom: '-0.14em',
        marginRight: 28,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          transform: `translateY(${(1 - t) * 110}%)`,
          color: accent ? c.primary : c.foreground,
        }}
      >
        {text}
      </span>
    </span>
  );
};

export const Slams: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Stage>
      {/* the eyebrow the landing page uses, held for the whole section */}
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 300,
          fontFamily: font.sans,
          fontSize: 27,
          fontWeight: 500,
          letterSpacing: -0.2,
          color: c.primary,
          opacity: interpolate(frame, [4, 20], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        for hackathons, and the teams in them
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
