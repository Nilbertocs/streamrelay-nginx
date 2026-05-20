const router = require('express').Router();
const db = require('../db');
const ffmpeg = require('../ffmpeg');

router.post('/stream-start', (req, res) => {
  if (req.query.secret !== process.env.HOOK_SECRET) return res.status(403).send('Forbidden');

  const { name: streamName } = req.body;
  const ingestKey = db.prepare("SELECT value FROM settings WHERE key = 'ingest_key'").get()?.value;
  if (!ingestKey || streamName !== ingestKey) return res.status(403).send('Invalid stream key');

  ffmpeg.stop('fallback');
  ffmpeg.start('relay', ffmpeg.buildRelayArgs(streamName));
  db.prepare("INSERT INTO events (type, details) VALUES ('stream_start', ?)").run(
    JSON.stringify({ addr: req.body.addr })
  );
  res.send('OK');
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
});

module.exports = router;
