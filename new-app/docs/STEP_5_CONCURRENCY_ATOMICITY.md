# STEP 5 — Concurrency / Atomicity Verification

Status date: 2026-09-26. Backend verification stage only — no deployment or frontend claims.

## Stage 5 Status

**PASS** (one genuine P0 finding was found, fixed as FIX-5-01, re-verified, and full regression re-run green).

## Methodology note (read first)

No MongoDB is reachable in this verification environment: `mongodb-memory-server`'s
binary download is blocked by the outbound proxy (`fastdl.mongodb.org` → HTTP 403
for every version tried). Rather than fall back to code-reading only, a dedicated
harness (`new-app/backend/tests/concurrencyHarness.js`) was built that models
MongoDB's real multi-document transaction semantics closely enough to actually
**execute** the unmodified service layer under genuine concurrent interleaving:

- Each `withTransaction(deps, fn)` attempt runs `fn` against a fresh, fully
  isolated clone of the committed store — exactly what a MongoDB snapshot
  transaction gives: it never sees another in-flight transaction's uncommitted
  writes.
- At commit, if no other transaction committed since this attempt's snapshot was
  taken, the clone is copied back as the new committed state. If one did, this
  attempt is discarded and `fn` is re-run from scratch against a fresh snapshot —
  exactly what the real `session.withTransaction()` driver helper does on a
  MongoDB `TransientTransactionError`/`WriteConflict`.
- The conflict check is at the whole-store level (coarser than MongoDB's
  per-document detection), which is strictly **more** conservative — it can force
  extra retries but can never let two conflicting writes silently both "win",
  so it cannot manufacture a false PASS by being too lenient.
- Reads/writes a service makes **before** calling `withTransaction` are, correctly,
  plain reads against the live committed store, exactly matching a non-session
  Mongoose call in the real repositories.

Every concurrency test below drives the real `src/services/*.js` modules,
unmodified, with genuine `Promise.allSettled([...])` concurrent calls — this is
explicitly **not** a literal MongoDB integration test, and is documented as such
here and in the harness file's own header. It gave enough fidelity to expose a
real, reproducible bug (FIX-5-01, below), which a naive in-memory-only fake could
not have distinguished from a false positive.

New test file added (net-new, no existing file modified or weakened):
`new-app/backend/tests/concurrencyAtomicity.stage5.test.js` (13 tests) plus its
helper `new-app/backend/tests/concurrencyHarness.js`.

## Atomicity coverage

All **19** rows of the master transaction map were reviewed against source:
Enquiry→SalesOrder, SalesOrder→Project, SalesOrder→Payment, SalesOrder→Checklist,
SalesOrder→Notifications, Project→Contract, Contract→ServiceCall,
ServiceCall→Payment, ServiceCall→Contract due update, Inventory
Issue/Return/Damaged Return/Mark Used/Transfer/Adjustment/Purchase/Opening Stock
(8 rows), User creation, Notification persistence.

| Workflow | Atomicity mechanism (source) | Result |
|---|---|---|
| Enquiry→SalesOrder | `Enquiry.markWonIfOpen` atomic conditional update + `SalesOrder.enquiryId` unique+sparse index (`businessRepositories.mongoose.js:86-95`, `salesOrderRepo.create` L110-124; `SalesOrder.js:83`), whole cascade in `withTransaction` (`enquiryService.js:518`) | MATCH |
| SalesOrder→Project | Fused into the same `withTransaction` as SalesOrder creation (`salesOrderCascade.js:190-241`); `Project.js:144` unique(companyId,salesOrderId) index is the DB-level backstop for any theoretical double-invocation | MATCH / INFRASTRUCTURE-ONLY DIFFERENCE (Project is never a separately-triggerable mutation off an existing SO in this app — see Finding F4) |
| SalesOrder→Payment | Milestone amount/received writes and Payment creation go through `withTransaction` (`paymentService.js`); `raiseToFinance`'s "create if missing" branch backed by `Payment.js:79-82` unique(companyId,salesOrderId,milestoneIndex) sparse index | MATCH (see Finding F3 for a minor error-handling gap) |
| SalesOrder→Checklist | Copy-by-value at SO/Project-creation time only (`salesOrderCascade.js` `resolveChecklist`); template edits never retroactively touch already-created checklists (PWA quirk, preserved) | MATCH |
| SalesOrder→Notifications | Created inside the same `withTransaction` as the triggering write in every path exercised (cascade, payment, service call, inventory) | MATCH |
| Project→Contract | `convertProjectToContract` (`contractService.js:284`), single `withTransaction`; duplicate conversion of the same Project is explicitly **not** guarded, per **locked** CONTRACT_DECISION_LOCK.md Decision 9 | MATCH (intentional PWA-preserved quirk — confirmed by test #8, both conversions succeed cleanly, no corruption) |
| Contract→ServiceCall | Per-company `Counter.getNextSequence` atomic `$inc`+upsert (`businessRepositories.mongoose.js:596-602`) for `complaintNumber`; creation inside `withTransaction` | MATCH |
| ServiceCall→Payment | `completeIfNotCompleted` atomic conditional update (`businessRepositories.mongoose.js:351-357`) gates the whole completion transaction, including the conditional Chargeable Payment write, in one `withTransaction` (`serviceCallService.js:662`) | MATCH |
| ServiceCall→Contract due update | `completePmVisitForContract` (`contractService.js:522-529`) re-reads the Contract fresh **inside** the caller's transaction (threaded via `deps.session`), so a transaction retry correctly recomputes the next-due slot instead of double-stamping | MATCH |
| Inventory Issue | Pre-check + atomic `$inc` + fresh in-transaction availability re-check (`inventoryService.js:issueMaterial`, item read is INSIDE `withTransaction`) | MATCH |
| Inventory Return | **Was** stale-read-outside-transaction (see Finding F1 / FIX-5-01) | FIXED (was ATOMICITY/CONCURRENCY GAP, now MATCH) |
| Inventory Damaged Return | Same code path as Return (`acceptReturn` with `damaged:true`) — fixed by the same FIX-5-01 change | FIXED (same root cause as Return) |
| Inventory Mark Used | **Was** stale-read-outside-transaction (see Finding F1 / FIX-5-01) | FIXED (was ATOMICITY/CONCURRENCY GAP, now MATCH) |
| Inventory Transfer | Availability re-check is INSIDE `withTransaction` (`inventoryService.js:transferStock`) | MATCH |
| Inventory Adjustment | Availability re-check is INSIDE `withTransaction` (`inventoryService.js:adjustStock`) | MATCH |
| Inventory Purchase / Opening Stock | Pure additive `$inc`, no ceiling check needed; both land under concurrency (test #7) | MATCH |
| User creation | Pre-check (`existsByCompanyAndUsername`) + `User.js:40` unique(companyId,username) index as DB-level backstop; no `withTransaction` (single-doc op, none needed) | MATCH (see Finding F3 for the same raw-duplicate-key error-handling gap) |
| Notification persistence | Always created with the same `session` as its triggering write, in every one of the ~9 transactional paths inspected; no orphan-notification path found | MATCH |

## Concurrency coverage

**13 concurrency scenarios were actually executed** (real `Promise.allSettled`
concurrent calls into the live service modules via the harness above, not
code-reading):

1. Enquiry→SalesOrder double conversion (also exercises the fused SO→Project/Checklist/Notifications cascade)
2. Inventory Issue race (10 available, two Issue(7))
3. Inventory Return race (10 balance, two Return(7)) — **the FIX-5-01 case**
4. Inventory Mark Used race (10 balance, two MarkUsed(7)) — **the FIX-5-01 case**
5. Inventory Transfer race (10 at source, two Transfer(7))
6. Inventory Adjustment race (two concurrent -7 adjustments)
7. Inventory Purchase race (two concurrent +5 purchases)
8. Project→Contract double conversion (locked "unguarded" decision)
9. ServiceCall completion race (double-complete → Payment → Contract due update)
10. Checklist `setDefaultTemplate` race (two different templates, same division)
11. User creation duplicate-username race
12. Cross-company concurrent Inventory Issue (isolation under load)
13. Project checklist `setChecklistItemDone` race (documented P2 finding — see F2)

All 13 pass after FIX-5-01 (0 failing). Two workflows named in the master task
(SalesOrder→Payment's `addPartPayment`/`editMilestone`/`raiseToFinance`, and
Notification-persistence-under-forced-rollback) were verified by **source
inspection only**, not by a dedicated concurrent-execution test in this pass —
stated plainly here rather than implied as executed.

## Inventory concurrency

| Action | Executed? | Result |
|---|---|---|
| Issue | Yes (test #2) | Exactly one of two Issue(7) against available=10 succeeds; stock lands at exactly 3, never negative, never double-decremented. |
| Return | Yes (test #3) | **Before FIX-5-01**: both concurrent Return(7) against balance=10 succeeded, stock over-credited to 14 and `quantityReturned` ledger field corrupted to 7 (lost the first commit's value) — reproduced and confirmed (see Findings). **After FIX-5-01**: exactly one succeeds, stock=7, ledger=7. |
| Damaged Return | Not separately executed as its own concurrency test, but shares 100% of `acceptReturn`'s code path (the `damaged:true` branch) — fixed by the same FIX-5-01 change; the stock-increment step is simply skipped for damaged returns, so the fix's re-fetch/re-validate applies identically. | FIXED (via F1) |
| Mark Used | Yes (test #4) | **Before FIX-5-01**: both concurrent MarkUsed(7) against balance=10 succeeded; ledger's `quantityUsed` ended at 7 instead of the true 14 (a silent lost update — stock itself was never touched, correctly, per Decision 24). **After FIX-5-01**: exactly one succeeds, `quantityUsed`=7. |
| Transfer | Yes (test #5) | Exactly one of two Transfer(7) from a source of 10 succeeds; source=3, destination=7, total conserved. |
| Adjustment | Yes (test #6) | Exactly one of two concurrent -7 adjustments against 10 succeeds (would otherwise go negative); final stock=3. |
| Purchase | Yes (test #7) | Both concurrent +5 purchases land (no ceiling to race against); final stock=10, two ledger transactions, no lost update. |
| Opening Stock | Covered by source inspection (`createItem`, single-shot at item-creation time inside its own `withTransaction`; not a concurrently-re-enterable action in the same sense as the others) | MATCH |

Exact formulas re-verified against `inventoryService.js`: `stockAtLocation` (L144),
`totQty` (L151), `stockState` (L157), `issBal` (L168), `issStatus` (L172) — all
unchanged by FIX-5-01; only the point in the transaction where `issue` is read
changed, never the formulas themselves.

## Cross-module coverage

| Pair | Result |
|---|---|
| Enquiry→SO | MATCH — exactly one SalesOrder/Project/Checklist/Payments/Won-transition persist under a double-conversion race; the loser is rejected with `DUPLICATE_CONVERSION` or `ENQUIRY_NOT_OPEN` depending on exactly which atomic check it loses (both are the same locked guard family, `enquiryService.js`'s own comment). |
| SO→Payment | MATCH by inspection — `editMilestone`/`raiseToFinance` re-fetch inside the transaction correctly; `addPartPayment`'s pre-transaction overpayment-confirmation check can be raced past under concurrent submissions (Finding F5, P3 — not a data-corruption issue, the part-payment record itself is always correctly and completely persisted). |
| SO→Project | MATCH — fused into one transaction, not a separately racy action (Finding F4). |
| Project→Contract | MATCH — both concurrent conversions of the same Project succeed cleanly (locked Decision 9), no corruption, no partial state. |
| Contract→ServiceCall | MATCH — atomic per-company counter, transactional creation. |
| ServiceCall→Payment | MATCH — `completeIfNotCompleted` atomic guard; exactly one Completed transition, one conditional Payment, one Contract due-slot stamp under a double-complete race. |
| Users→workflows | MATCH — re-ran the FIX-3.8-01 cross-module workflow assertion (a freshly created User immediately participates in Inventory/ServiceCall/Project lookups) under the same test harness pattern; still holds. Username-collision race: exactly one user persists (DB unique index backstop), confirmed by test #11. |
| Checklist→workflow | ATOMICITY/CONCURRENCY GAP, P2 — `setChecklistItemDone` (and the same whole-array-replace pattern in `setChecklistItemRemark`/`approveChecklistItem`/execution-update and delivery-challan mutators) can lose one user's tick if two different checklist items on the **same** Project are ticked concurrently by two different users (e.g. two assigned engineers). Reproduced by test #13. See Finding F2. |
| Notifications→workflows | MATCH — every notification observed across all 13 executed scenarios and all inspected code paths is created with the same transaction session as its triggering business write; no orphan notification was produced by any rolled-back or losing-side attempt. |

## Findings

**F1 — ATOMICITY/CONCURRENCY GAP (P0, FIXED as FIX-5-01).**
`inventoryService.acceptReturn` and `inventoryService.markUsed` read the `Issue`
document and computed its balance **before** calling `deps.withTransaction`, then
used that pre-transaction, closed-over value inside the transaction body to
compute the new `quantityReturned`/`quantityUsed`. On a write-conflict retry
(exactly what happens when two concurrent calls target the same Issue), only the
inner `async (txnDeps) => {...}` closure is re-run — the outer stale `issue`
variable is never refreshed. Empirically reproduced: two concurrent
`acceptReturn(quantity:7)` calls against a balance of 10 both succeeded, credited
stock twice (10→14, should have capped at one accepted return, final stock 7),
and left the Issue's own `quantityReturned` ledger field wrong (7, not
reflecting either the true single accepted return or the corrupted double one)
— a silent, undetectable phantom-stock and ledger-corruption bug. The identical
pattern in `markUsed` under-recorded `quantityUsed` (7 instead of the true 14)
after two accepted Mark-Used calls, corrupting the audit trail and leaving a
phantom remaining balance that does not actually exist.
*Fix:* re-fetch the Issue and re-validate its balance **inside** the transaction
closure on every attempt (`inventoryService.js` L570-586 for `acceptReturn`,
L714-728 for `markUsed`), exactly matching the already-correct pattern used by
`issueMaterial`/`adjustStock`/`transferStock` in the same module. Re-verified:
targeted tests #3 and #4 now pass (exactly one of the two concurrent calls
succeeds; the loser is cleanly rejected with the same `VALIDATION_ERROR`/balance
message a sequential caller would see). Full regression re-run green (356/356).

**F2 — ATOMICITY/CONCURRENCY GAP (P2, reported, not fixed this stage).**
`projectService.setChecklistItemDone` (and, by the same documented
architectural pattern — see the repo's own comment at
`businessRepositories.mongoose.js` L178-192 — likely
`setChecklistItemRemark`/`approveChecklistItem`/execution-update/
delivery-challan mutators) reads the whole Project, builds a **new whole
checklist array** reflecting only its own change, and writes that whole array
back inside the transaction. If two different users tick two *different*
checklist items on the *same* Project within the same race window, the second
commit's whole-array write can silently discard the first commit's already-saved
tick — reproduced by test #13 in this pass. The module's own code comment
explicitly acknowledges this trade-off ("this module's actual concurrency
profile — one project, one PM/engineer acting on it at a time in practice") but
`assignedEngineerIds` is a list, so two co-assigned engineers legitimately can
act on the same Project concurrently. Classified P2 (not P0/P1) because: no
stock/money is corrupted, no silent phantom value results, and the failure mode
a user experiences is a checklist tick reverting and needing to be re-applied
— annoying but visible and recoverable, unlike F1's silent phantom stock. Per
the engagement rules, this is reported, not fixed, in this stage. Recommended
remediation for a future stage: convert these mutators to positional
`checklist.${itemIndex}.<field>` updates (mirroring `setMilestoneAmount`'s
positional-path pattern in `salesOrderRepo`) instead of whole-array replace.

**F3 — TEST COVERAGE GAP / error-handling polish (P3, not fixed).**
Three places rely on a MongoDB unique index as the *sole* concurrency backstop
but do not catch/translate the resulting raw `E11000` duplicate-key error into
the same friendly `ServiceError` their own pre-check throws:
`projectRepo.create` (`Project.js:144` unique index, no catch in
`businessRepositories.mongoose.js` unlike `salesOrderRepo.create`'s explicit
translation), `paymentRepo.create` inside `raiseToFinance`'s
create-if-missing branch (`Payment.js:79-82`), and `userWriteRepo.create` inside
`userService.createUser` (`User.js:40`). In every case the transaction correctly
aborts and no duplicate record persists (atomicity/data-integrity is intact,
confirmed for the User case by test #11) — the only defect is that the caller
would see a raw, technical Mongo error instead of a clean 409. Not a data
integrity risk; recommended for Stage 6 (API/contract hardening).

**F4 — INFRASTRUCTURE-ONLY DIFFERENCE.**
Unlike the PWA (where `saveSO()` synchronously creates both the SalesOrder and
its Project in one function call) and unlike the master task's assumption of a
separately-triggerable "SalesOrder→Project" action, the NEW APP fuses Project
creation into the same `withTransaction` as SalesOrder creation
(`salesOrderCascade.js`) — there is no route or service function that creates a
Project for an *already-existing* SalesOrder. This removes an entire class of
"duplicate Project for one SO" race by construction, backed by
`Project.js:144`'s unique index as a pure defense-in-depth backstop. This
matches PWA behavior (single synchronous browser-side call, no concurrency
possible there either) and is a strengthening, not a business-logic change —
classified INFRASTRUCTURE-ONLY DIFFERENCE, not a gap.

**F5 — OPEN/NOT DETERMINABLE (P3).**
`paymentService.addPartPayment`'s overpayment-confirmation check
(`amt > balanceBefore` prompting `OVERPAYMENT_CONFIRMATION_REQUIRED`) is computed
from a pre-transaction read. Two concurrent legitimate part-payments that
individually pass the check but jointly exceed the balance will both post
without either being flagged for confirmation. The monetary records themselves
are always correctly and completely persisted (verified: `pushPartPayment` is a
pure `$push`, and `syncPayStatus` recomputes status from the fresh post-write
document inside the transaction) — this is a soft advisory gap, not a ledger
corruption, and the PWA itself has no hard cap here either (per this module's
own `editPartPayment` comment). Not fixed; flagged for awareness only.

## Fix tasks

**FIX-5-01 — IMPLEMENTED AND RE-VERIFIED.**
Files changed: `new-app/backend/src/services/inventoryService.js`
(`acceptReturn` and `markUsed` — see F1 above for the exact diff description
and line numbers). No PWA business formula changed (`issBal`/`issStatus`/
`stockAtLocation` are untouched); only the point at which the Issue document is
read moved from before the transaction to inside it, matching the pattern
already used elsewhere in the same file. No other file touched for this fix.
Verification: targeted concurrency tests #3/#4 (previously failing, empirically
reproducing the bug) now pass; full regression suite re-run green at 356/356
(see Tests below); safety checks re-run clean (see Safety below).

No other FIX-5-xx was needed — F2/F3/F5 are P2/P3 and are reported, not fixed,
per the engagement rules for this stage.

## Tests

- Targeted (new, this stage): **13/13** passing
  (`new-app/backend/tests/concurrencyAtomicity.stage5.test.js`), after FIX-5-01.
  Before the fix, 2/13 failed (Return, Mark Used), correctly reproducing F1 —
  confirming the harness has real discriminating power, not just green-by-default.
- Full regression: **356/356** passing
  (343 baseline + 13 new Stage 5 concurrency tests), split across two `node --test`
  invocations for wall-clock reasons only (`tests/*.test.js` → 313/313;
  `tests/auth/*.test.js` → 43/43); `npm test`'s own single-glob script is
  unchanged and still runs the same full set. No existing test was modified,
  skipped, or weakened.

## Safety

Before this stage's work:
- `git diff --name-status -- v2` → 37 files (matches the existing, unchanged baseline drift)
- `git diff --name-status -- v3` → 0 files
- `git diff --cached --name-status` → empty (nothing staged)
- `md5sum index.html MEP_PROJECTS_PWA/index.html` → `111b53dba91704f96b83dae96c7793c6` for both

After FIX-5-01 and all test runs:
- `git diff --name-status -- v2` → 37 files (unchanged)
- `git diff --name-status -- v3` → 0 files (unchanged)
- `git diff --cached --name-status` → empty (nothing staged)
- `md5sum index.html MEP_PROJECTS_PWA/index.html` → `111b53dba91704f96b83dae96c7793c6` for both (unchanged)
- Only files touched this stage: `new-app/backend/src/services/inventoryService.js`
  (FIX-5-01), `new-app/backend/tests/concurrencyHarness.js` (new),
  `new-app/backend/tests/concurrencyAtomicity.stage5.test.js` (new), and this
  report. Nothing under `server/`, `v2/`, `v3/`, either PWA `index.html`, or
  `new-app/frontend/` was touched.

## Current project state

This was a backend verification stage only. No deployment progress is claimed —
the prior hard deadline (Sept 24, 2026 23:59 IST) has already passed, and nothing
in this stage changes that. `new-app/frontend/` remains empty/out of scope and
was not touched.

## Carried-forward findings

Restated in full, none dropped or silently closed:
- **B2** — Company deletion/cascade (not in scope this stage).
- **FIX-3.7-01 / 3.7-02 / 3.7-03 / 3.7-04** — notification content-fidelity gaps (not in scope this stage; notification *atomicity/timing* was re-verified clean in this stage, but their *content* fidelity is unchanged and still open).
- **Pass 3.2 report persistence gap** — still open, not addressed here.
- Two smaller P3 exporter/source-walk gaps from prior passes — still open.
- **F2** (this stage) — Project checklist whole-array-replace lost-update risk (P2) — newly identified, reported, not fixed; carry into Stage 6 or a dedicated follow-up.
- **F3** (this stage) — three raw-duplicate-key error-handling gaps (P3) — newly identified, reported, not fixed.
- **F5** (this stage) — part-payment overpayment-confirmation race (P3) — newly identified, reported, not fixed.
- `new-app/frontend/` — still empty, out of scope.

## Next gate

**NEXT ALLOWED: STEP 6 — API / CONTRACT / TEST HARDENING**
