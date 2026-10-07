# E2E Pass 3.1 — Enquiry → SalesOrder → Payment / Finance

**PASS:** 3.1
**STATUS:** PASS
**DATE:** 2026-09-23
**WORKFLOW:** Enquiry → Follow-up → Won/Lost/Reopen → Conversion → SalesOrder → SO Checklist (SO side) → Payment Milestones → Payment Collection/Part Payment → Raise to Finance → Finance Follow-up/Reports → Notifications

This is a verification/documentation-only report. No file under `new-app/backend/src/`, no test file, no PWA copy, and no v1/v2/v3 file was modified while producing it. This report supersedes, for the Enquiry/SalesOrder/Payment/Finance workflow only, the implementation-status claims (not the field/behavior facts) of `PWA_COVERAGE_AUDIT_SALESORDER.md` §4/§8/§10/§18/§21/§22 — those sections were written **before** `salesOrderService.js`, `salesOrderCascade.js`, and `paymentService.js` existed, and this pass independently re-verified against the code that exists **now**. All PWA field/behavior facts in that document and in `PWA_COVERAGE_AUDIT_ENQUIRY.md` were spot-checked directly against `MEP_PROJECTS_PWA/index.html` in this pass and found accurate; only the "not yet implemented" implementation-status labels were stale.

---

## 1. Documents Read

`E2E_WORKFLOW_VERIFICATION_PLAN.md` (394 ln), `PWA_MASTER_WORKFLOW_AND_CONNECTION_AUDIT.md` (564 ln, referenced for §8 workflow-to-source index and §13 notify() baseline), `API_CONTRACT.md` (436 ln), `STAGED_IMPLEMENTATION_PLAN.md` (464 ln), `DOCUMENT_AUTHORITY.md` (25 ln), `OPEN_DECISIONS.md` (167 ln, decisions #19/#20 for Enquiry↔SO), `PWA_COVERAGE_AUDIT_ENQUIRY.md` (267 ln), `PWA_COVERAGE_AUDIT_SALESORDER.md` (574 ln, this document *is* the SalesOrder+Payment audit — no separately-named Payment doc exists), `ENQUIRY_BUSINESS_DECISION_SHEET.md`, `ENQUIRY_DESIGN_DECISION_REVIEW.md`, `CONTRACT_DECISION_LOCK.md` (skimmed, not this workflow), plus direct source: `MEP_PROJECTS_PWA/index.html`, `new-app/backend/src/services/{enquiryService.js,salesOrderService.js,salesOrderCascade.js,paymentService.js}`, `new-app/backend/src/routes/{enquiryRoutes.js,salesOrderRoutes.js,paymentRoutes.js}`, `new-app/backend/src/models/Notification.js`, `new-app/backend/src/middleware/tenantGuard.js`, `new-app/backend/tests/{enquiryService.test.js,enquiryConversion.test.js,salesOrderService.test.js,paymentService.test.js,audit-corrections.test.js}`.

`PROJECT_DECISION_LOCK.md`, `SERVICECALL_DECISION_LOCK.md`, `PWA_COVERAGE_AUDIT_PROJECT.md` are out of scope for this pass (Pass 3.2/3.3/3.4 territory) — noted as located, not traced here except at the Project handoff boundary (§23 below).

---

## 2. Safety Baseline (BEFORE)

```
git diff --name-status -- v2      -> 37 files (matches locked baseline)
git diff --name-status -- v3      -> 0 files (matches locked baseline)
git status --short                -> 95 entries pre-existing (not from this task); new-app/ shows only as "?? new-app/" (fully untracked, nothing staged inside it)
md5sum index.html MEP_PROJECTS_PWA/index.html -> both 111b53dba91704f96b83dae96c7793c6 (required, matches)
git diff --cached --name-status   -> 0 (nothing staged)
```
All required conditions met before any work in this pass began.

---

## 3. Pass Objective (restated)

Trace and verify the complete chain Enquiry → Follow-up → Won/Lost → Reopen → Conversion → SalesOrder → SO Checklist → Payment Milestones → Payment Entry → Part Payment/Received → Raise to Finance → Finance Follow-up → Reports/Export → Notifications, against `MEP_PROJECTS_PWA/index.html` as sole business authority, and record whether `new-app` reproduces it, per-behavior, with source evidence and classification. **Finding, stated up front:** the actual `new-app` implementation is materially more complete for this workflow than `PWA_COVERAGE_AUDIT_SALESORDER.md` describes — that document's §18 workflow table ("2 implemented, 2 partial, 8 not implemented") is now obsolete; current code implements essentially the full traced PWA behavior for Enquiry/SalesOrder/Payment/Finance, with only notification *delivery* (B1) and two narrow, already-classified fidelity gaps remaining (see §12/§34).

---

## 6-7. PWA Source Trace + Field-Level Checklist — Enquiry Lifecycle

Independently re-verified this session by direct grep of `MEP_PROJECTS_PWA/index.html` against `PWA_COVERAGE_AUDIT_ENQUIRY.md`'s claims (no discrepancy found — the audit is accurate and is cited as the evidence source below rather than re-transcribed field-by-field, per the source-of-truth rule that a locked PWA audit is authority tier 2, itself derived from tier-1 source). Confirmed anchors:

| PWA function | Line | Behavior |
|---|---|---|
| `mEnq(id)` | 1975 | Create/edit modal builder, UI defaults only |
| `saveEnq(id)` | 1990 | Validates `name` only; create sets system defaults (`status:"Open"`, `review:today()`, `log:[]`); edit does `Object.assign` of 8 fields, no log entry |
| `addFollow(id)` | 2016 | Requires `f_done`; overwrites `done/next/nextDate`, refreshes `review`, appends one `log` entry |
| `markLost`→`doMarkLost(id)` | (doMarkLost) | Joins reason picklist + free text with `" — "`, unconditional (reason optional); sets `status="Lost"`, `lostReason`, `lostDate`; appends `log` |
| `reopenEnq(id)` | — | UI-gated to `status==="Lost"`; sets `status="Open"`; appends `log`; does **not** clear `lostReason`/`lostDate` |
| `mSO(0,enqId)`→`saveSO(id,enqId)` | 2075 | Conversion entry point (traced fully in §9 below) |
| `dlEnq()` / `dlEnqReport` (alias) | 3566 | CSV export, exact column order per audit §10 |

**Field-level checklist (19 fields total, all traced in `PWA_COVERAGE_AUDIT_ENQUIRY.md` §3/§14):** Company/tenant (`co`→`companyId`, MATCH), Enquiry identifier (`id`, no PWA display number exists — MATCH, N/A gap), Client/customer info (`name`, MATCH), Contact info (`phone`, MATCH — no separate contact-name/email field exists on Enquiry itself), Source/reference (`ref`→`referenceSource`, MATCH), Assigned user/staff (**none exists on PWA Enquiry at all** — no `salesUserId`/`createdBy`; `new-app`'s `Enquiry.js` was independently checked and likewise has no owner field — MATCH, both absent by design), Status (`status` enum `Open|Won|Lost`, MATCH — `Contacted`/`Quoted` correctly excluded as V2-API-only vocabulary, confirmed absent from the Enquiry model's status enum, which is `['Open','Won','Lost']` only), Follow-up info (`done/next/nextDate/review`→`lastActionDone/nextActionDescription/nextActionDate/lastReviewDate`, MATCH), Lost reason (`lostReason`, optional, MATCH — `markLost` has no required-reason guard), Lost date (`lostDate`, MATCH), Reopen behavior (`lostReason`/`lostDate` NOT cleared — **re-verified**, see §8 below, MATCH), Conversion fields (`remark` overwritten, `log` appended, MATCH — see §9), Created/updated info (no separate audit-log field beyond `log[]`, MATCH), Additional fields actually used (`siteType`, `cap`→`capacity`, `seg`→`segment`, `rating`, `value`→`estimatedValue` — all present and typed correctly in `Enquiry.js`, MATCH per prior audit §17, spot-checked against `enquiryService.js`'s `EDITABLE_FIELDS`/`createEnquiry` field list which matches exactly).

No invented CRM-typical fields were found added to `new-app`'s Enquiry beyond the PWA's own 19.

---

## 8. Enquiry Status Transitions (re-verified, including the Lost→Reopen quirk)

| Current | Trigger | Actor | PWA Function | New State | Side Effects | Notification |
|---|---|---|---|---|---|---|
| (none) | Create | `sales` (UI: `admin` create button hidden) | `saveEnq(0)` | Open | system defaults set | none |
| Open | Follow-up | `sales`/`admin` | `addFollow(id)` | Open (unchanged) | `done/next/nextDate/review` overwritten, `log` appended | none |
| Open | Mark Lost | `sales`/`admin` | `doMarkLost(id)` | Lost | `lostReason`,`lostDate` set, `log` appended | none |
| Lost | Reopen | `sales`/`admin` | `reopenEnq(id)` | Open | `log` appended; **`lostReason`/`lostDate` NOT cleared** | none |
| Open | Convert | `sales`/`admin` | `saveSO(0,enqId)` | Won | `remark` overwritten, `log` appended; SO+Project+Payments created | 2 (SO-creation, not Enquiry-specific) |
| Won | — | — | none exists | — | dead end, no revert path | — |

**Re-verification of the Lost→Reopen stale-field claim, direct source evidence:** `reopenEnq` in the PWA source touches only `status` and pushes a `log` entry; there is no `x.lostReason=""` or `x.lostDate=""` assignment anywhere in that function or anywhere else in the file that runs on a reopen. `PWA_COVERAGE_AUDIT_ENQUIRY.md` §5/§12/§13-item-2 states this identically. **Confirmed by direct re-read: the claim is accurate, not merely cited.** `new-app`'s `reopenEnquiry()` (enquiryService.js, doc comment "#18 = A (locked)... lostReason/lostDate are INTENTIONALLY left untouched") reproduces this exactly, and `enquiryService.test.js`'s `'reopenEnquiry — #18=A locked: status becomes Open, log appended, lostReason/lostDate NOT cleared'` test (line 122) asserts it directly. **Classification: MATCH.**

`new-app` adds one behavior the PWA does not have: `reopenEnquiry` throws `INVALID_STATE` (409) if the Enquiry is not currently `Lost` (enquiryService.js, `if (existing.status !== 'Lost') throw ...`). The PWA's own `reopenEnq` has no such guard in its function body (only the UI button is gated) — this is a genuine strengthening, not a PWA fact. **Classification: INFRASTRUCTURE-ONLY DIFFERENCE** (real server-side state-guard replacing UI-only gating, consistent with the locked infrastructure-difference list in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §0).

## 9. Enquiry Conversion → SalesOrder (critical connection)

**Entry point:** Enquiry detail page "✓ Confirmed → Create SO" button (rendered only when `status==="Open"`) → `mSO(0, enqId)` → user edits/confirms the pre-filled form → `saveSO(0, enqId)`. **Actor:** `sales`/`admin` (same UI gate as the Enquiry "Convert" action).

**Source Enquiry lookup / company check (PWA):** `saveSO`'s `if(enqId){ var e=DB.enquiries.find(x=>x.id===enqId); ...}` — no explicit company-match assertion inside `saveSO` itself; the Enquiry is only reachable via the button, which is only rendered on a `mine()`-scoped record, so cross-company access never arises through the UI. **No server-side re-check exists in the PWA** (there is no server).

**Duplicate conversion (PWA):** confirmed no guard — a second `saveSO(0, enqId)` call (e.g. two tabs) re-runs the Won transition and the entire creation cascade a second time, silently. This is PWA FACT, independently re-verified (no `if(e.status!=="Open")return` anywhere in `saveSO`).

**SalesOrder creation / copied fields (re-verified against `saveSO` L2075-2097 and `mSO` L2050-2051, cross-checked with `salesOrderCascade.js`'s `buildSalesOrderDraft`):**

| Enquiry field | → | SO field | Transform |
|---|---|---|---|
| `name` | → | `project`/`projectName` | none |
| `phone` | → | `contacts[0].ph`/`.phone` | none |
| `value`/`estimatedValue` | → | `total`/`totalCost` | none |
| `seg`/`segment` | → | `div`/`division` | `"AMC"→"HVAC"`, else pass-through |
| — | → | `start`/`startDate` | not from Enquiry — `today()` |
| — | → | `salesTeam` | not from Enquiry — converting user's name |
| — | → | `terms`/`termsAndConditions` | not from Enquiry — fixed boilerplate |

Fields NOT copied: `siteType`, `cap`, `ref`, `rating`, `remark`, `review`, `done`, `next`, `nextDate`, `log`, `lostReason`, `lostDate`.

**`enquiryId` behavior:** PWA has **no back-reference field on SO at all** (`saveSO`'s `d`/`so` object never sets an `enqId`). `new-app`'s `SalesOrder.js` has `enquiryId` (nullable, `null` for a standalone SO) — this is a **NEW BACKEND DESIGN** addition (locked decision `#20=D`), not a PWA fact. **Read-back verified, not merely asserted as a field:** `enquiryService.js`'s `convertEnquiryToSalesOrder` sets `enquiryId: id` on creation (WRITE), and its own duplicate-guard reads it back via `deps.salesOrderRepo.findByEnquiryId(companyId, id)` (READ-BACK) before allowing a second conversion — the relationship is a live, read-back one, not merely a stored ID. `SalesOrder.js`'s schema also carries a unique index on `(companyId, enquiryId)` for non-null values (confirmed by the atomicity test `'a race that gets past the pre-check is still rejected atomically'`, which forces the pre-check to pass twice and asserts the second write still fails) — this is `NEW APP WRITE` + `NEW APP READ-BACK` with a durable DB-level constraint, which the PWA has no equivalent of.

**Numbering:** `DB.seq.so++` global counter in PWA (single sequence, cross-tenant, confirmed by `PWA_COVERAGE_AUDIT_SALESORDER.md` §15, re-spot-checked: `DB.seq` object has no `co` keying anywhere it's read/written). `new-app` uses `counterRepo.getNextSequence(companyId, 'salesOrder', session)` — per-company. **Classification: INFRASTRUCTURE-ONLY DIFFERENCE** (already locked in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §0's approved list — multi-tenant correctness requires this).

**Notifications:** exactly 2, fired unconditionally on SO creation (not conditioned on `enqId`) — literal text confirmed identical between PWA (`saveSO` L2094-2095) and `new-app` (`salesOrderCascade.js`'s `runCreationCascade`, the two `notificationRepo.create` calls). **Classification: MATCH** (content/targeting), see §24 for delivery-gap classification (B1).

**Transaction/atomicity:** PWA has none (synchronous in-memory pushes; a browser crash mid-`saveSO` is simply not a concern in a single-threaded demo app). `new-app` wraps the entire cascade — Enquiry Won-transition (atomic conditional update `markWonIfOpen`), counter reservation, SalesOrder create, Project create, N Payment creates, 2 Notification creates — inside one `deps.withTransaction(...)` call (verified in `enquiryService.js`'s `convertEnquiryToSalesOrder`, and directly tested by `enquiryConversion.test.js`'s `'transactional cascade cannot partially succeed: a downstream failure rolls back everything, including the Enquiry Won transition'`, line 146). **Classification: INFRASTRUCTURE-ONLY DIFFERENCE** (atomicity/transaction additions are on the locked approved list).

**PWA WRITE / READ-BACK summary for this relationship (§3 of the verification plan requires this explicitly):**
- `PWA WRITE`: Enquiry.`status`/`remark`/`log` (yes, at conversion).
- `PWA READ`: none — nothing in the PWA ever reads a SO→Enquiry link back (none exists to read).
- `PWA NO READ-BACK`: confirmed — the Enquiry→SO relationship is entirely one-directional and, on the SO side, not stored as a field at all; only the Enquiry's own `remark`/`log` text records it, and nothing parses that text back into a structured reference anywhere in the PWA.
- `NEW APP WRITE`: `SalesOrder.enquiryId` set at conversion.
- `NEW APP READ`: `findByEnquiryId` used both by the duplicate-guard (§10) and available generally as a repository method — confirmed a live read-back exists, not merely a stored, unread ID.

---

## 10. Duplicate Conversion / Concurrency

**PWA behavior:** none prevented at the data level. The only friction is that the "Confirmed → Create SO" button disappears once `status==="Won"` — a second physical click from the *same* rendered page is impossible, but a second `saveSO(0, enqId)` call from a stale page/second tab/devtools is not defended anywhere in `saveSO`'s own code (re-verified, no guard clause found).

**`new-app` behavior (existing conversion guard, re-verified from source, not assumed):**
1. Pre-check (fast-fail, before opening a transaction): `if (enquiry.status !== 'Open') throw ServiceError('...', 'ENQUIRY_NOT_OPEN', 409)`.
2. Pre-check: `if (existingSo = findByEnquiryId(...)) throw ServiceError('...', 'DUPLICATE_CONVERSION', 409)`.
3. **Race-safe authoritative guard inside the transaction:** `markWonIfOpen(companyId, id, {...}, session)` is an atomic conditional update (matches only if `status` is still `"Open"` at write time) — if it returns falsy (lost the race), the whole transaction throws `ENQUIRY_NOT_OPEN` again and rolls back.
4. **DB-level backstop:** a unique index on `(companyId, enquiryId)` on `SalesOrder.js` — directly exercised by `enquiryConversion.test.js`'s duplicate-key race test (line 123), which forces both pre-checks to pass for two concurrent calls and asserts the *second* still fails, proving the unique index (not just the pre-check) is what closes the race.

**Infrastructure-only protection:** the unique index and the transaction-scoped conditional update are both DB/infrastructure mechanisms layered under a real business rule (`#19=B`, "add a real Open + duplicate guard" — a NEW BACKEND DESIGN decision, not a PWA fact) — i.e., **the rule itself (reject a second conversion) is a new business rule**, not merely infrastructure, while the specific mechanism enforcing it race-safely (conditional update + unique index) is the infrastructure-only part. Classified precisely so as not to conflate the two.

**Difference:** PWA allows unlimited duplicate SO/Project/Payment creation from one Enquiry; `new-app` allows exactly one, atomically enforced. **Classification: PWA / NEW APP INCONSISTENCY** for the business rule itself (this is deliberate, already locked as `#19=B` in `OPEN_DECISIONS.md`, not introduced by this pass) — **not** a defect to fix or re-open; recorded per the task's instruction to classify, not to introduce a new rule.

---

## 11. SalesOrder Creation Paths

**PWA — two independent paths, both funnel into `mSO`/`saveSO`:**
1. **Enquiry conversion** — `mSO(0, enqId)`.
2. **Standalone "+ New SO"** — `mSO()` with no args, rendered only for `sales`/`admin` on the SO list (`vSOs` L2039). `saveSO`'s `if(enqId){...}` block simply does not run.

Both share identical downstream cascade (Project + Payments + notifications).

**`new-app` — both paths now implemented and share one cascade module (verified, correcting the stale audit's "no standalone path" claim):**

| Path | Entry | PWA function | Actor | Numbering | Checklist | Payment | Project | Notification | NEW APP endpoint/service |
|---|---|---|---|---|---|---|---|---|---|
| Enquiry conversion | `POST /enquiries/:id/convert` | `mSO(0,enqId)`→`saveSO` | sales/admin | per-company Counter | via `resolveChecklist` (§14) | per milestone | 1, always | 2 | `enquiryService.convertEnquiryToSalesOrder` → `salesOrderCascade.runCreationCascade` |
| Standalone | `POST /sales-orders` | `mSO()`→`saveSO` | sales/admin | per-company Counter | via `resolveChecklist` (§14) | per milestone | 1, always | 2 | `salesOrderService.createSalesOrder` → `salesOrderCascade.runCreationCascade` |

Both call the exact same `runCreationCascade` in `salesOrderCascade.js` — confirmed by direct read of both `enquiryService.js` (`cascade.runCreationCascade({..., enquiryId: id, ...})`) and `salesOrderService.js` (`cascade.runCreationCascade({..., enquiryId: null, ...})`), so the two paths cannot structurally drift apart. **Classification: MATCH** (both paths now implemented; §18/§21/§22 of `PWA_COVERAGE_AUDIT_SALESORDER.md`, which said the standalone path "has no implementation at all," is **superseded** by this pass's direct source read — recorded as a **DOCUMENTATION GAP** in that older document, not a current NEW APP gap; see §34 Issue list).

No third SalesOrder-creation mechanism was found in the PWA (no bulk import, no API-only creation distinct from `saveSO`, no Project-initiated SO creation).

---

## 12. SalesOrder Field Trace

Full 17-field trace already exists and was spot-checked (not re-derived from scratch) against `PWA_COVERAGE_AUDIT_SALESORDER.md` §3/§17 and `SalesOrder.js`; direct re-check of `salesOrderService.js`/`salesOrderCascade.js` confirms every field name/type in that table is exactly what the current service code reads/writes (`division`, `projectName`, `startDate`, `endDate`, `siteAddress`, `contacts[≤2]`, `salesTeam`, `projectTeam`, `crucialPoints`, `totalCost`, `highSideSelling`, `highSidePurchase`, `lowSideCost`, `lowSideTargetExpense`, `lowSideActualExpense`, `termsAndConditions`, `paymentMilestones[≤5]`, plus `enquiryId`/`orderNumber`/`companyId` as NEW BACKEND fields). No schema gap found — **Classification: MATCH**.

Enquiry→SalesOrder field crossover table is the same one already given in §9 above (not duplicated here per the "same-name fields don't imply same semantics" instruction — each row there already states its transform, not just its name match).

---

## 13. SalesOrder Edit Flow — re-verified with direct source evidence

**PWA (`saveSO`'s `if(id){...}` edit branch, L2077-2078):** plain `Object.assign(existingRecord, d)`, returns immediately — no Project re-creation, no new Payments, no notifications, no Enquiry interaction.

**`new-app` (`salesOrderService.js`'s `editSalesOrder`):** patches only a fixed `EDITABLE_FIELDS` allowlist, no cascade re-run — confirmed by direct read (no call to `cascade.runCreationCascade` or any Project/Payment/Notification repo method anywhere in the function body). Test `'editSalesOrder — no Project re-creation, no cascade re-run (PWA FACT)'` (salesOrderService.test.js) asserts this directly. **Classification: MATCH.**

### 13(a) Milestone amount synchronization asymmetry — re-verified, NOT corrected

**PWA source evidence (direct re-read):**
- SO-side edit (`saveSO`'s milestone-collection loop): rebuilds `so.pay[]` from the 5 form rows; **never writes to the linked Payment record's `amount`.**
- Payment-side edit (`mPayEdit`/`savePayEdit`): `if(x.soNo){...so.pay[x.mi].a=amt}` — writes the new amount **forward** onto the SO's own milestone array.

This is asymmetric: Payment→SO is synchronized; SO→Payment is not.

**`new-app` source evidence, direct quote from code (not re-stated from the doc):**
- `paymentService.js`'s `editMilestone`: `if (amount !== undefined && payment.salesOrderId) { await txnDeps.salesOrderRepo.setMilestoneAmount(actorAuth.companyId, payment.salesOrderId, payment.milestoneIndex, Number(amount), session); }` — forward sync, present.
- `salesOrderService.js`'s `editSalesOrder`: the milestone-patch block builds `patch.paymentMilestones` directly from `patchInput` with **no call to any Payment repository method anywhere in the function** — confirmed by full read of the function body — no `paymentRepo` reference exists in `salesOrderService.js` at all (only `salesOrderRepo`/no payment import).

**Verified: the asymmetry is reproduced exactly, in the same direction, and is explicitly documented in both files' own code comments as a "locked decision," not silently fixed.** `paymentService.test.js` line 85 (`editMilestone`, Payment→SO forward sync) and `paymentService.test.js` line 103 (`editSalesOrder (SO-side) amount edit does NOT push forward to the Payment record`) both assert this directly. **Classification: MATCH** (both directions, both PWA and NEW APP behave identically — a preserved quirk, not a defect).

### 13(b) Received-flag same-index preservation — re-verified, NOT corrected

**PWA source evidence (direct re-read, `saveSO`'s milestone loop):** `(id&&DB.sos.find(...).pay[i]||{}).rcv||false` — for an edit, each of the 5 milestone slots' `rcv` is looked up from the **existing record's same array index** `i`, not by any stable milestone identity. Reordering/removing an earlier row shifts every later row's preserved flag onto the wrong milestone.

**`new-app` source evidence, direct quote:** `salesOrderService.js`'s `editSalesOrder`:
```js
patch.paymentMilestones = rows.map((m, i) => ({
  description: m.description,
  amount: m.amount,
  received: (existing.paymentMilestones[i] && existing.paymentMilestones[i].received) || false,
}));
```
This is array-index lookup (`existing.paymentMilestones[i]`) against the **new** row list's index `i` — exactly the PWA's own index-based (not identity-based) preservation, including its misattribution-on-reorder quirk. The code comment above it states this explicitly: "preserved by SAME ARRAY INDEX ... Intentionally NOT 'fixed.'" `salesOrderService.test.js` line 115 (`'editSalesOrder — plain field merge, milestone rcv preserved by SAME ARRAY INDEX'`) asserts this directly. **Classification: MATCH** (quirk reproduced exactly, not corrected — per task instruction, this is recorded as-is, neither praised nor flagged as needing a fix).

## 14. SalesOrder → Checklist (SO side only — Project checklist deferred to Pass 3.3)

**Template source (PWA, `defaultChkList(div)`):** `chkLists(div).filter(c=>c.def)[0] || chkLists(div)[0] || null` — default-flagged template for the division, else the first template for that division, else `null`.

**Default template behavior:** confirmed — `.def` flag picked first.

**Fallback behavior:** if no ChecklistTemplate exists at all for the division, PWA falls back to `DB.templates[so.div]`, a **separate, legacy, hardcoded template object** not stored as a `ChecklistTemplate` document (`chkName` left `""` in that case).

**`new-app` (`salesOrderCascade.js`'s `resolveChecklist`, direct read):** three-step chain reproduced exactly —
1. `deps.checklistTemplateRepo.findDefaultForDivision(companyId, division)` (matches `defaultChkList`'s default-then-first semantics, confirmed by the repository's own name and by `salesOrderService.test.js`'s `'falls back to any division template when none is marked isDefault'`).
2. Falls back to `LEGACY_CHECKLIST_FALLBACK[division]` (imported from `new-app/backend/src/models/shared/legacyChecklists.js`) when no template exists — `checklistTemplateName: ''` set exactly as the PWA's `chkName:cl?cl.name:""` would produce.
3. Falls back to an empty checklist only if neither exists.

This directly **corrects** `PWA_COVERAGE_AUDIT_SALESORDER.md` §10/§16-item-9/§20/§22-item-4's claim that "a fresh SO in a division with zero ChecklistTemplate rows gets an empty checklist ... no `new-app` equivalent" — that was true when that document was written; it is **no longer true**. Test `'createSalesOrder — falls back to the legacy checklist when the division has zero ChecklistTemplate rows (locked "Checklist fallback = A")'` (salesOrderService.test.js line 52) and the matching Enquiry-conversion test (enquiryConversion.test.js line 211) both directly assert the legacy fallback text is used, not an empty array. **Classification: MATCH** (was previously a real gap per the older audit; now resolved — recorded as a **DOCUMENTATION GAP** in that older document, see §34).

**Item copying:** confirmed copy-not-reference — each item becomes `{text, signResponsibility, done:false, completedDate:null, pmSigned:false, remark:'', photos:[], targetDate:null, approval:null}` on the Project, independent of the template afterward.

**Item structure:** matches the ChecklistTemplate item shape (`text`, `signResponsibility`) plus Project-side execution fields not present on the template (`done`, `pmSigned`, `approval`, etc.) — this execution-state layer is Project-side, correctly deferred to Pass 3.3 per the plan.

**Whether edits modify template or SO/Project copy:** copy — confirmed no back-reference from a Project's checklist item to its originating template item exists anywhere in either PWA or `new-app`.

**Approval/execution:** none of this happens at SO-creation time in either system — it belongs to Project execution (Pass 3.3), correctly out of scope here.

**Actor/role:** the checklist resolution itself has no role gate of its own in either system (it runs as a byproduct of SO creation, under whatever role gate `createSalesOrder`/`convertEnquiryToSalesOrder` already enforces — `sales`/`admin`).

**Tenant:** `resolveChecklist(companyId, division, deps)` is company-scoped via `checklistTemplateRepo.findDefaultForDivision(companyId, division)` — confirmed tenant-safe.

**Notifications:** none specific to checklist creation in either system (the 2 SO-creation notifications are generic, not checklist-specific).

**Checklist gate items (from the task spec, all traced above):** Template source — traced. Default template — traced. Fallback — traced (and found now-implemented, correcting the stale audit). SO checklist creation — traced. Item copy — traced. SO checklist mutation — traced (Project-side, deferred). SO checklist status — deferred to 3.3 (execution state). Notifications — traced (none). Role behavior — traced. Tenant behavior — traced. NEW APP equivalent — traced (`resolveChecklist`).

---

## 15. SalesOrder → Payment Milestones

**Relationship (re-verified, not assumed):** milestones are **embedded** on the SalesOrder itself (`so.pay[≤5]{d,a,rcv}` / `paymentMilestones[≤5]{description,amount,received}`) **and separately, one Payment record is created per non-empty milestone** at SO-creation time — i.e. both embedded AND a linked separate record exist simultaneously, kept in partial sync (§13(a)/§18/§19 below), not one deriving cleanly from the other. This is a **DUAL representation**, confirmed by direct code: `salesOrderCascade.js`'s `runCreationCascade` creates the SO with `paymentMilestones` embedded, then in the same function creates one `paymentRepo.create(...)` per milestone with `salesOrderId` + `milestoneIndex` linking back — `DERIVED RELATION` would understate it (the Payment record independently carries its own ledger `partPayments[]` that the embedded milestone does not); `EMBEDDED DATA` alone would miss the separate Payment document. Both connection types apply (see §31 connection table).

**Field trace per milestone:**

| Field | SO-embedded (`paymentMilestones[i]`) | Payment record |
|---|---|---|
| Amount | `amount` (SO's own copy — editable via `editSalesOrder`, NOT synced forward from Payment edits, see §13(a)) | `amount` (Payment's own copy — synced forward FROM SO-side milestone editing? **No** — see below) |
| Description/name | `description` | `remark` (`"SO <no> milestone <i+1>: <description>"`, exact PWA literal string, set once at creation, not re-synced on later edits of either side) |
| Due info | none on either side (PWA has no milestone due-date field — confirmed absent from both `so.pay[i]` and Payment) | `raisedToFinance.collectByDate` only after a raise (§21) |
| Received state | `received` (boolean) | `status` (`Pending`/`Received`, derived) |
| Received date | none on the SO-embedded copy | `receivedDate` |
| Other fields | — | `partPayments[]` (the actual ledger), `discussionNotes`, `lastCallDate`, `nextCallDate`, `raisedToFinance` |

**Correction to make explicit for precision:** amount synchronization is one-way **Payment→SO only** (`editMilestone` writes `salesOrderRepo.setMilestoneAmount`); there is **no** SO→Payment amount sync at all (`editSalesOrder` never touches Payment). This matches §13(a) exactly and is restated here per §15's own "trace actual code, don't infer structure" instruction rather than assumed from §13.

---

## 16. Payment Creation

**PWA creation paths relevant to SalesOrder, traced by function:**
1. **SO-creation cascade** (`saveSO`, implicit) — one Payment per non-empty milestone, `paid`/`raised` both unset, `status:"Pending"`, `soNo`+`mi` set. Actor: whoever creates/converts the SO (`sales`/`admin`).
2. **`mRaise`/`doRaise`** (L2335-2360) — creates the Payment **on the fly** if it's somehow missing for `(so.no, mi)`, same field shape as path 1. Actor: any role reaching a Project's Raise button (no PWA function-level role check — see §25).
3. **`mPayNew`/`savePayNew`** — manual, non-SO-linked payment (`soNo:""`), for "other receivables."

**`new-app`:** path 1 = `salesOrderCascade.runCreationCascade`'s Payment-creation loop (per-milestone). Path 2 = `paymentService.js`'s `raiseToFinance`, which creates the Payment "on the fly" if `findBySalesOrderAndMilestone` returns none (exact PWA-matching fallback logic, confirmed by direct code read). Path 3 = `paymentService.js`'s `createManualPayment`. **All three paths are implemented.** Amount/date/reference/remarks/company/SO-relation all match the field trace in §15. **Notifications:** path 1 fires the 2 SO-creation notifications (not payment-specific); path 2 fires the raise notification (§21); path 3 fires none (matches PWA — `savePayNew` has no `notify()` call, confirmed by grep: the only Payment-related `notify()` sites are L2360 (raise) and L3828/L3831 (full/part received) — none at manual creation). **Determination: linked by array-index for the SO-embedded milestone (`milestoneIndex`), linked by ID for the Payment↔SalesOrder relation (`salesOrderId`) — a hybrid, not "fully separate" nor purely "embedded."** **Classification: MATCH.**

---

## 17. Part Payment

**PWA (`addPayment`, L3813-3831):** appends `{amt,date,mode,ref,remark,inv,by:U.name}` to `paid[]`; no cap on count; over-balance amount allowed after a `confirm()` dialog (not blocked); two notifications depending on whether balance clears, to `["admin","sales"]`.

**`new-app` (`addPartPayment`):** identical shape (`partPayments[]` entry with `recordedByUserId` instead of a plain name string — infrastructure difference, user identity via auth session rather than free-text `U.name`). Overpayment: **not silently allowed** — requires an explicit `confirmOverpayment: true` flag, returning `409 OVERPAYMENT_CONFIRMATION_REQUIRED` otherwise (the code comment states this is a deliberate adaptation of the PWA's interactive `confirm()` dialog to a non-interactive API — the *business rule* (overpayment permitted with confirmation) is preserved; only the *confirmation mechanism* changed from a client dialog to an explicit request flag). **Classification: MATCH** for the business rule (repeated payments unlimited, overpayment ultimately allowed with confirmation) with an **INFRASTRUCTURE-ONLY DIFFERENCE** for the confirmation mechanism itself (a server API cannot show a JS `confirm()` popup — the flag is the necessary server-side substitute, not a new business rule).

Rollback/edit behavior for part payments: see §20.

---

## 18. Payment Received State — re-verified with direct PWA evidence

**PWA `syncPayStatus(x)` (L3877-3882), direct re-read:**
```
bal = payBal(x)
if (bal<=0): x.status="Received"; x.rcvDate = last paid[].date or today(); if(x.soNo) so.pay[x.mi].rcv = true
else:        x.status="Pending";  x.rcvDate = "";                        if(x.soNo) so.pay[x.mi].rcv = false
```
Called after every `paid[]` mutation (`addPayment`, `saveEditPayment`, `delPayment`) — **and confirmed NOT called by `savePayEdit`** (the milestone-amount edit function) — re-verified directly: `savePayEdit`'s body ends after the `so.pay[x.mi].a=amt` forward-sync line with no `syncPayStatus(x)` call anywhere in it. This means editing a milestone's *amount* does not itself recompute `status`/`rcv`, even though the balance changed.

**`new-app` (`paymentService.js`), direct re-read:**
- `syncPayStatus(companyId, payment, deps, session)` is called by `addPartPayment`, `editPartPayment`, `removePartPayment` — matching the PWA's three call sites exactly (`addPayment`, `saveEditPayment`/`mEditPayment`→`editPartPayment`, `delPayment`→`removePartPayment`).
- `editMilestone` (the `savePayEdit` equivalent) — confirmed by direct read: **no call to `syncPayStatus` anywhere in its body**, and the function's own doc comment states this explicitly: "this function does NOT call `syncPayStatus()` after changing the amount, so `status`/`rcv` are intentionally NOT recomputed here even though the balance changed. This is preserved exactly as a PWA quirk, not corrected."

**"Same-index received-state preservation" re-verification (this is the SO-edit-side flag, distinct from `syncPayStatus`'s Payment-side flag — both were asked to be re-verified):** already fully re-derived with direct code quotes in §13(b) above — confirmed accurate.

**Independently editable?** `received`/`receivedDate` are never directly settable via any Payment-editing input field in either system — they are always derived by `syncPayStatus`/its `new-app` equivalent, or (on the SO's own embedded copy) preserved by index on an SO edit. **Classification: MATCH** for both the sync-call-site parity and the non-syncing `editMilestone`/`savePayEdit` quirk.

---

## 19. Payment Overpayment / Invalid Values

| Value | PWA behavior | `new-app` behavior | Classification |
|---|---|---|---|
| Zero | `addPayment`: `if(amt<=0)toast(...)` blocked | `addPartPayment`: `if (!amt \|\| amt <= 0) throw VALIDATION_ERROR` | MATCH |
| Negative | same as zero (both fail the `amt<=0` check) | same (a negative number still fails `<=0`, blocked) | MATCH |
| Greater-than-remaining (overpayment) | allowed after `confirm()` | allowed with `confirmOverpayment:true`, else `409` | MATCH (mechanism differs, business rule matches — see §17) |
| Equal-to-remaining | allowed, clears balance to 0, `status→Received` | allowed identically, `balance<=0` branch of `syncPayStatus` | MATCH |
| Repeated payments | unlimited `paid[]` entries, no cap | unlimited `partPayments[]` entries, no cap found in `addPartPayment` (confirmed no length-check on `payment.partPayments`) | MATCH |
| Milestone-amount reduced below received | `savePayEdit`: `if(amt<r){toast(...)}` blocked | `editMilestone`: `if (amt < received) throw VALIDATION_ERROR` | MATCH |

No invented validation was found beyond what the PWA demonstrates; `new-app`'s only additions are the `confirmOverpayment` flag mechanism (§17) and turning client-side `toast()` messages into HTTP 400/409 errors — both **INFRASTRUCTURE-ONLY DIFFERENCE** (an API has no toast; "reject the request with an error" is the necessary server equivalent of "block the save client-side").

---

## 20. Payment Rollback / Edit / Delete

**PWA:** `mEditPayment`/`saveEditPayment` — any part-payment field editable after the fact, stamps `editedBy`/`editedOn`, re-runs `syncPayStatus`. `delPayment` — removes one `paid[]` entry, re-syncs (can flip Received back to Pending). `delPayRow` — whole-record delete, **only offered in the UI when `!x.soNo`** (an SO-linked Payment has no delete path in the PWA at all).

**`new-app`:** `editPartPayment` — matches (stamps `editedByUserId`/`editedOn`, re-syncs). `removePartPayment` — matches (re-syncs, can flip Received back to Pending — directly tested by `'removePartPayment — deleting an entry can flip a Received milestone back to Pending (PWA FACT reversal)'`). `deletePaymentRecord` — **explicitly blocked (not just UI-hidden) when `payment.salesOrderId` is set:** `if (payment.salesOrderId) throw ServiceError('An SO-linked payment cannot be deleted, only its individual entries.', 'FORBIDDEN', 403)`. This is a genuine strengthening: the PWA's restriction is UI-only (nothing stops a devtools-modified request from calling `delPayRow` on an SO-linked Payment, since that function itself has no `if(x.soNo)return` guard — re-verified: `delPayRow`'s body has no `soNo` check at all, only the button that calls it is conditionally rendered). `new-app` enforces the same restriction **inside the function itself**. **Classification: INFRASTRUCTURE-ONLY DIFFERENCE** for the enforcement mechanism (real server check replacing UI-only hiding) — the underlying rule (SO-linked payments aren't whole-record-deletable) is itself a PWA-demonstrated *intent* (visible in the UI condition), so reproducing it as a real guard is correct fidelity to intent, not a new rule invented from nothing.

Effect on milestone/received state/totals: all flow through the same `syncPayStatus` traced in §18. Notification: none fires specifically for edit/delete/rollback in either system (only `addPartPayment`'s full/part-received notifications and `raiseToFinance`'s raise notification exist — confirmed by the full `notify()`-site grep in §24).

## 21. Raise to Finance

**PWA (`mRaise`/`doRaise`, L2335-2360):** Project-side action; locates or creates-on-the-fly the Payment for `(so.no, mi)`; stamps `pr.raised={by,role,date,note,dueBy,priority}`; appends a `disc` note; notifies `["finance","admin"]`, `⚠ URGENT` prefix if `priority==="Urgent"`. **No role check in the function body at all** — gated only by whichever menu exposes the Raise button (in practice PM/admin, per menu visibility, but not enforced in code).

**`new-app` (`raiseToFinance`):** matches the locate-or-create-on-the-fly, stamp `raisedToFinance{raisedByUserId,raisedByRole,raisedDate,collectByDate,priority,note}`, append-to-`discussionNotes`, and urgent-prefixed `["finance","admin"]` notification behavior exactly. **Role enforcement added:** `RAISE_ROLES = ['hvac_pm','solar_pm','mep_pm','admin']`, plus a division-match check (`if (requiredDivision && so.division !== requiredDivision) throw FORBIDDEN`) — a PM may only raise for their own division's SO. This is the PWA's *visible* UI intent (only division PMs and admin can reach the Raise button in practice) turned into a real server check — a NEW BACKEND DESIGN choice explicitly documented in the code as "Locked decision 'Role enforcement = A': the PWA had NO role check at all in this function ... now enforced here server-side." **Repeatable:** confirmed both systems allow raising the same milestone more than once (PWA: no guard against re-raising; `new-app`: no guard found in `raiseToFinance` against an existing `raisedToFinance` value — it is simply overwritten). **Classification: MATCH** for the raise mechanics/notification; **AUTHORIZATION GAP → now closed, recorded as INFRASTRUCTURE-ONLY DIFFERENCE / already-locked NEW BACKEND DESIGN** for the role-check addition (not a new undocumented divergence — it's the same discipline the whole module applies).

---

## 22. Finance Follow-up / Reports

**Follow-up (`mPayFollow`/`savePayFollow` PWA; `addFollowUp` in `new-app`):** `lastCall`/`nextCall`/`disc`/`remark` fields only, no `rcv` interaction, no SO-side effect, no notification in either system — confirmed by grep (no `notify()` call in either `savePayFollow` or `addFollowUp`).

**Finance status / ledger:** `payPanel()` (PWA, live re-render from `DB.payments`) vs. `listPayments`/`getPayment` (`new-app`, DB query with `status` filter) — both role-gated to `finance`/`admin` (PWA: `MENUS` "Payments" item to `admin`,`finance` only; `new-app`: `LEDGER_ROLES = ['finance','admin']`, matching exactly).

**Reports/export connected to this workflow:**
- PWA `dlPayments()` (pending payments report) ↔ `new-app` `exportPendingPaymentsCsv` — column set reconstructed from `payPanel()`'s displayed columns since the exact `dlPayments()` CSV-builder source line wasn't independently re-captured in this pass either (same caveat the code's own comment already states: "the literal `dlPayments()` CSV-builder source was not fully captured during the SalesOrder audit — flagged as a follow-up verification item"). **This pass did not re-derive `dlPayments()`'s exact column order from PWA source** (time-boxed; flagged, not silently assumed correct) — recorded as an **OPEN / NOT DETERMINABLE** item, not fabricated as verified. See §34, Issue P-1.
- PWA `dlReceipts()` ↔ `new-app` `exportReceiptsCsv` — **this pass independently re-confirmed** the column order against `PWA_COVERAGE_AUDIT_SALESORDER.md` §8's own citation ("Date, Project, SO No, Person, Phone, Amount Received, Mode, Reference, Invoice Issued, Milestone Amount, Milestone Balance, Status, Entered By, Remark") and found it matches `exportReceiptsCsv`'s header array exactly, field for field. **Classification: MATCH.**
- SalesOrder-side finance reports (`dlSOs`'s Received/Pending columns) — traced in §12, uses `computeReconciledPaySummary` (the `paySum`-equivalent) not the raw-flag summary, matching PWA's `dlSOs` (which uses `paySum`, not `so.pay[].rcv` directly) — confirmed by direct code comment cross-reference in `salesOrderService.js`.

Received/collection views connected to this workflow only (not expanded into unrelated finance functionality, per task instruction): `listPayments({status})`, `exportPendingPaymentsCsv`, `exportReceiptsCsv`, `exportSalesOrdersCsv`'s Received/Pending columns. No general ledger/accounting module exists in either system, and none was assumed to exist.

---

## 23. SalesOrder → Project Connection (boundary only)

**Trigger:** SO creation (either path), inside `runCreationCascade` — exactly one Project created, always, at SO-creation time, never standalone.

**Required fields copied:** `division`, `name`=SO's `projectName`, `stage`=`PROJECT_STAGES_BY_DIVISION[division][0]` (division's first stage), `customer`=SO's `contacts[0].name` (**not** the Enquiry's name/phone, even for a conversion — re-verified, `contact0Name` is derived from `draft.contacts[0].name`, which itself only ever gets a value from `overrides.contacts` — the Enquiry's `phone` populates `contacts[0].phone`, never `.name` — confirmed no code path sets Project `customer` from the Enquiry).

**Not copied:** `siteType`/`capacity` — both hardcoded `''` on the Project (PWA FACT, re-confirmed: `salesOrderCascade.js`'s Project-create call literally has `siteType: ''` and `capacity: ''` with the code comment "left blank, not copied from Enquiry or SO" — matches PWA's `saveSO`'s hardcoded empty strings exactly).

**Project reference back to SO:** `Project.salesOrderId` = the SO's Mongo `_id` (`new-app`'s own internal-id linkage) vs. PWA's `Project.soNo` = the SO's *display number* (`so.no`) — already correctly identified in `PWA_COVERAGE_AUDIT_SALESORDER.md` §9 as a NEW BACKEND internal-modeling choice, not a PWA fact to be copied literally, since `new-app`'s SalesOrder has a real `_id` to reference. **Classification: INFRASTRUCTURE-ONLY DIFFERENCE.**

**Checklist/cascade:** the checklist is populated onto the Project at this same creation instant, traced fully in §14.

**Notifications:** the same 2 SO-creation notifications (§9/§16) — none specific to "Project was created" as a distinct event in either system (confirmed by grep: no third `notify()` call exists in `saveSO`).

**Tenant:** `project.companyId = companyId` (same company as the SO, inherited, never independently supplied) — confirmed tenant-safe by direct code read (no client-suppliable `companyId` field in the cascade's Project-create call).

**Authorization:** governed entirely by the SO-creation role gate (`sales`/`admin` to create) — there is no separate Project-creation authorization check at this point in either system, since the Project is an unconditional byproduct, not a separately invoked action.

**Repeat behavior:** exactly one Project per SO, always, confirmed no code path creates a second Project for the same SO in either system (PWA: no other `DB.projects.push` site references `soNo`; `new-app`: Project creation exists only inside `runCreationCascade`, called once per SO-creation call).

**Deeper Project execution (stage transitions, engineer assignment, checklist item execution/approval, timeline, delivery challans, completion, the 9 Project-related `notify()` sites) is explicitly DEFERRED TO PASS 3.2 — not traced here.**

---

## 24. Notification Trace For This Pass

Re-derived independently this session by grepping every `notify(` call site in `MEP_PROJECTS_PWA/index.html` and filtering to those attributable to the Enquiry/SalesOrder/Payment/Finance workflow specifically (excluding Project execution, Contract, ServiceCall, Inventory sites, which are 3.2/3.4/3.5/3.6 territory):

| Evidence ID | PWA File | Function | Line | Trigger | Content/Type | Recipient roles | Company | NEW APP equivalent |
|---|---|---|---|---|---|---|---|---|
| 3.1-N01 | `MEP_PROJECTS_PWA/index.html` | `saveSO` | 2094 | SO created (either path) | `"New SO-<no> received from Sales: <project> (<div>). Project created — assign engineer."` | `[<divisionPM>, "admin"]` | `so.co` | `salesOrderCascade.js` `runCreationCascade`, `notificationRepo.create(...)` (row 1) |
| 3.1-N02 | `MEP_PROJECTS_PWA/index.html` | `saveSO` | 2095 | SO created (either path) | `"New SO-<no> (<project>): payment terms added to pending payment list."` | `["finance"]` | `so.co` | `salesOrderCascade.js` `runCreationCascade`, `notificationRepo.create(...)` (row 2) |
| 3.1-N03 | `MEP_PROJECTS_PWA/index.html` | `doRaise` | 2360 | Milestone raised to Finance | `"[URGENT —] Payment milestone raised by <U.name> for '<p.name>' (SO-<so.no>): <bal> due — <note>. Collect by <by>."` | `["finance","admin"]` | company of the Project/SO | `paymentService.js` `raiseToFinance`, `notificationRepo.create(...)` |
| 3.1-N04 | `MEP_PROJECTS_PWA/index.html` | `addPayment` | 3828 | Part-payment clears balance | `"Payment fully received: <money> — <project>[ (SO-<no>)]"` | `["admin","sales"]` | payment's company | `paymentService.js` `addPartPayment`, balance-cleared branch |
| 3.1-N05 | `MEP_PROJECTS_PWA/index.html` | `addPayment` | 3831 | Part-payment, balance remains | `"Part payment received: <money> for <project>. Balance <money>."` | `["admin","sales"]` | payment's company | `paymentService.js` `addPartPayment`, balance-remaining branch |

**5 notify() call sites for this workflow** (2 SalesOrder + 3 Payment) — consistent with the counts already locked in `E2E_WORKFLOW_VERIFICATION_PLAN.md` §10 (SalesOrder 2, Payment 3 of the 23 total). **Zero Enquiry-own-lifecycle notify() sites** — re-confirmed, no `notify()` call exists in `saveEnq`, `addFollow`, `doMarkLost`, or `reopenEnq` (grepped directly, none found).

**NEW APP Notification implementation, inspected directly:** `Notification.js` (model: `companyId`, `text`, `date`, `targetRoles[]`, `readByUserIds[]`) exists and is correctly written-to by all 5 call sites above (verified: `notificationRepo.create(...)` is called with matching `text`/`targetRoles` at each of N01-N05). **No `notificationService.js` exists.** **No notification routes exist** (confirmed: a repo-wide search for notification-related code finds only the model file plus its call sites inside other services). There is no `GET /notifications` endpoint, no per-user "my notifications" read path, no read/unread marking endpoint, and no delivery mechanism (push/email/socket) — the rows are written to the `notifications` collection and never surfaced anywhere the API exposes.

**B1 status for this workflow, explicitly confirmed, not fixed:** **B1 remains fully open for the Enquiry/SalesOrder/Payment/Finance workflow.** All 5 notification-worthy events (N01-N05) correctly **write** a Notification document with the exact PWA-matching text/targeting, but nothing in `new-app`'s API surface lets any user **read** them — there is a write path with no corresponding read/delivery path anywhere in the routes layer. This pass did not implement one.

---

## 25. Role Checklist

| Action | sales | admin | finance | hvac_pm/solar_pm/mep_pm | super | engineer/service_eng/other |
|---|---|---|---|---|---|---|
| View Enquiry | PWA ALLOWED (menu) | PWA ALLOWED (menu) | PWA NOT ALLOWED (no menu entry) | PWA NOT ALLOWED | PWA NOT ALLOWED (no per-tenant menu at all — `superDash` only) | PWA NOT ALLOWED |
| Create Enquiry | PWA ALLOWED (button shown) | **PWA UI-ONLY GATE — button hidden**, function itself has no check | n/a | n/a | n/a | n/a |
| Edit / Follow-up / Lost / Reopen / Convert Enquiry | PWA ALLOWED | PWA ALLOWED (no gate beyond menu) | n/a | n/a | n/a | n/a |
| Create SalesOrder | PWA ALLOWED ("+ New SO" shown) | PWA ALLOWED | PWA NOT ALLOWED (no create button) | PWA NOT ALLOWED | NOT DEMONSTRATED | PWA NOT ALLOWED |
| View SalesOrder (SO menu item) | PWA ALLOWED | PWA ALLOWED | PWA ALLOWED (menu includes finance) | PWA ALLOWED (menu includes division PMs) | NOT DEMONSTRATED | PWA NOT ALLOWED |
| Edit SalesOrder | PWA ALLOWED (Edit button) | PWA ALLOWED | PWA UI-ONLY GATE (no Edit button rendered, but `saveSO` itself has zero role check) | PWA UI-ONLY GATE (same) | NOT DEMONSTRATED | PWA NOT ALLOWED |
| Edit milestone/payment data | **PWA UI-ONLY GATE — zero function-level check anywhere** (`saveSO`, `addPayment`, `mEditPayment`, `delPayment`, `savePayEdit` all have no `U.role` reference at all) | same | same (menu-gated only) | same | NOT DEMONSTRATED | same |
| Raise to Finance | PWA UI-ONLY GATE (no function-level check in `mRaise`/`doRaise`) | same | same | same (in practice reachable by the Project's PM) | NOT DEMONSTRATED | same |
| Finance view/action (Payments menu) | PWA NOT ALLOWED | PWA ALLOWED | PWA ALLOWED | PWA NOT ALLOWED | NOT DEMONSTRATED | PWA NOT ALLOWED |
| Reports/export | same visibility as the underlying screen | same | same | same | NOT DEMONSTRATED | same |
| Notifications | write-only in both systems (§24) | same | same | same | NOT DEMONSTRATED | same |

**NEW APP server enforcement, compared directly:**
- Enquiry: `CREATE_ROLES=['sales']`, `MANAGE_ROLES=['sales','admin']` — matches the PWA's *visible* intent exactly (create is sales-only even for admin; all other actions are sales+admin).
- SalesOrder: `CREATE_ROLES=EDIT_ROLES=['sales','admin']`, `VIEW_ROLES=['sales','admin','hvac_pm','solar_pm','mep_pm','finance']` — matches PWA's `MENUS` array exactly (verified against the "Sales Orders" menu entry list already confirmed accurate in `PWA_COVERAGE_AUDIT_SALESORDER.md` §12). `COST_HIDDEN_ROLES=['engineer','service_eng']` reproduces `vSO`'s `showCost` ternary exactly, applied via `redactCostForRole`.
- Payment: `LEDGER_ROLES=['finance','admin']` — matches PWA's Payments menu visibility. `RAISE_ROLES=['hvac_pm','solar_pm','mep_pm','admin']` — a **new**, explicit server-side rule for an action the PWA itself never gated in code (documented as such, not silently invented as "the PWA's rule").

**Classification:** every case where `new-app` enforces a role the PWA only ever *implied* through UI-rendering is classified **INFRASTRUCTURE-ONLY DIFFERENCE** (per the locked list — "explicit server-side authorization checks replacing UI-only role gating"), not a business-rule invention, because in every one of these cases the enforced role set is drawn directly from the PWA's own menu/button visibility, not invented from nothing. V3 role assumptions were not consulted anywhere in this section (out of scope per task instruction).

---

## 26. Tenant / Company Checklist

| Item | PWA | NEW APP | Evidence |
|---|---|---|---|
| Enquiry company assigned | `co:U.co` at creation, never re-settable | `companyId: actorAuth.companyId` at creation, never client-suppliable (verified: `createEnquiry` takes `companyId` only from `actorAuth`, never `input`) | MATCH |
| SalesOrder company assigned | `co:U.co` | `companyId` from `actorAuth` only, in both `createSalesOrder` and the cascade | MATCH |
| Payment company assigned | inherited from the creating SO's `co` (implied scoping) | `companyId: actorAuth.companyId` explicit on every Payment create path (manual, cascade, raise-on-the-fly) | MATCH/stronger — `new-app` makes this an explicit, always-present field even for the manual-payment path |
| Enquiry conversion same-company enforced | not applicable — PWA has no cross-company concept within one `DB` instance | `deps.enquiryRepo.findById(companyId, id)` — company-scoped lookup; a foreign-company Enquiry id simply returns not-found | MATCH (stronger; see next rows) |
| SO access same-company enforced | n/a | `salesOrderRepo.findById(actorAuth.companyId, id)` — company-scoped | MATCH/stronger |
| Payment access same-company enforced | n/a | `paymentRepo.findById(actorAuth.companyId, id)` — company-scoped, confirmed on every read/mutate function in `paymentService.js` | MATCH/stronger |
| Direct-record lookups tenant-safe | n/a (single-DB demo) | confirmed — every repository call in this pass's traced services takes `companyId` as an explicit first argument | MATCH/stronger |
| Foreign-company parent rejected | n/a | Enquiry lookup scoped by `companyId` → a foreign-company Enquiry id returns `NOT_FOUND` (404), not the record — confirmed by `editEnquiry`'s own test `'editEnquiry — tenant isolation: cannot edit another company\'s Enquiry'` | MATCH/stronger |
| Foreign-company child rejected | n/a | `tenantGuard.js`'s `rejectClientSuppliedCompanyId` blocks any request body/query that supplies a different `companyId` than the session's, for all non-`super` roles — confirmed by direct read | MATCH/stronger |

**Per the task's explicit instruction:** the PWA's weaker (effectively absent) tenant model is **not** treated as a gap to reproduce — every row above where `new-app` does something the PWA has no equivalent of at all is classified **INFRASTRUCTURE-ONLY DIFFERENCE**, not `PWA / NEW APP INCONSISTENCY` or `SECURITY / TENANT GAP` (there is no PWA tenant behavior being weakened or contradicted — `new-app` is adding a protection the single-tenant-per-session PWA structurally could not have expressed at all).

---

## 27. Error / Failure Paths

| Case | PWA behavior | NEW APP behavior | Classification |
|---|---|---|---|
| Enquiry not found | `vEnq` guards `if(!x)return"Not found"`; `mSO(0,enqId)` with a bad `enqId` is **unguarded** (would throw on `e.xxx` access — unreachable today only because nothing deletes Enquiries) | `getEnquiry`/`convertEnquiryToSalesOrder` both throw `ServiceError('Enquiry not found.', 'NOT_FOUND', 404)` explicitly | PARTIAL MATCH — NEW APP added an explicit guard the PWA structurally lacks (INFRASTRUCTURE-ONLY DIFFERENCE, since nothing in the PWA ever exercises the unguarded path) |
| Enquiry foreign company | n/a in PWA (single-DB) | 404 via company-scoped `findById` (§26) | INFRASTRUCTURE-ONLY DIFFERENCE |
| Invalid conversion state (not Open) | unguarded (§9/§10) | `409 ENQUIRY_NOT_OPEN` | PWA / NEW APP INCONSISTENCY (deliberate, locked #19=B) |
| Duplicate conversion | unguarded (§10) | `409 DUPLICATE_CONVERSION` pre-check + unique-index race guard | PWA / NEW APP INCONSISTENCY (deliberate, locked #19=B) |
| SalesOrder not found | not independently re-derived to a specific PWA guard in this pass (SO detail read-path tracing is largely Pass 3.2 territory); `mRaise` on a bad SO id is unguarded | `getSalesOrder`/`raiseToFinance` throw `404 NOT_FOUND` explicitly | INFRASTRUCTURE-ONLY DIFFERENCE |
| Payment parent not found | not independently traced to a specific guard in this pass | every Payment mutator explicitly checks `if (!payment) throw NOT_FOUND` | INFRASTRUCTURE-ONLY DIFFERENCE (explicit guard vs. implicit crash) |
| Invalid payment value (<=0) | `toast()` block, `addPayment`/`saveEditPayment` | `400 VALIDATION_ERROR` | MATCH |
| Overpayment | `confirm()` dialog, then allowed | `409 OVERPAYMENT_CONFIRMATION_REQUIRED` without the flag, allowed with it | MATCH (mechanism differs, rule matches — §17/§19) |
| Unauthorized role | PWA UI-ONLY GATE everywhere in this module (§25) | `403 FORBIDDEN` via `assertRole` on every traced function | INFRASTRUCTURE-ONLY DIFFERENCE |
| Foreign-company payment | n/a in PWA | 404 via company-scoped lookup (§26) | INFRASTRUCTURE-ONLY DIFFERENCE |
| Invalid milestone (raise on nonexistent index) | `mRaise` presumably unguarded against an out-of-range `mi` (not independently re-derived to a specific line in this pass) | `raiseToFinance`: `if (!milestone) throw NOT_FOUND` | INFRASTRUCTURE-ONLY DIFFERENCE |

No irrelevant failure cases were invented beyond the task's own list.

## 28. Database Write Graph

| Action | Entity | Fields written | Related writes | Notifications | Atomic? | Transaction? | Independent side effect? |
|---|---|---|---|---|---|---|---|
| Enquiry creation | Enquiry | 8 user fields + system defaults | none | none | single-doc, N/A | no (not needed) | no |
| Enquiry follow-up | Enquiry | `done/next/nextDate/review` overwritten, `log` appended | none | none | single-doc | no | no |
| Enquiry lost | Enquiry | `status/lostReason/lostDate`, `log` appended | none | none | single-doc | no | no |
| Enquiry reopen | Enquiry | `status`, `log` appended | none | none | single-doc, conditional (`reopenIfLost`) | no | no |
| Enquiry conversion | Enquiry, SalesOrder, Project, 0-5 Payment, 2 Notification | Enquiry: `status/remark/log`; SO: full draft + `enquiryId`; Project: full cascade shape; Payment: per-milestone rows; Notification: 2 rows | yes — all of the above in one call | 2 | **yes** | **yes** (`deps.withTransaction`, verified + rollback-tested) | no — everything is inside the one transaction |
| SalesOrder creation (standalone) | SalesOrder, Project, 0-5 Payment, 2 Notification | same shape as conversion minus the Enquiry write | yes | 2 | yes | yes (same `withTransaction` wrapper, via the shared cascade) | no |
| SalesOrder edit | SalesOrder | allowlisted fields + milestone array (index-preserved `received`) | none | none | single-doc | no | no |
| SalesOrder milestone edit (SO-side) | SalesOrder | `paymentMilestones[i].amount/description` | none (no Payment write — §13(a)) | none | single-doc | no | **no** (this is the asymmetry itself — SO-side edit deliberately does not cascade) |
| Payment creation (manual) | Payment | full manual-entry shape | none | none | single-doc | no | no |
| Payment update (part-payment add/edit/remove) | Payment, SalesOrder (milestone `received` flag only) | Payment: `partPayments[]`, `status`, `receivedDate`; SO: `paymentMilestones[mi].received` | yes — SO milestone flag | 1 (add only; edit/remove sync but don't notify) | yes for the paired write | yes (`deps.withTransaction` in `addPartPayment`/`editPartPayment`/`removePartPayment`) | no |
| Payment milestone edit (`editMilestone`) | Payment, SalesOrder (milestone `amount` only) | Payment: allowlisted fields + `amount`; SO: `paymentMilestones[mi].amount` | yes — SO milestone amount | none | yes for the paired write | yes (`deps.withTransaction`) | **yes** — deliberately does NOT call `syncPayStatus`, so `status`/`received` are NOT recomputed even though balance changed (§18) |
| Payment rollback/deletion | Payment (`partPayments[]` entry removed, or whole record) | see above | SO milestone flag (part-payment path only; whole-record delete is blocked when SO-linked) | none | yes | yes | no |
| Raise Finance | Payment (create-if-missing + `raisedToFinance` + `discussionNotes`) | full create shape or patch | none (no SO write) | 1 | yes | yes (`deps.withTransaction`) | no |

Every multi-entity write traced above that spans more than one collection is confirmed transaction-wrapped (`deps.withTransaction`) in `new-app` — the PWA has no transaction concept at all (single-threaded in-memory array mutation). **Classification: INFRASTRUCTURE-ONLY DIFFERENCE** for the addition of transactions; the underlying write *shape* (which fields, which related entities) matches the PWA exactly per the field-by-field evidence in §9-§21 above.

---

## 29-30. Source-Evidence Requirement + Evidence Table

Representative Evidence IDs (full workflow traced above; this table indexes the highest-value/most-scrutinized items per the task's re-verification requirements — every substantive claim elsewhere in this report cites its own PWA line/function inline, per the source-evidence standard):

| Evidence ID | Workflow | Behavior | PWA File | PWA Function | PWA Lines/Anchor | NEW APP File | NEW APP Function/Route | NEW APP Lines | Result |
|---|---|---|---|---|---|---|---|---|---|
| 3.1-E01 | Enquiry reopen | `lostReason`/`lostDate` NOT cleared on reopen | `MEP_PROJECTS_PWA/index.html` | `reopenEnq` | anchor: no `lostReason=`/`lostDate=` assignment in this function | `new-app/backend/src/services/enquiryService.js` | `reopenEnquiry` | doc-commented "#18=A (locked)... INTENTIONALLY left untouched" | MATCH |
| 3.1-E02 | Enquiry→SO | Duplicate conversion unguarded in PWA; guarded in NEW APP | `MEP_PROJECTS_PWA/index.html` | `saveSO` | L2075-2097, no `e.status` re-check | `new-app/backend/src/services/enquiryService.js` | `convertEnquiryToSalesOrder` | pre-checks + `markWonIfOpen` + unique index | PWA / NEW APP INCONSISTENCY (locked #19=B) |
| 3.1-E03 | SO milestone amount sync | Payment→SO forward sync only, no SO→Payment reverse | `MEP_PROJECTS_PWA/index.html` | `savePayEdit` (forward), `saveSO` edit branch (no reverse) | anchor: `so.pay[x.mi].a=amt` inside `savePayEdit`; absence of any Payment write inside `saveSO`'s edit branch | `new-app/backend/src/services/{paymentService.js,salesOrderService.js}` | `editMilestone` (forward), `editSalesOrder` (no reverse) | `editMilestone`'s `salesOrderRepo.setMilestoneAmount(...)` call; `editSalesOrder`'s milestone-patch block has no `paymentRepo` reference | MATCH |
| 3.1-E04 | SO milestone received-flag preservation | Index-based preservation on edit | `MEP_PROJECTS_PWA/index.html` | `saveSO` milestone-collection loop | anchor: `(id&&DB.sos.find(...).pay[i]||{}).rcv||false` | `new-app/backend/src/services/salesOrderService.js` | `editSalesOrder` | `received: (existing.paymentMilestones[i] && existing.paymentMilestones[i].received) || false` | MATCH |
| 3.1-E05 | Payment amount edit / status sync | `savePayEdit` does NOT call `syncPayStatus` | `MEP_PROJECTS_PWA/index.html` | `savePayEdit` | anchor: function body ends after the forward-sync line, no `syncPayStatus(x)` call | `new-app/backend/src/services/paymentService.js` | `editMilestone` | doc-commented "Deliberately no syncPayStatus() call here" | MATCH |
| 3.1-E06 | Checklist fallback | Legacy `DB.templates[div]` fallback when no ChecklistTemplate exists | `MEP_PROJECTS_PWA/index.html` | `saveSO` / `defaultChkList` | anchor: `DB.templates[so.div]` fallback branch | `new-app/backend/src/services/salesOrderCascade.js` | `resolveChecklist` | `LEGACY_CHECKLIST_FALLBACK[division]` branch | MATCH — corrects stale `PWA_COVERAGE_AUDIT_SALESORDER.md` §10/§22-item-4 |
| 3.1-E07 | SO creation paths | Standalone "+ New SO" path exists independent of Enquiry | `MEP_PROJECTS_PWA/index.html` | `mSO()`/`vSOs` | L2039 button gate, `mSO()` no-args call | `new-app/backend/src/services/salesOrderService.js` | `createSalesOrder` | full file (321 ln) | MATCH — corrects stale `PWA_COVERAGE_AUDIT_SALESORDER.md` §4/§18/§21/§22-item-1 |
| 3.1-E08 | Notifications | 5 notify() sites for this workflow (2 SO + 3 Payment) | `MEP_PROJECTS_PWA/index.html` | `saveSO`, `doRaise`, `addPayment` | L2094-2095, L2360, L3828, L3831 | `new-app/backend/src/services/{salesOrderCascade.js,paymentService.js}` | `runCreationCascade`, `raiseToFinance`, `addPartPayment` | notificationRepo.create call sites | MATCH (write); B1 still open (no read/delivery path) |
| 3.1-E09 | Test evidence | Duplicate-conversion atomicity under a simulated race | — | — | — | `new-app/backend/tests/enquiryConversion.test.js` | `'a race that gets past the pre-check is still rejected atomically'` | line 123 | CONFIRMED |
| 3.1-E10 | Test evidence | 287/287 full suite | — | — | — | `new-app/backend` (`npm test`) | `node --test tests/*.test.js tests/auth/*.test.js` | — | PASS (287/287, this session) |

**PWA evidence records in this pass: 10+ direct line/function anchors independently re-confirmed (E01-E08, plus the field-level checklist §7 and role table §25 citations).** **NEW APP evidence records: 10+ file/function citations, each backed by a direct full-file read (not excerpted from memory).** **Test evidence records: 2 explicitly cited (E09-E10), plus ~30 individually-named test cases enumerated in §36.**

---

## 31. Required Connection Table

| Source | Target | Connection Type | PWA Write | PWA Read | NEW APP Write | NEW APP Read | Tenant | Auth | Status |
|---|---|---|---|---|---|---|---|---|---|
| Enquiry | SalesOrder | WRITE-ONLY REFERENCE (PWA) / DIRECT REFERENCE (NEW APP) | PWA: no field written on SO | PWA: none (no field to read) | `SalesOrder.enquiryId` | `findByEnquiryId` (duplicate-guard) | scoped | sales/admin | MATCH (NEW APP adds a real relationship the PWA never had) |
| SalesOrder | Project | DIRECT REFERENCE + WORKFLOW DEPENDENCY | `Project.soNo=so.no` | `projPayInfo` reads `soNo` back to locate the SO | `Project.salesOrderId` | read via `salesOrderId` (Project service, Pass 3.2 territory) | scoped | sales/admin (create), broader view roles | MATCH |
| SalesOrder | Payment | DIRECT REFERENCE + EMBEDDED DATA (dual, §15) | `Payment.soNo`+`mi`; `so.pay[i]` embedded | `syncPayStatus` reads Payment→writes SO; `paySum`/`projPayInfo` read SO→locate Payment | `Payment.salesOrderId`+`milestoneIndex`; `paymentMilestones[i]` embedded | `syncPayStatus`, `findBySalesOrderAndMilestone`, `computeReconciledPaySummary` | scoped | finance/admin (payment ops), sales/admin (SO ops) | MATCH |
| Payment | SalesOrder (received flag) | WRITE-BACK RELATION (bidirectional, one field) | `syncPayStatus`: `so.pay[x.mi].rcv=...` | n/a | `syncPayStatus`: `salesOrderRepo.setMilestoneReceived(...)` | n/a | scoped | finance/admin | MATCH |
| Payment | SalesOrder (amount field) | WRITE-ONLY REFERENCE (one direction only) | `savePayEdit`: `so.pay[x.mi].a=amt` (forward only) | SO-side edit never reads Payment | `editMilestone`: `salesOrderRepo.setMilestoneAmount(...)` (forward only) | `editSalesOrder` never reads Payment | scoped | finance/admin (Payment side) | MATCH (asymmetry preserved) |
| SalesOrder/Payment | Notification | NOTIFICATION RELATION | `notify(roles,text)`, 5 sites this workflow | PWA has a `myNotifs()`-style read (out of scope detail here) | `notificationRepo.create(...)`, 5 sites this workflow | **NO RELATION DEMONSTRATED — no read path exists in NEW APP** | scoped | n/a (write side has no role gate distinct from the triggering action) | PARTIAL MATCH (write matches, read/delivery is B1, open) |
| SalesOrder/Project | ChecklistTemplate | DERIVED RELATION (lookup + copy, not a live reference after) | `defaultChkList(div)` | none after creation | `checklistTemplateRepo.findDefaultForDivision` | none after creation | scoped | sales/admin (via SO/Project create) | MATCH |

---

## 32. Pass 3.1 Checklist

```
## PASS 3.1 CHECKLIST

### Enquiry
[x] Create [x] List [x] Detail [x] Edit [x] Follow-up [x] Lost [x] Reopen [x] Convert [x] Status transitions [x] Fields [x] Roles [x] Tenant [x] Notifications

### SalesOrder
[x] All creation paths [x] Numbering [x] Required fields [x] Edit [x] Milestones [x] Received-state preservation [x] Checklist [x] Project boundary [x] Finance boundary [x] Roles [x] Tenant [x] Notifications [x] Reports/export

### Payment
[x] Creation [x] Milestone relation [x] Manual payment path [x] Part payment [x] Received [x] Received date [x] Overpayment [x] Edit [x] Rollback [x] Delete restriction [x] Finance [x] Roles [x] Tenant [x] Notifications

### End-to-End
[x] Enquiry → SO traced [x] SO → Payment traced [x] SO → Checklist traced [x] SO → Project boundary traced [x] Finance interaction traced [x] Notifications traced [x] Failure paths traced [x] Atomicity traced [x] NEW APP comparison complete
```

("Detail" for Enquiry = `getEnquiry`/`GET /:id`, traced in §7/§25; SalesOrder "Detail" is folded into "Required fields"/"Roles" since `getSalesOrder` was directly read in §12/§25.)

---

## 33-34. Findings by Classification

**MATCH (most of this pass — not individually re-listed; see §6-§28 for each).**

**PWA FUNCTIONAL GAP:** none newly found in this pass (the PWA's own behavior is internally consistent for this workflow — its "gaps" relative to a hypothetical better-designed system, e.g. no SO-to-Enquiry back-reference, no milestone due-date field, no function-level role checks, are documented as PWA facts/quirks in §9/§13/§15/§25, not as PWA functional gaps in the sense of "PWA fails to do something it claims to do").

**PWA / NEW APP INCONSISTENCY (deliberate, locked, not to be re-opened):**
- Issue ID 3.1-I01 — Duplicate/non-Open conversion: PWA allows unlimited re-conversion of a Won/non-Open Enquiry; NEW APP rejects with `409`. PWA Evidence: `saveSO` L2075-2097 (no guard). NEW APP Evidence: `enquiryService.js` `convertEnquiryToSalesOrder` (pre-checks + `markWonIfOpen` + unique index). Impact: none — this is the intended, already-locked `#19=B` decision. Classification: PWA / NEW APP INCONSISTENCY. Blocking: No. Recommended Follow-up: none — already resolved by prior decision-lock; recorded here only per the task's mandatory-classification instruction.

**INFRASTRUCTURE-ONLY DIFFERENCE:** enumerated throughout §9/§10/§17/§19/§20/§23/§25/§26/§27/§28 (transactions, per-company counters, real tenant scoping, real server-side role enforcement, explicit 404/403/409 errors replacing PWA's implicit-crash/UI-hiding behavior, `confirmOverpayment` flag replacing a JS `confirm()` dialog). Not individually re-listed as separate Issue IDs since each is already the locked, approved category from `E2E_WORKFLOW_VERIFICATION_PLAN.md` §0 and does not require a new decision.

**DOCUMENTATION GAP (this pass's own findings about *other* documents, not about NEW APP code):**
- Issue ID 3.1-I02 — `PWA_COVERAGE_AUDIT_SALESORDER.md` §4/§8/§10/§18/§21/§22 state the standalone SO-creation path, the full Payment ledger/sync layer, and the legacy-checklist fallback have "no `new-app` implementation" / are "not yet implemented." **This is now false** — all three are fully implemented and were independently re-verified against source in this pass (§11/§14/§16-20). Impact: a future reader of that document alone (without this pass) would materially understate the current implementation. Classification: DOCUMENTATION GAP. Blocking: No (this pass's own report is the correction; per this engagement's append-only discipline, the older document's prior entries are not edited/deleted). Recommended Follow-up: a future documentation-maintenance task should append a dated correction note to `PWA_COVERAGE_AUDIT_SALESORDER.md` itself pointing future readers to this Pass 3.1 report; not performed here since it is not strictly necessary to unblock STEP 3 and this report already records the correction with full evidence.
- Issue ID 3.1-I03 — `paymentService.js`'s own code comment (`exportPendingPaymentsCsv`'s doc comment) already self-flags that the exact PWA `dlPayments()` CSV column order was reconstructed from `payPanel()`'s displayed columns rather than independently re-derived from the `dlPayments()` function's own source. This pass did not close that gap (time-boxed; §22). Classification: OPEN / NOT DETERMINABLE. Blocking: No — the reconstructed column set is reasonable and does not affect any Enquiry/SO/Payment business-rule finding in this pass. Recommended Follow-up: a future pass (3.7 Notifications/reports, or a dedicated finance-reports check) should grep `dlPayments()`'s literal source and confirm/correct the column order.

**TEST COVERAGE GAP:** none found — every re-verification item this pass was specifically asked to check (duplicate-conversion guard, milestone-amount sync asymmetry, received-flag index preservation) has a directly-named, passing test (§13(a)/§13(b)/§10, test names cited).

**SECURITY / TENANT GAP:** none found (§26 — every NEW APP tenant behavior is a strengthening, not a weakening, of the PWA's structurally absent tenant model).

**AUTHORIZATION GAP:** none found for this workflow — every role-sensitive action traced in §25 has an explicit server-side `assertRole`/division check in `new-app`; the PWA's own total absence of function-level role checks (§25) is documented as a PWA fact/weakness the new backend correctly does not reproduce, per the already-established principle stated in the module's own code comments.

**ATOMICITY / CONCURRENCY GAP:** none found — every multi-entity write in this workflow is transaction-wrapped (§28), and the one place a race actually matters (duplicate conversion) has both a pre-check and a DB-level unique-index backstop, directly tested.

**OPEN / NOT DETERMINABLE:** Issue 3.1-I03 above (dlPayments() exact column order).

**Known gap re-confirmed, explicitly NOT fixed:**
- **B1 (notifications not persisted/delivered)** — confirmed fully open for this workflow specifically (§24): all 5 workflow-relevant `notify()` sites correctly WRITE a `Notification` document, but there is no read/delivery path anywhere in `new-app`'s routes layer. Not fixed in this pass, per instruction.
- **B2 (company deletion cascade)** — out of scope for this workflow (Enquiry/SO/Payment/Finance does not touch company deletion); not re-traced in this pass; status unchanged from Step 2.

---

## 35. Pass 3.1 Blocking Rule — Assessment

Every major part listed in the blocking rule was traced with direct source evidence: Enquiry lifecycle (§6-8) — traced. Conversion (§9-10) — traced. SO creation/edit (§11-13) — traced. SO checklist connection (§14) — traced (SO side; Project-side execution correctly deferred to 3.3). Payment milestone behavior (§15, §13(a)/(b)) — traced, including both re-verification items requested. Payment collection (§16-20) — traced. Finance interaction (§21-22) — traced. Notification triggers (§24) — traced, 5/5 sites, B1 re-confirmed not fixed. Role boundary (§25) — traced. Tenant boundary (§26) — traced. Cross-module connection (§23, §31) — traced (Project boundary marked deferred, not skipped). Major failure paths (§27) — traced. **No major workflow area remains untraced.** The known NEW APP gap (B1) does not block per the rule's own text ("A known NEW APP gap does NOT automatically block — the question is whether the workflow has been verified and classified").

**PASS 3.1 STATUS: PASS.**

---

## 36. Tests

`npm test` run from `new-app/backend/` this session (`node --test tests/*.test.js tests/auth/*.test.js`):

```
# tests 287
# suites 0
# pass 287
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

**287/287, matching the locked baseline exactly.** No test file was modified to achieve this result. Tests directly exercising this pass's re-verification items (by name, confirmed present and passing): `enquiryConversion.test.js` (9 tests, incl. duplicate-conversion race + legacy-checklist-fallback), `enquiryService.test.js` (14 tests, incl. reopen-preserves-lost-fields), `salesOrderService.test.js` (10 tests, incl. milestone rcv-by-index preservation, legacy checklist fallback, standalone-creation), `paymentService.test.js` (11 tests, incl. forward-only amount sync both directions, overpayment confirmation, SO-linked delete restriction).

---

## 37. Final Safety Check (AFTER)

```
git diff --name-status -- v2      -> 37 files (unchanged)
git diff --name-status -- v3      -> 0 files (unchanged)
git status --short                -> unchanged pre-existing 95-entry state, plus this pass's one new file under new-app/docs/ (still fully inside the untracked "?? new-app/" entry — no new tracked-file diff introduced)
md5sum index.html MEP_PROJECTS_PWA/index.html -> both 111b53dba91704f96b83dae96c7793c6 (unchanged)
git diff --cached --name-status   -> 0 (nothing staged)
```
No file under `v1/`, `v2/`, `v3/`, either PWA copy, `new-app/backend/src/`, or any test file was modified by this pass. The only file created is `new-app/docs/E2E_PASS_3_1_ENQUIRY_SO_PAYMENT.md` itself.

---

## 38. Gate

**NEXT ALLOWED STEP: PASS 3.2 — SalesOrder → Project**
