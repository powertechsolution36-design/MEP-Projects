> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.
>
> **📝 rev 9 addition — 2026-09-10.** Additive only, does not reopen the freeze. Added steps 35a/35b (Raise to Finance) and the PWA-Proven Workflow Compatibility addendum. See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Rewrote step 24 CHECKLIST and added the "Checklist as a Common Operational Execution Engine" addendum — Checklist is not a Finance feature; Finance (rev 9) is one optional downstream consequence. See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Extended step 20 STOCK and step 21 PROJECT ISSUE; added steps 21a (TOOL CUSTODY), 21b (MATERIAL EXCESS / RETURN), 21c (STOCK TRANSFER); added the "Inventory: Reusable Tool Custody vs. Project Material Lifecycle" addendum. PM reports/requests only; Inventory Manager alone performs the physical stock transaction. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added the "Global Record Ownership, Edit & Delete Control" addendum — a platform-wide rule applying to every module's Edit/Delete workflow (not a new numbered step; it constrains how every existing step's edit/delete/correction actions are authorized). See `CHANGELOG.md` rev 12.

---

# MEP PROJECTS — End-to-End Business Workflow Map

**Generated:** 2026-08-28
**Purpose:** Map each step of target business flow against actual v2 implementation
**⚠️ Planning only — Zero code changes.**

---

## Priority Legend

- **P0** live-system safety
- **P1** users/roles/permissions
- **P2** connect existing modules
- **P3** project core
- **P4** Solar/MEP/HVAC specialization
- **P5** inventory/procurement
- **P6** finance/commercial
- **P7** documents/drawings/RFI/submittals
- **P8** QA/QC/safety
- **P9** service/AMC
- **P10** asset
- **P11** workforce
- **P12** reports/BI
- **P13** automation
- **P14** client portal
- **P15** vendor portal
- **P16** AI

---

## Workflow Step Map

### 1. CUSTOMER
| Field | Value |
|-------|-------|
| Existing | ❌ No dedicated Customer model. `Enquiry.client` is a plain string. |
| Missing | Customer master, contact directory, sites list, history |
| Existing model | none |
| Required new model | **Customer** {co, name, code, gstin, pan, contacts[], sites[], type, status, industry, owner, notes} |
| Existing API | none |
| Required new API | `GET/POST/PUT/DELETE /api/v3/customers`, `POST /api/v3/customers/:id/contacts`, `POST /api/v3/customers/:id/sites` |
| Existing frontend | Sidebar entry for hvac_dm/solar_dm/mep_dm points to `/customers` (404 currently) |
| Required new frontend | `Customers.jsx` list + detail + form; `<CustomerPicker>` component |
| Role responsible | Sales Manager, Sales Executive |
| Role approving | Company Admin (for large accounts) |
| Notification | On create → Sales team lead |
| Audit | Create/Edit/Delete |
| Dependency | none |
| Priority | **P2** |

### 2. ENQUIRY
| Field | Value |
|-------|-------|
| Existing | ✅ `Enquiry` model, `Enquiries.jsx`, full CRUD + `/log`, `/lost`, `/reopen`, `/convert` |
| Missing | Link to Customer (currently stores client as string), division field, trade field, qualification stage |
| Existing model | Enquiry {co, client, contact, phone, email, source, subject, desc, status, value, owner, log[]} |
| Required new model | Extend: `customerId` ref, `division`, `trade`, `stage` (new enum: new/qualifying/site-visit/quoted/negotiation/won/lost), `nextAction {at, by, note}` |
| Existing API | `/api/enquiries` full CRUD |
| Required new API | `POST /api/v3/enquiries/:id/qualify`, `POST /api/v3/enquiries/:id/schedule-site-visit`, filter by customerId/division/trade |
| Existing frontend | `Enquiries.jsx` |
| Required new frontend | Extend form with Customer picker + Division + Trade + Stage/nextAction |
| Role responsible | Sales Executive |
| Role approving | Sales Manager (for value > threshold) |
| Notification | New enquiry → Sales lead; overdue nextAction → owner |
| Audit | ✅ log[] already captures actions |
| Dependency | Customer (P2) |
| Priority | **P2** |

### 3. QUALIFICATION
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled — implicit in Enquiry.status='contacted' |
| Missing | Qualification framework (budget, timeline, decision-maker, needs), scoring |
| Existing model | none |
| Required new model | Add `Enquiry.qualification` sub-doc: {budget, timeline, decisionMaker, needs, score, qualifiedAt, qualifiedBy} |
| Existing API | none |
| Required new API | `POST /api/v3/enquiries/:id/qualify` (validates fields, sets stage='qualifying'→'quoted') |
| Existing frontend | none |
| Required new frontend | Qualification modal within Enquiry detail |
| Role responsible | Sales Executive |
| Role approving | Sales Manager if score ≥ threshold |
| Notification | Sales manager on qualified lead |
| Audit | Yes |
| Dependency | Enquiry (P2) |
| Priority | **P2** |

### 4. SITE VISIT
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled |
| Missing | Visit scheduling, visit report, photos, next steps |
| Existing model | none |
| Required new model | **SiteVisit** {co, enquiry/customer/project, scheduledFor, scheduledBy, visitedBy, report, photos[], nextSteps, status} |
| Existing API | none |
| Required new API | `POST /api/v3/site-visits`, `PUT /:id`, `GET ?enquiry=` |
| Existing frontend | none |
| Required new frontend | Site Visit modal/page |
| Role responsible | Sales Executive / Engineer |
| Role approving | Sales Manager |
| Notification | Visit scheduled → assigned engineer; report submitted → Sales Manager |
| Audit | Yes |
| Dependency | Enquiry (P2), Customer (P2) |
| Priority | **P3** |

### 5. ESTIMATE / BOQ
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled (SO has items but no BOQ concept) |
| Missing | Structured BOQ with line items, quantities, rates, sub-heads |
| Existing model | none |
| Required new model | **BOQ** {co, enquiry, customer, division, trade, sections[{name, items[{sn, desc, hsn, qty, unit, rate, amount}]}], subtotal, tax, total, status, revisions[]} |
| Existing API | none |
| Required new API | `GET/POST/PUT /api/v3/boqs`, `POST /:id/copy` |
| Existing frontend | none |
| Required new frontend | `BoqEditor.jsx` — spreadsheet-like UI |
| Role responsible | Estimator / Sales Executive |
| Role approving | Sales Manager |
| Notification | BOQ created → Sales Manager |
| Audit | Yes (versioning via revisions[]) |
| Dependency | Enquiry (P2) |
| Priority | **P2** |

### 6. QUOTATION
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled (sidebar has entry but no page/route/model) |
| Missing | Structured quotation with terms, validity, tax breakdown |
| Existing model | none |
| Required new model | **Quotation** {co, no, code, rev, date, validTill, enquiry, boq, customer, site, items[], terms[], subtotal, discount, tax, total, status, sent, acceptedAt, rejectedAt, salesOrder, log[]} |
| Existing API | none |
| Required new API | Full CRUD + `POST /:id/send`, `/revise`, `/accept`, `/reject` |
| Existing frontend | Sidebar link (404); no page |
| Required new frontend | `Quotations.jsx` list + form + PDF preview |
| Role responsible | Sales Executive |
| Role approving | Sales Manager (before send if >threshold) |
| Notification | Sent → Customer (email); accepted → PM |
| Audit | Yes |
| Dependency | Enquiry, BOQ, Customer (P2) |
| Priority | **P2** |

### 7. REVISION / NEGOTIATION
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled |
| Missing | Revision tracking, comparison view, negotiation log |
| Existing model | none |
| Required new model | Add `Quotation.revisions[]` sub-docs; `Quotation.negotiationLog[]` |
| Existing API | none |
| Required new API | `POST /api/v3/quotations/:id/revise` (creates new rev, copies items), `POST /:id/negotiation-note` |
| Existing frontend | none |
| Required new frontend | Revision compare view + negotiation note thread |
| Role responsible | Sales Executive |
| Role approving | Sales Manager for revision |
| Notification | New revision → Customer + Manager |
| Audit | Yes |
| Dependency | Quotation (P2) |
| Priority | **P2** |

### 8. APPROVAL (Internal)
| Field | Value |
|-------|-------|
| Existing | ❌ No workflow states beyond CRUD |
| Missing | Approval framework (multi-step, threshold-based) |
| Existing model | none |
| Required new model | **ApprovalRequest** {co, resource, resourceId, requestedBy, approver, level, status, note, at, approvedAt} |
| Existing API | none |
| Required new API | `POST /api/v3/approvals`, `POST /:id/approve`, `POST /:id/reject`, `GET /pending?forUser=` |
| Existing frontend | none |
| Required new frontend | `Approvals.jsx` inbox + inline approve buttons on resource pages |
| Role responsible | Requestor (Sales/PM) |
| Role approving | Manager / Company Admin |
| Notification | Approval needed → approver; result → requestor |
| Audit | Yes |
| Dependency | none (foundational) |
| Priority | **P1** |

### 9. CUSTOMER PO
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled |
| Missing | Customer PO document capture (their PO to us) |
| Existing model | none |
| Required new model | **CustomerPO** {co, customer, quotation, salesOrder, poNo, poDate, poValue, poFileUrl, receivedBy, terms, log[]} |
| Existing API | none |
| Required new API | `POST /api/v3/customer-pos`, `GET/PUT` |
| Existing frontend | none |
| Required new frontend | Small form + upload |
| Role responsible | Sales Executive |
| Role approving | Sales Manager |
| Notification | PO received → PM + Accounts |
| Audit | Yes |
| Dependency | Quotation (P2) |
| Priority | **P2** |

### 10. SALES ORDER
| Field | Value |
|-------|-------|
| Existing | ✅ SalesOrder model + full CRUD + `SalesOrders.jsx` |
| Missing | Link to Customer, Quotation, CustomerPO; division/trade; workflow states |
| Existing model | SalesOrder {co, no, date, client, contact, items[], subtotal, tax, total, status, notes} |
| Required new model | Extend: `customerId`, `enquiryId`, `quotationId`, `customerPOId`, `division`, `trade` |
| Existing API | `/api/sales-orders` CRUD |
| Required new API | `POST /:id/confirm`, `/close`, filter by customer/quotation/division |
| Existing frontend | `SalesOrders.jsx` |
| Required new frontend | Extend form with pickers + workflow buttons |
| Role responsible | Sales Manager |
| Role approving | Company Admin (for large SOs) |
| Notification | SO confirmed → PM + Accounts + Inventory Mgr |
| Audit | Yes |
| Dependency | Quotation, CustomerPO (P2) |
| Priority | **P2** |

### 11. PROJECT CREATION
| Field | Value |
|-------|-------|
| Existing | ✅ Project model + `Projects.jsx` + CRUD |
| Missing | Auto-create from SO; link back to SO; trade field; project template |
| Existing model | Project {co, code, name, client, site, div, status, start, target, value, pm, engs[], chk[], updates[], dc[], notes, meta} |
| Required new model | Add `salesOrderId`, `enquiryId`, `customerId`, `trade`, `projectMgrId` (ObjectId ref), `accessList[]`, `budget`, `template` |
| Existing API | `/api/projects` CRUD |
| Required new API | `POST /api/v3/projects/from-sales-order/:soId`, `POST /:id/assign-manager`, `POST /:id/from-template/:templateId` |
| Existing frontend | `Projects.jsx` |
| Required new frontend | "Create from SO" button on SO page; project template list |
| Role responsible | Sales Manager / Project Manager |
| Role approving | Company Admin |
| Notification | Project created → assigned PM; template used → template owner |
| Audit | Yes |
| Dependency | SO (P2) |
| Priority | **P3** |

### 12. PROJECT MANAGER (Assignment)
| Field | Value |
|-------|-------|
| Existing | Project.pm is a String (name), not FK |
| Missing | Proper user FK, workload view, reassignment |
| Existing model | Project.pm: String |
| Required new model | Add `Project.projectMgrId: ObjectId → User` (keep pm string for legacy display) |
| Existing API | none for assignment specifically |
| Required new API | `POST /api/v3/projects/:id/assign-manager {userId}` |
| Existing frontend | Project edit form has pm text input |
| Required new frontend | User picker (filtered to designation='project_manager' or 'manager') |
| Role responsible | Company Admin / Division Manager |
| Role approving | Company Admin |
| Notification | Assigned PM |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P3** |

### 13. DEPARTMENT ASSIGNMENT (Solar / MEP / HVAC)
| Field | Value |
|-------|-------|
| Existing | Project.div enum ['MEP','HVAC','Solar','Other'] |
| Missing | Sub-trade routing, multi-division projects, division manager routing |
| Existing model | Project.div |
| Required new model | Add `Project.divisions[]` (support multi), `Project.trade`, `Project.subTrades[]` |
| Existing API | Handled via PUT /projects/:id |
| Required new API | none new |
| Existing frontend | Division dropdown in form |
| Required new frontend | Multi-division selector + sub-trade chips |
| Role responsible | Project Manager |
| Role approving | Division Manager |
| Notification | Division Manager on assignment |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P4** |

### 14. BOQ (Project BOQ — post-award)
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Project-specific BOQ (derived from quotation BOQ + additions) |
| Required new model | **ProjectBOQ** {co, project, sourceBoq, items[], approvedBy, approvedAt, budget} |
| Required new API | `POST /api/v3/projects/:id/boq`, `POST /:id/boq/:bId/approve` |
| Required new frontend | BOQ editor within Project page |
| Role responsible | Project Manager |
| Role approving | Company Admin / Division Manager |
| Notification | BOQ approved → Inventory Mgr, Procurement |
| Audit | Yes (revisions) |
| Dependency | Project (P3), BOQ (P2) |
| Priority | **P5** |

### 15. BUDGET
| Field | Value |
|-------|-------|
| Existing | Project.value = revenue only; no cost budget |
| Missing | Cost budget (labor, material, overhead), variance tracking |
| Required new model | **Budget** {co, project, category, planned, actual, forecast, variance, revisions[]} |
| Required new API | Full CRUD |
| Required new frontend | Budget view + variance chart within Project |
| Role responsible | Project Manager |
| Role approving | Company Admin / Finance |
| Notification | Variance > 10% → alert PM |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P6** |

### 16. MATERIAL REQUEST
| Field | Value |
|-------|-------|
| Existing | ❌ (InvIssue is the direct issue, no request phase) |
| Missing | Request → Approve → Issue workflow |
| Required new model | **MaterialRequest** {co, project, requestedBy, items[{item, qty, unit, urgency}], status, approvedBy, approvedAt, issuedIssueId} |
| Required new API | Full CRUD + `/approve`, `/reject`, `/link-issue` |
| Required new frontend | `MaterialRequest.jsx` + inline in Project page |
| Role responsible | Engineer / PM |
| Role approving | Inventory Manager / Division Manager |
| Notification | Request → Inv Mgr; approved → requestor + PM |
| Audit | Yes |
| Dependency | Project (P3), InvItem |
| Priority | **P5** |

### 17. PROCUREMENT
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | RFQ, vendor selection, comparison |
| Required new model | **RFQ** {co, items[], vendors[], responses[{vendor, quote, at}], selectedVendor, status} |
| Required new API | Full CRUD + `/send-to-vendors`, `/record-response`, `/award` |
| Required new frontend | `Rfqs.jsx` |
| Role responsible | Inventory Manager / Procurement Exec |
| Role approving | Company Admin (for high value) |
| Notification | Vendor invited; response received |
| Audit | Yes |
| Dependency | Vendor, MaterialRequest (P5) |
| Priority | **P5** |

### 18. PURCHASE ORDER
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | PO to vendor, tracking, delivery schedule |
| Required new model | **PurchaseOrder** {co, no, vendor, rfq, items[], total, tax, deliveryTerms, poDate, expectedDate, status, grn} |
| Required new API | Full CRUD + `/send`, `/close` |
| Required new frontend | `PurchaseOrders.jsx` |
| Role responsible | Inventory Manager |
| Role approving | Company Admin / Finance (per limit) |
| Notification | Vendor sent; overdue delivery |
| Audit | Yes |
| Dependency | Vendor, RFQ (P5) |
| Priority | **P5** |

### 19. GRN (Goods Received Note)
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Goods receipt against PO with qty/quality check |
| Required new model | **GRN** {co, no, po, receivedBy, receivedAt, items[{item, qtyReceived, qtyRejected, condition}], notes, invItemUpdated} |
| Required new API | Full CRUD + `/post-to-inventory` (updates InvItem.qty) |
| Required new frontend | GRN form + inline PO close |
| Role responsible | Store keeper / Inventory Manager |
| Role approving | Inventory Manager |
| Notification | GRN posted → PM (material available) |
| Audit | Yes |
| Dependency | PO (P5), InvItem |
| Priority | **P5** |

### 20. STOCK (rev 11 — itemType-aware)
| Field | Value |
|-------|-------|
| Existing | ✅ InvItem + Inventory.jsx |
| Missing | Multi-location stock ledger, batch/serial tracking; itemType distinction (rev 11) |
| Existing model | InvItem (qty is single number, no ledger) |
| Required new model | **StockLedger** {co, item, location, qty, txn (in/out/adjust), ref, at} (add derived by-location view); `InvItem.itemType: REUSABLE_TOOL_ASSET \| PROJECT_MATERIAL` (rev 11 — see `DATABASE_ARCHITECTURE.md` rev 11 addendum) |
| Required new API | `GET /api/v3/stock/by-location`, `GET /:itemId/ledger` |
| Required new frontend | Location-wise stock view + ledger drill-down; itemType filter |
| Role responsible | Store / Inventory Manager |
| Role approving | Inventory Manager for adjustments |
| Notification | Stock hits critical → Inv Mgr, PM |
| Audit | ✅ InvTransaction exists |
| Dependency | GRN, InvItem |
| Priority | **P5** |

### 21. PROJECT ISSUE (Material Issue to project)
| Field | Value |
|-------|-------|
| Existing | ✅ InvIssue + workflow (open/partial/closed) + return requests |
| Missing | Link to MaterialRequest, project-level rollup |
| Existing model | InvIssue |
| Required new model | Add `InvIssue.materialRequestId` optional FK |
| Existing API | `/api/inventory/issues/*` |
| Required new API | none new |
| Existing frontend | Inventory.jsx has issues tab |
| Required new frontend | Add MaterialRequest link |
| Role responsible | Store keeper |
| Role approving | Inventory Manager |
| Notification | Issued → PM + engineer |
| Audit | ✅ log via InvTransaction |
| Dependency | MaterialRequest (P5) |
| Priority | **P5** |

### 21a. TOOL CUSTODY — rev 11 addition
| Field | Value |
|-------|-------|
| Existing | ❌ (legacy `ret` boolean has no custody concept) |
| Missing | Issue/return tracking for company-owned tools and equipment, independent of project material consumption |
| Required new model | **ToolCustody** {co, division, inventoryItemId, assetTag, serialNumber, currentLocation, custodianUserId, projectId, projectPackageId, issuedAt, issuedBy, expectedReturnDate, actualReturnDate, conditionAtIssue, conditionAtReturn, status} — see `DATABASE_ARCHITECTURE.md` rev 11 addendum |
| Required new API | `/api/v3/tools/:toolId/custody` CRUD + `/issue`, `/return`, `/report-condition` |
| Required new frontend | Tool Custody register (Inventory Manager) + "My Tools" view (Engineer/Technician) |
| Role responsible | Engineer/Technician reports condition/location; Inventory Manager issues/returns |
| Role approving | Inventory Manager |
| Notification | Overdue return → Inv Mgr + custodian; damage/loss reported → Inv Mgr |
| Audit | Yes — every custody change writes AuditLog |
| Dependency | InvItem.itemType=REUSABLE_TOOL_ASSET (rev 11) |
| Priority | **P6** |

### 21b. MATERIAL EXCESS / RETURN — rev 11 addition
| Field | Value |
|-------|-------|
| Existing | ⚠️ Partial — legacy `ret` boolean on InvIssue, no verification split |
| Missing | Dedicated Excess/Return Form distinguishing PM's declared quantities from Inventory Manager's physically verified quantities; scrap handling |
| Required new model | **MaterialReturnRequest** {co, division, projectId, projectPackageId, materialRequestId, inventoryItemId, declaredRemainingQty, declaredReturnQty, declaredScrapQty, reason, requestedBy, requestedAt, verifiedBy, verifiedAt, verifiedReturnQty, verifiedScrapQty, acceptedQty, acceptedScrapQty, rejectedQty, returnLocation, verificationRemark, status} — see `DATABASE_ARCHITECTURE.md` rev 11 addendum |
| Required new API | Full CRUD + `/submit`, `/verify` (Inventory Manager only — posts InvTransaction), `/reject` |
| Required new frontend | PM "Declare Excess / Return" form; Inventory Manager verification queue |
| Role responsible | PM declares; Inventory Manager verifies and physically actions |
| Role approving | Inventory Manager (verification IS the approval); escalates via existing ApprovalRule for high-value per `ACCESS_MATRIX.md` §13.3 |
| Notification | Submitted → Inv Mgr; verified/accepted or rejected → PM |
| Audit | Yes |
| Dependency | MaterialRequest (P5), InvItem.itemType=PROJECT_MATERIAL (rev 11) |
| Priority | **P6** |

### 21c. STOCK TRANSFER — rev 11 addition
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Auditable inter-project material transfer without routing back through central stock |
| Required new model | **StockTransfer** {co, division, inventoryItemId, sourceProjectId, sourceProjectPackageId, destinationProjectId, destinationProjectPackageId, quantity, reason, requestedBy, requestedAt, approvedBy, approvedAt, verifiedBy, verifiedAt, status} — see `DATABASE_ARCHITECTURE.md` rev 11 addendum |
| Required new API | Full CRUD + `/approve`, `/verify-receipt`, `/cancel` |
| Required new frontend | PM "Request Transfer" (source & destination project pickers, division-filtered); Inventory Manager approval/receipt screens |
| Role responsible | PM requests; Inventory Manager approves and verifies |
| Role approving | Inventory Manager |
| Notification | Requested → Inv Mgr; approved → both PMs; received → source PM |
| Audit | Yes |
| Dependency | InvItem, MaterialRequest history (P5) |
| Priority | **P6** |

### 22. SITE EXECUTION
| Field | Value |
|-------|-------|
| Existing | ⚠️ Partial — Project has updates[] (text posts) |
| Missing | Structured tasks/milestones, time tracking, geo-tag |
| Required new model | **Task** {co, project, title, desc, assignee, plannedStart, plannedEnd, actualStart, actualEnd, status, priority, dependencies[]} |
| Required new API | Full CRUD + `/start`, `/pause`, `/complete` |
| Required new frontend | `Tasks.jsx` (Kanban/Gantt) within Project page |
| Role responsible | Engineer / Technician |
| Role approving | PM |
| Notification | Task assigned; overdue; started |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P3** |

### 23. DAILY REPORT
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Daily submission by engineer with weather, manpower, work done, issues |
| Required new model | **DailyReport** {co, project, date, submittedBy, weather, manpower{skilled, unskilled}, workDone, materialsUsed[], issues, photos[], nextDayPlan} |
| Required new API | Full CRUD + `/submit` |
| Required new frontend | `DailyReport.jsx` mobile-first form |
| Role responsible | Engineer / Site Supervisor |
| Role approving | PM (review) |
| Notification | Missing report by 10am → engineer + PM |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P3** |

### 24. CHECKLIST (rev 10 — common operational execution engine, not a Finance feature)
| Field | Value |
|-------|-------|
| Existing | ✅ Checklist template + Project.chk[] items |
| Missing | Per-execution instance, multi-responsibility assignment, richer status lifecycle, evidence, first-class approval, division-safe reuse across modules |
| Existing model | Checklist (template), Project.chk[] (inline) |
| Required new model | **ChecklistInstance** + first-class **ChecklistInstanceItem** — full shape in `DATABASE_ARCHITECTURE.md` rev 10 addendum (assignment, `responsibilityType`, 8-state status lifecycle, evidence[], approval via first-class ApprovalRequest, client sign-off fields, PM sign) |
| Existing API | `/api/checklists` (template), `PATCH /projects/:id/chk/:idx` |
| Required new API | `POST /api/v3/checklist-instances`, `/:id/apply`, `/api/v3/checklist-instances/:id/items`, `/:itemId/assign`, `/:itemId/start`, `/:itemId/submit`, `/:itemId/approve`, `/:itemId/reject`, `/:itemId/waive`, `/:itemId/client-sign` |
| Existing frontend | Checklists.jsx, inline chk in Projects.jsx |
| Required new frontend | Checklist instance page (progress + all items + assignments + approvals + evidence) + universal "My Work" queue (see rev 10 addendum below) |
| Role responsible | ENGINEER / CLIENT / SALES / SERVICE / PROJECT_MANAGER / TECHNICIAN per item's `responsibilityType` (extensible — see `DATABASE_ARCHITECTURE.md` rev 10) |
| Role approving | Project Manager / Division Manager / QA, per item's approval configuration — via first-class ApprovalRequest, never an informal Company.settings mechanism |
| Notification | Assigned → assignee; submitted → approver; approved/rejected → assignee; overdue → assignee + PM |
| Audit | Yes — every assign/start/submit/approve/reject/waive writes AuditLog |
| Dependency | Project (P3), ProjectPackage, Checklist template |
| Priority | **P8** (unchanged — see rev 10 addendum below for why execution-engine reuse doesn't change this phase's position in the P0–P16 scheme) |

### 25. QA / QC
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Quality inspections, NCR (Non-Conformance), corrective action |
| Required new model | **QaInspection** {co, project, phase, inspector, findings[], status, ncrs[]}, **NCR** {co, project, description, severity, correctiveAction, status, closedBy, closedAt} |
| Required new API | Full CRUD |
| Required new frontend | `QaQc.jsx` |
| Role responsible | QA/QC Engineer |
| Role approving | PM |
| Notification | NCR raised → PM + engineer |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P8** |

### 26. RFI / SUBMITTAL
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Request for Information + Material Submittals to consultant |
| Required new model | **RFI** {co, project, no, subject, question, raisedBy, raisedAt, targetDate, response, respondedBy, status}, **Submittal** {co, project, no, type, item, submittedBy, submittedAt, status, remarks} |
| Required new API | Full CRUD + `/respond` |
| Required new frontend | `Rfis.jsx`, `Submittals.jsx` |
| Role responsible | PM / Engineer |
| Role approving | Consultant / Client |
| Notification | Raised → PM; response due → PM |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P7** |

### 27. CHANGE ORDER (Variation)
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Variation orders, scope changes, cost impact |
| Required new model | **ChangeOrder** {co, project, no, description, costImpact, timeImpact, status, approvedBy, approvedAt} |
| Required new API | Full CRUD + `/approve`, `/reject` |
| Required new frontend | `ChangeOrders.jsx` |
| Role responsible | PM |
| Role approving | Company Admin / Client |
| Notification | Raised → Admin; approved → PM, Accounts |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P6** |

### 28. BILLING (Invoice)
| Field | Value |
|-------|-------|
| Existing | ⚠️ Payment has invNo/invDate but no invoice document |
| Missing | Structured Invoice model with items, PDF |
| Required new model | **Invoice** {co, no, customer, project, salesOrder, items[], subtotal, tax, total, status, dueDate, issuedAt, paidPart} |
| Required new API | Full CRUD + `/send`, `/mark-paid` |
| Required new frontend | `Invoices.jsx` + PDF |
| Role responsible | Accounts |
| Role approving | Company Admin |
| Notification | Sent → Customer; overdue → Customer + Accounts |
| Audit | Yes |
| Dependency | SO, Project |
| Priority | **P6** |

### 29. PAYMENT
| Field | Value |
|-------|-------|
| Existing | ✅ Payment + `/paid` + `Payments.jsx` |
| Missing | Link to Invoice; multi-mode receipts |
| Existing model | Payment {client, project, invNo, invDate, amount, due, status, paid[]} |
| Required new model | Add `Payment.invoiceId` ref |
| Existing API | `/api/payments/*` |
| Required new API | none |
| Existing frontend | `Payments.jsx` |
| Required new frontend | Invoice link |
| Role responsible | Accounts |
| Role approving | Finance Manager |
| Notification | Received → Customer + PM |
| Audit | ✅ paid[] captures |
| Dependency | Invoice (P6) |
| Priority | **P6** |

### 30. PROJECT PROFITABILITY
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Revenue - (material cost + labor + overhead) = profit |
| Required new model | **ProjectFinancial** view/aggregation (no model — computed from Invoice, MaterialRequest, DailyReport labor) |
| Required new API | `GET /api/v3/projects/:id/financial` |
| Required new frontend | Project Financial tab with P&L, margin, variance |
| Role responsible | PM / Accounts |
| Role approving | Company Admin |
| Notification | Margin < threshold → alert Admin |
| Audit | Read-only calc |
| Dependency | Invoice, MaterialRequest, DailyReport |
| Priority | **P6** |

### 31. HANDOVER
| Field | Value |
|-------|-------|
| Existing | ❌ (implicit in status='completed') |
| Missing | Handover checklist, documents, sign-off |
| Required new model | **Handover** {co, project, customer, docs[], checklistInstance, handedOverBy, receivedBy, at, warrantyStart} |
| Required new API | Full CRUD + `/complete` |
| Required new frontend | Handover form + doc upload |
| Role responsible | PM |
| Role approving | Customer sign-off |
| Notification | Complete → Service Mgr (warranty starts) |
| Audit | Yes |
| Dependency | Project (P3) |
| Priority | **P8** |

### 32. WARRANTY
| Field | Value |
|-------|-------|
| Existing | ❌ |
| Missing | Warranty period tracking, coverage terms |
| Required new model | **Warranty** {co, project, customer, asset, startDate, endDate, terms, status} |
| Required new API | Full CRUD |
| Required new frontend | `Warranties.jsx` |
| Role responsible | Service Manager |
| Role approving | none |
| Notification | Expiring 30d → Sales + Customer |
| Audit | Yes |
| Dependency | Handover (P8) |
| Priority | **P9** |

### 33. AMC (Annual Maintenance Contract)
| Field | Value |
|-------|-------|
| Existing | ✅ Contract model + `/svcs` visits |
| Missing | Link to Warranty auto-convert, per-asset AMC |
| Existing model | Contract |
| Required new model | Add `Contract.warrantyId`, `Contract.assets[]` |
| Existing API | `/api/contracts/*` |
| Required new API | `POST /api/v3/contracts/from-warranty/:warrantyId` |
| Existing frontend | Contracts.jsx |
| Required new frontend | Auto-create button |
| Role responsible | Service Manager / Sales |
| Role approving | Company Admin |
| Notification | Expiring → Sales for renewal |
| Audit | Yes |
| Dependency | Warranty (P9), Contract |
| Priority | **P9** |

### 34. SERVICE
| Field | Value |
|-------|-------|
| Existing | ✅ ServiceCall + workflow |
| Missing | Link to AMC/Contract, per-asset service history |
| Existing model | ServiceCall |
| Required new model | Add `ServiceCall.contractId`, `ServiceCall.assetId` |
| Existing API | `/api/service-calls/*` |
| Required new API | `GET /api/v3/service-calls/by-contract/:cId`, `by-asset/:aId` |
| Existing frontend | ServiceCalls.jsx |
| Required new frontend | Contract/Asset picker |
| Role responsible | Service Engineer |
| Role approving | Service Manager |
| Notification | Assigned → Engineer; closed → Customer |
| Audit | Yes |
| Dependency | Asset (P10), Contract |
| Priority | **P9** |

### 35a. RAISE TO FINANCE (Payment Milestone Escalation) — rev 9 addition
| Field | Value |
|-------|-------|
| Existing | ❌ Not modeled in v2 (PWA proved the business need; no v2 equivalent) |
| Missing | Explicit escalation of a due Sales Order payment milestone to Accounts/Finance |
| Existing model | none |
| Required new model | **FinanceWorkItem** {co, salesOrderId, milestoneId, projectId, projectPackageId, outstandingAmount, siteStatus, remark, requestedCollectionDate, priority, requestedBy, status, claimedBy, resolution} — see `DATABASE_ARCHITECTURE.md` Rev 9 addendum |
| Existing API | none |
| Required new API | `POST /api/v3/sales-orders/:id/milestones/:mIdx/raise-to-finance`, `GET/POST /api/v3/finance-work-items`, `POST /:id/claim`, `POST /:id/resolve` |
| Existing frontend | none |
| Required new frontend | "Raise to Finance" button on Project/SalesOrder Commercial tab (PM); Finance Work Items queue on Accounts dashboard |
| Role responsible | Project Manager (or higher) — never Engineer, never Accounts |
| Role approving | N/A (this IS the escalation, not a request needing approval) — Accounts claims and resolves it |
| Notification | Raised → all authorized Accounts/Finance users; resolved → requesting PM |
| Audit | Yes — create/claim/resolve all write AuditLog |
| Dependency | SalesOrder (P2), Project/ProjectPackage (P3), Checklist/progress signal (P8) |
| Priority | **P6** (finance/commercial — same phase as Invoice/Payment) |

### 35b. FINANCE RECORDS PAYMENT (against a raised milestone) — rev 9 addition
| Field | Value |
|-------|-------|
| Existing | ✅ Payment + `/paid` (unchanged — this step reuses existing Payment recording) |
| Missing | Link from Payment back to the FinanceWorkItem/milestone that generated it |
| Required new model | Add `Payment.financeWorkItemId`, `Payment.milestoneRef` (see `DATABASE_ARCHITECTURE.md`) |
| Required new API | none new — existing Payment CRUD, extended with the new optional fields |
| Role responsible | Accounts / Finance |
| Role approving | Finance Manager (existing rule, unchanged) |
| Notification | Payment recorded → FinanceWorkItem.status='resolved' → requesting PM |
| Audit | ✅ existing Payment audit + FinanceWorkItem resolution audit |
| Dependency | Raise to Finance (35a) |
| Priority | **P6** |

### 35. RENEWAL
| Field | Value |
|-------|-------|
| Existing | ❌ (implicit "renewed" status in Contract) |
| Missing | Renewal quotation flow, discount matrix |
| Required new model | **Renewal** {co, contract, quotation, discount, status, decidedAt} |
| Required new API | `POST /api/v3/contracts/:id/renew` |
| Required new frontend | Renewal quotation from expiring contract |
| Role responsible | Sales Manager |
| Role approving | Company Admin |
| Notification | Contract expiring → Sales + Customer |
| Audit | Yes |
| Dependency | Contract, Quotation |
| Priority | **P9** |

---

## Summary Priority Roll-up

| Priority | Steps |
|----------|-------|
| **P0** (safety) | (foundational — session/deployment) |
| **P1** (users/roles/permissions) | Approval (8) |
| **P2** (connect existing) | Customer (1), Enquiry (2), Qualification (3), Estimate/BOQ (5), Quotation (6), Revision (7), Customer PO (9), SalesOrder (10) |
| **P3** (project core) | Site Visit (4), Project Creation (11), Project Manager Assignment (12), Site Execution (22), Daily Report (23) |
| **P4** (specialization) | Department Assignment (13) |
| **P5** (inventory/procurement) | Project BOQ (14), Material Request (16), Procurement (17), Purchase Order (18), GRN (19), Stock (20), Project Issue (21) |
| **P6** (finance/commercial) | Budget (15), Change Order (27), Billing (28), Payment (29), Profitability (30), Raise to Finance (35a), Finance Records Payment (35b) |
| **P7** (docs/RFI) | RFI/Submittal (26) |
| **P8** (QA/QC) | Checklist (24), QA/QC (25), Handover (31) |
| **P9** (service/AMC) | Warranty (32), AMC (33), Service (34), Renewal (35) |
| **P10** (asset) | Asset registry — implicit under service/warranty |
| **P11–P16** | Workforce, BI, automation, portals, AI — future |

---

## Rev 9 addendum — PWA-Proven Workflow Compatibility Requirement (ADDITIVE — does not reopen frozen architecture)

**Source:** the legacy PWA proved a business relationship in live production that v3 must retain. Only the *relationship* is preserved — not the PWA's technical implementation. Frozen rev 1–8 decisions (entitlement precedence, ProjectPackage as first-class collection, first-class approval collections, etc.) are unchanged.

### The preserved relationship

```
                PROJECT
                /     \
       CHECKLIST       SALES ORDER
      (operational)         │
           │                ↓
           │         PAYMENT MILESTONES
           │                │
           │                ↓
           └──────→   FINANCE / ACCOUNTS
```

Project is the operational bridge between Checklist (execution) and Accounts/Finance (commercial) — there is no direct Accounts → Checklist relationship. Using the frozen v3 model names:

```
Customer → SalesOrder → Project → ProjectPackage → ChecklistInstance → ChecklistInstanceItem
SalesOrder → paymentMilestones[] → (Raise to Finance) → FinanceWorkItem → Payment
```

### Role flow

- **Engineer/Technician:** executes assigned ChecklistInstance work; completion changes operational progress only. Never touches Payment/Invoice/FinanceWorkItem.
- **Project Manager:** owns Project/ProjectPackage/Checklist/Timeline; when a payment milestone becomes relevant, uses **Raise to Finance** (see workflow step 35a). Never records or edits a Payment.
- **Accounts/Finance:** receives the FinanceWorkItem, opens the related SalesOrder/Payment record, and records/reconciles payment (step 35b). Never owns Project execution, ProjectPackage assignment, or Checklist templates/instances.

### Explicitly forbidden relationships (do not implement)

- Accounts → Checklist ownership
- Checklist → Payment direct accounting write
- Engineer → Payment responsibility
- Checklist completion → automatic payment receipt
- Accounts acting as an operational Project Manager

### Required end-to-end test (P6 acceptance criteria)

1. SalesOrder exists with `paymentMilestones[]`.
2. Project linked to SalesOrder; ProjectPackage exists where applicable.
3. ChecklistInstance attached to the correct ProjectPackage.
4. Engineer completes assigned checklist work → Project/ProjectPackage progress updates.
5. A payment milestone's `dueCondition` is met → milestone `status` flips to `eligible` (informational only, no financial write).
6. Authorized Project Manager selects **Raise to Finance** on the eligible milestone.
7. FinanceWorkItem is created; authorized Accounts/Finance users are notified.
8. Accounts opens the related SalesOrder/milestone and records payment through the existing Payment workflow.
9. FinanceWorkItem.status → `resolved`; requesting PM notified.
10. Operational checklist history remains unchanged and financial history remains auditable throughout.
11. No user crosses a division/company boundary at any step (entitlement + scoping rules from `ACCESS_MATRIX.md` apply unchanged).

### Legacy data migration

Preserve `Project → SalesOrder → payment milestone → payment history` and `Project → checklist execution history` wherever the source data proves the link. Where it cannot be proven reliably: leave the v3 reference null, mark `migrationReviewRequired=true`, and never invent a relationship. See `DATABASE_ARCHITECTURE.md` Rev 9 addendum and `V3_MIGRATION_MAP.md` for field-level detail.

---

## Rev 10 addendum — Checklist as a Common Operational Execution Engine (ADDITIVE — does not reopen frozen architecture)

**Source:** Checklist's primary purpose is project execution — task, assignment, responsibility, evidence, approval, progress tracking. Finance (rev 9) is only one optional downstream consequence of progress; Checklist is never reduced to "things that trigger Finance." Full model in `DATABASE_ARCHITECTURE.md` rev 10 addendum; role guardrails in `ACCESS_MATRIX.md` §13.2.

### Core concept

```
ChecklistTemplate (= existing Checklist collection, REUSE'd)
  ↓
ChecklistInstance
  ↓
ChecklistInstanceItem
  ↓
Assignment / Responsibility
  ↓
User executes task
  ↓
Completion / Evidence / Approval
  ↓
ProjectPackage progress
  ↓ (optional downstream — see rev 9 addendum above)
Eligible payment milestone → Raise to Finance → FinanceWorkItem → Accounts
```

### Responsibility types (extensible)

Seed set — `ENGINEER`, `CLIENT`, `SALES`, `SERVICE`, `PROJECT_MANAGER` — extended through the permission/assignment model, never hard-coded forever (see `DATABASE_ARCHITECTURE.md` rev 10 "Responsibility types"). Examples:

- **ENGINEER:** Copper piping completed · Pressure testing completed · Electrical testing completed
- **CLIENT:** Equipment location approved · Installation accepted · Handover signed
- **SALES:** Site takeover information confirmed · Commercial/technical requirement confirmed
- **SERVICE:** Warranty/service handover completed · Service documentation received
- **PROJECT MANAGER:** Timeline set · Work package reviewed · Handover coordinated

**Responsibility ≠ Assignment.** `responsibilityType=ENGINEER` says what kind of party must act; `assignedUserId=Vinod` says which specific authorized user. A PM assigns work filtered by company, purchased division, department, project/package scope, and permissions.

### Engineer / Technician workflow (mobile-first)

```
My Work → Assigned Project/ProjectPackage → Assigned Checklist Tasks → Open task →
View instruction → View due date → Add remark → Upload photo/evidence → Complete/Submit →
Supervisor/Manager approval if required
```
Engineer/Technician sees only checklist work assigned to them or otherwise authorized by project/package scope — never unrelated items or projects.

### Project Manager workflow

Create/select checklist template · apply to ProjectPackage · add/edit allowed items · assign items · set planned dates · monitor progress · reassign with permission · review evidence · approve where permitted · add PM sign · monitor overdue items · close package/project per approval rules · Raise to Finance for eligible milestones (rev 9). **PM does not directly record payments** (unchanged from rev 9 — see `ACCESS_MATRIX.md` §13.1).

### Service workflow (checklist engine reused, not duplicated)

```
Service Call → Service Checklist (same ChecklistInstance/Item engine, serviceCallId parent) →
Assigned Service Engineer → Inspection → Actions → Photos/readings → Completion → Service Manager review
```
Service checklists stay separate from unrelated project execution data (different `serviceCallId` vs `projectPackageId` parent) while sharing the one engine — see `DATABASE_ARCHITECTURE.md` rev 10 "Reuse across modules."

### Sales workflow

Where `responsibilityType=SALES`, the Sales user completes only the checklist responsibilities they're authorized for — an actionable assigned responsibility, not a label. Example (project handover from Sales): site information confirmed · client requirement confirmed · access information shared · commercial documents handed over.

### Client sign-off

For `responsibilityType=CLIENT` (no User account — evidence is stored directly on the item, see `DATABASE_ARCHITECTURE.md` rev 10): client name, signature, date/time, approval remark, optional photo/document evidence.

### Status, overdue/timeline, evidence, approval

Full state machine and rules are in `DATABASE_ARCHITECTURE.md` rev 10 ("Status model", "Approval rule"). Every actionable item may carry `plannedDate`/`targetDate`; the system computes upcoming/due-today/overdue/completed-late/completed-on-time, visible to the responsible user and PM, with notifications targeted per authorization (never broadcast beyond entitlement/permission scope). Evidence (photos, documents, test reports, signatures, readings) belongs to the item/execution record and is never exposed across unauthorized companies/divisions/projects.

### Checklist → Project progress (never Finance-derived)

Progress is calculated from configured required/actionable checklist items only — see the Progress calculation rule in `DATABASE_ARCHITECTURE.md` rev 10 (20 items, 15 completed → 75%). Displayed on: Project Dashboard, ProjectPackage, Division Dashboard, Engineer "My Work", Reports.

### Checklist → Finance (reaffirms rev 9 — never automatic)

```
Checklist/task completion → ProjectPackage progress/stage → Payment milestone becomes eligible →
PM explicitly "Raise to Finance" → FinanceWorkItem → Accounts/Finance → Payment workflow
```
**NEVER:** checklist completion → automatic payment creation/receipt. Unchanged from rev 9.

### Checklist → other modules (one engine, many templates)

Reusable across Solar/MEP/HVAC projects, Service Calls, AMC/PM jobs, commissioning, testing, handover, warranty activities, site execution, quality inspections, safety inspections, and other authorized operational workflows — one secure common checklist/task engine with division/module-specific templates. Never a separate engine per module. Division separation is absolute: MEP and HVAC checklist templates and operational data are never combined (unchanged global invariant).

### Required UI (both views mandatory)

**A. Project/ProjectPackage view:** Project → Package → Checklist → progress → all items → assignments → approvals → evidence.
**B. Universal "My Work" queue:** any assigned user (Engineer/Technician/Sales/Service/PM) → Today's Tasks → Upcoming → Overdue → Completed → assigned checklist items. Checklist is an operational work queue, not merely an admin configuration page — see `DASHBOARD_ARCHITECTURE.md` rev 10 addendum.

### Reporting

Total tasks · completed · pending · overdue · completed late · completion percentage · employee workload · division workload · project/package progress · approval pending · rejected tasks — access follows existing company/division/project permission scoping (unchanged).

### Required end-to-end test (rev 10 acceptance criteria)

1. Project → ProjectPackage → apply checklist template → 10 checklist items.
2. Assign: 4 Engineer, 2 Client, 1 Sales, 2 Service, 1 PM.
3. Each user sees only their authorized work (scoping unchanged from `API_ARCHITECTURE.md` §7 `scopeFilterV3`).
4. Engineer completes a task with photo evidence.
5. Manager reviews; approval recorded via first-class ApprovalRequest.
6. ProjectPackage progress updates (required/actionable items only).
7. Relevant payment milestone becomes eligible (rev 9 — informational only).
8. PM explicitly chooses "Raise to Finance."
9. FinanceWorkItem created; Accounts receives it; Accounts handles the payment workflow.
10. At no point does checklist completion automatically create a payment.

---

## Rev 11 addendum — Inventory: Reusable Tool Custody vs. Project Material Lifecycle (ADDITIVE — does not reopen frozen architecture)

### Core concept

```
InvItem.itemType
  ├── REUSABLE_TOOL_ASSET → ToolCustody lifecycle (issue → use → return; never "consumed")
  └── PROJECT_MATERIAL    → Requirement → Request → Approval → Issue → Use → Excess/Return/Transfer/Scrap
```
The legacy PWA's single `ret` boolean collapses both realities into one flag. V3 keeps them explicitly separate everywhere — data model (`DATABASE_ARCHITECTURE.md` rev 11), workflow, reporting, and permissions (`ACCESS_MATRIX.md` §13.3).

### Project Manager workflow (report/request only)

```
Site material count → Declare remaining/excess/scrap → Submit MaterialReturnRequest →
(separately) Report tool condition/location → 
(separately) Request StockTransfer to another project →
Await Inventory Manager verification — PM never posts a stock transaction directly
```
Mirrors the rev 9 "Raise to Finance" pattern: the PM-facing action is a **request/declaration**, never a direct system-of-record mutation. The Inventory Manager's verification is the action that actually moves stock, exactly as Accounts' own Payment workflow is what actually records a payment (rev 9).

### Inventory Manager workflow (verification and physical action)

```
Verification queue (MaterialReturnRequest / StockTransfer / ToolCustody return) →
Physical count/inspection → Enter verified/accepted quantities (may differ from PM's declared quantities) →
Post InvTransaction (RETURN_TO_STOCK / SCRAP / TRANSFER_OUT / TRANSFER_IN / TOOL_RETURN) →
Update ToolCustody.status or MaterialRequest.returnedQty/scrapQty
```
The Inventory Manager alone performs the stock-affecting action, after physical verification — never a rubber stamp of the PM's declared numbers.

### Engineer / Technician workflow

Reports tool condition and location when custody changes hands on site; reports material usage against issued quantities. Never alters stock, never verifies their own or another user's return/transfer.

### Explicitly forbidden relationships (do not implement)

- PM's declared return/excess/scrap quantity directly decrementing/incrementing `InvItem` stock (verification step is mandatory).
- `REUSABLE_TOOL_ASSET` items being decremented as "used" like a consumable.
- A `StockTransfer` or `MaterialReturnRequest` crossing divisions (MEP ↔ HVAC).
- Accounts or any non-Inventory-Manager role posting an `InvTransaction`.
- A parallel/informal excess-return mechanism inside `Company.settings` instead of the first-class `MaterialReturnRequest`/`StockTransfer` collections.

### Required end-to-end test (rev 11 acceptance criteria — mirrors the user's three scenarios)

**Scenario A — Tool custody reissue:** Tool issued to Engineer A (`ToolCustody.status=ISSUED_TO_EMPLOYEE`) → Engineer A returns it → Inventory Manager verifies condition, sets `status=RETURNED` → Inventory Manager reissues to Engineer B (`status=ISSUED_TO_EMPLOYEE`, new `custodianUserId`). Full custody history preserved, never overwritten.

**Scenario B — Project material excess with partial scrap:** PM declares 50 units excess on a `PROJECT_MATERIAL` item (`declaredReturnQty=50`) → Inventory Manager physically verifies 40 usable + 10 damaged → records `acceptedQty=40`, `acceptedScrapQty=10` → posts `RETURN_TO_STOCK` (40) and `SCRAP` (10) `InvTransaction`s → `MaterialRequest.returnedQty`/`scrapQty` update accordingly → `remainingOnSiteQty` recalculates. PM's original declared 50 is preserved unmodified alongside the verified split.

**Scenario C — Cross-project transfer:** PM on Project X requests `StockTransfer` of material to Project Y (same division) → Inventory Manager approves → physical handoff → Inventory Manager verifies receipt at Project Y (`status=RECEIVED`) → `TRANSFER_OUT` posted against Project X, `TRANSFER_IN` posted against Project Y. A same-flow request spanning MEP→HVAC is rejected by validation before reaching the Inventory Manager.

### Legacy data migration

`ret` boolean and existing issue/used/returned-qty fields are read-only inputs to the rev 11 classification (see `DATABASE_ARCHITECTURE.md` rev 11 "Legacy compatibility"). No historical tool-custody or material-return relationship is fabricated during migration — unresolvable/ambiguous legacy rows get `itemType=null` + `migrationReviewRequired=true`, consistent with the rev 4–10 migration philosophy.

---

## Rev 12 addendum — Global Record Ownership, Edit & Delete Control (ADDITIVE — does not reopen frozen architecture, applies across every workflow step above)

### Core concept

```
Every "Edit" or "Delete" action in every step above (Quotation edit, DailyReport edit,
MaterialReturnRequest edit, Payment reversal, ChecklistInstanceItem edit, etc.)
    ↓
requireOwnership(record, user, action)   — API_ARCHITECTURE.md §7
    ↓
createdByUserId === user.id  OR  explicit override permission
    ↓
record.status allows this action (DRAFT/SUBMITTED/APPROVED-locked per resource)
    ↓
Allowed → normal edit/delete            Override → RecordCorrection (audited, never silent)
```
This is not a new workflow step — it is a constraint that applies to the Edit/Delete/Correction action inside every existing step (Quotation, MaterialRequest, DailyReport, Checklist item, Payment reversal, and so on), platform-wide, implemented once as a shared primitive.

### Per-role workflow impact (examples, non-exhaustive — the rule is uniform)

- **Sales Executive** edits their own Quotation freely pre-submission; cannot edit a colleague's Quotation; cannot self-approve where approval is required (unchanged approval-threshold rule).
- **Project Manager** edits their own Task/DailyReport/MaterialRequest/MaterialReturnRequest/StockTransfer request while in an editable state; cannot edit another PM's records even within the same division; cannot alter Payment (unchanged rev 9 rule) or directly alter stock (unchanged rev 11 rule) regardless of ownership.
- **Inventory Manager** verifying a `MaterialReturnRequest` is not "editing the PM's record" — it is the Inventory Manager's own authorized verification action on a cross-module boundary (unchanged rev 11 flow), not a `RecordCorrection`.
- **Accounts/Finance** corrects a reconciliation draft they created; a finalized Payment is locked — reversal only, never edit (unchanged rev 9/`LIVE_APP_SAFETY.md` rule).
- **Manager/Admin** (any module) needing to fix another employee's record uses the `RecordCorrection` workflow — never a direct field overwrite — and the correction is visible in that record's audit history.

### Explicitly forbidden relationships (do not implement)

- Any Edit/Delete UI action without a server-side `requireOwnership()` check behind it.
- Treating "same role" or "same department" as sufficient authorization to edit another user's record.
- A Manager/Admin edit that overwrites `createdByUserId` to themselves.
- A per-module reimplementation of ownership logic instead of the one shared `requireOwnership()` primitive.
- Inventing `createdByUserId` for legacy records with no reliable creator.

### Required acceptance tests (rev 12 — mirrors the user's 8 scenarios)

Same-role edit attempt on another's record (denied) · Manager normal edit of an employee's record (denied unless override, then via `RecordCorrection`) · creator edits own draft (allowed) · creator attempts edit of a submitted/locked record (denied or controlled resubmission) · creator attempts edit of a finalized financial entry (denied) · cross-company edit attempt (403) · cross-division edit attempt (403) · direct API call bypassing the UI for another employee's record (403 regardless of UI button visibility). Full test table: `ACCESS_MATRIX.md` §13.4.

### Legacy data migration

No `createdByUserId` is invented for migrated records with no reliable legacy creator field — such rows get `createdByUserId=null` + `migrationReviewRequired=true`, consistent with the rev 4–11 migration philosophy. v3 ownership enforcement is forward-only and does not retroactively restrict already-completed v2 history.

---

## Verification: No files modified
- Read: prior planning docs only
- Wrote: `v3/WORKFLOW_MAP.md`
- Zero v2 file changes
