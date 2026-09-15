# API ARCHITECTURE — v3

> **📝 rev 9 addition — 2026-09-10.** Additive only. Added Raise-to-Finance and FinanceWorkItem routes (§2). See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Added ChecklistInstance/Item routes and `/me/work` (§2); added `responsibilityType`-based scoping to `scopeFilterV3` (§7). See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Added Material Return/Excess Form, Stock Transfer, and Tool Custody routes (§2); added `itemType`-aware scoping to `scopeFilterV3` (§7). PM-facing endpoints only ever create/submit requests; only Inventory-Manager-permissioned endpoints post stock transactions. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added `requireOwnership()` to the middleware chain (§1) as a platform-wide, module-agnostic primitive; added `RecordCorrection` routes (§2); formalized that ownership and permission are independently evaluated, both required. Applies to every v3 Edit/Delete/Correction endpoint across all modules. See `CHANGELOG.md` rev 12.

**Authority:** API design + security authority (see DOCUMENT_AUTHORITY.md).

**Base path:** v3 endpoints live under `/api/v3/*`. Legacy v2 `/api/*` endpoints remain unchanged.

---

## 1. Middleware chain (every v3 request)

```
1. cors + helmet + compression + body-parser
2. auth()                       — verify JWT (shared secret with v2)
3. loadEntitlements()           — attach req.entitlements from cache (recompute if stale)
4. requireEntitlement({module,division}) — enforce company purchased this
5. requireRole() / requirePermission()   — legacy + fine-grained
6. requireOwnership()           — (rev 12) for Edit/Delete/Correction routes only — validates createdByUserId === user.id OR explicit override authority; independent of and in addition to requirePermission(); see §7
7. approvalThresholdGuard()     — creates ApprovalRequest and returns 202 if threshold hit
8. destructiveActionGuard()     — MFA + reason + cascade + 2-of-2 for DELETE/reverse
9. ensureCompany()              — enforce req.body.co matches user (non-super)
10. route handler
11. audit()                      — writes AuditLog entry
12. broadcastUpdate()            — WebSocket to minimum audience (see WebSocket section)
```
`requireOwnership()` is skipped on CREATE and on read-only routes; it runs on every Edit/Delete/Correction route platform-wide (Sales, Finance, Admin, Inventory, Solar/MEP/HVAC PM, Service, Engineer/Technician, and any future module) — never implemented per-module.

## 2. Route namespace map

Legacy (unchanged): `/api/auth`, `/api/users`, `/api/companies`, `/api/enquiries`, `/api/sales-orders`, `/api/projects`, `/api/service-calls`, `/api/contracts`, `/api/payments`, `/api/inventory`, `/api/checklists`, `/api/notifications`, `/api/reports`, `/api/bulk`

V3 additive:
- `/api/v3/plans`, `/api/v3/plans/:id`
- `/api/v3/subscriptions`, `/api/v3/subscriptions/:id`, `/api/v3/subscriptions/:id/change-plan`, `/:id/add-addon`, `/:id/remove-addon`
- `/api/v3/entitlements/:companyId` (read-only view)
- `/api/v3/permissions`
- `/api/v3/roles/:role/permissions`
- `/api/v3/users/:id/permissions`
- `/api/v3/audit?resource=&user=&from=&to=`
- `/api/v3/approvals`, `/api/v3/approvals/:id/approve`, `/:id/reject`, `/pending?forUser`
- `/api/v3/approval-rules` (per-company matrix editor)
- `/api/v3/customers`, `/quotations`, `/vendors`, `/purchase-orders`, `/rfqs`, `/grns`, `/rfis`, `/submittals`, `/drawings`, `/assets`, `/warranties`, `/renewals`, `/tasks`, `/daily-reports`, `/material-requests`, `/change-orders`, `/invoices`, `/budgets`, `/handovers`, `/qa-inspections`, `/ncrs`, `/customer-pos`, `/boqs`
- `/api/v3/projects/:pId/packages`, `/api/v3/projects/:pId/packages/:pkgId`
- `/api/v3/sales-orders/:id/milestones`, `/api/v3/sales-orders/:id/milestones/:mIdx/raise-to-finance` (rev 9 — PM/manager only, creates FinanceWorkItem)
- `/api/v3/finance-work-items`, `/api/v3/finance-work-items/:id/claim`, `/api/v3/finance-work-items/:id/resolve` (rev 9 — Accounts/Finance only)
- `/api/v3/checklist-instances`, `/:id`, `/:id/apply` (rev 10 — apply a template to a ProjectPackage or ServiceCall)
- `/api/v3/checklist-instances/:id/items`, `/:itemId` — `/:itemId/assign`, `/:itemId/start`, `/:itemId/submit`, `/:itemId/approve`, `/:itemId/reject`, `/:itemId/waive`, `/:itemId/client-sign` (rev 10 — permission-gated per `responsibilityType`, see `ACCESS_MATRIX.md` §13.2)
- `/api/v3/me/work?status=today|upcoming|overdue|completed` (rev 10 — universal "My Work" queue, scoped by `scopeFilterV3`)
- `/api/v3/me/entitlements`, `/me/sidebar`, `/me/dashboard`, `/me/permissions`
- `/api/v3/material-returns`, `/:id`, `/:id/submit` (rev 11 — PM-facing, declares only), `/:id/verify` (rev 11 — Inventory Manager only, posts `InvTransaction`), `/:id/reject`
- `/api/v3/stock-transfers`, `/:id`, `/:id/approve`, `/:id/verify-receipt` (rev 11 — Inventory Manager only), `/:id/cancel`
- `/api/v3/tools`, `/:toolId/custody`, `/:toolId/custody/issue`, `/:toolId/custody/return` (rev 11 — Inventory Manager only), `/:toolId/custody/report-condition` (rev 11 — custodian, report only)
- `/api/v3/record-corrections`, `/:id` (rev 12 — read; creation happens as a side-effect of an authorized override write, never posted directly by an arbitrary client)
- `/api/v3/bulk` (entitlement-enforced replacement for legacy)

## 3. Bulk endpoint rules (both legacy and v3)

Rule: **NO bulk endpoint may bypass entitlement.** Applies to `/api/bulk` and `/api/v3/bulk`.

- `/api/bulk` — legacy: current behavior extended with entitlement filter (when `enforceEntitlements=true` per company); returns only enabled modules/divisions
- `/api/v3/bulk` — new: enforces from day 1; returns only what user's permissions + entitlements allow; supports `?slice=` param for lazy per-module loading

Backward compatibility for legacy `/api/bulk`:
- If `enforceEntitlements=false` → returns everything (log-only)
- If `enforceEntitlements='warn'` → returns everything + response header `X-Entitlement-Warning: <list>`
- If `enforceEntitlements=true` → filters response strictly

## 4. Destructive action guard

Applied to DELETE endpoints and any request with `_destructive: true`:
- `requireOwnership()` (rev 12) runs first — non-owner without explicit override is 403 before any of the below is evaluated
- Reject if last auth > 5 min ago (require reauth)
- Reject if no `deletionReason` (min 20 chars)
- Reject if child records exist (cascade-block; delete children first)
- If flagged `requireSecondApprover`, validate 2-of-2 approver token
- Persist before-snapshot to AuditLog
- Mark record `deleted=true, deletedAt, deletedBy` (soft delete)
- Financial resources (Invoice, Payment, GRN): NO delete route exists; only reversal endpoints

## 5. Approval architecture

First-class collections (not just matrix in settings):
```
ApprovalRule { co, resource, action, condition{field,op,value}, approvers[{role,quorum}], escalation{after,to}, active }
ApprovalRequest { co, requesterId, resource, resourceId, action, payload,
                  ruleIds[], status(pending|approved|rejected|executed),
                  createdAt, decidedAt,
                  approvalRequestId, actionId, idempotencyKey,
                  executionStatus(queued|running|succeeded|failed|null), executedAt }
ApprovalStep    { requestId, approverId, decision(approve|reject), note, at }
```

Idempotency:
- `approvalRequestId` + `actionId` + `idempotencyKey` guarantee the queued action runs at most once
- On execute: check executionStatus; if already `succeeded`, return prior result
- Retry-safe on approver double-click

Escalation:
- Scheduled job scans pending ApprovalRequests past their `escalation.after` window
- Adds escalation.to approvers to the requiredApprovers list, notifies them
- Original approvers still valid

## 6. WebSocket security

Rooms:
- `co:{coId}` — company baseline
- `co:{coId}:div:{division}` — per division user has access to
- `co:{coId}:user:{userId}` — private
- `co:{coId}:role:{role}` — role-based (approval queues)

Server decides minimum audience per broadcast — never leaks. Payload sensitivity check redacts financial/PII fields per role.

No writes via socket. Only `typing`, `presence`, `heartbeat` client-to-server commands allowed. Everything else goes through REST + full middleware chain.

## 7. Authorization primitives

```
requireEntitlement({module, division}):
  if super → allow
  if enforceEntitlements=false → log-only, allow
  if module and not in entitlements.modules → 403
  if division and not in entitlements.divisions → 403
  else → allow

requirePermission(code):
  if super → allow
  effective = UserPermissionOverride ∪ RolePermission[user.role]
  if effective.includes(code) or effective.includes('*') → allow
  else → 403

scopeFilterV3(user, resource, extra):
  filter = extra
  if user.role !== super → filter.co = user.co
  if user.designation ∈ divisional_manager → filter.division = user.division
  if user.designation ∈ engineer/technician:
      if user has projectAccess[]: filter._project_in = user.projectAccess
      else: filter.assignedTo = user._id (or team.userId in)
      also filter.division = user.division (if set)
  # Service and Inventory managers: allow all purchased divisions (COMMON + entitlements.divisions)
  if user.designation ∈ [service_manager, inventory_manager]:
      filter._division_in = entitlements.divisions ∪ ['COMMON']
  # rev 10: ChecklistInstanceItem additionally filters by responsibility — never by designation alone
  if resource == 'ChecklistInstanceItem' and user.designation not in [company_admin, project_manager, solar_manager, mep_manager, hvac_manager, service_manager]:
      filter.assignedUserId = user._id   # a user sees only items assigned to them, regardless of responsibilityType
  # rev 11: MaterialReturnRequest / StockTransfer / ToolCustody — write-scope narrower than read-scope
  if resource in ['MaterialReturnRequest', 'StockTransfer'] and user.designation == project_manager:
      filter.projectId_in = user.projectAccess   # PM sees/creates only for own projects; verify/approve fields stay read-only to PM regardless of filter match
  if resource == 'ToolCustody' and user.designation ∈ engineer/technician:
      filter.custodianUserId = user._id   # sees only tools currently or previously in their own custody
  return filter
```

**Write-side enforcement (rev 11, additive to `requirePermission`):** a `MaterialReturnRequest`/`StockTransfer` document matching a PM's `scopeFilterV3` read-scope is still not writable on its `verified*`/`accepted*`/`status→APPROVED|RETURNED` fields by that PM — those fields are gated by a separate `requirePermission('inventory.verify')` check held only by Inventory Manager (and explicitly permissioned store keeper), independent of the read-scope filter above. Read-scope and write-scope are never conflated.

### `requireOwnership()` (rev 12, FINAL — platform-wide, every module)

```
requireOwnership(record, user, action):
  if user.role === super and action !== 'delete-hard' → allow (support-access rules in DOCUMENT_AUTHORITY.md still apply)
  if record.co !== user.co → 403                                         # company isolation, unchanged
  isOwner = (record.createdByUserId === user.id)
  hasOverride = requirePermission(`${resource}.override`)                # explicit override permission — never implied by role/title alone
  if not isOwner and not hasOverride → 403
  if isOwner and not stateAllows(record.status, action) → 403            # e.g. APPROVED/POSTED/FINALIZED blocks normal edit/delete
  if hasOverride and not isOwner:
      require RecordCorrection payload {reason, oldValue, newValue}      # override MUST go through RecordCorrection, never a silent write
      write RecordCorrection; audit() records action=OVERRIDE/CORRECT
  else:
      proceed with normal edit/delete
  return allow
```
Runs **after** `requirePermission()`, never instead of it — a user with the module permission but no ownership/override is still denied; a user with ownership but no underlying business-action permission (e.g. a PM who owns a `MaterialRequest` but lacks `inventory.verify`) is still denied on that specific action. `createdByName` is never read by this check — `createdByUserId` is the only authoritative field. Applies identically to Sales, Finance, Admin, Inventory, Solar/MEP/HVAC PM, Service, Engineer/Technician, and every future module — implemented once as a shared primitive, never duplicated per-module.

## 8. Service / Inventory entitlement (division-scoped, cross-division-capable)

- **Service Manager**: `division scope = entitlements.divisions ∪ ['COMMON']`. Never accesses data tagged with an unpurchased division.
- **Inventory Manager**: same. Items visible = COMMON + purchased divisions only. (rev 11) Sole holder of `requirePermission('inventory.verify')` — the only role whose write to `MaterialReturnRequest.verified*/accepted*`, `StockTransfer.approvedBy/verifiedBy`, or `ToolCustody.status` (other than employee self-report of condition) is accepted; a `StockTransfer` request whose source/destination divisions differ is rejected before reaching this check.

## 9. Audit rules

Every mutation writes AuditLog with:
```
{ co, user, userName, action, resource, resourceId, method, path,
  status, ip, userAgent, before (snapshot), after, reason, timestamp }
```
`action` (rev 12 — full platform-wide set): `CREATE | UPDATE | DELETE | SUBMIT | APPROVE | REJECT | ASSIGN | CLOSE | REOPEN | OVERRIDE | CORRECT | REVERSE`. An `OVERRIDE`/`CORRECT` entry always cross-references the corresponding `RecordCorrection._id`. Audit history remains available after soft-deletion — never purged alongside a deleted record.

Never store: passwords, tokens, JWT, secrets, credit cards.

Retention: 7 years for financial actions, 2 years for operational.

## 10. Legacy endpoints — behavior

- `/api/auth/*` — untouched (shared)
- All other legacy endpoints — untouched behavior for v2 UI, enhanced with entitlement middleware for v3 UI (via feature flag)
- Legacy `/api/bulk` gets entitlement filter (see §3)

## 11. Rate limits

- Login: 10/minute per IP (already in v2 via loginLimiter)
- Reports export: 30/hour per user
- API: per-plan rate limit from Plan.limits.apiCallsPerHour

## 12. Error contract

```
Success: { data | list | ...specific shape }
Error:   { error: string, code?: string, retriable?: bool, details?: {} }
202 Approval Pending: { status: 'pending_approval', approvalRequestId }
```
