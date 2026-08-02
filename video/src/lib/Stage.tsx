// Shared furniture: the surface every scene sits on, and the overlays that sit
// on top of the whole film. Keeping the grade in one place is what stops the
// piece looking like nine separate scenes glued together.

import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c } from '../brand/tokens';
import { Grain } from '../ui/Grain';
import { BEAT, pulse } from './beats';

/** The base surface: near-black, with the app's own grain over it. */
export const Stage: React.FC<{
  children?: React.ReactNode;
  background?: string;
  style?: React.CSSProperties;
}> = ({ children, background = c.background, style }) => (
  <AbsoluteFill style={{ background, ...style }}>{children}</AbsoluteFill>
);

/** Darkened corners. Keeps the eye centred without anyone noticing. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(120% 90% at 50% 45%, transparent 40%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

/** A bloom of the accent colour, used behind logos and hero type. */
export const Bloom: React.FC<{
  x?: string;
  y?: string;
  size?: number;
  color?: string;
  opacity?: number;
  blur?: number;
}> = ({
  x = '50%',
  y = '50%',
  size = 900,
  color = c.primary,
  opacity = 0.2,
  blur = 120,
}) => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        background: color,
        opacity,
        filter: `blur(${blur}px)`,
      }}
    />
  </AbsoluteFill>
);

/**
 * The film's heartbeat: a barely-there exposure lift on every kick. Two or
 * three percent — invisible as an effect, but it makes static shots feel like
 * they are moving with the track.
 */
export const BeatPump: React.FC<{ amount?: number; from?: number }> = ({
  amount = 0.03,
  from = 0,
}) => {
  const frame = useCurrentFrame();
  if (frame < from) return null;
  const p = pulse(frame - from, BEAT);
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: '#ffffff',
        opacity: p * amount,
        mixBlendMode: 'overlay',
      }}
    />
  );
};

/** A hard white frame. One or two frames only — this is an impact, not a fade. */
export const Flash: React.FC<{ opacity: number; color?: string }> = ({
  opacity,
  color = '#ffffff',
}) =>
  opacity <= 0 ? null : (
    <AbsoluteFill
      style={{ pointerEvents: 'none', background: color, opacity }}
    />
  );

/** Grain + vignette, applied over the finished frame. */
export const Grade: React.FC<{ vignette?: number; grain?: number }> = ({
  vignette = 0.55,
  grain = 1,
}) => (
  <>
    <Vignette strength={vignette} />
    <Grain opacity={grain} />
  </>
);
