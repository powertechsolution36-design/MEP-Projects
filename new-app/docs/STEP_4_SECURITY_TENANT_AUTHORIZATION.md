# STAGE 4 — Security / Tenant / Authorization Verification

Date: 2026-09-26
Scope: full NEW APP backend (`new-app/backend/`). Verification only, with
authorization to fix a genuine P0/P1 gap in-place (none was found). v2/v3
and both PWA files untouched throughout.

## STAGE 4 STATUS: PASS

No P0/P1 security, tenant, or authorization gap was found. One TEST
COVERAGE GAP was found and closed (new regression tests added; no
production code was changed).

## 4.1 Authentication verification

Verified by direct code review AND by re-running the existing, comprehensive
`tests/auth/` suite (43/43 passing) plus `tests/userManagementWorkflow.test.js`:

| Concern | Verified by | Result |
|---|---|---|
| Login (correct company+username+password) | `authService.test.js` #5 | MATCH |
| Wrong password / unknown user (no enumeration leak) | `authService.test.js` #6/#7 | MATCH |
| Password hashing | `passwordHasher.test.js`, bcrypt via `src/auth/passwordHasher.js`, never plaintext at rest | INFRASTRUCTURE-ONLY DIFFERENCE (approved: PWA stores/displays plaintext password) |
| Inactive user rejected | `authService.test.js` #8 | MATCH |
| Session creation / `/me` resolution | `authService.test.js` #9/#11, `authRoutes.js` `GET /me` | MATCH |
| Expired session rejected | `authService.test.js` #10, `tokenService.test.js` #10 | MATCH |
| Session revocation (logout) | `authService.test.js` #13, idempotent double-logout | MATCH |
| Invalid/garbage/missing token | `authService.test.js` #12, `middleware.test.js` | MATCH |
| Token forgery (wrong secret / no secret) | `tokenService.test.js` | MATCH |
| Company isolation at login | `authService.test.js` #14/#15 | MATCH |
| New-user login | `userManagementWorkflow.test.js` "a newly-created user can log in..." | MATCH |
| Password change then login with new password | `userManagementWorkflow.test.js` | MATCH |
| Safe user response never includes password hash | `authService.test.js` #20, `userRoutes.js`/`userService.js` comments | MATCH |

No gaps. `req.auth.companyId` is populated exclusively from the verified
session (`authMiddleware.js`), never from client-supplied data — this is
the single source of tenant truth used everywhere downstream.

## 4.2 Role verification (all 11 roles)

`src/models/shared/enums.js` `ROLES` = exactly the 11 PWA roles: `super,
admin, sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr,
service_eng, finance` — verified against PWA `MENUS` object
(`MEP_PROJECTS_PWA/index.html` line 1289) key-for-key. No V3 role rules were
imported (V3 untouched, confirmed by safety check). No gaps.

## 4.3 User administration verification

`new-app/backend/src/services/userService.js` (FIX-3.8-01, P0, already
resolved and re-verified in Pass 3.8) re-verified in this stage:

- **admin-only gate**: `assertIsAdmin` on every operation (list/get/create/
  update/delete) — matches PWA FACT (`MENUS.admin` is the only role array
  containing `"users"`).
- **Create/list/detail/edit/role assignment/password change**: all present
  and company-scoped (`userWriteRepo.findByIdAndCompany` /
  `listByCompany`). `role: "super"` cannot be assigned
  (`assertAssignableRole`); a PM role is rejected if the company doesn't
  subscribe to that division (`assertRoleAllowedForCompany`).
- **Delete**: hard delete, no cascade — PWA FACT, preserved exactly.
- **Self-delete restriction**: re-verified still enforced —
  `deleteUser` throws `FORBIDDEN` when
  `String(existing.id) === String(actorAuth.userId)`. Confirmed by
  `userService.test.js` "deleteUser — an admin cannot remove their own
  login" (passing in this stage's regression run).
- **Role usage across other modules** (Project/ServiceCall/Inventory/
  Finance/Notifications/Accounts): every place a client-supplied user id is
  resolved into a role-bearing actor (`assignEngineers` in
  `projectService.js`, `assignEngineer` in `serviceCallService.js`,
  `issueMaterial`'s recipient in `inventoryService.js`) independently
  re-checks `String(candidate.companyId) === String(actorAuth.companyId)`
  AND the candidate's role against a role allow-list
  (`ENGINEER_CANDIDATE_ROLES` / `RECIPIENT_ROLES`) before use — this closes
  what would otherwise be a cross-tenant user-id injection vector. No gap.

## 4.4 / 4.5 Tenant isolation verification (including DIRECT foreign-company lookups)

Every tenant-owned entity's direct-lookup route was tested — either by
pre-existing tests (re-run and confirmed passing) or by new probe tests
added in this stage where a route existed but no dedicated cross-tenant
test did. Both the real Mongo repositories
(`src/repositories/businessRepositories.mongoose.js`, `Model.findOne({_id,
companyId})`) and the in-memory test fakes (`tests/enquiryFakes.js`)
enforce the same `{ _id, companyId }` scoping — confirmed by direct code
read of both.

| Entity | Direct-lookup route exists? | Cross-company test | Result |
|---|---|---|---|
| Company | No `GET /:id` (only `POST /` for bootstrap, super-only) | N/A — no such route | N/A |
| User | `GET /api/users/:id` | `userService.test.js` "listUsers / getUser — tenant isolation" | TESTED — PASS |
| Enquiry | `GET /api/enquiries/:id` | **NEW**: `tenantIsolationCrossCompany.test.js` "getEnquiry direct lookup" (existing `editEnquiry` tenant test also re-confirmed) | TESTED — PASS |
| SalesOrder | `GET /api/sales-orders/:id` | **NEW**: `tenantIsolationCrossCompany.test.js` "getSalesOrder"/"editSalesOrder" | TESTED — PASS |
| Project | `GET /api/projects/:id` | `projectService.test.js` "tenant isolation: a project cannot be read or mutated across companies" | TESTED — PASS |
| Contract | `GET /api/contracts/:id` | `contractService.test.js` "getContract / completePmVisitForContract — cross-company access is rejected" | TESTED — PASS |
| ServiceCall | `GET /api/service-calls/:id` | `serviceCallService.test.js` "cross-tenant direct detail access is blocked" | TESTED — PASS |
| Payment | `GET /api/payments/:id` | **NEW**: `tenantIsolationCrossCompany.test.js` "getPayment"/"deletePaymentRecord" | TESTED — PASS |
| Notification | No `GET /:id` (list + mark-read only) | `notificationService.test.js` "markNotificationRead — tenant isolated" (mark-read is the only "direct" op) + list-scoping test | TESTED — PASS |
| ChecklistTemplate | `GET /api/checklist-templates/:id` | `checklistTemplateService.test.js` "getTemplate — ... tenant-isolated" | TESTED — PASS |
| InventoryCategory | rename/delete by `:id` (no standalone GET) | `inventoryService.test.js` "tenant isolation — item/category/location lookups" | TESTED — PASS |
| InventoryLocation | rename/delete by `:id` (no standalone GET) | same test as above | TESTED — PASS |
| InventoryItem | `GET /api/inventory/items/:id` | same test as above | TESTED — PASS |
| InventoryIssue | accept/reject/mark-used by `:id` (no standalone GET) | `inventoryService.test.js` "tenant isolation — issue lookups" | TESTED — PASS |
| InventoryTransaction | No direct-lookup route at all (append-only, by design — Decision 29) | N/A — no such route | N/A |

**13 of the 15 entities in scope have a direct-lookup route; all 13 were
tested with a real cross-company lookup attempt against the running
service layer (not just read as code) and all 13 correctly reject with a
404/"not found" — none leak another company's record.** The remaining 2
(Company, InventoryTransaction) have no direct-lookup route to test against
by design.

List/report/export/conversion/assignment paths were also spot-checked for
company scoping during this pass (`listByCompany` pattern everywhere;
`notificationService.test.js` explicitly seeds an `co2` notification and
confirms it never appears in a `co1` actor's list) — MATCH, no gaps.

## Authorization matrix

| Module | Operation | PWA Visible Intent (MENUS / in-code role check) | NEW APP Allowed Roles | Tenant | Result |
|---|---|---|---|---|---|
| Users | list/get/create/edit/delete | `MENUS.admin` only | `admin` (`assertIsAdmin`) | own company only | MATCH |
| Enquiry | create | sales-only screen | `CREATE_ROLES = [sales]` | own company | MATCH |
| Enquiry | edit/follow-up/mark-lost/reopen/convert | `MENUS.sales`/`admin` reach Enquiries | `MANAGE_ROLES = [sales, admin]` | own company | MATCH |
| SalesOrder | create/edit | sales+admin SO screens | `CREATE_ROLES/EDIT_ROLES = [sales, admin]` | own company | MATCH |
| SalesOrder | view | `MENUS.sos` on sales/admin/hvac_pm/solar_pm/mep_pm/finance | `VIEW_ROLES` (same 6) | own company; costing redacted for engineer/service_eng | MATCH |
| SalesOrder | raise milestone to Finance | PM/admin action | `RAISE_ROLES = [hvac_pm, solar_pm, mep_pm, admin]` | own company | MATCH |
| Project | vendor/timeline/checklist/DC edits | PM-only screens | `assertIsPM` (division-matched PM or admin) | own company | MATCH |
| Project | engineer assignment | PM-only, company-wide candidate pool | `assertIsPM` + candidate role in `ENGINEER_CANDIDATE_ROLES`, company-checked | own company | MATCH |
| Contract | create/from-project | `MENUS.admin`/`service_mgr` reach `pmlist` | `assertCanManageContracts` (admin/service_mgr) | own company | MATCH |
| Contract | list/pm-due/renewal | all company roles reach dashboard panels | any authenticated company role | own company | MATCH |
| ServiceCall | list/register/export | `MENUS.admin`/`service_mgr` reach `service` | `assertCanManageServiceCalls` (admin/service_mgr) | own company | MATCH |
| ServiceCall | assign engineer | admin/service_mgr action | `assertCanManageServiceCalls` + candidate in `ENGINEER_CANDIDATE_ROLES`, company-checked | own company | MATCH |
| ServiceCall | report/complete | assigned engineer or admin/service_mgr | `assertCanEditReport` | own company | MATCH |
| Payment | ledger/receipts export | `MENUS.finance`/`admin` reach `payments` | `LEDGER_ROLES = [finance, admin]` | own company | MATCH |
| Inventory | categories/locations/items/issues/transfers manage | `MENUS.inventory`/`admin` | `MANAGE_ROLES = [inventory, admin]` | own company | MATCH |
| Inventory | stock report view | broader Stock-screen roles (hvac_pm/solar_pm/service_mgr/admin/inventory), NOT mep_pm | `STOCK_REPORT_ROLES` (FIX-3.6-01, re-verified passing) | own company | MATCH |
| Inventory | issue recipient | any role except admin | `RECIPIENT_ROLES` (10 of 11 roles, admin excluded) | own company, role-checked | MATCH |
| ChecklistTemplate | edit library | PM/admin roles per division | `assertCanEditChecklistLibrary` | own company | MATCH |
| Notification | list/mark-read | every role sees own-role-targeted notifications | any authenticated role, `targetRoles`-filtered | own company | MATCH |

No entry in this matrix grants a permission the PWA does not demonstrate
(all role sets above are traced to PWA `MENUS`/inline role checks already
documented in each service module's own doc comments, established across
Passes 3.1–3.8 and re-confirmed by re-reading the PWA `MENUS` object and
each service file directly in this stage).

## Findings

### INFRASTRUCTURE-ONLY DIFFERENCE
- Password hashing (bcrypt) vs. PWA's plaintext storage/display — approved exception, unchanged.
- MongoDB ObjectIds / hashed passwords / `withTransaction` atomicity — approved infra adaptations, unchanged.

### TEST COVERAGE GAP (found and closed in this stage)
- `salesOrderService.test.js` and `paymentService.test.js` had no dedicated
  test exercising a direct cross-company lookup (`getSalesOrder`,
  `editSalesOrder`, `getPayment`, `deletePaymentRecord`), even though the
  underlying `salesOrderRepo.findById(companyId, id)` /
  `paymentRepo.findById(companyId, id)` scoping was already correct (same
  pattern as every other module). `enquiryService.test.js` similarly had no
  dedicated `getEnquiry` cross-company test (only `editEnquiry`'s).
  **Closed**: added `new-app/backend/tests/tenantIsolationCrossCompany.test.js`
  with 5 new tests, all passing against the real service layer — this is a
  test-only change; no production code was modified because none needed
  to be (the property being tested already held).

### SECURITY/TENANT GAP, AUTHORIZATION GAP, FUNCTIONAL GAP, PWA/NEW APP INCONSISTENCY
- None found.

### OPEN / NOT DETERMINABLE
- None in this stage's scope.

## Fix tasks

No FIX-4-XX was needed — no P0/P1 gap was found. The only change made in
this stage is the addition of `tenantIsolationCrossCompany.test.js` (a pure
test-coverage addition, not a fix to a defect).

## Tests

- Targeted: 5 new tests in `tenantIsolationCrossCompany.test.js`, all passing (see 4.4/4.5 table).
- Full regression: `node --test tests/*.test.js` → 300/300 passing;
  `node --test tests/auth/*.test.js` → 43/43 passing.
  **Total: 343/343 passing** (338 baseline + 5 new tenant-isolation tests). 0 failures.

## Carried-forward findings (not touched in this stage)

- **B2** — Company deletion/cascade (not in scope for Stage 4).
- **FIX-3.7-01/02/03/04** — notification content-fidelity gaps (not in scope for Stage 4).
- **Pass 3.2 report persistence gap** (not in scope for Stage 4).
- Two smaller P3 exporter/source-walk gaps from earlier passes (not in scope for Stage 4).
- Frontend (`new-app/frontend/`) is currently empty — Stage 4 explicitly did not touch the frontend.

None of these were silently closed; they remain open and are restated here per instruction.

## Safety

**Before this stage:**
- `git diff --name-status -- v2`: 37 files (baseline drift, unchanged)
- `git diff --name-status -- v3`: 0 files
- `git status --short`: pre-existing working-tree state only (no new-app changes yet)
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: both `111b53dba91704f96b83dae96c7793c6`
- `git diff --cached --name-status`: empty

**After this stage:**
- `git diff --name-status -- v2`: 37 files (unchanged)
- `git diff --name-status -- v3`: 0 files (unchanged)
- `git status --short`: unchanged outside `new-app/` (only untracked `new-app/` content, as before — this stage added 1 new test file and this doc, both under `new-app/`)
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: both still `111b53dba91704f96b83dae96c7793c6` (unchanged)
- `git diff --cached --name-status`: empty (nothing staged, nothing committed)

All safety invariants held throughout.

## Next step

STAGE 4 COMPLETE. Stages 5 (Concurrency/Atomicity), 6 (API Hardening), the
remaining notification/B2 fixes, and Stage 7 (full frontend build) plus
deployment are separate, much larger undertakings not attempted in this
task.
