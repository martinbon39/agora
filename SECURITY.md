# Security

## What agora actually is

agora gives a browser a shell on your server. An authenticated session can
start processes, read and write files, and drive coding agents that do the
same. **There is no sandbox between a logged-in user and your machine — the
login *is* the security boundary.** Treat an agora instance as equivalent to
handing out SSH access, and deploy it accordingly.

## Reporting a vulnerability

Please report privately, not in a public issue: open a
[security advisory](https://github.com/martinbon39/agora/security/advisories/new)
on the repository. Include what you did, what you observed, and the impact you
believe it has. This is a personal project — expect a first reply within a few
days, not within hours, and no bug bounty.

Please don't test against anyone else's instance without permission. Running a
local instance is easy and gives you a much better repro.

## Threat model

**In scope** — bugs that let someone do more than they were granted:

- Reaching the API, WebSockets, `/uploads`, `/artifacts` or `/proxy/` without a
  valid session cookie.
- Enrolling a passkey or minting a session without a valid one-shot token.
- A **guest escaping their project scope**: reading files, canvases, chat or
  sessions belonging to another project, attaching to its terminals, or
  reaching services on the server's loopback. Guests are semi-trusted people
  invited to one canvas, and the scoping is meant to hold.
- A guest performing an owner-only action (managing invites, push
  subscriptions, GitHub).
- Cross-site request forgery, or an origin other than the configured ones
  driving the API with a victim's cookie.
- Escaping the projects directory through path traversal or symlinks.
- Content rendered from a proxied page or an uploaded file executing script in
  the agora origin.

**Out of scope** — these are the design, not bugs:

- The owner running arbitrary commands. That is the entire product.
- Agents in a session doing anything the session's Unix user can do. agora does
  not sandbox the agents it launches; give the agora user only what it needs.
- Anything reachable after an attacker already has the owner's passkey or
  Google account. Protect those as you would your SSH key.
- Local-network exposure of a `AGORA_HOST=0.0.0.0` instance run without TLS,
  on purpose, by its operator.
- The absence of multi-tenancy. agora hosts one owner, plus guests they invite.

## How the boundary is enforced

- **Nothing is public.** One `onRequest` hook gates `/api`, `/ws`, `/proxy`,
  `/uploads` and `/artifacts`; only the auth endpoints, the version endpoint
  and the SPA's own static assets are open. The login screen contains no
  secrets.
- **Passkeys (WebAuthn) first.** The first credential can only be created from
  a one-shot token printed by `agoractl enroll` — a command that requires
  filesystem access to the server and writes straight to SQLite. There is no
  HTTP path to bootstrap an owner, and no password to guess or reset.
- **Google sign-in is an allowlist**, never open registration:
  `AGORA_ALLOWED_EMAIL` becomes owner, addresses on the invite list become
  guests, everyone else is turned away.
- **Invite links are bearer credentials, and are treated as such.** An invite
  mints a link that signs its holder in as that guest, so that whoever you
  invite can arrive on an install with no OAuth configured. Only the SHA-256 of
  the token is stored, so it is readable exactly once and a leaked database
  hands out no invitations; revoking clears the token in the same statement
  that sets `revoked_at`; and re-minting invalidates the previous link. A link
  redeems into a guest session and never an owner one. It does not expire on
  first use — the person you invited will open it on a second device — so
  anyone it is forwarded to gets the same access, exactly like any
  "anyone with the link" URL.
- **Guest scope is read live** from the invite on every request, so re-scoping
  or revoking applies to sessions already open rather than at next login.
  Revoking also deletes the sessions and closes the live sockets.
- **CSRF.** Session cookies are `httpOnly`, `sameSite=lax`, and `secure`
  whenever the origin is HTTPS; requests arriving with
  `Sec-Fetch-Site: cross-site` are refused outright, which also covers content
  running inside the sandboxed proxy iframe.
- **Containment.** The file explorer anchors twice — the project must sit under
  `AGORA_PROJECTS_DIR`, and the target's *real* path (symlinks resolved) must
  sit under the project's real path.
- **Secrets are generated, never shipped.** The hook secret, PC-bridge token
  and VAPID keypair are created on first run under `AGORA_DATA_DIR`, mode
  `0600`. The repository contains no keys and no default credentials.
- **Rate limiting** applies to the authentication endpoints.

`deploy/gate-scope.mjs` pins the guest-scope guarantees above against the real
routes, `deploy/gate-invite.mjs` pins what a link may and may not redeem into,
and `deploy/gate-ws.mjs` pins that revocation reaches sockets that are already
open. Please add a case to whichever one your fix touches.

## Tenancy, and where it stops

agora is forked from a single-user cockpit, and the parts of that inheritance
that matter for security have been replaced. The parts that have not are listed
at the end of this section — read those before pointing a public URL at it.

**A project is a row, not a directory.** Authorization goes through one function
(`scopeAllows`) that every route consults, and it answers from the `projects`
table: the row names the owner. A directory nobody registered belongs to nobody
and is refused. Upstream, that function short-circuited on `role === "owner"`
and returned true for every project on the box — correct for one human, and a
cross-tenant hole here. The role now distinguishes a full account from an
invited guest and grants nothing by itself.

**Each tenant has a workspace.** Projects are created under a per-tenant
directory. Containment is checked with `withinRoot`, which compares on a path
separator: without it, `workspaces/alice-bob` reads as inside
`workspaces/alice`. A session may only start inside a registered project — not
in the home directory, which upstream allowed explicitly.

**Each tenant runs as their own Anthropic account.** `CLAUDE_CONFIG_DIR` is
always set to the tenant's own config directory, and a session refuses to start
(402) when the tenant has connected nothing. Upstream set it only when a project
named an account and otherwise let the child inherit the server's environment,
so `claude` resolved `$HOME/.claude` — the operator's account, credentials and
files. Inheritance is not a fallback here; it is the thing being prevented. API
keys are stored in a 0600 file rather than in the database, which is what gets
copied around for backups.

These are pinned by `deploy/gate-tenants.mjs` and `deploy/gate-credentials.mjs`,
both built on refusals with paired positive controls, and both verified to fail
when the old behaviour is restored.

### What is NOT isolated

A session is still an ordinary process under the server's unix user. Three
things follow, and no amount of application-level scoping addresses them:

1. **The filesystem.** An agent can read the operator's home directory,
   including agora's own database, its env file and its secrets. `bwrap` closes
   this and works unprivileged (a tmpfs over `/home` with the tenant's
   workspace bound back), but it is not wired in.
2. **The network.** Sessions share the network namespace, so every loopback
   service is reachable — including, on a typical box, a reverse proxy's
   unauthenticated admin API. Unsharing the namespace instead cuts the agent off
   from agora's own hook endpoint, so this needs the server to listen on a unix
   socket, not just a flag.
3. **The hook secret is global.** One value, readable by anything running as the
   user, authenticates the `agora` CLI. A sandboxed agent handed that file could
   act as any session. Per-session tokens are the fix.

Because of these, `AGORA_OPEN_SIGNUP` makes the server **refuse to start**
unless `AGORA_SANDBOX` is set. That override is appropriate for a team where the
strangers are colleagues. It is not appropriate for a public URL, and there is
currently no value that makes it genuinely sandboxed.

## Deploying it safely

- Put it behind TLS and set `AGORA_ORIGIN` to the public URL. Passkeys bind to
  that hostname; getting it wrong doesn't fail loudly, it just never logs in.
- Keep `AGORA_HOST=127.0.0.1` and let a reverse proxy face the internet.
  `deploy/Caddyfile` does this and sets HSTS and `nosniff`.
- Run agora as a dedicated, unprivileged user — never root. `deploy/provision.sh`
  creates one, and `agora.service` sets `NoNewPrivileges=true`.
- Only invite guests you would trust in the room. Scope every invite to a single
  project unless you truly mean "the whole cockpit". Send invite links over
  something you would send a password over, and rotate one you have misdirected
  rather than hoping.
- `AGORA_DATA_DIR` holds session logs and your database. Back it up, and treat
  it as sensitive: session logs contain whatever scrolled through your
  terminals.
