# LEGACY ROLE COMPATIBILITY — v3

**Purpose:** Definitive mapping between v2 legacy roles and v3 organizational triple (designation + department + division), with actual v2 behavior verified from source.

**Verified from:** `v2/server/src/models/User.js`, `v2/web/src/components/Shell.jsx`, `v2/server/src/utils/scope.js`, `v2/server/src/middleware/auth.js`.

## Rule of engagement

1. Legacy `role` field on User **stays exactly as it is** in existing records.
2. V3 never renames or removes any of the 15 legacy role values.
3. The pre-validate hook that silently rewrote `role` from designation changes is **frozen for v3 writes** — V3 API must set role explicitly if it wants to change it.
4. V3 code reads legacy `role` via `legacyRoleMap.js` compatibility resolver — returns effective `{ designation, department, division }` for permissions/UI without mutating stored data.

## Complete mapping (15 legacy roles)

| Legacy `role` | v2 permission summary | Target designation | Target department | Target division | Migration action | Backward-compat behavior |
|---|---|---|---|---|---|---|
| `super` | Full platform: all companies, all data, requireRole bypass | `super_admin` | `ADMIN` | `null` | none | v3 requireRole('super') = allow |
| `admin` | Full company scope; POST/PUT/DELETE users + companies | `company_admin` | `ADMIN` | `null` | none | requireRole('admin') allowed for admin + DMs |
| `hvac_dm` | Same route access as admin (per `DM_ROLES` in auth.js); scope.js grants cross-resource access filtered by HVAC division; sidebar = full menu minus Users | `manager` | `HVAC` | `HVAC` | none | Treat as admin for route ACL; scope by HVAC |
| `solar_dm` | Same as hvac_dm scoped to SOLAR | `manager` | `SOLAR` | `SOLAR` | none | Route-admin, scope by SOLAR |
| `mep_dm` | Same as hvac_dm scoped to MEP | `manager` | `MEP` | `MEP` | none | Route-admin, scope by MEP |
| `hvac_pm` | Sidebar: Dashboard, Projects, Sales Orders, Stock, Checklist Template; scope: projects/enquiries/salesOrders/quotations filtered by HVAC division | `project_manager` | `PROJECTS` | `HVAC` | none | project_manager designation resolves to hvac_pm role by deriveRoleFromDesDep |
| `solar_pm` | Same as hvac_pm scoped to SOLAR | `project_manager` | `PROJECTS` | `SOLAR` | none | Same pattern |
| `mep_pm` | Sidebar: Dashboard, Projects, Sales Orders, Checklist Template (NO Stock — narrower than hvac/solar_pm) | `project_manager` | `PROJECTS` | `MEP` | none | Note the sidebar asymmetry — mep_pm currently lacks Stock; v3 target aligns all three |
| `engineer` | Sidebar: My Work, My Material; scope: projects filtered to `engs.includes(user.name)` (String match, not FK) | `engineer` | (varies by assignment) | (varies) | Optional: back-fill dept/division per assignment history | Keep name-string filter working via compat adapter until Project.accessList[] rollout |
| `service_eng` | Sidebar: My Service Jobs, My Material; scope: serviceCalls filtered to `eng === user.name` | `engineer` | `SERVICE` | `null` | none | Same name-string quirk; compat adapter preserves |
| `service_mgr` | Sidebar: Dashboard, Service Calls, AMC/PM, Stock; scope: sees company serviceCalls + contracts | `manager` | `SERVICE` | `null` | none | Cross-division within Service domain |
| `sales` | Sidebar: Dashboard, Enquiries, Sales Orders, Lost Enquiries | `executive` | `SALES` | `null` | Optional split into sales_manager vs sales_executive later | Existing users treated as sales_executive by default |
| `store` | Sidebar: full inventory sections; effective "Inventory Manager" | `manager` | `STORE` | `null` | Optional label rename to Inventory Manager in UI only | Enum name never changed |
| `accounts` | Sidebar: Dashboard, Pending Payments, Sales Orders | `executive` | `ACCOUNTS` | `null` | none | Financial destructive rules apply (no delete Invoice/Payment) |
| `viewer` | Sidebar: Dashboard, Reports; read-only | `viewer` | `ADMIN` | `null` | none | Read + Export only |

## Compatibility resolver (v3 side, read-only)

```
function resolveLegacy(user) {
  if (user.designation && user.department) {
    return { designation: user.designation, department: user.department, division: user.division };
  }
  return ROLE_TO_DESDEP[user.role] || { designation: 'viewer', department: 'ADMIN', division: null };
}
```

## What NOT to do

- Do NOT rename `role` values in v2 collections.
- Do NOT drop the ROLES enum.
- Do NOT let v3 pre-validate hook rewrite `role` from designation on save — this is deprecated for v3-created records; v3 sets role explicitly.
- Do NOT assume new engineers have a division set — must be explicit on creation.
- Do NOT treat mep_pm sidebar asymmetry as a bug in production — it is the current state; target v3 sidebar is what unifies.

## Known asymmetries (kept for record, corrected only in v3 target sidebars)

- `mep_pm` in v2 lacks `/inventory/stock` in sidebar; `hvac_pm` and `solar_pm` have it. Target v3 sidebar for all three PMs includes Stock (read).
- `engineer` and `service_eng` use name-string matching (`engs.includes(user.name)`, `eng === user.name`). Target v3 uses `accessList[]` and `assignedTo` FKs. Compat adapter preserves name-string fallback until Phase P3 rollout.
