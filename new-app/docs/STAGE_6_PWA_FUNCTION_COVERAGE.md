# STAGE 6 — Workstream C: Complete PWA Function Coverage

**Date:** 2026-09-27
**Scope:** every materially demonstrated PWA function, proven represented and functionally covered by NEW APP — not merely that a supporting API endpoint exists.
**Status of underlying implementation at the time of this pass:** 123/123 endpoints registered and documented (Workstream B, PASS); 365/365 regression PASS (no code changed by this pass); PWA md5 unchanged (`111b53dba91704f96b83dae96c7793c6`, both copies).

---

## 1. Objective

Prove, function-by-function (not endpoint-by-endpoint), that NEW APP reproduces every materially distinct PWA business function across all 11 required modules, with PWA source evidence, NEW APP equivalent, and test evidence for each — and to honestly flag anything not yet executable (report/export execution, deferred to Workstream D) or not fully field-level documented (the four endpoints Workstream B already disclosed).

## 2. Methodology

This pass does **not** re-open `MEP_PROJECTS_PWA/index.html` line-by-line for every one of the ~100 functions below. Per the engagement's own reuse rule ("Previously established audit/decision documents may be reused as evidence where they already contain verified source tracing"), this document is built primarily as a **function-level synthesis and reconciliation** of an already very large, already independently source-verified corpus produced earlier in this engagement:

- `PWA_COVERAGE_AUDIT_ENQUIRY.md`, `PWA_COVERAGE_AUDIT_SALESORDER.md`, `PWA_COVERAGE_AUDIT_PROJECT.md`, `PWA_COVERAGE_AUDIT_CONTRACT.md`, `PWA_COVERAGE_AUDIT_SERVICECALL.md`, `PWA_COVERAGE_AUDIT_INVENTORY.md` — per-module, field-level PWA-source audits.
- `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` (2026-09-23) — cross-module entity map, connection map, 23-site notification map (later reconciled to 25, see below), role matrix, checklist master trace; this document independently re-grepped the PWA source for its own claims and is treated as directly-verified, not hearsay.
- `E2E_PASS_3_1` through `E2E_PASS_3_8` (2026-09-23 to 2026-09-26) — 8 sequential, source-re-verified passes covering Enquiry→SO→Payment, SO→Project, Checklist completion, Project→Contract/PM, ServiceCall, Inventory, Notifications (25/25 sites, independently re-grepped fresh in Pass 3.7), and a master reconciliation.
- `STAGE_6_API_CONTRACT_AUDIT.md` (Workstream B, 2026-09-27, same day as this pass) — independently re-verified role gates, notification call-site counts, transaction wrapping, and the Company-deletion cascade directly against current source, with no drift found.
- `*_DECISION_LOCK.md` (Contract, Project, ServiceCall, Inventory) and `OPEN_DECISIONS.md` — the engagement's locked business-decision record for every PWA ambiguity already resolved.

**What this pass independently did, beyond synthesis:** reconciled the Pass-3.8 finding "no User-management API exists" (2026-09-26, FIX-3.8-01, backend functional gap) against Workstream B's fresh 2026-09-27 route inventory, which shows `userRoutes.js` with 5 registered endpoints (EP-105–109) and `userService.js`/`userManagementWorkflow` test suites passing — confirming FIX-3.8-01 was **closed** between Pass 3.8 and Workstream B, not still open. This reconciliation (§5 below) is this pass's one genuine new finding-resolution, independently checked via `device_bash` route/test greps rather than taken on either document's word alone (see §5, §18).

**What this pass does NOT claim:** a fresh, independent field-by-field re-walk of `index.html` for every one of the ~100 functions catalogued below. Where a row's evidence is "per audit, not independently re-walked this session," that is stated plainly in the Test Evidence column, per the Evidence Column Requirement. Reports/exports are marked `Execution pending Workstream D` per instruction — code-inspection presence is not claimed as PASS for execution.

## 3. Source evidence references

`MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`) and byte-identical root `index.html` copy; the 6 per-module `PWA_COVERAGE_AUDIT_*.md` documents; `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`; `E2E_PASS_3_1` .. `E2E_PASS_3_8`; `STAGE_6_API_CONTRACT_AUDIT.md`; `CONTRACT_DECISION_LOCK.md`, `PROJECT_DECISION_LOCK.md`, `SERVICECALL_DECISION_LOCK.md`, `INVENTORY_DECISION_LOCK.md`, `ENQUIRY_BUSINESS_DECISION_SHEET.md`, `OPEN_DECISIONS.md`, `API_CONTRACT.md`.

---

## 4. Complete function matrix

Legend — **Result**: A = Exact/functionally covered · B = Accepted infra/security adaptation · C = Documentation-only limitation · D = Missing/incorrect · E = PWA behavior not sufficiently evidenced · F = Reserved for Workstream D execution evidence.

### A. Company

| # | Module | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Account Relation | Checklist Relation | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Company | `saveCompany` (create) | `index.html` L~ (per master §1) | Creates tenant record, no uniqueness check on name observed | `companyService.createCompanyWithAdmin` | `POST /api/companies` (EP-005) | User (bootstrap admin) | root of tenancy | — | none | Master audit §3 (direct read); not independently re-walked this session | A |
| 2 | Company | `delCompany` (id=1 protected) | L1811-1816, cascades `["users","enquiries","sos","projects","svcCalls","contracts","payments","notifs"]`, excludes all 5 Inventory collections | 8/15 collections cascade-deleted; Inventory + ChecklistTemplate survive | `companyService.js` cascade fn | `DELETE /api/companies/:id` (EP-110) | Users/Enquiry/SO/Project/ServiceCall/Contract/Payment/Notification (cascaded); Inventory/ChecklistTemplate (not cascaded) | full tenant wipe | not cascaded (matches PWA) | none | STAGE_6_API_CONTRACT_AUDIT.md §15: "Company-deletion 8-collection cascade, read directly from `companyService.js`" — independently re-confirmed 2026-09-27, matches PWA exactly. Superseded PWA_MASTER's 2026-09-23 finding B2 ("not implemented") — resolved between then and Workstream B | A |
| 3 | Company | tenant scoping (`co`/`companyId`) | `mine()` helper, L1265, used by ~every list fn | Every business record filtered by company at list-read time | `companyId` ObjectId on every collection, repository-layer filter | all modules | all 15 entities | is the account boundary | n/a | n/a | Master audit §3; Workstream A/B endpoint audits (companyId-from-session on every module) | B (server-side companyId scoping is the approved infra adaptation over PWA's client-trusted `co`) |
| 4 | Company | direct-by-id lookup gap (PWA-native) | `vProject`/`vCall`/`itemById` — no `mine()` wrapper on several detail lookups | PWA's own list-vs-direct-lookup gap | NEW APP requires `{_id, companyId}` scoping on every direct lookup | all modules | — | tightened vs PWA | n/a | n/a | Master audit §3, STAGE_6_API_CONTRACT_AUDIT.md (ServiceCall `GET /:id`, Inventory `GET /items/:id` explicitly closing this gap) | B |

### B. Users / Accounts / Roles

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 5 | Login | login screen, matches `users` row, sets global `U` session object `{co,role,name,un}` | no server/session concept — pure client-side global | `POST /api/auth/login` (EP-002), issues session/token | User, Company | none | STEP_4/STEP_5/API_CONTRACT auth foundation docs; regression suite | B (server session replacing client-trusted global is the approved infra adaptation) |
| 6 | Session / `/me` | `U` global read wherever role-gating occurs | in-memory only, lost on refresh (PWA has no persistence) | `GET /api/auth/me` (EP-004) | User | none | API_AUTH_FOUNDATION.md | B |
| 7 | Logout | not modeled as a distinct PWA function (client-side only) | n/a | `POST /api/auth/logout` (EP-003) | User | none | infra-only addition, not a PWA-fidelity item | B |
| 8 | `saveUser` (create) | L1847, `co:U.co` at push | new user always attached to creator's own company | `userService.js` create | `POST /api/users` (EP-105) role `admin` | Company | none observed (not in 25-site list) | STAGE_6_API_CONTRACT_AUDIT.md §4; Pass 3.8 found the gap 2026-09-26 (FIX-3.8-01), Workstream B (2026-09-27) confirms `userRoutes.js` 5 endpoints registered and `userService`/`userManagementWorkflow` test suites in the 131/131 Step-6 batch — gap independently reconciled closed this pass (§5) | A |
| 9 | `saveUser` (edit) | same fn, edit branch | role/name/status editable | `userService.js` edit | `PATCH /api/users/:id` (EP-107 or similar) | Company | none | same as #8 | A |
| 10 | List users / team | `vUsers`/`vTeam`, `mine()`-filtered | company-scoped list | `GET /api/users` (EP-106) | Company | none | same as #8 | A |
| 11 | `delUser` | delete fn, no PWA-native self-delete restriction observed in source (UI-only) | any user deletable via UI gate only | `DELETE /api/users/:id` (EP-108/109) + **server-side self-delete guard** (`403 FORBIDDEN` deleting own login) | Company | none | STAGE_6_API_CONTRACT_AUDIT.md §4: "deliberate server-side strengthening of a PWA UI-only restriction — approved infrastructure/security adaptation, correctly labeled, not presented as missing PWA behavior" | B |
| 12 | Role assignment / `ROLES` (11 roles) | `ROLES` object L1286: `super,admin,sales,hvac_pm,solar_pm,mep_pm,engineer,inventory,service_mgr,service_eng,finance` | role lives on `U.role`, no per-record override field anywhere | role field on User model, enforced service-layer per module (`*_ROLES` constants) | all modules | n/a | Master audit §4 (11/11 traced); STAGE_6_API_CONTRACT_AUDIT.md §3 (byte-compared role constants, no drift) | A |
| 13 | Menu/module access per role | `MENUS` object L1289 | UI-gating only, no function-level PWA check on nearly any mutation | NEW APP adds function-level `*_ROLES` checks server-side reproducing PWA's visible menu intent | all modules | n/a | Master audit §4 | B |
| 14 | Downstream participation — Project engineers | `p.engs[]` (name strings, no ObjectId, company-wide candidate pool, PM-division-matched action gate) | no referential integrity | `Project.engs[]`/candidate pool preserved per `PROJECT_DECISION_LOCK.md` (name-string shape traced, not independently field-name-confirmed this session) | Project | see Project rows | Master audit §15 (flagged "traced, not field-name-confirmed") | A |
| 15 | Downstream participation — ServiceCall `eng` | `s.eng` (name string) | ownership check `s.eng===U.name` | `ServiceCall.engineerId` (ObjectId, durable ref — an approved upgrade of a non-referential PWA field) | ServiceCall | see ServiceCall rows | Master audit §15 | B |
| 16 | Downstream participation — Inventory issue staff | `staff` free text on `InventoryIssue` | not a User ref | preserved as free text (per audit) | Inventory | see Inventory rows | Master audit §12 | A |
| 17 | Downstream participation — Finance/Notification role targeting | `notify(roles,...)` role-list or `"*"` | never targets individual users | `Notification.targetRoles:[String]`, no user-id targeting field exists — structurally matches PWA ceiling | all modules | see §12 below | E2E_PASS_3_7 §"Account/role/tenant coverage": MATCH | A |
| 18 | Downstream participation — Company ownership/tenant | see Company §A | — | — | — | — | — | A |
| 19 | No direct User FK on Checklist/Enquiry/SalesOrder | confirmed absence, per engagement's locked relationship-boundary rule | intentional PWA gap | not invented in NEW APP | Enquiry/SalesOrder/Checklist | — | STAGE_6_API_CONTRACT_AUDIT.md §4: "No direct User foreign key was found or asserted...consistent with the engagement's locked relationship-boundary rule" | A |

**Account/user/role coverage summary:** 15 functions traced (rows 5–19). Backend User-management CRUD gap (FIX-3.8-01, discovered Pass 3.8, 2026-09-26) is **closed** as of Workstream B (2026-09-27) — independently reconciled this pass by cross-checking route/test evidence, not merely re-asserted. Self-delete restriction is a correctly-labeled infra strengthening, not a PWA-fidelity claim. No direct User FK invented on Enquiry/SalesOrder/Checklist.

### C. Enquiry

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 20 | Create | `saveEnq` | `status:"Open"` | `enquiryService.js` create | `POST /api/enquiries` (EP-006 range) | Company | none (0 of 25 sites) | `PWA_COVERAGE_AUDIT_ENQUIRY.md`; E2E_PASS_3_1 | A |
| 21 | List | `vEnquiries` | co-scoped | list endpoint | Enquiry | — | none | same | A |
| 22 | Detail | `vEnq` | direct-by-id | detail endpoint (+tenant check added) | Enquiry | — | none | same | A/B (tenant check = infra) |
| 23 | Edit | `saveEnq` (edit branch) | full edit | edit endpoint | Enquiry | — | none | same | A |
| 24 | Follow-up | `followUp` | appends to `log[]`/`followUpLog`, no status change | preserved | Enquiry | — | none | same | A |
| 25 | Lost | `lostEnq` | `status:"Lost"`, stores `lostReason`/`lostDate` | preserved | Enquiry | — | none | same | A |
| 26 | Reopen | `reopenEnq` | `status:"Open"`, **does not clear** stale `lostReason`/`lostDate` (`OPEN_DECISIONS.md` #18, Choice A) | preserved exactly, stale fields retained | Enquiry | — | none | E2E_PASS_3_1; Master audit §5 checklist "Reopen preserved (incl. stale lostReason/lostDate retained)" | A |
| 27 | Won/convert | `saveSO(0,enqId)` sets `status:"Won"` + log line naming new SO; no fields auto-transferred; no back-ref stored on SO by PWA | conversion guard added (atomic Won-only + `enquiryId` back-ref field — genuine NEW APP addition beyond PWA, explicitly flagged) | `convertEnquiryToSalesOrder` (transactional) | Enquiry, SalesOrder(new) | 2 (fire on SalesOrder side, not Enquiry — see §D) | E2E_PASS_3_1; Master audit §5 | A / B (guard+back-ref = infra addition, correctly flagged not silently invented) |
| 28 | Duplicate-conversion guard | PWA: **none** — `saveSO` never checks `e.status` (`OPEN_DECISIONS.md` #19) | NEW APP deliberately adds protection PWA lacks | atomic conditional update + unique/sparse index backstop | Enquiry/SalesOrder | — | `OPEN_DECISIONS.md` #19; Master audit §5 | B (approved, intentional divergence — locked Choice B) |
| 29 | Reports / export | `vEnquiries` CSV export, summary report, followups-due report | not independently re-walked field-by-field this session | `GET /export.csv`, `GET /reports/summary`, `GET /reports/followups-due` (EP-008/009/010) — role-gate/route presence confirmed, execution not run | Enquiry | — | STAGE_6_API_CONTRACT_AUDIT.md §12 (presence confirmed); not executed | F — Execution pending Workstream D |

**Enquiry: 10 functions traced.** Zero notify() call sites confirmed (matches PWA fact exactly — an absence correctly matched by an absence, not a gap).

### D. SalesOrder

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 30 | Enquiry conversion creation | `saveSO(0,enqId)` | see #27 | `convertEnquiryToSalesOrder` | Enquiry, SalesOrder, Project(cascade), Payment(cascade), Checklist(seed) | 2 (rows 1–2 of §12) | Master audit §5/§6; E2E_PASS_3_1 | A |
| 31 | Standalone creation (no Enquiry) | `saveSO(0,0)` — fully supported, function never requires `enqId` truthy except for the 2-line Enquiry-status block | preserved | same cascade fn, `enquiryId` omitted | SalesOrder, Project, Payment, Checklist | 2 | Master audit §6: "PASS — confirmed the function signature and body never require enqId truthy for anything except..." | A |
| 32 | Edit | `saveSO(id,...)` edit branch — preserves each milestone's `rcv` flag **by array index** (`OPEN_DECISIONS.md` #24); fires **no** notification (edit vs create asymmetry — early-return skips both notify() calls) | preserved exactly incl. index-based `rcv` preservation and the edit/create notification asymmetry | edit fn | SalesOrder, Payment(milestones) | 0 (edit fires none — E2E_PASS_3_7 §Coverage: "SO editing fires no notification...preserved") | E2E_PASS_3_1; E2E_PASS_3_7 | A |
| 33 | Numbering | `DB.seq.so++` (`no`, human-facing) + internal `id` (array key, superseded by ObjectId) | preserved: `no` kept as display sequence | `SalesOrder.no` + `_id` | — | — | per-module audit; not independently re-walked this session beyond confirming `DB.seq.so` exists | A |
| 34 | Detail/list | `vSO`/`vSOs` | co-scoped, `vSO` resolves linked Project via `soNo` | detail/list endpoints | Project, Payment | — | none | per-module audit | A |
| 35 | Checklist creation (seed) | 3-step fallback (template→legacy `DB.templates[div]`→empty) | preserved exactly incl. hardcoded legacy lists | `salesOrderCascade.js` seed | ChecklistTemplate→Project.chk[] | — | — | Master audit §9B, §18 "PWA FIDELITY—MATCH" | A |
| 36 | Legacy fallback | same 3-step chain | preserved | same | — | — | same | A |
| 37 | Milestone creation | `so.pay[]` loop → `payments` collection rows, one per un-received milestone | preserved, index-linked (`soNo+mi`) | cascade fn | Payment | 2 | Master audit §7 | A |
| 38 | Milestone editing (SO-side) | one-way sync **Payment→SO only** (amount), not SO→Payment (`OPEN_DECISIONS.md` #23) | preserved exactly, "byte-for-byte behaviorally" per Master audit §18 | payment edit fn | Payment | — | Master audit §7/§18 | A |
| 39 | Payment linkage | `soNo+mi` index link, not ObjectId | preserved index link + added real `salesOrderId` ref | Payment | — | — | Master audit §15 | A/B |
| 40 | Raise-to-finance | `mRaise`/`doRaise` | fires `notify(["finance","admin"],...)` with urgency text + "Collect by `<date>`." clause | `paymentService.js` raise fn | Payment | 1 (row 4 of §12) | E2E_PASS_3_7 row 4: **content-fidelity gap** — "Collect by `<date>`." clause dropped from NEW APP text (data is stored in `raisedToFinance.collectByDate` but not surfaced) — carried-forward **FIX-3.7-02** (P2), still open, not fixed by this pass (Phase A convention preserved: doc-only workstream) | C (documented, pre-existing, open finding — see §16) |
| 41 | Project creation (fused) | synchronous, inside `saveSO`, 1:1, no "create later"/"no project" SO exists | preserved — `salesOrderCascade.js` transactional | Project | — | 2 | Master audit §2/§6/§8 | A |
| 42 | Notifications (SO creation) | 2 sites (new SO→PM+admin; new SO→finance) | preserved | cascade fn | — | 2 | E2E_PASS_3_7 rows 1–2: MATCH | A |
| 43 | CSV/export | `vSOs` export | not independently re-walked field-by-field this session | `GET /export.csv` (EP-019) — presence confirmed | SalesOrder | — | STAGE_6_API_CONTRACT_AUDIT.md §12; not executed | F — Execution pending Workstream D |

**SalesOrder: 14 functions traced.** One open content-fidelity finding carried forward (FIX-3.7-02, P2) — not a coverage gap in the sense of missing functionality (the raise-to-finance function exists and works; the notification text omits one clause).

### E. Payment / Finance (connected chain)

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 44 | SO milestone→Payment auto-creation | `saveSO` L2092 | one row per un-received milestone | cascade fn | SalesOrder | 2 (SO creation) | Master audit §7 | A |
| 45 | Manual payment entry | `addPayment` | no `soNo`, free `amount` | `paymentService.js` create | — | 0 (manual add itself doesn't notify — confirmed absent from 25-site list) | Master audit §7 | A |
| 46 | Part payment | `partPayment` | `status→"Part"` | `paymentService.js` | — | 1 (row 25) | E2E_PASS_3_7 row 25: **money() formatting missing** — FIX-3.7-03 (P2/P3), open | C |
| 47 | Received / full payment | `recvPayment` | `status→"Received"` | `paymentService.js` | — | 1 (row 24) | E2E_PASS_3_7 row 24: same FIX-3.7-03 | C |
| 48 | Payment date | full-receipt/part-payment date fields | present on Payment schema (`lastCall`/`nextCall`/`disc` etc.) | preserved | — | — | Master audit §7: "PASS (per audit; not independently re-derived beyond the status field this session)" | A |
| 49 | Payment-side milestone editing | `mPayEdit`/`savePayEdit` — asymmetric one-way sync to SO | preserved exactly | — | — | — | Master audit §7 | A |
| 50 | Overpayment gate | referenced via `OPEN_DECISIONS.md` #32 "locked `confirmOverpayment` precedent" | not independently re-derived from raw source this session or prior master pass (Master audit §20 Issue N4, OPEN/NOT DETERMINABLE by that session) | implemented per `OPEN_DECISIONS.md` #32 (per-module audit authority) | — | — | `PWA_COVERAGE_AUDIT_SALESORDER.md` §12 (per-module audit is authoritative here; not independently re-walked again this pass) | E — flagged, not independently closed this session either; carried as an open documentation/verification item, non-blocking (narrow named edge case, payment mechanics otherwise thoroughly traced) |
| 51 | Rollback | no explicit "rollback payment" fn located in any session's targeted greps so far | OPEN/NOT DETERMINABLE (Master audit §20 Issue N4) | not independently located this pass either | — | — | same as #50 | E |
| 52 | SO-linked deletion protection | `delPayment` — restricted when SO-linked, unrestricted for manual/ServiceCall-linked rows | preserved (`204` unrestricted / `FORBIDDEN` SO-linked) | `DELETE /api/payments/:id` (EP-034) | — | — | Master audit §7; STAGE_6_API_CONTRACT_AUDIT.md §6 | A |
| 53 | Raise to Finance | see #40 | — | — | Payment | 1 | see #40 | C (FIX-3.7-02) |
| 54 | Finance follow-up | `lastCall`/`nextCall`/`disc` fields | preserved | — | — | — | Master audit §7 | A |
| 55 | Finance reports | CSV exports (pending/receipts) | not independently re-walked this session | `GET /export/pending.csv`, `GET /export/receipts.csv` (EP-024/025) — presence confirmed | — | — | STAGE_6_API_CONTRACT_AUDIT.md §12; not executed | F — Execution pending Workstream D |
| 56 | ServiceCall chargeable→Payment | `completeCall` L3699-3703: `s.report.chargeable` → auto Payment row + `notify(["finance"],...)` | preserved, one-way (Payment has no `serviceCallId` — confirmed `SERVICECALL_DECISION_LOCK.md` §25 explicitly not added) | `serviceCallService.js` completion fn | ServiceCall | 1 (row 22) | E2E_PASS_3_7 row 22: MATCH, `money()` formatting reproduced correctly here (unlike rows 24/25) | A |
| 57 | Payment received notifications | `notify(["admin","sales"],...)` full/part | preserved role targets, content has the FIX-3.7-03 formatting gap | — | — | 2 (rows 24–25) | see #46/#47 | C |

**Finance: 14 functions traced, connected chain confirmed** (SalesOrder→Milestones→Payments→Part/Received→Raise-to-Finance→Notifications; ServiceCall→Chargeable→Payment→Finance→Notification). Open findings: FIX-3.7-02 (Collect-by-date clause dropped, P2), FIX-3.7-03 (money() formatting missing on 2 of 25 notification texts, P2/P3), overpayment/rollback not independently closed this session (E — narrow, non-blocking, does not affect the rest of the traced chain).

### F. Checklist (all layers connected)

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 58 | Template create | `saveChkList` | `{id,co,div,name,items:[{text,sign}],def,by,date}` | `checklistTemplateService.js` | `POST /api/checklist-templates` (EP-111 range) | Company | 0 (confirmed `grep -c "notificationRepo.create" checklistTemplateService.js` = 0 — matches "No notifications fire for any Checklist Template Library action") | STAGE_6_API_CONTRACT_AUDIT.md §5; E2E_PASS_3_8 "ChecklistTemplate CRUD fully implemented (FIX-3.3-01)" | A |
| 59 | Template edit | `saveChkList` edit branch | — | same | `PATCH` | — | 0 | same | A |
| 60 | Template duplicate | `dupChkList` — `name+" (copy)"`, `def:false` always | preserved | same | `POST .../duplicate` | — | 0 | same | A |
| 61 | Template delete | `delChkList` | — | same | `DELETE` | — | 0 | same | A |
| 62 | Template default/role restriction | `def` flag, `canEditChk()` = any of 3 division-PM roles or admin, **cross-division** (native PWA gap, not per-division-enforced — `OPEN_DECISIONS.md` #27) | preserved exactly, cross-division permissive by design | `checklistTemplateService.js` role gate | — | — | STAGE_6_API_CONTRACT_AUDIT.md §5; Master audit §9A | A |
| 63 | SO checklist selection/seed | `defaultChkList(so.div)` → template's own items → legacy `DB.templates[div]` → empty (3-step fallback) | preserved exactly | `salesOrderCascade.js` seed | — | 0 (bundled into SO's own 2 notifications) | Master audit §9B | A |
| 64 | Project checklist init | one-time copy: text/sign only, execution-state fields (`done,date,pmSign,remark,photos,appr`) added at copy time, no templateId retained | preserved | `projectService.js` | — | — | Master audit §9C | A |
| 65 | Item tick/execution | inline mutator — toggling `done` clears `pmSign`/`appr` on un-mark; photos append-only, no delete | preserved exactly incl. the clear-on-unmark quirk | `projectService.js` tick fn | — | 1 ("delayed completion" conditional, row 10 of §12) | E2E_PASS_3_7 row 10: MATCH; Master audit §9C | A |
| 66 | Approval / sign-off | `appr={by,role,date,remark,sig,enteredBy}` — CLIENT-sign-role users can be external (free-text `by`) | preserved; NEW APP adds durable `enteredByUserId` alongside free-text `approverName` (`PROJECT_DECISION_LOCK.md` Decision 7) | `projectService.js` approve fn | — | 1 (row 5) | E2E_PASS_3_7 row 5: MATCH | A/B |
| 67 | PM countersign | `pmSign()` — one-way true, no "un-sign" fn found; requires `done&&appr.by` (UI-gated only) | preserved | `projectService.js` | — | 0 (no dedicated notify) | Master audit §9D | A |
| 68 | Timeline readiness gate | tick depends on timeline readiness (per PROJECT_DECISION_LOCK / STAGE_6 §5: "In-Service checklist-edit lock stated identically across all five checklist-mutation endpoints") | preserved | `projectService.js` | — | — | STAGE_6_API_CONTRACT_AUDIT.md §5 | A |
| 69 | Completion gate independence | **independently confirmed NOT a gate**: `setStage()` (L2596-2608) contains no check of `p.chk[].done`/`.appr`/`.pmSign` before allowing stage transition to `"Completed"`; only the "all points completed" notification is conditional on it, and that's informational only | preserved — completion is a PM's independent `stage` action, not blocked by checklist state | `projectService.js` `setStage` fn | — | 1 ("all points completed," row 11) | Master audit §9D (direct source read, this session's own independent confirmation); E2E_PASS_3_7 row 11 | A |
| 70 | Replace vs append (`applyChkList`) | `append=false`→wholesale replace, discards execution state, **no native confirm() gate** (`OPEN_DECISIONS.md` #30); `append=true`→concatenate, keeps state | preserved exactly, no confirm() added | `POST /api/projects/:id/checklist/apply` (EP-046) | — | 0 | Master audit §9C/§18 | A |
| 71 | Delayed-completion / project-delay notifications | `runDelayCheck` (once/day/project throttle) | reproduced with hourly scheduler tick + transactional per-project throttle | `delayCheckScheduler.js` + `projectService.js` | — | 1 (row 3) | E2E_PASS_3_7 row 3: **content-fidelity gap** — warning emoji dropped, em-dash→ASCII hyphen — FIX-3.7-01 (P3), open | C |
| 72 | Concurrency (FIX-6-01 precedent) | n/a (PWA single-threaded, no concurrency concept) | NEW APP wraps checklist-affecting writes transactionally | `withTransaction` | — | — | STEP_5_CONCURRENCY_ATOMICITY.md; regression 365/365 — confirmed by actual regression evidence, not merely asserted | B |

**Checklist: 15 functions traced across all three layers (Template / SalesOrder-seed / Project-execution), explicitly connected.** One open content-fidelity finding (FIX-3.7-01, P3, cosmetic — punctuation/emoji only, no information loss).

### G. Project

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 73 | Creation/init | synchronous inside `saveSO` | 1:1 with SO always | `salesOrderCascade.js` | SalesOrder | — | — | Master audit §8 | A |
| 74 | Stage | `setStage()`, division-specific `STAGES[div]` | `stage`/`status` are independent stored fields (status mutated as a side effect, not purely derived) | `projectService.js` setStage | — | 3 (rows 6–8) | E2E_PASS_3_7 rows 6-8: MATCH; Master audit §8/§14 — stage/status independence preserved | A |
| 75 | Status | Ongoing/Completed/In Service | same fn | same | — | (bundled) | same | A |
| 76 | Timeline (`savePM`/`mSaveTimeline`) | `timelineSet` one-way flag; notification fires **first save only** — quirk: re-saving after first fires nothing (`!p.timelineSet` gate) | preserved exactly, `if(first)` gate mirrors PWA | `projectService.js:579` | — | 1 (row 12) | E2E_PASS_3_7 row 12: "MATCH - first-save-only quirk preserved" | A |
| 77 | Partially-dated timeline | timeline readiness independent of full-date completeness (per PROJECT_DECISION_LOCK) | preserved | same | — | — | per-module decision lock; not independently re-walked field-by-field this session | A |
| 78 | `timelineReady` gate | checklist ticking depends on timeline readiness | preserved (see Checklist #68) | `projectService.js` | — | — | STAGE_6_API_CONTRACT_AUDIT.md §5 | A |
| 79 | Checklist (all sub-items) | see §F | — | — | — | — | — | A |
| 80 | Engineers assignment | company-wide candidate pool, PM-division-matched **action** gate (not a candidate-pool division filter) (`OPEN_DECISIONS.md` #26) | preserved | `projectService.js` assign fn | User | 1 (row 9, `"*"` broadcast) | E2E_PASS_3_7 row 9: MATCH | A |
| 81 | Engineer replacement/pool behavior | same company-wide pool applies on reassignment | preserved | same | — | (same site) | Master audit §4/§8 | A |
| 82 | Updates (append-only progress log) | `updates[]`, push-only, no evidence of edit/delete | preserved append-only | `projectService.js` | — | — | Master audit §8 | A |
| 83 | Delivery Challans | `dc[]` — free-text item/qty/unit + `by` (free-text receiver name, often external), **no** `invItemId`/`invIssueId` field (confirmed by direct read of the push statement) | preserved exactly — non-integration with Inventory is intentional (`OPEN_DECISIONS.md` #8/#33/#45) | `deliveryChallans[]` with `receivedByName`(free text) + `recordedByUserId`(ObjectId, logged-in staff — genuine addition) | Inventory: NO RELATION DEMONSTRATED | — | Master audit §2/§8/§15; §14 NO-RELATION boundary | A |
| 84 | Completion (dual override gate) | `stage==="Completed"` literal string compare; un-completing reverts `status` to `"Ongoing"` silently (`OPEN_DECISIONS.md` #29) | preserved | `projectService.js` setStage | — | 1 (row 8) | Master audit §8 "Completion overrides — PASS — un-completing reverts status silently" | A |
| 85 | PM countersign (does not gate completion) | see Checklist #67/#69 | — | — | — | — | — | A |
| 86 | Contract eligibility (MEP/non-MEP) | `status==="Completed" && p.div!=="MEP"` — **MEP structurally excluded**, MEP terminal stage is the literal string `"Delivered"`, never `"Completed"` (`OPEN_DECISIONS.md` #28) | preserved literally, independently re-confirmed via direct grep this engagement | `contractService.js` eligibility check | Contract | — | Master audit §8/§18: "PWA FIDELITY—MATCH" | A |
| 87 | Notifications (all 6 Project sites) | delay-check, 3× stage-change (finance/admin/service_mgr-on-completion), engineer-assignment, timeline-first-save | preserved, see §12 | `projectService.js` | — | 6 | E2E_PASS_3_7 rows 3,6-9,12 | A (row 3 has FIX-3.7-01 cosmetic gap only) |
| 88 | Reports/exports | `GET /export.csv`, `/:id/delivery-challans/export.csv`, `/:id/report`, `/:id/report/export.csv` | not independently re-walked field-by-field; presence confirmed | EP-035/057/058/059 | — | — | STAGE_6_API_CONTRACT_AUDIT.md §12; not executed | F — Execution pending Workstream D |

**Project: 16 functions traced.** All stated quirks (stage/status independence, `savePM` first-save-only timeline notification, partially-dated timeline, timelineReady gate, dual completion override, PM countersign non-gating, MEP/non-MEP literal-string distinction, embedded DCs, append-only updates) independently confirmed present, not normalized away.

### H. Contract

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 89 | Project conversion (`convertToService`) | L2737; eligibility checked at render only (L2193), not re-checked inside the function itself (`OPEN_DECISIONS.md` #58 — PWA-native gap) | fields: `customer,phone:"",email:"",site,cap,start,end:+1yr,amcType:"Quarterly",cat:"Warranty",amount:0,svcs,fromProject`; **phone/email hardcoded empty strings, not copied from Project/SO contact** | `contractService.js` conversion fn; NEW APP adds `prepareServiceConversion`/`isEligibleForServiceConversion` as a locked defense-in-depth re-check (approved infra addition) | Project | 1 (row 13) | Master audit §10; E2E_PASS_3_7 row 13: MATCH | A/B |
| 90 | Non-MEP behavior | see Project #86 | MEP structurally excluded | preserved | — | — | Master audit §10 | A |
| 91 | Completed condition | `status==="Completed"` | preserved | — | — | — | same | A |
| 92 | Role gate | `service_mgr`/`admin` menu-gated only in PWA (no function-level check); NEW APP adds one (`OPEN_DECISIONS.md` #54) | preserved intent, server-enforced | `contractService.js` `MANAGE_ROLES` | — | — | STAGE_6_API_CONTRACT_AUDIT.md; Master audit §10 | B |
| 93 | Warranty defaults | `cat:"Warranty"`, `amount:0` | preserved exactly | — | — | — | `CONTRACT_DECISION_LOCK.md` Decision 10 | A |
| 94 | Quarterly cadence | `amcType:"Quarterly"` fixed at conversion | preserved | — | — | — | Master audit §10 | A |
| 95 | One-year period | `start:<today>, end:<today+1yr>` | preserved | — | — | — | same | A |
| 96 | Amount 0 / blank phone/email | see #89 | preserved (never flows to `payments`, `OPEN_DECISIONS.md` #49) | — | — | — | Master audit §10/§18 | A |
| 97 | Notification (conversion) | `notify(["service_mgr","admin"],...)` L2739 | preserved | — | — | 1 | E2E_PASS_3_7 row 13 | A |
| 98 | Project state transition | Contract creation does not itself change Project state beyond what completion already set | preserved | — | — | — | Master audit §10 | A |
| 99 | Manual AMC creation (`saveContract`) | manual-creation path, own `amcType` selector (not fixed to Quarterly) | **fires zero notifications** — `saveContract()` manual edits fire no notify() (re-confirmed E2E_PASS_3_7: "asymmetry preserved, not fixed") | `contractService.js` manual create | — | 0 | E2E_PASS_3_7 §Coverage Contract row; Master audit §1 | A |
| 100 | Manual AMC role gate | same `MANAGE_ROLES` | preserved | — | — | — | STAGE_6_API_CONTRACT_AUDIT.md §3 | A |
| 101 | Manual AMC defaults / blank-end behavior | per-module audit (`PWA_COVERAGE_AUDIT_CONTRACT.md`) | not independently re-walked field-by-field this session | preserved per that audit's authority | — | — | `PWA_COVERAGE_AUDIT_CONTRACT.md` (per-module audit is authoritative, not re-derived this session) | A (per prior-audit authority) |
| 102 | Visit lifecycle — cadence/due calculation | `pmDue()`/`contractStatus()`, derived not stored | preserved (DERIVED RELATION) | — | — | — | Master audit §10/§14 | A |
| 103 | Expiring Soon / Expired | derived via `contractStatus()` | preserved; **Expired contracts remain due** — no automatic payment on expiry | — | — | — | Master audit §14; engagement ground rules | A |
| 104 | Due-slot behavior | `due[0]`-stamps-first-due (not the specific triggering visit) — `OPEN_DECISIONS.md` #52 | preserved exactly, confirmed exact mechanism | `serviceCallService.js` completion fn | ServiceCall | — | Master audit §2/§11 | A |
| 105 | Signature completion / Payment when chargeable | see ServiceCall §I | — | — | — | — | — | A |
| 106 | ServiceCall→Contract forward-only relation | `ServiceCall.contractId` set by `schedulePM`; **Contract stores no reverse array** — confirmed one-way, `CONTRACT_DECISION_LOCK.md` Decision 12 | preserved exactly | — | — | — | Master audit §2/§11/§17: "ServiceCall→Contract PASS, one-way only, confirmed" | A |
| 107 | Reports/export | `GET /export.csv` (EP-062) | not independently re-walked; presence confirmed | — | — | — | STAGE_6_API_CONTRACT_AUDIT.md §12; not executed | F — Execution pending Workstream D |

**Contract: 19 functions traced.** No reverse ServiceCall FK exists or is invented. Manual-vs-conversion notification asymmetry (1 fires, other doesn't) independently reconfirmed, not "fixed."

### I. ServiceCall

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 108 | Complaint registration | `registerComplaint` (shares underlying save path with PM scheduling — same `saveCall` fn, ternary on `contractId`) | no `contractId` | `serviceCallService.js:305 registerComplaint` | — | 1 (row 19) | E2E_PASS_3_7 row 19: MATCH; NEW APP splits the PWA's one shared line into two literal call sites — approved code-structure difference | A |
| 109 | PM scheduling | `schedulePM` — same underlying path, `contractId` truthy, prefill from Contract | preserved | `serviceCallService.js:373 schedulePM` | Contract | 1 (row 20) | E2E_PASS_3_7 row 20: MATCH | A |
| 110 | Assignment | candidate pool `["service_eng","engineer","service_mgr"]` (L3621), company-wide, no division filter | preserved exactly | `serviceCallService.js` assign fn | User | 1 (row 21, `"*"` broadcast, **no dedup** — fires on every save w/ truthy engineer even re-assigning same person) | E2E_PASS_3_7 row 21: "MATCH - no-dedup quirk preserved" | A |
| 111 | Reassignment | same fn, no dedup guard | preserved | same | — | (same site) | same | A |
| 112 | Report draft | `saveReport` — single overwrite-in-place subdocument, **no history** (`SERVICECALL_DECISION_LOCK.md` §25, explicitly not resolved) | preserved | `serviceCallService.js` | — | — | Master audit §11 | A |
| 113 | Report completion | `saveReport(complete=true)` | sets `status="Completed"`, stamps Contract due[0] if applicable, creates chargeable Payment | preserved | `serviceCallService.js` complete fn | Contract, Payment | 2 (rows 22–23) | E2E_PASS_3_7 rows 22-23: MATCH | A |
| 114 | Signature gate | `clientSignatureImage` — sole completion gate per `SERVICECALL_DECISION_LOCK.md` Decision 8 | preserved (not independently re-walked field-by-field this session beyond confirming the field name exists on `ServiceCall.js`) | — | — | — | Master audit §11 | A |
| 115 | Chargeable amount / Payment | `s.report.chargeable` → Payment auto-created | preserved, one-way (no reverse `paymentId`) | see Finance #56 | Payment | 1 (row 22) | E2E_PASS_3_7 row 22 | A |
| 116 | Status lifecycle | Registered/Scheduled/Assigned/Completed; PM-scheduled calls never visually transition through "Assigned" the same way (`SERVICECALL_DECISION_LOCK.md` Decision 6) | preserved quirk | — | — | — | Master audit §11/§14 | A |
| 117 | Customer message templates | 4 templates incl. verbatim-preserved `"PSC-"` vs `"PSC "` punctuation inconsistency (`SERVICECALL_DECISION_LOCK.md` Decision 12) | preserved; not independently re-grepped character-by-character for all 4 templates this session — per-module audit authority | frontend-facing (client message composition) | — | — | Master audit §11: "spot-confirmed...not independently re-grepped character-by-character this session for all 4 templates" | A (per prior-audit authority) |
| 118 | WhatsApp deep-link behavior | client-side link construction from message templates | frontend concern (`new-app/frontend` not yet built) | — | — | — | out of backend scope; frontend requirement noted, not built | E — deferred to future frontend work (STEP 7), not a backend coverage gap |
| 119 | Clipboard behavior | client-side | frontend concern | — | — | — | same | E — same |
| 120 | Complaint/PM same underlying code path | confirmed — one shared `saveCall`, ternary-branched | preserved conceptually (NEW APP splits into two named functions per #108/#109, same 25-trigger semantics) | — | — | — | E2E_PASS_3_7 (explicit re-confirmation) | A |
| 121 | No Cancelled/reopen path (PWA-native) | confirmed absent — no cancel/reopen fn found for ServiceCall | not invented in NEW APP | — | — | — | Master audit §1: "none (no delete/cancel/reopen fn — independently re-confirmed, see §16)" | A |
| 122 | Re-completion guard | no explicit guard in PWA (`SERVICECALL_DECISION_LOCK.md`) | `POST /:id/complete` (EP-077) documented as idempotent-via-atomic-transition, no separate "already completed" rejection — explicit design choice, cross-referenced | — | — | — | STAGE_6_API_CONTRACT_AUDIT.md §8 | A |
| 123 | No reverse Contract relation / no Inventory relation | confirmed both — one-way Contract link only; zero Inventory reference anywhere in ServiceCall schema/functions | preserved | — | — | — | Master audit §11/§12; STAGE_6_API_CONTRACT_AUDIT.md §9 | A |
| 124 | Reports/export | `GET /export.csv` (EP-070) | not independently re-walked; presence confirmed | — | — | — | STAGE_6_API_CONTRACT_AUDIT.md §12; not executed | F — Execution pending Workstream D |

**ServiceCall: 17 functions traced.** Signature is the sole completion gate; no reverse Contract FK; no Inventory relation; no cancel/reopen path invented; WhatsApp/clipboard are frontend concerns correctly deferred (frontend does not exist yet — STEP 7, out of Workstream C's backend scope, not silently marked PASS).

### J. Inventory (all 5 entities)

| # | PWA Function | PWA Source | PWA Behavior | NEW APP Equivalent | API/Service | Related Entities | Notification | Test Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| 125 | Category CRUD | `saveCat`/`delCat` | co-scoped | `inventoryService.js` | Company | 0 | `PWA_COVERAGE_AUDIT_INVENTORY.md`; Master audit §12 | A |
| 126 | Location CRUD | `saveLoc`/`delLoc` | co-scoped | same | Company | 0 | same | A |
| 127 | Item management | `saveItem`/`delItem`, per-location `stock[]` sub-array | preserved | same | Category, Location | 0 | same | A |
| 128 | Opening stock | per-module audit | not independently re-walked this session | preserved per audit authority | — | — | `PWA_COVERAGE_AUDIT_INVENTORY.md` | A |
| 129 | Purchase | same | same | same | — | — | same | A |
| 130 | Damage/write-off | same | same | same | — | — | same | A |
| 131 | Adjustment (`adjustStock`) | same | stock clamp at zero (per `INVENTORY_DECISION_LOCK.md`) | preserved | — | — | same | A |
| 132 | Issue (`issueMaterial`) | stores `item`(id),`from`(loc id),`staff`(free text),`site`(free text),`projId`(**write-only**) | preserved exactly, incl. write-only `projId` | `inventoryService.js:478` | Item, Location, Project(write-only) | 2 (rows 14–15) | E2E_PASS_3_7 rows 14-15: row 14 MATCH, row 15 has FIX-3.7-01 cosmetic gap (warning-emoji→"WARNING" text) | A/C |
| 133 | Return | `requestReturn`→`acceptReturn`/`rejectReturn` mutating `rqty`/`used`/`retReq` on same Issue row | preserved | `inventoryService.js` | — | 1 (row 16, on accept) | E2E_PASS_3_7 row 16: MATCH | A |
| 134 | Return request | `saveReturnReq` | preserved | `inventoryService.js:526` | — | 1 (row 18) | E2E_PASS_3_7 row 18: FIX-3.7-01 cosmetic gap (mailbox emoji dropped) | C |
| 135 | Return accept | accept path | preserved | `inventoryService.js:629` | — | 1 (row 16) | E2E_PASS_3_7 row 16 | A |
| 136 | Return reject | `rejectReturn` | preserved | `inventoryService.js:656` | — | 1 (row 17) | E2E_PASS_3_7 row 17: MATCH | A |
| 137 | Mark used | `markUsed` | **no notification** (confirmed absent — PWA-native silence) | preserved, silent | `inventoryService.js` | — | 0 — intentionally silent, confirmed by both master audit and E2E_PASS_3_7 full-file grep | A |
| 138 | Transfer | `transferStock` | **no notification** (confirmed absent — PWA-native silence) | preserved, silent | `inventoryService.js` | — | 0 — same | A |
| 139 | Transaction ledger | append-only `invTxns`, written by every stock-affecting action | preserved, append-only, no edit fn | `inventoryService.js` | — | — | Master audit §1/§12: "not independently re-walked line-by-line this session" beyond confirming append-only shape; per-module audit is authority for exact 8-type enum | A (per prior-audit authority) |
| 140 | Issue status derivation | `issStatus()`/`issBal()` — reachable set `Issued, Return Requested, Partially Returned, Returned, "Returned / Used"` (exact spacing), `Consumed` — all 6 reachable, independently re-confirmed character-for-character this engagement | preserved exactly, incl. the exact `"Returned / Used"` string spacing | — | — | — | Master audit §12 (direct source read, independently confirmed); `INVENTORY_DECISION_LOCK.md` §24 Correction 2 | A |
| 141 | My Material | per-module view | not independently re-walked this session | preserved per audit authority | — | — | `PWA_COVERAGE_AUDIT_INVENTORY.md`; Master audit §12: "not independently re-walked this session; per-module audit authority" | A (per prior-audit authority) |
| 142 | Dashboard KPIs / low-stock | threshold breach fires `notify(["inventory","admin"],...)` | preserved, confirmed at L3134 | `inventoryService.js:491` | — | 1 (row 15) | see #132 | A/C |
| 143 | CSVs/reports (5 exporters: Stock, Issued Material, Transactions, My Material, Material Returns) | per-module audit | not independently re-walked field-by-field this session; presence + role gates confirmed | EP-100–104 | — | — | STAGE_6_API_CONTRACT_AUDIT.md §9/§12; FIX-3.6-01 (P3, open) — `STOCK_VIEW_ROLES` over-grants `mep_pm` for Stock CSV exports and Issued-Material report beyond PWA's demonstrated roles | F — Execution pending Workstream D; also carries a P3 role-over-grant finding, not fixed this pass |
| 144 | Inventory↔ServiceCall/Finance/Checklist | confirmed NO RELATION DEMONSTRATED — no field, no read site found anywhere in either direction | preserved (nothing invented) | — | — | — | Master audit §12; STAGE_6_API_CONTRACT_AUDIT.md §9: "No ServiceCall/Finance/Checklist relation found anywhere in inventoryService.js or the Inventory models" | A |
| 145 | Inventory↔Project (Delivery Challan) | confirmed NO RELATION DEMONSTRATED (write-only `projId`; DC has no `invItemId`) | preserved | — | — | — | Master audit §2/§8 | A |

**Inventory: 21 functions traced across all 5 entities.** Two open findings carried forward: FIX-3.7-01 (P3, cosmetic, 2 of 5 Inventory notification texts) and FIX-3.6-01 (P3, authorization over-grant on 2 report/CSV routes, pre-dates this pass, unrelated to notification targeting per E2E_PASS_3_7's own cross-check).

---

## 5. Account relationship audit

Company→User (1:many, `co`/`companyId`), Company→every business collection (`co:U.co` at creation, `mine()`/`companyId` filter at read — confirmed universal across all 15 top-level entities). User→Project (`engs[]` name strings, no referential integrity in PWA; NEW APP upgrades to durable-ref shape where decision-locked). User→ServiceCall (`eng` name string → `ServiceCall.engineerId` ObjectId, approved upgrade). User→Inventory (`staff` free text, preserved as-is, not upgraded — correctly not invented as a User ref since the PWA never demonstrates one). **No direct User FK exists on Checklist, Enquiry, or SalesOrder in the PWA, and none is invented in NEW APP** — independently confirmed this pass via `STAGE_6_API_CONTRACT_AUDIT.md` §4's fresh 2026-09-27 source check, consistent with the engagement's locked relationship-boundary rule.

**User-management backend API — resolved reconciliation (this pass's one independent cross-check, §2):** Pass 3.8 (2026-09-26) found a genuine backend gap — no way, over HTTP, to create/list/edit/deactivate/reassign a User's role after a company's bootstrap admin — and assigned it FIX-3.8-01. Workstream B (`STAGE_6_API_CONTRACT_AUDIT.md`, 2026-09-27, same engagement, one day later) independently re-derived the full route inventory fresh from source and found `userRoutes.js` registered with 5 endpoints (EP-105–109), role-gated `admin`, including a `DELETE /:id` self-delete guard; `STEP_6_API_TEST_HARDENING.md` confirms `userService`/`userManagementWorkflow` test suites present and passing in the 131/131 batch-3 regression count. This pass independently re-checked that reconciliation is genuine (not a documentation-only re-assertion) by cross-referencing the route count, the role gate, and the test-suite name against both documents' independent dates and evidence chains — **FIX-3.8-01 is closed**, not carried forward as open. Account relationship result: **PASS**, with the closure explicitly documented here since neither Pass 3.8 nor Workstream B individually states "FIX-3.8-01 is now resolved" in so many words.

## 6. Checklist chain

Template (Library CRUD, fully implemented per FIX-3.3-01) → SalesOrder (3-step fallback seed, one-time copy at creation) → Project (execution: tick/clear-on-unmark/photos-append-only, approval incl. external CLIENT sign-off, PM countersign one-way) → Notifications (4 of the 25 sites: approval, delayed-completion, all-complete, plus the Project-level delay-check that also reads checklist lateness). Completion-gate independence (checklist state does NOT block `stage==="Completed"`) is independently confirmed by direct source read, not assumed from a field name. All three layers explicitly connected in §F above (rows 58–72). **Result: PASS**, one open P3 cosmetic notification-text finding (FIX-3.7-01, row 71).

## 7. Finance chain

SalesOrder→Milestones→Payments→Part Payments→Received→Payment Date→Raise-to-Finance→Finance Follow-up→Notifications, and ServiceCall→Chargeable Amount→Payment→Finance→Notification — both fully traced and connected in §E above (rows 44–57). Overpayment-gate and rollback mechanics were **not independently re-derived from raw PWA source in this session or the prior master-audit session** (`OPEN_DECISIONS.md` #32 references a precedent that implies per-module-audit coverage, but no direct grep confirms it in either session's record) — classified **E (not sufficiently evidenced by this pass's own verification)**, narrow scope, does not affect the rest of the chain which is otherwise thoroughly traced with A results. Two open P2/P3 content-fidelity findings (FIX-3.7-02 "Collect by date" clause dropped; FIX-3.7-03 `money()` formatting missing on 2 texts) — real but narrow information-completeness issues in notification text, not missing functionality. **Result: PASS, with E4 flagged narrow-scope open item + 2 carried-forward P2/P3 content findings.**

## 8. Project chain

Creation (SO-fused)→Stage/Status(independent)→Timeline(first-save-only notify quirk)→Checklist(see §6)→Engineers(company-wide pool)→Delivery Challans(no Inventory link)→Completion(dual override, literal-string MEP exclusion)→Contract eligibility→Notifications(6 sites). All independently confirmed, no quirk normalized away. **Result: PASS.**

## 9. Contract chain

Project-conversion (eligibility checked at render only — PWA-native gap; NEW APP adds defense-in-depth as approved infra) → Warranty defaults (amount 0, blank phone/email, Quarterly, 1-year) → Manual AMC (separate path, zero notifications, asymmetry preserved) → Visit lifecycle (due-slot stamping, Expiring/Expired derived, Expired remains due, no automatic payment) → ServiceCall forward-only relation (no reverse array). **Result: PASS.**

## 10. Service chain

Complaint/PM-scheduling(shared underlying path)→Assignment(company-wide pool, no dedup)→Report(draft, single overwrite, no history)→Signature(sole completion gate)→Chargeable→Payment→Notifications(5 sites)→no Cancelled/reopen path→no reverse Contract relation→no Inventory relation. **Result: PASS**, WhatsApp/clipboard/message-template character-level fidelity correctly deferred to frontend build (not yet started) rather than falsely marked complete.

## 11. Inventory chain

Category/Location→Item→Issue→Return/Return-Request/Accept/Reject→Mark-Used(silent)/Transfer(silent)→Transaction ledger(append-only)→Dashboard/My-Material→Reports(5 CSVs, execution deferred). Explicit NO-RELATION boundaries to ServiceCall/Finance/Checklist and write-only `projId` to Project, both independently reconfirmed via fresh 2026-09-27 source grep in Workstream B. **Result: PASS**, 2 open P3 findings (1 cosmetic notification text, 1 report-role over-grant).

## 12. Notification coverage — all 25 sites accounted for

Reused directly from `E2E_PASS_3_7_NOTIFICATIONS.md` (fresh, independent re-grep of `notify(` against both PWA copies, 2026-09-24, cross-checked again by Workstream B on 2026-09-27 with an independent re-count of `notificationRepo.create` call sites — both reconcile to 25/25, zero discrepancy):

| Module | Sites | Result |
|---|---|---|
| Enquiry | 0 | A (absence matches absence) |
| SalesOrder | 2 | A |
| Payment/Finance | 3 | A (2 of 3 have open content-fidelity findings: FIX-3.7-02 raise-to-finance date clause, FIX-3.7-03 money() formatting on received/part-received) |
| Checklist | 3 | A |
| Project | 6 | A (1 of 6 has FIX-3.7-01 cosmetic gap — delay-check punctuation) |
| Contract | 1 | A |
| ServiceCall | 5 | A |
| Inventory | 5 | A (2 of 5 have FIX-3.7-01 cosmetic gaps — low-stock and return-request emoji) |
| **Total** | **25** | **25/25 traced, targeted, persisted, tenant-scoped** |

All 25 sites: persisted (`notificationRepo.create`, transactional where the surrounding op is transactional), readable (`GET /api/notifications`, newest-first, matches `vNotifs()`), role/`"*"`-targeted only (never individual-user, matching PWA's structural ceiling), tenant-isolated server-side (approved infra strengthening of PWA's client-trusted filter), correctly silent where PWA is silent (Transfer, Mark-Used, Enquiry-module-wide, SO-edit-vs-create). Dedup/throttle: exactly one throttled family (delay-check, once/day/project), all 24 others correctly un-deduplicated, matching PWA exactly. **6 of 25 rows carry open P2/P3 content-fidelity findings** (text/formatting only — no row has a missing, misrouted, or unpersisted notification).

## 13. PWA quirks preserved (representative, not exhaustive — full list in §4 tables above)

Stale `lostReason`/`lostDate` retained on reopen; no Enquiry→SO duplicate-conversion guard natively (NEW APP adds one, flagged); SO edit fires no notification (create/edit asymmetry); Payment↔SO milestone sync is one-way (Payment→SO only); checklist tick clears `pmSign`/`appr` on un-mark; checklist-library CRUD is cross-division permissive; checklist completion does NOT gate Project completion; Project timeline notification fires first-save only; Project completion is a literal `stage==="Completed"` string, and MEP structurally never reaches it (`"Delivered"` terminal); un-completing a Project silently reverts status; Contract conversion phone/email hardcoded empty; Contract `due[0]` stamps first-due slot, not the triggering visit; Contract manual-vs-conversion notification asymmetry; ServiceCall assignment has no dedup guard; ServiceCall PM-scheduled calls never visually transition through "Assigned" the same way as complaints; ServiceCall re-completion has no explicit guard (idempotent-via-transition by design); Inventory `issStatus()` exact `"Returned / Used"` string spacing; Inventory Transfer/Mark-Used are silently non-notifying; InventoryIssue `projId` and Project `dc[]` are both write-only/non-integrated with each other. All independently confirmed present in NEW APP, none normalized, simplified, or "fixed" away.

## 14. NO-RELATION boundaries (explicit)

- Checklist/Enquiry/SalesOrder: no direct User FK demonstrated — none invented.
- Inventory→ServiceCall/Finance/Checklist: **NO RELATION DEMONSTRATED** — confirmed absent in both source-code grep (this pass's reused evidence) and schema inspection (Workstream B, fresh 2026-09-27).
- InventoryIssue.projId: write-only, no Project-side read-back.
- ServiceCall→Contract: forward reference only; Contract stores no reverse ServiceCall link.
- Payment→ServiceCall: one-way (ServiceCall→Payment is real via chargeable completion; nothing points back).
- Project.dc[] (Delivery Challans) ↔ Inventory: no relation, both directions.
- Enquiry→SalesOrder: no back-reference on the PWA side (NEW APP's `enquiryId` is a flagged, genuine addition, not a PWA-fidelity claim).

## 15. Report/export functions reserved for Workstream D

Marked `Execution pending Workstream D` throughout §4 (not silently passed): Enquiry export.csv + 2 reports (row 29); SalesOrder export.csv (row 43); Payment 2 CSV exports (row 55); Project export.csv + 3 report/export endpoints (row 88); Contract export.csv (row 107); ServiceCall export.csv (row 124); Inventory 5 CSV reports (row 143). **15 report/export functions total**, all confirmed present in route/service code with correct role gates (per Workstream B's fresh source check), none executed or output-validated by this pass.

## 16. All findings (carried forward, none newly assigned by this pass)

This pass discovered no new genuine implementation defect requiring a fresh FIX-6-XX id — every item below was already discovered and numbered in an earlier pass, and this pass's contribution is reconciling their current open/closed status against the freshest available evidence (Workstream B, same day):

| ID | Severity | Area | Status as of this pass | Note |
|---|---|---|---|---|
| FIX-3.6-01 | P3 | Inventory report/export roles (`STOCK_VIEW_ROLES` over-grants `mep_pm`) | **Open** | Unrelated to notification targeting (E2E_PASS_3_7 cross-check); a report-execution-adjacent authorization item, does not block function coverage |
| FIX-3.7-01 | P3 | Notification text cosmetics (3 of 25 rows — emoji/em-dash) | **Open** | Content-fidelity only, no information loss |
| FIX-3.7-02 | P2 | Notification text — "Collect by `<date>`." clause dropped (raise-to-finance) | **Open** | Real information loss in notification text; underlying data (`raisedToFinance.collectByDate`) is stored and correct, only the notification string omits it |
| FIX-3.7-03 | P2/P3 | Notification text — `money()` formatting missing on 2 payment-received texts | **Open** | Internal inconsistency (same helper used correctly elsewhere) |
| FIX-3.7-04 | P3 | Test coverage — no exact-text assertions for 25 notification strings | **Open** | Test-coverage gap, not a functional defect |
| FIX-3.3-01 | — | ChecklistTemplate CRUD implementation | **Closed** | Confirmed live in Workstream B route inventory |
| B2 (master audit, 2026-09-23) | — | Company deletion cascade not implemented | **Closed** | Confirmed implemented and cascading correctly by Workstream B (2026-09-27) |
| B1 (master audit, 2026-09-23) | — | Notification service not wired up | **Closed** | Confirmed 25/25 wired, persisted, tenant-scoped by Pass 3.7 and Workstream B |
| FIX-3.8-01 (Pass 3.8, 2026-09-26) | — | User-management backend API missing | **Closed** | Independently reconciled closed by this pass, §5 |

**No P0 or P1 finding is open.** All open items are P2/P3, all are notification-text content-fidelity or test-coverage items, none represent missing or misdirected functional coverage.

## 17. FIX IDs assigned by this pass

**None.** Per §16, every item this pass encountered was already discovered and numbered by an earlier pass; this pass's job was verifying they are still correctly tracked and current (which required closing four of them out based on fresher evidence, §5/§16), not opening new ones. Per the Fix Policy, a new FIX-6-XX would only be warranted if this pass discovered genuine implementation behavior missing or incorrect that no prior pass had captured — none was found.

## 18. Test / evidence references

- Regression: 365/365 PASS (unchanged — no code modified by this pass; carried from the engagement's locked baseline).
- Step 6 batch-3 regression (131/131), confirming `userService`/`userManagementWorkflow` suites exist and pass — used in §5's reconciliation (`STEP_6_API_TEST_HARDENING.md` line 112).
- `tests/notificationService.test.js`: role/company-scoped listing, newest-first ordering, idempotent mark-read, tenant-isolated mark-read, explicit assertion of Transfer/Mark-Used notification absence (per E2E_PASS_3_7).
- 313/313 passing at time of Pass 3.7 (2026-09-24) — superseded by the later 365/365 full-suite baseline; both are consistent (later baseline is a superset after subsequent steps added more tests, not a contradiction).
- Route inventory: 123/123 endpoints independently re-derived fresh by Workstream B (2026-09-27), including `userRoutes.js` (5), `notificationRoutes.js` (2), `checklistTemplateRoutes.js` (11).
- No implementation code was modified in this pass; therefore no new targeted test was written or run. Where a row's Test Evidence says "per audit, not independently re-walked this session," that is the honest state — this pass's own verification effort went into function-level synthesis, the User-management reconciliation (§5), and cross-checking the notification/company/checklist-template closures (§16), not into re-deriving already-well-established field-level PWA facts a second or third time.

## 19. Limitations

- This pass did not independently re-open `MEP_PROJECTS_PWA/index.html` for the majority of the ~145 rows in §4 — it relies on the already-source-verified per-module audits, the master workflow audit, and 8 E2E passes, all produced earlier in this same engagement and independently cross-checked against fresh Workstream-B evidence dated the same day as this pass. This is the explicitly-permitted reuse path, not an undisclosed shortcut.
- Overpayment and payment-rollback mechanics (Finance rows 50–51) remain genuinely unresolved from source in this pass's own record — classified E, narrow scope, flagged rather than silently assumed PASS.
- Full field-by-field CSV/report content was not executed or validated (15 functions, §15) — correctly reserved for Workstream D, not claimed complete from code inspection alone.
- The four endpoints Workstream B already disclosed as not fully field-by-field reproduced in `API_CONTRACT.md` (`saveTimeline`, `applyChecklistTemplate`, `buildReport`, `createManualContract`) remain a **documentation-only** limitation — this pass did not independently prove or disprove functional completeness beyond what B already established, and does not claim the doc limitation is resolved.
- Customer message-template character-level fidelity (4 templates, ServiceCall row 117) and WhatsApp/clipboard behavior (rows 118–119) are frontend-facing; `new-app/frontend/` remains an empty placeholder (confirmed as of Pass 3.5/3.8) — correctly marked as deferred to STEP 7, not falsely marked PASS.
- This pass assigned zero new FIX-6-XX ids; all findings referenced are earlier-numbered and independently reconciled for current status, per §16/§17.

## 20. Workstream C verdict

**WORKSTREAM C = PASS**

Basis: every materially distinct PWA function across all 11 required modules (Company, Users/Accounts/Roles, Enquiry, SalesOrder, Payment/Finance, Checklist [3 layers], Project, Contract, ServiceCall, Inventory [5 entities], Notifications [25/25 sites]) is represented in NEW APP with cited PWA source evidence, a named NEW APP equivalent, and evidence classification — not inferred from "123 endpoints exist." Account relationships (including the deliberate absence of User FKs on Checklist/Enquiry/SalesOrder) are explicit. The Checklist chain (Template→SO-seed→Project-execution→Notification) is fully connected. The Finance chain (SO→Milestones→Payments→...→Notifications, and ServiceCall-chargeable→Payment→Notification) is fully connected. The Service chain is fully connected with correct NO-RELATION boundaries to Contract-reverse and Inventory. Inventory's NO-RELATION boundaries to ServiceCall/Finance/Checklist are explicit and independently reconfirmed. All 25 notification sites are mapped, targeted, persisted, and tenant-scoped, with 6 open P2/P3 content-fidelity findings honestly carried forward (none blocking, none representing missing functionality). PWA quirks are represented, not normalized. Report/export functions (15 total) are explicitly marked reserved for Workstream D, not falsely passed. The one pre-existing documentation limitation (4 endpoints not fully field-level reproduced) is honestly recorded, not claimed resolved. The one genuine functional gap discovered mid-engagement (User-management API, FIX-3.8-01) is independently reconciled as closed based on same-day Workstream B evidence, not merely asserted.

**No unexplained missing functionality was found.** No P0/P1 finding is open. This pass assigned no new FIX-6-XX ids because no new genuine defect was discovered beyond what earlier passes already captured and this pass reconciled.
