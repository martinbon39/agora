// Resolve the app's oklch()/color-mix() design tokens down to plain sRGB hex,
// so the film can use the exact same colours without a CSS engine.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (u) =>
    u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(clamp01(u), 1 / 2.4) - 0.055;

  return [gamma(lr), gamma(lg), gamma(lb)].map((v) => clamp01(v));
}

// color-mix(in srgb, <color> P%, white|black) — gamma-space mix, as browsers do for srgb.
function mixSrgb(rgb, pct, withRgb) {
  const t = pct / 100;
  return rgb.map((v, i) => v * t + withRgb[i] * (1 - t));
}

const hex = (rgb) =>
  '#' +
  rgb
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('');

const WHITE = [1, 1, 1];

const tokens = {
  background: mixSrgb(oklchToRgb(0.145, 0, 0), 95, WHITE),
  foreground: oklchToRgb(0.922, 0, 0),
  primary: oklchToRgb(0.588, 0.217, 264),
  mutedForeground: mixSrgb(oklchToRgb(0.553, 0.012, 58), 90, WHITE),
  destructive: mixSrgb(oklchToRgb(0.637, 0.237, 25.3), 90, WHITE),
  success: oklchToRgb(0.696, 0.17, 162.5),
  warning: oklchToRgb(0.769, 0.188, 70.1),
  sidebar: mixSrgb(oklchToRgb(0.145, 0, 0), 97, WHITE),
};

for (const [k, v] of Object.entries(tokens)) {
  console.log(k.padEnd(18), hex(v));
}

// card = color-mix(in srgb, var(--background) 98%, white)
console.log('card'.padEnd(18), hex(mixSrgb(tokens.background, 98, WHITE)));
console.log('popover'.padEnd(18), hex(mixSrgb(tokens.background, 97, WHITE)));
