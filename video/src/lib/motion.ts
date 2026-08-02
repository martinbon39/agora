// Motion vocabulary.
//
// Two rules the whole film obeys:
//  - nothing moves linearly. Every transition is either a spring or the app's
//    own cubic-bezier, so the video moves the way the product moves.
//  - anything that reads as "impact" is a spring with low damping and high
//    stiffness, fired exactly on a beat.

import { Easing, interpolate, spring } from 'remotion';
import { EASE } from '../brand/tokens';
import { FPS } from './beats';

/** The marketing page's one curve (web/src/marketing/Landing.tsx:18). */
export const appEase = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

export const SPRINGS = {
  /** Impact. Overshoots hard, settles fast. For anything landing on a beat. */
  punch: { damping: 12, stiffness: 300, mass: 0.8 },
  /** Entrances with personality — per-word text, cards. */
  bouncy: { damping: 9, stiffness: 140, mass: 1 },
  /** UI reveals. Snappy, almost no visible bounce. */
  snappy: { damping: 20, stiffness: 200, mass: 0.5 },
  /** Camera moves and parallax. Must not oscillate. */
  glide: { damping: 200, stiffness: 90, mass: 1 },
  /** The one deliberately slow move, at the very end. */
  elegant: { damping: 15, stiffness: 50, mass: 2 },
} as const;

type SpringName = keyof typeof SPRINGS;

/** spring() with the boilerplate removed. Returns 0 before `from`. */
export const sp = (
  frame: number,
  from: number,
  which: SpringName = 'snappy',
  durationInFrames?: number,
) =>
  spring({
    frame: frame - from,
    fps: FPS,
    config: SPRINGS[which],
    durationInFrames,
  });

/** A value that springs from `a` to `b` starting at frame `from`. */
export const springTo = (
  frame: number,
  from: number,
  a: number,
  b: number,
  which: SpringName = 'snappy',
) => a + (b - a) * sp(frame, from, which);

/** Fade/slide in on the app's own easing. */
export const rise = (
  frame: number,
  from: number,
  duration = 27, // 450ms at 60fps — the app's transition duration
) =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: appEase,
  });

/** Symmetric in/out envelope, for shots that appear and leave. */
export const inOut = (
  frame: number,
  from: number,
  to: number,
  ramp = 8,
) =>
  Math.min(
    interpolate(frame, [from, from + ramp], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: appEase,
    }),
    interpolate(frame, [to - ramp, to], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: appEase,
    }),
  );

/**
 * Deterministic pseudo-random in [0,1). Seeded by an integer so every render
 * of a given frame produces the same value — Math.random() would make the
 * output non-reproducible and make frame-by-frame rendering flicker.
 */
export const rand = (seed: number) => {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  x -= Math.floor(x);
  return x;
};

/** Pick from a list deterministically. */
export const pick = <T,>(list: readonly T[], seed: number) =>
  list[Math.floor(rand(seed) * list.length) % list.length];
