// Typographic furniture shared by the three feature acts, so they read as one
// system: a numbered mono kicker, a display headline, and a muted sub-line.

import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { rise, reveal } from './motion';
import { RevealWords } from './Reveal';

/**
 * A title, and nothing under it. There used to be a kicker line above and a
 * caption below; Martin's note was that a main title does not need a second
 * line explaining it, and he was right — the visual underneath is the
 * explanation.
 */
export const SectionLabel: React.FC<{
  title: string;
  from?: number;
  x?: number;
  y?: number;
  size?: number;
}> = ({ title, from = 0, x = 120, y = 110, size = 66 }) => {
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      <div
        style={{
          fontSize: size,
          fontWeight: 700,
          letterSpacing: -1.6,
          lineHeight: 1.02,
          color: c.foreground,
          maxWidth: 1180,
        }}
      >
        <RevealWords at={from + 18}>{title}</RevealWords>
      </div>
    </div>
  );
};

/** A line of supporting copy. Rises on the app's curve, never fades in flat. */
export const Caption: React.FC<{
  children: React.ReactNode;
  from: number;
  until?: number;
  x?: number;
  y?: number;
  size?: number;
  mono?: boolean;
  color?: string;
  width?: number;
  align?: 'left' | 'center';
}> = ({
  children,
  from,
  until,
  x = 120,
  y = 880,
  size = 30,
  mono = false,
  color = c.muted,
  width = 820,
  align = 'left',
}) => {
  const frame = useCurrentFrame();
  const a = reveal(frame, from + 20, 20);
  const out = until
    ? interpolate(frame, [until - 10, until], [1, 0], { extrapolateLeft: 'clamp' })
    : 1;
  if (a <= 0 || out <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        maxWidth: width,
        fontFamily: mono ? font.mono : font.sans,
        fontSize: size,
        lineHeight: 1.35,
        letterSpacing: mono ? 0.5 : -0.2,
        color,
        opacity: a * out,
        transform: `translateY(${(1 - a) * 12}px)`,
        textAlign: align,
      }}
    >
      {children}
    </div>
  );
};

/** A word revealed on a beat, for emphasis inside a caption. */
export const Punch: React.FC<{ children: string; at: number; color?: string }> = ({
  children,
  at,
  color = c.foreground,
}) => (
  <RevealWords at={at} style={{ color, fontWeight: 600 }}>
    {children}
  </RevealWords>
);
