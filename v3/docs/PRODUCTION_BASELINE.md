# MEP PROJECTS — v2 Deep Repository Analysis

**Generated:** 2026-08-28
**Scope:** Read-only analysis of existing v2 code (`C:\Projects\MEP-Projects\v2\`).
**⚠️ LIVE PRODUCTION APPLICATION — Zero files modified during this analysis.**

---

## A. Application Architecture

**Type:** Multi-tenant SaaS for MEP (Mechanical/Electrical/Plumbing) contracting firms
**Pattern:** SPA React frontend + REST/WebSocket Node.js backend + MongoDB
**Version:** 2.0.0 (v2 clean rewrite)

**Stack:**
- **Frontend:** React 18.3.1 + React Router v6 + Zustand 5.0.1 + Vite 5.4.10 + Socket.io-client 4.7.5
- **Backend:** Node.js + Express 4.21.2 + Mongoose 8.12.1 + Socket.io 4.7.5
- **Security:** JWT (30-day expiry), bcryptjs, helmet, cors, express-rate-limit
- **File processing:** ExcelJS 4.4.0 (reports)
- **Database:** MongoDB `mep_projects` on VPS (127.0.0.1:27017)

**Deployment:**
- VPS: `srv1846527` at `/var/www/mep-projects/`
- PM2 process: `mep-projects-api` (id 7, port 4001)
- Nginx: `mep-projects.spereon.codes` (web) + `api.mep-projects.spereon.codes` (API)
- Other apps on same VPS (untouched): ems-backend, glampower, spereon.codes

---

## B. Folder Structure

```
v2/
├── server/
│   ├── package.json
│   ├── ecosystem.config.js       (PM2)
│   ├── .env.example
│   └── src/
│       ├── index.js              (Express app + bulk endpoint)
│       ├── config/db.js
│       ├── middleware/auth.js    (JWT verify, requireRole, ensureCompany)
│       ├── models/               (12 Mongoose schemas)
│       ├── routes/               (13 route files)
│       ├── scripts/              (seed.js, migrate.js, migrate-departments.js)
│       ├── utils/
│       │   ├── crud.js           (Generic CRUD helper)
│       │   ├── notify.js         (Notification broadcaster)
│       │   └── scope.js          (Department-based data scoping — NEW)
│       └── websocket/sync.js     (Socket.io setup, room per company)
├── web/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── public/
│   │   ├── icons/, manifest.webmanifest
│   │   └── sw.js                 (Service worker kill-switch)
│   └── src/
│       ├── main.jsx, App.jsx
│       ├── api/client.js         (Fetch wrapper + JWT header)
│       ├── api/socket.js         (Socket.io client)
│       ├── components/
│       │   ├── AppShell.jsx      (Wrapper: flat sidebar for super)
│       │   ├── Shell.jsx         (Main shell with grouped/role-based sidebar)
│       │   ├── Modal.jsx, Toast.jsx, Charts.jsx
│       │   ├── ReportDownload.jsx  (NEW - report generator UI)
│       │   ├── ResourcePage.jsx    (Generic list page)
│       │   ├── ResponsibilitiesCard.jsx
│       │   └── SubscriptionFields.jsx
│       ├── config/superAdminMenu.js  (Flat menu for super)
│       ├── store/useStore.js         (Zustand global state)
│       ├── styles/app.css
│       ├── utils/
│       │   ├── orgModel.js       (Designations, Departments, Divisions — NEW)
│       │   ├── responsibilities.js (Role → ROLE_META)
│       │   └── reports.js
│       └── pages/                (16 page components)
├── deploy/                       (Nginx configs, VPS install script)
└── mobile/                       (Expo app — not currently deployed)
```

---

## C. Module Map (Frontend Page → API → Model)

| Module | Page | Route | API Base | Model | Notes |
|---|---|---|---|---|---|
| Login | `Login.jsx` | `/` (when !user) | `POST /api/auth/login` | User | JWT returned |
| Dashboard | `Dashboard.jsx` | `/` | `GET /api/bulk` | *all* | Aggregated stats |
| Users | `Users.jsx` | `/users/*` | `/api/users` | User | Admin-only |
| Companies | `Companies.jsx` | `/companies/*` | `/api/companies` | Company | Super-only |
| Enquiries | `Enquiries.jsx` | `/enquiries/*` | `/api/enquiries` | Enquiry | Log, convert, lost, reopen |
| Lost Enquiries | `LostEnquiries.jsx` | `/lost-enquiries` | `/api/enquiries?status=lost` | Enquiry | Filtered view |
| Sales Orders | `SalesOrders.jsx` | `/sales-orders/*` | `/api/sales-orders` | SalesOrder | Auto-numbered |
| Projects | `Projects.jsx` | `/projects/*` | `/api/projects` | Project | Chk, updates, dc |
| Checklists | `Checklists.jsx` | `/checklists/*` | `/api/checklists` | Checklist | Templates per division |
| Inventory | `Inventory.jsx` | `/inventory/*` | `/api/inventory/{items,categories,locations,issues,transactions}` | InvItem, InvCategory, InvLocation, InvIssue, InvTransaction | Stock, Issue, Returns, Log |
| Service Calls | `ServiceCalls.jsx` | `/service-calls/*` | `/api/service-calls` | ServiceCall | Assigned engineers |
| Contracts / AMC | `Contracts.jsx` | `/contracts/*` | `/api/contracts` | Contract | Scheduled visits (svcs[]) |
| Payments | `Payments.jsx` | `/payments/*` | `/api/payments` | Payment | Multi-payment tracking |
| Notifications | `Notifications.jsx` | `/notifications` | `/api/notifications` | Notification | Read/unread, roles filter |
| Reports | `Reports.jsx` | `/reports` | `/api/reports/download` | (any) | XLSX/CSV export |
| Super Analytics | `SuperAnalytics.jsx` | `/analytics/*` | `/api/bulk` (client-side aggregate) | Company + others | Super-only |

---

## D. Role Map

**Legacy `role` enum** (still stored on User docs):
```
super, admin, hvac_pm, solar_pm, mep_pm, hvac_dm, solar_dm, mep_dm,
engineer, service_eng, service_mgr, sales, store, accounts, viewer
```

**New `designation` + `department` + `division` fields** (added on top; role is auto-derived):
- Designations: `super_admin, company_admin, manager, project_manager, senior_engineer, engineer, executive, technician, viewer`
- Departments: `ADMIN, PROJECTS, HVAC, SOLAR, MEP, SERVICE, SALES, STORE, ACCOUNTS`
- Divisions (only for Project Manager): `HVAC, SOLAR, MEP`

**Role permission summary:**

| Role | Sidebar | Data Scope |
|------|---------|------------|
| `super` | Flat (Companies, Analytics, Revenue, Expiring, Locations, Reports) | ALL companies |
| `admin` | Full company menu incl. Users | Their company |
| `hvac_dm` / `solar_dm` / `mep_dm` | Full menu MINUS Users | Company data filtered by division |
| `hvac_pm` / `solar_pm` / `mep_pm` | Projects, SO, Stock, Checklists | Own division projects only |
| `sales` | Dashboard, Enquiries, Quotations, SO, Lost | Company enquiries/SO |
| `service_mgr` | Dashboard, Service Calls, AMC/PM, Stock | Company service data |
| `service_eng` | My Service Jobs, My Material | Own assigned jobs only |
| `store` | Inventory sections | Company inventory |
| `accounts` | Dashboard, Pending Payments, Sales Orders | Company payments |
| `engineer` | My Work, My Material | Own assigned projects |
| `viewer` | Dashboard, Reports | Read-only |

---

## E. Permission Map

**Enforcement layers:**
1. **`auth()` middleware** — verifies JWT, loads user
2. **`requireRole(...roles)`** — allows super always; DM roles = admin; else roles.includes(user.role)
3. **`ensureCompany()`** — POST must have `co` (super supplies, others auto-fills)
4. **`scopeFilter(user, resource, extra)`** — MongoDB query filter by division/dept/assignment (utils/scope.js)
5. **Route-level checks** — most routes trust `req.user.co` from auth

**Currently protected routes (requireRole):**
- `POST /api/users` — admin
- `PUT /api/users/:id` — admin
- `DELETE /api/users/:id` — admin
- `PUT /api/companies/:id` — admin
- `DELETE /api/companies/:id` — admin

**All other routes are role-agnostic** — they rely on company scoping via `req.user.co`.

---

## F. API Map (Route → Method → Purpose)

### `/api/auth`
- `POST /login` — Rate-limited (loginLimiter)
- `GET /me`
- `POST /change-password`

### `/api/companies`
- `GET /` `GET /:id` `POST /` `PUT /:id` (admin) `DELETE /:id` (admin)

### `/api/users`
- `GET /` `GET /:id` `POST /` (admin) `PUT /:id` (admin) `DELETE /:id` (admin)

### `/api/projects`
- `GET / :id`, `POST /`, `PUT /:id`, `PATCH /:id/chk/:idx`, `POST /:id/updates`, `POST /:id/dc`, `DELETE /:id`

### `/api/service-calls`
- Full CRUD

### `/api/contracts`
- Full CRUD + `PATCH /:id/svcs/:idx` (mark visit done) + `POST /notify-checks`

### `/api/payments`
- Full CRUD + `POST /:id/paid` (record payment)

### `/api/enquiries`
- Full CRUD + `/:id/log`, `/:id/lost`, `/:id/reopen`, `/:id/convert` (→ SalesOrder)

### `/api/sales-orders`
- Full CRUD

### `/api/notifications`
- `GET`, `POST`, `PATCH /:id/read`, `PATCH /read-all`, `DELETE /:id`

### `/api/checklists`
- Full CRUD

### `/api/inventory`
- Items via generic CRUD (bulk endpoint)
- `GET/POST /issues`, `PUT /issues/:id`, `POST /issues/:id/return-request`, `PATCH /issues/:id/return-request/:reqId`, `PATCH /issues/:id/consume`
- `GET/POST /transactions`

### `/api/reports`
- `GET /download?module=&period=&format=&from=&to=&co=&division=` — XLSX/CSV export
- `GET /modules` — list report types available for current user

### `/api/bulk`
- `GET` — returns all resources for user's company scope (initial app load) with division-filtered inventory

---

## G. Database Model Map

| Model | Key Fields | Indexes | Company Scoped |
|-------|-----------|---------|----------------|
| **Company** | name, code, address, phone, email, gstin, logo, divs[], disabled, meta | name, code, disabled | N/A (is the tenant) |
| **User** | co, un, pw, name, role, designation, department, division, employeeId, createdBy, email, phone, disabled | co, un, role, designation, department, division, disabled, (co+department) | ✓ (co, super has none) |
| **Enquiry** | co, client, contact, phone, email, source, subject, desc, status, value, owner, log[] | co, status | ✓ |
| **SalesOrder** | co, no, date, client, contact, items[], subtotal, tax, total, status, notes | co, no, status | ✓ |
| **Project** | co, code, name, client, site, div, status, start, target, value, pm, engs[], chk[], updates[], dc[], notes, meta | co, code, status, div | ✓ |
| **ServiceCall** | co, psc, client, site, contact, phone, type, priority, status, eng, scheduled, desc, actions, parts[], closedAt, meta | co, psc, type, status, eng | ✓ |
| **Contract** | co, no, client, site, type, start, end, value, freq, status, svcs[], notes | co, no, status | ✓ |
| **Payment** | co, client, project, invNo, invDate, amount, due, status, paid[], notes | co, status | ✓ |
| **Checklist** | co, name, div, desc, items[] | co, div | ✓ |
| **Notification** | co, title, body, type, link, roles[], read[] | co+createdAt | ✓ |
| **InvCategory** | co, name, desc | co | ✓ |
| **InvLocation** | co, name, address | co | ✓ |
| **InvItem** | co, code, name, cat, unit, qty, minQty, rate, location, division, desc | co, code, name, cat, division | ✓ |
| **InvIssue** | co, staff, site, project, location, items[], status, notes, issuedBy, returnRequests[] | co, staff, status | ✓ |
| **InvTransaction** | co, item, type, qty, rate, ref, by, notes | co, item, type, (co+item+createdAt) | ✓ |
| **Sequence** | co, key, seq | (co+key unique) | ✓ (Auto-increment) |

---

## H. Frontend → Backend Dependency Map

```
Login.jsx → useStore.login(un, pw) → api.post('/api/auth/login') → routes/auth.js#login → User.comparePw
    ↓ [success]
App.jsx → restoreSession() → api.get('/api/auth/me') → routes/auth.js#me
    ↓
Shell.jsx → MENUS[user.role] → NavLinks
    ↓
useStore.loadBulk() → GET /api/bulk → parallel fetch of all resources
    ↓
Individual pages read from useStore state (reactive)
    ↓
CRUD operations → api.{get,post,put,del} → route → model.{find,save,update,delete}
    ↓
Backend broadcasts via websocket/sync.js#broadcastUpdate → all connected clients
    ↓
socket.js updates useStore in place
```

---

## I. Current Sidebar Map

**Super admin (via AppShell → superAdminMenu.js — FLAT):**
- 🏠 Dashboard, 🏢 Companies, 📈 Analytics, 💵 Revenue, ⏳ Expiring, 📍 Locations, 📊 Reports

**All other roles (via Shell.jsx MENUS[role] — FLAT):**
Each role has a hard-coded array of `{ to, label, icon }` items.
- `admin` — 14 items (all modules + Users)
- `hvac_dm` / `solar_dm` / `mep_dm` — 14 items (all modules minus Users)
- `hvac_pm` / `solar_pm` — 5 items (Projects, SO, Stock, Checklists)
- `mep_pm` — 4 items (Projects, SO, Checklists)
- `sales` — 4 items
- `service_mgr` — 4 items
- `service_eng` — 2 items
- `store` — 7 items (Inventory-focused)
- `accounts` — 3 items
- `engineer` — 2 items
- `viewer` — 2 items

**Bug/Note:** `AppShell.jsx` is imported into `App.jsx` under alias `Shell`; AppShell delegates to Shell for non-super roles.

---

## J. Current Dashboard Map

**`Dashboard.jsx` reads from useStore:**
- Aggregates: total enquiries, projects, service calls, contracts (per user's scope)
- Charts: `Charts.jsx` uses inline SVG for bar/pie
- Different card layouts per role (via `if isSuper` / `if isAccount` etc.)
- Super Admin gets `SuperAnalytics` on `/analytics/*` route (4 tabs: Client Business, Revenue, Expiring, Locations)

---

## K. Current Workflows

### 1. **Enquiry → SalesOrder → Project → Payment**
- Enquiry (new → contacted → quoted → won/lost)
- `POST /enquiries/:id/convert` creates SalesOrder
- (Manual) Create Project referencing Sales Order
- Payments log invoices against Project

### 2. **Service Call → Contract**
- Service Call (open → assigned → inprogress → closed)
- Recurring visits tracked in Contract.svcs[]
- `PATCH /contracts/:id/svcs/:idx` marks visit done

### 3. **Inventory Issue → Return → Consume**
- Issue: create InvIssue with items[]
- Return request: `POST /issues/:id/return-request`
- Handle return: `PATCH /issues/:id/return-request/:reqId`
- Consume: `PATCH /issues/:id/consume`
- Auto-creates InvTransaction records

### 4. **Auto-numbering (Sequence)**
- Sequence.next(co, key) atomic increment
- SalesOrder.no comes from Sequence('so')

### 5. **Bulk Load on Login**
- After login, useStore.loadBulk() fetches everything via `GET /api/bulk`
- Subsequent updates come via WebSocket

---

## L. Production-Risk / Protected Areas

**⛔ DO NOT MODIFY WITHOUT MIGRATION + TESTING:**

1. **User model role enum** — Adding roles is OK; removing/renaming breaks existing users
2. **JWT secret / expiry** — Changing invalidates all sessions
3. **Company model divs default** — `['MEP', 'HVAC', 'Solar']` referenced across UI
4. **Sequence key names** (`so`) — Renaming breaks numbering continuity
5. **`co` field on ALL models** — Removing breaks multi-tenancy
6. **WebSocket room naming (`co:{coId}`)** — Frontend/backend must match
7. **`/api/bulk` shape** — useStore expects exact key names
8. **Password field name `pw`** — Model + auth + routes all reference
9. **User.pre('validate')** hook — auto-derives role from designation/department; changing breaks new signups
10. **Nginx configs** — `mep-projects.spereon.codes` production domain

**⚠️ DEPRECATED / TECHNICAL DEBT:**

1. `/api/enquiries/:id/convert` creates SalesOrder without linking back to Enquiry (no FK)
2. Project.pm and Project.engs are `String` (staff names), not `ObjectId` refs
3. ServiceCall.eng is String (name), not User FK
4. No `quotations` model exists yet (referenced in sidebars for _dm roles but no page/route/model)
5. No `customers` model (referenced in _dm sidebars)
6. `checklists` model has `div` but no explicit HVAC/Solar/MEP mapping to Company.divs
7. Payment.paid[] doesn't validate total against Payment.amount
8. No audit log persistence (only WebSocket broadcasts)

**🕳️ UNKNOWN / NOT YET IMPLEMENTED IN ROUTES:**
- Sidebar shows `/customers/*` and `/quotations/*` for `hvac_dm/solar_dm/mep_dm` but no pages, routes, or models exist. Clicking → 404 Redirect to `/`.

---

## M. Recommended Safe Extension Points

1. **New modules** — Follow the established pattern:
   - Create Model in `server/src/models/`
   - Create Route in `server/src/routes/` (mount in `index.js`)
   - Add to bulk endpoint if needed
   - Add page in `web/src/pages/`
   - Add route in `App.jsx`
   - Add menu item to `Shell.jsx` MENUS[role]
   - Add store slice in `useStore.js` (pathFor + RESOURCE_MAP)

2. **v3 additions** — Build alongside v2:
   - Put new server routes under `/api/v3/*` OR use fresh `v3/server`
   - Share the same MongoDB (models compatible with both)
   - Share the same JWT (users log in once, both v2 and v3 recognize token)
   - Share the same Company/User collections

3. **Company scoping** — Use `req.user.co` (auto-set by auth middleware)

4. **Role-based UI** — Reference `user.role`, `user.designation`, `user.department`, `user.division`

5. **Real-time updates** — Emit via `websocket/sync.js#broadcastUpdate(io, coId, resource, doc)`

6. **Reports** — Extend MODULES in `reportsDownload.js`

---

## N. Unknowns / Areas Requiring Further Inspection

1. **`Reports.jsx`** — Not read in detail; may have its own logic
2. **`SuperAnalytics.jsx`** — Detailed calculations not audited
3. **`InvIssue` consumption logic** — Return→Consume workflow bug potential
4. **Mobile app (`/mobile/`)** — Expo app present, unclear if actively used
5. **`MEP_PROJECTS_PWA/`** — Legacy PWA at repo root, unclear relationship to v2
6. **`sw.js` at repo root** — Old service worker; new kill-switch at `v2/web/public/sw.js`
7. **Old `/server` dir at repo root** — Separate from `v2/server`, purpose unclear (possibly legacy)
8. **Notification.roles filter** — Frontend may or may not honor this
9. **`checklist.div`** — Not clear if enforced against user's division
10. **exceljs installed on VPS?** — Recently added; requires `npm install` on VPS server

---

## Verification: No Files Modified

The following read-only operations were performed:
- `ls -la`, `cat`, `grep`, `find`, `wc -l` — all read-only
- **Zero writes, zero installs, zero database queries executed**

Directory `v3/` is empty and ready for new development.
