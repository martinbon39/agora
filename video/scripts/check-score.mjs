// Verify the score by measuring the PCM, not by trusting the generator.
// Checks the three things the edit depends on: the two silences are actually
// silent, the impacts actually hit on the marked frames, and energy rises
// across the acts instead of sitting flat.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const wav = readFileSync(join(HERE, '..', 'public', 'score.wav'));
const map = JSON.parse(readFileSync(join(HERE, '..', 'src', 'score-map.json'), 'utf8'));

const SR = wav.readUInt32LE(24);
const channels = wav.readUInt16LE(22);
const bits = wav.readUInt16LE(34);
const dataLen = wav.readUInt32LE(40);
const frames = dataLen / (channels * (bits / 8));

console.log(`format: ${SR}Hz ${channels}ch ${bits}bit — ${(frames / SR).toFixed(2)}s`);

const sampleAt = (i) => {
  const o = 44 + i * 4;
  return (wav.readInt16LE(o) + wav.readInt16LE(o + 2)) / 2 / 32768;
};

const f2s = (f) => Math.round((f / map.fps) * SR);

function rms(fromFrame, toFrame) {
  const a = f2s(fromFrame);
  const b = Math.min(f2s(toFrame), frames);
  let s = 0;
  for (let i = a; i < b; i++) s += sampleAt(i) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
}
function peak(fromFrame, toFrame) {
  const a = f2s(fromFrame);
  const b = Math.min(f2s(toFrame), frames);
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(sampleAt(i)));
  return p;
}
const db = (v) => (v <= 0 ? -Infinity : 20 * Math.log10(v));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
};

// 1. duration matches the composition exactly
check(
  'duration matches score-map',
  Math.abs(frames / SR - map.durationInFrames / map.fps) < 0.02,
  `wav ${(frames / SR).toFixed(3)}s vs map ${(map.durationInFrames / map.fps).toFixed(3)}s`,
);

// 2. the two dead-air holes are real hard stops. Not digital silence — a reverb
//    tail ringing into the gap is wanted — but the level has to fall off a cliff.
for (const [name, at] of [['silence1', map.marks.silence1], ['silence2', map.marks.silence2]]) {
  // measure the back half of the hole; the previous bar's tail decays into its start
  const hole = rms(at + 12, at + 23);
  const before = rms(at - 48, at - 12);
  const drop = db(before) - db(hole);
  check(
    `${name} is a real hard stop`,
    drop >= 10,
    `${drop.toFixed(1)} dB below the preceding bar (${db(before).toFixed(1)} -> ${db(hole).toFixed(1)} dBFS)`,
  );
}

// 3. the impacts land on the marked frames (peak within ±3 frames of the mark)
for (const [name, at] of [['drop', map.marks.drop], ['lockup', map.marks.lockup]]) {
  let bestFrame = -1;
  let best = 0;
  for (let f = at - 12; f < at + 12; f++) {
    const p = peak(f, f + 1);
    if (p > best) {
      best = p;
      bestFrame = f;
    }
  }
  check(
    `${name} impact lands on its mark`,
    Math.abs(bestFrame - at) <= 3,
    `peak at frame ${bestFrame}, mark ${at} (Δ${bestFrame - at}), ${db(best).toFixed(1)} dBFS`,
  );
}

// 4. the arrangement actually builds: cold open < build < machine gun < climax
const sections = [
  ['coldOpen', map.marks.coldOpen, map.marks.build],
  ['build', map.marks.build, map.marks.machineGun],
  ['machineGun', map.marks.machineGun, map.marks.silence1],
  ['acts', map.marks.actTerminals, map.marks.climax],
  ['climax', map.marks.climax, map.marks.silence2],
  ['lockup', map.marks.lockup, map.marks.end],
];
console.log('\nsection levels:');
const levels = {};
for (const [name, a, b] of sections) {
  levels[name] = rms(a, b);
  console.log(`  ${name.padEnd(12)} ${db(levels[name]).toFixed(1)} dBFS RMS`);
}
check(
  'cold open is the quietest section',
  levels.coldOpen < levels.build && levels.coldOpen < levels.machineGun,
  `${db(levels.coldOpen).toFixed(1)} < ${db(levels.build).toFixed(1)}`,
);
check(
  'energy ramps into the machine gun',
  levels.machineGun > levels.build,
  `${db(levels.machineGun).toFixed(1)} > ${db(levels.build).toFixed(1)}`,
);
check(
  'climax is the loudest sustained section',
  levels.climax >= levels.acts && levels.climax >= levels.machineGun,
  `climax ${db(levels.climax).toFixed(1)} vs acts ${db(levels.acts).toFixed(1)}`,
);
check(
  'it resolves rather than stopping dead',
  levels.lockup < levels.climax && levels.lockup > 0.002,
  `lockup ${db(levels.lockup).toFixed(1)} dBFS`,
);

// 5. Recover the tempo and the downbeat phase FROM THE AUDIO, and check they
//    match what the composition is cutting to. This is the check that actually
//    matters: if it passes, picture and sound cannot drift, whatever the
//    generator believes it wrote.
//
//    Method is the standard one — onset flux, then autocorrelation for the
//    period and phase folding for the offset. Deliberately instrument-agnostic:
//    trying to isolate "the kick" by frequency failed, because the kick sweeps
//    down from 210Hz and only enters a sub band once it has already decayed.
{
  const from = map.marks.actTerminals;
  const to = map.marks.climax; // 21 bars of steady groove
  const a = f2s(from);
  const b = f2s(to);

  // broadband envelope, fast attack / slow release
  const atk = 1 - Math.exp(-1 / (SR * 0.002));
  const rel = 1 - Math.exp(-1 / (SR * 0.05));
  let e = 0;
  const nFrames = Math.floor(((b - a) / SR) * map.fps);
  const flux = new Float64Array(nFrames);
  let prevEnv = 0;
  let cursor = 0;
  for (let i = a; i < b; i++) {
    const x = Math.abs(sampleAt(i));
    e += (x - e) * (x > e ? atk : rel);
    const f = Math.floor(((i - a) / SR) * map.fps);
    if (f !== cursor && f < nFrames) {
      flux[cursor] = Math.max(0, e - prevEnv); // positive change only = attacks
      prevEnv = e;
      cursor = f;
    }
  }
  // remove the DC component so autocorrelation measures periodicity, not level
  let mean = 0;
  for (let i = 0; i < nFrames; i++) mean += flux[i];
  mean /= nFrames;
  for (let i = 0; i < nFrames; i++) flux[i] -= mean;

  const autocorr = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < nFrames; i++) s += flux[i] * flux[i + lag];
    return s / (nFrames - lag);
  };
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = 8; lag <= 120; lag++) {
    const s = autocorr(lag);
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  // the strongest periodicity may be the 16th/8th grid; fold it up to the beat
  let beatLag = bestLag;
  while (beatLag < map.framesPerBeat - 1) beatLag *= 2;
  const measuredBpm = (60 * map.fps) / beatLag;
  check(
    'tempo recovered from the audio matches the edit grid',
    Math.abs(measuredBpm - map.bpm) < 1.5,
    `measured ${measuredBpm.toFixed(2)} BPM (lag ${bestLag} -> beat ${beatLag} frames), score says ${map.bpm}`,
  );

  // phase: fold the flux onto one beat and find which offset carries the energy
  const fold = new Float64Array(beatLag);
  for (let i = 0; i < nFrames; i++) fold[i % beatLag] += Math.max(0, flux[i]);
  let phase = 0;
  let phaseBest = -Infinity;
  for (let i = 0; i < beatLag; i++) {
    if (fold[i] > phaseBest) {
      phaseBest = fold[i];
      phase = i;
    }
  }
  const signedPhase = phase > beatLag / 2 ? phase - beatLag : phase;
  check(
    'the downbeat is aligned to frame 0 of the grid',
    Math.abs(signedPhase) <= 1,
    `strongest onset falls ${signedPhase} frame(s) from the beat`,
  );

  // and the beat should genuinely dominate the subdivisions
  const offbeat = fold[Math.round(beatLag / 2)];
  check(
    'the beat dominates the off-beat',
    phaseBest > offbeat * 1.5,
    `beat energy ${(phaseBest / offbeat).toFixed(2)}x the off-beat`,
  );
}

// 6. no digital clipping and a sane peak
const overall = peak(0, map.durationInFrames);
check('peak is below full scale', overall < 0.995, `${db(overall).toFixed(2)} dBFS`);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
