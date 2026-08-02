// Typographic furniture shared by the three feature acts, so they read as one
// system: a numbered mono kicker, a display headline, and a muted sub-line.

import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { rise, sp } from './motion';

export const SectionLabel: React.FC<{
  index: string;
  title: string;
  from?: number;
  x?: number;
  y?: number;
}> = ({ index, title, from = 0, x = 120, y = 110 }) => {
  const frame = useCurrentFrame();
  const a = rise(frame, from, 20);
  const b = rise(frame, from + 6, 24);
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 19,
          letterSpacing: 5,
          textTransform: 'uppercase',
          color: c.primary,
          opacity: a,
          transform: `translateY(${(1 - a) * 10}px)`,
        }}
      >
        {index}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 62,
          fontWeight: 700,
          letterSpacing: -1.6,
          lineHeight: 1.02,
          color: c.foreground,
          opacity: b,
          transform: `translateY(${(1 - b) * 14}px)`,
          maxWidth: 1000,
        }}
      >
        {title}
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
  const a = rise(frame, from, 22);
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

/** A word that punches in on a beat, for emphasis inside a caption. */
export const Punch: React.FC<{ children: React.ReactNode; at: number; color?: string }> = ({
  children,
  at,
  color = c.foreground,
}) => {
  const frame = useCurrentFrame();
  const s = sp(frame, at, 'punch');
  if (frame < at) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        color,
        fontWeight: 600,
        transform: `scale(${interpolate(s, [0, 1], [1.25, 1])})`,
      }}
    >
      {children}
    </span>
  );
};
