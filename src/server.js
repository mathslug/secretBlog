const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`whorl listening on :${config.port} (tz=${config.tz})`);
});
