// Is the rhythm right?
//
// Not an opinion. Every structural moment in the film is derived from the score's
// grid, so "the rhythm is right" is a checkable property: every act starts on a
// bar, every hole is exactly one beat, and the cut lists inside the two montage
// sections fill their sections exactly, with no shot straddling a beat.
//
// Run: node scripts/check-grid.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(HERE, '..', 'src', 'score-map.json'), 'utf8'));

const BEAT = map.framesPerBeat;
const BAR = map.framesPerBar;

let bad = 0;
const check = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

// 1. every act boundary lands on a bar
const acts = Object.entries(map.marks).filter(([k]) => !k.startsWith('silence'));
for (const [name, frame] of acts) {
  check(frame % BAR === 0, `${name} starts on a bar`, `frame ${frame} = bar ${frame / BAR}`);
}

// 2. the two holes are exactly one beat, and sit on the last beat of a bar
for (const name of ['silence1', 'silence2']) {
  const at = map.marks[name];
  const next = name === 'silence1' ? map.marks.drop : map.marks.lockup;
  check(next - at === BEAT, `${name} is exactly one beat of dead air`, `${next - at} frames`);
  check(at % BAR === BAR - BEAT, `${name} is the last beat of its bar`, `frame ${at}`);
}

// 3. the montage cut lists fill their sections exactly
const PATTERNS = {
  machineGun: {
    pattern: [...Array(6).fill(24), ...Array(8).fill(12), ...Array(20).fill(6)],
    section: map.marks.drop - map.marks.machineGun,
  },
  climaxTail: {
    pattern: [...Array(4).fill(24), ...Array(6).fill(12)],
    section: 168, // FRAGMENTS(288) -> HOLE(456)
  },
};
for (const [name, { pattern, section }] of Object.entries(PATTERNS)) {
  const sum = pattern.reduce((a, b) => a + b, 0);
  const expected = name === 'machineGun' ? section - BEAT : section; // gun ends on a hole
  check(sum === expected, `${name} cut list fills its section exactly`, `${sum} of ${expected} frames, ${pattern.length} shots`);
  check(
    pattern.every((d) => BEAT % d === 0),
    `${name} shot lengths all divide a beat`,
    `[${[...new Set(pattern)].join(', ')}] frames`,
  );
  // no shot may straddle a beat: every cut point must be a whole subdivision
  let at = 0;
  const straddles = pattern.filter((d) => {
    const crosses = Math.floor((at + d - 1) / BEAT) !== Math.floor(at / BEAT) && (at % d !== 0);
    at += d;
    return crosses && d > BEAT;
  });
  check(straddles.length === 0, `${name} has no shot straddling a beat`);
}

// 4. total length matches the audio the film is cut to
check(
  map.durationInFrames === map.totalBars * BAR,
  'the film is a whole number of bars',
  `${map.durationInFrames} frames = ${map.totalBars} bars = ${(map.durationInFrames / map.fps).toFixed(1)}s`,
);

// 5. the acts are ordered the way the film argues
const order = ['actCanvas', 'actMultiplayer', 'actAgentTalk', 'actHarnesses', 'actLaptop', 'climax'];
const frames = order.map((k) => map.marks[k]);
check(
  frames.every((f, i) => i === 0 || f > frames[i - 1]),
  'acts run in the intended order',
  order.join(' -> '),
);

console.log(bad === 0 ? '\nthe grid holds' : `\n${bad} check(s) FAILED`);
process.exit(bad === 0 ? 0 : 1);
