// Container health check.
//
// A file rather than an inline `node -e "…"` in the Quadlet unit: podman's
// Quadlet parser does not survive nested quotes, and silently truncates the
// command at the first inner quote. The result is a container that reports
// unhealthy forever with "Syntax error: Unterminated quoted string", while the
// app itself is perfectly fine.
//
// node 24 has global fetch, so this needs nothing added to the image.

const port = process.env.PORT || 3000;

fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
