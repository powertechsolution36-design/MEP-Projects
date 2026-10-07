# NEW APP — API Contract

**Status:** Implementation-grounded contract for all currently implemented backend modules.
**Derived from:** direct inspection of `new-app/backend/src/app.js`, `src/routes/*.js`, `src/services/*.js`, `src/middleware/*.js`, `src/auth/*.js`, `src/repositories/businessRepositories.mongoose.js`, and `src/models/*.js` as they exist in the repository today — **not** from memory of the audit/decision-lock documents. Those documents are cross-referenced for *why* a given behavior exists, never as the source of *what* the route does.
**Verified against a live test run** (`node --test tests/*.test.js tests/auth/*.test.js`, 2026-09-26, Phase B FIX-3.8-01/FIX-3.6-01): **338/338 passing, 0 failing** (up from the 313/313 baseline carried through Pass 3.8 — 25 net new tests: 17 `userService.test.js` + 6 `userManagementWorkflow.test.js` + 2 `FIX-3.6-01` Inventory-role tests; the pre-existing `287/287` figure predates Pass 3.4-3.8's own additions and is superseded by the `313/313` figure those passes already reconciled to).

---

## 0. Conventions used throughout this document

- **Auth**: unless stated otherwise, every route requires `Authorization: Bearer <token>` (`src/middleware/authMiddleware.js`), and every business-module router additionally applies, in this order: `authMiddleware` → `requireCompanyContext` → `rejectClientSuppliedCompanyId` (`src/middleware/tenantGuard.js`). This means:
  - No route below is reachable without a valid, unexpired, unrevoked session.
  - Every non-`super` request's `companyId` comes **only** from `req.auth.companyId` (the verified session) — a client-supplied `companyId` in the body or query is rejected with `403 { error: "Cannot operate on a different company." }` if it differs from the session's.
  - Tenant scoping at the data layer: every repository `findById`/`findOne`/`findOneAndUpdate` in `businessRepositories.mongoose.js` filters by `{ _id, companyId }` together — a record belonging to another company is indistinguishable from a non-existent one (`404 NOT_FOUND`), not a `403`. This is uniform across all nine business repositories (Enquiry, SalesOrder, Project, Payment, Contract, ServiceCall, InventoryCategory, InventoryLocation, InventoryItem, InventoryIssue, ChecklistTemplate).
- **Role enforcement**: role checks are **not** done in the router layer (except `POST /api/companies`, which uses `requireRole('super')` directly). Every business module instead checks `actorAuth.role` inside its service function (`assertRole`/`assertCanManageX`/`MANAGE_ROLES`/etc. — see each module's own service file). This document states the role gate each service function actually enforces.
- **Error shape**: every module router wraps its handlers in a `handle()` closure that translates a thrown `ServiceError` (`src/errors.js`: `{ message, code, status }`) into `res.status(err.status).json({ error: err.message, code: err.code })`. An uncaught non-`ServiceError` exception becomes a generic `500 { error: 'Internal error.' }` (logged server-side, message not leaked). The `errors.js` code/status taxonomy observed in the service layer today:

  | code | status | typical meaning |
  |---|---|---|
  | `VALIDATION_ERROR` | 400 | missing/invalid required field (mirrors an observed PWA `toast()` guard where noted) |
  | `NOT_FOUND` | 404 | record not found **or** belongs to another company (tenant isolation — see above) |
  | `FORBIDDEN` | 403 | role not permitted, or a business-state guard (e.g. edit-after-lock) |
  | `NO_COMPANY_CONTEXT` | 403 | `actorAuth.companyId` missing (should not happen for a non-`super` session; fail-closed) |
  | `INSUFFICIENT_STOCK` | 400 | Inventory: requested quantity exceeds available stock |
  | `INVALID_STATUS_TRANSITION` / `INVALID_STATE` | 400 / 409 | an action attempted from a status that does not permit it |
  | `NOT_ELIGIBLE` | 400 | a conversion/eligibility precondition failed |
  | `TIMELINE_NOT_READY` | 400 | Project: an action requires `timelineSet` first |
  | `MISSING_SIGNATURE` | 400 | ServiceCall: completion requires a client signature |
  | `LOCATION_HAS_STOCK` / `CATEGORY_IN_USE` | 400 | Inventory: delete blocked because the row is referenced |
  | `ENQUIRY_NOT_OPEN` | 409 | Enquiry: convert attempted on a non-`Open` Enquiry |
  | `DUPLICATE_CONVERSION` | 409 | Enquiry: convert attempted twice (also caught as a raw error code, not only `ServiceError`, in `enquiryRoutes.js`/`salesOrderRoutes.js`) |
  | `ENGINEER_NOT_FOUND` | 404 | assignment target user not found/not in company |

  Where a route's own doc-comment cites a literal PWA guard (e.g. `if(!gv("e_n")){toast(...)}`), that is the source file's own comment, reproduced here as-is — not an inference by this document.

- **Response envelope**: JSON routes return the primary entity under a named key matching the route's noun (`{ enquiry }`, `{ salesOrder }`, `{ payment }`, `{ project }`, `{ contract }`, `{ serviceCall }`, `{ item }`, `{ category }`, `{ location }`, `{ issue }`, list routes as `{ <plural> }`). CSV export routes return `text/csv` with a `Content-Disposition: attachment` header and no JSON envelope. `DELETE` routes that fully remove a record return `204` with no body; `DELETE`/action routes that instead return a mutated remaining entity return `200` with that entity.

- **Divisions / roles enums** (`src/models/shared/enums.js`, PWA-observed, fixed sets):
  - `DIVISIONS = [HVAC, Solar, MEP]`
  - `ROLES = [super, admin, sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr, service_eng, finance]` (11 roles)
  - PM roles are division-bound: `hvac_pm→HVAC`, `solar_pm→Solar`, `mep_pm→MEP` (`src/auth/roleDivision.js`); a user may only hold a PM role if their company's `divisions[]` includes that division.

---

## 1. Auth (`/api/auth`) — `src/routes/authRoutes.js`, `src/auth/authService.js`

Full narrative documentation also lives in `new-app/docs/API_AUTH_FOUNDATION.md` (pre-existing); this section restates it against the live route code.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | none | `{ username, password, companyId? }` → `200 { token, expiresAt, user }`. `companyId` is required to resolve a non-`super` account (username is unique only *within* a company — Auth §12 open decision, see `OPEN_DECISIONS.md` #12). One generic `401 { error: 'Invalid username or password.' }` for both "unknown username" and "wrong password" (`authService.GENERIC_INVALID_CREDENTIALS`) — deliberately indistinguishable. Inactive accounts are rejected **only after** a correct password match (`ACCOUNT_INACTIVE`, still `401`), so an unauthenticated guesser learns nothing about account existence from timing/branch. Session is created via `sessionRepo.createSession` and a signed JWT (`tokenService.signAccessToken`) embeds `{ sub: userId, companyId, role, sid: sessionId }`. `user` in the response is always `authService.toSafeUser()` — never includes `passwordHash`. |
| POST | `/api/auth/logout` | Bearer | Revokes the session backing the token (`sessionRepo.revokeSession`). Idempotent — revoking an already-revoked/nonexistent session is not an error. `200 { ok: true }`. |
| GET | `/api/auth/me` | Bearer | Re-resolves the user by `req.auth.userId`; `401` if the user no longer exists. `200 { user }` (safe profile). |

`verifySession` (used by `authMiddleware`) checks the JWT signature **and** that the backing session is still active/unexpired in `sessionRepo` — this is what makes logout actually invalidate a token before its own `exp` claim would. One generic `401 SESSION_INVALID` for any invalid/expired/revoked condition.

**Ambiguity flagged, not guessed:** token/session lifetime, refresh, multi-device login and logout-everywhere semantics are explicitly unresolved — `OPEN_DECISIONS.md` #1. The current `config.authTokenExpiry` value is an environment/config concern (`src/config/env.js`), not part of this contract.

## 2. Company (`/api/companies`) — `src/routes/companyRoutes.js`, `src/services/companyService.js`

| Method | Path | Auth/Role | Notes |
|---|---|---|---|
| POST | `/api/companies` | Bearer + `requireRole('super')` (router-level, the one exception to service-layer role checks) | `{ company, admin }` → `201 { company, admin }`. Bootstraps a company **and** its initial admin user in one call — this exists only because a company cannot exist without a way to create it and every company needs an initial admin (`companyService.createCompanyWithAdmin`). `admin.role` is hard-set to `'admin'`; `assertRoleAllowedForCompany('admin', company)` is called (documented as a no-op today since `admin` is never a PM role). The response's `admin` never includes a password/hash. |
| DELETE | `/api/companies/:id` | Bearer + `requireRole('super')` (router-level) | FIX-6-03/FIX-6-04 (added Stage 6; previously implemented but undocumented — closed as part of the Stage 6 Final Closure endpoint-reconciliation gap). PWA source: `delCompany(id)`, `MEP_PROJECTS_PWA/index.html:1811-1817` — "Companies" is a nav item that exists only in the `super` role's menu, so no other role can reach this action in the PWA either. Hard delete, no soft-delete flag, runs inside `withTransaction` (approved infrastructure-only strengthening — the PWA's synchronous array filters have no partial-failure mode to guard against). Cascades exactly the PWA's own literal 8-collection array (`["users","enquiries","sos","projects","svcCalls","contracts","payments","notifs"]`, i.e. Users/Enquiries/SalesOrders/Projects/ServiceCalls/Contracts/Payments/Notifications), filtered by `companyId`, plus the Company doc itself. **Not** cascaded, exactly matching the PWA's own array (an apparent PWA-side oversight, preserved rather than "fixed"): Inventory (categories/locations/items/issues/transactions) and ChecklistTemplates. 404 for an unknown company id. The PWA's hardcoded `id===1` ("cannot remove the primary company in demo") guard is specific to the PWA's own localStorage demo mode and has no real-deployment equivalent — explicitly left OPEN/NOT DETERMINABLE, not reproduced as an invented "first company is special" rule (`companyService.deleteCompany`). |

**Explicitly out of scope** (per the router's own doc comment): this is not the full Super Admin company-management API — subscription editing, suspension, and usage reports (`OPEN_DECISIONS.md` #13/#14) are not implemented here. Company deletion (formerly listed as out of scope here) **was** implemented in Stage 6 (FIX-6-03) — see the DELETE row above. Do not infer the existence of anything else.

## 2a. Users (`/api/users`) — `src/routes/userRoutes.js`, `src/services/userService.js` (FIX-3.8-01, P0 — implemented Phase B)

All routes: Bearer + tenant guard (module-level `router.use`: `authMiddleware`, `requireCompanyContext`, `rejectClientSuppliedCompanyId`). Every action additionally requires `role==='admin'` (checked in `userService.js`, not the router — same convention as every other business module) — PWA FACT: `MENUS.admin` is the only role array containing `"users"`; no other role has any menu path to `vUsers`/`mUser`/`saveUser`/`delUser`.

| Method | Path | Auth/Role | Notes |
|---|---|---|---|
| GET | `/api/users` | Bearer, `admin` | PWA: `vUsers()`'s `mine(DB.users)`. `200 { users: [...] }`, every user of the caller's own company, each the `authService.toSafeUser()` shape (`id,name,username,role,companyId,active` — never `passwordHash`). |
| GET | `/api/users/:id` | Bearer, `admin` | Single-user detail (supports an eventual edit-modal prefill, the NEW APP analog of `mUser(id)`'s `DB.users.find(...)`). `404 NOT_FOUND` if the id doesn't exist or belongs to another company (tenant isolation, same convention as every other module). |
| POST | `/api/users` | Bearer, `admin` | PWA: `mUser()`/`saveUser()` (create). Body `{ name, username, password, role }`, all four required. `role` must be one of the 11 PWA roles EXCEPT `super` (PWA FACT: `mUser`'s role `<select>` explicitly skips it), and if it is a PM role (`hvac_pm`/`solar_pm`/`mep_pm`) the caller's company must subscribe to that division (`assertRoleAllowedForCompany` — PWA FACT: `mUser`'s role `<select>` filters via `hasDiv`/`ROLE_DIV`, the SAME helper `companyService.createCompanyWithAdmin` already uses for the bootstrap admin). Username must be unique **within the company** (`409 ALREADY_EXISTS` — pre-existing NEW BACKEND DESIGN DECISION, `User.js`'s unique index, `OPEN_DECISIONS.md` #12; the PWA's own `saveUser` has no such check on this path, only on company-bootstrap, but this backend applies it consistently). Password is bcrypt-hashed immediately (`src/auth/passwordHasher.js`) and NEVER returned, stored, or logged in the clear — the one approved security adaptation for this task. `201 { user }` (safe shape, no password/hash). |
| PATCH | `/api/users/:id` | Bearer, `admin` | PWA: `mUser(id)`/`saveUser(id)` (edit) — also the (re)assignment surface for role, and for password change (the PWA has no separate action for either; `saveUser` just overwrites whichever fields the form carries). Body: any of `{ name, username, role, password }`, all optional — an omitted field is left unchanged (unlike the PWA, the client can never read back the current password to "resubmit the same value", so omitting `password` is the correct analog of "didn't touch that field"). `role`/`username` changes are validated exactly as in create (division check, per-company uniqueness). `200 { user }`. |
| DELETE | `/api/users/:id` | Bearer, `admin` | PWA: `delUser(id)` — hard delete, no cascade (PWA FACT: every other module's copied name/ObjectId reference is left untouched). `403 FORBIDDEN` if the caller tries to delete their OWN login — the PWA's own restriction is UI-only (`vUsers`'s Remove button isn't rendered for `u.id===U.id`; `delUser()` itself has no guard), enforced here server-side as an approved "server-side authorization matching PWA-visible intent" exception. `200 { deleted: true, id }`. |

**No notification fires for any User create/edit/delete action** — confirmed by exhaustive grep of the PWA's entire "ADMIN: USERS" block (`index.html` ~L1819-1850): zero `notify()` call sites, unlike every other business module (the 25 documented notification triggers across Enquiry/SalesOrder/Payment/Checklist/Project/Contract/ServiceCall/Inventory do not include Users).

**Explicitly NOT implemented (PWA does not demonstrate it):** a deactivate/disable workflow. `User.js`'s `active` boolean is a pre-existing, separate NEW BACKEND DESIGN field (already load-bearing for `authService.login`, which rejects `active:false`) — it is NOT exposed through this API, because the PWA has no deactivate feature to reproduce, only the hard delete above. Per this task's explicit instruction not to invent CRUD the PWA doesn't demonstrate, no `PATCH .../deactivate` or `active` toggle exists here.

**Cross-module workflow verification (re-run live this task, `tests/userManagementWorkflow.test.js`):** a user created through this API in ANY role is immediately usable, with no additional wiring, by every other already-implemented module's own user lookup (`deps.userRepoForEnquiry`, the same repository interface a real deployment backs with the same `User` Mongo collection this API writes to) — verified directly for Project engineer/PM assignment (`projectService.assignEngineers`), ServiceCall engineer assignment (`serviceCallService.assignEngineer`), Inventory issue recipients (`inventoryService.issueMaterial`), and the Notification role-target system (a `finance`-role user created via this API receives the chargeable-ServiceCall Payment notification). See `new-app/docs/E2E_PASS_3_8_MASTER_RECONCILIATION.md`'s FIX-3.8-01 section for the full re-verification narrative.

## 3. Enquiry (`/api/enquiries`) — `src/routes/enquiryRoutes.js`, `src/services/enquiryService.js`

All routes: Bearer + tenant guard (module-level `router.use`).

| Method | Path | Role gate | Request | Response | Notes |
|---|---|---|---|---|---|
| POST | `/` | `sales` (`CREATE_ROLES`) | `{ name, siteType, capacity, segment, phone, referenceSource, rating, estimatedValue, remark }` | `201 { enquiry }` | `name` required (`VALIDATION_ERROR`, PWA FACT `if(!gv("e_n"))`); `segment` required and must be in `VALID_SEGMENTS` (`VALIDATION_ERROR`). `status` fixed to `'Open'`, `lastReviewDate` set to today, `followUpLog: []`. `companyId` from session only. |
| GET | `/` | any authenticated company member | query: `q, segment, siteType, rating, status, referenceSource, reviewFrom, reviewTo, nextActionFrom, nextActionTo, valueMin, valueMax` | `200 { enquiries }` | Excludes Lost (`includeLost:false`). |
| GET | `/lost` | any | same filters | `200 { enquiries }` | `includeLost:true` scope. |
| GET | `/reports/summary` | any | — | `200 { summary }` | Segment/status reporting aggregation. |
| GET | `/reports/followups-due` | any | — | `200 { enquiries }` | Follow-ups-due-today dashboard data. |
| GET | `/export.csv` | any | `?lost=true` toggles scope, same filters | `text/csv` | Exact PWA export column set (per doc comment); filename `enquiries.csv`. |
| GET | `/:id` | any (tenant-scoped) | — | `200 { enquiry }` | `NOT_FOUND` if absent or cross-tenant. |
| PATCH | `/:id` | `sales`/`admin` (`MANAGE_ROLES`) | partial field set (name/siteType/capacity/segment/phone/referenceSource/rating/estimatedValue/remark) | `200 { enquiry }` | **No edit-history is recorded** — `OPEN_DECISIONS.md` #17, HOLD FOR #3 (general audit-retention policy), not finalized. |
| POST | `/:id/follow-ups` | `sales`/`admin` | follow-up entry | `200 { enquiry }` | Appended to `followUpLog`. |
| POST | `/:id/mark-lost` | `sales`/`admin` | `{ reason?, ... }` | `200 { enquiry }` | Sets `status:'Lost'`. |
| POST | `/:id/reopen` | `sales`/`admin` | — | `200 { enquiry }` | `lostReason`/`lostDate` are **left untouched** on reopen — `OPEN_DECISIONS.md` #18, locked as Decision A via `ENQUIRY_BUSINESS_DECISION_SHEET.md`. |
| POST | `/:id/convert` | `sales`/`admin` | SalesOrder field overrides | `201 { enquiry, salesOrder, project, payment? }` (cascade result) | Requires Enquiry `status==='Open'` (`ENQUIRY_NOT_OPEN`, 409) — Decision B (`OPEN_DECISIONS.md` #19). A second convert attempt on an already-converted Enquiry raises `DUPLICATE_CONVERSION` (409) via an atomic `findOneAndUpdate` guard (see `enquiryRepo`'s conditional update, doc comment: "STILL `Open` at the instant of this single findOneAndUpdate, never via" a separate read-then-write). SalesOrder keeps **no back-reference field naming the Enquiry beyond `enquiryId`** per Decision D (`OPEN_DECISIONS.md` #20). **Runs inside one DB transaction** (`deps.withTransaction`) — the whole Enquiry→SalesOrder→Project(→Payment) cascade is atomic. |

## 4. SalesOrder (`/api/sales-orders`) — `src/routes/salesOrderRoutes.js`, `src/services/salesOrderService.js`, `src/services/salesOrderCascade.js`

| Method | Path | Role gate | Notes |
|---|---|---|---|
| POST | `/` | `sales`/`admin` (`CREATE_ROLES`) | Standalone create (no Enquiry) — `cascade.buildSalesOrderDraft(null, overrides, actorName)` then `cascade.validateSalesOrderDraft` then `cascade.runCreationCascade` inside `withTransaction`. Shares the identical creation cascade with the Enquiry-conversion path, so both paths yield an identical entity shape (Project side-effect included — see §6). Order number assigned via a **per-company atomic counter** (`counterRepo.getNextSequence(companyId, 'salesOrder', session)`). |
| GET | `/` | `sales, admin, hvac_pm, solar_pm, mep_pm, finance` (`VIEW_ROLES`) | query: `q, division`. |
| GET | `/export.csv` | same view roles | exact PWA `dlSOs` column set. |
| GET | `/:id` | view roles, tenant-scoped | **Costing is redacted** for `engineer`/`service_eng` (`COST_HIDDEN_ROLES`) via `redactCostForRole`. |
| PATCH | `/:id` | `sales`/`admin` (`EDIT_ROLES`) | Plain field edit — **no cascade re-run** (division change after Project creation does not re-derive stage list — `OPEN_DECISIONS.md` #15, still open). |
| POST | `/:id/milestones/:mi/raise` | division-matched PM role or `admin` (`RAISE_ROLES`, via `paymentService.raiseToFinance`) | See §5 for the full contract — mounted here because the PWA's `mRaise` is invoked from the Project/SO side. |

## 5. Payment / Finance (`/api/payments`) — `src/routes/paymentRoutes.js`, `src/services/paymentService.js`

`LEDGER_ROLES = ['finance', 'admin']` gates the ledger-management endpoints below unless noted.

| Method | Path | Role gate | Notes |
|---|---|---|---|
| GET | `/` | `finance`/`admin` | `?status=Pending|Received`. |
| GET | `/export/pending.csv` | `finance`/`admin` | pending-payments CSV. |
| GET | `/export/receipts.csv` | `finance`/`admin` | exact PWA `dlReceipts` columns. |
| POST | `/` | `finance`/`admin` | manual pending entry, no SO link. |
| GET | `/:id` | `finance`/`admin` | detail. |
| PATCH | `/:id/milestone` | `finance`/`admin` | edits the milestone/reference record (`savePayEdit` equivalent). |
| POST | `/:id/follow-up` | `finance`/`admin` | `lastCall`/`nextCall`/`disc`/`remark` (`savePayFollow` equivalent). |
| POST | `/:id/part-payments` | `finance`/`admin` | adds a part-payment (`addPayment`). Runs inside `withTransaction`. |
| PATCH | `/:id/part-payments/:partId` | `finance`/`admin` | edits one entry (`saveEditPayment`). |
| DELETE | `/:id/part-payments/:partId` | `finance`/`admin` | removes one entry (`delPayment`). |
| DELETE | `/:id` | `finance`/`admin` | Deletes the **whole** record — **only if not SO-linked**; an SO-linked payment raises `FORBIDDEN` ("An SO-linked payment cannot be deleted, only its individual entries.") — `delPayRow` equivalent. `204` on success. |

**Raise-to-Finance** (mounted on the SalesOrder router — see §4):
`POST /api/sales-orders/:id/milestones/:mi/raise` — role gate is `RAISE_ROLES = ['hvac_pm','solar_pm','mep_pm','admin']`, and a PM role may **only** raise milestones for a SalesOrder whose division matches that PM's own division (`PM_DIVISION_FOR_ROLE`) — cross-division raise is `FORBIDDEN` (403). Runs inside `withTransaction`; on success fans out a notification to `targetRoles: ['finance','admin']`.

`syncPayStatus` recomputes the payment's aggregate status from its part-payment/milestone data on every mutating call (`computeReceived`/`computeBalance`).

## 6. Project (`/api/projects`) — `src/routes/projectRoutes.js`, `src/services/projectService.js`

**No standalone create route** — a Project is created only as a side effect of SalesOrder creation (§4) via the shared cascade (`salesOrderCascade.js`).

Role-group constants used below: `PM_ROLES = { ENGINEER: [engineer,hvac_pm,solar_pm,mep_pm,admin], CLIENT: [engineer,hvac_pm,solar_pm,mep_pm,service_eng,admin], SALES: [sales,admin], SERVICE: [service_mgr,service_eng,admin] }`, `ENGINEER_CANDIDATE_ROLES = [engineer,hvac_pm,solar_pm,mep_pm,service_eng]`.

| Method | Path | Role gate | Notes |
|---|---|---|---|
| GET | `/` | any (tenant-scoped) | list/search. |
| GET | `/export.csv` | any | list/dashboard CSV. |
| GET | `/:id` | any (tenant-scoped) | **No division restriction on detail read** — `isPmForProject`/division-check is used for *write* gates only; read access is any authenticated company member. This preserves the PWA's own `vProject()`, which performs no division check — locked exactly (`OPEN_DECISIONS.md` #25, `PROJECT_DECISION_LOCK.md` Decision 1). |
| POST | `/:id/stage` | PM for the project's division, or `admin` (`isPmForProject`) | Stage edit **and** the completion gate. MEP's stage list ends at `Delivered`, not `Completed` — MEP is excluded from the completion-gate path (`PROJECT_DECISION_LOCK.md` Decision 4, `OPEN_DECISIONS.md` #28). Un-completing (editing `stage` away from `Completed`) is preserved exactly, not blocked (`OPEN_DECISIONS.md` #29 / Decision 5). Runs inside `withTransaction`; on stage→Completed fans out to `targetRoles:['finance']`/`['admin']`/`['service_mgr']` in sequence (see source, lines ~410–432). |
| PATCH | `/:id/vendor` | PM or admin | vendor edit. |
| POST | `/:id/engineers` | PM or admin | **Full replace** of the engineer list. Every candidate ID must resolve to a user in the **same company** and hold a role in `ENGINEER_CANDIDATE_ROLES` (`ENGINEER_NOT_FOUND`, 404, otherwise). **The candidate pool is company-wide, not division-filtered** — preserved exactly per explicit task instruction, `OPEN_DECISIONS.md` #26 / `PROJECT_DECISION_LOCK.md` Decision 2. |
| POST | `/:id/timeline` | PM or admin | Set/edit timeline. `timelineSet` is a **one-way flag** — once true, later edits do not revert readiness state (`OPEN_DECISIONS.md` #36 / `PROJECT_DECISION_LOCK.md` Decision 12). |
| PATCH | `/:id/checklist/:i/target-date` | PM or admin | single-point date edit; blocked once project is `In Service` (`FORBIDDEN`, "Checklist cannot be modified once the project is In Service."). |
| POST | `/:id/checklist` | PM or admin | add a point; same In-Service lock. |
| PATCH | `/:id/checklist/:i` | PM or admin | edit point text/sign-responsibility; same lock. |
| DELETE | `/:id/checklist/:i` | PM or admin | remove point; same lock. |
| POST | `/:id/checklist/apply` | PM or admin | apply a `ChecklistTemplate`, replace or append. The PWA's replace-vs-append `confirm()` gap is preserved exactly, not added server-side (`OPEN_DECISIONS.md` #30 / Decision 6). |
| POST | `/:id/checklist/:i/tick` | PM **or the assigned engineer** (`assertIsPmOrAssignedEngineer`) | tick/untick a point. |
| PATCH | `/:id/checklist/:i/remark` | PM or assigned engineer | remark edit. |
| POST | `/:id/checklist/:i/photos` | PM or assigned engineer | append-only photo list — no size/retention policy added beyond the PWA's own (`OPEN_DECISIONS.md` #32, preserve exactly, same precedent as `confirmOverpayment`). |
| POST | `/:id/checklist/:i/approve` | **the point's own `signResponsibility`-matched role** (`PM_ROLES.ENGINEER/CLIENT/SALES/SERVICE`, checked against `item.signResponsibility`) | `FORBIDDEN` if the actor's role doesn't match the point's required sign-responsibility. |
| POST | `/:id/checklist/:i/pm-sign` | PM only | PM counter-sign. |
| POST | `/:id/updates` | SALES roles or PM (see source ~L892) | append an execution update. |
| POST | `/:id/delivery-challans` | PM or admin | create/append DC; same In-Service lock as checklist. `by` ("Received By (site)") is a durable `User` reference (Decision, `OPEN_DECISIONS.md` #31, additive schema fix). |
| PATCH \| DELETE | `/:id/delivery-challans/:i` | PM or admin | edit/delete one DC item; same lock. |
| POST | `/:id/delivery-challans/:i/return` | PM or admin | record a material return; same lock. **Not linked to InventoryItem/InventoryIssue** — DC remains a free-text log, `OPEN_DECISIONS.md` #8/#33/#45, still open now that Inventory is implemented (see §9 baseline notes). |
| GET | `/:id/delivery-challans/export.csv` | any | DC CSV export. |
| GET | `/:id/report` \| `/:id/report/export.csv` | any | detailed report, JSON and CSV. |
| POST | `/:id/delay-check` | any (manual trigger) | no scheduler is wired up — manual invocation only, per explicit scope limit. |
| POST | `/:id/service-conversion/prepare` | any | `prepareServiceConversion`/`isEligibleForServiceConversion` — a **deferred integration stub**: re-verifies `status==='Completed' && division!=='MEP'` server-side as defense-in-depth (not a new business rule — the PWA's own UI-visible intent, re-checked at the function level where the PWA itself has none — `OPEN_DECISIONS.md` #58, `CONTRACT_DECISION_LOCK.md` Decision 10). Does **not** create a Contract itself — see §7's `convertProjectToContract`, which is the actual conversion route. |

Raising a payment milestone from a Project stays on `POST /api/sales-orders/:id/milestones/:mi/raise` (§5) — Project never reimplements that logic; a client resolves `project.salesOrderId` first.

## 7. Contract — AMC / Warranty (`/api/contracts`) — `src/routes/contractRoutes.js`, `src/services/contractService.js`

`MANAGE_ROLES = ['admin', 'service_mgr']` (`CONTRACT_DECISION_LOCK.md` Decision 6 / `OPEN_DECISIONS.md` #54, enforcing the PWA's own visible role intent server-side).

| Method | Path | Role gate | Notes |
|---|---|---|---|
| GET | `/` | any company member, **no division scoping** | PWA FACT §2/§13. |
| GET | `/export.csv` | `admin`/`service_mgr` only (`MANAGE_ROLES`) | `CONTRACT_DECISION_LOCK.md` Decision 6. |
| GET | `/pm-due` | any | PM-Due dashboard panel. |
| GET | `/renewal-opportunities` | any | Renewal-Opportunities panel. |
| GET | `/:id` | any (tenant-scoped) | detail. |
| POST | `/` | `admin`/`service_mgr` | manual AMC/Warranty creation. `end` field: manual creation preserves the PWA's own validation exactly — an unset `end` reads as immediately `Expired` in status computation (`OPEN_DECISIONS.md` #56, Decision 8); the schema field itself was loosened from `required:true` to `default: null` as a storage-layer reconciliation (the one Contract schema change made — see `OPEN_DECISIONS.md` #49 implementation note). |
| POST | `/from-project/:projectId` | `admin`/`service_mgr` | Project → Warranty Contract conversion. |

**No edit/delete route exists for Contract, for any role, anywhere** — `CONTRACT_DECISION_LOCK.md` Decisions 2–3, both locked to "preserve exactly" (the PWA has neither). Other locked-exact behaviors relevant to the contract surface (all cross-referenced rather than re-explained): PM-completion stamping mechanism (Decision 4), the 4-visit display/export cap on Monthly 12-visit contracts (Decision 5), manual-creation notification asymmetry (Decision 7), duplicate-conversion handling (Decision 9), expired-contract PM-due visibility (Decision 11), one-way-only Contract↔ServiceCall relationship (Decision 12), no display/reference number (Decision 13), write-only `fromProject` reverse-lookup (Decision 14), and AMC-vs-Warranty being a label-only distinction with zero behavioral difference (Decision 15). See `CONTRACT_DECISION_LOCK.md` for the business reasoning behind each.

`completePmVisitForContract(contractId, actorAuth, deps, { assignedEngineerUserId })` is **not** exposed as its own route on this router by design — it is invoked as a side effect from within ServiceCall completion (§8). It optionally threads `deps.session` through to `contractRepo.setVisitCompleted` (a no-op when absent) so ServiceCall completion can enlist the Contract PM-slot write inside its own transaction — the one minimal, backwards-compatible extension made to this file for ServiceCall integration (`OPEN_DECISIONS.md` #77 status note).

## 8. ServiceCall — Complaint / PM visit (`/api/service-calls`) — `src/routes/serviceCallRoutes.js`, `src/services/serviceCallService.js`

`MANAGE_ROLES = ['admin', 'service_mgr']` (register/assign/PM-schedule/list gate, PWA FACT §18). `ENGINEER_CANDIDATE_ROLES = ['service_eng', 'engineer', 'service_mgr']` — **no division filter** (`SERVICECALL_DECISION_LOCK.md` Decision 5 / `OPEN_DECISIONS.md` #68).

| Method | Path | Role gate | Notes |
|---|---|---|---|
| GET | `/` | `admin`/`service_mgr` | list/search register (PWA FACT §18). |
| GET | `/open` | `admin`/`service_mgr` | Open Service Calls dashboard panel. |
| GET | `/export.csv` | `admin`/`service_mgr` | report export. |
| GET | `/:id` | **any company member, tenant-scoped only** | This **closes** a PWA gap: the PWA's own `vCall()` had no company check at all on a direct-ID lookup (cross-tenant read exposure) — `SERVICECALL_DECISION_LOCK.md` Decision 2 / `OPEN_DECISIONS.md` #65. The NEW APP route is tenant-scoped like every other detail route (see §0), which is the security-gap closure, not a business-behavior change — role is intentionally left open (any company member) matching the PWA's own lack of a role gate on this specific read. |
| POST | `/complaints` | `admin`/`service_mgr` | register a Complaint. Per-company atomic PSC numbering (`SERVICECALL_DECISION_LOCK.md` Decision 3). Returns the verbatim customer-message preview text (`msgReg`) — no real SMS/WhatsApp/email delivery is built (`OPEN_DECISIONS.md` #11, #77). |
| POST | `/pm/:contractId` | `admin`/`service_mgr` | schedule a PM visit from a Contract. Returns `msgPM` preview text. |
| PUT | `/:id/assign` | `admin`/`service_mgr` | assign/reassign/clear engineer + date/time. Candidate must resolve to a same-company user with a role in `ENGINEER_CANDIDATE_ROLES` — otherwise `ENGINEER_NOT_FOUND`/validation error. |
| PUT | `/:id/report` | assigned engineer **or** `admin`/`service_mgr` (`assertCanEditReport`) | Whole-object-replace report draft — **no history**, single overwrite-in-place subdocument (`OPEN_DECISIONS.md` #77 status note, §25 item re: report draft-history model left unresolved). |
| POST | `/:id/complete` | assigned engineer **or** `admin`/`service_mgr` | Requires `input.signature` — the **only** hard completion guard (`MISSING_SIGNATURE`, 400), matching the PWA's sole `if(_sg&&_sg.empty)` check. Completion is **idempotent via an atomic conditional transition** (`completeIfNotCompleted`) rather than an explicit re-completion-rejection guard — a concurrent/retried completion cannot duplicate a Chargeable Payment or re-stamp a Contract PM-slot (`OPEN_DECISIONS.md` #77, §25 item "re-completion guard" intentionally NOT added as a separate rejection path; idempotency achieved structurally instead). On completion this creates a Chargeable Payment (via the existing `paymentRepo`), calls `contractService.completePmVisitForContract` when the ServiceCall originated from a Contract PM schedule (reusing the `due[0]` PM-slot-update quirk exactly), and fans out to `targetRoles:['finance']`/`['service_mgr','admin']` — **all inside one transaction** (`deps.withTransaction`). |

**No edit/delete/cancel/reopen route exists for any role** — the PWA has none (`SERVICECALL_DECISION_LOCK.md` §21 item 14 / §23 item 13).

**Genuinely open, not resolved by this implementation** (restated from `OPEN_DECISIONS.md` #77, `SERVICECALL_DECISION_LOCK.md` §25): re-completion rejection guard (implemented as idempotent no-op instead, see above), engineer-candidate division-scoping (none added), report draft-history model (none added), a reverse `paymentId` reference on ServiceCall (none added), and automated customer-message delivery (none built — preview text only).

## 9. Inventory (`/api/inventory`) — `src/routes/inventoryRoutes.js`, `src/services/inventoryService.js`

`MANAGE_ROLES = ['inventory', 'admin']` (write gate for categories/locations/items/issues/transfers/adjustments). `RECIPIENT_ROLES = ['sales','hvac_pm','solar_pm','mep_pm','engineer','inventory','service_mgr','service_eng','finance']` — every role **except `admin`** is a valid Issue recipient.

**UPDATE (Phase B, FIX-3.6-01, P3 — implemented):** the old single `STOCK_VIEW_ROLES` gate over-granted both CSV exports and has been split, matching PWA's exact per-report menu access (traced fresh from `index.html` `MENUS`, L1289-1300):
- `STOCK_REPORT_ROLES = ['admin','inventory','hvac_pm','solar_pm','service_mgr']` — gates `GET /reports/stock.csv` (`mep_pm` dropped: PWA's `mep_pm` menu is `[dash,projects,sos,checklists]`, never `"stock"`).
- `ISSUED_REPORT_ROLES = ['admin','inventory']` — gates `GET /reports/issued.csv` (PWA's `"invissue"` menu entry, which carries the `dlIssued()` button, is visible only to `admin`/`inventory`, never `hvac_pm`/`solar_pm`/`mep_pm`/`service_mgr`).
See `new-app/docs/E2E_PASS_3_8_MASTER_RECONCILIATION.md`'s FIX-3.6-01 section for the re-verification; tests added in `tests/inventoryService.test.js`.

| Method | Path | Role gate | Notes |
|---|---|---|---|
| GET \| POST | `/categories` | view roles \| `MANAGE_ROLES` | No uniqueness check on `name` — `OPEN_DECISIONS.md` #80, genuinely open. |
| PUT \| DELETE | `/categories/:id` | `MANAGE_ROLES` | rename / delete (blocked with `CATEGORY_IN_USE` if referenced). |
| GET \| POST | `/locations` | view \| `MANAGE_ROLES` | No uniqueness check — `OPEN_DECISIONS.md` #81, genuinely open. |
| PUT \| DELETE | `/locations/:id` | `MANAGE_ROLES` | rename / delete (blocked with `LOCATION_HAS_STOCK`). |
| GET \| POST | `/items` | view \| `MANAGE_ROLES` | — |
| GET | `/items/:id` | view roles, **tenant-scoped** | Closes the PWA's own `itemById()` no-company-check gap — explicit security-gap closure, same pattern as ServiceCall §8. |
| PUT \| DELETE | `/items/:id` | `MANAGE_ROLES` | delete is **hard, unguarded** — matches the PWA's own `delItem()` exactly; no archive/soft-delete state (`OPEN_DECISIONS.md` #84 implementation note). |
| POST | `/items/:id/adjust` | `MANAGE_ROLES` | Stock adjustment: Purchase In / Opening Stock / Damage / Adjustment — the 8-type append-only `InventoryTransaction` ledger record is always written. |
| POST | `/issues` | `MANAGE_ROLES` | Issue material. Requires `quantity>0`, `itemId`, `fromLocationId`, `staffId`, `site`; recipient must be a same-company user with a role in `RECIPIENT_ROLES`. Runs inside `withTransaction`, using a **concurrency-safe atomic `$inc`-plus-clamp-to-zero** stock primitive (`incrementStockAtLocation`) replacing the PWA's synchronous, non-atomic `moveStock()` (`OPEN_DECISIONS.md` #84). |
| POST | `/issues/:id/return-request` | **owner only** (the staff the material was issued to) | `FORBIDDEN` if the caller is not the original recipient. |
| POST | `/issues/:id/accept-return` | `MANAGE_ROLES` | accept a return; runs inside `withTransaction`. |
| POST | `/issues/:id/reject-return` | `MANAGE_ROLES` | reject a return request. |
| POST | `/issues/:id/mark-used` | `MANAGE_ROLES` | mark issued material used. |
| POST | `/transfers` | `MANAGE_ROLES` | stock transfer between locations; runs inside `withTransaction`. |
| GET | `/dashboard` | `MANAGE_ROLES` (per doc comment) | KPIs, low-stock aggregation. |
| GET | `/my-material` | any authenticated user | caller's own issues only. |
| GET | `/reports/stock.csv` | `STOCK_REPORT_ROLES` (FIX-3.6-01) | Stock Report. |
| GET | `/reports/issued.csv` | `ISSUED_REPORT_ROLES` (FIX-3.6-01) | Issued Material Report. |
| GET | `/reports/transactions.csv` | `admin`/`inventory` | Inventory Transaction Report. |
| GET | `/reports/my-material.csv` | any | My Material Report (caller-scoped). |
| GET | `/reports/returns.csv` | `admin`/`inventory` | Material Return Report. |

**No edit/delete route exists for `InventoryTransaction`** — append-only (`INVENTORY_DECISION_LOCK.md` Decision 29). Corrected PWA facts baked into the derivation logic (`issStatus`/`issBal`): the `"Returned"` status **is** reachable (corrects `OPEN_DECISIONS.md` #16 — see #78, a PWA-fact correction, not a business decision), and the `"Returned / Used"` string has the corrected spacing (#79). Notification catalogue: 5 events, **no** Transfer/Mark-Used notifications (matches PWA).

**Genuinely open, not resolved by this implementation** (`OPEN_DECISIONS.md` #80–#82): Category-name uniqueness, Location-name uniqueness, and Admin's missing Stock-Transfer menu entry (a UI/menu-presentation question only — does **not** affect backend authorization, which is already locked to `inventory`/`admin` regardless).

---

## 9a. Checklist Template Library (`/api/checklist-templates`) — `src/routes/checklistTemplateRoutes.js`, `src/services/checklistTemplateService.js` (FIX-3.3-01; documented as part of Stage 6 Final Closure — previously implemented, tested, and referenced from §6's `POST /api/projects/:id/checklist/apply`, but had no dedicated contract section of its own)

Source of truth: `MEP_PROJECTS_PWA/index.html` "CHECKLIST LIBRARY" section (`chkLists`, `defaultChkList`, `chkListById`, `canEditChk`, `vChecklists`, `mNewChkList`/`createChkList`, `dupChkList`, `setDefChkList`, `delChkList`, `vChklist`, `mRenameChkList`/`doRenameChkList`, `mChkPoint`/`saveChkPoint`, `rmChkPoint`, `moveChkPoint`, lines ~2744-2868). Distinct from `applyChecklistTemplate` in `projectService.js` (§6), which reads a template to seed/replace a *project's own* checklist and is unaffected by this module.

**Role gate** (`canEditChecklistLibrary`, PWA `canEditChk()`): `admin` OR **any** division-PM role (`hvac_pm`/`solar_pm`/`mep_pm`) — preserved PWA quirk: a division PM may create/edit/delete/duplicate/set-default a template in **any** division, not just their own; there is no per-division match check on the edit gate in the PWA source. Viewing (list/detail) is open to every authenticated company user; list defaults to the caller's own division for a division-PM and to all company divisions otherwise (PWA `myDiv()`/`chkLists(div)` quirk).

| Method | Path | Auth/Role | Notes |
|---|---|---|---|
| GET | `/api/checklist-templates` | any authenticated company user; optional `?division=HVAC\|Solar\|MEP` filter | List, division-scoped by default for a division-PM, all-divisions otherwise. |
| GET | `/api/checklist-templates/:id` | any authenticated company user | Detail; no extra role/division restriction (PWA `vChklist`/`chkListById`). |
| POST | `/api/checklist-templates` | `canEditChecklistLibrary` | Create; optional `sourceTemplateId` to start-from-copy. |
| POST | `/api/checklist-templates/:id/duplicate` | `canEditChecklistLibrary` | Duplicate an existing template. |
| PATCH | `/api/checklist-templates/:id/rename` | `canEditChecklistLibrary` | Rename. |
| POST | `/api/checklist-templates/:id/set-default` | `canEditChecklistLibrary` | Set as the division's default template. |
| DELETE | `/api/checklist-templates/:id` | `canEditChecklistLibrary` | Deletes; blocked with `409 MIN_ONE_PER_DIVISION` if it is the last template in its division (`countByDivision < 2` guard — at least one template per division must always remain). |
| POST | `/api/checklist-templates/:id/items` | `canEditChecklistLibrary` | Add a checklist point; `text` required, `sign` one of the 4 fixed `SIGN_RESPONSIBILITIES` values (PWA `saveChkPoint` add branch). |
| PATCH | `/api/checklist-templates/:id/items/:i` | `canEditChecklistLibrary` | Edit a point by index. |
| DELETE | `/api/checklist-templates/:id/items/:i` | `canEditChecklistLibrary` | Remove a point by index. |
| POST | `/api/checklist-templates/:id/items/:i/move` | `canEditChecklistLibrary` | Reorder; body `{ direction: -1 \| 1 }`. |

Tenant: standard `requireCompanyContext` + `rejectClientSuppliedCompanyId` middleware (same pattern as every other business router) — every lookup is scoped to `actorAuth.companyId`. No notifications fire for any Checklist Template Library action (distinct from Project-checklist tick/approve/sign notifications in §6, which are unaffected). Test file: `tests/checklistTemplateService.test.js`.

## 9b. Notifications — read side (`/api/notifications`) — `src/routes/notificationRoutes.js`, `src/services/notificationService.js` (FIX-B1; documented as part of Stage 6 Final Closure — previously implemented and tested, but had no dedicated contract section of its own)

Source of truth: `MEP_PROJECTS_PWA/index.html` `notify()`/`myNotifs()`. This router only adds the previously-missing read/list surface — no create route exists here; every module's own service creates notifications directly via `notificationRepo.create()` as a side effect of its own business action (the 25 documented trigger sites across Enquiry/SalesOrder/Payment/Checklist/Project/Contract/ServiceCall/Inventory, catalogued in the relevant module sections above and in the Pass 3.7 notification audit).

| Method | Path | Auth/Role | Notes |
|---|---|---|---|
| GET | `/api/notifications` | any authenticated company user; optional `?limit=` | Company-scoped and role-targeted list (PWA `myNotifs()` fact: a notification is visible to a user if it targets their own role, or targets the "*" all-roles wildcard). `notificationRepo.listForRole(companyId, role, {limit})`. |
| PATCH | `/api/notifications/:id/read` | any authenticated company user (the acting user, for their own read-state) | Marks the notification read for the calling user (PWA `vNotifs()`'s per-item read call). `notificationRepo.markRead(companyId, id, userId)`. |

Tenant: standard `requireCompanyContext` + `rejectClientSuppliedCompanyId` middleware. Test file: `tests/notificationService.test.js`.

## 10. Ambiguities and gaps explicitly flagged (not guessed)

- **Exact request-body field lists** for several write endpoints (e.g. `saveTimeline`, `applyChecklistTemplate`, `buildReport`'s full ServiceCall report shape, `createManualContract`'s full field set) are enforced deep inside their service functions with PWA-fidelity-driven validation logic that this document summarizes at the role/error/transaction level but does not reproduce field-by-field — a client integration (Stage 7) must read the relevant service function directly (line references given per module above) rather than infer the shape from this document.
- **Company-scoped admin bootstrap vs. full Super Admin API** (§2): only creation is implemented; suspension/subscription/usage-report/deletion endpoints do not exist and must not be assumed present.
- **Milestone raise role/division coupling** (§5) is enforced only for the three PM roles plus `admin` — `finance`/`sales` cannot call it; this is a route that lives outside its "natural" Payment module for PWA-fidelity reasons (see router doc comment) — a client must call it via the SalesOrder path.
- **DC ↔ Inventory linkage** (§6/§9): despite Inventory now being implemented, Delivery Challans remain an unlinked free-text log — this is a standing open decision (`OPEN_DECISIONS.md` #8/#33/#45), not an oversight of this contract.

---

## 11. ENDPOINT COUNTING STANDARD

**Canonical definition:** an **endpoint** means one distinct HTTP method + one distinct registered route path exposed by the NEW APP API. Method matters, path matters. Example: `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects` are **three** endpoints, not one "Project" endpoint.

This section fixes the exact rules used to count endpoints in this document and in all future reports on this engagement, so that "how many endpoints" always means the same thing regardless of who asks or answers.

- **Route registration is the primary source.** The canonical count MUST come from actual Express/router registration in the implemented app, not from a prior document's prose, not from a PWA screen count, not from a service-function count. Trace `src/app.js` (`app.use(mountPath, createXRouter(...))`) → the router returned by `createXRouter` → every `router.<method>(path, ...)` call inside it. Nested routers resolve to their **final mounted path**: e.g. `app.use('/api/inventory', createInventoryRouter(...))` plus `router.get('/items', ...)` inside `inventoryRoutes.js` is counted as `GET /api/inventory/items`, never as `GET /items`.
- **Count method + path, not business function.** The same business function/entity can legitimately have multiple endpoints — full CRUD on one entity is 4+ endpoints, not 1. Conversely, do **not** count screens, services, controller functions, repository methods, database operations, PWA UI functions, business workflows, or CRUD "modules" as endpoints. Only an actual `router.<method>(path, ...)` registration, resolved to its final mounted path, counts.
- **Path parameters do not create additional endpoints** — `/api/projects/:id` is one registered path regardless of how many different `:id` values are ever requested at runtime. They DO count separately from a sibling static segment at the same position when the registered path STRING itself differs: `/api/inventory/items/:id` and `/api/inventory/items/:id/adjust` are two different registered paths (two endpoints); so are `GET /api/enquiries/lost` and `GET /api/enquiries/:id` (Express resolves these by registration order, but each is its own registered path string, hence its own endpoint). Multiple middleware/handlers layered onto one registered `method+path` (e.g. `authMiddleware` then the route handler) is still **one** endpoint, not one per middleware.
- **Query parameters never increase the endpoint count.** `GET /api/enquiries?status=Open` and `GET /api/enquiries?status=Lost` are the same endpoint (`GET /api/enquiries`) with different query values, not two endpoints.
- **Request body variations never increase the endpoint count.** `POST /api/contracts` accepting an AMC-shaped body vs. a Warranty-shaped body is one endpoint with two request-body contract variants, not two endpoints. Different body shapes belong in the contract's request-schema documentation, not in the endpoint count.
- **Export/CSV/download/report/dashboard/lookup endpoints count normally.** `GET /api/enquiries/export.csv`, `GET /api/inventory/dashboard`, `GET /api/contracts/pm-due` etc. are real registered routes and are counted exactly like any other endpoint — they are not excluded as "non-business" or "infrastructure" routes.
- **Parameterized routes count once**, regardless of how many runtime ID values will ever be substituted into them — `GET /api/projects/:id` is one endpoint whether the system ends up holding 10 projects or 10,000.
- **Route aliases / duplicate registrations:**
  - Two **distinct** registered paths that perform functionally similar work (e.g. a hypothetical `GET /api/projects/search` alongside `GET /api/projects?q=`) both count separately — functional similarity never merges two distinct registered paths into one count.
  - If the **same** method+path were ever found registered more than once in source (a true duplicate registration — the second registration would be dead code in Express, since the first handler wins), that is documented as a distinct **implementation issue** for a future task to resolve, and is **not** silently fixed in this documentation-only task. The canonical count counts the logical route contract once in that hypothetical case. (No such duplicate was found in the current source — see §12 Reconciliation below.)
- **Middleware does not create endpoints.** `authMiddleware`, `requireCompanyContext`, `rejectClientSuppliedCompanyId`, per-service `assertRole`/`assertCanManageX` checks, and the `handle()`/error-translation wrapper are all attached TO an endpoint; none of them is counted as an endpoint of its own.
- **App mounts (`app.use(...)`) are not themselves endpoints.** `app.use('/api/inventory', createInventoryRouter(...))` in `src/app.js` is a mount point, not a route; only the `router.<method>(path, ...)` calls registered inside the router it mounts are counted.
- **Health/auth/system routes count normally if actually registered and exposed.** `GET /api/health` is a real registered Express route (`app.get('/api/health', ...)` in `src/app.js`) and is counted as one endpoint (`EP-001` below) — it is not arbitrarily excluded as "infrastructure." Likewise every `/api/auth/*` and `/api/companies` route counts normally.

## 12. TOTAL IMPLEMENTED API ENDPOINTS: 123

Derived fresh from a direct read of `new-app/backend/src/app.js`'s 12 mount points (`/api/auth`, `/api/companies`, `/api/users`, `/api/enquiries`, `/api/sales-orders`, `/api/payments`, `/api/projects`, `/api/contracts`, `/api/service-calls`, `/api/inventory`, `/api/checklist-templates`, `/api/notifications`) plus the one directly-registered `GET /api/health`, and every `router.<method>(path, ...)` call in each of the 12 files under `src/routes/`, resolved to its final mounted path. No number from any prior version of this document was assumed correct — every route was re-verified against current source during the Stage 6 Final Closure Audit (2026-09-27). **UPDATE (Stage 6 Final Closure, FIX-6-04): the prior frozen total of 109 (Phase B, FIX-3.8-01) never accounted for `checklistTemplateRoutes.js` (11 endpoints, FIX-3.3-01) or `notificationRoutes.js` (2 endpoints, FIX-B1) — both had been implemented and tested in earlier sessions but were never given a contract section or Endpoint Index rows — nor the `DELETE /api/companies/:id` route added by FIX-6-03 in the immediately-preceding Stage 6 session. All 14 are documented for the first time here (§2, §9a, §9b), raising 109 to 123. This is a documentation-only reconciliation: no new endpoint was implemented as part of closing this gap; all 14 already existed in registered route source and already had test coverage before this task began.**

### Module breakdown

| Module                | Endpoint Count |
| ---------------------- | -------------: |
| Auth                   |              3 |
| Company                |              2 |
| User                  |              5 |
| Enquiry               |             12 |
| SalesOrder            |              6 |
| Payment / Finance     |             11 |
| Project               |             27 |
| Contract              |              7 |
| ServiceCall           |              9 |
| Inventory             |             27 |
| ChecklistTemplate     |             11 |
| Notification          |              2 |
| System / Other        |              1 |
| **TOTAL**              |          **123** |

`Auth` (3, `src/routes/authRoutes.js`) and `Company` (2, `src/routes/companyRoutes.js`, the second added by FIX-6-03) are two separate routers mounted separately in `src/app.js`, each carrying its own `Module` value in the Endpoint Index below. `User` is its own separate router (`src/routes/userRoutes.js`), mounted at `/api/users`. `ChecklistTemplate` (`src/routes/checklistTemplateRoutes.js`, mounted at `/api/checklist-templates`) and `Notification` (`src/routes/notificationRoutes.js`, mounted at `/api/notifications`) are documented for the first time in this task (see §9a/§9b) — both were already implemented, tested, and mounted before this task began.

`System / Other` is the single directly-registered `GET /api/health` route (not mounted through any business/foundation router — registered directly on `app` in `src/app.js`).

## 13. Endpoint Index / Traceability Matrix

One row per canonical endpoint (123 rows, `EP-001`-`EP-123`), each independently re-verified against the current route source during this task, not carried over from any prior draft of this document. `EP-105`-`EP-109` (User) were added in Phase B, FIX-3.8-01. `EP-110`-`EP-123` (Company DELETE, ChecklistTemplate ×11, Notification ×2) are added in Stage 6 Final Closure (FIX-6-04) — all 14 document already-implemented, already-tested routes that had no prior Endpoint Index row; none is a newly-implemented endpoint. `EP-001`-`EP-109` are unchanged and were re-verified, not re-derived.

| Endpoint | Method | Final Path | Module | Route File | Service | Repository/Model | Test File | PWA Audit/Workflow |
|---|---|---|---|---|---|---|---|---|
| EP-001 | GET | `/api/health` | System | `src/app.js` | `(inline in app.js — no service layer)` | (none) | NONE — no test file exercises GET /api/health directly (gap) | n/a (infra route, not PWA-derived) |
| EP-002 | POST | `/api/auth/login` | Auth | `src/routes/authRoutes.js` | `src/auth/authService.js` | src/auth/repositories.mongoose.js (userRepo, sessionRepo) | tests/auth/authService.test.js, tests/auth/tokenService.test.js, tests/auth/middleware.test.js | API_AUTH_FOUNDATION.md |
| EP-003 | POST | `/api/auth/logout` | Auth | `src/routes/authRoutes.js` | `src/auth/authService.js` | src/auth/repositories.mongoose.js (userRepo, sessionRepo) | tests/auth/authService.test.js, tests/auth/tokenService.test.js, tests/auth/middleware.test.js | API_AUTH_FOUNDATION.md |
| EP-004 | GET | `/api/auth/me` | Auth | `src/routes/authRoutes.js` | `src/auth/authService.js` | src/auth/repositories.mongoose.js (userRepo, sessionRepo) | tests/auth/authService.test.js, tests/auth/tokenService.test.js, tests/auth/middleware.test.js | API_AUTH_FOUNDATION.md |
| EP-005 | POST | `/api/companies` | Company | `src/routes/companyRoutes.js` | `src/services/companyService.js` | src/auth/repositories.mongoose.js (companyRepo, userWriteRepo) | tests/auth/companyService.test.js | API_AUTH_FOUNDATION.md |
| EP-110 | DELETE | `/api/companies/:id` | Company | `src/routes/companyRoutes.js` | `src/services/companyService.js` | businessRepositories.mongoose.js (all 8 cascaded repos) + src/auth/repositories.mongoose.js (companyRepo) | tests/companyDeletion.test.js | STEP_6_API_TEST_HARDENING.md (FIX-6-03) |
| EP-105 | GET | `/api/users` | User | `src/routes/userRoutes.js` | `src/services/userService.js` | src/auth/repositories.mongoose.js (userWriteRepo) | tests/userService.test.js, tests/userManagementWorkflow.test.js | E2E_PASS_3_8_MASTER_RECONCILIATION.md (FIX-3.8-01) |
| EP-106 | GET | `/api/users/:id` | User | `src/routes/userRoutes.js` | `src/services/userService.js` | src/auth/repositories.mongoose.js (userWriteRepo) | tests/userService.test.js | E2E_PASS_3_8_MASTER_RECONCILIATION.md (FIX-3.8-01) |
| EP-107 | POST | `/api/users` | User | `src/routes/userRoutes.js` | `src/services/userService.js` | src/auth/repositories.mongoose.js (userWriteRepo) | tests/userService.test.js, tests/userManagementWorkflow.test.js | E2E_PASS_3_8_MASTER_RECONCILIATION.md (FIX-3.8-01) |
| EP-108 | PATCH | `/api/users/:id` | User | `src/routes/userRoutes.js` | `src/services/userService.js` | src/auth/repositories.mongoose.js (userWriteRepo) | tests/userService.test.js | E2E_PASS_3_8_MASTER_RECONCILIATION.md (FIX-3.8-01) |
| EP-109 | DELETE | `/api/users/:id` | User | `src/routes/userRoutes.js` | `src/services/userService.js` | src/auth/repositories.mongoose.js (userWriteRepo) | tests/userService.test.js | E2E_PASS_3_8_MASTER_RECONCILIATION.md (FIX-3.8-01) |
| EP-006 | POST | `/api/enquiries` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-007 | GET | `/api/enquiries/lost` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-008 | GET | `/api/enquiries/reports/summary` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-009 | GET | `/api/enquiries/reports/followups-due` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-010 | GET | `/api/enquiries/export.csv` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-011 | GET | `/api/enquiries` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-012 | GET | `/api/enquiries/:id` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-013 | PATCH | `/api/enquiries/:id` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-014 | POST | `/api/enquiries/:id/follow-ups` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-015 | POST | `/api/enquiries/:id/mark-lost` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-016 | POST | `/api/enquiries/:id/reopen` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-017 | POST | `/api/enquiries/:id/convert` | Enquiry | `src/routes/enquiryRoutes.js` | `src/services/enquiryService.js` | businessRepositories.mongoose.js (enquiryRepo) | tests/enquiryService.test.js, tests/enquiryConversion.test.js | PWA_COVERAGE_AUDIT_ENQUIRY.md |
| EP-018 | POST | `/api/sales-orders` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-019 | GET | `/api/sales-orders/export.csv` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-020 | GET | `/api/sales-orders` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-021 | GET | `/api/sales-orders/:id` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-022 | PATCH | `/api/sales-orders/:id` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-023 | POST | `/api/sales-orders/:id/milestones/:mi/raise` | SalesOrder | `src/routes/salesOrderRoutes.js` | `src/services/salesOrderService.js, src/services/salesOrderCascade.js` | businessRepositories.mongoose.js (salesOrderRepo) | tests/salesOrderService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md |
| EP-024 | GET | `/api/payments/export/pending.csv` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-025 | GET | `/api/payments/export/receipts.csv` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-026 | GET | `/api/payments` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-027 | POST | `/api/payments` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-028 | GET | `/api/payments/:id` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-029 | PATCH | `/api/payments/:id/milestone` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-030 | POST | `/api/payments/:id/follow-up` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-031 | POST | `/api/payments/:id/part-payments` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-032 | PATCH | `/api/payments/:id/part-payments/:partId` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-033 | DELETE | `/api/payments/:id/part-payments/:partId` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-034 | DELETE | `/api/payments/:id` | Payment | `src/routes/paymentRoutes.js` | `src/services/paymentService.js` | businessRepositories.mongoose.js (paymentRepo) | tests/paymentService.test.js | PWA_COVERAGE_AUDIT_SALESORDER.md (ledger behavior); no dedicated Payment audit file exists |
| EP-035 | GET | `/api/projects/export.csv` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-036 | GET | `/api/projects` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-037 | GET | `/api/projects/:id` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-038 | POST | `/api/projects/:id/stage` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-039 | PATCH | `/api/projects/:id/vendor` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-040 | POST | `/api/projects/:id/engineers` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-041 | POST | `/api/projects/:id/timeline` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-042 | PATCH | `/api/projects/:id/checklist/:i/target-date` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-043 | POST | `/api/projects/:id/checklist` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-044 | PATCH | `/api/projects/:id/checklist/:i` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-045 | DELETE | `/api/projects/:id/checklist/:i` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-046 | POST | `/api/projects/:id/checklist/apply` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-047 | POST | `/api/projects/:id/checklist/:i/tick` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-048 | PATCH | `/api/projects/:id/checklist/:i/remark` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-049 | POST | `/api/projects/:id/checklist/:i/photos` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-050 | POST | `/api/projects/:id/checklist/:i/approve` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-051 | POST | `/api/projects/:id/checklist/:i/pm-sign` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-052 | POST | `/api/projects/:id/updates` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-053 | POST | `/api/projects/:id/delivery-challans` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-054 | PATCH | `/api/projects/:id/delivery-challans/:i` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-055 | DELETE | `/api/projects/:id/delivery-challans/:i` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-056 | POST | `/api/projects/:id/delivery-challans/:i/return` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-057 | GET | `/api/projects/:id/delivery-challans/export.csv` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-058 | GET | `/api/projects/:id/report` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-059 | GET | `/api/projects/:id/report/export.csv` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-060 | POST | `/api/projects/:id/delay-check` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-061 | POST | `/api/projects/:id/service-conversion/prepare` | Project | `src/routes/projectRoutes.js` | `src/services/projectService.js` | businessRepositories.mongoose.js (projectRepo) | tests/projectService.test.js | PWA_COVERAGE_AUDIT_PROJECT.md |
| EP-062 | GET | `/api/contracts/export.csv` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-063 | GET | `/api/contracts/pm-due` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-064 | GET | `/api/contracts/renewal-opportunities` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-065 | GET | `/api/contracts` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-066 | GET | `/api/contracts/:id` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-067 | POST | `/api/contracts` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-068 | POST | `/api/contracts/from-project/:projectId` | Contract | `src/routes/contractRoutes.js` | `src/services/contractService.js` | businessRepositories.mongoose.js (contractRepo) | tests/contractService.test.js | PWA_COVERAGE_AUDIT_CONTRACT.md |
| EP-069 | GET | `/api/service-calls/open` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-070 | GET | `/api/service-calls/export.csv` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-071 | GET | `/api/service-calls` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-072 | GET | `/api/service-calls/:id` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-073 | POST | `/api/service-calls/complaints` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-074 | POST | `/api/service-calls/pm/:contractId` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-075 | PUT | `/api/service-calls/:id/assign` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-076 | PUT | `/api/service-calls/:id/report` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-077 | POST | `/api/service-calls/:id/complete` | ServiceCall | `src/routes/serviceCallRoutes.js` | `src/services/serviceCallService.js` | businessRepositories.mongoose.js (serviceCallRepo) | tests/serviceCallService.test.js | PWA_COVERAGE_AUDIT_SERVICECALL.md |
| EP-078 | GET | `/api/inventory/categories` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-079 | POST | `/api/inventory/categories` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-080 | PUT | `/api/inventory/categories/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-081 | DELETE | `/api/inventory/categories/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-082 | GET | `/api/inventory/locations` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-083 | POST | `/api/inventory/locations` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-084 | PUT | `/api/inventory/locations/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-085 | DELETE | `/api/inventory/locations/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-086 | GET | `/api/inventory/items` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-087 | POST | `/api/inventory/items` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-088 | GET | `/api/inventory/items/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-089 | PUT | `/api/inventory/items/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-090 | DELETE | `/api/inventory/items/:id` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-091 | POST | `/api/inventory/items/:id/adjust` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-092 | POST | `/api/inventory/issues` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-093 | POST | `/api/inventory/issues/:id/return-request` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-094 | POST | `/api/inventory/issues/:id/accept-return` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-095 | POST | `/api/inventory/issues/:id/reject-return` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-096 | POST | `/api/inventory/issues/:id/mark-used` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-097 | POST | `/api/inventory/transfers` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-098 | GET | `/api/inventory/dashboard` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-099 | GET | `/api/inventory/my-material` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-100 | GET | `/api/inventory/reports/stock.csv` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-101 | GET | `/api/inventory/reports/issued.csv` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-102 | GET | `/api/inventory/reports/transactions.csv` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-103 | GET | `/api/inventory/reports/my-material.csv` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |
| EP-104 | GET | `/api/inventory/reports/returns.csv` | Inventory | `src/routes/inventoryRoutes.js` | `src/services/inventoryService.js` | businessRepositories.mongoose.js (inventoryCategoryRepo/inventoryLocationRepo/inventoryItemRepo/inventoryIssueRepo/inventoryTransactionRepo) | tests/inventoryService.test.js | PWA_COVERAGE_AUDIT_INVENTORY.md |

| EP-111 | GET | `/api/checklist-templates` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-112 | GET | `/api/checklist-templates/:id` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-113 | POST | `/api/checklist-templates` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-114 | POST | `/api/checklist-templates/:id/duplicate` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-115 | PATCH | `/api/checklist-templates/:id/rename` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-116 | POST | `/api/checklist-templates/:id/set-default` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-117 | DELETE | `/api/checklist-templates/:id` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-118 | POST | `/api/checklist-templates/:id/items` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-119 | PATCH | `/api/checklist-templates/:id/items/:i` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-120 | DELETE | `/api/checklist-templates/:id/items/:i` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-121 | POST | `/api/checklist-templates/:id/items/:i/move` | ChecklistTemplate | `src/routes/checklistTemplateRoutes.js` | `src/services/checklistTemplateService.js` | businessRepositories.mongoose.js (checklistTemplateRepo) | tests/checklistTemplateService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-122 | GET | `/api/notifications` | Notification | `src/routes/notificationRoutes.js` | `src/services/notificationService.js` | businessRepositories.mongoose.js (notificationRepo) | tests/notificationService.test.js | STAGE_6_FINAL_CLOSURE.md |
| EP-123 | PATCH | `/api/notifications/:id/read` | Notification | `src/routes/notificationRoutes.js` | `src/services/notificationService.js` | businessRepositories.mongoose.js (notificationRepo) | tests/notificationService.test.js | STAGE_6_FINAL_CLOSURE.md |

## 14. ENDPOINT COUNT RECONCILIATION

```
A. Number of registered canonical HTTP routes (src/app.js + all src/routes/*.js, re-grepped fresh, independently script-derived): 123
B. Number of rows in Endpoint Index (§13 above): 123
C. Number of rows in Traceability Matrix (§13 above — the Endpoint Index IS the Traceability Matrix in this document; one combined table, not two separate ones, per the column set required): 123
D. Number of endpoints by module (§12 table): 3 + 2 + 5 + 12 + 6 + 11 + 27 + 7 + 9 + 27 + 11 + 2 + 1 = 123
E. Final canonical total: 123
```

**A = B = C = E: 123 = 123 = 123 = 123. Module totals (D) sum exactly to E (123 = 123).**

**Reconciliation: PASS.** The API contract's endpoint surface is considered **frozen** at 123 canonical endpoints as of the Stage 6 Final Closure Audit (2026-09-27, FIX-6-04) — up from the prior frozen total of 109 (2026-09-26, Phase B FIX-3.8-01). The difference (+14) is **entirely a documentation-gap closure, not new implementation**: `DELETE /api/companies/:id` (added by the immediately-preceding Stage 6 session's FIX-6-03, never documented), and all 11 `checklistTemplateRoutes.js` endpoints plus both `notificationRoutes.js` endpoints (both routers implemented and tested in still-earlier sessions — FIX-3.3-01 and FIX-B1 respectively — but never given a contract section or Endpoint Index rows at all). No duplicate method+path registration was found anywhere in `src/app.js` or any file under `src/routes/` (each of the 123 `(method, path)` pairs is unique — independently verified by a script-driven uniqueness check during derivation, not merely asserted). EP numbers `EP-105`-`EP-110` are positioned in the Endpoint Index table immediately after the Company row (`EP-005`) for module-grouping readability; `EP-111`-`EP-123` are appended at the physical end of the table. Neither is more than a presentation choice — it does not affect A=B=C=E above (every EP id is still unique and every row still independently counted).

If a future task ever finds A ≠ B ≠ C ≠ E, or a module sum ≠ E, that future task's report MUST state explicitly that the API contract is **NOT** considered frozen at that point, and must explain the discrepancy (e.g. a route added to source but not yet documented here, or a documented row for a route that was since removed) rather than silently forcing the numbers to match.

## 15. ENDPOINT vs. WORKFLOW — REQUIRED DISTINCTION

An **end-to-end business workflow** (e.g. Enquiry → SalesOrder → Project → Payment → Notification, or Service Complaint register → assign → report → complete) is **NOT an endpoint**. A workflow is one business process that spans multiple endpoints, called in sequence (sometimes across multiple HTTP requests, sometimes as one endpoint that internally triggers a multi-collection cascade in one transaction, per §6/§7 above). Conversely, a single endpoint can perform multiple database writes internally (e.g. `POST /api/enquiries/:id/convert` writes Enquiry, SalesOrder, Project, and optionally Payment inside one `withTransaction`) and still counts as **exactly one** endpoint — the endpoint count is about registered HTTP surface, not about how many collections a handler touches or how many workflow steps a business process has.

This distinction MUST be used throughout every future report in this engagement: a claim like "12 workflows are verified" is never interchangeable with, and never implies anything about, "104 endpoints are implemented" — they are two different, non-substitutable counts, and a report that conflates them (e.g. treats "workflow coverage" as evidence of "endpoint coverage" or vice versa) is not acceptable under this standard.

## 16. FUTURE REPORTING STANDARD (MANDATORY for all subsequent implementation/audit tasks in this engagement)

No future report in this engagement may simply say "X routes" or "X endpoints" without stating whether X means **registered**, **documented**, or **tested** endpoints — these are three different counts and can differ (e.g. a route can be registered in source but not yet have a row in this document's Endpoint Index, or have a row here but no passing test asserting its behavior). Every future report that states an endpoint count MUST use this exact format:

```
Endpoint Count:
- Registered canonical endpoints: <N, from a fresh grep of src/app.js + src/routes/*.js>
- Endpoint Index rows: <N, from this document's §13 table>
- Traceability Matrix rows: <N, same table — see §14 note on this document combining both>
- Final canonical total: <N>
- Reconciliation: PASS / FAIL
```

And, per module, whenever a module-level claim is made:

```
Module Endpoint Count:
- Registered: <N>
- Documented: <N>
- Tested: <N — count of endpoints in that module with at least one passing test asserting their behavior, not merely "the module has a test file">
- Reconciliation: PASS / FAIL
```

A module's "Tested" count of 0 (see `System / Other` / `GET /api/health` in §13 above, which currently has no dedicated test) is not itself a defect to silently fix in a documentation task — it is a finding to report honestly, exactly as this document does.
