const bcrypt = require('bcryptjs');
const db = require('./db');

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  if (req.headers.accept?.includes('application/json') || req.path.startsWith('/api/') || req.path.startsWith('/hooks/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Forbidden' });
}

async function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

module.exports = { requireAuth, requireAdmin, login };
