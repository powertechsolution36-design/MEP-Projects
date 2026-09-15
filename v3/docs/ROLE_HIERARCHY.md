# ROLE HIERARCHY — v3 (rev 4)

> **📝 rev 10 addition — 2026-09-11.** Additive only. Added CHECKLIST RESPONSIBILITY TYPE as a 6th distinct concept, separate from Designation. See `CHANGELOG.md` rev 10.

**Authority:** Role/designation/department/division taxonomy authority (see `DOCUMENT_AUTHORITY.md`).
**Legacy compatibility:** see `LEGACY_ROLE_COMPATIBILITY.md`.

---

## 1. Six distinct concepts (must not mix) — rev 10 adds CHECKLIST RESPONSIBILITY TYPE

| Concept | Purpose | Values | Storage |
|---------|---------|--------|---------|
| **DESIGNATION** | Primary organizational role — chosen by admin, drives permissions | super_admin, company_admin, sales_manager, sales_executive, project_manager, solar_manager, mep_manager, hvac_manager, inventory_manager, service_manager, engineer, technician, executive, viewer | `User.designation` |
| **JOB TITLE** | Optional human-readable title, DISPLAY ONLY, no security effect | Sales Executive, Store Keeper, Solar Engineer, MEP Engineer, HVAC Engineer, Service Engineer, Senior Engineer, Technician, etc. | `User.jobTitle` (string) |
| **SYSTEM ROLE** | Legacy v2 authorization enum, preserved for backward compatibility | super, admin, hvac_pm, solar_pm, mep_pm, hvac_dm, solar_dm, mep_dm, engineer, service_eng, service_mgr, sales, store, accounts, viewer | `User.role` |
| **DEPARTMENT** | Operational unit within a company | ADMIN, PROJECTS, SALES, SOLAR, MEP, HVAC, SERVICE, INVENTORY, FINANCE | `User.department` |
| **DIVISION** | Business division (only for divisional designations) | SOLAR, MEP, HVAC | `User.division` (null for non-divisional) |
| **CHECKLIST RESPONSIBILITY TYPE** (rev 10) | Per-task label on a `ChecklistInstanceItem` saying what *kind* of party must act — extensible catalog, not a security grant itself | ENGINEER, CLIENT, SALES, SERVICE, PROJECT_MANAGER, TECHNICIAN (seed set; extensible via `Permission` catalog, never hard-coded) | `ChecklistInstanceItem.responsibilityType` |

**Job Title never affects security.** Only Designation + Department + Division + Permissions decide access. System Role is a legacy compatibility layer. **Checklist Responsibility Type is not a security concept on its own** (rev 10) — it labels the task; whether a given user's Designation/Permissions make them *eligible* for that responsibility, and which specific user is `assignedUserId`, are separate decisions enforced by `requirePermission()` and PM assignment (see `ACCESS_MATRIX.md` §13.2, `DATABASE_ARCHITECTURE.md` rev 10). CLIENT-responsibility items carry no `User` at all — evidence (name/signature) is stored directly on the item.

---

## 2. Final Organizational Tree (authoritative)

```
SUPER ADMIN (platform)
└── COMPANY (tenant)
    └── COMPANY ADMIN / MANAGER
        ├── SALES MANAGER
        │   └── SALES EXECUTIVE(s)              // FINAL — split confirmed
        │
        ├── PROJECT MANAGER (cross-division)
        │
        ├── SOLAR MANAGER          [only when SOLAR division purchased]
        │   ├── Solar Engineer (engineer, dept=SOLAR, div=SOLAR)
        │   └── Solar Technician (technician, dept=SOLAR, div=SOLAR)
        │
        ├── MEP MANAGER            [only when MEP division purchased]
        │   ├── MEP Engineer (engineer, dept=MEP, div=MEP)
        │   └── MEP Technician (technician, dept=MEP, div=MEP)
        │
        ├── HVAC MANAGER           [only when HVAC division purchased]
        │   ├── HVAC Engineer (engineer, dept=HVAC, div=HVAC)
        │   └── HVAC Technician (technician, dept=HVAC, div=HVAC)
        │
        ├── INVENTORY MANAGER
        │   └── Store Keeper (job title, designation=engineer or technician)
        │
        └── SERVICE MANAGER
            ├── Service Engineer (engineer, dept=SERVICE, div=null)
            └── Service Technician (technician, dept=SERVICE, div=null)

Supporting system roles: ACCOUNTS / FINANCE, VIEWER
```

**Rules:**
- **MEP and HVAC remain completely separate** — separate divisions, separate managers, separate workflows.
- **Engineer / Technician** — one designation; scope is decided by department + division + project/package assignment.
- **No separate "Projects Engineer"** designation — engineers are always tied to a specific division or SERVICE department.
- **Project Manager** is a cross-division coordination role (department=PROJECTS, division=null).

---

## 3. Sales split (FINAL)

**Sales Manager** (designation=sales_manager, department=SALES):
- Sees team pipeline
- Assigns enquiries to executives
- Manages quotations
- Manages sales approvals (per `ApprovalRule` — first-class collection)
- Sees team performance
- Sees all customers, all sales activity within company

**Sales Executive** (designation=sales_executive, department=SALES):
- Assigned enquiries (own only)
- Follow-ups
- Site visits
- Quotations within permission (threshold-based approval)
- Assigned customers
- Own performance

**Legacy `sales` role** maps to `sales_executive` by default (existing users). Company Admin may promote to `sales_manager` explicitly.

---

## 4. Designation × Department × Division validity matrix

| Designation | Department | Division | Legacy role produced |
|---|---|---|---|
| super_admin | ADMIN | null | super |
| company_admin | ADMIN | null | admin |
| sales_manager | SALES | null | sales (with promoted flag) |
| sales_executive | SALES | null | sales |
| project_manager | PROJECTS | HVAC | hvac_pm |
| project_manager | PROJECTS | SOLAR | solar_pm |
| project_manager | PROJECTS | MEP | mep_pm |
| solar_manager | SOLAR | SOLAR | solar_dm |
| mep_manager | MEP | MEP | mep_dm |
| hvac_manager | HVAC | HVAC | hvac_dm |
| inventory_manager | INVENTORY | null | store |
| service_manager | SERVICE | null | service_mgr |
| engineer | SOLAR/MEP/HVAC/SERVICE | (matches dept) | engineer or service_eng |
| technician | SOLAR/MEP/HVAC/SERVICE | (matches dept) | engineer or service_eng |
| executive | SALES | null | sales |
| executive | ACCOUNTS | null | accounts |
| viewer | ADMIN | null | viewer |

`availableDesignations(company)` filters to combinations whose required divisions are in `company.entitlements.divisions`.

---

## 5. Compatibility resolver (V3 read-only)

```
resolve(user):
  if user.designation and user.department:
    return { designation, department, division: user.division }
  map = LEGACY_ROLE_MAP[user.role]   // see LEGACY_ROLE_COMPATIBILITY.md
  return { designation: map.designation, department: map.department, division: map.division }
```

V3 never mutates legacy `role` on write. If V3 must change role, it sets it explicitly.

---

## 6. Display label rule

```
orgLabel(user):
  if division-based (dept in {SOLAR,MEP,HVAC} or division set):
    return `${divisionLabel} ${designationLabel}`     // e.g. "Solar Manager"
  else:
    return `${designationLabel}` [+ " — ${departmentLabel}" for non-admin]
```

Examples: **"HVAC Manager"**, **"Solar Project Manager"**, **"Sales Executive"**, **"Sales Manager"**, **"Company Admin"**, **"Service Manager"**.

---

## 7. Role availability (data-driven per company)

`availableDesignations(company)` returns:
- Always: super_admin (platform only), company_admin, sales_manager, sales_executive, project_manager, inventory_manager, service_manager, executive, viewer
- If SOLAR purchased: + solar_manager, engineer/technician (dept=SOLAR, div=SOLAR)
- If MEP purchased: + mep_manager, engineer/technician (dept=MEP, div=MEP)
- If HVAC purchased: + hvac_manager, engineer/technician (dept=HVAC, div=HVAC)

Backend validates on User POST/PUT.
