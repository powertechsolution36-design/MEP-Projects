> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.
>
> **📝 rev 9 addition — 2026-09-10.** Additive only. Added `FinanceDashboard.jsx` (Accounts/Finance — previously undefined) + Payment Milestone widgets on Project Control Dashboard. See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Added the universal "My Work" queue (Field Dashboard), Checklist Approval Queue + Overdue widgets (Project Control), and SALES/SERVICE checklist widgets (Sales/Service Dashboards). See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Added PM-facing material excess/return/transfer request widgets (Project Control Dashboard) and Tool Custody + Material Return Queue widgets (Inventory Dashboard). See `CHANGELOG.md` rev 11.

---

# MEP PROJECTS — Target Dashboard Architecture

**Generated:** 2026-08-28
**Purpose:** Define role-based dashboard experiences; identify reusable components; plan additions
**⚠️ Planning only — Dashboard.jsx and Charts.jsx not modified. Visual style preserved.**

---

## 1. Current Dashboard Architecture (v2)

**File:** `v2/web/src/pages/Dashboard.jsx` (151 lines) — single component for all roles
**Charts:** `v2/web/src/components/Charts.jsx` (118 lines) — pure SVG (no external chart lib)

**Building blocks:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `<Stat>` | inline in Dashboard.jsx | KPI card with icon + label + value + colored left border |
| `<DonutChart>` | Charts.jsx | SVG donut with optional center label |
| `<BarChart>` | Charts.jsx | Horizontal bar chart |
| `<LineChart>` | Charts.jsx | Trend/time-series line |
| `<ReportDownload />` | components/ReportDownload.jsx | Modal for downloading reports |
| `<ResponsibilitiesCard />` | components/ResponsibilitiesCard.jsx | Static role responsibilities panel |
| `countBy()` | inline util | Group array by field, return `{label, value}[]` |

**STAT_DEFS registry** (22 pre-defined stats):
- companies, users, projects, projectsActive, projectsPlanning, projectsCompleted
- serviceCalls, contracts, payments, paymentsPending, paymentsPaid
- enquiries, enquiriesNew, salesOrders, salesOrdersTotal
- inventory, lowStock, invIssues, invValue
- myProjects, myChecklistItems, myCallsOpen, myCallsClosed, myCallsUrgent

**Role-based stat selection:** uses `ROLE_DASHBOARD[role]` from `utils/responsibilities.js` which returns an array of stat keys.

**Chart selection logic:** 
- All non-engineer roles get charts based on `ROLE_MODULES[role]` check
- Charts iterate over: projects, service calls, enquiries, payments, inventory issues
- Engineer/service_eng get **filtered projects/calls** (only own)

**Data source:**
- All data comes from Zustand `useStore` state
- Loaded via single `/api/bulk` call at login
- WebSocket keeps state fresh
- **No dedicated dashboard API endpoint** — everything is computed client-side

**Layout:**
- CSS classes: `stat-grid`, `stat-card`, `stat-icon`, `stat-value`, `chart-grid`
- Emoji icons for stats
- Colors: 8 hard-coded hex values (`#0891b2`, `#1d9e5f`, `#d92b2b`, etc.)
- Section: `<h2>Dashboard</h2>` + optional `(All Companies)` badge for super
- Header includes `<ReportDownload />` and `<ResponsibilitiesCard />`

**Limitations of current implementation:**
1. Single component; role logic sprinkled inline
2. All 15+ resources loaded even for viewer role (heavy for engineers on mobile)
3. No time-series widgets (LineChart exists but not used in Dashboard.jsx)
4. No approval queue, alerts, SLA breach, or workflow status widgets
5. No drill-down (cards are static; click doesn't navigate)
6. No engineer mobile-first layout
7. Charts fixed at ~180px width — not responsive
8. `myProjects` uses name-match (`engs.includes(user.name)`) — fragile on rename

---

## 2. Target Dashboard Architecture (v3)

Each designation gets a **separate dashboard component** that composes reusable widgets. All continue using the current visual language (Stat cards + Charts.jsx components + CSS classes).

### **Platform Dashboard** (Super Admin) → `pages/dashboards/PlatformDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Companies | Company.find().count | Stat |
| Active Companies | Company where !disabled | Stat |
| Users | User.find().count | Stat |
| Platform Usage | Aggregate active sessions / API hits (needs new metric) | Line chart |
| Projects | Project across all tenants | Stat |
| Platform Sales | Sum SalesOrder.total across tenants | Stat |
| Security | Recent audit events (needs Audit model) | List (top 10) |
| System Health | Server uptime, DB status | Traffic-light card |
| Backups | Last backup ts + size | Info card |
| API Health | Request rate, error rate, latency (needs new metrics) | Line chart |

### **Business Dashboard** (Company Admin / Manager) → `pages/dashboards/BusinessDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Sales Pipeline | Enquiry by status funnel | Bar chart |
| Orders Won | SalesOrder count + total | Stat + delta vs prev period |
| Active Projects | Project where status='active' | Stat |
| Outstanding | Payment.amount - sum(paid[]) where !paid | Stat (currency) |
| Expected Profit | Sum(SalesOrder.total - estimated cost) | Stat |
| Service Calls | Open service calls | Stat |
| AMC Value | Sum active contracts.value | Stat |
| Inventory Value | Sum(qty × rate) | Stat |
| Department Performance | Bar per division of orders/projects | Bar chart |
| Approvals | Count pending approvals across resources | Stat + list |
| Critical Alerts | Overdue payments, expired AMCs, SLA breaches | Alert list |
| Project Health | Green/Amber/Red per project | Traffic-light grid |

### **Sales Dashboard** → `pages/dashboards/SalesDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| New Enquiries | Enquiry where status='new' | Stat |
| Hot Leads | Enquiry where value ≥ threshold + status IN(contacted,quoted) | Stat |
| Quotation Value | Sum Quotation.total where status='sent' | Stat |
| Negotiation Value | Sum where status='negotiation' | Stat |
| Expected Orders | Sum where status='accepted' pending SO | Stat |
| Won | Enquiry.status='won' count | Stat |
| Lost | Enquiry.status='lost' count | Stat |
| Conversion | Won / Total × 100 | Percentage |
| Sales Funnel | New → Contacted → Quoted → Negotiation → Won/Lost | Funnel |
| Follow-ups | Enquiry with `nextAction.at <= today` | List (top 10) |
| Top Opportunities | Enquiry sorted by value desc | List (top 5) |
| Salesperson Performance | Group by owner: won/lost/pipeline | Bar chart |
| Lost Business | Sum lost value, group by reason | Donut |
| My Checklist Tasks (rev 10) | ChecklistInstanceItem where assignedUserId=user && responsibilityType='SALES' | Stat + list (links to `/me/work`) |

### **Project Control Dashboard** (Project Manager) → `pages/dashboards/ProjectControlDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Active Projects | Project.status='active' | Stat |
| Delayed Projects | target < today && status != 'completed' | Stat (red) |
| Tasks Due | Task where plannedEnd within 7d (rev 10: superseded by "Overdue Checklist Items" below for checklist-specific work) | Stat |
| Overdue Tasks | Task past plannedEnd | Stat (red) |
| Material Shortages | InvIssue where required qty > available | Stat |
| RFI Pending | (new model) RFI where status='open' | Stat |
| Submittals Pending | (new model) Submittal where status='pending' | Stat |
| Project Progress | Per project % complete | Bar chart |
| Project Health | G/A/R per project | Traffic-light |
| Engineer Workload | Count assigned tasks per engineer | Bar chart |
| Blockers | Projects marked meta.blocked=true | List |
| Project Financial Snapshot | Value / cost / margin per project | Table |
| Payment Milestones Eligible (rev 9) | SalesOrder.paymentMilestones where status='eligible' for own projects | Stat + list (with "Raise to Finance" action button) |
| Finance Work Items Raised (rev 9) | FinanceWorkItem where requestedBy=user && status != resolved | Stat |
| Checklist Approval Queue (rev 10) | ChecklistInstanceItem where status='SUBMITTED' && approver=user (own projects) | Stat + list (Approve/Reject action buttons) |
| Checklist Progress by Package (rev 10) | ChecklistInstance.progressPct grouped by ProjectPackage | Bar chart |
| Overdue Checklist Items (rev 10) | ChecklistInstanceItem where targetDate < today && !completed, own projects | Stat (red) + list |
| My Material Return Requests (rev 11) | MaterialReturnRequest where requestedBy=user | Stat + list (status per request; declared vs. verified once actioned) |
| My Stock Transfer Requests (rev 11) | StockTransfer where requestedBy=user (source or destination) | Stat + list |
| Tools in Custody (rev 11) | ToolCustody where projectId=own project && status='AT_PROJECT' | List (report condition action) |

### **Solar Dashboard** → `pages/dashboards/SolarDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Active Solar Projects | Project where div='Solar' && status='active' | Stat |
| Installed Capacity | Sum project.meta.capacityKW where status='completed' | Stat (kW) |
| Under Installation | Project where meta.phase='installation' | Stat |
| Material Pending | InvIssue for solar projects with pending items | Stat |
| Inspection Pending | Project where meta.phase='inspection' | Stat |
| Testing Pending | Project where meta.phase='testing' | Stat |
| Commissioning Pending | Project where meta.phase='commissioning' | Stat |
| Completed | status='completed' | Stat |
| Solar Project Value | Sum(project.value where div='Solar') | Stat |
| Site Survey | List of upcoming surveys | List |
| Installation Progress | Per project % | Bar |
| Testing | Per project test results | Table |
| Commissioning | Ready-to-commission list | List |

### **MEP Dashboard** → `pages/dashboards/MepDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Active MEP Projects | div='MEP' && status='active' | Stat |
| Electrical Projects | trade='Electrical' | Stat |
| Plumbing Projects | trade='Plumbing' | Stat |
| Fire Fighting Projects | trade='Fire' | Stat |
| Pending Drawings | (new) DrawingLog where status='pending' | Stat |
| Material Shortage | InvIssue with pending qty | Stat |
| RFI Pending | RFI on MEP projects | Stat |
| Testing Pending | Project phase='testing' | Stat |
| Commissioning | Ready-to-commission MEP list | List |
| Discipline-wise Progress | Progress per sub-trade | Bar chart |

### **HVAC Dashboard** → `pages/dashboards/HvacDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Active HVAC Projects | div='HVAC' && status='active' | Stat |
| HVAC Project Value | Sum(value) | Stat |
| Piping Jobs | trade='Piping' | Stat |
| Installation | phase='installation' | Stat |
| Pressure Testing Pending | test.pressure='pending' | Stat |
| Vacuum Testing Pending | test.vacuum='pending' | Stat |
| Leak Testing Pending | test.leak='pending' | Stat |
| Testing Pending | phase='testing' | Stat |
| Commissioning | phase='commissioning' | Stat |
| VRF | trade='VRF' | Stat |
| Ducting | trade='Ducted' | Stat |
| Piping | trade='Piping' | Stat |
| HVAC Technical Issues | list of open technical logs | List |

### **Inventory Dashboard** → `pages/dashboards/InventoryDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Stock Value | Sum(qty × rate) | Stat |
| Total Items | InvItem.count | Stat |
| Low Stock | qty <= minQty && minQty > 0 | Stat |
| Critical Stock | qty <= 0.5×minQty | Stat (red) |
| Material Requests | (new) MaterialRequest where status='pending' | Stat |
| Pending PO | (new) PurchaseOrder where status='sent' && !received | Stat |
| Pending GRN | (new) GRN where status='draft' | Stat |
| Issued Today | InvIssue where createdAt >= today | Stat |
| Returned Today | InvIssue returnRequests.at >= today | Stat |
| Project Material Demand | Sum required qty across active projects | Bar chart per item |
| Procurement Pipeline | RFQ→PO→GRN funnel | Funnel |
| Warehouse Movement | InvTransaction last 30 days | Line chart |
| Material Return Verification Queue (rev 11) | MaterialReturnRequest where status='SUBMITTED' or 'UNDER_REVIEW' | Stat + list (Verify action — declared vs. entered-verified quantities side by side) |
| Stock Transfer Queue (rev 11) | StockTransfer where status='REQUESTED' | Stat + list (Approve/Verify-receipt actions) |
| Tool Custody Register (rev 11) | ToolCustody grouped by status | Donut + table (by tool, by custodian) |
| Overdue Tool Returns (rev 11) | ToolCustody where expectedReturnDate < today && status != 'RETURNED' | Stat (red) + list |

**Reporting (rev 11, four-part — see `DATABASE_ARCHITECTURE.md` rev 11 addendum):** Reusable Assets report, Project Material report, Project-wise Material Cost report, Employee Custody report — all read-side aggregations, no new source of truth.

### **Service Dashboard** → `pages/dashboards/ServiceDashboard.jsx`
| Widget | Source | Type |
|--------|--------|------|
| Open Calls | ServiceCall.status != 'closed' | Stat |
| Urgent Calls | priority='urgent' && !closed | Stat (red) |
| Today's Visits | scheduled = today | Stat |
| Overdue Calls | scheduled < today && !closed | Stat |
| AMC Visits Due | Contract.svcs where due <= today+7 && !done | Stat |
| AMC Expiring | Contract.end <= today+30 | Stat |
| SLA | avg (closedAt - createdAt) — needs SLA target | Gauge |
| Engineer Utilization | Assigned calls per engineer | Bar chart |
| Service Status | ServiceCall by status | Donut |
| Engineer Workload | Open calls per engineer | Bar chart |
| AMC Calendar | Upcoming visits list | Calendar/list |
| Parts Waiting | (new) Parts request where status='pending' | Stat |
| Customer Complaints | ServiceCall where type='complaint' | List |
| Service Checklist Approvals (rev 10) | ChecklistInstanceItem where status='SUBMITTED' && serviceCallId set, own scope | Stat + list |

### **Finance Dashboard** (Accounts/Finance) → `pages/dashboards/FinanceDashboard.jsx` *(rev 9 — new; no v2/v3 dashboard previously defined for this role)*
| Widget | Source | Type |
|--------|--------|------|
| Finance Work Items Queue | FinanceWorkItem where status in [open,claimed,in_progress] | List (with Claim/Resolve action buttons) |
| Outstanding | Payment.amount - sum(paid[]) where !paid | Stat (currency) |
| Overdue Invoices | Invoice.dueDate < today && status != paid | Stat (red) |
| Payments Recorded Today | Payment created today | Stat |
| Receivables by Customer | Grouped outstanding per customer | Table |
| Reconciliation Watch | SO/PO/GRN flagged for reconciliation review | List |

Scope: same co+division scoping as `scopeFilterV3` in `API_ARCHITECTURE.md` §7 (Accounts sees all purchased divisions, never Checklist/Task/ProjectPackage data).

### **Field Dashboard** (Engineer/Technician) → `pages/dashboards/FieldDashboard.jsx`
**Mobile-first, simpler layout, larger touch targets.**

| Widget | Source | Type |
|--------|--------|------|
| My Work (rev 10) | `GET /api/v3/me/work` — ChecklistInstanceItem where assignedUserId=user, grouped Today/Upcoming/Overdue/Completed | Stack list (the canonical "My Work" queue — see `DATABASE_ARCHITECTURE.md`/`BUSINESS_WORKFLOWS.md` rev 10) |
| Service Calls | ServiceCall.eng = user.name && !closed | Stat + list |
| Overdue Checklist Items (rev 10) | ChecklistInstanceItem where targetDate < today && !completed && assignedUserId=user | Stat (red) |
| Pending Reports | Daily report not submitted for today | Stat (red if missing) |
| Material Requests | Own InvIssue in-progress | Stat |
| Today's Work | Ordered chronologically | Time-based list |
| Start Work | Big button → clock-in | Action button |
| Upload Photos / Evidence (rev 10) | File picker → attach to ChecklistInstanceItem.evidence[] | Action button |
| Checklist | Quick-open list → item detail (submit/remark/evidence) | Action button |
| Daily Report | Form to submit today's work | Action button |

**Layout for Field Dashboard:**
- Single column on mobile (< 768px)
- Larger fonts, 44px+ touch targets
- Sticky action buttons at bottom
- No charts (heavy on mobile) — replace with progress bars

---

## 3. Reusable Components to Keep

**No visual changes; import and reuse as-is:**

| Component | Reuse Because |
|-----------|---------------|
| `<Stat>` (inline) | Extract to `components/StatCard.jsx` — used by every dashboard |
| `<DonutChart>` | 4 dashboards need donut |
| `<BarChart>` | 8 dashboards need bar |
| `<LineChart>` | Time-series for platform + procurement + service |
| `<ReportDownload />` | Every dashboard header |
| `<ResponsibilitiesCard />` | Onboarding tooltip on each dashboard |
| `countBy()` util | Extract to `utils/dashboardHelpers.js` |
| CSS classes: `.stat-card, .stat-value, .stat-icon, .chart-grid, .stat-grid` | Keep |

**Extract into new lightweight components (v3):**
- `<KpiCard>` — Stat with delta indicator (up/down %)
- `<AlertList>` — Compact list of alerts with severity badges
- `<TrafficLightGrid>` — G/A/R per row (project health)
- `<Funnel>` — Sales funnel horizontal
- `<GaugeChart>` — SLA gauge (0-100%)
- `<CalendarList>` — Upcoming events (AMC visits)
- `<ProgressBar>` — For engineer mobile
- `<ActionButton>` — Large touch-friendly button for engineer

---

## 4. Components That Need To Be Added

**New chart components:**
- `<Funnel>` — SVG funnel (stages with counts)
- `<GaugeChart>` — SVG semicircle gauge
- `<HeatmapCalendar>` — Weekly grid of visits

**New widget components:**
- `<KpiCard>` — Stat + delta % + sparkline
- `<AlertList>` — `{ items: [{ severity, title, at, link }] }`
- `<TrafficLightGrid>` — For project health
- `<CalendarList>` — Compact upcoming events
- `<ApprovalQueue>` — Pending approvals with 1-click approve/reject
- `<TopList>` — Top N items with value bars

**New dashboard page components (11 — rev 9 adds FinanceDashboard):**
- `PlatformDashboard.jsx`
- `BusinessDashboard.jsx`
- `SalesDashboard.jsx`
- `ProjectControlDashboard.jsx`
- `SolarDashboard.jsx`
- `MepDashboard.jsx`
- `HvacDashboard.jsx`
- `InventoryDashboard.jsx`
- `ServiceDashboard.jsx`
- `FieldDashboard.jsx` (engineer)
- `FinanceDashboard.jsx` (accounts — rev 9)

**Router in `pages/Dashboard.jsx` (v3):**
- Detects `user.role/designation` → renders correct component
- Keeps single `/` route

---

## 5. Required API Endpoints

**Existing `/api/bulk`** — keep for backward-compat but insufficient for target dashboards (too heavy on Field, missing time-series/aggregates).

**New endpoints (all under `/api/v3/dashboard/*`):**

| Endpoint | Returns |
|----------|---------|
| `GET /api/v3/dashboard/platform` | Super admin metrics (companies, users, health, backups, api stats) |
| `GET /api/v3/dashboard/business` | Company admin snapshot |
| `GET /api/v3/dashboard/sales` | Sales widgets (funnel, follow-ups, top opps) |
| `GET /api/v3/dashboard/projects` | Project mgr snapshot |
| `GET /api/v3/dashboard/solar` | Solar-scoped |
| `GET /api/v3/dashboard/mep` | MEP-scoped |
| `GET /api/v3/dashboard/hvac` | HVAC-scoped |
| `GET /api/v3/dashboard/inventory` | Inventory + procurement |
| `GET /api/v3/dashboard/service` | Service + AMC calendar |
| `GET /api/v3/dashboard/field` | Engineer's tasks + reports + material (mobile-optimized) |
| `GET /api/v3/dashboard/approvals` | Pending items across all resources for current user |
| `GET /api/v3/dashboard/alerts` | Critical alerts (overdue, expiring, SLA breach) |
| `GET /api/v3/dashboard/trend?metric=&window=` | Time-series for line charts |

Each response is **role-scoped by the requesting user** using `scopeFilter` and `req.user`. Response includes only what that dashboard needs — reduces payload dramatically for engineers on mobile.

---

## 6. Required Database Calculations

**Aggregations needed (MongoDB pipelines):**

| Calc | Model | Formula |
|------|-------|---------|
| Sales pipeline value | Enquiry | `$sum: value` grouped by status |
| Sales funnel counts | Enquiry | `$group: {_id: status, count: $sum:1}` |
| Conversion rate | Enquiry | `won / (won + lost) × 100` |
| Outstanding amount | Payment | `sum(amount) - sum(paid.amt)` where !paid |
| Expected profit | SalesOrder | `sum(total) - sum(project.meta.estimatedCost)` |
| Inventory value | InvItem | `$sum: {$multiply: [qty, rate]}` |
| Low stock count | InvItem | `qty ≤ minQty && minQty > 0` |
| Critical stock count | InvItem | `qty ≤ 0.5 × minQty` |
| Project delayed | Project | `target < now() && status != 'completed'` |
| SLA (avg close time) | ServiceCall | `avg(closedAt - createdAt)` where closed |
| AMC visits due 7d | Contract | `svcs[].due <= now+7 && !done` |
| Engineer utilization | ServiceCall | `count(assigned per eng) / max` |
| Warehouse movement | InvTransaction | `$dateTrunc: day, $sum: qty` last 30 days |
| Sub-trade progress | Project | avg(chk.done count) grouped by trade |

**New models for calculations (v3):**
- `MaterialRequest` — for "Material Requests" widget
- `PurchaseOrder` — for "Pending PO"
- `GRN` — for "Pending GRN"
- `RFI` — for "RFI Pending"
- `Submittal` — for "Submittals Pending"
- `Drawing` — for "Pending Drawings"
- `DailyReport` — for engineer's daily report submission
- `SLATarget` — per-company SLA config
- `SystemMetric` — for platform health/API stats (or use external monitoring)

**Caching:** Dashboard endpoints should cache aggregates for 30-60 seconds (Redis or in-process) — otherwise every reload triggers heavy MongoDB pipelines.

---

## 7. Role / Designation Logic

**Dashboard selection (in v3 `Dashboard.jsx`):**

```
function pickDashboard(user):
  if user.role == 'super' → PlatformDashboard
  if user.role == 'admin' or user.designation == 'company_admin' → BusinessDashboard
  if user.designation == 'sales_manager' or user.role == 'sales' → SalesDashboard
  if user.designation == 'project_manager' and no division → ProjectControlDashboard
  if user.role == 'solar_dm' or (designation='manager' and dept='SOLAR') → SolarDashboard
  if user.role == 'mep_dm' or (designation='manager' and dept='MEP') → MepDashboard
  if user.role == 'hvac_dm' or (designation='manager' and dept='HVAC') → HvacDashboard
  if user.role == 'store' or user.designation == 'inventory_manager' → InventoryDashboard
  if user.role == 'service_mgr' → ServiceDashboard
  if user.designation in [engineer, technician, senior_engineer] → FieldDashboard
  if user.role == 'accounts' or (designation='executive' and dept='ACCOUNTS') → FinanceDashboard   # rev 9
  else → BusinessDashboard (fallback for admin-like)
```

**Data scoping:**
- Server enforces via `scopeFilter(user, resource)` — no client-side filtering
- Field dashboard endpoint restricts to `user._id` and user's `division`
- Division dashboards check `user.division` matches the requested division

**Fallback:**
- If user has no matching dashboard, show BusinessDashboard (lightweight, most compatible)
- Prevents blank screen

---

## 8. Risks

### High-severity:

1. **Data volume for Field Dashboard on mobile** — Current `/api/bulk` returns ~15 collections. Engineer on 3G could take 20+ seconds.
   - **Mitigation:** Field dashboard uses lean `/api/v3/dashboard/field` endpoint returning only user's assignments (~50 KB max).

2. **New models required** (MaterialRequest, PO, GRN, RFI, Submittal, DailyReport, Drawing) — adds significant scope.
   - **Mitigation:** Phase them in. First release has placeholders showing "Coming soon" for widgets depending on missing models.

3. **Sub-trade widgets** rely on `Project.trade` field which doesn't exist yet.
   - **Mitigation:** Add trade field first (Phase 4 per prior plan), THEN release sub-trade widgets.

4. **Approvals widget** requires workflow states that don't exist yet.
   - **Mitigation:** Hide Approvals widget until workflow endpoints exist (Phase 3).

5. **Platform dashboard "API Health" / "Backups"** — no metrics currently collected.
   - **Mitigation:** Show static placeholders on day 1; integrate with monitoring (PM2 metrics API + backup script) later.

6. **Dashboard aggregation performance** — Company Admin dashboard runs 12+ aggregations per load. Without indexes could take seconds.
   - **Mitigation:** Add compound indexes; cache responses 30-60s.

7. **Losing single Dashboard.jsx entry point** — external links to `/` currently work. Rewriting could break scroll positions or bookmark state.
   - **Mitigation:** Keep `/` as router; each dashboard component is a child.

### Medium-severity:

8. **Chart library decision** — new widgets (Funnel, Gauge, HeatmapCalendar) not in current Charts.jsx. Building from SVG keeps zero external deps but takes time.
   - **Mitigation:** Extend Charts.jsx with new SVG functions using existing color palette.

9. **Sales metrics require Quotation model** which doesn't exist yet.
   - **Mitigation:** Sales dashboard partially functional at launch; add Quotation-based widgets after Phase 2.

10. **Alerts widget** — real-time via WebSocket vs polling? WS is cleaner but adds complexity.
    - **Mitigation:** Poll every 60s at first; upgrade to WS in later phase.

11. **Engineer division mismatch** — HVAC engineer with role='engineer' (no division set) would see empty Field Dashboard.
    - **Mitigation:** Migration script back-fills division from legacy role mapping (already done in `migrate-departments.js`).

### Low-severity:

12. **Mobile CSS conflicts** — Field Dashboard mobile-first layout may clash with existing app.css desktop-first patterns. Test at breakpoints.
13. **Traffic-light color accessibility** — G/A/R needs colorblind-friendly icons alongside color.
14. **Time zone** — SLA calculations and "today's visits" must respect company/user TZ.
15. **Cache invalidation** — When user creates new project, dashboard cache should invalidate. Simple approach: bust cache on any write to relevant resource.

---

## Verification: No files modified

- Read: `Dashboard.jsx`, `Charts.jsx`, `utils/reports.js`, `utils/responsibilities.js`
- Wrote: only `v3/DASHBOARD_ARCHITECTURE.md`
- Zero v2 file changes
- Zero database queries, zero installs
