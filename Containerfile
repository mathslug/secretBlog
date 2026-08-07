# whorl — container image
#
# Build this ON the target host (arm64 Pi). `sharp` ships platform-specific
# prebuilt binaries, so an image built on x86 will not run on the Pi.
#
#   podman build -t whorl:latest .
#
# The process runs as container-root on purpose. Under rootless podman the
# container's uid 0 is mapped to the unprivileged host user that owns the
# container (see /etc/subuid), so this is not privileged on the host — and it
# keeps files under DATA_DIR owned by that host user, which is what makes the
# off-box backup able to read them.

FROM docker.io/library/node:24-trixie-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# Dependencies in their own layer so app-code edits don't force a reinstall.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# DATA_DIR is a bind mount at runtime; create it so the image also runs bare.
RUN mkdir -p /data

EXPOSE 3000

# src/db.js creates data/images and the SQLite schema on first boot, so an
# empty DATA_DIR is a valid starting state — no migration step to run.
CMD ["node", "src/server.js"]
