const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), check);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+90 days'))`
  ).run(token, userId);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  const attrs = [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${90 * 24 * 3600}`
  ];
  if (config.isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
}

// Loads req.user (and nav badge count) from the session cookie if present.
function attachUser(req, res, next) {
  req.user = null;
  const token = getCookie(req, 'sid');
  if (token) {
    const row = db.prepare(
      `SELECT u.id, u.username, u.display_name FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    ).get(token);
    if (row) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  res.locals.user = req.user;
  res.locals.pendingCount = req.user
    ? db.prepare('SELECT COUNT(*) AS c FROM friend_requests WHERE to_id = ?').get(req.user.id).c
    : 0;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// Naive in-memory limiter for login/signup attempts.
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    attempts.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > 30) return res.status(429).send('Too many attempts. Try again later.');
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  safeEqual,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  rateLimit
};
