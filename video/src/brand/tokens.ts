// agora's design tokens, resolved to plain sRGB.
//
// The app writes these as oklch()/color-mix() in web/src/index.css, which needs
// a CSS engine to evaluate. `scripts/oklch.mjs` resolves them once; the values
// below are its output, so the film is the same colour as the product rather
// than an approximation of it.
//
// FROZEN — other sessions import this. Add, don't rewrite.

export const c = {
  // surfaces — near-black, never pure black (web/src/index.css:43)
  background: '#161616',
  card: '#1b1b1b',
  popover: '#1d1d1d',
  sidebar: '#111111',
  termBg: '#111111',

  // ink
  foreground: '#e5e5e5',
  muted: '#867f7a',

  // the one accent
  primary: '#366ffb',

  // status — the three states a session reports through the Claude Code hooks
  working: '#fe9a00', // amber-500
  idle: '#00bc7d', // emerald
  needsApproval: '#fb414b', // rose
  approvalRose: 'rgb(251 113 133)',
  workingAmber: 'rgb(251 191 36)',

  // borders are alpha-white hairlines, not hex
  border: 'rgb(255 255 255 / 6%)',
  input: 'rgb(255 255 255 / 8%)',

  // the violet that shows up as the terminal cursor and selection
  violet: '#a78bfa',

  // harness tint (Anthropic terracotta), from HarnessAvatar.tsx
  claude: '#D97757',
} as const;

// The xterm.js theme, copied verbatim from web/src/terminal/TerminalView.tsx:23-46.
// Terminal text in the film must use these and nothing else.
export const term = {
  background: '#101010',
  foreground: '#ded9ce',
  cursor: '#a78bfa',
  cursorAccent: '#101010',
  selectionBackground: '#a78bfa38',
  black: '#28241e',
  red: '#f26d78',
  green: '#8fd968',
  yellow: '#ffcc66',
  blue: '#73b8ff',
  magenta: '#d4a5ff',
  cyan: '#5ce6d5',
  white: '#dbd6cb',
  brightBlack: '#5c574d',
  brightRed: '#ff8a93',
  brightGreen: '#a6e685',
  brightYellow: '#ffd98c',
  brightBlue: '#94cbff',
  brightMagenta: '#e2c2ff',
  brightCyan: '#84f0e2',
  brightWhite: '#f3efe6',
} as const;

export const font = {
  sans: '"DM Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
} as const;

// The app's node chrome (web/src/index.css:279-290)
export const node = {
  radius: 14,
  border: `1px solid ${c.border}`,
  shadow: '0 10px 34px rgb(0 0 0 / 40%)',
  headerHeight: 36, // h-9
} as const;

// The fractal-noise grain the app lays over every surface at 3.5% opacity.
// Same SVG as --surface-grain in web/src/index.css:39.
export const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")";

// The marketing page's single motion curve (web/src/marketing/Landing.tsx:18).
// Everything in the film that is not beat-driven uses it, so the video moves
// the way the product moves.
export const EASE = [0.16, 1, 0.3, 1] as const;

// The Greek personas the product's own marketing uses for its example sessions.
export const AGENTS = {
  hermes: { harness: 'claude' as const, color: '#7dd3fc' },
  athena: { harness: 'codex' as const, color: '#fca5a5' },
  hypnos: { harness: 'claude' as const, color: '#c4b5fd' },
  iris: { harness: 'gemini' as const, color: '#86efac' },
  nyx: { harness: 'opencode' as const, color: '#fcd34d' },
} as const;

export type AgentName = keyof typeof AGENTS;
export type Harness = 'claude' | 'codex' | 'opencode' | 'gemini' | 'shell';
export type AgentState = 'idle' | 'working' | 'needs_approval' | 'unknown';
