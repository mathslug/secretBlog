const express = require('express');
const { db, transaction, isConstraintError } = require('../db');
const { requireAuth } = require('../auth');
const { areFriends } = require('../helpers');

const router = express.Router();

router.get('/friends', requireAuth, (req, res) => {
  const me = req.user.id;
  const friends = db.prepare(
    `SELECT u.id, u.username, u.display_name FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ? OR f.user_b = ?
     ORDER BY u.username`
  ).all(me, me, me);
  const incoming = db.prepare(
    `SELECT r.id, u.id AS user_id, u.username, u.display_name FROM friend_requests r
     JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.id DESC`
  ).all(me);
  const outgoing = db.prepare(
    `SELECT u.id AS user_id, u.username FROM friend_requests r
     JOIN users u ON u.id = r.to_id WHERE r.from_id = ?`
  ).all(me);
  const unmatched = db.prepare(
    'SELECT username FROM unmatched_requests WHERE from_id = ?'
  ).all(me);

  // Sent requests are rendered as usernames and nothing else — no row id, no
  // hint of which table a name came from — so a request to a name nobody holds
  // renders identically to one to a private account that hasn't accepted.
  // Cancelling keys off the username for the same reason.
  const sent = [...outgoing, ...unmatched]
    .map((r) => r.username)
    .sort((a, b) => a.localeCompare(b));

  // Search only ever matches accounts that opted in via the profile toggle.
  // Everyone else can be reached, but only by typing their username exactly.
  const query = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  let results = [];
  if (query) {
    const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    const friendIds = new Set(friends.map((f) => f.id));
    const incomingByUser = new Map(incoming.map((r) => [r.user_id, r.id]));
    const outgoingUsers = new Set(outgoing.map((r) => r.user_id));
    results = db.prepare(
      `SELECT id, username FROM users
       WHERE discoverable = 1 AND id != ? AND username LIKE ? ESCAPE '\\'
       ORDER BY username LIMIT 25`
    ).all(me, like).map((u) => ({
      username: u.username,
      isFriend: friendIds.has(u.id),
      incomingId: incomingByUser.get(u.id) || null,
      requested: outgoingUsers.has(u.id)
    }));
  }

  res.render('friends', {
    title: 'Friends',
    friends,
    incoming,
    sent,
    query,
    results,
    error: req.query.err || null,
    notice: req.query.ok || null
  });
});

// Sending a request must look the same whether or not the username exists, so
// that private accounts cannot be found by guessing. Every path below that
// involves someone other than an existing friend ends in the same confirmation,
// and an unmatched name is recorded so it also occupies your sent list. The
// only true signal that an account exists is that it accepts.
router.post('/friends/request', requireAuth, (req, res) => {
  const fail = (msg) => res.redirect('/friends?err=' + encodeURIComponent(msg));
  const ok = (msg) => res.redirect('/friends?ok=' + encodeURIComponent(msg));
  const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const sent = () => ok(`Request sent to @${username}.`);

  // Names that can never be accounts are not stored; nothing about real
  // accounts can be inferred from how they are handled.
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return sent();
  if (username === req.user.username) return fail('That is you.');

  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) {
    try {
      db.prepare('INSERT INTO unmatched_requests (from_id, username) VALUES (?, ?)')
        .run(req.user.id, username);
    } catch (e) {
      if (!isConstraintError(e)) throw e; // already recorded; same reply
    }
    return sent();
  }

  if (areFriends(req.user.id, target.id)) {
    return fail(`You are already friends with @${target.username}.`);
  }

  // If they already asked us, this is an acceptance.
  const reverse = db.prepare('SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ?')
    .get(target.id, req.user.id);
  if (reverse) {
    acceptRequest(reverse.id, req.user.id);
    return ok(`You and @${target.username} are now friends.`);
  }

  try {
    db.prepare('INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?)')
      .run(req.user.id, target.id);
    // Drop any placeholder from back when this name had no account, so the
    // sent list never shows it twice.
    db.prepare('DELETE FROM unmatched_requests WHERE from_id = ? AND username = ?')
      .run(req.user.id, target.username);
  } catch (e) {
    if (!isConstraintError(e)) throw e; // already sent; same reply
  }
  sent();
});

const acceptRequest = transaction((requestId, me) => {
  const r = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND to_id = ?').get(requestId, me);
  if (!r) return false;
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(r.id);
  // Clean up any counter-request too.
  db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(me, r.from_id);
  const [a, b] = r.from_id < me ? [r.from_id, me] : [me, r.from_id];
  db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)').run(a, b);
  // Either side may have guessed the other's name before that account existed.
  // Becoming friends settles those placeholders, which would otherwise sit in
  // the sent list forever: re-sending stops early once you are already friends.
  db.prepare(
    `DELETE FROM unmatched_requests
     WHERE (from_id = ? AND username = (SELECT username FROM users WHERE id = ?))
        OR (from_id = ? AND username = (SELECT username FROM users WHERE id = ?))`
  ).run(me, r.from_id, r.from_id, me);
  return true;
});

router.post('/friends/accept', requireAuth, (req, res) => {
  acceptRequest(Number(req.body.request_id), req.user.id);
  res.redirect('/friends');
});

router.post('/friends/decline', requireAuth, (req, res) => {
  db.prepare('DELETE FROM friend_requests WHERE id = ? AND (to_id = ? OR from_id = ?)')
    .run(Number(req.body.request_id), req.user.id, req.user.id);
  res.redirect('/friends');
});

// Cancels a request you sent, by username. Both deletes always run and are
// scoped to you, so the server never has to be told — and the page never has
// to reveal — whether the name belongs to a real account.
router.post('/friends/cancel', requireAuth, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  db.prepare(
    `DELETE FROM friend_requests
     WHERE from_id = ? AND to_id = (SELECT id FROM users WHERE username = ?)`
  ).run(req.user.id, username);
  db.prepare('DELETE FROM unmatched_requests WHERE from_id = ? AND username = ?')
    .run(req.user.id, username);
  res.redirect('/friends');
});

router.post('/friends/remove', requireAuth, (req, res) => {
  const other = Number(req.body.user_id);
  const [a, b] = other < req.user.id ? [other, req.user.id] : [req.user.id, other];
  db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(a, b);
  res.redirect('/friends');
});

module.exports = router;
