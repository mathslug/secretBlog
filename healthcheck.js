// Container health check, run by HealthCmd in deploy/whorl.container.
//
// It has to be a file: Quadlet truncates a command at the first nested quote,
// so an inline `node -e "…"` cannot carry one.
//
// node 24 has a global fetch, so this adds nothing to the image.

const port = process.env.PORT || 3000;

fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
