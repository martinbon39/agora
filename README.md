<div align="center">

# agora

**A self-hosted cockpit for Claude Code and other CLI coding agents.**

Your agents run on your server, in real tmux sessions. agora gives you a
browser window onto them — from your desk, or from your phone on a train.

[![CI](https://github.com/martinbon39/agora/actions/workflows/ci.yml/badge.svg)](https://github.com/martinbon39/agora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![Platform](https://img.shields.io/badge/platform-linux-lightgrey)

<br />

![Several people and several agents in one workspace](docs/multiplayer.gif)

</div>

---

## Install it

agora belongs on a server, not on your laptop. The point is that your agents
outlive your machine, so a local install throws away the only thing that makes
it worth running.

**Hand [`PROMPT-INSTALL.md`](PROMPT-INSTALL.md) to your agent** and let it do the
whole thing. It will ask which VPS you want, which domain, and which agent CLIs
to install, then provision the box, get TLS working, mint your first passkey, and
verify the install actually works instead of telling you it did.

```
Copy PROMPT-INSTALL.md into Claude Code, Codex, or whatever you use.
```

A 4GB Ubuntu box is enough for a handful of agents. You need a domain: passkeys
bind to a hostname, so an IP will not do.

Prefer to do it by hand? [Deploying it for real](#deploying-it-for-real) below.

---

## Why

Coding agents are long-running. You start one, it works for twenty minutes, and
you want to look in on it — but the laptop is closed, the SSH session is gone,
and the agent went with it.

agora moves the agent off your laptop. Every session is a detached tmux session
on your own server; the browser is only a viewer. Close the tab, restart the
server, walk away for a day — the agent keeps going and the terminal is exactly
where you left it when you come back. Nothing is kept in the page, so nothing is
lost when the page dies.

## What it does

### Your agents live on your server, not on your laptop

Every session is a detached tmux session on a machine you own. The browser is
only a viewer, so closing the tab, restarting agora or shutting the laptop does
not touch the agent. `KillMode=process` means even a deploy leaves tmux alone.

![A session that keeps printing while nobody is watching](docs/persist.gif)

### One infinite canvas per project

Terminals, notes, boards, file viewers and live previews laid out side by side
instead of stacked in tabs. Drag things where they make sense; the layout is
saved with the project and it is the same layout for everyone on it.

![Arranging a workspace](docs/canvas.gif)

### The agents talk to each other

A shared board per project. Agents announce what they are about to touch before
they touch it, so the next one reads that instead of overwriting them. An
`@mention` is delivered straight into the other session's terminal, not into a
notification nobody reads.

![An @mention landing inside another session](docs/agents.gif)

### Invite anyone

Send someone a link. They get live cursors, a presence badge on whatever
terminal each person is watching, and they can type into a session an agent is
in the middle of. Same pty, not a screenshare. Re-scoping and revoking apply
instantly to sessions that are already open.

### Any engine, per session

`claude`, `codex`, `opencode`, `gemini`, or a plain `shell`. Anything else works
by passing an explicit command. Each session picks its own, so a Codex session
and a Claude session sit side by side on the same canvas.

![Claude, Codex, Gemini or a plain shell](docs/harnesses.png)

### And the rest

- **Agent status at a glance.** Claude Code hooks report each session as
  working, idle, or waiting for approval, so you can see which agent is stuck on
  a permission prompt without opening it.
- **Built for the phone.** PWA install, web push when an agent needs you,
  floating quick keys for the characters a mobile keyboard hides, and a fix for
  Android IME double-input.
- **Push-to-talk dictation** into any terminal, via Groq Whisper.
- **Paste images to agents.** Drop a screenshot on a terminal and Claude Code
  actually receives the image, through a small fake `xclip` on the server.
- **Preview the dev servers your agents start**, proxied into a canvas node.
- **Two Claude accounts, one machine.** `CLAUDE_CONFIG_DIR` per project, so
  credentials are separate while CLAUDE.md, agents, skills and transcripts stay
  shared. Sub-agents and forks inherit it.

### The film

A 72-second look at the whole thing:
[agora.mp4](https://github.com/martinbon39/agora/releases/latest/download/agora.mp4).

## Running it locally

Only worth doing if you want to hack on agora itself. For actually using it, put
it on a VPS: see [Install it](#install-it) above.

Linux, Node 22+, and tmux. The server drives real ptys, so macOS and Windows
aren't supported (WSL is fine).

```sh
sudo apt install tmux build-essential   # node-pty + better-sqlite3 compile
git clone https://github.com/martinbon39/agora.git
cd agora
npm install

export AGORA_ORIGIN=http://localhost:5173   # see below — do this before both
npm run dev:server    # API + WebSockets on :4570
npm run dev:web       # UI on :5173, proxying to the server
```

In dev the UI is served by Vite on `:5173` and the API by the server on `:4570`,
so agora has to be told which of the two the browser is actually on.
`AGORA_ORIGIN` is that answer, and both things that need it break silently
without it: passkeys are bound to the origin of the page that created them, so
registration is rejected, and the enrolment link below is printed with the
server's port, where no UI is listening. In production one process serves both
and the default is right.

Then create your account. There is no signup page and no default password — the
first passkey can only be minted from the server's filesystem:

```sh
npm run build -w server
node server/dist/cli.js enroll     # prints a one-shot link, valid 15 minutes
```

Open the link, register a passkey, and you're the owner. Invite anyone else from
the multiplayer panel in the top bar: it hands you a link that signs them in,
scoped to one canvas, with nothing else to configure.

## Deploying it for real

On a fresh Ubuntu server, as root:

```sh
git clone https://github.com/martinbon39/agora.git
cd agora
bash deploy/provision.sh agora.example.com https://github.com/martinbon39/agora.git
```

That installs Node, tmux, Caddy and Claude Code, creates an unprivileged `agora`
user, sets up the firewall, writes a systemd unit and a Caddy vhost with
automatic TLS, and builds the app. Point your domain's A record at the box, then:

```sh
sudo -u agora agoractl enroll
```

Two things to get right:

- **`AGORA_ORIGIN` must be your public URL.** Passkeys are bound to that
  hostname. A wrong or missing value doesn't crash anything — logins just never
  succeed. `provision.sh` writes it into the unit for you.
- **Keep agora on the loopback** and let Caddy face the internet. That is the
  shipped default.

Prefer to run it yourself? `npm run build && npm start`, plus a reverse proxy.
`deploy/agoractl start|stop|restart|logs` is a pidfile-based alternative to
systemd.

Read [SECURITY.md](SECURITY.md) before exposing it. agora gives a browser a
shell on your server; the login is the only thing between the internet and your
machine.

## Configuration

Everything is optional — agora boots with no configuration at all and serves
`http://localhost:4570`.
Full annotated list in [`.env.example`](.env.example).

| Variable | Default | What it does |
| --- | --- | --- |
| `AGORA_ORIGIN` | `http://localhost:<port>` | Public URL. **Required in production** — passkeys bind to its hostname. |
| `AGORA_HOST` | `127.0.0.1` | Bind address. |
| `AGORA_PORT` | `4570` | Port. |
| `AGORA_DATA_DIR` | `~/.agora` | Database, session logs, uploads, generated secrets. |
| `AGORA_PROJECTS_DIR` | `~/projects` | Where your code lives; sessions and the file explorer are confined here. |
| `AGORA_TMUX_SOCKET` | `agora` | Dedicated `tmux -L` socket. Changing it on a live install orphans running sessions. |
| `AGORA_EXTRA_ORIGINS` | — | Additional origins, comma-separated. For domain migrations. |
| `AGORA_ALLOWED_EMAIL` | — | Google address that gets owner rights. |
| `AGORA_OWNER_NAME` | from the email | Display name on cursors and messages. |
| `AGORA_GOOGLE_CLIENT_ID` / `_SECRET` | — | Enables Google sign-in. Invites work without it, by link. |
| `GROQ_API_KEY` | — | Enables dictation. Also readable from `<data-dir>/groq.key`. |

The hook secret, PC-bridge token and web-push VAPID keys are generated on first
run under the data directory. There is nothing to paste in.

## Who can get in

**Passkeys** are the primary path and need no third-party account. Credentials
are only created from a one-shot, 15-minute token printed by `agoractl enroll`,
which writes directly to SQLite and is therefore only reachable by someone with
shell access to the server. No HTTP route can bootstrap an owner.

**Invite links** are how a second person gets in, and they need nothing
configured. Inviting an address mints a link that signs that person in as a
guest; it is shown once, because only its hash is stored. Anyone holding it gets
in, so send it the way you would send a password. Rotating replaces it, and
revoking destroys it.

**Google sign-in** is optional and is strictly an allowlist. `AGORA_ALLOWED_EMAIL`
becomes the owner, addresses you invite become guests, and everyone else is
refused. Configure it and the same invites also work by Google account, which
is worth having when you would rather not pass links around at all.

**Guests** are scoped to exactly one project — an invite has to name one, there
is no "everything" scope. They
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
| `cli/agora` | The in-session CLI agents call: `chat`, `spawn`, `notify`, `artifact`, `pc`. |
| `deploy/` | Provisioning, systemd unit, Caddyfile, and the `gate-*.mjs` smoke tests. |

One process serves the API, the WebSockets and the built SPA. State lives in
tmux and SQLite, never in the server process — that's what lets a deploy restart
mid-session without anyone noticing.

### The agent-facing CLI

Sessions get an `agora` command on their PATH, authenticated by the hook secret:

```sh
agora chat "renaming the canvas merge helper — heads up @other-session"
agora spawn "review the diff on branch x" --model sonnet   # a sibling session
agora notify "tests are green" --link https://…            # push to your phone
agora artifact report.html                                 # publish + get a URL
agora board                                                # what others announced
agora read hecate                                          # see what it is doing
agora send hecate "does your change touch mergeDoc?"       # write into its terminal
```

### How agents relate

They do not share a conversation. Each one is its own process with its own
context, and everything between them is deliberately narrow:

- `agora chat "…"` posts to the **project board** — an announcement that
  interrupts nobody. `agora board` reads it. Pushing these into every terminal
  is what turns a project running five agents into one derailed conversation.
- **Link two terminals** (Link tool in the dock, or `L`) and their agents can
  deal with each other. The link grants both halves: `agora read <name>` sees
  what the other is doing — its recent turns, or `--terminal` for its live pane
  — without waking it, and `agora send <name> "…"` writes into its terminal at
  the cost of a turn. Read before you send. The graph is the permission, and it
  never chains, so a hub does not open everything.

The owner is the exception: a message you post reaches the whole fleet, because
you are the human talking to your own agents and you write rarely.

## Tests

Correctness is pinned by **gates**: small scripts that replay a bug that
actually happened, against the real routes.

```sh
npm test    # every headless gate; needs tmux, and bwrap for full coverage
```

These run in CI on every push. Three more need a real browser or a dev server
and are run by hand. What each gate pins is listed in
[CONTRIBUTING.md](CONTRIBUTING.md), and fixing a bug means adding a case to one.

## FAQ

**Why tmux instead of managing ptys directly?**
Because then the agent's life would depend on the agora process staying up. With
tmux, agora is just a viewer that can be restarted, redeployed or crash without
the agent noticing.

**Is this multi-tenant?**
No. agora hosts one owner plus the guests they invite. Guest scoping is a real
boundary and it's tested, but it isn't isolation between untrusted strangers —
don't run this as a shared service.

**Can I use it without Claude Code?**
Yes. `codex`, `opencode`, `gemini` and plain shells work, and anything else runs
via an explicit command. Only the status indicators (working / idle / waiting for
approval) are Claude Code specific, since they come from its hooks.

**Does it sandbox the agents?**
No, and that's the point — they need to do real work in your repos. Agents can do
anything the agora Unix user can. Give that user only what it should have.

## Contributing

Bug reports and fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). It's a
personal project developed in the open, so large features are worth discussing in
an issue first.

## License

[MIT](LICENSE) © Martin Bonan

Named for Agora Panoptes, the herdsman of a hundred eyes — half of them awake
while the others slept.
