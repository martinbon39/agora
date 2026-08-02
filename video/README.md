# agora — announcement film

An 80-second launch film for agora, built in [Remotion](https://remotion.dev).
1920×1080, 60fps, with an original score.

```sh
npm install
npm run setup     # synthesise the score, then inline the fonts (both generated)
npm run check     # verify the score against the edit grid
npm run dev       # Remotion Studio
npm run render    # out/agora-announce.mp4
```

## The one idea worth knowing

**The music and the edit share a single source of truth.**

`scripts/make-score.mjs` synthesises the track from nothing — kick, sub bass,
clap, hats, arp, pad, risers, impacts, a small reverb — at 150 BPM. It writes
two files:

- `public/score.wav`, the audio
- `src/score-map.json`, the grid it was written on

`src/lib/beats.ts` reads that JSON. Every cut, every scale punch and every
caption in the film is positioned in beats and bars from those numbers, never in
raw frames. At 150 BPM and 60fps a beat is exactly 24 frames and a bar is 96, so
nothing drifts over the runtime.

That is also why there is no licensed track: a bought loop would have an unknown
tempo and an unknown first downbeat, and the edit would have to be nudged by
hand against it. Here the drop is at frame 1056 because bar 11 is at frame 1056.

`scripts/check-score.mjs` proves it rather than assuming it. It recovers the
tempo and downbeat phase back out of the rendered PCM by autocorrelating the
onset flux, and fails if they disagree with `score-map.json`:

```
PASS  tempo recovered from the audio matches the edit grid  measured 150.00 BPM
PASS  the downbeat is aligned to frame 0 of the grid        0 frame(s) offset
PASS  the beat dominates the off-beat                       15.43x
PASS  silence1 is a real hard stop                          13.4 dB below
```

## Structure

| Bars | Frames | Section |
|---|---|---|
| 0–2 | 0–192 | cold open, one prompt and nine keystrokes |
| 2–5 | 192–480 | made for hackathons, made for teams, open source |
| 5–9 | 480–864 | machine gun, 34 shots ramping a beat to a quarter |
| — | 840–864 | **the hole**: picture and score both stop |
| 9–11 | 864–1056 | the drop, and the logo |
| 11–15 | 1056–1440 | a laptop closes in 3D and the session carries on without it |
| 15–22 | 1440–2112 | **an infinite canvas you can arrange** |
| 22–26 | 2112–2496 | **Claude, Codex, Gemini, or a plain shell**, each drawing its own TUI |
| 26–31 | 2496–2976 | **agents that talk to each other** (no humans on screen) |
| 31–40 | 2976–3840 | **invite anyone**: cursors, acting on the canvas, taking a keyboard |
| 40–45 | 3840–4320 | climax, the whole room, holding tempo rather than accelerating |
| — | 4296–4320 | the second hole |
| 45–50 | 4320–4800 | lockup |

80s at 60fps. The four bolded acts are half the runtime: they are what the
product actually is. Agent-to-agent coordination and human multiplayer are
deliberately separate acts with a title card each — run together, they read as
one blurry feature.

Each act gets a title and nothing else. There is no kicker above it and at most
one caption below, at the beat where the act turns: a cursor landing inside
someone else's terminal, and that terminal printing "martin joined this
session", does not need a caption explaining what you are looking at.

## Where the look comes from

Nothing here is an approximation of the product's design — the values are the
product's own:

- `src/brand/tokens.ts` — the app's oklch/color-mix CSS tokens resolved to sRGB
  by `scripts/oklch.mjs`, plus the xterm.js theme copied verbatim from
  `web/src/terminal/TerminalView.tsx`.
- `src/brand/Logo.tsx` — the path out of `web/src/logo-source.svg`.
- `public/fonts/` — DM Sans and JetBrains Mono, the same files the app ships.
- `src/ui/` — the canvas components (terminal node, board, sticky, presence
  cursor, harness avatar) rebuilt as pure presentational React, with the app's
  measurements: 14px node radius, 36px header, 10px status dot, the
  `0 0 0 2.5px COLOR, 0 0 22px COLOR88` glow for "someone is watching this
  terminal".
- The copy is the landing page's copy.

`src/ui/` components take no Remotion hooks and animate nothing themselves.
Every moving value is a prop, driven per frame from `src/scenes/`, so the UI can
never fall out of step with the music.

## Credits

Score, edit and scenes: achilles. UI kit (`src/ui/`): circe. Both agora
sessions, on the same checkout, coordinating over the project board — which is
also what the film is about.
