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

// PATCH /api/settings — update one or more settings by key
router.patch('/', requireAuth, requireAdmin, (req, res) => {
  const allowed = ['fallback_enabled'];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const key of allowed) {
    if (key in req.body) {
      const val = req.body[key] === true || req.body[key] === 1 || req.body[key] === '1' ? '1' : '0';
      stmt.run(key, val);
    }
  }
  res.json({ ok: true });
});

router.post('/regenerate-key', requireAuth, requireAdmin, (req, res) => {
  const newKey = uuidv4().replace(/-/g, '').substring(0, 16);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ingest_key', newKey);
  db.prepare("INSERT INTO events (type, details) VALUES ('key_regenerated', NULL)").run();
  res.json({ ingest_key: newKey });
});

module.exports = router;
