const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { db, isConstraintError } = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const {
  todayStr,
  friendIds,
  canViewPost,
  postingStatus,
  attachComments,
  fmtTime
} = require('../helpers');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.uploadMaxBytes }
});

const imagesDir = () => path.join(config.dataDir, 'images');

router.get('/', requireAuth, (req, res) => {
  const ids = [req.user.id, ...friendIds(req.user.id)];
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const placeholders = ids.map(() => '?').join(',');
  const posts = db.prepare(
    `SELECT p.*, u.username, u.display_name FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id IN (${placeholders}) AND p.id < ?
     ORDER BY p.id DESC LIMIT 21`
  ).all(...ids, before);
  const hasMore = posts.length > 20;
  if (hasMore) posts.pop();
  attachComments(posts);
  res.render('feed', {
    title: 'Feed',
    posts,
    hasMore,
    nextCursor: posts.length ? posts[posts.length - 1].id : null,
    status: postingStatus(req.user.id),
    limits: config.limits,
    fmtTime,
    expandComments: false
  });
});

router.get('/new', requireAuth, (req, res) => {
  res.render('new', {
    title: 'New post',
    status: postingStatus(req.user.id),
    limits: config.limits,
    error: req.query.err || null
  });
});

// Crop the uploaded image to the user-chosen square, cap at 1080px, save as WebP.
// Crop coordinates are pixels in the EXIF-oriented image; sharp's rotate()
// applies the same orientation, so both sides agree.
async function processPhoto(buffer, crop) {
  const oriented = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const swap = (meta.orientation || 1) >= 5;
  const w = swap ? meta.height : meta.width;
  const h = swap ? meta.width : meta.height;

  let size = Math.min(w, h);
  let left = Math.floor((w - size) / 2);
  let top = Math.floor((h - size) / 2);
  if (crop && [crop.x, crop.y, crop.size].every(Number.isFinite)) {
    size = Math.round(Math.max(1, Math.min(crop.size, w, h)));
    left = Math.round(Math.min(Math.max(crop.x, 0), w - size));
    top = Math.round(Math.min(Math.max(crop.y, 0), h - size));
  }

  const target = Math.min(config.limits.imageSize, size);
  const out = await oriented
    .extract({ left, top, width: size, height: size })
    .resize(target, target)
    .webp({ quality: 82 })
    .toBuffer();

  const name = crypto.randomBytes(16).toString('hex') + '.webp';
  await fs.promises.writeFile(path.join(imagesDir(), name), out);
  return name;
}

router.post('/posts', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const fail = (msg) => res.redirect('/new?err=' + encodeURIComponent(msg));
    const status = postingStatus(req.user.id);
    const type = req.body.type === 'essay' ? 'essay' : 'photo';

    if (status.postedToday) return fail('You already posted today. Come back tomorrow!');

    let caption = null;
    let body = null;
    let image = null;

    if (type === 'photo') {
      if (!status.canPhoto) {
        return fail(`You have ${status.photosSinceEssay} short posts since your last essay — time to write one.`);
      }
      caption = String(req.body.caption || '').trim() || null;
      if (caption && caption.length > config.limits.caption) {
        return fail(`Text must be at most ${config.limits.caption} characters.`);
      }
      // A short post is a photo (caption optional) or just text.
      if (!req.file && !caption) return fail('Add a photo or write something.');
      if (req.file) {
        const crop = {
          x: Number(req.body.cropX),
          y: Number(req.body.cropY),
          size: Number(req.body.cropSize)
        };
        try {
          image = await processPhoto(req.file.buffer, crop);
        } catch (e) {
          console.error('image processing failed:', e.message);
          return fail('Could not read that image. Try a JPEG or PNG.');
        }
      }
    } else {
      if (!status.canEssay) {
        const need = status.essayAllowedAfterPhotos - status.photosSinceEssay;
        return fail(`Essays unlock after ${status.essayAllowedAfterPhotos} short posts — ${need} more to go.`);
      }
      body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
      if (body.length < config.limits.essayMin || body.length > config.limits.essayMax) {
        return fail(`Essays must be ${config.limits.essayMin}–${config.limits.essayMax} characters (yours is ${body.length}).`);
      }
    }

    try {
      db.prepare(
        'INSERT INTO posts (user_id, type, day, caption, body, image) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(req.user.id, type, todayStr(), caption, body, image);
    } catch (e) {
      if (isConstraintError(e)) {
        if (image) fs.promises.unlink(path.join(imagesDir(), image)).catch(() => {});
        return fail('You already posted today.');
      }
      throw e;
    }
    res.redirect('/');
  } catch (e) {
    next(e);
  }
});

router.get('/post/:id', requireAuth, (req, res) => {
  const post = db.prepare(
    `SELECT p.*, u.username, u.display_name FROM posts p
     JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  ).get(req.params.id);
  if (!post || !canViewPost(post, req.user.id)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Post not found.' });
  }
  attachComments([post]);
  res.render('post', {
    title: `@${post.username}`,
    post,
    limits: config.limits,
    fmtTime,
    expandComments: true,
    expandEssay: true
  });
});

router.post('/post/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !canViewPost(post, req.user.id)) return res.status(404).send('Not found');
  const body = String(req.body.body || '').trim();
  if (!body || body.length > config.limits.comment) {
    return res.redirect('back');
  }
  db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)')
    .run(post.id, req.user.id, body);
  res.redirect(req.headers.referer || `/post/${post.id}`);
});

router.post('/post/:id/delete', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!post) return res.status(404).send('Not found');
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  if (post.image) fs.promises.unlink(path.join(imagesDir(), post.image)).catch(() => {});
  res.redirect('/');
});

// Commenters can delete their own comments; the post's author can moderate.
router.post('/comments/:id/delete', requireAuth, (req, res) => {
  const comment = db.prepare(
    `SELECT c.*, p.user_id AS post_owner FROM comments c
     JOIN posts p ON p.id = c.post_id WHERE c.id = ?`
  ).get(req.params.id);
  if (!comment || (comment.user_id !== req.user.id && comment.post_owner !== req.user.id)) {
    return res.status(404).send('Not found');
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.redirect(req.headers.referer || '/');
});

router.get('/u/:username', requireAuth, (req, res) => {
  const person = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());
  if (!person || !canViewPost({ user_id: person.id }, req.user.id)) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'No such profile, or you are not friends yet.'
    });
  }
  const posts = db.prepare(
    `SELECT p.*, u.username, u.display_name FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 100`
  ).all(person.id);
  attachComments(posts);
  res.render('profile', {
    title: `@${person.username}`,
    person,
    posts,
    limits: config.limits,
    fmtTime,
    expandComments: false
  });
});

// Images are behind auth like everything else; filenames are random,
// content-addressed-ish, and immutable.
router.get('/img/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}\.webp$/.test(name)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(imagesDir(), name), (err) => {
    if (err && !res.headersSent) res.status(404).send('Not found');
  });
});

module.exports = router;
