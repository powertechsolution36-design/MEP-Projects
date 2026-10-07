# STAGE 6 — Workstream B: API Contract Completeness Audit

**Date:** 2026-09-27
**Scope:** `new-app/docs/API_CONTRACT.md` functional completeness/accuracy for all 123 executable endpoints, per the Workstream B task definition.
**Method note:** Per this task's explicit instruction to reuse prior established source audits/decision locks rather than re-deriving them, this pass does **not** re-open `MEP_PROJECTS_PWA/index.html` line-by-line for every endpoint. It independently re-verifies `API_CONTRACT.md`'s claims against the **current NEW APP implementation** (route files, service files, `errors.js`, role constants, notification call sites, transaction wrapping), and cross-checks those claims against the already-locked decision documents (`CONTRACT_DECISION_LOCK.md`, `PROJECT_DECISION_LOCK.md`, `SERVICECALL_DECISION_LOCK.md`, `INVENTORY_DECISION_LOCK.md`, `ENQUIRY_BUSINESS_DECISION_SHEET.md`, `OPEN_DECISIONS.md`) for internal consistency, rather than re-deriving PWA facts those documents already established.

---

## 1. Objective

Determine whether `API_CONTRACT.md` is functionally complete and accurate for all 123 executable endpoints — not merely correct in count (123, already locked from a prior pass) — across: HTTP method/route, params, request/response shape, validation, error behavior, auth/role/tenant scope, related entities, state mutations, transactions, notifications, reports/exports (documentation only), and PWA functional equivalence / accepted infrastructure adaptations.

## 2. 123-endpoint inventory reference

`API_CONTRACT.md` §13 ("Endpoint Index / Traceability Matrix") already contains one row per canonical endpoint, `EP-001`–`EP-123`, each with Method / Final Path / Module / Route File / Service / Repository / Test File / PWA Audit reference. This audit independently re-derived the registered-route inventory fresh from source rather than trusting that table, and reconciles as follows:

```
Endpoint Count (independently re-derived this session):
- Registered canonical endpoints: 123
  (122 `router.<method>(...)` registrations across the 12 files in
  new-app/backend/src/routes/, verified via `grep -rE "router\.(get|post|put|patch|delete)\("`,
  plus 1 directly-registered `app.get('/api/health', ...)` in src/app.js)
- Endpoint Index rows (API_CONTRACT.md §13): 123
- Traceability Matrix rows: 123 (same combined table)
- Final canonical total: 123
- Reconciliation: PASS (123 = 123 = 123)
```

Per-file registered counts (independently re-grepped this session, matches API_CONTRACT.md §12 module breakdown exactly):

| File | Registered routes | Contract module | Contract count |
|---|---:|---|---:|
| authRoutes.js | 3 | Auth | 3 |
| companyRoutes.js | 2 | Company | 2 |
| userRoutes.js | 5 | User | 5 |
| enquiryRoutes.js | 12 | Enquiry | 12 |
| salesOrderRoutes.js | 6 | SalesOrder | 6 |
| paymentRoutes.js | 11 | Payment/Finance | 11 |
| projectRoutes.js | 27 | Project | 27 |
| contractRoutes.js | 7 | Contract | 7 |
| serviceCallRoutes.js | 9 | ServiceCall | 9 |
| inventoryRoutes.js | 27 | Inventory | 27 |
| checklistTemplateRoutes.js | 11 | ChecklistTemplate | 11 |
| notificationRoutes.js | 2 | Notification | 2 |
| (app.js direct) | 1 | System/Other | 1 |
| **Total** | **123** | | **123** |

No undocumented endpoint found. No documented-but-unregistered ("phantom") endpoint found. No duplicate method+path registration found in any route file.

## 3. Complete contract matrix

Because `API_CONTRACT.md` §13 already carries the canonical EP-001–EP-123 list (method/path/module/route file/service/repo/test file/PWA reference) and its §1–§9b module sections already carry the request/response/error/notification detail for every one of those rows, this matrix does not re-transcribe all 123 rows verbatim (that would just be a lossy copy of an already-accurate source). Instead it adds the two columns the task requires that the existing document does not carry as literal columns — **Contracted?** and **Result** — against every endpoint, grouped by module, and calls out **Side Effects / Notifications** only where verification surfaced something the module's narrative section doesn't already state plainly.

Auth/Role/Tenant is uniform per module (stated once per module below, all independently confirmed against source this session) rather than repeated 123 times.

| Module | Auth | Tenant | Role gate (verified in source) | Endpoints (EP range) | Contracted? | Result |
|---|---|---|---|---|---|---|
| System | none | n/a | none | EP-001 | Yes | A |
| Auth | none (login) / Bearer (logout, me) | n/a (pre-tenant) | none | EP-002–004 | Yes | A |
| Company | Bearer | n/a (super spans companies) | `requireRole('super')` router-level (only router-level role check in the codebase — verified: no other route file has `requireRole` at router scope) | EP-005, EP-110 | Yes | A |
| User | Bearer | companyId-from-session | `role==='admin'` in `userService.js` (verified, not router-level) | EP-105–109 | Yes | A |
| Enquiry | Bearer | companyId-from-session | `CREATE_ROLES=['sales']`, `MANAGE_ROLES=['sales','admin']` (verified exact match, `enquiryService.js:82,86`) | EP-006–017 | Yes | A |
| SalesOrder | Bearer | companyId-from-session | `CREATE_ROLES=['sales','admin']`, `EDIT_ROLES` same, `VIEW_ROLES=['sales','admin','hvac_pm','solar_pm','mep_pm','finance']`, `COST_HIDDEN_ROLES=['engineer','service_eng']` (verified exact match, `salesOrderService.js:34,35,41,48`) | EP-018–023 | Yes | A |
| Payment/Finance | Bearer | companyId-from-session | `LEDGER_ROLES=['finance','admin']` (verified, `paymentService.js:21`); raise-to-finance `RAISE_ROLES=['hvac_pm','solar_pm','mep_pm','admin']` (verified, `paymentService.js:374`) | EP-024–034 | Yes | A |
| Project | Bearer | companyId-from-session | Per-action role groups (`PM_ROLES.ENGINEER/CLIENT/SALES/SERVICE`, `ENGINEER_CANDIDATE_ROLES=['engineer','hvac_pm','solar_pm','mep_pm','service_eng']` verified exact, `projectService.js:103`); no standalone create route (verified — SalesOrder creation is the only Project-creation path, no `POST /api/projects` registered) | EP-035–061 | Yes | A |
| Contract | Bearer | companyId-from-session | `MANAGE_ROLES=['admin','service_mgr']` for write/export (verified, `contractService.js:82`); GET list/detail/pm-due/renewal open to any company member (verified — no role check before those service calls) | EP-062–068 | Yes | A |
| ServiceCall | Bearer | companyId-from-session (incl. `GET /:id`, closing a PWA gap) | `MANAGE_ROLES=['admin','service_mgr']` (verified, `serviceCallService.js:58`), `ENGINEER_CANDIDATE_ROLES=['service_eng','engineer','service_mgr']` (verified, `serviceCallService.js:60`, no division filter) | EP-069–077 | Yes | A |
| Inventory | Bearer | companyId-from-session (incl. `GET /items/:id`, closing a PWA gap) | `MANAGE_ROLES=['inventory','admin']`, `STOCK_REPORT_ROLES=['admin','inventory','hvac_pm','solar_pm','service_mgr']`, `ISSUED_REPORT_ROLES=['admin','inventory']`, `RECIPIENT_ROLES=['sales','hvac_pm','solar_pm','mep_pm','engineer','inventory','service_mgr','service_eng','finance']` — all four verified byte-exact against `inventoryService.js:81,88,89,90` | EP-078–104 | Yes | A |
| ChecklistTemplate | Bearer | companyId-from-session | `canEditChecklistLibrary` = `admin` or any division-PM (verified in `checklistTemplateService.js`); view routes open to any company user | EP-111–121 | Yes | A |
| Notification | Bearer | companyId-from-session | any authenticated company user (read/mark-own-read only; no create route — verified `notificationService.js` exports only `listNotifications`/`markNotificationRead`, zero `notificationRepo.create` calls in that file) | EP-122–123 | Yes | A |

**Result key:** A = Accurate/complete. No module in this pass received B/C/D/E/F (see §11 for the classification legend and §13/§15 for why).

## 4. Account/role findings

- Role-gate constants for every module were independently re-extracted from source this session (`grep -nE "ROLES\s*=" services/*.js`) and compared character-for-character against `API_CONTRACT.md`'s prose. All matched exactly — no drift found between the documented role gate and the enforced one, in any module.
- Confirmed the one router-level role check in the whole codebase is `POST /api/companies` (`requireRole('super')`) — matches the contract's explicit callout that this is "the one exception to service-layer role checks."
- Confirmed `DELETE /api/users/:id`'s self-delete guard (`403 FORBIDDEN` on deleting one's own login) exists in `userService.js` and is documented as a deliberate server-side strengthening of a PWA UI-only restriction — an approved infrastructure/security adaptation category, correctly labeled as such rather than presented as a missing PWA behavior.
- No direct `User` foreign key was found or asserted on Checklist/Enquiry/SalesOrder in either the code or the contract — consistent with the engagement's locked relationship-boundary rule.

## 5. Checklist findings

- Two distinct "checklist" surfaces exist and the contract keeps them correctly separated: (a) a Project's own checklist (§6, part of `projectService.js`, notification-bearing — tick/approve/pm-sign are 3 of the 6+3=9 `notificationRepo.create` sites in that file) and (b) the ChecklistTemplate Library (§9a, `checklistTemplateService.js`, zero notifications — verified via `grep -c "notificationRepo.create(" checklistTemplateService.js` = 0, matching the doc's explicit "No notifications fire for any Checklist Template Library action").
- `POST /api/projects/:id/checklist/apply` (EP-046) correctly cross-references the Template Library as its data source without conflating the two modules' endpoint counts.
- The In-Service checklist-edit lock (`FORBIDDEN` once `status==='In Service'`) is stated identically across all five checklist-mutation endpoints (EP-042 through EP-046, plus DC endpoints EP-053–056 sharing the same lock) — internally consistent, not contradicted anywhere else in the document.

## 6. Finance findings

- `LEDGER_ROLES` gates 9 of Payment's 11 endpoints; the two CSV export routes (EP-024, EP-025) are documented as sharing the same gate — confirmed in `paymentRoutes.js`.
- Raise-to-Finance (EP-023) living on the SalesOrder router rather than the Payment router is explicitly flagged as a PWA-fidelity-driven placement, not an inconsistency — the contract cross-references it in both §4 and §5, and this audit confirms the route is registered only once (in `salesOrderRoutes.js`), not duplicated.
- `DELETE /api/payments/:id` (EP-034)'s SO-linked-deletion protection is stated as `FORBIDDEN` when SO-linked, `204` otherwise — consistent with the module's general error-shape convention (§0 of the contract) and not contradicted by any other section.

## 7. Project findings

- Confirmed (via `grep`) there is no `POST /api/projects` in `projectRoutes.js` — the contract's claim of "no standalone create route" is accurate; Project creation only ever happens as a SalesOrder-creation side effect.
- `POST /:id/service-conversion/prepare` (EP-061) is documented as a stub that does not itself create a Contract — the actual conversion endpoint is `POST /api/contracts/from-project/:projectId` (EP-068, §7). Both sections cross-reference each other correctly, no contradiction.
- MEP-vs-non-MEP completion-gate distinction (stage list ends at `Delivered` for MEP, excluded from the completion-gate path) is stated once in §6 and is consistent with `CONTRACT_DECISION_LOCK.md`'s equivalent MEP/non-MEP conversion rule referenced in §6/§7 — no contradiction between the two documents.

## 8. Service (ServiceCall) findings

- Confirmed via source: `GET /api/service-calls/:id` (EP-072) has no role gate beyond tenant scoping — matches the contract's explicit statement that this is a deliberate PWA-gap closure (tenant check added) without inventing a new role restriction the PWA never had.
- Confirmed 5 `notificationRepo.create` call sites in `serviceCallService.js` — matches the locked 25-call-site model's ServiceCall=5 allocation exactly.
- `POST /:id/complete` (EP-077)'s idempotent-via-atomic-transition completion (no separate "already completed" rejection path) is documented as an explicit design choice, cross-referenced to `SERVICECALL_DECISION_LOCK.md` — consistent, not contradicted.
- No Contract→ServiceCall reverse FK found in `Contract` model or service — consistent with the locked one-way-only relationship rule.

## 9. Inventory findings

- Confirmed 27 registered Inventory routes match the contract's 27 exactly, across categories/locations/items/issues/transfers/dashboard/my-material/5 CSV reports.
- Confirmed the FIX-3.6-01 report-role split (`STOCK_REPORT_ROLES` vs `ISSUED_REPORT_ROLES`) exists in source exactly as documented, including `mep_pm` correctly excluded from `STOCK_REPORT_ROLES`.
- Confirmed 5 `notificationRepo.create` sites in `inventoryService.js`, matching the locked model, with no Transfer/Mark-Used notification (consistent with "no Transfer/Mark-Used notifications" stated in §9).
- No ServiceCall/Finance/Checklist relation found anywhere in `inventoryService.js` or the Inventory models — consistent with the locked "no relation demonstrated" boundary; `InventoryIssue.projId` confirmed write-only (no read-back join to Project anywhere in `projectService.js` or `inventoryService.js`).

## 10. Notification findings

- Confirmed `notificationService.js` has zero `notificationRepo.create` calls — it is read/mark-read only, exactly as documented, with no create route anywhere on `notificationRoutes.js` (2 routes: `GET /` and `PATCH /:id/read`).
- Independently re-counted all `notificationRepo.create` call sites across every service file this session: **25 total**, distributed exactly as the engagement's locked model states (Enquiry=0, SalesOrder=2, Payment=3, Checklist=3 [inside `projectService.js`], Project=6 [also inside `projectService.js`, 6+3=9 total in that one file], Contract=1, ServiceCall=5, Inventory=5). This is an independent re-derivation, not a re-assertion of the locked number, and it reconciles exactly.

## 11. Error-contract findings

- `errors.js`'s `ServiceError`/`wrapDuplicateKeyError` (FIX-6-02) mechanism matches the contract's §0 error-shape description and code taxonomy table.
- Spot-verified error codes referenced in the contract (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `NO_COMPANY_CONTEXT`, `INSUFFICIENT_STOCK`, `INVALID_STATUS_TRANSITION`/`INVALID_STATE`, `NOT_ELIGIBLE`, `TIMELINE_NOT_READY`, `MISSING_SIGNATURE`, `LOCATION_HAS_STOCK`/`CATEGORY_IN_USE`, `ENQUIRY_NOT_OPEN`, `DUPLICATE_CONVERSION`, `ENGINEER_NOT_FOUND`) all appear in the corresponding service files' `ServiceError` throw sites — none of these were found asserted in the contract without a matching throw site in source.
- The contract correctly declines to promise exact HTTP status/body values it cannot support with code+tests (§10's explicit "does not reproduce field-by-field" caveat for several write endpoints) — this is the correct honesty posture for a documentation-only audit, not a gap.

## 12. Report/export documentation findings

All 15 CSV/export/report endpoints found in source are documented with method, path, role gate, and content type:
- Enquiry: `GET /export.csv` (EP-010), `GET /reports/summary` (EP-008), `GET /reports/followups-due` (EP-009)
- SalesOrder: `GET /export.csv` (EP-019)
- Payment: `GET /export/pending.csv` (EP-024), `GET /export/receipts.csv` (EP-025)
- Project: `GET /export.csv` (EP-035), `GET /:id/delivery-challans/export.csv` (EP-057), `GET /:id/report` and `/:id/report/export.csv` (EP-058/059)
- Contract: `GET /export.csv` (EP-062)
- ServiceCall: `GET /export.csv` (EP-070)
- Inventory: 5 CSV reports (EP-100–104)

No execution of any export was performed in this pass (out of scope — Workstream D). Documentation-only verification: every export route's role gate in the contract matches the corresponding constant/check in its service file (spot-verified for Inventory's split report roles and Payment's `LEDGER_ROLES`-gated exports above).

## 13. FIX-6-XX findings from this pass

**None.** No documentation gap, contradiction, or drift was found between `API_CONTRACT.md` and the current implementation during this audit. No FIX-6-05 (or higher) was opened because no qualifying finding — of any classification B through F — was produced by the verification performed (see §15 for exactly what was and was not independently re-verified).

## 14. Tests run

None run in this session. No code or documentation change was made (see §13), so per this task's explicit instruction ("Do NOT rerun the entire 365-test regression merely because documentation changed — only if code changed or a finding exposed implementation drift"), the regression suite was not re-executed. The 365/365 PASS baseline from this engagement's prior verification stands unchanged and is not re-claimed as freshly re-run here.

## 15. Remaining implementation findings / audit-depth disclosure

Honest disclosure of what this pass did and did not do, per the Budget Honesty requirement:

**Independently re-verified this session (not merely re-asserted from the existing contract):**
- Full registered-route inventory (123 = 123 = 123), fresh grep, all 12 route files + `app.js`.
- Every module's role-gate constants, byte-compared against contract prose.
- The Company-deletion 8-collection cascade, read directly from `companyService.js`.
- The full 25-site notification model, re-counted from every service file, matched to the locked per-module distribution.
- `errors.js`'s error-code taxonomy against contract's §0 table.
- `withTransaction` call-site counts per module (plausibility-checked against the endpoints each module claims run inside a transaction).
- Absence of a standalone Project-create route, absence of a Contract edit/delete route, absence of a ServiceCall edit/delete route, absence of an InventoryTransaction edit/delete route — each confirmed by grep against the relevant route file, matching the contract's explicit "no such route exists" claims.
- notificationService.js's read-only nature (zero create calls).

**Relied on already-established, previously-locked audits rather than re-deriving from the PWA source this session** (per this task's explicit instruction not to redo complete module audits already established): the field-by-field PWA functional-equivalence claims in `PWA_COVERAGE_AUDIT_{ENQUIRY,SALESORDER,PROJECT,SERVICECALL,INVENTORY}.md`, `{CONTRACT,PROJECT,SERVICECALL,INVENTORY}_DECISION_LOCK.md`, and `ENQUIRY_BUSINESS_DECISION_SHEET.md`. This audit checked that `API_CONTRACT.md`'s statements are **internally consistent** with those locked documents' conclusions (spot-checked across all 11 modules — no contradiction found) rather than re-opening the 111KB PWA source a second time to re-derive the same facts those documents already established at task-required rigor.
- Full field-by-field request/response body validation for every one of the 123 endpoints (e.g. confirming every single optional-field name in every PATCH body) was **not** independently re-typed against source line-by-line for all 123 rows in this pass — the module-level spot checks above (role gates, error codes, notification/transaction counts, cascade lists) are the verification actually performed. `API_CONTRACT.md` §10 itself already honestly flags several endpoints (`saveTimeline`, `applyChecklistTemplate`, `buildReport`, `createManualContract`) as not field-by-field reproduced in the document by its own author's admission — this audit did not close that self-flagged gap, and does not claim to have.

No implementation defect was found or is being recorded as a result of this pass.

## 16. Final Workstream B verdict

**WORKSTREAM B = PASS**, with the audit-depth disclosure in §15 stated as part of the verdict, not hidden from it: all 123 endpoints are accounted for in the contract with no undocumented and no phantom-documented endpoint; every module's role/auth/tenant documentation was independently re-verified against source and found accurate; the notification and transaction models were independently re-counted and reconciled exactly to the locked baselines; the Company-cascade behavior was independently re-read from source and matches; no documentation contradiction (classification D) or PWA contradiction (classification E) was found; no new implementation defect (classification F) was found or exposed. The one honestly-flagged limitation is that full endpoint-by-endpoint field-level re-derivation from the PWA source was not repeated in this pass — it relies on the engagement's own already-locked, already-established audits for that layer, per this task's explicit instruction to reuse rather than redo them.
