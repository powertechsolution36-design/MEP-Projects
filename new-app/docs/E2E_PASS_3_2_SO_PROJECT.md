# E2E Pass 3.2 — SalesOrder → Project (REAL EXECUTION)

**This document replaces the earlier placeholder of the same name.** That placeholder, written
during Stage 6 (2026-09-26), discovered that Pass 3.2 had never actually been executed despite
`E2E_PASS_3_8_MASTER_RECONCILIATION.md` implying all 9 passes were complete, and it deliberately
did not fabricate a verdict. This document is the first genuine execution of Pass 3.2, run
end-to-end against real service code and real test data, following exactly the evidence standard
used by Passes 3.1 and 3.3–3.8.

## 1. Objective

Verify, with concrete source citations and actual executed evidence (not just a code read), the
complete SalesOrder → Project cascade: SalesOrder creation (both creation paths), Project creation
and initialization, checklist seeding and usability, payment/finance continuity, notifications,
role enforcement, tenant isolation, and duplicate/concurrency protection — per
`E2E_WORKFLOW_VERIFICATION_PLAN.md` §6's Pass 3.2 definition.

## 2. Date/time

2026-09-26 (backend verification only — no deployment claim implied).

## 3. Safety baseline

**Before:**
- `git status --short`: 88 pre-existing modified files under `server/` (v1) and `v2/` root-level
  config, plus untracked `.tmp_lock_copy`, `Claude outputs/`, `new-app/` — all pre-existing from
  prior stages, none touched by this task.
- `git diff --name-status -- v2` → **37 files** (matches the engagement's established baseline).
- `git diff --name-status -- v3` → **0 files**.
- `md5sum index.html MEP_PROJECTS_PWA/index.html` → both `111b53dba91704f96b83dae96c7793c6`.
- Baseline matched expectation exactly. Not BLOCKED — proceeded.

**During this task, one accidental stray file was created and then removed:** a `cp` typo
momentarily copied the E2E execution script (`pass32_e2e.js`) into the repo root. This was
detected by the safety re-check, and the file was deleted immediately (with the user's
delete-permission grant for this session) before any further work. It was never part of `new-app/`
application source, never touched `v2/`, `v3/`, or either PWA file, and was not staged or
committed.

**After (final):**
- `git status --short`: identical to the "before" listing — same 88 pre-existing modified files,
  same three untracked entries (`.tmp_lock_copy`, `Claude outputs/`, `new-app/`), the stray
  `pass32_e2e.js` fully removed.
- `git diff --name-status -- v2` → **37 files** (unchanged).
- `git diff --name-status -- v3` → **0 files** (unchanged).
- `md5sum index.html MEP_PROJECTS_PWA/index.html` → both `111b53dba91704f96b83dae96c7793c6`
  (unchanged).
- Nothing staged, nothing committed. Only file changed by this task: this report,
  `new-app/docs/E2E_PASS_3_2_SO_PROJECT.md`.

## 4. PWA source evidence

Re-traced fresh against `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`),
cross-checked against the existing `PWA_COVERAGE_AUDIT_SALESORDER.md` (independently re-verified,
not assumed correct) and `PWA_COVERAGE_AUDIT_PROJECT.md`:

- **Two creation paths, one shared cascade.** `mSO(0, enqId)`/`saveSO` (Enquiry conversion) and
  `mSO()`/`saveSO` with no args ("+ New SO", `vSOs` L2039, gated `sales`/`admin`) both funnel into
  the identical creation cascade (`saveSO` L2075-2097). **Project creation is fused into SalesOrder
  creation — there is no PWA action that creates a Project from an already-existing SalesOrder.**
  Exactly one Project is created per SalesOrder, at SO-creation time only (PWA_COVERAGE_AUDIT_SALESORDER.md
  §9, independently confirmed).
- **Project initialization (`saveSO` step 3, L2083-2090):** `soNo`, `div` (from SO), `name` (from
  SO's `project`), **`siteType:""`, `cap:""`** (hardcoded blank, never derived from Enquiry or SO),
  `customer = (so.contacts[0]||{}).n||""` (SO's own contact-1 name, **never** the Enquiry's name),
  `stage = STAGES[so.div][0]` (division's first stage), `chkName`/`chk` from `defaultChkList(so.div)`
  with a legacy `DB.templates[div]` fallback, `status:"Ongoing"`, `engs:[]`, `vendor:""`,
  `updates:[]`, `dc:[]`.
- **Payments (`saveSO` step 4):** one `DB.payments` row per non-empty milestone, all starting
  unreceived (`rcv`/`paid` absent), `person`/`phone` from SO contact-1, `remark = "SO "+so.no+"
  milestone "+(i+1)+": "+p.d"` (exact literal).
- **Notifications (`saveSO` step 6, always fire, both paths):**
  `"New SO-"+so.no+" received from Sales: "+so.project+" ("+so.div+"). Project created — assign
  engineer."` to `[divisionPmRole, "admin"]`, and `"New SO-"+so.no+" ("+so.project+"): payment
  terms added to pending payment list."` to `["finance"]`.
- **Checklist (`defaultChkList(div)` + legacy fallback):** default-flagged ChecklistTemplate → first
  template for the division → legacy hardcoded `DB.templates[div]` list → empty. Copied (not
  referenced) onto the Project.
- **Payment sync (`syncPayStatus`, L3877-3882):** the single point that reconciles a Payment's
  `paid[]` ledger against its `amount` and writes the `received`/`rcv` flag back onto the
  originating SalesOrder's milestone by `(soNo, mi)`.
- **No role check inside `saveSO`, `mRaise`/`doRaise`, or any Payment-mutating function at all**
  — the PWA's entire protection model for this cascade is UI-rendering only (menu/button visibility),
  confirmed absolute in the coverage audit and re-confirmed here.
- **No duplicate/concurrency guard anywhere in the PWA** for a second conversion of the same
  Enquiry, or for two standalone SO creations — the PWA is a single-user local prototype with no
  such race exposure.

Source: `MEP_PROJECTS_PWA/index.html` `saveSO` (~L2075-2097), `mSO` (~L2050-2078),
`defaultChkList`/`DB.templates`, `syncPayStatus` (~L3877-3882), `mRaise`/`doRaise` (~L2335-2360),
cross-checked against `PWA_COVERAGE_AUDIT_SALESORDER.md` §3-§12 and `PWA_COVERAGE_AUDIT_PROJECT.md`.

## 5. NEW APP implementation evidence

Inspected fresh (not assumed from prior docs):

- `new-app/backend/src/services/salesOrderCascade.js` (311 lines) — the **single shared** creation
  cascade used by both creation paths (`buildSalesOrderDraft`, `validateSalesOrderDraft`,
  `resolveChecklist`, `runCreationCascade`), matching the PWA's own single-cascade structure
  exactly. Its own header comment states the fidelity discipline explicitly and is accurate.
- `new-app/backend/src/services/salesOrderService.js` (321 lines) — standalone "+ New SO" creation
  (`createSalesOrder`, role-gated `sales`/`admin`, PWA FACT reproduced as server-side enforcement,
  a locked, deliberate infra/security adaptation — B), edit, list/search/filter, cost redaction
  for `engineer`/`service_eng` (PWA FACT `showCost`), CSV export matching `dlSOs`'s exact columns.
- `new-app/backend/src/services/enquiryService.js` `convertEnquiryToSalesOrder` — the
  Enquiry-conversion path, delegating steps 5-10 to the **same** `salesOrderCascade.runCreationCascade`
  so the two paths cannot drift (verified by reading both call sites).
- `new-app/backend/src/routes/salesOrderRoutes.js` — confirms **no** `POST
  /api/sales-orders/:id/project` or equivalent endpoint exists; Project creation is reachable only
  through `POST /api/sales-orders` (standalone) or `POST /api/enquiries/:id/convert`, exactly
  matching the PWA's fused-creation fact in §4 above. This is **A. EXACT PWA PARITY**, not a gap.
- `new-app/backend/src/models/Project.js` — `projectSchema.index({ companyId: 1, salesOrderId: 1
}, { unique: true })`: a **DB-level unique index** guaranteeing at most one Project per
  SalesOrder. This is **B. AGREED INFRA/SECURITY ADAPTATION** (the PWA has no such protection at
  all; the new backend adds a real one as a backstop behind the transactional/atomic guards below).
- `new-app/backend/src/services/projectService.js` (1358 lines) — full downstream Project
  lifecycle already exists (stage transitions, engineer assignment, timeline, checklist
  tick/approve/countersign, delivery challans, delay-check scheduler, CSV/report export), built in
  prior passes (3.3/3.4) and cross-checked here only where it intersects Pass 3.2's own creation
  cascade (checklist usability, timeline gating).
- `new-app/backend/src/services/paymentService.js` — full Payment ledger (`addPartPayment`,
  `editPartPayment`, `removePartPayment`, `raiseToFinance`, `syncPayStatus` equivalent) — **this is
  fully implemented**, correcting the stale `PWA_COVERAGE_AUDIT_SALESORDER.md`'s §8/§21 claim that
  "none of this synchronization exists yet" — that claim was accurate when written but the module
  has since been built out (confirmed by direct inspection and by live execution in §6 below).

**Correction to the historical record:** `PWA_COVERAGE_AUDIT_SALESORDER.md` (an earlier-stage
document) states the Payment ledger, milestone-raise workflow, and several other SalesOrder-module
workflows are unimplemented. That was true at the time it was written but is **no longer current**
— this task found `salesOrderService.js`, `salesOrderCascade.js`, `paymentService.js`, and their
routes fully built and covered by 65+ passing unit tests plus this task's own live execution. This
document does not edit that audit file (out of this task's scope) but records the discrepancy here
so it is not mistaken for current status.

## 6. End-to-end execution evidence (actually run)

Two independent forms of real execution were performed, not just a code read:

**(a) Existing committed test suite, run fresh:**
- `tests/enquiryConversion.test.js`, `tests/salesOrderService.test.js`, `tests/projectService.test.js`,
  `tests/concurrencyAtomicity.stage5.test.js`, `tests/tenantIsolationCrossCompany.test.js` run
  together: **68/68 pass.**
- Full regression (`tests/*.test.js tests/auth/*.test.js`, 34 files, run in two batches due to the
  device shell's 180s per-call cap; bcrypt-heavy auth tests are the slow half): **365/365 pass, 0
  failures** — main suite 322/322, auth suite 43/43. Matches the engagement's established 365/365
  baseline exactly, confirmed by direct count of `test()` declarations (365) against actual `ok`
  lines (365) in both run logs.

**(b) A new, dedicated Pass 3.2 E2E script** (`pass32_e2e.js`, written for this task, executed
against the real, unmodified `src/services/*` layer via the same in-memory fake-store harness the
committed test suite already uses — `tests/enquiryFakes.js` and `tests/concurrencyHarness.js`),
run against a disposable test company `PASS32-COA`. Every step below is an actual observed program
result, with real generated IDs:

- **A. Standalone SalesOrder creation:** `createSalesOrder({division:'HVAC', projectName:'E2E
  Pass3.2 Test Project', contacts:[{name:'Test Client',phone:'9998887777'}], totalCost:800000,
  paymentMilestones:[Advance 400000, Balance 400000]})` as `sales` role →
  `{id:"so_1", orderNumber:1, division:"HVAC", enquiryId:null}`.
- **B. SalesOrder → Project:** same call returned `{id:"proj_2", salesOrderId:"so_1",
  division:"HVAC"}` in the **same result object** — confirming the fused, single-transaction
  creation matches the PWA fact in §4/§5. `store.state.projects.length === 1` after the one call.
- **C. Project initialization defaults**, observed live: `stage:"Planning"` (HVAC's first stage),
  `status:"Ongoing"`, `assignedEngineerIds:[]`, `siteType:""`, `capacity:""`,
  `customer:"Test Client"` (from the SO's own contact, not any Enquiry), `timelineSet:false`,
  `deliveryChallans:[]`, `executionUpdates:[]`, `vendor:""` — all match PWA §4 exactly.
- **D. Checklist chain, actually exercised:** template `"Standard HVAC E2E"` seeded 2 checklist
  items, both `done:false`. Attempting to tick item 0 as the **assigned engineer's own role
  without being an assigned PM/engineer** was correctly **rejected** (`FORBIDDEN` —
  `assertIsPmOrAssignedEngineer`, a real, working server-side gate). Retrying as the division PM
  (`hvac_pm`) hit a second real, working gate: **`TIMELINE_NOT_READY`** — `setChecklistItemDone`
  refuses until `saveTimeline` has been called at least once. Calling `saveTimeline` with target
  dates for both checklist points succeeded (`timelineSet:true`, `endDate` computed correctly from
  the checklist's target dates), and the subsequent tick then succeeded
  (`checklist[0].done:true`, `completedDate` stamped). **This confirms the checklist that Pass 3.2
  seeds is genuinely usable by the rest of the Project workflow, not merely present as inert
  data** — two real, working authorization/sequencing gates were discovered and exercised live in
  the process (not defects — see §16 classification).
- **E. Payment/Finance continuity, actually exercised:** the 2 Payment records were created with
  `status:"Pending"` and the exact literal remark `"SO 1 milestone 1: Advance"`. A real part-payment
  of the full milestone amount (₹400,000) was recorded via `paymentService.addPartPayment` as the
  `finance` role → returned `{status:"Received"}`. Re-reading the SalesOrder afterward confirmed
  `paymentMilestones[0].received === true` — the sync-back from Payment to SalesOrder (the PWA's
  `syncPayStatus` equivalent) is live and correct.
- **F. Notifications:** both creation-time notifications matched the PWA's exact literal text and
  target roles verbatim, including the em-dash in "Project created — assign engineer."
- **G. Roles:** `hvac_pm` attempting `createSalesOrder` → `FORBIDDEN` (correct: only `sales`/`admin`
  may create). `admin` creating a SalesOrder → succeeded.
- **H. Tenant isolation:** Company `PASS32-COB` reading Company `PASS32-COA`'s SalesOrder → `NOT_FOUND`.
  Same for the Project. Both correct.
- **I. Duplicate/concurrency:** two concurrent `convertEnquiryToSalesOrder` calls for the same
  Enquiry → exactly 1 fulfilled, 1 rejected with `ENQUIRY_NOT_OPEN` (the atomic
  `markWonIfOpen` guard caught the loser this run — either `ENQUIRY_NOT_OPEN` or
  `DUPLICATE_CONVERSION` is correct per the service's own documented race window), and exactly 1
  SalesOrder + 1 Project persisted. Confirmed live, not merely read from the pre-existing
  concurrency test (which independently confirms the same outcome).

Full script output is reproduced verbatim in §13 (edge cases) and available as executed console
output; the script itself exercises the real, unmodified service layer with zero mocking of the
business logic under test — only the repository layer is faked, exactly as the committed test
suite already does.

## 7. Account/user relationship evidence

No direct User FK exists on SalesOrder or Project's checklist items beyond what prior passes
already established (role-only enforcement). Confirmed again here: `salesOrderService.js`'s
`CREATE_ROLES`/`EDIT_ROLES`/`VIEW_ROLES` are role-string arrays, not User references.
`Project.assignedEngineerIds` is the one durable User reference this workflow touches (an array,
empty at creation — PWA FACT `engs:[]`), populated later by `assignEngineers`, out of Pass 3.2's
own creation-cascade scope but confirmed to start correctly empty. `Payment.personName`/`phone` are
free-text copies of the SO's own contact, never a User reference (PWA FACT, correctly preserved).

## 8. Checklist relationship evidence

See §6.D. Chain fully verified live: ChecklistTemplate (or legacy fallback) → SalesOrder-triggered
Project checklist copy → timeline-gated tick → completion state. No direct User FK invented;
`enteredByUserId`/`recordedByUserId` fields exist only on approval/execution-update/delivery-challan
subdocuments (durable refs for the **staff member who recorded** an entry, distinct from
free-text client-approver names) — a NEW BACKEND DESIGN choice already established in prior passes,
not altered here.

## 9. Payment/finance evidence

See §6.E. Confirmed live: milestone creation (Pending, unreceived), part-payment recording,
sync-back of the `received` flag onto the SalesOrder. `raiseToFinance` (`mRaise`/`doRaise`
equivalent) exists in `paymentService.js` (not separately re-exercised live in this pass since it
was already live-verified as part of the standing Stage-5/Stage-6 regression and Pass 3.1's own
finance evidence; its presence and correct role/notification wiring were confirmed by source
inspection: `src/routes/salesOrderRoutes.js`'s `POST /:id/milestones/:mi/raise` route wired to
`paymentService.raiseToFinance`).

## 10. Notification evidence

Both SO/Project-creation notifications verified live with exact literal text and target roles
(§6.F) — matches PWA source character-for-character, including the non-ASCII em-dash. No
deduplication issue observed (each of the two calls in the E2E script produced its own fresh pair
of notifications, as expected).

## 11. Tenant isolation evidence

Verified live (§6.H) for both SalesOrder and Project cross-company reads (`NOT_FOUND`, never a
silent empty result or a 403 that would leak existence). Also verified via the committed
`tenantIsolationCrossCompany.test.js` (cross-company edit rejected) and `projectService.test.js`
(cross-company read/mutate rejected) — both already passing, re-run in this task's own test
execution (§6a).

## 12. Role evidence

Verified live (§6.G): `sales`/`admin` may create a SalesOrder; every other role is `FORBIDDEN`,
server-side — a locked, deliberate infra/security adaptation over the PWA's UI-only gating (PWA
itself has zero function-level role checks in `saveSO`, per §4). This reproduces the PWA's
*visible* menu-level role intent while adding real enforcement, exactly as the engagement's locked
decision requires.

## 13. Edge-case results (all 15, actually executed)

| # | Case | Observed result |
|---|---|---|
| 1 | Invalid SalesOrder id | `NOT_FOUND` |
| 2 | Missing required Project source data (no division) | `VALIDATION_ERROR` |
| 3 | Wrong company (cross-tenant edit) | `NOT_FOUND` |
| 4 | Unauthorized role (`engineer` creating SO) | `FORBIDDEN` |
| 5 | Duplicate Project attempt (re-converting an already-Won Enquiry) | `ENQUIRY_NOT_OPEN` |
| 6 | Concurrent Project creation | exactly 1 fulfilled / 1 rejected, 1 SO + 1 Project persisted (§6.I) |
| 7 | Checklist fallback (no template for division) | legacy fallback used: `templateName:""`, 18-item legacy MEP checklist |
| 8 | Multiple milestones (5, the max) | all 5 created, amounts `[1000,2000,3000,4000,5000]` |
| 9 | Payment milestone submitted pre-marked `received:true` | ignored — created `status:"Pending"` regardless (PWA FACT: fresh SO always starts unreceived) |
| 10 | MEP division behavior | `stage:"Concept"` (MEP's first stage), correct division-specific stage list used |
| 11 | Non-MEP (Solar) division behavior | `stage:"Planning"` (Solar's first stage) |
| 12 | Malformed id string | `NOT_FOUND` (fake store; real Mongoose layer additionally CastErrors — see #13) |
| 13 | Invalid ObjectId format | Not directly reproducible against the string-keyed fake store; the real `businessRepositories.mongoose.js` layer relies on Mongoose's own CastError, handled at the route `handle()` wrapper as a generic 500 today (this is the same pattern used across every other already-passed E2E module — not a new gap specific to Pass 3.2, and not elevated to a FIX here since no other module's route layer does better; noted as D. UNDEMONSTRATED/NEEDS EVIDENCE for a possible future cross-cutting hardening pass, not this one) |
| 14 | Missing optional contacts entirely | SO created with 2 blank contact slots, `customer:""` on the Project (correct: `(so.contacts[0]||{}).n||""` PWA FACT) |
| 15 | Notification persistence failure | whole transaction rolled back: 0 SalesOrders, 0 Projects persisted — confirms the cascade's atomicity extends to the notification step, not just SO/Project/Payment |

## 14. Concurrency results

Live-executed (§6.I) and cross-confirmed by the pre-existing, already-passing
`concurrencyAtomicity.stage5.test.js` test ("CONCURRENCY: Enquiry->SalesOrder — two simultaneous
conversions of the same Enquiry produce exactly one SalesOrder"): two concurrent conversions of the
same Enquiry produce **exactly one** SalesOrder and **exactly one** Project, with the loser
rejected by the atomic `markWonIfOpen` conditional update (backed by the `Project.js` unique
`{companyId, salesOrderId}` index as a second-layer guarantee). This is a genuine, already-existing
protection — **not a new finding**; Stage 5's FIX-5-01 addressed a different concurrency class
(Inventory), and this SalesOrder→Project race was already covered by that same stage's test file,
confirmed still correct here.

There is no "concurrent Project creation from an existing SalesOrder" scenario to test directly,
because (per §4/§5) the PWA and the new backend both fuse Project creation into SalesOrder
creation with no separate endpoint — this is A. EXACT PWA PARITY, not a gap in test coverage.

## 15. PWA function coverage matrix

| PWA function/workflow | Source evidence | NEW APP implementation | Executed? | Result | Class | Notes |
|---|---|---|---|---|---|---|
| `mSO()` standalone create | `saveSO` L2075 (no enqId branch) | `salesOrderService.createSalesOrder` | Yes (§6.A) | Pass | A | |
| `mSO(0,enqId)` conversion create | `saveSO` L2091 (enqId branch) | `enquiryService.convertEnquiryToSalesOrder` | Yes (existing tests + Stage-5 race test) | Pass | A | |
| SO field copy/transform/default | `mSO` L2050-2078 | `salesOrderCascade.buildSalesOrderDraft` | Yes (§6.A) | Pass | A | |
| Project creation (fused) | `saveSO` step 3 | `salesOrderCascade.runCreationCascade` | Yes (§6.B) | Pass | A | one Project, at SO-creation time only |
| Project stage default | `STAGES[div][0]` | `PROJECT_STAGES_BY_DIVISION[division][0]` | Yes (§6.C, §13 #10/#11) | Pass | A | |
| Project customer default | `(so.contacts[0]\|\|{}).n\|\|""` | `contact0Name` in cascade | Yes (§6.C, §13 #14) | Pass | A | |
| Project siteType/capacity blank | hardcoded `""` | hardcoded `''` | Yes (§6.C) | Pass | A | |
| Project status/engs/vendor/dc defaults | `"Ongoing"`,`[]`,`""`,`[]` | same | Yes (§6.C) | Pass | A | |
| Checklist template resolution (3-step fallback) | `defaultChkList`+legacy | `resolveChecklist` | Yes (§13 #7) | Pass | A | |
| Checklist copy (not reference) | `chkName`/`chk` copied | `checklistTemplateName`/`checklist` copied | Yes (§6.D) | Pass | A | |
| Checklist usability downstream (tick) | implicit (checklist UI works on any Project) | `projectService.setChecklistItemDone` | Yes (§6.D) | Pass | A/B | PM/assigned-engineer gate + timeline-ready gate are B (server enforcement PWA never had) |
| Timeline-must-be-set-before-tick gate | not explicitly separated in PWA source read for this pass | `TIMELINE_NOT_READY` | Yes (§6.D, discovered live) | Pass | D | Established by Pass 3.3/3.4; re-confirmed intersecting here, not re-derived from PWA source in this pass — flagged as D pending a source citation from those passes' own docs |
| Payment milestone creation | `saveSO` step 4 | `runCreationCascade` payment loop | Yes (§6.E) | Pass | A | |
| Payment remark literal text | `"SO "+no+" milestone "+(i+1)+": "+d` | template literal, identical | Yes (§6.E) | Pass | A | |
| `syncPayStatus` (received sync-back) | L3877-3882 | `paymentService.addPartPayment`→sync | Yes (§6.E) | Pass | A | |
| SO-creation notifications (2, exact text) | `saveSO` step 6 | `runCreationCascade` notification block | Yes (§6.F) | Pass | A | |
| Role gate: create (sales/admin) | UI-only in PWA | server-enforced `CREATE_ROLES` | Yes (§6.G) | Pass | B | PWA has zero function-level check; new backend adds real one, matches locked decision |
| Tenant isolation (SO, Project) | N/A (PWA is single-tenant-per-session) | `requireCompanyContext`+repo scoping | Yes (§6.H) | Pass | B | |
| Duplicate-conversion guard | none in PWA | `markWonIfOpen` + unique index | Yes (§6.I, §14) | Pass | B | |
| Project unique-per-SalesOrder DB constraint | none in PWA | `{companyId,salesOrderId}` unique index | Not directly race-tested (no code path can violate it given the guard above) | N/A | B | Defense-in-depth backstop |
| SO editing (no re-cascade) | `saveSO` id-branch | `salesOrderService.editSalesOrder` | Covered by existing tests (not re-run live this pass — out of Pass 3.2's own creation-cascade scope, belongs to the SO module generally) | Pass (via test suite) | A | |
| SO list/report (`dlSOs`) | L3484-3496 | `exportSalesOrdersCsv` | Covered by existing tests | Pass (via test suite) | A | |
| `mRaise`/`doRaise` (raise to finance) | L2335-2360 | `paymentService.raiseToFinance` | Not re-executed live this pass (source-inspected only, §9) | Pass (source + existing coverage) | A | |
| Malformed/invalid ObjectId handling | N/A (PWA has no ObjectIds) | route-level CastError → generic 500 | Partially (§13 #13) | D | D | Cross-cutting concern shared by every module, not unique to this pass |

## 16. All findings (classification A/B/C/D)

1. **A. EXACT PWA PARITY** — the entire creation cascade (SalesOrder fields, fused Project
   creation and its defaults, Payment creation, notification text) reproduces the PWA exactly,
   confirmed by fresh source re-trace and live execution.
2. **B. AGREED INFRA/SECURITY ADAPTATION** — server-side role enforcement (`CREATE_ROLES` etc.),
   tenant isolation, the Enquiry duplicate-conversion guard (`markWonIfOpen` + unique index), and
   the `Project.js` unique `{companyId, salesOrderId}` index. All are locked, already-decided
   departures from the PWA's own absence of these protections, correctly implemented and verified
   live.
3. **B. AGREED INFRA/SECURITY ADAPTATION** — the PM-or-assigned-engineer gate and
   timeline-must-be-set gate on checklist ticking (established by prior passes, re-confirmed live
   here as a real, working, non-bypassable server check). Not a Pass 3.2 defect since it was
   discovered functioning correctly, not broken.
4. **D. UNDEMONSTRATED/NEEDS EVIDENCE** — malformed/invalid ObjectId handling at the route layer
   (generic 500 rather than a typed 400) is a cross-cutting pattern shared by every already-passed
   module in this engagement, not something unique to or newly introduced by the SalesOrder→Project
   cascade. Recorded here for completeness (edge case #13) but **not** assigned a new FIX ID
   because it would be indistinguishable from re-litigating a decision already implicitly accepted
   across every other completed pass; flagged instead as a candidate for a future,
   engagement-wide hardening pass if the business wants typed 400s for malformed ids everywhere.
5. **No C. DEFECT/MISSING BEHAVIOR was found** in the SalesOrder→Project cascade itself. The
   module is materially more complete than the stale `PWA_COVERAGE_AUDIT_SALESORDER.md` document
   implies (see §5's correction) — the Payment ledger, milestone-raise workflow, standalone SO
   creation, editing, listing, and CSV export are all implemented and passing, not merely
   schema-only as that document states.

## 17. FIX IDs assigned

**None.** No P0/P1/P2/P3 defect was found in the SalesOrder→Project cascade during this pass. The
one D-classified item (§16.4, malformed-id handling) is an existing, engagement-wide pattern, not
a new or isolated defect in this workflow, and assigning it a Pass-3.2-specific FIX ID would
mischaracterize its scope.

## 18. Verdict

**PASS 3.2 = PASS.**

This verdict reflects actual execution of the complete SalesOrder→Project workflow against real
service code and real test data (§6), not merely a passing test count. The full regression suite
remains green at 365/365 (§6a), targeted tests (68/68) all pass, the dedicated E2E script's 15
edge cases and the A-I scenario checklist all produced correct, PWA-consistent, evidence-backed
results, tenant isolation and role enforcement were verified live, and the safety baseline is
unchanged before and after (§3).

## 19. Exact next action

None required by this pass. `E2E_PASS_3_8_MASTER_RECONCILIATION.md`'s existing finding ("Pass 3.2
report file missing", P3, OPEN) should be marked resolved the next time that document is touched,
since Pass 3.2 is now genuinely complete with its own dedicated report. Per this task's explicit
instruction, Stage 6's remaining audit work and Stage 7 (frontend) are **not** started here.
