# STAGE 6 — Report/Export Audit (Workstream D)

Inventory: see `STAGE_6_REPORT_EXPORT_INVENTORY.md` (14 CSV export families,
no non-CSV report/export exists in either system).

## Scope actually executed this pass
Zero of the 14 export families had a dedicated **tenant-isolation** test
before this pass (`tests/tenantIsolationCrossCompany.test.js` does not
mention any `Csv`/`export` symbol). 4 families additionally had **zero**
functional test coverage at all: `exportSalesOrdersCsv`, `exportProjectsCsv`,
`exportPendingPaymentsCsv`, `exportReceiptsCsv`.

This pass:
1. Executed all 4 previously-untested export functions directly against the
   real service code, seeded with two disposable companies (`coA`, `coB`),
   and inspected the raw generated CSV text (see
   `STAGE_6_REPORT_EXPORT_EXECUTION_EVIDENCE.md`).
2. Verified tenant isolation for those same 4 by real execution (not just
   code inspection) — company A's report never contained company B's
   distinctive test string and vice versa, for both companies, in each of
   the 4 exports. All 8 checks PASSED.
3. Line-by-line compared each of the 4 functions' output against the actual
   PWA source function it claims to reproduce (`dlSOs`, `dlProjects`,
   `dlPayments`, `dlReceipts` — read directly from
   `MEP_PROJECTS_PWA/index.html`), not from the PWA audit docs' summaries.
4. Confirmed the full regression suite still passes at 365/365 (no code was
   changed in this pass — see Tests section).
5. Cited, but did not re-execute, the 10 remaining families (Enquiry,
   Contract, ServiceCall, all 5 Inventory reports, Delivery Challan, Project
   detail report) — these already have passing unit-level tests exercising
   the real service functions with the same fake-repository harness,
   including several with explicit role-gate and cross-company tests
   (e.g. `tests/inventoryService.test.js` lines 533-600). Re-deriving that
   coverage from scratch was out of budget for this pass; it is flagged as
   **not independently re-verified in this pass** rather than claimed PASS
   on my own authority.

## Findings

### FIX-6-05 (P2, Documentation/Behavior gap — Payment report scope split)
**Classification: D** (behavior mismatch) for `exportPendingPaymentsCsv`,
compounded by **E** (already self-flagged as reconstructed in code comments,
now confirmed against real PWA source).

PWA has exactly ONE payments report, `dlPayments()` (index.html:3552),
covering **every** payment record regardless of status (filtered only by
free-text search), with 16 columns: `Project,SO No,Person,Phone,Milestone
Amount,Received,Balance,Status,Raised by PM,Raised On,Collect By,Last
Call,Discussion,Next Call,Remark,Part Payments`.

NEW APP splits this into two exports that together do not reproduce it:
- `exportPendingPaymentsCsv` hard-filters `{status: 'Pending'}` — PWA's
  report includes Received/other-status rows too.
- Missing columns vs PWA: **SO No, Status, Raised by PM / Raised On / Collect
  By (collapsed into one "Raised By" string), Part Payments (count)**.
- Column order also differs (Remark is placed before Last Call/Discussion/
  Next Call in NEW APP; PWA places Remark after Next Call).
- `exportReceiptsCsv` is a genuinely different report (per part-payment
  ledger) that PWA also has (`dlReceipts`) — that half is fine (see below).

Executed evidence (`pendingCoA` in the evidence doc) confirms these gaps are
real, not just a documentation claim: the generated CSV has 11 columns, not
16, and a payment I seeded with `status: 'Received'` (`payA2`) does not
appear in `exportPendingPaymentsCsv` output at all, whereas PWA's
`dlPayments()` would include it.

**Not fixed in this pass** — closing this gap means deciding whether to (a)
add a full "all Payments" export matching `dlPayments()` exactly and keep
`exportPendingPaymentsCsv`/`exportReceiptsCsv` as-is, or (b) extend
`exportPendingPaymentsCsv` to match `dlPayments()` column-for-column and drop
the status filter. This is a product/scope decision, not a one-line fix —
flagging as BLOCKED for this workstream pending a decision.

### FIX-6-06 (P3, Output mismatch — receipts ordering)
**Classification: D.**
PWA's `dlReceipts()` iterates `DB.payments` / `paid[]` in raw insertion order
with **no sort**. NEW APP's `exportReceiptsCsv` explicitly sorts
`receipts.sort((a,b) => a.p.date < b.p.date ? 1 : -1)` — newest-date-first.
Confirmed by reading both sources directly (index.html:3958 vs
paymentService.js exportReceiptsCsv). Columns, header text, and TOTAL row
shape are an exact match (verified — see evidence doc) so this is ordering
only, not a data-content defect. Low severity but a real, unauthorized
divergence from the "preserve PWA quirks exactly" rule.
**Not fixed in this pass** (scope/severity judgment call for the user).

### FIX-6-07 (P1, MAJOR output mismatch — Project list CSV)
**Classification: D**, already self-flagged as a reconstruction gap in
`projectService.js`'s own code comment, now confirmed severe against actual
PWA source.

PWA `dlProjects()` (index.html:3498) emits **26 columns**: `SO No,Project,
Division,Site Type,Capacity,Customer,Stage,Status,Start,Target End,
Engineers,Vendor,Checklist,Points Done,Total Points,Approved Points,
Timeline Set,Overdue Points,Max Delay (days),Last Action,Last Action
Date,Next Action,Next Action Date,Material Pending Return,Payment
Received,Payment Pending`.

NEW APP `exportProjectsCsv` emits only **13** of them: `SO No,Division,
Name,Site Type,Capacity,Customer,Stage,Status,Vendor,Engineers,Checklist,
Start,End` — and even among the 13, "Name" vs PWA's "Project", and an "End"
column PWA does not have (PWA has "Target End", not a raw project End date)
plus column ORDER differs (Division/Name swapped relative to PWA's
Project/Division).

**Missing entirely**: Target End, Points Done, Total Points, Approved
Points, Timeline Set, Overdue Points, Max Delay (days), Last Action, Last
Action Date, Next Action, Next Action Date, Material Pending Return,
Payment Received, Payment Pending — 13 of 26 PWA columns absent. The report
title also differs: PWA titles it `"<Division> Projects Report"` (division-
scoped, e.g. "HVAC Projects Report") and filenames
`projects-<div>-<date>.csv`; NEW APP always titles it "PROJECT LIST" and
filenames it statically `projects.csv`.

Confirmed via real execution (`projectsCoA` in the evidence doc): the actual
generated CSV has exactly 13 columns with no delay/checklist-progress/
payment-summary data at all.

**Not fixed in this pass** — the missing computations (delay/overdue-days
logic, checklist point-count aggregation, division-scoped report title, and
project payment-summary reconciliation) are non-trivial business logic that
would need its own implementation + dedicated tests, not a targeted patch.
Flagging **BLOCKED, P1** pending the user's decision on priority.

### Note — no role gate on Project export
`exportProjectsCsv` calls `assertCompanyContext(actorAuth)` only; there is no
`assertRole` call anywhere in `projectService.js` (confirmed by search — zero
hits for `assertRole`/`VIEW_ROLES`/`LEDGER_ROLES` in that file), even though
`projectRoutes.js`'s own header comment states "Role/tenant enforcement
happens in the service layer, matching the pattern in
salesOrderRoutes.js/paymentRoutes.js" — those two DO have `assertRole` calls
with `VIEW_ROLES`/`LEDGER_ROLES`; `projectService.js` does not honor that
stated pattern for its export. Since the PWA itself has no formal role gate
on `dlProjects()` beyond `myDiv()` division scoping, this is not necessarily
wrong, but the missing division-scoping (`myDiv()`) in the NEW APP's export —
which does not filter by the actor's own division the way listProjects'
`filters` argument would need to be supplied explicitly to replicate — is an
unresolved question flagged as **Classification C (documentation gap)**: it
is not proven whether callers are expected to always pass a division filter,
or whether cross-division project data is intentionally visible to all
company roles.

## Role / authorization audit (executed where testable)
| Export | Role gate found | PWA intent match |
|---|---|---|
| SalesOrder | `VIEW_ROLES = [sales, admin, hvac_pm, solar_pm, mep_pm, finance]` | matches PWA's SO-menu roles |
| Payment (pending+receipts) | `LEDGER_ROLES = [finance, admin]` | matches PWA's Payments-menu roles |
| Project | none (company-context only) | see note above — C, unresolved |
| Contract, ServiceCall, Inventory (x5) | already tested and confirmed in the locked 365-test baseline (FIX-3.6-01, etc.) | PASS (cited, not re-executed) |

## Tenant isolation — EXECUTED (not just inspected)
Two disposable companies (`coA`, `coB`) were seeded in-process with a
SalesOrder, Project, and two/one Payment records each, using distinctive
strings (`"Alpha Tower"` / `"Beta Plant (SHOULD NOT LEAK)"`). All 4
untested export functions were called once per company and their raw output
scanned for the other company's distinctive string:

| Check | Result |
|---|---|
| `exportSalesOrdersCsv` — coA output excludes coB SO | PASS |
| `exportSalesOrdersCsv` — coB output excludes coA SO | PASS |
| `exportProjectsCsv` — coA output excludes coB project | PASS |
| `exportProjectsCsv` — coB output excludes coA project | PASS |
| `exportPendingPaymentsCsv` — coA output excludes coB payment | PASS |
| `exportPendingPaymentsCsv` — coB output excludes coA payment | PASS |
| `exportReceiptsCsv` — coA output excludes coB receipt | PASS |
| `exportReceiptsCsv` — coB output excludes coA receipt | PASS |

**Result: no tenant leakage found in any of the 4 newly-executed exports.**
The remaining 10 families were not re-executed for tenant isolation in this
pass (cited existing coverage only — see Scope section); `Contract`,
`ServiceCall`, `Enquiry` and `Inventory` exports all call `mine()`/
`listByCompany(actorAuth.companyId)`-equivalent scoping by source inspection,
consistent with the pattern that held for the 4 that WERE executed, but this
is inspection, not fresh execution, for those 10.

## Tests
- Full regression: **365/365 PASS** (re-run this pass, `npm test`,
  ~176s wall time) — reconfirms the locked baseline; no backend code was
  modified in this pass, so no new targeted tests were required for the
  findings above (all 3 are documented-but-not-yet-fixed).
- No test file was added because no fix was applied — per the fix policy,
  targeted regression coverage is added when an actual code fix lands. Since
  FIX-6-05/06/07 are being reported as scope/priority decisions for the user
  rather than patched blind, no new test exists yet for them.

## Workstream D verdict: **BLOCKED**

Reasons:
1. FIX-6-07 (P1): Project list/dashboard CSV is missing 13 of 26 PWA
   columns — a major, confirmed, unfixed parity gap.
2. FIX-6-05 (P2): Payment report family diverges in scope (pending-only vs
   PWA's all-statuses `dlPayments()`) and is missing 5 of 16 PWA columns.
3. Full HTTP+MongoDB execution (Steps 4/5 as literally specified — real
   running server, real Mongo, real HTTP responses with headers/status
   codes) could not be performed: no MongoDB instance is reachable in this
   environment and `mongodb-memory-server`'s binary cannot be downloaded
   (outbound network policy). All execution in this pass is real
   service-layer execution against the same in-memory fake-repository
   harness the 365-test locked baseline already relies on — the closest
   available approximation, but not the literal running-server standard the
   task specifies. This is an **F (environment limitation)**, stated
   honestly per the engagement's ground rules, not a fabricated PASS.
4. 10 of 14 export families were not independently re-executed with fresh
   disposable multi-tenant data in this pass; their PASS status rests on
   already-existing (locked, passing) unit tests, cited but not reproduced
   here.

## Exact remaining blockers
- Decide scope/fix for FIX-6-05 (Payment report split vs PWA's single
  `dlPayments()`) and FIX-6-07 (Project CSV missing columns) — both need
  product-level scope decisions before a safe fix can be written.
- Decide whether FIX-6-06 (receipts ordering) is worth fixing given its low
  severity.
- Resolve the Project-export division-scoping/role-gate question (documented
  above) as its own decision item.
- If genuine HTTP+Mongo execution is required to close Steps 4/5 to the
  letter, that needs an environment with a reachable MongoDB (or unblocked
  `mongodb-memory-server` downloads) and a device network policy that allows
  it — neither was available here.
- Re-execute the 10 not-yet-independently-re-verified families with fresh
  disposable multi-tenant data if the user wants Workstream D's tenant-
  isolation claim to rest on fresh execution across ALL 14 families rather
  than 4 fresh + 10 cited.
