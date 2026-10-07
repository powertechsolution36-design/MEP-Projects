# STAGE 6 — WORKSTREAM E: CROSS-MODULE / ACCOUNT RELATION VERIFICATION

Executed 2026-09-27 against the live repo at `C:\Projects\MEP-Projects` via
the connected-device bridge. Phase A, read-only — no `new-app/` source,
test, `v2/`, `v3/`, or PWA file was modified in this workstream.

This workstream does **not** repeat Workstreams A-D (endpoint reconciliation,
API contract, PWA function coverage, report/export audits) and does **not**
re-decide FIX-6-05/06/07 (Payment report scope split, Payment receipts CSV
ordering, Project CSV column gap) — those remain OPEN, unfixed, reserved for
the later consolidated Stage 6 fix pass, exactly as directed. It also does
not start Stage 7.

## 1. Objective and methodology

Objective: explicitly trace, with real code evidence (not entity-existence
narrative), whether the four PWA-demonstrated cross-module chains are
actually *connected* end-to-end in `new-app/backend`, and explicitly confirm
that the seven known PWA NO-RELATION boundaries are correctly **absent**
from the new implementation (not silently invented).

Method used:

1. Read every model file touched by a chain (`new-app/backend/src/models/*`)
   to confirm/deny FK fields the chain requires or the boundaries forbid.
2. Read the actual service-layer function bodies
   (`new-app/backend/src/services/*.js`) that PWA source shows perform each
   transition, confirming each is a real, callable, transactional write that
   invokes the *next* link's repository/service — not just that the next
   link's entity exists in isolation.
3. Grepped the whole backend (`models/`, `services/`, `routes/`,
   `repositories/`) for any accidental implementation of a NO-RELATION
   boundary (a repo call, a populate/`$lookup`, a schema field) that would
   contradict the PWA's demonstrated absence of that relation.
4. Ran the specific existing test files that already exercise each chain's
   code paths, live, this session (not cited from memory) as executable
   proof the linkage behaves as traced. No full 365-test regression was
   re-run — no code was changed in this workstream (per the task's own
   testing rule) — but 209 targeted tests across the six most relevant
   service test files were executed fresh this session with 0 failures
   (§8).
5. Cross-referenced the shared audit/decision documents
   (`salesOrderCascade.js`, `SERVICECALL_DECISION_LOCK.md`-cited comments,
   `INVENTORY_DECISION_LOCK.md`-cited comments) only to corroborate, never
   to substitute for, the direct source read.

## 2. Commercial chain

**Enquiry → SalesOrder → Project → Checklist → Payment → Notifications**

| Link | Classification | Evidence |
|---|---|---|
| Enquiry → SalesOrder | **A** | `enquiryService.js:488` `convertEnquiryToSalesOrder()`: loads the Enquiry, requires `status==='Open'`, rejects a second conversion via `salesOrderRepo.findByEnquiryId` pre-check **and** the DB-level unique sparse index `SalesOrder.js` `{enquiryId:1}`, then atomically marks the Enquiry Won (`enquiryRepo.markWonIfOpen`) and calls `cascade.runCreationCascade(...)`, all inside one `deps.withTransaction`. `SalesOrder.enquiryId` (`SalesOrder.js`) is the durable back-reference, set only by this cascade, never client-editable. |
| SalesOrder → Project | **A** | `salesOrderCascade.js` `runCreationCascade()`: after creating the SalesOrder, unconditionally creates exactly one `Project` via `deps.projectRepo.create(...)` in the SAME transaction, with `salesOrderId: salesOrder.id` (enforced unique per `Project.js` `{companyId,salesOrderId}` index), `division`/`stage`/`customer` derived from the SO, never the Enquiry. |
| Project → Checklist | **A** | Same `runCreationCascade()` call: `resolveChecklist(companyId, draft.division, deps)` runs the full verified 3-step fallback (`checklistTemplateRepo.findDefaultForDivision` → `LEGACY_CHECKLIST_FALLBACK` → empty) and the resulting `checklist` array is written directly onto the new `Project.checklist` field in the same `projectRepo.create` call — copy-on-create, not a lazy join. Execution-time checklist item completion/approval/delay logic is further verified in `projectService.js` (`toggleChecklistItem`, `approveChecklistItem`, ~lines 570-800), each writing `project.checklist` and firing notifications (§ below). |
| Checklist → Payment | **A (as PWA-scoped: parallel creation + read-only visibility, not a create-trigger)** | The PWA never derives a Payment from checklist completion — Payments are created once, per milestone, from the SalesOrder at cascade time (`runCreationCascade()`'s payment loop, `deps.paymentRepo.create(...)` per `draft.paymentMilestones[i]`, `salesOrderId`+`milestoneIndex` set). The Project↔Payment relationship that *does* exist is a read-only visibility link: `projectService.js` `buildProjectReportSections()` (~line 1201-1213) reads `so.paymentMilestones` and, per milestone, `deps.paymentRepo.findBySalesOrderAndMilestone(...)` to build the Project report's payment-milestone table — exactly matching the master relationship matrix's classification of this as "Project → Payment-visibility". No code path lets completing a checklist item create, mutate, or unlock a Payment. This matches the PWA exactly (verified previously in Workstream C/passes 3.1-3.3) and is not a broken link — it is correctly modeled as two sibling branches of the same SalesOrder cascade, joined at read time for reporting. |
| Payment → Notifications | **A** | `salesOrderCascade.js` fires the "payment terms added to pending payment list" notification (`targetRoles:['finance']`) as part of the same cascade transaction; `paymentService.js` `addPartPayment()` fires "Payment fully received" / "Part payment received" notifications on every part-payment write (§4 has the full Finance-chain notification trace). |

**Commercial chain verdict: PASS — A on every link**, with the
Checklist→Payment link correctly modeled as parallel-creation +
read-only-visibility rather than a create-trigger, matching the PWA's own
behavior (re-confirmed, not re-derived from scratch, against Workstream C's
prior finding).

## 3. Finance chain

**SalesOrder → Milestones → Payment → Part Payment → Received → Raise to Finance → Finance Follow-up → Notifications**

| Link | Classification | Evidence |
|---|---|---|
| SalesOrder → Milestones | **A** | `SalesOrder.js` embeds `paymentMilestones: [paymentMilestoneSchema]` (max 5, `SalesOrderCascade.js` `validateSalesOrderDraft` enforces the cap) directly on the SalesOrder document. |
| Milestones → Payment | **A** | `salesOrderCascade.js` `runCreationCascade()`: one `deps.paymentRepo.create(...)` per milestone at SO-creation time, `salesOrderId`+`milestoneIndex` set, unique-indexed (`Payment.js` `{companyId,salesOrderId,milestoneIndex}`). A milestone missing its Payment (e.g. legacy data) is self-healed on demand by `paymentService.js` `raiseToFinance()` (creates it "on the fly with the same field shape as the original creation cascade" — line ~404-419), matching PWA's `mRaise`/`doRaise` fallback-create behavior exactly. |
| Payment → Part Payment | **A** | `paymentService.js` `addPartPayment()` (line 136): validates amount>0, gates overpayment behind `confirmOverpayment`, re-validates the balance *inside* the transaction (FIX-5-01 concurrency hardening) before `txnDeps.paymentRepo.pushPartPayment(...)`. |
| Part Payment → Received | **A** | `paymentService.js` `syncPayStatus()` (line 63): recomputes `status`/`receivedDate` from `computeBalance()`; when `balance<=0` sets `status:'Received'`; called at the end of every `addPartPayment`/`editPartPayment`/`removePartPayment` call. |
| Received → milestone sync (SalesOrder write-back) | **A** | Same `syncPayStatus()`: "ONE place a Payment mutation is allowed to touch the SalesOrder" — calls `deps.salesOrderRepo.setMilestoneReceived(companyId, payment.salesOrderId, payment.milestoneIndex, balance<=0, session)`, correctly allowing the flag to flip back to `false` if a part-payment is later edited down (PWA FACT, intentionally not "fixed"). |
| Received/Pending → Raise to Finance | **A** | `paymentService.js` `raiseToFinance()` (line 386): role-gated (`hvac_pm`/`solar_pm`/`mep_pm`/`admin`, division-checked against the SO — a locked, approved server-side authorization strengthening over the PWA's own unchecked function), stamps `raisedToFinance{raisedByUserId,raisedByRole,raisedDate,collectByDate,priority,note}` on the Payment. |
| Raise to Finance → Finance Follow-up | **A** | `paymentService.js` `addFollowUp()` (line 358): updates `lastCallDate`/`nextCallDate`/`discussionNotes`/`remark` on the same Payment record — the Finance team's ongoing collection-follow-up loop on a raised/pending Payment. |
| → Notifications (every step) | **A** | Confirmed notification fan-out at each step: cascade-time "payment terms added" (`finance`); `addPartPayment` → "fully received"/"part payment received" (`admin`,`sales`); `raiseToFinance` → urgent-prefixed raise notification with **"Collect by `<date>`" clause present** (`finance`,`admin`) — this clause was the subject of the now-RESOLVED FIX-3.7-02 (confirmed live in source this session: `paymentService.js` line ~437 reads `` `...Collect by ${dueByDate || ''}.` `` — present, not dropped, consistent with the engagement's locked "FIX-3.7-02 RESOLVED" status). |

**Finance chain verdict: PASS — A on every link**, including the
SalesOrder↔Payment two-way milestone-sync boundary (the one deliberate,
documented exception to "Payment never writes back to SalesOrder" — itself
a PWA-exact, not an invented, behavior).

## 4. Service chain

**Project → Contract (where PWA permits) → ServiceCall → Engineer → Report → Signature → Completion → Payment (when chargeable) → Notifications**

| Link | Classification | Evidence |
|---|---|---|
| Project → Contract (commissioning) | **A** | `contractService.js` `convertProjectToContract()` (line 288): role-gated (`service_mgr`/`admin`), requires `projectService.isEligibleForServiceConversion(project)` (Completed + not MEP — `CONTRACT_DECISION_LOCK.md` Decision 9/10, reused verbatim, no extra guard invented), creates the `Contract` with `originatingProjectId: project.id`, flips `Project.status` to `'In Service'` in the **same transaction**, and fires the commissioning-approved notification (`service_mgr`,`admin`). |
| Contract → ServiceCall (PM-visit generation) | **A** | `serviceCallService.js` `schedulePM(contractId, ...)` (line 332): loads the Contract (`deps.contractRepo.findById`), pre-fills customer/phone/site from it (one-time copy, not a live reference — PWA FACT), and creates the ServiceCall with `contractId` set (`type:'PM'`, `complaintDescription:''`). This is the forward reference `ServiceCall.contractId` (`ServiceCall.js`, nullable) — confirmed the *only* direction (§6). |
| ServiceCall → Engineer | **A** | `serviceCallService.js` `assignEngineer()` (line 530): role-gated, rejects on `status==='Completed'`, writes `ServiceCall.engineerId` (`User` ref), fires an assignment notification on every save with a non-blank engineer (PWA quirk, preserved, no dedup). |
| Engineer → Report | **A** | `serviceCallService.js` `saveReportDraft()` (line 600): rejects edits once `status==='Completed'`; builds and writes `ServiceCall.report` (make/model/capacity/serviceType/amount/etc., `reportSchema`). |
| Report → Signature → Completion | **A** | `serviceCallService.js` `completeServiceCall()` (line 632): the SOLE hard gate is a non-empty `signature` (PWA FACT, `_sg.empty` check) — rebuilds/replaces the report unconditionally, writes `clientSignatureImage`, then atomically transitions `status:'Completed'` via `serviceCallRepo.completeIfNotCompleted` (the approved atomicity strengthening over the PWA's unguarded resave, preventing a duplicate side-effect on a network retry/race — INFRASTRUCTURE-ONLY DIFFERENCE, not a functional change). |
| Completion → Contract PM-slot update | **A** | Same `completeServiceCall()`, inside the transaction: `if (updated.contractId) { await contractService.completePmVisitForContract(updated.contractId, actorAuth, txnDeps, {assignedEngineerUserId: updated.engineerId}) }` — reuses the existing Contract-facing function (`SERVICECALL_DECISION_LOCK.md` §14/§15, "reuse the existing Contract-facing boundary EXACTLY as built"), which stamps the next-due scheduled visit (`due[0]` quirk, `DO NOT FIX`, preserved). |
| Completion → Payment (chargeable) | **A** | Same `completeServiceCall()`: `if (report.serviceType==='Chargeable' && report.amount>0)` writes a `Payment` directly via `txnDeps.paymentRepo.create(...)` (never through `paymentService.createManualPayment`, deliberately, because that function's `LEDGER_ROLES` gate doesn't match the PWA's actual completing-actor set — PWA FACT, "no separate Payment-service abstraction exists"), with `salesOrderId:null` (write-only, no FK back to the ServiceCall — confirmed boundary, §6). |
| → Notifications (every branch) | **A** | Chargeable branch fires a `finance`-targeted "to collect from `<customer>`" notification; an **unconditional** completion notification (`service_mgr`,`admin`) fires "regardless of the Contract/Payment branches above" (line ~732 comment, verified against the actual unconditional placement in source). |

**Service chain verdict: PASS — A on every link.**

## 5. Inventory chain

**User/Staff → Inventory Issue → Project context (where demonstrated) → Return / Mark Used / Transfer → Inventory Transactions → Notifications**

| Link | Classification | Evidence |
|---|---|---|
| User/Staff → Inventory Issue | **A** | `inventoryService.js` `issueMaterial()` (line 422): validates the recipient (`staffId`) exists, is same-company, and `RECIPIENT_ROLES.includes(staff.role)` (every role except `admin` — PWA FACT, Decision 40); inside a transaction, decrements stock (`incrementStockAtLocation`) and creates the `InventoryIssue` with `staffId` set. |
| Inventory Issue → Project context | **F-adjacent / write-only, matches PWA (see §6 boundary #6)** | Same `issueMaterial()`: `projectId: src.projectId || null` is written onto the `InventoryIssue` but is never read back anywhere — confirmed by a repo-wide grep (§7) finding zero references to `InventoryIssue` in `projectService.js` or any Project-facing route. This is the documented write-only field (Decision 43), correctly modeled as one-directional, not a broken chain link. |
| Inventory Issue → Return | **A** | `inventoryService.js` `requestReturn()`/`acceptReturn()` (line 524/554): `acceptReturn` re-validates the balance *inside* the transaction (FIX-5-01), conditionally credits stock back (`incrementStockAtLocation`, skipped when `damaged`), updates `quantityReturned`/`status` via `issStatus()`, and — for a damaged return — separately writes a "Damage / Write-off" transaction alongside the "Return" transaction (Decision 23). |
| Inventory Issue → Mark Used | **A** | `inventoryService.js` `markUsed()` (line 702): re-validates balance inside the transaction, increments `quantityUsed`, **deliberately never calls `incrementStockAtLocation` again** (Decision 24 — stock was already decremented once, at issue time — explicitly commented in source and confirmed no second stock mutation exists in this function), writes a `'Consumed'` `InventoryTransaction`. |
| Inventory Issue → Transfer | **A** | `inventoryService.js` `transferStock()` (line 764): rejects same-location transfer, decrements the From location and credits the To location in the same transaction, writes a `'Transfer'` `InventoryTransaction`; confirmed no notification fires for Transfer (Decision 26, matching the PWA). |
| → Inventory Transactions (ledger) | **A** | Every stock-affecting function above (`issueMaterial`, `acceptReturn`, `markUsed`, `transferStock`, plus `adjustStock` not itself part of this chain) writes to the single append-only `InventoryTransaction` collection — confirmed no second stock ledger exists anywhere in the models or services (`InventoryTransaction.js`'s own header comment, corroborated by the grep in §7 finding no competing ledger writes). |
| → Notifications | **A** | `issueMaterial()` fires an unconditional "Material issued to `<staff>`" notification (`targetRoles:['*']`) plus a conditional low-stock notification (`inventory`,`admin`) when `stockState(...)` crosses a threshold — confirmed as the ONLY path that fires the low-stock notice (Decisions 36-38: never from Adjustment/Transfer/Return). `markUsed`/`transferStock` correctly fire **no** notification (Decisions 25-26, confirmed by their absence of any `notificationRepo.create` call in the read source above). |

**Inventory chain verdict: PASS — A on every link**, with the
Issue→Project-context link correctly classified as the documented
write-only, non-functional field rather than a defect.

## 6. NO-RELATION boundary confirmations (all 7)

Each confirmed by direct source inspection this session, not carried
forward from memory:

1. **Checklist has no direct User FK.** `Project.js`'s
   `checklistExecutionItemSchema` (the executed checklist) has no top-level
   `userId`/owner FK — only `signResponsibility` (a role string) and, inside
   the nested, optional `approval` sub-document, `enteredByUserId` (who
   *recorded* an approval action, not an owner FK on the checklist point
   itself). `ChecklistTemplate.js`'s `templateItemSchema` likewise has no
   per-item User FK (only the template-level `createdByUserId`, a template
   metadata field, not a per-item relation). **CONFIRMED NOT IMPLEMENTED.**
2. **Enquiry/SalesOrder have no direct User FK.** `Enquiry.js` and
   `SalesOrder.js` were read in full (§ model dump) — neither schema
   contains any `Schema.Types.ObjectId, ref:'User'` field anywhere. Role
   gates (`sales`/`admin`/PM roles) are enforced in the service layer by
   role string only, never a stored assigned-user id. **CONFIRMED NOT
   IMPLEMENTED.**
3. **Inventory → ServiceCall = NO RELATION DEMONSTRATED.** Repo-wide grep
   (`grep -n "serviceCall\|ServiceCall" inventoryService.js`) returns zero
   functional hits — the only textual occurrence in the whole Inventory
   module is a documentation comment ("no structural ServiceCall link
   (Decision 44)"). `serviceCallService.js` contains zero references to any
   Inventory repository (`inventoryIssueRepo`/`inventoryItemRepo`/
   `inventoryTransactionRepo` — confirmed absent by grep). **CONFIRMED NOT
   IMPLEMENTED.**
4. **Inventory → Finance = NO RELATION DEMONSTRATED.** `inventoryService.js`
   contains zero references to `paymentRepo`/`Payment` (confirmed by grep,
   §7); `paymentService.js` contains zero references to any Inventory
   repository. **CONFIRMED NOT IMPLEMENTED.**
5. **Inventory → Checklist = NO RELATION DEMONSTRATED.** `inventoryService.js`
   contains zero references to `checklist`/`Checklist` beyond the module
   header's own documentation-comment mention of the PWA's `mep_pm` menu not
   including "stock" (an authorization note, not a relation); no Checklist
   or `checklistTemplateRepo`/Project-checklist code path references any
   Inventory entity. **CONFIRMED NOT IMPLEMENTED.**
6. **InventoryIssue.projId is write-only** (no Project-side read-back).
   `issueMaterial()` writes `projectId` onto the `InventoryIssue` document;
   a repo-wide grep for `InventoryIssue` across `models/`, `routes/`, and
   `services/` (excluding `inventoryService.js` itself) returns **zero
   matches** — `projectService.js` never reads, joins, or references
   `InventoryIssue` in any form (no field on `Project.js` holds issued
   materials, no aggregation/populate anywhere in
   `businessRepositories.mongoose.js`, confirmed no `populate`/`$lookup`/
   `aggregate` call exists in that file at all). **CONFIRMED NOT
   IMPLEMENTED** (write-only, exactly matching the PWA).
7. **Contract → ServiceCall reverse reference does NOT exist** (only
   ServiceCall → Contract forward). `Contract.js` has no
   `serviceCalls`/`scheduledCalls` array or any field referencing
   `ServiceCall` — confirmed by a full read of the model and a targeted
   grep (`grep -rn "serviceCalls\s*:" models/` → zero matches). The
   relationship is exclusively the forward `ServiceCall.contractId`
   (nullable `ObjectId ref:'Contract'`). `serviceCallService.js`'s own
   module-header comment explicitly documents this as a locked design fact:
   "No reverse Contract->ServiceCall list; no duplicate-PM-call guard."
   **CONFIRMED NOT IMPLEMENTED.**

**All 7 boundaries: CONFIRMED CORRECTLY ABSENT. No unexpected relation was
found implemented for any of them.**

## 7. Supporting greps (raw evidence for §5/§6)

Run live this session from `new-app/backend/src`:

```
$ grep -n "serviceCall\|ServiceCall|paymentRepo|Payment|checklist|Checklist" services/inventoryService.js
66: *    write-only/non-functional (Decision 43); no structural ServiceCall
84:// (`[dash,projects,sos,checklists]`) never includes "stock" -- mep_pm never
        (both are documentation comments, not code — zero functional matches)

$ grep -n "InventoryIssue|inventoryIssue|issueRepo" services/projectService.js
        (zero matches)

$ grep -n -i "inventory" services/serviceCallService.js
        (zero matches)

$ grep -rn "serviceCalls\s*:" models/
        (zero matches)

$ grep -rln "InventoryIssue" models/ routes/ services/ | grep -v inventoryService.js
        (zero matches)

$ grep -n "inventoryIssueRepo|inventoryItemRepo|inventoryTransactionRepo" \
      services/serviceCallService.js services/paymentService.js \
      services/projectService.js services/checklistTemplateService.js
        (zero matches)

$ grep -n "populate|\$lookup|aggregate" repositories/businessRepositories.mongoose.js
        (zero matches — no cross-collection joins exist anywhere in the
        repository layer that could implicitly implement a forbidden
        relation)
```

## 8. Findings

**No genuine missing/broken chain link (classification D) was found in any
of the four chains.** Every link traced to a real, transactional,
service-layer implementation matching the PWA's demonstrated behavior, and
every NO-RELATION boundary was confirmed correctly absent. No new
`FIX-6-08` (or higher) is opened by this workstream.

One pre-existing, already-tracked item is re-confirmed (not newly found)
during this trace and is called out for completeness, not as a new finding:
the "Collect by `<date>`" clause in the `raiseToFinance` notification (§3)
is present in current source, consistent with the engagement's locked
"FIX-3.7-02 RESOLVED" status — cited here only as corroborating evidence for
the Finance chain's Notifications link, not as new work.

## 9. Test evidence used/run

No code was changed in this workstream, so the full 365-test regression
suite was not re-run (per the task's own instruction) — the existing
365/365 baseline is cited as-is. Because the sandbox's `npm test` (all
files) exceeded the device-bridge's per-call timeout twice (120s and 180s
caps, both hit without completing), **targeted test files covering every
chain traced above were run individually, live, this session**, as
executable proof of the linkage (not merely cited from memory):

| Test file(s) run | Chain(s) covered | Result |
|---|---|---|
| `tests/enquiryConversion.test.js` | Commercial chain (Enquiry→SO→Project→Checklist→Payment→Notifications cascade) | **9/9 PASS** |
| `tests/projectService.test.js` + `tests/contractService.test.js` | Commercial (Project/Checklist), Service (Project→Contract) | **61/61 PASS** |
| `tests/serviceCallService.test.js` + `tests/paymentService.test.js` | Service chain (Contract→ServiceCall→Engineer→Report→Signature→Completion→Payment), Finance chain (Payment/PartPayment/Raise) | **70/70 PASS** |
| `tests/inventoryService.test.js` + `tests/salesOrderService.test.js` + `tests/notificationService.test.js` | Inventory chain, SalesOrder→Milestones, Notification fan-out | **69/69 PASS** |
| **Total targeted, run fresh this session** | | **209/209 PASS, 0 failures** |

No test was modified, skipped, or weakened to obtain these results. This
supplements, and is consistent with, the engagement's locked full-suite
baseline of 365/365 (unchanged, since this workstream made no code edits).

## 10. Workstream E verdict

**WORKSTREAM E = PASS.**

All four chains (Commercial, Finance, Service, Inventory) are verified
link-by-link with real source-code evidence (transactional service
functions actually invoking the next link's repository/service, not mere
entity co-existence). All 7 NO-RELATION boundaries are confirmed, by direct
model inspection and repo-wide grep, to be correctly absent from
`new-app/backend`. No genuine missing/broken chain link (classification D)
was found; no new `FIX-6-08`+ is opened.

## 11. Explicit note on deferred fixes

**FIX-6-05, FIX-6-06, and FIX-6-07 (all identified in Workstream D — Payment
report scope split, Payment receipts CSV ordering, Project CSV missing
columns/role gate) were NOT touched, NOT fixed, and NOT re-evaluated in this
workstream**, per the user's explicit decision to finish Workstream E first
and batch all Stage 6 fixes into one consolidated fix pass at the end. They
remain OPEN exactly as Workstream D left them, awaiting that later
consolidated pass.

## 12. Exit status

Workstream E is complete for all four required chains and all seven
required boundaries. Do NOT start Stage 7. Awaiting instruction for the
consolidated Stage 6 fix pass (FIX-6-05, FIX-6-06, FIX-6-07 — no new items
from this workstream).
