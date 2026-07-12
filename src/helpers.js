const { db } = require('./db');
const config = require('./config');

// Today's date (YYYY-MM-DD) in the app's timezone. en-CA formats as ISO.
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function friendIds(userId) {
  return db.prepare(
    `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id
     FROM friendships WHERE user_a = ? OR user_b = ?`
  ).all(userId, userId, userId).map((r) => r.id);
}

function areFriends(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return !!db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').get(lo, hi);
}

function canViewPost(post, userId) {
  return post.user_id === userId || areFriends(post.user_id, userId);
}

// The heart of the posting rules:
// - one post per day (also enforced by a UNIQUE constraint)
// - a photo is allowed while you have fewer than 4 photos since your last essay
// - an essay is allowed once you have at least 2 photos since your last essay
function postingStatus(userId) {
  const { essayAllowedAfterPhotos, essayRequiredAfterPhotos } = config.limits;
  const postedToday = !!db.prepare('SELECT 1 FROM posts WHERE user_id = ? AND day = ?')
    .get(userId, todayStr());
  const lastEssay = db.prepare(
    `SELECT id FROM posts WHERE user_id = ? AND type = 'essay' ORDER BY id DESC LIMIT 1`
  ).get(userId);
  const photosSinceEssay = db.prepare(
    `SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND type = 'photo' AND id > ?`
  ).get(userId, lastEssay ? lastEssay.id : 0).c;
  return {
    postedToday,
    photosSinceEssay,
    canPhoto: !postedToday && photosSinceEssay < essayRequiredAfterPhotos,
    canEssay: !postedToday && photosSinceEssay >= essayAllowedAfterPhotos,
    essayAllowedAfterPhotos,
    essayRequiredAfterPhotos
  };
}

// Attach comments (oldest first) to each post in the list.
function attachComments(posts) {
  const stmt = db.prepare(
    `SELECT c.*, u.username FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.id ASC`
  );
  for (const post of posts) post.comments = stmt.all(post.id);
}

// SQLite's datetime('now') is UTC without a zone marker; parse accordingly.
function parseUtc(s) {
  return new Date(s.replace(' ', 'T') + 'Z');
}

function fmtTime(s) {
  const d = parseUtc(s);
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 7 * 86400) return `${Math.floor(secs / 86400)}d`;
  const opts = { timeZone: config.tz, month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

module.exports = {
  todayStr,
  friendIds,
  areFriends,
  canViewPost,
  postingStatus,
  attachComments,
  fmtTime
};
