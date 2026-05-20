const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key != ?').all('hook_secret');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  res.json(s);
});

router.post('/fallback-toggle', requireAuth, requireAdmin, (req, res) => {
  const cur = db.prepare("SELECT value FROM settings WHERE key = 'fallback_enabled'").get()?.value;
  const next = cur === '1' ? '0' : '1';
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('fallback_enabled', next);
  res.json({ fallback_enabled: next });
});

router.post('/regenerate-key', requireAuth, requireAdmin, (req, res) => {
  const newKey = uuidv4().replace(/-/g, '').substring(0, 16);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ingest_key', newKey);
  db.prepare("INSERT INTO events (type, details) VALUES ('key_regenerated', NULL)").run();
  res.json({ ingest_key: newKey });
});

module.exports = router;
