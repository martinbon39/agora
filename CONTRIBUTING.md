# Contributing

Thanks for looking. agora is a personal project run in the open: it is shaped
around one person's daily use, so a feature that doesn't fit that workflow may
be declined even when it's well built. Opening an issue before a large pull
request will save you time.

Bug reports and fixes are always welcome.

## Getting set up

Requires **Linux** and **Node 22+**. Sessions are real tmux sessions driven
through a pty, so macOS and Windows aren't supported for the server (the web
app builds anywhere).

```sh
sudo apt install tmux build-essential   # node-pty and better-sqlite3 compile
npm install
npm run dev:server                      # :4560
npm run dev:web                         # :5173, proxies to the server
```

State lands in `~/.agora` by default; set `AGORA_DATA_DIR` to keep a
development instance away from a real one. See `.env.example` for the full set
of variables.

## Before you open a pull request

```sh
npm run build     # typechecks both workspaces (tsc) and builds the web bundle
npm test          # the headless gates
```

Both must pass. CI runs exactly these on every pull request.

## Tests

There is no unit-test framework. Correctness is pinned by **gates** — small
scripts under `deploy/` that replay a bug that actually happened, against the
real routes:

| Gate | Pins |
| --- | --- |
| `gate-canvas.mjs` | Multiplayer canvas merge: a deleted node must not be resurrected by a stale client. |
| `gate-chat.mjs` | Chat routing: an un-mentioned owner message reaches every live agent; a waiting agent never gets stray keystrokes. |
| `gate-scope.mjs` | Guest scoping: no reaching another project, the loopback proxy, or outside the project via symlink. |
| `gate-peek.mjs` | Canvas links as permission: no link, no reading another agent's transcript; permission never chains and never crosses projects. |
| `gate-accounts.mjs` | Claude accounts: a second identity gets its own credentials while CLAUDE.md, agents, skills and transcripts stay shared; a project resolves to its own account; removing one never follows its links into the real config. |
| `gate-m1.mjs` | Session HTTP + WebSocket lifecycle. Needs a **live server** on :4560. |
| `gate-mobile-ime.mjs` | Mobile IME double-input filter. Needs **Playwright** + `npm run dev:web`. |
| `gate-paste.mjs` | Clipboard image paste in a real browser. Needs **Playwright** + `npm run dev:web`. |

The first five are hermetic — they use `fastify.inject` and a throwaway data
directory, so they need no server, no network and no browser. Those are the
ones `npm test` and CI run. The last three need a running server or a real
browser; run them by hand (`npm install -D playwright && npx playwright install
chromium` for the browser ones).

**Fixing a bug means adding a case to a gate.** Write it first and watch it
fail, then fix the code. If your change touches auth, scoping or the canvas
merge, a gate case is expected rather than optional.

## House style

- TypeScript, 2 spaces, double quotes. No formatter is enforced; match the file
  you're in.
- Comments explain *why*, not *what* — and are worth writing where a decision
  looks arbitrary (why a name is kept, why a delete wins a race). The codebase
  leans on this; please keep it up.
- Keep user-facing strings in English.
- Small, focused commits with a one-line summary in the imperative
  (`fix(canvas): …`).

## Things worth knowing

- **`agora` is agora's former name.** The tmux socket (`-L agora`), the data
  directory (`~/.agora`), the SQLite filename and the session cookie still use
  it on purpose: renaming them would orphan live sessions and log everyone out.
  Environment variables accept both `AGORA_` and `AGORA_` prefixes. New code
  should say `agora`; don't "clean up" the compatibility names.
- Sessions must survive a server restart. Anything holding state in the server
  process rather than in tmux or SQLite will break that, which is the property
  the whole design exists to protect.
- The server is one process serving the API, the WebSockets and the built SPA.
