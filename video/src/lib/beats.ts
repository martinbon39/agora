// The edit grid. Everything in the film is positioned in beats and bars, never
// in raw frames — and these numbers come out of the same file the synthesiser
// wrote, so a cut cannot land off the music.
//
//   150 BPM @ 60fps  ->  beat = 24 frames, bar = 96 frames = 1.6s

import map from '../score-map.json';

export const FPS = map.fps;
export const BPM = map.bpm;
export const BEAT = map.framesPerBeat; // 24
export const HALF = BEAT / 2; // 12
export const SIXTEENTH = BEAT / 4; // 6
export const BAR = map.framesPerBar; // 96
export const DURATION = map.durationInFrames; // 4416

/** Absolute frame of bar `b`, beat `beat` (both zero-indexed). */
export const at = (b: number, beat = 0) => Math.round(b * BAR + beat * BEAT);

/** Structural moments, in absolute frames — shared with the score. */
export const M = map.marks as Record<keyof typeof map.marks, number>;

/**
 * The film's sections. Start/end are absolute frames; `dur` is what a
 * <Sequence> wants. Keeping them in one table means the timeline is auditable
 * in one place instead of scattered across the scene files.
 */
const SECTION_BOUNDS = [
  ['coldOpen', M.coldOpen, M.build],
  ['slams', M.build, M.machineGun],
  ['machineGun', M.machineGun, M.drop],
  ['logo', M.drop, M.actTerminals],
  ['terminals', M.actTerminals, M.actCanvas],
  ['canvas', M.actCanvas, M.actMultiplayer],
  ['multiplayer', M.actMultiplayer, M.climax],
  ['climax', M.climax, M.lockup],
  ['lockup', M.lockup, M.end],
] as const;

export type SectionName = (typeof SECTION_BOUNDS)[number][0];

export const S = Object.fromEntries(
  SECTION_BOUNDS.map(([name, from, to]) => [name, { from, to, dur: to - from }]),
) as Record<SectionName, { from: number; to: number; dur: number }>;

/** Frames since the last beat — 0 on the beat, rising to BEAT-1. */
export const sinceBeat = (frame: number, div = BEAT) => frame % div;

/**
 * 1 on the beat, decaying to 0 before the next one. The film's pulse: scale
 * punches, glows and flashes all ride this so they breathe with the kick.
 */
export const pulse = (frame: number, div = BEAT, decay = 0.55) => {
  const t = sinceBeat(frame, div) / div;
  return Math.max(0, 1 - t / decay) ** 2;
};

/** Which beat index we are on, counting from `from`. */
export const beatIndex = (frame: number, from = 0, div = BEAT) =>
  Math.floor((frame - from) / div);
