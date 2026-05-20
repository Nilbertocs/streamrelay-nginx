const router = require('express').Router();
const db = require('../db');
const ffmpeg = require('../ffmpeg');
const { requireAuth } = require('../auth');

const clients = new Set();

function getStatus() {
  const procs = ffmpeg.status();
  let state = 'offline';
  if (procs.relay?.running) state = procs.relay.hlsReady ? 'live' : 'starting';
  else if (procs.fallback?.running) state = procs.fallback.hlsReady ? 'fallback' : 'starting';

  return {
    state,
    relay: procs.relay || null,
    fallback: procs.fallback || null,
    fallbackEnabled: db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value === '1',
    activeFile: db.prepare('SELECT id, name, type FROM fallback_files WHERE active = 1').get() || null,
    streams: db.prepare('SELECT id, name, platform, enabled FROM streams ORDER BY name').all(),
    ingestKey: db.prepare("SELECT value FROM settings WHERE key = 'ingest_key'").get()?.value,
    events: db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 20').all()
  };
}

function broadcast() {
  if (clients.size === 0) return;
  const msg = `data: ${JSON.stringify(getStatus())}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) { clients.delete(res); }
  }
}

// SSE endpoint — instant push to all connected dashboards
router.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(getStatus())}\n\n`);

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Polling fallback
router.get('/', requireAuth, (req, res) => {
  res.json(getStatus());
});

module.exports = router;
module.exports.broadcast = broadcast;
