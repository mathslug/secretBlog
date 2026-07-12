#!/usr/bin/env bash
# Idempotent server bootstrap + deploy for slugclub. Run as root on the
# droplet by the GitHub Actions workflow, after the app has been rsynced to
# /srv/app and /etc/slugclub.env has been written. The first run installs
# everything; later runs just refresh dependencies and restart. There are no
# manual server steps.
set -euo pipefail

APP_DIR=/srv/app
DATA_DIR=/srv/app-data
export DEBIAN_FRONTEND=noninteractive

echo "--- swap"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "--- node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "--- caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "--- app user + data dir"
id -u slugclub >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin slugclub
mkdir -p "$DATA_DIR"
chown -R slugclub:slugclub "$DATA_DIR"

echo "--- dependencies"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

echo "--- services"
install -m 644 "$APP_DIR/deploy/slugclub.service" /etc/systemd/system/slugclub.service
# shellcheck disable=SC1091
source /etc/slugclub.env
sed "s/__DOMAIN__/${DOMAIN}/" "$APP_DIR/deploy/Caddyfile.tmpl" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable slugclub caddy >/dev/null 2>&1 || true
systemctl restart slugclub
systemctl reload-or-restart caddy

echo "--- health check"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/healthz >/dev/null; then
    echo "app healthy"
    exit 0
  fi
  sleep 1
done
echo "app failed to become healthy"
journalctl -u slugclub --no-pager -n 50
exit 1
