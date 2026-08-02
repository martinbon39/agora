# Give this to your agent

Copy everything below the line into Claude Code, Codex, or whatever agent you
use, and let it install agora on your server for you. It will ask you what it
needs as it goes.

---

You are installing **agora** on a VPS for me. agora is a self-hosted cockpit for
CLI coding agents: it runs them in real tmux sessions on a server and gives me a
browser window onto them. Repo: https://github.com/martinbon39/agora

agora is meant to live on a server, not on a laptop. The whole point is that the
sessions outlive my machine, so a local install defeats it. Install it on a VPS.

## Ask me these first, one message, and wait for my answers

1. **Do I already have a VPS?** If yes, I will give you the SSH host and user. If
   no, recommend one and tell me exactly what to click. Anything with Ubuntu
   24.04 and 4GB of RAM is enough for a handful of agents; 8GB if I plan to run
   many at once. Hetzner, OVH, Scaleway and DigitalOcean all work. Say what it
   will cost me per month.
2. **What domain or subdomain do I want it on?** It needs one. Passkeys are bound
   to a hostname, so an IP address will not do. If I do not own a domain, tell me
   so and stop until I have one.
3. **Which agent CLIs should be available on the box?** claude, codex, opencode,
   gemini, or just a plain shell. Install the ones I say and skip the rest.

Do not start until you have all three answers.

## Then do this

**Point the domain first.** Tell me to create an `A` record for the hostname
pointing at the VPS's IPv4, and wait until `dig +short <hostname>` returns that
IP from the box. TLS will fail silently later if you skip this, and the failure
looks like a broken login rather than a DNS problem.

**Provision.** SSH in as root and run:

```sh
git clone https://github.com/martinbon39/agora.git
cd agora
bash deploy/provision.sh <hostname> https://github.com/martinbon39/agora.git
```

That installs Node 22, tmux, Caddy and the agent CLIs, creates an unprivileged
`agora` user, configures ufw and fail2ban, writes a systemd unit and a Caddy
vhost with automatic TLS, and builds the app. Read the script before you run it
and tell me if anything in it looks wrong for my setup.

**Check `AGORA_ORIGIN`.** It must be the public `https://` URL, exactly. This is
the single most common way an install ends up broken: a wrong value does not
crash anything, logins simply never succeed. `provision.sh` writes it into the
systemd unit; verify it rather than assuming.

**Make me the owner.** There is no signup page and no default password by
design. The first credential can only be minted from the server's filesystem:

```sh
sudo -u agora agoractl enroll
```

Give me the link it prints. It is valid for 15 minutes and works once. I open it,
register a passkey, and I am the owner.

**Verify it actually works, do not just report success.** Confirm each of these
and tell me the result of each:

- `systemctl status agora` is active, and still active 30 seconds later.
- The site loads over `https://` with a valid certificate.
- I can sign in with the passkey I just registered.
- A new session starts and its terminal streams output. This is the one that
  matters: it exercises the WebSocket, the pty and tmux together.
- `tmux -L agora ls` on the box lists that session.
- Closing the browser tab and reopening it leaves the session running with its
  scrollback intact.

If any of those fail, debug it and tell me what was wrong. Do not hand me a
half-working install with a summary that says it went fine.

## Things worth telling me once it is up

- Read `SECURITY.md` with me. agora gives a browser a shell on my server; the
  login is the only thing between the internet and that machine.
- Keep agora bound to the loopback and let Caddy face the internet. That is the
  shipped default; do not change it.
- Sessions survive deploys and restarts on purpose (`KillMode=process`), so
  restarting agora does not kill my agents.
- If I want to add other people later, they sign in and get scoped to a single
  project. Show me how when I ask, not before.
