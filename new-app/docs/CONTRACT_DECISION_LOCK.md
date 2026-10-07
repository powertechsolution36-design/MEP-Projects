# Contract Decision Lock

**Status: LOCKED.** This document consolidates and formally locks the 15 Contract/ServiceCall business decisions raised by `PWA_COVERAGE_AUDIT_CONTRACT.md` §25 and resolved individually in `OPEN_DECISIONS.md` #49–#63. It is a documentation consolidation, not an implementation task — `Contract.js`/`ServiceCall.js` (schema only) already exist and already reflect every rule below; no Contract or ServiceCall service/route layer exists yet, and this document does not create one. Nothing here changes any PWA-observed behavior or any already-shipped backend behavior.

Cross-references: `PWA_COVERAGE_AUDIT_CONTRACT.md` (source audit, all section numbers below refer to it unless stated otherwise), `PWA_COVERAGE_AUDIT_PROJECT.md` (for the Project↔Contract conversion boundary), `OPEN_DECISIONS.md` #7, #34, #49–#63, `DOMAIN_MODEL.md` §7 Contract, `DATABASE_SCHEMA.md` §7 `contracts`, `PROJECT_DECISION_LOCK.md` Decision 10 (Contract phone/email, the Project-side half of this same rule).

---

## 1. Locked principle

The PWA is exactly how the business wants the new app to behave. Every Contract/AMC/Warranty/PM behavior found in `PWA_COVERAGE_AUDIT_CONTRACT.md` is preserved exactly by default — including its quirks, asymmetries, and the total absence of edit/delete/role-enforcement — unless the item is infrastructure (tenant isolation, ObjectIds, hashed passwords, storage representation) or genuine server-side security enforcement reproducing the PWA's own *visible* intent. Nothing here "improves," "fixes," "normalizes," or "completes" a PWA quirk. Nothing here invents a Contract→Payment financial rule, a Contract→ServiceCall back-reference, a Contract display number, or any other capability the PWA never had. Where the audit's §25 left an item genuinely undecided between "preserve" and "add a new capability," the resolution below chooses **preserve the PWA exactly**, per the task's default-resolution instruction — this is not this document inventing new business logic; it is applying the one universal rule the whole audit trail has already established.

---

## 2. Contract audit decisions (all 15 items, `PWA_COVERAGE_AUDIT_CONTRACT.md` §25)

Each of the 15 decisions is expanded fully in its own numbered section below. Summary table:

| # | Audit §25 item | Decision | Resolution |
|---|---|---|---|
| 1 | AMC/warranty `amount` → Payment linkage | Decision 1 | PRESERVE PWA — no linkage of any kind |
| 2 | Contract editing | Decision 2 | PRESERVE PWA — immutable, no edit function |
| 3 | Contract deletion | Decision 3 | PRESERVE PWA — no delete function |
| 4 | PM-completion stamping mechanism | Decision 4 | PRESERVE PWA — stamps first-due index, bug-for-bug |
| 5 | 4-visit display/export cap | Decision 5 | PRESERVE PWA — truncation kept exactly |
| 6 | Function-level role enforcement | Decision 6 | INFRASTRUCTURE/SECURITY — enforce PWA's visible intent server-side |
| 7 | Manual-creation notification asymmetry | Decision 7 | PRESERVE PWA — asymmetry kept |
| 8 | Manual `end`-field validation | Decision 8 | PRESERVE PWA — no fallback/validation required |
| 9 | Duplicate conversion | Decision 9 | PRESERVE PWA — no guard added |
| 10 | Project-eligibility re-check inside conversion | Decision 10 | INFRASTRUCTURE/SECURITY — reuse existing `prepareServiceConversion` stub |
| 11 | Expired-contract PM-due visibility | Decision 11 | PRESERVE PWA — still surfaces |
| 12 | Contract↔ServiceCall relationship direction | Decision 12 | PRESERVE PWA — one-way only |
| 13 | Contract display/reference number | Decision 13 | PRESERVE PWA — none added |
| 14 | `fromProject` reverse-lookup UI | Decision 14 | PRESERVE PWA — write-only, no lookup UI |
| 15 | AMC-vs-Warranty behavioral difference | Decision 15 | PRESERVE PWA — label-only |

---

## How to read the decisions below

Each decision gives:
- **Exact PWA behavior** — the literal, source-verified fact from the audit.
- **What the new backend must do** — the rule locked now for whenever Contract/ServiceCall implementation happens.
- **What it must NOT do** — the "fix" that is explicitly forbidden.
- **Infrastructure-only exceptions** — representation differences that don't change observable business behavior.
- **DO NOT FIX** callout.

---

## Decision 1 — AMC/warranty `amount` → Payment linkage

**Exact PWA behavior:** Verified by exhaustively grepping every `DB.payments.push`/`DB.seq.pay++` call site in the entire PWA (four total, all inspected, §17): Contract `amount` never creates or links to a Payment record anywhere, on creation or on any PM-visit completion. `dlContracts()`'s CSV sums `c.amount` into its own report total, but this is a display-only aggregation, never reconciled against `DB.payments`.

**What the new backend must do:** whenever Contract implementation happens, no Contract `amount` → Payment linkage of any kind is to be created — not per-visit, not per-term, not an auto-invoice.

**What it must NOT do:** must NOT invent automatic Payment behavior tied to Contract `amount`, category, or PM-visit completion.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** this is `OPEN_DECISIONS.md` #7/#49. Do not invent a Contract→Payment financial rule the PWA never had.

---

## Decision 2 — Contract editing

**Exact PWA behavior:** Verified by exhaustive search (§9): no `editContract`/`mEditContract`/`updateContract` function exists. The "Add Contract" modal's input-id set is referenced by exactly one builder (`mContract()`) and one saver (`saveContract()`), both of which always create a brand-new row — never look up or mutate an existing Contract by id. `customer`/`phone`/`email`/`site`/`cap`/`start`/`end`/`amcType`/`cat`/`amount` are all write-once at creation. The only field ever mutated post-creation is `scheduledVisits[].completedDate`, and only as an automatic side effect of ServiceCall completion — never a direct edit.

**What the new backend must do:** Contract remains immutable after creation, byte-for-byte matching the PWA. No edit endpoint/service function for any Contract field is to be added.

**What it must NOT do:** must NOT add a genuine edit capability the PWA never had, "because it would be more complete."

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #50. Also corrects a documentation gap: `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md`'s prior "edited"/"Update" language for Contract described only who is authorized to reach the screen, not an actual edit function — see the addenda appended to those documents.

---

## Decision 3 — Contract deletion

**Exact PWA behavior:** No delete function of any kind exists for Contract in the PWA (§9, §13).

**What the new backend must do:** no delete capability is to be added for Contract, for any role.

**What it must NOT do:** must NOT add a delete/archive endpoint.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #51.

---

## Decision 4 — PM-completion stamping mechanism

**Exact PWA behavior:** `saveReport(id, true)` (§7, §10, lines ~3691-3699): on completing ANY ServiceCall with a truthy `contractId`, the code looks up the Contract, recomputes `pmDue(c)` **fresh** (not tied to which specific `scheduledVisits[i]` this ServiceCall was originally scheduled against), and stamps the **first currently-due index** (`due[0]`) as done (`c.svcs[due[0]].done=today()`). If multiple visits are simultaneously due, or multiple ServiceCalls exist against the same contract, completing any one of them only ever advances the first-due slot — never the slot the triggering ServiceCall was actually created for.

**What the new backend must do:** whenever ServiceCall/Contract completion logic is implemented, it must reproduce this exact mechanism: recompute the due-visit list fresh at completion time and stamp the first currently-due index — regardless of which visit the completing ServiceCall was originally scheduled against.

**What it must NOT do:** must NOT add a `visitIndex` (or equivalent) reference on ServiceCall to make the stamp specific to the triggering visit. That would be Choice B in the audit's own framing (§25 item 4) — explicitly not chosen.

**Infrastructure-only exceptions:** none. This is a business-behavior quirk, not a representation detail — it must be preserved bug-for-bug.

**DO NOT FIX:** `OPEN_DECISIONS.md` #52. This is the single most important "DO NOT FIX" in this document — see §6 of this document.

---

## Decision 5 — 4-visit display/export cap for Monthly (12-visit) contracts

**Exact PWA behavior:** both the on-screen AMC list (`vPM()`'s table) and `dlContracts()`'s CSV export hardcode exactly 4 visit-slot columns (`1st`..`4th` Due/Done pairs), regardless of `scheduledVisits.length` (§6, §15, §18 #20). A `Half-Yearly` contract's 2 entries pad with `-`; a `Monthly` contract's 12 entries are truncated — entries 5 through 12 are never rendered or exported anywhere.

**What the new backend must do:** whenever the Contract list/report UI is implemented, it must preserve this exact 4-slot truncation for both display and CSV export.

**What it must NOT do:** must NOT show or export all scheduled visits regardless of count — that would silently reveal Monthly-contract data the PWA itself never surfaced, changing the observable report.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #53.

---

## Decision 6 — Function-level role enforcement for Contract actions

**Exact PWA behavior:** zero function-level role checks exist anywhere in the Contract code path (§13): `convertToService`, `saveContract`, `saveCall`/`mCall`, `saveReport`, `dlContracts` all perform no role check at all — every restriction is menu-item visibility or an inline button-rendering ternary. Any authenticated user of any role, calling these functions directly from the browser console, can perform any Contract action regardless of their role.

**What the new backend must do:** following the same precedent already applied to SalesOrder/Payment (`OPEN_DECISIONS.md` #22, Choice A there), a future implementation must enforce, **server-side**, the PWA's own **visible** role intent:
- Contract create (both manual and conversion paths), PM-schedule/ServiceCall creation, and reports/CSV export: `admin` or `service_mgr`.
- PM-visit/ServiceCall completion: the assigned engineer (`isEng`, matched by identity) or `admin`/`service_mgr` (`isMgr`) — mirroring `vCall()`'s own rendering gate.

**What it must NOT do:** must NOT reproduce the PWA's own total lack of function-level checks as a business behavior (that would be a security hole, not a business rule) — but also must NOT add any role restriction beyond what the PWA's menus/buttons already visibly gate (e.g. must NOT restrict Contract *viewing* to a division-matched PM, since the PWA does not division-scope Contract at all — §2 of the audit).

**Infrastructure-only exceptions:** real server-side authorization replacing UI-only security is the allowed infrastructure/security adaptation for this decision specifically — the PWA's own weakness (no server check at all) is intentionally not carried over, exactly as already accepted for SalesOrder/Payment.

**DO NOT FIX (the other direction):** do not invent new role restrictions beyond the PWA's own visible menu/button gates — e.g. do not division-scope Contract actions (the PWA never division-scopes Contract/AMC/PM at all, per §2 of the audit). `OPEN_DECISIONS.md` #54.

---

## Decision 7 — Manual-creation notification asymmetry

**Exact PWA behavior:** `saveContract()` (manual AMC/Warranty creation) contains **no** `notify()` call whatsoever (§4 Path B, §12) — no one is notified when a manual contract is created. `convertToService()` (Path A) does notify `service_mgr`+`admin`. This asymmetry is a PWA FACT, not a bug the PWA corrects anywhere.

**What the new backend must do:** preserve this exact asymmetry — manual Contract creation fires no notification; conversion-created Contracts fire the existing `service_mgr`+`admin` notification.

**What it must NOT do:** must NOT add a notification to manual Contract creation "to match" the conversion path, and must NOT consolidate the two into one shared notification behavior.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #55.

---

## Decision 8 — Manual `end`-field validation

**Exact PWA behavior:** `saveContract()`'s manual path (§3, §4 Path B) stores `end` as whatever `gv("ct_ed")` returns, with **no fallback and no validation** — unlike every other field in that function. A blank end date is accepted and stored as `""`. Combined with `contractStatus()`'s string comparison (`c.end<t`), a blank `end` immediately reads as `"Expired"` (§18 #17).

**What the new backend must do:** the future business-facing create-Contract workflow must not require a valid `end` date beyond what the PWA itself required (i.e., none) — no *business*-level "you must pick a valid end date" rule is to be added.

**What it must NOT do:** must NOT add client- or server-side business validation forcing a non-blank/valid `end` date on manual Contract creation.

**Infrastructure-only exceptions:** `Contract.js`'s existing Mongoose-level `endDate: { required: true }` is a pre-existing, allowed infra tightening (a database column cannot literally be absent the way a JS object property can be `""`) — but this is a storage-representation necessity, not license to add a business validation rule stopping a user from proceeding without a valid date. Whoever eventually builds the create-Contract API must reconcile this tension (e.g. rejecting truly missing input at the transport layer is infra; rejecting it as "invalid business input" when the PWA itself accepted it is not) rather than silently tightening business rules.

**DO NOT FIX:** `OPEN_DECISIONS.md` #56.

---

## Decision 9 — Duplicate conversion

**Exact PWA behavior:** nothing in `convertToService(id)` prevents calling it more than once for the same Project id (§18 #9) — each call independently increments `DB.seq.contract` and pushes a brand-new Contract row, with a fresh 1-year window computed from "now." A Project could accumulate multiple `fromProject`-linked Contracts.

**What the new backend must do:** preserve exactly — no uniqueness constraint or guard against repeated conversion of the same Project.

**What it must NOT do:** must NOT add a guard against duplicate conversion, unlike the different precedent chosen for Enquiry's Won-transition guard (`OPEN_DECISIONS.md` #19, Choice B — real backend protection was added there). That precedent is explicitly **not** applied here; this is a deliberately different resolution for a structurally similar-looking situation, because the audit's own default (preserve unless instructed otherwise) governs here, whereas #19 was resolved differently by explicit business decision in the Enquiry business-decision sheet.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #57.

---

## Decision 10 — Project-eligibility re-check inside conversion

**Exact PWA behavior:** `convertToService(id)` itself performs **zero** re-verification of `Project.status`/`div` (§4, §18 #8) — only the UI button's render condition (`p.status==="Completed" && p.div!=="MEP"`) checks this. Any role could call `convertToService(id)` directly from the console on a project not currently `"Completed"`.

**What the new backend must do:** `projectService.js`'s existing `prepareServiceConversion`/`isEligibleForServiceConversion` already re-verifies `status==="Completed" && division!=="MEP"` server-side as a defense-in-depth stub, byte-for-byte matching the PWA's own UI-visible condition. A future Contract-creation function must trust and reuse this existing stub rather than omitting the check to mirror the PWA's own lack of a function-level check.

**What it must NOT do:** must NOT add any *additional* eligibility condition beyond the PWA's own UI-visible one (i.e. must not also require, say, no existing Contract from this Project — see Decision 9 above, which explicitly allows duplicates).

**Infrastructure-only exceptions:** this re-check is the allowed security/infrastructure adaptation — it reproduces exactly the PWA's own UI-visible intent as a server-side check (defense-in-depth against a direct API call bypassing the UI), not a new business rule, since the *conditions checked* are identical to what the PWA's button already visibly gates.

**DO NOT FIX (the other direction):** do not add extra conditions beyond `status==="Completed" && division!=="MEP"`. `OPEN_DECISIONS.md` #58.

---

## Decision 11 — Expired-contract PM-due visibility

**Exact PWA behavior:** `pmDue(c)` is computed independently of `contractStatus(c)` (§6, §18 #13) — an already-`"Expired"` contract's still-not-done past-month visits remain "due" and continue to surface in the PM-Due panel indefinitely; nothing excludes Expired contracts from the due-visit scan. The PM-Due panel and the Renewal-Opportunities panel can both list the same contract simultaneously.

**What the new backend must do:** preserve exactly — a future PM-due computation/panel must continue to surface Expired contracts' overdue visits.

**What it must NOT do:** must NOT suppress Expired contracts from the PM-due panel/computation "because it's already expired" — that is a fix, not a preservation.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #59.

---

## Decision 12 — Contract↔ServiceCall relationship direction

**Exact PWA behavior:** one-way only, ServiceCall → Contract (§7, §21). Contract does NOT store any ServiceCall ids/references — no `svcCallIds[]` or similar array exists on Contract, confirmed absent from both creation paths and the full seed data. ServiceCall stores `contractId` (truthy for PM-type calls, `0` for Complaint-type). There is no "Service History" panel/tab on the Contract's own display anywhere — the PWA reconstructs any "this contract's service calls" view only implicitly, inside the completion side-effect, never as a rendered list.

**What the new backend must do:** preserve the one-way relationship exactly — `ServiceCall.contractId` remains the only link; `Contract.js` must not gain a reverse `serviceCallIds[]` array, a virtual populate, or any derived "service history" field.

**What it must NOT do:** must NOT invent a Contract→ServiceCall collection or back-reference of any kind, and must NOT add a "Service History" view on the Contract detail screen that the PWA never had.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #60. See §7 of this document for the fuller write-up of this boundary.

---

## Decision 13 — Contract display/reference number

**Exact PWA behavior:** unlike ServiceCall's genuine `psc` display sequence (e.g. "PSC-401"), Contract has **no** display sequence at all (§7) — it is referenced everywhere only by its raw internal `id`, or by customer/site name in the UI, never by a human-facing contract number.

**What the new backend must do:** do not add a Contract display/reference number.

**What it must NOT do:** must NOT introduce a `contractNumber`/`AMC-xxxx` style sequence — this would be a genuine new capability the PWA never had, not inferable from it.

**Infrastructure-only exceptions:** none (Mongo `_id` already correctly substitutes for the PWA's raw internal `id` — this was already noted as COVERED in the audit's §19 field table, not a gap).

**DO NOT FIX:** `OPEN_DECISIONS.md` #61.

---

## Decision 14 — `fromProject` reverse-lookup UI

**Exact PWA behavior:** the PWA never surfaces "which Contract did this Project spawn" (or vice versa) in its own UI, despite storing the forward `fromProject`/`originatingProjectId` link (§16, §18 #18) — no PWA function ever reads `fromProject` to look anything up; it is write-only, exactly analogous to the already-documented `InventoryIssue.projId` "write-only, functionally dead foreign key" pattern (`OPEN_DECISIONS.md` #33).

**What the new backend must do:** leave `originatingProjectId` write-only exactly as observed.

**What it must NOT do:** must NOT add a reverse-lookup UI/endpoint ("show originating Project from Contract" or "show spawned Contract from Project") surfacing this link — even though it would be a reasonable, low-risk convenience, it is a new capability the PWA never offered.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #62.

---

## Decision 15 — AMC-vs-Warranty category having zero behavioral difference

**Exact PWA behavior:** verified there is **no** behavioral difference between `cat="AMC"` and `cat="Warranty"` beyond the stored label/badge color (`b-blu` for AMC, `b-prp` otherwise) and the renewal-panel's framing text ("Warranty → paid AMC") (§18 #15). Schedule generation, `pmDue()`, `contractStatus()`, and every calculation treat both categories identically.

**What the new backend must do:** preserve this label-only treatment exactly.

**What it must NOT do:** must NOT introduce any behavioral distinction between AMC and Warranty categories — no different default cadences, no different Payment treatment, no different validation.

**Infrastructure-only exceptions:** none.

**DO NOT FIX:** `OPEN_DECISIONS.md` #63. This does not "normalize Warranty vs AMC behavior" in either direction — it locks their existing, already-identical treatment.

---

## 3. Exact PWA behavior (by major area)

**Entity/fields (§3 of the audit):** `id`, `co`, `customer`, `phone`, `email`, `site`, `cap`, `start`, `end`, `amcType` (Monthly/Quarterly/Half-Yearly), `cat` (AMC/Warranty), `amount`, `svcs[]` ({m, done}), `fromProject`. Only `site` is client-side enforced non-empty on the manual path; every other field is optional or system-defaulted. `svcs[i].done` is the only field ever mutated post-creation.

**Creation paths (§4):** exactly two — Project-conversion (`convertToService`, hardcoded Warranty/Quarterly/₹0/phone=""/email="") and manual (`saveContract`, fully user-entered, `amcType`/`cat` user-selected). No third path exists.

**PM schedule generation (§5):** Monthly = 12 visits, 1 month apart. Half-Yearly = **2** visits, 6 months apart (not 6 visits — a corrected assumption). Quarterly = 4 visits, 3 months apart. Conversion path is always hardcoded Quarterly/4-visit regardless of the fact `amcType` is stored as `"Quarterly"`. Visits are `{month:"YYYY-MM", done}`, generated once, never regenerated/resized/reordered.

**PM due/expiring logic (§6):** `pmDue(c)`: visit due iff not done AND month <= current month (string comparison). `contractStatus(c)`: Expired if `end < today`; Expiring Soon if today >= end−45 days (and not already Expired); else Active. These are pure, independent, read-time computations.

**Contract→ServiceCall (§7):** one-way (ServiceCall.contractId → Contract); PM-visit ServiceCalls created only via staff-initiated "Schedule PM"; completion stamps the first currently-due visit index, not the triggering visit's own slot.

**Manual AMC (§8):** distinct flow from conversion — own customer/contact/site entry, own amount, own amcType/cat selection, own schedule, own dates, no notification.

**Contract editing (§9):** none exists — write-once at creation, immutable thereafter except the automatic `done` stamp.

**Service visit completion (§10):** stamped `today()` at ServiceCall-completion time; ServiceCall's own rich report data is never copied onto Contract.

**Contract status (§11):** exactly three derived values — Active/Expiring Soon/Expired — independent of `scheduledVisits` completion state.

**Notifications (§12):** six `notify()` calls total, exhaustively enumerated (see §14 of this document).

**Roles/authorization (§13):** zero function-level role checks anywhere in the Contract code path; every restriction is menu/button visibility only.

**Search/list/dashboard (§14):** ten-field substring search (`customer, phone, email, site, cap, amcType, cat, start, end, amount`); no filters/sorting beyond that; PM-Due panel and Renewal-Opportunities panel are the only dashboard surfaces.

**Reports/export (§15):** exactly one export, `dlContracts()`, 20 fixed CSV columns, truncated to 4 visit-slot pairs, filtered by current search text, company-scoped.

**Project relationship (§16):** at most one Project per Contract via `fromProject`; write-only; no re-sync if the Project changes later.

**Payment relationship (§17):** none exists anywhere, for any Contract action.

---

## 4. New-app behavior required

- Mirror every field, both creation paths' exact defaults, and the exact 12/2/4 visit-cadence formulas whenever Contract/ServiceCall service and route layers are eventually implemented.
- Implement `pmDue`/`contractStatus` as the literal algorithms in §6 of the audit — string/date-boundary semantics preserved (45-day threshold, month `<=` comparison).
- Implement the ServiceCall-completion side effect exactly as described in Decision 4 (stamp first-due index).
- Implement server-side role enforcement per Decision 6 (the one true infrastructure/security adaptation in this whole document).
- Implement the Project-eligibility re-check per Decision 10 (already partially done via `prepareServiceConversion`).
- Do not implement anything else beyond documentation in this task — Contract/ServiceCall service/route layers remain future work.

---

## 5. Infrastructure-only differences

- **Tenant isolation:** `companyId` ObjectId ref replaces the PWA's raw `co` integer — mandatory backend infrastructure, not a business change.
- **ObjectIds:** Mongo `_id` replaces the PWA's `++DB.seq.contract` integer id — no display-number gap results, since the PWA never had one either (Decision 13).
- **Date typing:** `startDate`/`endDate` as real `Date` types (vs. the PWA's plain `"YYYY-MM-DD"` strings) — representation upgrade only; comparison semantics (lexicographic string vs. chronological Date) must still produce the same Active/Expiring/Expired outcomes for every valid PWA-representable date.
- **`scheduledVisits[].completedDate` as `Date|null`** (vs. the PWA's `""`/`"YYYY-MM-DD"` string) — same representation upgrade, same semantics (falsy-until-stamped).
- **Real enums** (`amcType`, `category`) at the Mongoose level, vs. the PWA's convention-only strings — the PWA's own `<select>` never produces an out-of-set value anyway, so this tightens nothing observable.
- **`site: { required: true }`** at the Mongoose level — the PWA already enforces this via its one client-side `toast()` check; the schema constraint is a storage-layer mirror of an existing business rule, not a new one.
- **Server-side role enforcement (Decision 6)** and **the eligibility re-check reuse (Decision 10)** — both reproduce the PWA's own visible intent as real backend enforcement, replacing UI-only security; this is the allowed "server-side authorization matching PWA-visible intent" adaptation named in the ground rules.
- **Transactions/storage adaptations** for integrity (e.g., atomic Contract-creation + Project-status-update when conversion is eventually implemented) are permitted infra, provided the *observable* two-step behavior (Contract created, `Project.status="In Service"`, no re-verify beyond Decision 10) matches the PWA exactly.

No other infrastructure exception is identified. Every other item in this document is PRESERVE PWA.

---

## 6. Explicit "DO NOT FIX" list

Consolidated from the audit's §18/§23 quirk lists and this document's 15 decisions — do not "fix" any of the following, ever, without an explicit new business instruction overriding this lock:

1. Duplicate manual Contract creation is never blocked — no uniqueness check of any kind on `customer`/`site`/dates for manually created contracts (audit §18 #10).
2. Duplicate Project→Contract conversion is never blocked — the same Project can spawn multiple Contracts (Decision 9).
3. Expired contracts continue to appear in the PM-Due panel forever (Decision 11).
4. Warranty vs. AMC (`cat`) is a label-only distinction — no behavioral difference is ever introduced (Decision 15).
5. ServiceCall completion stamps the **first currently-due** scheduled-visit slot, not the slot the completing ServiceCall was actually created against (Decision 4) — this is the single most tempting "obvious bug" in the whole audit; it is explicitly preserved.
6. Phone/email are hardcoded blank (`""`) on Project→Contract (Warranty) conversion — never copy the SalesOrder/Project contact's real phone/email onto the new Contract (audit §4/§18 #7; re-confirms `OPEN_DECISIONS.md` #34 and `PROJECT_DECISION_LOCK.md` Decision 10).
7. Role/UI-only weaknesses are not silently "fixed" by adding *extra* business restrictions beyond the PWA's own visible menu/button intent — only the exact visible intent is enforced server-side (Decision 6); e.g. do not division-scope Contract, since the PWA never does.
8. Schedule/date quirks: `scheduledVisits[].month` is month-only (day discarded); dates are compared as plain strings/lexicographically equivalent-to-chronological; a blank manual `end` is accepted and immediately reads as "Expired" (Decision 8; audit §18 #17).
9. Stale/write-only fields: `fromProject`/`originatingProjectId` is write-only, never looked up (Decision 14); `cap`/`capacity` is display-only, never used in any calculation (audit §18 #18).
10. String-based date comparison quirks: `c.end<t`, `s.m<=tm` are plain string comparisons, not Date-object comparisons — this "works" only because `"YYYY-MM-DD"`/`"YYYY-MM"` strings sort chronologically; this mechanism, and its edge cases (e.g. blank `end` sorting before any real date), are preserved, not hardened (audit §18 #17).
11. The 4-visit display/export cap silently truncates a Monthly contract's 5th–12th visits from both the on-screen list and the CSV export (Decision 5).
12. Manual AMC/Warranty creation fires zero notifications, asymmetric with the conversion path's notification (Decision 7).
13. No Contract-edit or Contract-delete function exists, and none is to be added (Decisions 2–3).
14. No Contract→Payment linkage of any kind exists, and none is to be added (Decision 1).
15. No Contract display/reference number exists, and none is to be added (Decision 13).
16. Contract↔ServiceCall stays one-way; no reverse array/history/collection is to be added (Decision 12; see §7 below).

---

## 7. Contract → ServiceCall boundary

- ServiceCall holds `contractId` (an ObjectId ref to Contract, truthy only for PM-type calls); Contract has **no** reverse array, no `serviceCallIds[]`, and no derived "service history" field — this one-way direction is locked exactly (Decision 12).
- Do NOT invent a Contract→ServiceCall join collection, back-reference array, or virtual populate. Any "this Contract's service calls" view must be built, if ever needed, by *querying* ServiceCall for matching `contractId` at read time — exactly how the PWA's own completion side-effect does it — never by a stored back-reference.
- The completion-stamps-first-due-slot quirk (Decision 4) must be preserved literally whenever ServiceCall/Contract completion logic is eventually implemented: on completing a ServiceCall with a truthy `contractId`, recompute the due-visit list fresh and stamp the first currently-due `scheduledVisits` index — never a `visitIndex`-specific stamp tied to the particular ServiceCall that triggered it.
- PM-visit ServiceCall creation remains entirely staff-initiated ("Schedule PM" from the PM-due panel) — never automatic, never triggered by a visit becoming due.
- Complaint-type ServiceCalls remain entirely independent of Contract (`contractId` falsy/`0`).

---

## 8. Contract → Payment boundary

- Contract `amount` never creates or links to a Payment record — not on creation (either path), not on renewal (renewal is not a distinct workflow — it is just a fresh manual "Add Contract" with no linkage to the expiring one), and not on any PM-visit completion (Decision 1).
- The only Payment-adjacent event that can occur near a Contract is generic to ServiceCall, not Contract-specific: if a ServiceCall's own `report.stype==="Chargeable"` and `amount>0`, a Payment row is created and `finance` is notified — this applies to any ServiceCall (PM-type or Complaint-type) whose report happens to be filed that way, entirely independent of the Contract's own stored `amount` field. A `type:"PM"` call's report defaults its `stype` to `"AMC"`, not `"Chargeable"`, so this is not the normal PM-completion path.
- There is no Contract→Payment financial logic to invent, ever, for this document's scope — this remains `OPEN_DECISIONS.md` #7/#49, permanently resolved as "no linkage," not merely deferred.

---

## 9. Warranty conversion rules (`convertToService`)

Locked exactly as audited (§4 Path A, §5, §18 #5–#7):

- `category` = `"Warranty"` (hardcoded).
- `amount` = `0` (hardcoded — a warranty contract is never billed).
- `amcType` = `"Quarterly"` (hardcoded — always 4-visit cadence, regardless of the originating project's division/capacity/value).
- **1-year duration, exact inclusive end-date calculation:** `start = today()`; `end = today() + 1 calendar year − 1 day` (`setFullYear(+1)` then `setDate(-1)`) — e.g. a contract starting `2026-01-01` ends `2026-12-31`, not `2027-01-01`.
- **4 PM schedule entries, one per calendar quarter, starting the current month:** generated by `for(q=0;q<4;q++){d=new Date(); d.setMonth(d.getMonth()+q*3); ...}` — always exactly 4 entries, always 3 months apart, always anchored to "today" at generation time (not re-read from the Contract's own `start`, though the two coincide on this path).
- **`phone`="" and `email`="" — kept blank.** Must NOT copy the SalesOrder/Project contact's real phone/email onto the new Contract, even though that data exists upstream (`Project.customer` is itself sourced from the SO contact name). This is a hardcoded literal in the PWA, not a failed lookup — re-confirmed by the audit's own trace (§4/§18 #7), and already locked from the Project side in `PROJECT_DECISION_LOCK.md` Decision 10 / `OPEN_DECISIONS.md` #34.
- **No eligibility re-check beyond the PWA's own UI-visible condition** (`status==="Completed" && division!=="MEP"`) — see Decision 10 above for the one permitted infra/security adaptation (server-side re-verification of this same condition).
- **Duplicate conversion is not blocked** — see Decision 9 above.
- `customer` = `p.customer||p.name`; `site` = `p.name`; `cap` = `p.cap` — copied once, never re-synced if the Project later changes.
- `Project.status` is set to `"In Service"` unconditionally, with no re-check of the prior status inside the function itself (only Decision 10's server-side re-check, which mirrors the UI gate, is added).
- Fires `notify(["service_mgr","admin"], "Commissioning approved: ... converted to Service project — 1 year warranty, quarterly PM scheduled.")`.

---

## 10. Manual AMC rules

Locked exactly as audited (§4 Path B, §8):

- A separate flow from conversion — reached via "+ Add Contract" in the AMC/PM list, not from a Project screen.
- Own fields: `customer`, `phone`, `email`, `site`, `cap`, `start` (defaults to today if blank), `end` (no fallback — see Decision 8), `amcType` (user-selected, default Quarterly), `cat` (user-selected, default AMC — but Warranty is also selectable here, with zero behavioral difference per Decision 15), `amount` (user-entered, defaults 0).
- Own frequency/schedule: driven by the selected `amcType` exactly per the 12/2/4 cadence table (§11 below), computed from the Contract's own `start`, not from "today."
- The only client-side validation is non-empty `site` — every other field, including a fully blank `customer`/`phone`/`email`/`amount`/`end`, is accepted.
- No automatic Payment is ever created (Decision 1/8 of this document).
- No notification fires on manual creation (Decision 7).
- No edit/delete exists for a manually created Contract, same as a converted one (Decisions 2–3).

---

## 11. PM cadence rules

Locked exactly per the audit's re-verified cadence table (§5):

| `amcType` | Visit count | Interval | Notes |
|---|---|---|---|
| Monthly | **12** | 1 month | matches the task's original assumption |
| Half-Yearly | **2** | 6 months | **corrected assumption** — NOT 6 visits/6 months; the actual PWA cadence is 2 visits, 6 months apart (exactly one year of coverage, at month 0 and month 6) |
| Quarterly | **4** | 3 months | matches the task's original assumption; also the fallback for any unrecognized `amcType` value and the value always hardcoded by the conversion path |

Exact generation logic to preserve (not a new algorithm) — the literal PWA generator:
```
n = amcType==="Monthly" ? 12 : amcType==="Half-Yearly" ? 2 : 4;
step = amcType==="Monthly" ? 1 : amcType==="Half-Yearly" ? 6 : 3;
base = new Date(start);
for (i=0;i<n;i++){ d=new Date(base); d.setMonth(d.getMonth()+i*step); scheduledVisits.push({month: d slice to "YYYY-MM", completedDate: null}) }
```
The first visit is always at `i=0` — the contract's own start month itself, not one interval later. Month values are month-only strings (`"YYYY-MM"`); day-of-month is discarded. Once generated, the schedule is never regenerated, resized, or reordered — no "add a visit"/"remove a visit"/"change cadence after creation" capability exists or is to be added.

---

## 12. Status/due/expiry rules

Locked exactly per the audit's re-verified algorithms (§6, §11):

- **Contract status** (`contractStatus(c)`), exactly three values:
  - `"Expired"` if `end < today`.
  - `"Expiring Soon"` if `today >= end − 45 days` (and not already Expired).
  - `"Active"` otherwise.
- **PM due** (`pmDue(c)`): a scheduled visit is due iff `!completedDate && month <= currentMonth` (string/lexicographic comparison of `"YYYY-MM"` values, which is chronologically equivalent for well-formed values). A future-month visit is never due; a past uncompleted month stays due indefinitely (no upper bound, no "too late, drop it" logic).
- **Expired contracts still appear in due panels** — not "fixed." `pmDue()` is computed entirely independently of `contractStatus()`; nothing excludes an Expired contract's overdue visits from the PM-Due panel (Decision 11).
- **Overdue vs. due** is a display-layer-only distinction (`month < currentMonth` for "overdue" styling) — `pmDue()`'s own return value lumps both together.
- Completing every scheduled visit does **not** change `contractStatus()` — status depends only on `endDate`, never on `scheduledVisits` completion state; there is no "schedule fully complete" flag or notification.

---

## 13. Role/security rules

- The PWA's **visible functional intent** (menu/button gating) is reproduced as real server-side enforcement (Decision 6): `admin`/`service_mgr` for Contract create (either path), PM-schedule/ServiceCall creation, and reports export; the assigned engineer or `admin`/`service_mgr` for PM-visit/ServiceCall completion.
- The PWA's **total lack of function-level checks** is NOT reproduced as a business behavior — that would be a genuine security hole carried forward unnecessarily, and the ground rules explicitly allow "server-side authorization matching PWA-visible intent" as an infrastructure adaptation.
- Conversely, **no new business role restriction is added beyond that visible intent** — e.g., Contract/AMC/PM remains **not** division-scoped in the new backend, exactly as it is not division-scoped in the PWA (audit §2); do not gate Contract actions to a matching-division PM, since no such concept exists in the PWA for Contract at all (there is only one door: `admin`/`service_mgr`, full stop).
- These two statements are compatible, not contradictory: "enforce the PWA's *visible* intent server-side" and "don't add restrictions beyond that visible intent" together describe exactly one rule — replicate what the buttons/menus already show, no more, no less.

---

## 14. Reports/notifications rules

**Reports (`dlContracts()`, §15):** exact column order (`Customer, Phone, Email, Site, Capacity, Category, AMC Type, Amount, Start, End, Status, PM Due Now, 1st Due, 1st Done, 2nd Due, 2nd Done, 3rd Due, 3rd Done, 4th Due, 4th Done`), exact row values (raw fields, `contractStatus(c)`, `pmDue(c).length`, the 4-slot truncation per Decision 5), exact totals row (`contract count`, `amt` = sum of `Number(amount)||0` across filtered rows, `due` = sum of `pmDue(c).length` across filtered rows), raw unconverted `"YYYY-MM-DD"` date strings in the CSV (no locale reformatting, unlike the `money()`-formatted on-screen display), company-scoped and filtered by whatever the on-screen search text currently is (not necessarily the whole company's contract list). No new filters, no new KPI, no "originating Project" column (never exported by the PWA).

**Search/list (§14):** ten-field substring search (`customer, phone, email, site, cap, amcType, cat, start, end, amount`), case-insensitive, no other filters, no sorting. PM-Due panel columns (`Site, Customer, Phone, Type/cat, Service Due month, [Schedule PM]`); Renewal-Opportunities panel columns (`Site, Customer·Phone, Category, End Date, Status`), listing any contract whose status is not `"Active"` — informational only, no "renew" action/button exists.

**Notifications — every Contract-related `notify()` call, exact recipients/trigger/wording/timing/frequency/duplicate-behavior, preserved individually, never consolidated (§12):**

| # | Trigger | Recipients | Message (verbatim, with substitutions) | Timing | Dedup/Throttle |
|---|---|---|---|---|---|
| 1 | `convertToService(id)` | `service_mgr`, `admin` | `Commissioning approved: "`+p.name+`" converted to Service project — 1 year warranty, quarterly PM scheduled.` | immediately on conversion | none — fires every call, callable repeatedly (Decision 9) |
| 2 | `saveCall(contractId)`, PM path | `service_mgr`, `admin` | `PM scheduled: PSC-`+psc+` — `+customer+` (`+site+`)` | on scheduling a PM visit's ServiceCall | none |
| 3 | `saveCall(contractId)`, Complaint path (contrast only, not Contract-related) | `service_mgr`, `admin` | `New complaint registered: PSC-`+psc+` — `+customer+` (`+site+`)` | on registering a complaint | none |
| 4 | `saveReport(id,true)`, chargeable branch | `finance` | `Chargeable service PSC-`+psc+` completed — `+money(amount)+` to collect from `+customer` | on completion, only if `report.stype==="Chargeable" && amount>0` | none |
| 5 | `saveReport(id,true)`, always | `service_mgr`, `admin` | `PSC-`+psc+` completed by `+(eng||U.name)+` — `+customer` | on any service-call completion (applies to PM visits too) | none |
| 6 | `assignCall(id)` (contrast — applies to PM-type calls too) | all company users | `Service call PSC-`+psc+` (`+customer+`) assigned to `+eng+(optional appointment date/time) | on assigning an engineer/appointment | fires only if `s.eng` truthy after save |

**Never notified:** manual AMC/Warranty contract creation (Decision 7); a Contract becoming Expiring Soon/Expired (pure read-time computation); a PM visit becoming due (pure pull/dashboard-based, no proactive alert). None of these six notifications is to be consolidated, merged, deduplicated, or extended in scope — each fires exactly as enumerated, independently.

---

## 15. Deferred ServiceCall items

- Contract may, in a future implementation, expose the Contract→PM-due→ServiceCall-creation-later integration boundary described in §7 above (i.e., `ServiceCall.contractId` and the "Schedule PM" staff-initiated creation flow) — but this document does not implement the ServiceCall business module now, and neither should any future task treat this document as authorization to do so.
- Everything ServiceCall-specific that is not the Contract-facing boundary (assignment, report capture, checklist/signature capture, chargeable-Payment creation, the four canned customer messages, PSC display-sequence generation) is out of this document's scope entirely and remains governed by whatever future ServiceCall-specific audit/decision-lock task is eventually run.
- This document's job, per its ground rules, ends at: documenting and locking the Contract-side decisions and the Contract↔ServiceCall/Contract↔Payment boundaries. No ServiceCall, Contract, or Inventory code is implemented, modified, or scaffolded by this document.

---

*End of document. No Contract, ServiceCall, Project, Payment, Notification, or Inventory source code was implemented, modified, or scaffolded to produce this document.*
