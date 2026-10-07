# STAGE 6 — Report/Export Inventory (Workstream D, Step 1)

Built by tracing PWA source (`MEP_PROJECTS_PWA/index.html`) function-by-function
for every `dl*()` report/export function, plus the NEW APP `src/routes/*.js` /
`src/services/*.js` CSV-producing endpoints (`grep -rn "csv" src`). 14 materially
distinct CSV export families were found; there is no non-CSV (e.g. PDF/XLSX)
export in either system.

| # | Module | PWA Function | PWA Source | Output Type | Filters | Columns (PWA) | Ordering | Formatting | Role Gate (PWA intent) | Tenant Scope | NEW APP Equivalent |
|---|--------|-------------|------------|--------------|---------|----------------|----------|------------|------------------------|--------------|---------------------|
| 1 | Enquiry | `dlEnq()` / `dlEnqReport()` | index.html (Enquiry section) | CSV | search/`hit()`, `?lost=true` scope | Enquiry list + lost/reopen fields (see PWA_COVERAGE_AUDIT_ENQUIRY.md — already Workstream C audited) | insertion order | date ISO | any Enquiry-menu role | `mine()` = companyId | `GET /api/enquiries/export.csv` → `exportEnquiriesCsv` |
| 2 | SalesOrder | `dlSOs()` | index.html:3484 | CSV | `hasDiv`+`hit()` on no/project/div/addr/salesTeam/projTeam/start/total | SO No,Division,Project,Site Address,Start,End,Sales Team,Project Team,Contact 1,Phone 1,Contact 2,Phone 2,Total Cost,High Side Selling,High Side Purchase,Low Side Cost,Low Side Target Exp,Low Side Actual Exp,Total Margin,Received,Pending,Terms (22 cols) + TOTAL row | insertion order | ISO dates, raw numbers | sales/admin/pm/finance (division-filtered) | `mine()` = companyId | `GET /api/sales-orders/export.csv` → `exportSalesOrdersCsv` |
| 3 | Payment (pending/full ledger) | `dlPayments()` | index.html:3552 | CSV | `hit()` on project/person/phone/remark/disc/soNo/amount/status — **ALL statuses**, not pending-only | Project,SO No,Person,Phone,Milestone Amount,Received,Balance,Status,Raised by PM,Raised On,Collect By,Last Call,Discussion,Next Call,Remark,Part Payments (16 cols) + TOTAL | insertion order | raw | finance/admin (payments menu) | `mine()` | `GET /api/payments/export/pending.csv` → `exportPendingPaymentsCsv` (see Finding FIX-6-05) |
| 4 | Payment receipts ledger | `dlReceipts()` | index.html:3958 | CSV | none (all payments, flattened per part-payment) | Date,Project,SO No,Person,Phone,Amount Received,Mode,Reference,Invoice Issued,Milestone Amount,Milestone Balance,Status,Entered By,Remark (14 cols) + TOTAL | **insertion order, no sort** | ISO date | finance/admin | `mine()` | `GET /api/payments/export/receipts.csv` → `exportReceiptsCsv` (see Finding FIX-6-06, ordering) |
| 5 | Project list/dashboard | `dlProjects()` | index.html:3498 | CSV | `myDiv()` (user's own division) + `hit()`/engineer name search | SO No,Project,Division,Site Type,Capacity,Customer,Stage,Status,Start,Target End,Engineers,Vendor,Checklist,Points Done,Total Points,Approved Points,Timeline Set,Overdue Points,Max Delay (days),Last Action,Last Action Date,Next Action,Next Action Date,Material Pending Return,Payment Received,Payment Pending (26 cols) | insertion order | ISO dates, Yes/No, counts | any Project-menu role, division-scoped | `mine()` + own division | `GET /api/projects/export.csv` → `exportProjectsCsv` (see Finding FIX-6-07 — MAJOR gap) |
| 6 | Delivery Challan | `dlChallan(pid)` | index.html:2530 | CSV | one project | DC No,Date,Material,Qty,Unit,Type,Returned Qty,Balance on Site,Received By,Remark | insertion order | raw | project-menu roles | project's companyId | `GET /api/projects/:id/delivery-challans/export.csv` → `exportDeliveryChallanCsv` — **already tested, exact match confirmed** (tests/projectService.test.js:427) |
| 7 | Project detail report | (print/report view feeding the same data as `getProjectReport`) | projectService.js comment references it | CSV | one project | PROJECT REPORT header, MATERIAL TALLY, PAYMENT MILESTONES sections | n/a | raw | project-menu roles | project's companyId | `GET /api/projects/:id/report/export.csv` → `exportProjectReportCsv` — **already tested** (tests/projectService.test.js:427) |
| 8 | Contract / AMC-PM | `dlContracts()` | index.html (AMC section) | CSV | `hit()` on customer/phone/email/site/cap/amcType/cat/start/end/amount | Customer,Phone,Email,Site,Capacity,Category,AMC Type,Amount,Start,End,Status,PM Due Now,1st..4th Due/Done (20 cols) + TOTAL | insertion order | raw | admin/service_mgr | `mine()` | `GET /api/contracts/export.csv` → `exportContractsCsv` — **already tested/RESOLVED (FIX-6-04)** |
| 9 | ServiceCall register | `dlService()` | index.html:3510 area | CSV | `hit()` on psc/type/customer/phone/site/status/eng/regDate/date/complaint | PSC No,Type,Registered On,Customer,Phone,Site,Appt Date,Appt Time,Engineer,Status,Complaint,Make,Model,Capacity,Unit Type,Material Used,Service Done,Service Type,Amount,Engineer Remark,Customer Remark,Client Signed (22 cols) + TOTAL | insertion order | raw | admin/service_mgr | `mine()` | `GET /api/service-calls/export.csv` → `exportServiceCallsCsv` — **already tested** |
| 10 | Inventory Stock Report | `dlStock()` (PWA inventory module) | index.html (Inventory section) | CSV | none | Code,Name,Category,Unit,... stock-by-location | insertion order | raw | Decision 35 broadened role set (hvac_pm/solar_pm/service_mgr/admin/inventory, NOT mep_pm) | `mine()` | `GET /api/inventory/reports/stock.csv` → `exportStockCsv` — **already tested (FIX-3.6-01 RESOLVED)** |
| 11 | Inventory Issued Material Report | `dlIssued()` | index.html | CSV | none | Date,Item Code,Item,Type,Qty,... | insertion order | raw | admin/inventory only | `mine()` | `GET /api/inventory/reports/issued.csv` → `exportIssuedCsv` — **already tested (FIX-3.6-01 RESOLVED)** |
| 12 | Inventory Transaction Report | `dlTxns()` | index.html | CSV | none | transaction-type ledger (Opening Stock, Purchase In, Damage/Write-off, Adjustment, Issue, Return, Transfer, Consumed) | insertion order | raw | admin/inventory only | `mine()` | `GET /api/inventory/reports/transactions.csv` → `exportTransactionsCsv` — **already tested** |
| 13 | Inventory My Material Report | `dlMyMaterial()` | index.html | CSV | current user only | issued-to-me rows | insertion order | raw | any inventory-menu role (self-scoped) | `mine()` + own userId | `GET /api/inventory/reports/my-material.csv` → `exportMyMaterialCsv` — **already tested** |
| 14 | Inventory Material Return Report | `dlReturns()` | index.html | CSV | none | Returned/Returned-Used/Partially Returned/Return Requested rows | insertion order | raw | admin/inventory only | `mine()` | `GET /api/inventory/reports/returns.csv` → `exportReturnsCsv` — **already tested** |

## Environment limitation (F)
No real MongoDB instance or running HTTP server is reachable in this
environment (no `mongod`/`mongosh` on the device; `mongodb-memory-server`'s
binary download is blocked by the outbound network policy — see
`tests/concurrencyHarness.js` comment). All "actual execution" in this
workstream therefore runs the exported service functions directly (Node
`require`, not HTTP) against the SAME in-memory fake repository harness
(`tests/enquiryFakes.js`, `createEnquiryFakeStore`) already used by all 365
locked regression tests — this is full production business-logic execution
(the real `src/services/*.js` code, unmodified), just without a live TCP/HTTP
hop or a real Mongo wire-protocol round trip. This is stated per the ground
rules' required honesty about the missing replica set. HTTP status
codes/headers (`Content-Type: text/csv`, `Content-Disposition`) were verified
by reading the route handlers (`src/routes/*.js`), not by an actual HTTP
request/response cycle.
