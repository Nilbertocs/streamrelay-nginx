const router = require('express').Router();
const http = require('http');
const db = require('../db');
const ffmpeg = require('../ffmpeg');

function broadcast() {
  try { require('./status').broadcast(); } catch (_) {}
}

router.post('/stream-start', (req, res) => {
  if (req.query.secret !== process.env.HOOK_SECRET) return res.status(403).send('Forbidden');

  const { name: streamName } = req.body;
  const ingestKey = db.prepare("SELECT value FROM settings WHERE key = 'ingest_key'").get()?.value;
  if (!ingestKey || streamName !== ingestKey) return res.status(403).send('Invalid stream key');

  db.prepare("INSERT INTO events (type, details) VALUES ('stream_start', ?)").run(
    JSON.stringify({ addr: req.body.addr })
  );

  // Respond OK first so nginx accepts the OBS stream before the relay tries to read it.
  // nginx holds the publish pending until it gets this response, so the ingest stream
  // does not exist yet when this handler runs — starting FFmpeg before responding would
  // cause it to connect to a stream that hasn't been accepted yet and immediately exit.
  res.send('OK');

  setTimeout(() => {
    ffmpeg.stop('fallback');
    ffmpeg.start('relay', ffmpeg.buildRelayArgs(streamName));

    // Poll nginx until HLS segments are actually available before
    // notifying dashboards — prevents the player from hitting 404s.
    let attempts = 0;
    const maxAttempts = 15;
    const checkHls = () => {
      attempts++;
      const req = http.get('http://nginx:80/hls/stream.m3u8', (res) => {
        res.resume();
        if (res.statusCode === 200) {
          broadcast();
        } else if (attempts < maxAttempts) {
          setTimeout(checkHls, 1000);
        } else {
          broadcast(); // give up waiting, broadcast anyway
        }
      });
      req.on('error', () => {
        if (attempts < maxAttempts) setTimeout(checkHls, 1000);
        else broadcast();
      });
      req.setTimeout(2000, () => { req.destroy(); });
    };
    setTimeout(checkHls, 1000);
  }, 2000);
});

router.post('/stream-stop', (req, res) => {
  if (req.query.secret !== process.env.HOOK_SECRET) return res.status(403).send('Forbidden');

  ffmpeg.stop('relay');

  const fallbackEnabled = db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value;
  const activeFile = db.prepare('SELECT * FROM fallback_files WHERE active = 1').get();

  if (fallbackEnabled === '1' && activeFile) {
    ffmpeg.start('fallback', ffmpeg.buildFallbackArgs(`/app/data/videos/${activeFile.filename}`, activeFile.type));
  }

  db.prepare("INSERT INTO events (type, details) VALUES ('stream_stop', NULL)").run();

  res.send('OK');
  broadcast();
});

module.exports = router;
