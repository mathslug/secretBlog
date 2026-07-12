const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`slugclub listening on :${config.port} (tz=${config.tz})`);
});
