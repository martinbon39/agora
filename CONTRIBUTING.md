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
npm run dev:server                      # :4570
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
| `gate-scope.mjs` | Guest scoping: no reaching another project, the loopback proxy, or outside the project via a symlink; and the gate itself is not walkable with percent-encoding. |
| `gate-invite.mjs` | A second human can actually get in: an invite hands back a sign-in link that works with no OAuth configured, lands them scoped to one project, and dies when rotated or revoked. |
| `gate-accounts.mjs` | Claude accounts: a second identity gets its own credentials while CLAUDE.md, agents, skills and transcripts stay shared; removing one never follows its links into the real config. |
| `gate-peek.mjs` | Canvas links as permission: no link, no reading another agent's transcript; permission never chains and never crosses projects. |
| `gate-paths.mjs` | Path containment: a tenant's directory root is a boundary, not a string prefix. |
| `gate-tenants.mjs` | Cross-tenant access: authority lives in the projects table, not in `role === "owner"`. |
| `gate-credentials.mjs` | A session signs in as its own tenant's Claude account, never the server's. |
| `gate-hooktokens.mjs` | The hook channel: a session is pinned to its own token and cannot act as another. |
| `gate-plan.mjs` | The shared plan: claims are exclusive, so two agents cannot silently build the same thing. |
| `gate-cost.mjs` | Cost arithmetic, against hand-computed numbers — a confidently wrong meter is worse than none. |
| `gate-rooms.mjs` | Room expiry frees compute without deleting work. |
| `gate-spectate.mjs` | The one endpoint that answers without a cookie, and everything it refuses to say. |
| `gate-reel.mjs` | The demo reel assembles from what the room already recorded. |
| `gate-socket.mjs` | The unix socket door: 0600, same app as the port, no way around the auth wall, reachable from inside a network-less sandbox, and refused outright when the path exceeds the kernel's limit. |
| `gate-ws.mjs` | The live websocket path: upgrade and auth-on-upgrade, pty round-trip, resize, flow control under a flood, presence for a second person, revocation cutting open sockets, and a black-holed connection being noticed by both ends. |
| `gate-sandbox.mjs` | `AGORA_SANDBOX=bwrap`: the harness survives the tmpfs, the home does not, and egress still works. |
| `gate-m1.mjs` | Session lifecycle against a **live server on :4570**. Predates authentication and 401s today — kept for reference, not wired in. |
| `gate-mobile-ime.mjs` | Mobile IME double-input filter. Needs **Playwright** + `npm run dev:web`. |
| `gate-paste.mjs` | Clipboard image paste in a real browser. Needs **Playwright** + `npm run dev:web`. |

`npm test` runs everything above except the last three. Most are hermetic —
`fastify.inject` against the real route modules and a throwaway data directory,
no server and no network. Four are not, and are in the suite anyway because
what they pin cannot be faked:

- `gate-socket` and `gate-ws` **spawn the real server** on a scratch port and
  data dir, and drive real tmux sessions. `gate-ws` deliberately spends ~50s
  waiting out a heartbeat, so it is the slow one.
- `gate-rooms` and `gate-sandbox` need **tmux**; `gate-sandbox` needs **bwrap**
  as well. The bwrap-only block in `gate-socket` prints `SKIP` when bwrap is
  absent rather than failing.

So the suite needs `tmux` installed, and `bwrap` for full coverage. The three
excluded gates need a running dev server or a real browser; run them by hand
(`npm install -D playwright && npx playwright install chromium` for the browser
ones).

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

- **Every name is `agora`, and there is no fallback.** The tmux socket
  (`-L agora`), the data directory (`~/.agora`), the SQLite file (`agora.db`),
  the session cookie (`agora_session`) and every environment variable
  (`AGORA_*`) agree. `server/src/config.ts` reads `process.env["AGORA_" + name]`
  and nothing else — a variable spelled any other way is silently ignored, so
  check the spelling before concluding a setting does not work.
- Sessions must survive a server restart. Anything holding state in the server
  process rather than in tmux or SQLite will break that, which is the property
  the whole design exists to protect.
- The server is one process serving the API, the WebSockets and the built SPA.
