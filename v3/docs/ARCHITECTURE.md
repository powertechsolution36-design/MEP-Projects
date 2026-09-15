> **📝 SYNC PASS rev 3 — 2026-08-28.** Updated in the correction pass. Authoritative decisions on overlapping topics live in `DOCUMENT_AUTHORITY.md`. Key: standardized `source` enum (`plan|addon|manual|migration`), `ProjectPackage` is a first-class collection (not inline), no `|| [SOLAR,MEP,HVAC]` migration fallback, `Company.entitlements` is cache-only, phase priorities standardized to P0/P1/P1.5/P1.6/P1.7/P2…P16. See `CHANGELOG.md` for the full list.

---

# MEP PROJECTS — Multi-Tenant Modular SaaS Architecture Analysis

**Generated:** 2026-08-28
**Purpose:** Compare current v2 against target multi-tenant SaaS with plan/entitlement architecture
**⚠️ Planning only — Zero code changes, zero DB queries, zero installs.**

**Classification tags:**
- ✅ SAFE ADDITIVE — new field/model/route with defaults
- 🔧 MODIFICATION — changes existing behavior
- 🗄️ MIGRATION — requires data migration script
- ⚠️ HIGH RISK — could break users if mis-executed
- 🛡️ PRODUCTION SENSITIVE — live user access

---

## A. Current Company Model
File: `v2/server/src/models/Company.js`
Fields: `name, code, address, phone, email, gstin, logo, divs:[String] (default [MEP,HVAC,Solar]), disabled, meta, timestamps`.
Observations: `divs[]` is closest to "purchased divisions" but no plan/subscription linkage. Every company defaults to all 3 divisions enabled — no entitlement enforcement. `meta.subscription` used for cycle/dates via SubscriptionFields.jsx. No Plan/Subscription/Feature models.

## B. Current User/Role Model
File: `v2/server/src/models/User.js`
Role enum (15): super, admin, hvac_pm, solar_pm, mep_pm, hvac_dm, solar_dm, mep_dm, engineer, service_eng, service_mgr, sales, store, accounts, viewer.
Designation enum (8): super_admin, company_admin, manager, project_manager, senior_engineer, engineer, executive, technician, viewer.
Department enum (9): ADMIN, PROJECTS, HVAC, SOLAR, MEP, SERVICE, SALES, STORE, ACCOUNTS.
Division enum: HVAC, SOLAR, MEP, null.
Pre-validate hook auto-derives role from designation+department+division.
No permissions[] array. No linkage to Plan/Subscription/Entitlement.

## C. Current Sidebar Architecture
`Shell.jsx` MENUS[role] hard-coded per legacy role. `AppShell.jsx` wraps and delegates to `superAdminMenu.js` for super. No entitlement filter — every role sees full menu regardless of company divisions. 4 sidebar items point to 404 routes (`/customers`, `/quotations`, `/inventory/transfer`, `/inventory/categories`).

## D. Current Dashboard Architecture
Single `Dashboard.jsx` (151 lines) with role branches. 22 stats in STAT_DEFS. `ROLE_DASHBOARD[role]` picks stat keys from `responsibilities.js`. Charts render across all resources — no division entitlement filter.

## E. Current Company Scoping
Every model has `co: ObjectId → Company` with compound index. `auth()` loads user + `req.user.co`. `ensureCompany()` sets body.co on POST for non-super. Route handlers filter reads with `{co: req.user.co}` (except super). WebSocket rooms `co:{coId}`. Verdict: SOLID multi-tenant scoping. Gap: no module/division gate — every module open per role.

## F. Current Role Guards
`requireRole(...roles)` in middleware/auth.js: super bypasses; DM roles get admin access; else role must match. Only used on POST/PUT/DELETE `/api/users` + PUT/DELETE `/api/companies/:id`. Most write endpoints unguarded (rely on company scoping only).

## G. Current Project Structure
Single `div` enum (MEP/HVAC/Solar/Other). No multi-division support, no packages. `pm` and `engs[]` are name strings not User FKs. No salesOrderId back-link.

## H. Current Division Handling
Division concept scattered: Company.divs[] (string array), Project.div, InvItem.division, Checklist.div, User.division. Missing on Enquiry, SalesOrder, ServiceCall, Contract, Payment. No central "purchased division" enforcement.

## I. Current Inventory Structure
InvItem has division (COMMON/HVAC/SOLAR/MEP). Categories/Locations/Issues/Transactions don't. `/api/bulk` filters items by user role→division mapping (recent addition).

## J. Current Service/AMC Structure
ServiceCall: no division, no assetId, no contractId. Contract: no division, no asset link. Both co-scoped only.

## K. Current Payment/Finance Structure
Payment model has client/project/invNo/amount/paid[]/status. No Invoice model, no division, no Budget, no Profitability, no approval workflow.

## L. Current Audit Implementation
**NONE persisted.** Some models have inline log[] (Enquiry.log[]). WebSocket broadcasts transient. Complete gap for enterprise SaaS.

## M. Existing Models Requiring Extension
| Model | Add fields | Class |
|-------|------------|-------|
| Company | subscription{}, entitlements{divisions,modules,features}, settings{uiVersion} | ✅ SAFE ADDITIVE |
| User | permissions[], subDivision, projectAccess[] | ✅ SAFE ADDITIVE |
| Project | salesOrderId, customerId, enquiryId, subTrades[], projectMgrId, accessList[], budget (multi-division uses first-class ProjectPackage collection — see DATABASE_ARCHITECTURE.md) | ✅ SAFE ADDITIVE + 🗄️ backfill |
| Enquiry | customerId, division, trade, stage, qualification{}, nextAction{} | ✅ SAFE ADDITIVE |
| SalesOrder | customerId, enquiryId, quotationId, customerPOId, division, trade | ✅ SAFE ADDITIVE |
| ServiceCall | division, contractId, assetId | ✅ SAFE ADDITIVE |
| Contract | division, warrantyId, assets[] | ✅ SAFE ADDITIVE |
| Payment | invoiceId, division | ✅ SAFE ADDITIVE |
| Checklist | (has div) — normalize + phase | 🔧 MODIFICATION |

## N. New Models Required (~30)
**P1:** Permission, RolePermission, UserPermissionOverride, ApprovalRequest, AuditLog
**P1.5:** Plan, Subscription, CompanyEntitlement
**P2:** Customer, Contact, Site, Quotation, CustomerPO, BOQ
**P3:** ProjectPackage, Task, DailyReport
**P5:** MaterialRequest, Vendor, RFQ, PurchaseOrder, GRN, StockLedger
**P6:** Invoice, Budget, ChangeOrder
**P7:** RFI, Submittal, Drawing
**P8:** QaInspection, NCR, Handover
**P9:** Warranty, Renewal
**P10:** Asset
All ✅ SAFE ADDITIVE.

## O. Existing APIs Requiring Extension
- `POST /api/companies` accept plan + purchasedDivisions (super only) ✅
- `PUT /api/companies/:id` allow plan change 🔧
- `/api/projects` accept package/division fields ✅
- `/api/enquiries` accept customerId+division+stage ✅
- `/api/sales-orders` accept quotationId+customerId+division ✅
- `/api/bulk` add division-filtered payload per entitlement 🔧 🛡️
- ALL routes: add `requireEntitlement()` middleware 🔧 🛡️

## P. New APIs Required
**Super scope:** `/api/v3/plans`, `/api/v3/subscriptions`, `/api/v3/entitlements/:coId`, `POST /companies/:id/change-plan`, `enable-division`, `disable-division`
**Permissions:** `/api/v3/permissions`, `/api/v3/roles/:role/permissions`, `/api/v3/users/:id/permissions`
**Self:** `/api/v3/me/entitlements`, `/api/v3/me/sidebar`, `/api/v3/me/dashboard`
**Audit:** `/api/v3/audit?resource=&user=&from=&to=`
All new modules from Section N get standard REST under `/api/v3/*`.

## Q. Existing Frontend Screens Requiring Extension
| Screen | Change | Class |
|--------|--------|-------|
| Companies.jsx (Super) | Plan picker + division checkboxes + subscription dates | ✅ |
| Users.jsx | Designation options filtered by company entitlements | 🔧 |
| Shell.jsx | Filter by entitlement + permissions | 🔧 🛡️ |
| Dashboard.jsx | Route to per-designation dashboard | 🔧 🛡️ |
| Projects.jsx | Division picker limited to purchased | 🔧 |
| Inventory.jsx | Division filter limited to purchased | 🔧 |
| Reports.jsx | Report types limited to entitlements | 🔧 |

## R. New Frontend Screens Required
**Super:** Plans.jsx, Subscriptions.jsx, PlatformSecurity.jsx, PlatformSystem.jsx, PlatformSettings.jsx, PlatformUsers.jsx
**Company Admin:** SubscriptionInfo.jsx, Approvals.jsx, TeamPermissions.jsx, division landings (Solar/Mep/Hvac shown only if purchased)
**Shared:** Profile.jsx, ~20 new module pages per Section N

## S. Plan / Subscription Architecture
```
Plan { code(unique), name, description, price, currency(INR),
       billingCycle(monthly/yearly/one-time),
       availableDivisions:[SOLAR,MEP,HVAC], includedModules[],
       features:{code:Bool|Num}, limits:{users,projects,storageGB},
       status:draft|active|deprecated, timestamps }

Subscription { co(unique active per company), plan,
               startDate, endDate,
               status:active|suspended|expired|cancelled|trial,
               purchasedDivisions:[], enabledFeatures:{},
               billingStatus:paid|pending|overdue,
               renewalDate, createdBy, log:[{at,by,action,note}] }
```
Alternative (inline on Company.meta.subscription) not recommended — first-class model needed for reporting.

## T. Company Entitlement Architecture
Denormalized on Company for fast lookup + separate CompanyEntitlement collection for audit trail:
```
Company.entitlements = {
  divisions:['MEP','HVAC'],
  modules:['CRM','PROJECTS','MEP','HVAC','INVENTORY','SERVICE','FINANCE','REPORTS'],
  features:{'reports.export.csv':true, 'users.max':25},
  computedAt: Date
}
CompanyEntitlement { co, module, division, enabled, limits, startDate, endDate, source(plan|addon|manual|migration) }
```
Middleware attaches `req.entitlements = user.co.entitlements`. Sidebar filter: `menuItem.requires.every(m => req.entitlements.modules.includes(m))`. Route guard: `if (!entitlements.divisions.includes('HVAC')) return 403`.
**Legacy compatibility (corrected — rev 4 sync; see `DOCUMENT_AUTHORITY.md` Canonical Effective-Entitlement Precedence Ex 4/Ex 5, and `PLAN_ENTITLEMENTS.md` §9/§11 for the full mechanism):** There is no blanket "LEGACY_FULL" (all-divisions/all-modules/all-features) grant. A company whose `company.divs` migrates cleanly gets the hidden, system-only `LEGACY_UNLIMITED` Subscription scoped to **exactly** those existing divisions (`source:'migration'`, no auto-expansion). A company whose division data is missing or invalid gets `migrationReviewRequired=true` and zero automatic division grant — visible to Company Admin/Super for manual resolution, never silently defaulted to full access.

## U. Division Selector Architecture
Rules:
- 1 division purchased → no selector, auto-locked
- >1 division purchased → selector in top-bar for Company Admin/Manager
Store: `useStore.selectedDivision` + localStorage. Pass as `?division=HVAC` on API calls. Backend applies filter when present and user is admin-level.
Component: `<DivisionSelector />` — chips [All][HVAC][Solar][MEP] filtered to purchased. Shown only when `entitlements.divisions.length > 1` and user has cross-division view rights.

## V. Role Availability Architecture
Data-driven `availableDesignations(company)`:
- Always: company_admin, manager, executive, viewer
- If entitlements.divisions has HVAC → add hvac_manager, hvac_pm, hvac_engineer
- If SOLAR → add solar_manager, solar_pm, solar_engineer
- If MEP → add mep_manager, mep_pm, mep_engineer
- If modules includes INVENTORY → inventory_manager, store_keeper
- If SERVICE → service_manager, service_engineer
- If FINANCE → accounts
Frontend Users.jsx populates dropdown from this list. Backend validates on POST/PUT.

## W. Sidebar Entitlement Logic
Each menu item declares:
```
{ to, label, icon, requires: { modules:[], divisions:[], permissions:[] } }
```
Resolver filters items where requires satisfied. Backward compat: legacy `MENUS[user.role]` works as fallback if no entitlements loaded.

## X. Dashboard Entitlement Logic
Widget declares `requires` + eligible roles:
```
{ key:'solarProjects', requires:{divisions:['SOLAR'],modules:['PROJECTS']},
  roles:['company_admin','solar_manager'] }
```
Solar-only company's Company Admin sees zero HVAC/MEP widgets automatically.

## Y. Project Division/Package Architecture
Preserve current single-`div` Project AS-IS. Add optional multi-division support via packages sub-doc:
```
Project { ...existing...,
  divisions:[enum],  // if length>1, packages required
  packages:[{ _id, division, scope, value, projectMgr:User, engs:[User],
              startDate, endDate, status, chk:[], updates:[] }] }
```
Migration: existing single-div projects get `divisions:[project.div]` + one package with same fields. No breakage.
Views: Company Admin sees all packages; Solar Manager sees only Solar package (via scope filter); Project Manager sees whole project.

## Z. Migration Strategy
1. **Snapshot** MongoDB before any migration
2. **Add fields with defaults** — no code path uses them yet
3. **Seed reference data** — Plans, Permissions, RolePermissions
4. **Legacy entitlement backfill** — per `DOCUMENT_AUTHORITY.md`: valid legacy division data (e.g. `company.divs`) migrates to explicit `source:'migration'` DivisionEntitlement rows; missing/invalid data sets `migrationReviewRequired=true` with zero automatic grant (idempotent either way) — never a blanket LEGACY_FULL grant
5. **User backfill** — designation/department/division (already done via migrate-departments.js)
6. **Optional Project backfill** — divisions[project.div] + packages[single]
7. **Rollback** — every script has --undo flag; snapshot always available
Never destructive: no field deletion, no role rename, no data purge.

## AA. Backward Compatibility Strategy
| Concern | Strategy |
|---------|----------|
| Existing JWTs | Unchanged (same secret/claims) |
| Existing role checks | Keep requireRole(); add requireEntitlement() alongside |
| Existing sidebars | Keep MENUS[role]; new resolver first tries entitlement-aware, falls back to legacy |
| Existing bulk endpoint | Keep /api/bulk; add /api/v3/bulk |
| Existing pages | Keep unchanged; feature-flag via Company.settings.uiVersion |
| Legacy roles | Never renamed; auto-map to new designations for display |
| Legacy companies | No automatic full grant — missing/invalid division data → `migrationReviewRequired=true`, zero grant; valid data migrates to explicit `source:'migration'` rows (`DOCUMENT_AUTHORITY.md`) |
| Legacy Company.divs[] | Stay in sync with new entitlements.divisions |
| Deployment | v3 API runs on separate PM2 process (port 4002 or nginx /v3) |

## AB. Production Risks
Highest severity:
1. 🛡️ Sidebar entitlement rollout — bug hides items → users can't work. Mitigation: feature flag per company; monitor tickets.
2. 🛡️ Entitlement backfill mistake — wrong entitlements hide modules. Mitigation: per `DOCUMENT_AUTHORITY.md`, ambiguous legacy data is flagged `migrationReviewRequired` (visible to Company Admin/Super, not silently hidden) rather than defaulted to a blanket grant; explicit `manual` entitlement rows resolve it case by case.
3. ⚠️ Auth changes invalidate sessions. Rule: no JWT changes.
4. ⚠️ Role guard regression — bad `requireEntitlement` order blocks super. Mitigation: super always bypasses.
5. ⚠️ Bulk payload growth slows load. Mitigation: `/api/v3/bulk` with lazy-load per module.
Medium: division-selector state sync; legacy Project.div vs new divisions[]; approval blocks users; audit write volume; Company.divs vs entitlements.divisions consolidation.
Low: icons for new modules; mobile responsive; report export entitlement.

## AC. Recommended Implementation Sequence
**P0 (Week 0):** Full DB backup, automated backups, staging env, feature flags (uiVersion, enforceEntitlements)
**P1 (W1-2):** Permission/RolePermission/UserPermissionOverride/AuditLog/ApprovalRequest models; requirePermission() middleware; seed 60-80 permission codes; role→permission default mapping
**P1.5 (W3-4):** Plan/Subscription/CompanyEntitlement models; seed default plans; legacy division backfill per `DOCUMENT_AUTHORITY.md` (migrate valid data to `source:'migration'` rows, flag the rest `migrationReviewRequired` — never a blanket LEGACY_FULL grant); Super admin Plan CRUD + Subscription UI; requireEntitlement() in log-only mode
**P2 (W5-7):** Customer/Contact/Site/Quotation/CustomerPO/BOQ; fix broken sidebar links; sales pipeline pages
**P3 (W8-10):** Extend Project with salesOrderId/projectMgrId; first-class ProjectPackage collection; Task, DailyReport
**P4 (W11-13):** Division landings; sub-trade fields; division-specific workflows
**P5 (W14-16):** MaterialRequest, Vendor, RFQ, PO, GRN, StockLedger
**P6 (W17-19):** Invoice, Budget, ChangeOrder, Profitability
**P7 (W20):** RFI, Submittal, Drawing
**P8 (W21):** QA/QC, Handover
**P9 (W22):** Warranty, AMC extend, Renewal
**P10-16:** Assets, Workforce, BI, Portals, AI (later)
**Final:** Enforce entitlements (flip flag), migrate companies to v3 UI one at a time.

## Final Classification Summary
| Category | Count |
|----------|-------|
| ✅ SAFE ADDITIVE | 42 |
| 🔧 MODIFICATION | 8 |
| 🗄️ MIGRATION | 3 |
| ⚠️ HIGH RISK | 4 |
| 🛡️ PRODUCTION SENSITIVE | 5 |

---

## Verification
- Read: no additional v2 files this pass (used prior deep analysis)
- Wrote: v3/PLATFORM_ARCHITECTURE.md only
- Zero code changes, zero DB writes, zero installs, zero commits
