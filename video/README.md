# agora — announcement film

A 77-second launch film for agora, built in [Remotion](https://remotion.dev).
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
| 0–2 | 0–192 | cold open: someone types "how do i win this hackathon" |
| 2–5 | 192–480 | made for hackathons, made for teams, open source |
| 5–9 | 480–864 | machine gun, seven distinct shots strided so none repeats |
| — | 840–864 | **the hole**: picture and score both stop |
| 9–11 | 864–1056 | the drop, and the logo |
| 11–15 | 1056–1440 | a laptop closes in 3D and the session carries on without it |
| 15–20 | 1440–1920 | **an infinite canvas you can arrange** |
| 20–24 | 1920–2304 | **Claude, Codex, Gemini or a plain shell**, each drawing its own TUI |
| 24–29 | 2304–2784 | **agents that talk to each other** (no humans on screen) |
| 29–38 | 2784–3648 | **invite anyone**: a button, three cursors at once, taking a keyboard |
| 38–43 | 3648–4128 | climax, holding tempo rather than accelerating |
| — | 4104–4128 | the second hole |
| 43–48 | 4128–4608 | lockup |

76.8s at 60fps. Four bolded acts, half the runtime.

Every terminal renders the real interface of whichever harness is running in it
(`src/lib/Session.tsx` picks by harness), so a Codex session is visibly Codex
wherever it appears. Sessions are written as TUI events in `src/content.ts`.

Type does not spring. Headlines slide up from behind a mask on expo-out
(`cubic-bezier(0.19, 1, 0.22, 1)`), 16 frames, 4 frames of stagger per word,
nothing scales, and the reveal finishes ON the beat rather than starting there.
A spring models a physical system you can interrupt; a word in a cut film is
neither physical nor interruptible.

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
