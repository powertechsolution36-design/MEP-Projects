# DATABASE ARCHITECTURE — v3

> **📝 rev 9 addition — 2026-09-10.** Additive only, does not reopen the freeze. Added `SalesOrder.paymentMilestones[]`, `Payment` finance-linkage fields, and `FinanceWorkItem` collection (PWA-compat "Raise to Finance" requirement). See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Defined full `ChecklistInstanceItem` shape (task/assignment/responsibility/evidence/approval/status lifecycle) — Checklist is a common operational execution engine; Finance is one downstream consequence, never the owner. See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Split Inventory into two lifecycles: `REUSABLE_TOOL_ASSET` (custody-tracked, never decremented as consumed) vs. `PROJECT_MATERIAL` (consumption-tracked, requirement→issue→use→excess→return/transfer/scrap). Added `InvItem.itemType`, first-class `ToolCustody`, extended `MaterialRequest` + new `MaterialReturnRequest` (Excess/Return Form), first-class `StockTransfer`, and extended `InvTransaction.type` enum. PM reports/requests only; Inventory Manager alone performs the physical stock transaction. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added the mandatory ownership metadata block (`createdByUserId`, `updatedByUserId`, etc.) required on every v3 collection platform-wide, and the first-class `RecordCorrection` collection for controlled manager/admin overrides. Applies uniformly across Sales, Finance, Admin, Inventory, Solar/MEP/HVAC PM, Service, and every other module — never implemented per-module. See `CHANGELOG.md` rev 12.

**Authority:** Data model authority. Contradictions in other docs deferred to this one (see DOCUMENT_AUTHORITY.md).

**Rule:** Every v3 model is additive. Legacy v2 collections continue unchanged; v3 adds new collections and new optional fields to existing collections with defaults so v2 code paths ignore them.

---

## Collection inventory

### Legacy (v2) collections — UNCHANGED shapes, may gain new optional fields

| Collection | v3 status | Additions |
|---|---|---|
| Company | ADAPT | + `entitlements` (cache), + `settings.enforceEntitlements`, + `settings.uiVersion`, + `settings.migrationReviewRequired`, + `settings.approvalPreferences` (company-level preferences ONLY; workflow history lives in first-class `ApprovalRule` / `ApprovalRequest` / `ApprovalStep`) |
| User | ADAPT | + `permissions[]`, + `projectAccess[]`, + `jobTitle` (optional display), + `mfa{}`, + `lastAuthTs` |
| Enquiry | ADAPT | + `customerId`, + `division`, + `trade`, + `stage`, + `qualification{}`, + `nextAction{}` |
| SalesOrder | ADAPT | + `customerId`, + `enquiryId`, + `quotationId`, + `customerPOId`, + `division`, + `trade`, + `paymentMilestones[]` (rev 9 — see addendum below) |
| Project | ADAPT | + `divisions[]`, + `projectMgrId`, + `customerId`, + `salesOrderId` |
| ServiceCall | ADAPT | + `division`, + `contractId`, + `assetId`, + `assignedTo` (FK, not string) |
| Contract | ADAPT | + `division`, + `warrantyId`, + `assets[]` |
| Payment | ADAPT | + `invoiceId`, + `division`, + `salesOrderId`, + `projectId`, + `projectPackageId` (nullable), + `milestoneRef`, + `financeWorkItemId` (rev 9 — see addendum below) |
| Checklist | REUSE | (template stays; ChecklistInstance is new) |
| InvItem | ADAPT (rev 11) | + `itemType: REUSABLE_TOOL_ASSET \| PROJECT_MATERIAL` (see rev 11 addendum below); division already present |
| InvCategory, InvLocation, InvIssue | REUSE | — |
| InvTransaction | ADAPT (rev 11) | `type` enum extended to 12 values (see rev 11 addendum below); shape otherwise unchanged |
| Notification | ADAPT | + `permissions[]` (permission-based targeting), + `divisions[]` |
| Sequence | REUSE | — |

### New v3 collections

**Platform / Commercial**
- Plan
- Subscription
- DivisionEntitlement
- FeatureEntitlement
- AddOn

**Access / Audit**
- Permission (catalog)
- RolePermission (default role → permission map)
- UserPermissionOverride (per-user grants/revokes)
- ApprovalRule (per-company approval logic)
- ApprovalRequest (in-flight approvals)
- ApprovalStep (per-approver decisions)
- AuditLog (immutable)
- RecordCorrection (rev 12 — first-class, controlled manager/admin override path; see addendum below)

**CRM / Sales**
- Customer
- Contact
- Site
- Quotation
- CustomerPO
- BOQ

**Project / Execution**
- ProjectPackage (first-class, addressable)
- Task
- DailyReport
- ChecklistInstance
- ChecklistInstanceItem (rev 10 — first-class, addressable; see addendum below)

**Procurement / Inventory**
- MaterialRequest (rev 11 — extended; see addendum below)
- MaterialReturnRequest (rev 11 — first-class Excess/Return Form; see addendum below)
- ToolCustody (rev 11 — first-class; see addendum below)
- StockTransfer (rev 11 — first-class, inter-project; see addendum below)
- Vendor
- RFQ
- PurchaseOrder
- GRN
- StockLedger

**Finance**
- Invoice
- Budget
- ChangeOrder
- FinanceWorkItem (rev 9 — "Raise to Finance" record; see addendum below)

**Documents**
- RFI
- Submittal
- Drawing

**QA / Handover**
- QaInspection
- NCR
- Handover
- Warranty
- Renewal
- Asset

---

## Sourced-vs-cached data

| Concept | Source of truth | Cache |
|---------|-----------------|-------|
| Effective entitlement | Subscription + DivisionEntitlement + FeatureEntitlement + Subscription.addOns[] | `Company.entitlements` |
| User's effective permissions | RolePermission (by role) + UserPermissionOverride | (in-request, not stored) |
| Approval matrix | ApprovalRule collection | not cached |
| Project stock rollup | InvTransaction | on-demand aggregation |
| Project material remainingOnSite (rev 11) | MaterialRequest quantity fields (issuedQty−usedQty−returnedQty−scrapQty) | not cached — computed at read |
| Tool current custody/location (rev 11) | ToolCustody.status + latest record per tool | cached on ToolCustody (single current record per tool) |
| Payment milestone due-status | SalesOrder.paymentMilestones[] + Project/ProjectPackage progress | not cached — computed at read |
| ProjectPackage progress % | ChecklistInstanceItem where required=true (see rev 10 addendum) | cached on ChecklistInstance.progressPct, recomputed on item change |

---

## Project / Package model (RESOLVED)

`Project` is the overall project shell. `ProjectPackage` is a **first-class collection** (not embedded sub-doc), addressable at `/api/v3/projects/:pId/packages/:pkgId`.

```
Project {
  co, code, name, client, site, customerId,
  divisions: [enum],                    // 1 or more purchased divisions
  status,                                // rolled up from packages OR direct for single-div
  value,                                 // sum of packages.value
  projectMgrId: ObjectId → User,        // Overall PM
  salesOrderId, enquiryId,               // Provenance
  meta, timestamps,
  // Legacy fields preserved (never removed)
  div, pm, engs[], chk[], updates[], dc[]    // Read via compat adapter
}

ProjectPackage {
  _id, co, projectId: ObjectId → Project,
  division: enum,                        // SOLAR | MEP | HVAC
  code, name, scope,
  value, budget,
  projectMgr: ObjectId → User,          // Division PM
  engs: [ObjectId → User],
  status,
  startDate, endDate,
  handedOverAt,
  warranty { start, end, terms },
  timestamps
}
```

### Migration compatibility rule
- Existing single-div projects: DO NOT duplicate history into packages
- Compat adapter (`legacyProjectPackageAdapter.js`) presents single-div v2 project AS ONE virtual package on the fly
- No writes to duplicated fields
- Only when the project is EXPLICITLY converted to multi-div (user action or v3 API call) does a ProjectPackage row get materialized
- After materialization, the legacy `chk[]`, `updates[]`, `engs[]` on Project become read-only historical fields; new writes go to Task, ChecklistInstance, DailyReport, ProjectPackage

**Single source of truth per record.** Never two writable copies.

---

## Standardized `source` enum

Used on entitlement rows and migration-tracked rows:
```
source: 'plan' | 'addon' | 'manual' | 'migration'
```

---

## Indexes (target)

- `Company`: name, code, disabled
- `User`: co+un (partial unique), role, designation, department, division, disabled, createdBy
- `Subscription`: co+status (partial unique where status='active'), plan+startDate
- `DivisionEntitlement`: co+division (unique), enabled
- `FeatureEntitlement`: co+code (unique)
- `AuditLog`: co+createdAt (descending), user+createdAt, resource+resourceId+createdAt
- `Project`: co+status, co+divisions, code
- `ProjectPackage`: co+projectId, co+division, projectId+division (unique)
- `Task`: co+projectId, assignee+status
- `DailyReport`: co+projectId+date (unique), submittedBy+date
- `MaterialRequest`: co+projectId+status
- `PurchaseOrder`: co+status, co+vendor
- `GRN`: co+po
- `Invoice`: co+status, co+customerId, no (unique per co)
- `Payment`: co+status, co+invoiceId
- `Asset`: co+customerId, co+division

---

## Non-destructive rules encoded in schema

- All models have `deleted: Boolean (default false, indexed)` + `deletedAt`, `deletedBy`, `deletionReason`
- Invoice, Payment, GRN: `immutable: true` at model-level guard — no delete route exists; reversal via credit note / reverse entry
- AuditLog: `immutable: true` — no delete route at all
- Restore window enforced by scheduled job (30/90/180 days per resource class)

---

## Legacy-safe additions

- Every new field on existing collections has a default (null, empty array, false) so v2 code paths that ignore the field continue to work
- New indexes added without dropping existing
- V3 uses `mongoose.createConnection` isolated from v2 to avoid Model registry conflicts

Active models live under `v3/server/src/models/` (P1 foundation — User, Company, AuditLog, RecordCorrection, Plan, Subscription, DivisionEntitlement, FeatureEntitlement, AddOn already implemented there; feature-module models are added under the same `src/models/` path as each module is built).

---

## Rev 4 addendum — Sub-trade model (FINAL)

Use `subTrades[]` (array of enums) on Project / ProjectPackage / Enquiry / SalesOrder / BOQ / Quotation — never a single `trade` string.

```
Project { ..., subTrades: [enum] }
ProjectPackage { ..., division: enum, subTrades: [enum] }
```

Valid sub-trade values by division:

**MEP:**  `ELECTRICAL, PLUMBING, FIRE_FIGHTING, OTHER`
**HVAC:** `VRF, DUCTED_AC, SPLIT_AC, PIPING, PRESSURE_TESTING, VACUUM_TESTING, LEAK_TESTING, COMMISSIONING`
**SOLAR:** `ROOFTOP_ON_GRID, ROOFTOP_OFF_GRID, GROUND_MOUNT, HYBRID, OTHER`

A project/package MAY contain multiple sub-trades (multi-select). Validation ensures each sub-trade belongs to the package's division.

## Rev 4 addendum — Approval collections (FINAL, first-class)

```
ApprovalRule    { co, resource, action, condition{field,op,value},
                  approvers[{role|userId, quorum}], steps[], escalation{after,to},
                  systemManaged (bool — cannot be disabled by company), active }

ApprovalRequest { co, requesterId, resource, resourceId, action, payload,
                  ruleIds[], status pending|approved|rejected|executed|expired,
                  createdAt, decidedAt, approvalRequestId, actionId, idempotencyKey,
                  executionStatus queued|running|succeeded|failed|null, executedAt }

ApprovalStep    { requestId, approverId, stepIndex, decision approve|reject,
                  note, decidedAt }
```

- Super Admin owns master/default ApprovalRule templates (systemManaged=true).
- Company Admin may create additional ApprovalRules (systemManaged=false) but cannot disable systemManaged=true rules.
- ApprovalRequest idempotent execution — retry-safe via idempotencyKey.

## Rev 9 addendum — Project↔Checklist↔Payment Milestone↔Finance (PWA-proven workflow, ADDITIVE)

**Business requirement source:** legacy PWA proved this operational/commercial relationship in production. V3 preserves the *relationship*, not the PWA's implementation. See `BUSINESS_WORKFLOWS.md` for the full workflow narrative and `ACCESS_MATRIX.md` §13 for the role guardrails this addendum enforces.

This does NOT reopen or modify: entitlement precedence, ProjectPackage first-class-collection decision, approval-collection architecture, or any other frozen rev 1–8 decision. It only adds new fields/collections per the existing "every v3 model is additive" rule.

```
SalesOrder {
  ...existing (rev 1–8, unchanged)...
  paymentMilestones: [{
    _id, index, label, dueCondition,     // e.g. "on handover", "30% advance"
    amount, currency,
    status: pending | eligible | raised | invoiced | paid | cancelled,
    projectId, projectPackageId,          // nullable — operational context this milestone tracks
    eligibleAt, eligibleReason,           // set when PM/Engineer progress makes it raisable (informational only)
    raisedFinanceWorkItemId               // set once "Raise to Finance" is used
  }]
}

FinanceWorkItem {
  co, salesOrderId, milestoneId,
  projectId, projectPackageId,           // nullable
  outstandingAmount, siteStatus, remark,
  requestedCollectionDate, priority,
  requestedBy: ObjectId → User,          // must be an authorized PM/manager (see ACCESS_MATRIX §13)
  status: open | claimed | in_progress | resolved | cancelled,
  claimedBy: ObjectId → User,            // Accounts/Finance user who picked it up
  resolution { paymentId, note, at },
  createdAt, updatedAt
}

Payment {
  ...existing (rev 1–8, unchanged)...
  salesOrderId, projectId, projectPackageId (nullable),
  milestoneRef,                          // SalesOrder.paymentMilestones[]._id this payment settles
  financeWorkItemId                      // nullable — set when payment originated from a Raise-to-Finance item
}
```

### Rules (FINAL, additive — do not reopen)

- **Checklist completion never writes Payment, Invoice, or FinanceWorkItem directly.** ChecklistInstanceItem completion may only update Project/ProjectPackage progress/status and, where a milestone's `dueCondition` is met, flip that milestone's `status` to `eligible` (informational — no financial effect).
- **"Raise to Finance" is the only path that creates a FinanceWorkItem.** It is an explicit action by an authorized Project Manager (or higher), never an automatic side-effect of checklist or progress changes.
- **Accounts/Finance acts only through FinanceWorkItem → Payment.** Accounts never writes ChecklistInstance, Task, DailyReport, or ProjectPackage assignment.
- **AuditLog entry required** on FinanceWorkItem create, claim, and resolve — same audit rules as §9 of `API_ARCHITECTURE.md`.
- All new fields are optional with safe defaults (`paymentMilestones: []`, all Payment additions nullable) — zero impact on existing SalesOrder/Payment records or v2 code paths.

### Legacy migration rule (see `V3_MIGRATION_MAP.md` for file-level detail)

- Preserve `Project → SalesOrder → payment history` wherever the source data proves the link; where it cannot be proven, leave the reference **null** and set `migrationReviewRequired=true` on the record — never invent a milestone or a Project↔SalesOrder link.
- Never reconstruct historical checklist completion state from the current checklist template.
- Never alter historical Payment records to backfill `milestoneRef`/`financeWorkItemId` — those stay null for pre-v3 payments.

## Rev 10 addendum — Checklist as a common operational execution engine (ADDITIVE)

**Business requirement source:** Checklist's primary purpose is project execution — task, assignment, responsibility, evidence, approval, progress tracking. Finance (rev 9) is one optional downstream consequence of progress, never the owner of Checklist. This addendum defines the full `ChecklistInstanceItem` shape that rev 1–9 left at outline level (`BUSINESS_WORKFLOWS.md` step 24 previously sketched a minimal `{title, done, doneBy, doneAt, note, photos[]}` — superseded by this addendum, which is additive to the frozen `ChecklistInstance` decision, not a reopening of it).

```
ChecklistInstance {
  _id, co,
  projectId, projectPackageId,        // ProjectPackage required for project execution; nullable only when parent is a ServiceCall
  serviceCallId,                      // nullable — alternate parent for Service-driven checklists (see BUSINESS_WORKFLOWS.md §7 rev 10)
  templateId: ObjectId → Checklist,   // legacy `Checklist` collection, REUSE'd as the template store — no new template collection
  division, subTrades[],              // inherited from ProjectPackage/template at apply-time; never mixed across MEP/HVAC
  phase,                              // e.g. "installation", "commissioning", "handover"
  status: not_started | in_progress | completed,   // rolled up from items
  progressPct,                        // see Progress calculation rule below
  appliedBy, appliedAt,
  timestamps
}

ChecklistInstanceItem {                // first-class, addressable — NOT a sub-doc (needs independent indexing for "My Work"/overdue/reporting queries, same rationale as ProjectPackage's rev 1 first-class decision)
  _id, co,
  checklistInstanceId, projectId, projectPackageId,   // projectId/projectPackageId denormalized for fast scoped queries
  sequence, title, description,
  required: Boolean,                  // required items count toward progress; optional items never do
  responsibilityType,                 // extensible enum — see "Responsibility types" below
  assignedUserId,                     // nullable — null for CLIENT-responsibility items (client has no User account)
  assignedRole, department, division, // filter/authorization hints; the permission system is the actual authority, not these alone
  plannedDate, targetDate,
  status,                             // PENDING|ASSIGNED|IN_PROGRESS|SUBMITTED|APPROVED|REJECTED|COMPLETED|WAIVED — see Status model below
  completed: Boolean,                 // derived convenience flag — true iff status ∈ {APPROVED,COMPLETED,WAIVED}; mirrors legacy v2 `done` for simple UI reads
  completedAt, completedBy,
  remark,
  evidence: [{ type: photo|document|report|signature|reading, url, uploadedBy, uploadedAt, note }],
  approvalRequestId,                  // set when item routes through first-class ApprovalRequest (see Approval rule below)
  approvedBy, approvedAt, approvalRemark,
  rejectedBy, rejectedAt, rejectedReason,
  clientName, clientSignatureUrl, clientSignedAt, clientApprovalRemark,   // CLIENT-responsibility evidence — stored on the item, no User needed
  pmSign { by: ObjectId → User, at },  // PM sign-off where the template marks it required
  waivedBy, waivedAt, waivedReason,    // explicit skip by an authorized approver — never a silent default
  timestamps
}
```

### Responsibility types (extensible — not hard-coded forever)

Seed set: `ENGINEER | CLIENT | SALES | SERVICE | PROJECT_MANAGER | TECHNICIAN`. Stored as a string validated against a `ResponsibilityType` catalog (same extensibility mechanism as `Permission` catalog rows — see `DATABASE_ARCHITECTURE.md` §Access/Audit) — a new type is a data row, never a code/enum migration. Each type maps to which designations/permissions are *eligible* to be assigned it; the mapping is enforced by the existing `requirePermission()` primitive (`API_ARCHITECTURE.md` §7), not reinvented here.

**Responsibility ≠ Assignment.** `responsibilityType` says *what kind* of party must do the work (e.g. `ENGINEER`); `assignedUserId` says *which specific user* (e.g. Vinod). A Project Manager assigns applicable work to an authorized user filtered by company, purchased division, department, project/package scope, and permissions — never a free-for-all picker.

### Status model (FINAL — replaces the rev 1–8 sketch's plain boolean)

```
PENDING → ASSIGNED → IN_PROGRESS → SUBMITTED → APPROVED           (happy path, approval required)
PENDING → ASSIGNED → IN_PROGRESS → COMPLETED                       (happy path, no approval required)
SUBMITTED → REJECTED → IN_PROGRESS → SUBMITTED → ...                (rework loop)
(any pre-terminal state) → WAIVED                                  (explicit skip by authorized approver only)
```
`done: true/false` alone is insufficient — assignment, submission, approval, and rejection need richer state than a boolean. Legacy v2/PWA boolean state (`done`) is preserved via the `completed` derived flag for backward-reading compatibility; it is never the source of truth in v3.

### Approval rule

Completion and approval are different actions. Where a template marks an item `required approval`, submission creates an `ApprovalRequest` against the item (using the existing first-class `ApprovalRule`/`ApprovalRequest`/`ApprovalStep` architecture from the Rev 4 addendum above — **never** an informal mechanism inside `Company.settings`). Approve/reject writes `approvedBy/approvedAt` or `rejectedBy/rejectedAt/rejectedReason` on the item and advances `status`.

### Progress calculation rule (FINAL)

```
ChecklistInstance.progressPct = count(items where required=true AND completed=true) / count(items where required=true)
```
Computed from required/actionable checklist items only — **never** from Finance records (Payment/Invoice/FinanceWorkItem). Example: 20 required items, 15 completed → 75%. Cached on `ChecklistInstance.progressPct`, recomputed on every item status change, surfaced to Project/ProjectPackage/Division dashboards and reports (see `DASHBOARD_ARCHITECTURE.md` rev 10 addendum).

### Reuse across modules (FINAL — one engine, many callers)

`ChecklistInstance`/`ChecklistInstanceItem` is the **common execution engine** for: Solar/MEP/HVAC project execution, Service Calls, AMC/PM jobs, commissioning, testing, handover, warranty activities, QA/safety inspections, and any other authorized operational workflow. Never build a parallel checklist engine per module — callers attach via `projectPackageId` (project execution) or `serviceCallId` (service execution); division separation (MEP ≠ HVAC) is enforced the same way as everywhere else in this document.

### Legacy compatibility (v2/PWA field mapping — read-only, never reconstructed)

| v2/PWA `Project.chk[]` field | v3 `ChecklistInstanceItem` field |
|---|---|
| `text` | `title` |
| `sign` | `responsibilityType` (inferred at migration read-time, not rewritten) |
| `done` | `completed` (derived; `status` set to `COMPLETED` on read-mapping) |
| `date` | `completedAt` |
| `plan` | `plannedDate` |
| `remark` | `remark` |
| `photos` | `evidence[]` (type='photo') |
| `appr` | `approvedBy`/`approvedAt` |
| `pmSign` | `pmSign{by,at}` |

Historical `Project.chk[]` stays read-only via the existing compat adapter (`legacyProjectPackageAdapter.js`) exactly as established in rev 1–8 — this mapping is a read-time presentation, never a write-time backfill. New checklist work always writes `ChecklistInstance`/`ChecklistInstanceItem`.

---

## Rev 11 addendum — Inventory: Reusable Tool Custody vs. Project Material Lifecycle (ADDITIVE)

**Business requirement source:** the legacy PWA conflates two fundamentally different inventory realities under one `InvItem`/`InvTransaction`/`ret` boolean model — company-owned tools and equipment that circulate by custody and are never "consumed," and project consumables that are requisitioned, issued, used up, and sometimes returned as excess or scrapped. V3 must model these as two distinct, explicit lifecycles without collapsing either into the other, and must ensure the Project Manager can only **report and request** against project material while the Inventory Manager alone **performs** the physical stock transaction after independent verification (which may differ from what the PM declared).

### `InvItem.itemType` (new field, FINAL)

```
InvItem {
  ...existing v2 fields unchanged...
  itemType: REUSABLE_TOOL_ASSET | PROJECT_MATERIAL     // rev 11 — required going forward, defaulted at migration (see Legacy compatibility below)
}
```
- `REUSABLE_TOOL_ASSET` — company-owned tools/equipment/instruments. Tracked by **custody**, never decremented as "consumed." Quantity on hand is a count of units in circulation, not a consumable stock level.
- `PROJECT_MATERIAL` — consumables. Tracked by **quantity through a lifecycle**: requirement → request → approval → issue → use → excess/return/transfer/scrap.
- An `InvItem` is one or the other, never both. A company that uses the same physical catalog row for conceptually different purposes must split it into two `InvItem` rows — this document does not invent a dual-mode item.

### ToolCustody (new, first-class, addressable)

```
ToolCustody {
  co, division,
  inventoryItemId,              // FK → InvItem (itemType=REUSABLE_TOOL_ASSET)
  assetTag, serialNumber,       // physical identification
  currentLocation,               // warehouse / site / vehicle, free-text or FK → InvLocation
  custodianUserId,                // FK → User, nullable when AVAILABLE (in warehouse, no custodian)
  projectId, projectPackageId,   // nullable — set when AT_PROJECT
  issuedAt, issuedBy,
  expectedReturnDate, actualReturnDate,
  conditionAtIssue, conditionAtReturn,   // free-text / enum (GOOD|FAIR|DAMAGED)
  status: AVAILABLE | ISSUED_TO_EMPLOYEE | AT_PROJECT | UNDER_RETURN | RETURNED | UNDER_REPAIR | DAMAGED | LOST | RETIRED,
  remark,
  createdAt, updatedAt
}
```
First-class (not an embedded sub-doc of `InvItem`) because custody history needs independent indexing for per-employee, per-project, and per-tool queries and reporting (same precedent as `ProjectPackage`/`FinanceWorkItem`/`ChecklistInstanceItem`). One current record per tool reflects live status; prior custody periods are preserved as history (never overwritten), addressable at `/api/v3/tools/:toolId/custody`.

### MaterialRequest (extended, FINAL) and MaterialReturnRequest (new, first-class — the Excess/Return Form)

```
MaterialRequest {
  ...existing v2/v3 fields unchanged (co, projectId, requestedBy, item, qty, status)...
  division,
  projectPackageId,
  requiredQty,       // what the project plan/BOQ calls for
  requestedQty,       // what the PM is asking to be issued now
  approvedQty,        // set by Inventory Manager / approver
  issuedQty,          // physically issued (may differ from approvedQty across partial issues)
  usedQty,            // reported by PM/Engineer as consumed on site
  returnedQty,        // physically returned and accepted (mirrors MaterialReturnRequest.acceptedQty, cumulative)
  scrapQty            // physically scrapped (mirrors MaterialReturnRequest.acceptedScrapQty, cumulative)
}
```
Derived, never separately stored: `remainingOnSiteQty = issuedQty − usedQty − returnedQty − scrapQty`. Must never go negative; validation blocks any report/verification that would drive it below zero without an accompanying explanation captured in `remark`.

```
MaterialReturnRequest {
  co, division,
  projectId, projectPackageId,
  materialRequestId,             // FK — links back to the originating issue
  inventoryItemId,
  declaredRemainingQty,          // PM's on-site count at time of reporting
  declaredReturnQty,              // PM's requested return quantity
  declaredScrapQty,               // PM's declared unusable/scrap quantity
  reason,                          // over-ordered | project-closed | wrong-item | damaged | other
  requestedBy, requestedAt,
  verifiedBy, verifiedAt,          // Inventory Manager — physical verification
  verifiedReturnQty,               // Inventory Manager's actual count — MAY DIFFER from declaredReturnQty
  verifiedScrapQty,                // Inventory Manager's actual count — MAY DIFFER from declaredScrapQty
  acceptedQty,                     // usable stock actually taken back into inventory
  acceptedScrapQty,                // scrapped/written-off quantity actually recorded
  rejectedQty,                     // declared but not accepted (discrepancy — remains PM's/project's responsibility, remark required)
  returnLocation,                  // FK → InvLocation — where it was physically received back
  verificationRemark,
  status: DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | PARTIALLY_ACCEPTED | REJECTED | RETURNED | CLOSED,
  createdAt, updatedAt
}
```
First-class (not embedded in `MaterialRequest`) — same rationale as `ToolCustody`: independent indexing for Inventory Manager's verification queue, project-wise material-cost reporting, and audit. Addressable at `/api/v3/material-returns/:id`.

**The verification split is FINAL:** `declared*` fields are the PM's report only and never move stock by themselves. `verified*`/`accepted*` fields, written only by the Inventory Manager (or authorized store keeper) after physical check, are what actually posts `InvTransaction` entries. A declared return of 50 units that the Inventory Manager physically finds to be 40 usable + 10 scrap is recorded exactly that way — `acceptedQty=40`, `acceptedScrapQty=10` — the discrepancy is never silently reconciled to match the PM's number.

### StockTransfer (new, first-class — auditable inter-project transfer)

```
StockTransfer {
  co, division,
  inventoryItemId,
  sourceProjectId, sourceProjectPackageId,
  destinationProjectId, destinationProjectPackageId,
  quantity,
  reason,
  requestedBy, requestedAt,        // typically a PM (source or destination project)
  approvedBy, approvedAt,           // Inventory Manager (or division manager per ACCESS_MATRIX §13.3)
  verifiedBy, verifiedAt,           // physical handoff verification
  status: DRAFT | REQUESTED | APPROVED | IN_TRANSIT | RECEIVED | REJECTED | CANCELLED,
  createdAt, updatedAt
}
```
First-class, addressable at `/api/v3/stock-transfers/:id`. Only division-safe transfers are permitted — a transfer request whose source and destination projects span divisions is rejected by validation (mirrors the MEP≠HVAC separation invariant); a `PROJECT_MATERIAL`-typed item never transfers into a `REUSABLE_TOOL_ASSET` flow or vice versa.

### `InvTransaction.type` — extended enum (FINAL, 12 values)

```
RECEIPT_GRN | ISSUE_TO_PROJECT | ISSUE_TO_EMPLOYEE | USAGE_REPORTED | RETURN_TO_STOCK |
SCRAP | TRANSFER_OUT | TRANSFER_IN | TOOL_ISSUE | TOOL_RETURN | ADJUSTMENT | STOCK_TAKE
```
Every value maps to exactly one physical stock movement or custody change, each posted only by the Inventory Manager's verified action (`MaterialReturnRequest` approval, `StockTransfer` verification, `ToolCustody` issue/return) or the existing GRN/issue flow — never by a PM's declaration alone. Existing v2 `InvTransaction` shape (co, item, qty, date, ref) is unchanged; only `type`'s allowed values grow.

### Rules (FINAL, additive — do not reopen)

- **Custody ≠ Consumption.** `REUSABLE_TOOL_ASSET` quantity is never decremented by "use" — a tool is issued, used, and returned; it is not consumed. Only `PROJECT_MATERIAL` has a consumption lifecycle.
- **PM reports/requests; PM does not alter stock.** A Project Manager may: report material usage, declare on-site remaining/excess/scrap quantities, submit a `MaterialReturnRequest`, request a `StockTransfer`, report a tool's condition/location. A Project Manager may **never**: post an `InvTransaction`, change `InvItem` stock levels, unilaterally mark a `MaterialReturnRequest` or `StockTransfer` as verified/accepted, or change `ToolCustody.status` without the Inventory Manager's counter-action.
- **Only the Inventory Manager (or explicitly permissioned store keeper) performs the physical stock transaction**, and only after physical verification — which may legitimately differ from the PM's declared quantities. The system records both the declared and verified/accepted figures; it never overwrites one with the other.
- **Every return/transfer/custody change is audited** via the existing `AuditLog` mechanism — no new parallel audit path.
- **Division safety extends to inventory.** `StockTransfer` and `MaterialRequest`/`MaterialReturnRequest` inherit the same division-scoping (`scopeFilterV3`, `API_ARCHITECTURE.md` §7) as every other v3 collection; MEP inventory never merges with HVAC inventory.
- **No parallel approval mechanism.** Where `MaterialReturnRequest`/`StockTransfer` require sign-off beyond the Inventory Manager's own verification (per `ACCESS_MATRIX.md` §13.3 thresholds), it routes through the existing `ApprovalRule`/`ApprovalRequest`/`ApprovalStep` architecture — never an informal `Company.settings` flag.
- **Reporting (four-part, FINAL):** (1) Reusable Assets report — current custody/location per tool, overdue returns; (2) Project Material report — requirement vs. issued vs. used vs. returned vs. scrap per project/package; (3) Project-wise Material Cost report — valued consumption per project, sourced from `usedQty` × item cost, never from `requestedQty`; (4) Employee Custody report — tools currently held per employee, issue/expected-return dates. All four are read-side aggregations over the collections above; none introduces a new source of truth.

### Legacy compatibility (v2/PWA field mapping — read-only, never reconstructed)

| v2/PWA field | v3 rev 11 mapping |
|---|---|
| `InvItem` with no prior type distinction | `itemType` backfilled per company/category rule at migration time (e.g. category "Tools & Equipment" → `REUSABLE_TOOL_ASSET`, all else → `PROJECT_MATERIAL`); ambiguous rows get `itemType=null` + `migrationReviewRequired=true` — **never guessed silently** |
| `ret: true` | Historically meant "returned" with no distinction between usable-return and scrap, and no distinction between tool-return and material-return. Read-mapped to `MaterialReturnRequest.status=RETURNED` (acceptedQty = full historical qty, acceptedScrapQty=0) **only** when the underlying `InvItem.itemType` resolves to `PROJECT_MATERIAL`; when it resolves to `REUSABLE_TOOL_ASSET`, read-mapped instead to a `ToolCustody` record with `status=RETURNED` |
| `ret: false` | No return recorded — item remains in its last known issued state; migration does **not** infer `remainingOnSiteQty` retroactively beyond what issue/use records already show |
| issue/used/returned-qty fields on legacy `Project`/`InvTransaction` records | Read-mapped into `MaterialRequest.issuedQty`/`usedQty`/`returnedQty` for display; **never** rewritten in place — new project-material activity always writes through the rev 11 `MaterialRequest`/`MaterialReturnRequest` flow |
| project/site field on legacy inventory records | Mapped to `projectId`/`projectPackageId` where resolvable; unresolvable references get `migrationReviewRequired=true`, never a fabricated project link |
| legacy status strings on inventory records | Mapped to the nearest rev 11 status value for read-time display only; the legacy string itself is preserved unaltered in the source v2 collection (untouched, per `LIVE_APP_SAFETY.md`) |

Exactly as with the rev 10 `chk[]` mapping table, this mapping is a **read-time presentation via the existing compat adapter layer**, never a write-time backfill and never a source of fabricated historical relationships — where the mapping is ambiguous, the rule is `null` + `migrationReviewRequired=true`, not a guess.

---

## Rev 12 addendum — Global Record Ownership, Edit & Delete Control (ADDITIVE, PLATFORM-WIDE)

**Business requirement source:** V3 must enforce creator-based record ownership consistently across every module — Sales, Finance/Accounts, Admin, Inventory, Solar/MEP/HVAC PM, Service, Engineer/Technician, and any future module — as a single reusable authorization layer, never a per-module reimplementation. Role permission and record ownership are two separate checks that must both pass.

### Mandatory ownership metadata (FINAL — every v3 collection)

```
{
  co,                        // companyId — existing convention, unchanged
  createdByUserId,           // FK → User — the authoritative owner, never createdByName
  createdByName,             // display only — NEVER used for authorization
  createdAt,
  updatedByUserId,           // FK → User — most recent writer
  updatedAt,
  status,                    // existing per-collection status enum — governs edit/delete eligibility
  deletedAt, deletedByUserId, deletionReason   // soft-delete triad — required wherever delete is permitted
}
```
This block is additive to every existing and future v3 collection (`ChecklistInstanceItem`, `FinanceWorkItem`, `MaterialReturnRequest`, `ToolCustody`, `StockTransfer`, `Quotation`, `Task`, `DailyReport`, etc.) and to v2 collections gaining v3-side fields — optional/defaulted so legacy code paths are unaffected. `createdByUserId` is the single source of truth for ownership; `createdByName` is a cached display value only and must never appear in an authorization check.

### RecordCorrection (new, first-class — the only sanctioned override path)

```
RecordCorrection {
  co,
  originalRecordId, originalCollection, originalCreatedByUserId,
  overrideByUserId, overrideAt,
  reason,
  oldValue, newValue,          // field-level before/after snapshot
  createdAt
}
```
First-class (not embedded) — same rationale as `AuditLog`: independent indexing for per-record correction history and audit queries, addressable at `/api/v3/record-corrections/:id`. A Manager/Admin correction to another user's record is **never** a silent field write; it is always mediated through `RecordCorrection`, which the standard `AuditLog` mechanism also captures as an `OVERRIDE`/`CORRECT` action (§Access/Audit — no new parallel audit path).

### Rules (FINAL, additive — do not reopen)

- **Ownership ≠ Role ≠ Permission.** Three independent checks, all must pass: `authenticatedUser.id === record.createdByUserId` (ownership) OR explicit override authority; `requirePermission(code)` (role-based grant); and company/division/department/project/package scope (`scopeFilterV3`). None substitutes for another.
- **Default edit/delete is creator-only.** Same department/role/division/company membership never grants edit/delete on another user's record by itself.
- **State governs eligibility.** DRAFT → creator may edit/delete freely (within permission). SUBMITTED → edit only where workflow explicitly permits; delete restricted. APPROVED/POSTED/FINALIZED → locked; correction/reversal only, never a normal edit/delete.
- **No hard delete of business history.** Where delete is permitted at all, it is the existing soft-delete triad (`deletedAt/deletedByUserId/deletionReason`, per `LIVE_APP_SAFETY.md`) — never a destructive remove.
- **Manager/Admin override is controlled, never silent.** A correction to another user's record always creates a `RecordCorrection` row with `oldValue`/`newValue`/`reason`; the original record's ownership metadata (`createdByUserId`) is never rewritten to the overriding user.
- **Ownership never bypasses business authorization.** Owning a record does not grant the underlying business action if that action belongs to another role — a PM owns a `MaterialRequest` but cannot alter stock (unchanged rev 11 rule); a Sales Executive owns a Quotation but cannot self-approve where approval is required (unchanged Rev 4 approval-threshold rule); an Engineer owns a checklist completion but cannot edit Payment (unchanged rev 9 rule). Rev 12 formalizes ownership as a *second, additional* gate — it never loosens any existing rev's restriction.
- **Cross-module protection is absolute.** Ownership of a record in one module never grants write access to another module's collection — Sales ownership never reaches Finance records, Inventory ownership never reaches Sales Orders, and so on; cross-module actions go through the existing approved workflow/API boundary (Raise to Finance, MaterialReturnRequest verification, etc.) exactly as established in rev 9–11.
- **Legacy/migrated records never get invented ownership.** Where v2 data has no reliable creator, the record is marked legacy/unresolved (`migrationReviewRequired=true`) — never auto-assigned to the current Company Admin or any other user.
- **Server-side enforcement only.** UI button visibility is not a security mechanism; every Edit/Delete/Correction API independently validates ownership + permission + scope + state, returning `403` on failure regardless of what the UI renders.

### Legacy compatibility (v2/PWA — read-only, never reconstructed)

| v2/PWA gap | v3 rev 12 handling |
|---|---|
| No `createdByUserId` on most legacy collections | Backfilled where a reliable creator field exists (e.g. `Project.createdBy`, `Enquiry.assignedTo` at creation); unresolvable rows get `createdByUserId=null` + `migrationReviewRequired=true` — never guessed |
| No ownership enforcement in v2 (any authenticated user could edit most records) | v3 enforcement is additive and forward-only — it governs new v3-side edits; it does not retroactively restrict already-completed v2 history |
| No `RecordCorrection` equivalent | Historical manager corrections in v2 (if any) are not reconstructed into `RecordCorrection` rows — rev 12 governs corrections made from this point forward only |

This mapping follows the same discipline as the rev 10 `chk[]` and rev 11 `ret` tables: read-time presentation via the existing compat adapter layer, `null` + `migrationReviewRequired=true` wherever ambiguous, never a fabricated historical relationship.
