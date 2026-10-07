# MEP New App — Deployment Preparation Report

**Date:** 2026-10-07 (Audit Update)
**Status:** READY FOR MANUAL VPS EXECUTION

---

## CURRENT VPS STATE

The old MEP V2 has **already been removed** from the VPS:
- PM2 process `mep-projects-api` removed, port 4001 freed
- `/var/www/mep-projects` removed
- Old Nginx configs (`mep-projects.conf`, `api-mep-projects.conf`) disabled
- Backup preserved at `/root/mep-old-backup/`
- Domain `mep-projects.spereon.codes` is now **available** for the new app

**Three existing applications MUST remain untouched:**

| PM2 Process | Path | Status |
|-------------|------|--------|
| `ems-backend` | `/var/www/employee-management-system` | Running — DO NOT TOUCH |
| `glampower` | `/var/www/glampower` | Running — DO NOT TOUCH |
| `spereon.codes` | `/var/www/spereon.codes` | Running — DO NOT TOUCH |

**MongoDB:** Access control is NOT enabled. The old `mep_projects` database must remain untouched.

---

## LOCAL PREPARATION

### Backend Tests
- **419/419 PASS** — all tests pass, zero failures

### Frontend Build
- **PASS** — `frontend/dist/index.html` exists
- **2 asset files** generated (JS + CSS)
- **No dev URLs** leaked in production build (`localhost:4000` not present)
- `VITE_API_BASE_URL=` (empty) — correct same-origin configuration

### Deployment Artifacts (pre-existing)
All 7 required deployment artifacts verified:

| File | Status |
|------|--------|
| `ecosystem.config.js` | Present — PM2 config, process `mep-new-app`, port 4000 |
| `nginx.conf.example` | Present — same-origin reverse proxy template |
| `deploy.sh` | Present — 5-step deployment script |
| `backend/.env.example` | Present — MONGODB_URI, AUTH_TOKEN_SECRET, AUTH_TOKEN_EXPIRY |
| `frontend/.env.production` | Present — `VITE_API_BASE_URL=` (empty) |
| `backend/src/server.js` | Present — production entry point, DB connect + Express start |
| `backend/src/app.js` | Present — full Mongoose-backed app, 17 route modules, health endpoint |

### Application Architecture Confirmed
- **Same-origin deployment**: frontend + API served from one domain via Nginx
- **No CORS middleware** needed (by design)
- **Backend port**: 4000 (port 4001 freed after V2 removal)
- **PM2 process name**: `mep-new-app` (unique, does not conflict with ems-backend/glampower/spereon.codes)
- **MongoDB database**: `mep_new_app` (separate from old `mep_projects`)
- **Domain**: `mep-projects.spereon.codes` (previously V2, now available)
- **Super Admin**: `companyId: null`, must be seeded directly in MongoDB
- **Plan seeding**: via `POST /api/subscriptions/plans/seed` (super-admin auth)
- **Company creation**: via `POST /api/companies` (creates company + admin user)

---

## SUPER ADMIN ACCESS VERIFICATION

### Authentication Flow — VERIFIED
- `authService.login()`: When `companyId` is null/omitted, looks up `{ role: 'super', username }` — **correct**
- `userRepo.findForLogin()`: `companyId ? { companyId, username } : { role: 'super', username }` — **correct**
- Token includes `companyId: null` for super admin — **correct**
- `verifySession()` returns `{ userId, companyId: null, role: 'super', sessionId }` — **correct**

### Middleware Behavior for Super Admin — VERIFIED
- `requireRole('super')`: Checks `req.auth.role` — super passes — **correct**
- `requireCompanyContext`: Allows super through (`role !== 'super'` guard) — **correct**
- `rejectClientSuppliedCompanyId`: Allows super through (`role === 'super'` exemption) — **correct**

### Route Access for Super Admin — VERIFIED

| Route | Middleware Chain | Super Admin Access |
|-------|-----------------|-------------------|
| `POST /api/auth/login` | (none) | **PASS** — login with `{username, password}` (no companyId) |
| `POST /api/subscriptions/plans/seed` | `authMiddleware → requireRole('super')` | **PASS** — no `requireCompanyContext` |
| `POST /api/companies` | `authMiddleware → requireRole('super')` | **PASS** — no `requireCompanyContext` |
| `GET /api/companies` | `authMiddleware → requireRole('super')` | **PASS** — list all companies |
| `POST /api/subscriptions/company/:id` | `authMiddleware → requireRole('super')` | **PASS** — assign subscription |
| `GET /api/subscriptions/my-divisions` | `authMiddleware → requireCompanyContext` | **N/A** — super has no company, but middleware lets super through |

### Deployment Seeding Order — VERIFIED
1. Seed super admin directly in MongoDB (bcrypt hash via app's bcryptjs)
2. Login as super admin → get token
3. `POST /api/subscriptions/plans/seed` with token → seeds 7 default plans (idempotent)
4. `POST /api/companies` with token → creates company + admin user
5. `POST /api/subscriptions/company/:companyId` with token → assigns plan to company
6. Login as company admin → full application access

---

## DEPLOYMENT FILES

All 6 required files under `new-app/deployment/`:

| File | Lines | Purpose |
|------|-------|---------|
| `VPS_DEPLOYMENT_GUIDE.md` | ~560 | Complete step-by-step manual runbook (§1–§13) |
| `deploy-new-app.sh` | ~462 | Main deployment script with safety checks and confirmations |
| `health-check-new-app.sh` | ~275 | Post-deployment health/security/tenant/protected-systems verification |
| `rollback-new-app.sh` | ~133 | Safe rollback affecting only the new app |
| `nginx-new-app.conf.example` | ~62 | Separate Nginx server block with `NEW_APP_DOMAIN` placeholder |
| `production.env.example` | 24 | Production environment template |

### deploy-new-app.sh Audit — PASS

| Check | Result |
|-------|--------|
| `set -euo pipefail` | **PASS** — fails on errors |
| Safety checks (Node, npm, PM2, Nginx) | **PASS** |
| Displays hostname for VPS confirmation | **PASS** |
| Inspects current PM2 processes | **PASS** — shows all, touches only `mep-new-app` |
| Port 4000 occupancy check | **PASS** |
| Target directory inspection | **PASS** |
| Explicit `YES` confirmation | **PASS** |
| Timestamped backups | **PASS** — app, Nginx configs, PM2 list |
| `rsync --delete` excludes `.env`, `node_modules`, `logs`, `dist` | **PASS** |
| `npm ci --production` with fallback | **PASS** |
| Frontend build + verification | **PASS** — checks `dist/index.html`, asset count, no dev URLs |
| `.env` validation (MONGODB_URI, AUTH_TOKEN_SECRET) | **PASS** — rejects placeholder values |
| PM2 start/restart only `mep-new-app` | **PASS** — uses `pm2 describe` to decide start vs restart |
| Health endpoint verification | **PASS** |
| Nginx config via `sed` replacement | **PASS** — `nginx -t` before reload |
| References ems-backend/glampower/spereon.codes as protected | **PASS** (updated) |
| Does NOT `rm`, `kill`, `stop` any other process | **PASS** — verified by full script read |

### health-check-new-app.sh Audit — PASS

| Check | Result |
|-------|--------|
| Infrastructure: disk, RAM, port, PM2, Nginx | **PASS** |
| Backend: health endpoint `200`, body `{ok:true}` | **PASS** |
| Security: unauthenticated → `401`, invalid token → `401` | **PASS** |
| Frontend: `dist/index.html`, assets count | **PASS** |
| Domain (optional): HTTP, HTTPS, API health, frontend HTML | **PASS** |
| Protected systems: ems-backend, glampower, spereon.codes paths | **PASS** (updated) |
| Protected systems: PM2 status of other apps | **PASS** (updated) |
| No destructive commands | **PASS** — read-only checks only |

### rollback-new-app.sh Audit — PASS

| Check | Result |
|-------|--------|
| Stops only `mep-new-app` PM2 process | **PASS** |
| Removes only `/etc/nginx/sites-enabled/mep-new-app` symlink | **PASS** |
| `nginx -t` before reload | **PASS** |
| Optional backup restore with confirmation | **PASS** |
| Does NOT touch ems-backend, glampower, spereon.codes | **PASS** (updated) |
| Does NOT drop `mep_new_app` database (manual only) | **PASS** |
| `set -uo pipefail` (no `set -e` — intentional for rollback) | **PASS** |

### nginx-new-app.conf.example Audit — PASS

| Check | Result |
|-------|--------|
| `NEW_APP_DOMAIN` placeholder (actual: `mep-projects.spereon.codes`) | **PASS** |
| HTTP only (certbot adds HTTPS) | **PASS** |
| `/api/` → `http://127.0.0.1:4000` | **PASS** |
| SPA fallback: `try_files $uri $uri/ /index.html` | **PASS** |
| Root: `/var/www/mep-new-app/frontend/dist` | **PASS** |
| Static asset caching (30d, immutable) | **PASS** |
| `client_max_body_size 10m` | **PASS** |
| Gzip enabled | **PASS** |
| No reference to other sites | **PASS** |

### production.env.example Audit — PASS

| Check | Result |
|-------|--------|
| `MONGODB_URI=mongodb://127.0.0.1:27017/mep_new_app` | **PASS** |
| `MONGODB_DB_NAME=mep_new_app` | **PASS** |
| `AUTH_TOKEN_SECRET=` (empty, must be filled) | **PASS** |
| `AUTH_TOKEN_EXPIRY=15m` | **PASS** |
| `PORT=4000` | **PASS** |
| Does NOT reference V2 database | **PASS** |

### VPS_DEPLOYMENT_GUIDE.md Audit — PASS

| Check | Result |
|-------|--------|
| Overview table reflects current VPS state | **PASS** (updated) |
| §2 Discovery: checks for three existing apps | **PASS** (updated) |
| §4 MongoDB: creates `mep_new_app` only, warns about old DB | **PASS** (updated) |
| §4 MongoDB security note added | **PASS** (updated) |
| §5 Deploy: runs deploy script only | **PASS** |
| §6 HTTPS: notes existing SSL cert may be reusable | **PASS** (updated) |
| §7 Super Admin: bcrypt via app's own bcryptjs, mongosh insert | **PASS** |
| §8 Plan seed: idempotent, super-admin auth | **PASS** |
| §9 Company creation: company + admin in one call | **PASS** |
| §10 Smoke tests: comprehensive API coverage | **PASS** |
| §11 PM2 persistence: `pm2 save && pm2 startup` | **PASS** |
| §12 Rollback: references three existing apps | **PASS** (updated) |
| §13 Log inspection | **PASS** |
| No references to old V2 as "existing" | **PASS** (updated) |

---

## MONGODB SECURITY

| Concern | Status |
|---------|--------|
| Access control not enabled | **WARNING** — documented in guide with remediation steps |
| Old `mep_projects` database | **PROTECTED** — guide warns against touching it |
| New `mep_new_app` database | **ISOLATED** — separate database, separate MONGODB_URI |
| Post-deployment hardening steps | **DOCUMENTED** — enable auth, create dedicated user |

---

## VARIABLES YOU MUST SET

| Variable | Where to Set | Value |
|----------|-------------|-------|
| `NEW_APP_DOMAIN` | Deploy script prompt | `mep-projects.spereon.codes` |
| `MONGODB_URI` | `backend/.env` | `mongodb://127.0.0.1:27017/mep_new_app` |
| `AUTH_TOKEN_SECRET` | `backend/.env` | Generate: `openssl rand -hex 48` |
| `AUTH_TOKEN_EXPIRY` | `backend/.env` | `15m` |
| `PORT` | `backend/.env` | `4000` |
| Super Admin password | MongoDB seed step | Your chosen password (min 8 chars) |
| Company Admin password | API call | Your chosen password |

**No `NEW_APP_API_DOMAIN` is required** — the architecture uses same-origin (frontend and API on one domain).

---

## VPS EXECUTION ORDER

1. **Upload** `new-app/` to VPS (scp/rsync/git)
2. **Discover** — run read-only VPS inspection commands (Guide §2)
3. **Verify existing apps** — confirm ems-backend, glampower, spereon.codes are online
4. **Backup** — create timestamped backups (Guide §3)
5. **MongoDB** — create `mep_new_app` database (Guide §4)
6. **Deploy** — run `sudo bash deployment/deploy-new-app.sh` (Guide §5)
7. **Create `.env`** — when prompted by deploy script (Guide §5)
8. **DNS** — point `mep-projects.spereon.codes` to VPS IP (may already point there)
9. **HTTPS** — `sudo certbot --nginx -d mep-projects.spereon.codes` (Guide §6)
10. **Super Admin** — seed in MongoDB (Guide §7)
11. **Seed Plans** — `POST /api/subscriptions/plans/seed` (Guide §8)
12. **Create Company** — `POST /api/companies` (Guide §9)
13. **Assign Subscription** — `POST /api/subscriptions/company/:companyId` (Guide §9)
14. **Smoke Test** — run `bash deployment/health-check-new-app.sh mep-projects.spereon.codes` (Guide §10)
15. **PM2 Persist** — `pm2 save && pm2 startup` (Guide §11)
16. **Log Check** — inspect PM2 and Nginx logs (Guide §13)

---

## ROLLBACK

```bash
# VPS
sudo bash deployment/rollback-new-app.sh
```

Affects ONLY:
- `mep-new-app` PM2 process → stopped
- `mep-new-app` Nginx server block → disabled
- Optionally restores from backup

Does NOT affect:
- `/var/www/employee-management-system` (ems-backend)
- `/var/www/glampower` (glampower)
- `/var/www/spereon.codes` (spereon.codes)
- Existing PM2 processes (ems-backend, glampower, spereon.codes)
- Any existing MongoDB databases

MongoDB `mep_new_app` database is preserved (manual drop only if desired).

---

## PROTECTED SYSTEMS

| System | Status |
|--------|--------|
| `ems-backend` PM2 + `/var/www/employee-management-system` | **Untouched** — scripts only manage `mep-new-app` |
| `glampower` PM2 + `/var/www/glampower` | **Untouched** — no references in any script |
| `spereon.codes` PM2 + `/var/www/spereon.codes` | **Untouched** — no references in any script |
| MongoDB `mep_projects` database | **Untouched** — new app uses separate `mep_new_app` |
| Old V2 backup at `/root/mep-old-backup/` | **Untouched** — not referenced by any script |
| Reference documents (6 files) | **Untouched** — read-only, not modified |
| Local directories: V2 (`v2/`), V3 (`v3/`), PWA (`MEP_PROJECTS_PWA/`) | **Untouched** — on user's machine only |

No deployment script touches any protected system. Verified by full script audit.

---

## AUDIT SUMMARY

| Category | Result |
|----------|--------|
| Backend tests (419/419) | **PASS** |
| Frontend build | **PASS** |
| Super admin auth flow | **PASS** |
| Super admin route access (plans, companies, subscriptions) | **PASS** |
| deploy-new-app.sh safety | **PASS** |
| health-check-new-app.sh coverage | **PASS** |
| rollback-new-app.sh isolation | **PASS** |
| nginx-new-app.conf.example correctness | **PASS** |
| production.env.example completeness | **PASS** |
| VPS_DEPLOYMENT_GUIDE.md accuracy | **PASS** |
| Protected systems isolation | **PASS** |
| MongoDB security documentation | **PASS** (warning documented) |
| Domain configuration | **PASS** — `mep-projects.spereon.codes` |
| SSL certificate reuse documented | **PASS** |

---

## STATUS

**READY FOR MANUAL VPS EXECUTION**

All 6 deployment files audited and updated. All scripts verified safe — they touch only `mep-new-app` resources and explicitly protect all other VPS applications.
