# Stage 6 Final Closure

Date: 2026-09-27
Scope: new-app/ only (v1 `server/`, LIVE v2, in-dev v3 permanently out of scope, never modified).
Source of truth for all behavior: `MEP_PROJECTS_PWA/index.html` (byte-identical to root `index.html`,
md5 `111b53dba91704f96b83dae96c7793c6`, including the confirmed-expected uncommitted offline-read-cache
feature).

## 1. Final endpoint count
123 endpoints reconciled between the PWA's functional surface and the new-app API contract (Workstream A).

## 2. Workstream A — PASS
API endpoint reconciliation: 123/123 endpoints accounted for. No change this session.

## 3. Workstream B — PASS
API contract completeness verified against the PWA's demonstrated request/response shapes. No change
this session.

## 4. Workstream C — PASS
~145 PWA functions audited for behavioral fidelity. No change this session.

## 5. Workstream D — PASS (now that FIX-6-05/06/07 have landed)
Workstream D covers the three defects that were open going into this stage: the Payment pending export
(FIX-6-05), the Payment receipts ordering (FIX-6-06), and the Project export (FIX-6-07). All three are
resolved and re-verified below — Workstream D is now clear of unresolved P0–P3 defects within Stage 6
scope.

## 6. Workstream E — PASS
All 4 cross-module chains verified; all 7 NO-RELATION boundaries confirmed absent. No change this
session.

## 7. FIX-6-04 summary (previously resolved, reconfirmed unaffected)
API contract missing endpoints — resolved in an earlier pass; unaffected by this session's payment/
project service changes (full regression below covers it).

## 8. FIX-6-05 — RESOLVED (Payment pending export scope)

**Original finding:** `exportPendingPaymentsCsv` (backend `paymentService.js`) hard-filtered to
`status: 'Pending'` only, was missing the `SO No`, `Status`, and `Part-Payments` columns entirely, and
collapsed the PWA's 3 separate "Raised by PM" / "Raised On" / "Collect By" columns into a single string.

**PWA evidence** (`dlPayments()`, index.html:3552): `rows = mine(DB.payments).filter(hit(...))` — the
**full** payments collection (no status filter). Exact 16-column header: `Project, SO No, Person, Phone,
Milestone Amount, Received, Balance, Status, Raised by PM, Raised On, Collect By, Last Call, Discussion,
Next Call, Remark, Part Payments`. `x.soNo` and `x.status` are read directly off the payment record (not
derived). `Part Payments` = `(x.paid||[]).length`. TOTAL row = `out.push([], ["TOTAL","","","",t,r,b])` —
a blank line then a short, un-padded 7-field row.

**Implementation change:** removed the `{ status: 'Pending' }` filter from the `paymentRepo.listByCompany`
call; expanded the header/row to all 16 PWA columns; resolved `SO No` via the durable
`salesOrderId -> SalesOrder.orderNumber` ref (infra-only substitution for the PWA's plain display number);
split the collapsed "Raised By" string into its three own columns (`raisedToFinance.raisedByUserId`
resolved to a name via `userRepoForEnquiry`, `raisedDate`, `collectByDate`); added the `Part Payments`
count column; reproduced the exact blank-line + short TOTAL row shape.

**Tests:** `backend/tests/paymentService.test.js` — 2 new tests: full-column-set + representative values
(SO No resolved to `36002`, Status `Pending` read directly, Part Payments count, a `Received`-status
row now present that the old filter silently dropped, cross-tenant row excluded, exact TOTAL row shape)
and role-restriction (finance/admin only, unaffected by the fix).

**Export execution evidence** (in-memory harness, real output):
```
PAYMENTS REPORT

Project,SO No,Person,Phone,Milestone Amount,Received,Balance,Status,Raised by PM,Raised On,Collect By,Last Call,Discussion,Next Call,Remark,Part Payments
Rishab Showroom - Satara,36002,Mr. Mayur Jain,9028495310,278100,100000,178100,Pending,Vaibhavi Finance,2026-08-01,2026-08-10,,,,,1
Sneh Resort AC,,Yuvraj,8605394494,200000,0,200000,Pending,,,,,,,,0

TOTAL,,,,478100,100000,378100
```

## 9. FIX-6-06 — RESOLVED (Payment receipts ordering)

**Original finding:** NEW APP's `exportReceiptsCsv` sorted receipts newest-first via
`.sort((a,b)=>...)`; the PWA has no such sort.

**PWA evidence** (`dlReceipts()`, index.html:3958): `mine(DB.payments).forEach(x=>(x.paid||[]).forEach(p=>
rows.push(...)))` — no `.sort()`/`.reverse()` anywhere in the function. Raw insertion order: outer loop
over the Payment array in its natural order, inner loop over that Payment's `paid[]` array in its natural
order.

**Implementation change:** removed the `.sort((a, b) => (a.p.date < b.p.date ? 1 : -1))` call entirely.
No other field, role, or tenant-scope logic touched.

**Tests:** `backend/tests/paymentService.test.js` — 2 new tests: (a) a Payment with two part-payments
inserted newest-first by array order but oldest-first by date — asserts the newer-dated-but-first-inserted
entry stays first (this test fails under the old sort and passes under the fix); (b) two separate Payment
records where the second was inserted after the first but carries a much later receipt date — asserts the
first payment's receipt still precedes the second's (outer array order preserved, not date order).

**Export execution evidence** (in-memory harness, real output — single receipt shown, ordering already
covered by the dedicated multi-entry regression tests above):
```
PAYMENT RECEIPTS LEDGER

Date,Project,SO No,Person,Phone,Amount Received,Mode,Reference,Invoice Issued,Milestone Amount,Milestone Balance,Status,Entered By,Remark
2026-08-05,Rishab Showroom - Satara,so1,Mr. Mayur Jain,9028495310,100000,RTGS,RT001,No,278100,178100,Pending,u1,

,,,,TOTAL,100000
```
Note (out of FIX-6-06's approved scope — ordering only): the `SO No` column here prints the raw
`salesOrderId` string (`so1`) rather than the resolved `SalesOrder.orderNumber` display number. This is a
pre-existing field-resolution gap distinct from the ordering defect this fix targeted; the task's
instructions for FIX-6-06 explicitly restricted changes to ordering only ("don't alter receipt data,
fields..."), so it was left untouched and is flagged here for a future, separately-scoped fix.

## 10. FIX-6-07 — RESOLVED (Project export: all 26 columns + role gate)

**Original finding:** NEW APP's `exportProjectsCsv` reproduced only 13 of the PWA's 26 `dlProjects()`
columns (missing delay/checklist-progress/payment-summary/next-action fields), and had no role gate of
any kind — any authenticated same-company user could call it.

**PWA evidence** (`dlProjects()`, index.html:3498) — all 26 columns traced to source:

| # | PWA column | Source / derivation |
|---|---|---|
| 1 | SO No | `x.soNo` -> `SalesOrder.orderNumber` via `salesOrderId` ref |
| 2 | Project | `x.name` |
| 3 | Division | `x.div` |
| 4 | Site Type | `x.siteType` |
| 5 | Capacity | `x.cap` |
| 6 | Customer | `x.customer` |
| 7 | Stage | `x.stage` |
| 8 | Status | `x.status` |
| 9 | Start | `x.start` |
| 10 | Target End | `timelineReady(x) ? projTargetEnd(x) : ""` — latest checklist target date, blank until timeline is ready |
| 11 | Engineers | `(x.engs||[]).join(", ")` -> resolved names from `assignedEngineerIds` |
| 12 | Vendor | `x.vendor` |
| 13 | Checklist | `x.chkName` |
| 14 | Points Done | `x.chk.filter(done).length` |
| 15 | Total Points | `x.chk.length` |
| 16 | Approved Points | `x.chk.filter(c.appr && c.appr.by).length` |
| 17 | Timeline Set | `timelineReady(x) ? "Yes" : "No"` |
| 18 | Overdue Points | `delayedItems(x).length` — not done, has a target date, target date < today |
| 19 | Max Delay (days) | `max(daysBetween(plan, today))` over overdue points, blank if none |
| 20 | Last Action | last `x.updates[]` entry's `.done` (renamed `actionDone`) |
| 21 | Last Action Date | last update's `.d` (`date`) |
| 22 | Next Action | last update's `.next` (`nextAction`) |
| 23 | Next Action Date | last update's `.nd` (`nextActionDate`) |
| 24 | Material Pending Return | sum of `(qty - rqty)` over returnable delivery challans |
| 25 | Payment Received | `projPayInfo(x).rcv` -> reconciled `paySum()` via linked SalesOrder, `""` if no SO resolves |
| 26 | Payment Pending | `projPayInfo(x).pen` -> same reconciliation, `""` if no SO resolves |

Role/visibility intent (`MENUS`, re-verified): the "Projects" menu item — the sole reachable entry point
to `vProjects()`/`dlProjects()` — is listed only for `admin`, `hvac_pm`, `solar_pm`, `mep_pm`. The PWA
itself never enforces this server-side (it is a client-only SPA; `nav()` performs no role check), so this
is the PWA's demonstrated intent rather than a literal server behavior to copy — per the task's explicit
instruction, the new backend (which has a real server) enforces that intent. Division scoping
(`myDiv()`/`hasDiv()`, PM roles restricted to their own division, admin/others seeing all) was already
correctly implemented in `listProjects` and is unchanged.

**Implementation change:** rewrote `exportProjectsCsv` (`projectService.js`) to emit all 26 columns in
exact PWA order, reusing already-verified helpers (`isTimelineReady`, `computeTargetEnd`,
`computePendingReturnableMaterial`) and the salesOrderService's already-reconciled `paySum()` port
(`computeReconciledPaySummary`) for the payment-summary columns rather than re-deriving that logic a
second time; added a new `PROJECT_EXPORT_ROLES = ['admin','hvac_pm','solar_pm','mep_pm']` gate enforced
via `assertRole` before any data is read. No new division restriction was invented beyond what
`listProjects` already scopes; no Project→Inventory or other unsupported relation was introduced.

**Tests:** `backend/tests/projectService.test.js` — 4 new tests:
- All 26 columns, exact order, and representative derived values against a rich fixture (mixed
  done/approved/overdue checklist points, multiple execution updates, mixed returnable/non-returnable
  delivery challans, a SalesOrder with one flagged-received and one ledger-reconciled milestone).
- Role gate: `admin`/`hvac_pm`/`solar_pm`/`mep_pm` succeed; `sales`, `finance`, `engineer`, `service_mgr`,
  `service_eng`, `inventory`, `super` are all rejected with `FORBIDDEN` — proving server-side rejection,
  not just frontend menu-hiding.
- Division scoping preserved: a `solar_pm` sees zero rows for an HVAC project; a `hvac_pm` sees it.
- Tenant isolation: another company's project never appears in the export.

**Export execution evidence** (in-memory harness, real output):
```
PROJECT LIST

SO No,Project,Division,Site Type,Capacity,Customer,Stage,Status,Start,Target End,Engineers,Vendor,Checklist,Points Done,Total Points,Approved Points,Timeline Set,Overdue Points,Max Delay (days),Last Action,Last Action Date,Next Action,Next Action Date,Material Pending Return,Payment Received,Payment Pending
36002,Rishab Showroom - Satara,HVAC,Commercial,26,Mayur Jain,Piping,Ongoing,2025-08-15,2026-01-01,Deepak Engineer,Rajiudeen,Standard HVAC Checklist,1,2,1,Yes,1,270,Piping done,2026-08-01,Start ducting,2026-09-01,40,855800,178100
```
Role-gate rejection, executed live: calling as `sales` returned
`FORBIDDEN — Role "sales" is not permitted to export Project reports.` (request never reached the data
layer).

## 11. All relevant tests
Full regression: **373/373 pass, 0 failures** (see §17 for breakdown). New tests added this session: 8
(2 FIX-6-05, 2 FIX-6-06, 4 FIX-6-07) — a legitimate increase over the prior 365/365 baseline; no test was
weakened, skipped, or deleted.

## 12. Export execution evidence
See §8, §9, §10 above — all three exports were actually executed against the in-memory fake-repository
harness (no real MongoDB replica set is reachable in this environment) and their real CSV output
inspected, in addition to the automated regression tests.

## 13. Account relationship verification summary
Unchanged from Workstream E (locked): all 4 cross-module chains verified, all 7 NO-RELATION boundaries
(Checklist/Enquiry/SalesOrder have no direct User FK; Inventory→ServiceCall/Finance/Checklist = no
relation; InventoryIssue.projId write-only; ServiceCall→Contract one-directional) remain intact and
undisturbed by this session's payment/project export changes.

## 14. Checklist verification summary
Checklist execution-item fields (`done`, `targetDate`, `approval.approverName`) were read (never mutated)
by the FIX-6-07 Project export fix, using the same field semantics already verified in
`runDelayCheckForProject` and `computeIncompleteOrUnapprovedChecklistCount`. No checklist behavior changed.

## 15. Finance verification summary
Payment ledger semantics (`computeReceived`, `computeBalance`, part-payment structure, milestone linkage)
are unchanged. FIX-6-05 changed only which rows and columns are exported and how `SO No`/raise-to-finance
fields are surfaced; FIX-6-06 changed only iteration order. Role enforcement (`finance`/`admin` only) is
unchanged and re-verified by the new tests.

## 16. Service verification summary
Not in scope for this stage's three fixes; ServiceCall behavior is untouched.

## 17. Inventory verification summary
Not in scope for this stage's three fixes; Inventory behavior is untouched. `deliveryChallans` fields
(`returnable`, `quantity`, `returnedQuantity`) were read (never mutated) for the Project export's
"Material Pending Return" column, reusing the already-verified `computePendingReturnableMaterial` helper.

## 18. Notification verification summary
No notification was added, removed, or altered by any of the three fixes — all three are read-only export
functions.

## 19. MongoDB environment limitations (honestly stated)
No real MongoDB replica set is reachable in this environment. All service-layer changes were verified —
both automatically (regression tests) and manually (live export execution) — against the same in-memory
fake-repository harness (`tests/enquiryFakes.js`) used throughout prior workstreams, which implements the
exact repository interface the real Mongoose-backed repositories (`businessRepositories.mongoose.js`)
expose. This proves correct application/service-layer logic; it does not exercise the real MongoDB driver,
indexes, or transaction semantics, which remain unverified against a live database in this environment.

## 20. Final safety result
Re-run identically to the pre-work baseline:
- `git diff --name-status -- v2`: 37 files (unchanged from baseline)
- `git diff --name-status -- v3`: 0 files (unchanged from baseline)
- `md5sum index.html MEP_PROJECTS_PWA/index.html`: `111b53dba91704f96b83dae96c7793c6` for both
  (unchanged, PWA untouched)
- `git status --short`: 95 entries (unchanged count; `new-app/` shows as one untracked-directory entry,
  its only change)
- Nothing staged or committed.

## 21. Final Stage 6 verdict: **PASS**

All exit criteria met: FIX-6-05, FIX-6-06, and FIX-6-07 are resolved and re-executed against real PWA
source evidence; full regression is 373/373 with 0 failures (8 legitimate new tests, none weakened,
skipped, or deleted); the Project export role gate is verified including server-side rejection of
unauthorized roles even when bypassing the frontend menu; tenant isolation is verified for all three
exports; all three affected exports were re-checked against the PWA's literal source (not just the new
tests); and the final safety check passes unchanged from baseline. No unresolved P0–P3 implementation
defect remains within Stage 6 scope. (One out-of-scope, pre-existing informational note is flagged in §9:
`exportReceiptsCsv`'s `SO No` column prints the raw internal `salesOrderId` rather than the resolved
`SalesOrder.orderNumber` — left untouched per FIX-6-06's explicit "ordering only" instruction, and
recommended as a small follow-up fix in a future stage.)
