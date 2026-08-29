# 🐌 Whorl

A tiny private social site at **whorl.mathslug.com**. One short post a day, an
essay every few, friends only. No likes, no messages, no algorithm.

## The rules

- **One post per day** (calendar day in `APP_TZ`, default America/New_York).
- A post is a **short post** or an **essay**:
  - **Short post**: a photo, a bit of text (up to **256** characters, shown
    tweet-style in the feed), or both (the text becomes the caption). Photos
    are square-cropped (you pick the crop and zoom at upload — that is the
    only editing there is) and re-encoded to a ≤1080×1080 WebP.
  - **Essay**: **2,048–8,192** characters (2¹¹–2¹³ — roughly 3.5 to 10
    paragraphs). Essays appear in the feed collapsed to the first few lines.
- **Essay cadence**: essays unlock after **2** short posts since your last
  essay, and after **4** short posts your next post *must* be an essay.
- **Skipping**: you can skip a day instead of posting. A skip burns the day
  (nothing else can be posted) and advances the cadence — it counts as
  whichever type you were about to post (the active composer tab, when both
  are allowed). Skips are stored as hidden rows in `posts` (`skipped = 1`)
  and never appear anywhere.
- **Comments** up to **128** characters. The first two show; the rest expand.
- Signup is open to anyone: username + password, no invite code. Usernames are
  stored lowercase, so capitals typed at signup or login are folded down.
  Feeds show you + your friends only.
- New accounts start with no friends and an empty feed.
- **Discoverability** is off by default and toggled from your own profile. Off,
  you can only be reached by someone typing your username exactly; on, you also
  turn up in friend search. Nobody is ever listed wholesale.
- Sending a friend request always reports success, whether or not the username
  exists — a request to a name nobody holds is recorded in `unmatched_requests`
  so it occupies your sent list exactly like a real one (it is never delivered
  or converted). Guessing usernames therefore reveals nothing; an account
  accepting is the only confirmation it exists.

## Stack

Node 24 + Express + EJS, SQLite via the built-in `node:sqlite` (WAL mode, no
native deps) and sharp for image processing. It runs in a rootless **podman**
container managed by systemd on a Raspberry Pi, reached over a Cloudflare
Tunnel — so there is no TLS, no reverse proxy and no open port configured here.
State is `/data` in the container (`app.db` + `images/`), bind-mounted from the
host and never touched by a deploy.

## Development

```sh
npm install
npm run dev            # http://localhost:3000, data in ./data
# env: PORT, DATA_DIR, APP_TZ, DOMAIN
```

## Deployment — pulled, not pushed

Nothing can reach the Pi from outside, so it fetches its own updates. A systemd
timer runs one `git ls-remote` every 15 minutes and exits unless `main` has
moved; when it has, the Pi pulls, rebuilds the image and restarts the
container. A failed build leaves the previous container serving.

**So a push to `main` is the deploy** — live within about 15 minutes, with
nothing to run here. To skip the wait:

```sh
ssh mypi-remote 'sudo /opt/rpi/deploy-app.sh whorl'   # or `ssh mypi` on the LAN
```

The machinery lives in the **rpi** repo (`~/src/rpi`, cloned to `/opt/rpi` on
the Pi). `apps/whorl.conf` there is this app's entire registration: the deploy,
the auto-deploy timer, the nightly backup, the health dashboard and the tunnel
ingress rule all read that one file.

What this repo has to hold up its end:

- **`Containerfile`** — built *on* the Pi. sharp ships platform-specific
  binaries, so an image built on an x86 machine will not run on arm64.
- **`deploy/whorl.container`** — the Quadlet unit. systemd's
  `podman-user-generator` turns it into `whorl.service`; there is no unit to
  regenerate when it changes.
- **`healthcheck.js`** — the container's health command. `/healthz` also backs
  the dashboard's five-minute poll, so it must stay cheap.
- **`snapshot.js`, at the repo root** — `VACUUM INTO`, run inside the container
  by the off-box backup. It sits at the root because `.containerignore`
  excludes `deploy/`.

Configuration is `~podsvc/.config/whorl.env` on the Pi (`DOMAIN`, `APP_TZ`),
written from the conf's `ENV_TEMPLATE` on the first deploy and left alone
after.

## Infrastructure (a Raspberry Pi at home)

- The container runs as **`podsvc`**, a sudo-less account, under rootless
  podman — an escape lands nowhere. `ssh mypi` on the LAN, `ssh mypi-remote`
  from anywhere (through the tunnel, behind Cloudflare Access).
- **No inbound ports.** `cloudflared` dials out and routes
  `whorl.mathslug.com` to `127.0.0.1:3000`. Cloudflare terminates TLS and the
  DNS record is a proxied one in Cloudflare, so a dynamic home IP is
  irrelevant and there is no A record to maintain.
- **State**: `~podsvc/data/whorl` on the Pi → `/data` in the container. The
  database and the photos are the only things a rebuild cannot regenerate.
- **Backups**: pulled nightly onto the workstation by the rpi repo's
  `backup/pull-backups.sh` — `snapshot.js` writes a consistent snapshot inside
  the container, `images/` is rsynced, and the copy that was *kept* is
  verified. Fourteen dailies, eight weeklies, in `~/src/rpi/backups`.
- **Memory**: capped at 512MB via `PodmanArgs=--memory=512m`. Size it against
  the largest file, not the process: the cap covers page cache, and the
  backup's `VACUUM INTO` pulls the whole database through it.

### Rebuilding from scratch

The Pi rebuilds from a wiped disk in about half an hour; that sequence is the
rpi repo's `RECOVERY.md`. For this app alone, `deploy-app.sh whorl` clones,
builds and starts it, and `backup/restore.sh` puts `~podsvc/data/whorl` back.
An empty data directory is a valid starting state — `src/db.js` creates the
schema and `images/` on first boot — so a restore is the only step that
carries real information.
