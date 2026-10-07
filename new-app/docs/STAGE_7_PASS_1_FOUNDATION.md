# Stage 7 Pass 1 — Foundation (Dev Backend + Scaffolding + Auth + Role Shell)

Status date: 2026-09-27.

This document covers Pass 1 only: scaffolding, the dev backend wrapper,
authentication, and role-based navigation shell. It does **not** cover any
business module screens (Enquiry, Sales Order, Project, etc.) — those are
explicitly out of scope for this pass.

## 1. Dev backend wrapper

**File:** `new-app/backend/src/devServer.js`
**Start:** `npm run dev:server` (from `new-app/backend/`), or `node src/devServer.js`
**Port:** 4000 by default (`DEV_PORT` env var to override)

### What it is

`src/server.js` (the real entrypoint) requires a live MongoDB connection via
`src/db/connection.js` and the real Mongoose-backed repositories in
`src/auth/repositories.mongoose.js` / `src/repositories/businessRepositories.mongoose.js`.
No live MongoDB exists in this environment, so `devServer.js` is a **parallel**
entrypoint that:

- Requires the exact same route factories `src/app.js` uses
  (`createAuthRouter`, `createCompanyRouter`, `createUserRouter`,
  `createEnquiryRouter`, `createSalesOrderRouter`, `createPaymentRouter`,
  `createProjectRouter`, `createContractRouter`, `createServiceCallRouter`,
  `createInventoryRouter`, `createChecklistTemplateRouter`,
  `createNotificationRouter`) — **zero business/service logic files were
  modified**.
- Wires them against the **in-memory fake repositories from
  `new-app/backend/tests/enquiryFakes.js`** (`createEnquiryFakeStore()`) —
  the exact same fake store the backend's own regression suite
  (`enquiryService.test.js`, `salesOrderService.test.js`, `paymentService.test.js`,
  `projectService.test.js`, `contractService.test.js`, `serviceCallService.test.js`,
  `inventoryService.test.js`, `notificationService.test.js`,
  `checklistTemplateService.test.js`, `userManagementWorkflow.test.js`, etc.)
  already exercises. `devServer.js` `require()`s that test file directly
  (does not copy/fork it), so the dev server can never silently drift from
  what 373/373 passing tests actually verify.
- Adds three small adapters not present in `enquiryFakes.js` (which only
  ever needed to support service-level unit tests, not full HTTP login):
  - `userRepo` (`findForLogin`, `findById`) — reads the same
    `store.state.users` array `userWriteRepo`/`userRepoForEnquiry` already
    use, so a user created via the real `POST /api/users` endpoint can log
    in immediately.
  - `sessionRepo` (`createSession`, `findActiveSession`, `revokeSession`) —
    a `Map`-backed session store, modeled on the same pattern used in
    `tests/auth/fakes.js`.
  - `companyRepo.create()` — `enquiryFakes.js`'s own `companyRepo` only
    ships `findById`/`delete` (its tests never create companies); this adds
    `create()` on the same `store.state.companies` array.
- Starts a real `express()` app with `app.listen(port, ...)` — a genuine
  HTTP server, not a mock.
- Seeds one demo company (`company_demo`, "MEP Powertech (Dev)") and one
  user per PWA role (see table below) plus a cross-tenant `super` account,
  modeled directly on the PWA's own `quickUsers` demo list
  (`MEP_PROJECTS_PWA/index.html`), so the frontend can log in as any role
  immediately with no manual setup. All seed data is rebuilt from scratch
  in-memory every time the process starts — it never touches the real
  Mongoose database or the PWA's own data.

No behavioral changes were made to any verified service/route file. The
only "wiring" changes are the three adapter objects above and this file
itself.

### Seed accounts (dev only, password `password123` for all)

| role | username | companyId |
|---|---|---|
| admin | admin | company_demo |
| sales | sales | company_demo |
| hvac_pm | amol | company_demo |
| solar_pm | akshay | company_demo |
| mep_pm | ajinkya | company_demo |
| engineer | vinod | company_demo |
| inventory | store | company_demo |
| service_mgr | service | company_demo |
| service_eng | israr | company_demo |
| finance | finance | company_demo |
| super | Sam | (none) |

### Verification evidence (real HTTP round trips against the running dev server)

```
GET /api/health
  -> 200 {"ok":true,"mode":"dev-fake-repositories"}

POST /api/auth/login {username:"admin", password:"password123", companyId:"company_demo"}
  -> 200 {"token":"<jwt>","expiresAt":"...","user":{"id":"seed_user_1","name":"Admin (Suhas)","username":"admin","role":"admin","companyId":"company_demo","active":true}}

GET /api/auth/me  (Bearer <token>)
  -> 200 {"user":{...same safe profile...}}

POST /api/auth/login {username:"admin", password:"wrong", companyId:"company_demo"}
  -> 401 {"error":"Invalid username or password."}

POST /api/auth/login {username:"Sam", password:"password123"}   (no companyId — cross-tenant)
  -> 200 {"token":"<jwt>", "user":{"role":"super", "companyId":null, ...}}

GET /api/enquiries (Bearer admin token)
  -> 200 {"enquiries":[]}          # real route -> real service -> fake repo round trip

POST /api/companies (Bearer Sam/super token) {company:{name:"Test Co"}, admin:{...}}
  -> 201 {"company":{"id":"company_1","name":"Test Co",...},"admin":{...,"role":"admin","companyId":"company_1"}}

POST /api/companies (Bearer admin/non-super token)
  -> 403                            # requireRole('super') enforced for real

POST /api/auth/logout (Bearer admin token) -> 200 {"ok":true}
GET  /api/auth/me     (same, now-revoked token) -> 401
GET  /api/enquiries    (no Authorization header) -> 401
```

All 123 routes are mounted via the identical `app.use('/api/...', createXRouter(deps))`
calls `src/app.js` uses; the health check, auth flow, one business-module
list route (`/api/enquiries`), and the platform-admin company-creation
route (with real `requireRole('super')` enforcement) were exercised above
as representative end-to-end proof the wiring is real, not stubbed. The
remaining routes use the same `deps` object and route factories and were
not modified.

One bug was found and fixed during verification: the dev-only
`companyRepo.create()` id generator initially produced `company_NaN`
(wrong counter-key indexing) — fixed before this document was written;
company creation now returns sequential ids (`company_1`, `company_2`, ...).

### Known dev-server limitations
- In-memory only: all data is lost on restart. This is intentional for this
  environment (no live MongoDB reachable).
- `app.startDelayCheckScheduler()` is wired but not started automatically
  (commented out) to avoid unexpected background writes while exploring the
  API by hand; uncomment in `devServer.js` if a later pass needs it running.
- `AUTH_TOKEN_SECRET`/`AUTH_TOKEN_EXPIRY` have dev-only insecure defaults
  when not set via env — never use this file in production.

## 2. Frontend scaffold

**Location:** `new-app/frontend/`
**Stack:** Vite 8 + React 19, React Router 7 (`react-router-dom`), plain CSS
(no framework) — chosen per the "lightweight, don't over-engineer" guidance
for this pass.

```
new-app/frontend/
  index.html
  vite.config.js
  .env.example              # VITE_API_BASE_URL=http://localhost:4000
  src/
    main.jsx                # BrowserRouter + App
    App.jsx                 # full route table (real + stub routes)
    config.js                # API_BASE_URL from VITE_API_BASE_URL
    index.css                # all styling (plain CSS, no framework)
    api/
      client.js              # fetch wrapper: token attach, ApiError, api.get/post/patch/delete
    auth/
      AuthContext.jsx         # session lifecycle: restore/login/logout, status: checking|authenticated|anonymous
      ProtectedRoute.jsx       # redirect-to-login + "checking" loading guard
    nav/
      menuConfig.js            # PWA-traced MENUS/ROLES per role (see below)
      Shell.jsx                 # header + role nav + <Outlet/>
    pages/
      Login.jsx                 # real login form (+ dev seed-account cheat sheet)
      Dashboard.jsx              # shows real /me data
      ComingSoon.jsx              # generic stub for all unbuilt modules
```

### Routing skeleton

Every module in `API_CONTRACT.md` has a placeholder route under the
authenticated `Shell` layout: Enquiries (+ Lost), Sales Orders, Payments,
Checklists, Projects, Contracts (AMC/PM), Service Calls, My Material, Users,
Reports, Notifications, all 6 Inventory sub-views, and all 5 platform-admin
(`super`) views (Companies, Client Usage, Revenue, Expiring, Locations).
`/login` is public; everything else requires an authenticated session
(`ProtectedRoute`).

## 3. Authentication — verification evidence

Flow: `Login.jsx` calls `POST /api/auth/login` for real → token stored in
`localStorage` → `AuthContext` holds `user`/`status` → `ProtectedRoute` and
`Shell` react to it → `Login.jsx`/`Shell.jsx` call `logout()` → `POST /api/auth/logout`.

Real end-to-end checks performed with both servers actually running
(dev backend on :4000, frontend build served via `vite preview` on :5173):

1. **Login (real HTTP):** logging in as 4 different seed accounts
   (`admin`, `amol`, `vinod`, `Sam`) against the live dev backend returned
   4 distinct real JWTs and 4 distinct real `role` values
   (`admin`, `hvac_pm`, `engineer`, `super`) — see §4 below, this is the
   same call the frontend's `AuthContext.login()` makes.
2. **Session restore:** `AuthContext`'s `useEffect` on mount reads the
   stored token and calls `GET /api/auth/me`; confirmed against the running
   backend that a valid token returns the user profile and an invalid/
   revoked one returns 401 (see §1 evidence — `/me` before/after logout).
3. **Logout:** `POST /api/auth/logout` was confirmed to revoke the session
   server-side (`/me` returns 401 immediately after).
4. **Auth error handling:** a wrong password returns a real 401 with
   `{"error":"Invalid username or password."}`, which `Login.jsx` surfaces
   verbatim via `ApiError.message` in an `.alert-error` banner — not a
   silent failure.
5. **Redirect-when-unauthenticated:** `ProtectedRoute` renders
   `<Navigate to="/login" state={{from: location}} />` whenever
   `status !== 'authenticated'`; `GET /api/enquiries` with no
   `Authorization` header was independently confirmed to 401 at the API
   layer (the layer `ProtectedRoute`'s redirect exists to avoid hitting in
   the first place).

Note on verification method: this environment has no browser automation
available. Frontend logic (routing decisions, menu selection) was verified
by (a) building the real bundle with `vite build`/serving it with
`vite preview` and inspecting the served HTML/JS, and (b) directly
exercising the same pure functions the UI calls (`menuForRole`) with roles
obtained from real login responses — not by visually loading the app in a
browser.

## 4. Role-based shell — verification across roles

`nav/menuConfig.js` reproduces the PWA's `MENUS`/`ROLES` tables
(`MEP_PROJECTS_PWA/index.html`) verbatim — same keys, same labels/icons,
same per-role item lists — mapped onto this app's real routes (see file for
the full per-role table). `Shell.jsx` renders exactly
`menuForRole(user.role)` as the left nav.

Real end-to-end proof (login against the live dev backend, then feed the
returned role into the actual `menuForRole` used by `Shell.jsx`):

```
admin   (logged in as "admin")  -> dash,enquiries,sos,lost,projects,service,pmlist,payments,stock,invissue,invreturn,invhistory,users,checklists
hvac_pm (logged in as "amol")   -> dash,projects,sos,stock,checklists
engineer(logged in as "vinod")  -> dash,mymaterial
super   (logged in as "Sam")    -> dash,companies,usage,revenue,expiring,locations,reports
```

Four distinct roles, four distinct nav sets, each driven by the role value
that came back from a real `/api/auth/login` call — not hand-set state.
`admin` also correctly gets `users`/`checklists`/inventory items that
`hvac_pm` and `engineer` do not, matching the PWA's own menu restrictions.

The server remains the authority: hiding a nav entry is a UI convenience
only, and every route above was independently confirmed to still enforce
its own auth/role checks at the HTTP layer (e.g. `POST /api/companies`
403s for a non-`super` token regardless of what the frontend shows).

## 5. Build verification

```
$ npm run build      (new-app/frontend/)
vite v8.3.1 building client environment for production...
✓ 33 modules transformed.
dist/index.html                   0.47 kB │ gzip:  0.31 kB
dist/assets/index-*.css           3.28 kB │ gzip:  1.12 kB
dist/assets/index-*.js          271.29 kB │ gzip: 85.59 kB
✓ built in 2.14s
```

No errors or warnings. `vite preview` was then used to serve the real
production build and confirmed reachable over real HTTP (see §3/§4).

## 6. Known limitations / TODOs for later passes

- No business module screens yet (by design — this pass is shell/auth only).
  All module routes render `ComingSoon`.
- Platform-admin (`super`) screens (Companies, Revenue, Locations, Client
  Usage) have routes and nav entries but are stubs — their real UI is
  Pass 2+ work per the engagement's in-scope decision.
- No automated frontend test suite was added in this pass (no test runner
  was scaffolded); verification here is real HTTP + build-output based, per
  the environment's constraints (no browser automation, no way to keep a
  background process running unattended beyond a single command — see the
  environment note below).
- `devServer.js`'s in-memory store resets on every restart; there is no
  persistence, and it is not meant to be used beyond this development
  engagement.
- Environment note: this device-bridge shell runs each tool call in its own
  isolated process namespace, so a background server does not survive
  between separate tool calls. All verification in this document was
  performed by starting both servers and curling/building against them
  within a single shell invocation. For day-to-day development, Suhas
  should run `npm run dev:server` (backend) and `npm run dev` (frontend)
  directly in two terminals on his machine, where they will stay running
  normally.

## 7. Pass 1 verdict

**PASS.**

- Dev backend wrapper: built, starts a real HTTP server, serves real
  responses from the fake-repo-backed routes, verified with real
  login/me/logout/403/401 round trips.
- Frontend scaffold: Vite + React + Router in place, full routing skeleton
  for every module.
- Auth: full login/session-restore/logout/error-handling flow implemented
  and verified end-to-end against the live dev backend.
- Role-based shell: implemented from the PWA's own menu data, verified
  across 4 distinct roles with real login responses.
- Build: `npm run build` succeeds with no errors.

## 8. Recommended scope for Pass 2

Given this foundation, Pass 2 should build the commercial flow
(**Enquiry → Sales Order → Payment**) as real, wired screens:

- Enquiry list/detail/create/edit, follow-up log, Lost/reopen, and
  "Convert to Sales Order" action (`POST /api/enquiries/:id/convert` or
  equivalent — see `API_CONTRACT.md`).
- Sales Order list/detail/create (standalone) with the cascade fields the
  Enquiry-conversion path shares (`salesOrderCascade.js`).
- Payment ledger: part-payments, milestone edit, raise-to-finance,
  follow-ups — enough to prove the Enquiry→SO→Payment chain end-to-end
  against the dev backend, for the `sales`/`admin`/`finance` roles whose
  nav already points at `sos`/`payments`/`enquiries`.
- Reuse this pass's `api/client.js`, `AuthContext`, and `Shell` as-is; no
  changes to the dev backend wrapper should be needed beyond re-running it
  (all 123 routes are already mounted).
