# agora — announcement film

An 85-second launch film for agora, built in [Remotion](https://remotion.dev).
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
| 2–5 | 192–480 | made for hackathons, made for teams, one word per beat |
| 5–9 | 480–864 | machine gun, 34 shots ramping a beat to a quarter |
| — | 840–864 | **the hole**: picture and score both stop |
| 9–11 | 864–1056 | the drop, and the logo |
| 11–16 | 1056–1536 | close the laptop, it keeps running |
| 16–24 | 1536–2304 | **an infinite canvas you can arrange** |
| 24–28 | 2304–2688 | **Claude, Codex, Gemini, or a plain shell** |
| 28–43 | 2688–4128 | **multiplayer** (the longest act, ending on a human taking a keyboard) |
| 43–48 | 4128–4608 | climax, the whole room, then fragments |
| — | 4584–4608 | the second hole |
| 48–53 | 4608–5088 | lockup |

84.8s at 60fps. The three bolded acts are 51% of the runtime: they are what the
product actually is, and v1 gave them 40% while the machine gun spent ten
seconds on footage too fast to read.

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
