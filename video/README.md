# agora — announcement film

A 73-second launch film for agora, built in [Remotion](https://remotion.dev).
1920×1080, 60fps, with an original score.

```sh
npm install
npm run setup     # synthesise the score, then inline the fonts (both generated)
npm run check     # verify the score against the edit grid
npm run dev       # Remotion Studio
npm run render    # out/agora.mp4
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
PASS  the beat dominates the off-beat                       15.67x
PASS  silence1 is a real hard stop                          10.0 dB below
```

## Structure

| Bars | Frames | Section |
|---|---|---|
| 0–2 | 0–192 | cold open — one prompt, nine keystrokes |
| 2–5 | 192–480 | the hackathon claim, one word per beat |
| 5–11 | 480–1056 | machine gun — 48 shots, density ramping to one per 16th |
| — | 1032–1056 | **the hole**: picture and score both stop |
| 11–13 | 1056–1248 | the drop, and the logo |
| 13–18 | 1248–1728 | act 1 — the terminal is real, and outlives you |
| 18–23 | 1728–2208 | act 2 — the canvas |
| 23–34 | 2208–3264 | act 3 — **multiplayer** (the longest act) |
| 34–40 | 3264–3840 | climax — the whole room, then fragments |
| — | 3816–3840 | the second hole |
| 40–46 | 3840–4416 | lockup |

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
