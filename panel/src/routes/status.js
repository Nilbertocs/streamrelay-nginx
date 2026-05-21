const router = require('express').Router();
const db = require('../db');
const ffmpeg = require('../ffmpeg');
const { requireAuth } = require('../auth');
const destMonitor = require('../destination-monitor');

const clients = new Set();

function getStatus() {
  const procs = ffmpeg.status();
  const obs = ffmpeg.obsStatus();

  let state = 'offline';
  if (obs.active) state = obs.hlsReady ? 'live' : 'starting';
  else if (procs.fallback?.running) state = procs.fallback.hlsReady ? 'fallback' : 'starting';

  return {
    state,
    obs,
    fallback: procs.fallback || null,
    fallbackEnabled: db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value === '1',
    activeFile: db.prepare('SELECT id, name, type FROM fallback_files WHERE active = 1').get() || null,
    destinations: destMonitor.getDestinationStatus(),
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

router.get('/', requireAuth, (req, res) => {
  res.json(getStatus());
});

module.exports = router;
module.exports.broadcast = broadcast;
