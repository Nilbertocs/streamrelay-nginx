const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const ffmpeg = require('../ffmpeg');
const { requireAuth, requireAdmin } = require('../auth');

const VIDEOS_DIR = '/app/data/videos';

const storage = multer.diskStorage({
  destination: VIDEOS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `fallback_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.mp4', '.jpg', '.jpeg', '.png'].includes(ext)) {
      return cb(new Error('Only MP4 and images (JPG, PNG) are allowed'));
    }
    cb(null, true);
  }
});

function detectType(filename) {
  return path.extname(filename).toLowerCase() === '.mp4' ? 'mp4' : 'image';
}

function startFallback(file) {
  ffmpeg.start('fallback', ffmpeg.buildFallbackArgs(path.join(VIDEOS_DIR, file.filename), file.type));
}

router.get('/files', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM fallback_files ORDER BY created_at DESC').all());
});

router.post('/upload', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const type = detectType(req.file.filename);
    const result = db.prepare(
      'INSERT INTO fallback_files (name, filename, type, size, active) VALUES (?, ?, ?, ?, 0)'
    ).run(req.file.originalname, req.file.filename, type, req.file.size);
    res.status(201).json({ id: result.lastInsertRowid, filename: req.file.filename });
  });
});

router.post('/files/:id/activate', requireAuth, requireAdmin, (req, res) => {
  const file = db.prepare('SELECT * FROM fallback_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  db.prepare('UPDATE fallback_files SET active = 0').run();
  db.prepare('UPDATE fallback_files SET active = 1 WHERE id = ?').run(file.id);
  if (ffmpeg.isRunning('fallback')) startFallback(file);
  res.json({ ok: true });
});

router.delete('/files/:id', requireAuth, requireAdmin, (req, res) => {
  const file = db.prepare('SELECT * FROM fallback_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.active && ffmpeg.isRunning('fallback')) ffmpeg.stop('fallback');
  db.prepare('DELETE FROM fallback_files WHERE id = ?').run(file.id);
  try { fs.unlinkSync(path.join(VIDEOS_DIR, file.filename)); } catch (_) {}
  res.json({ ok: true });
});

router.post('/start', requireAuth, requireAdmin, (req, res) => {
  const file = db.prepare('SELECT * FROM fallback_files WHERE active = 1').get();
  if (!file) return res.status(400).json({ error: 'No active fallback file set' });
  startFallback(file);
  res.json({ ok: true });
});

router.post('/stop', requireAuth, requireAdmin, (req, res) => {
  ffmpeg.stop('fallback');
  res.json({ ok: true });
});

module.exports = router;
