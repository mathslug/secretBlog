// Write a consistent snapshot of the live database to /data/.backup.db.
//
// Run inside the container by the off-box backup (rpi/backup/pull-backups.sh),
// so it sees the same file the app has open. Lifted out of an inline
// `node -e "…"` in that script: the escaping needed to pass this through ssh
// was the kind of thing that breaks silently.
//
// VACUUM INTO, never a file copy. The database runs in WAL mode — production's
// app.db was once 4096 bytes with 1.3MB of write-ahead log — so copying app.db
// alone yields a valid, EMPTY database with no error. VACUUM INTO takes a
// transactionally consistent snapshot of a live database and folds the WAL in,
// so this needs no downtime and cannot tear.

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");

const SRC = "/data/app.db";
const DEST = "/data/.backup.db";

try {
  fs.unlinkSync(DEST);
} catch {
  // Nothing to remove; a previous run already cleaned up.
}

const db = new DatabaseSync(SRC, { readOnly: true });
db.exec(`VACUUM INTO '${DEST}'`);
db.close();

console.log(`${DEST}: ${fs.statSync(DEST).size} bytes`);
