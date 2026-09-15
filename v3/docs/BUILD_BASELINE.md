# BUILD_BASELINE — V3 Implementation Start

**Status:** Inspection only. No code written or modified by this pass except the new file you are reading and (per Step 17) the safe V3 foundation described at the bottom.
**Purpose:** Ground the V3 build in what actually exists in the repository today, before any implementation, per STEP 1 of the "V3 BUILD START" instruction.

---

## 1. Repository structure (top level, `C:\Projects\MEP-Projects`)

```
MEP-Projects/
├── index.html, App.js, index.js, sw.js, manifest.webmanifest, icons/   ← root-level single-file PWA (v1 prototype)
├── server/                                                              ← root-level API (v1.0.0) — superseded, not deployed
├── MEP_PROJECTS_PWA/                                                    ← legacy PWA folder
├── deploy/nginx/                                                        ← legacy deploy config (root-level)
├── v2/                                                                  ← LIVE PRODUCTION (server + web)
│   ├── server/          Express + Mongoose API, PM2 "mep-projects-api", port 4001
│   ├── web/              React 18 + Vite + Zustand SPA
│   ├── mobile/           Expo wrapper pointing at the same web build
│   └── deploy/           nginx-api.conf, nginx-web.conf, vps-install.sh
├── v3/                                                                  ← THIS BUILD
│   ├── docs/              16 architecture docs, rev 1–12, FINAL/FROZEN (see DOCUMENT_AUTHORITY.md)
│   ├── server/            empty scaffold dirs only (controllers, middleware, migrations, models, routes, services, utils)
│   ├── web/               empty scaffold dirs only (components, dashboards, pages, services, store, utils)
│   └── tests/             empty — no files yet
├── v3.zip                                                                ← an existing archive at repo root, presumably a snapshot; not touched
├── .git/                  local branches: `main` (current HEAD), `api-integration`; remote: origin/main only
├── package.json           root — Expo app "mep_projects_expo" (react-native/expo), unrelated to v2/v3 API work
└── node_modules/
```

**Key finding — three generations of backend coexist:**
1. **Root `server/`** — `mep-projects-api` v1.0.0, plain `index.js`, no PM2 config, simpler models. Not referenced by any nginx/PM2 config found. Treated as legacy/frozen, same as the root PWA files — never touched.
2. **`v2/server/`** — `mep-projects-api` v2.0.0 ("clean rewrite"), the actual live production API. Confirmed live by: `ecosystem.config.js` (PM2, port 4001) + `v2/deploy/nginx-api.conf` (proxies `api.mep-projects.spereon.codes` → `127.0.0.1:4001`) — this exact port and subdomain are what `v3/docs/LIVE_APP_SAFETY.md` and `API_ARCHITECTURE.md` name as the untouchable production target.
3. **`v3/server/`** — empty scaffold, nothing built yet. This is what STEP 17 populates.

---

## 2. V2 application structure (LIVE — read-only reference for this build)

### Backend (`v2/server/src/`)
```
index.js            Express app entry — helmet, cors, compression, JSON body parser, health check,
                     mounts /api/auth, /api/companies, /api/users, /api/projects, /api/service-calls,
                     /api/contracts, /api/payments, /api/enquiries, /api/sales-orders,
                     /api/notifications, /api/checklists, /api/inventory, /api/reports,
                     plus a hand-rolled /api/bulk (Promise.all fan-out across ~14 collections),
                     Socket.IO server on the same HTTP server, global error handler, SIGTERM handler.
config/db.js         mongoose.connect(MONGO_URI), strictQuery true, single shared connection/model registry.
middleware/auth.js    JWT auth() (Bearer token, verifies against User, attaches req.user, req.token),
                     requireRole(...roles) (role-enum gate; division-manager roles get admin-level route access),
                     ensureCompany() (forces req.body.co from req.user.co on POST, except super).
utils/scope.js        scopeFilter(user, resource, extra) — hand-written per-resource switch statement
                     building a Mongo filter from role/department/designation. No ownership concept.
utils/crud.js          buildCrud({model, resource, ...}) — generic CRUD router factory used by several
                     route files. LIST/GET scoped by company only; POST sets co from req.user.co;
                     PUT does findOneAndUpdate with no ownership check; DELETE does
                     findOneAndDelete — a HARD delete, no soft-delete triad, no audit trail.
routes/*.js            13 route files; several (payments.js, projects.js, etc.) hand-roll their own
                     GET/POST/PUT/DELETE instead of buildCrud, but follow the identical pattern:
                     company-scoped filter only, no ownership check, no audit log, hard delete.
models/*.js             14 Mongoose models (Company, User, Project, ServiceCall, Contract, Payment,
                     Enquiry, SalesOrder, Notification, Checklist, InvItem, InvCategory, InvLocation,
                     InvIssue, InvTransaction, Sequence). No `createdByUserId`, no `deletedAt`, no
                     audit metadata on any of them today.
websocket/sync.js       Socket.IO room broadcast helpers (broadcastUpdate/broadcastDelete), no
                     server-side authorization on socket events beyond initial connection auth.
scripts/                migrate.js, migrate-departments.js, seed.js — one-off/idempotent data scripts.
```

**Confirmed gap vs. the V3 rev 12 requirement:** V2 today has **no record ownership enforcement at all** — any authenticated user whose company/role/department passes `scopeFilter`/`requireRole` can edit or hard-delete any other user's record in that scope, including `Payment`. This is expected (V2 predates the ownership requirement) and is exactly the gap V3's `requireOwnership()` is designed to close — for V3-side collections only. **V2 is not being retrofitted** — this finding is recorded here only so V3's own enforcement isn't assumed to already exist anywhere in the shared codebase.

### Frontend (`v2/web/src/`)
React 18 + Vite + React Router 6 + Zustand + socket.io-client. `api/client.js` (fetch wrapper, presumably attaches JWT), `store/useStore.js` (Zustand global store), page-per-resource under `pages/`, shared `components/` (AppShell, Shell, ResourcePage, Charts, etc.), `utils/orgModel.js` + `utils/responsibilities.js` (role/department derivation helpers mirroring the backend's `ROLE_TO_DESDEP`).

### Mobile
`v2/mobile/` — thin Expo wrapper, same icon set as `v2/web/public/icons`. Not a separate codebase to track for V3 purposes.

---

## 3. Existing authentication (V2, live)

- JWT, `HS256` implied by `jsonwebtoken` default, secret from `process.env.JWT_SECRET` (fallback `'dev-secret-change-me'` for local dev only — **production must have this set**; V3 must read the **same** env var, never a new secret, per the frozen "v3 shares the same MongoDB and same JWT secret with v2" rule).
- `JWT_EXPIRES` default `30d`.
- Login issues token via `routes/auth.js` (not yet read in full this pass — file exists, 2.2KB).
- `auth()` middleware verifies token, loads `User` by `decoded.id`, strips `pw`, rejects disabled users.
- Passwords hashed with `bcryptjs` (10 rounds) in a `pre('save')` hook.

## 4. Existing authorization (V2, live)

- Legacy flat `role` enum (15 values: super/admin/hvac_pm/solar_pm/mep_pm/hvac_dm/solar_dm/mep_dm/engineer/service_eng/service_mgr/sales/store/accounts/viewer) is still the authoritative field read by `requireRole()`.
- A newer `designation`/`department`/`division` triad already exists on `User` (9 designations, 9 departments, 3 divisions) with a **bidirectional** `pre('validate')` derivation: role → designation/department when only role is set, and designation/department → role when those are set first. This is the exact resolver the frozen `ROLE_HIERARCHY.md` §5 "Compatibility resolver" describes — it already exists in V2, V3 does not need to invent it, only read from it.
- Authorization = `requireRole()` (coarse, route-level) + `scopeFilter()` (per-resource Mongo filter, hand-coded switch statement) + `ensureCompany()` (company isolation on POST). No fine-grained permission catalog, no entitlement check, no approval workflow, no ownership check exist in V2.
- `Company.divs[]` defaults to `['MEP', 'HVAC', 'Solar']` for every new company at the schema level (`Company.js` line 11) — this is V2's own legacy behavior, not a V3 fallback. It confirms why the frozen rule "no automatic legacy fallback (`company.divs || [SOLAR,MEP,HVAC]`)" exists: V3's entitlement layer must compute from `Subscription`/`DivisionEntitlement`/`FeatureEntitlement`/`AddOn` and treat `Company.divs[]` purely as a legacy-read signal, never as the source of truth, and never assume every legacy company actually purchased all three divisions just because the schema default says so.

## 5. Existing database models (V2, live — 14 collections, untouched by this build)

Company, User, Project, ServiceCall, Contract, Payment, Enquiry, SalesOrder, Notification, Checklist, InvItem, InvCategory, InvLocation, InvIssue, InvTransaction, Sequence. Shapes match what `V3_MIGRATION_MAP.md` already documents (confirmed by direct file inspection this pass, not just prior doc analysis) — no drift found between the frozen migration map's classification and the actual field lists.

## 6. Existing routes (V2, live)

`/api/auth`, `/api/companies`, `/api/users`, `/api/projects`, `/api/service-calls`, `/api/contracts`, `/api/payments`, `/api/enquiries`, `/api/sales-orders`, `/api/notifications`, `/api/checklists`, `/api/inventory`, `/api/reports`, plus `/api/bulk`. All under `/api/*`, unversioned. Matches `API_ARCHITECTURE.md`'s "Legacy (unchanged)" route list exactly.

## 7. Existing tests

**None found.** No test framework, no test files, anywhere in `v2/` or `v3/`. `v3/tests/` exists as an empty directory. This means V3's test-driven-safety requirement (STEP 15) starts from zero — there is no existing V2 test suite to run as a regression baseline before/after V3 changes, which raises the collision-risk profile of any future V2-adjacent work (there is nothing today that would catch an accidental V2 regression except manual verification).

## 8. Existing deployment configuration

- **v2 API:** PM2 process `mep-projects-api`, `v2/server/ecosystem.config.js`, fork mode, 1 instance, `NODE_ENV=production`, `PORT=4001`, 512M memory restart threshold, logs to `./logs/{error,out}.log`.
- **v2 nginx:** `api.mep-projects.spereon.codes` → `127.0.0.1:4001` (proxy, WS upgrade headers present, 20M body limit); a second `nginx-web.conf` (not yet read in full) presumably serves the Vite build.
- **v2 web:** Vite build (`npm run build`), served statically per `nginx-web.conf`.
- No V3 PM2 config exists yet. No V3 nginx config exists yet. `v3/docs/LIVE_APP_SAFETY.md` and `API_ARCHITECTURE.md` specify the target (port 4002, `api-v3.mep-projects.spereon.codes` / `v3.mep-projects.spereon.codes`) but nothing has been created on disk for it.

## 9. Existing environment variables (from `v2/server/.env.example` — the only env reference found; no live `.env` was read or will be read)

```
NODE_ENV, PORT (4001), MONGO_URI, JWT_SECRET, JWT_EXPIRES, CORS_ORIGIN
```
V3 must read `MONGO_URI` (same database, isolated Mongoose connection per the frozen rule) and `JWT_SECRET` (same secret) from the same source; it will need its own `PORT` (4002) and likely its own `.env` file under `v3/server/` that references the same Mongo URI and JWT secret rather than duplicating them, to avoid drift. No secret values were read or will ever be logged/exposed by this build.

## 10. Current Git status

- Local branches: `main` (current `HEAD`), `api-integration`.
- Remote: `origin/main` only (from `packed-refs`).
- Last commit on `main`: *"Simplify: HVAC/Solar/MEP as flat departments; Division only shown for Project Manager designation"* — consistent with the `User.js` designation/department/division model inspected above.
- No uncommitted-change listing was taken (git shell access was unavailable during this pass — see §12); a `git status` should be run and reviewed manually, or in the next session once shell access to the repo is confirmed, before any commit.
- **A dedicated V3 development branch does not yet exist.** Per STEP 16, one must be created before any code is committed. Recommended: branch from `main` (not `api-integration`, whose contents were not inspected this pass) — e.g. `v3-foundation`.

---

## 11. V3 isolation strategy (confirmed against actual repo, not just docs)

```
V2 (LIVE, untouched)                         V3 (new, isolated)
─────────────────────                        ────────────────────
v2/server/  (PM2 "mep-projects-api", :4001)   v3/server/  (new PM2 process, :4002)
v2/web/     (Vite build, nginx static)        v3/web/     (separate Vite build, own nginx)
Same MongoDB, v2's own Mongoose connection    Same MongoDB, ISOLATED mongoose.createConnection()
                                               (separate Model registry — avoids OverwriteModelError,
                                                per V3_MIGRATION_MAP.md §Ambiguity #6)
Same JWT_SECRET (read from same source)       Same JWT_SECRET (read-only reuse, never redefined)
/api/*  (unversioned)                         /api/v3/*  (versioned, additive)
```
This matches the frozen architecture exactly and is achievable without any V2 file changes: V3 gets its own `package.json`, its own `node_modules`, its own PM2 app definition, and its own Mongoose connection object, all living under `v3/server/`.

## 12. Potential V2/V3 collision risks (found by direct inspection this pass)

1. **Shared MongoDB, shared model names.** V2's Mongoose models are registered on the default `mongoose` connection under names like `'User'`, `'Company'`, `'Project'`. If V3 code ever calls `require('mongoose').model(...)` on the default connection instead of its own `createConnection()`-scoped registry, it will collide (`OverwriteModelError`) or — worse — silently share V2's exact schema/validation, since Node module caching means a naive V3 file that does `require('../../v2/server/src/models/Project')` gets V2's live model object, not a copy. **Mitigation (already frozen in docs, confirmed necessary by this inspection):** V3 must use its own `mongoose.createConnection()` and its own model registry from the first line of code — never `require()` a V2 model directly for anything that writes data.
2. **`Company.divs[]` legacy default.** Every V2-created company already has `divs: ['MEP','HVAC','Solar']` by schema default (§4 above) — a naive V3 entitlement read of this field would over-grant every legacy company all three divisions. V3's entitlement computation must never read `Company.divs[]` as a grant; only `Subscription`/`DivisionEntitlement`/`FeatureEntitlement`/`AddOn` are the source of truth, with `migrationReviewRequired=true` for anything ambiguous — this is already the frozen rule, now confirmed as necessary (not hypothetical) against the real schema.
3. **No ownership/audit exists anywhere in V2 to imitate.** V3's `requireOwnership()` and `AuditLog` are being built from scratch with no V2 precedent to reconcile against — lower collision risk (nothing to conflict with) but also means V3 cannot lean on any existing V2 utility for this; it must be original V3 code under `v3/server/`.
3a. **Hard delete is V2's only delete behavior.** If any future V3 code path is ever tempted to import/reuse V2's `buildCrud`/`crud.js` helper for convenience, it would silently reintroduce hard-delete and zero ownership checks into V3. **V3 must write its own CRUD/ownership-aware helper, never reuse `v2/server/src/utils/crud.js`.**
4. **Two other backend copies already exist in the repo (root `server/`, and presumably contents of `api-integration` branch, not yet inspected).** Risk is purely one of human/AI confusion — a future edit could target the wrong `server/` folder by mistake. **Mitigation:** every V3 file path in this build will be prefixed `v3/server/...` explicitly; V2 file operations are restricted to read/inspection only, never write, for the duration of this build.
5. **JWT secret and Mongo URI must be read, never redefined.** V3's own `.env` (to be created under `v3/server/`) must point at the same `MONGO_URI` and same `JWT_SECRET` value as `v2/server/.env` — these are operational secrets on the live machine and were not read/copied by this pass; the user (or a deploy script with file access) will need to populate `v3/server/.env` from the existing `v2/server/.env` (not the `.env.example` inspected here) before V3 can authenticate against real V2-issued tokens.
6. **No existing test suite** (§7) means there is no automated guardrail today that would catch a V3 change accidentally touching a V2 file path. This build's own STEP 15 test suite is additive and V3-scoped only; it does not and cannot replace a V2 regression suite that doesn't exist. Recommend flagging to the user, outside this build, that V2 having zero tests is itself a standing production risk independent of V3.

---

## Verification
- Read: root-level `package.json`, `CLAUDE.md`, `AGENTS.md`, `README.md`; `.git/HEAD`, `.git/packed-refs`, `.git/refs/heads/*`, `.git/COMMIT_EDITMSG`; `v2/server/package.json`, `ecosystem.config.js`, `.env.example`, `src/index.js`, `src/config/db.js`, `src/middleware/auth.js`, `src/utils/scope.js`, `src/utils/crud.js`, `src/models/User.js`, `src/models/Company.js`, `src/routes/payments.js`; `v2/web/package.json`; `v2/deploy/nginx-api.conf`, `nginx-web.conf` (listed, api conf read in full); root `server/package.json`, `server/index.js` (existence/version confirmed, not read line-by-line); full recursive directory listing of repo root, `server/`, `v2/`, `v3/`.
- Not read this pass (exists, not yet inspected): `v2/server/src/routes/auth.js` body, `v2/server/src/routes/{companies,contracts,enquiries,inventory,notifications,checklists,serviceCalls,salesOrders,users}.js`, `v2/server/src/models/{Checklist,Contract,Enquiry,InvCategory,InvIssue,InvItem,InvLocation,InvTransaction,Notification,Payment,SalesOrder,Sequence,ServiceCall}.js`, `v2/web/src/**` (beyond the file listing), root `server/` internals beyond `package.json`/`index.js`'s existence, contents of the `api-integration` git branch, `v3.zip`, `.claude/` folder contents, `v2/server/.env` (real secrets — intentionally not read).
- Wrote: this file only (`v3/docs/BUILD_BASELINE.md`). Zero V2 files touched. Zero V2 files modified. Zero destructive operations performed.
