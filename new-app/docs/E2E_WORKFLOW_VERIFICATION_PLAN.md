# E2E Workflow Verification Plan — STEP 3

**Purpose:** this document freezes the exact pass sequence, evidence standard, and templates that all future STEP 3 (`End-to-End Workflow Verification`) passes (3.0–3.8) must follow. It is a control document, not a findings document — it establishes HOW passes 3.1–3.8 will be run and evidenced; it does NOT itself execute any workflow verification.

**Produced:** 2026-09-23, as a documentation/control-only setup task. No PWA workflow behavior was traced in depth beyond what was needed to build the source indexes below and confirm known anchors exist.

**Governs:** all future `E2E_PASS_3_*.md` reports. Per `DOCUMENT_AUTHORITY.md`, this document controls STEP 3 pass sequencing; `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` remains the master PWA workflow/connection reference; actual PWA source (`MEP_PROJECTS_PWA/index.html`) remains the functional authority; actual NEW APP source (`new-app/backend/src/`) remains the implementation authority.

---

## 0. Source-of-Truth Rule (locked, applies to every pass)

Authority hierarchy, strictly in this order:

1. **MEP Projects PWA source** (`MEP_PROJECTS_PWA/index.html`, byte-identical to root `index.html`, md5 `111b53dba91704f96b83dae96c7793c6`) — the functional/business source of truth.
2. **PWA audit/decision-lock documents** (`PWA_COVERAGE_AUDIT_*.md`, `*_DECISION_LOCK.md`, `OPEN_DECISIONS.md`, `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`) — locked interpretations of that source.
3. **NEW APP implementation** (`new-app/backend/src/`) — must reproduce (2)'s behavior, except where a difference is explicitly locked as infrastructure-only.
4. **NEW APP tests/API contract** (`new-app/backend/tests/`, `new-app/docs/API_CONTRACT.md`) — lowest authority; documents/tests current behavior, does not define correct behavior.

Do NOT use V3 design, V2 implementation, or NEW APP architecture as proof of PWA behavior — only the PWA source and its locked audits prove PWA behavior.

**Approved infrastructure-only differences** (do not require re-litigation in 3.1–3.8 unless a pass finds a *new* one): ObjectIds replacing numeric/array-index ids; bcrypt-hashed passwords replacing plaintext; explicit tenant (`co`) isolation enforcement server-side replacing client-trusted `co` filtering; explicit server-side authorization checks replacing UI-only role gating; DB-transaction / concurrency-safety additions; MongoDB collections replacing the PWA's in-memory `DB` object as durable storage. Everything else (business rules, field semantics, status machines, notification content/recipients, checklist/payment/inventory formulas, read-back behavior) requires explicit analysis and evidence — it is never assumed equivalent.

---

## 1. Mandatory Pass Gate (verbatim — every pass 3.0–3.8 must follow this sequence)

```
START PASS → READ PWA SOURCE → READ RELEVANT NEW APP SOURCE → TRACE WORKFLOW → RECORD SOURCE EVIDENCE → COMPARE → CLASSIFY FINDINGS → RUN REQUIRED TESTS → RUN SAFETY CHECK → PASS / BLOCKED
```

Never skip source tracing. Never declare a pass complete from tests alone. 287/287 (or whatever the current count is) passing tests alone do NOT make any pass, or STEP 3 as a whole, PASS.

---

## 2. Mandatory Source-Evidence Standard

Every substantive finding in every pass 3.0–3.8 must include source evidence. A vague statement such as "PWA sends a notification after project completion" is NOT sufficient — evidence must identify exactly where the behavior comes from. For every workflow behavior, record all of the following fields:

| Field | Requirement |
|---|---|
| Evidence ID | Unique per pass, e.g. `3.1-E07` |
| Workflow | Which of the 12 established workflows / which pass |
| Entity | The business entity/collection involved |
| PWA Source File | e.g. `MEP_PROJECTS_PWA/index.html` |
| PWA Function Name | Actual function name as it appears in source (verbatim — see §2.1) |
| PWA Line Range | e.g. `lines 2075–2140`, or a code anchor if lines are unstable |
| PWA Code/Logic Reference | The actual logic excerpt or precise description of it |
| Behavior Demonstrated | What this evidence proves |
| NEW APP Source File | e.g. `new-app/backend/src/services/salesOrderCascade.js` |
| NEW APP Function/Route | Actual function/route name |
| NEW APP Line Range | e.g. `lines 40–95` |
| NEW APP Behavior | What the NEW APP code actually does |
| Comparison | MATCH / PARTIAL MATCH / GAP / INCONSISTENCY |
| Classification | One value from the Finding Classification list (§4) |

### 2.1 PWA Source Evidence Requirement

For every PWA-derived finding: PWA source file + function/handler name + line range, OR (when line numbers are unstable across edits) a uniquely searchable code anchor.

Preferred format: `MEP_PROJECTS_PWA/index.html` / `functionName(...)` / `lines X–Y`.
Fallback format: `MEP_PROJECTS_PWA/index.html` / `functionName(...)` / `unique code anchor: "..."`.

Citing only "the PWA" / "Inventory code" / "the Project section" is NOT evidence and must be rejected in review.

**Correction carried forward from this setup task:** the master audit document (`PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`) uses several descriptive/paraphrased function names (e.g. "`setStage`", "`completeCall`", "`schedulePM`", "`registerComplaint`", "`assignEngineer`") that are NOT the literal PWA source identifiers. Future passes must cite the ACTUAL verbatim function name. Verified real names for these, confirmed this session by direct grep of `MEP_PROJECTS_PWA/index.html`:
- "`setStage`" → actually `savePM(id)` (line 2590) — project stage/status/engineer-assignment save handler.
- "`completeCall`" → actually the `complete` branch of `saveReport(id,complete)` (line 3689).
- "`schedulePM`" (PM-scheduled call) → actually the `saveCall(contractId)` (line 3606) path where `contractId` is truthy.
- "`registerComplaint`" → actually the `saveCall(contractId)` (line 3606) path where `contractId` is falsy/absent (same function, two branches).
- "`assignEngineer`" → actually `assignCall(id)` (line 3667).
- "`transferStock`" → actually `saveTransfer()` (line 3231).
- "`markUsed`" → actually `saveMarkUsed(id)` (line 3384, confirmed exact per §7.1's item-13 anchor list).

These corrections are informational (they do not change any PASS/blocking verdict from Step 2) and must be used going forward so that Evidence IDs cite real, greppable identifiers.

### 2.2 NEW APP Source Evidence Requirement

For every NEW APP implementation claim: NEW APP file + function/class/route name + line range. Examples:
- Route: file + `METHOD /path` + line range (e.g. `new-app/backend/src/routes/projectRoutes.js` / `POST /projects/:id/stage` / lines 40–58).
- Service: file + function name + line range (e.g. `new-app/backend/src/services/projectService.js` / `setStage(...)` / lines 210–260).
- Model: file + field name + line range (e.g. `new-app/backend/src/models/Project.js` / `chk` field / lines 30–45).
- Test: test file + test name + line range (e.g. `new-app/backend/tests/projectService.test.js` / `"blocks stage transition for wrong role"` / lines 120–140).

### 2.3 Evidence Quality Rules

Evidence must be:
- **DIRECT** — the cited code directly demonstrates the claimed behavior (not an inference from an adjacent function).
- **TRACEABLE** — another developer can locate the exact line/anchor from the citation alone.
- **SPECIFIC** — identifies the function/route/field, not just the module or file.
- **COMPLETE** — for cross-module behavior, evidence must show both sides where applicable. E.g. the claim "PWA writes `project.contractId`" is INCOMPLETE if the claim also asserts the PWA later reads it back — the read path must be separately located and cited (see §3, read-back verification). WRITE EVIDENCE and READ-BACK EVIDENCE must be distinguished as separate evidence entries when both are claimed.

---

## 3. Read-Back Verification (mandatory per relationship)

For every cross-entity relationship traced in passes 3.1–3.8, explicitly determine and record which of the following apply (more than one may apply):

- `PWA WRITE` — PWA writes the field/reference.
- `PWA READ` — PWA reads the field/reference back elsewhere.
- `PWA WRITE-BACK` — the reading function also mutates the field on the same or the referenced entity.
- `PWA NO READ-BACK` — PWA writes the field but no PWA function ever reads it back (write-only reference).
- `NEW APP WRITE` — NEW APP writes the corresponding field/reference.
- `NEW APP READ` — NEW APP reads it back.

Do not call a field a "relationship" simply because it stores an ID — a stored ID with `PWA NO READ-BACK` is a write-only reference, not a live relationship, and must be labeled as such.

Especially important — must be explicitly determined for each of the following (already partially evidenced in `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §2/§17, to be re-confirmed and extended per-pass, not re-invented):
- Enquiry → SalesOrder
- SalesOrder → Project
- SalesOrder → Payment
- Project → Contract
- Contract → ServiceCall
- ServiceCall → Payment
- InventoryIssue → Project (known PWA fact: `projId` is write-only/functionally dead — confirmed in the master audit, §2 and §17; to be re-confirmed, not re-derived from scratch, in Pass 3.6)
- Notification → User/Role
- Checklist relationships (Template → SO checklist → Project checklist → Item)

---

## 4. Finding Classification (locked list — used by every pass 3.0–3.8)

```
MATCH
PARTIAL MATCH
PWA FUNCTIONAL GAP
PWA / NEW APP INCONSISTENCY
INFRASTRUCTURE-ONLY DIFFERENCE
DOCUMENTATION GAP
TEST COVERAGE GAP
SECURITY / TENANT GAP
AUTHORIZATION GAP
ATOMICITY / CONCURRENCY GAP
OPEN / NOT DETERMINABLE
```

No vague terms ("looks okay", "probably fine", "seems covered") are permitted in any pass report. Every finding must use exactly one of the above classifications.

---

## 5. No Implementation During STEP 3

If a gap is found during any future pass (3.0–3.8): **DO NOT fix it.** Record it as a Gap with:

```
Gap ID:
PWA Evidence:
NEW APP Evidence:
Impact:
Classification:
Blocking? (yes/no, and for which exit criteria)
Recommended Follow-up Stage:
```

The known Step 2 findings remain findings only, not to be fixed as a side effect of any STEP 3 pass:
- **B1 — Notification persistence/delivery is not wired up in NEW APP.** PWA Evidence: 23 independently-enumerated `notify()` call sites (Enquiry 0, SalesOrder 2, Project 9, Contract 2, ServiceCall 4, Payment 3, Inventory 5 — `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §13). NEW APP Evidence: `Notification.js` model exists; no `notificationService.js`, no notification routes, no wired write-path anywhere (confirmed by grep this session — still true, see §7.2 below). This remains an open, documented, blocking-for-full-fidelity gap. Pass 3.7 will independently re-confirm and formally re-trace it — it is NOT to be implemented in Pass 3.7 or any other STEP 3 pass.
- **B2 — Company deletion (with or without cascade) is not implemented in NEW APP.** PWA Evidence: `delCompany(id)` (line 1811, confirmed this session). NEW APP Evidence: `companyService.js` is 88 lines with no delete/remove/cascade function (confirmed this session, see §7.2 below). This remains a documented, non-blocking-for-STEP-3 (it is not one of the 12 workflows) but still-open finding; it is not to be implemented in any STEP 3 pass.

---

## 6. Pass Sequence (3.0 → 3.8)

### PASS 3.0 — Baseline / Evidence Preparation
**Purpose:** establish the exact source files, functions, routes, models, tests, and workflow references to be used during Passes 3.1–3.8. Does NOT verify workflow behavior yet — it builds the index other passes trace against.
**Deliverables:** PWA source inventory (§7.1), NEW APP source inventory (§7.2), workflow-to-source index (§8), evidence-record template (§9 / §2 table), known baseline counts (§10), safety baseline (§12).
**Gate:** PASS 3.0 = PASS is required before Pass 3.1 may begin.

### PASS 3.1 — Enquiry → SalesOrder → Payment
Verify: Enquiry → Follow-up/Won/Lost/Reopen → Conversion → SalesOrder → Payment milestones → Payment collection/finance → Notifications. Includes Enquiry, SalesOrder, Payment, Finance, and the notifications involved in this flow.

### PASS 3.2 — SalesOrder → Project
Verify: SalesOrder → Project → Project setup/execution. Includes project creation, copied/default fields, project status/stage, engineer/PM connections, embedded project structures, notifications.

### PASS 3.3 — Project → Checklist → Completion
Dedicated checklist-heavy pass — must NOT be merged into generic Project testing. Verify: Checklist Template → SalesOrder Checklist → Project Checklist → Checklist Item Execution → Approval/Sign-off → Completion Gate. Must trace template lifecycle, default template behavior, checklist creation, fallback behavior, item copying, item mutation, approval, client approver, PM countersign, engineer involvement, completion dependency (known finding: checklist approval does NOT gate Project completion in the PWA — `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §8/§16 row 4–5, to be re-confirmed not re-derived), notifications, roles, tenant ownership.

### PASS 3.4 — Project → Contract/Warranty → PM Service
Verify: Project → Completion/Eligibility → Contract/Warranty → PM Due → ServiceCall. Includes eligibility (`status==="Completed" && div!=="MEP"`), generated Contract defaults, cadence, due calculation, Contract status, PM scheduling, Contract due-slot interaction, notifications.

### PASS 3.5 — ServiceCall End-to-End
Verify separately: (a) Complaint flow — Complaint → ServiceCall → Assignment → Report → Signature → Completion. (b) PM flow — Contract → PM ServiceCall → Engineer → Report → Signature → Completion. (c) Chargeable service flow — ServiceCall → Chargeable completion → Payment → Notification. All PWA ServiceCall quirks (shared PSC- numbering, company-wide `notify(["*"],...)` assignment fan-out, one-way Payment↔ServiceCall reference) must be checked.

### PASS 3.6 — Inventory End-to-End
Verify: Category → Item → Location/Stock → Issue → Return/Return Request → Mark Used/Transfer → Transaction Ledger → Dashboard/Reports/My Material. Includes stock calculations, issue, return, partial return, damaged return, return request, accept/reject, mark-used, transfer, transaction ledger, staff material, notifications, Project `projId` (known write-only), tenant, authorization. Must preserve exact literal `Returned / Used` status string and exact PWA stock/status formulas (`issBal()`, `issStatus()`).

### PASS 3.7 — Notifications + Cross-Workflow Side Effects
Verify the PWA notification system independently across ALL workflows. Trace all 23 known PWA `notify()` call sites. Verify trigger, recipient, role/user, payload, company, duplicate behavior, workflow, side effects, NEW APP implementation status. Must specifically confirm the Step 2 finding B1 — NEW APP currently does not actually persist/deliver PWA notifications. Do NOT implement notifications in this pass.

### PASS 3.8 — Master End-to-End Reconciliation
After Passes 3.1–3.7 individually PASS, reconcile the complete PWA business graph:
`Company → Users/Roles → Enquiry → SalesOrder → {Payment/Finance, Checklist, Project → {Timeline/Updates, Checklist, Delivery Challans, Completion, Contract → ServiceCall → Payment}}`
and
`Inventory → {Category, Location, Item, Issue, Return, Return Request, Mark Used, Transfer, Transaction}`.
Confirm every connection demonstrated by the PWA has been accounted for.

---

## 7. Source Inventories (Pass 3.0 deliverable, built this session)

### 7.1 PWA source inventory
- `MEP_PROJECTS_PWA/index.html` (== root `index.html`, byte-identical, md5 `111b53dba91704f96b83dae96c7793c6`) — single-file PWA, 4113 lines, 941 occurrences of the word "function". All business logic lives in this one file; there is no separate PWA backend.
- Confirmed real (verbatim) function names for key anchors, this session, by direct grep:

| Concern | Real function | Location |
|---|---|---|
| Notification helper | `notify(roles,text)` | line 1267 |
| Contract due calc | `pmDue(c)` | line 1434 |
| Contract status calc | `contractStatus(c)` | line 1439 |
| Company delete | `delCompany(id)` | line 1811 |
| SalesOrder save (incl. Enquiry conversion + Project/Payment cascade) | `saveSO(id,enqId)` | line 2075 |
| Project stage/status/engineer save | `savePM(id)` | line 2590 |
| Checklist point PM countersign | `pmSign(id,i)` | line 2634 |
| Commissioning → Contract conversion | `convertToService(id)` | line 2732 |
| Inventory stock move | `moveStock(it,locId,delta)` | line 2897 |
| Inventory transaction log | `invLog(type,item,qty,from,to,ref,remark)` | line 2893 |
| Inventory issue balance | `issBal(x)` | line 2905 |
| Inventory issue status | `issStatus(x)` | line 2910 |
| Inventory issue save | `saveIssue()` | line 3119 |
| Inventory return save | `saveInvReturn(id)` | line 3168 |
| Inventory transfer save | `saveTransfer()` | line 3231 |
| Inventory mark-used menu | `mMarkUsed(id)` | line 3375 |
| Inventory mark-used save | `saveMarkUsed(id)` | line 3384 |
| ServiceCall register/PM-schedule (branches on `contractId`) | `saveCall(contractId)` | line 3606 |
| ServiceCall engineer assignment | `assignCall(id)` | line 3667 |
| ServiceCall report/completion (branches on `complete`) | `saveReport(id,complete)` | line 3689 |

All 7 anchors required by task item 13 (`moveStock`, `issBal`, `issStatus`, `invLog`, `saveIssue`, `saveInvReturn`, `saveMarkUsed`) are confirmed present and searchable at the line numbers above. Full behavioral tracing (including caller/reader chains) is explicitly deferred to Pass 3.6, per the setup task's scope limit — not performed here.

### 7.2 NEW APP source inventory
`new-app/backend/src/` (7,731 total lines across routes+services+models):

**Routes** (`src/routes/*.js`, 1,249 lines total): `authRoutes.js` (54), `companyRoutes.js` (36), `contractRoutes.js` (113), `enquiryRoutes.js` (165), `inventoryRoutes.js` (199), `paymentRoutes.js` (143), `projectRoutes.js` (302), `salesOrderRoutes.js` (110), `serviceCallRoutes.js` (127).

**Services** (`src/services/*.js`, 5,483 lines total): `companyService.js` (88), `contractService.js` (550), `enquiryService.js` (584), `inventoryService.js` (998), `paymentService.js` (525), `projectService.js` (1,329), `salesOrderCascade.js` (311), `salesOrderService.js` (321), `serviceCallService.js` (777).

**Models** (`src/models/*.js`): `AuthSession.js`, `ChecklistTemplate.js`, `Company.js`, `Contract.js`, `Counter.js`, `Enquiry.js`, `InventoryCategory.js`, `InventoryIssue.js`, `InventoryItem.js`, `InventoryLocation.js`, `InventoryTransaction.js`, `Notification.js`, `Payment.js`, `Project.js`, `SalesOrder.js`, `ServiceCall.js`, `User.js`, plus `models/index.js`, `models/shared/enums.js`, `models/shared/legacyChecklists.js`.

**Foundation:** `src/auth/*` (authService, passwordHasher, repositories.mongoose, roleDivision, tokenService), `src/middleware/*` (authMiddleware, roleMiddleware, tenantGuard), `src/repositories/businessRepositories.mongoose.js`, `src/db/*` (connection, counters), `src/config/env.js`, `src/errors.js`, `src/app.js`, `src/server.js`.

**Confirmed this session (re-check of B1/B2):** no `notificationService.js` and no notification routes exist under `src/services/` or `src/routes/` — B1 remains open. `companyService.js` is 88 lines with no delete/remove/cascade function — B2 remains open. Neither is to be fixed in STEP 3.

**Tests** (`new-app/backend/tests/`, own-code test files only — `node_modules/*/test` excluded from this count): `audit-corrections.test.js`, `contractService.test.js`, `domain-structures.test.js`, `enquiryConversion.test.js`, `enquiryFakes.js`, `enquiryService.test.js`, `inventoryService.test.js`, `models.test.js`, `paymentService.test.js`, `projectService.test.js`, `salesOrderService.test.js`, `serviceCallService.test.js`, `validation.test.js`, plus `tests/auth/*.test.js`. Run via `npm test` → `node --test tests/*.test.js tests/auth/*.test.js`.

---

## 8. Workflow-to-Source Index (Pass 3.0 deliverable)

This index maps each of the 12 established PWA workflows (per `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §16) to its primary PWA entry function and primary NEW APP module, as a starting point for the pass that owns it. It is a starting index, not a completed trace — each pass must still do its own full evidence trace per §2–§3 above.

| # | Workflow | Owning Pass | PWA entry (real name) | Primary NEW APP module(s) |
|---|---|---|---|---|
| 1 | Enquiry→SalesOrder | 3.1 | `saveSO(id,enqId)` (L2075) | `enquiryService.js`, `salesOrderCascade.js` |
| 2 | SalesOrder→Project+Payment+Checklist+Notification | 3.1 / 3.2 | `saveSO` (L2075) | `salesOrderCascade.js`, `projectService.js`, `paymentService.js` |
| 3 | Project Timeline/Updates/Checklist | 3.2 / 3.3 | `savePM(id)` (L2590) + checklist mutators | `projectService.js` |
| 4 | Checklist Approval | 3.3 | `appr` setter + `pmSign(id,i)` (L2634) | `projectService.js` |
| 5 | Project Completion | 3.2 / 3.3 | `savePM(id)` (L2590) | `projectService.js` |
| 6 | Commissioning→Contract/Service | 3.4 | `convertToService(id)` (L2732) | `contractService.js` |
| 7 | Contract→PM Visits | 3.4 | `saveCall(contractId)` (L3606, contractId truthy) | `serviceCallService.js`, `contractService.js` |
| 8 | Service Complaint Lifecycle | 3.5 | `saveCall(contractId)` (L3606, no contractId) → `assignCall(id)` (L3667) → `saveReport(id,complete)` (L3689) | `serviceCallService.js` |
| 9 | Inventory Issue/Return | 3.6 | `saveIssue()` (L3119) → `saveInvReturn(id)` (L3168) | `inventoryService.js` |
| 10 | Payment Collection/Part Payments/Raise Finance | 3.1 | `partPayment`/`recvPayment`/`mRaise` family | `paymentService.js` |
| 11 | Finance Interactions | 3.1 | Payment ledger edit functions | `paymentService.js` |
| 12 | Notifications | 3.7 | `notify(roles,text)` (L1267), 23 call sites | none — B1 gap, `Notification.js` model only |

---

## 9. Pass Result Template (verbatim — every future `E2E_PASS_3_*.md` must use this exact structure)

```
PASS:
STATUS:
DATE:
WORKFLOW:

PWA EVIDENCE:
- Source file:
- Function:
- Lines/code anchor:
- Behavior:

NEW APP EVIDENCE:
- Source file:
- Route/service/model:
- Lines:
- Behavior:

COMPARISON:
- Match:
- Difference:
- Infrastructure-only difference:

CHECKLIST:
[ ] PWA path traced
[ ] NEW APP path traced
[ ] Read path traced
[ ] Write path traced
[ ] Roles traced
[ ] Tenant traced
[ ] Notifications traced
[ ] Payment traced where applicable
[ ] Checklist traced where applicable
[ ] Failure path traced
[ ] Test evidence mapped

FINDINGS:
- ID:
- Classification:
- Evidence:
- Blocking:

TEST RESULT:

SAFETY RESULT:

EXIT STATUS:
PASS / BLOCKED
```

---

## 10. Known Baseline Counts (locked, to be re-verified not re-derived by later passes unless a discrepancy is suspected)

- 8 business modules implemented, 104 canonical endpoints (per `API_CONTRACT.md`).
- 287/287 tests passing at Step 2 close (re-verified this session — see §12 below for exact current result).
- 23/23 PWA `notify()` call sites independently enumerated in `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` §13 (Enquiry 0, SalesOrder 2, Project 9, Contract 2, ServiceCall 4, Payment 3, Inventory 5).
- 12/12 established PWA business workflows (§16 of the master audit, reproduced in §6/§8 above).
- 15/15 top-level PWA entities traced (master audit §19).
- V2 baseline drift: 37 files. V3 baseline drift: 0 files.
- Open blocking findings carried forward: B1 (notifications not persisted/delivered in NEW APP), B2 (company deletion not implemented in NEW APP). Neither is fixed by STEP 3; both are re-confirmed, not re-implemented, by Passes 3.7 and 3.0/3.8 respectively.

---

## 11. Pass Documentation File Names (names/purpose only — not created in this setup task; each is created when its pass actually executes)

| File | Purpose |
|---|---|
| `new-app/docs/E2E_PASS_3_1_ENQUIRY_SO_PAYMENT.md` | Pass 3.1 result report: Enquiry → SalesOrder → Payment |
| `new-app/docs/E2E_PASS_3_2_SO_PROJECT.md` | Pass 3.2 result report: SalesOrder → Project |
| `new-app/docs/E2E_PASS_3_3_CHECKLIST_COMPLETION.md` | Pass 3.3 result report: Project → Checklist → Completion |
| `new-app/docs/E2E_PASS_3_4_PROJECT_CONTRACT_PM.md` | Pass 3.4 result report: Project → Contract/Warranty → PM Service |
| `new-app/docs/E2E_PASS_3_5_SERVICECALL.md` | Pass 3.5 result report: ServiceCall end-to-end (complaint, PM, chargeable) |
| `new-app/docs/E2E_PASS_3_6_INVENTORY.md` | Pass 3.6 result report: Inventory end-to-end |
| `new-app/docs/E2E_PASS_3_7_NOTIFICATIONS.md` | Pass 3.7 result report: Notifications + cross-workflow side effects |
| `new-app/docs/E2E_PASS_3_8_MASTER_RECONCILIATION.md` | Pass 3.8 result report: master end-to-end reconciliation |

Note: there is no separate `E2E_PASS_3_0_*.md` file requirement stated by the task; Pass 3.0's deliverables (source inventories, workflow-to-source index, evidence template, baseline counts, safety baseline) are captured directly in this document (§7–§10, §12) and constitute Pass 3.0's evidence record. A future session may still choose to file a short `E2E_PASS_3_0_BASELINE.md` status report using the template in §9 when it formally opens Pass 3.0 execution; this document does not require it but does not forbid it either.

---

## 12. Safety Baseline (this session)

Commands run (from repo root `C:\Projects\MEP-Projects`, i.e. `$HOME/mnt/MEP-Projects` on this bridge):

```
git diff --name-status -- v2      -> 37 files (unchanged from established baseline)
git diff --name-status -- v3      -> 0 files (unchanged from established baseline)
git status --short                -> 95 entries (92 modified, 3 untracked) - pre-existing repo-wide working-tree state from prior sessions' committed-but-unstaged work; NOT caused by this task; includes MEP_PROJECTS_PWA/index.html and index.html showing as "M" in git status despite md5 matching the required hash exactly (see below) - this reflects a difference from the git HEAD commit that predates this task, not a content change made in it. This task made zero edits to any file.
md5sum index.html MEP_PROJECTS_PWA/index.html -> both 111b53dba91704f96b83dae96c7793c6 (required value, confirmed match)
git diff --cached --name-status   -> 0 (nothing staged)
```

Expected per task spec: V2 = existing 37-file drift (re-verified: 37, matches), V3 = 0 (re-verified: 0, matches), both PWA md5 = `111b53dba91704f96b83dae96c7793c6` (re-verified: matches), nothing staged (re-verified: 0 staged). All expectations met.

---

## 13. Pass Dependency Order (verbatim)

```
3.0 → 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8
```

A blocked pass blocks all later passes. Do not start 3.2 while 3.1 is BLOCKED. Do not parallelize passes — reason: traceability; each later pass may depend on verified relationships established by the previous pass.

---

## 14. STEP 3 Exit Criteria (verbatim)

STEP 3 can only be declared PASS when Passes 3.0 through 3.8 are ALL individually PASS, AND:
- All 12 PWA workflows are covered.
- All PWA connections are reconciled.
- All checklist behavior is traced.
- All known notification call sites are traced.
- Every substantive finding has source evidence (per §2 above).
- All write-only/read-back relationships are explicitly identified (per §3 above).
- All major PWA behavior gaps are documented (per §5 above).
- No major workflow remains untraced.

**287 passing tests alone do NOT make Step 3 PASS.** Tests are one input among many (per the Mandatory Pass Gate, §1) - a pass is not complete until source has been traced, evidence recorded, and findings classified.

---

## 15. This Setup Task's Own Status

This is a documentation/control-only setup task. It did not execute Pass 3.0 (or any later pass) - it produced the control artifacts (this document, plus the narrow updates to `STAGED_IMPLEMENTATION_PLAN.md` and `DOCUMENT_AUTHORITY.md`) that Pass 3.0 and all later passes will follow. No workflow verification, gap classification, or implementation work was performed. See the accompanying session report for exact test/safety results.

---

## ACCELERATION PROTOCOL (recorded — governs all future Step 3 passes)

Recorded per an explicit control-only instruction requesting execution-efficiency acceleration toward a compressed timeline, WITHOUT reducing PWA functional coverage. This section governs how future passes (3.2 onward) are executed. It does not itself perform, resume, or advance any pass.

**Governing principle — repeat at the top of every future accelerated task:**

> Faster execution does not mean reduced PWA coverage. Every function, workflow, connection, checklist, field, notification, report, role, status, edge case, and documented quirk demonstrated by the MEP Projects PWA remains in scope.

**What acceleration means here (and does not mean):**
- The 9-pass sequence (3.0 → 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8) is NOT reordered, merged, or reduced. Passes remain strictly sequential — a blocked pass still blocks all later passes.
- WITHIN a single pass, independent read-only evidence gathering (PWA function tracing, field write/read tracing, notification tracing, role-gate tracing, checklist tracing, status-transition tracing) may proceed in parallel before being unified into one evidence set and compared against NEW APP.
- Previously directly-verified evidence (from `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md`, `PWA_COVERAGE_AUDIT_*.md`, `*_DECISION_LOCK.md`, and completed pass reports such as `E2E_PASS_3_1_ENQUIRY_SO_PAYMENT.md`) may be reused by Evidence ID as a starting index rather than re-transcribed. It is NOT a substitute for source verification when a pass needs a fact that a prior document only summarized — in that case the actual PWA/NEW APP source is traced fresh, as Pass 3.1 did when it found `PWA_COVERAGE_AUDIT_SALESORDER.md` was stale.
- A cross-module connection already mapped globally (e.g. in the master audit) still gets re-verified as it actually participates in the current pass's execution path, but the current pass does not need to reconstruct every unrelated relationship of that same connection.
- Automation (scripted greps/searches for function definitions, `notify()` calls, CRUD handlers, status calculations, role gates, field mutations) is encouraged to accelerate discovery. It accelerates finding candidates; it never replaces citing traceable source evidence (file + function + line range/anchor) for the conclusion.
- Checklist behavior is never cut for speed — every checklist-heavy pass still traces template/default/fallback/creation/copy/items/execution/mutation/approval/actors/client sign-off/PM countersign/completion-dependency/notifications/roles/tenant/read-back in full. An unrelated checklist function found during a pass is explicitly deferred to its designated pass (e.g. Pass 3.3), not silently ignored.
- Test strategy: targeted tests may be used during in-progress evidence work; a full `npm test` run is still required at each completed pass. If a verified gap triggers a separate implementation task, that task runs targeted tests then a full regression before resuming the next pass. The 287-baseline is never lowered by weakening tests.
- Safety baseline (V2 = 37-file drift, V3 = 0, both PWA md5 = `111b53dba91704f96b83dae96c7793c6`, nothing staged, nothing committed) is non-negotiable under acceleration and is checked before and after every pass exactly as before.
- Known blockers (B1 — notifications not persisted/delivered; B2 — company deletion cascade not implemented; Checklist-Library CRUD partial) remain visible findings across every future pass until a SEPARATE, explicitly-issued implementation task addresses them. Verification passes do not fix them as a side effect, and do not stop being reported just because they're already known.
- Step 3 exit criteria are UNCHANGED by this protocol: all 12 workflows traced, all demonstrated PWA connections reconciled, all checklist flows traced, all known notification call sites traced, every substantive finding source-evidenced, all write-only/read-back relationships identified, all major gaps documented, no major workflow untraced. 287/287 tests passing is necessary but never sufficient on its own.

**Current position at time of recording:** Step 0 (baseline), Step 1 (API contract freeze), Step 2 (cross-module/master workflow audit — PASS), and the Step 3 pass framework (this document) are complete. **Pass 3.1 — Enquiry → SalesOrder → Payment/Finance has already been executed and returned PASS** (see `E2E_PASS_3_1_ENQUIRY_SO_PAYMENT.md`, 587 lines) prior to this protocol being recorded. This acceleration task did not start, resume, or re-run any pass — it is documentation-only. The next allowed step remains unchanged: **PASS 3.2 — SalesOrder → Project**, not yet started.
