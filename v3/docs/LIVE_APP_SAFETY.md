# LIVE APP SAFETY — v3

> **📝 rev 9 addition — 2026-09-10.** Additive only. Added `FinanceWorkItem` to the whitelist of collections v3 may create. See `CHANGELOG.md` rev 9.
>
> **📝 rev 10 addition — 2026-09-11.** Additive only. Added `ChecklistInstanceItem` to the whitelist (first-class, per `DATABASE_ARCHITECTURE.md` rev 10). See `CHANGELOG.md` rev 10.
>
> **📝 rev 11 addition — 2026-09-11.** Additive only. Added `MaterialReturnRequest`, `ToolCustody`, `StockTransfer` to the whitelist (all first-class, per `DATABASE_ARCHITECTURE.md` rev 11). Legacy `InvItem`/`InvTransaction` gain optional fields only (`itemType`, extended `type` enum) — no legacy field renamed/removed. See `CHANGELOG.md` rev 11.
>
> **📝 rev 12 addition — 2026-09-11.** Additive only. Added `RecordCorrection` to the whitelist (first-class, per `DATABASE_ARCHITECTURE.md` rev 12). All v3 collections gain the additive ownership metadata block (`createdByUserId`, `updatedByUserId`, etc.) — optional/defaulted, no legacy field renamed/removed. See `CHANGELOG.md` rev 12.

**Purpose:** Absolute rules that protect the running v2 production application during v3 evolution.

## Untouchable in v2
- Any file inside `v2/server/src/*`
- Any file inside `v2/web/src/*`
- `v2/deploy/*` nginx and PM2 configs
- Root-level `MEP_PROJECTS_PWA/`, root `sw.js`, root `App.js`, root `index.js` (Expo)
- MongoDB documents (existing collections; existing docs)
- JWT secret, env vars, PM2 process for `mep-projects-api`
- Existing user records (never renamed/deleted — deactivate only)
- Existing role enum values (never renamed)
- `Company.divs[]` field (kept in sync with new entitlements; never removed)

## v3 additive rules
- All new v3 collections may be created (Plan, Subscription, DivisionEntitlement, FeatureEntitlement, AddOn, Permission, RolePermission, UserPermissionOverride, ApprovalRule, ApprovalRequest, ApprovalStep, AuditLog, Customer, Contact, Site, Quotation, CustomerPO, BOQ, ProjectPackage, Task, DailyReport, ChecklistInstance, MaterialRequest, Vendor, RFQ, PurchaseOrder, GRN, StockLedger, Invoice, Budget, ChangeOrder, RFI, Submittal, Drawing, QaInspection, NCR, Handover, Warranty, Renewal, Asset, FinanceWorkItem [rev 9], ChecklistInstanceItem [rev 10], MaterialReturnRequest [rev 11], ToolCustody [rev 11], StockTransfer [rev 11], RecordCorrection [rev 12])
- New fields may be added to existing collections **only via v3-side schema** (never modify v2 files); MUST be optional with default values so v2 code paths ignore them
- v3 runs as separate PM2 process on port 4002 with its own Mongoose connection (isolated Model registry to avoid OverwriteModelError)
- v3 shares the same MongoDB and same JWT secret with v2

## Deployment separation
- Production port 4001 unchanged
- v3 gets port 4002 + subdomain `api-v3.mep-projects.spereon.codes`
- v3 web gets separate SPA build at `v3.mep-projects.spereon.codes`
- Nginx configs added, not modified

## Feature flags (per company, set by super admin)
- `Company.settings.enforceEntitlements`: false | 'warn' | true — default `false` for legacy, `true` for new
- `Company.settings.uiVersion`: 'v2' | 'v3' — default `v2`
- `Company.settings.showV3Preview`: bool — opt-in banner

## Rollback commands (memorize)
- Turn off enforcement per co: set `Company.settings.enforceEntitlements = false`
- Revert UI per co: set `Company.settings.uiVersion = 'v2'`
- Stop v3 entirely: `pm2 stop mep-projects-v3-api`
- Nuclear: `mongorestore` from Stage 0 snapshot

## Data safety
- Financial records (Invoice, Payment, GRN) are **immutable**: no delete, no edit after issuance; reversal via credit-note / reverse-entry
- Destructive delete requires: fresh reauth + reason ≥ 20 chars + cascade-block + 2-of-2 approver
- Soft-delete only, restore window: 30/90/180 days by resource class
- Hard delete only via Super Admin ops tool after retention + explicit written request
- (rev 12) Edit/Delete on any v3 record requires `requireOwnership()` to pass first (creator or explicit override) — platform-wide, every module; a Manager/Admin correction to another user's record is never a silent write, always a `RecordCorrection` row

## Audit rules
- Every mutation writes to `AuditLog` (immutable)
- Never store passwords, JWT tokens, or secrets in AuditLog payloads
- PII redacted per role
- Log retention: 7 years for financial actions, 2 years for operational

## Backup rules
- Daily automated `mongodump` before any migration
- Off-site copy (secondary bucket / drive)
- Verified restore on staging before Stage 2 migration begins
- Migration scripts idempotent + resumable
- Every migration produces a report; Super Admin reviews before flipping enforcement

## Test discipline
- No v3 code deploys without: staging integration test + regression pass against v2 fixtures
- Load test before enforcement flip
- Per-company opt-in migration (never a big-bang across all tenants)
