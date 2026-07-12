const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add a Postgres database in Railway and reference its DATABASE_URL in this service\'s variables.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Path of the legacy SQLite db (pre-Postgres). Used once for migration, then ignored.
const LEGACY_SQLITE = process.env.LEGACY_SQLITE || '/data/loom.db';

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS signups (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    gpu TEXT NOT NULL,
    vram INTEGER NOT NULL,
    hours INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);

  // One-time migration from the old SQLite volume, if present and Postgres is empty.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM signups');
  if (rows[0].n === 0 && fs.existsSync(LEGACY_SQLITE)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const old = new DatabaseSync(LEGACY_SQLITE);
      const legacy = old.prepare('SELECT id, email, gpu, vram, hours, created_at FROM signups ORDER BY id').all();
      for (const r of legacy) {
        await pool.query(
          `INSERT INTO signups (id, email, gpu, vram, hours, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz) ON CONFLICT (email) DO NOTHING`,
          [r.id, r.email, r.gpu, r.vram, r.hours, r.created_at + 'Z']
        );
      }
      await pool.query(`SELECT setval(pg_get_serial_sequence('signups','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM signups), 1))`);
      console.log(`Migrated ${legacy.length} signups from SQLite -> Postgres`);
    } catch (e) {
      console.error('SQLite migration failed (continuing with empty Postgres):', e.message);
    }
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', async (_req, res) => {
  try {
    const agg = (await pool.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(vram),0)::int AS vram, COALESCE(SUM(hours),0)::int AS hours FROM signups')).rows[0];
    const top = (await pool.query('SELECT gpu, COUNT(*) AS n FROM signups GROUP BY gpu ORDER BY n DESC LIMIT 1')).rows[0];
    res.json({ count: agg.count, vram: agg.vram, hours: agg.hours, topGpu: top ? top.gpu : null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'stats failed' }); }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/join', async (req, res) => {
  const { email, gpu, vram, hours } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254)
    return res.status(400).json({ error: 'Enter a valid email.' });
  const v = parseInt(vram, 10), h = parseInt(hours, 10);
  if (typeof gpu !== 'string' || gpu.length > 64 || !Number.isFinite(v) || !Number.isFinite(h) || v < 0 || v > 512 || h < 0 || h > 24)
    return res.status(400).json({ error: 'Invalid hardware details.' });
  const mail = email.trim().toLowerCase();
  try {
    const ins = await pool.query(
      'INSERT INTO signups (email, gpu, vram, hours) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id',
      [mail, gpu, v, h]
    );
    if (ins.rows.length) return res.json({ node: ins.rows[0].id });
    const existing = await pool.query('SELECT id FROM signups WHERE email = $1', [mail]);
    res.json({ node: existing.rows[0].id, existing: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong. Try again.' }); }
});

init().then(() => {
  app.listen(PORT, () => console.log(`LOOM listening on :${PORT} (db: postgres)`));
}).catch(e => { console.error('init failed:', e); process.exit(1); });
