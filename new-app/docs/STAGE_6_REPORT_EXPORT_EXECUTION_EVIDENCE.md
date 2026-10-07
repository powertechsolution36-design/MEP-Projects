# STAGE 6 — Report/Export Execution Evidence (Workstream D)

Execution method: direct `require()` of the real, unmodified
`src/services/*.js` service functions, invoked with the real function
signature the production HTTP routes call
(`src/routes/salesOrderRoutes.js`, `paymentRoutes.js`, `projectRoutes.js`),
against `tests/enquiryFakes.js`'s `createEnquiryFakeStore` — the same
in-memory repository fake the entire 365-test locked regression suite uses.
No real MongoDB or HTTP server was reachable in this environment (see
Environment limitation note in the inventory doc); this is real business
logic execution, not a mock of the assertion under test, but it is not a
literal HTTP round trip. Reproduction: the seed data and calls below are
inlined verbatim; re-running them requires only Node and the repo checkout
(no external services).

Two disposable companies were used throughout: `coA` and `coB`, actor
`{ userId: 'uA', role: 'admin', name: 'Test Admin' }` (companyId swapped per
call). Distinctive marker strings: `"Alpha Tower"` (coA), `"Beta Plant
(SHOULD NOT LEAK)"` (coB).

---

## 1. SalesOrder CSV export
- **Export/report**: Sales Order Report
- **Endpoint/function**: `GET /api/sales-orders/export.csv` → `salesOrderService.exportSalesOrdersCsv`
- **PWA source**: `dlSOs()`, index.html:3484
- **NEW APP source**: `src/services/salesOrderService.js` (exportSalesOrdersCsv)
- **Test company / seed**: coA (SO `soA1`, orderNumber 101, HVAC), coB (SO `soB1`, orderNumber 201, Solar)
- **Role used**: admin
- **HTTP status**: not executed (no live server) — route returns 200 + `text/csv` per source read
- **Content type**: `text/csv` (per route source)
- **Filename**: `sales-orders.csv` (per route source; PWA uses `sales-orders-<date>.csv`)
- **Columns produced**: `SO No,Division,Project,Site Address,Start,End,Sales Team,Project Team,Contact 1,Phone 1,Contact 2,Phone 2,Total Cost,High Side Selling,High Side Purchase,Low Side Cost,Low Side Target Exp,Low Side Actual Exp,Total Margin,Received,Pending,Terms` — **exact match** to PWA's 22-column header.
- **Row count**: 1 data row + TOTAL, per company
- **Filters**: none applied (default)
- **Formatting**: dates ISO `YYYY-MM-DD`; margin computed on the fly `(hsSell-hsPur)+(lsCost-lsActual||lsTarget)` — matches PWA formula exactly
- **Result**: **PASS (Classification A)** — column set, header text, TOTAL-row shape (values, not trailing comma count — see note) and margin formula all match PWA exactly.
- **Evidence** (actual generated output, coA):
```
SALES ORDER REPORT
Generated 2026-09-27 by Test Admin (admin)

SO No,Division,Project,Site Address,Start,End,Sales Team,Project Team,Contact 1,Phone 1,Contact 2,Phone 2,Total Cost,High Side Selling,High Side Purchase,Low Side Cost,Low Side Target Exp,Low Side Actual Exp,Total Margin,Received,Pending,Terms
101,HVAC,Alpha Tower,Pune,2026-01-01,2026-06-01,S1,P1,C1,111,,,100000,60000,40000,40000,30000,28000,32000,50000,50000,T&C-A
TOTAL,,,,,,,,,,,,100000,,,,,,,50000,50000,
```
- coB output (isolation check): contained only `Beta Plant`/order 201 data; `Alpha Tower` absent. coA output contained no `Beta Plant`. **Tenant isolation: PASS.**
- Minor note: PWA's TOTAL row omits trailing empty cells (21 fields vs the 22-column header); NEW APP pads to 22. Cosmetically different CSV field count in that one row, but every populated value lands in the correct column either way — not treated as a functional mismatch.

## 2. Payment — Pending Payments CSV
- **Endpoint/function**: `GET /api/payments/export/pending.csv` → `paymentService.exportPendingPaymentsCsv`
- **PWA source**: `dlPayments()`, index.html:3552 (PWA has no separate "pending-only" report — this is NEW APP's split of that single report)
- **NEW APP source**: `src/services/paymentService.js`
- **Test company / seed**: coA — `payA1` (Pending, amount 50000, one part-payment 20000), `payA2` (Received, amount 50000); coB — `payB1` (Pending, amount 90000)
- **Role used**: admin (LEDGER_ROLES = finance, admin)
- **HTTP status / content type / filename**: 200 (by source) / `text/csv` / `pending-payments.csv`
- **Columns produced**: `Project,Person,Phone,Amount,Received,Balance,Raised By,Remark,Last Call,Discussion,Next Call` (11 cols) vs PWA's 16: missing **SO No, Status, Part Payments**, and PWA's 3 separate `Raised by PM/Raised On/Collect By` are collapsed into 1 `Raised By` string.
- **Row count**: 1 (coA) / 1 (coB) — `payA2` (status Received) correctly excluded by the Pending filter, but that also means it would never appear in ANY new-app export, whereas PWA's `dlPayments()` would show it.
- **Filters**: hard-coded `{status: 'Pending'}` — PWA's `dlPayments()` has no status filter at all.
- **Result**: **FAIL / Classification D (FIX-6-05, P2)** — confirmed real, see audit doc.
- **Evidence** (actual generated output, coA):
```
PENDING PAYMENTS

Project,Person,Phone,Amount,Received,Balance,Raised By,Remark,Last Call,Discussion,Next Call
Alpha Tower,C1,111,50000,20000,30000,,Follow up,2026-03-01,Discussed,2026-03-15
TOTAL,,,50000,20000,30000,,,,,
```
- coB output contained only `Beta Plant` data, no `Alpha Tower`. **Tenant isolation: PASS.**

## 3. Payment Receipts Ledger CSV
- **Endpoint/function**: `GET /api/payments/export/receipts.csv` → `paymentService.exportReceiptsCsv`
- **PWA source**: `dlReceipts()`, index.html:3958
- **NEW APP source**: `src/services/paymentService.js`
- **Test company / seed**: coA — 2 part-payments across `payA1`/`payA2` (20000 on 2026-03-10, 50000 on 2026-01-20); coB — none
- **Role used**: admin
- **Columns produced**: `Date,Project,SO No,Person,Phone,Amount Received,Mode,Reference,Invoice Issued,Milestone Amount,Milestone Balance,Status,Entered By,Remark` — **exact match** to PWA's 14-column header; TOTAL row shape `['','','','','TOTAL',total]` also **exact match**.
- **Row count**: 2 (coA), 0 (coB, correctly empty with a TOTAL-only row)
- **Ordering**: NEW APP sorts newest-date-first (`sort((a,b)=>a.p.date<b.p.date?1:-1)`); PWA has **no sort** (raw insertion order). Confirmed by reading both sources. **Classification D (FIX-6-06, P3)** — columns/values are correct, only ordering diverges from PWA.
- **Result**: **PASS on structure/values (A)**, **minor FAIL on ordering (D, low severity)**.
- **Evidence** (actual generated output, coA):
```
PAYMENT RECEIPTS LEDGER

Date,Project,SO No,Person,Phone,Amount Received,Mode,Reference,Invoice Issued,Milestone Amount,Milestone Balance,Status,Entered By,Remark
2026-03-10,Alpha Tower,soA1,C1,111,20000,NEFT,REF1,Yes,50000,30000,Pending,uA,part1
2026-01-20,Alpha Tower,soA1,C1,111,50000,Cheque,REF0,No,50000,0,Received,uA,first
,,,,TOTAL,70000
```
- Zero-result case (coB, no payments): `,,,,TOTAL,0` only — correct empty behavior.
- Tenant isolation: coA output contains no `Beta Plant`; coB output (empty) trivially contains no `Alpha Tower`. **PASS.**

## 4. Project List/Dashboard CSV
- **Endpoint/function**: `GET /api/projects/export.csv` → `projectService.exportProjectsCsv`
- **PWA source**: `dlProjects()`, index.html:3498
- **NEW APP source**: `src/services/projectService.js`
- **Test company / seed**: coA — `projA1` (HVAC, Alpha Tower, one assigned engineer); coB — `projB1` (Solar, Beta Plant)
- **Role used**: admin (no role gate exists on this export — see audit doc note)
- **Columns produced**: `SO No,Division,Name,Site Type,Capacity,Customer,Stage,Status,Vendor,Engineers,Checklist,Start,End` — **13 of PWA's 26 columns**; missing Target End, Points Done, Total Points, Approved Points, Timeline Set, Overdue Points, Max Delay (days), Last Action, Last Action Date, Next Action, Next Action Date, Material Pending Return, Payment Received, Payment Pending.
- **Row count**: 1 per company
- **Result**: **FAIL / Classification D (FIX-6-07, P1 — MAJOR)**.
- **Evidence** (actual generated output, coA):
```
PROJECT LIST

SO No,Division,Name,Site Type,Capacity,Customer,Stage,Status,Vendor,Engineers,Checklist,Start,End
101,HVAC,Alpha Tower,Commercial,10TR,C1,Execution,Active,VendorX,Engineer Alpha,Std HVAC,2026-01-05,2026-05-30
```
- coB output: `201,Solar,Beta Plant (SHOULD NOT LEAK),Industrial,50KW,C2,Planning,Active,VendorY,,,2026-02-05,2026-06-30` — no `Alpha Tower`; coA output has no `Beta Plant`. **Tenant isolation: PASS.**

---

## 5–14. Remaining 10 families — CITED, not re-executed this pass
Delivery Challan CSV, Project detail report CSV, Contract/AMC-PM CSV,
ServiceCall register CSV, and the 5 Inventory reports (Stock, Issued,
Transactions, My Material, Returns) already have real service-level
execution evidence inside the locked, passing 365-test suite (e.g.
`tests/projectService.test.js:427` for the DC/report pair, and
`tests/inventoryService.test.js:533-600` for role-gated inventory report
execution with a genuine second company `co2`). Re-running `npm test` this
pass reconfirmed all 365 of those tests still pass — see below — but no NEW
disposable-company execution was performed by me for these 10 in this pass;
that is an explicit, stated gap, not a claimed PASS.

## Regression run (this pass, no code changed)
```
$ npm test
...
# tests 365
# suites 0
# pass 365
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 175762.2468
```
Matches the locked baseline exactly (365/365).
