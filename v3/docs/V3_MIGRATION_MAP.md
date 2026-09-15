> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.
>
> **📝 rev 9 addition — 2026-09-10.** Additive only. Added `SalesOrder.paymentMilestones[]`, `Payment` finance-linkage fields, and `FinanceWorkItem.js` (PWA-compat "Raise to Finance" requirement). See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Added `ChecklistInstanceItem.js` (first-class) and `MyWork.jsx`; documented legacy `Project.chk[]` field mapping. See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Re-classified `InvItem.js` and `InvTransaction.js` from REUSE to ADAPT (`itemType` field; extended `type` enum); added `MaterialReturnRequest.js`, `ToolCustody.js`, `StockTransfer.js` (all first-class); documented legacy `ret` boolean field mapping. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added `RecordCorrection.js` (first-class); documented that every REUSE/ADAPT legacy model gains the additive ownership metadata block, with `createdByUserId` backfilled only where a reliable legacy creator field exists — never invented. See `CHANGELOG.md` rev 12.

---

# V3 Migration Map — Production → V3 File Classification

**Purpose:** Before any code moves into v3, every file in production `v2/` is classified. Nothing is blindly copied. Nothing is deleted.
**Rule:** v3 references or wraps production code where safe, adapts where extension is needed, and only rewrites what has fundamental gaps.
**Status:** Planning only — no code moved yet.

---

## Classification Legend

| Tag | Meaning |
|-----|---------|
| **REUSE** | Import/consume production code as-is in v3 (no copy). |
| **ADAPT** | Copy into v3 with additive changes; keep production version untouched. |
| **UNCHANGED** | Stays in production, not needed in v3 at all. |
| **NEW** | Doesn't exist yet; created fresh in v3. |
| **COMPAT-LAYER** | Sits in v3 as a translation shim between legacy production API and target model. |

Every entry answers: *does v3 touch this file?* — if no, it stays put.

---

## Backend (`v2/server/src/`)

### Config

| Production file | Class | v3 disposition |
|---|---|---|
| `config/db.js` | REUSE | Same MongoDB connection, same URI. v3 requires the same DB. Import via relative path or duplicate the 15-line file if we want v3 fully standalone. |

### Middleware

| Production file | Class | v3 disposition |
|---|---|---|
| `middleware/auth.js` (auth, sign, requireRole, ensureCompany) | REUSE | JWT secret and token shape must be shared with production. v3 uses the same `auth()` for compatibility. `requireRole()` continues to work for legacy checks. |
| — | **ACTIVE** (P0/P1 foundation, built) | `loadEntitlements()` — implemented as a function inside `v3/server/src/middleware/tenant.js` (not a separate file); attaches `req.entitlements` from the `Company.entitlements` cache |
| — | **ACTIVE** (built) | `requireEntitlement()` — function inside `v3/server/src/middleware/tenant.js` |
| — | **ACTIVE** (built) | `requirePermission()` (fine-grained) — function inside `v3/server/src/middleware/authorization.js` |
| — | FUTURE (not yet built) | `v3/server/src/middleware/destructiveActionGuard.js` (MFA + reason + cascade + 2-of-2) |
| — | FUTURE (not yet built) | `v3/server/src/middleware/approvalThresholdGuard.js` |
| — | **ACTIVE**, relocated (built) | write-every-mutation-to-AuditLog — implemented as `v3/server/src/services/auditService.js` (a service, not middleware); called from route handlers via `ownershipService.js`/direct use, not as an Express middleware layer |
| — | **ACTIVE** (built) | `scopeFilterV3()` — function inside `v3/server/src/middleware/authorization.js` |

### Models

| Production file | Class | v3 disposition |
|---|---|---|
| `models/Company.js` | ADAPT | v3 extends with `entitlements`, `settings.enforceEntitlements`, `settings.uiVersion`, `settings.approvalPreferences` (preferences only — approval history lives in first-class `ApprovalRule/ApprovalRequest/ApprovalStep`). **Cannot modify production file** — v3 defines its own Company model against the same collection, using `strict: false` or extending via `Model.compile()` pattern that adds fields without breaking prod. |
| `models/User.js` | ADAPT | v3 already has designation/department/division added (rolled into production during v2 evolution). Add `permissions[]`, `projectAccess[]`. v3 file extends prod schema. |
| `models/Project.js` | ADAPT | v3 adds `divisions[]`, `projectMgrId`, first-class ProjectPackage collection (not embedded), `customerId`, `salesOrderId`. Legacy `div`, `pm`, `engs[]` kept. |
| `models/Enquiry.js` | ADAPT | v3 adds `customerId`, `division`, `trade`, `stage`, `qualification{}`, `nextAction{}`. |
| `models/SalesOrder.js` | ADAPT | v3 adds `customerId`, `enquiryId`, `quotationId`, `customerPOId`, `division`, `trade`, `paymentMilestones[]` (rev 9 — nullable/empty by default; see `DATABASE_ARCHITECTURE.md`). |
| `models/ServiceCall.js` | ADAPT | v3 adds `division`, `contractId`, `assetId`. |
| `models/Contract.js` | ADAPT | v3 adds `division`, `warrantyId`, `assets[]`. |
| `models/Payment.js` | ADAPT | v3 adds `invoiceId`, `division`, `salesOrderId`, `projectId`, `projectPackageId`, `milestoneRef`, `financeWorkItemId` (rev 9 — all nullable; historical payments never backfilled). |
| `models/Checklist.js` | REUSE | Template model — no fundamental change; v3 adds `ChecklistInstance`/`ChecklistInstanceItem` as new models (rev 10 — full shape in `DATABASE_ARCHITECTURE.md`; legacy `Project.chk[]` field mapping table there, read-only, never backfilled). |
| `models/InvItem.js` | ADAPT (rev 11) | Already has `division` field, consumed as-is (unchanged). v3 adds `itemType: REUSABLE_TOOL_ASSET \| PROJECT_MATERIAL` (rev 11 — full shape in `DATABASE_ARCHITECTURE.md` rev 11; legacy rows backfilled per category rule, ambiguous rows get `itemType=null` + `migrationReviewRequired=true`, never guessed). |
| `models/InvCategory.js`, `InvLocation.js`, `InvIssue.js` | REUSE | v3 consumes as-is. |
| `models/InvTransaction.js` | ADAPT (rev 11) | Existing shape (co, item, qty, date, ref) unchanged; v3 extends `type` to the 12-value enum in `DATABASE_ARCHITECTURE.md` rev 11 (`RECEIPT_GRN \| ISSUE_TO_PROJECT \| ISSUE_TO_EMPLOYEE \| USAGE_REPORTED \| RETURN_TO_STOCK \| SCRAP \| TRANSFER_OUT \| TRANSFER_IN \| TOOL_ISSUE \| TOOL_RETURN \| ADJUSTMENT \| STOCK_TAKE`). Existing rows/values untouched. |
| *(new, rev 11)* `models/MaterialReturnRequest.js` | NEW | First-class Excess/Return Form — PM declares, Inventory Manager verifies/accepts. Full shape in `DATABASE_ARCHITECTURE.md` rev 11. |
| *(new, rev 11)* `models/ToolCustody.js` | NEW | First-class custody record for `REUSABLE_TOOL_ASSET` items. Full shape in `DATABASE_ARCHITECTURE.md` rev 11. |
| *(new, rev 11)* `models/StockTransfer.js` | NEW | First-class auditable inter-project transfer, division-safe. Full shape in `DATABASE_ARCHITECTURE.md` rev 11. |
| `models/Notification.js` | ADAPT | v3 extends `roles[]` → `permissions[]` for permission-based targeting. |
| `models/Sequence.js` | REUSE | Auto-numbering utility; v3 uses same pattern. |
| — | **ACTIVE** (built) | `v3/server/src/models/Plan.js` |
| — | **ACTIVE** (built) | `v3/server/src/models/Subscription.js` |
| — | **ACTIVE** (built) | `v3/server/src/models/DivisionEntitlement.js` |
| — | **ACTIVE** (built) | `v3/server/src/models/FeatureEntitlement.js` |
| — | **ACTIVE** (built) | `v3/server/src/models/AddOn.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/Permission.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/RolePermission.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/UserPermissionOverride.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/ApprovalRequest.js` |
| — | **ACTIVE** (built) | `v3/server/src/models/AuditLog.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/Customer.js`, `Contact.js`, `Site.js`, `Quotation.js`, `CustomerPO.js`, `BOQ.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/ProjectPackage.js` — first-class (per `DOCUMENT_AUTHORITY.md`: `Project ≠ ProjectPackage`, never embedded) |
| — | FUTURE (not yet built) | `v3/server/src/models/Task.js`, `DailyReport.js`, `ChecklistInstance.js`, `ChecklistInstanceItem.js` (rev 10 — first-class, addressable) |
| — | FUTURE (not yet built) | `v3/server/src/models/MaterialRequest.js`, `Vendor.js`, `RFQ.js`, `PurchaseOrder.js`, `GRN.js`, `StockLedger.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/Invoice.js`, `Budget.js`, `ChangeOrder.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/FinanceWorkItem.js` (rev 9 — "Raise to Finance" record; see `DATABASE_ARCHITECTURE.md`) |
| — | FUTURE (not yet built) | `v3/server/src/models/RFI.js`, `Submittal.js`, `Drawing.js` |
| — | FUTURE (not yet built) | `v3/server/src/models/QaInspection.js`, `NCR.js`, `Handover.js`, `Warranty.js`, `Renewal.js`, `Asset.js` |

Also already **ACTIVE** (built, not previously listed here): `v3/server/src/models/User.js`, `Company.js`, `RecordCorrection.js`, `registry.js` (the lazy isolated-connection model registry all of the above resolve through).

### Routes

| Production file | Class | v3 disposition |
|---|---|---|
| `routes/auth.js` | REUSE | Login, /me, /change-password shared. v3 does NOT create its own auth. |
| `routes/companies.js` | COMPAT-LAYER | v3 wraps with entitlement-aware endpoints (`/api/v3/companies/:id/entitlements`, `/change-plan`) but production `/api/companies` remains untouched. |
| `routes/users.js` | COMPAT-LAYER | v3 adds `/api/v3/users/:id/permissions`, `/api/v3/users?availableDesignations`. Production endpoints continue for legacy UI. |
| `routes/enquiries.js` | REUSE | Existing endpoints stay; v3 layers new endpoints (`/qualify`, `/schedule-site-visit`) as additions. |
| `routes/salesOrders.js` | REUSE | Existing stays. |
| `routes/projects.js` | REUSE | Existing stays. New `/api/v3/projects/:id/packages`, `/from-sales-order/:soId`, `/assign-manager` added. |
| `routes/serviceCalls.js` | REUSE | Existing stays. |
| `routes/contracts.js` | REUSE | Existing stays. |
| `routes/payments.js` | REUSE | Existing stays. |
| `routes/inventory.js` | REUSE | Existing stays. |
| `routes/checklists.js` | REUSE | Existing stays. |
| `routes/notifications.js` | REUSE | Existing stays. |
| `routes/reportsDownload.js` | REUSE | Existing stays. |
| — | NEW | `/api/v3/plans`, `/api/v3/subscriptions`, `/api/v3/entitlements`, `/api/v3/permissions`, `/api/v3/audit`, `/api/v3/approvals` |
| — | NEW | `/api/v3/customers`, `/quotations`, `/vendors`, `/purchase-orders`, `/grns`, `/rfis`, `/submittals`, `/assets`, `/warranties`, `/renewals`, `/tasks`, `/daily-reports`, `/material-requests`, `/change-orders`, `/invoices`, `/budgets` |
| — | NEW | `/api/v3/me/entitlements`, `/me/sidebar`, `/me/dashboard` |

### Utilities & scripts

| Production file | Class | v3 disposition |
|---|---|---|
| `utils/crud.js` | REUSE | Generic CRUD helper — v3 uses same pattern for new resources. |
| `utils/notify.js` | REUSE | Notification broadcaster — v3 reuses. |
| `utils/scope.js` | ADAPT | v3 defines `scopeFilterV3()` that extends this with entitlement + package awareness. Original stays untouched for production callers. |
| `utils/permissions.js` (partial in v2) | ADAPT / EXTEND | v3 layers `hasPermission(user, code)` reading Permission/RolePermission/UserPermissionOverride. |
| `scripts/seed.js` | REUSE | Legacy seed for baseline data. |
| `scripts/migrate.js` | REUSE | Legacy migration runner. |
| `scripts/migrate-departments.js` | REUSE | Already backfills designation/department/division for existing users. |
| — | FUTURE (not yet built) | `001_seed_permissions.js` |
| — | FUTURE (not yet built) | `002_seed_plans_and_addons.js` |
| — | FUTURE (not yet built) | `003_backfill_legacy_companies.js` — implements `PLAN_ENTITLEMENTS.md` §11 / `ACCESS_MATRIX.md` Stage 2: a company with valid `company.divs` gets the hidden, system-only `LEGACY_UNLIMITED` Subscription scoped to **exactly** its existing divisions (`source:'migration'`, no auto-expansion — this is a legitimate, already-correct mechanism, distinct from the rejected `LEGACY_FULL`/"all divisions" anti-pattern named in `ARCHITECTURE.md`); a company with missing/invalid `company.divs` gets `migrationReviewRequired=true` and zero automatic grant instead. *(Correction note: an earlier pass of this cleanup briefly and incorrectly described `LEGACY_UNLIMITED` itself as the same anti-pattern as `LEGACY_FULL` — it is not; `LEGACY_UNLIMITED` is the frozen, correct mechanism per `PLAN_ENTITLEMENTS.md` §9/§11.)* |
| — | FUTURE (not yet built) | `004_seed_approval_matrix.js` |
| — | FUTURE (not yet built) | `005_project_packages_backfill.js` |
| — | FUTURE (not yet built) | `999_rollback_toolkit.js` |

**Location note:** the pre-restructure `v3/server/migrations/` directory (created in the first build pass, before the `src/` layout was established) was empty and has been removed as dead scaffolding — see `CHANGELOG.md`/cleanup report. A concrete migrations location (e.g. `v3/server/src/migrations/` or a top-level sibling of `src/`, consistent with how `tests/` sits outside `src/`) will be decided when Phase 2 actually needs one; the filenames above are listed without a directory prefix for that reason.

### WebSocket

| Production file | Class | v3 disposition |
|---|---|---|
| `websocket/sync.js` | ADAPT | v3 wraps with multi-room hierarchy (`co:{coId}:div:{X}`, `:user:{uid}`, `:role:{r}`), payload filtering, no writes via socket, entitlement-aware rooms. **Production file NOT modified** — v3 initializes its own socket namespace or extended emitter alongside. |

### Entry point

| Production file | Class | v3 disposition |
|---|---|---|
| `server/src/index.js` | REUSE / UNCHANGED | Production server stays on port 4001 with its current route list. |
| — | **ACTIVE** (built), **path corrected** | `v3/server/src/index.js` — separate Express app (app factory in `v3/server/src/app/app.js`), port 4002 by default, mounts `/api/v3/*` routes, shares MongoDB + JWT with production. |

---

## Frontend (`v2/web/src/`)

### Entry & routing

| Production file | Class | v3 disposition |
|---|---|---|
| `main.jsx` | UNCHANGED | Production entry. |
| `App.jsx` | UNCHANGED | Production routes. |
| — | NEW | `v3/web/main.jsx` and `v3/web/App.jsx` — separate v3 app served at subdomain or `/v3/*` route. |
| `api/client.js` | REUSE | JWT header + fetch wrapper — v3 reuses (auth is shared). |
| `api/socket.js` | ADAPT | v3 extends with room join + entitlement-aware event filtering. |

### Store

| Production file | Class | v3 disposition |
|---|---|---|
| `store/useStore.js` | ADAPT | v3 has its own store extending same shape + `entitlements`, `selectedDivision`, `permissions` slots. Zustand store isolated per app. |

### Components (visual language shared, functional differences)

| Production file | Class | v3 disposition |
|---|---|---|
| `components/Shell.jsx` | ADAPT | v3 `SidebarShell.jsx` — same CSS/DOM structure but resolves menu from entitlement + permissions. Production Shell.jsx untouched. |
| `components/AppShell.jsx` | ADAPT | v3 wraps role-based menu resolver. Production version stays. |
| `components/Modal.jsx` | REUSE | Same modal component — import or duplicate. |
| `components/Toast.jsx` | REUSE | Same. |
| `components/Charts.jsx` | REUSE | Same SVG chart primitives. v3 extends with Funnel, Gauge, HeatmapCalendar. |
| `components/ReportDownload.jsx` | REUSE | Same. |
| `components/ResourcePage.jsx` | REUSE | Generic list page. |
| `components/ResponsibilitiesCard.jsx` | REUSE | Onboarding tooltip. |
| `components/SubscriptionFields.jsx` | ADAPT | Extended for v3 subscription editing UI. |
| `components/ReportModal.jsx` | REUSE | Same. |
| — | NEW | `v3/web/components/KpiCard.jsx`, `AlertList.jsx`, `TrafficLightGrid.jsx`, `ApprovalQueue.jsx`, `DivisionSelector.jsx`, `EntitlementBadge.jsx`, `Funnel.jsx`, `GaugeChart.jsx`, `HeatmapCalendar.jsx`, `ActionButton.jsx`, `ProgressBar.jsx`, `CalendarList.jsx`, `TopList.jsx` |

### Pages

| Production page | Class | v3 disposition |
|---|---|---|
| `pages/Login.jsx` | UNCHANGED | Shared login. |
| `pages/Dashboard.jsx` | ADAPT | v3 replaces with router that picks per-designation dashboard. Production Dashboard.jsx untouched. |
| `pages/Enquiries.jsx` | ADAPT | v3 version extends with customer picker, stage, qualification. Prod version stays. |
| `pages/LostEnquiries.jsx` | REUSE | Same. |
| `pages/SalesOrders.jsx` | ADAPT | v3 links quotation/customer. |
| `pages/Projects.jsx` | ADAPT | v3 supports packages, PM assignment. |
| `pages/Checklists.jsx` | REUSE | Template CRUD unchanged; v3 adds `ChecklistInstance.jsx` (Project/Package view) and `MyWork.jsx` (rev 10 — universal work queue: Today/Upcoming/Overdue/Completed, reused by Engineer/Sales/Service/PM). |
| `pages/Inventory.jsx` | ADAPT | v3 adds division filter (already partially there), procurement links. |
| `pages/ServiceCalls.jsx` | ADAPT | v3 adds contract/asset link. |
| `pages/Contracts.jsx` | ADAPT | v3 adds warranty auto-convert. |
| `pages/Payments.jsx` | ADAPT | v3 links invoice, reverse-entry (no delete). |
| `pages/Notifications.jsx` | REUSE | Same. |
| `pages/Users.jsx` | ADAPT | v3 form uses `availableDesignations(company)`, permission editor, credentials dialog kept. |
| `pages/Companies.jsx` | ADAPT | Super admin — v3 adds plan/subscription pickers, division checkboxes. |
| `pages/SuperAnalytics.jsx` | REUSE | Reused as-is by v3 Platform Dashboard. |
| `pages/Reports.jsx` | REUSE | Same. |
| — | NEW | `v3/web/pages/Plans.jsx`, `Subscriptions.jsx`, `PlatformSecurity.jsx`, `PlatformSystem.jsx`, `PlatformSettings.jsx`, `PlatformUsers.jsx` |
| — | NEW | `v3/web/pages/SubscriptionInfo.jsx`, `Approvals.jsx`, `TeamPermissions.jsx`, `Profile.jsx` |
| — | NEW | `v3/web/pages/Customers.jsx`, `Quotations.jsx`, `Vendors.jsx`, `PurchaseOrders.jsx`, `RFQs.jsx`, `GRNs.jsx`, `RFIs.jsx`, `Submittals.jsx`, `Drawings.jsx`, `MaterialRequests.jsx`, `Invoices.jsx`, `Budgets.jsx`, `ChangeOrders.jsx`, `Warranties.jsx`, `Renewals.jsx`, `Assets.jsx`, `Tasks.jsx`, `DailyReports.jsx`, `SiteLog.jsx` |
| — | NEW | Division landings: `SolarLanding.jsx`, `MepLanding.jsx`, `HvacLanding.jsx`, `Execution.jsx`, `Material.jsx`, `MaterialControl.jsx`, `Procurement.jsx`, `ProjectMaterial.jsx`, `Engineers.jsx`, `Parts.jsx`, `MyDashboard.jsx`, `MyWork.jsx`, `DepartmentWork.jsx` |

### Dashboards

| Production file | Class | v3 disposition |
|---|---|---|
| — | NEW | `v3/web/dashboards/PlatformDashboard.jsx` (super), `BusinessDashboard.jsx` (company admin), `SalesDashboard.jsx`, `ProjectControlDashboard.jsx`, `SolarDashboard.jsx`, `MepDashboard.jsx`, `HvacDashboard.jsx`, `InventoryDashboard.jsx`, `ServiceDashboard.jsx`, `FieldDashboard.jsx` (engineer, mobile-first) |

### Utils

| Production file | Class | v3 disposition |
|---|---|---|
| `utils/orgModel.js` | REUSE | Designation/department mappings; v3 imports. |
| `utils/responsibilities.js` | REUSE | Role labels; v3 extends. |
| `utils/reports.js` | REUSE | Same. |
| `config/superAdminMenu.js` | REUSE | Legacy super menu; v3 layers its own resolver. |
| — | NEW | `v3/web/utils/entitlements.js` — client-side hasFeature/hasDivision/hasModule helpers |
| — | NEW | `v3/web/utils/permissions.js` — hasPermission client helper |
| — | NEW | `v3/web/utils/divisionSelector.js` — persist selection, event dispatch |
| — | NEW | `v3/web/utils/approvalRequest.js` — 202 pending helper |
| — | NEW | `v3/web/utils/sidebarResolver.js` — computes menu from entitlement + permissions |
| — | NEW | `v3/web/utils/dashboardResolver.js` — picks dashboard for user |

### Styles

| Production file | Class | v3 disposition |
|---|---|---|
| `styles/app.css` | REUSE | v3 imports same stylesheet — visual continuity guaranteed. Adds `v3-` prefixed class additions as needed. |

---

## Deployment (`v2/deploy/` and root files)

| Production file | Class | v3 disposition |
|---|---|---|
| `deploy/nginx-api.conf`, `nginx-web.conf` | REUSE | Nginx configs untouched. |
| — | NEW | `v3/deploy/nginx-api-v3.conf` — mounts port 4002 → `api-v3.mep-projects.spereon.codes` OR path-based `/v3/*` on same domain |
| — | NEW | `v3/deploy/nginx-web-v3.conf` — serves v3 SPA at `v3.mep-projects.spereon.codes` OR `/v3` path |
| — | NEW | `v3/deploy/ecosystem-v3.config.js` — PM2 process for v3 server |
| Root `sw.js`, `MEP_PROJECTS_PWA/`, root `index.html` etc. | UNCHANGED | Legacy PWA relics — untouched. |
| Root `/server/`, `App.js`, `index.js` (Expo) | UNCHANGED | Mobile Expo project — untouched. |

---

## Legacy Compatibility Shims (COMPAT-LAYER)

These live only in v3 and translate between legacy and target. None of these exist yet (FUTURE — not yet built); path shown as `v3/server/src/compat/` for consistency with the established `src/` layout:

- `v3/server/src/compat/legacyRoleMap.js` — role ↔ (designation, department, division)
- `v3/server/src/compat/legacyPermissionMap.js` — role → default permission set
- `v3/server/src/compat/legacyProjectPackageAdapter.js` — presents single-div projects as one-package projects
- `v3/server/src/compat/legacyEntitlementLoader.js` — for a company without a Subscription, loads the `LEGACY_UNLIMITED`-backed `source:'migration'` DivisionEntitlement rows created by the Stage 2 backfill (scoped to exactly that company's pre-existing divisions), or surfaces `migrationReviewRequired=true` where the company was never successfully backfilled — see `PLAN_ENTITLEMENTS.md` §9/§11. **Never** a blanket "LEGACY_FULL" (all-divisions/all-modules) grant.
- `v3/server/src/compat/legacyBulkEndpoint.js` — mirrors `/api/bulk` shape with entitlement filter, for v3 UI running against legacy data

---

## What v3 Never Touches

- Any file in `v2/server/src/` — read-only reference
- Any file in `v2/web/src/` — read-only reference
- `v2/deploy/*` production configs
- Root-level legacy PWA / Expo files
- MongoDB collections' existing documents — only NEW collections added and existing collections gain new fields with defaults
- JWT secret, env variables, PM2 processes for production

---

## Copy vs Import Decision Rule

When v3 needs behavior from a REUSE-tagged file:

- **Prefer import** if v3 server can `require('../../v2/server/src/models/InvItem')` — same node_modules, same DB connection. Zero duplication.
- **Duplicate** only when the file is small (< 30 lines) and v3 needs to add tiny variations, OR when v3 must run fully standalone.

For frontend REUSE:
- v3 web imports v2 components directly via relative path OR uses a shared npm workspace.
- Style file imported directly.

---

## Migration Order (before writing any v3 code)

1. **Create v3 folder scaffold** (empty dirs) — done ✅
2. **Author docs** (this map + others) — in progress
3. **Verify DB backup + snapshot** — production safety P0
4. **Set up v3 dev process** — port 4002 stub server that just responds `/api/v3/health`
5. **Create shared JWT secret env var** already exists — verify v3 reads same
6. **Build P1 (permissions + audit + approval)** — models + routes + middleware; production untouched
7. **Build P1.5 (plans/subscription/entitlement)** — models + super admin UI; LEGACY backfill script (idempotent, run in staging first)
8. **Build P1.6 (division/feature gating)** — enforcement in log-only mode
9. **Build P1.7 (legacy compat layer)** — shims that let v3 UI serve legacy companies
10. **Ship in log-only mode, monitor for 1 week**, then rollout per-company

---

## Ambiguity / Open Questions

1. **Cross-repo import**: is v3 a subfolder of v2 (import paths work) or eventually a separate git repo? Decision affects `require()` paths.
2. **Package manager**: v3 server as separate `package.json` or share `v2/server/package.json`? Recommendation: **separate** so dependencies can evolve without touching production.
3. **Nginx routing**: subdomain (`api-v3.` and `v3.`) or path prefix (`/v3/*`)? Recommendation: **subdomain** — cleaner and lets us upgrade v3 stack independently.
4. **Frontend bundling**: v3 as separate Vite build (own `dist/`) or federated module? Recommendation: **separate build**.
5. **Component sharing**: import from v2 via relative path or publish shared package? Recommendation: **relative import at start; extract shared package later** if it stabilizes.
6. **v2 model extension conflicts**: adding fields via v3 Model definition on same collection — Mongoose allows via `strict: false`, but two definitions of the same model in one process risks OverwriteModelError. Recommendation: **v3 server has its own Model registry** (`mongoose.createConnection` for isolation), same MongoDB URI.

---

## Rev 11 addendum — Legacy `ret` boolean field mapping (read-only, never reconstructed)

| v2/PWA field | v3 rev 11 mapping |
|---|---|
| `InvItem` with no prior type distinction | `itemType` backfilled per company/category rule at migration time (e.g. category "Tools & Equipment" → `REUSABLE_TOOL_ASSET`, all else → `PROJECT_MATERIAL`); ambiguous rows get `itemType=null` + `migrationReviewRequired=true` |
| `ret: true` | Read-mapped to `MaterialReturnRequest.status=RETURNED` (`PROJECT_MATERIAL` items) or a `ToolCustody` record with `status=RETURNED` (`REUSABLE_TOOL_ASSET` items), depending on the resolved `itemType` — never a single uniform mapping |
| `ret: false` | No return recorded; migration does not infer `remainingOnSiteQty` retroactively |
| legacy issue/used/returned-qty fields | Read-mapped into `MaterialRequest.issuedQty`/`usedQty`/`returnedQty` for display only; new activity always writes through the rev 11 flow |

Full mapping table and rationale: `DATABASE_ARCHITECTURE.md` rev 11 addendum, "Legacy compatibility." Exactly as with the rev 10 `chk[]` mapping, this is a read-time presentation via the existing compat adapter layer — never a write-time backfill, never a fabricated historical relationship.

---

## Rev 12 addendum — Legacy record-ownership backfill (read-only, never reconstructed)

| v2/PWA gap | v3 rev 12 handling |
|---|---|
| No `createdByUserId` on most legacy collections | Backfilled only where a reliable creator field already exists in the legacy record (e.g. `Project.createdBy`, `Enquiry.assignedTo` captured at creation, `SalesOrder.createdBy`); unresolvable rows get `createdByUserId=null` + `migrationReviewRequired=true` |
| Legacy records with no enforcement of edit ownership at all | v3 `requireOwnership()` enforcement is forward-only — governs v3-side edits from this point forward; does not retroactively flag or restrict already-completed v2 history |
| No `RecordCorrection` equivalent in v2 | Historical corrections (if any existed informally) are not reconstructed into `RecordCorrection` rows — rev 12 governs corrections made from this point forward only |

Full model and rationale: `DATABASE_ARCHITECTURE.md` rev 12 addendum, "Legacy compatibility." Same discipline as the rev 10/rev 11 tables — `null` + `migrationReviewRequired=true` wherever ambiguous, never an invented owner and never a fabricated correction history.

---

## Verification

- Read: no additional v2 files this pass (used prior deep analysis)
- Wrote: `v3/docs/V3_MIGRATION_MAP.md` only
- Zero code moved, zero copies made, zero v2 files modified
