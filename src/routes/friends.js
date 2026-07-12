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
    `SELECT r.id, u.username, u.display_name FROM friend_requests r
     JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.id DESC`
  ).all(me);
  const outgoing = db.prepare(
    `SELECT r.id, u.username, u.display_name FROM friend_requests r
     JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.id DESC`
  ).all(me);
  res.render('friends', {
    title: 'Friends',
    friends,
    incoming,
    outgoing,
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
