const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const db = require('./db');
const SQLiteStore = require('./sqlite-session-store');
const { requireAuth, login } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme',
  store: new SQLiteStore({ db }),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

app.get('/login.html', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await login(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  res.json({ ok: true, role: user.role, name: user.name });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.session.userId, name: req.session.name, role: req.session.role });
});

// HLS preview proxy — pipes nginx HLS segments to the browser (authenticated)
app.get('/hls/*', requireAuth, (req, res) => {
  const file = req.path.replace(/^\/hls\//, '').replace(/\.\./g, '');
  const proxyReq = http.get(`http://nginx:80/hls/${file}`, (proxyRes) => {
    if (proxyRes.statusCode !== 200) return res.status(proxyRes.statusCode).end();
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => res.status(503).end());
});

app.use('/hooks', require('./routes/hooks'));
app.use('/api/streams', require('./routes/streams'));
app.use('/api/fallback', require('./routes/fallback'));
app.use('/api/status', require('./routes/status'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));

app.use(requireAuth, express.static(path.join(__dirname, 'public')));

app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`StreamRelay panel on :${PORT}`));
