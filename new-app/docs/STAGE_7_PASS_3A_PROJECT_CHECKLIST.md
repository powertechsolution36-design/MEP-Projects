# Stage 7 Pass 3A — Project + Checklist Frontend

**Date**: 2026-09-28
**Scope**: React frontend for Projects module — list, detail with all sub-sections, wired to the existing backend HTTP API.
**PWA source of truth**: `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`)

---

## 1. Files Created / Modified

| File | Action | Lines | Purpose |
|------|--------|-------|---------|
| `frontend/src/pages/projects/ProjectList.jsx` | Created | 137 | Project list with search, CSV export, role-scoped filtering |
| `frontend/src/pages/projects/ProjectDetail.jsx` | Created | 1069 | Full detail view with all sub-sections |
| `frontend/src/App.jsx` | Modified | +4 | Added imports + routes for `/projects` and `/projects/:id` |
| `frontend/src/pages/enquiries/enquiry.css` | Modified | +5 selectors | Added `.proj-page`, `.proj-header`, `.proj-actions` to shared CSS |
| `backend/src/services/projectService.js` | Modified | +12 | Added `listEngineerCandidates()` function |
| `backend/src/routes/projectRoutes.js` | Modified | +6 | Added `GET /api/projects/engineer-candidates` route |

## 2. Project List (ProjectList.jsx)

- **PWA `vProjects()` exact reproduction**
- Columns: Project Name, Division, Stage, Status, Start, End
- Search: free-text over project fields + engineer names (server-side `?q=` param)
- Export CSV: button visible only for `admin`, `hvac_pm`, `solar_pm`, `mep_pm` (PROJECT_EXPORT_ROLES)
- **No "+ New Project" button** — PWA FACT: projects created ONLY via SalesOrder cascade
- Click-through to `/projects/:id` detail
- Stage/status badges with color classes

## 3. Project Detail (ProjectDetail.jsx)

### 3a. Identity Panel
- Fields: Name, Division, Customer, Site Type, Capacity, Start Date, End Date, Vendor, Checklist Template
- SO Link: button navigating to `/sales-orders/${proj.salesOrderId}`

### 3b. Stage & Status (Separate Fields)
- **Stage**: displayed with per-division dropdown for PM actions
  - HVAC: Planning → Piping → Installation → Testing → Finishing → Completed
  - Solar: Planning → Fabrication → Installation → Wiring → Net Metering → Completed
  - MEP: Concept → Design In Progress → Internal Review → Client Review → Delivered
- **Status**: displayed independently (Ongoing / Completed / In Service)
- Stage and status can diverge — preserved exactly per PWA

### 3c. Completion Gates
- Stage change to "Completed" (literal string check) triggers:
  - Pending returnable material check → `confirmPendingMaterial` flag
  - Incomplete/unapproved checklist check → `confirmIncompleteChecklist` flag
- Both overridable via confirm checkboxes in the stage-change modal
- MEP division NEVER reaches "Completed" — ends at "Delivered"

### 3d. Engineers Section
- Company-wide pool, not division-filtered
- ENGINEER_CANDIDATE_ROLES: `['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_eng']`
- Full-replace assignment (not additive)
- New backend endpoint: `GET /api/projects/engineer-candidates` → `{ candidates: [{id, name, role}] }`
- Multi-select modal with checkbox list

### 3e. Timeline Section
- Shows timeline status and `timelineReady` state
- `timelineReady = !!project.timelineSet && (at least one checklist point has a targetDate)`
- Partial-date handling: `confirmPartialDates` flag when not all points have dates
- Set/edit target dates for each checklist point plus project startDate

### 3f. Checklist Section
Full table with columns: #, Done, Text, Sign Responsibility, Target Date, Approved, PM Signed, Actions

- **Tick (Done checkbox)**: disabled when `!timelineReady` — gate is project-level, NOT per-point targetDate
- **Remark**: modal with textarea, visible to isPmOrAssignedEngineer
- **Photo**: file input → FileReader → base64 data URI upload
- **Approve**: modal with approverName (for CLIENT role), approvalRemark, signatureImage
  - SIGN_ROLES: ENGINEER→[engineer, hvac_pm, solar_pm, mep_pm, admin], CLIENT→[engineer, hvac_pm, solar_pm, mep_pm, service_eng, admin], SALES→[sales, admin], SERVICE→[service_mgr, service_eng, admin]
  - PM is dead/unreachable in sign roles
- **PM Counter-sign**: bare one-way boolean, no undo, no metadata
  - Visible when isPM && done && approved && !pmSigned
- **Add/Edit/Remove Point**: PM-only, edit/remove only when !done
- **Apply Template**: PM-only, replace or append mode

### 3g. Execution Updates
- Append-only list (reversed for newest-first display)
- 5 fields: date (auto-set), actionDone (required), nextAction, nextActionDate, enteredByUserId
- No edit/delete capability — PWA exact
- Add Update modal for isPmOrAssignedEngineer

### 3h. Delivery Challans
Full CRUD table:

- **Create**: multi-item form (+ Add Row), per-project numbering, fields: date, items[{materialName, quantity, unit, returnable}], receivedByName, remark
- **Edit**: single-item edit modal
- **Delete**: with confirm dialog
- **Return**: quantity input for returnable items only, returnedQuantity increments (never decrements), clamped to quantity
- **CSV Export**: per-project DC export

## 4. Role Gates

| Action | Required Role |
|--------|--------------|
| View project list | Any authenticated (PM roles scoped to own division) |
| View project detail | Any authenticated same-company user |
| Change stage | isPM (admin or matching-division PM) |
| Edit vendor | isPM |
| Assign engineers | isPM |
| Set/edit timeline | isPM |
| Add/edit/remove checklist point | isPM |
| Apply checklist template | isPM |
| Tick checklist item | isPmOrAssignedEngineer (+ timelineReady gate) |
| Add remark | isPmOrAssignedEngineer |
| Upload photo | isPmOrAssignedEngineer |
| Approve checklist item | Role matching SIGN_ROLES[signResponsibility] |
| PM counter-sign | isPM |
| Add execution update | isPmOrAssignedEngineer |
| Create/edit/delete DC | isPmOrAssignedEngineer |
| Record DC return | isPmOrAssignedEngineer |
| Export CSV (list) | admin, hvac_pm, solar_pm, mep_pm |

## 5. PM Division Mapping

| Role | Division |
|------|----------|
| hvac_pm | HVAC |
| solar_pm | Solar |
| mep_pm | MEP |
| admin | All (no division restriction) |

## 6. API Endpoints Used (Frontend → Backend)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects` | List (with `?q=` search) |
| GET | `/api/projects/:id` | Detail |
| GET | `/api/projects/engineer-candidates` | Engineer pool (NEW) |
| GET | `/api/projects/export.csv` | List CSV export |
| POST | `/api/projects/:id/stage` | Change stage |
| PATCH | `/api/projects/:id/vendor` | Edit vendor |
| POST | `/api/projects/:id/engineers` | Assign engineers |
| POST | `/api/projects/:id/timeline` | Save timeline |
| POST | `/api/projects/:id/checklist/:i/tick` | Tick/untick |
| PATCH | `/api/projects/:id/checklist/:i/remark` | Set remark |
| POST | `/api/projects/:id/checklist/:i/photos` | Upload photo |
| POST | `/api/projects/:id/checklist/:i/approve` | Approve |
| POST | `/api/projects/:id/checklist/:i/pm-sign` | PM counter-sign |
| POST | `/api/projects/:id/checklist` | Add point |
| PATCH | `/api/projects/:id/checklist/:i` | Edit point |
| DELETE | `/api/projects/:id/checklist/:i` | Remove point |
| POST | `/api/projects/:id/checklist/apply` | Apply template |
| PATCH | `/api/projects/:id/checklist/:i/target-date` | Set target date |
| POST | `/api/projects/:id/updates` | Add execution update |
| POST | `/api/projects/:id/delivery-challans` | Create DC |
| PATCH | `/api/projects/:id/delivery-challans/:i` | Edit DC item |
| DELETE | `/api/projects/:id/delivery-challans/:i` | Delete DC item |
| POST | `/api/projects/:id/delivery-challans/:i/return` | Record return |
| GET | `/api/projects/:id/delivery-challans/export.csv` | DC CSV export |
| GET | `/api/projects/:id/report` | Project report |
| GET | `/api/projects/:id/report/export.csv` | Report CSV |

## 7. Routing (App.jsx)

```
/projects          → ProjectList
/projects/:id      → ProjectDetail
```

Replaced `<ComingSoon title="Projects" />` stub.

## 8. CSS (enquiry.css shared styles)

Added `.proj-page`, `.proj-header`, `.proj-actions` to all shared selector groups:
- Page container (max-width: 1200px)
- Header flex layout
- Header h2 margin reset
- Actions flex layout
- Responsive breakpoint (640px)

## 9. Backend Addition: Engineer Candidates Endpoint

**Problem**: `GET /api/users` is admin-only, but PM roles need to see engineer candidates for assignment.

**Solution**: New `GET /api/projects/engineer-candidates` endpoint:
- Added `listEngineerCandidates()` to `projectService.js`
- Filters company users by ENGINEER_CANDIDATE_ROLES
- Returns `{ candidates: [{id, name, role}] }`
- Accessible to any authenticated user (scoped to own company)
- Placed BEFORE `/:id` catch-all route in `projectRoutes.js`

## 10. What Was NOT Implemented (Explicit Exclusions)

- ❌ Checklist Templates CRUD (separate module, not in this pass)
- ❌ Contract / AMC / Warranty (Pass 3B scope)
- ❌ Service Calls (future pass)
- ❌ Inventory (future pass)
- ❌ Photo viewer UI (photos stored as base64, display is a future enhancement)
- ❌ Signature drawing canvas (signatureImage accepted as text/base64)

## 11. PWA Behavior Preserved Exactly

1. No "+ New Project" button — projects only via SO cascade
2. Stage/status as separate, independently-changing fields
3. Timeline partial-date behavior with `confirmPartialDates`
4. `timelineReady` calculation: `!!timelineSet && projPlanned > 0`
5. Checklist tick blocked when timeline not ready (project-level gate, not per-point)
6. Engineer pool is company-wide (not division-filtered)
7. Engineer assignment is full-replace (not additive)
8. Execution updates are append-only (no edit/delete)
9. PM counter-sign is bare one-way boolean (no undo, no metadata)
10. Delivery challan per-project numbering (max+1)
11. Return quantity increments (never decrements), clamped to quantity
12. Completion gate: literal "Completed" string check, confirmation flags for both pending material and incomplete checklist
13. MEP division never reaches "Completed" status
14. PM scoping: PM roles see only their division in list; all roles see all in detail
15. SIGN_ROLES map exactly as PWA (PM is dead/unreachable)

## 12. Test Results

### Backend Sequential Tests
```
373 / 373 PASS
```

### Frontend Build
```
46 modules transformed
dist/assets/index-QOMlRcPB.js  374.54 kB │ gzip: 109.59 kB
✓ built in 2.68s
```

### Browser Journey (Playwright, 38 checks)
```
✅ 1. Project list shows cascade-created project
✅ 2. Project row has division HVAC
✅ 3. Project row has initial stage Planning
✅ 4. No New Project button (PWA exact)
✅ 5. Project detail loads
✅ 6. Detail shows Division
✅ 7. Stage and Status shown separately
✅ 8. SO link/reference present
✅ 9. Stage change API (Planning→Piping)
✅ 10. UI reflects new stage Piping
✅ 11. Vendor update API
✅ 12. Engineer candidates endpoint
✅ 13. Engineer assignment
✅ 14. Add checklist point
✅ 15. Second checklist point
✅ 16. Set target date on checklist point
✅ 17. Save timeline (timelineSet=true)
✅ 18. Tick checklist item (timeline ready)
✅ 19. Remark on checklist item
✅ 20. Approve checklist item
✅ 21. PM counter-sign
✅ 22. Add execution update
✅ 23. Second update appended
✅ 24. Create delivery challan
✅ 25. Edit delivery challan
✅ 26. Return material on DC
✅ 27. Completion gate with confirm flags
✅ 28. Delete delivery challan
✅ 29. PM scoping — hvac_pm sees only HVAC
✅ 30. Projects CSV export
✅ 31. Project report endpoint
✅ 32. Detail shows Checklist section
✅ 33. Detail shows Updates section
✅ 34. Detail shows Delivery Challan section
✅ 35. Detail shows vendor
✅ 36. Search filters projects
✅ 37. Engineer can view project detail
✅ 38. Sales role sees project list

TOTAL: 38  |  ✅ 38  |  ❌ 0
```

## 13. Seed Data Note

The dev server seeds users and company only — NO project seed data exists. Projects are created exclusively via the SalesOrder cascade:
1. Create Enquiry (sales role, segment=HVAC/Solar/MEP/AMC)
2. Convert Enquiry → SalesOrder (admin or sales role)
3. Cascade creates: SalesOrder + Project + Payments
4. Project inherits: name, division (AMC→HVAC), customer from SO contacts[0].name, checklist from division default template

## 14. Infrastructure-Only Differences from PWA

- MongoDB/ObjectIds for document storage (vs localStorage)
- Hashed credentials for authentication
- Tenant isolation via companyId-from-session-only
- Server-side authorization (role checks in service layer)
- Durable counters for DC numbering (vs max+1 in-memory)

## 15. Known Limitations

- Photo upload sends base64 data URI via JSON — no binary upload or S3 storage
- Signature image in approval is a text field — no drawing canvas
- Checklist template application requires a templateId — template CRUD is a separate module
- No real-time updates between users (standard request/response pattern)

## 16. Dependency Chain

```
Stage 6 (Backend API) → Stage 7 Pass 1 (Auth + Shell) → Pass 2 (Enquiry/SO/Payment frontend)
→ Pass 3A (Project + Checklist frontend) [THIS PASS]
→ Pass 3B (Contract frontend) [NEXT, NOT STARTED]
```

## 17. FIX Log

No fixes were required during this pass. All backend API contracts matched the frontend implementation.

New backend endpoint added: `GET /api/projects/engineer-candidates` — this is an infrastructure addition (not a PWA behavior change) to support the frontend engineer-assignment modal without requiring admin-level access to the full users list.
