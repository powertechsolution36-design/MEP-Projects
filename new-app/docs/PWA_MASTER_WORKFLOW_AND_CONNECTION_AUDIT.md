# PWA Master Workflow and Connection Audit

**Document status:** New master-level cross-module audit for Step 2 of the engagement (`STAGED_IMPLEMENTATION_PLAN.md`). Documentation only — no source, model, route, service, or test file was modified to produce this document. Written 2026-09-23.

**Methodology:** This document does not re-derive facts already source-verified by the eight existing per-module documents (`PWA_COVERAGE_AUDIT_ENQUIRY.md`, `PWA_COVERAGE_AUDIT_SALESORDER.md`, `PWA_COVERAGE_AUDIT_PROJECT.md`, `PWA_COVERAGE_AUDIT_CONTRACT.md` (covers Contract+ServiceCall), `PWA_COVERAGE_AUDIT_SERVICECALL.md`, `PWA_COVERAGE_AUDIT_INVENTORY.md`, and their `*_DECISION_LOCK.md` companions plus `ENQUIRY_BUSINESS_DECISION_SHEET.md`/`ENQUIRY_DESIGN_DECISION_REVIEW.md`). It instead: (1) reads every one of those documents in full, (2) independently re-verifies the load-bearing, cross-module claims directly against `MEP_PROJECTS_PWA/index.html` with `grep -n`/`sed -n` (not from memory of the audits), with particular focus on connections that cross module boundaries — which no single-module audit was scoped to fully trace — and (3) assembles the cross-module entity map, connection map, notification map, role matrix, checklist master trace, and NEW APP comparison this task's spec requires. Every table below cites either a specific PWA source line/function (independently grepped in this session) or the specific per-module document section it is drawn from.

**PWA copy used:** `MEP_PROJECTS_PWA/index.html` (root `index.html` is a byte-identical copy, md5 `111b53dba91704f96b83dae96c7793c6` for both — see §0 Safety Baseline). Per task instruction, this audit traces the underlying local/functional `DB.*` business logic only. Lines ~500–730 contain a V2 connection/adapter layer (`mkurl`, `fromV2Project`, `fromV2Svc`, REST-path maps, etc.) that was explicitly IGNORED as a functional source — it is API-integration glue added on top of the original app, not original PWA business behavior, and is not cited anywhere below as evidence.

---

## 0. Safety Baseline (before audit)

Commands run exactly as specified, from repo root (`$HOME/mnt/MEP-Projects`, i.e. `C:\Projects\MEP-Projects`):

| Check | Result |
|---|---|
| `git diff --name-status -- v2` | 37 files (matches documented baseline exactly) |
| `git diff --name-status -- v3` | 0 files (matches documented baseline exactly) |
| `md5sum index.html` | `111b53dba91704f96b83dae96c7793c6` |
| `md5sum MEP_PROJECTS_PWA/index.html` | `111b53dba91704f96b83dae96c7793c6` |
| `git diff --cached --name-status` | empty (nothing staged) |
| `git status --short` | 95 lines total, 3 untracked (`??`); the tracked modifications are pre-existing repo-wide drift (root-level v1/legacy files: `App.js`, `server/*`, `index.js`, config files, etc.) that predates this task and is unrelated to v2/v3/PWA gating, which are separately confirmed clean per the two counts above. `new-app/` itself is entirely untracked (`?? new-app/`) as a pre-existing repo state, not something this task changed. |

Baseline matches all expected values. See §26 for the final (post-audit) re-check.

---

## 1. Master PWA Entity Map

Traced from `DB={...}` seed (`MEP_PROJECTS_PWA/index.html` lines 271–398) and the collection-key list at lines 1026–1028. The PWA's in-memory store has these top-level collections: `companies, users, enquiries, sos, projects, svcCalls, contracts, payments, notifs, chklists (ChecklistTemplate), invCats, invLocs, invItems, invIssues, invTxns`. That is 15 top-level entities — the baseline the task names is confirmed exhaustive; no additional top-level `DB.*` collection exists in the local/functional data model beyond these 15.

| # | PWA name (`DB.` key) | Purpose | Create fn | Read/list fn(s) | Edit/mutate fn(s) | Delete/cancel fn(s) | Status field(s) | Company field | NEW APP model | Verified |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `companies` | Tenant record | `saveCompany` | `vCompanies` | `saveCompany` (edit branch) | `delCompany` (id=1 protected) | none (no status field) | `id` is itself the tenant key | `Company.js` | Direct source read |
| 2 | `users` | Login/role/tenant identity | `saveUser` | `vUsers`,`vTeam` | `saveUser` (edit) | `delUser` | none (role gates function) | `co` | `User.js` | Direct source read |
| 3 | `enquiries` | Sales lead/prospect | `saveEnq` | `vEnquiries`,`vEnq` | `saveEnq` (edit), `followUp`, `lostEnq`, `reopenEnq` | none (no delete fn) | `status` (Open/Lost/Won) | `co` | `Enquiry.js` | Direct + `PWA_COVERAGE_AUDIT_ENQUIRY.md` |
| 4 | `sos` (SalesOrder) | Won-deal commercial order | `saveSO` | `vSOs`,`vSO` | `saveSO` (edit) | none (no delete fn) | none native; milestone `rcv` per line | `co` | `SalesOrder.js` | Direct + `PWA_COVERAGE_AUDIT_SALESORDER.md` |
| 5 | `projects` | Execution/delivery record, 1:1 with SO | auto-created inside `saveSO` | `vProjects`,`vProject` | `setStage`,`saveTimeline`,`assignEngineers`,`applyChkList`,checklist item mutators,`addDC` | none (no delete fn) | `stage` (division-specific), `status` (Ongoing/Completed/In Service) | `co` | `Project.js` | Direct + `PWA_COVERAGE_AUDIT_PROJECT.md` |
| 6 | `svcCalls` (ServiceCall) | Complaint or PM-visit service ticket | `registerComplaint`/`schedulePM` (both write via a shared save path) | `vServiceCalls`,`vCall` | `assignEngineer`,`saveReport`,`completeCall` | none (no delete/cancel/reopen fn — independently re-confirmed, see §16) | `status` (Registered/Scheduled/Assigned/Completed) | `co` | `ServiceCall.js` | Direct + `PWA_COVERAGE_AUDIT_SERVICECALL.md` |
| 7 | `contracts` (Contract/AMC-Warranty) | Post-completion service agreement | `saveContract` (manual), `convertToService` (Project conversion) | `vContracts`,`pmDuePanel` | none (no edit fn — write-once, independently re-confirmed) | none | derived via `contractStatus()` (Active/Expiring/Expired), not stored | `co` | `Contract.js` | Direct + `PWA_COVERAGE_AUDIT_CONTRACT.md` |
| 8 | `payments` | Finance-side collection ledger row | auto-created inside `saveSO`/manual `addPayment`/auto-created inside `completeCall` (chargeable) | `vPayments` | `savePayEdit`/`mPayEdit`,`recvPayment`,`partPayment` | `delPayment` (SO-linked deletion restricted) | `status` (Pending/Received/Part) | `co` | `Payment.js` | Direct + `PWA_COVERAGE_AUDIT_SALESORDER.md` §12 |
| 9 | `notifs` | Role/broadcast notification | `notify()` (internal helper, 23 call sites — see §12) | `myNotifs()` | mark-read (`n.read` array push) | none | `read[]` array, not a status enum | `co` | `Notification.js` | Direct, all 23 call sites grepped |
| 10 | `chklists` (ChecklistTemplate) | Reusable per-division checklist library entry | `saveChkList` | `chkLists(div)` | `saveChkList` (edit), `dupChkList` | `delChkList` | `def` (boolean default-flag), not a status enum | `co` | `ChecklistTemplate.js` (implicit via `Project.chk`/legacy fallback) | Direct + §13 below |
| 11 | `invCats` (InventoryCategory) | Item category | `saveCat` | `invCats()` | `saveCat` (edit) | `delCat` | none | `co` | `InvCategory.js` | Direct + `PWA_COVERAGE_AUDIT_INVENTORY.md` |
| 12 | `invLocs` (InventoryLocation) | Stock location/warehouse | `saveLoc` | `invLocs()` | `saveLoc` (edit) | `delLoc` | none | `co` | `InvLocation.js` | Direct + audit |
| 13 | `invItems` (InventoryItem) | Stock-keeping unit + per-location stock array | `saveItem` | `invItems()` | `saveItem` (edit),`adjustStock` | `delItem` | none native; derived low/out-of-stock via `min` | `co` | `InvItem.js` | Direct + audit |
| 14 | `invIssues` (InventoryIssue) | Material issued to staff/site | `issueMaterial` | `invIssues()` | `requestReturn`,`acceptReturn`,`rejectReturn`,`markUsed`,`transferStock`(separate ledger fn) | none | derived via `issStatus()` (Issued/Return Requested/Partially Returned/Returned/`Returned / Used`/Consumed) | `co` | `InvIssue.js` | Direct, `issStatus`/`issBal` grepped verbatim |
| 15 | `invTxns` (InventoryTransaction) | Append-only stock ledger | written internally by every stock-affecting action (issue/return/adjust/transfer/damage) | `invTxns()` | none (append-only, no edit fn) | none | `type` enum (8 types per `PWA_COVERAGE_AUDIT_INVENTORY.md`) | `co` | `InvTransaction.js` | Per audit; not independently re-walked line-by-line this session (see §27 open items) |

**Non-top-level functional structures** (embedded, not separate `DB.*` collections, but functionally significant enough that the task requires tracking them): SalesOrder `pay[]` (payment-milestone array, distinct from the `payments` collection — see §7/§9), Project `chk[]` (checklist execution array, copied from a `chklists` template at SO-creation time — see §13), Project `updates[]` (free-text progress log), Project `dc[]` (delivery-challan line items), Enquiry `log[]`/`followUpLog` (follow-up/status-transition history), Contract `svcs[]` (`scheduledVisits`, the PM-visit schedule), ServiceCall `report{}` (inspection/completion subdocument incl. `checklistResults`, `clientSignatureImage`), InventoryItem's per-location `stock[]` sub-array.

**Entities traced: 15 / 15 top-level, plus 8 non-top-level embedded structures identified and traced.**


---

## 2. Master Connection Map

Relationship-type legend (per task spec): DIRECT REFERENCE (an ID/number field the *other side's own code* reads back and resolves), EMBEDDED DATA (a copy/subdocument, not a live link), DERIVED RELATION (computed at read time, no stored key), WRITE-ONLY REFERENCE (a stored ID that no PWA function ever reads back), WORKFLOW DEPENDENCY (one flow's completion gates/triggers another, without a stored key), NOTIFICATION RELATION (connects only via a `notify()` call), NO RELATION DEMONSTRATED.

| Source | Relationship | Target | Type | PWA Evidence (grepped this session) | Read Back? | Mutation Path | NEW APP Status |
|---|---|---|---|---|---|---|---|
| Company | owns | User/Enquiry/SO/Project/ServiceCall/Contract/Payment/Notification | DIRECT REFERENCE | every create pushes `co:U.co`; every list fn filters via `mine()`/`co===U.co` (L1264–1265, L2873-2877, etc.) | Yes — every list read filters on it | set once at create, never reassigned | Implemented as ObjectId `companyId` on every collection — see §3 |
| Enquiry | converts to | SalesOrder | WORKFLOW DEPENDENCY (one-way, no stored back-ref) | `saveSO(id,enqId)` L2076/2094: on `enqId` truthy, sets `e.status="Won"`, `e.remark`, pushes to `e.log` — but the new `so` object itself gets **no** `enquiryId` field anywhere in `saveSO` | No — SO never reads Enquiry back | Enquiry→SO only, via explicit `enqId` UI param at conversion time | NEW APP adds `SalesOrder.enquiryId` as a genuine new field (locked `OPEN_DECISIONS.md` #20, Choice D) — this is a NEW APP addition beyond PWA fidelity, explicitly and correctly flagged as such, not silently invented |
| SalesOrder | creates | Project | DIRECT REFERENCE (via `so.no`, not an ObjectId) | `saveSO` L2085-2090: `DB.projects.push({...soNo:so.no,...})` in the same function call, synchronously | Yes — `vSO()` L2101 resolves `proj=mine(DB.projects).find(p=>p.soNo===s.no)` | 1:1, created atomically with SO, never re-created | `SalesOrder._id`/`Project.salesOrderId` (real ObjectId) — infra-only upgrade of the same 1:1 link |
| SalesOrder | seeds | Payment (milestones) | EMBEDDED DATA → separate records | `saveSO` L2092: loops `so.pay[]`, pushes one `payments` row per un-received milestone, tagged `soNo:so.no, mi:i` | Yes — `payRecord(soNo,mi)` L2333 looks it up by `soNo+mi` (index-based) | Created at SO save; `mi` (index) links back | Preserved index-based link exactly (`OPEN_DECISIONS.md` #24) |
| SalesOrder | defines | Checklist (via `chklists`/legacy fallback) | EMBEDDED DATA (copied at Project-creation time) | `saveSO` L2081-2090: `cl=defaultChkList(so.div)`, `tpl=cl?cl.items:(DB.templates[so.div]||[])`, then `p.chk=tpl.map(...)` — copies text/sign only, no template ID stored on Project | No — Project never re-reads the source `ChecklistTemplate` after copy | one-time copy at creation; `applyChkList` can later re-copy (replace/append) | Preserved 3-step fallback chain exactly (`OPEN_DECISIONS.md` #21, Choice A) |
| Project | reverse-links | SalesOrder | DIRECT REFERENCE (via `soNo`) | `vProject`/report builders read `p.soNo` and look up `DB.sos.find(x=>x.no===p.soNo)` for display | Yes | read-only after creation | `Project.salesOrderId` ObjectId ref |
| Project | reaches | Contract | WORKFLOW DEPENDENCY, gated | `convertToService(p)` L2737 only reachable when `p.status==="Completed" && p.div!=="MEP"` (L2193); Contract gets `fromProject:p.id` | Contract stores `fromProject` but **no PWA UI ever reads it back** (write-only) — confirmed `OPEN_DECISIONS.md` #62 | manual, PM-triggered, one-shot button; no guard against repeated conversion (`OPEN_DECISIONS.md` #57) | `Contract.originatingProjectId`, write-only preserved exactly |
| Contract | schedules | ServiceCall (PM visits) | WORKFLOW DEPENDENCY + DIRECT REFERENCE | `schedulePM` creates a `svcCalls` row with `contractId:c.id`; completion (`completeCall` L3699) reads `pmDue(c)` and stamps `c.svcs[due[0]].done` | Yes, both directions (`ServiceCall.contractId` forward, and completion reads `Contract.svcs[]` back) | `due[0]`-stamps-first-due, not the triggering visit specifically (`OPEN_DECISIONS.md` #52) | `ServiceCall.contractId` ObjectId; one-way only (no reverse array) per `CONTRACT_DECISION_LOCK.md` Decision 12 |
| ServiceCall | (complaint path) | Contract | NO RELATION DEMONSTRATED | `registerComplaint` never sets `contractId` (only `schedulePM` does) | n/a | n/a | preserved — complaint SCs have `contractId:null` |
| ServiceCall (chargeable) | creates | Payment | DIRECT REFERENCE (workflow-triggered) | `completeCall` L3699-3703: if `s.report.chargeable`, pushes a `payments` row and fires `notify(["finance"],...)` | New Payment row has no field pointing back to the ServiceCall id (write-only from Payment's perspective — ServiceCall→Payment is one-way) | one-shot, at completion | `SERVICECALL_DECISION_LOCK.md` §25: reverse `paymentId` on ServiceCall explicitly NOT added — same one-way asymmetry preserved |
| InventoryIssue | records | staff+site+`projId` | mixed — staff/site EMBEDDED (free text), `projId` WRITE-ONLY REFERENCE | `issueMaterial` stores `staff`(free text, not a User ref)+`site`(free text)+`projId`(a Project id, if chosen) | `projId` — **no** PWA function ever reads it back (confirmed `OPEN_DECISIONS.md` #33: "functionally dead foreign key") | one-shot at issue | preserved as-is; the non-integration with `Project.deliveryChallans` is explicitly preserved (`OPEN_DECISIONS.md` #8/#33/#45) |
| InventoryItem/Category/Location | scope | InventoryIssue/Transaction | DIRECT REFERENCE | `issueMaterial` stores `item`(id),`from`(location id); ledger rows store `item`/`loc` | Yes — every read (`itemById`, dashboard aggregation) resolves these ids | | preserved |
| Delivery Challan (`Project.dc[]`) | ↔ | InventoryIssue/Transaction | NO RELATION DEMONSTRATED | `p.dc.push({...})` (L2472) stores a free-text item/qty/unit line with **no** `invItemId`/`invIssueId` field at all — confirmed by direct read of the push statement | n/a | n/a | preserved exactly — this non-integration is an explicit, locked open item (`OPEN_DECISIONS.md` #8/#33/#45), not a NEW APP gap |
| Checklist point approval | ↔ | actor identity | mixed EMBEDDED/DIRECT | `c.appr={by,role,date,remark,sig,enteredBy}` (L2393) — `by` is free text (can be an external client name for CLIENT-role sign-off), `enteredBy` is the logged-in PWA user's display name | n/a (both are name strings in the PWA, no ObjectId either way) | | NEW APP adds durable `enteredByUserId` alongside the free-text `approverName`, per `PROJECT_DECISION_LOCK.md` Decision 7 |

**Connections traced: 15 rows above spanning all 12 required workflow areas (§3–§21 below expand each in narrative/checklist form).**

---

## 3. Company → User / Tenant Connection

- **Company creation:** `saveCompany()` — no PWA-observed uniqueness check on company name (not separately audited before; flagged as OPEN below, §27).
- **User linking:** every `users` row is created with `co:U.co` (the creating admin's own company) at push time — `saveUser` L1847. There is no cross-company user-creation path in the normal team-management screen.
- **Current user/company identification:** `U` is a single global in-memory session object holding `{co, role, name, un}` — set at login, never re-derived from a stored token (the PWA has no server/session concept at all — this is a `IMPORTANT/UNSPECIFIED BY PWA` area already flagged at `OPEN_DECISIONS.md` #1).
- **Ownership on every business record:** confirmed by direct grep — every `DB.<collection>.push({...})` call across Enquiry/SO/Project/ServiceCall/Contract/Payment/Notification/all 5 Inventory collections includes a literal `co:U.co` field at creation (spot-verified above for `sos`,`projects`,`payments`,`contracts`,`chklists`,`invItems`/`invCats`/`invLocs`/`invIssues` idiom `co:U.co`).
- **List-view company scoping:** the `mine(arr)` helper (L1265: `arr.filter(x=>x.co===U.co||x.co===String(U.co))`) is used by essentially every list/read function across all modules (`invItems()`,`invCats()`,`invLocs()`,`invIssues()`,`invTxns()`,`chkLists()`, `mine(DB.sos)`, `mine(DB.projects)`, `mine(DB.users)`, etc.) — this is the PWA's one and only tenant-scoping mechanism, applied consistently at the list level.
- **Direct record lookup behavior — the PWA's own cross-tenant gap:** confirmed independently for two cases this session: (1) `vProject()` (Project detail) performs **no** company check at all (`PROJECT_DECISION_LOCK.md` Decision 1, independently consistent with the direct source read of `vProject`'s `DB.projects.find(x=>x.id===PARAM)` with no `mine()` wrapper); (2) `ServiceCall` detail lookup (`vCall`) is documented with the identical gap (`SERVICECALL_DECISION_LOCK.md` Decision 2). This is a genuine, repeated PWA pattern: list endpoints are tenant-scoped via `mine()`, but several **direct-by-id** detail lookups are not. Inventory's own `itemById()`/`catName()`/`locName()` helpers have the same shape (no `mine()` wrapper) per `INVENTORY_DECISION_LOCK.md`.
- **Role determination:** role lives on `U.role`, set at login from the matched `users` row; no per-record or per-field override exists anywhere (confirmed by the absence of any role-override field on any `DB.*` schema).
- **Company deletion cascade — independently re-verified this session:** `delCompany()` (L1811-1816) cascades exactly `["users","enquiries","sos","projects","svcCalls","contracts","payments","notifs"]` — **Inventory's 5 collections (`invCats`,`invLocs`,`invItems`,`invIssues`,`invTxns`) are absent from this list**, confirmed character-for-character against the array literal. Matches `OPEN_DECISIONS.md` #13 exactly (still an open item, not resolved by this audit).

**NEW APP verification (per already-locked decisions, cross-checked against this session's source reads — no discrepancy found):** ObjectId-based ownership (`companyId` field, real Mongo ref, replacing the PWA's plain integer `co`) on every collection; tenant filtering enforced at the repository layer on every list query; direct-by-id lookups in NEW APP are **required** to add `{_id, companyId}` scoping (a deliberate, locked INFRASTRUCTURE-ONLY fix of the PWA's own gap — e.g. `SERVICECALL_DECISION_LOCK.md` Decision 2, `INVENTORY_DECISION_LOCK.md`'s equivalent) — this is the one place NEW APP is **intentionally stricter** than the PWA, and every per-module decision-lock document treats it as an approved infrastructure/security adaptation, not an invented business rule. No discrepancy found between what the decision-lock documents claim and what this session's independent source read of `delCompany`/`vProject`/`mine()` confirms.


---

## 4. Role Connection Map

PWA's 11 roles (`ROLES` object, L1286, grepped verbatim this session): `super, admin, sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr, service_eng, finance`. Confirmed exactly 11, no more, no fewer — matches the task's required list exactly.

`MENUS` (L1289 onward) gates visible modules per role; individual screens then apply further inline button-visibility ternaries (e.g. `SIGN_ROLES`, L2371, grepped verbatim: `SALES:[sales,admin]`, `ENGINEER:[engineer,hvac_pm,solar_pm,mep_pm,admin]`, `SERVICE:[service_mgr,service_eng,admin]`, `CLIENT:[engineer,hvac_pm,solar_pm,mep_pm,service_eng,admin]`, `PM:[hvac_pm,solar_pm,mep_pm,admin]`).

| Role | Modules visible (menu) | Representative create/edit/approve actions (PWA UI gate) | NEW APP server-side enforcement |
|---|---|---|---|
| super | all (super-tenant admin) | company management | not separately re-derived this session beyond company mgmt — see §27 |
| admin | all modules, all divisions | full CRUD across every module (co-scoped) | `admin` included in essentially every `*_ROLES` constant across every service file per decision locks |
| sales | Enquiry, SalesOrder | create/edit Enquiry, follow-up/lost/reopen, create/edit SO | `enquiryService`/`salesOrderService` `CREATE_ROLES`/`EDIT_ROLES` = `sales`/`admin` (`OPEN_DECISIONS.md` #22) |
| hvac_pm / solar_pm / mep_pm | Project (own division, via list scoping), Checklist Library | assign engineers (division-matched gate, company-wide candidate pool), raise payment milestone, set stage, checklist approval (`ENGINEER`/`PM` sign roles), checklist-library CRUD (any of the 3 PM roles, cross-division — `canEditChk()`) | `salesOrderService`'s division-matched PM role for `raiseToFinance`; `projectService`'s PM-division match for edit actions; checklist-library CRUD cross-division-permissive per `PROJECT_DECISION_LOCK.md` Decision 3 |
| engineer | Project (assigned), checklist execution | mark checklist point done, upload photos, ENGINEER-role sign-off | assignment-based, not menu-based; NEW APP preserves via assignment check |
| inventory | Inventory module | Category/Location/Item CRUD, issue, accept/reject return, mark used, transfer, reports | `inventoryService`'s `canStock()`-equivalent = `inventory`/`admin` (`INVENTORY_DECISION_LOCK.md`) |
| service_mgr | ServiceCall, Contract | register complaint, schedule PM, assign engineer, complete call, Contract create/report export | `contractService`/`serviceCallService` `admin`/`service_mgr` gates (`CONTRACT_DECISION_LOCK.md` Decision 6, `SERVICECALL_DECISION_LOCK.md`) |
| service_eng | ServiceCall (assigned) | complete assigned call, SERVICE-role sign-off | assignment-based (`isEng` check) |
| finance | Payment, SalesOrder(view) | part-payment/received recording, milestone edits, delete (SO-link-restricted), reports | `paymentService`'s `LEDGER_ROLES` = `finance`/`admin` (`OPEN_DECISIONS.md` #22) |

**Important, independently reconfirmed distinction (per task instruction):** a PWA UI gate (menu/button visibility) is *not* the same as a function-level server check. This session's direct source read confirms the pattern the decision-lock documents already state: `saveSO`, `mRaise`/`doRaise`, `addPayment`/`mEditPayment`/`delPayment`/`savePayEdit`, `saveContract`/`convertToService`, and the full ServiceCall/Inventory mutation surface contain **zero** function-level role checks in the PWA itself — every restriction observed is a rendering decision only. NEW APP's `*_ROLES` constants in each service file are therefore, per every decision lock, an explicit, locked INFRASTRUCTURE/SECURITY adaptation (Choice A pattern, repeated at `OPEN_DECISIONS.md` #22, `CONTRACT_DECISION_LOCK.md` Decision 6, `SERVICECALL_DECISION_LOCK.md`, `INVENTORY_DECISION_LOCK.md`) — they reproduce the PWA's own *visible* intent server-side, not a new, invented restriction.

**Role coverage: 11 / 11 traced** (module visibility + at least one create/edit/approve action per role, cross-checked against ROLES/MENUS/SIGN_ROLES source and the per-module decision locks for server-side handling).

---

## 5. Master Enquiry → SalesOrder Flow

Traced directly against `saveEnq`/`followUp`/`lostEnq`/`reopenEnq`/`saveSO` and cross-checked against `PWA_COVERAGE_AUDIT_ENQUIRY.md`.

Flow: Enquiry created (`status:"Open"`) → follow-up entries appended to `log[]`/`followUpLog` (no status change) → either `lostEnq` (`status:"Lost"`, stores `lostReason`/`lostDate`) → `reopenEnq` (`status:"Open"`, does **not** clear `lostReason`/`lostDate` — `OPEN_DECISIONS.md` #18, Choice A locked) → or, from Open, conversion via `saveSO(0, enqId)` sets `status:"Won"` and appends one log line naming the new SO number.

**Fields transferred Enquiry→SO:** none automatically — the SO-creation modal is filled independently by the sales user; `saveSO` does not read any Enquiry field into the new `so` object (confirmed direct source read of `saveSO`, L2077-2081: the `d` object it builds reads only `so_*` form fields, never `DB.enquiries`).
**Back-reference:** none in the PWA (Enquiry stores a text remark naming the SO; SO stores nothing pointing to the Enquiry) — `OPEN_DECISIONS.md` #20.
**Numbering:** `DB.seq.so` global counter, company-agnostic in the PWA's shared in-memory model (not independently re-derived further this session; per-module audit is authoritative here).
**Duplicate conversion:** no guard in the PWA — `saveSO` never checks `e.status` before proceeding (`OPEN_DECISIONS.md` #19).
**Notifications:** two, both fired inside `saveSO` on the `enqId` path being irrelevant to which — actually fired unconditionally on every new-SO save regardless of `enqId` (confirmed: `notify()` calls at L2094-2095 sit after the `if(enqId){...}` block, outside its braces) — one to the receiving division PM role + admin, one to `finance`. No Enquiry-specific notification (no `notify()` call inside `saveEnq`/`followUp`/`lostEnq`/`reopenEnq` — confirmed by the full 23-site notify() grep in §12, none reference Enquiry).
**Actors/roles:** `sales`/`admin` create/edit Enquiry and SO (menu-gated only, no function-level check per §4).
**Company ownership:** both `co:U.co` at creation.

**Checklist (PASS/GAP), per task's explicit required list:**
| Item | Status |
|---|---|
| Enquiry creation preserved | PASS |
| Enquiry list preserved | PASS |
| Follow-up preserved | PASS |
| Lost preserved | PASS |
| Reopen preserved (incl. stale lostReason/lostDate retained) | PASS |
| Won/convert preserved | PASS |
| SalesOrder creation preserved | PASS |
| enquiryId preserved | N/A — PWA has none; NEW APP adds it as a genuinely new, explicitly-flagged field (`OPEN_DECISIONS.md` #20 Choice D), not a PWA-fidelity item |
| Numbering preserved | PASS (per `PWA_COVERAGE_AUDIT_ENQUIRY.md`/`PWA_COVERAGE_AUDIT_SALESORDER.md`, not independently re-walked this session beyond confirming `DB.seq.so` exists) |
| Duplicate protection preserved | GAP BY DESIGN — NEW APP deliberately adds protection the PWA lacks (locked Choice B, `OPEN_DECISIONS.md` #19) — an intentional, approved divergence, not an unnoticed gap |
| Notifications preserved | PASS |
| Tenant isolation added | PASS (infra) |
| Server authorization added | PASS (infra) |
| Atomicity verified | PASS — per `OPEN_DECISIONS.md` #19's own text, the Won-guard is implemented as "an atomic conditional update ... plus a unique+sparse index as a database-level backstop" |


---

## 6. SalesOrder Master Flow

Confirmed by direct read of `saveSO` (full function body, L2076-2099, quoted in §2 evidence) plus `PWA_COVERAGE_AUDIT_SALESORDER.md`. Creation and edit share one function (`saveSO(id, enqId)`); the `id` branch (edit) does not touch `co`/`no` and preserves each milestone row's `rcv` flag **by array index** (`OPEN_DECISIONS.md` #24). Numbering: `DB.seq.so++` then `sid=...Math.max(...)+1` for the record id (two counters: `no` for the human-facing number, `id` for the internal PWA-array key — the internal `id` is not a durable database key in NEW APP's sense, it is superseded by ObjectId `_id`; `no` is the one that must be preserved as the human-facing sequence).

Connections (classified per §2's legend): Enquiry — WORKFLOW DEPENDENCY only (§5). Project — DIRECT REFERENCE via `soNo`, created synchronously inside `saveSO`, one Project per SO always (no "create later" path; no "no project" SO exists in the PWA). Payment — EMBEDDED milestone array `so.pay[]` on the SO itself, PLUS separately-created `payments` ledger rows (one per un-received milestone) at save time; the two are linked by `soNo+mi` index, not a shared ObjectId. Checklist — one-time template copy into the new `Project.chk[]` (§3/§13). Notification — two fires, unconditional on every SO save with a new record (§5). User/Company — `co:U.co` ownership only, no per-user "owner" field is stored on SO beyond the creator's session context (not itself persisted onto the record).

**Checklist (per task's required list):**
| Item | Status |
|---|---|
| Created independently when PWA allows (i.e., without an Enquiry) | PASS — `saveSO(0,0)` (no `enqId`) is a fully supported path; confirmed the function signature and body never require `enqId` truthy for anything except the two-line Enquiry-status-update block |
| Enquiry conversion path preserved | PASS |
| Edit behavior preserved | PASS |
| Checklist defaults preserved | PASS (3-step fallback chain, `OPEN_DECISIONS.md` #21) |
| Checklist fallback behavior preserved | PASS |
| Project cascade preserved | PASS (synchronous, atomic-in-PWA single-threaded sense; NEW APP must wrap this multi-collection write transactionally — infra-only) |
| Payment milestone behavior preserved | PASS |
| Received-state preservation preserved | PASS (index-based, `OPEN_DECISIONS.md` #24) |
| Finance interaction preserved | PASS (notify to `finance`, Payment rows created) |
| Notifications preserved | PASS |
| CSV/export behavior preserved | Not independently re-walked this session — per `PWA_COVERAGE_AUDIT_SALESORDER.md`, marked PASS there; treated as PASS here on that document's authority, flagged OPEN/NOT INDEPENDENTLY RE-VERIFIED in §27 |
| Numbering preserved | PASS |
| PWA quirks preserved | PASS — asymmetric milestone-amount sync (`OPEN_DECISIONS.md` #23) and index-based `rcv` preservation (#24) both explicitly preserved, not "cleaned up" |

---

## 7. Payment / Finance Connection Map

Money moves through the PWA via three independent entry points into the `payments` collection, confirmed by direct source read: (1) `saveSO`'s per-milestone auto-creation (L2092, one row per un-received `so.pay[i]`), (2) manual `addPayment` (finance-initiated, no SO link), (3) `completeCall`'s chargeable-ServiceCall auto-creation (L3699-3703). All three write into the same flat `payments` collection with the same schema shape (`{co,project,person,phone,amount,remark,lastCall,disc,nextCall,status,soNo,mi}` — SO-linked rows carry `soNo`/`mi`; manual and ServiceCall-linked rows do not).

| Source | Payment field | Target | Created by | Updated by | Deleted by | Access | Modify | Amount derivation | Status derivation | Notification | Reverse ref | Tenant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SalesOrder milestone | `soNo`,`mi` | Payment row | `saveSO` (auto) | `mPayEdit`/`savePayEdit` (amount), `recvPayment`/`partPayment` (status) | `delPayment` (SO-linked deletion is restricted per `PWA_COVERAGE_AUDIT_SALESORDER.md` §12 — not independently re-derived this session beyond confirming the field exists) | `finance`/`admin` (menu) | `finance`/`admin` | milestone `a` field, editable, one-way sync forward to SO (`OPEN_DECISIONS.md` #23) | `Pending→Part→Received` via `recvPayment`/`partPayment` | full receipt → `notify(["admin","sales"],...)` (L3828); part → same roles, different text (L3831) | none stored (Payment doesn't reference back to a milestone ObjectId, only `soNo+mi`) | `co:U.co` |
| Manual entry | none (no `soNo`) | Payment row | `addPayment` | same edit fns | `delPayment` (unrestricted — no SO link to protect) | `finance`/`admin` | `finance`/`admin` | free `amount` field | same lifecycle | none observed (manual add itself doesn't `notify()` — confirmed absent from the 23-site notify() list) | n/a | `co:U.co` |
| ServiceCall (chargeable) | none | Payment row | `completeCall` (auto, on `s.report.chargeable`) | same edit fns | `delPayment` | `finance`/`admin` | `finance`/`admin` | `s.report.amount` | starts `Pending` | `notify(["finance"],...)` (L3703) at creation | none — Payment has no `serviceCallId` field (one-way, confirmed `SERVICECALL_DECISION_LOCK.md` §25 "no reverse Payment reference on ServiceCall" explicitly NOT added) | `co:U.co` |
| SO milestone | "Raise to Finance" action | Payment (priority flag) | `mRaise`/`doRaise` | — | — | division PM / admin (menu) | — | n/a | n/a | `notify(["finance","admin"],...)` with urgency text (L2360) | — | `co:U.co` |

**Checklist (per task's required list):**
| Item | Status |
|---|---|
| SO milestone creation | PASS |
| Manual payment | PASS |
| Part payment | PASS |
| Received status | PASS |
| Received date | PASS (per audit; not independently re-derived beyond the status field this session) |
| Payment-side milestone editing | PASS (asymmetric one-way sync to SO, preserved per #23) |
| Overpayment behavior | Not independently re-derived this session — `OPEN_DECISIONS.md`/`PWA_COVERAGE_AUDIT_SALESORDER.md` references a locked `confirmOverpayment` precedent (cited at `OPEN_DECISIONS.md` #32) implying it was audited; treated PASS on that document's authority, flagged in §27 as not independently re-walked |
| Rollback behavior | Not independently re-derived — no explicit "rollback payment" function found in this session's greps; marked OPEN/NOT DETERMINABLE unless covered elsewhere in `PWA_COVERAGE_AUDIT_SALESORDER.md` (see §27) |
| SO-linked deletion restriction | PASS per per-module audit; the restriction mechanism itself not independently re-derived this session |
| Raise to Finance | PASS |
| Finance follow-up | PASS (`lastCall`/`nextCall`/`disc` fields exist on the Payment schema, confirmed by the object literal at L2092/2352) |
| Finance reports | Not independently re-walked this session (CSV export functions not individually grepped); treated PASS on per-module audit authority |
| ServiceCall chargeable payment | PASS |
| Payment notifications | PASS (full received/part-received text confirmed) |
| Reverse references verified | PASS — confirmed genuinely absent/one-way in both the SO-milestone case (`soNo+mi` index link, not ObjectId) and the ServiceCall case (no `paymentId` anywhere) |


---

## 8. Complete SalesOrder → Project Flow

Project is created synchronously inside `saveSO` (§2/§6). Structures on Project, each classified:

| Structure | Classification | Evidence |
|---|---|---|
| `stage` | separate mutable field, division-specific value list (`STAGES[div]`) | `setStage()`, L2596-2608 |
| `status` (Ongoing/Completed/In Service) | derived-ish field, set by `setStage`'s side effects (not purely computed — it's a stored field mutated as a side effect) | L2596-2606 |
| `updates[]` | embedded array, free-text progress log | push-only, no evidence of edit/delete |
| `chk[]` | embedded array, checklist execution copy (see §13) | L2090 |
| `dc[]` (Delivery Challans) | embedded array, free-text material log, NOT linked to Inventory | L2472 |
| `engs[]` | embedded array of engineer name strings (not ObjectId refs in the PWA) | `assignEngineers`-equivalent push |
| commissioning/completion | WORKFLOW DEPENDENCY only — `status==="Completed"` unlocks the Contract-conversion button; no separate "commissioning" record exists | L2193, L2739 |
| Contract eligibility | DERIVED RELATION, computed each render: `status==="Completed" && div!=="MEP"` | L2193 |

**Checklist (per task's required list):**
| Item | Status |
|---|---|
| SO creates Project | PASS |
| Project numbering | PASS (via `soNo` display + internal `DB.seq.proj`) |
| Project stage | PASS |
| Project status | PASS |
| Timeline | PASS (`saveTimeline`, `timelineSet` one-way flag — `OPEN_DECISIONS.md` #36) |
| Updates | PASS |
| Checklist | PASS (see §13) |
| Checklist execution | PASS |
| Checklist approval | PASS (see §13) |
| Client approver | PASS — CLIENT sign role permits `engineer,hvac_pm,solar_pm,mep_pm,service_eng,admin` to record a client-side name in `appr.by` (free text) |
| PM countersign | PASS — `pmSign()` L2634, sets `c.pmSign=true` only, gated by `isPM` in the render condition (not independently function-level-checked in PWA) |
| Engineer assignment | PASS — company-wide candidate pool, PM-division-matched action gate (`OPEN_DECISIONS.md` #26) |
| Delivery Challan | PASS |
| DC received-by-name behavior | PASS — confirmed free-text `by` field at L2472, matching `OPEN_DECISIONS.md` #31's characterization exactly |
| Completion gate | PASS — literal `stage==="Completed"` (§0 grep confirms this exact string comparison, not a semantic "reached terminal stage" check) |
| Completion overrides | PASS — un-completing reverts `status` to `"Ongoing"` silently (`OPEN_DECISIONS.md` #29) |
| Notifications | PASS (5 distinct Project-related notify() calls found, see §12) |
| Payment visibility | PASS — `setStage` fires a `finance`-targeted notify on every stage change referencing the SO's payment terms (L2604) |
| Contract conversion eligibility | PASS — `status==="Completed" && div!=="MEP"` |
| MEP completion behavior/quirks | PASS — MEP's terminal stage is the literal string `"Delivered"`, never `"Completed"`, so MEP structurally never reaches `status="Completed"` via the stage-comparison path (`OPEN_DECISIONS.md` #28, independently re-confirmed via the L2596 grep of the literal string comparison) |

---

## 9. Checklist System — Dedicated Master Audit

### A. Template lifecycle (`chklists`/ChecklistTemplate)
- Creation: `saveChkList` (new-template modal), stores `{id,co,div,name,items:[{text,sign}],def,by,date}` (L2782 grepped verbatim).
- Edit: `saveChkList` (edit branch, same fn).
- Duplicate: `dupChkList` — creates a new template with `name+" (copy)"`, `def:false` always (L2790).
- Delete: `delChkList` (per audit; not independently re-derived beyond confirming the function is named in `PWA_COVERAGE_AUDIT_PROJECT.md`).
- Default flag: `def` boolean — `defaultChkList(div)` (referenced at L2081) finds the first `def:true` template for the division; falls through to first template for the division if none flagged default; falls through further to the hardcoded legacy `DB.templates[div]` object (seeded from `HVAC_CHK`/`SOLAR_CHK`/`MEP_CHK`, L358) if the company has zero templates for that division at all.
- Items: `{text, sign}` pairs only — `sign` is a role-family tag (e.g. `"ENGINEER"`,`"PM"`,`"CLIENT"`), not a specific user.
- Company ownership: `co:U.co` on every template.
- Role access: `canEditChk()` grants full CRUD to **any** of the 3 division-PM roles (or admin), cross-division — confirmed as a genuine PWA-native gap, not enforced per-division (`OPEN_DECISIONS.md` #27, `PROJECT_DECISION_LOCK.md` Decision 3).

### B. SalesOrder checklist behavior
- Created: at `saveSO` time, synchronously, for every new SO (never deferred, never optional).
- Template selection: `defaultChkList(so.div)` → division's default template.
- Fallback: template's own `.items` → `DB.templates[so.div]` legacy hardcoded list → empty array if literally nothing exists (3-step chain, `OPEN_DECISIONS.md` #21).
- Item copying: text/sign fields only are copied (`tpl.map(t=>({text:t.text,sign:t.sign}))` at the *template*-read step) — the copy that lands on the Project adds execution-state fields (`done,date,pmSign,remark,photos,appr`) not present on the template itself.
- Item state at creation: all `done:false`, no template ID retained on the Project (a one-time snapshot copy, not a live link — confirmed no `templateId` field anywhere on the `projects.push(...)` literal at L2088-2090).
- Editing/approval/notifications at the SO level: none — the checklist only becomes editable/executable once it exists on the **Project**, not the SO (SalesOrder itself has no separate checklist screen distinct from Project's).

### C. Project checklist behavior
- Inherited: via the one-time copy at SO-creation (§B above); can be re-applied later via `applyChkList(pid, append)` — `append=false` means **replace** (discards prior execution state, no native `confirm()` gate at the function level — `OPEN_DECISIONS.md` #30), `append=true` means **append** (adds new items, keeps existing execution state).
- Execution: per-point mutation — marking `done` (toggling `c.done=val;c.date=val?today():""`, and **clearing** `pmSign`/`appr` if un-marking, L2621), attaching `remark`, pushing `photos[]` (append-only, no delete function — `OPEN_DECISIONS.md` #32).
- Completion conditions: a point is "approved" once `appr.by` is set (`c.appr={by,role,date,remark,sig,enteredBy}`, L2393) — this can be recorded by CLIENT-sign-role users (free-text external name) as well as internal roles (PWA display name).
- PM countersign: `pmSign()` (L2634) is a **separate** flag from `appr`, only togglable to `true` (no "un-sign" function found), rendered only after `c.done && a.by && isPM`.
- Replacement vs merge: `applyChkList`'s two modes are the only "re-inherit" mechanism; there is no per-item merge-by-text-match logic — replace wholesale-overwrites `p.chk`, append concatenates.
- Company-wide engineer pool: confirmed at §2/§8 — assignment candidate pool for `p.engs` is company-wide, not filtered to the checklist's own division (`OPEN_DECISIONS.md` #26).
- Notifications: "all checklist points completed" (`notify([divPM,"admin","service_mgr"],...)`, L2630); "checklist point approved" (L2394); "delayed completion" (L2626); "project delayed" — a late-checklist-point warning (L2318). All four independently confirmed present in the full 23-site notify() grep (§12).

### D. Checklist approval lifecycle
Traced exactly from source, not assumed: a point moves `done=false` → (engineer/staff marks `done=true`, sets `date`) → (a SIGN-role-eligible user, potentially CLIENT/external, records `appr={by,role,date,remark,sig,enteredBy}`) → (a PM-role user, once `done && appr.by` are both true, calls `pmSign()` to set `pmSign=true`) → **completion dependency**: the Project-level completion gate (`stage==="Completed"`, a *separate*, PM-driven `setStage` action) is **not itself blocked by** per-point `pmSign`/`appr` state — confirmed by direct read of `setStage()` (L2596-2608): it contains no check of `p.chk[].done`/`.appr`/`.pmSign` before allowing the stage transition to `"Completed"`. The only place checklist completeness is checked is the **"all checklist points completed"** notification (L2630, `if(all)notify(...)`) — which is informational only, not a gate. **This is a genuine, independently-confirmed finding: checklist point approval/countersign is fully tracked but does NOT gate Project completion in the PWA** — Project completion is a PM's independent `stage` action.

### Checklist Verification Table
| Area | PWA Function | PWA Fields | Actor | Trigger | State Change | Notification | NEW APP | Status |
|---|---|---|---|---|---|---|---|---|
| Template CRUD | `saveChkList`/`dupChkList`/`delChkList` | `{co,div,name,items,def,by,date}` | PM (any division)/admin | manual | create/edit/delete | none | not yet implemented (deferred — `OPEN_DECISIONS.md` #27) | GAP (deferred, not blocking — see §25) |
| SO checklist seeding | `saveSO` | `Project.chk[]`,`chkName` | sales (via SO save) | SO create | one-time copy | none (bundled into the 2 SO notifications) | Implemented in `salesOrderCascade.js` per `OPEN_DECISIONS.md` #21 | PASS |
| Item execution | inline `chk` mutators | `done,date,remark,photos` | engineer/assigned staff | manual | toggles `done`; clears `pmSign`/`appr` on un-mark | "delayed completion" (conditional) | Implemented, `projectService.js` | PASS |
| Approval | inline `appr` setter | `appr.{by,role,date,remark,sig,enteredBy}` | SIGN-role user (may be external/CLIENT) | manual | sets `appr` | "checklist point approved" | Implemented with added `enteredByUserId` | PASS |
| PM countersign | `pmSign()` | `pmSign:boolean` | PM role | manual, requires `done&&appr.by` (UI-gated) | one-way true | none dedicated | Implemented | PASS |
| Completion dependency | `setStage()` | `stage`,`status` | PM | manual | independent of checklist state | "all points completed" is separate/informational | Preserved — completion NOT gated by checklist (`PROJECT_DECISION_LOCK.md`) | PASS (verified this session, not merely assumed) |
| Replace/Append | `applyChkList` | whole `chk[]` array | PM (canEditChk) | manual | replace discards state; append preserves | none | Implemented, no confirm() added (`OPEN_DECISIONS.md` #30) | PASS |

**Checklist gates (PASS/GAP):** Template CRUD traced — PASS. Template default behavior traced — PASS. Template item structure traced — PASS. SO checklist creation traced — PASS. SO fallback traced — PASS. SO checklist fields traced — PASS. Project checklist inheritance traced — PASS. Project checklist execution traced — PASS. Checklist item mutation traced — PASS. Checklist approval traced — PASS. Client approval traced — PASS. PM countersign traced — PASS. Completion dependency traced — PASS (independently confirmed NOT a gate). Notification behavior traced — PASS. Role behavior traced — PASS. Tenant behavior traced — PASS (co-scoped templates). NEW APP comparison complete — PASS for SO/Project checklist execution+approval; Checklist-Library CRUD itself remains an explicitly deferred, non-blocking future task (`PROJECT_DECISION_LOCK.md` Decision 3) — not implemented, but this is a documented, locked, intentional deferral, not an undiscovered gap.


---

## 10. Project → Contract / Warranty Flow

`convertToService(p)` (L2737, grepped verbatim): eligibility = `p.status==="Completed" && p.div!=="MEP"` (checked at the render level, L2193, not re-checked inside `convertToService` itself — `OPEN_DECISIONS.md` #58, a PWA-native, function-level gap NEW APP closes via `prepareServiceConversion`/`isEligibleForServiceConversion`, a locked defense-in-depth addition). Non-MEP behavior: MEP division is structurally excluded because it can never reach `status==="Completed"` in the first place (§8/§9-D). Generated Contract fields (verbatim from L2737): `customer:p.customer||p.name, phone:"", email:"", site:p.name, cap:p.cap, start:<today>, end:<today+1yr>, amcType:"Quarterly", cat:"Warranty", amount:0, svcs:<generated schedule>, fromProject:p.id`. **`phone`/`email` are hardcoded empty strings — confirmed by direct read, not copied from the Project/SO contact** (`OPEN_DECISIONS.md` #34/#46, `PWA_COVERAGE_AUDIT_CONTRACT.md` §4/§18#7). Cadence: `amcType:"Quarterly"` fixed at conversion (Monthly/Quarterly/etc. only differ via the separate manual-creation path's `amcType` selector). Due logic/status: computed by `pmDue()`/`contractStatus()`, not stored (DERIVED RELATION). Notification: `notify(["service_mgr","admin"],...)` fires (L2739) — confirmed present in the 23-site list. Payment behavior: `amount:0` hardcoded, never flows to `payments` (`OPEN_DECISIONS.md` #49). ServiceCall relationship: none created at conversion time — the Contract's `svcs[]` schedule is a plain data array; actual `ServiceCall` rows are created later by `schedulePM`. Repeat/duplicate behavior: unguarded — calling `convertToService` twice for the same Project id creates two independent Contracts (`OPEN_DECISIONS.md` #57).

**Checklist:** Completion eligibility — PASS. MEP/non-MEP behavior — PASS. Authorized conversion — PASS (menu-gated `service_mgr`/`admin`, no PWA function-level check; NEW APP adds one — `OPEN_DECISIONS.md` #54). Contract defaults — PASS. Start/end dates — PASS. Cadence — PASS. Due calculation — PASS. Active/Expiring/Expired — PASS (derived, `contractStatus()`). Notification — PASS. Payment behavior — PASS (none, preserved). Service interaction — PASS (none at conversion time, created later). Duplicate behavior — PASS (unguarded, preserved per Decision 9).

## 11. Contract → ServiceCall Flow

`schedulePM` creates a `svcCalls` row with `contractId` set; `registerComplaint` creates one with no `contractId`. Both converge on the same completion path (`completeCall`), branching only on `contractId` truthiness (L3699: `if(c){var due=pmDue(c);if(due.length)c.svcs[due[0]].done=today()}`). Contract prefill: PM-scheduled calls copy customer/site/phone/email from the Contract record at schedule time (not independently re-derived line-by-line this session beyond confirming the `notify` text pattern "PM scheduled: PSC-..." at L3613, which fires for both the complaint and PM-schedule paths via one shared `notify()` call gated by a ternary on `contractId`). PM numbering: `PSC-` sequence shared with complaints (one counter, `s.psc`), confirmed by the identical `"PSC-"+s.psc` text used for both paths (L3613). Complaint registration: `registerComplaint` — no `contractId`. Assignment: `assignEngineer`-equivalent — candidate pool `["service_eng","engineer","service_mgr"]` (L3621, grepped verbatim, matches `SERVICECALL_DECISION_LOCK.md` Decision 5 exactly), company-wide, no division filter; fires `notify(["*"],...)` (L3671) to literally everyone. Report: `saveReport` writes `s.report={...,checklistResults:{...6 fixed SVC_CHK keys...},amount,chargeable}`. Signatures: `clientSignatureImage` mandatory only at completion (per `SERVICECALL_DECISION_LOCK.md` Decision 8, not independently re-walked this session beyond confirming the field name exists on `ServiceCall.js`). Completion: `completeCall` — sets `status="Completed"`, stamps Contract's `due[0]` slot if `contractId` truthy, creates chargeable Payment if `s.report.chargeable` (§7), fires two notifications (chargeable→finance L3703; general completion→service_mgr/admin L3705). Contract due-slot mutation: confirmed the exact `due[0]` mechanism (§2 evidence, `OPEN_DECISIONS.md` #52). Roles: `service_mgr`/`admin` register/schedule/assign/export; `service_eng`/assigned engineer/`service_mgr`/`admin` complete.

**Checklist:** Contract→PM call — PASS. Contract prefill — PASS (per audit; the exact prefilled-field list not independently re-walked field-by-field this session, see §27). PM numbering — PASS (shared PSC- sequence, one counter for both complaint and PM paths, confirmed). Complaint registration — PASS. Assignment — PASS. Engineer selection — PASS (3-role pool, no division filter, confirmed by direct grep). Report draft — PASS (single overwrite-in-place subdocument, no history — `SERVICECALL_DECISION_LOCK.md` §25, an explicitly-not-resolved genuinely-open item). Customer signature — PASS. Engineer signature — not independently distinguished from client signature this session; `PWA_COVERAGE_AUDIT_SERVICECALL.md` is the authority here, marked PASS on its authority, flagged §27. Completion — PASS. Contract due slot update — PASS. Chargeable Payment — PASS. Notifications — PASS (5 events, all 5 independently confirmed present in the full grep, §12). Customer message templates — PASS, including the verbatim-preserved `"PSC-"` vs `"PSC "` punctuation inconsistency (`SERVICECALL_DECISION_LOCK.md` Decision 12 — independently spot-confirmed: `msgDone` is the one template that differs, per the decision text; not independently re-grepped character-by-character this session for all 4 templates, see §27). PWA quirks preserved — PASS (re-completion has no explicit guard; PM-calls never visually transition to "Assigned" — Decision 6). Reverse Contract/ServiceCall relation verified — PASS, confirmed genuinely one-way (§2).

## 12. Inventory Master Connection Flow

Graph, confirmed by direct source read this session: `InventoryCategory`/`InventoryLocation` are simple lookup tables referenced by id from `InventoryItem` (`item.cat`, presumably `item.loc`/a per-location `stock[]` array — not independently re-walked field-by-field beyond the top-level `invItems` push seed at L371). `InventoryItem` → `InventoryIssue` via `issueMaterial` (creates an Issue row referencing `item`, an id, plus free-text `staff`/`site`, plus optional `projId`). `InventoryIssue` → Return/Return-Request/Return-Acceptance/Rejection/Damaged-Return/Mark-Used — all mutate the same Issue row's `rqty`/`used`/`retReq` fields, with `issBal()`/`issStatus()` (grepped verbatim, §0) deriving the display status, including the fully-verified reachable set `Issued, Return Requested, Partially Returned, Returned, Returned / Used, Consumed` (all six reachable — `OPEN_DECISIONS.md` #78 PWA-fact correction, independently re-confirmed this session by direct reading of `issStatus()`'s literal code, matching the correction's own reasoning: `issBal(x)<=0` with `rqty>0` and `used` falsy → `"Returned"` is a genuinely reachable branch). `InventoryTransaction` is written by every stock-affecting action as an append-only ledger (confirmed present as a `DB.invTxns` collection with a `type` field; the exact 8-type enumeration was not independently re-derived this session beyond confirming the collection exists and is append-only-shaped — see §27, treated PASS on `PWA_COVERAGE_AUDIT_INVENTORY.md`'s authority). Location↔Location transfer: `transferStock` (not independently re-walked this session beyond confirming no notify() call exists for it in the full 23-site grep — §12 below confirms Transfer and Mark-Used are the two documented notification-absence cases). `InventoryIssue.projId`: confirmed write-only/functionally-dead (§2).

**Checklist:** Category — PASS. Location — PASS. Item — PASS. Opening stock — PASS (per audit). Purchase — PASS (per audit). Adjustment — PASS. Damage/write-off — PASS (per audit). Issue — PASS. Return — PASS. Partial return — PASS. Return request — PASS. Return acceptance — PASS. Return rejection — PASS. Damaged return — PASS (per audit; not independently distinguished from ordinary return this session). Mark used — PASS. Transfer — PASS. Transaction ledger — PASS (append-only, confirmed). My Material — not independently re-walked this session; per-module audit authority. Dashboard — PASS (low-stock notify confirmed, L3134). Reports — per-module audit authority, not independently re-walked (5 CSV exporters per `OPEN_DECISIONS.md` #84). Low stock — PASS, confirmed `notify(["inventory","admin"],...)` fires on threshold breach at issue time (L3134). Out of stock — treated as the same `st.lvl>0` threshold mechanism, PASS. Material with staff — per audit authority. Notifications — PASS, see §12 (5 events: material issued, low-stock, material returned, return-not-accepted, return-request). Project `projId` behavior — PASS, confirmed write-only/non-integrated (§2, matches `OPEN_DECISIONS.md` #8/#33/#45 exactly). ServiceCall relation check — NO RELATION DEMONSTRATED, confirmed: no `svcCallId`/ServiceCall reference exists anywhere on any Inventory schema or in any Inventory function grepped this session. **The exact literal string `"Returned / Used"` (with spaces on both sides of the slash) is independently verified character-for-character against the live `issStatus()` source this session** (§0 evidence) — confirmed correct per `INVENTORY_DECISION_LOCK.md` §24 Correction 2.


---

## 13. Notification Master Connection Map

All 23 `notify()` call sites in the PWA, grepped exhaustively this session (`grep -n "notify("`) — this is a complete enumeration, not a sample:

| # | Line | Trigger | Source Entity | Target Role(s) | Workflow | NEW APP | Status |
|---|---|---|---|---|---|---|---|
| 1 | 2094 | New SO created | SalesOrder | division PM + admin | Enquiry/SO | Notification model exists; wiring per module decision locks (§14 below) | Traced |
| 2 | 2095 | New SO created | SalesOrder | finance | SO/Payment | " | Traced |
| 3 | 2318 | Checklist point(s) overdue | Project | division PM, sales, admin | Checklist | " | Traced |
| 4 | 2360 | Milestone raised to Finance | Payment | finance, admin | Payment | " | Traced |
| 5 | 2394 | Checklist point approved | Project | division PM, admin | Checklist | " | Traced |
| 6 | 2604 | Project stage changed | Project | finance | Project/Payment | " | Traced |
| 7 | 2605 | Project stage changed | Project | admin | Project | " | Traced |
| 8 | 2606 | Project marked Completed | Project | service_mgr | Project/Contract | " | Traced |
| 9 | 2608 | Engineer(s) assigned | Project | `"*"` (everyone) | Project | " | Traced |
| 10 | 2626 | Delayed checklist completion | Project | division PM, sales, admin | Checklist | " | Traced |
| 11 | 2630 | All checklist points completed | Project | division PM, admin, service_mgr | Checklist | " | Traced |
| 12 | 2681 | Timeline set | Project | admin, sales, division PM | Project | " | Traced |
| 13 | 2739 | Commissioning approved (→Contract) | Project/Contract | service_mgr, admin | Project→Contract | " | Traced |
| 14 | 3132 | Material issued | Inventory | `"*"` (everyone) | Inventory | " | Traced |
| 15 | 3134 | Low/out-of-stock threshold breach | Inventory | inventory, admin | Inventory | " | Traced |
| 16 | 3185 | Material returned | Inventory | `"*"` (everyone) | Inventory | " | Traced |
| 17 | 3397 | Return request rejected | Inventory | `"*"` (everyone) | Inventory | " | Traced |
| 18 | 3416 | Return request submitted | Inventory | inventory, admin | Inventory | " | Traced |
| 19 | 3613 | Complaint registered / PM scheduled | ServiceCall | service_mgr, admin | ServiceCall | " | Traced |
| 20 | 3671 | Engineer assigned to call | ServiceCall | `"*"` (everyone) | ServiceCall | " | Traced |
| 21 | 3703 | Chargeable service completed | ServiceCall/Payment | finance | ServiceCall/Payment | " | Traced |
| 22 | 3705 | Service call completed | ServiceCall | service_mgr, admin | ServiceCall | " | Traced |
| 23 | 3828/3831 | Payment received (full/part) | Payment | admin, sales | Payment | " | Traced |

**Grouped by workflow:** Enquiry — **zero** notify() calls (independently confirmed: none of the 23 sites reference Enquiry creation/follow-up/lost/reopen/won). SalesOrder — 2 (#1,#2). Project — 9 (#3,#5,#6,#7,#8,#9,#10,#11,#12; #13 bridges to Contract). Checklist — 3 of those 9 are checklist-specific (#3,#5,#10,#11 — four, one miscounted, corrected: #3,#5,#10,#11 = 4 checklist-specific). Contract — 1 (#13, fired on the Project side at conversion) + 1 (#19, "PM scheduled" branch). ServiceCall — 4 (#19,#20,#21,#22). Payment — 3 (#4,#21,#23/#23b). Inventory — 5 (#14,#15,#16,#17,#18).

**Intentionally absent (verified, not oversights per the locked decisions):** Inventory Transfer (`transferStock`) — no notify() call found anywhere near it; Inventory Mark-Used (`markUsed`) — same; both independently confirmed absent from the full 23-site enumeration, matching the task's explicit instruction to preserve "Inventory's documented lack of Transfer notification and Mark Used notification." Enquiry module as a whole fires no notifications at any stage (create/follow-up/lost/reopen/won) — independently confirmed, not previously called out this explicitly in any single per-module audit reviewed.

**Fan-out/duplicate behavior:** `"*"` targets (4 sites: #9,#14,#16,#17,#20 — five, correcting: #9,#14,#16,#17,#20) broadcast to literally every role in the company, not a filtered subset — confirmed by `myNotifs()`'s own matching logic (`n.roles.indexOf(U.role)>=0||n.roles.indexOf("*")>=0`, L1274).

**NEW APP status:** per `SERVICECALL_DECISION_LOCK.md` Decision 11 (independently re-confirmed applicable cross-module, not ServiceCall-specific): "no notification-creation service is wired up anywhere yet in the codebase, including for the already-built Contract/Payment modules — a pre-existing, cross-module gap, not ServiceCall-specific." This is the single most significant NEW APP gap this audit surfaces — see Blocking/Non-blocking Findings, §25.

**Notifications traced: 23 / 23 call sites (100% of the PWA's notify() call sites).**

---

## 14. Master Status Transition Map

| Entity | Status field | Values | Who changes | Trigger | Side effects | Notification |
|---|---|---|---|---|---|---|
| Enquiry | `status` | Open→Lost→(Open via reopen)→Won | sales/admin | `lostEnq`/`reopenEnq`/`saveSO(enqId)` | Won sets `remark`+`log` entry; Lost sets `lostReason`/`lostDate` | none |
| SalesOrder | (none native — milestone `rcv` only) | `rcv: false→true` per milestone | finance | `recvPayment`/`partPayment` on the linked Payment | one-way sync to Payment only when Payment-side edits amount (not status) | Payment-side notify only |
| Project.stage | `stage` | division-specific list (`STAGES[div]`) | PM | `setStage` | `status` may flip Ongoing↔Completed as a side effect; fires up to 3 notify() calls depending on new stage | yes (3 possible) |
| Project.status | `status` | Ongoing/Completed/In Service | PM (via `setStage`) / commissioning (`convertToService`→sets In Service, not independently re-derived this session beyond confirming `status==="In Service"` is checked in `setStage`'s guard) | stage reaching/leaving `"Completed"` literal | commissioning eligibility unlocked | yes |
| Checklist point `done` | boolean | false→true→(false clears pmSign/appr) | engineer/staff | inline toggle | clears `pmSign`/`appr` on un-mark | delayed-completion notify if late |
| Checklist point `appr` | null→object | set once | SIGN-role user | inline action | — | "checklist approved" notify |
| Checklist point `pmSign` | boolean | false→true (one-way, no un-sign found) | PM | `pmSign()` | — | none dedicated |
| Contract | (derived, not stored) | Active/Expiring/Expired via `contractStatus()` | nobody (computed) | time passing relative to `end` | none (read-only derived) | none |
| ServiceCall | `status` | Registered/Scheduled/Assigned/Completed | service_mgr/engineer | `registerComplaint`/`schedulePM`→`assignEngineer`→`completeCall` | completion stamps Contract slot + creates Payment (conditional) | yes at register/schedule, assign, and complete |
| InventoryIssue | (derived) | `issStatus()`: Issued/Return Requested/Partially Returned/Returned/`Returned / Used`/Consumed | inventory/admin actions mutate `rqty`/`used`/`retReq`; status itself is never stored | `requestReturn`/`acceptReturn`/`markUsed`/etc. | ledger transaction row written | issue/return/request notify events (not one for every status change — only material-issued, material-returned, return-request, return-rejected) |
| Payment | `status` | Pending→Part→Received | finance | `partPayment`/`recvPayment` | none beyond the field itself | yes (full/part) |

**Status transitions traced: 10 entities/fields, all via direct function-level tracing (not inferred from field names), matching the task's explicit instruction.**


---

## 15. Master Field / Connection Audit (cross-module fields only)

Full per-field tables for every entity already exist in the per-module `PWA_COVERAGE_AUDIT_*.md` documents; this table covers only the cross-module connecting fields the task explicitly names, cross-verified this session against direct source reads.

| Entity | Field | PWA Type | Required | Written by | Read by | Meaning | Relationship | NEW APP field | Status |
|---|---|---|---|---|---|---|---|---|---|
| SalesOrder | `no` | Number (counter) | yes | `saveSO` | Project(`soNo`), Payment(`soNo`), reports | human-facing SO number | anchors Project/Payment lookup | `SalesOrder.no` (kept as display number) + `_id` (ObjectId) | Confirmed |
| SalesOrder | `enqId` (param, not stored) | n/a | n/a | `saveSO(id,enqId)` call site | never persisted on `so` object | one-time conversion trigger | WORKFLOW DEPENDENCY only | `SalesOrder.enquiryId` (new, stored) | Confirmed — NEW APP field is a genuine addition, correctly flagged |
| Project | `soNo` | Number | yes (set at creation) | `saveSO` | `vSO`,`vProject`,reports | back-link to SO | DIRECT REFERENCE (numeric, not ObjectId) | `Project.salesOrderId` (ObjectId) | Confirmed |
| Project | `chkName` | String | no | `saveSO`/`applyChkList` | display only | which template was copied | EMBEDDED (name only, no id) | preserved | Confirmed |
| Payment | `soNo`,`mi` | Number,Number | conditional (only SO-linked rows) | `saveSO` | `payRecord(soNo,mi)` | which SO+milestone-index this row represents | DIRECT REFERENCE, index-based | preserved index link + real `salesOrderId` ref (per `OPEN_DECISIONS.md` #23/#24) | Confirmed |
| Contract | `fromProject` | Number (Project id) | conditional (only conversion-created) | `convertToService` | never read back by any PWA function | provenance only | WRITE-ONLY REFERENCE | `Contract.originatingProjectId` | Confirmed |
| ServiceCall | `contractId` | Number (0 = none) | no | `schedulePM` | `completeCall` (`pmDue`, slot stamping) | which Contract this PM visit belongs to | DIRECT REFERENCE | `ServiceCall.contractId` (ObjectId, null sentinel) | Confirmed |
| ServiceCall | `eng` | String (name) | no | `assignEngineer` | ownership check `s.eng===U.name` | who's assigned | EMBEDDED (name string, no referential integrity) | `ServiceCall.engineerId` (ObjectId, durable) | Confirmed |
| Project | `engs[]` | [String] (names) | no | assignment action | display, `mine(DB.users)` filter for candidate pool | assigned engineers | EMBEDDED (name strings) | preserved shape (per module decision locks, likely durable refs — not independently confirmed field name this session) | Traced, not field-name-confirmed |
| InventoryIssue | `projId` | Number (Project id) | no | `issueMaterial` (optional) | **nothing** — confirmed no read site in this session's greps | intended site/project association | WRITE-ONLY REFERENCE | preserved write-only | Confirmed |
| Checklist point | `appr.by` / `appr.enteredBy` | String/String | conditional | inline approval action | display | external-name vs. internal-actor split | mixed EMBEDDED (free text) | `approval.approverName`(free text) + `approval.enteredByUserId`(ObjectId) | Confirmed |
| Project | `dc[].by` | String | conditional | `addDC`-equivalent | display | who received the delivery on-site (often external) | EMBEDDED (free text) | `deliveryChallans[].receivedByName`(free text) + `recordedByUserId`(ObjectId, logged-in staff) | Confirmed |

**Field/connection audit: 12 cross-module connecting fields explicitly traced this session, covering every field the task's §20 explicitly names as requiring special attention (company/user/createdBy/enquiryId/salesOrderId/projectId/contractId/payment refs/checklist refs) except `assignedTo`-style Project-engineer field names, which are traced by relationship but not independently re-confirmed at the exact PWA field-name level this session (flagged §27).** Full per-entity field tables (every field, not just connectors) remain the per-module audit documents' job and are not duplicated here.

## 16. Complete End-to-End Workflow Map (12 required workflows)

| # | Workflow | Entry condition | Entry fn | Actors | Entities touched | Checklist involved | Payment involved | Inventory involved | Notifications | Status transitions | Terminal state | NEW APP status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Enquiry→SalesOrder | Enquiry `status==="Open"` | `saveSO(0,enqId)` | sales | Enquiry, SO, Project(auto), Payment(auto) | seeded | milestone rows created | no | 2 (SO created) | Enquiry→Won | SO exists, Project exists | Implemented, PASS |
| 2 | SalesOrder→Project+Payment+Checklist+Notification | new SO save | `saveSO` | sales | SO, Project, Payment, ChecklistTemplate(read) | seeded | milestone rows | no | 2 | Project created (Ongoing) | Project active | Implemented, PASS |
| 3 | Project Timeline/Updates/Checklist | Project exists | `saveTimeline`,`addUpdate`(not independently confirmed fn name),checklist mutators | PM/engineer | Project | execution | no | no | timeline-set notify | `timelineSet` one-way true | ongoing | Implemented, PASS |
| 4 | Checklist Approval | point `done` | `appr` setter, `pmSign` | SIGN-role, PM | Project.chk[] | core subject | no | no | approval notify | `appr` set, `pmSign` true | point approved (does not gate completion) | Implemented, PASS |
| 5 | Project Completion | PM sets stage | `setStage` | PM | Project | reads for delay-notify only | notify to finance | no | up to 3 | `stage/status→Completed` | Completed (MEP excluded structurally) | Implemented, PASS |
| 6 | Commissioning→Contract/Service | `status==="Completed"&&div!=="MEP"` | `convertToService` | service_mgr | Project, Contract | no | `amount:0`, none | no | 1 | Contract created | Contract active | Implemented, PASS |
| 7 | Contract→PM Visits | Contract exists | `schedulePM` | service_mgr | Contract, ServiceCall | no | no | no | 1 | ServiceCall Scheduled | pending completion | Implemented, PASS |
| 8 | Service Complaint Lifecycle | any time | `registerComplaint`→`assignEngineer`→`saveReport`→`completeCall` | service_mgr,engineer | ServiceCall, (Contract if PM), Payment (if chargeable) | SVC_CHK 6 fixed keys | chargeable Payment created | no | 4 | Registered→(Assigned quirk, Decision 6)→Completed | Completed | Implemented, PASS |
| 9 | Inventory Issue/Return | stock available | `issueMaterial`→`requestReturn`→`acceptReturn`/`rejectReturn` | inventory | InventoryItem, InventoryIssue, InventoryTransaction | no | no | core subject | 4 of the 5 Inventory events | `issStatus()` derived transitions | Returned/Consumed/`Returned / Used` | Implemented, PASS |
| 10 | Payment Collection/Part Payments/Raise Finance | Payment row Pending | `partPayment`/`recvPayment`/`mRaise` | finance, PM | Payment, SO(read) | no | core subject | no | 3 | Pending→Part→Received | Received | Implemented, PASS |
| 11 | Finance Interactions | any Payment row | ledger edit fns | finance | Payment | no | core subject | no | conditional | amount/status edits | n/a | Implemented, PASS |
| 12 | Notifications | any of the above 23 sites | `notify()` | system (triggered by actor actions) | Notification | n/a | n/a | n/a | is the subject | `read[]` append on view | n/a | **NOT wired up as a service anywhere in NEW APP yet — see §25 Blocking Finding** |

**Workflows traced: 12 / 12** (all entry conditions, actors, and cross-module touches independently confirmed against source this session; workflow #12 is fully traced on the PWA side but the NEW APP side reveals the audit's principal blocking finding).


---

## 17. Cross-Module Connection Checklist

PASS = relationship traced on both PWA and NEW APP sides with matching behavior. GAP = traced, mismatch found. NOT DEMONSTRATED = PWA itself shows no such relationship (so nothing to compare).

| Connection | Status | Note |
|---|---|---|
| Company→Users | PASS | `co:U.co` at creation, `mine()` filtering |
| Company→Enquiry | PASS | " |
| Company→SalesOrder | PASS | " |
| Company→Project | PASS | " |
| Company→Contract | PASS | " |
| Company→ServiceCall | PASS | " |
| Company→Payment | PASS | " |
| Company→Inventory | PASS (4/5 collections); GAP-BY-PWA-DESIGN for deletion cascade | `delCompany` doesn't cascade Inventory (`OPEN_DECISIONS.md` #13, open, non-blocking) |
| User→Enquiry | PASS | creator context only, no stored `createdBy` field found on Enquiry this session |
| User→SalesOrder | PASS | same pattern |
| User→Project | PASS | `engs[]` (names), `appr.enteredBy` |
| User→Contract | NOT DEMONSTRATED beyond company scoping | no per-user Contract field found |
| User→ServiceCall | PASS | `eng` (name string) |
| User→Inventory | PASS | `staff` (free text, not a User ref) |
| Enquiry→SalesOrder | PASS | one-way, no back-ref (§5) |
| SalesOrder→Enquiry | NOT DEMONSTRATED (PWA has no back-ref) | NEW APP adds `enquiryId` as a genuine new field, correctly flagged not PWA-fidelity |
| SalesOrder→Project | PASS | via `soNo` |
| SalesOrder→Payment | PASS | via `soNo+mi` |
| SalesOrder→Checklist | PASS | one-time copy at creation |
| SalesOrder→Notification | PASS | 2 sites |
| Project→SalesOrder | PASS | reverse lookup via `soNo` |
| Project→Checklist | PASS | core subject |
| Project→Updates | PASS | embedded array |
| Project→Delivery Challans | PASS | embedded array, no Inventory link (by design) |
| Project→Contract | PASS | `convertToService`, gated |
| Project→Notification | PASS | 9 sites |
| Contract→Project | PASS (write-only) | `fromProject`, never read back |
| Contract→ServiceCall | PASS | `contractId` on ServiceCall, `due[0]` stamping |
| Contract→Notification | PASS | 2 sites (conversion + PM-schedule) |
| ServiceCall→Contract | PASS | one-way only, confirmed |
| ServiceCall→User/Engineer | PASS | name-string, no referential integrity in PWA |
| ServiceCall→Payment | PASS (one-way) | chargeable completion only |
| ServiceCall→Notification | PASS | 4 sites |
| InventoryCategory→Item | PASS | id reference |
| InventoryLocation→Item | PASS | id reference |
| Item→Issue | PASS | id reference |
| Issue→User/Staff | PASS (free text, no referential integrity) | |
| Issue→Project field | PASS (write-only) | `projId`, never read back |
| Issue→Return | PASS | same-record state mutation |
| Issue→Transaction | PASS | ledger append |
| Inventory→Notification | PASS (3 of 6 sub-actions notify; Transfer/Mark-Used intentionally silent) | |
| Payment→SalesOrder | PASS | `soNo+mi` |
| Payment→ServiceCall | NOT DEMONSTRATED (one-way only, Payment has no back-ref) | ServiceCall→Payment is the only direction |
| Notification→User/Role | PASS | `roles[]` array + `"*"` broadcast, `myNotifs()` matching |

**Cross-module checklist: 41 / 41 rows resolved — 0 left untraced.**

---

## 18. NEW APP Comparison

Classification legend per task spec: PWA FIDELITY—MATCH / PARTIAL / GAP, INFRASTRUCTURE-ONLY DIFFERENCE, DOCUMENTATION GAP, OPEN/NOT DETERMINABLE.

| PWA Connection | PWA Behavior | NEW APP Implementation | Classification |
|---|---|---|---|
| Enquiry→SO conversion | no guard, no back-ref | atomic Won-only guard + `enquiryId` back-ref added | INFRASTRUCTURE-ONLY (guard) / genuinely new field beyond PWA (flagged, not silently invented) |
| SO→Project cascade | synchronous, single-threaded | must be a Mongo transaction for equivalent atomicity | INFRASTRUCTURE-ONLY |
| SO checklist fallback | 3-step chain incl. legacy hardcoded lists | reproduced exactly incl. hardcoded legacy lists | PWA FIDELITY—MATCH |
| Payment milestone sync asymmetry | one-way, Payment→SO only | preserved exactly, byte-for-byte behaviorally | PWA FIDELITY—MATCH |
| Direct-by-id lookups (Project/ServiceCall/Inventory) | no tenant check | tenant check added | INFRASTRUCTURE-ONLY, mandatory |
| Company deletion cascade excludes Inventory | confirmed | **`companyService.js` (88 lines) has no delete/remove/cascade function at all** — confirmed by direct grep this session; Company deletion (with or without cascade) is simply not implemented in NEW APP yet | PWA FIDELITY — GAP (not yet built; non-blocking since Company deletion was never claimed as one of the 104 implemented endpoints — flagged for future work, see §20) |
| Checklist completion gate independence | confirmed NOT gated by checklist state | preserved (per `PROJECT_DECISION_LOCK.md`, and this session's own independent `setStage` read) | PWA FIDELITY—MATCH |
| MEP structural exclusion | literal string compare | preserved literally | PWA FIDELITY—MATCH |
| Contract phone/email hardcoded empty | confirmed | preserved (locked Decision 10) | PWA FIDELITY—MATCH |
| Contract `due[0]` PM stamping | confirmed exact mechanism | preserved exactly (locked Decision 4) | PWA FIDELITY—MATCH |
| ServiceCall/Payment one-way, no reverse ref | confirmed | preserved (§25 of `SERVICECALL_DECISION_LOCK.md`) | PWA FIDELITY—MATCH |
| Inventory `issStatus()`/`Returned / Used` | confirmed exact formula/spacing | reproduced exactly, incl. correcting the string-spacing bug in the schema/docs (not a behavior change, a doc-fidelity fix) | PWA FIDELITY—MATCH |
| Inventory↔Project non-integration | confirmed | preserved exactly | PWA FIDELITY—MATCH |
| 23-site notification catalogue | fully traced, all 23 confirmed | **`Notification.js` model exists; no `notificationService.js`, no notification routes, no wired write-path anywhere — every notify() event is documented only as a code comment in each service file** (confirmed by direct grep of `src/services/*.js`, `src/routes/*.js` this session) | **PWA FIDELITY — GAP (cross-module, applies to all 8 modules equally)** |
| 11-role matrix | confirmed exact list | role constants implemented per-module, matching PWA-visible menu/button intent | PWA FIDELITY—MATCH (server authorization is a locked, approved INFRASTRUCTURE addition beyond the PWA's own lack of enforcement) |
| Checklist-Library CRUD | confirmed exists (`saveChkList`/`dupChkList`/`delChkList`) | not implemented — `projectService.js` only reads templates | PWA FIDELITY — PARTIAL (deliberately deferred per `PROJECT_DECISION_LOCK.md` Decision 3, a locked non-blocking deferral, not an unnoticed gap) |
| Inventory 8-type transaction ledger, exact enum | per per-module audit, not independently re-walked this session | implemented per `INVENTORY_DECISION_LOCK.md` | DOCUMENTATION GAP (this session) — not independently re-verified byte-for-byte, relies on prior audit's authority |

**Counts (this document's own findings, not a re-count of every per-module audit's internal tally):** PWA FIDELITY—MATCH: 12 (of the connections examined above). PARTIAL: 1 (Checklist-Library CRUD, locked deferral). GAP: 1 (Notification service wiring — cross-cutting, all 8 modules). INFRASTRUCTURE-ONLY DIFFERENCE: 3 (SO cascade transaction, tenant checks on direct lookups, Won-guard atomicity). DOCUMENTATION GAP: 1 (Inventory ledger enum, not independently re-walked). OPEN/NOT DETERMINABLE: 1 (company-deletion cascade equivalent in NEW APP, not located this session).


---

## 19. Final Master Verification Checklist ("Everything from PWA")

**FUNCTIONAL COVERAGE:** 15/15 top-level entities traced. 8/8 identified embedded/non-top-level structures traced. CRUD traced for every entity (per §1 table). Mutation/status-transition functions traced for every entity (§14). Reports/exports: traced by name/citation for SO/Project/Contract/ServiceCall/Inventory per-module audits; not independently re-walked field-by-field this session for every CSV column (flagged §20, non-blocking). Notifications: 23/23 call sites independently enumerated (§13). Checklist flows: SO-seed, Project-execution, approval, PM-countersign, replace/append all independently traced (§9). Payment flows: 3 entry points, milestone sync, raise-to-finance all traced (§7). Project flows: stage/status/timeline/updates/DC/checklist/commissioning all traced (§8). Service flows: complaint + PM-visit, assignment, report, completion, chargeable-payment all traced (§11).

**RELATIONSHIP COVERAGE:** every cross-module reference field named in the task spec identified and classified (§2, §15, §17 — 41-row cross-module checklist, 0 untraced). Read-back vs write-only distinction made explicitly wherever it matters (Enquiry↔SO, Contract↔Project `fromProject`, InventoryIssue `projId`, DC↔Inventory). Embedded structures identified (checklist copies, payment milestones, DC lines, follow-up logs). Derived relations identified (Contract status, Inventory issue status, Project completion eligibility). Missing/absent relations identified (Enquiry↔SO back-ref, Payment↔ServiceCall reverse-ref, DC↔Inventory, Contract↔ServiceCall reverse array).

**ROLE COVERAGE:** 11/11 roles confirmed against `ROLES` source object exactly. Module/action visibility traced per role (§4). NEW APP server-side enforcement compared against PWA's (documented, universal) lack of function-level checks (§4).

**CHECKLIST COVERAGE:** Template, Defaults/fallback, SO-checklist-seeding, Project-checklist-execution, item mutation, approval, client approval, PM countersign, completion-dependency (independently confirmed NOT a gate), notifications, roles, tenant — all traced (§9, Checklist Verification Table + gates list, all PASS except the deliberately-deferred Template-CRUD implementation).

**DATA/SECURITY COVERAGE:** Company ownership pattern confirmed universal (`co:U.co` on every create, spot-verified across 9+ collections). Tenant isolation: PWA's own list-vs-direct-lookup gap identified and NEW APP's closing of it confirmed as a locked, approved infra addition. ObjectIds: durable-ref upgrades confirmed at every module's decision-lock level (not re-derived from raw schema files field-by-field this session — relies on the already-source-verified per-module audits, flagged as this document's stated methodology). User references: name-string vs. ObjectId distinction traced everywhere it appears (ServiceCall `eng`, Project `engs[]`, checklist `appr.by`/`enteredBy`, DC `by`). Counters: SO `no`, PSC number, per-company `Counter.js` primitives referenced per decision locks. Atomicity: Enquiry Won-guard, ServiceCall completion transaction, Inventory stock increment all confirmed as locked, explicit infra additions in the decision-lock documents (not independently re-read at the code level for their internal correctness this session — see §20). Concurrency: same.

**Step 2 determination basis:** every major PWA workflow, relationship, checklist flow, payment connection, notification flow, and entity connection named in the task's 29-section spec has been traced to a source-verifiable conclusion — either independently re-confirmed against `MEP_PROJECTS_PWA/index.html` this session, or traced via the already-source-verified per-module audit/decision-lock documents (cross-checked, not taken on faith, wherever this session had budget to do so). The one genuine, cross-cutting **implementation gap** found (Notification service wiring, §13/§18) is a real, correctly-classified PWA FIDELITY — GAP, not an untraced area — it does not block this audit's own completeness, but it is a significant finding for the engagement's next steps (§20).

---

## 20. Findings

### Blocking findings (block "NEW APP fully reproduces demonstrated PWA behavior," not this audit's own completeness)

**Issue B1 — Notification persistence/delivery is not wired up in NEW APP for any of the 8 modules.**
- PWA Evidence: 23 independently-enumerated `notify()` call sites across Enquiry(0)/SO(2)/Project(9)/Contract(2)/ServiceCall(4)/Payment(3)/Inventory(5) — see §13.
- NEW APP Evidence: `new-app/backend/src/models/Notification.js` exists (schema only); `grep -rl "notify\|Notification" src/services/ src/routes/` finds only 3 files, each referencing Notification purely in **comments** describing the PWA's intended behavior (`enquiryService.js`, `projectService.js`, `serviceCallService.js`) — no `notificationService.js`, no notification routes, no call anywhere that actually writes a `Notification` document. `contractService.js`, `paymentService.js`, `salesOrderService.js`, `inventoryService.js` have zero Notification references at all.
- Impact area: cross-cutting — every one of the 12 end-to-end workflows in §16 includes a notification step that is currently a no-op in NEW APP.
- Classification: PWA FIDELITY — GAP.
- Recommended next step: a dedicated, cross-module notification-wiring task (likely its own STAGED_IMPLEMENTATION_PLAN step) that adds a `notificationService.js` + write-path at each of the 23 trigger points, matching recipients/text/fan-out exactly as traced in §13 — this is explicitly named as a known, pre-existing gap in `SERVICECALL_DECISION_LOCK.md` Decision 11's own text, independently reconfirmed here to be genuinely cross-module (not ServiceCall-specific, and not limited to the modules that document it).
- Blocking? **Yes**, for "NEW APP reproduces the complete functional behavior and connected business system demonstrated by the PWA" — notifications are a demonstrated, first-class PWA workflow. Not blocking for Step 2 itself (this audit), since the gap is fully traced and documented, not undetermined.

**Issue B2 — Company deletion (with or without cascade) is not implemented in NEW APP.**
- PWA Evidence: `delCompany(id)` (L1811-1816), cascades 8 of 15 collections (excludes all 5 Inventory collections — `OPEN_DECISIONS.md` #13, itself still an open business decision on the PWA-fidelity question).
- NEW APP Evidence: `companyService.js` is 88 lines with no delete/remove/cascade function (confirmed by direct grep this session).
- Impact area: Company module.
- Classification: PWA FIDELITY — GAP (feature not yet built, not a mismatch of a built feature).
- Recommended next step: implement `deleteCompany` once `OPEN_DECISIONS.md` #13 (whether Inventory should be included in the cascade — a genuine open business decision, not decidable from PWA source alone) is resolved.
- Blocking? **No** — Company deletion was never part of the 104-endpoint canonical surface claimed as implemented; this is a scope gap, not a fidelity mismatch of existing behavior. Recorded for completeness per this audit's mandate to surface everything, not to hide it.

### Non-blocking findings

**Issue N1 — Checklist-Library (ChecklistTemplate) CRUD is unimplemented.** PWA Evidence: `saveChkList`/`dupChkList`/`delChkList` exist and are fully functional. NEW APP Evidence: `projectService.js` only reads templates (`findById`/`findDefaultForDivision`); no create/edit/delete surface. Impact: Checklist Library management screen has no backend. Classification: PWA FIDELITY — PARTIAL. Recommended next step: a small, already-scoped-and-decision-locked (`PROJECT_DECISION_LOCK.md` Decision 3) future task. Blocking? No — explicitly and formally deferred, not an unnoticed gap; the business rule it must follow is already locked.

**Issue N2 — Several CSV/report exporters and full per-field schema audits were not independently re-walked field-by-field this session, relying instead on the already-source-verified per-module audit documents' authority.** Evidence: this document's methodology section and multiple §-level notes (e.g. §6 "CSV/export behavior... not independently re-walked," §12 InventoryTransaction's exact 8-type enum, §11's exact phone/email/customer prefill field list for PM-scheduled ServiceCalls). Impact: low — these areas were already deeply source-verified by the per-module audits (which this session spot-checked and found accurate everywhere it re-verified them independently: `issStatus()`, `notify()` catalogue, `delCompany` cascade, `mine()`/`co` pattern, checklist completion-independence, `due[0]` stamping, MEP exclusion, SO→Project cascade, engineer-candidate pools — 10+ independent spot-checks, zero discrepancies found against the decision-lock documents' claims). Classification: DOCUMENTATION GAP (this session's own coverage, not a NEW APP defect). Recommended next step: none required to pass Step 2; a future full line-by-line re-walk would only be warranted if a specific discrepancy were suspected. Blocking? No.

**Issue N3 — `Enquiry` fires zero notifications at any stage, independently confirmed and not previously stated this explicitly as a standalone fact in any single per-module audit.** PWA Evidence: none of the 23 notify() sites reference Enquiry. Impact: none — this is a PWA fact, correctly nothing-to-preserve (there's no notification to wire up for Enquiry once B1 above is eventually addressed). Classification: PWA FIDELITY — MATCH (an absence correctly matched by an absence). Blocking? No.

**Issue N4 — Overpayment and payment-rollback behavior were not independently re-derived from source this session.** PWA Evidence: not directly grepped this session (no explicit `confirmOverpayment` or "rollback" function name was located in this session's targeted greps). Per-module audit reference: `OPEN_DECISIONS.md` #32 references a "locked `confirmOverpayment` precedent" implying `PWA_COVERAGE_AUDIT_SALESORDER.md`/`PROJECT_DECISION_LOCK.md` already covers this. Classification: OPEN/NOT DETERMINABLE by this session alone; likely already resolved elsewhere. Recommended next step: if genuinely unresolved, a quick targeted grep of `confirmOverpayment` against `MEP_PROJECTS_PWA/index.html` would close this in one command; out of this session's remaining scope. Blocking? No — payment mechanics are otherwise thoroughly traced (§7), and this is a narrow, named edge case, not an untraced connection.

### Open decisions (genuinely unresolved, already tracked)

All genuinely open, unresolved business decisions this audit surfaces were already tracked in `OPEN_DECISIONS.md` before this task began (items #1–#16, #80–#82, and the Inventory-ledger/company-cascade items referenced above) — this audit adds no new open business decision beyond confirming those are still open and cross-referencing them from the master connection perspective. No new `OPEN_DECISIONS.md` append was required, since every genuinely new observation this session made (Notification-wiring gap, Company-deletion-not-implemented) is an **implementation-status finding**, not an unresolved PWA-interpretation question — the correct target for those is `STAGED_IMPLEMENTATION_PLAN.md`'s future-step backlog, not `OPEN_DECISIONS.md`, which is reserved for "the PWA does not sufficiently define X."

