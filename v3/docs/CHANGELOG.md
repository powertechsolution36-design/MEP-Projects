# V3 Documentation CHANGELOG

## 2026-08-28 — Sync/Correction Pass (rev 3)

**Correction pass on doc pack after review found contradictions.**

### Contradictions found & resolved
1. `Company.divs || [SOLAR,MEP,HVAC]` fallback in migration — REMOVED. Missing/invalid `divs` → `migration-review-required`, exception logged, migration report generated, no auto-grant.
2. Project packages inline vs first-class — RESOLVED as first-class `ProjectPackage` collection, addressable at `/api/v3/projects/:pId/packages/:pkgId`.
3. `Company.entitlements` was described as authoritative — RESOLVED: it is a **cache only**; source of truth is `Subscription + DivisionEntitlement + FeatureEntitlement + AddOn`.
4. Effective entitlement described as `array + array` concat — RESOLVED with set/override semantics + explicit precedence rules.
5. `source` enum inconsistent across docs — STANDARDIZED to: `plan | addon | manual | migration`.
6. Pre-validate hook on User was silently rewriting `role` from designation — DEPRECATED for v3 mutations. Legacy hook remains for read-side back-compat only; V3 API never overwrites legacy `role`.
7. LEGACY_UNLIMITED not marked hidden — CLARIFIED as `visibility: internal, sellable: false, editable: false`.
8. Approval engine was matrix in `Company.settings.approvalMatrix` — SUPPLEMENTED with first-class `ApprovalRule`, `ApprovalRequest`, `ApprovalStep` collections + idempotency fields (approvalRequestId, actionId, idempotencyKey, executionStatus, executedAt).
9. Service and Inventory Managers assumed cross-division without restriction — CORRECTED: data scope = `COMMON + purchasedDivisions` (never unpurchased).
10. Bulk endpoint entitlement bypass — CORRECTED: `/api/bulk` and `/api/v3/bulk` both enforce company + entitlement + division + permission.
11. Division vs Department confusion in earlier docs — RESOLVED via clear definitions in ROLE_HIERARCHY.md.
12. Filename `WORKFLOW_MAP.md` referenced but file was renamed — FIXED to `BUSINESS_WORKFLOWS.md`.
13. Priority schemes differing across docs — STANDARDIZED to P0/P1/P1.5/P1.6/P1.7/P2…P16.

### Files created this pass
- `DOCUMENT_AUTHORITY.md`
- `CHANGELOG.md`
- `LIVE_APP_SAFETY.md`
- `LEGACY_ROLE_COMPATIBILITY.md`
- `DATABASE_ARCHITECTURE.md`
- `API_ARCHITECTURE.md`

### Files updated this pass
- `ROLE_HIERARCHY.md` (added 5-concept distinction)
- `PLAN_ENTITLEMENTS.md` (added precedence, source enum, cache vs source of truth, division-addon validation)
- `SIDEBAR_ARCHITECTURE.md` (correction header added; CURRENT V2 vs TARGET V3 separation)
- `V3_MIGRATION_MAP.md` (project migration reconciled)
- `ACCESS_MATRIX.md` (source enum sync, project/package model reference)
- `ARCHITECTURE.md` (pointer to authority index)
- `BUSINESS_WORKFLOWS.md` (priority scheme sync)
- `GAP_ANALYSIS.md` (priority scheme sync)

### Not changed
- Production v2 code
- v3 server / web / tests folders (still empty except migration map)
- Database
- Environment

## 2026-08-28 — Sync Pass rev 4 (final architecture decisions)

Final decisions from architecture review baked into docs:

### Decisions confirmed
1. **Sales split** — Sales Manager and Sales Executive are separate designations. Legacy `sales` role → maps to `sales_executive` by default; explicit promotion required for sales_manager.
2. **Engineer structure** — one Engineer/Technician designation; no separate "Projects Engineer". Scope decided by department + division + project/package assignment.
3. **Sub-trade model** — `subTrades[]` array (not single `trade` field). MEP: ELECTRICAL/PLUMBING/FIRE_FIGHTING/OTHER. HVAC: VRF/DUCTED_AC/SPLIT_AC/PIPING/PRESSURE_TESTING/VACUUM_TESTING/LEAK_TESTING/COMMISSIONING. SOLAR: ROOFTOP_ON_GRID/ROOFTOP_OFF_GRID/GROUND_MOUNT/HYBRID/OTHER.
4. **V3 deployment** — separate API boundary `api-v3.mep-projects.spereon.codes`; not connected to production users yet. Dev → Staging → Controlled V3 API → Per-company rollout → Production migration.
5. **Approval architecture** — first-class collections `ApprovalRule`, `ApprovalRequest`, `ApprovalStep`. Super Admin owns systemManaged=true templates (uneditable by company). Company may add non-systemManaged rules and adjust thresholds within limits.
6. **Sidebar architecture** — SIDEBAR_ARCHITECTURE.md now has Part A (CURRENT V2) and Part B (TARGET V3) cleanly separated. Legacy role names appear only in Part A + LEGACY_ROLE_COMPATIBILITY.md.

### Final authority hierarchy baked into DOCUMENT_AUTHORITY.md
```
PLATFORM → PLAN → SUBSCRIPTION → DIVISION ENTITLEMENT → FEATURE ENTITLEMENT
→ ADD-ONS → COMPANY → DESIGNATION → DEPARTMENT → PROJECT/PACKAGE ACCESS
→ PERMISSION → SIDEBAR → DASHBOARD → API
```

### Files updated this pass
- `DOCUMENT_AUTHORITY.md` (rev 4) — added authority hierarchy, invariants list, standardized enums, sales_manager and sales_executive added to designation list
- `ROLE_HIERARCHY.md` (rev 4) — sales split confirmed, engineer structure clarified, no separate Projects Engineer
- `SIDEBAR_ARCHITECTURE.md` (rev 4) — full rewrite with Part A CURRENT V2 + Part B TARGET V3 sections; SALES EXECUTIVE menu added
- `DATABASE_ARCHITECTURE.md` — subTrades[] rule appended; approval collections spec finalized
- `PLAN_ENTITLEMENTS.md` — approval ownership rule appended
- `ACCESS_MATRIX.md` — Sales Manager (12A) + Sales Executive (12B) rows appended
- `CHANGELOG.md` — this entry

### Files not changed this pass (still valid from rev 3)
- `API_ARCHITECTURE.md`, `LIVE_APP_SAFETY.md`, `LEGACY_ROLE_COMPATIBILITY.md`, `ARCHITECTURE.md`, `DASHBOARD_ARCHITECTURE.md`, `V3_MIGRATION_MAP.md`, `BUSINESS_WORKFLOWS.md`, `GAP_ANALYSIS.md`, `PRODUCTION_BASELINE.md`

## 2026-08-28 — Sync Pass rev 5 (documentation consistency, final)

Consistency pass to eliminate residual contradictions between sync-summary banners and body sections.

### Contradictions found
1. **ACCESS_MATRIX.md § PART 8 Stage 2 code snippet** still contained `purchasedDivisions: company.divs || [SOLAR,MEP,HVAC]` — the very fallback the banner said was removed.
2. **ACCESS_MATRIX.md § PART 7** still described `Project.packages[]` as embedded sub-doc; banner said first-class. `ARCHITECTURE.md § M` and `V3_MIGRATION_MAP.md` also listed `packages[]` as a Project field.
3. **ACCESS_MATRIX.md header** was still labelled "rev 2" though banner said "rev 3".
4. **PLAN_ENTITLEMENTS.md header** was still "rev 2".

### Contradictions fixed
1. ACCESS_MATRIX.md § PART 8 Stage 2 pseudocode now reads: `purchasedDivisions: <computed from company.divs — see rule>` with explicit note that missing divs → migrationReviewRequired.
2. ACCESS_MATRIX.md § PART 7 schema block replaced with concise reference to first-class `ProjectPackage` collection; details point to `DATABASE_ARCHITECTURE.md`.
3. ACCESS_MATRIX.md bumped to **rev 3 FINAL** in header, generated line, and verification footer.
4. PLAN_ENTITLEMENTS.md header bumped to **rev 3 FINAL**.
5. ARCHITECTURE.md M-table: Project row now says "first-class ProjectPackage collection (not embedded)".
6. V3_MIGRATION_MAP.md Models table: Project row updated to "first-class ProjectPackage collection".
7. Roadmap week P3 mention of `packages[]` replaced with "first-class ProjectPackage collection".

### Files changed this pass
- `ACCESS_MATRIX.md` — rev 3 FINAL header, Project schema replaced, code snippet fixed
- `PLAN_ENTITLEMENTS.md` — rev 3 FINAL header
- `ARCHITECTURE.md` — Project row + P3 mention updated
- `V3_MIGRATION_MAP.md` — Project row updated
- `CHANGELOG.md` — this entry

### Files unchanged (still consistent)
- `DOCUMENT_AUTHORITY.md`, `ROLE_HIERARCHY.md`, `SIDEBAR_ARCHITECTURE.md`, `DASHBOARD_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `API_ARCHITECTURE.md`, `BUSINESS_WORKFLOWS.md`, `GAP_ANALYSIS.md`, `LIVE_APP_SAFETY.md`, `LEGACY_ROLE_COMPATIBILITY.md`, `PRODUCTION_BASELINE.md`

## 2026-08-28 — Sync Pass rev 6 (final consistency)

Verification pass across all 16 docs found 2 residual contradictions inside ACCESS_MATRIX.md § PART 8 Stage 2 pseudocode.

### Contradictions found (2)
1. `source:'legacy'` used in DivisionEntitlement + FeatureEntitlement create calls (lines 609, 611). Invalid — only `plan|addon|manual|migration` are valid enum values.
2. `Company.entitlements = { divisions: [SOLAR,MEP,HVAC], ... }` hardcoded three divisions in the legacy-backfill compute. Contradicted the rule that legacy migration must derive from `company.divs` and never auto-grant.

### Contradictions fixed
1. Both `source:'legacy'` → `source:'migration'`.
2. Backfill compute now reads: `divisions: company.divs (no auto-expansion)`, plus `computedFrom` provenance and `source: 'migration'` marker.

### Files changed this pass
- `ACCESS_MATRIX.md` — Stage 2 pseudocode source enum + entitlement compute fixed
- `CHANGELOG.md` — this entry

### Legitimate `[SOLAR,MEP,HVAC]` occurrences kept
- `ACCESS_MATRIX.md § PART 0 Plan schema` — describes `availableDivisions` as an enum array type (schema doc, not runtime assignment)
- `ARCHITECTURE.md § Plan schema` — same schema doc

Both are correct type documentation, not migration behavior. No change needed.

### Verification (all clean)
- 0 real `company.divs || [SOLAR,MEP,HVAC]` fallback occurrences
- 0 `packages: [` embedded schema in body
- 0 invalid `source` enum values
- 0 hardcoded division-set assignments in migration flow
- LEGACY_UNLIMITED occurrences all in hidden/internal/migration context
- Legacy role names appear only in PRODUCTION_BASELINE, LEGACY_ROLE_COMPATIBILITY, SIDEBAR Part A, GAP_ANALYSIS, ARCHITECTURE, ROLE_HIERARCHY, ACCESS_MATRIX (all legitimate compat contexts)

## 2026-08-28 — Sync Pass rev 7 (FINAL FREEZE)

### Contradictions found (4 in ACCESS_MATRIX.md)
1. Line 623: "all divisions on, all features on" — contradicted rule that legacy backfill only grants verified divisions
2. Line 403: "Approvals matrix is per-company data in Company.settings.approvalMatrix" — contradicted first-class ApprovalRule/Request/Step
3. Line 430: pseudocode block declaring `Company.settings.approvalMatrix: [...]` as the engine
4. Line 537: "Auto-create one Package copying: chk, updates, engs, pm, value" — contradicted "no history duplication" rule

### Contradictions corrected
1. Rewritten as: "every successfully mapped legacy company retains **exactly** its verified pre-V3 division access; companies with missing/invalid divs → migrationReviewRequired=true, NO automatic grant"
2. Replaced with reference to first-class collections (ApprovalRule/ApprovalRequest/ApprovalStep); Company.settings holds preferences ONLY
3. Pseudocode block renamed to `companyApprovalPreferences` with header noting authority lives in first-class collections
4. Rewritten as: "NO Package materialization on backfill; compat adapter presents legacy Project as one virtual package for reads; real ProjectPackage row materialized only on explicit Company Admin conversion or new multi-division project"

### Final status stamps added
- `ACCESS_MATRIX.md` — top banner: **V3 AUTHORIZATION SPECIFICATION · STATUS: FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**
- `PLAN_ENTITLEMENTS.md` — top banner: **V3 SAAS ENTITLEMENT SPECIFICATION · STATUS: FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**
- `DOCUMENT_AUTHORITY.md` — top banner: **V3 DOCUMENTATION FREEZE · Status: FINAL · Implementation: NOT STARTED**

### Canonical precedence rule added to DOCUMENT_AUTHORITY.md
```
EXPLICIT MANUAL DISABLE > EXPLICIT MANUAL ENABLE > ADD-ON GRANT > SUBSCRIPTION PURCHASE > PLAN DEFAULT
```
Plus 5 worked examples.

### Super Admin support-access rule added to DOCUMENT_AUTHORITY.md
- Read-only default
- Fully audited with reason
- "Support Op" flag required for mutations, notifies Company Admin
- Never bypasses company isolation

### Files changed this pass
- `ACCESS_MATRIX.md` — 4 fixes + FROZEN status banner
- `PLAN_ENTITLEMENTS.md` — FROZEN status banner
- `DOCUMENT_AUTHORITY.md` — FROZEN status banner + canonical precedence + super-admin support rule
- `CHANGELOG.md` — this entry

### Files unchanged (still valid from prior rev)
API_ARCHITECTURE.md, ROLE_HIERARCHY.md, SIDEBAR_ARCHITECTURE.md, DASHBOARD_ARCHITECTURE.md, DATABASE_ARCHITECTURE.md, BUSINESS_WORKFLOWS.md, GAP_ANALYSIS.md, V3_MIGRATION_MAP.md, LIVE_APP_SAFETY.md, LEGACY_ROLE_COMPATIBILITY.md, PRODUCTION_BASELINE.md, ARCHITECTURE.md

### DOCUMENTATION FROZEN
The v3 documentation set is now **FINAL** and **FROZEN**. Application code has NOT been implemented. Ready for P0 Live Safety kickoff.

## 2026-08-28 — Sync Pass rev 8 (FINAL VERIFICATION)

Verification found 4 remaining `approvalMatrix` mentions in CURRENT/authoritative sections. All corrected in place:

### Contradictions found (4)
1. `ACCESS_MATRIX.md:598` Stage 1 said "Seed default approvalMatrix rows"
2. `ROLE_HIERARCHY.md:69` Sales Manager said "(per approvalMatrix)"
3. `DATABASE_ARCHITECTURE.md:15` Company adaptation had `settings.approvalMatrixRef`
4. `V3_MIGRATION_MAP.md:52` Company adaptation had `settings.approvalMatrix`

### Corrections
1. → "Seed default `ApprovalRule` rows (first-class collection)"
2. → "Manages sales approvals (per `ApprovalRule` — first-class collection)"
3. → `settings.approvalPreferences` (preferences ONLY; workflow history in first-class ApprovalRule/ApprovalRequest/ApprovalStep)
4. → same clarification

### Files changed
- ACCESS_MATRIX.md, ROLE_HIERARCHY.md, DATABASE_ARCHITECTURE.md, V3_MIGRATION_MAP.md, CHANGELOG.md

### Verification result
✅ Zero CURRENT contradictions across all 13 authoritative docs.

## 2026-09-10 — rev 9 (ADDITIVE — PWA-proven business workflow requirement)

**Type:** Addition, not a correction. The rev 1–8 freeze is unchanged; nothing here reopens entitlement precedence, ProjectPackage-as-first-class-collection, first-class approval collections, or any other frozen decision.

**Source:** legacy PWA proved a business relationship in live production — `Project` is the operational bridge between `Checklist` (execution) and `Accounts/Finance` (commercial), via `SalesOrder → paymentMilestones[] → Raise to Finance → Accounts`. Only the relationship is preserved, not the PWA's implementation.

### What was added
1. **Data model** (`DATABASE_ARCHITECTURE.md` Rev 9 addendum): `SalesOrder.paymentMilestones[]`, new `FinanceWorkItem` collection, `Payment` finance-linkage fields (`salesOrderId`, `projectId`, `projectPackageId`, `milestoneRef`, `financeWorkItemId`). All additive/nullable; zero impact on existing records.
2. **Business workflow** (`BUSINESS_WORKFLOWS.md`): new steps 35a (Raise to Finance) and 35b (Finance Records Payment), both P6; full "PWA-Proven Workflow Compatibility Requirement" addendum with the preserved-relationship diagram, role flow, forbidden-relationships list, required end-to-end test, and legacy-migration rule (nullable refs, `migrationReviewRequired=true`, never invent history).
3. **Authorization** (`ACCESS_MATRIX.md`): new §13 CROSS-FUNCTIONAL WORKFLOW GUARDRAILS; updated §4 (Project Manager gains Raise to Finance, not Payment write), §10 (Engineer/Technician explicitly barred from any financial write), §11 (Accounts gains FinanceWorkItem view/claim/resolve, explicitly barred from operational modules).
4. **API** (`API_ARCHITECTURE.md`): added `/api/v3/sales-orders/:id/milestones/:mIdx/raise-to-finance` and `/api/v3/finance-work-items` (+`/claim`, `/resolve`).
5. **Live safety** (`LIVE_APP_SAFETY.md`): added `FinanceWorkItem` to the whitelist of collections v3 may create.
6. **Migration map** (`V3_MIGRATION_MAP.md`): documented `SalesOrder.js`/`Payment.js` field additions and new `FinanceWorkItem.js`, all with the never-backfill-historical-payments rule.
7. **Document authority** (`DOCUMENT_AUTHORITY.md`): added topic row for the new workflow; added global invariant "Checklist ≠ Payment."
8. **Dashboards/Sidebar** (`DASHBOARD_ARCHITECTURE.md`, `SIDEBAR_ARCHITECTURE.md`): added the previously-undefined `FinanceDashboard.jsx` (Accounts had no dashboard at all pre-rev-9) with a Finance Work Items queue; added Payment Milestone widgets to Project Control Dashboard; clarified existing PM "Commercial" / Accounts "Finance" sidebar items now cover this flow.

### Explicitly NOT created (per requirement)
Accounts → Checklist ownership · Checklist → Payment direct write · Engineer → Payment responsibility · Checklist completion → automatic payment receipt · Accounts as operational Project Manager.

### Files changed
- DATABASE_ARCHITECTURE.md, BUSINESS_WORKFLOWS.md, ACCESS_MATRIX.md, API_ARCHITECTURE.md, LIVE_APP_SAFETY.md, V3_MIGRATION_MAP.md, DOCUMENT_AUTHORITY.md, DASHBOARD_ARCHITECTURE.md, SIDEBAR_ARCHITECTURE.md, CHANGELOG.md

### Files audited, no change needed
- ROLE_HIERARCHY.md (existing designations — project_manager, engineer/technician, executive+dept=ACCOUNTS — already cover every role this workflow needs)
- ARCHITECTURE.md, GAP_ANALYSIS.md, PRODUCTION_BASELINE.md, LEGACY_ROLE_COMPATIBILITY.md, PLAN_ENTITLEMENTS.md (superseded/historical planning docs or out of scope for this addition)

### Verification result
✅ Addition is fully additive — no rev 1–8 decision modified, contradicted, or reopened. Still **FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**.

## 2026-09-11 — rev 10 (ADDITIVE — Checklist as a common operational execution engine)

**Type:** Addition, not a correction. Does not reopen rev 1–9. Clarifies and extends rev 9's `ChecklistInstance` outline (which was Finance-adjacent by necessity, not by design) into the full execution-engine model — supersedes the minimal `{title, done, doneBy, doneAt, note, photos[]}` sketch in the original `BUSINESS_WORKFLOWS.md` step 24.

**Source:** Checklist's primary purpose is project execution — task, assignment, responsibility, evidence, approval, progress tracking. Finance is only one optional downstream consequence (unchanged rev 9 rule); Checklist must remain useful for tasks with zero financial consequence.

### What was added
1. **Data model** (`DATABASE_ARCHITECTURE.md` Rev 10 addendum): full `ChecklistInstanceItem` shape (first-class collection) — extensible `responsibilityType` (ENGINEER/CLIENT/SALES/SERVICE/PROJECT_MANAGER/TECHNICIAN), 8-state status lifecycle (PENDING→ASSIGNED→IN_PROGRESS→SUBMITTED→APPROVED/REJECTED/COMPLETED/WAIVED), evidence[], first-class-ApprovalRequest-based approval, client sign-off fields, PM sign, progress calculation rule (required/actionable items only, never Finance-derived), reuse-across-modules rule, and the legacy `Project.chk[]` field-mapping table (read-only, never reconstructed).
2. **Business workflow** (`BUSINESS_WORKFLOWS.md`): rewrote step 24 CHECKLIST; added the "Checklist as a Common Operational Execution Engine" addendum — core concept diagram, responsibility-type examples, Engineer/PM/Service/Sales workflows, client sign-off, status/overdue/evidence/approval rules, progress rule, Finance reaffirmation (never automatic), reuse-across-modules rule, required UI (Project/Package view + universal "My Work" queue), reporting requirements, and the 10-step acceptance test.
3. **Authorization** (`ACCESS_MATRIX.md`): split §13 into §13.1 (Finance, unchanged from rev 9) and new §13.2 (Checklist execution-engine guardrails with explicit CAN/CANNOT per actor); updated §4 (PM checklist authority), §9 (Service checklist reuse), §10 (Engineer CAN/CANNOT), §11 (Accounts CAN/CANNOT), §12A/§12B (Sales checklist responsibility scope).
4. **API** (`API_ARCHITECTURE.md`): added ChecklistInstance/Item routes (apply/assign/start/submit/approve/reject/waive/client-sign) and `/api/v3/me/work`; added `responsibilityType`-aware scoping to `scopeFilterV3`.
5. **Live safety** (`LIVE_APP_SAFETY.md`): added `ChecklistInstanceItem` to the whitelist of collections v3 may create.
6. **Migration map** (`V3_MIGRATION_MAP.md`): documented `ChecklistInstanceItem.js` (new, first-class) and `MyWork.jsx`; cross-referenced the legacy field-mapping table.
7. **Document authority** (`DOCUMENT_AUTHORITY.md`): added topic row; added two invariants — "Checklist ≠ Finance-only feature" and "Responsibility ≠ Assignment ≠ Approval."
8. **Role taxonomy** (`ROLE_HIERARCHY.md`): added CHECKLIST RESPONSIBILITY TYPE as a 6th distinct concept (was previously undocumented as a concept, though implied by rev 9's PWA responsibility note) — explicitly not a security grant on its own.
9. **Dashboards/Sidebar** (`DASHBOARD_ARCHITECTURE.md`, `SIDEBAR_ARCHITECTURE.md`): added universal "My Work" queue (Field Dashboard); Checklist Approval Queue + Overdue + Progress-by-Package widgets (Project Control); SALES checklist widget (Sales Dashboard); Service Checklist Approvals widget (Service Dashboard); sidebar footnotes clarifying which existing nav items now cover checklist responsibility work (no new nav items needed except the existing Engineer "My Work," now formally defined).

### Explicitly NOT created (per requirement)
A checklist engine per module (one common engine only) · Finance as owner of Checklist · `done: true/false` as the sole status representation · an informal approval mechanism inside `Company.settings` · reconstructed historical checklist execution from the current template.

### Files changed
- DATABASE_ARCHITECTURE.md, BUSINESS_WORKFLOWS.md, ACCESS_MATRIX.md, API_ARCHITECTURE.md, LIVE_APP_SAFETY.md, V3_MIGRATION_MAP.md, DOCUMENT_AUTHORITY.md, ROLE_HIERARCHY.md, DASHBOARD_ARCHITECTURE.md, SIDEBAR_ARCHITECTURE.md, CHANGELOG.md

### Files audited, no change needed
- ARCHITECTURE.md, GAP_ANALYSIS.md, PRODUCTION_BASELINE.md, LEGACY_ROLE_COMPATIBILITY.md, PLAN_ENTITLEMENTS.md (superseded/historical planning docs or out of scope for this addition)

### Verification result
✅ Addition is fully additive — no rev 1–9 decision modified, contradicted, or reopened. Still **FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**.

## 2026-09-11 — rev 11 (ADDITIVE — Inventory: reusable tool custody vs. project material lifecycle)

**Type:** Addition, not a correction. Does not reopen rev 1–10. Splits the legacy PWA's single `ret`-boolean inventory model into two explicit lifecycles without touching any existing v2 inventory collection's shape beyond additive optional fields.

**Source:** the legacy PWA conflates company-owned tools/equipment (custody-tracked, never consumed) with project consumables (requisitioned, issued, used, sometimes returned as excess or scrapped) under one model and one boolean. V3 must keep these explicit and separate, and must ensure the Project Manager only reports/requests while the Inventory Manager alone performs the physical stock transaction after independent verification — which may legitimately differ from what the PM declared.

### What was added
1. **Data model** (`DATABASE_ARCHITECTURE.md` Rev 11 addendum): `InvItem.itemType: REUSABLE_TOOL_ASSET | PROJECT_MATERIAL`; first-class `ToolCustody` (issue/return/reissue custody lifecycle, status enum AVAILABLE→…→RETIRED); extended `MaterialRequest` (requiredQty/requestedQty/approvedQty/issuedQty/usedQty/returnedQty/scrapQty, derived `remainingOnSiteQty`) and new first-class `MaterialReturnRequest` (the Excess/Return Form, with separately-tracked `declared*` vs. `verified*`/`accepted*` fields — the verification split is FINAL and never reconciled to match the PM's number); first-class `StockTransfer` (division-safe inter-project transfer); `InvTransaction.type` extended to a 12-value enum. All additive/nullable; zero impact on existing records.
2. **Business workflow** (`BUSINESS_WORKFLOWS.md`): extended steps 20 (STOCK) and 21 (PROJECT ISSUE); added steps 21a (TOOL CUSTODY), 21b (MATERIAL EXCESS / RETURN), 21c (STOCK TRANSFER); full "Inventory: Reusable Tool Custody vs. Project Material Lifecycle" addendum with core-concept diagram, PM/Inventory Manager/Engineer workflows, forbidden-relationships list, and the three required acceptance scenarios (tool custody reissue; project-material excess with partial scrap; cross-project transfer).
3. **Authorization** (`ACCESS_MATRIX.md`): new §13.3 INVENTORY GUARDRAILS with explicit CAN/CANNOT per actor; updated §4 (PM — report/request only, never alters stock), §8 (Inventory Manager — sole verifier/poster of stock transactions), §10 (Engineer/Technician — usage/condition reporting only), §11 (Accounts — read-only Material Cost report access, no operational write).
4. **API** (`API_ARCHITECTURE.md`): added `/api/v3/material-returns` (+`/submit`, `/verify`, `/reject`), `/api/v3/stock-transfers` (+`/approve`, `/verify-receipt`, `/cancel`), `/api/v3/tools/:toolId/custody` (+`/issue`, `/return`, `/report-condition`); added `itemType`-aware read-scope to `scopeFilterV3` and a separate write-side `requirePermission('inventory.verify')` gate held only by the Inventory Manager, independent of read-scope.
5. **Live safety** (`LIVE_APP_SAFETY.md`): added `MaterialReturnRequest`, `ToolCustody`, `StockTransfer` to the whitelist of collections v3 may create.
6. **Migration map** (`V3_MIGRATION_MAP.md`): re-classified `InvItem.js`/`InvTransaction.js` from REUSE to ADAPT; added new-model rows for `MaterialReturnRequest.js`/`ToolCustody.js`/`StockTransfer.js`; documented the legacy `ret` boolean field mapping (never a single uniform mapping — depends on resolved `itemType`; ambiguous rows get `migrationReviewRequired=true`, never guessed).
7. **Document authority** (`DOCUMENT_AUTHORITY.md`): added topic row; added two invariants — "Custody ≠ Consumption" and "PM declaration ≠ verified stock transaction."
8. **Dashboards/Sidebar** (`DASHBOARD_ARCHITECTURE.md`, `SIDEBAR_ARCHITECTURE.md`): added My Material Return Requests / My Stock Transfer Requests / Tools in Custody widgets (Project Control Dashboard); added Material Return Verification Queue / Stock Transfer Queue / Tool Custody Register / Overdue Tool Returns widgets and the four-part report (Inventory Dashboard); sidebar footnotes clarifying existing PM "Material" and Inventory Manager "Material Control"/"Project Material"/"Reports (inv)" items now cover this flow — no new nav items.

### Explicitly NOT created (per requirement)
A PM-facing endpoint that posts `InvTransaction` or alters `InvItem` stock · `REUSABLE_TOOL_ASSET` items decremented as "consumed" · a `StockTransfer`/`MaterialReturnRequest` that crosses MEP↔HVAC · a dual-mode `InvItem` that is both a tool and a material at once · an informal excess-return mechanism inside `Company.settings` · a verification step that silently overwrites the PM's declared figures instead of recording the verified split · reconstructed historical custody/return relationships from legacy `ret` data.

### Files changed
- DATABASE_ARCHITECTURE.md, BUSINESS_WORKFLOWS.md, ACCESS_MATRIX.md, API_ARCHITECTURE.md, LIVE_APP_SAFETY.md, V3_MIGRATION_MAP.md, DOCUMENT_AUTHORITY.md, DASHBOARD_ARCHITECTURE.md, SIDEBAR_ARCHITECTURE.md, CHANGELOG.md

### Files audited, no change needed
- ROLE_HIERARCHY.md (Inventory Manager, Project Manager, Engineer/Technician, Accounts/Executive designations already cover every role this workflow needs — `itemType`/custody are data-model concepts, not a new taxonomy concept, unlike rev 10's Checklist Responsibility Type)
- ARCHITECTURE.md, GAP_ANALYSIS.md, PRODUCTION_BASELINE.md, LEGACY_ROLE_COMPATIBILITY.md, PLAN_ENTITLEMENTS.md (superseded/historical planning docs or out of scope for this addition)

### Verification result
✅ Addition is fully additive — no rev 1–10 decision modified, contradicted, or reopened. Still **FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**.

## 2026-09-11 — rev 12 (ADDITIVE — Global Record Ownership, Edit & Delete Control, platform-wide)

**Type:** Addition, not a correction. Does not reopen rev 1–11. Unlike rev 9–11 (each scoped to one workflow/module), rev 12 is explicitly platform-wide: it defines one reusable ownership/authorization layer and applies it uniformly across Sales, Finance/Accounts, Admin, Inventory, Solar/MEP/HVAC PM, Service, Engineer/Technician, and every future module — never a per-module reimplementation.

**Source:** V3 must guarantee that a record's creator is its authoritative owner and default editor/deleter; that role, department, division, or company membership alone never grants edit/delete on another user's record; that Manager/Admin corrections to another user's record are always controlled and audited, never silent; and that ownership and role-permission are two independent, both-required checks, evaluated identically everywhere.

### What was added
1. **Data model** (`DATABASE_ARCHITECTURE.md` Rev 12 addendum): mandatory ownership metadata block (`createdByUserId` — authoritative, `createdByName` — display only, `createdAt`, `updatedByUserId`, `updatedAt`, plus the existing `status`/soft-delete triad) added additively to every v3 collection, present and future; new first-class `RecordCorrection` collection (originalRecordId/Collection/CreatedByUserId, overrideByUserId/At, reason, oldValue/newValue) as the sole sanctioned override path.
2. **Business workflow** (`BUSINESS_WORKFLOWS.md`): "Global Record Ownership, Edit & Delete Control" addendum — not a new numbered step, but an explicit constraint on the Edit/Delete/Correction action inside every existing step; per-role workflow impact examples across Sales/PM/Inventory/Accounts/Manager; forbidden-relationships list; the 8-scenario acceptance test; legacy migration rule (no invented ownership).
3. **Authorization** (`ACCESS_MATRIX.md`): new §13.4 GLOBAL RECORD OWNERSHIP, EDIT & DELETE CONTROL with explicit CAN/CANNOT per actor class (creator, other user, Manager/Admin, cross-module actor), forbidden-relationships list, invariant statement, and the full acceptance-test list — applies on top of, and never overrides, §1–§13.3.
4. **API** (`API_ARCHITECTURE.md`): added `requireOwnership()` to the middleware chain (§1) as step 6, running on every Edit/Delete/Correction route platform-wide; added the `requireOwnership()` pseudocode primitive (§7) evaluating ownership + explicit override + record state independently of `requirePermission()`; added `RecordCorrection` read routes (§2); extended the destructive-action guard (§4) to run `requireOwnership()` first; extended the AuditLog `action` enum (§9) to the full platform-wide set (CREATE/UPDATE/DELETE/SUBMIT/APPROVE/REJECT/ASSIGN/CLOSE/REOPEN/OVERRIDE/CORRECT/REVERSE).
5. **Live safety** (`LIVE_APP_SAFETY.md`): added `RecordCorrection` to the whitelist of collections v3 may create; added the ownership-gate rule to Data safety.
6. **Migration map** (`V3_MIGRATION_MAP.md`): added `RecordCorrection.js` (new, first-class); documented that `createdByUserId` is backfilled only where a reliable legacy creator field exists, never invented — consistent with the rev 10 `chk[]` / rev 11 `ret` migration philosophy.
7. **Document authority** (`DOCUMENT_AUTHORITY.md`): added topic row; added two invariants — "Ownership ≠ Role ≠ Permission" and "Manager/Admin edit ≠ Creator ownership."

### Explicitly NOT created (per requirement)
Edit/delete authorization based on role/department/division/company membership alone · Manager/Admin editing treated as equivalent to creator ownership · any silent field-level overwrite of another user's record outside `RecordCorrection` · `createdByName` used in any authorization decision · a UI-only edit/delete restriction with no server-side enforcement · hard-delete of business history · a separate per-module ownership implementation (Sales-specific, Inventory-specific, etc.) instead of one shared platform-wide layer · invented `createdByUserId` on migrated records with no reliable legacy creator.

### Files changed
- DATABASE_ARCHITECTURE.md, BUSINESS_WORKFLOWS.md, ACCESS_MATRIX.md, API_ARCHITECTURE.md, LIVE_APP_SAFETY.md, V3_MIGRATION_MAP.md, DOCUMENT_AUTHORITY.md, CHANGELOG.md

### Files audited, no change needed
- ROLE_HIERARCHY.md (ownership is a data/authorization concept applied uniformly to existing designations — it introduces no new role, designation, department, or division concept, unlike rev 10's Checklist Responsibility Type)
- DASHBOARD_ARCHITECTURE.md, SIDEBAR_ARCHITECTURE.md (no new widgets or nav items required — ownership enforcement is a backend authorization layer; existing Edit/Delete UI affordances already route through the same API endpoints that now additionally enforce `requireOwnership()`)
- ARCHITECTURE.md, GAP_ANALYSIS.md, PRODUCTION_BASELINE.md, LEGACY_ROLE_COMPATIBILITY.md, PLAN_ENTITLEMENTS.md (superseded/historical planning docs or out of scope for this addition)

### Verification result
✅ Addition is fully additive — no rev 1–11 decision modified, contradicted, or reopened. Still **FINAL — ARCHITECTURE FROZEN · CODE STATUS: NOT YET IMPLEMENTED**.
