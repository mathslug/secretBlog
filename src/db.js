const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.join(config.dataDir, 'images'), { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('photo', 'essay')),
  day TEXT NOT NULL,
  caption TEXT,
  body TEXT,
  image TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Migrations for databases created before a column existed.
if (!db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('posts') WHERE name = 'skipped'").get().c) {
  db.exec('ALTER TABLE posts ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0');
}

// One-time rename, applied on deploy (safe to delete once it has run).
// The NOT EXISTS guard keeps a boot from ever hitting the UNIQUE constraint.
db.prepare(`
  UPDATE users SET username = 'zootrider', display_name = 'zootrider'
  WHERE username = 'juliagbentley5'
    AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'zootrider')
`).run();

// node:sqlite has no transaction helper; wrap manually.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

function isConstraintError(e) {
  return /constraint/i.test(e && e.message ? e.message : '');
}

module.exports = { db, transaction, isConstraintError };
