const express = require('express');
const { db, isConstraintError } = require('../db');
const config = require('../config');
const {
  hashPassword,
  verifyPassword,
  safeEqual,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  rateLimit
} = require('../auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Log in', error: req.query.err || null });
});

router.post('/login', rateLimit, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.redirect('/login?err=' + encodeURIComponent('Wrong username or password.'));
  }
  setSessionCookie(res, createSession(user.id));
  res.redirect('/');
});

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('signup', { title: 'Sign up', error: req.query.err || null });
});

router.post('/signup', rateLimit, (req, res) => {
  const fail = (msg) => res.redirect('/signup?err=' + encodeURIComponent(msg));
  const invite = String(req.body.invite || '');
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');

  if (!safeEqual(invite, config.inviteCode)) return fail('Wrong invite code.');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return fail('Username must be 3–20 characters: lowercase letters, digits, underscores.');
  }
  if (!displayName || displayName.length > 40) return fail('Display name must be 1–40 characters.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');

  let info;
  try {
    info = db.prepare(
      'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)'
    ).run(username, displayName, hashPassword(password));
  } catch (e) {
    if (isConstraintError(e)) return fail('That username is taken.');
    throw e;
  }
  const newId = Number(info.lastInsertRowid);

  const founder = db.prepare('SELECT id FROM users WHERE username = ?').get(config.autoFriend);
  if (founder && founder.id !== newId) {
    const [a, b] = founder.id < newId ? [founder.id, newId] : [newId, founder.id];
    db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)').run(a, b);
  }

  setSessionCookie(res, createSession(newId));
  res.redirect('/friends');
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.redirect('/login');
});

module.exports = router;
