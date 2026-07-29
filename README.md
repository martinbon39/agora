<div align="center">

# argos

**A self-hosted cockpit for Claude Code and other CLI coding agents.**

Your agents run on your server, in real tmux sessions. argos gives you a
browser window onto them — from your desk, or from your phone on a train.

[![CI](https://github.com/martinbon39/argos/actions/workflows/ci.yml/badge.svg)](https://github.com/martinbon39/argos/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![Platform](https://img.shields.io/badge/platform-linux-lightgrey)

</div>

---

## Why

Coding agents are long-running. You start one, it works for twenty minutes, and
you want to look in on it — but the laptop is closed, the SSH session is gone,
and the agent went with it.

argos moves the agent off your laptop. Every session is a detached tmux session
on your own server; the browser is only a viewer. Close the tab, restart the
server, walk away for a day — the agent keeps going and the terminal is exactly
where you left it when you come back. Nothing is kept in the page, so nothing is
lost when the page dies.

## What you get

- **Real terminals in the browser.** xterm.js over a WebSocket to a pty attached
  to tmux, with a WebGL renderer and ack-based flow control, so a process
  spraying output doesn't drown the tab.
- **An infinite canvas per project.** Arrange terminals, notes, checklists, file
  viewers and live web previews on one spatial workspace instead of a stack of
  tabs. It persists.
- **Sessions that outlive everything.** Browser disconnects, server restarts and
  deploys don't touch the agents. `KillMode=process` means even restarting argos
  leaves tmux alone.
- **Agent status at a glance.** Claude Code hooks report each session as working,
  idle, or waiting for approval, so you can see which agent is stuck on a
  permission prompt without opening it.
- **Multiplayer.** Invite someone with their Google account and scope them to a
  single project. Live cursors, presence badges on the terminal someone is
  watching, signed sticky notes. Re-scoping and revoking apply instantly to open
  sessions.
- **Agents that talk to each other.** A shared per-project chat feed: agents
  announce what they're touching, ask each other questions, and mention a
  session by name to deliver a message straight into its terminal.
- **Built for the phone.** PWA install, web push when an agent needs you,
  floating quick keys for the characters a mobile keyboard hides, and a fix for
  Android IME double-input.
- **Push-to-talk dictation** into any terminal, via Groq Whisper.
- **Paste images to agents.** Drop a screenshot on a terminal and Claude Code
  actually receives the image, through a small fake `xclip` on the server.
- **Preview the dev servers your agents start.** `localhost:5173` on the server
  renders inside a canvas node, proxied and framed.

- **Two Claude accounts, one machine.** Point a project at a personal or a work
  identity and its agents sign in as that one — `CLAUDE_CONFIG_DIR` per project,
  so credentials are separate while CLAUDE.md, agents, skills and transcripts
  stay shared. Sub-agents and forks inherit it.

Harnesses supported out of the box: `claude`, `codex`, `opencode`, `gemini`, and
a plain `shell`. Anything else works by passing an explicit command.

## Quickstart (local)

Linux, Node 22+, and tmux. The server drives real ptys, so macOS and Windows
aren't supported (WSL is fine).

```sh
sudo apt install tmux build-essential   # node-pty + better-sqlite3 compile
git clone https://github.com/martinbon39/argos.git
cd argos
npm install

npm run dev:server    # API + WebSockets on :4560
npm run dev:web       # UI on :5173, proxying to the server
```

Then create your account. There is no signup page and no default password — the
first passkey can only be minted from the server's filesystem:

```sh
npm run build -w server
node server/dist/cli.js enroll     # prints a one-shot link, valid 15 minutes
```

Open the link, register a passkey, and you're the owner.

## Deploying it for real

On a fresh Ubuntu server, as root:

```sh
git clone https://github.com/martinbon39/argos.git
cd argos
bash deploy/provision.sh argos.example.com https://github.com/martinbon39/argos.git
```

That installs Node, tmux, Caddy and Claude Code, creates an unprivileged `argos`
user, sets up the firewall, writes a systemd unit and a Caddy vhost with
automatic TLS, and builds the app. Point your domain's A record at the box, then:

```sh
sudo -u argos argosctl enroll
```

Two things to get right:

- **`ARGOS_ORIGIN` must be your public URL.** Passkeys are bound to that
  hostname. A wrong or missing value doesn't crash anything — logins just never
  succeed. `provision.sh` writes it into the unit for you.
- **Keep argos on the loopback** and let Caddy face the internet. That is the
  shipped default.

Prefer to run it yourself? `npm run build && npm start`, plus a reverse proxy.
`deploy/argosctl start|stop|restart|logs` is a pidfile-based alternative to
systemd.

Read [SECURITY.md](SECURITY.md) before exposing it. argos gives a browser a
shell on your server; the login is the only thing between the internet and your
machine.

## Configuration

Everything is optional — argos boots with no configuration at all and serves
`http://localhost:4560`. Every variable also accepts a legacy `ORBIT_` prefix.
Full annotated list in [`.env.example`](.env.example).

| Variable | Default | What it does |
| --- | --- | --- |
| `ARGOS_ORIGIN` | `http://localhost:<port>` | Public URL. **Required in production** — passkeys bind to its hostname. |
| `ARGOS_HOST` | `127.0.0.1` | Bind address. |
| `ARGOS_PORT` | `4560` | Port. |
| `ARGOS_DATA_DIR` | `~/.orbit` | Database, session logs, uploads, generated secrets. |
| `ARGOS_PROJECTS_DIR` | `~/projects` | Where your code lives; sessions and the file explorer are confined here. |
| `ARGOS_TMUX_SOCKET` | `orbit` | Dedicated `tmux -L` socket. Changing it on a live install orphans running sessions. |
| `ARGOS_EXTRA_ORIGINS` | — | Additional origins, comma-separated. For domain migrations. |
| `ARGOS_ALLOWED_EMAIL` | — | Google address that gets owner rights. |
| `ARGOS_OWNER_NAME` | from the email | Display name on cursors and messages. |
| `ARGOS_GOOGLE_CLIENT_ID` / `_SECRET` | — | Enables Google sign-in and guest invites. |
| `GROQ_API_KEY` | — | Enables dictation. Also readable from `<data-dir>/groq.key`. |

The hook secret, PC-bridge token and web-push VAPID keys are generated on first
run under the data directory. There is nothing to paste in.

## Who can get in

**Passkeys** are the primary path and need no third-party account. Credentials
are only created from a one-shot, 15-minute token printed by `argosctl enroll`,
which writes directly to SQLite and is therefore only reachable by someone with
shell access to the server. No HTTP route can bootstrap an owner.

**Google sign-in** is optional and is strictly an allowlist. `ARGOS_ALLOWED_EMAIL`
becomes the owner, addresses you invite become guests, and everyone else is
refused. It's what makes invites possible, since a guest has no shell on your box.

**Guests** are scoped to one project (or, explicitly, the whole cockpit). They
collaborate on that canvas and its terminals but can't administer anything, and
the scope is re-read from the invite on every request, so revoking someone kicks
them out of sessions they already have open.

## Architecture

```
browser ──ws──► fastify ──► node-pty ──► tmux attach ──► your agent
  xterm.js        │                       (detached, survives everything)
  react-flow      └──► sqlite (sessions, canvas, chat, invites, credentials)
```

| Path | What's in it |
| --- | --- |
| `server/` | Fastify, WebSockets, node-pty, better-sqlite3. Routes in `src/routes/`, auth in `src/auth.ts`, tmux in `src/tmux.ts`. |
| `web/` | Vite, React, xterm.js, React Flow. Canvas and node types in `src/canvas/`. |
| `cli/argos` | The in-session CLI agents call: `chat`, `spawn`, `notify`, `artifact`, `pc`. |
| `deploy/` | Provisioning, systemd unit, Caddyfile, and the `gate-*.mjs` smoke tests. |

One process serves the API, the WebSockets and the built SPA. State lives in
tmux and SQLite, never in the server process — that's what lets a deploy restart
mid-session without anyone noticing.

### The agent-facing CLI

Sessions get an `argos` command on their PATH, authenticated by the hook secret:

```sh
argos chat "renaming the canvas merge helper — heads up @other-session"
argos spawn "review the diff on branch x" --model sonnet   # a sibling session
argos notify "tests are green" --link https://…            # push to your phone
argos artifact report.html                                 # publish + get a URL
argos board                                                # what others announced
argos read hecate                                          # see what it is doing
argos send hecate "does your change touch mergeDoc?"       # write into its terminal
```

### How agents relate

They do not share a conversation. Each one is its own process with its own
context, and everything between them is deliberately narrow:

- `argos chat "…"` posts to the **project board** — an announcement that
  interrupts nobody. `argos board` reads it. Pushing these into every terminal
  is what turns a project running five agents into one derailed conversation.
- **Link two terminals** (Link tool in the dock, or `L`) and their agents can
  deal with each other. The link grants both halves: `argos read <name>` sees
  what the other is doing — its recent turns, or `--terminal` for its live pane
  — without waking it, and `argos send <name> "…"` writes into its terminal at
  the cost of a turn. Read before you send. The graph is the permission, and it
  never chains, so a hub does not open everything.

The owner is the exception: a message you post reaches the whole fleet, because
you are the human talking to your own agents and you write rarely.

## Tests

Correctness is pinned by **gates**: small scripts that replay a bug that
actually happened, against the real routes.

```sh
npm test    # gate-canvas + gate-chat + gate-scope, hermetic, no server needed
```

These run in CI on every push. Three more gates need a live server or a real
browser and are run by hand; see [CONTRIBUTING.md](CONTRIBUTING.md).

## FAQ

**Why does everything say `orbit` under the hood?**
That was the project's name until July 2026. The tmux socket, the data
directory, the SQLite filename and the session cookie still use it on purpose:
renaming them would orphan every live session and log everyone out. Environment
variables accept both prefixes. It's compatibility debt, deliberately kept.

**Why tmux instead of managing ptys directly?**
Because then the agent's life would depend on the argos process staying up. With
tmux, argos is just a viewer that can be restarted, redeployed or crash without
the agent noticing.

**Is this multi-tenant?**
No. argos hosts one owner plus the guests they invite. Guest scoping is a real
boundary and it's tested, but it isn't isolation between untrusted strangers —
don't run this as a shared service.

**Can I use it without Claude Code?**
Yes. `codex`, `opencode`, `gemini` and plain shells work, and anything else runs
via an explicit command. Only the status indicators (working / idle / waiting for
approval) are Claude Code specific, since they come from its hooks.

**Does it sandbox the agents?**
No, and that's the point — they need to do real work in your repos. Agents can do
anything the argos Unix user can. Give that user only what it should have.

## Contributing

Bug reports and fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). It's a
personal project developed in the open, so large features are worth discussing in
an issue first.

## License

[MIT](LICENSE) © Martin Bonan

Named for Argos Panoptes, the herdsman of a hundred eyes — half of them awake
while the others slept.
