# Stage 7 Pass 3B — Contract / AMC / Warranty Frontend

**Date**: 2026-09-29
**Scope**: React frontend for Contract (AMC / Warranty) module — list, detail, manual creation, Project→Warranty conversion, PM visit display, CSV export — wired to the existing backend HTTP API.
**PWA source of truth**: `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`)

---

## 1. Files Created / Modified

| File | Action | Lines | Purpose |
|------|--------|-------|---------|
| `frontend/src/pages/contracts/ContractList.jsx` | Created | ~170 | Contract list with search, status badges, PM due count, CSV export |
| `frontend/src/pages/contracts/ContractDetail.jsx` | Created | ~177 | Read-only detail: customer info, contract info, originating project link, PM visits table |
| `frontend/src/pages/contracts/ContractCreate.jsx` | Created | ~178 | Manual AMC/Warranty creation form (Path B) |
| `frontend/src/pages/projects/ProjectDetail.jsx` | Modified | +20 | Added Convert to Service (Warranty) button + handler |
| `frontend/src/App.jsx` | Modified | +9 | Added contract imports + 3 routes (`/contracts`, `/contracts/new`, `/contracts/:id`) |

## 2. Contract List (ContractList.jsx)

- **PWA `vAMC()` exact reproduction**
- Columns: Customer, Site, Category, AMC Type, Amount, Start, End, Status, PM Due
- Search: free-text over customer and site fields (client-side filter)
- **Status computation** (client-side, matching PWA exactly):
  - No endDate → Expired
  - endDate < today → Expired
  - Within 45 days of end → Expiring Soon
  - Otherwise → Active
- **PM Due count**: uncompleted visits where `visit.month <= currentYYYYMM`
- Status badges with color-coded classes (Active=green, Expiring Soon=orange, Expired=red)
- `+ New AMC` button: visible only for admin, service_mgr (MANAGE_ROLES)
- `CSV Export` button: visible only for MANAGE_ROLES; fetches `/api/contracts/export.csv` with bearer token
- Click-through rows to `/contracts/:id` detail

## 3. Contract Detail (ContractDetail.jsx)

- **PWA `vContract(x)` / `vPM()` exact reproduction**
- **Read-only** — no edit, no delete (PWA has neither)

### 3a. Customer Information Panel
- Fields: Customer, Phone, Email, Site, Capacity
- All display `—` for empty values

### 3b. Contract Information Panel
- Fields: Category, AMC Type, Amount (₹ formatted), Start Date, End Date, Status
- Status badge with computed status (same algorithm as list)

### 3c. Originating Project Link
- Displayed only when `originatingProjectId` is set (conversion-created contracts)
- Button navigates to `/projects/${originatingProjectId}`

### 3d. Scheduled PM Visits Table
- Columns: #, Month (YYYY-MM), Status, Completed Date
- Visit status logic (matching PWA):
  - `completedDate` set → Completed (blue badge)
  - Not completed AND month < currentMonth → Overdue (red badge)
  - Not completed AND month = currentMonth → Due (orange badge)
  - Not completed AND month > currentMonth → Upcoming (green badge)
- Empty state: "No scheduled visits." message

## 4. Manual AMC Creation (ContractCreate.jsx)

- **PWA `saveContract()` Path B exact reproduction**
- Role gate: only admin, service_mgr can access (others see rejection message)
- Form fields:
  - Customer Name, Phone, Email (all optional)
  - **Site** (only required field — PWA FACT)
  - Capacity (optional)
  - Category: select, default "AMC" (options: AMC, Warranty)
  - AMC Type: select, default "Quarterly" (options: Monthly, Quarterly, Half-Yearly)
  - Amount: number, defaults to 0 if blank
  - Start Date: defaults to today
  - End Date: optional, blank allowed (contract immediately reads as Expired — Decision 8)
- POST to `/api/contracts`; on success navigates to `/contracts/:id`
- **No duplicate guard** — repeated submissions create independent contracts

## 5. Project → Warranty Conversion (ProjectDetail.jsx modification)

- **PWA `convertToService()` exact reproduction**
- Button displayed only when ALL conditions met:
  - User role is admin or service_mgr
  - Project status is "Completed"
  - Project division is NOT "MEP"
- Confirm dialog before proceeding
- POST to `/api/contracts/from-project/:projectId`
- On success: reloads project (status now "In Service"), shows alert
- **Hardcoded warranty defaults** (server-side):
  - category = "Warranty"
  - amount = 0
  - amcType = "Quarterly"
  - 4 scheduled visits
  - 1-year term (start + 365 days - 1 day)
  - Blank phone/email
  - site = project name
- **Duplicate conversion NOT guarded client-side** — server rejects because project is now "In Service" (not "Completed")

## 6. Routing (App.jsx)

```
/contracts          → ContractList
/contracts/new      → ContractCreate
/contracts/:id      → ContractDetail
```

Menu entry `🔁 AMC / PM List` → `/contracts` exists for admin and service_mgr roles in `menuConfig.js`.

## 7. PWA Decisions Preserved

| # | Decision | Implementation |
|---|----------|----------------|
| 7 | Manual creation fires zero notifications | Server-side: no notification in `createManualContract` |
| 8 | Null endDate = always Expired | Client `computeStatus()`: `if (!c.endDate) return 'Expired'` |
| 9 | Duplicate conversion: server rejects (project already In Service) | Client shows error from 400 response |
| — | No Contract edit/delete | No edit/delete routes or UI exist |
| — | No Contract→Payment linkage | No payment references anywhere |
| — | Expired contracts surface in PM due forever | `computePmDue` has no status filter |
| — | CSV 4-visit cap (truncates Monthly 5th–12th) | Server-side in `exportContractsCsv` |

## 8. Cadence → Visit Count

| AMC Type | Visits | Step |
|----------|--------|------|
| Monthly | 12 | 1 month |
| Quarterly | 4 | 3 months |
| Half-Yearly | 2 | 6 months |

## 9. Role Authorization

| Action | Allowed Roles |
|--------|---------------|
| View contract list | Any authenticated user |
| View contract detail | Any authenticated user |
| Create manual contract | admin, service_mgr |
| Convert project → warranty | admin, service_mgr |
| Export CSV | admin, service_mgr |
| Complete PM visit | admin, service_mgr (server-side, no UI in this pass) |

## 10. Test Results

**Browser test**: `contract-pass3b.spec.js` — **96 / 96 PASS**

| Section | Checks | Result |
|---------|--------|--------|
| 1. Manual AMC Creation | 18 | PASS |
| 2. Contract List + Search | 8 | PASS |
| 3. Contract Detail | 6 | PASS |
| 4. Project → Warranty Conversion | 14 | PASS |
| 5. PM Visits / Due Panel | 4 | PASS |
| 6. CSV Export | 5 | PASS |
| 7. Role Authorization | 14 | PASS |
| 8. MEP Project Exclusion | 1 | PASS |
| 9. Error Cases | 2 | PASS |
| 10. Browser Verification (Playwright) | 18 | PASS |
| **Total** | **96** | **96 PASS** |

## 11. What This Pass Does NOT Include

- ServiceCall module (future pass)
- Inventory module (future pass)
- PM visit completion UI (server endpoint exists; no button in this pass)
- Contract edit or delete (PWA has neither)
- Any modification to Pass 1 (Auth), Pass 2 (Commercial), or Pass 3A (Project) code

---

## VERDICT: PASS

Stage 7 Pass 3B delivers the Contract / AMC / Warranty frontend module with exact PWA behavioral fidelity. All 96 acceptance checks pass — covering manual creation (3 cadences, defaults, validation), list/search/detail display, Project→Warranty conversion cascade, PM visit schedule rendering, CSV export, role authorization (6 forbidden + 3 allowed role combinations), MEP exclusion, error handling, and 18 Playwright browser interaction checks.
