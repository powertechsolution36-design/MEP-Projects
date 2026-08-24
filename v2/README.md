# MEP PROJECTS v2

Complete rewrite: Express + MongoDB + Socket.IO backend, React + Vite SPA frontend, Expo WebView mobile app.

## Structure

- `server/` — Node.js API (Express, Mongoose, Socket.IO, JWT)
- `web/` — React SPA (Vite build → static files)
- `mobile/` — Expo WebView wrapper (loads the web URL)
- `deploy/` — VPS deployment scripts

## Quick start (local dev)

```bash
# Backend
cd server
cp .env.example .env
npm install
npm run seed    # creates DEMO company, super/super123, admin/admin123
npm run dev

# Frontend (new terminal)
cd web
npm install
npm run dev     # http://localhost:5173 (proxies to backend :4001)
```

## Production deploy on VPS

1. Copy files to `/var/www/mep-projects/` on VPS
2. Run `deploy/vps-install.sh`
3. Build web: `cd web && npm install && npm run build`
4. Nginx serves `web/dist/` at `mep-projects.spereon.codes`
5. PM2 runs backend at `api.mep-projects.spereon.codes:4001`

## Migration from v1

```bash
cd server && npm run migrate   # preserves users + companies, wipes rest
```

## Users seeded

- `super` / `super123` — cross-company super admin
- `admin` / `admin123` — DEMO company admin
