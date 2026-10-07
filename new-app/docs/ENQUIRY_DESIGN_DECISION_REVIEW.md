# Enquiry Design Decision Review

**Status: READ-ONLY ANALYSIS. No decision is made in this document. No source code, schema, or `OPEN_DECISIONS.md` was changed to produce it.**

This document analyzes the four unresolved Enquiry/SalesOrder design decisions recorded in `OPEN_DECISIONS.md` items #17–#20. It exists to support a future business decision — it does not make one. Source of truth for facts below: `PWA_COVERAGE_AUDIT_ENQUIRY.md`, `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `OPEN_DECISIONS.md`, and direct inspection of `new-app/backend/src/models/Enquiry.js` and `new-app/backend/src/models/SalesOrder.js`.

---

## Decision #17 — Enquiry Edit History

### 1. PWA FACT
A direct field edit to an Enquiry (via the Edit modal — `name`, `siteType`, `capacity`, `segment`, `phone`, `referenceSource`, `rating`, `estimatedValue`, `remark`) creates **no record at all**. The PWA's only history mechanism for Enquiry is `followUpLog`, an append-only array, and it is written to in exactly three circumstances: adding a follow-up note, marking Lost, and reopening. A direct edit silently overwrites the prior field value with no trace of the change, the previous value, the actor, or the timestamp.

### 2. CURRENT NEW APP STATE
- `Enquiry.js` has a `followUpLog` array (`{ date, text }`, append-only) and no other history structure. No edit-tracking fields exist.
- `DOMAIN_MODEL.md` (Enquiry "Business rules demonstrated" bullet) and `DATABASE_SCHEMA.md` §3 both now explicitly document: "a direct field edit... creates no `followUpLog` entry and no other history record," and flag this as unresolved, pointing to `OPEN_DECISIONS.md` #17.
- No edit-history collection, versioning field, or middleware exists anywhere in the new backend.

### 3. Options

**Option A — Preserve PWA behavior (no audit trail for direct edits)**
- **Data model:** No change. `Enquiry.js` stays as-is.
- **Service logic:** An update service simply applies the new field values and saves; no side-write.
- **API behavior:** `PATCH`/`PUT` Enquiry returns the updated document; no history payload.
- **Validation:** None added.
- **Relationships:** None affected.
- **Audit/history:** None exists for direct edits — matches the PWA exactly. `followUpLog` remains the only history channel, unchanged.
- **Downstream modules:** None depend on edit history existing; nothing to wire up.
- **Migration implications:** None — no schema addition, so no backfill needed.

**Option B — Introduce edit history / audit tracking**
- **Data model:** Requires a new structure — either (i) an embedded `editHistory` array on `Enquiry` (`{ field, oldValue, newValue, changedBy, changedAt }` per changed field, or one entry per save with a diff), or (ii) a separate `enquiryEditHistory` collection referencing `enquiryId`, or (iii) a generic cross-entity audit-log collection (which would also need its own design — see dependency on Open Decision #3, "Audit retention policy," and could subsume or duplicate that broader item).
- **Service logic:** The update service must diff old vs. new document state before saving, construct history entries, and write them (ideally in the same transaction/write as the update itself, to avoid drift). Adds a mandatory "load-before-update" pattern if the diff needs prior values (bulk/patch-based updates that don't first fetch the document would need to fetch it, adding a read).
- **API behavior:** May need a new endpoint (`GET /enquiries/:id/history`) to expose the trail; existing update endpoints are otherwise unchanged from the caller's perspective.
- **Validation:** Needs a decision on what's captured — every field, or only a defined subset — and whether `changedBy` (actor) is mandatory, which in turn depends on Open Decision #1 (auth/session) being resolved enough to know who "the current user" is reliably.
- **Relationships:** New history records reference `enquiryId` (and possibly `userId`); adds a new relationship to maintain and (if a separate collection) index.
- **Audit/history:** Enquiry becomes more auditable than the PWA ever was — a deliberate, intentional divergence, not a bug fix.
- **Downstream modules:** Reporting could later surface "who changed what, when" for Enquiry; no other module (SalesOrder, Project, Payment) needs this data to function, so it is additive rather than a hard dependency for anyone else.
- **Migration implications:** Existing Enquiry documents (once real data exists) have no history to backfill — the trail necessarily starts from zero at the point Option B ships; pre-existing edits are unrecoverable and this should be stated to users of the new system, not silently implied to be complete.

### 4. PWA Fidelity Impact
- **Option A** preserves PWA behavior exactly — zero divergence.
- **Option B** is an intentional divergence, explicitly adding a capability with no PWA precedent. This is not "fixing a bug" (the PWA's lack of history is not a defect verified against a spec — it is simply how the PWA works); it is a genuine product decision to exceed the old app's capability.

### 5. Dependencies
- **Audit/history (Open Decision #3, general audit retention policy):** if the business separately decides to build a system-wide audit log, Option B for Enquiry specifically may become redundant, or should be implemented as an instance of that broader mechanism rather than a bespoke one. Deciding #17 before #3 risks building two different audit patterns.
- **Auth (Open Decision #1):** attributing an edit to a user requires a settled session/identity model.
- **Reporting:** only relevant if a future report/screen is meant to show edit history; no current reporting requirement demands it.
- **SalesOrder, Project, Payment, Notification:** no dependency — these modules do not read or require Enquiry edit history to function.

### 6. Recommended Selection Criteria (no winner chosen)
- Does the business have a compliance, dispute-resolution, or customer-trust reason to know who changed a lead's details and when? (E.g., disputes over quoted `estimatedValue`.)
- Is a system-wide audit mechanism (Open Decision #3) already planned? If yes, resolve that first and treat #17 as a special case of it rather than a standalone feature.
- What is the cost tolerance for extra writes/reads on every Enquiry update, given expected Enquiry volume?
- Is there a UI requirement (a "history" tab) driving this, or is it speculative completeness?

### 7. Implementation Impact (if/when decided)
- `Enquiry.js` (only if Option B and an embedded array is chosen) or a new model file (if a separate collection/general audit log is chosen).
- Enquiry update service/controller (whichever new-app layer eventually implements it — none exists yet).
- Possibly a new route (`GET /enquiries/:id/history`).
- `DATABASE_SCHEMA.md` and `DOMAIN_MODEL.md` updated to describe the finalized structure once chosen.

---

## Decision #18 — Lost Fields on Reopen

### 1. PWA FACT
`reopenEnq` sets Enquiry `status` from `Lost` back to `Open` and appends one `followUpLog` entry recording the reopen. It does **not** clear `lostReason` or `lostDate`. Both fields remain stored on the document — merely hidden from the detail view while `status !== 'Lost'` — until either overwritten by a subsequent Lost transition, or left indefinitely if the Enquiry is never marked Lost again.

### 2. CURRENT NEW APP STATE
- `Enquiry.js` has `lostReason: { type: String }` (optional) and `lostDate: { type: Date }`, with no reopen-specific logic (no service layer exists yet at all for Enquiry — this is schema-only).
- `DOMAIN_MODEL.md` and `DATABASE_SCHEMA.md` both now document the stale-retention behavior explicitly and flag it as unresolved, pointing to `OPEN_DECISIONS.md` #18.

### 3. Options

**Option A — Preserve PWA behavior (`lostReason`/`lostDate` remain populated after reopen)**
- **Data model:** No change to `Enquiry.js`.
- **Service logic:** The reopen action sets `status = 'Open'` and appends a `followUpLog` entry; it explicitly does **not** touch `lostReason`/`lostDate`.
- **API behavior:** `GET` on a reopened-then-fetched Enquiry will still return non-null `lostReason`/`lostDate` even though `status` is `Open` — callers (including any new frontend) must not assume these fields are only ever populated when `status==='Lost'`.
- **Validation:** None added; no constraint tying these fields' presence to `status`.
- **Relationships:** None.
- **Audit/history:** The stale values are themselves a (crude, PWA-native) trace that the Enquiry was Lost before — arguably an incidental "history" side effect worth naming explicitly if kept.
- **Downstream modules:** Any report or list view that filters/displays "Lost reason" must be written defensively (check `status==='Lost'` before showing `lostReason`, exactly as the PWA's own detail view does) — this is a UI/reporting contract that must be documented so it isn't "fixed" by an unaware future developer.
- **Migration implications:** None.

**Option B — Clear `lostReason`/`lostDate` on reopen**
- **Data model:** No schema change required (fields stay optional/nullable) — only service logic changes.
- **Service logic:** The reopen action additionally sets `lostReason = null` (or unset) and `lostDate = null` as part of the same update.
- **API behavior:** A reopened Enquiry cleanly returns `null` for both fields; simpler contract for any consumer, since `status==='Open'` now reliably implies both are unset.
- **Validation:** None added, but this creates an implicit invariant ("Open ⇒ lostReason/lostDate are null") that could be worth enforcing with a pre-save hook if the business wants it guaranteed rather than merely conventional.
- **Relationships:** None.
- **Audit/history:** The prior Lost reason is destroyed with no trace — if the business ever wants to know "this lead was Lost twice, for reasons X then Y," Option B loses the first reason at the moment of reopen unless Decision #17 (edit history) is separately adopted to capture it before clearing.
- **Downstream modules:** Simplifies any report/list logic that reads `lostReason` (no defensive `status` check needed) but removes information that Option A retains.
- **Migration implications:** None for new documents. If applied retroactively to existing "reopened" Enquiries with stale data already in the database, a one-time backfill script would be needed to null out `lostReason`/`lostDate` wherever `status !== 'Lost'` — a decision in itself, since that changes historical data.

### 4. PWA Fidelity Impact
- **Option A** is exact PWA fidelity.
- **Option B** is an intentional, small behavioral divergence — cleaner data hygiene at the cost of losing the PWA's (accidental) retention of prior Lost context.

### 5. Dependencies
- **Decision #17 (Edit History):** if adopted, it could independently preserve the "why was this Lost before" information even if Option B is chosen here, decoupling data cleanliness from information loss.
- **Reporting:** any dashboard/report that surfaces `lostReason` needs to know which option was chosen to decide whether it must guard on `status`.
- **SalesOrder, Project, Payment, Notification:** no dependency.

### 6. Recommended Selection Criteria (no winner chosen)
- Does any planned report or list view need to distinguish "never been Lost" from "was Lost, now reopened"? Option A preserves that signal implicitly (non-null stale fields); Option B erases it unless edit history (#17) is separately built.
- Is data-hygiene simplicity (a reliable `status==='Open'` ⇒ null invariant) valued over incidental information retention?
- Is this worth deciding independently of #17, or should the two be decided together (e.g., "clear on reopen, but only after Decision #17 guarantees the prior value is preserved elsewhere")?

### 7. Implementation Impact (if/when decided)
- Enquiry reopen service/controller (does not exist yet — will be created during Enquiry implementation) — the clearing logic (Option B) or explicit non-clearing comment (Option A) belongs there.
- Any frontend/report code that reads `lostReason`/`lostDate` must match whichever contract is chosen.
- `DATABASE_SCHEMA.md`/`DOMAIN_MODEL.md` updated once decided (currently they describe the open question, not a resolution).

---

## Decision #19 — Won/Conversion Guard

### 1. PWA FACT
The Enquiry→SalesOrder "Convert" action is only rendered in the UI when `status==="Open"`. However, the underlying save logic that actually creates the SalesOrder and marks the Enquiry `Won` performs **no server-side (or even client-side function-level) check** of the Enquiry's current status before proceeding. Additionally, nothing in the PWA prevents an entirely unrelated, non-Enquiry-linked SalesOrder from being created later for the same company, even one that already has a Won Enquiry — there is no hard 1:1 enforcement anywhere in the data model or logic.

### 2. CURRENT NEW APP STATE
- No Enquiry→SalesOrder conversion service exists yet in the new backend (schema-only phase). `Enquiry.js` and `SalesOrder.js` have no interlocking validation.
- `DOMAIN_MODEL.md` (SalesOrder "Create" bullet) and `DATABASE_SCHEMA.md` §4 ("Create cascade") both now explicitly document the absence of a status check and the absence of 1:1 enforcement, flagging this as unresolved and pointing to `OPEN_DECISIONS.md` #19.

### 3. Options

**Option A — Preserve literal PWA behavior (no server-side guard)**
- **Data model:** No change.
- **Service logic:** The conversion service creates the SalesOrder and marks the Enquiry `Won` unconditionally, regardless of the Enquiry's current `status` at the moment of the call (mirrors the PWA's UI-only gate).
- **API behavior:** A conversion request against an already-`Won` or `Lost` Enquiry would succeed exactly as it would against an `Open` one — no rejection.
- **Validation:** None added.
- **Relationships:** No 1:1 constraint between `Enquiry` and `SalesOrder`; multiple SalesOrders could reference (or fail to reference) the same Enquiry with no system objection.
- **Audit/history:** No record of "attempted invalid conversion" since none is ever rejected.
- **Downstream modules:** Exposes the new backend to the same race condition the PWA has (e.g., two salespeople converting the same Enquiry near-simultaneously, or a stale client re-submitting a conversion) — this must be explicitly accepted as a known, carried-over risk, not an oversight.
- **Migration implications:** None.

**Option B — Add backend protection against invalid/repeated conversion**
- **Data model:** No schema change strictly required, though enforcing "at most one SalesOrder per Enquiry" could optionally be backed by a unique index on `SalesOrder.enquiryId` (partial/sparse, since it's nullable) — this itself interacts with Decision #20 (whether `enquiryId` survives at all, and in what form).
- **Service logic:** The conversion service must, before creating the SalesOrder, re-fetch the Enquiry and verify `status==='Open'` (reject with a clear error otherwise), and optionally check for an existing SalesOrder already referencing this Enquiry (reject a second conversion). This needs to happen inside the same transaction as the cascade (Project + Payment creation + notification) to avoid a check-then-act race.
- **API behavior:** Conversion against a non-Open Enquiry (or an already-converted one, if 1:1 is enforced) returns an explicit error (e.g. 409 Conflict) instead of silently succeeding.
- **Validation:** New validation step in the service layer; possibly a schema-level unique/partial index as a second line of defense against races.
- **Relationships:** Could formalize Enquiry↔SalesOrder as an enforced (not just conventional) 1:1, which directly overlaps with Decision #20's population/enforcement sub-question (Option D there).
- **Audit/history:** A rejected conversion attempt could optionally be logged (ties back to Decision #17's broader question of what gets tracked).
- **Downstream modules:** Reduces risk of duplicate/inconsistent Project + Payment cascades firing twice for one Enquiry; Notification and Reporting benefit from cleaner, non-duplicated data.
- **Migration implications:** If applied to a system that already has data violating the invariant (e.g., two SalesOrders already reference the same Enquiry from an earlier, unguarded period), adding a unique index would fail at creation time until the data is cleaned up — a migration/cleanup step would be needed before Option B could be enforced at the database level.

### 4. PWA Fidelity Impact
- **Option A** is exact fidelity, including the PWA's known race-condition weakness.
- **Option B** is an intentional strengthening beyond the PWA — a considered "fix" rather than a silent one, since it is being surfaced here as an explicit choice rather than assumed.

### 5. Dependencies
- **Decision #20 (SalesOrder back-reference):** if `enquiryId` is removed entirely (#20 Option A/C-style), a hard 1:1 enforcement in Option B here becomes impossible to implement at the database level (there would be no field to index) — the two decisions are directly coupled at the technical level, not just adjacent in theme.
- **SalesOrder, Project, Payment, Notification:** Option B protects all of these from duplicate-cascade side effects; Option A leaves this risk intact.
- **Reporting:** A cleaner conversion path (Option B) reduces the chance of orphaned/duplicated SalesOrder records skewing sales pipeline reports.

### 6. Recommended Selection Criteria (no winner chosen)
- How much operational risk does the business accept from the PWA's known race condition, given real-world usage patterns (single sales rep per Enquiry vs. shared/team access)?
- Is "at most one SalesOrder per Enquiry" actually a business rule the company wants enforced, or is the current flexibility (allowing a fresh unrelated SO later) intentionally useful?
- Should this be decided jointly with #20, since a hard-enforcement Option B depends on what shape (or presence) `enquiryId` ends up taking?

### 7. Implementation Impact (if/when decided)
- Enquiry→SalesOrder conversion service (does not exist yet).
- Possibly a unique/partial index addition on `SalesOrder.js` (`enquiryId`), which would itself require this decision plus #20 to be resolved together.
- `DATABASE_SCHEMA.md`/`DOMAIN_MODEL.md` updated to state the finalized guard behavior.

---

## Decision #20 — SalesOrder→Enquiry Back-Reference

### 1. PWA FACT
The PWA's own in-memory SalesOrder object has **no field at all** referencing an originating Enquiry. The only Enquiry↔SalesOrder link the PWA ever demonstrates is one-directional and informal: on conversion, the Enquiry's own `remark` field is overwritten with `"Converted to SO-<no>"` and a `followUpLog` entry is appended — both live on the *Enquiry* side. A SalesOrder itself carries nothing pointing back to "the Enquiry that produced me."

### 2. CURRENT NEW APP STATE (verified directly from `SalesOrder.js` in this review)
`SalesOrder.js` **already contains** an implemented field:
```js
enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', default: null }, // PWA FACT
```
This field and its `// PWA FACT` code comment **have not been modified** by any prior documentation-only task (per explicit instruction not to touch `SalesOrder.js`). The comment is now known to be inaccurate — confirmed again in this review by direct inspection of the PWA's SO object, which has no such field. `DATABASE_SCHEMA.md` §4's prose has already been corrected (in the prior task) to stop calling this a PWA fact and instead labels it "NEW BACKEND DESIGN — verified NOT a PWA fact," pointing to this decision. **`SalesOrder.js`'s in-code comment itself, however, still literally reads `// PWA FACT` today** — this is a live inconsistency between the code comment and the documentation, which this decision, once made, should resolve by updating the code comment (not the field's existence) to match whichever option is chosen.

To be precise about the three-way distinction requested:
- **PWA fact:** no back-reference field exists on the PWA's SalesOrder object at all.
- **Current NEW APP implementation:** `enquiryId` (`ObjectId ref enquiries, nullable`, default `null`) already exists in `SalesOrder.js`, mislabeled in-code as `// PWA FACT`, and is not currently populated or enforced by any service logic (none exists yet).
- **Proposed design choice:** what to do with this already-implemented candidate field going forward — the four options below.

### 3. Options

**Option A — Remove the existing `enquiryId` field entirely**
- **Data model:** Delete the `enquiryId` field from `SalesOrder.js`; drop it from `DATABASE_SCHEMA.md` §4.
- **Service logic:** Any future conversion service simply never sets a back-reference; the only Enquiry↔SO link remains the Enquiry-side `remark`/`followUpLog` text, exactly as in the PWA.
- **API behavior:** SalesOrder API responses never include an `enquiryId`; a client wanting "which enquiry produced this SO" would have to search Enquiries whose `remark`/`followUpLog` mentions the SO number (fragile, PWA-faithful, text-based).
- **Validation:** None needed.
- **Relationships:** No formal Enquiry↔SalesOrder relationship at the database level; fully matches the PWA's total absence of one.
- **Audit/history:** N/A.
- **Downstream modules:** Any reporting that wants "conversion rate" or "Enquiry source of SalesOrder X" must parse free text or be reconstructed from `followUpLog`, which is significantly harder and less reliable than a direct reference. Decision #19's Option B (1:1 enforcement) becomes structurally impossible without reintroducing a field.
- **Migration implications:** If any SalesOrder document already has `enquiryId` populated (unlikely at this schema-only stage, but relevant once real data exists), removing the field would need those documents migrated/dropped, and would destroy already-captured linkage data.

**Option B — Keep it, renamed to `originatingEnquiryId`**
- **Data model:** Rename the field in `SalesOrder.js` (and update the index/reference name everywhere it's referenced). Same type/nullability as today.
- **Service logic:** Conversion service sets `originatingEnquiryId` when creating a SalesOrder from an Enquiry; otherwise leaves it null. No difference in behavior from Option C — this is a naming-only change.
- **API behavior:** Field name in API payloads changes; any hypothetical existing integration or frontend referencing `enquiryId` would need updating (low risk today since none consumes it yet).
- **Validation:** Same as Option C below.
- **Relationships:** Same as Option C — a formal reference, more descriptively named to signal "this records where the SO came from" rather than implying an active/required relationship.
- **Audit/history:** N/A.
- **Downstream modules:** Same benefits as Option C; the more explicit name reduces ambiguity for future developers/reports about the field's semantics (a "back-reference recording provenance," not a live foreign-key relationship the SO depends on).
- **Migration implications:** A field rename on an existing collection requires a migration script (rename in-place) if any data already exists under the old name; trivial at this pre-data stage, non-trivial once the app is live with real records.

**Option C — Keep `enquiryId` as-is (name unchanged)**
- **Data model:** No change to `SalesOrder.js` structure; only the misleading `// PWA FACT` code comment would need correcting to something like `// NEW BACKEND DESIGN — see OPEN_DECISIONS.md #20` once this decision is finalized.
- **Service logic:** Conversion service sets `enquiryId` on SalesOrder creation from an Enquiry; otherwise null.
- **API behavior:** No naming change/migration needed for any future consumer built against the current field name.
- **Validation:** None beyond the existing `ref: 'Enquiry'` type constraint (Mongoose does not enforce referential integrity by itself — this only affects population, not existence).
- **Relationships:** A conventional (not database-enforced) many-to-one reference: many SalesOrders could theoretically reference the same Enquiry unless Decision #19 adds enforcement.
- **Audit/history:** N/A.
- **Downstream modules:** Reporting/analytics can join SalesOrder→Enquiry directly and efficiently once populated; Project/Payment/Notification are unaffected either way, since they key off SalesOrder, not off Enquiry.
- **Migration implications:** None — lowest-friction option since it changes nothing about what already exists in code.

**Option D — Keep a durable reference and enforce its population/relationship rules**
- **Data model:** Keep `enquiryId` (or the renamed `originatingEnquiryId` — this option is orthogonal to naming and could combine with B or C) and add real enforcement: e.g. a unique/partial index (at most one SalesOrder per Enquiry, coupling directly with Decision #19 Option B), and/or a pre-save/service-level validation that the referenced Enquiry actually exists and is (or was) `Won`.
- **Service logic:** Conversion service must auto-set the field (never left to manual/API input) and validate consistency (e.g., reject creating a SalesOrder with an `enquiryId` pointing to an Enquiry that isn't `Won`, or that already has a linked SalesOrder).
- **API behavior:** Field becomes effectively system-managed/read-only from the client's perspective post-creation (an immutable reference), not a freely editable field.
- **Validation:** The most validation-heavy option — needs existence checks, status checks, and possibly uniqueness checks, all requiring service-layer or transactional logic that does not exist yet.
- **Relationships:** Formalizes Enquiry↔SalesOrder as a real, enforced 1:1 relationship — the most significant behavioral divergence from the PWA of all four options, since the PWA enforces nothing here at all.
- **Audit/history:** Could log rejected population attempts if paired with Decision #17.
- **Downstream modules:** Strongest benefit for Reporting (guaranteed-clean conversion-tracking data) and for Decision #19 (this is effectively the data-layer half of that decision's Option B). Also the most coupled option — it cannot be decided in isolation from #19.
- **Migration implications:** Same as whichever naming option it's paired with, plus a data-integrity backfill/cleanup pass would be needed before any uniqueness constraint could be safely added to a database that might already contain violating data.

### 4. PWA Fidelity Impact
- **Option A** is the only option matching the PWA's total absence of a back-reference — full fidelity via removal.
- **Options B and C** are already-implemented (pre-existing in code before this review) intentional divergences from the PWA — the field exists for the new backend's own reasons (structured querying, reporting), not because the PWA has one. B and C differ from each other only in naming, not in fidelity posture.
- **Option D** is the largest intentional divergence — it adds enforcement the PWA never had anywhere in this relationship.

### 5. Dependencies
- **Decision #19 (Won/Conversion guard):** directly coupled — Option D here is close to a prerequisite for Decision #19's Option B (hard 1:1 enforcement needs a field to enforce it on); conversely, choosing Decision #19 Option B strongly implies wanting Option D (or at least C) here rather than Option A.
- **Reporting:** Options B/C/D all materially simplify "which SalesOrder came from which Enquiry" reporting/conversion-rate analysis versus Option A's text-parsing fallback.
- **SalesOrder, Project, Payment, Notification:** none of these modules currently read `enquiryId` for their own cascade logic (the cascade is driven by the Enquiry object passed into the conversion call, not by reading the field back off the saved SalesOrder) — so none of them break under Option A; the impact is confined to Enquiry↔SalesOrder traceability and reporting.
- **Migration/data integrity tooling:** Option D specifically depends on a data-cleanup capability existing before any uniqueness constraint can be safely deployed against non-empty data.

### 6. Recommended Selection Criteria (no winner chosen)
- Does the business want a queryable, reliable way to trace "which Enquiry produced this SalesOrder" for reporting, even though the PWA never offered one? If not, Option A restores PWA-exact behavior and removes now-unused code.
- If a reference is wanted, is the current name (`enquiryId`) acceptable, or does the team prefer the more self-documenting `originatingEnquiryId` (Option B) — noting this is a naming/communication decision, not a functional one?
- Should the relationship be merely informational (Option C) or actively enforced (Option D)? This should be decided together with Decision #19, since they are technically the same underlying question viewed from two entities.
- If Option D is attractive, is the business prepared for the migration/cleanup work needed before a database-level uniqueness constraint can be safely added later, once real data exists?

### 7. Implementation Impact (if/when decided)
- `SalesOrder.js`: field kept/removed/renamed per choice; `// PWA FACT` comment corrected in all cases (this alone is due regardless of which option is chosen, since the comment is already known to be wrong).
- `DATABASE_SCHEMA.md` §4 and `DOMAIN_MODEL.md` SalesOrder "References" bullet: updated to state the finalized field name/semantics once decided (both currently describe the open question, consistent with each other).
- Enquiry→SalesOrder conversion service (does not exist yet): must populate the field per the decision.
- Possibly a unique/partial index (Option D, coupled with Decision #19).
- `OPEN_DECISIONS.md` #20 updated to record the resolution once made (not part of this task).

---

## Comparison Table

| Decision | Option | PWA Fidelity | New Backend Complexity | Data Integrity | Downstream Impact | Migration Impact | Trade-offs |
|---|---|---|---|---|---|---|---|
| #17 Edit History | A. Preserve (no audit trail) | Exact match | None | No history captured for direct edits | None | None | Simplicity vs. no traceability of field-level changes |
| #17 Edit History | B. Add edit-history tracking | Intentional divergence | Moderate–high (diff logic, new storage, possible new endpoint) | Improves — changes become traceable | Enables future "who changed what" reporting; may overlap with Open Decision #3 (general audit log) | None (new data starts empty at cutover; no way to backfill past edits) | Traceability vs. added write/read cost and possible duplication with a future general audit system |
| #18 Lost Fields on Reopen | A. Preserve (fields remain populated) | Exact match | None | Retains prior Lost context as a side effect, but ambiguous meaning of non-null fields when `status==='Open'` | Consumers (reports/UI) must defensively check `status` before trusting these fields | None | Retains incidental history vs. a less clean/predictable data contract |
| #18 Lost Fields on Reopen | B. Clear fields on reopen | Intentional divergence | Low (one extra field-clear in reopen logic) | Cleaner — `status==='Open'` reliably implies both fields null | Simplifies any code reading these fields; loses the prior Lost reason unless captured elsewhere (e.g. #17) | Backfill/cleanup needed only if retroactively applied to already-reopened records with stale data | Cleaner data contract vs. loss of (accidental) historical context |
| #19 Won/Conversion Guard | A. Preserve (no server-side check) | Exact match, including known race condition | None | No protection against invalid/duplicate conversions | Carries forward risk of duplicate Project/Payment cascades on race or misuse | None | Fidelity/simplicity vs. accepted operational risk |
| #19 Won/Conversion Guard | B. Add backend protection | Intentional divergence (deliberate strengthening) | Moderate (status re-check, optional uniqueness enforcement, must be transactional) | Materially improved — prevents duplicate/invalid conversions | Protects Project/Payment/Notification from duplicate cascades; improves Reporting accuracy | Needs data cleanup before any uniqueness constraint can be enforced on non-empty data | Safety/consistency vs. added service-layer complexity; tightly coupled to Decision #20 |
| #20 SalesOrder Back-Reference | A. Remove `enquiryId` | Exact match (PWA has no such field) | Lowest (deletion) | N/A — no reference to keep consistent | Reporting must fall back to text-parsing `remark`/`followUpLog`; blocks Decision #19 Option B | Needs migration/cleanup only if any data already populated the field | Full fidelity vs. loss of a clean, queryable link |
| #20 SalesOrder Back-Reference | B. Rename to `originatingEnquiryId` | Intentional divergence (pre-existing field, clarified) | Low (rename + reference updates) | Same as Option C, more clearly named | Same benefits as Option C, improved clarity for future developers | Rename migration if data already exists under the old name | Clarity of intent vs. a rename migration cost |
| #20 SalesOrder Back-Reference | C. Keep `enquiryId` as-is | Intentional divergence (pre-existing field, unchanged) | Lowest of the "keep" options (no rename needed) | Same as Option B, name unchanged | Same benefits as Option B | None | Lowest friction vs. a less self-documenting name |
| #20 SalesOrder Back-Reference | D. Keep + enforce population/relationship | Largest intentional divergence | Highest (existence/status/uniqueness checks, transactional service logic) | Highest — guarantees a valid, consistent, at-most-one-per-Enquiry link | Strongest benefit for Reporting; effectively required if Decision #19 Option B is chosen | Needs data cleanup before any uniqueness constraint can be safely added | Strongest guarantees vs. most implementation work; tightly coupled to Decision #19 |

---

## Cross-Decision Coupling (informational only — not a recommendation)

- **#19 and #20 are technically linked.** Enforcing "at most one SalesOrder per Enquiry" (Decision #19, Option B) requires a durable, indexable reference field to enforce it on (Decision #20, Option C or D). Choosing #19-B while also choosing #20-A (remove the field) is not implementable as described — this combination is flagged as inconsistent, not ruled out, since the business could still choose to remove the field and enforce the rule some other way (e.g. purely in application logic without a database index), which just was not detailed above.
- **#17 and #18 both touch what "history" means for an Enquiry.** If #17-B (edit history) is adopted, it could independently preserve the prior `lostReason` even if #18-B (clear on reopen) is also chosen, decoupling data-hygiene from information loss.
- **#17 may overlap with Open Decision #3** (general audit retention policy, already recorded in `OPEN_DECISIONS.md`). Resolving #3 first could determine the shape #17 should take, rather than building a bespoke Enquiry-only mechanism that a later general audit system would duplicate or need to reconcile with.
