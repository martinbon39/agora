# Security

## What argos actually is

argos gives a browser a shell on your server. An authenticated session can
start processes, read and write files, and drive coding agents that do the
same. **There is no sandbox between a logged-in user and your machine — the
login *is* the security boundary.** Treat an argos instance as equivalent to
handing out SSH access, and deploy it accordingly.

## Reporting a vulnerability

Please report privately, not in a public issue: open a
[security advisory](https://github.com/martinbon39/argos/security/advisories/new)
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
  the argos origin.

**Out of scope** — these are the design, not bugs:

- The owner running arbitrary commands. That is the entire product.
- Agents in a session doing anything the session's Unix user can do. argos does
  not sandbox the agents it launches; give the argos user only what it needs.
- Anything reachable after an attacker already has the owner's passkey or
  Google account. Protect those as you would your SSH key.
- Local-network exposure of a `ARGOS_HOST=0.0.0.0` instance run without TLS,
  on purpose, by its operator.
- The absence of multi-tenancy. argos hosts one owner, plus guests they invite.

## How the boundary is enforced

- **Nothing is public.** One `onRequest` hook gates `/api`, `/ws`, `/proxy`,
  `/uploads` and `/artifacts`; only the auth endpoints, the version endpoint
  and the SPA's own static assets are open. The login screen contains no
  secrets.
- **Passkeys (WebAuthn) first.** The first credential can only be created from
  a one-shot token printed by `argosctl enroll` — a command that requires
  filesystem access to the server and writes straight to SQLite. There is no
  HTTP path to bootstrap an owner, and no password to guess or reset.
- **Google sign-in is an allowlist**, never open registration:
  `ARGOS_ALLOWED_EMAIL` becomes owner, addresses on the invite list become
  guests, everyone else is turned away.
- **Guest scope is read live** from the invite on every request, so re-scoping
  or revoking applies to sessions already open rather than at next login.
  Revoking also deletes the sessions and closes the live sockets.
- **CSRF.** Session cookies are `httpOnly`, `sameSite=lax`, and `secure`
  whenever the origin is HTTPS; requests arriving with
  `Sec-Fetch-Site: cross-site` are refused outright, which also covers content
  running inside the sandboxed proxy iframe.
- **Containment.** The file explorer anchors twice — the project must sit under
  `ARGOS_PROJECTS_DIR`, and the target's *real* path (symlinks resolved) must
  sit under the project's real path.
- **Secrets are generated, never shipped.** The hook secret, PC-bridge token
  and VAPID keypair are created on first run under `ARGOS_DATA_DIR`, mode
  `0600`. The repository contains no keys and no default credentials.
- **Rate limiting** applies to the authentication endpoints.

`deploy/gate-scope.mjs` pins the guest-scope guarantees above against the real
routes; please add a case to it with any fix that touches them.

## Deploying it safely

- Put it behind TLS and set `ARGOS_ORIGIN` to the public URL. Passkeys bind to
  that hostname; getting it wrong doesn't fail loudly, it just never logs in.
- Keep `ARGOS_HOST=127.0.0.1` and let a reverse proxy face the internet.
  `deploy/Caddyfile` does this and sets HSTS and `nosniff`.
- Run argos as a dedicated, unprivileged user — never root. `deploy/provision.sh`
  creates one, and `argos.service` sets `NoNewPrivileges=true`.
- Only invite guests you would trust in the room. Scope every invite to a single
  project unless you truly mean "the whole cockpit".
- `ARGOS_DATA_DIR` holds session logs and your database. Back it up, and treat
  it as sensitive: session logs contain whatever scrolled through your
  terminals.
