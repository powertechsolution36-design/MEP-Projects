# PASS 3.8 — MASTER MEP PROJECTS PWA RECONCILIATION

Phase A, read-only. No `new-app/` application source, test, v2/, or v3/ file
was modified in this pass. Executed 2026-09-26 against the live repo at
`C:\Projects\MEP-Projects` via the connected-device bridge.

## STEP 3.8 STATUS

**BLOCKED.**

Reasoning (per the exit rule in `E2E_WORKFLOW_VERIFICATION_PLAN.md` /
`STAGED_IMPLEMENTATION_PLAN.md`, and per the engagement's own rule that a
missing frontend/backend capability does not disappear because individual
module passes (3.1-3.7) each PASSed):

- All 12 workflows and all 8 module passes (3.1, 3.3-3.7; 3.2's report file
  is itself missing - see Open Findings) individually reconcile to PASS or
  PASS(post-fix) for **backend/PWA functional parity**. No new P0/P1
  functional gap was found in this reconciliation pass beyond what was
  already carried forward.
- However, `STAGED_IMPLEMENTATION_PLAN.md` (the authoritative sequencing
  document) explicitly scopes STEP 3 to backend workflow verification only
  (its STEP 3 Inputs/Objective never reference frontend code) and explicitly
  defers all frontend/client work to **STEP 7**, gated behind STEP 4, 5 and
  6. This is genuine, explicit, pre-existing project-authority permission
  (per rule 11(a) of this task) to treat backend-workflow reconciliation and
  frontend integration as separately sequenced steps - so a missing
  frontend, by itself, does not retroactively fail STEP 3's own backend
  scope.
- **But the account/user/role master reconciliation (task item 6) is
  explicitly inside STEP 3's own scope** (STEP 3 workflows include
  role/tenant/notification fan-out, and PASS 3.8's own task text requires
  reconciling Company->Users->Roles->Assignments). That reconciliation
  finds a **backend, not merely frontend, functional gap**: there is no
  user-management API anywhere in `new-app/backend` - no way, over HTTP, to
  create, list, edit, deactivate, or reassign the role of any User after a
  company's single bootstrap admin is created. This is a real, in-scope,
  unresolved functional gap in the connected account/role system STEP 3 is
  chartered to verify, not a frontend-only absence. It independently blocks
  a clean STEP 3 PASS regardless of the frontend framing above.
- Therefore: **Step 3 = PASS FOR BACKEND/PWA FUNCTIONAL WORKFLOW
  RECONCILIATION (Enquiry/SO/Payment/Project/Checklist/Contract/
  ServiceCall/Inventory/Notifications)**, but **Step 3 = BLOCKED for the
  Company/User/Role account-management workflow**, because the
  user-management backend API does not exist. Per rule 6 ("do not hide the
  gap as 'just a frontend problem' if the backend API is also missing"),
  this is reported as BLOCKED, not PASS.
- Frontend integration (STEP 7) additionally cannot begin at all today -
  `new-app/frontend/` is a placeholder with zero screens - but that fact
  alone is explicitly NOT a STEP 3 blocker under the plan's own sequencing
  (STEP 7 is a later, separately gated step). It is reported here as a
  required, unstarted future step, not as the reason STEP 3 is BLOCKED.

No new P0/P1 finding requires a brand-new `FIX-3.8-XX` fix implementation
beyond what passes 3.1-3.7 already opened; the User-Management-API gap was
already discovered and named (as a fact) in Pass 3.5, but was never given a
FIX id or formal priority classification in any prior pass. This pass
assigns it one for the first time: **FIX-3.8-01** (see Fix tasks below).

## PWA coverage

- **Entities: 15/15** reconciled (Company, User, Enquiry, SalesOrder,
  Project, ServiceCall, Contract, Payment, Notification,
  ChecklistTemplate, InventoryCategory, InventoryLocation, InventoryItem,
  InventoryIssue, InventoryTransaction) - 14/15 MATCH or
  INFRASTRUCTURE-ONLY DIFFERENCE at the backend-model/CRUD level; **User is
  a FUNCTIONAL GAP** (model + auth-login exist; management CRUD does not).
- **Workflows: 12/12** traced across passes 3.1-3.7 (Enquiry->SO;
  SO->Project/Payment/Checklist/Notifications; Project timeline/checklist;
  checklist approval; Project completion; Commissioning->Contract/service;
  Contract->PM visits; Service complaint lifecycle; Inventory issue/return;
  Payment collection/part-payment/raise; Finance interactions;
  Notifications). All 12 reconcile to PASS at the backend-workflow level.
  None of the 12 depends on the missing User-management API to function
  (role checks read the already-created User records; they just cannot be
  created/edited/deactivated through the API after bootstrap).
- **Notification call sites: 25/25** reconciled in Pass 3.7 (re-confirmed,
  not re-derived, this pass - Enquiry=0, SalesOrder=2, Payment/Finance=3,
  Checklist=3, Project=6, Contract=1, ServiceCall=5, Inventory=5).
- **Roles: 11/11** traced (super, admin, sales, hvac_pm, solar_pm, mep_pm,
  engineer, inventory, service_mgr, service_eng, finance) - see Master
  account/role section.
- **Connections:** the master relationship matrix below covers 25
  demonstrated cross-module PWA relations, all MATCH or approved
  INFRASTRUCTURE-ONLY DIFFERENCE except the User-management gap already
  named.
- **Checklists:** ChecklistTemplate CRUD fully implemented
  (FIX-3.3-01, re-confirmed live this pass: `checklistTemplateRoutes.js`
  has 6 GET/POST/PATCH/DELETE handlers mounted at
  `/api/checklist-templates`).
- **Reports/Exports:** all CSV exports named in passes 3.1/3.5/3.6/3.7
  re-confirmed present (Payments, ServiceCall, Stock, Issued Material,
  Transactions, My Material, Material Returns).

## Master relationship status

25 demonstrated cross-module relations were reconciled (Company<->User,
Company<->{Enquiry,SalesOrder,Project,Contract,ServiceCall,Payment,
Inventory}, User<->{Enquiry,SalesOrder,Project,Contract,ServiceCall,
Inventory}, Enquiry->SalesOrder, SalesOrder->{Project,Payment,Checklist,
Notification}, Project->{Checklist,Contract,Payment-visibility,
Notification}, Contract->{ServiceCall,Notification}, ServiceCall->{Payment,
Notification}, Inventory->{Staff/User,Project-field,Notification},
Payment->Finance, Notification->User/Role). Every one of these is MATCH or
an approved INFRASTRUCTURE-ONLY DIFFERENCE (ObjectId refs replacing name/
numeric-id strings, real tenant scoping via session-derived `companyId`,
transactional writes). No relation was found broken or newly regressed.
The one open item is not a broken *relation* but a missing *write surface*:
User records can be read/referenced by every other module correctly, but
cannot be created/edited beyond the one bootstrap admin per company (see
Master account/user/role status).

Selected rows (full detail already carried in passes 3.1-3.7, re-confirmed
not re-derived, per Document Authority):

| Source | Target | PWA Relationship | NEW APP Write | NEW APP Read | Tenant | Auth | Result |
|---|---|---|---|---|---|---|---|
| Company | User | 1:many, `co` field | only at company-bootstrap (`companyService.createCompanyWithAdmin`) | session-scoped | company-scoped | `super` (create company) | FUNCTIONAL GAP (no post-bootstrap write) |
| Enquiry | SalesOrder | direct conversion | `convertEnquiryToSalesOrder` (txn) | scoped | scoped | role-checked | MATCH |
| SalesOrder | Project | cascade on creation | `salesOrderCascade.js` (txn) | scoped | scoped | role-checked | MATCH |
| SalesOrder | Payment | milestone-derived | `paymentService.js` | scoped | scoped | role-checked | MATCH |
| Project | Checklist | copy-on-create | `projectService.js` | scoped | scoped | role-checked | MATCH |
| Project | Contract | commissioning-derived | `contractService.js` | scoped | scoped | role-checked | MATCH |
| Contract | ServiceCall | PM-visit generation | `serviceCallService.js` | scoped | scoped | role-checked | MATCH |
| ServiceCall | Payment | chargeable-completion, write-only, no FK back | `paymentRepo.create` | scoped | scoped | none (matches PWA) | MATCH |
| Inventory | User (staff) | name string (PWA) -> ObjectId (NEW APP) | `issueMaterial` | scoped | scoped | staff same-company | INFRASTRUCTURE-ONLY DIFFERENCE |
| InventoryIssue | Project | write-only field, no functional integration either side | `issueMaterial` sets `projectId` | none | n/a | n/a | MATCH (both write-only) |
| Notification | User/Role | `targetRoles` array | `notificationService.js` (25/25 sites) | `/api/notifications` GET/PATCH | scoped | role-string match | MATCH |

## Finance connection status

Fully reconciled across passes 3.1 and 3.5, re-confirmed this pass:
SalesOrder->Payment Milestones->Payment->Part Payment->Received->Raise to
Finance->Finance Follow-up->Reports, and ServiceCall->Chargeable
Completion->Payment->Finance. `paymentService.js` implements milestone
sync, part-payment accumulation, the received-state flag, `raisedToFinance`
metadata (including `collectByDate`), and the pending-payments CSV export.
Cross-links SalesOrder<->Payment and ServiceCall->Payment are both one-way,
write-only (no back-reference), exactly matching PWA. Two carried-forward,
non-blocking content-fidelity findings remain open: **FIX-3.7-02** (payment
milestone-raised notification drops the "Collect by `<date>`" clause even
though the date is stored) and **FIX-3.7-03** (payment-received
notifications lack `money()` currency formatting used elsewhere in the same
codebase). Neither is a broken connection - both are notification-text
fidelity issues layered on top of an otherwise-correct finance workflow.
Result: **PASS with 2 open P2/P3 fixes carried forward, no new finance
connection defect found.**

## Service connection status

Fully reconciled in Pass 3.5, re-confirmed this pass:
Project->Contract/Warranty->PM->ServiceCall->Engineer->Report->Signature->
Completion->Payment(where chargeable)->Finance->Notification. Connection
types confirmed exactly as Pass 3.5 classified them: Contract->ServiceCall
is a direct reference (`contractId`, nullable, PM path only);
ServiceCall->Payment is write-only with no FK back; ServiceCall<->Inventory,
ServiceCall<->Project, and ServiceCall->customer-as-account are each **NO
RELATION DEMONSTRATED** in the PWA and correctly not built in NEW APP
(an absence correctly matched by an absence, not a gap). The one atomicity
strengthening (`completeIfNotCompleted`) remains an approved
INFRASTRUCTURE-ONLY closure of a PWA race, not a functional change.
Result: **PASS, no new service connection defect found.**

## Checklist connection status

ChecklistTemplate->SalesOrder Checklist->Project Checklist->Timeline->Item
Execution->Approval/Sign-off->PM countersign->Completion fully reconciled
in Pass 3.3 (post-fix) and re-confirmed live this pass. Template CRUD is
**fully implemented** (`checklistTemplateRoutes.js`: GET list, GET by id,
POST create, POST duplicate, PATCH update, DELETE, plus a seed default
route - 6+ verbs, matching PWA's `saveChkList`/`dupChkList`/`delChkList`).
Copy-on-create, item execution, late-execution, client sign-off, PM
countersign (non-gating, matching PWA quirk), and completion gates all
verified present in Pass 3.3/3.4. Notification persistence for checklist
events (FIX-B1) is live: `notificationService.js` + `/api/notifications`
mounted in `app.js`, and `delayCheckScheduler.js` runs the once-a-day delay
check. Result: **PASS, checklist functionality is fully implemented
post-FIX-3.3-01/FIX-B1, no regression found.**

## Accounts-User status

See "Master account/user/role reconciliation" below - this is the one area
of STEP 3 that does not reach a clean PASS.

## Master account/user/role reconciliation

All 11 PWA roles (super, admin, sales, hvac_pm, solar_pm, mep_pm, engineer,
inventory, service_mgr, service_eng, finance) are represented in NEW APP's
`roleDivision.js`/`roleMiddleware.js` and are correctly enforced at every
route this pass and prior passes checked (`requireRole`,
`assertCanViewStock`, `MANAGE_ROLES`, division checks). Role-based
notification targeting (`targetRoles`) and role-based menu-equivalent
authorization gates were reconciled module-by-module in 3.4-3.7 with only
the already-carried-forward FIX-3.6-01 (P3, `mep_pm`/`service_mgr`
over-grant on two CSV exports) as an open item.

**The user-management gap, reconciled explicitly per task item 6:**

- **What PWA has:** a full "Users" screen (admin-only menu item, index.html
  `MENUS`) backed by working functions to create a user, edit a user,
  assign/change a user's role, and (per `OPEN_DECISIONS.md`/PWA source)
  deactivate a user - all scoped to the admin's own company.
- **What NEW APP backend has:** confirmed live this pass by direct
  `find`/`grep` of `new-app/backend/src/routes/` and `src/services/`:
  - No `userRoutes.js` file exists.
  - `companyRoutes.js` exposes exactly one endpoint,
    `POST /api/companies` (`super`-only), which creates a company **and**
    its single initial admin user via `createCompanyWithAdmin`. This is
    the *only* way any User document is ever created over HTTP.
  - `authRoutes.js` exposes only login/logout/me - no create/list/update
    endpoint for `User`.
  - No service file (`companyService.js`, or any other) contains a
    create/update/list/deactivate function for `User` beyond the one
    bootstrap-admin path.
  - No test file targets user-management CRUD (`tests/` has no
    `userService.test.js` or equivalent).
- **Classification:** this is a **FUNCTIONAL GAP** (not merely a
  DOCUMENTATION GAP, and not "just a frontend problem" - there is no
  backend endpoint for the frontend to eventually call even if a frontend
  existed). It is a **backend implementation gap** in the account/role
  system that STEP 3 is chartered to verify.
- **Practical consequence:** a company can never have more than the single
  bootstrap admin created at company-creation time. There is no way, via
  the API, to add a `sales`, `hvac_pm`, `solar_pm`, `mep_pm`, `engineer`,
  `inventory`, `service_mgr`, `service_eng`, or `finance` user to any
  company - every one of the 11 PWA roles other than that one bootstrap
  admin has no route to actually get a real user account in NEW APP today.
  This is assessed as **P0** (see Finding priority) because it prevents
  core company operation: a real company (e.g. MEP Powertech itself) needs
  many users across many roles, and none beyond the founding admin can be
  provisioned.

**Fix tasks arising:** **FIX-3.8-01** (new, P0) - implement a
user-management service + route (`userService.js`/`userRoutes.js`,
company-scoped, admin-authorized) providing at minimum create/list/update/
deactivate for `User` and role (re)assignment, matching the PWA's Users
screen functions, per the mandatory Phase B protocol (separate
implementation cycle, not performed in this Phase A pass).

## Frontend status

**Explicit and unchanged since Pass 3.5:** `new-app/frontend/` contains
exactly one file, `README.md`, whose own text says "Placeholder only - no
code yet." `find new-app/frontend -type f` returns only that file - no
`package.json`, no source directory, no build tooling. **Zero screens of
any kind exist for any of the 12 PWA domains** (Accounts/Users, Enquiry,
SalesOrder, Finance/Payments, Checklist, Project, Contract, ServiceCall,
Inventory, Notifications, Reports, Exports). This is stated plainly per
instruction; it has not changed since Pass 3.5 discovered it, and this pass
independently re-verified it live via `device_bash`/`find`, not from
memory of the prior report.

Per `STAGED_IMPLEMENTATION_PLAN.md`, frontend work is explicitly **STEP 7**
- gated behind STEP 4 (Security/Tenant), STEP 5 (Concurrency), and STEP 6
(Test hardening), none of which have started. Frontend integration cannot
begin today regardless of STEP 3's outcome, and per plan design this is
expected at this point in the sequence, not evidence STEP 3 itself failed
- except where a module's backend API for frontend binding is itself
missing (see User-management, immediately above), which *is* a STEP 3
finding.

## User-management API

**Confirmed missing, this pass, live from source** (not carried forward
from memory): no `userRoutes.js`; no service-level user CRUD beyond
company-bootstrap; no tests. See Master account/user/role reconciliation
above for full detail and the new **FIX-3.8-01 (P0)** this pass assigns to
it.

## Open findings

Pulled by actually re-reading all 7 prior pass reports plus the master
Step-2 audit, this session:

| Item | Priority | Source pass | Status | Evidence |
|---|---|---|---|---|
| **User-management API missing** | **P0** | 3.5 (discovered), 3.8 (classified/fix-id assigned) | OPEN | No `userRoutes.js`; `companyRoutes.js` only creates bootstrap admin; confirmed live this pass |
| **Frontend (`new-app/frontend/`) is an empty placeholder** | P1 (blocks STEP 7 start; does not block STEP 3 per plan's own sequencing) | 3.5 (discovered), re-confirmed every pass since | OPEN | `find new-app/frontend -type f` = README.md only, confirmed live this pass |
| **B2 - Company deletion/cascade not implemented** | P2 | Step-2 master audit (untouched since) | OPEN, unchanged | `companyService.js` has no delete/cascade function; PWA's `delCompany()` cascades 8/15 collections; deletion depends on an unresolved business decision (`OPEN_DECISIONS.md` #13, Inventory-cascade question) |
| **FIX-3.6-01 - Inventory `STOCK_VIEW_ROLES` over-grants `mep_pm`/over-grants Issued-Material report access** | P3 | 3.6, carried forward through 3.7 | OPEN, unchanged | See Master inventory reconciliation below |
| **FIX-3.7-01 - notification text emoji/dash punctuation drift** | P3 | 3.7 | OPEN, unchanged | `projectService.js`/`inventoryService.js` substitute ASCII `-` for PWA's em-dash/emoji in 3 of 25 notification strings |
| **FIX-3.7-02 - payment-milestone-raised notification drops "Collect by `<date>`" clause** | P2 | 3.7 | OPEN, unchanged | `paymentService.js:399`; real information loss, not cosmetic |
| **FIX-3.7-03 - payment-received notifications lack `money()` currency formatting** | P2/P3 | 3.7 | OPEN, unchanged | `paymentService.js:168,179`; internal inconsistency vs. `serviceCallService.js`'s own use of `money()` |
| **FIX-3.7-04 - no exact-text test coverage for the 25 notification strings** | P3 | 3.7 | OPEN, unchanged | test-coverage gap, not a functional defect |
| **Pass 3.2 report file missing** (`E2E_PASS_3_2_SO_PROJECT.md`) | P3 (documentation gap) | Noted in orientation, confirmed this pass | OPEN | `ls new-app/docs \| grep 3_2` returns nothing; `E2E_WORKFLOW_VERIFICATION_PLAN.md` names the expected filename but no such file exists on disk |
| **3.1-I03 - `dlPayments()` CSV column order reconstructed, not independently re-derived from source** | P3 | 3.1, never closed | OPEN, unchanged | `paymentService.js`'s own doc comment self-flags this |
| **N2 (Step-2 master audit) - several CSV/report exporters not independently field-by-field re-walked** | P3 | Step-2 master audit | OPEN, low-impact, not independently re-tested this pass | Documentation-coverage note, not a defect |

No item above is newly discovered as a P0/P1 *functional workflow* gap in
this pass except the formal P0 classification now assigned to the
already-known User-management absence (FIX-3.8-01) - everything else is an
unchanged carry-forward, exactly as instructed.

## Fix tasks

- **FIX-3.8-01 (NEW, P0):** Implement `userService.js` + `userRoutes.js`
  (company-scoped, `admin`-authorized) for create/list/update/deactivate
  of `User` records and role (re)assignment, matching the PWA's Users
  screen. Blocks a clean STEP 3 PASS for the account/role workflow. Not
  implemented in this pass (Phase A, read-only) - requires a separate
  Phase B implementation cycle with targeted tests + full regression +
  re-verification before Pass 3.8 (account/role portion) may move from
  BLOCKED to PASS.
- **FIX-3.6-01 (P3, carried forward, unfixed):** narrow `STOCK_VIEW_ROLES`
  into `STOCK_REPORT_ROLES`/`ISSUED_REPORT_ROLES` per Pass 3.6's exact
  recommendation. Recommendation reaffirmed this pass: **fix before
  deployment is not mandatory** (P3, no cross-tenant exposure, read-only
  CSV over-grant to legitimate same-company PM/manager roles) but should be
  bundled into the same Phase B cycle as FIX-3.8-01 since both touch
  role-gating code, to avoid two separate regression passes.
- **FIX-3.7-01/02/03/04 (P2/P3, carried forward, unfixed):** notification
  content-fidelity and test-coverage items, unchanged from Pass 3.7.
- **B2 (P2, carried forward, unfixed):** Company deletion/cascade - blocked
  on an open business decision (`OPEN_DECISIONS.md` #13) before it can even
  be implemented; not scheduled ahead of FIX-3.8-01.

## Tests

`npm test` in `new-app/backend/` (run live this session):

```
# tests 313
# suites 0
# pass 313
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

313/313, matching the baseline carried through Passes 3.4-3.7 exactly - no
regression.

## Safety

Run live this session:

- `git diff --name-status -- v2` -> **37 files** - matches the required
  existing baseline exactly.
- `git diff --name-status -- v3` -> **0 files** - matches required.
- `md5sum index.html MEP_PROJECTS_PWA/index.html` -> both
  `111b53dba91704f96b83dae96c7793c6` - matches required, unchanged.
- `git diff --cached --name-status` -> empty - nothing staged.
- `git status --short` -> only `?? new-app/` (untracked, pre-existing
  working-tree state across all prior passes - `new-app/` itself has never
  been committed to this repo's git history at any point in this
  engagement); no unexpected v1/v2/v3/PWA modification.

All four required safety-check values are within tolerance. No unauthorized
drift found.

## Historical deadline

**MISSED.** The hard project target was **September 24, 2026, 23:59 IST**.
Today's actual date is **September 26, 2026** - the deadline passed
approximately two days ago. The target explicitly required "full required
MEP Projects PWA functional parity + critical security/tenant protection +
critical data integrity + frontend connected + full regression + deployed"
by that checkpoint. As of this reconciliation: the frontend is not
connected (it does not exist), STEP 4 (security/tenant verification) has
not been executed, and there is no deployment of any kind for `new-app`
(no CI/CD config, no Dockerfile, no deployment script, no `deploy/`
reference to `new-app` - the only `deploy/` content in this repo is an
`nginx` config unrelated to `new-app`). The deadline was **MISSED**, not
met, and this is reported plainly per the task's explicit instruction not
to hide a missed deadline.

## Current deadline status

**BLOCKED.**

Reasoning: not DEPLOYED (no frontend exists at all - a system with zero UI
screens cannot be in production regardless of backend quality; no
deployment configuration or evidence of any kind was found for `new-app`).
Not AT RISK (that status implies the deadline is still approachable; it has
already passed). Not simply MISSED as a terminal status for *current*
state, because "MISSED" describes the historical deadline outcome (above)
- the *current* operational status, per this task's required vocabulary,
is **BLOCKED**: STEP 3's account/role workflow cannot reach a clean PASS
until FIX-3.8-01 (user-management API) is implemented, STEP 4-6 have not
run, and STEP 7 (frontend) has not started at all. No dishonest "ON TRACK"
or "DEPLOYED" framing is used here.

## Next step

**STEP 4 BLOCKED.**

Per `STAGED_IMPLEMENTATION_PLAN.md`'s own gate rule, STEP 4 requires STEP 3
declared PASS in full. STEP 3 is PASS for backend/PWA functional workflow
reconciliation across Enquiry/SO/Payment/Project/Checklist/Contract/
ServiceCall/Inventory/Notifications, but BLOCKED for the Company/User/Role
account-management workflow (FIX-3.8-01, P0, not yet implemented). Per this
task's explicit rule 12, Step 4 is **not** started automatically. A
separate Phase B implementation cycle for FIX-3.8-01 (and, ideally,
bundled FIX-3.6-01), followed by re-verification of the account/role
portion of Pass 3.8, is required before STEP 4 may begin.

---

# PHASE B ADDENDUM — FIX-3.8-01 (P0) + FIX-3.6-01 (P3) IMPLEMENTATION AND RE-VERIFICATION

Executed 2026-09-26 against the live repo at `C:\Projects\MEP-Projects` via the
connected-device bridge. Everything above this line is the original Phase A
(read-only) Pass 3.8 report and is **unchanged** — this addendum records the
separate Phase B implementation cycle that Pass 3.8 itself required before
STEP 4 could be considered.

## FIX-3.8-01 — P0 (User Management API)

**Status: RESOLVED.**

- **PWA behavior:** traced fresh from `MEP_PROJECTS_PWA/index.html`'s
  "ADMIN: USERS" block (`vUsers`, `mUser`, `saveUser`, `delUser`,
  ~L1819-1850), reachable only via `admin`'s own `MENUS` entry
  (`["users","👥 Users"]` — no other role's `MENUS` array contains
  `"users"`). List = every user of the admin's own company
  (`mine(DB.users)`), searchable client-side by name/username/role.
  Create/Edit fields: name, role, username, password. The role `<select>`
  explicitly skips `"super"` and skips any PM role
  (`hvac_pm`/`solar_pm`/`mep_pm`) whose division the company doesn't
  subscribe to (`hasDiv`/`ROLE_DIV`). `saveUser` requires only
  name+username non-blank and has no duplicate-username check on this path.
  Delete (`delUser`) is a hard delete with no cascade; its only
  self-delete restriction is UI-only (`u.id!==U.id` gates the Remove
  button, not the function itself). Zero `notify()` call sites exist
  anywhere in this block. PWA stores/displays the password in the clear.
- **NEW APP implementation:** `new-app/backend/src/services/userService.js`
  (`listUsers`, `getUser`, `createUser`, `updateUser`, `deleteUser`) +
  `new-app/backend/src/routes/userRoutes.js`, mounted at `/api/users` in
  `src/app.js` (minimal router-mount addition only, per the standing
  `app.js` convention — no restructuring). Reuses, rather than
  reimplementing: `assertRoleAllowedForCompany` (`src/auth/roleDivision.js`,
  the same helper `companyService.createCompanyWithAdmin` already uses),
  `toSafeUser` (`src/auth/authService.js`), the existing bcrypt
  `passwordHasher` (`SALT_ROUNDS=12`, unchanged, no new hashing library),
  `rejectClientSuppliedCompanyId`/`requireCompanyContext`
  (`src/middleware/tenantGuard.js`), and the pre-existing
  `{companyId,username}` unique index on `User.js` (already applied
  identically by `companyService.js` — not a new decision this fix
  introduces). Role assignment is admin-only, excludes `super`, and is
  division-gated for PM roles exactly as the PWA's role dropdown filters
  it. Delete is a hard delete with no cascade (PWA-exact), with one
  approved infrastructure-only exception: self-delete is rejected
  server-side (`403 FORBIDDEN`) — enforcing, server-side, the restriction
  the PWA's own UI clearly intends but never enforces in the function
  itself ("server-side authorization matching PWA-visible intent", per the
  approved exception list). **Password adaptation (the one approved
  security exception):** passwords are bcrypt-hashed immediately on create
  and on any password change; the plaintext is never stored, logged, or
  returned; edit's `password` field is optional (omit to keep the existing
  hash — the correct analog of the PWA client "not touching" the field,
  since our client can never read back a hash to resubmit it unchanged).
  No notification fires for any User action, matching the PWA's zero
  `notify()` sites. Deactivate/disable was deliberately **NOT** implemented
  — the PWA has no such feature (only hard delete), and `User.js`'s
  pre-existing `active` field (already load-bearing for login) is not
  exposed through this API, per the explicit instruction not to invent
  CRUD the PWA doesn't demonstrate.
- **User API endpoints (5, all under `/api/users`, admin-only, tenant-scoped):**
  `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`. Full contract
  in `new-app/docs/API_CONTRACT.md` §2a (EP-105–EP-109).
- **Multi-user workflow (re-verified live, not just "the API exists"):**
  `new-app/backend/tests/userManagementWorkflow.test.js` builds a company's
  entire post-bootstrap user roster using ONLY the new `userService`
  (never seeding users directly into a fake store) — bootstrap admin
  creates sales/hvac_pm/solar_pm/mep_pm/engineer/inventory/service_mgr/
  service_eng/finance users (all 9 non-admin, non-super roles) — then
  proves each is immediately usable by the OTHER already-implemented
  modules through the SAME `userRepoForEnquiry` lookup interface a real
  Mongoose deployment backs with the same `User` collection this API
  writes to:
  - Every created user can authenticate (`authService.login`) and gets the
    correct role/company session.
  - The `hvac_pm` user can be assigned as a Project engineer/PM candidate
    (`projectService.assignEngineers`).
  - The `service_eng`/`engineer`/`service_mgr` users can be assigned to a
    ServiceCall (`serviceCallService.assignEngineer`); a non-candidate role
    (`sales`) is correctly rejected.
  - The `inventory`-eligible `engineer` user can be the recipient of an
    Inventory Issue (`inventoryService.issueMaterial`); `admin` is
    correctly rejected as a recipient (PWA FACT).
  - The `finance` user correctly receives the chargeable-ServiceCall
    Payment notification (role-string match, PWA FACT).
  - A password changed via `updateUser` invalidates the old password and
    authenticates with the new one; a deleted user can no longer log in.
  All 6 workflow tests pass. This is genuine cross-module proof, not a
  constant-membership check.
- **Targeted tests:** `tests/userService.test.js` (17/17) +
  `tests/userManagementWorkflow.test.js` (6/6) = **23/23 passing**. Covers:
  authorization (admin-only), create validation (required fields, `super`
  rejection, division gating, per-company username uniqueness),
  list/get tenant isolation, update (rename, role reassignment incl.
  division re-check, password change, username-conflict rejection,
  no-op-on-omitted-fields, cross-company rejection), delete (hard delete
  no-cascade, self-delete rejection, cross-company rejection), and login
  integration (create→login, password-change→login, delete→login-rejected).
- **Full regression:** `npm test` (`tests/*.test.js tests/auth/*.test.js`):
  **338/338 passing, 0 failing** (up from the 313/313 baseline — 25 net new
  tests: 23 User-management + 2 FIX-3.6-01 Inventory-role). No existing
  test was modified to force a result; one existing scope-guard test
  (`tests/audit-corrections.test.js`) was updated to add `userRoutes.js`/
  `userService.js` to its explicitly-authorized file list — the guard's
  entire purpose is to fail on an unauthorized module addition, and this
  update documents that this addition IS authorized (this task), the same
  pattern every prior authorized module (Checklist Template, Notification)
  used when it was added.
- **Re-verification of the original P0 evidence:** the original Pass 3.8
  finding was "no `userRoutes.js`; `companyRoutes.js` only creates the
  bootstrap admin; no test file targets user-management CRUD." All three
  are now false: `userRoutes.js` exists and is mounted; a company can now
  provision a real user in every one of the 11 PWA roles (all except
  `super`, which the PWA itself never allows here); `userService.test.js`
  and `userManagementWorkflow.test.js` both exist and pass. The practical
  consequence Pass 3.8 flagged — "a company can never have more than the
  single bootstrap admin" — is verified, live, to no longer hold.
- **Final classification: RESOLVED.**

## FIX-3.6-01 — P3 (Inventory `STOCK_VIEW_ROLES` over-grant)

**Status: RESOLVED.**

- **PWA behavior:** `mep_pm`'s `MENUS` entry (`[dash,projects,sos,checklists]`)
  never includes `"stock"` — `mep_pm` never sees the Stock Report button.
  The `"invissue"` menu entry (which carries the `dlIssued()` "Issued
  Material Report" button) is visible only to `admin`/`inventory`, never
  `hvac_pm`/`solar_pm`/`mep_pm`/`service_mgr`.
- **Original NEW APP gap:** a single `STOCK_VIEW_ROLES =
  ['admin','inventory','hvac_pm','solar_pm','mep_pm','service_mgr']`
  gated BOTH `exportStockCsv` and `exportIssuedCsv`, over-granting `mep_pm`
  access to the Stock report and over-granting `hvac_pm`/`solar_pm`/
  `mep_pm`/`service_mgr` access to the Issued Material report.
- **Changed NEW APP implementation:**
  `new-app/backend/src/services/inventoryService.js` — split into
  `STOCK_REPORT_ROLES = ['admin','inventory','hvac_pm','solar_pm','service_mgr']`
  (drops `mep_pm`) gating `exportStockCsv`, and
  `ISSUED_REPORT_ROLES = ['admin','inventory']` gating `exportIssuedCsv`,
  exactly per Pass 3.6's own recommended fix. No other Inventory
  permission was touched.
- **Targeted tests:** 2 new tests in `tests/inventoryService.test.js` —
  `exportStockCsv` reachable by `hvac_pm`/`solar_pm`/`service_mgr`, rejected
  for `mep_pm`; `exportIssuedCsv` reachable by `admin`/`inventory` only,
  rejected for `hvac_pm`/`solar_pm`/`mep_pm`/`service_mgr`. Full Inventory
  suite: **52/52 passing** (up from 50/50).
- **Full regression:** included in the same 338/338 run above.
- **Re-verification:** re-opened the exact PWA `MENUS` evidence
  (`index.html` L1289-1300) that Pass 3.6 cited; confirmed the new role
  sets match it exactly (`mep_pm` excluded from Stock report;
  `hvac_pm`/`solar_pm`/`mep_pm`/`service_mgr` excluded from Issued
  Material report).
- **Final classification: RESOLVED.**

## User-management coverage (exact PWA functions implemented)

List, create, edit (name/username/role reassignment/password change),
delete (hard, no cascade) — exactly `vUsers`/`mUser`/`saveUser`/`delUser`'s
demonstrated scope, with the one approved password-hashing security
adaptation. NOT implemented, because not PWA-demonstrated: deactivate/
disable; a separate "reset password" flow distinct from edit; any
approval workflow around user creation/role change.

## User -> workflow connections (verified this task)

| Connection | PWA relation | Verified in NEW APP |
|---|---|---|
| User -> Project | engineer/PM assignment candidate pool (company-wide, no division filter — PWA FACT, `assignEngineers`) | `projectService.assignEngineers` accepts a `userService`-created `hvac_pm`/`engineer`/`service_eng` user's id |
| User -> ServiceCall | engineer assignment candidate = `service_eng`/`engineer`/`service_mgr` (PWA FACT, no division filter) | `serviceCallService.assignEngineer` accepts a `userService`-created candidate; rejects a `userService`-created `sales` user |
| User -> Inventory | Issue recipient = every role except `admin` (PWA FACT, `staffList()`) | `inventoryService.issueMaterial` accepts a `userService`-created `engineer` user; rejects a `userService`-created `admin` user |
| User -> Finance/Payment | chargeable-ServiceCall Payment notification targets role `finance` (role-string match, no FK) | a `userService`-created `finance` user receives the notification after a chargeable ServiceCall completion |
| User -> Notification | `targetRoles` role-string match (PWA FACT, no per-user FK anywhere in the notification system) | verified via the Finance case above; the same role-string mechanism applies identically to every other notification target role, all of which are unchanged by this fix |
| User -> Checklist | **NO RELATION DEMONSTRATED** — the PWA's checklist library edit gate (`canEditChk`) is `admin` OR any division-PM role, checked by ROLE only, never by a specific User id/FK; unaffected by this fix | not applicable — no User FK exists on `ChecklistTemplate` in either source |
| User -> Enquiry/SalesOrder | **NO RELATION DEMONSTRATED** — Enquiry/SalesOrder role gates (`sales`/`admin`) are role-only, no assigned-user FK anywhere in either source | not applicable — no User FK exists on `Enquiry`/`SalesOrder` in either source |

## API

5 new endpoints (`GET /api/users`, `GET /api/users/:id`, `POST /api/users`,
`PATCH /api/users/:id`, `DELETE /api/users/:id`). Reconciled canonical
total: **109** (up from the previously-frozen 104), re-derived fresh from
`src/app.js` + all `src/routes/*.js` per `API_CONTRACT.md` §11's counting
standard — see §12/§13/§14 there for the full reconciliation
(A=B=C=E=109).

## Tests

Targeted: **User management 23/23** (`userService.test.js` 17 +
`userManagementWorkflow.test.js` 6); **Inventory FIX-3.6-01 2/2** (plus the
pre-existing 50/50 Inventory suite, now 52/52). **Full regression:
338/338 passing, 0 failing** (baseline was 313/313 — net +25 tests, 0
regressions, 0 skipped/weakened).

## Remaining blockers (carried forward, NOT silently closed)

| Item | Priority | Status |
|---|---|---|
| Frontend (`new-app/frontend/`) is an empty placeholder | P1 | OPEN, unchanged — STEP 7, still not started |
| B2 — Company deletion/cascade | P2 | OPEN, unchanged — blocked on `OPEN_DECISIONS.md` #13 |
| FIX-3.7-01 — notification text emoji/dash punctuation drift | P3 | OPEN, unchanged |
| FIX-3.7-02 — payment-milestone-raised notification drops "Collect by `<date>`" | P2 | OPEN, unchanged |
| FIX-3.7-03 — payment-received notifications lack `money()` formatting | P2/P3 | OPEN, unchanged |
| FIX-3.7-04 — no exact-text test coverage for the 25 notification strings | P3 | OPEN, unchanged |
| Pass 3.2 report file missing (`E2E_PASS_3_2_SO_PROJECT.md`) | P3 | OPEN, unchanged |
| 3.1-I03 — `dlPayments()` CSV column order reconstructed, not independently re-derived | P3 | OPEN, unchanged |
| N2 — several CSV/report exporters not independently field-by-field re-walked | P3 | OPEN, unchanged |

None of the above was in scope for this task and none was resolved as a
side effect; none is silently dropped.

## Frontend

**Still not implemented — zero screens exist, exactly as every prior pass
found.** `new-app/frontend/` remains a placeholder (`README.md` only).
This task adds one new, previously-impossible frontend requirement: the
Users screen (list/create/edit/role-assign/delete, admin-only) now has a
real API to bind to (`/api/users`, this task). Remaining PWA frontend
scope, unchanged from Pass 3.5/3.6's inventories, plus this addition:
Accounts/**Users** (list, create/edit modal with role dropdown filtered by
company division and excluding `super`, delete-with-self-guard), Enquiry,
SalesOrder, Finance/Payments, Checklist (template library + project
checklist execution), Project (all sub-screens), Contract, ServiceCall
(register/detail/assign/report/complete/CSV/PM-due/open-calls), Inventory
(all 16 screens per Pass 3.6), Notifications, Reports/Exports. No frontend
code was written in this task.

## Deadline status

**BLOCKED.** Not DEPLOYED — the frontend still does not exist (zero
screens for any of the 12 PWA domains, unchanged by this task) and there
is still no deployment configuration of any kind for `new-app`. Not AT
RISK — the September 24, 2026 23:59 IST deadline already passed two days
before this task ran (today is 2026-09-26). Not simply "MISSED" as the
*current* operational status (that describes the historical checkpoint
outcome, already recorded in the Phase A section above, unchanged). This
task RESOLVES the one backend P0 (FIX-3.8-01) that was blocking a clean
STEP 3 account/role PASS and additionally closes the bundled P3
(FIX-3.6-01), but STEP 4 (Security/Tenant/Authorization verification),
STEP 5 (Concurrency), STEP 6 (Test hardening), and STEP 7 (Frontend) have
still not run at all. **BLOCKED** is the honest, exact current status
required by this task's vocabulary.

## Safety

Run live this session, after all Phase B changes:

- `git diff --name-status -- v2` -> **37 files** — matches the existing,
  unchanged baseline exactly. V2 untouched.
- `git diff --name-status -- v3` -> **0 files** — matches required. V3
  untouched.
- `md5sum index.html MEP_PROJECTS_PWA/index.html` -> both
  `111b53dba91704f96b83dae96c7793c6` — matches required, unchanged. Neither
  PWA file was modified.
- `git diff --cached --name-status` -> empty — nothing staged.
- `git status --short` -> unchanged in composition from every prior pass
  (the same pre-existing, uncommitted working-tree state across `v2/` and
  root-level app files that predates this entire engagement, plus
  untracked `new-app/`) — this task's own edits are new/modified files
  strictly under `new-app/backend/src/` and `new-app/backend/tests/` and
  documentation edits strictly under `new-app/docs/`; `new-app/` itself
  remains entirely untracked (`??`), i.e. never committed, consistent with
  every prior pass. No commit was made. All four required safety-check
  values are within tolerance; no unauthorized drift.

## FRONTEND USER MANAGEMENT REQUIREMENTS

(Per this task's explicit requirement — discovered/confirmed during this
fix, not implemented.)

The eventual frontend Users screen (admin-only, per PWA `MENUS.admin`
containing `"users"`) needs, at minimum:

1. **List view** — `GET /api/users`: table of name/role/username (never
   password), with client-side search by name/username/role (PWA FACT,
   `vUsers`'s `hit()` filter) — no server-side search parameter exists or
   is needed (PWA FACT: filtering is entirely client-side over the small
   per-company list).
2. **Create modal** — `POST /api/users`: name, username, password (masked
   input, never echoed back), and a role `<select>` that MUST be filtered
   client-side to exclude `super` and to exclude any PM role
   (`hvac_pm`/`solar_pm`/`mep_pm`) whose division isn't in the logged-in
   company's `divisions[]` — mirroring `mUser()`'s exact dropdown-filter
   logic, so the user never sees an option the server will reject anyway.
3. **Edit modal** — `PATCH /api/users/:id`: same fields as create, but
   password must be an OPTIONAL "change password" field (blank = unchanged)
   since the API never returns a hash to prefill — this is a required UI
   behavior change from the PWA's own modal (which prefills the plaintext
   password), driven directly by the approved security adaptation.
4. **Delete action** — `DELETE /api/users/:id`, with a confirmation dialog
   (PWA FACT: `confirm("Remove this login?")`) and the Remove control
   HIDDEN for the caller's own row (PWA FACT, `u.id!==U.id` — though the
   API also enforces this server-side now, the UI should still hide it to
   avoid a confusing 403).
5. **No deactivate control** — do not build one; neither the PWA nor this
   API's User-management surface has one.
6. **Downstream pickers** (Project engineer/PM assignment, ServiceCall
   engineer assignment, Inventory Issue recipient) can now be built against
   a real company user list once this Users screen (or an equivalent
   users-list fetch) exists — this task's `userManagementWorkflow.test.js`
   is the backend-side proof those pickers will work once built.

## Next gate

**NEXT ALLOWED: STEP 4 — SECURITY/TENANT/AUTHORIZATION VERIFICATION.**

FIX-3.8-01 (P0) is genuinely resolved and re-verified end-to-end (API +
multi-user workflow, not API existence alone); FIX-3.6-01 (P3) is resolved
and re-verified; full regression is clean at 338/338 with zero regressions.
Per `STAGED_IMPLEMENTATION_PLAN.md`'s own gate rule, the account/role
portion of STEP 3 that was previously BLOCKED can now be considered
resolved, and STEP 4 may begin in a separate task. This does not itself
start STEP 4 (per rule 12) — it only removes the one blocker Pass 3.8
identified against it.
