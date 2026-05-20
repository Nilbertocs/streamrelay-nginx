const router = require('express').Router();
const db = require('../db');
const ffmpeg = require('../ffmpeg');
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const procs = ffmpeg.status();
  let state = 'offline';
  if (procs.relay?.running) state = 'live';
  else if (procs.fallback?.running) state = 'fallback';

  res.json({
    state,
    relay: procs.relay || null,
    fallback: procs.fallback || null,
    fallbackEnabled: db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value === '1',
    activeFile: db.prepare('SELECT id, name, type FROM fallback_files WHERE active = 1').get() || null,
    streams: db.prepare('SELECT id, name, platform, enabled FROM streams ORDER BY name').all(),
    ingestKey: db.prepare("SELECT value FROM settings WHERE key = 'ingest_key'").get()?.value,
    events: db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 20').all()
  });
});

module.exports = router;
