# V3 DOCUMENTATION FREEZE
**Status: FINAL**
**Implementation: NOT STARTED**

> **📝 rev 9 addition — 2026-09-10.** Additive only, does not reopen the freeze — see `CHANGELOG.md` rev 9 for the PWA-compat "Raise to Finance" addition.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only, does not reopen the freeze — see `CHANGELOG.md` rev 10 for the Checklist common-execution-engine addition.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only, does not reopen the freeze — see `CHANGELOG.md` rev 11 for the Inventory reusable-tool-custody-vs-project-material addition.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only, does not reopen the freeze — see `CHANGELOG.md` rev 12 for the platform-wide Global Record Ownership, Edit & Delete Control addition.

---

# DOCUMENT AUTHORITY — v3 (rev 4)

**Purpose:** Single index of which document is authoritative for which topic. If documents disagree, the authority listed here wins.

---

## FINAL AUTHORITY HIERARCHY (conceptual dependency)

```
PLATFORM
  ↓
PLAN            (catalog: what CAN be sold)
  ↓
SUBSCRIPTION    (what a company purchased for a time period)
  ↓
DIVISION ENTITLEMENT   (active purchased divisions)
  ↓
FEATURE ENTITLEMENT    (active capabilities)
  ↓
ADD-ONS         (optional commercial purchases)
  ↓
COMPANY (Company.entitlements = COMPUTED CACHE ONLY)
  ↓
DESIGNATION     (organizational role)
  ↓
DEPARTMENT      (operational unit)
  ↓
PROJECT / PACKAGE ACCESS
  ↓
PERMISSION      (fine-grained action grants)
  ↓
SIDEBAR         (rendered from all of the above)
  ↓
DASHBOARD       (rendered from all of the above)
  ↓
API             (enforces all of the above)
```

Any doc that inverts this dependency (e.g. claims Company.entitlements is authoritative, or that Sidebar controls security) is wrong and must be corrected.

---

## Authority index (topic → doc)

| Topic | Authority |
|-------|-----------|
| Authorization (who can do what) | `ACCESS_MATRIX.md` |
| SaaS commercial (Plan/Subscription/DivisionEntitlement/FeatureEntitlement/AddOn) | `PLAN_ENTITLEMENTS.md` |
| Role / designation / department / division taxonomy | `ROLE_HIERARCHY.md` |
| Legacy v2 role → v3 designation mapping | `LEGACY_ROLE_COMPATIBILITY.md` |
| Data model (all collections — legacy + new) | `DATABASE_ARCHITECTURE.md` |
| API design, security, middleware, WebSocket | `API_ARCHITECTURE.md` |
| Navigation (sidebar per role) | `SIDEBAR_ARCHITECTURE.md` |
| Role dashboards | `DASHBOARD_ARCHITECTURE.md` |
| Business workflows + phase priorities | `BUSINESS_WORKFLOWS.md` |
| V2 → V3 file classification | `V3_MIGRATION_MAP.md` |
| Migration + backfill + rollback | `MIGRATION_PLAN.md` (or PLAN_ENTITLEMENTS §11 until authored) |
| Live-app safety rules | `LIVE_APP_SAFETY.md` |
| V2 production baseline (read-only) | `PRODUCTION_BASELINE.md` |
| Change log | `CHANGELOG.md` |
| Overall architecture (index/pointer) | `ARCHITECTURE.md` |
| Gap analysis + strategy | `GAP_ANALYSIS.md` |
| Project↔Checklist↔Payment-Milestone↔Finance workflow (PWA-compat, rev 9) | `BUSINESS_WORKFLOWS.md` (rev 9 addendum) |
| Checklist execution engine (task/assignment/responsibility/evidence/approval, rev 10) | `DATABASE_ARCHITECTURE.md` (rev 10 addendum) — workflow narrative in `BUSINESS_WORKFLOWS.md` (rev 10 addendum) |
| Inventory material classification, custody, and excess/return (reusable tool asset vs. project material, rev 11) | `DATABASE_ARCHITECTURE.md` (rev 11 addendum) — workflow narrative in `BUSINESS_WORKFLOWS.md` (rev 11 addendum); guardrails in `ACCESS_MATRIX.md` §13.3 |
| Record ownership, edit/delete control, and controlled override (platform-wide, rev 12) | `DATABASE_ARCHITECTURE.md` (rev 12 addendum) — enforcement in `API_ARCHITECTURE.md` §1/§7 `requireOwnership()`; guardrails in `ACCESS_MATRIX.md` §13.4 |

## Global invariants (checked every sync pass)

- **Plan ≠ Subscription** — Plan is a template; Subscription is an instance.
- **Subscription ≠ Entitlement** — Subscription references a Plan; Entitlement is a computed effect.
- **Division ≠ Department** — Division ∈ {SOLAR, MEP, HVAC}; Department ∈ {ADMIN, PROJECTS, SALES, SOLAR, MEP, HVAC, SERVICE, INVENTORY, FINANCE}. Departments SOLAR/MEP/HVAC map to the same-named division; other departments (SERVICE, INVENTORY, FINANCE) have no division.
- **Designation ≠ Job Title** — Designation is security; Job Title is a display label with no security effect.
- **MEP ≠ HVAC** — always separate divisions, separate managers, separate workflows, separate models where applicable.
- **Project ≠ ProjectPackage** — Project is the shell; ProjectPackage is the first-class per-division operational unit.
- **Sidebar ≠ Security** — Sidebar is view rendering; backend independently enforces.
- **selectedDivision ≠ authorization** — Division selector is view context only. Backend never trusts client-supplied division without cross-checking entitlements.
- **Company.entitlements = CACHE only** — Never authoritative. Recomputed from Subscription+DivisionEntitlement+FeatureEntitlement+AddOn on any change.
- **Checklist ≠ Payment (rev 9)** — ChecklistInstance completion is an operational-progress signal only; it never creates or edits a Payment/Invoice/FinanceWorkItem. The only path from operations to finance is the explicit "Raise to Finance" action (PM-initiated); the only path back is Accounts' own Payment workflow. See `ACCESS_MATRIX.md` §13.1.
- **Checklist ≠ Finance-only feature (rev 10)** — Checklist's primary purpose is project execution (task/assignment/responsibility/evidence/approval/progress); Finance is one optional downstream consequence, never the owner. Never reduce Checklist design decisions to "things that trigger Finance." See `ACCESS_MATRIX.md` §13.2.
- **Responsibility ≠ Assignment ≠ Approval (rev 10)** — `responsibilityType` (what kind of party), `assignedUserId` (which specific authorized user), and approval (a separate authorized approver via first-class ApprovalRequest) are three distinct decisions, never collapsed into one.
- **Custody ≠ Consumption (rev 11)** — `REUSABLE_TOOL_ASSET` items circulate by custody and are never decremented as "consumed"; only `PROJECT_MATERIAL` items have a consumption lifecycle. The two are never modeled or reported as one.
- **PM declaration ≠ verified stock transaction (rev 11)** — a Project Manager may only report usage and request excess/return/transfer; only the Inventory Manager's physical verification actually posts an `InvTransaction` or changes `ToolCustody.status`, and the verified figures may differ from the PM's declared figures — both are preserved, never merged. See `ACCESS_MATRIX.md` §13.3.
- **Ownership ≠ Role ≠ Permission (rev 12)** — `createdByUserId` (who owns the record), the requester's role-based `requirePermission()` grant, and company/division/project/package scope are three independent checks; all must pass. Never assume department/role/division/company membership alone grants edit/delete on another user's record.
- **Manager/Admin edit ≠ Creator ownership (rev 12)** — a Manager or Admin correcting another user's record always goes through the controlled, audited `RecordCorrection` collection; it is never a silent field-level overwrite, and higher job title never implies unrestricted editing of another person's record. See `ACCESS_MATRIX.md` §13.4.

## Phase priority (single scheme used everywhere)

`P0, P1, P1.5, P1.6, P1.7, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P15, P16`. Any doc using a different scheme is out-of-date.

## Standardized enums

- `source` (used on entitlement rows and migration markers): `plan | addon | manual | migration`
- Division values: `SOLAR | MEP | HVAC` (uppercase in DB; UI may render mixed-case)
- Department values: `ADMIN | PROJECTS | SALES | SOLAR | MEP | HVAC | SERVICE | INVENTORY | FINANCE`
- Designation values: `super_admin | company_admin | sales_manager | sales_executive | project_manager | solar_manager | mep_manager | hvac_manager | inventory_manager | service_manager | engineer | technician | executive | viewer`

---

## Canonical Effective-Entitlement Precedence (FINAL, FROZEN)

Effective entitlement uses **set/override semantics**, never literal array addition. The single deterministic precedence — used everywhere in v3:

```
EXPLICIT MANUAL DISABLE
  >  EXPLICIT MANUAL ENABLE
  >  ADD-ON GRANT
  >  SUBSCRIPTION PURCHASE
  >  PLAN DEFAULT
```

- Start from PLAN DEFAULT (baseline).
- Apply SUBSCRIPTION PURCHASE (intersect with `purchasedDivisions`).
- Layer ADD-ON GRANTS (add divisions / features).
- Apply EXPLICIT MANUAL ENABLE rows (add).
- Apply EXPLICIT MANUAL DISABLE rows LAST (highest priority — always wins).

Migration rows are informational only (provenance), never re-grant.

### Worked examples
- **Ex 1** — Plan HVAC + Add-on HVAC + Manual disabled → `disabled` (manual wins).
- **Ex 2** — Plan MEP + Add-on HVAC + no manual → `MEP + HVAC`.
- **Ex 3** — Plan Solar + MEP + Manual disable Solar → `MEP only`.
- **Ex 4** — Legacy migration with `company.divs = [MEP]` → `MEP only`. Not `[SOLAR,MEP,HVAC]`.
- **Ex 5** — Legacy company with missing/invalid divs → `migrationReviewRequired=true`, no grant.

## Super Admin Support-Access Rule (FINAL, FROZEN)

- "Super bypasses entitlement" ≠ unrestricted business mutation.
- Super Admin support access to company data is:
  - **Read-only by default**
  - **Fully audited** (every read writes an AuditLog entry with `reason`)
  - **Support operation flag** required for exceptional mutations (Super Admin selects "Support Op" in UI, provides justification, mutation captured with `supportOp: true, supportReason: ...` in AuditLog)
  - **Never bypasses company isolation** — a Super Admin viewing Company A's data cannot leak Company B data in the same session
  - **Notifies Company Admin** on any support mutation (async notification)
