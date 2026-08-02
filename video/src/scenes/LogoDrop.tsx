// 0:17.6–0:20.8 — the drop.
//
// Everything before this was pressure. The mark lands on frame 0 of this scene,
// which is the same frame the impact hits in the score and the same frame the
// bass comes back.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { BEAT } from '../lib/beats';
import { sp } from '../lib/motion';
import { Bloom, Stage } from '../lib/Stage';
import { Logo } from '../brand/Logo';

// measured width of "agora" at 168px / weight 600 / -8 tracking, plus the gap
const WORDMARK_W = 420 + 34;

export const LogoDrop: React.FC = () => {
  const frame = useCurrentFrame();

  const land = sp(frame, 0, 'punch');
  const scale = interpolate(land, [0, 1], [1.55, 1]);
  const blur = interpolate(land, [0, 0.35], [26, 0], { extrapolateRight: 'clamp' });

  // a shockwave ring leaving the mark on the hit
  const ring = interpolate(frame, [0, 34], [0.2, 3.2], { extrapolateRight: 'clamp' });
  const ringOpacity = interpolate(frame, [0, 34], [0.7, 0], { extrapolateRight: 'clamp' });

  const word = sp(frame, BEAT, 'snappy');
  const tag = sp(frame, BEAT * 2, 'snappy');

  return (
    <Stage background="#0e0e0e">
      {/* A neutral light bloom behind the mark. This used to be the accent
          blue, which read as a coloured wash over the whole hit rather than as
          the logo arriving. */}
      <Bloom
        size={760}
        color="#ffffff"
        opacity={interpolate(frame, [0, 16, 192], [0.13, 0.06, 0.04])}
        blur={150}
      />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {/* The mark has to land dead centre on the impact frame. If the
            wordmark reserved its space from the start, the mark would sit
            off to the left through the whole hit — so the group only slides
            over as "agora" actually writes in. */}
        <div
          style={{
            position: 'relative',
            transform: `scale(${scale}) translateX(${-WORDMARK_W / 2 * word}px)`,
            filter: blur > 0.4 ? `blur(${blur}px)` : undefined,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: -30,
              borderRadius: '50%',
              border: `2px solid ${c.primary}`,
              transform: `scale(${ring})`,
              opacity: ringOpacity,
            }}
          />
          <Logo size={210} color={c.foreground} />
          <div
            style={{
              position: 'absolute',
              left: 210 + 34,
              top: '50%',
              fontSize: 168,
              fontWeight: 600,
              letterSpacing: -8,
              lineHeight: 1,
              marginTop: -84,
              opacity: word,
              transform: `translateX(${(1 - word) * -40}px)`,
            }}
          >
            agora
          </div>
        </div>

        <div
          style={{
            marginTop: 42,
            fontFamily: font.sans,
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: -0.5,
            color: c.muted,
            opacity: tag,
            transform: `translateY(${(1 - tag) * 16}px)`,
          }}
        >
          A control room for the agents doing the work
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
