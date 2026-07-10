# LOOM — Phase 0 Compute Census

Waitlist for a distributed-training protocol on consumer hardware. Visitors pledge GPU model, VRAM, and hours/day; the landing page shows live anonymous aggregates (node count, pledged VRAM/hours, top hardware). Emails are stored server-side only and never exposed via the API.

## Stack
- Node + Express, single `server.js`
- SQLite via `better-sqlite3` (zero-config, single file)
- Static frontend in `public/` (no build step)

## Run locally
```bash
npm install
npm start        # http://localhost:3000
```

## Deploy on Railway
1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** → select it. Railway auto-detects Node and runs `npm start`.
3. **Persistence (important):** add a Volume to the service and mount it at `/data`. The server automatically uses `/data/loom.db` when the mount exists — without a volume, signups are lost on every redeploy.
4. Generate a public domain under **Settings → Networking**.

Optional env var: `DB_PATH` to override the database location.

## API
- `GET /api/stats` → `{ count, vram, hours, topGpu }` (anonymous aggregates)
- `POST /api/join` `{ email, gpu, vram, hours }` → `{ node }` (idempotent per email)

## Exporting the list
```bash
sqlite3 /data/loom.db "SELECT email, gpu, vram, hours, created_at FROM signups;"
```
