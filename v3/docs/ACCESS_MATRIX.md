# V3 AUTHORIZATION SPECIFICATION
**STATUS: FINAL — ARCHITECTURE FROZEN**
**CODE STATUS: NOT YET IMPLEMENTED**

---

> **📝 rev 9 addition — 2026-09-10.** Additive only, does not reopen the freeze. Added §13 CROSS-FUNCTIONAL WORKFLOW GUARDRAILS (Raise to Finance / PWA-compat requirement) and updated §4/§10/§11. See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Split §13 into §13.1 (Finance, unchanged) and new §13.2 (Checklist execution-engine guardrails); updated §4/§9/§10/§11/§12A/§12B for checklist responsibility types. See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Added new §13.3 (Inventory guardrails — reusable tool custody vs. project material); updated §4/§8/§10/§11 for material request/usage/excess-return/transfer/custody CAN/CANNOT lists. PM reports/requests only; Inventory Manager alone performs the physical stock transaction. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added new §13.4 (Global Record Ownership, Edit & Delete Control — platform-wide, every role/module in §1–§12). Creator-only edit/delete by default; Manager/Admin override only via controlled `RecordCorrection`; ownership and permission independently required. See `CHANGELOG.md` rev 12.

---

> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.

---

# MEP PROJECTS — Target Access Matrix (rev 3 FINAL)

**Generated:** 2026-08-28 (rev 3 FINAL)
**Revisions incorporated:**
1. Separate Plan / Subscription / DivisionEntitlement / FeatureEntitlement collections
2. Optional paid Add-Ons catalog
3. Destructive-action hardening (⛔ marker, MFA, second approver, cascade block)
4. Formalized per-company approval threshold matrix
5. WebSocket security (multi-room, payload filtering, no writes via socket)
6. Project/Package architecture (single-div compat + multi-div packages)
7. Live legacy-company migration (6 stages, zero-downtime, one-command rollback)

**⚠️ Planning only — Zero code changes.**

**Legend:** ✅ granted · ⚠️ conditional (own/dept/division scope) · 🔒 requires approval · ⛔ destructive (MFA + reason + optional 2-of-2) · ❌ denied

---

## PART 0 — Concept Separation (NEW)

Five distinct collections, independent lifecycles:

```
Plan            → catalog template of what CAN be sold
Subscription    → links a Company to a Plan for a time window
DivisionEntitlement → which of Plan.availableDivisions the company actually purchased (subset, toggleable)
FeatureEntitlement  → per-feature toggle/limit (overrides Plan defaults; supports add-ons)
AddOn (NEW)     → optional paid extras (portals, AI, extra users, extra division)
```

### Plan — versioned catalog, super-admin editable
```
Plan {
  code (unique, e.g. 'SOLAR_STARTER', 'FULL_ENTERPRISE'),
  name, description, version,
  price, currency, billingCycle (monthly/yearly/one-time),
  availableDivisions [SOLAR,MEP,HVAC],
  includedModules [String],
  defaultFeatures { code: Bool|Number },
  availableAddOns [addOnCode],
  limits { users, projects, storageGB, apiCallsPerHour },
  trialDays,
  status draft|active|deprecated
}
```

### Subscription — per-company runtime
```
Subscription {
  co (indexed, one active per company),
  plan (FK),
  planSnapshot {frozen plan fields — immune to future edits},
  startDate, endDate, trialEndsAt,
  status trial|active|suspended|expired|cancelled|pending_renewal,
  billingStatus paid|pending|overdue|failed,
  autoRenew,
  purchasedDivisions [enum]  ← authoritative for this subscription,
  addOns [{ code, startDate, endDate, price }],
  contract { number, signedAt, signedBy },
  createdBy (super), log[]
}
```

### DivisionEntitlement — fine-grained on/off per division
```
DivisionEntitlement {
  co, division,
  enabled,
  source 'plan'|'addon'|'manual',
  startDate, endDate (optional),
  historicalData (true = keep data readable after disable),
  reason (for disable audit),
  addedBy, disabledBy, disabledAt
}
```
Downgrade never deletes data — sets enabled=false, historicalData=true.

### FeatureEntitlement — add-on / override layer
```
FeatureEntitlement {
  co, code (e.g. 'reports.export.pdf','client_portal','ai_estimator'),
  enabled, limit (optional),
  source 'plan'|'addon'|'manual',
  addOnCode (if source=addon),
  startDate, endDate
}
```

### AddOn (NEW) — optional paid feature catalog
```
AddOn {
  code, name, description, category,
  price, billingCycle,
  featuresGranted { code: true|limit },
  divisionsGranted [enum]  (for division add-ons),
  compatiblePlans [planCode],
  status active|deprecated
}
```

**Add-on examples:**
- `DIVISION_SOLAR`, `DIVISION_MEP`, `DIVISION_HVAC` — enable one division on top of an existing plan
- `CLIENT_PORTAL` — customer self-service module
- `VENDOR_PORTAL` — vendor login for POs/RFQs
- `AI_ESTIMATOR` — AI-powered BOQ generation
- `ADVANCED_BI` — extended analytics + custom dashboards
- `MOBILE_APP` — native mobile access
- `CUSTOM_BRANDING` — white-label
- `EXTRA_USERS_PACK_10` — +10 users cap
- `STORAGE_100GB` — +100 GB
- `API_ACCESS` — external API + webhooks
- `MULTI_LOCATION` — multi-warehouse inventory
- `PAYROLL_INTEGRATION` — HRMS/payroll sync

### Effective entitlement (denormalized to Company.entitlements)

```
divisions = Subscription.purchasedDivisions
          + all active DivisionEntitlement (enabled=true)
          + all divisionsGranted from active addOns
modules   = Subscription.planSnapshot.includedModules
          + all module keys from active addOn.featuresGranted
features  = Subscription.planSnapshot.defaultFeatures
          overridden by active FeatureEntitlement
          overridden by active addOn.featuresGranted
limits    = Subscription.planSnapshot.limits
          + summed limits from addOns (users, storage, api)
```

Cached in `Company.entitlements` for hot-path reads; recomputed on any Subscription/DivisionEntitlement/FeatureEntitlement/AddOn change.

---

## PART 1 — Per-Role Permission Matrix (12 roles) with HARDENED destructive column

### Destructive-action policy (NEW — HARDENED)

All DELETE and irreversible operations are treated as destructive:

- **Soft delete only** — record → trash bin with deleted=true, deletedBy, deletedAt, deletionReason
- **Restore window** — 30 days default, 90 days Financial (invoice/payment), 180 days Contracts/Projects
- **Hard delete** — Super Admin ops tool only, after retention + written request
- **⛔ marker means requires ALL:**
  1. Fresh reauthentication (password OR MFA in last 5 min)
  2. Deletion reason (min 20 chars)
  3. Second approver for records with linked children (2-of-2 quorum)
  4. AuditLog entry with full before-snapshot
- **Cascade blocked** — cannot delete parent that has active children (delete children first)

### Column headers
VIEW · CREATE · EDIT · SUBMIT · APPROVE · REJECT · DELETE · ASSIGN · CLOSE · EXPORT

### 1. SUPER ADMIN
Scope: ALL companies, ALL divisions (platform). Sidebar: 8 items. Modules: Platform-only.

| Resource | V | C | E | S | A | R | D | Asn | Cl | Ex |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Companies | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | ✅ | ✅ |
| Plans | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | — | ✅ |
| Subscriptions | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ |
| DivisionEntitlement | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | — | ✅ |
| FeatureEntitlement | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | — | ✅ |
| AddOns | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | — | ✅ |
| Platform Users | ✅ | ✅ | ✅ | — | — | — | ⛔ | — | — | ✅ |
| AuditLog | ✅ | — | — | — | — | — | ❌ (immutable) | — | — | ✅ |
| Company business data | ⚠️ read for support | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### 2. COMPANY ADMIN / MANAGER
Scope: own company, all purchased divisions. Dashboard: Business. Sidebar: 15 items.

| Resource | V | C | E | S | A | R | D | Asn | Cl | Ex |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Customer | ✅ | ✅ | ✅ | — | — | — | ⛔ | ✅ | — | ✅ |
| Enquiry | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ |
| Quotation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ |
| SalesOrder | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ |
| Project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ cascade-blocked | ✅ | ✅ | ✅ |
| Task | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ |
| MaterialRequest | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | — | — | ✅ |
| PurchaseOrder | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | — | ✅ | ✅ |
| Invoice | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ (never — credit note) | — | ✅ | ✅ |
| Payment | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⛔ (never — reverse-entry) | — | ✅ | ✅ |
| ServiceCall | ✅ | ✅ | ✅ | — | ✅ | — | ⛔ | ✅ | ✅ | ✅ |
| Contract (AMC) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ⛔ | ✅ | ✅ | ✅ |
| InvItem | ✅ | ✅ | ✅ | — | — | — | ⛔ if txn history → archive only | — | — | ✅ |
| Users (own co) | ✅ | ✅ | ✅ | — | — | — | ⛔ deactivate preferred | ✅ | — | ✅ |
| Company Settings | ✅ | — | ✅ | — | — | — | ❌ | — | — | ✅ |
| AuditLog (own co) | ✅ | — | — | — | — | — | ❌ | — | — | ✅ |

### 3. SALES MANAGER
Scope: own co, all divisions purchased (sees cross-div sales data). Dashboard: Sales. Sidebar: 7 items.

| Resource | V | C | E | S | A | R | D | Asn | Cl | Ex |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Customer | ✅ | ✅ | ✅ | — | — | — | ⛔ admin | ✅ | — | ✅ |
| Enquiry | ✅ | ✅ | ✅ | ✅ | 🔒 threshold | 🔒 threshold | ⛔ admin | ✅ | ✅ | ✅ |
| Quotation | ✅ | ✅ | ✅ | ✅ | 🔒 threshold | 🔒 threshold | ⛔ admin | ✅ | ✅ | ✅ |
| CustomerPO | ✅ | ✅ | ✅ | — | — | — | ⛔ admin | — | — | ✅ |
| SalesOrder | ✅ | ✅ | ✅ | ✅ | 🔒 threshold | 🔒 threshold | ⛔ admin | — | ✅ | ✅ |
| Sales Reports | ✅ | — | — | — | — | — | — | — | — | ✅ |
| Users | ⚠️ read Sales team | ❌ | ❌ | — | — | — | ❌ | ❌ | — | ❌ |

### 4. PROJECT MANAGER (cross-division)
Scope: own co, ALL purchased divisions. Dashboard: ProjectControl. Sidebar: 8 items.

Key permissions:
- Project ⛔ admin only
- Task/DailyReport/Checklist/RFI/ChangeOrder — full CRUD with 🔒 approvals on high-cost
- Budget ⚠️ own project only; 🔒 admin for approve
- **Raise to Finance** (rev 9) ✅ own project's eligible payment milestones only — creates `FinanceWorkItem`; ❌ Payment write access itself (see §13.1)
- **Checklist execution engine** (rev 10) ✅ create/select template, apply to ProjectPackage, add/edit allowed items, assign items to authorized users (filtered by company+division+department+project scope+permissions), set planned dates, monitor progress/overdue, reassign with permission, review evidence, approve where permitted, add PM sign, close package/project per approval rules — see §13.2
- **Inventory (rev 11) — CAN:** submit `MaterialRequest` for own project; report material usage; declare on-site remaining/excess/scrap quantities via `MaterialReturnRequest`; request `StockTransfer` to/from own project; report tool condition/location on `ToolCustody` records assigned to own project — see §13.3
- **Inventory (rev 11) — CANNOT:** post any `InvTransaction`; alter `InvItem` stock levels directly; verify/accept their own or another PM's `MaterialReturnRequest`/`StockTransfer`; change `ToolCustody.status`; approve a cross-division transfer (see §13.3)

### 5. SOLAR MANAGER
Scope: own co, **SOLAR only**. Dashboard: Solar. Sidebar: 8 items.

Solar-tagged resources: Project (Solar package), BOQ, Site Survey, Installation, DC/AC Testing, Commissioning, Handover, Warranty, Enquiry/Quotation/SO — full CRUD scoped to Solar.
❌ on HVAC/MEP data. ❌ on Users.
Material access: Solar-tagged + COMMON only.

### 6. MEP MANAGER
Same shape as Solar Manager, scoped to **MEP only** with sub-trades (Electrical, Plumbing, Fire, Other). ❌ on Solar/HVAC.

### 7. HVAC MANAGER
Same shape as Solar Manager, scoped to **HVAC only** with sub-trades (VRF, Ducted, Split, Piping, Pressure/Vacuum/Leak Testing, Commissioning). Sidebar has extra **HVAC Service** item. ❌ on Solar/MEP.

### 8. INVENTORY MANAGER
Scope: own co, all purchased divisions. Dashboard: Inventory. Sidebar: 9 items.

- InvItem ⛔ blocked if InvTransaction references it → archive-only
- GRN ⛔ NEVER (financial trail)
- PurchaseOrder ⛔ admin
- MaterialRequest APPROVE/REJECT ✅
- Vendor CRUD ✅
- **Inventory (rev 11) — CAN:** verify and accept/reject `MaterialReturnRequest` declared quantities (may differ from PM's declared figures); post `InvTransaction` (all 12 types); issue/return `ToolCustody` to employees/projects; approve and verify `StockTransfer` receipt; manage `InvItem.itemType` classification — see §13.3
- **Inventory (rev 11) — CANNOT:** approve a `StockTransfer` that crosses divisions (MEP↔HVAC); silently overwrite a PM's declared figures instead of recording the verified split; skip physical verification before posting a stock-affecting `InvTransaction`

### 9. SERVICE MANAGER
Scope: own co, all purchased divisions. Dashboard: Service. Sidebar: 9 items.

- ServiceCall closed >30d → EDIT locks, DELETE requires Company Admin approval
- Contract ⛔ admin
- Asset CRUD ✅
- Warranty CRUD ✅
- Renewal SUBMIT + 🔒 admin/sales approve
- **Checklist (rev 10):** applies checklist templates to ServiceCall (same engine as ProjectPackage, `serviceCallId` parent — see `DATABASE_ARCHITECTURE.md` rev 10); assigns SERVICE-responsibility items to Service Engineers; reviews/approves their submissions

### 10. ENGINEER / TECHNICIAN
Scope: own co, **own department only** (HVAC/SOLAR/MEP/SERVICE). Dashboard: Field (mobile-first). Sidebar: 9 items.

- Everything ⚠️ own-only
- DailyReport: EDIT locks after 24h, ⛔ never deletable (supervisor must reverse)
- MaterialRequest: own only, cancellable pre-approval only
- Site logs: ⚠️ own
- ChecklistInstance completion ❌ NEVER creates or edits Payment/Invoice/FinanceWorkItem (rev 9 — see §13.1); may only flip a milestone to `eligible` informationally
- **Checklist execution (rev 10) — CAN:** view assigned checklist work (own `responsibilityType` items only); execute assigned work; add evidence (photos/documents/readings); add remarks; submit/complete according to permissions
- **Checklist execution (rev 10) — CANNOT:** edit unrelated checklist items; access unrelated projects; access another company's data; create/edit Payment; create/edit Invoice; create FinanceWorkItem directly; bypass approval (see §13.2)
- **Inventory (rev 11) — CAN:** view materials assigned to own project; report usage against issued quantities; report tool condition/location while in custody; request a tool return — see §13.3
- **Inventory (rev 11) — CANNOT:** alter stock levels; verify/accept a `MaterialReturnRequest`; approve a `StockTransfer`; change `ToolCustody.status` themselves (Inventory Manager action only)
- ❌ on any cross-user data

### 11. ACCOUNTS / FINANCE
Scope: own co, all purchased divisions. Sidebar: Dashboard, Finance, Invoices, Payments, Reports, Notifications, Profile.

- Invoice ⛔ NEVER — credit note only
- Payment ⛔ NEVER — reverse-entry only
- ⚠️ read on SO/PO/GRN for reconciliation
- **FinanceWorkItem** (rev 9) ✅ VIEW/CLAIM/RESOLVE — receives items raised by PMs; Payment CREATE/EDIT ✅ against the claimed milestone (existing Payment rule, unchanged)
- ❌ on operational modules — never Checklist, Task, DailyReport, or ProjectPackage assignment (see §13.1)
- **Checklist execution (rev 10) — CAN:** receive FinanceWorkItem; view related commercial/project context as authorized; claim/resolve FinanceWorkItem; record financial transactions per permissions
- **Checklist execution (rev 10) — CANNOT:** perform operational checklist tasks; assign engineers; alter project execution; own ChecklistInstance; own ProjectPackage execution (see §13.2)
- **Inventory (rev 11) — CAN:** read-only view of Project-wise Material Cost report for reconciliation, where permissioned — see §13.3
- **Inventory (rev 11) — CANNOT:** submit/verify a `MaterialReturnRequest` or `StockTransfer`; post `InvTransaction`; own or approve any operational inventory action

### 12. VIEWER
Scope: own co, division-configurable. Sidebar: Dashboard, Reports, Notifications, Profile.
Read + Export only. ❌ on everything else.

### 13. CROSS-FUNCTIONAL WORKFLOW GUARDRAILS

#### 13.1 Finance guardrails (rev 9 — PWA-compat requirement)

Preserves the proven Project ↔ Checklist ↔ Payment Milestone ↔ Finance relationship (full narrative in `BUSINESS_WORKFLOWS.md` rev 9 addendum; model in `DATABASE_ARCHITECTURE.md` rev 9 addendum). These rules apply on top of, and never override, the role-by-role grants in §1–§12.

| Actor | May do | May NOT do |
|---|---|---|
| Engineer / Technician | Execute assigned ChecklistInstance work; own DailyReport/Task | Create/edit Payment, Invoice, or FinanceWorkItem; own no financial responsibility |
| Project Manager | Own Project/ProjectPackage/Checklist/Timeline; **Raise to Finance** on own project's eligible payment milestones (creates `FinanceWorkItem`) | Record or edit a Payment; approve/resolve their own FinanceWorkItem |
| Accounts / Finance | Claim + resolve FinanceWorkItem; record/reconcile Payment against the referenced SalesOrder/milestone | Own Project execution, ProjectPackage assignment, Checklist templates/instances, or engineer assignment |

**Forbidden relationships (never implement):** Accounts → Checklist ownership · Checklist → Payment direct accounting write · Engineer → Payment responsibility · Checklist completion → automatic payment receipt · Accounts acting as an operational Project Manager.

**Invariant:** Checklist completion is an operational-progress signal only. It may make a payment milestone *eligible*; it never creates a financial record. The only path from operations to finance is the explicit **Raise to Finance** action, and the only path back is Accounts' own Payment workflow.

#### 13.2 Checklist execution-engine guardrails (rev 10)

Checklist's primary purpose is project execution — task, assignment, responsibility, evidence, approval, progress tracking. Finance (§13.1) is one optional downstream consequence, never the owner. Full model in `DATABASE_ARCHITECTURE.md` rev 10 addendum; workflow narrative in `BUSINESS_WORKFLOWS.md` rev 10 addendum.

| Actor | May do | May NOT do |
|---|---|---|
| Engineer / Technician / Service | View + execute own assigned `responsibilityType` items; add evidence/remarks; submit per permissions | Edit unrelated items; access unrelated projects/companies; create/edit Payment/Invoice/FinanceWorkItem; bypass approval |
| Sales (Manager/Executive) | Complete own assigned `SALES`-responsibility items within authorized handover scope | Perform ENGINEER/CLIENT/SERVICE items; approve items outside their own scope |
| Client (`responsibilityType=CLIENT`, no User account) | Provide name/signature/date/remark/evidence on the specific item requiring client sign-off | Anything else — CLIENT items carry evidence only, never system access |
| Project Manager | Create/apply templates; assign items (scoped by company+division+department+project+permissions); monitor/reassign/approve/PM-sign per §4 | Bypass division separation (MEP≠HVAC); assign outside purchased-division/entitlement scope |
| Accounts / Finance | Everything in §13.1 | Perform operational checklist tasks; assign engineers; alter project execution; own ChecklistInstance/ProjectPackage execution |

**Responsibility ≠ Assignment ≠ Approval** — three distinct decisions, never collapsed into one: `responsibilityType` (what kind of party), `assignedUserId` (which specific authorized user), and approval (a separate authorized approver via first-class ApprovalRequest — never the assignee self-approving where approval is required).

**Extensibility rule:** new `responsibilityType` values are `Permission`-catalog data rows, never a hard-coded enum requiring a migration (see `DATABASE_ARCHITECTURE.md` rev 10).

#### 13.3 Inventory guardrails (rev 11 — reusable tool custody vs. project material)

Reusable tools/equipment (custody-tracked, never "consumed") and project consumables (requirement→issue→use→excess→return/transfer/scrap) are two distinct lifecycles (`InvItem.itemType`). Full model in `DATABASE_ARCHITECTURE.md` rev 11 addendum; workflow narrative in `BUSINESS_WORKFLOWS.md` rev 11 addendum. These rules apply on top of, and never override, the role-by-role grants in §1–§12.

| Actor | May do | May NOT do |
|---|---|---|
| Project Manager | Submit `MaterialRequest`; report usage; declare excess/return/scrap quantities via `MaterialReturnRequest`; request `StockTransfer`; report tool condition/location | Post any `InvTransaction`; alter `InvItem` stock levels; verify/accept their own declared return/transfer; change `ToolCustody.status` |
| Engineer / Technician | Report usage against issued materials; report tool condition/location while in custody; request tool return | Alter stock; verify/accept a return or transfer; act as Inventory Manager for any request |
| Inventory Manager | Verify and accept/reject declared quantities (physical count governs, not the PM's declaration); post all 12 `InvTransaction` types; issue/return `ToolCustody`; approve + verify `StockTransfer`; classify/reclassify `InvItem.itemType` | Approve a cross-division `StockTransfer`; silently overwrite a PM's declared figures instead of recording the verified split; skip physical verification |
| Accounts / Finance | Read-only view of Project-wise Material Cost report, where permissioned (for reconciliation) | Submit, verify, or approve any `MaterialRequest`/`MaterialReturnRequest`/`StockTransfer`/`ToolCustody` action; post `InvTransaction` |

**Forbidden relationships (never implement):** PM's declared quantity directly posting a stock transaction · `REUSABLE_TOOL_ASSET` items being decremented as "used" · a `StockTransfer` or `MaterialReturnRequest` crossing MEP↔HVAC · any non-Inventory-Manager role posting `InvTransaction` · an informal excess-return mechanism inside `Company.settings` instead of the first-class `MaterialReturnRequest`/`StockTransfer` collections.

**Invariant:** Custody ≠ Consumption, and PM declaration ≠ verified stock transaction. The only path from a PM's report/request to an actual stock movement is the Inventory Manager's physical verification and posting — mirroring the rev 9 "Raise to Finance" bridge pattern (a request-side action distinct from the record-side action).

#### 13.4 Global Record Ownership, Edit & Delete Control (rev 12 — platform-wide, every role/module in §1–§12)

Every user-created record across every module carries `createdByUserId` as its authoritative owner. Edit/Delete authorization evaluates **ownership AND permission AND scope AND record state together** — never any one of these alone. Full model in `DATABASE_ARCHITECTURE.md` rev 12 addendum; middleware in `API_ARCHITECTURE.md` §1/§7 `requireOwnership()`. These rules apply on top of, and never override, the role-by-role grants in §1–§12 and the module-specific guardrails in §13.1–§13.3 — they add a second, independent gate, they do not loosen any existing one.

| Actor | May do | May NOT do |
|---|---|---|
| Record creator (any role, any module) | Edit/delete their own record while its `status` permits (DRAFT freely; SUBMITTED per workflow; APPROVED/POSTED/FINALIZED never) | Edit/delete another user's record merely by sharing department/role/division/company; perform the record's underlying business action if that action belongs to another role's permission (e.g. own a Quotation but not self-approve it, own a MaterialRequest but not alter stock — unchanged from earlier revs) |
| Other user, same role/department/division | View per normal permission; Approve/Reject/Assign only if that specific permission exists | Edit or delete another user's record by default, with no explicit override |
| Manager / Admin | View/Approve/Reject per permission; issue a controlled correction via `RecordCorrection` (creates an audited before/after row, `originalCreatedByUserId` preserved) | Silently modify another employee's original record; treat their job title as automatic edit authority; make Manager/Admin editing equivalent to creator ownership |
| Cross-module actor (e.g. Sales into Finance, Inventory into Sales Orders, Engineer into Payment) | Interact only through the approved workflow/API boundary of the owning module (Raise to Finance, MaterialReturnRequest verification, etc. — unchanged from rev 9–11) | Directly edit another module's records regardless of the requester's ownership standing in their own module |

**Forbidden relationships (never implement):** edit/delete authorized on role/department/division/company membership alone · Manager/Admin editing treated as equivalent to creator ownership · a silent field-level overwrite of another user's record outside `RecordCorrection` · `createdByName` used anywhere in an authorization decision · hard-delete of business history · invented `createdByUserId` on migrated records with no reliable legacy creator · a UI-only edit/delete restriction with no server-side `requireOwnership()` check.

**Invariant:** Ownership answers *who may touch this record*; permission answers *what action is this role allowed to perform*; scope answers *is this record even in the requester's company/division/project/package*; state answers *is the record still in an editable/deletable condition*. All four must independently allow the action — this is the platform-wide, module-agnostic layer referenced by every role section above and by §13.1–§13.3, implemented once and reused everywhere, never rebuilt per module.

**Required acceptance tests (rev 12 — minimum, mirrors the user's spec):** same-role edit attempt on another's record → denied · Manager normal edit of an employee's record → denied unless explicit override → `RecordCorrection` path → allowed and audited · creator edits own DRAFT → allowed · creator attempts edit of a locked/submitted record → denied or controlled resubmission · creator attempts edit of a finalized financial entry → denied · cross-company edit attempt → 403 · cross-division edit attempt (e.g. MEP user on an HVAC-restricted record) → 403 · direct API call bypassing the UI for another employee's record → 403 regardless of UI button visibility.

---

## PART 2 — Per-Plan Entitlement Matrix (7 combinations)

Common modules always available (per plan features): Dashboard, Sales & CRM, Customers, Contacts, Site Visits, Estimates, Quotations, Sales Orders, Projects (base), Finance, Billing, Payments, Receivables, Inventory, Procurement, Vendors, Service, AMC, Assets, Team, Employees, Attendance, Reports, Notifications, Documents, Audit, Company Administration.

**Now with base-plan modules vs add-on modules clearly separated per row.**

### A. Solar-only Company
- Base plan modules: Common + **Solar suite** (Solar Projects, BOQ, Site Surveys, Installation, Checklists, DC Testing, AC Testing, Commissioning, Handover, Warranty)
- Available add-ons: Client Portal, Vendor Portal, AI Estimator, Advanced BI, Mobile App, Custom Branding, Extra Users, Storage, API Access, **DIVISION_MEP**, **DIVISION_HVAC**
- Available roles: Company Admin, Sales Mgr, Project Mgr, **Solar Manager**, Inv Mgr, Svc Mgr, Engineer (Solar/Service dept), Accounts, Viewer
- Dashboards: Business, Sales, Project, **Solar**, Inventory, Service, Field
- Available reports: Sales, Projects, **Solar**, Inventory, Finance, Service, AMC
- Disabled modules: MEP suite, HVAC suite
- Disabled roles: MEP Manager, HVAC Manager, MEP/HVAC Engineers
- Division selector: NOT shown (auto-locked to SOLAR)

### B. MEP-only Company
Same shape, MEP suite active, Solar+HVAC disabled. Selector not shown.

### C. HVAC-only Company
Same shape, HVAC suite active, Solar+MEP disabled. Selector not shown.

### D. MEP + HVAC Company
- Base plan modules: Common + **MEP + HVAC** suites
- Available add-ons: (same list + **DIVISION_SOLAR**)
- Roles: + **MEP Manager, HVAC Manager**
- Dashboards: + MEP + HVAC
- Reports: + MEP + HVAC
- Disabled: Solar suite; Solar Manager, Solar Engineer
- Selector: **Shown** [All][MEP][HVAC]

### E. MEP + Solar Company
Selector: **Shown** [All][MEP][Solar]. HVAC disabled.

### F. Solar + HVAC Company
Selector: **Shown** [All][Solar][HVAC]. MEP disabled.

### G. Full (Solar + MEP + HVAC)
All modules, all roles, all dashboards, all reports. Selector: [All][Solar][MEP][HVAC].

---

## PART 3 — Division Selector Behavior

### 1 division purchased
**Selector NOT shown.** Single division auto-locked in state. `useStore.selectedDivision = <div>` at login. All API calls implicit or backend infers from `entitlements.divisions[0]`. Dashboards render directly. User form defaults engineer.division to that division (read-only).

### 2 divisions purchased
**Selector SHOWN** in top bar for eligible roles.

Eligible (can toggle): Company Admin, Project Manager, Inventory Manager, Service Manager, Accounts.
Locked (not eligible): Solar/MEP/HVAC Managers (own division), Engineers (own dept).

Options: `[All Divisions]` (default) + `[Div A]` + `[Div B]`.

Behavior:
- On change → `useStore.selectedDivision` updates
- Persisted in `localStorage.selectedDivision`
- Dashboard re-renders filtered
- List pages send `?division=<sel>`
- Reports pre-filter
- Menu items with `requires.divisions` visible only when selection is 'all' OR matches

### 3 divisions purchased
Same as 2, with all 3 options: `[All]`, `[Solar]`, `[MEP]`, `[HVAC]`.

### Implementation notes
- Selector is NOT merely visual — affects state, API filters, analytic queries
- Backend receives `?division=<X>` or resolves from user's assigned division if locked
- Server always double-checks: requested division must be in `entitlements.divisions`; else 403
- WebSocket rooms include `co:{coId}:div:{X}` for finer targeting

---

## PART 4 — API Authorization Enforcement

### Middleware chain (updated)
```
1. cors + helmet + compression + body-parser
2. auth()                        — verify JWT
3. loadEntitlements()            — attach req.entitlements (cached 5 min per co; invalidated on any Subscription/DE/FE/AddOn change)
4. requireEntitlement()          — check module + division + feature
5. requireRole() / requirePermission()
6. approvalThresholdGuard()      — NEW (see PART 5)
7. destructiveActionGuard()      — NEW (MFA + reason + second-approver + cascade-block)
8. ensureCompany()
9. route handler
10. audit()                      — always write to AuditLog
11. broadcastUpdate()            — WebSocket emit (see PART 6)
```

### `destructiveActionGuard()` — NEW
```
destructiveActionGuard({ resource, requireSecondApprover })
{
  return async (req,res,next) => {
    if (req.method !== 'DELETE' && !req.body?._destructive) return next();
    // Fresh reauth in last 5 min
    if (Date.now() - (req.user._lastAuthTs||0) > 5*60*1000)
      return res.status(401).json({ error:'Fresh reauthentication required', requiresReauth:true });
    // Reason
    if (!req.body?.deletionReason || req.body.deletionReason.length < 20)
      return res.status(400).json({ error:'Deletion reason required (min 20 chars)' });
    // Cascade
    const kids = await countChildren(resource, req.params.id);
    if (kids > 0) return res.status(409).json({ error:`Cannot delete: ${kids} linked records exist. Delete children first.` });
    // Second approver
    if (requireSecondApprover) {
      if (!req.body?.secondApproverToken)
        return res.status(400).json({ error:'Second approver required', approversUrl:'/api/v3/approvals/pending-destructive' });
      if (!(await validateSecondApprover(req.body.secondApproverToken, req.user._id)))
        return res.status(403).json({ error:'Second approver invalid or expired' });
    }
    req.body._softDelete = true;
    req.body._snapshot = await snapshotRecord(resource, req.params.id);
    next();
  };
}
```

### `requireEntitlement()` and `requirePermission()`
As previously defined; super bypasses; log-only mode via `Company.settings.enforceEntitlements`.

### 3-stage enforcement rollout
1. **log-only** — middleware logs violations, doesn't block
2. **warn** — banner in UI, backend still allows
3. **enforce** — 403 on violation

Applied per-company via Super Admin toggle. Instant rollback = flip flag.

---

## PART 5 — Approval Thresholds (FORMALIZED — NEW)

Approvals use **first-class collections**: `ApprovalRule` (definition), `ApprovalRequest` (in-flight), `ApprovalStep` (per-approver decision). `Company.settings` MAY hold company-level preferences/thresholds as configuration ONLY — approval history and workflow state MUST live in the dedicated collections. See DATABASE_ARCHITECTURE.md and API_ARCHITECTURE.md for schemas.

### Default matrix (backfilled at migration; company-editable)

| Resource | Action | Threshold | Approver(s) |
|---|---|---|---|
| Quotation | send | value >= 500,000 INR | Sales Manager |
| Quotation | send | value >= 2,500,000 INR | Sales Manager + Company Admin |
| SalesOrder | confirm | value >= 1,000,000 INR | Company Admin |
| Discount on Quotation | apply | discountPct >= 15% | Sales Manager |
| Discount on Quotation | apply | discountPct >= 25% | Company Admin |
| PurchaseOrder | send | value >= 100,000 INR | Inventory Manager |
| PurchaseOrder | send | value >= 500,000 INR | Company Admin |
| PurchaseOrder | send | value >= 2,000,000 INR | Company Admin + 2nd Director |
| MaterialRequest | approve | any | Inventory Manager OR Division Manager |
| ChangeOrder | approve | costImpact >= 200,000 INR | Company Admin |
| ChangeOrder | approve | costImpact >= 500,000 INR | Company Admin + Client sign-off |
| Payment | write-off | any | Company Admin; dual-approve if > 50,000 |
| Invoice | credit-note | value >= 100,000 INR | Company Admin |
| User | grant admin | any | Company Admin (different user than requester) |
| Contract | terminate | any | Company Admin + reason |
| Project | close | any | Project Manager (mandatory checklist complete) |
| Handover | complete | any | Project Manager + Customer sign-off |
| Destructive delete (any resource with children) | delete | any | Second approver (2-of-2) |

### Schema
```
// Legacy config shape (retained for company-level preferences only — NOT the source of workflow history):
// The authoritative history lives in ApprovalRule / ApprovalRequest / ApprovalStep collections.
companyApprovalPreferences: [
  {
    resource: 'quotation',
    action: 'send',
    condition: { field:'total', op:'>=', value:500000 },
    approvers: [{ role:'sales_manager', quorum:1 }],
    escalation: { after:'48h', to:[{ role:'company_admin', quorum:1 }] }
  },
  ...
]
```

### `approvalThresholdGuard()`
Reads matrix, evaluates condition, checks requester meets required quorum. If yes → pass. If no → creates ApprovalRequest (status=pending), notifies approvers, returns 202 with approvalRequestId. On approve → queued action executes with payload.

### UI flow
- Requestor triggers → 202 "Pending approval" toast
- Approver: Approvals inbox + notification
- Approve → queued action runs
- Escalation timer runs (default 48h → escalates to secondary)
- Full trail in AuditLog

---

## PART 6 — WebSocket Security (FIXED — NEW)

### Problem in v2
`sync.js` broadcasts to `co:{coId}` room — every user in company receives every event. No division / department / entitlement filter. No verification of payload sensitivity.

### Target model

**Multi-room subscription on connect:**
- Verify JWT + load user + entitlements
- Join rooms based on access:
  - `co:{coId}` — company baseline
  - `co:{coId}:div:{division}` — per division user has access to
  - `co:{coId}:user:{userId}` — private (assignments, notifications)
  - `co:{coId}:role:{role}` — role-based (approval queues)
- Emit `session.ready` with room list; client verifies expected rooms

**Emit rules:**
```
broadcastUpdate(io, coId, resource, doc, {division, roles, ownerId}) {
  // Choose minimum audience
  if (ownerId) → co:{coId}:user:{ownerId}
  if (division) → co:{coId}:div:{division}
  if (roles?.length) → for each role: co:{coId}:role:{role}
  else → co:{coId}
  // ALWAYS scoped by co; never leaks to other tenants
}
```

**Payload filtering:**
- Every emitted payload includes `_audience: { division, roles, ownerId }` for server-side verification
- Sensitive fields (financial numbers, PII, cost) redacted for non-authorized roles before emit
- Non-authorized roles receive `{ id, status, updatedAt }` only

**No writes via socket:**
- Client → server commands limited to typed operations (`typing`, `presence`, `heartbeat`)
- All writes go through REST + audit + entitlement chain
- Ignore any write-like command payload

**Reconnect handshake:**
- Re-verify JWT
- Refresh entitlements
- Invalidate stale room membership
- Client rejoins current-user rooms

**Rate limits:**
- 100 events/second per socket (server → client, fan-out)
- 10 commands/second per socket (client → server)
- Excess → disconnect + audit

**Entitlement changes propagate:**
- On DivisionEntitlement disable → server force-removes sockets from `co:{coId}:div:{X}` and emits `entitlement.changed` so client refreshes state
- On role/permission change → same

---

## PART 7 — Project / Package Architecture (DEFINED — NEW)

### Rule
Preserve v2 single-`div` Project. Multi-division projects use a first-class **ProjectPackage collection** (not embedded). See `DATABASE_ARCHITECTURE.md` for schema; see `V3_MIGRATION_MAP.md` for legacy compat adapter.

### Authoritative schema (concise)
```
Project {                            // Overall shell (co, name, divisions[], projectMgrId, subTrades[], salesOrderId, customerId, meta)
  divisions: [enum],                 // 1 or more purchased divisions
  status,                             // Rolled up from packages OR direct for single-div
  value,                              // Sum of ProjectPackage.value
  // Legacy fields preserved (never removed): div, pm, engs[], chk[], updates[], dc[]
}
ProjectPackage {                     // First-class collection, addressable
  _id, co, projectId, division,      // e.g. SOLAR | MEP | HVAC
  code, name, scope, value, budget,
  projectMgr: User FK, engs: [User FK],
  status, startDate, endDate,
  handedOverAt, warranty { start, end, terms }
}
// Tasks, ChecklistInstances, DailyReports, MaterialRequests each carry projectPackageId FK
```

**Legacy operational history is NOT duplicated into packages.** The compat adapter (`legacyProjectPackageAdapter.js`) reads legacy `chk[]/updates[]/engs[]/pm` on Project and presents a single-div project as one virtual package for v3 UI. Only on EXPLICIT conversion to multi-div does a ProjectPackage row get materialized; then the legacy fields become read-only historical.

### Legacy migration
Every existing Project:
- Set `divisions: [<current div>]`
- **NO Package materialization on backfill.** Legacy Project remains the source of truth. The compat adapter (`legacyProjectPackageAdapter.js`) presents the single-division Project as one **virtual** package for v3 UI reads — legacy `chk[] / updates[] / engs[] / pm / value` are read-only on Project and NOT duplicated. A real `ProjectPackage` row is materialized only when: (a) the project is explicitly converted to v3 package architecture by a Company Admin, OR (b) a new multi-division project is created. On conversion, legacy fields become read-only historical.
- `pm` (String) preserved; new `projectMgr` (ObjectId) left null until assigned
- No data loss; single-div projects work identically

### Access rules
| Role | Sees |
|------|------|
| Company Admin | Whole Project + all packages |
| Project Manager | Whole Project + all packages |
| Solar Manager | Solar package only |
| MEP Manager | MEP package only |
| HVAC Manager | HVAC package only |
| Engineer | Tasks assigned to them within their division's package |

Backend `scopeFilter` for Project queries:
- Single-div (packages.length ≤ 1): filter by `divisions` overlap with user's division scope
- Multi-div: return Project shell + only accessible packages

### Package as first-class entity
Addressable: `/api/v3/projects/:pId/packages/:pkgId`. Actions (assign PM, add engineer, close, handover) act on package, not whole Project.

### Financial rollup
`Project.value = SUM(packages.value)`. Profitability computed per package + rolled up. Division Manager sees their package's P&L; Company Admin sees combined.

### Reports
- Solar Report: only Solar packages across all projects
- Project Report: whole projects with per-package breakdown
- Combined report: Company Admin / Accounts only

---

## PART 8 — Live Legacy-Company Migration (EXPLICIT — NEW)

Zero-downtime, non-destructive, one-command rollback.

### Stage 0: Preparation (Week 0)
- Full DB snapshot (mongodump) + off-site copy
- Verify snapshot restore on staging
- Add feature flags to Company.settings:
  - `enforceEntitlements: false` (log-only)
  - `uiVersion: 'v2'`
  - `showV3Preview: false`
- New collections created empty (Plan, Subscription, DivisionEntitlement, FeatureEntitlement, AddOn, ApprovalRequest, AuditLog, Customer, Quotation, ...) — no code path uses them yet
- v3 codebase deployed as separate PM2 process on port 4002; not linked from customer URLs

### Stage 1: Reference Data Seed (Week 1)
- Seed default Plans:
  - `LEGACY_UNLIMITED` (hidden — for existing companies)
  - `SOLAR_STARTER`, `MEP_STARTER`, `HVAC_STARTER`
  - `MEP_HVAC_PRO`, `MEP_SOLAR_PRO`, `SOLAR_HVAC_PRO`
  - `FULL_ENTERPRISE`
- Seed default AddOns catalog
- Seed ~80 Permission codes + default role → permission map
- Seed default `ApprovalRule` rows (first-class collection — see DATABASE_ARCHITECTURE.md)

### Stage 2: Legacy Company Backfill (Week 1, idempotent)

Script `backfill-legacy.js` (per-company, idempotent, resumable):
```
For each Company:
  If no Subscription:
    Subscription.create({
      co, plan: LEGACY_UNLIMITED, planSnapshot,
      startDate: company.createdAt, endDate: null,
      status: 'active', billingStatus: 'paid',
      purchasedDivisions: <computed from company.divs — see rule below>,
      // RULE: if company.divs missing/empty/invalid → migrationReviewRequired=true, no Subscription created;
      // Super Admin must map explicitly. See PLAN_ENTITLEMENTS.md §11.
      addOns: [],
      log: [{at:now, by:'migration', action:'legacy-backfill'}]
    });
  For each div in company.divs:
    DivisionEntitlement.upsert({co, division:div, enabled:true, source:'migration'});
  For each default feature:
    FeatureEntitlement.upsert({co, code, enabled:true, source:'migration'});
  Compute Company.entitlements = {
    divisions: company.divs,              // exactly what the company had — no auto-expansion
    modules: <derived from LEGACY_UNLIMITED.includedModules>,
    features: <derived from LEGACY_UNLIMITED.defaultFeatures>,
    computedAt: now,
    computedFrom: { subscriptionId, divisionEntitlementIds: [...], source: 'migration' }
  };
  Company.settings.enforceEntitlements = false;  // stays log-only
  Company.settings.uiVersion = 'v2';               // no UI change
```

Result: every successfully mapped legacy company retains **exactly** its verified pre-V3 division access (from company.divs) with a perpetual LEGACY_UNLIMITED subscription and no enforcement. Companies with missing or invalid division metadata are flagged migrationReviewRequired=true — they receive NO automatic division or feature grant and require explicit Super Admin mapping. See PLAN_ENTITLEMENTS.md §11 for the mapping rule.

### Stage 3: Validation (Week 2)
- Run diff script comparing pre/post behavior for every route
- UAT: log in as super, admin, hvac_pm, solar_pm, mep_pm, engineer, sales, store, accounts — verify identical experience
- Load test with realistic traffic
- Monitor logs for `entitlement.check.skipped` (log-only mode should log every request)

### Stage 4: Rollout (Weeks 3–6, per-company opt-in)
- Company owner (via Super Admin) chooses to migrate
- Super Admin creates real Subscription (replaces LEGACY_UNLIMITED)
- Picks appropriate plan
- Sets `enforceEntitlements: 'warn'` → banner shown 2 weeks
- If no complaints → `enforceEntitlements: true` after 2 weeks
- On issue: flip back to `false` instantly (no data change)

### Stage 5: New Companies (from Week 3+)
- Super Admin picks real Plan on creation
- DivisionEntitlement per purchased division
- FeatureEntitlement per feature toggle
- `enforceEntitlements: true` from day 1
- UI: v3 if `showV3Preview: true`, else v2 with entitlement checks

### Stage 6: UI Migration (Weeks 6+)
- Per-company opt-in: `Company.settings.uiVersion = 'v3'`
- Users see new sidebar/dashboard on next login
- v2 UI available via URL fallback for 6 months

### Rollback plans
- **Stage 2 rollback:** unset `Company.entitlements`, revert settings — no data loss
- **Stage 4 rollback:** flip `enforceEntitlements` back to `false`
- **Stage 6 rollback:** flip `uiVersion` back to `v2`
- **Nuclear:** restore from Stage 0 snapshot

### Do-not-touch rules (legacy companies)
- Never delete User records (deactivate only)
- Never rename role enum values
- Never remove `Company.divs[]` (keep in sync with new entitlements)
- Never drop indexes on existing models
- Never change JWT secret
- Never change existing field names
- All new fields added with default values so old code paths ignore them

### Audit of migration
Every backfill action → AuditLog with `source: 'migration'`. Super Admin reviews post-migration report.

---

## Verification
- Read: no additional v2 files this pass (used prior analysis)
- Wrote: `v3/ACCESS_MATRIX.md` (rev 3 FINAL) only
- Zero code changes, zero DB writes, zero installs

---

## Rev 4 addendum — Sales split (FINAL)

Add row 12A (Sales Manager) and 12B (Sales Executive) — supersedes any legacy grouping.

### 12A. SALES MANAGER
Scope: own company, all purchased divisions. Dashboard: SalesDashboard (team view). Sidebar: 7 items.

- Customer / Enquiry / Quotation / SO: ✅ CRUD, ✅ APPROVE/REJECT (threshold), ⛔ DELETE admin
- Assigns enquiries to Sales Executives ✅ ASSIGN
- Views team pipeline + performance
- No access to Users/Team management (Company Admin only)
- **Checklist (rev 10):** may complete own assigned `SALES`-responsibility ChecklistInstanceItems (e.g. site takeover / commercial confirmation on handover) within authorized project scope — see `ACCESS_MATRIX.md` §13.2. No access to ENGINEER/CLIENT/SERVICE items.

### 12B. SALES EXECUTIVE
Scope: own company, all purchased divisions, but **only own assigned records** for Enquiries/Quotations.

| Resource | V | C | E | S | A | R | D | Asn | Cl | Ex |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Customer (own) | ✅ | ✅ | ⚠️ own | — | — | — | ❌ | ❌ | — | — |
| Enquiry (own) | ⚠️ own | ✅ | ⚠️ own | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| Quotation (own) | ⚠️ own | ✅ | ⚠️ own | ✅ | 🔒 threshold | ❌ | ❌ | ❌ | ⚠️ threshold | — |
| SalesOrder | ⚠️ related | ⚠️ threshold | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Everything else | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Legacy `sales` role maps to `sales_executive` by default (existing users). Company Admin may promote to `sales_manager` explicitly.

**Checklist (rev 10):** Sales Executive may complete own assigned `SALES`-responsibility ChecklistInstanceItems on own enquiries/quotations/handovers only — same §13.2 rule as Sales Manager, scoped further to own-assigned records.
