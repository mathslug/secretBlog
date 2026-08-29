// Write a consistent snapshot of the live database to /data/.backup.db.
//
// Runs inside the container, driven by the off-box backup
// (rpi/backup/pull-backups.sh), so it reads the same file the app has open.
//
// VACUUM INTO, never a file copy. The database is in WAL mode, so app.db on its
// own can be a complete and valid database that is also empty, with every row
// still in the write-ahead log — and copying it reports no error. VACUUM INTO
// folds the WAL in and is transactionally consistent, so it needs no downtime
// and cannot tear.

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");

const SRC = "/data/app.db";
const DEST = "/data/.backup.db";

try {
  fs.unlinkSync(DEST);
} catch {
  // No snapshot left over from a previous run.
}

const db = new DatabaseSync(SRC, { readOnly: true });
db.exec(`VACUUM INTO '${DEST}'`);
db.close();

console.log(`${DEST}: ${fs.statSync(DEST).size} bytes`);
