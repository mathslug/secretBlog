const path = require('path');
const express = require('express');
const config = require('./config');
const { attachUser } = require('./auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
// Assets keep their names across deploys, so browsers must revalidate them
// (ETag 304s are cheap at this scale). Photos are immutable and get long
// cache headers from their own route.
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));

// Same-origin check for all state-changing requests (CSRF guard alongside
// SameSite=Lax cookies).
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers.origin) {
    let originHost;
    try {
      originHost = new URL(req.headers.origin).host;
    } catch {
      return res.status(403).send('Bad origin');
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (originHost !== host) return res.status(403).send('Cross-origin request blocked');
  }
  next();
});

app.get('/healthz', (req, res) => res.send('ok'));

app.use(attachUser);

app.use(require('./routes/auth'));
app.use(require('./routes/posts'));
app.use(require('./routes/friends'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).render('error', {
      title: 'Too large',
      message: 'That photo is over 15 MB. Please resize it and try again.'
    });
  }
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

module.exports = app;
