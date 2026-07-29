#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 VPS (e.g. Hetzner CAX31) for agora.
# Run as root: bash provision.sh <domain> [github-repo-url]
set -euo pipefail

DOMAIN="${1:?usage: provision.sh <domain> [repo-url]}"
REPO="${2:-}"

# --- system ---
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  tmux git curl build-essential ufw fail2ban unattended-upgrades

# Node 22 (NodeSource)
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (official repo)
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# --- firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- agora user + app ---
id agora &>/dev/null || useradd -m -s /bin/bash agora
mkdir -p /home/agora/.ssh
[ -f /root/.ssh/authorized_keys ] && cp -n /root/.ssh/authorized_keys /home/agora/.ssh/
chown -R agora:agora /home/agora/.ssh && chmod 700 /home/agora/.ssh

sudo -u agora mkdir -p /home/agora/projects /home/agora/apps
if [ -n "$REPO" ]; then
  sudo -u agora git clone "$REPO" /home/agora/apps/agora
  (cd /home/agora/apps/agora && sudo -u agora npm install && sudo -u agora npm run build)
  sudo -u agora install -Dm755 /home/agora/apps/agora/cli/agora /home/agora/.local/bin/agora
fi

# Claude Code for the agora user
sudo -u agora bash -c 'curl -fsSL https://claude.ai/install.sh | bash' || true

# gh backs the repo picker in the New Project dialog (`gh repo list`); the user
# still has to run `gh auth login` once from a terminal inside agora.
apt-get install -y gh || echo "note: gh unavailable — the GitHub repo picker stays disabled"

# --- services ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SCRIPT_DIR/agoractl" /usr/local/bin/agoractl
# fake xclip: lets headless agents "paste" the last image uploaded from the web
# UI (see deploy/xclip). Must land ahead of any real xclip on the user's PATH.
sudo -u agora install -Dm755 "$SCRIPT_DIR/xclip" /home/agora/.local/bin/xclip
sed "s/agora.example.com/$DOMAIN/" "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
sed "s#https://agora.example.com#https://$DOMAIN#" "$SCRIPT_DIR/agora.service" \
  > /etc/systemd/system/agora.service
systemctl daemon-reload
systemctl enable --now agora
systemctl reload caddy

echo "Done. Point DNS A record of $DOMAIN at this server, then:"
echo "  sudo -u agora agoractl enroll   # get the one-shot passkey link"
