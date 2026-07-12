# 🐌 Slug Club

A tiny private social site at **slugclub.mathslug.com**. One photo a day, an
essay every few, friends only. No likes, no messages, no algorithm.

## The rules

- **One post per day** (calendar day in `APP_TZ`, default America/New_York).
- A post is a **photo** or an **essay**:
  - **Photo**: square-cropped (you pick the crop and zoom at upload — that is
    the only editing there is), optional caption up to **256** characters.
    The server re-encodes to a ≤1080×1080 WebP.
  - **Essay**: **2,048–8,192** characters (2¹¹–2¹³ — roughly 3.5 to 10
    paragraphs). Essays appear in the feed collapsed to the first few lines.
- **Essay cadence**: essays unlock after **2** photos since your last essay,
  and after **4** photos your next post *must* be an essay.
- **Comments** up to **128** characters. The first two show; the rest expand.
- Signup requires the invite code. Feeds show you + your friends only.

## Stack

Node 24 + Express + EJS, SQLite via the built-in `node:sqlite` (WAL mode, no
native deps) and sharp for image processing. Runs as a plain systemd service
behind a native Caddy install (automatic HTTPS). No Docker. State lives in
`/srv/app-data` (`app.db` + `images/`), untouched by deploys.

## Development

```sh
npm install
npm run dev            # http://localhost:3000, data in ./data
# env: PORT, DATA_DIR, INVITE_CODE (default "letmein"), APP_TZ, DOMAIN
```

## Deployment — no manual server steps

Every push to `main` runs `.github/workflows/deploy.yml`:

1. `rsync` the app to `/srv/app` on the droplet and write `/etc/slugclub.env`
   from Actions secrets/vars.
2. Run `deploy/deploy.sh` (as root, over SSH) — an idempotent script that
   installs swap, Node 24, and Caddy *if missing*, creates the `slugclub`
   system user, runs `npm ci`, installs the systemd unit and Caddyfile, and
   restarts both services. The first deploy bootstraps a bare droplet;
   subsequent deploys just sync and restart.
3. Health-check the service; the run fails loudly if it isn't healthy.

Configuration lives in GitHub Actions **secrets** (`DEPLOY_HOST`,
`DEPLOY_SSH_KEY`, `INVITE_CODE`) and **variables** (`DOMAIN`, `APP_TZ`).
To change the domain later: update the `DOMAIN` variable, add the new DNS
record, re-run the workflow.

## Infrastructure (DigitalOcean, created via doctl)

- Droplet `slugclub` (nyc1, s-1vcpu-1gb, Ubuntu 24.04), ID `584093059`.
  `infra/cloud-init.yaml` is minimal — the deploy workflow does the real
  bootstrap.
- Reserved IP **24.199.66.225** → point DNS here (survives droplet rebuilds).
- Cloud firewall `slugclub-fw`: inbound 22/80/443 only.
- Deploy key: `~/.ssh/slugclub_deploy` (public key on the droplet, private
  key in the `DEPLOY_SSH_KEY` Actions secret).

DNS (at Namecheap): `A slugclub → 24.199.66.225`. Caddy fetches the TLS
certificate automatically once the record resolves.

### Rebuilding from scratch

```sh
doctl compute droplet create slugclub --region nyc1 --size s-1vcpu-1gb \
  --image ubuntu-24-04-x64 --ssh-keys <key-id> \
  --user-data-file infra/cloud-init.yaml --wait
doctl compute reserved-ip-action assign 24.199.66.225 <new-droplet-id>
# then re-run the deploy workflow (Actions → deploy → Run workflow)
```

Note: photos and the database live in `/srv/app-data` on the droplet — take a
snapshot or `rsync` that directory somewhere before destroying it.
