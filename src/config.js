const path = require('path');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  inviteCode: process.env.INVITE_CODE || 'letmein',
  domain: process.env.DOMAIN || 'localhost:3000',
  // Calendar used for the one-post-per-day rule.
  tz: process.env.APP_TZ || 'America/New_York',
  // New members are automatically friended with this user (if the account
  // exists); they're free to remove the friendship afterwards.
  autoFriend: process.env.AUTO_FRIEND_USERNAME || 'mathslug',
  isProd: process.env.NODE_ENV === 'production',
  limits: {
    caption: 256,
    comment: 128,
    essayMin: 2048, // 2^11 — roughly a 3.5-paragraph essay
    essayMax: 8192, // 2^13 — roughly a 10-paragraph essay
    // An essay may be posted once you have 2 photos since your last essay,
    // and must be posted before your 5th.
    essayAllowedAfterPhotos: 2,
    essayRequiredAfterPhotos: 4,
    imageSize: 1080,
    uploadMaxBytes: 15 * 1024 * 1024
  }
};
