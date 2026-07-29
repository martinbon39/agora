#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 VPS (e.g. Hetzner CAX31) for argos.
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

# --- argos user + app ---
id argos &>/dev/null || useradd -m -s /bin/bash argos
mkdir -p /home/argos/.ssh
[ -f /root/.ssh/authorized_keys ] && cp -n /root/.ssh/authorized_keys /home/argos/.ssh/
chown -R argos:argos /home/argos/.ssh && chmod 700 /home/argos/.ssh

sudo -u argos mkdir -p /home/argos/projects /home/argos/apps
if [ -n "$REPO" ]; then
  sudo -u argos git clone "$REPO" /home/argos/apps/argos
  (cd /home/argos/apps/argos && sudo -u argos npm install && sudo -u argos npm run build)
  sudo -u argos install -Dm755 /home/argos/apps/argos/cli/argos /home/argos/.local/bin/argos
fi

# Claude Code for the argos user
sudo -u argos bash -c 'curl -fsSL https://claude.ai/install.sh | bash' || true

# gh backs the repo picker in the New Project dialog (`gh repo list`); the user
# still has to run `gh auth login` once from a terminal inside argos.
apt-get install -y gh || echo "note: gh unavailable — the GitHub repo picker stays disabled"

# --- services ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SCRIPT_DIR/argosctl" /usr/local/bin/argosctl
# fake xclip: lets headless agents "paste" the last image uploaded from the web
# UI (see deploy/xclip). Must land ahead of any real xclip on the user's PATH.
sudo -u argos install -Dm755 "$SCRIPT_DIR/xclip" /home/argos/.local/bin/xclip
sed "s/argos.example.com/$DOMAIN/" "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
sed "s#https://argos.example.com#https://$DOMAIN#" "$SCRIPT_DIR/argos.service" \
  > /etc/systemd/system/argos.service
systemctl daemon-reload
systemctl enable --now argos
systemctl reload caddy

echo "Done. Point DNS A record of $DOMAIN at this server, then:"
echo "  sudo -u argos argosctl enroll   # get the one-shot passkey link"
