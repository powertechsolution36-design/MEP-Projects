# Enquiry / SalesOrder — Business Decision Sheet

**Status: ANALYSIS/DECISION WORKSHEET ONLY. No decision is made here. No source code, schema, or `OPEN_DECISIONS.md` was changed to produce this document.**

This condenses the full analysis in `ENQUIRY_DESIGN_DECISION_REVIEW.md` into a business-facing worksheet for the four unresolved decisions in `OPEN_DECISIONS.md` (#17–#20). Fill in the selections at the bottom and return this document — nothing is implemented until that happens.

---

## #17 — Enquiry Edit History

**Exact PWA behavior:** A direct field edit to an Enquiry (name, site type, capacity, segment, phone, reference source, rating, estimated value, remark — via the Edit modal) leaves no trace at all. Only follow-ups and the three status actions (Lost / Reopen / Won-conversion) are ever logged, in `followUpLog`.

| | **A — Preserve (no audit trail)** | **B — Add edit-history tracking** |
|---|---|---|
| What choosing this means | New backend behaves exactly like the PWA: edits overwrite silently, nothing recorded | New backend records who changed what field, from what value, to what value, and when, on every direct edit |
| Business behavior change | None — same as today | New capability: staff could later be asked "who changed this quote value and when?" and get an answer |
| Data integrity | No record of edit history exists (matches PWA) | Enquiry becomes fully traceable at the field level |
| Reporting | No edit-history reports possible | Enables a future "change log" report per Enquiry |
| Downstream Project/Payment/Notification | No effect either way — these modules don't read Enquiry edit history | No effect either way |
| Implementation impact | None | New storage (embedded array or separate collection), new service logic to diff before/after values, possibly a new API endpoint to view history |
| Migration impact | None | History starts from zero at cutover — no way to recover edits made before this feature ships |
| Main trade-off | Simplicity vs. no way to ever answer "who changed this and when" | Full traceability vs. real build cost and an implicit invariant that "history" must be evaluated together with the general audit question below |

**Dependency with OPEN_DECISIONS.md #3 (general audit retention policy):** #3 already asks whether the new system needs a *general* audit log across all entities, separate from entity-specific histories. If the business later decides yes on #3, a bespoke Enquiry-only edit-history mechanism built for #17 could end up duplicating or conflicting with that broader system. **Recommendation embedded in the analysis (not a decision): resolve #3 before finalizing #17, or explicitly decide #17 is a stand-in until #3 is resolved.** This document does not choose between them.

---

## #18 — Lost Fields on Reopen

**Exact PWA behavior:** Reopening a Lost Enquiry (`reopenEnq`) sets `status` back to `Open` and logs the reopen action, but does **not** clear `lostReason` or `lostDate`. Both values remain stored — merely hidden from the detail view while status isn't `Lost` — until a later Lost transition overwrites them, or forever if it's never marked Lost again.

| | **A — Preserve (retain fields)** | **B — Clear on reopen** |
|---|---|---|
| What choosing this means | `lostReason`/`lostDate` stay populated after reopen, exactly as the PWA does | Reopening also nulls out `lostReason`/`lostDate` |
| Business behavior change | None — matches today's app | A reopened Enquiry looks "clean" — no residual Lost data until it's marked Lost again |
| Data integrity | Fields can be non-null even when status is `Open` — any consumer must know to check status first | Cleaner invariant: `status==Open` reliably means both fields are empty |
| Reporting | Any report reading `lostReason` must filter by `status==Lost` to avoid showing stale data | Reports can read `lostReason` directly with no extra filtering |
| Downstream Project/Payment/Notification | No effect either way | No effect either way |
| Implementation impact | None | One extra field-clear step added to the reopen action |
| Migration impact | None | None for new records; a cleanup script would be needed only if the business wants old "reopened with stale data" records retroactively cleaned |
| Main trade-off | Keeps an (accidental) trace of why it was Lost before, at the cost of a messier data contract | Cleaner data, but the prior Lost reason is lost forever unless #17 (edit history) is separately adopted to capture it first |

---

## #19 — Won/Conversion Guard

**Exact PWA behavior:** The "Convert to SalesOrder" button is only shown when an Enquiry's status is `Open`, but the underlying save logic itself never checks this — nothing stops a conversion from proceeding regardless of status, and nothing stops an unrelated, fresh SalesOrder from being created later even if the Enquiry already has one linked. No 1:1 relationship is enforced anywhere.

| | **A — Preserve (no guard)** | **B — Add backend protection** |
|---|---|---|
| What choosing this means | Conversion always succeeds, no matter the Enquiry's current status, exactly like the PWA | Conversion is rejected if the Enquiry isn't `Open`, and/or if it's already been converted once |
| Business behavior change | None — carries forward the same (rare) risk of a double-conversion or accidental re-conversion | Staff attempting an invalid conversion get a clear error instead of a silent duplicate |
| Data integrity | No protection against duplicate or invalid conversions | Materially safer — prevents duplicate Project/Payment records from a race or repeated click |
| Reporting | Possible duplicate/orphaned SalesOrders can skew pipeline/conversion-rate numbers | Cleaner, more trustworthy conversion data |
| Downstream Project/Payment/Notification | These modules could receive duplicate cascades if a conversion is accidentally repeated | Protected from duplicate cascades triggered by a bad/repeated conversion |
| Implementation impact | None | New status/duplicate check in the (not-yet-built) conversion service, ideally inside the same transaction as the cascade |
| Migration impact | None | If enforcing "one SalesOrder per Enquiry" at the database level, any existing data that already violates this would need cleanup first |
| Main trade-off | Fidelity/simplicity vs. accepted risk of duplicate conversions | Safety vs. added complexity — **and this option is technically linked to Decision #20, see below** |

---

## #20 — SalesOrder → Enquiry Back-Reference

**Exact PWA behavior:** The PWA's SalesOrder has **no field at all** referencing its originating Enquiry. The only Enquiry↔SalesOrder link is one-directional and informal — on conversion, the Enquiry's own `remark` is overwritten with `"Converted to SO-<no>"` and a follow-up log entry is added, both on the Enquiry side only.

**Current code state (verified):** `SalesOrder.js` already contains an implemented field, `enquiryId` (`ObjectId ref Enquiry`, nullable), left over from earlier work — its in-code comment still literally reads `// PWA FACT`, which is inaccurate (confirmed: the PWA has no such field). This decision is about what to do with an **already-existing** field, not whether to add a brand-new one.

| | **A — Remove `enquiryId`** | **B — Rename to `originatingEnquiryId`** | **C — Keep `enquiryId` as-is** | **D — Keep + enforce relationship/population rules** |
|---|---|---|---|---|
| What choosing this means | Delete the field entirely; SalesOrder carries no Enquiry reference, matching the PWA exactly | Keep the field, just rename it for clarity | Keep the field exactly as named today | Keep the field and add real rules: auto-populate on conversion, validate the referenced Enquiry exists/was Won, optionally enforce at most one SalesOrder per Enquiry |
| Business behavior change | Tracing "which Enquiry led to this SalesOrder" becomes impossible except by reading free text in the Enquiry's remark/log | None functionally — only the field's name changes | None — no functional change from today's code | Guarantees a clean, reliable, always-correct link — the new backend does something the PWA never could |
| Data integrity | No formal link exists at all | Same integrity posture as C, clearer naming | A conventional (not enforced) reference — nothing stops it from being wrong or duplicated | Strongest integrity — enforced at save time |
| Reporting | Must reconstruct conversions by parsing free text — slow and unreliable | Same benefit as C, easier for a developer to understand at a glance | Direct, efficient join possible once populated | Most reliable reporting — guaranteed-clean data |
| Downstream Project/Payment/Notification | No effect on these modules — they key off SalesOrder, not off Enquiry, either way | No effect | No effect | No functional effect on these modules, but pairs naturally with #19-B for stronger overall data safety |
| Implementation impact | Delete field from `SalesOrder.js`; fix in-code comment moot since field is gone | Rename field + comment; update anything that would reference the old name | Only the misleading comment needs fixing (to something accurate, once this decision is made) | Field kept/renamed + new validation logic in the conversion service, possibly a uniqueness constraint |
| Migration impact | Needs cleanup only if real data has already populated the field | Needs a rename migration only if real data already exists under the old name | None | Needs a data-cleanup pass before any uniqueness rule can be safely added to non-empty data |
| Main trade-off | Full PWA fidelity vs. losing a clean, queryable link | Clearer naming vs. a rename migration cost | Lowest friction vs. a less self-documenting name | Strongest guarantees vs. the most implementation work |

**Coupling with #19 (explicitly flagged):** Enforcing "at most one SalesOrder per Enquiry" (#19 Option B) requires a durable, indexable field to enforce it against. That means:

> **#19 = B combined with #20 = A is not directly implementable as described** — there would be no field left to enforce the rule on. If the business wants #19-B, it should be paired with #20-C or #20-D (or an equivalent field kept under a different plan). If #20-A is chosen (remove the field entirely), #19-B's duplicate-conversion protection would need a different enforcement mechanism than a database reference — which is not detailed in this worksheet.

---

## CURRENT CODE INCONSISTENCY

`new-app/backend/src/models/SalesOrder.js` currently contains:

```js
enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', default: null }, // PWA FACT
```

The `// PWA FACT` comment is **inaccurate** — verified directly against the PWA source: the PWA's own SalesOrder object has no such field. This has **not been changed** in `SalesOrder.js` itself (per explicit instruction), because Decision #20 is unresolved and the correct comment/field treatment depends entirely on which option is chosen. It will be corrected once #20 is decided — regardless of which option wins, since the comment is wrong under all four.

---

## DECISIONS REQUIRED FROM BUSINESS

```
#17 Edit History: [A / B / HOLD FOR #3]
#18 Lost Fields on Reopen: [A / B]
#19 Won/Conversion Guard: [A / B]
#20 SalesOrder Back-Reference: [A / B / C / D]
```

**Incompatible combination — flagged explicitly:**
- **#19 = B with #20 = A is technically inconsistent** — there is no field left to enforce a one-SalesOrder-per-Enquiry rule against. Choose #19-B only alongside #20-C or #20-D (or note that a non-field-based enforcement mechanism will need separate design).
- All other combinations across #17/#18/#19/#20 are independent of one another and may be selected freely.
