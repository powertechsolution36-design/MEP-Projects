# NEW APP — Staged Implementation Plan

**Purpose:** the sequence for taking the already-implemented NEW APP backend to a production-ready, fully-verified state without uncontrolled changes. This is a documentation/verification-first plan grounded in the actual current repository state (module list, live test count, real open decisions, real preserved quirks) — not a generic software roadmap.

**Produced:** 2026-09-23, alongside `new-app/docs/API_CONTRACT.md` (this plan's Stage 1 output).

---

## STAGE 0 — BASELINE / FREEZE

**Current implemented modules (8 business areas + foundation), verified by direct source inspection:**

1. **Company/User/Auth foundation** — `src/routes/authRoutes.js`, `src/routes/companyRoutes.js`, `src/auth/*`, `src/middleware/*`. Login/logout/me, company+admin bootstrap.
2. **Enquiry** — `src/routes/enquiryRoutes.js`, `src/services/enquiryService.js`. Create/edit/follow-up/mark-Lost/reopen/convert-to-SalesOrder/search/reporting/CSV.
3. **SalesOrder** — `src/routes/salesOrderRoutes.js`, `src/services/salesOrderService.js`, `src/services/salesOrderCascade.js`. Standalone create/edit/read/list/report; shares its creation cascade with the Enquiry-conversion path.
4. **Payment/Finance** — `src/routes/paymentRoutes.js`, `src/services/paymentService.js`. Full ledger: part-payments, milestone edits, raise-to-finance, follow-ups, reports.
5. **Project Execution** — `src/routes/projectRoutes.js`, `src/services/projectService.js`. Stage/status transitions incl. completion gate, engineer assignment, timeline, checklist execution/approval, execution updates, delivery challans, reports. Created only via the SalesOrder cascade — no standalone create route.
6. **Contract (AMC/Warranty)** — `src/routes/contractRoutes.js`, `src/services/contractService.js`. Manual and Project-conversion creation, list/search/dashboard/report. No edit/delete (`CONTRACT_DECISION_LOCK.md` Decisions 2–3).
7. **ServiceCall (Complaint/PM)** — `src/routes/serviceCallRoutes.js`, `src/services/serviceCallService.js`. Registration, assignment, report draft/completion, Chargeable Payment creation, Contract PM-slot update, search/report. No edit/delete/cancel/reopen (`SERVICECALL_DECISION_LOCK.md` §21/§23).
8. **Inventory** — `src/routes/inventoryRoutes.js`, `src/services/inventoryService.js`. Category/Location/Item CRUD, Issue, Return request/accept/reject, Mark Used, Transfer, Adjustments, dashboard/reports. No edit/delete for InventoryTransaction (append-only).

**Current confirmed test baseline:** **287/287 passing, 0 failing**, verified by an actual live run of `node --test tests/*.test.js tests/auth/*.test.js` in `new-app/backend/` during this task (2026-09-23; 19 test files, 244 non-auth tests + 43 auth-subdirectory tests). This matches the count independently reported in `new-app/docs/OPEN_DECISIONS.md` item #84 ("full regression suite: 287/287 passing, up from the prior 237/237 baseline" — the ServiceCall→Inventory delta of 50 new Inventory tests).

**Current safety baseline** (re-verified before and after this task — see §Final Verification of this document's companion report):
- `git diff --name-status -- v2`: **37 files**, pre-existing drift, unrelated to `new-app/`.
- `git diff --name-status -- v3`: **0 files**.
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: both **`111b53dba91704f96b83dae96c7793c6`**.
- `git status --short`: pre-existing modified-file set (root/V2-era files, `server/`), none from this task.

**Current architectural boundaries:** `new-app/` is fully isolated from `v1`/`v2`/`v3`/both PWA copies. Nothing in `new-app/backend/src` imports from or writes to those trees; the Mongoose models, repositories and services are entirely new, PWA-behavior-derived code, not copies of `server/*`. This isolation is what makes the Stage-0 safety checks meaningful gates rather than formalities.

**PWA-as-functional-authority principle:** every business rule implemented in `new-app/backend/src` traces to an observed PWA behavior (`PWA_COVERAGE_AUDIT_*.md`), a formally locked decision derived from one (`*_DECISION_LOCK.md`), or an explicitly flagged NEW BACKEND DESIGN DECISION / infra-only security adaptation (never silently invented). This document does not relitigate that principle — it governs every later stage's "verification, not redesign" scope.

**Current genuinely unresolved decisions** (pulled from `new-app/docs/OPEN_DECISIONS.md`; items below carry no `[RESOLVED…]`/`[LOCKED…]`/`[STATUS UPDATE…]`/`[NOT APPLICABLE…]` tag, i.e. are still actually open):

| # | Decision | One-line status |
|---|---|---|
| 1 | Authentication/session mechanism (lifetime, refresh, multi-device, logout-everywhere) | Undecided — PWA has no server to observe. |
| 2 | Permission granularity beyond observed role/menu behavior | Undecided — no per-user override/custom role/field-level permission ever demonstrated. |
| 3 | Audit retention policy (general, cross-entity) | Undecided — governs #17 below. |
| 4 | Offline write synchronization | Explicitly out of scope for this engagement to date (READ CACHE ONLY). |
| 5 | Conflict resolution (concurrent multi-device writes) | Undecided — no PWA precedent exists. |
| 6 | Notification persistence/retention/archiving | Undecided. |
| 8 | Delivery Challan ↔ Inventory integration | Undecided — still open now that Inventory is implemented (DC remains an unlinked free-text log). |
| 9 | Full database indexing plan (beyond obvious tenant/lookup fields) | Deferred to a schema-phase task. |
| 10 | Reporting architecture (dedicated layer vs. equivalent on-demand exports) | Undecided. |
| 11 | External messaging automation (SMS/WhatsApp/email) | Undecided — current behavior is preview-text-only by design. |
| 12 | Username uniqueness scope (global vs. per-company) | Undecided — PWA itself is inconsistent. |
| 13 | Company deletion cascade completeness (Inventory collections never observed in PWA cascade) | Undecided. |
| 14 | Protected/non-deletable tenant concept | Undecided. |
| 15 | SO division change after Project creation (no re-derivation of stage list) | Undecided. |
| 17 | Enquiry edit history | HOLD FOR #3, not independently decided. |
| 80 | `InventoryCategory.name` uniqueness | Undecided. |
| 81 | `InventoryLocation.name` uniqueness | Undecided. |
| 82 | Admin's missing Stock-Transfer menu entry | UI/menu-presentation only; does not affect backend authorization (already locked). |

(Items #7, #16 were resolved/corrected by later items #49 and #78 respectively; all `[RESOLVED]`/`[LOCKED]`/`[STATUS UPDATE]`-tagged items #18–#79, #83–#84 are settled and are not repeated here — see `OPEN_DECISIONS.md` directly for their full text.)

**Current known PWA quirks intentionally preserved** (consolidated from all module decision-locks):

- **Enquiry:** reopen leaves `lostReason`/`lostDate` untouched (Decision A, #18); no edit-history on direct field edits (#17, hold).
- **SalesOrder:** SO division can be changed post-Project-creation with no re-derivation of the project's stage list/checklist (#15, still open — not yet blocked or handled).
- **Project:** `vProject`-equivalent detail read has **no division restriction** (Decision 1); engineer-assignment candidate pool is **company-wide, not division-filtered** (Decision 2); MEP is excluded from the completion gate because its stage list ends at `Delivered` (Decision 4); un-completing a project (`stage` edited away from `Completed`) is allowed, not blocked (Decision 5); checklist "Replace" has no `confirm()`-equivalent guard server-side (Decision 6); checklist photos are append-only, no size/retention cap (Decision 8, same precedent as `confirmOverpayment`); `timelineSet` is a one-way flag (Decision 12).
- **Contract:** no edit/delete route exists at all (Decisions 2–3); PM-completion stamping preserves the PWA's own bug-for-bug mechanism (Decision 4); a Monthly 12-visit AMC still only displays/exports 4 visits (Decision 5); manual-creation notification asymmetry preserved (Decision 7); an unset `end` date reads as immediately `Expired` (Decision 8); Contract→ServiceCall relationship is one-way only (Decision 12); no display/reference number exists (Decision 13); `fromProject` is write-only, no reverse-lookup UI concept (Decision 14); AMC vs. Warranty is a label-only distinction with zero behavioral difference (Decision 15).
- **ServiceCall:** the PWA's own cross-tenant `vCall()` read gap was closed (infra-only — see Stage 4), not preserved; engineer-candidate pool (`service_eng`/`engineer`/`service_mgr`) has no division filter (Decision 5); PM calls never visually transition to "Assigned" in the PWA's own state model (Decision 6); the sole completion guard is client signature presence (Decision, `MISSING_SIGNATURE`); the `"PSC-"` vs `"PSC "` message-template spacing inconsistency across the four canned messages is preserved verbatim (Decision 12); no edit/delete/cancel/reopen route exists for any role.
- **Inventory:** the PWA's own `itemById()`/direct-lookup tenant gap was closed (infra-only — see Stage 4), not preserved; Category/Location creation has no name-uniqueness enforcement (#80/#81, open); Item deletion is hard and unguarded, matching `delItem()` exactly (no archive/soft-delete); `InventoryTransaction` is append-only, no edit/delete ever; the `"Returned"` status derivation bug was corrected (a PWA-fact correction, #78, not a preserved quirk) as was the `"Returned / Used"` string spacing (#79); no Transfer/Mark-Used notifications exist (matches PWA); Admin has full `canStock()` authorization but the PWA's own menu never exposed a Transfer entry to Admin (UI-only gap, #82, not a backend concern).

**Gate:**

```
INPUT: git history, the full new-app/backend/src tree, new-app/docs/* (all audits + decision locks + OPEN_DECISIONS.md), a live test run.
IMPLEMENTATION/VERIFICATION SCOPE: verification-only — enumerate implemented modules, run the regression suite, run the safety checks, extract the open-decisions and preserved-quirks lists from source documents. No code written.
EXPECTED OUTPUT: this Stage 0 section (module list, 287/287 confirmed baseline, safety-check values, open-decisions table, preserved-quirks list) plus this plan document and API_CONTRACT.md as Stage 1's artifact.
TEST REQUIREMENT: full regression suite run and green (287/287) before any further stage's work is considered to build on a valid baseline.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 both copies = 111b53dba91704f96b83dae96c7793c6 (unchanged), git status shows no new staged/committed files beyond the two new-app/docs/*.md deliverables.
```

No work on any later stage starts until this baseline is verified — it was, in this task, by direct inspection and a live test run (see Deliverable report).

---

## STAGE 1 — API CONTRACT FREEZE

```
INPUT: src/app.js (route mounting), all src/routes/*.js, all src/services/*.js, src/middleware/*, src/auth/*, src/repositories/businessRepositories.mongoose.js, src/models/*, src/errors.js, and the module decision-lock docs for cross-reference.
IMPLEMENTATION/VERIFICATION SCOPE: documentation only. Every mounted route is read directly from source (not inferred from prior audits) and its method, path, auth requirement, role gate, tenant-scoping behavior, request/response shape, and error taxonomy is recorded. No route, service, model, or test file is modified.
EXPECTED OUTPUT: new-app/docs/API_CONTRACT.md (this task's Deliverable 1) — the frozen, implementation-grounded contract for all 8 business modules plus Auth/Company.
TEST REQUIREMENT: the contract document's every route entry must be traceable to an actual grep/read of the route file and its backing service function (done in this task); ambiguous request shapes are flagged explicitly in the document rather than guessed. Full regression suite stays green (287/287, unchanged — no code touched).
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 both copies unchanged, nothing staged/committed, only new-app/docs/API_CONTRACT.md (and this plan) created.
```

Once this stage's document exists, the API surface is considered **frozen** for the purposes of Stage 2 onward: later stages verify against it, they do not casually revise it. A genuine contract change (e.g. resolving an open decision that changes a route's shape) must update `API_CONTRACT.md` explicitly as part of whatever future task makes that change — not silently drift.

---

## STAGE 2 — CROSS-MODULE CONTRACT VERIFICATION

```
INPUT: API_CONTRACT.md (Stage 1 output), src/services/salesOrderCascade.js (the Enquiry→SalesOrder→Project(→Payment) shared cascade), src/services/contractService.js's completePmVisitForContract, src/services/serviceCallService.js's use of it and of paymentRepo, src/repositories/businessRepositories.mongoose.js (every cross-module foreign-key field and its ObjectId type), DATABASE_SCHEMA.md, DOMAIN_MODEL.md.
IMPLEMENTATION/VERIFICATION SCOPE: verification/documentation only. Trace every cross-module reference actually used by the implemented system:
  - Company/User/Auth → Enquiry → SalesOrder → Project → Contract → ServiceCall: confirm every foreign key (companyId, enquiryId, salesOrderId, projectId, contractId, engineerId/userId references) is a real ObjectId reference consistently typed and consistently company-scoped at every hop, not a denormalized string copy that could drift.
  - SalesOrder → Payment/Finance: confirm milestone raise (§5 of API_CONTRACT.md) and payment creation reference the correct SalesOrder/company pair and that syncPayStatus recomputation is consistent with the SalesOrder's own milestone data.
  - Inventory: confirm Issue/Return/Transfer/Adjustment all resolve item/location/staff strictly within the acting company (no cross-tenant leakage through a foreign-key ID), and that the atomic incrementStockAtLocation primitive is used uniformly rather than a mix of atomic and non-atomic stock mutation paths.
  - Confirm transaction/session propagation is consistent: every cascade that writes across >1 collection uses deps.withTransaction and threads the same session through every repository call inside it (spot-check each module's identified withTransaction block against this rule).
  - Confirm error-contract consistency: the same conceptual failure (not-found, cross-tenant, forbidden-role, business-state guard) uses the same ServiceError code/status across modules, per the taxonomy table in API_CONTRACT.md §0.
IMPLEMENTATION/VERIFICATION SCOPE (continued): no redesign — where an inconsistency is found, it is documented as a finding for a future task to resolve, not fixed in this stage.
EXPECTED OUTPUT: a cross-module contract verification checklist/report (e.g. new-app/docs/CROSS_MODULE_VERIFICATION.md) listing each traced interaction, its consistency verdict, and any flagged inconsistency.
TEST REQUIREMENT: full regression suite stays green (287/287) throughout — this stage reads and documents, it does not run new tests beyond the existing suite. Every cross-module reference in API_CONTRACT.md's module sections must be accounted for in the verification checklist (no interaction silently skipped).
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing staged/committed beyond the new verification document.
```

---

## STAGE 3 — END-TO-END WORKFLOW VERIFICATION

```
INPUT: API_CONTRACT.md, the Stage 2 cross-module verification document, the 12 established PWA workflows, tests/*.test.js (to check which workflows already have integration-style coverage vs. only unit-level service coverage).
IMPLEMENTATION/VERIFICATION SCOPE: verification/documentation only. For each of the 12 workflows — (1) Enquiry→SO conversion; (2) SO→Project/Payment/Checklist/Notifications fan-out at creation; (3) Project timeline/checklist progression; (4) Checklist approval (sign-responsibility-gated); (5) Project completion (incl. the MEP exclusion); (6) Commissioning→Contract/ServiceCall conversion; (7) Contract→PM visits (scheduled-visit generation + due-index computation); (8) Service complaint lifecycle (register→assign→report→complete); (9) Inventory issue/return lifecycle; (10) Payment collection/part-payments/raise-to-finance; (11) Finance interactions (ledger sync, deletion guard); (12) Notifications (all fan-out events across every module) — document: entry endpoint, every dependent endpoint it triggers or requires, every database write (which collections, which fields), every notification fan-out (targetRoles), authorization at each step, the expected terminal state, atomicity requirements (which parts must be one transaction vs. may be separate calls), and failure behavior (what happens on a partial failure, and whether it can leave inconsistent state).
IMPLEMENTATION/VERIFICATION SCOPE (continued): no workflow may be declared complete merely because its individual endpoint-level unit tests pass — the trace must follow the actual call chain through the service layer (e.g. Enquiry convert → salesOrderCascade → Project creation → optional Payment creation, all inside one withTransaction) and confirm the chain matches what API_CONTRACT.md documents.
EXPECTED OUTPUT: a workflow verification document (e.g. new-app/docs/WORKFLOW_VERIFICATION.md) with one section per workflow, each ending in an explicit "gap found" or "no gap found" verdict.
TEST REQUIREMENT: each of the 12 workflows traced end-to-end with no undocumented gap; full regression suite stays green (287/287). Where an existing test does NOT actually exercise the full chain (e.g. only unit-tests one service function with mocked deps), that is noted as a Stage 6 test-coverage gap, not silently assumed covered.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing staged/committed beyond the new workflow-verification document.
```

---

## STAGE 4 — SECURITY / TENANT / AUTHORIZATION VERIFICATION

```
INPUT: API_CONTRACT.md's role-gate table per module, src/middleware/tenantGuard.js, src/middleware/roleMiddleware.js, every service file's assertRole/assertCanManageX/MANAGE_ROLES-style gate, the repository layer's uniform {_id, companyId} scoping (see API_CONTRACT.md §0).
IMPLEMENTATION/VERIFICATION SCOPE: verification/documentation only. For every implemented endpoint: confirm authentication requirement (all require Bearer except POST /api/auth/login), accepted roles (cross-check against the role-gate table already in API_CONTRACT.md), tenant boundary (confirm every direct-record fetch by ID is company-scoped at the repository layer, not just at a higher service-logic level), cross-company denial behavior (404 NOT_FOUND, not 403 — confirmed uniform per API_CONTRACT.md §0), ObjectId ownership checks (e.g. Project engineer assignment's same-company user check, ServiceCall engineer assignment's same-company check, Inventory issue recipient's same-company check), and function-level authorization (not just menu/UI-level — i.e., does every action a role could reach via a direct API call, bypassing any client UI, actually get re-checked server-side).
IMPLEMENTATION/VERIFICATION SCOPE (continued): explicitly distinguish, for every case where NEW APP's behavior differs from the PWA's own permissiveness:
  - Preserved-PWA-permissiveness (a deliberate PWA-fidelity decision, e.g. Project's absent division check on detail-view reads, Project's company-wide engineer-candidate pool, ServiceCall's no-division-filter engineer-candidate pool) — these are NOT security gaps to close; they are locked business decisions and must stay as documented in API_CONTRACT.md/the relevant decision-lock doc.
  - Closed-security-gaps (an infra-only adaptation, e.g. Inventory's direct single-record lookup gap — itemById() had no company check in the PWA — now tenant-scoped in NEW APP; ServiceCall's vCall() cross-tenant read gap, now tenant-scoped) — these ARE gap closures and must be confirmed still closed (i.e., not accidentally reopened by any later change).
IMPLEMENTATION/VERIFICATION SCOPE (continued): no new authorization logic is added in this stage — only verification that what exists matches what is documented, and a gap list for anything that does not.
EXPECTED OUTPUT: a security/tenant verification checklist (e.g. new-app/docs/SECURITY_VERIFICATION.md) — one row per endpoint with its confirmed auth/role/tenant/ownership status, and a short table separating "preserved permissiveness" from "closed gaps" for quick audit reference.
TEST REQUIREMENT: every endpoint in API_CONTRACT.md accounted for in the checklist; full regression suite stays green (287/287); any endpoint whose live role/tenant behavior does not match its documented contract is flagged as a Stage 6 test-gap or a correctness finding for a future task, not silently reconciled by editing the contract.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing staged/committed beyond the new security-verification document.
```

---

## STAGE 5 — CONCURRENCY / ATOMICITY VERIFICATION

```
INPUT: every withTransaction call site identified in Stage 2 (per-module list), src/repositories/businessRepositories.mongoose.js's atomic primitives (incrementStockAtLocation, the enquiry conditional findOneAndUpdate "still Open" guard, serviceCallRepo.completeIfNotCompleted, per-company counterRepo.getNextSequence for order/PSC numbering).
IMPLEMENTATION/VERIFICATION SCOPE: verification/documentation only. Cover:
  - Inventory: issueMaterial, requestReturn/acceptReturn/rejectReturn, markUsed, transferStock, adjustStock (covering Purchase In/Opening Stock/Damage/Adjustment) — confirm each stock-mutating path uses the atomic incrementStockAtLocation primitive (or an equivalent session-scoped atomic update) rather than a read-modify-write race, and that InventoryTransaction ledger rows are written inside the same transaction as the stock mutation they record.
  - Cascaded writes: Enquiry→SalesOrder→Project(→Payment) conversion (one withTransaction spanning all four); SalesOrder standalone creation (same cascade, one withTransaction); Project stage→Completed transition and its notification fan-out; ServiceCall completion + Chargeable Payment creation + Contract PM-slot update (one withTransaction spanning all three, using contractService.completePmVisitForContract's optional deps.session threading — confirm this threading is exercised, not just present in signature); Payment raise-to-finance.
  - Idempotency/uniqueness guards: the per-company atomic order-number/PSC-number counter (no duplicate-number race under concurrent creates), the Enquiry conditional "still Open" convert guard (DUPLICATE_CONVERSION on a race), ServiceCall's completeIfNotCompleted (idempotent completion under retry/concurrency — confirm it is genuinely atomic, e.g. a single findOneAndUpdate with a status precondition, not a separate read-then-write).
IMPLEMENTATION/VERIFICATION SCOPE (continued): document which operations use MongoDB transactions vs. conditional atomic single-document updates vs. neither (and whether "neither" is safe because the operation is genuinely single-document/single-write). No new business rules are invented; where a race is found without a guard, it is documented as a finding, not fixed here.
EXPECTED OUTPUT: a concurrency/atomicity verification document (e.g. new-app/docs/CONCURRENCY_VERIFICATION.md) listing every identified transactional/atomic operation, its mechanism, and any gap found.
TEST REQUIREMENT: every Inventory stock-mutating operation and every cross-collection cascade listed above accounted for; full regression suite stays green (287/287). Where the existing suite does not actually exercise a concurrent/racing scenario (most unit-style tests won't), that absence is noted as a Stage 6 gap.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing staged/committed beyond the new concurrency-verification document.
```

---

## STAGE 6 — API TEST / CONTRACT TEST HARDENING

```
INPUT: API_CONTRACT.md, tests/*.test.js (19 files, 287 tests today), the Stage 2–5 verification documents and any gaps they flagged.
IMPLEMENTATION/VERIFICATION SCOPE: primarily verification/documentation — compare the documented contract (every route × role × tenant × error condition) against actual test coverage, and produce a gap list. Do NOT add tests in this stage unless a gap is severe enough to threaten establishing a trustworthy baseline for Stage 7/8 (and even then, prefer documenting first and adding only with explicit sign-off, per the ground rules governing this whole engagement).
IMPLEMENTATION/VERIFICATION SCOPE (continued): identify, per module: missing endpoint coverage (a route in API_CONTRACT.md with no corresponding test), missing error coverage (a documented ServiceError code/status with no test asserting it), missing tenant-isolation coverage (no test asserting a cross-company 404 for a given entity type), missing role coverage (a role gate with no test asserting both the allowed and at least one forbidden role), missing concurrency coverage (flagged in Stage 5), missing cross-module workflow coverage (a Stage 3 workflow with only unit-level, not chain-level, coverage).
EXPECTED OUTPUT: a test-gap inventory (e.g. new-app/docs/TEST_GAP_INVENTORY.md), organized by module and by gap category, each gap referencing the specific route/behavior in API_CONTRACT.md it corresponds to.
TEST REQUIREMENT: full regression suite stays green (287/287) — this stage's own output is a gap list, not new failing/passing tests. If any test is added to establish baseline, it must be additive only (no existing test behavior changed) and the suite must stay 100% green afterward.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing staged/committed beyond the new gap-inventory document (and, only if unavoidable, additive test files).
```

---

## STAGE 7 — FRONTEND / PWA-COMPATIBLE CLIENT INTEGRATION

```
INPUT: the FROZEN API_CONTRACT.md (Stage 1, verified consistent through Stages 2–6), the PWA source itself (MEP_PROJECTS_PWA/index.html / root index.html) as the UI/UX and business-behavior reference.
IMPLEMENTATION/VERIFICATION SCOPE: THIS IS THE FIRST STAGE INVOLVING NEW CLIENT/FRONTEND CODE. The client is built to call the NEW API exactly per the locked contract — it does not change business behavior to make client code simpler, and where the PWA exposes a quirk (see Stage 0's preserved-quirks list), the client documents and preserves it in its own UI/UX unless that quirk was already classified as infrastructure-only and closed (Stage 4's closed-gaps list) — in which case the client reflects the closed/secure behavior, not the old PWA gap.
EXPECTED OUTPUT: a client integration layer (framework/approach to be decided in that stage, not here) whose every network call maps 1:1 to a route in API_CONTRACT.md.
TEST REQUIREMENT: client-side tests (or equivalent manual verification script) covering the 12 workflows from Stage 3 against the real API; backend regression suite stays green (287/287) throughout, since backend code should not need to change to support a compliant client.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged (the PWA remains the reference, untouched), nothing in new-app/backend/src modified by this stage — only new client code and its own docs/tests.
```

---

## STAGE 8 — PRODUCTION READINESS

```
INPUT: the fully verified system from Stages 0–7 (backend contract frozen and cross-verified, client integrated against it).
IMPLEMENTATION/VERIFICATION SCOPE: infrastructure/operations only — environment configuration (src/config/env.js hardening), MongoDB production configuration (connection pooling, replica-set/transaction requirements — src/db/connection.js), JWT/session security review (token secret management, expiry policy — resolves Open Decision #1 as an infra decision if the business signs off), CORS policy, rate limiting where appropriate, structured logging, error observability, backup/recovery procedure, migration strategy for schema changes, deployment process, health/readiness endpoints (GET /api/health already exists — confirm it is sufficient or extend it), operational monitoring. These are infrastructure concerns, not ERP/business redesign — no new business feature, route, or rule is introduced in this stage.
EXPECTED OUTPUT: a production-readiness runbook/checklist and whatever infra configuration files it requires.
TEST REQUIREMENT: full regression suite stays green (287/287); a deployment smoke test (health endpoint + one representative authenticated call per module) passes against the production-configured environment before go-live.
SAFETY CHECK: git diff v2 = 37 (unchanged), git diff v3 = 0 (unchanged), PWA md5 unchanged, nothing in new-app/backend/src's business logic (routes/services/models) modified by this stage — only infra/config/deployment artifacts.
```

---

## Closing note: what is documentation and what is code

**Stages 0–6 are documentation/verification against the already-implemented backend — no new code is written** (Stage 6 permits, at most, additive tests as a last resort, and only with explicit sign-off). **Stage 7 is the first stage that involves client/frontend code.** **Stage 8 is infrastructure/operations, not business logic.**

Given this, and given that this task (producing `API_CONTRACT.md` and this plan) completes Stage 1, **the next actionable task in this engagement is almost certainly Stage 2 (cross-module contract verification) or Stage 3 (end-to-end workflow verification) — not new business-module work.** All 8 business modules identified in Stage 0 are already implemented; there is no Stage-0-identified module left to build. Any request to "add module X" or "extend module Y with feature Z" should be treated as a new, out-of-sequence business-decision task requiring its own audit/decision-lock discipline (matching every prior module's pattern in this engagement) — not as work this plan already schedules — unless the user explicitly directs the engagement to deviate from this sequence.

---

## EXACT EXECUTION ORDER

This section removes ambiguity about the sequence of the remaining verification/production-readiness stages. It restates Stages 0–8 above (already written into this document) as a frozen, numbered STEP sequence with a uniform gate and a uniform set of required output fields, per an explicit control-update task (2026-09-23). It does not change what any stage does — the content of STEP 0–8 below is the same Stage 0–8 content already in this document, restructured into the exact field format this section requires. It supersedes nothing substantive; it only fixes the ordering, the gate, and the reporting shape.

**The order is frozen as follows and MUST NOT be reordered, skipped, or silently combined:**

```
STEP 0 — Baseline / Freeze Verification
    ↓
STEP 1 — API Contract Freeze
    ↓
STEP 2 — Cross-Module Contract Verification
    ↓
STEP 3 — End-to-End Workflow Verification
    ↓
STEP 4 — Security / Tenant / Authorization Verification
    ↓
STEP 5 — Concurrency / Atomicity Verification
    ↓
STEP 6 — API Test / Contract Test Hardening
    ↓
STEP 7 — Frontend / PWA-Compatible Client Integration
    ↓
STEP 8 — Production Readiness
```

STEP *N* = STAGE *N* everywhere in this document (STEP 0 is STAGE 0, STEP 1 is STAGE 1, … STEP 8 is STAGE 8) — the two words are interchangeable labels for the same 9-stage sequence; this section uses "STEP" because that is the term a future control instruction to this engagement uses.

### THE GATE RULE (applies identically to every step, STEP 0 through STEP 8)

```
START
→ execute only that step
→ produce its documented deliverables
→ run its required tests
→ run its safety check
→ review the result
→ explicitly declare PASS or BLOCKED
```

- A step may only advance to the next step when **PASS** is **explicitly recorded** for it — not implied, not assumed because no error was reported, not inferred from a later step's success. The declaration itself (the literal word PASS or BLOCKED, against that step's Exit Criteria) is the gate, not the work product alone.
- If a step is declared **BLOCKED**, the next step **MUST NOT begin**. Work stops at the blocked step; whatever caused the block is documented (per that step's `BLOCKING CONDITIONS` below) and handed back for a decision before any further step's work starts.
- **A future Claude command must not implicitly combine multiple stages/steps unless the user explicitly instructs it to do so.** Doing STEP 2's work while nominally executing STEP 1, or quietly starting STEP 3 because STEP 2 "looked done," is a violation of this gate regardless of the quality of the work produced — the explicit PASS declaration for the prior step, stated as such, is a precondition for starting the next one, every time, with no exception for perceived efficiency.
- This task (the documentation-only control update that added this section) does not itself execute, PASS, or BLOCK any of STEP 2–8 — see **Blocking status** in this task's own final report. It only froze the order and the gate.

### REQUIRED OUTPUT OF EACH STEP

Every step, STEP 0 through STEP 8, is documented (here, or in that step's own deliverable document once executed) using exactly these eight fields, in this order:

```
Objective
Inputs
Execution Scope
Deliverables
Required Tests
Safety Check
Exit Criteria
BLOCKING CONDITIONS
```

`BLOCKING CONDITIONS` states concretely, for that step's own content, what prevents moving to the next step — never "when ready" or "after review" on their own. Where this document's existing Stage 0–8 sections (above, in this same file) already describe a stage's inputs/scope/output/tests/safety-check, the fields below restructure that existing text into this exact shape and fill in `Objective`, `Exit Criteria`, and `BLOCKING CONDITIONS` explicitly for each — these three were not previously broken out as separate labeled fields.

---

#### STEP 0 — Baseline / Freeze Verification

```
Objective: Establish and document the actual, verified starting state of the engagement before any further stage's work is treated as building on trustworthy ground — module inventory, live test count, safety-check values, and the genuinely open decisions/preserved quirks, all re-derived from source, not assumed from memory of prior documents.

Inputs: git history; the full new-app/backend/src tree; new-app/docs/* (all audits, all *_DECISION_LOCK.md files, OPEN_DECISIONS.md); a live test run.

Execution Scope: Verification-only. Enumerate implemented modules by direct source inspection (not by trusting a prior document's module list). Run the full regression suite. Run the four safety-check commands (git diff v2/v3 name-status, PWA md5 both copies, git status --short). Extract the still-open-decisions table and the preserved-PWA-quirks list from OPEN_DECISIONS.md and the module decision-lock documents. No code is written.

Deliverables: This document's own Stage 0 section (module list, confirmed test-count baseline, safety-check values, open-decisions table, preserved-quirks list) plus this plan document and API_CONTRACT.md as this step's/STEP 1's artifacts.

Required Tests: Full regression suite run and green before any later step's work is considered to build on a valid baseline. (287/287 at the time this document's Stage 0 was written — re-verify fresh at the start of whichever future task actually executes STEP 0/1 again, do not assume the number is still current.)

Safety Check: git diff --name-status -- v2 = 37 files (unchanged from the pre-existing drift baseline); git diff --name-status -- v3 = 0 files; md5sum index.html MEP_PROJECTS_PWA/index.html = 111b53dba91704f96b83dae96c7793c6 for both copies; git status --short shows no new staged/committed files beyond this step's own new-app/docs/*.md deliverables.

Exit Criteria: The module inventory, test count, and safety-check values above are each independently re-derived (not copied from a prior document) and recorded in this document's Stage 0 section; the open-decisions and preserved-quirks lists are extracted from OPEN_DECISIONS.md and the decision-lock documents, not invented.

BLOCKING CONDITIONS: The regression suite is not green (any failing/erroring test blocks every later step — there is no partial baseline). Any of the four safety-check values does not match its expected baseline (v2 ≠ 37, v3 ≠ 0, either PWA md5 ≠ 111b53dba91704f96b83dae96c7793c6, or git status shows an unexpected staged/committed file) — any such mismatch blocks STEP 1 onward until it is explained and, if it represents unauthorized drift, resolved.
```

#### STEP 1 — API Contract Freeze

```
Objective: Produce a single, implementation-grounded document (API_CONTRACT.md) that records the exact current HTTP API surface — every route's method, path, auth requirement, role gate, tenant-scoping behavior, request/response shape, and error taxonomy — read directly from source, so later steps have one authoritative contract to verify against instead of re-deriving it themselves each time.

Inputs: src/app.js (route mounting); all src/routes/*.js; all src/services/*.js; src/middleware/*; src/auth/*; src/repositories/businessRepositories.mongoose.js; src/models/*; src/errors.js; the module decision-lock docs for cross-reference.

Execution Scope: Documentation only. Every mounted route is read directly from source (not inferred from prior audits) and its method, path, auth requirement, role gate, tenant-scoping behavior, request/response shape, and error taxonomy is recorded. No route, service, model, or test file is modified.

Deliverables: new-app/docs/API_CONTRACT.md — the frozen, implementation-grounded contract for all 8 business modules plus Auth/Company, including (as of the 2026-09-23 control update) the ENDPOINT COUNTING STANDARD, the canonical 104-endpoint total, the module breakdown table, the combined Endpoint Index/Traceability Matrix (one row per canonical endpoint), and the ENDPOINT COUNT RECONCILIATION section.

Required Tests: Every route entry in the contract document is traceable to an actual grep/read of the route file and its backing service function; ambiguous request shapes are flagged explicitly rather than guessed. Full regression suite stays green throughout (no code touched by this step). The endpoint-count reconciliation (Registered = Endpoint Index rows = Traceability Matrix rows = Final canonical total, module sums = total) must PASS per API_CONTRACT.md's own Reconciliation section.

Safety Check: git diff v2/v3 unchanged from STEP 0's values; PWA md5 both copies unchanged; nothing staged/committed; only new-app/docs/API_CONTRACT.md (and this plan document) created or modified.

Exit Criteria: API_CONTRACT.md exists, covers all 9 mounted routers (Auth, Company, Enquiry, SalesOrder, Payment, Project, Contract, ServiceCall, Inventory) plus the directly-registered health route, and its endpoint-count reconciliation (§14 of that document) reads PASS.

BLOCKING CONDITIONS: Any route found in source with no corresponding row in API_CONTRACT.md's Endpoint Index (or vice versa — a documented row with no matching source registration) blocks this step from being declared PASS. A reconciliation FAIL (Registered ≠ Endpoint Index rows, or module sums ≠ total) blocks STEP 2 — the API contract is explicitly NOT considered frozen while that mismatch stands, per API_CONTRACT.md §14's own rule.
```

#### STEP 2 — Cross-Module Contract Verification

```
Objective: Verify that every cross-module reference the implemented system actually uses (foreign keys, shared cascades, transaction/session propagation, cross-module error-code consistency) is internally consistent with itself and with what API_CONTRACT.md documents — without redesigning anything.

Inputs: API_CONTRACT.md (STEP 1 output); src/services/salesOrderCascade.js; src/services/contractService.js's completePmVisitForContract; src/services/serviceCallService.js's use of it and of paymentRepo; src/repositories/businessRepositories.mongoose.js (every cross-module foreign-key field and its ObjectId type); DATABASE_SCHEMA.md; DOMAIN_MODEL.md.

Execution Scope: Verification/documentation only. Trace every cross-module reference actually used by the implemented system: (a) Company/User/Auth → Enquiry → SalesOrder → Project → Contract → ServiceCall foreign-key consistency and company-scoping at every hop; (b) SalesOrder → Payment/Finance milestone-raise and syncPayStatus consistency; (c) Inventory cross-module tenant isolation and atomic-stock-mutation uniformity; (d) transaction/session propagation consistency across every multi-collection cascade; (e) error-contract consistency (the same conceptual failure uses the same ServiceError code/status across modules, per API_CONTRACT.md §0's taxonomy). Where an inconsistency is found, it is documented as a finding for a future task to resolve, not fixed in this step.

Deliverables: A cross-module contract verification checklist/report (e.g. new-app/docs/CROSS_MODULE_VERIFICATION.md) listing each traced interaction, its consistency verdict, and any flagged inconsistency.

Required Tests: Full regression suite stays green throughout (this step reads and documents; it does not add new tests). Every cross-module reference named in API_CONTRACT.md's module sections is accounted for in the verification checklist — none silently skipped.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing staged/committed beyond the new verification document.

Exit Criteria: The cross-module verification checklist covers every reference enumerated in its own Execution Scope (a)–(e) above, each with an explicit consistency verdict.

BLOCKING CONDITIONS: STEP 1 not yet declared PASS (this step cannot start against an unfrozen contract — see the Frozen Dependency Order below). Any traced interaction left without a verdict. A found inconsistency that is severe enough to make API_CONTRACT.md itself inaccurate (not just a future-task finding) blocks this step's own PASS declaration until API_CONTRACT.md is corrected and STEP 1 is re-verified.
```

#### STEP 3 — End-to-End Workflow Verification

```
Objective: Trace each of the 12 established PWA-derived business workflows through its actual multi-endpoint, multi-collection call chain (not just its individual endpoints' unit tests) and confirm the chain matches what API_CONTRACT.md documents, with an explicit gap/no-gap verdict per workflow.

Inputs: API_CONTRACT.md; the STEP 2 cross-module verification document; the 12 established PWA workflows (Enquiry→SO conversion; SO→Project/Payment/Checklist/Notifications fan-out; Project timeline/checklist progression; checklist approval; Project completion incl. MEP exclusion; Commissioning→Contract/ServiceCall conversion; Contract→PM visits; Service complaint lifecycle; Inventory issue/return lifecycle; Payment collection/part-payments/raise-to-finance; Finance interactions; Notifications fan-out); tests/*.test.js (to check unit- vs. chain-level coverage).

Execution Scope: Verification/documentation only. For each of the 12 workflows, document: entry endpoint; every dependent endpoint it triggers or requires; every database write (collections, fields); every notification fan-out (targetRoles); authorization at each step; expected terminal state; atomicity requirements; failure behavior. No workflow is declared complete merely because its individual endpoints' unit tests pass — the trace must follow the actual service-layer call chain.

Deliverables: A workflow verification document (e.g. new-app/docs/WORKFLOW_VERIFICATION.md) with one section per workflow, each ending in an explicit "gap found" or "no gap found" verdict.

Required Tests: Each of the 12 workflows traced end-to-end with no undocumented gap; full regression suite stays green. Where an existing test only unit-tests one service function with mocked deps rather than exercising the full chain, that is noted as a STEP 6 test-coverage gap, not silently assumed covered.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing staged/committed beyond the new workflow-verification document.

Exit Criteria: All 12 workflows have an explicit gap/no-gap verdict recorded; every workflow's entry/dependent endpoints are cross-checked against API_CONTRACT.md's Endpoint Index.

BLOCKING CONDITIONS: STEP 2 not yet declared PASS. Any of the 12 workflows left untraced or without an explicit verdict. A "gap found" verdict that indicates the implementation does not match API_CONTRACT.md's documented behavior (as opposed to a documented, locked PWA-fidelity quirk) blocks this step's own PASS until the discrepancy is resolved or explicitly re-classified as an accepted, documented quirk.
```

**STEP 3 pass structure (added 2026-09-23, documentation/control-only annotation — does not reorder or re-sequence the above):** STEP 3's execution is broken into 9 dependency-ordered passes, frozen in `new-app/docs/E2E_WORKFLOW_VERIFICATION_PLAN.md`, which governs pass sequencing, the mandatory source-evidence standard, and the pass result template. Sequence: **3.0** Baseline/Evidence Preparation (source inventories + workflow-to-source index, no verification yet) → **3.1** Enquiry→SalesOrder→Payment → **3.2** SalesOrder→Project → **3.3** Project→Checklist→Completion (dedicated checklist pass) → **3.4** Project→Contract/Warranty→PM Service → **3.5** ServiceCall End-to-End (complaint/PM/chargeable) → **3.6** Inventory End-to-End → **3.7** Notifications + Cross-Workflow Side Effects (re-confirms Step 2 finding B1) → **3.8** Master End-to-End Reconciliation. Each pass individually gates PASS/BLOCKED per `E2E_WORKFLOW_VERIFICATION_PLAN.md`'s Mandatory Pass Gate; STEP 3 as a whole is not PASS until all 9 passes are PASS. See that document for the full pass definitions, evidence standard, and finding-classification list this STEP 3 entry now points to.

#### STEP 4 — Security / Tenant / Authorization Verification

```
Objective: Confirm, endpoint by endpoint, that authentication requirement, accepted roles, tenant boundary, cross-company denial behavior, ObjectId ownership checks, and function-level (not just UI-level) authorization all match what API_CONTRACT.md documents — and explicitly separate deliberate PWA-fidelity permissiveness from genuine, closed security gaps.

Inputs: API_CONTRACT.md's role-gate table per module; src/middleware/tenantGuard.js; src/middleware/roleMiddleware.js; every service file's assertRole/assertCanManageX/MANAGE_ROLES-style gate; the repository layer's uniform {_id, companyId} scoping.

Execution Scope: Verification/documentation only. For every implemented endpoint (all 104, per API_CONTRACT.md's Endpoint Index): confirm authentication requirement, accepted roles, tenant boundary, cross-company denial behavior (404, not 403), ObjectId ownership checks, and function-level authorization. Explicitly separate preserved-PWA-permissiveness (a locked business decision — not a gap to close) from closed-security-gaps (an infra-only adaptation that must be confirmed still closed, not reopened). No new authorization logic is added in this step.

Deliverables: A security/tenant verification checklist (e.g. new-app/docs/SECURITY_VERIFICATION.md) — one row per endpoint with confirmed auth/role/tenant/ownership status, and a short table separating "preserved permissiveness" from "closed gaps."

Required Tests: Every one of the 104 endpoints in API_CONTRACT.md's Endpoint Index accounted for in the checklist; full regression suite stays green. Any endpoint whose live role/tenant behavior does not match its documented contract is flagged as a STEP 6 test-gap or a correctness finding for a future task — not silently reconciled by editing the contract in this step.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing staged/committed beyond the new security-verification document.

Exit Criteria: All 104 endpoints have a recorded auth/role/tenant/ownership status; the preserved-permissiveness vs. closed-gaps table is complete and cross-referenced to the relevant decision-lock document for each entry.

BLOCKING CONDITIONS: STEP 3 not yet declared PASS. Any endpoint left unchecked. A previously-closed security gap (e.g. ServiceCall's vCall() cross-tenant read, Inventory's itemById() cross-tenant read) found to be reopened blocks this step's PASS immediately — that is a regression, not a documentation finding, and must be escalated rather than merely logged.
```

#### STEP 5 — Concurrency / Atomicity Verification

```
Objective: Confirm every stock-mutating Inventory operation and every cross-collection cascade uses the transactional/atomic mechanism API_CONTRACT.md and the service source claim it uses, and document which operations rely on MongoDB transactions vs. conditional atomic single-document updates vs. neither (and whether "neither" is safe).

Inputs: Every withTransaction call site identified in STEP 2 (per-module list); src/repositories/businessRepositories.mongoose.js's atomic primitives (incrementStockAtLocation, the enquiry conditional "still Open" guard, serviceCallRepo.completeIfNotCompleted, per-company counterRepo.getNextSequence).

Execution Scope: Verification/documentation only. Cover: Inventory stock-mutating paths (issueMaterial, requestReturn/acceptReturn/rejectReturn, markUsed, transferStock, adjustStock); cascaded multi-collection writes (Enquiry→SalesOrder→Project(→Payment), Project stage→Completed + notification fan-out, ServiceCall completion + Chargeable Payment + Contract PM-slot update, Payment raise-to-finance); idempotency/uniqueness guards (per-company counters, Enquiry's DUPLICATE_CONVERSION guard, ServiceCall's completeIfNotCompleted). No new business rules are invented; a race found without a guard is documented as a finding, not fixed here.

Deliverables: A concurrency/atomicity verification document (e.g. new-app/docs/CONCURRENCY_VERIFICATION.md) listing every identified transactional/atomic operation, its mechanism, and any gap found.

Required Tests: Every Inventory stock-mutating operation and every cross-collection cascade listed above accounted for; full regression suite stays green. Where the existing suite does not exercise a concurrent/racing scenario, that absence is noted as a STEP 6 gap.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing staged/committed beyond the new concurrency-verification document.

Exit Criteria: Every listed operation has a recorded mechanism (transaction / atomic conditional update / neither-but-safe) and any gap is explicitly flagged.

BLOCKING CONDITIONS: STEP 4 not yet declared PASS. Any stock-mutating Inventory operation or listed cascade left unverified. A race condition found with no guard AND with a plausible real-world trigger (not purely theoretical) blocks this step's PASS until it is at minimum escalated as a correctness finding requiring explicit business/engineering sign-off before STEP 6 proceeds.
```

#### STEP 6 — API Test / Contract Test Hardening

```
Objective: Compare the documented contract (every route × role × tenant × error condition, and every STEP 3/4/5-flagged gap) against actual test coverage, and produce a gap list — adding tests only as a last resort for severe gaps, not as this step's primary output.

Inputs: API_CONTRACT.md; tests/*.test.js (19 files, 287 tests as of the 2026-09-23 baseline); the STEP 2–5 verification documents and any gaps they flagged.

Execution Scope: Primarily verification/documentation. Identify, per module: missing endpoint coverage; missing error coverage (a documented ServiceError code/status with no test asserting it); missing tenant-isolation coverage; missing role coverage (both allowed and at least one forbidden role); missing concurrency coverage (from STEP 5); missing cross-module workflow coverage (from STEP 3, chain-level not just unit-level). Do NOT add tests in this step unless a gap is severe enough to threaten a trustworthy baseline for STEP 7/8, and even then prefer documenting first and adding only with explicit sign-off.

Deliverables: A test-gap inventory (e.g. new-app/docs/TEST_GAP_INVENTORY.md), organized by module and gap category, each gap referencing the specific route/behavior in API_CONTRACT.md it corresponds to.

Required Tests: Full regression suite stays green — this step's own output is a gap list, not new failing/passing tests. If a test is added to establish baseline, it must be additive only (no existing test behavior changed) and the suite must stay 100% green afterward.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing staged/committed beyond the new gap-inventory document (and, only if unavoidable, additive test files).

Exit Criteria: The gap inventory covers every category listed in Execution Scope, for every module, with each gap traced to a specific API_CONTRACT.md row or STEP 3/4/5 finding.

BLOCKING CONDITIONS: STEP 5 not yet declared PASS. Any module or gap category left unassessed. A gap judged severe enough to threaten STEP 7/8's trustworthiness, found without the explicit sign-off this step's own rule requires before adding a test, blocks this step's PASS until that sign-off is obtained or the gap is otherwise resolved.
```

#### STEP 7 — Frontend / PWA-Compatible Client Integration

```
Objective: Build a client integration layer whose every network call maps 1:1 to a route in the frozen API_CONTRACT.md, preserving the PWA's own UI/UX and locked business-behavior quirks (except where STEP 4 confirmed a quirk was an infra-only closed security gap, in which case the client reflects the closed/secure behavior).

Inputs: The FROZEN API_CONTRACT.md (STEP 1, verified consistent through STEP 2–6); the PWA source itself (MEP_PROJECTS_PWA/index.html / root index.html) as the UI/UX and business-behavior reference.

Execution Scope: THIS IS THE FIRST STEP INVOLVING NEW CLIENT/FRONTEND CODE. The client calls the NEW API exactly per the locked contract — it does not change business behavior to make client code simpler. Where the PWA exposes a preserved quirk (STEP 0's preserved-quirks list), the client documents and preserves it in its own UI/UX, unless STEP 4 classified it as a closed infra gap, in which case the client reflects the closed/secure behavior instead.

Deliverables: A client integration layer (framework/approach decided in this step, not earlier) whose every network call maps 1:1 to a route in API_CONTRACT.md.

Required Tests: Client-side tests (or an equivalent manual verification script) covering the 12 STEP 3 workflows against the real API; backend regression suite stays green throughout, since backend code should not need to change to support a compliant client.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged (the PWA remains the untouched reference); nothing in new-app/backend/src modified by this step — only new client code and its own docs/tests.

Exit Criteria: Every network call the client makes is traced to a specific API_CONTRACT.md Endpoint Index row; all 12 workflows are exercised against the real API with a passing result.

BLOCKING CONDITIONS: STEP 6 not yet declared PASS — in particular, per the Frozen Dependency Order below, frontend integration must never become the mechanism by which an API contract ambiguity is first discovered; any such ambiguity discovered during this step blocks this step immediately and is kicked back to STEP 1/2 for resolution before client work continues. Any client network call with no corresponding API_CONTRACT.md row. Any backend source file found modified to "make the client simpler."
```

#### STEP 8 — Production Readiness

```
Objective: Make the fully verified, client-integrated system operationally deployable — infrastructure and operations only, no new business feature, route, or rule.

Inputs: The fully verified system from STEP 0–7 (backend contract frozen and cross-verified, client integrated against it).

Execution Scope: Infrastructure/operations only — environment configuration hardening (src/config/env.js); MongoDB production configuration (connection pooling, replica-set/transaction requirements — src/db/connection.js); JWT/session security review (resolves Open Decision #1 as an infra decision if the business signs off); CORS policy; rate limiting where appropriate; structured logging; error observability; backup/recovery procedure; migration strategy; deployment process; health/readiness endpoints (confirm GET /api/health is sufficient or extend it); operational monitoring. No new business feature, route, or rule is introduced.

Deliverables: A production-readiness runbook/checklist and whatever infra configuration files it requires.

Required Tests: Full regression suite stays green; a deployment smoke test (health endpoint + one representative authenticated call per module) passes against the production-configured environment before go-live.

Safety Check: git diff v2/v3 unchanged; PWA md5 unchanged; nothing in new-app/backend/src's business logic (routes/services/models) modified by this step — only infra/config/deployment artifacts.

Exit Criteria: The runbook/checklist is complete, the deployment smoke test passes, and the regression suite is green in the production-configured environment.

BLOCKING CONDITIONS: STEP 7 not yet declared PASS. Any infra change found to also alter routes/services/models (business logic) blocks this step's PASS — that change belongs to an earlier step's scope, re-opened under its own gate, not folded into STEP 8. The deployment smoke test failing blocks go-live regardless of how clean STEP 0–7 were.
```

### FROZEN DEPENDENCY ORDER

The following dependencies are mandatory and chain exactly as given — no step in this chain may start before the step immediately before it in the chain has an explicit, recorded PASS:

```
API Contract must be frozen before Cross-Module Verification
Cross-Module Verification must be completed before End-to-End Workflow Verification
End-to-End Workflow Verification must be completed before Security/Tenant/Authorization Verification
Security/Tenant/Authorization Verification must be completed before Concurrency/Atomicity Verification
Concurrency/Atomicity Verification must be completed before Contract-Test Hardening
Contract-Test Hardening must be completed before Frontend/PWA-Compatible Client Integration
Frontend/PWA-Compatible Client Integration must be completed before Production Readiness
```

**Frontend integration must never become the mechanism by which API contract ambiguities are discovered.** The API contract (STEP 1, verified through STEP 2–6) must be resolved before STEP 7 begins specifically so that STEP 7's client work is a mechanical mapping exercise against an already-trustworthy contract, not a discovery process that finds contract gaps the earlier steps should have caught. If STEP 7 work ever surfaces a genuine contract ambiguity, that is treated as evidence STEP 1–6 did not actually reach PASS on that point — the ambiguity is kicked back to the relevant earlier step (re-opened under that step's own gate) rather than resolved ad hoc inside the client code.

---

## DEADLINE CHECKPOINTS

Appended 2026-09-23 by an explicit documentation/execution-control-update task. This section does not reorder, remove, or alter STEP 0–8 above or the EXACT EXECUTION ORDER section — it adds deadline checkpoints on top of that unchanged sequence. Full governing detail (the Phase A/Phase B verify-vs-fix protocol, fix-task identifier format, priority classification, re-verification rule, and the PWA completeness checklist) lives in `new-app/docs/EXECUTION_CONTROL_AND_DEADLINE.md`, which this section only summarizes for placement alongside the STEP sequence it applies to.

**Hard project target: September 24, 2026, 23:59 IST.** Today (as of this appended section) is September 23, 2026 — this is a next-day deadline. Objective by that checkpoint: full required MEP Projects PWA functional parity + critical security/tenant protection + critical data integrity + frontend connected + full regression + deployed. The deadline is never interpreted as permission to reduce PWA coverage — speed comes from faster execution of the same scope, never from reduced scope.

- **CHECKPOINT 1 — September 24, 2026, 09:00 IST.** Required state: STEP 3 E2E verification substantially advanced; all discovered P0/P1 gaps identified; no unknown major PWA workflow areas.
- **CHECKPOINT 2 — September 24, 2026, 13:00 IST.** Required state: core PWA workflows verified; major cross-module gaps identified; critical fixes in progress/completed.
- **CHECKPOINT 3 — September 24, 2026, 17:00 IST.** Required state: STEP 3 master reconciliation (Pass 3.8) substantially complete; critical PWA gaps resolved or explicitly blocking deployment; frontend integration (STEP 7) operational.
- **CHECKPOINT 4 — September 24, 2026, 20:00 IST.** Required state: production candidate; full regression executed; security/tenant checks (STEP 4) completed; deployment validation underway.
- **HARD DEADLINE — September 24, 2026, 23:59 IST.** Required final state: DEPLOYED, unless a genuine blocking issue prevents safe deployment. Never declare deployment complete if critical functionality is known to be broken.

**Status reporting at every checkpoint uses exactly one of:** `ON TRACK`, `AT RISK`, `BLOCKED`, `DEPLOYED` — no vague language ("almost done", "mostly done", "nearly ready", "probably ready").

**Deadline blocking conditions:** the project cannot be declared deployment-ready while any P0/P1 issue remains open in core PWA workflow, cross-module relationship, checklist behavior, payment/finance flow, authentication, tenant isolation, authorization, data integrity, critical notification workflow, or critical inventory stock mutation. Non-blocking documentation issues (P3, or an explicitly accepted P2) may remain documented after functional deployment only when they do not affect PWA behavior or safe operation. A functional PWA gap is never classified as non-blocking merely to meet the deadline.

**Verify-vs-fix execution model (full detail in `EXECUTION_CONTROL_AND_DEADLINE.md`):** every STEP 3 pass (and any later STEP's verification work) still runs Phase A (`READ SOURCE → TRACE PWA → TRACE NEW APP → COMPARE → DOCUMENT EVIDENCE → CLASSIFY FINDINGS → TEST → PASS / BLOCKED`) with no application-source changes permitted. A BLOCKED pass with a P0/P1 finding moves immediately, without unnecessary human pause, into a separately identified Phase B fix task (`FIX-<PASS>-<NUMBER>`), which implements the fix, runs targeted tests and a full regression, and then re-verifies the original evidence before the pass may change from BLOCKED to PASS. A verification pass never silently fixes its own findings. Known blockers B1 (notifications), B2 (company deletion), and Checklist-Library remain open, documented findings — not fixed by this appended section or by the control-update task that added it — until a separately issued fix task addresses and re-verifies each.

**Known open items still carried forward, unchanged by this appended section:** B1 — Notifications not persisted/delivered (23 PWA `notify()` call sites vs. no wired NEW APP write-path). B2 — Company deletion cascade not implemented in NEW APP. Checklist-Library — ChecklistTemplate CRUD partially unimplemented per `PROJECT_DECISION_LOCK.md` Decision 3. None of these three is resolved by this appended section.
