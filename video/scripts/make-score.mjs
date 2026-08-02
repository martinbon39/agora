// The score for the agora film, synthesised from scratch.
//
// There is no licensed track behind this video: the music is generated here, on
// a grid the film also reads. That is the whole point — every cut in the edit is
// derived from the same BPM constant as the kick drum, so picture and sound can
// not drift apart. `score-map.json` is the contract between the two.
//
//   150 BPM · 60 fps  ->  1 beat = 24 frames, 1 bar = 96 frames = 1.6s
//
// Key: F minor. Progression i - VI - III - VII (Fm - Db - Ab - Eb), one bar each.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_WAV = join(HERE, '..', 'public', 'score.wav');
const OUT_MAP = join(HERE, '..', 'src', 'score-map.json');

// ---------------------------------------------------------------- grid

const SR = 44100;
const BPM = 150;
const FPS = 60;
const SPB = (60 / BPM) * SR; // samples per beat = 17640
const BEATS_PER_BAR = 4;
const SPBAR = SPB * BEATS_PER_BAR;
const TOTAL_BARS = 46;
const N = Math.round(SPBAR * TOTAL_BARS); // 3,245,760 samples ≈ 73.6s

const barAt = (bar, beat = 0) => Math.round(bar * SPBAR + beat * SPB);

// Named structural moments, in bars. The composition imports these.
const MARKS = {
  coldOpen: 0,
  build: 2,
  machineGun: 5,
  silence1: 10.75, // last beat of bar 10 — the hole before the drop
  drop: 11,
  actTerminals: 13,
  actCanvas: 18,
  actMultiplayer: 23,
  climax: 34,
  silence2: 39.75,
  lockup: 40,
  end: TOTAL_BARS,
};

// ---------------------------------------------------------------- buses

const buf = () => new Float64Array(N);
const drums = [buf(), buf()];
const bass = [buf(), buf()];
const music = [buf(), buf()];
const fx = [buf(), buf()];
const send = [buf(), buf()]; // reverb send

const add = (bus, i, l, r) => {
  if (i < 0 || i >= N) return;
  bus[0][i] += l;
  bus[1][i] += r;
};

// deterministic noise — no Math.random, so re-running gives a bit-identical track
let seed = 0x2f6e2b1;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed |= 0;
  return (seed / 0x7fffffff) % 1;
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- voices

function kick(at, gain = 1) {
  const len = Math.round(SR * 0.42);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // pitch envelope: a 150Hz thump collapsing to a 45Hz body in ~45ms
    const f = 45 + 165 * Math.exp(-t / 0.028);
    ph += (2 * Math.PI * f) / SR;
    const amp = Math.exp(-t / 0.115) * (1 - Math.exp(-t / 0.0012));
    // a touch of click so it cuts through on laptop speakers
    const click = i < 90 ? (rnd() * 2 - 1) * 0.35 * Math.exp(-i / 26) : 0;
    const v = (Math.sin(ph) * 0.95 + click) * amp * gain;
    add(drums, at + i, v, v);
  }
}

function clap(at, gain = 1) {
  const len = Math.round(SR * 0.34);
  // four short bursts a few ms apart read as hands, not as a noise blip
  const taps = [0, 0.011, 0.021, 0.030];
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = 0;
    for (const tap of taps) {
      const dt = t - tap;
      if (dt >= 0) env += Math.exp(-dt / (tap === 0.03 ? 0.13 : 0.009));
    }
    env = Math.min(env, 2.2) * 0.42;
    const n = rnd() * 2 - 1;
    // bandpass ≈ 1.6kHz via two cascaded one-poles, high-passed
    bp1 += (n - bp1) * 0.34;
    bp2 += (bp1 - bp2) * 0.34;
    const v = (bp1 - bp2 * 0.72) * env * gain;
    add(drums, at + i, v * 0.92, v);
    add(send, at + i, v * 0.28, v * 0.3);
  }
}

function hat(at, gain = 1, open = false) {
  const len = Math.round(SR * (open ? 0.16 : 0.045));
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / (open ? 0.055 : 0.012));
    const n = rnd() * 2 - 1;
    hp = 0.86 * (hp + n - prev); // one-pole highpass
    prev = n;
    const v = hp * env * 0.3 * gain;
    const pan = open ? 0.25 : -0.1;
    add(drums, at + i, v * (1 - pan * 0.5), v * (1 + pan * 0.5));
  }
}

function subBass(at, dur, midi, gain = 1) {
  const f = mtof(midi);
  let ph = 0;
  const len = Math.round(dur);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env =
      (1 - Math.exp(-t / 0.006)) * Math.exp(-t / (dur / SR) / 1.9);
    ph += (2 * Math.PI * f) / SR;
    // sine + a little saw grit an octave up so it survives small speakers
    const grit = ((((ph * 2) / (2 * Math.PI)) % 1) * 2 - 1) * 0.14;
    const v = (Math.sin(ph) + grit) * env * 0.5 * gain;
    add(bass, at + i, v, v);
  }
}

// detuned saw stack through a resonant-ish lowpass envelope
function stab(at, dur, midis, gain = 1, cutoffStart = 2600, cutoffEnd = 700) {
  const len = Math.round(dur);
  const voices = [];
  for (const m of midis) {
    for (const det of [-0.11, 0, 0.13]) {
      voices.push({ f: mtof(m + det), ph: rnd() });
    }
  }
  let lp = [0, 0];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const p = i / len;
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / (dur / SR) / 1.5);
    let s = 0;
    for (const v of voices) {
      v.ph += v.f / SR;
      if (v.ph > 1) v.ph -= 1;
      s += v.ph * 2 - 1;
    }
    s /= voices.length;
    const cut = cutoffStart + (cutoffEnd - cutoffStart) * p;
    const a = clamp((2 * Math.PI * cut) / SR, 0, 0.99);
    lp[0] += (s - lp[0]) * a;
    lp[1] += (lp[0] - lp[1]) * a;
    const v = lp[1] * env * 0.5 * gain;
    add(music, at + i, v * 0.94, v);
    add(send, at + i, v * 0.34, v * 0.36);
  }
}

function pad(at, dur, midis, gain = 1) {
  const len = Math.round(dur);
  const voices = [];
  for (const m of midis) {
    for (const det of [-0.14, 0.09]) {
      voices.push({ f: mtof(m + det), ph: rnd(), pan: det > 0 ? 0.5 : -0.5 });
    }
  }
  const lp = [0, 0];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const rel = (dur / SR) - t;
    const env =
      clamp(t / 0.9, 0, 1) * clamp(rel / 1.4, 0, 1) * 0.5;
    let l = 0;
    let r = 0;
    for (const v of voices) {
      v.ph += v.f / SR;
      if (v.ph > 1) v.ph -= 1;
      const s = v.ph * 2 - 1;
      l += s * (1 - v.pan * 0.6);
      r += s * (1 + v.pan * 0.6);
    }
    l /= voices.length;
    r /= voices.length;
    const a = (2 * Math.PI * 900) / SR;
    lp[0] += (l - lp[0]) * a;
    lp[1] += (r - lp[1]) * a;
    add(music, at + i, lp[0] * env * gain, lp[1] * env * gain);
    add(send, at + i, lp[0] * env * gain * 0.5, lp[1] * env * gain * 0.5);
  }
}

// noise sweeping up through a bandpass + a rising sine — the tension before a hit
function riser(at, dur, gain = 1) {
  const len = Math.round(dur);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.pow(p, 1.7) * gain;
    const n = rnd() * 2 - 1;
    const a = clamp((2 * Math.PI * (400 + 7000 * p * p)) / SR, 0, 0.99);
    lp += (n - lp) * a;
    hp = 0.92 * (hp + lp - prev);
    prev = lp;
    const f = 220 * Math.pow(2, p * 2.6);
    ph += (2 * Math.PI * f) / SR;
    const wob = 1 + 0.04 * Math.sin((2 * Math.PI * 9 * i) / SR);
    const v = (hp * 0.5 + Math.sin(ph) * 0.16 * p) * env * wob * 0.7;
    add(fx, at + i, v * (1 - p * 0.3), v * (1 + p * 0.3));
    add(send, at + i, v * 0.25, v * 0.28);
  }
}

// the drop hit: sub boom + noise crack + a long tail into the reverb
function impact(at, gain = 1) {
  const len = Math.round(SR * 2.4);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 38 + 120 * Math.exp(-t / 0.05);
    ph += (2 * Math.PI * f) / SR;
    const boom = Math.sin(ph) * Math.exp(-t / 0.9);
    const n = rnd() * 2 - 1;
    lp += (n - lp) * 0.22;
    const crack = lp * Math.exp(-t / 0.16) * 0.7;
    const v = (boom * 1.05 + crack) * gain * 0.8;
    add(fx, at + i, v, v * 0.97);
    add(send, at + i, v * 0.3, v * 0.32);
  }
}

// reversed swell — pulls the ear toward the moment it lands on
function reverseSwell(at, dur, gain = 1) {
  const len = Math.round(dur);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const n = rnd() * 2 - 1;
    lp += (n - lp) * clamp(0.05 + 0.5 * p, 0, 0.99);
    const v = lp * Math.pow(p, 2.4) * gain * 0.55;
    add(fx, at + i, v * 0.9, v);
    add(send, at + i, v * 0.4, v * 0.4);
  }
}

// short UI ping — the sound a slammed word makes
function blip(at, midi, gain = 1, dur = 0.09) {
  const len = Math.round(SR * dur);
  const f = mtof(midi);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t / (dur / 4)) * (1 - Math.exp(-t / 0.0008));
    const v = (Math.sin(ph) * 0.7 + Math.sin(ph * 2.01) * 0.3) * env * gain * 0.3;
    add(fx, at + i, v, v * 0.95);
    add(send, at + i, v * 0.35, v * 0.35);
  }
}

// a typed keystroke, for the cold open
function keyTick(at, gain = 1) {
  const len = Math.round(SR * 0.035);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const n = rnd() * 2 - 1;
    hp = 0.7 * (hp + n - prev);
    prev = n;
    const v = hp * Math.exp(-t / 0.006) * 0.22 * gain;
    add(fx, at + i, v, v * 0.9);
  }
}

function droneSub(at, dur, midi, gain = 1) {
  const len = Math.round(dur);
  const f = mtof(midi);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const rel = dur / SR - t;
    const env = clamp(t / 1.2, 0, 1) * clamp(rel / 0.8, 0, 1);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * env * gain * 0.32;
    add(bass, at + i, v, v);
  }
}

// ---------------------------------------------------------------- arrangement

// i - VI - III - VII in F minor, one chord per bar
const CHORDS = [
  { root: 41, tones: [65, 68, 72] }, // Fm
  { root: 37, tones: [61, 65, 68] }, // Db
  { root: 44, tones: [56, 60, 63] }, // Ab
  { root: 39, tones: [63, 67, 70] }, // Eb
];
const chordAt = (bar) => CHORDS[bar % 4];

const inRange = (bar, a, b) => bar >= a && bar < b;

for (let bar = 0; bar < TOTAL_BARS; bar++) {
  const ch = chordAt(bar);
  const b0 = barAt(bar);

  const isColdOpen = inRange(bar, MARKS.coldOpen, MARKS.build);
  const isBuild = inRange(bar, MARKS.build, MARKS.machineGun);
  const isGun = inRange(bar, MARKS.machineGun, MARKS.drop);
  const isDrop = inRange(bar, MARKS.drop, MARKS.actTerminals);
  const isBody = inRange(bar, MARKS.actTerminals, MARKS.climax);
  const isClimax = inRange(bar, MARKS.climax, MARKS.lockup);
  const isLockup = bar >= MARKS.lockup;

  // --- cold open: a sub drone and a few keystrokes, nothing else
  if (isColdOpen) {
    if (bar === 0) droneSub(b0, SPBAR * 2.2, 29, 1.0); // F1
    if (bar === 1) {
      // keystrokes land on 16ths — the terminal is typing in time
      for (let k = 0; k < 9; k++) keyTick(b0 + Math.round(k * SPB * 0.25), 1);
      reverseSwell(b0 + Math.round(SPB * 2), SPB * 2, 0.55);
    }
    continue;
  }

  // --- build: kick arrives, hats offbeat, bass on 8ths
  if (isBuild) {
    const g = 0.55 + 0.2 * (bar - MARKS.build);
    for (let b = 0; b < 4; b++) {
      kick(b0 + Math.round(b * SPB), g);
      hat(b0 + Math.round((b + 0.5) * SPB), 0.5 + 0.15 * (bar - MARKS.build));
      subBass(b0 + Math.round(b * SPB), SPB * 0.85, ch.root, 0.7);
      subBass(b0 + Math.round((b + 0.5) * SPB), SPB * 0.4, ch.root + 12, 0.35);
    }
    if (bar >= MARKS.build + 1) clap(b0 + Math.round(SPB), 0.5);
    if (bar >= MARKS.build + 1) clap(b0 + Math.round(3 * SPB), 0.5);
    if (bar === MARKS.machineGun - 1) riser(b0 + Math.round(2 * SPB), SPB * 2, 0.5);
    continue;
  }

  // --- machine gun: the full groove, ramping, with the hole punched at the end
  if (isGun) {
    const silenceFrom = barAt(10, 3); // last beat of bar 10 is dead air
    const gate = (t) => t < silenceFrom;

    for (let b = 0; b < 4; b++) {
      const t = b0 + Math.round(b * SPB);
      if (!gate(t)) continue;
      kick(t, 0.95);
      subBass(t, SPB * 0.9, ch.root, 0.95);
      if (b === 1 || b === 3) clap(t, 0.85);
      for (let s = 0; s < 4; s++) {
        const ts = b0 + Math.round((b + s * 0.25) * SPB);
        if (!gate(ts)) continue;
        if (s === 2) hat(ts, 0.75, true);
        else hat(ts, 0.5 + (s === 0 ? 0.25 : 0));
      }
    }
    // arpeggio in 16ths from bar 7
    if (bar >= MARKS.machineGun + 2) {
      for (let s = 0; s < 16; s++) {
        const ts = b0 + Math.round(s * SPB * 0.25);
        if (!gate(ts)) continue;
        const m = ch.tones[s % 3] + (s % 6 >= 3 ? 12 : 0);
        stab(ts, SPB * 0.24, [m], 0.32, 3200, 1400);
      }
    }
    // the riser has to STOP at the hole, not sail through it — otherwise the
    // hard stop before the drop never happens and the impact lands on a wall
    if (bar === 9) riser(b0, barAt(10, 3) - b0, 0.62);
    if (bar === 10) {
      // the hole: everything stops, one quiet reversed swell points at the drop
      reverseSwell(barAt(10, 3) - Math.round(SPB * 0.15), SPB * 1.15, 0.3);
    }
    continue;
  }

  // --- the drop
  if (isDrop) {
    if (bar === MARKS.drop) impact(b0, 1.0);
    for (let b = 0; b < 4; b++) {
      const t = b0 + Math.round(b * SPB);
      kick(t, 1.0);
      subBass(t, SPB * 0.92, ch.root, 1.0);
      if (b === 1 || b === 3) clap(t, 0.9);
      for (let s = 0; s < 4; s++) {
        hat(b0 + Math.round((b + s * 0.25) * SPB), s === 2 ? 0.7 : 0.45, s === 2);
      }
    }
    stab(b0, SPB * 2.6, ch.tones, 0.85, 4200, 900);
    pad(b0, SPBAR, ch.tones.map((t) => t - 12), 0.5);
    continue;
  }

  // --- body: the three feature acts
  if (isBody) {
    const intensity = inRange(bar, MARKS.actMultiplayer, MARKS.climax) ? 1 : 0.85;
    for (let b = 0; b < 4; b++) {
      const t = b0 + Math.round(b * SPB);
      kick(t, 0.95);
      subBass(t, SPB * 0.9, ch.root, 0.92 * intensity);
      if (b === 1 || b === 3) clap(t, 0.8 * intensity);
      for (let s = 0; s < 4; s++) {
        const ts = b0 + Math.round((b + s * 0.25) * SPB);
        hat(ts, s === 2 ? 0.6 : 0.4, s === 2);
      }
    }
    // offbeat bass push on the multiplayer act — more forward motion
    if (intensity === 1) {
      for (let b = 0; b < 4; b++) {
        subBass(b0 + Math.round((b + 0.75) * SPB), SPB * 0.22, ch.root + 12, 0.4);
      }
    }
    pad(b0, SPBAR, ch.tones.map((t) => t - 12), 0.42);
    // arp every other bar in the first acts, every bar once multiplayer lands
    if (intensity === 1 || bar % 2 === 0) {
      for (let s = 0; s < 16; s++) {
        const m = ch.tones[s % 3] + (s % 8 >= 4 ? 12 : 0);
        stab(b0 + Math.round(s * SPB * 0.25), SPB * 0.22, [m], 0.3 * intensity, 3000, 1200);
      }
    }
    if (bar % 8 === 7) stab(b0 + Math.round(SPB * 3.5), SPB * 0.5, ch.tones, 0.5, 5000, 1500);
    if (bar === MARKS.climax - 2) riser(b0, SPBAR * 2, 0.7);
    continue;
  }

  // --- climax: double-time, everything on
  if (isClimax) {
    const silenceFrom = barAt(39, 3);
    const gate = (t) => t < silenceFrom;
    for (let b = 0; b < 4; b++) {
      const t = b0 + Math.round(b * SPB);
      if (!gate(t)) continue;
      kick(t, 1.0);
      kick(t + Math.round(SPB * 0.5), 0.45);
      subBass(t, SPB * 0.45, ch.root, 1.0);
      subBass(t + Math.round(SPB * 0.5), SPB * 0.4, ch.root, 0.8);
      if (b === 1 || b === 3) clap(t, 0.92);
      for (let s = 0; s < 8; s++) {
        const ts = b0 + Math.round((b + s * 0.125) * SPB);
        if (!gate(ts)) continue;
        hat(ts, s % 4 === 2 ? 0.62 : 0.32, s % 4 === 2);
      }
    }
    for (let s = 0; s < 16; s++) {
      const ts = b0 + Math.round(s * SPB * 0.25);
      if (!gate(ts)) continue;
      const m = ch.tones[s % 3] + (s % 4 >= 2 ? 12 : 0);
      stab(ts, SPB * 0.22, [m], 0.38, 4000, 1600);
    }
    pad(b0, SPBAR, ch.tones.map((t) => t - 12), 0.45);
    if (bar === MARKS.lockup - 2) riser(b0, barAt(39, 3) - b0, 0.8);
    if (bar === MARKS.lockup - 1) {
      reverseSwell(barAt(39, 3) - Math.round(SPB * 0.15), SPB * 1.15, 0.32);
    }
    continue;
  }

  // --- lockup: one last hit, then let the chord ring out
  if (isLockup) {
    if (bar === MARKS.lockup) {
      impact(b0, 1.05);
      pad(b0, SPBAR * 5.4, [41, 48, 53, 56, 60], 0.75); // Fm spread, wide
    }
    const since = bar - MARKS.lockup;
    if (since < 4) {
      kick(b0, 0.85 - since * 0.15);
      if (since < 3) {
        subBass(b0, SPB * 1.8, 41, 0.7 - since * 0.15);
        hat(b0 + Math.round(SPB * 2), 0.3);
      }
      if (since === 0) stab(b0, SPB * 3, [65, 68, 72], 0.6, 5200, 800);
    }
    continue;
  }
}

// ---------------------------------------------------------------- mix

// sidechain: duck the sustained material under every kick so the low end breathes
const duck = new Float64Array(N).fill(1);
{
  const kicks = [];
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    if (bar < MARKS.build) continue;
    for (let b = 0; b < 4; b++) kicks.push(barAt(bar, b));
  }
  const dlen = Math.round(SR * 0.3);
  for (const k of kicks) {
    for (let i = 0; i < dlen && k + i < N; i++) {
      const p = i / dlen;
      const v = 0.3 + 0.7 * Math.pow(p, 0.55);
      if (v < duck[k + i]) duck[k + i] = v;
    }
  }
}

// reverb: 4 combs + 2 allpasses per channel. Cheap, and it sounds like a room.
function reverb(input) {
  const combs = [1687, 1601, 2053, 2251];
  const feed = [0.79, 0.78, 0.77, 0.76];
  const aps = [556, 441];
  const out = new Float64Array(N);
  for (let c = 0; c < combs.length; c++) {
    const d = combs[c];
    const line = new Float64Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const y = line[idx];
      lp += (y - lp) * 0.42; // damping
      line[idx] = input[i] + lp * feed[c];
      idx = idx + 1 === d ? 0 : idx + 1;
      out[i] += y * 0.25;
    }
  }
  for (const d of aps) {
    const line = new Float64Array(d);
    let idx = 0;
    for (let i = 0; i < N; i++) {
      const y = line[idx];
      const v = out[i] + y * 0.5;
      line[idx] = v;
      out[i] = y - v * 0.5;
      idx = idx + 1 === d ? 0 : idx + 1;
    }
  }
  return out;
}

const wetL = reverb(send[0]);
const wetR = reverb(send[1]);

const outL = new Float64Array(N);
const outR = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const d = duck[i];
  outL[i] =
    drums[0][i] * 1.0 +
    bass[0][i] * d * 1.05 +
    music[0][i] * (0.35 + 0.65 * d) * 0.95 +
    fx[0][i] * 0.95 +
    wetL[i] * 0.3 * (0.4 + 0.6 * d);
  outR[i] =
    drums[1][i] * 1.0 +
    bass[1][i] * d * 1.05 +
    music[1][i] * (0.35 + 0.65 * d) * 0.95 +
    fx[1][i] * 0.95 +
    wetR[i] * 0.3 * (0.4 + 0.6 * d);
}

// gentle master: soft clip, then normalise to -1 dBFS
let peak = 0;
for (let i = 0; i < N; i++) {
  outL[i] = Math.tanh(outL[i] * 0.85);
  outR[i] = Math.tanh(outR[i] * 0.85);
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
}
const norm = (Math.pow(10, -1 / 20) / peak) || 1;

// 25ms fade in, 1.2s fade out so nothing clicks at the edges
const fadeIn = Math.round(SR * 0.025);
const fadeOut = Math.round(SR * 1.2);
for (let i = 0; i < N; i++) {
  let g = norm;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= (N - i) / fadeOut;
  outL[i] *= g;
  outR[i] *= g;
}

// ---------------------------------------------------------------- write

const bytes = Buffer.alloc(44 + N * 4);
bytes.write('RIFF', 0);
bytes.writeUInt32LE(36 + N * 4, 4);
bytes.write('WAVE', 8);
bytes.write('fmt ', 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20); // PCM
bytes.writeUInt16LE(2, 22); // stereo
bytes.writeUInt32LE(SR, 24);
bytes.writeUInt32LE(SR * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  bytes.writeInt16LE(Math.round(clamp(outL[i], -1, 1) * 32767), 44 + i * 4);
  bytes.writeInt16LE(Math.round(clamp(outR[i], -1, 1) * 32767), 46 + i * 4);
}
writeFileSync(OUT_WAV, bytes);

const FPB = (FPS * 60) / BPM; // frames per beat = 24
const map = {
  bpm: BPM,
  fps: FPS,
  framesPerBeat: FPB,
  framesPerBar: FPB * BEATS_PER_BAR,
  totalBars: TOTAL_BARS,
  durationInFrames: Math.round(FPB * BEATS_PER_BAR * TOTAL_BARS),
  marks: Object.fromEntries(
    Object.entries(MARKS).map(([k, bar]) => [k, Math.round(bar * FPB * BEATS_PER_BAR)]),
  ),
  markBars: MARKS,
};
writeFileSync(OUT_MAP, JSON.stringify(map, null, 2) + '\n');

console.log(
  `score.wav  ${(bytes.length / 1e6).toFixed(1)} MB  ${(N / SR).toFixed(2)}s  ` +
    `${TOTAL_BARS} bars @ ${BPM} BPM  peak-normalised to -1 dBFS`,
);
console.log(`score-map.json  ${map.durationInFrames} frames @ ${FPS}fps`);
console.table(map.marks);
