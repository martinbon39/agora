// 1:04–1:13.6 — the lockup.
//
// The one deliberately slow shot in the film. After sixty seconds of cutting on
// the beat, holding a single frame for eight bars is what makes it feel
// finished rather than exhausting.

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { BAR, BEAT } from '../lib/beats';
import { rise, sp } from '../lib/motion';
import { Bloom, Stage } from '../lib/Stage';
import { Logo } from '../brand/Logo';

const OUT = BAR * 3.6; // start the fade with the chord still ringing

export const Lockup: React.FC = () => {
  const frame = useCurrentFrame();

  const land = sp(frame, 0, 'punch');
  const drift = sp(frame, 0, 'elegant');

  const tag = rise(frame, BEAT * 2, 26);
  const strip = rise(frame, BAR + BEAT, 26);
  const url = rise(frame, BAR * 2, 26);

  const fade = interpolate(frame, [OUT, 480], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage background="#0c0c0c">
      <Bloom size={1200} color="#ffffff" opacity={interpolate(frame, [0, 24], [0.12, 0.05])} blur={190} />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          opacity: fade,
          // a very slow continuing push, so the held frame is not a still
          transform: `scale(${1 + drift * 0.035})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 30,
            transform: `scale(${interpolate(land, [0, 1], [1.4, 1])})`,
          }}
        >
          <Logo size={168} color={c.foreground} />
          <div style={{ fontSize: 142, fontWeight: 600, letterSpacing: -7, lineHeight: 1 }}>
            agora
          </div>
        </div>

        <div
          style={{
            marginTop: 40,
            fontSize: 42,
            fontWeight: 500,
            letterSpacing: -0.8,
            color: c.foreground,
            opacity: tag,
            transform: `translateY(${(1 - tag) * 14}px)`,
          }}
        >
          A control room for the agents doing the work
        </div>

        <div
          style={{
            marginTop: 34,
            fontFamily: font.sans,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: -0.2,
            color: c.muted,
            opacity: strip,
            transform: `translateY(${(1 - strip) * 12}px)`,
          }}
        >
          self-hosted · passkey-only · bring your own key
        </div>

        <div
          style={{
            marginTop: 58,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            opacity: url,
            transform: `translateY(${(1 - url) * 12}px)`,
          }}
        >
          <div
            style={{
              fontFamily: font.sans,
              fontSize: 21,
              fontWeight: 500,
              color: c.primary,
              border: `1px solid ${c.primary}55`,
              borderRadius: 999,
              padding: '8px 18px',
            }}
          >
            Made for hackathons
          </div>
          <div style={{ fontFamily: font.sans, fontSize: 24, fontWeight: 500, color: c.foreground }}>
            github.com/martinbon39/agora
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
