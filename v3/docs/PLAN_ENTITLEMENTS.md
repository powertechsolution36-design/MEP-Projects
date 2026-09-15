# V3 SAAS ENTITLEMENT SPECIFICATION
**STATUS: FINAL — ARCHITECTURE FROZEN**
**CODE STATUS: NOT YET IMPLEMENTED**

---

# PLAN & ENTITLEMENTS — v3 Master Specification (rev 3 FINAL)

**Authority:** This document is the SaaS commercial entitlement authority. See `DOCUMENT_AUTHORITY.md`.

**Source of truth for effective entitlement:**
- `Subscription` (current active row per company)
- `DivisionEntitlement` (per-division rows)
- `FeatureEntitlement` (per-feature rows)
- `AddOn` (catalog) + Subscription.addOns[] active entries

**Cache:** `Company.entitlements` is a **denormalized cache** — never trusted alone. Any authoritative check re-reads sources or reads from a freshly recomputed cache with a validity stamp.

---

## 1. Five collections (no overlap)

```
Plan            → catalog of sellable packages
Subscription    → Company × Plan × time window (planSnapshot frozen at signup)
DivisionEntitlement → per-division on/off with historicalData preservation
FeatureEntitlement  → per-feature toggle/limit override
AddOn           → catalog of optional paid extras (division / feature / capacity)
```

---

## 2. Source-of-truth vs Cache

```
SOURCE OF TRUTH (authoritative, immutable audit log):
  Subscription, DivisionEntitlement, FeatureEntitlement, AddOn catalog, Subscription.addOns[]

CACHE (denormalized, recomputed on any change):
  Company.entitlements = {
    divisions: [enum],
    modules: [String],
    features: { code: Bool|Number },
    limits: { users, projects, storageGB, apiCallsPerHour },
    computedAt: Date,          // Sanity check age
    computedFrom: {            // Trace links back to sources
      subscriptionId, divisionEntitlementIds[], featureEntitlementIds[], activeAddOnCodes[]
    }
  }
```

**Rule:** any middleware that reads `Company.entitlements` MUST check `computedAt` < 5 minutes old; else force recompute. Any write to Subscription/DivisionEntitlement/FeatureEntitlement/AddOn triggers recompute and cache-invalidation broadcast.

---

## 3. Standardized `source` enum

Used everywhere entitlement rows have provenance:

```
source: 'plan' | 'addon' | 'manual' | 'migration'
```

| Value | Meaning |
|-------|---------|
| `plan` | Row created because the base Plan includes this division/feature. Auto-created on Subscription create. Auto-removed on plan change. |
| `addon` | Row created because an active AddOn grants this division/feature. Tied to AddOn code on Subscription. |
| `manual` | Super Admin created/modified directly. Persists across plan changes. Higher precedence than `plan`. |
| `migration` | Row created by a migration script (Stage 1/2). Used to distinguish legacy backfill from real commercial data. |

**All other values are invalid.** Old docs may have said `plan-change`, `legacy`, `super`, `system` — all mapped to one of the four above.

---

## 4. Entitlement precedence (deterministic conflict resolution)

Applied per division (and per feature) in this order — **later rules override earlier**:

```
1. Plan defaults        (source=plan; from Subscription.planSnapshot)
2. Add-on grants         (source=addon; from active AddOn.divisionsGranted / featuresGranted)
3. Manual overrides      (source=manual; from super-admin explicit toggle)
4. Migration rows        (source=migration; kept for record, does not re-grant)
```

Effective value = last matching row's `enabled` (bool) or `limit` (number).

### Set/override semantics (not concatenation)

- Represent divisions as a set: start with `plan.availableDivisions ∩ Subscription.purchasedDivisions`
- Add: `addOns[*].divisionsGranted` (where AddOn is active AND compatible with plan)
- Then apply each `DivisionEntitlement` row keyed by division:
  - If `enabled=true`, add to set (or leave)
  - If `enabled=false`, remove from set
- The final set is the effective divisions

Same pattern for modules and features.

### Conflict examples

**Example A** — Plan enabled + Add-on enabled + Manual disabled → **disabled** (manual wins)

```
Plan SOLAR_STARTER  →  SOLAR (source=plan, enabled=true)
Add-on DIVISION_HVAC → HVAC (source=addon, enabled=true)
DivisionEntitlement { division: HVAC, enabled: false, source: manual } (super-admin disabled)
Result: divisions = { SOLAR }, HVAC hidden but data preserved
```

**Example B** — Plan enabled + Manual disabled + Manual re-enabled

```
Plan MEP_HVAC_PRO → MEP + HVAC (source=plan)
DivisionEntitlement { division: HVAC, enabled: false, source: manual, disabledAt: T1 } (super-admin disabled HVAC 6 months ago)
DivisionEntitlement { division: HVAC, enabled: true, source: manual, addedAt: T2 } (super-admin re-enabled last week)
Result: divisions = { MEP, HVAC }, HVAC data reactivated
```

Precedence uses **the most recent row per (co, division)** for the manual/addon/migration layers. Plan layer is stable per active subscription.

---

## 5. Add-ons — validation rule (division add-ons)

`DIVISION_SOLAR`, `DIVISION_MEP`, `DIVISION_HVAC` add-ons can activate a division that is **not** in the current plan, ONLY IF:

- `AddOn.compatiblePlans` is empty (universal) OR includes the company's current `Subscription.plan.code`
- The current plan does not explicitly forbid the division (rare — `plan.forbiddenDivisions[]`)
- No `DivisionEntitlement { division: X, enabled: false, source: manual }` more recent than the AddOn activation exists

Validated by `validateAddOnAttach(company, addOnCode)` server-side before the AddOn is added to Subscription.addOns[]. Returns 400 with reason if invalid.

---

## 6. Core / Division / Add-on feature classification

Every feature code lives in exactly one bucket:

```
CORE FEATURES (always on, all plans, cannot be disabled):
  auth.login, auth.mfa, profile.view, notifications.view, audit.view.own

DIVISION FEATURES (on only when division purchased):
  solar.projects, solar.boq, solar.commissioning, solar.warranty
  mep.projects, mep.electrical, mep.plumbing, mep.fire, mep.commissioning
  hvac.projects, hvac.vrf, hvac.piping, hvac.testing.pressure, hvac.testing.vacuum,
  hvac.testing.leak, hvac.commissioning

OPTIONAL PAID ADD-ONS (sold separately):
  client_portal, vendor_portal, ai_estimator, advanced_bi, mobile_app,
  custom_branding, api_access, multi_location, payroll_integration,
  extra_users_pack_10, storage_100gb
```

Architecture supports future combinations without code changes — new features declare their bucket via seed data.

---

## 7. Effective entitlement formula (formal)

```
function computeEntitlement(company):
  sub = activeSubscription(company)
  if not sub: return LEGACY_REVIEW_REQUIRED   (see LEGACY MIGRATION)

  # 1. Base from plan snapshot
  divisions = set(sub.planSnapshot.availableDivisions) ∩ set(sub.purchasedDivisions)
  modules   = set(sub.planSnapshot.includedModules)
  features  = dict(sub.planSnapshot.defaultFeatures)
  limits    = dict(sub.planSnapshot.limits)

  # 2. Layer active add-ons (validated compatible)
  for addon in activeAddOns(sub):
    divisions |= set(addon.divisionsGranted)
    for k, v in addon.featuresGranted.items():
      modules.add_if_module(k)
      features[k] = v
    limits = merge_add(limits, addon.limits)

  # 3. Layer manual DivisionEntitlement rows (most-recent per division wins)
  for de in mostRecentPerDivision(DivisionEntitlement.find({co}, source=manual)):
    if de.enabled: divisions.add(de.division)
    else: divisions.discard(de.division)

  # 4. Layer manual FeatureEntitlement rows
  for fe in mostRecentPerFeature(FeatureEntitlement.find({co}, source=manual)):
    features[fe.code] = fe.enabled if fe.limit is None else fe.limit

  # 5. Migration rows: informational only, do not re-grant

  return {
    divisions: list(divisions),
    modules: list(modules),
    features: features,
    limits: limits,
    computedAt: now(),
    computedFrom: {...ids...}
  }
```

---

## 8. Non-destructive plan changes

**Upgrade** (add divisions or features):
- Update Subscription.purchasedDivisions and/or add AddOns entries
- Recompute Company.entitlements
- Old data untouched
- AuditLog entry with delta

**Downgrade** (remove divisions):
- Do NOT delete data
- Set DivisionEntitlement{ division, enabled: false, source: manual, historicalData: true }
- Users of that division lose access via entitlement check
- Super Admin retains read access
- Re-enable = instant restoration

**Plan switch** (different plan code):
- New Subscription created with status='active', planSnapshot frozen at switch time
- Old Subscription set to status='replaced', endDate=switch time (preserved for history)
- Add-ons carry over unless explicitly dropped
- AuditLog entry

**Never mutates historical Subscription rows.** planSnapshot immutability protects commercial contract integrity.

---

## 9. LEGACY_UNLIMITED plan (system-only)

```
Plan {
  code: 'LEGACY_UNLIMITED',
  visibility: 'internal',      // hidden from Super Admin plan picker
  sellable: false,             // cannot be selected for new companies
  editable: false,             // system/migration only
  ...
}
```

- Used exclusively by migration script for pre-existing companies at Stage 2
- Never selectable in normal Super Admin plan UI
- Super Admin ops tool can view it (audit) but not modify

---

## 10. Subscription history

- One Subscription active per company at a time (unique index: `{ co: 1, status: 1 }` partial where status='active')
- Historical Subscriptions preserved with status IN ('replaced','expired','cancelled') — NEVER deleted
- planSnapshot on each row is immutable — protects commercial contract audit
- Migrations never overwrite existing historical Subscriptions

---

## 11. Legacy company migration (safe rule)

If Company has no active Subscription at migration time:

```
if company.divs is missing or empty or invalid:
  mark company with settings.migrationReviewRequired = true
  create AuditLog { source: 'migration', action: 'review-required', reason: 'divs missing/invalid' }
  do NOT auto-grant any divisions
  produce migration-report row
  Super Admin must explicitly map before migration proceeds

else:
  # divs is present and valid
  create Subscription { plan: LEGACY_UNLIMITED, planSnapshot, source: 'migration',
                         purchasedDivisions: company.divs }
  for each div in company.divs:
    create DivisionEntitlement { division: div, enabled: true, source: 'migration' }
  set enforceEntitlements = false (log-only mode)
```

**No `|| [SOLAR,MEP,HVAC]` silent fallback.** Missing data → review-required, not auto-grant.

---

## 12. Enforcement modes (per company)

`Company.settings.enforceEntitlements`:
- `false` — log-only, no blocking (default for legacy pre-review)
- `'warn'` — banner shown in UI, backend allows with warning header
- `true` — full 403 on violation (default for new companies)

Rollout per company via Super Admin toggle. Instant rollback = flip flag.

---

## 13. Super Admin management

Super Admin can:
- CRUD Plans (versioned, excluding LEGACY_UNLIMITED which is read-only)
- CRUD AddOns
- Create/modify/expire Subscriptions per company
- Enable/disable DivisionEntitlement per company
- Toggle FeatureEntitlement per company
- View computed Company.entitlements + provenance (which source granted what)
- Set enforceEntitlements per company

## 14. Company Admin visibility

Company Admin can:
- **View** current plan + purchasedDivisions + active add-ons + expiry
- **View** feature entitlements + limits
- **Request** upgrade/downgrade/add-on via ApprovalRequest → sent to Super Admin
- **Cannot** self-serve plan changes

---

## Rev 4 addendum — Approval ownership

- Super Admin owns platform-level ApprovalRule templates (systemManaged=true) — company cannot disable.
- Company Admin may configure company-specific thresholds and approvers by creating additional ApprovalRule rows.
- Company Admin can override thresholds ONLY on non-systemManaged rules.
- All rule changes audited.

---

## Rev 5 addendum — CORE / DIVISION / ADD-ON classification (FINAL)

Every module belongs to exactly one commercial layer. Nothing is "always free" unless explicitly CORE.

### CORE (always on with any active subscription — cannot be disabled)
- Authentication, Profile, Notifications, own AuditLog view
- Basic CRM (Customers, Contacts, Enquiries — read/write within plan limits)
- Basic Projects (Project shell only — no package/sub-trade features)
- Basic Reports (canned reports only, no export beyond CSV, no scheduling)
- Company Administration (self view; edit via Company Admin only)
- Basic Inventory master (items list, categories, locations — read/write within plan limits)
- Basic Service (single Service Call per asset — no AMC scheduling)
- Basic Finance (Payments record entry — no Invoice generation)

### DIVISION (available only when division purchased)
- **SOLAR:** Solar Projects, Solar BOQ, Solar Site Surveys, Solar Installation, DC/AC Testing, Solar Commissioning, Solar Handover, Solar Warranty
- **MEP:** MEP Projects, MEP BOQ, MEP Drawings, MEP sub-trade workflows (Electrical/Plumbing/Fire/Other), MEP Testing, MEP Commissioning, MEP Handover
- **HVAC:** HVAC Projects, HVAC BOQ, HVAC Drawings, HVAC sub-trade workflows (VRF/Ducted/Split/Piping/Testing/Commissioning), HVAC Commissioning, HVAC Handover

### OPTIONAL PAID ADD-ONS (sold separately, layered on top)
- Advanced Procurement (RFQ, PurchaseOrder, GRN, Vendor comparison)
- Advanced BI (custom dashboards, extended analytics)
- Client Portal, Vendor Portal
- AI Estimator, API Access, Mobile App, Custom Branding
- Multi-location Inventory, Payroll Integration
- Extra Users Pack, Extra Storage
- Advanced Approval (multi-step chains, custom escalation paths)
- Structured Invoicing (Invoice model with credit notes, dispatch)

**No hard-coded plan combinations.** Super Admin creates plans dynamically (name, price, cycle, availableDivisions, includedModules, defaultFeatures, availableAddOns, limits, trial, status). Application behavior depends on entitlement data, not plan code.
