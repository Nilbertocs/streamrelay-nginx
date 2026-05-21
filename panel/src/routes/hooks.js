const router = require('express').Router();
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

  res.send('OK');

  setTimeout(() => {
    ffmpeg.stop('fallback');
    ffmpeg.setObsActive(true);
    broadcast();
  }, 500);
});

router.post('/stream-stop', (req, res) => {
  if (req.query.secret !== process.env.HOOK_SECRET) return res.status(403).send('Forbidden');

  ffmpeg.setObsActive(false);

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
