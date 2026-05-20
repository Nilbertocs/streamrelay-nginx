const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at').all());
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (name, email, hash, role) VALUES (?, ?, ?, ?)').run(
      name, email, hash, ['admin', 'viewer'].includes(role) ? role : 'viewer'
    );
    res.status(201).json({ id: result.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Email already exists' }); }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, role, password } = req.body;
  const safeRole = ['admin', 'viewer'].includes(role) ? role : 'viewer';
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, role=?, hash=? WHERE id=?').run(name, email, safeRole, hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(name, email, safeRole, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (target?.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const ok = await bcrypt.compare(currentPassword, user.hash);
  if (!ok) return res.status(401).json({ error: 'Wrong current password' });
  db.prepare('UPDATE users SET hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 10), req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
