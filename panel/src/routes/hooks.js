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

  // Stop fallback BEFORE responding OK so the live app is free for the OBS push
  ffmpeg.stop('fallback');
  ffmpeg.setObsActive(true);

  // Small delay to let FFmpeg process die and release the RTMP publish slot
  setTimeout(() => {
    res.send('OK');
    broadcast();
  }, 500);
});

router.post('/stream-stop', (req, res) => {
  if (req.query.secret !== process.env.HOOK_SECRET) return res.status(403).send('Forbidden');

  ffmpeg.setObsActive(false);

  db.prepare("INSERT INTO events (type, details) VALUES ('stream_stop', NULL)").run();

  res.send('OK');

  // Start fallback after responding so nginx has fully released the stream
  setTimeout(() => {
    const fallbackEnabled = db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value;
    const activeFile = db.prepare('SELECT * FROM fallback_files WHERE active = 1').get();

    if (fallbackEnabled === '1' && activeFile) {
      ffmpeg.start('fallback', ffmpeg.buildFallbackArgs(`/app/data/videos/${activeFile.filename}`, activeFile.type));
    }
    broadcast();
  }, 1000);
});

module.exports = router;
