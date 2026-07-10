const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// On Railway, mount a volume at /data so signups survive redeploys.
const DB_PATH = process.env.DB_PATH || (require('fs').existsSync('/data') ? '/data/loom.db' : path.join(__dirname, 'loom.db'));
const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  gpu TEXT NOT NULL,
  vram INTEGER NOT NULL,
  hours INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Anonymous aggregate stats — no emails ever leave the server.
app.get('/api/stats', (_req, res) => {
  const agg = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(vram),0) AS vram, COALESCE(SUM(hours),0) AS hours FROM signups').get();
  const top = db.prepare('SELECT gpu, COUNT(*) AS n FROM signups GROUP BY gpu ORDER BY n DESC LIMIT 1').get();
  res.json({ count: agg.count, vram: agg.vram, hours: agg.hours, topGpu: top ? top.gpu : null });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const insert = db.prepare('INSERT INTO signups (email, gpu, vram, hours) VALUES (?, ?, ?, ?)');

app.post('/api/join', (req, res) => {
  const { email, gpu, vram, hours } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254)
    return res.status(400).json({ error: 'Enter a valid email.' });
  const v = parseInt(vram, 10), h = parseInt(hours, 10);
  if (typeof gpu !== 'string' || gpu.length > 64 || !Number.isFinite(v) || !Number.isFinite(h) || v < 0 || v > 512 || h < 0 || h > 24)
    return res.status(400).json({ error: 'Invalid hardware details.' });
  try {
    const info = insert.run(email.trim().toLowerCase(), gpu, v, h);
    res.json({ node: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const row = db.prepare('SELECT id FROM signups WHERE email = ?').get(email.trim().toLowerCase());
      return res.json({ node: row.id, existing: true });
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

app.listen(PORT, () => console.log(`LOOM listening on :${PORT} (db: ${DB_PATH})`));
