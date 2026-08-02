// Typographic furniture shared by the three feature acts, so they read as one
// system: a numbered mono kicker, a display headline, and a muted sub-line.

import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c, font } from '../brand/tokens';
import { rise, sp } from './motion';

/**
 * A title, and nothing under it. There used to be a kicker line above and a
 * caption below; Martin's note was that a main title does not need a second
 * line explaining it, and he was right — the visual underneath is the
 * explanation.
 */
export const SectionLabel: React.FC<{
  title: string;
  /** lands one beat after the first line, the way the laptop act does it */
  then?: string;
  from?: number;
  /** clear the title once the scene needs the space back */
  until?: number;
  gap?: number;
  x?: number;
  y?: number;
  size?: number;
}> = ({ title, then, from = 0, until, gap = 24, x = 120, y = 110, size = 66 }) => {
  const frame = useCurrentFrame();
  const out = until
    ? interpolate(frame, [until, until + 16], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const a = rise(frame, from + 6, 24);
  const b = rise(frame, from + 6 + gap, 24);
  const line = (text: string, t: number, dim: boolean): React.ReactNode => (
    <div
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: -1.6,
        lineHeight: 1.04,
        color: dim ? c.muted : c.foreground,
        opacity: t,
        transform: `translateY(${(1 - t) * 14}px)`,
        maxWidth: 1180,
      }}
    >
      {text}
    </div>
  );
  if (out <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: out, zIndex: 50 }}>
      {/* once the second line is up, the first steps back so the eye moves on */}
      {line(title, a, Boolean(then) && b > 0.35)}
      {then ? line(then, b, false) : null}
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
