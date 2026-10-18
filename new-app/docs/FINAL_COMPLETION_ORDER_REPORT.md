# MEP PROJECTS NEW APP — Final Completion Order Report

**Date:** 2026-10-13 (superseded in part — see `DESIGN_AND_COMPLETION_REPORT.md` for the design pass and the five closed gaps)
**Branch / base:** cloud working copy, branch `completion` from `acd0a0c`. Nothing is committed, pushed or deployed. That needs the owner's authorization.
**Source of truth:** `MEP_PROJECTS_PWA/index.html`. It is unchanged (`git status` clean for every file outside `new-app/`). Line numbers below refer to that file.

Status legend:

- **PASS:** implemented and verified by an automated test or a browser test.
- **FAIL:** verified and broken.
- **BLOCKED:** could not be verified here, and the reason is given.
- **NOT IMPLEMENTED:** a known gap that remains open.
- **NOT APPLICABLE:** the PWA has no such behaviour.

---

## 1. Verification results

| Check | Command | Result |
|---|---|---|
| Backend suite (default, no DB) | `npm test` | **477 tests: 475 pass, 0 fail, 2 skipped.** The 2 skipped are the opt-in DB contract files, which skip when no URI is set. |
| Backend suite, serial, with DB contracts | `MEP_TEST_MONGO_URI=… MEP_TEST_MONGO_DB=mep_test_full node --test --test-concurrency=1 tests/*.test.js tests/auth/*.test.js` | **492 tests: 490 pass, 0 fail, 2 skipped.** The 2 skipped are the "real MongoDB only" subtests (see §6). |
| DB contract: Stage 7 + subscriptions | `tests/stage7-mongoose-contract.test.js` | 6/6 pass |
| DB contract: completion pass | `tests/completion-mongoose-contract.test.js` | 9 pass, 2 skipped (real MongoDB only) |
| Completion regression (HTTP + service) | `tests/completion-regression.test.js` | 17/17 pass |
| Frontend production build | `npm run build` (Vite 8) | **PASS** |
| Frontend lint | `npx oxlint src` | **0 errors**, 52 warnings (unused catch params, set-state-in-effect; none functional) |
| Browser acceptance, 11 roles, Chromium | `e2e/completion/run.js` against a fresh dev server | **36/36 PASS** (`e2e/completion/results.json`) |

The DB contract runs used **FerretDB 1.24 (SQLite backend) on 127.0.0.1**, with throwaway databases named `mep_test_*` that are dropped after each run. MongoDB server downloads are blocked in this sandbox. No live database, VPS, PM2, Nginx or production configuration was touched.

### Browser acceptance (36 checks, all PASS)

- **Login screen:** shows Username + Password only, with no company field. A wrong password shows an error and stays on /login.
- **Every role** logs in and opens every page in its menu, with no JS errors and no 5xx responses:
  - admin (16 pages), sales (5), hvac_pm (5), solar_pm (5), mep_pm (4), engineer (2)
  - inventory (7), service_mgr (4), service_eng (2), finance (4), super (8)
- **Menus:**
  - Quotations appears only for admin, sales and finance.
  - Company Profile appears only for admin; Subscriptions only for super.
- **Enquiries:**
  - Segment options are the company's divisions plus AMC.
  - `/enquiries?segment=HVAC` opens with the filter pre-selected (PWA `goSeg`).
- **Users:** "⬇ Report" downloads the PWA Team & Login report, with no passwords.
- **Super admin:**
  - The dashboard shows the PWA KPIs, Quick Links and the Needs Attention table.
  - Add Company (Trial) works through the modal, and the list shows contacts, GST and "Trial → date".
  - The new company admin can log in.
  - Expiring → Renew / Edit opens the edit modal with the Login ID prefilled.
  - Revenue and Subscriber CSVs have a BOM, the PWA headers, a TOTAL row and are grouped by status.
  - No errors occurred during the super journey.

---

## 2. Owner-approved decisions (implemented)

| # | Decision | Status | Evidence |
|---|---|---|---|
| 1 | Username + password login, usernames globally unique, no company field | PASS | completion-regression: login, ambiguity and uniqueness tests; DB contract `findLoginCandidates` / `existsByUsername`; browser login check |
| 2 | Append menu entries: Quotations (admin/sales/finance), Company Profile (admin), Subscriptions (super), AMC Document button. PWA items unchanged. | PASS | browser menu checks; `nav/menuConfig.js` `NEW_APP_MENU_ADDITIONS` |
| 3 | Purchased divisions enforced across modules on the server | PASS | `assertDivisionEntitled` in enquiry, SO, project, checklist-template and quotation services; regression test returns 403 for a Solar enquiry at an HVAC-only company |
| 4 | Solar quotation GST = sum of per-item GST | PASS | regression test: Solar lines at 18% + 5% give 230; HVAC uses one rate; 0% is valid |

---

## 3. Feature matrix (PWA parity)

### Authentication, sessions, security

| Item | Status | Notes |
|---|---|---|
| Login with username + password | PASS | |
| Legacy duplicate usernames → clear "more than one account" error; optional companyId disambiguation | PASS | Run `backend/scripts/check-duplicate-usernames.js` (read-only) before go-live |
| Suspended company: login blocked and existing sessions rejected ("Company subscription suspended. Contact provider.", PWA 1307) | PASS | fakes + real DB |
| PM role login blocked if its division is not subscribed | PASS | authService `assertCompanyAllowsLogin` |
| Role, active flag and company re-read on every request (token role never trusted) | PASS | regression: role change takes effect immediately |
| Password change / user delete revokes sessions | PASS | fakes + real DB |
| 401 in the browser clears the token and returns to login | PASS | `api/client.js` + AuthContext event |
| Passwords never returned or exported (PWA displayed them in plain text) | PASS (documented deviation) | company edit leaves the password blank, meaning unchanged |

### Super admin (PWA superDash, vCompanies, mCompany, vUsage, vRevenue, vExpiring, vLocations, vReports)

| Item | Status | Notes |
|---|---|---|
| Super dashboard: 6 platform KPIs, 5 client-business KPIs, Quick Links, Needs Attention (1482-1503) | PASS | |
| Companies list: search over name/city/address/GST/status/email/cycle/divisions; PWA columns; Edit / Suspend / Activate / Remove; ⬇ Report (1661-1680) | PASS | |
| Company modal: all PWA fields, Trial note, Active subscription block, 2 contacts, admin Login ID / password (1689-1719) | PASS | |
| saveCompany rules: name required; Login ID required on create; Login ID unique (409); Active needs rate + start; ≥1 division; Trial end = +15 days; admin name defaults to contact 1 (1720-1743) | PASS | |
| `?edit=<id>` from Expiring "Renew / Edit" | PASS | |
| Client Business & Usage (coStats) via `GET /api/companies/platform/usage` | PASS | |
| Subscription Revenue Monthly / Yearly / Total | PASS | |
| Expiring in 30 days, Location-wise subscribers | PASS | |
| Six report CSVs (revenue month/year/all, subscribers month/year/all) (1546-1590) | PASS | |
| Delete company cascade incl. subscription | PASS (fakes) / BLOCKED (real DB) | Transactional; FerretDB has no transactions, see §6 |

### Enquiries / Sales Orders / Quotations

| Item | Status | Notes |
|---|---|---|
| Enquiry create defaults (site type Residential, rating 3), segments = divisions + AMC | PASS | |
| Mark lost only when Open | PASS | |
| Dashboard segment row → enquiry list filtered by segment (goSeg 1607) | PASS | |
| Enquiry CSV export uses the same filters as the screen | PASS | |
| SO list/export filtered to entitled divisions; create/edit entitlement | PASS | |
| Quotation numbering counter (`quotation`) | PASS | Counter enum + test updated |
| Lost Enquiries KPI cards, full filter bar, PWA enqTable columns and TOTAL row | PASS | Closed in the design + completion pass (Oct 13) — see DESIGN_AND_COMPLETION_REPORT.md |
| SO margin figures on screen and in the CSV (Equipment / Accessories naming) | PASS | Closed in the design + completion pass (Oct 13) |

### Projects / checklists

| Item | Status | Notes |
|---|---|---|
| Optimistic lock (`revision`), 409 on stale write, auto-retry in services | PASS | real DB contract |
| CLIENT approval needs client name + signature; PM sign needs done + approved | PASS | |
| Checklist item re-date, apply template (division match), photo thumbnails | PASS | |
| Report CSV / Print, engineer names | PASS | |
| Nested checklist sub-items | NOT APPLICABLE | PWA has none (index.html 233, 2772) |
| Projects list 19 PWA columns, timeline auto-fill, DC grouping / print | PASS | Closed in the design + completion pass (Oct 13) |

### Service / AMC

| Item | Status | Notes |
|---|---|---|
| PWA and frontend field names both accepted (complaint, date, time, signature) | PASS | |
| Service type default on completion (AMC for PM, Chargeable for complaint) | PASS | |
| `GET /api/service-calls/mine` (own calls only) | PASS | |
| Contract detail: AMC Document + Schedule PM; PM Due & Renewal panels | PASS | |
| AMC document: `{{contractAmount}}` as "₹ 50,000", `{{contractPeriod}}` from the contract dates (was the cadence, e.g. "Quarterly"), no double "₹", no hard-coded tagline or designation fallback | PASS | regression test |
| Division enforcement for contracts / service calls | NOT APPLICABLE | These records have no division field in the PWA |

### Inventory

| Item | Status | Notes |
|---|---|---|
| Issues list, Return / Mark Used, returns page, history ledger, site options | PASS | |
| Opening stock per location; own-company location/category checks | PASS | |
| Over-large decrement rejected, stock unchanged | PASS | fakes + real DB (sequential) |
| Two concurrent issues cannot over-issue | BLOCKED | Needs a real MongoDB server, see §6 |

### Payments, notifications, dashboards, users

| Item | Status | Notes |
|---|---|---|
| Part payments carry `id` from the real repo; milestone edit re-syncs status (PWA 3844) | PASS | |
| Raise to finance: "Raised by <name>:" and next-call default | PASS | |
| Receipts CSV: SO number, user names, company in title | PASS | |
| Per-user read state for notifications | PASS | |
| `GET /api/dashboard` for admin, sales, PMs, service_mgr, finance; engineer and inventory dashboards | PASS | |
| Users: PM roles filtered by division; ⬇ Report (dlUsers 3475) | PASS | |
| Payments receipts ledger, raised banner, PWA pending columns and totals | PASS | Closed in the design + completion pass (Oct 13) |

### Company Profile

| Item | Status | Notes |
|---|---|---|
| Own-company read (any user) / edit (admin), 5 MB body for logo | PASS | |
| Company Profile is authoritative for document branding (AMC fallbacks removed) | PASS | |

---

## 4. Relationship matrix

| Relationship | Status | Evidence |
|---|---|---|
| Company → Users (tenant scoping; global usernames) | PASS | HTTP + DB tests |
| Company → Subscription → effective divisions → every module | PASS | subscription + division tests |
| Company delete → users, enquiries, SOs, projects, calls, contracts, payments, notifications, subscription | PASS (fakes) / BLOCKED (real DB transaction) | |
| Enquiry → Sales Order → Project → Payments (cascade) | PASS | existing E2E suites, unchanged and passing |
| Project → checklist → approvals → PM sign | PASS | projectService tests |
| Contract → PM service calls → AMC document | PASS | |
| Inventory item → location stock → issue → return / used | PASS | |
| Quotation ↔ inventory (no side effects) | PASS | stage7 HTTP test |
| Session → user → company (re-checked per request) | PASS | |

---

## 5. Documented deviations from PWA behaviour

1. **Passwords are never shown.** The PWA prefilled and displayed plaintext passwords. The new app stores only hashes, so a blank password on edit means "unchanged".
2. **Over-issue is rejected instead of clamped.** The PWA's `moveStock()` clamped a location to zero. Every PWA caller pre-checks stock, so the clamp was only reachable through a race, where it hides an over-issue. The repo now rejects the write with INSUFFICIENT_STOCK. Single-user behaviour is the same. Evidence and reasoning are in `tests/inventoryService.test.js` and the repo docstring. **Owner may want to confirm.**
3. **Duplicate Login ID returns HTTP 409** (it was 400 for company create). The PWA message text "Login ID already in use — choose another" is kept.
4. **`{{contractPeriod}}` in AMC documents is the contract length.** It used to substitute the AMC cadence. The AMC document is new-app only (Stage 7) and has no PWA equivalent.

---

## 6. Blockers and limitations

- **No real MongoDB in this sandbox.** FerretDB stands in for it and lacks two things:
  1. Multi-document transactions. Company delete and other `withTransaction` paths fail on FerretDB with "unknown field autocommit".
  2. Atomic conditional single-document updates under concurrency. Both of two concurrent conditional decrements reported success.

  Both checks are kept as tests and skip unless `MEP_TEST_REAL_MONGODB=1`. **Run them against a MongoDB replica set before deploying:**

  ```
  MEP_TEST_MONGO_URI=mongodb://<throwaway-replset> MEP_TEST_MONGO_DB=mep_test_predeploy MEP_TEST_REAL_MONGODB=1 \
    node --test tests/completion-mongoose-contract.test.js tests/stage7-mongoose-contract.test.js
  ```

- **Production MongoDB must be a replica set.** Transactions require it (already noted in `docs/STEP_6_API_TEST_HARDENING.md`).
- **Inaccessible history.** The "App category comparison and flow" discussion referenced by the order is not accessible from this session, so nothing in it could be checked.
- **No push credentials.** The cloud session has no GitHub push access (403). Device git push credentials are unverified.

---

## 7. Deployment notes (for when deployment is authorized)

1. **Set `AUTH_TOKEN_EXPIRY` in the production env** (recommended `12h`). The code default is `15m`, which logs users out every 15 minutes.
2. **Before switching to the username-only login screen,** run the read-only check and rename any duplicates it lists:

   ```
   MONGODB_URI=… MONGODB_DB_NAME=mep_new_app node scripts/check-duplicate-usernames.js
   ```

   It prints usernames, companies and roles only; exit code 2 means duplicates exist.
3. **Confirm the database runs as a replica set,** then run the real-MongoDB contract tests above against a throwaway replica set.
4. **Index change:** `Subscription.companyId` now has one unique index definition instead of two duplicates. The resulting index is the same, `companyId_1` unique.

---

## 8. Files

- **Backend:**
  - errors / persistence mapping
  - auth (login, sessions, company checks)
  - services: user, company, subscription, enquiry, salesOrder, project, checklistTemplate, quotation, payment, inventory, notification, serviceCall, amcDocument, dashboard (new)
  - routes: all, plus dashboard (new)
  - Mongoose repositories; Counter / Payment / Project / Subscription models
  - `scripts/check-duplicate-usernames.js` (new)
- **Backend tests:**
  - new: `completion-regression.test.js`, `completion-mongoose-contract.test.js`
  - updated: models, validation, userService, companyService, projectService, paymentService, inventoryService, stage7-http-integration
- **Frontend:**
  - Dashboard; Reports; admin/*
  - users, enquiries, projects, contracts, service, inventory, quotations, salesorders, checklists
  - Login, Shell, menuConfig, App routes, api client, AuthContext
  - new: `utils/platform.js`, `hooks/useMyDivisions.js`, `components/SignaturePad.jsx`, `pages/inventory/IssueActions.jsx`
- **Browser harness:** `e2e/completion/` (server.js, run.js, results.json).
- **Docs:**
  - this report
  - corrected divisionGuard claims in `FINAL_IMPLEMENTATION_REPORT.md` and `FINAL_PRE_DEPLOYMENT_VERIFICATION.md`

## 9. Confirmations

- Protected reference files are unchanged: root `index.html`, `MEP_PROJECTS_PWA/index.html`, and the V2 / V3 copies.
- No live VPS, production database, PM2, Nginx or production config was touched. Nothing was deployed.
- No tests were weakened. The two changed assertions are documented in place: the stock clamp became a rejection, and the counter list now includes the real `quotation` sequence. Real-MongoDB-only checks are skipped with an explicit reason, not removed.
- Nothing has been committed or pushed. **That waits for owner authorization.**
