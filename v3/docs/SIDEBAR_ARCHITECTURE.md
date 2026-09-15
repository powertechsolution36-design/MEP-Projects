# SIDEBAR ARCHITECTURE — v3 (rev 4)

> **📝 rev 9 addition — 2026-09-10.** Additive only. Clarified that PM's "Commercial" item and Accounts' "Finance" item cover Raise-to-Finance / Finance Work Items. See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Clarified Engineer's "My Work" as the universal checklist queue reused by Sales/Service/PM; renumbered Finance footnotes to §13.1. See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Clarified PM's "Material" item to include excess/return/transfer requests (report/request only); clarified Inventory Manager's "Material Control"/"Project Material" items to include tool custody, return verification, and transfer approval. No new top-level sidebar items. See `CHANGELOG.md` rev 11.

**Authority:** Navigation authority (see `DOCUMENT_AUTHORITY.md`).
**Rule:** Sidebar is view rendering; **backend independently enforces**. Sidebar hiding is NEVER a security mechanism.

Sidebar for target v3 is built dynamically from:
```
Company entitlement + Designation + Department + Permission
```
An unpurchased division must not appear in the target v3 sidebar under any condition.

---

## Part A — CURRENT V2 SIDEBAR (production baseline, read-only reference)

**File:** `v2/web/src/components/Shell.jsx` (contains `MENUS[role]` object) + `v2/web/src/components/AppShell.jsx` (super admin wrapper) + `v2/web/src/config/superAdminMenu.js` (super flat menu).

**Data shape:** `{ to, label, icon, end? }` per item.

Legacy role → menu:

| Legacy role | Items |
|---|---|
| `super` | Dashboard, Companies, Analytics, Revenue, Expiring, Client Locations, Reports (7) |
| `admin` | Dashboard, Enquiries, Sales Orders, Lost Enquiries, Projects, Service Calls, AMC/PM, Payments, Stock, Issue, Returns, Inventory Log, Users, Checklists (14) |
| `hvac_dm / solar_dm / mep_dm` | Dashboard, Customers*, Enquiries, Quotations*, Sales Orders, Lost Enquiries, Projects, Service Calls, AMC/PM, Payments, Stock, Issue Material, Checklists, Reports (14) |
| `sales` | Dashboard, Enquiries, Sales Orders, Lost Enquiries (4) |
| `hvac_pm / solar_pm` | Dashboard, Projects, Sales Orders, Stock, Checklist Template (5) |
| `mep_pm` | Dashboard, Projects, Sales Orders, Checklist Template (4) — no Stock |
| `engineer` | My Work, My Material (2) |
| `store` | Dashboard, Stock, Issue, Returns, Transfer, Categories & Locations, Transactions (7) |
| `service_mgr` | Dashboard, Service Calls, AMC/PM, Stock (4) |
| `service_eng` | My Service Jobs, My Material (2) |
| `accounts` | Dashboard, Pending Payments, Sales Orders (3) |
| `viewer` | Dashboard, Reports (2) |

*Items pointing to `/customers` and `/quotations` are broken in v2 — backend routes do not exist → currently redirect to `/`.

**No entitlement filter.** All items always show for the role, regardless of purchased divisions.

---

## Part B — TARGET V3 SIDEBAR (goal state — dynamic, entitlement-driven)

**Menu item shape:**
```
{ to, label, icon, requires: { modules?:[], divisions?:[], permissions?:[] } }
```

**Resolver:**
```
resolveSidebar(user, entitlements, permissions):
  base = DESIGNATION_MENU[user.designation]     // per-designation base list
  return base.filter(item =>
    (item.requires.modules?.every(m => entitlements.modules.includes(m)) ?? true) &&
    (item.requires.divisions?.some(d => entitlements.divisions.includes(d)) ?? true) &&
    (item.requires.permissions?.every(p => permissions.has(p)) ?? true)
  )
```

Server may also serve `GET /api/v3/me/sidebar` for a fully authoritative pre-computed menu.

### Target menus per designation

#### SUPER ADMIN (8 items)
Dashboard, Companies, Platform Users, Platform Analytics, Security, Platform Settings, System, Profile.

#### COMPANY ADMIN / MANAGER (up to 15 items — items marked with divisions[] appear only if purchased)
Dashboard, Approvals, Sales & CRM, Projects, Solar*, MEP*, HVAC*, Inventory & Procurement, Service & AMC, Finance, Reports, Team, Company Admin, Notifications, Profile.

#### SALES MANAGER (7 items)
Dashboard, Sales & CRM (team view), Sales Pipeline, Commercial, Reports (sales-scoped), Notifications, Profile.

#### SALES EXECUTIVE (6 items) — NEW in v3 target
Dashboard (own metrics), My Customers, My Enquiries, My Quotations, Notifications, Profile.
*(rev 10: "Dashboard" surfaces own assigned SALES-responsibility ChecklistInstanceItems — see `ACCESS_MATRIX.md` §13.2.)*

#### PROJECT MANAGER (8 items)
Dashboard, Projects (all packages cross-div), Material, Team, Commercial, Reports (project-scoped), Notifications, Profile.
*(rev 9: "Commercial" includes the "Raise to Finance" action on eligible payment milestones — see `ACCESS_MATRIX.md` §13.1. rev 10: "Projects" includes checklist template apply/assign/approve — see `ACCESS_MATRIX.md` §13.2. rev 11: "Material" includes reporting usage and submitting excess/return (`MaterialReturnRequest`) and transfer (`StockTransfer`) requests — report/request only, never a direct stock transaction — see `ACCESS_MATRIX.md` §13.3.)*

#### SOLAR MANAGER (8 items) — visible only when SOLAR in entitlements.divisions
Dashboard, Solar, Execution, Material (Solar+COMMON), Commercial, Reports (Solar), Notifications, Profile.

#### MEP MANAGER (8 items) — visible only when MEP purchased
Dashboard, MEP, Execution, Material (MEP+COMMON), Commercial, Reports (MEP), Notifications, Profile.

#### HVAC MANAGER (9 items) — visible only when HVAC purchased
Dashboard, HVAC, Execution, Material (HVAC+COMMON), HVAC Service, Commercial, Reports (HVAC), Notifications, Profile.

#### INVENTORY MANAGER (9 items)
Dashboard, Inventory, Material Control, Procurement, Vendors, Project Material, Reports (inv), Notifications, Profile.
*(rev 11: "Inventory" includes the Tool Custody register (issue/return/reissue); "Material Control" includes the Material Return verification queue and Stock Transfer approval/receipt queue; "Reports (inv)" includes the four-part rev 11 report — Reusable Assets, Project Material, Project-wise Material Cost, Employee Custody — see `ACCESS_MATRIX.md` §13.3, `DATABASE_ARCHITECTURE.md` rev 11.)*

#### SERVICE MANAGER (9 items)
Dashboard, Service, AMC, Assets, Engineers, Parts, Reports (service), Notifications, Profile.
*(rev 10: "Service" includes checklist-driven service execution — same engine as project checklists, `serviceCallId` parent — see `ACCESS_MATRIX.md` §13.2.)*

#### ENGINEER / TECHNICIAN (9 items) — mobile-first
My Dashboard, My Work, Department Work (division-scoped), Checklists (own), Reports (own daily), Material (own), Site, Notifications, Profile.
*(rev 10: "My Work" is the universal ChecklistInstanceItem queue — Today/Upcoming/Overdue/Completed, `GET /api/v3/me/work` — same component reused by Sales/Service/PM for their own assigned responsibilityType items; see `ACCESS_MATRIX.md` §13.2. rev 11: "Material (own)" includes reporting material usage and reporting condition/location of tools currently in own custody — never altering stock or custody status directly; see `ACCESS_MATRIX.md` §13.3.)*

#### ACCOUNTS / FINANCE (7 items)
Dashboard, Finance, Invoices, Payments, Reports (finance), Notifications, Profile.
*(rev 9: "Finance" includes the Finance Work Items queue — items PMs raised via "Raise to Finance" — see `ACCESS_MATRIX.md` §13.1.)*

#### VIEWER (4 items)
Dashboard, Reports, Notifications, Profile.

### Entitlement rule for target v3

- No unpurchased division may appear in any user's sidebar (backend also blocks).
- Solar-only company Company Admin sees Solar row; MEP/HVAC rows hidden.
- MEP+HVAC company Company Admin sees MEP and HVAC rows; Solar hidden.
- Division managers of a division not purchased **cannot exist as users** — `availableDesignations()` blocks creation.
- Legacy compatibility: if an existing user has designation resolving to a division not purchased (edge case from migration), the sidebar hides that division; the user is flagged for Super Admin review.

### Division selector

- 1 division purchased → NOT shown, division auto-locked.
- ≥2 divisions purchased → shown in top-bar for cross-division roles (Company Admin, Project Manager, Inventory Manager, Service Manager, Accounts).
- Locked for Solar/MEP/HVAC Managers (fixed to own division) and Engineers/Technicians (fixed to own dept).
- Selector is **view context only** — backend never trusts it without cross-checking entitlements.
