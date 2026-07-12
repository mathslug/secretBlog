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
    `SELECT r.id, u.id AS user_id, u.username, u.display_name FROM friend_requests r
     JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.id DESC`
  ).all(me);

  // Everyone on the site, ranked by mutual friends (not displayed), then name.
  const everyone = db.prepare(
    `SELECT u.id, u.username,
       (SELECT COUNT(*) FROM friendships f1
         WHERE (f1.user_a = u.id OR f1.user_b = u.id)
           AND (CASE WHEN f1.user_a = u.id THEN f1.user_b ELSE f1.user_a END) IN (
             SELECT CASE WHEN f2.user_a = ? THEN f2.user_b ELSE f2.user_a END
             FROM friendships f2 WHERE f2.user_a = ? OR f2.user_b = ?)
       ) AS mutuals
     FROM users u WHERE u.id != ?
     ORDER BY mutuals DESC, u.username ASC`
  ).all(me, me, me, me);
  const friendIds = new Set(friends.map((f) => f.id));
  const incomingByUser = new Map(incoming.map((r) => [r.user_id, r.id]));
  const outgoingUsers = new Set(outgoing.map((r) => r.user_id));
  const directory = everyone.map((p) => ({
    username: p.username,
    isFriend: friendIds.has(p.id),
    incomingId: incomingByUser.get(p.id) || null,
    requested: outgoingUsers.has(p.id)
  }));

  res.render('friends', {
    title: 'Friends',
    friends,
    incoming,
    outgoing,
    directory,
    error: req.query.err || null,
    notice: req.query.ok || null
  });
});

router.post('/friends/request', requireAuth, (req, res) => {
  const fail = (msg) => res.redirect('/friends?err=' + encodeURIComponent(msg));
  const ok = (msg) => res.redirect('/friends?ok=' + encodeURIComponent(msg));
  const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) return fail(`No user named @${username || '?'}.`);
  if (target.id === req.user.id) return fail('That is you.');
  if (areFriends(req.user.id, target.id)) return fail(`You are already friends with @${target.username}.`);

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
  } catch (e) {
    if (isConstraintError(e)) return fail('Request already sent.');
    throw e;
  }
  ok(`Request sent to @${target.username}.`);
});

const acceptRequest = transaction((requestId, me) => {
  const r = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND to_id = ?').get(requestId, me);
  if (!r) return false;
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(r.id);
  // Clean up any counter-request too.
  db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(me, r.from_id);
  const [a, b] = r.from_id < me ? [r.from_id, me] : [me, r.from_id];
  db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)').run(a, b);
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

router.post('/friends/remove', requireAuth, (req, res) => {
  const other = Number(req.body.user_id);
  const [a, b] = other < req.user.id ? [other, req.user.id] : [req.user.id, other];
  db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(a, b);
  res.redirect('/friends');
});

module.exports = router;
