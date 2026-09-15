> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.

---

# MEP PROJECTS — v2 vs Target Architecture Gap Analysis

**Generated:** 2026-08-28
**Purpose:** Compare current v2 implementation against target org hierarchy + permission model
**⚠️ Read-only planning document — Zero code changes made.**

---

## Target Architecture Reminder

```
SUPER ADMIN (platform)
└── COMPANY {A,B,C}
    └── COMPANY ADMIN / MANAGER
        ├── SALES MANAGER
        ├── PROJECT MANAGER            (overall projects — cross division)
        ├── SOLAR MANAGER              (Solar ops only)
        ├── MEP MANAGER                (MEP ops only — Electrical/Plumbing/Fire/Other)
        ├── HVAC MANAGER               (HVAC ops only — VRF/Ducted/Split/Piping/Testing/Commissioning)
        ├── INVENTORY MANAGER
        └── SERVICE MANAGER
            └── ENGINEER / TECHNICIAN
```

**Rule:** HVAC ≠ MEP. Two independent divisions with own sub-trades.

**New Authorization Model:**
`USER + COMPANY + DESIGNATION + DEPARTMENT + PROJECT ACCESS + PERMISSION`

**Permissions vocabulary:**
`VIEW, CREATE, EDIT, SUBMIT, APPROVE, REJECT, DELETE, ASSIGN, CLOSE, EXPORT`

---

## 1. Current Roles → Target Roles Mapping

| Current v2 Role | Target Role | Notes |
|---|---|---|
| `super` | **SUPER ADMIN** | ✅ Direct 1:1 |
| `admin` | **COMPANY ADMIN / MANAGER** | ✅ Direct 1:1 |
| `sales` | **SALES MANAGER** (or Sales Executive under it) | Needs split: manager vs exec |
| `hvac_dm` | **HVAC MANAGER** | ✅ Recently added, maps directly |
| `solar_dm` | **SOLAR MANAGER** | ✅ Recently added, maps directly |
| `mep_dm` | **MEP MANAGER** | ✅ Recently added, maps directly |
| `hvac_pm` | Reports to HVAC Manager as **Division Project Manager** | Different from "Project Manager" (cross-div) |
| `solar_pm` | Reports to Solar Manager | Same pattern |
| `mep_pm` | Reports to MEP Manager | Same pattern |
| *(missing)* | **PROJECT MANAGER** (cross-division execution) | **NEW ROLE NEEDED** |
| `store` | **INVENTORY MANAGER** | Rename recommended |
| `service_mgr` | **SERVICE MANAGER** | ✅ Direct 1:1 |
| `service_eng` | **SERVICE ENGINEER / TECHNICIAN** | Direct, but restrict to Service dept |
| `engineer` | **PROJECT ENGINEER / TECHNICIAN** | Needs to be scoped by division |
| `accounts` | **ACCOUNTS / FINANCE** | Not in target diagram but exists — keep |
| `viewer` | **VIEWER** | Keep for read-only access |

**Gap:** Target diagram has ONE **Project Manager** at same tier as division managers, meaning cross-division PM. v2 has per-division PMs (hvac_pm/solar_pm/mep_pm) but NO cross-division PM. Need to add.

**Gap:** No **Sales Executive** distinct from Sales Manager in v2.

---

## 2. Current Routes → Required Role Changes

### Currently protected routes (v2):

| Route | Method | Current Guard | Target Guard |
|-------|--------|---------------|--------------|
| `/api/users` | POST/PUT/DELETE | `requireRole('admin')` (+DM allowed) | `admin` OR permission `users.create/edit/delete` |
| `/api/companies` | PUT/DELETE | `requireRole('admin')` | Should be `super` only for cross-company; `admin` for own company edits |

### Routes needing NEW guards (currently open):

| Route | Method | Recommended Guard |
|-------|--------|-------------------|
| `/api/enquiries` | POST/PUT/DELETE | Permission: `enquiries.create/edit/delete` |
| `/api/sales-orders` | POST/PUT/DELETE | Permission: `salesOrders.*` |
| `/api/projects` | POST/PUT/DELETE | Permission: `projects.*` scoped by division |
| `/api/service-calls` | POST/PUT/DELETE | Permission: `serviceCalls.*` (SERVICE dept + Managers) |
| `/api/contracts` | POST/PUT/DELETE | Permission: `contracts.*` (SERVICE dept) |
| `/api/payments` | POST/PUT/DELETE + `/paid` | Permission: `payments.*` (ACCOUNTS + admin) |
| `/api/inventory/*` | POST/PUT/DELETE | Permission: `inventory.*` (STORE/Managers) |
| `/api/checklists` | POST/PUT/DELETE | Permission: `checklists.*` |
| `/api/notifications` | POST/DELETE | Permission: `notifications.create/delete` |
| `/api/reports/download` | GET | Permission: `reports.export` |

### Missing action routes:
| Action | Target Route | Currently |
|--------|--------------|-----------|
| SUBMIT | `POST /:resource/:id/submit` | Missing — everything is direct-save |
| APPROVE | `POST /:resource/:id/approve` | Missing |
| REJECT | `POST /:resource/:id/reject` | Missing (except Enquiry `/lost`) |
| CLOSE | `POST /:resource/:id/close` | Missing (except implicit in status change) |
| ASSIGN | `POST /:resource/:id/assign` | Missing (uses PUT for assignment field) |
| EXPORT | Handled by `/api/reports/download` | ✅ Present |

**Impact:** v2 has no workflow states — everything is CRUD. Target model needs a workflow layer.

---

## 3. Current Sidebar → Target Sidebar Mapping

### Current v2 sidebar per role:

**Super Admin:** Dashboard, Companies, Analytics, Revenue, Expiring, Locations, Reports
**Company Admin:** All 14 modules including Users
**HVAC/Solar/MEP Manager (DMs):** All modules minus Users (14 items)
**HVAC/Solar/MEP PM:** 4-5 items (Projects, SO, Stock, Checklists)
**Sales:** Dashboard, Enquiries, SO, Lost
**Service Manager:** Dashboard, Service Calls, AMC/PM, Stock
**Service Engineer:** My Service Jobs, My Material
**Store:** Full Inventory sections
**Accounts:** Dashboard, Pending Payments, SO
**Engineer:** My Work, My Material
**Viewer:** Dashboard, Reports

### Target sidebar per role (proposed):

**SUPER ADMIN:** Dashboard, Companies, Analytics, Revenue, Expiring, Locations, Reports (KEEP AS-IS)

**COMPANY ADMIN / MANAGER:** Dashboard, Enquiries, Quotations, Sales Orders, Projects, Service Calls, AMC/PM, Payments, Inventory, Users, Reports, Checklists (rename "Users" workflow)

**SALES MANAGER:** Dashboard, Customers, Enquiries, Quotations, Sales Orders, Lost Enquiries, Reports (sales)

**PROJECT MANAGER (cross-division):** Dashboard, All Projects (cross-div), Sales Orders, Stock (read), Reports

**HVAC / SOLAR / MEP MANAGER:** Dashboard, Division Enquiries, Division Quotations, Division SO, Division Projects, Division Service, Division Contracts, Division Inventory view, Reports — all pre-filtered by division

**INVENTORY MANAGER:** Dashboard, Stock, Issue, Returns, Transfer, Categories/Locations, Transactions, Reports (inventory)

**SERVICE MANAGER:** Dashboard, Service Calls, AMC/PM, Assignments, Reports (service)

**ENGINEER / TECHNICIAN:** Dashboard (My Work), Assigned Projects/Service Calls, Issue Material, Daily Report

**VIEWER:** Dashboard (read), Reports (read)

**Gaps:**
- Sidebar entries for `/customers` and `/quotations` exist for DM roles but **backend routes/models are missing** — clicking → 404
- No sidebar for cross-division PROJECT MANAGER
- No sidebar entry for a Sub-Trade view under HVAC (VRF, Ducted, Split etc.) or MEP (Electrical, Plumbing, Fire, Other)

---

## 4. Current Dashboard → Target Dashboard Mapping

**Current `Dashboard.jsx`:**
- Universal stats card grid based on `if isSuper/isAccount/etc.`
- Aggregates from useStore state (already loaded via `/api/bulk`)
- Charts via inline SVG

**Target dashboard requirements per role:**

| Role | Widgets |
|------|---------|
| **SUPER ADMIN** | Companies, Revenue MRR/ARR, Active companies, Expiring subs (already OK) |
| **COMPANY ADMIN** | Overall pipeline (enquiries→SO→projects), Revenue, Cash flow, Alerts |
| **SALES MANAGER** | Enquiries by status, Quotations sent, Conversion rate, Lost reasons |
| **PROJECT MANAGER** | Active projects by status, Delays, Milestones, Total value |
| **HVAC / SOLAR / MEP MANAGER** | Division-only slice of the Company Admin widgets |
| **INVENTORY MANAGER** | Low stock, Recent issues, Pending returns, Stock value |
| **SERVICE MANAGER** | Open calls, AMC due, Engineer load, SLA breaches |
| **ENGINEER** | Assigned tasks today, Pending updates, Materials issued |

**Gap:** Only one Dashboard.jsx today with role-branching. Needs modular role-scoped widgets.

---

## 5. Current Models → Required Additions

### New Models Needed (v3):

| Model | Purpose |
|-------|---------|
| **Customer** | Referenced in sidebar but not built. Fields: co, name, code, address, gstin, contacts[], sites[] |
| **Quotation** | Referenced in sidebar but not built. Fields: co, no, customer, enquiry, items[], validity, status, revisions[] |
| **Trade** (enum table) | HVAC sub-trades + MEP sub-trades as a domain-controlled list |
| **Role** | New model to store the target roles + their designation/department combos (or use v2's User.role enum) |
| **Permission** | `{ code, label, category }` e.g., `enquiries.create`, `payments.approve` |
| **RolePermission** | Junction: `{ role, permission, granted }` |
| **UserPermissionOverride** | `{ user, permission, granted }` for per-user grants/revokes |
| **ProjectAccess** | `{ user, project, role/permissions }` — for target "PROJECT ACCESS" dimension |
| **AuditLog** | `{ co, user, action, resource, resourceId, before, after, ip, ua, at }` |
| **Workflow** | For SUBMIT/APPROVE/REJECT states (or add stateMachine to each doc) |

### Additions to Existing Models:

| Model | Add Field | Purpose |
|-------|-----------|---------|
| **User** | `permissions[]` (or ref to UserPermissionOverride) | Per-user grants |
| **User** | `subDepartment` / `trade` | For MEP: Electrical/Plumbing/Fire; HVAC: VRF/Ducted/Split etc. |
| **Project** | `trade` | Sub-trade classification |
| **Project** | `accessList[]` — `{ user, canView, canEdit, canApprove }` | For project-level access |
| **Enquiry** | `trade`, `division` (currently missing division field) | Consistent filtering |
| **Enquiry** | `customerId` ref | Link to Customer model |
| **SalesOrder** | `division`, `enquiry`, `quotation` refs | Trace back to source |
| **ServiceCall** | `division` | Route service to right team |
| **Contract** | `division` | Route AMC to right team |
| **InvItem** | `subCategory` / `trade` | Extend existing division with fine-grained trade |
| **Company** | `settings.divisionsEnabled[]`, `settings.subTrades{}` | Per-company config |
| **Notification** | `permissions[]` | Notify users who have specific permission |

---

## 6. Current APIs → Required Additions

### New endpoints needed:

**Customers**
- `GET/POST/PUT/DELETE /api/customers`
- `GET/POST /api/customers/:id/sites`

**Quotations**
- `GET/POST/PUT/DELETE /api/quotations`
- `POST /api/quotations/:id/revise`
- `POST /api/quotations/:id/send`
- `POST /api/quotations/:id/accept` (→ creates SalesOrder)
- `POST /api/quotations/:id/reject`

**Permissions**
- `GET /api/permissions` — list all permission codes
- `GET /api/roles` — list roles + their permissions
- `PUT /api/roles/:role/permissions` — update role permissions
- `PUT /api/users/:id/permissions` — override per user

**Workflow**
- `POST /api/:resource/:id/submit`
- `POST /api/:resource/:id/approve`
- `POST /api/:resource/:id/reject`
- `POST /api/:resource/:id/close`
- `POST /api/:resource/:id/assign`

**Project Access**
- `GET /api/projects/:id/access`
- `POST /api/projects/:id/access` (grant user)
- `DELETE /api/projects/:id/access/:userId`

**Audit**
- `GET /api/audit?resource=&user=&from=&to=`

**Trades**
- `GET /api/trades` — list HVAC + MEP sub-trades (config)

### Existing APIs needing changes:

- `/api/users` — add filter by department, division, designation
- `/api/enquiries` — add filter by division and trade
- All list endpoints — return counts + support pagination (currently unbounded)

---

## 7. Data Migration Requirements

### Additive migrations (safe, backward-compatible):

1. **Add new fields to existing docs** — all with defaults, so old docs continue to work:
   - `User.permissions[]` — default `[]`
   - `User.subDepartment` — default `null`
   - `Project.trade` — default `null`
   - `Project.accessList[]` — default `[]`
   - `Enquiry.division`, `Enquiry.trade`, `Enquiry.customerId` — default `null`
   - `SalesOrder.division`, `SalesOrder.enquiry`, `SalesOrder.quotation` — default `null`
   - `ServiceCall.division` — default `null`
   - `Contract.division` — default `null`
   - `InvItem.trade` — default `null`
   - `Company.settings` — default `{}`

2. **Seed new collections:**
   - Permissions: seed ~50-80 permission codes
   - RolePermission: seed default mapping (mirror current role behavior)
   - Trades: seed HVAC + MEP sub-trade lists per Company

3. **Backfill existing users:**
   - Derive `department` and `division` from `role` (already done in `migrate-departments.js`)
   - Extend to derive `permissions[]` from `role`

### Rename operations (BREAKING — defer or wrap):

- `store` → INVENTORY MANAGER: **Do NOT rename role enum yet**. Instead add alias in UI labeling.
- `engineer` → PROJECT ENGINEER: **Same** — keep enum name, change display label only.

---

## 8. Backward-Compatibility Strategy

**The safe plan is dual-track:**

1. **Keep v2 legacy fields intact** (`User.role`, `Project.div`, etc.). Do NOT touch existing records.

2. **v3 adds new fields alongside** (`User.permissions[]`, `Project.trade`, etc.) — all optional with sensible defaults.

3. **`requireRole()` middleware stays** and continues checking `user.role`. Add a NEW middleware `requirePermission(code)` that:
   - First checks user's explicit permissions[] override
   - Falls back to role's default permissions (via RolePermission table)
   - Grants if either allows

4. **`scopeFilter()` stays and continues division-scoping** as it does today. Add `scopeFilterV3(user, resource, extra)` that also respects trade + project access list.

5. **Sidebar stays flat per role** in v2. v3 adds a new dynamic sidebar computed from `user.permissions[]` → shown routes.

6. **JWT unchanged.** Same token works for v2 and v3 endpoints.

7. **Bulk endpoint stays.** v3 can add `/api/v3/bulk` if it needs a permission-scoped payload.

8. **Frontend uses v2 pages by default.** New v3 pages live under `/v3/*` routes until ready to switch.

9. **Feature flag on Company.settings.uiVersion** — `'v2'` (default) or `'v3'`. Frontend switches based on this.

10. **Login flow unchanged.** After login, if `company.settings.uiVersion === 'v3'`, load v3 shell; else v2.

---

## 9. Risks

### High-severity risks:

1. **Breaking role-based logic** — 20+ files reference `user.role === 'admin'` or `MENUS[user.role]`. Any rename cascades everywhere.
   - **Mitigation:** Don't rename. Add labels/aliases only.

2. **Existing users lose access** — If a role → permission mapping is wrong, users can't do their job.
   - **Mitigation:** Extensive dry-run script that reports "what X user could do before / after"

3. **Duplicated records** if Customers/Quotations models added — existing Enquiries have `client` as string, not FK.
   - **Mitigation:** Backfill Customers from unique `Enquiry.client` values with dedup by name+phone

4. **WebSocket broadcasts** rely on `co:${coId}` room. v3 must join same rooms or add own.
   - **Mitigation:** v3 uses same room naming.

5. **Sidebar 404s** — `/customers`, `/quotations` already broken in v2 for DM roles. Any deploy that surfaces them without backing routes will look like new bugs.
   - **Mitigation:** Complete Customer + Quotation modules FIRST before making them accessible.

6. **Migration script errors** on stale data (users with null role, projects without co).
   - **Mitigation:** Migration must handle each case with logging + skip-on-error.

7. **JWT secret mismatch** if v3 server runs separately with different .env.
   - **Mitigation:** Share JWT_SECRET env var across both.

8. **Permission override loops** — infinite recursion if permission depends on another permission.
   - **Mitigation:** Permission table is flat; no hierarchical inheritance in v1 of the model.

### Medium-severity risks:

- Bulk endpoint payload growth (currently returns all records) as new fields added
- ExcelJS memory usage on large report exports
- Notifications flooding when audit logging is added

### Low-severity risks:

- UI label changes confusing existing users (retrain needed)
- Frontend bundle size growth (~50KB per new page)

---

## 10. Recommended Implementation Order

**Phase 0 (already done in v2 — verify only):**
- ✅ department, division, designation fields on User
- ✅ Division scoping in scope.js
- ✅ InvItem.division

### Phase 1 — v3 Foundation (Weeks 1-2, ~0 risk)

**Backend:**
- Create `v3/server/` with same package layout as v2/server
- Copy (don't move) v2 models — reuse same MongoDB collections
- Add Permission, RolePermission, UserPermissionOverride, AuditLog models
- Seed script: 50-80 permission codes + default role mapping
- New `requirePermission(code)` middleware alongside `requireRole()`
- `/api/v3/permissions`, `/api/v3/roles`, `/api/v3/users/:id/permissions` endpoints
- `/api/v3/audit` endpoint

**Frontend:**
- Create `v3/web/` with same layout
- Add `PermissionsAdmin.jsx` page (super/company_admin only) — grid of role×permission checkboxes
- Add `UserPermissions.jsx` page — per-user override editor
- No changes to v2 pages

**Rollout:** v3 runs on port 4002, own subdomain `v3.mep-projects.spereon.codes` OR mounted at `/v3/*`. v2 users unaffected.

### Phase 2 — Customer + Quotation Modules (Weeks 3-4)

- Customer model, routes, page — used by both v2 sidebar (fixes 404) and v3
- Quotation model, routes, page
- Backfill Customers from Enquiry.client (script)
- Enquiry.customerId (optional FK) — v2 continues to work with plain client string

### Phase 3 — Workflow Actions (Weeks 5-6)

- Add SUBMIT/APPROVE/REJECT/CLOSE/ASSIGN endpoints to Quotation, SalesOrder, Project, ServiceCall
- Emit status transitions to audit log
- v2 pages continue using PUT to change status; v3 pages use new workflow endpoints

### Phase 4 — Sub-trades (Weeks 7-8)

- Add Trade config per Company
- Add `trade` field to Project, Enquiry, SalesOrder, InvItem
- Frontend: sub-trade picker under Division

### Phase 5 — Project Access List (Weeks 9-10)

- Project.accessList[] + routes
- Engineer sees only projects where they're in accessList

### Phase 6 — Role Renames (UI only) (Week 11)

- Change display labels: "store" → "Inventory Manager", etc.
- Do NOT rename enum values
- Add `Company Admin` label alias for `admin` role

### Phase 7 — Optional: Deprecate v2 (After stabilization)

- Feature flag Company.settings.uiVersion switch
- Gradually migrate companies to v3
- Keep v2 running for 6 months as fallback

---

## Compatibility Summary

| Component | Change Strategy |
|-----------|-----------------|
| User.role enum | **KEEP** — add new roles, never rename existing |
| requireRole() | **KEEP** — new requirePermission() supplements |
| /api/bulk | **KEEP** — /api/v3/bulk supplements |
| Sidebar per role | **KEEP** — v3 uses permission-derived menu |
| Frontend routing | **v2 routes intact** — v3 mounts under /v3/* |
| Database schema | **Additive only** — no field removals or renames |
| JWT | **Unchanged** — shared secret |
| WebSocket rooms | **Unchanged** — same co:{coId} pattern |

---

## Verification: No files modified

Only read operations performed. `v3/` folder contains:
- `DEEP_ANALYSIS.md`
- `GAP_ANALYSIS_AND_STRATEGY.md` (this file)

No v2 files touched. No database queries. No installs.
