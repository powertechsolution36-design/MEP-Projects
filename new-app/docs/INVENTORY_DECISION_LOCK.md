# Inventory Decision Lock

Status: DOCUMENTATION-ONLY. No Inventory implementation (service/routes/controllers/repository/tests) exists or was created by this task. This document formally resolves every open item raised by `new-app/docs/PWA_COVERAGE_AUDIT_INVENTORY.md` §28, so that a future implementation task has no ambiguity left to interpret on its own.

## 1. Purpose

`PWA_COVERAGE_AUDIT_INVENTORY.md` produced a 20-item open-decision list (§28) plus a 26-item PWA-quirk list (§25) that a future Inventory implementation would otherwise have to interpret unsupervised. This document closes that gap: for every material decision, it records the PWA fact, the resolved decision, its classification, the concrete implementation consequence, and the reason — following the same "decision lock" pattern already established by `PROJECT_DECISION_LOCK.md`, `CONTRACT_DECISION_LOCK.md`, and `SERVICECALL_DECISION_LOCK.md`. The governing default principle, applied throughout: **PWA behavior is preserved exactly unless the deviation falls into an already-approved infrastructure-only category** (MongoDB storage, durable ObjectIds, concurrency-safe server counters, hashed passwords, mandatory tenant isolation, real server-side authorization matching the PWA's own visible intent, transaction/concurrency safety, or storage adaptation genuinely required by the platform change). A bug, gap, or awkward PWA behavior is not automatically fixed by appearing in this document — nothing is silently improved, and no useful-sounding enhancement is smuggled in as "infrastructure."

## 2. Source authority

- **Primary source of truth (unchanged):** `MEP_PROJECTS_PWA/index.html` (md5 `111b53dba91704f96b83dae96c7793c6`), via `PWA_COVERAGE_AUDIT_INVENTORY.md` (741 lines, read in full for this task, not sampled).
- **Secondary sources consulted (read-only):** `new-app/docs/OPEN_DECISIONS.md` (current highest entry: #77, from the ServiceCall implementation status update), `new-app/docs/DOMAIN_MODEL.md` §11–§15 (InventoryCategory/Location/Item/Issue/Transaction), `new-app/docs/DATABASE_SCHEMA.md` §13–§15 (`inventoryItems`/`inventoryIssues`/`inventoryTransactions`) plus the Inventory Relationship Map, `new-app/backend/src/models/InventoryCategory.js`, `InventoryLocation.js`, `InventoryItem.js`, `InventoryIssue.js`, `InventoryTransaction.js` (schema-only, no service/route/controller exists for any of them), `new-app/backend/src/repositories/businessRepositories.mongoose.js` (the `{ _id, companyId }` tenant-scoping and `session`-threaded write conventions), `new-app/backend/src/middleware/authMiddleware.js`/`roleMiddleware.js`/`tenantGuard.js`, and `new-app/backend/src/models/Counter.js` (the `getNextSequence(companyId, ...)` primitive already used for ServiceCall's PSC numbering).
- `SERVICECALL_DECISION_LOCK.md` and `CONTRACT_DECISION_LOCK.md` were read in full as the structural/format template for this document (same "Decision #: / Question: / PWA fact: / Decision: / Classification: / Implementation consequence: / Reason:" pattern).
- No PWA source line was re-derived from memory; every fact restated below is traceable to a specific line-numbered citation already captured in `PWA_COVERAGE_AUDIT_INVENTORY.md`.

## 3. Safety baseline

This task is documentation-only, exactly as constrained:
- No `inventoryService.js`, `inventoryRoutes.js`, controller, repository, or test file may be created.
- `InventoryCategory.js`, `InventoryLocation.js`, `InventoryItem.js`, `InventoryIssue.js`, `InventoryTransaction.js`, and every other source file outside `new-app/docs/` remain untouched.
- `MEP_PROJECTS_PWA/index.html` and the root `index.html` copy remain untouched (md5 `111b53dba91704f96b83dae96c7793c6` verified unchanged both before and after — see §29).
- `v2/` and `v3/` remain untouched (git diff counts re-verified unchanged — see §29).
- Files created/updated by this task: `new-app/docs/INVENTORY_DECISION_LOCK.md` (new), `new-app/docs/OPEN_DECISIONS.md` (appended, #78 onward), `new-app/docs/DOMAIN_MODEL.md` and `new-app/docs/DATABASE_SCHEMA.md` (narrow, Inventory-specific corrections only — no unrelated section touched).
- Nothing is staged or committed by this task.

## 4. Entity lock

The five-entity, field-by-field shape documented in the audit's §3 is locked as-is; no field is added, removed, or renamed beyond what the existing schemas (`InventoryCategory.js`/`InventoryLocation.js`/`InventoryItem.js`/`InventoryIssue.js`/`InventoryTransaction.js`) already reflect:
- `InventoryCategory`: `companyId`, `name` only — no description, code, parent/child, icon, or `div` field is authorized.
- `InventoryLocation`: `companyId`, `name` only — same restriction, no `div` field.
- `InventoryItem`: `companyId`, `code`, `name`, `categoryId`, `unit` (enum `Nos, Mtr, Kg, Set, Box, Roll, Ltr`), `returnable`, `minimumStockLevel`, `ratePerUnit`, `stockByLocation` (`Map<String, Number>`) — the legacy `qty` fallback field is **not** ported (it is dormant/unused in the live PWA; §6 of the audit).
- `InventoryIssue`: the 17-field shape (`companyId, itemId, quantityIssued, staffId, site, projectId, fromLocationId, date, returnable, quantityReturned, quantityUsed, status, returnRequested, requestedQuantity, requestedDate, requestNote, issuedByUserId, remark`) is locked exactly as already modeled — no new field is authorized.
- `InventoryTransaction`: `companyId, date, type, itemId, quantity, fromLocationId, toLocationId, recordedByUserId, referenceText, remark` — the eight-type enum (§8 lock below) is locked exactly as already modeled.
- No entity gains a `div`/division field (see §20 lock).

## 5. Category lock

**Decision 1 — Category name uniqueness**
Question: should `InventoryCategory.name` be unique per company?
PWA fact: `saveCat()` performs no duplicate-name check anywhere; two categories with an identical name in the same company are fully permitted (audit §4/§25 item 20).
Decision: not resolved by this document — the PWA demonstrates the *absence* of a rule, not a rule to preserve or reject.
Classification: OPEN — REQUIRES BUSINESS DECISION.
Implementation consequence: no `unique: true` index is added to `InventoryCategory.name` pending this decision; the existing non-unique `{companyId, name}` index (already present, per the audit's §26 gap analysis) remains query-performance-only, not a constraint.
Reason: the PWA gives no evidence either way — inventing a uniqueness constraint because `name` looks like it should be unique would be exactly the "useful enhancement disguised as infrastructure" this task must avoid.

**Decision 2 — Category deletion with dependent items**
Question: what happens when a category still has items assigned to it and someone tries to delete it?
PWA fact: `delCat()` hard-blocks deletion whenever any `invItems()` row has `cat===id` ("Move or delete items in this category first"); no reassign-and-delete or orphan-and-delete option exists (audit §4).
Decision: preserve exactly — deletion remains hard-blocked while any item references the category.
Classification: PRESERVE PWA.
Implementation consequence: a future `deleteCategory` function must reject the operation (not cascade-delete items, not orphan them, not reassign them) whenever `InventoryItem.categoryId` references the target category.
Reason: this is the one deletion guard the PWA actually implements in the Category/Location/Item trio; it is a demonstrated rule, not a gap.

**Decision 3 — Category rename propagation**
PWA fact: `catName()` is resolved live on every render, never snapshotted onto items/issues/transactions — a rename instantly changes what every downstream display shows, with no historical record of the old name (audit §7).
Decision: preserve exactly — category names remain live-resolved (a populate/lookup at read time), never copied onto `InventoryItem`/`InventoryIssue`/`InventoryTransaction`.
Classification: PRESERVE PWA.
Implementation consequence: no `categoryName` snapshot field is added to any dependent entity.
Reason: directly verified PWA behavior; snapshotting would be a new data-integrity feature the PWA never had.

## 6. Location lock

**Decision 4 — Location name uniqueness**
Question: should `InventoryLocation.name` be unique per company?
PWA fact: `saveLoc()` performs no duplicate-name check, identical pattern to Category (audit §5).
Decision: not resolved by this document.
Classification: OPEN — REQUIRES BUSINESS DECISION.
Implementation consequence: no `unique: true` index is added pending this decision.
Reason: same reasoning as Decision 1 — absence of evidence is not a decision.

**Decision 5 — Location deletion with existing stock**
PWA fact: `delLoc()` hard-blocks deletion whenever any item currently has non-zero stock at that location; no "delete and zero-out" option exists (audit §5).
Decision: preserve exactly — deletion remains hard-blocked while stock exists at that location.
Classification: PRESERVE PWA.
Implementation consequence: a future `deleteLocation` function must reject the operation while any `InventoryItem.stockByLocation` entry for that location is non-zero; no archive/soft-delete semantic is invented (the PWA has none — it is a hard block or nothing).
Reason: directly verified, the only guard the PWA implements for Location deletion.

## 7. Item lock

**Decision 6 — Item deletion**
Question: should Item deletion remain a hard, unguarded delete, or should the new system add archive/soft-delete/recycle-bin semantics?
PWA fact: `delItem()` removes the item row immediately after `confirm()`, with **no** block for outstanding issues or transaction history — the confirmation text itself says "Transaction history is kept," and `invIssues`/`invTxns` rows referencing the deleted item are left in place, with every downstream `itemById()` lookup resolving to `undefined` and rendering a blank name defensively (audit §6/§25 item 22).
Decision: preserve exactly — no delete workflow beyond this hard, unguarded, dangling-reference-tolerant delete exists in the PWA, so none is invented.
Classification: PRESERVE PWA.
Implementation consequence: a future `deleteItem` function must perform a hard delete of the `InventoryItem` document with no block for existing `InventoryIssue`/`InventoryTransaction` references, and downstream reads (item lookups on old issue/transaction rows) must defensively return a blank/placeholder name rather than error — no archive flag, no restore action, no recycle bin, and no import of any V3 destructive-delete framework is authorized.
Reason: this is a demonstrated PWA design (explicit, in the confirmation text itself) to keep history while deleting the parent row — not an oversight calling for a safer replacement, and not licence to invent a richer lifecycle either.

**Decision 7 — Item `code` uniqueness**
PWA fact: `code` is free-text, optional, never validated for uniqueness anywhere — the seed data demonstrates the identical code (`"CU-14"`) reused across two different companies for two different items, proving not even per-tenant uniqueness is implicitly enforced (audit §7/§25 item 21).
Decision: preserve exactly — no uniqueness index (global or per-company) is added on `InventoryItem.code`.
Classification: PRESERVE PWA.
Implementation consequence: the existing `{companyId, code}` index (per the audit's §26 gap analysis, already non-unique) remains query-performance-only; `code` is never used as a lookup key by any function, exactly as in the PWA — all references remain by durable `_id`.
Reason: `code` looking like a natural key is not evidence the PWA treats it as one; the audit's seed data is a direct, demonstrated counter-example.

**Decision 8 — Stock model (per-location map, pure derived calculations)**
PWA fact: `stock` is a per-item map keyed by location id (`it.stock[String(locId)] = qty`); `totQty`/`stockState`/`stockValue`/`issuedQty` are pure functions recomputed on every read, never persisted (audit §6/§7).
Decision: preserve exactly — `stockByLocation` remains the sole stock-quantity store; total stock, stock state (In/Low/Out), stock value, and material-with-staff figures remain calculated at read time from `stockByLocation`/`InventoryIssue`, never stored as a separate persisted field.
Classification: PRESERVE PWA.
Implementation consequence: whichever service layer eventually implements this must build `totQty`/`stockState`/`stockValue`/`issuedQty` equivalents as pure functions over live data (currently missing per the audit's §26/§29 gap analysis), not as new stored/cached fields that could drift from the underlying `stockByLocation`/`InventoryIssue` data.
Reason: directly and exhaustively verified; storing a derived figure would introduce a new class of data-consistency bug the PWA never has.

## 8. Stock lock

**Decision 9 — Stock adjustment types and semantics**
PWA fact: a single shared `mAdjust()`/`saveAdjust()` flow covers exactly four transaction types (`Purchase In`, `Opening Stock`, `Damage / Write-off`, `Adjustment`) via one signed-quantity input; the **absolute value** is what's logged as `qty`, with `from`/`to` (not the sign) carrying direction; a negative result that would take a location below zero is blocked with a toast before `moveStock()` is called (audit §6/§8).
Decision: preserve exactly — exactly these four adjustment types, one shared signed-quantity input, `Math.abs(q)` logged as the transaction quantity, and the negative-result-at-that-location guard.
Classification: PRESERVE PWA.
Implementation consequence: no additional adjustment type is invented (no "Purchase Return," no "Stock Count," no "Transfer-In-Correction," etc.); a negative adjustment is never reinterpreted as a new Issue-type transaction; `"Opening Stock"` remains re-usable on an existing item (not restricted to first-creation only), matching the audit's confirmed finding that this is source-confirmed PWA behavior, not a naming assumption.
Reason: directly verified in §6/§8/§24 of the audit; this is the PWA's entire model for stock-in/adjustment/write-off — nothing more structured (e.g. a dedicated Purchase-In screen with PO-line detail) is demonstrated or required.

**Decision 10 — Negative stock clamp**
PWA fact: `moveStock()` unconditionally clamps a location's stock to zero if a delta would take it negative (`if(it.stock[k]<0)it.stock[k]=0`) — this floor exists independently of, and in addition to, the various pre-save `q<=available` guards that normally prevent it from ever being exercised (audit §6/§25 item 10).
Decision: preserve both rules independently and exactly — (a) `moveStock()`'s own zero-floor clamp, and (b) the separate pre-save `available quantity` checks in Issue/Transfer/Adjustment that normally make the clamp unreachable in ordinary use.
Classification: PRESERVE PWA — explicit PWA quirk, not to be normalized into a single "reject negative stock" rule.
Implementation consequence: a future stock-mutation function must (a) still perform its own pre-check that blocks an operation which would exceed available quantity (Issue: `q<=stock@fromLocation`; Transfer: `q<=stock@fromLocation`; Adjustment: blocked if the result would go negative at that location), AND (b) the underlying stock-mutation primitive itself must clamp to zero rather than allow (or reject via database constraint) a negative value, exactly mirroring the PWA's belt-and-suspenders behavior. Collapsing these into one check (e.g. relying solely on the pre-check and letting the primitive throw on a hypothetical negative) would be a silent behavioral simplification, not a preservation.
Reason: the audit explicitly frames these as two independently verified, structurally separate mechanisms — conflating them changes observable behavior in the one hypothetical case where the pre-check is somehow bypassed (e.g. a future direct API/script call).

**Decision 11 — Low/out-of-stock thresholds**
PWA fact: Out of Stock = `totQty(it) <= 0` (checked first, priority over Low); Low Stock = `it.min` truthy AND `totQty(it) <= it.min`; with `min` falsy/unset, the Low branch is structurally unreachable (audit §6/§13).
Decision: preserve exactly, including the `min` falsy → Low-Stock-unreachable quirk.
Classification: PRESERVE PWA.
Implementation consequence: a future `stockState` equivalent must check Out-of-Stock first, then Low-Stock only if `minimumStockLevel` is truthy; an item with `minimumStockLevel: 0` (or unset) can only ever read as "In Stock" or "Out of Stock," never "Low Stock" — this is not to be "fixed" by treating `0` as "any positive stock is low."
Reason: directly verified exact formula (audit §6/§13); this is a real PWA quirk with observable UI/report consequences, explicitly listed for preservation per the task's quirk-lock requirement.

**Decision 12 — Stock value calculation**
PWA fact: `stockValue(it) = totQty(it) * (Number(it.rate)||0)` — flat quantity × single unit rate, no FIFO/weighted-average/per-batch costing (audit §6/§7).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: no per-batch/lot costing model is introduced; `ratePerUnit` remains a single scalar per item, and stock value remains `totalQuantity × ratePerUnit` computed at read time.
Reason: directly verified; a richer costing model would be a new business feature, not a preservation.

## 9. Issue lock

**Decision 13 — Item/location/staff/site selection pools**
PWA fact: item dropdown = items with `totQty>0` somewhere; from-location dropdown = all locations unfiltered (fails at save time if insufficient); staff pool (`staffList()`) = every company user except role `admin`; site pool (`siteList()`) = every non-"In Service" project + every non-Completed service call (given `id:0`, never a real reference) + a static "Office / Godown" entry (also `id:0`) (audit §9).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: the staff/recipient candidate pool for issuance is every company role except `admin` (i.e. `sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr, service_eng, finance` remain eligible recipients) — no narrower "field staff only" pool is invented; the from-location dropdown remains unfiltered by the chosen item's actual stock at each location (validated only at save time); service-call sites continue to store `projectId: null` (or the PWA's `0`-equivalent) rather than a structured ServiceCall reference (see §21 lock).
Reason: `staffList()` and `siteList()` directly and unambiguously answer this question from source; no genuine ambiguity remains to leave open.

**Decision 14 — Quantity/stock validation at issue time**
PWA fact: `saveIssue()` checks `q>0 && q<=stock@chosenLocation` — availability at the *specific chosen location*, not total item stock across all locations (audit §9).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: the future issue-creation validation must check quantity against `stockByLocation[fromLocationId]`, not `totQty(item)` — an item with plenty of total stock spread across other locations, but none at the chosen location, must still be rejected.
Reason: directly verified; location-specific validation is the actual rule, not a total-stock check.

**Decision 15 — `returnable` snapshot behavior**
PWA fact: `ret: !!it.ret` is copied onto the issue at issue time and never re-synced — a later edit to the item's `ret` flag does not retroactively change already-issued rows (audit §9/§25 item 1).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: `InventoryIssue.returnable` remains a point-in-time snapshot, never re-derived from the current `InventoryItem.returnable` value after creation.
Reason: directly verified, and independently distinguished (§16 below) from the separate "any issued material's balance may be returned regardless of the flag" rule.

## 10. Return-request lock

**Decision 16 — Return request does not move stock**
PWA fact: `saveReturnReq()` only sets `retReq/retReqQty/retReqDate/retReqNote` and notifies — no `moveStock()`, no `invLog()` call; the actual movement only happens when the inventory manager later runs `saveInvReturn()` (audit §10).
Decision: preserve exactly — a staff-initiated return request is a pure signal, never a stock movement.
Classification: PRESERVE PWA.
Implementation consequence: the return-request endpoint must never touch `stockByLocation` or write an `InventoryTransaction`; the two steps (request, then actual return) remain structurally distinct functions/endpoints, never merged into one operation.
Reason: directly and exhaustively verified; merging the two steps would silently change observable stock-movement timing.

**Decision 17 — Return-request quantity rule and duplicate/overwrite behavior**
PWA fact: `1 <= q <= issBal(x)`; calling `saveReturnReq()` again while a request is already pending simply overwrites the prior request's fields (no guard, though the UI relabels the button "Update request") (audit §10/§25 item 16).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: repeated return-request calls on the same issue remain a full overwrite of `returnRequested/requestedQuantity/requestedDate/requestNote`, not rejected and not appended as a queue/history.
Reason: directly verified; a history/queue of requests would be a new capability.

**Decision 18 — Return-request rejection**
PWA fact: `rejectReturn()` clears `retReq/retReqQty/retReqNote` (but **not** `retReqDate`, a harmless quirk since the date is never displayed once `retReq` is false); no stock change, no transaction, and no persistent record that a request was ever made and rejected beyond the one-time notification text (audit §10/§25 item 26).
Decision: preserve exactly, including the `retReqDate`-not-cleared quirk.
Classification: PRESERVE PWA.
Implementation consequence: a future rejection function clears `returnRequested`/`requestedQuantity`/`requestNote` but leaves `requestedDate` as-is; no rejection-history collection/field is added.
Reason: directly verified as an explicit, source-confirmed quirk, not an oversight to correct.

## 11. Return lock

**Decision 19 — Returnable-flag vs. actual returnability**
PWA fact: `item.ret` (`returnable`) is a snapshot that affects the "Returnable Material With Staff" dashboard panel (`pendingReturns()` filters on `x.ret`) — but the *return action itself* (`mInvReturn`/`returnableNow()`) operates purely on balance (`issBal(x)>0`), regardless of `ret`; a non-returnable consumable's un-used balance can still be formally "returned" through the same flow (the PWA's own UI copy says this explicitly: "tools, or unused leftover consumables") (audit §16/§25 item 3).
Decision: preserve both rules independently — do not collapse "is this item flagged returnable" and "can this issued balance be returned" into a single rule.
Classification: PRESERVE PWA.
Implementation consequence: a future `getPendingReturnsPanel`-equivalent (the dashboard's "Returnable Material With Staff" panel) filters on `returnable===true && balance>0 && status!=="Returned"`, while the actual accept-a-return action remains available for **any** issue with `balance>0`, irrespective of `returnable`.
Reason: directly and separately verified as two independent predicates serving two different purposes; merging them would silently block legitimate returns of non-returnable consumables' unused balance, which the PWA explicitly allows.

**Decision 20 — Full/partial return, location choice, and `rqty` accumulation**
PWA fact: `1<=q<=balance`; both full and partial return use the same function, `rqty` accumulates additively across multiple partial-return actions; return location defaults to the original issue location but is freely changeable to a different location (audit §10).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: return-into-location remains a free choice (not locked to the original issue location); `quantityReturned` accumulates across repeated partial returns on the same issue.
Reason: directly verified.

**Decision 21 — Return-request clearing on accept**
PWA fact: an accepted return unconditionally clears `retReq=false, retReqQty=0` regardless of whether that specific return was triggered by the pending request or is an ad-hoc manager-initiated return, silently clearing any unrelated pending request state on the same row (audit §10).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: the accept-return function always resets `returnRequested`/`requestedQuantity` regardless of whether a request existed or matches the accepted quantity.
Reason: directly verified as source-confirmed, unconditional behavior.

**Decision 22 — "Mark remaining balance used" combined action**
PWA fact: the accept-return modal's optional checkbox, if checked, adds any remaining post-return balance to `used` and logs a `"Consumed"` transaction in the same save operation — a return and a mark-used can happen atomically in one user action (audit §10).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: the accept-return function must support this same combined-action shape (an optional `markRemainingUsed` flag on the same call), not require two separate API calls to achieve the same result.
Reason: directly verified; splitting it into two mandatory calls would change the observable transactionality of the action from the user's perspective (though it may still be one database transaction internally — that is an infra detail, not a business behavior change, provided the API-level combined action remains available).

## 12. Damage/write-off lock

**Decision 23 — Damaged return representation**
PWA fact: a `Condition` dropdown toggles Good/Damaged; damaged means `moveStock()` is skipped (stock NOT credited) but `rqty` still increments by the full amount (balance still clears from the staff's perspective) and a separate `"Damage / Write-off"` transaction is logged alongside the `"Return"` transaction; there is no separate scrap-stock entity, no `scrapQty` field, no approval state — this one condition toggle plus the transaction pair is the PWA's entire write-off model (audit §10/§25 item 5).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: damaged-return handling remains: skip the stock credit, still increment `quantityReturned` by the full returned amount, and write both a `"Return"`-type transaction (remark prefixed `"DAMAGED — not added to stock. "`) and a separate `"Damage / Write-off"`-type transaction (remark `"damaged material returned"`) — no scrap-stock ledger, no `scrapQty` field, and no approval-state workflow is introduced.
Reason: directly and exhaustively verified; this is the explicit finding the task instructions anticipated ("confirms the task's directive not to invent a separate scrap-stock system — none exists to preserve or extend").

## 13. Mark-used lock

**Decision 24 — Mark used does not double-deduct stock**
PWA fact: `saveMarkUsed()`/`markConsumed()` never call `moveStock()` — the only stock decrement for issued material happens once, at `saveIssue()` time; marking used only closes staff-side balance bookkeeping and logs a `"Consumed"` transaction (audit §11).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: a future mark-used function must increment `quantityUsed` and write a `"Consumed"` transaction, and must **never** call the stock-mutation primitive — no second deduction.
Reason: directly verified line-by-line by the audit; this is an explicit, load-bearing quirk (§25 item 6) that a naive re-implementation could easily get wrong by "helpfully" also decrementing stock.

**Decision 25 — Mark used has no self-service path and no notification**
PWA fact: "Mark Used" is exclusively an inventory-manager (`canStock()`-gated) action on `vIssue()`/`vReturns()`/item-detail — never offered on "My Material"; neither `saveMarkUsed()` nor `markConsumed()` calls `notify()` (audit §11/§15/§17).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: no self-service "mark my own material used" endpoint/UI affordance is added for staff; no notification is fired on a mark-used action.
Reason: directly verified as a genuine gap relative to every other Inventory action, explicitly documented as a fact to preserve, not a gap to fill.

## 14. Transfer lock

**Decision 26 — Transfer semantics**
PWA fact: source/target are two independent location dropdowns (target defaults to the second location in the list, a fixed-index default, not "not-the-source"); same-location transfer is explicitly blocked (`f===t` rejected — the one deliberate no-op guard in the whole module); quantity validated against source-location stock only; both `moveStock()` calls run synchronously back-to-back with no lock/transaction concept in the PWA itself; no notification is ever fired (audit §12/§25 items 18, and the "no notification" finding of §17).
Decision: preserve exactly.
Classification: PRESERVE PWA (semantics, no-notification) / INFRASTRUCTURE-ONLY (the underlying two-location stock write becoming a genuinely atomic database operation instead of the PWA's "atomic only because synchronous JS" model — see §30 lock).
Implementation consequence: a future transfer function must reject `fromLocationId===toLocationId`; must validate quantity against `stockByLocation[fromLocationId]` only; must never fire a notification (no Transfer notification exists in the PWA and none is to be invented, per §17 lock below); the two stock writes should be wrapped in one database transaction as an infra-level atomicity improvement, without changing what is validated or reported to the user.
Reason: directly verified; the same-location guard is the one deliberate duplicate/no-op protection the module has, worth preserving precisely because most similar scenarios elsewhere are explicitly *not* guarded.

**Decision 27 — Admin's missing Transfer menu link**
PWA fact: `MENUS.admin` lists `stock, invissue, invreturn, invhistory` but **not** `invtransfer` — Admin has `canStock()` privileges (which the Transfer button's render condition checks) but no menu path to reach the Transfer creation screen; this is a demonstrated UI gap/quirk, not a deliberate two-tier permission design (nothing else distinguishes Admin's Inventory capabilities from Inventory Manager's) (audit §18/§25 item 19).
Decision: not resolved by this document — whether the new system's UI/menu should give `admin` a Transfer entry point (closing what looks like an accidental PWA UI gap) or preserve the gap is a presentation/UX decision, not a data-model or API-authorization decision; either way, the **backend authorization** for Transfer remains `inventory`/`admin` per §26 lock (role/access), since the underlying function itself has always allowed `admin` — only the PWA's own menu wiring omits the entry point.
Classification: OPEN — REQUIRES BUSINESS DECISION (UI/menu presentation only; not an API-authorization question).
Implementation consequence: the Transfer API/service authorization is `inventory`/`admin` regardless of this decision (§26 lock); whether the new frontend's menu structure exposes a Transfer link to `admin` is left to whoever designs that frontend.
Reason: the audit explicitly frames this as "a genuine PWA quirk, not a design choice documented anywhere in the code" — worth flagging for a business/UX decision rather than silently perpetuating or silently fixing a menu-wiring accident.

## 15. Transaction-ledger lock

**Decision 28 — Transaction storage shape**
PWA fact: exact shape `{id, co, date, type, item, qty, from, to, by, ref, remark}`, with `qty` always the absolute quantity moved (direction carried by `from`/`to`/`type`), and `by` always the *current session actor* (not necessarily the staff member) (audit §8).
Decision: preserve the complete field set exactly — do not reduce the ledger to a single running-balance field.
Classification: PRESERVE PWA + INFRASTRUCTURE STORAGE ADAPTATION (durable ObjectId references for `itemId`/`fromLocationId`/`toLocationId`/`recordedByUserId` in place of the PWA's in-memory integers/name string, already reflected in `InventoryTransaction.js`).
Implementation consequence: every field in the audit's §8 table (`type, item, qty, from, to, by, ref, remark`) must be persisted per transaction; no aggregate-only or running-balance-only ledger design is authorized.
Reason: directly verified as the complete, exhaustive shape; a slimmer ledger would lose audit-trail fidelity the PWA itself maintains.

**Decision 29 — Transaction immutability**
PWA fact: no function anywhere edits or deletes an `invTxns` row — confirmed append-only (audit §8/§16).
Decision: preserve exactly — `InventoryTransaction` remains immutable history; no update/delete endpoint is ever built.
Classification: PRESERVE PWA (already reflected in the schema's `immutable: true` fields, per the audit's §26 gap analysis).
Implementation consequence: no `PATCH`/`DELETE` route or service function is ever added for `InventoryTransaction`; a stock correction is always a **new** transaction (e.g. a new `Adjustment` entry), never a mutation of an existing row.
Reason: directly and exhaustively verified; this is one of the most load-bearing quirks in the whole document.

**Decision 30 — Eight-type transaction enum, exact and closed**
PWA fact: exactly eight type strings are ever produced — `Opening Stock, Purchase In, Damage / Write-off, Adjustment, Issue, Return, Consumed, Transfer` (audit §8, exhaustive `invLog()` call-site search).
Decision: preserve exactly — no additional transaction type is authorized.
Classification: PRESERVE PWA (already reflected in `InventoryTransaction.js`'s enum, per the audit's §26 gap analysis).
Implementation consequence: no ninth type (e.g. "Stock Count," "Reservation," "GRN") is added; the enum remains closed to these eight.
Reason: directly and exhaustively verified as the complete list.

**Decision 31 — Issue-transaction date discrepancy**
PWA fact: the `"Issue"` transaction's logged `date` is always "today" (`invLog()`'s own default), never the issue's own (possibly backdated) `date` field — `saveIssue()` never passes a `date` argument to `invLog()` for this call (audit §8/§25 item 25).
Decision: preserve exactly.
Classification: PRESERVE PWA — explicit quirk, not to be "fixed" by propagating the issue's own date onto the transaction row.
Implementation consequence: a future issue-creation function logs the `"Issue"`-type transaction with the current server date/time, independent of whatever date was chosen on the issue record itself.
Reason: directly source-confirmed as a real discrepancy, not an inference — explicitly listed as a quirk that must be preserved verbatim, not normalized.

## 16. Dashboard/report lock

**Decision 32 — Dashboard KPI formulas**
PWA fact: exact formulas for Total Items, Categories, Stock Value, Low Stock (`lowStockItems().length - out.length`, a subtraction of the combined low∪out set, not a separately filtered predicate), Out of Stock, Material With Staff (`returnableNow().length`, a count of **issue rows**, not items or quantity), Return Requests (audit §14).
Decision: preserve exactly, including the subtraction-based Low Stock KPI formula and the issue-row-count (not item-count, not quantity-sum) Material-With-Staff figure.
Classification: PRESERVE PWA.
Implementation consequence: the Low Stock KPI is computed as `(lowStockOrOutCount - outOfStockCount)`, not as an independently filtered "exactly low" predicate (they are numerically equivalent, but the implementation must not silently switch mechanisms in a way that could drift if the underlying predicates ever change); Material With Staff counts distinct `InventoryIssue` rows with `balance>0 && status!=="Returned"`, not summed quantity and not distinct items.
Reason: directly verified exact formulas; a "cleaner" reimplementation could easily produce a numerically different result under edge cases (e.g. if predicates diverge later) if the mechanism isn't preserved as specified.

**Decision 33 — Dashboard panel set and ordering**
PWA fact: five conditionally-rendered panels in a fixed order — Return Requests from Staff, Quick Actions (always shown), Low/Out of Stock, Returnable Material With Staff (using `pendingReturns()`, distinct from the KPI's `returnableNow()` — see §19 lock), Category-wise Inventory (audit §14).
Decision: preserve exactly.
Classification: PRESERVE PWA.
Implementation consequence: the dashboard data/API contract must expose exactly these five panels' underlying data, with the Returnable-Material panel using the `returnable===true` filtered predicate (distinct from the KPI card).
Reason: directly verified panel set and filter distinctions.

**Decision 34 — Report behavior (Stock, Issued, My Material, Transaction, Return reports)**
PWA fact: five report functions (`dlStock`, `dlIssued`, `dlTxns`, `dlMyMaterial`, `dlReturns`) with exact column sets, exact filter behavior (some respect the active search box, some dump unfiltered), exact ordering (reports iterate in insertion order, **not** reversed, unlike their on-screen table counterparts which are newest-first), and a shared `rptHead()` header block (audit §16).
Decision: preserve exactly — same five reports, same columns, same filter/ordering behavior per report.
Classification: PRESERVE PWA.
Implementation consequence: no new report type (financial/profitability/BOQ-variance/procurement/GRN) is added, since the PWA has none; CSV export ordering must match each report's documented behavior (insertion order for the `dl*()` exports, even where the corresponding on-screen table is reversed).
Reason: directly and exhaustively verified as the complete report catalogue; adding a new report type would be exactly the kind of "useful enhancement" this task must not introduce.

**Decision 35 — Report actor/access gating**
PWA fact: report download buttons are gated by which menu screen exposes them, not by a report-specific role check — e.g. `dlStock`/`dlIssued` are reachable by any role that can see the Stock screen (`admin, inventory, hvac_pm, solar_pm, mep_pm, service_mgr`), not just `inventory`/`admin` (audit §16/§18).
Decision: preserve the PWA's own visible access pattern per report (§26 lock covers the general role-enforcement infra adaptation).
Classification: PRESERVE PWA (visible intent) / INFRASTRUCTURE-ONLY (server-side enforcement of that same intent, per §26 lock).
Implementation consequence: `dlStock`/`dlIssued`-equivalent endpoints authorize the same broader role set the Stock screen itself is visible to, not narrowed to `inventory`/`admin` only; `dlTxns`-equivalent stays `admin`/`inventory` only (mirroring `invhistory` menu visibility); `dlMyMaterial`-equivalent stays open to any authenticated user for their own data; `dlReturns`-equivalent stays `admin`/`inventory` only.
Reason: directly verified per-report access pattern; a uniform "only inventory/admin can export any report" rule would narrow several roles' PWA-visible access.

## 17. Notification lock

**Decision 36 — Five-notification catalogue, verbatim**
PWA fact: exactly five `notify()` call sites — material issued (`["*"]`), low/out-of-stock warning (`["inventory","admin"]`, fires only from the Issue path), material returned (`["*"]`), return request rejected (`["*"]`), return request raised (`["inventory","admin"]`) — with exact text templates as quoted in the audit's §17, and **no** deduplication anywhere (audit §17).
Decision: preserve exactly — same five events, same recipients, same (verbatim, variable-substituted) text templates, same complete absence of dedup.
Classification: PRESERVE PWA.
Implementation consequence: no sixth notification event is added; no dedup/throttling logic is introduced as a new user-visible business rule (an infra-level retry-idempotency mechanism, per §30 lock, may prevent a single logical action from firing twice due to network retry, but must not suppress two genuinely separate qualifying actions' notifications, which the PWA never suppresses either).
Reason: directly and exhaustively verified as the complete list; this matches the task's explicit ground rule.

**Decision 37 — No notification for Transfer or Mark Used**
PWA fact: confirmed absent for both — `saveTransfer()` never calls `notify()`; neither `saveMarkUsed()` nor `markConsumed()` calls `notify()` (audit §12/§17).
Decision: preserve exactly — no notification is added for either action.
Classification: PRESERVE PWA — explicit DO NOT FIX (these read as gaps relative to every other action, but are demonstrated PWA facts, not oversights this task is licensed to correct).
Implementation consequence: Transfer and Mark-Used service functions must not call any notification mechanism.
Reason: directly verified; explicitly named in the task's quirk-lock list.

**Decision 38 — Low-stock notice fires only from the Issue path**
PWA fact: the low/out-of-stock warning is checked only inside `saveIssue()`, never in `saveAdjust()`, `saveTransfer()`, or `saveInvReturn()` — even though a Damage/Write-off adjustment or an outbound Transfer can equally push an item below its minimum (audit §13/§17).
Decision: preserve exactly.
Classification: PRESERVE PWA — explicit DO NOT FIX.
Implementation consequence: the low-stock notification trigger is wired only into the issue-creation code path, not into adjustment/transfer/return.
Reason: directly verified; adding the check to other paths would be a new, user-visible notification-trigger redesign, not a preservation.

## 18. Role/access lock

**Decision 39 — Function-level role enforcement for Inventory actions**
PWA fact: `canStock() = role==='inventory' || role==='admin'` gates rendering only — every `mXxx()`/`saveXxx()` function itself performs zero internal role check; the full per-capability table (Category/Location/Item management, Stock adjustment, Issue, Return accept/reject, Mark Used, Transfer, Transaction history, per-report access) is documented exhaustively in the audit's §18 (audit §18).
Decision: enforce, server-side, the PWA's own visible role intent exactly as tabulated in the audit's §18 — `inventory`/`admin` for Category/Location/Item management, stock adjustment, issue, return accept/reject, mark used, and transaction history; Transfer authorization is `inventory`/`admin` at the function level (matching what `canStock()` would allow if reached — see Decision 27's note that only the *menu* omits `admin`, not the underlying authorization); self-service return-request remains open to **any** authenticated user with a personal balance, with no role restriction narrower than the PWA's own (which is none).
Classification: INFRASTRUCTURE-ONLY (server-side enforcement matching PWA-visible intent — same approved category already applied to every prior module in this series).
Implementation consequence: reuse the existing project-wide role-constant/`assertCanManage*`-style pattern (e.g. `contractService.js`'s `MANAGE_ROLES`/`assertCanManageContracts`) for Inventory's mutating endpoints; do **not** broaden access to any role the PWA's UI never showed a mutating control to, and do **not** narrow My-Material's self-service return-request beyond what the PWA allows (any user with a personal `InventoryIssue` row).
Reason: this is the identical, already-precedented infra pattern applied to SalesOrder/Payment (`OPEN_DECISIONS.md` #22), Contract (`CONTRACT_DECISION_LOCK.md` Decision 6), and ServiceCall (`SERVICECALL_DECISION_LOCK.md` Decision/§19) — closing a UI-only gate with real server-side enforcement of the same intent, not inventing a new authorization scheme.

**Decision 40 — Recipient role scope for issuance**
PWA fact: `staffList()` = every company role except `admin` — a broad pool, not narrowed to "field staff only" (audit §9/§25 item 14).
Decision: preserve exactly — the recipient candidate pool for issuance remains every company role except `admin`.
Classification: PRESERVE PWA.
Implementation consequence: no new, narrower "eligible recipient" role list is invented; `inventory` and `finance` roles remain eligible material recipients, exactly as the PWA allows.
Reason: `staffList()` directly and unambiguously answers this question — the audit itself frames the PWA's own answer as "broad, exclude admin only," not a genuinely open question.

## 19. Tenant-security lock

**Decision 41 — Mandatory server-side tenant isolation on every Inventory path**
PWA fact: every direct-lookup function (`itemById(id)`, `catName(id)`, `locName(id)`, and every `mXxx(id)`/`save*` counterpart resolving an issue/item by raw id) performs **no** `co` check at all — only the list-producing functions (`invCats()`, `invLocs()`, `invItems()`, `invIssues()`, `invTxns()`) filter by `co`; a user who knows or guesses a numeric id could view or act on another company's Inventory data via direct navigation/console manipulation (audit §19/§25 item 23).
Decision: mandatory server-side company/tenant scoping on every single Inventory read/write path — item, category, location, issue, and transaction lookups, all mutations, and all exports — using the same `{ _id, companyId }` repository-query pattern already used by every other implemented module (Contract, Payment, Project, ServiceCall).
Classification: INFRASTRUCTURE-ONLY — mandatory, non-optional (tenant isolation is in the pre-approved list, and this PWA weakness is directly demonstrated in source, not hypothesized).
Implementation consequence: every future Inventory repository method takes and applies `companyId` exactly as `businessRepositories.mongoose.js`'s existing methods for Contract/Payment/Project/ServiceCall already do; a cross-tenant id lookup naturally yields "not found," following the existing project-wide convention (no separate 403-vs-404 design decision needed). This closes exactly the gap the PWA itself has and introduces no new business-facing restriction beyond company scoping.
Reason: directly demonstrated cross-tenant exposure in the PWA's own code, identical in kind to the already-resolved ServiceCall Decision 2 (`SERVICECALL_DECISION_LOCK.md`) — this is a security fix reusing an existing pattern, not a new authorization scheme.

## 20. Division lock

**Decision 42 — No division concept anywhere in Inventory**
PWA fact: exhaustively searched — no `div` field or division-based filter exists on any of the five Inventory entities, in `siteList()`, or in any report; a "Solar Components" category is purely a name, not a system-enforced division tag; nothing stops an HVAC project's issue from drawing material tagged with a Solar-named category (audit §20).
Decision: preserve exactly — no division field or division-based filter is added to `InventoryCategory`, `InventoryLocation`, `InventoryItem`, `InventoryIssue`, or `InventoryTransaction`, and none of the five reports gain a division filter/grouping.
Classification: PRESERVE PWA.
Implementation consequence: none of the five Inventory schemas gains a `division` field; `siteList()`-equivalent site selection for issuance continues to pull from all the company's non-completed projects/service calls regardless of division; category names remain freely mixed division-wise, with no system-enforced tag.
Reason: this is an unambiguous, exhaustively-verified PWA fact; importing any V3 division-separation concept into Inventory would directly contradict it.

## 21. Project relationship lock

**Decision 43 — `InventoryIssue.projectId` remains write-only/non-functional**
PWA fact: `projId` is written at issue-creation time (a real project id, or `0`/service-call/"Office") but is **never** read back by any Project-side code — Project completion, dashboard, reports, and material-balance calculations are built exclusively from `Project.deliveryChallans[]` (`dc[]`), an entirely separate, free-text material-tracking mechanism with no reference to `InventoryItem`/`InventoryIssue` at all (audit §21, independently re-verified rather than assumed).
Decision: preserve exactly — do not add any Project-Inventory join, rollup, material-balance dependency, stock ledger integration, or ProjectPackage-style linkage.
Classification: PRESERVE PWA.
Implementation consequence: `InventoryIssue.projectId` remains a plain, optional reference field with no functional consumer on the Project side; Project completion/reporting logic must continue to read only `Project.deliveryChallans[]`, never `InventoryIssue`; this reconfirms `OPEN_DECISIONS.md` #8/#33/#45 (already locked from the Project side) from the Inventory side, with no change.
Reason: independently re-verified by this audit (not merely repeated from the prior Project-side finding); the non-integration is a demonstrated, exhaustively-searched PWA fact — this is explicitly not something this document proposes fixing, matching the ground rule that older V3/architecture documents proposing `ProjectPackage`/`MaterialRequest`/BOQ-linked material allocation are out of scope.

## 22. ServiceCall relationship lock

**Decision 44 — No structural link between ServiceCall and Inventory**
PWA fact: `invIssues.projId` is never a `svcCalls.id` — a chosen service-call site gets `projId:0` (structurally identical to "no project"), discarding any way to trace back to the specific service call; `siteList()`'s service-call option text is a one-time free-text copy onto `invIssues.site`, never re-synced if the service call's own `site`/`psc` later changes; no ServiceCall code anywhere reads `invIssues`/`invItems`/`invTxns`; ServiceCall's own "Material Used" concept (`report.material`) is a completely separate free-text field with zero structural connection to Inventory (audit §22).
Decision: preserve exactly — no `serviceCallId` field is added to `InventoryIssue`, and no join/rollup is introduced in either direction.
Classification: PRESERVE PWA.
Implementation consequence: `InventoryIssue` gains no `serviceCallId` field (only the existing free-text `site` and the non-functional `projectId`); ServiceCall's `report.material`/`report.materialUsed` field remains free text with no structural tie to `InventoryIssue`/`InventoryItem`.
Reason: directly, exhaustively verified — nothing in either module's source demonstrates or implies a relationship beyond the one-time display-text copy; inventing one would be a new integration this task must not build.

## 23. PWA quirks

Every quirk below is independently verified in the audit's §25 (26 items total) and is locked as an explicit **DO NOT FIX** unless separately resolved as a genuine open decision elsewhere in this document. Restated here for a single point of reference (cross-references to the fuller write-up above where one exists):

1. `ret`/`returnable` snapshot never re-syncs after issue (§9 lock, Decision 15).
2. Return requests never move stock or write a transaction (§10 lock, Decision 16).
3. Any issued material's balance is returnable regardless of the item's `returnable` flag (§11 lock, Decision 19).
4. Partial return is fully supported and repeatable, `rqty` accumulates additively (§11 lock, Decision 20).
5. Damaged return is a write-off, not a separate scrap-stock entity (§12 lock, Decision 23).
6. Mark-Used/Consumed never decrements stock a second time (§13 lock, Decision 24).
7. `issBal()` clamps to zero (`Math.max(0, qty-rqty-used)`) — a defensive backstop, not normally reachable through the UI's own input caps.
8. Status is derived fresh on every mutation, never trusted from storage at rest.
9. **`"Returned"` IS reachable** (fully returned, nothing marked used) — independently re-verified by direct execution; see §24 (documentation corrections) below — this corrects a prior incorrect characterization, it does not change PWA behavior.
10. `moveStock()` clamps negative location stock to zero, independent of the separate pre-save availability checks (§8 lock, Decision 10).
11. `invTxns` rows are append-only, no edit/delete function exists (§15 lock, Decision 29).
12. `invIssues.projId` is written but never functionally read back (§21 lock, Decision 43).
13. `invIssues.site` is free text, copied once at issue time, never re-synced (§22 lock, Decision 44).
14. The staff/recipient candidate pool excludes only `admin` (§18 lock, Decision 40).
15. Duplicate issues are fully possible — no uniqueness/dedup check on issuance (§29 lock, Decision 47).
16. Duplicate return requests simply overwrite prior request state (§10 lock, Decision 17).
17. Repeated notification is the norm — no suppression/dedup anywhere (§17 lock, Decision 36).
18. Same-location transfer is explicitly blocked — the one deliberate no-op guard in the module (§14 lock, Decision 26).
19. Admin has `canStock()` privileges but no menu path to the Transfer create screen (§14 lock, Decision 27).
20. Category/Location deletion guards check only "is it currently referenced," with zero uniqueness enforcement on creation (§5/§6 lock, Decisions 2, 5).
21. Item `code` can duplicate across items, even within the same company (§7 lock, Decision 7).
22. Item deletion leaves dangling references, defensively rendered blank, never cleaned up (§7 lock, Decision 6).
23. Cross-tenant direct-lookup gap on every Inventory single-record route (§19 lock, Decision 41 — closed as mandatory infra, not denied as a fact).
24. `saveAdjust()`'s `"Opening Stock"` type is reusable on an existing item, not first-creation-only (§8 lock, Decision 9).
25. The Issue transaction's logged `date` never matches the issue's own (possibly backdated) `date` field (§15 lock, Decision 31).
26. A rejected return request leaves no persistent history beyond the one-time notification text (§10 lock, Decision 18).

No item on this list is treated as a bug to silently fix; each is preserved verbatim per the task's explicit quirk-lock requirement.

## 24. Documentation corrections

**Correction 1 — `"Returned"` reachability (OPEN_DECISIONS.md #16 superseded, not deleted)**
`OPEN_DECISIONS.md` #16 (written during an earlier task) claims the PWA's `issStatus()` has an operator-precedence bug making the literal `"Returned"` status permanently unreachable, and that the reachable outcomes are only `Issued, Return Requested, Partially Returned, Returned/Used, Consumed`. `PWA_COVERAGE_AUDIT_INVENTORY.md` §10/§25 item 9 independently re-executed the exact extracted `issStatus()` expression in Node (not just re-read it) and confirmed the opposite: `"Returned"` **is** reachable — a fully-returned issue with nothing marked used (e.g. `qty:10, rqty:10, used:0`) correctly produces `"Returned"`, not `"Returned/Used"` and not a permanently dead branch. The two documents' *parse* of the expression is identical; the disagreement is purely in which branch a falsy `used` selects, and direct execution resolves it unambiguously in the audit's favor.
Decision: this is a **PWA FACT CORRECTION**, not a business decision — the original #16 entry is **not deleted** (preserving decision history, per this task's ground rules); a new entry (`OPEN_DECISIONS.md` #78, §25 below) is appended immediately, explicitly marking #16 as **SUPERSEDED/CORRECTED BY #78**, quoting the audit's independent re-verification.
Classification: PWA FACT CORRECTION.
Implementation consequence: any future `issStatus()`-equivalent derivation service must be designed so that `qty===rqty && used===0` (balance zero via return alone, no consumption) produces the literal string `"Returned"`, distinct from `"Returned / Used"` (which requires `used>0`) and from `"Consumed"` (which requires `rqty===0`). The `InventoryIssue.js` schema's existing comment asserting `"Returned"` is unreachable is **not** edited by this task (read-only comparison only, per the ground rules) — that correction is recorded here and in `OPEN_DECISIONS.md` for whoever next touches that file.
Reason: the audit's re-verification method (direct execution, not manual precedence re-reading) is the more reliable evidence, and the task instructions explicitly required correcting rather than deleting the old note.

**Correction 2 — `"Returned/Used"` spacing**
PWA fact: `issStatus()` literally produces the string `"Returned / Used"` (with a space before and after the slash) — verified character-for-character in the audit's §10 code excerpt (`"Returned / Used"`). The existing `InventoryIssue.js` schema enum, `DATABASE_SCHEMA.md` §14 (line 465, and the Inventory Relationship Map), and `DOMAIN_MODEL.md` §14 all currently read `Returned/Used` (no spaces) — a cosmetic but real mismatch between the documented/modeled string and what the PWA actually emits (audit §26 gap analysis, §28 item 20).
Decision: **PWA FACT CORRECTION** — the correct string, to be used whenever the status-derivation service is eventually built, is `"Returned / Used"` (with spaces), matching the PWA exactly.
Classification: PWA FACT CORRECTION.
Implementation consequence: `DOMAIN_MODEL.md` and `DATABASE_SCHEMA.md` are corrected by this task (narrow, Inventory-specific edits only — see §31 below) to read `"Returned / Used"`. `InventoryIssue.js`'s schema enum itself (currently `'Returned/Used'`) is **not** edited by this task, per the read-only/no-model-file-modification ground rule — this correction is recorded here so whoever next implements the status-derivation service corrects the enum value at that time, not silently, and not as an unrecorded side effect.
Reason: directly verified spacing mismatch; silently "fixing" the model file now (outside this task's documentation-only scope) is exactly what the ground rules forbid — recording the correction for the implementation task is the right-sized action here.

## 25. Infrastructure-only adaptations

The complete, closed list of infrastructure-only adaptations authorized for Inventory by this document — nothing broader is authorized:

1. MongoDB/Mongoose document modeling (already reflected in all five models).
2. Durable ObjectIds in place of the PWA's in-memory numeric ids (`_id`, `companyId`, `categoryId`, `itemId`, `fromLocationId`/`toLocationId`, `projectId` — already present in the schemas).
3. Durable `User` ObjectId references (`staffId`, `issuedByUserId`, `recordedByUserId`) in place of the PWA's plain name strings for `staff`/`by` — already a stated design choice in `InventoryIssue.js`/`InventoryTransaction.js`, correctly labeled NEW BACKEND DESIGN.
4. Mandatory server-side tenant/company scoping on every Inventory read/write path (§19 lock, Decision 41), reusing the existing `{ _id, companyId }` repository convention.
5. Server-side authorization matching the PWA's own visible role intent (§18 lock, Decision 39), reusing the existing `MANAGE_ROLES`/`assertCanManage*` pattern already established for Contract/SalesOrder/Payment/ServiceCall.
6. Concurrency-safe stock mutation — the PWA's `moveStock()` is a synchronous, single-threaded, no-lock, no-transaction operation, appropriate for a single-user in-memory demo, not a multi-user server; any real implementation of Issue/Return/Transfer/Adjust must guard the underlying stock write against concurrent requests (e.g. an atomic increment/decrement query, or a session-guarded transaction), without changing which quantities are validated or what gets rejected.
7. Transaction/concurrency safety around multi-document writes that must succeed or fail together (e.g. a Transfer's two `stockByLocation` updates, or an accepted-return-with-mark-used-in-one-action's combined write), using the existing `session`-threaded pattern from `paymentService.js`/`contractService.js`/`businessRepositories.mongoose.js`.
8. Storage-representation adaptation for the transaction ledger if MongoDB document-size/volume considerations require restructuring how `InventoryTransaction` rows are physically stored/indexed at scale (§30 lock) — provided the observable per-transaction fields and query results remain equivalent to the PWA's flat ledger.

New business fields or workflow redesigns are **not** classified as infrastructure here just because they might sound useful — none are proposed by this document.

## 26. Explicitly forbidden redesigns

The following are explicitly **not** authorized by this document, regardless of how reasonable they might seem as improvements — a future implementer must not introduce any of these without a separate, explicit business decision:

1. Adding a uniqueness constraint on `InventoryItem.code` (per-company or global).
2. Adding cascade-delete or auto-reassign/orphan behavior to Category or Location deletion.
3. Adding archive/soft-delete/restore/recycle-bin behavior to Item deletion.
4. Adding any edit/delete function to `InventoryIssue` beyond its existing state-machine transitions.
5. Adding any update or delete capability to `InventoryTransaction`.
6. Adding a ninth transaction type beyond the eight locked in §15/Decision 30.
7. Adding a scrap-stock entity, `scrapQty` field, or damaged-material approval workflow.
8. Adding a second stock deduction when material is marked used.
9. Adding division (`div`) filtering or a `div` field to any of the five Inventory entities.
10. Adding a real, functional join between `InventoryIssue`/`InventoryItem`/`InventoryTransaction` and `Project` (beyond the existing non-functional `projectId` field) or `ServiceCall` (beyond the existing free-text `site` copy) — no `ProjectPackage`, `MaterialRequest`, BOQ-linked allocation, physical-verification workflow, or project material ledger.
11. Adding a low-stock (or any) notification trigger to Adjustment, Transfer, or Return that the PWA does not have.
12. Adding a Transfer or Mark-Used notification.
13. Adding notification deduplication/throttling as a new user-visible business rule (an infra-level retry-idempotency guard against transport-level duplication is allowed; suppressing two genuinely separate qualifying actions is not).
14. Adding duplicate-issue or duplicate-return-request prevention as a new business rule.
15. Splitting the single shared stock-adjustment flow into type-specific structured forms (e.g. a dedicated Purchase-In screen with PO-line detail) as part of this document's scope.
16. Adding a new financial/profitability/BOQ-variance/procurement/GRN report.
17. Narrowing the self-service return-request feature to only `engineer`/`service_eng` roles (the PWA allows any authenticated user with a personal balance).
18. Broadening any Inventory-management capability (Category/Location/Item CRUD, Issue, Return accept/reject, Mark Used, Transfer, transaction history) to a role beyond `inventory`/`admin`.

## 27. Final resolved decision table

Restates the audit's own 20-item §28 list plus the additional material decisions this document raised, each in the required Decision-format, cross-referenced to the fuller write-up above.

**Decision 1** (§5) — Category name uniqueness — **OPEN — REQUIRES BUSINESS DECISION**.
**Decision 2** (§5) — Category deletion with dependent items — **PRESERVE PWA**.
**Decision 3** (§5) — Category rename propagation (live-resolved, never snapshotted) — **PRESERVE PWA**.
**Decision 4** (§6) — Location name uniqueness — **OPEN — REQUIRES BUSINESS DECISION**.
**Decision 5** (§6) — Location deletion with existing stock — **PRESERVE PWA**.
**Decision 6** (§7) — Item deletion (hard, unguarded, dangling-reference-tolerant) — **PRESERVE PWA**.
**Decision 7** (§7) — Item `code` uniqueness — **PRESERVE PWA**.
**Decision 8** (§7) — Stock model: per-location map, pure derived calculations — **PRESERVE PWA**.
**Decision 9** (§8) — Stock-adjustment types and semantics — **PRESERVE PWA**.
**Decision 10** (§8) — Negative-stock clamp, independent of pre-save availability checks — **PRESERVE PWA**.
**Decision 11** (§8) — Low/out-of-stock thresholds, including the `min`-falsy quirk — **PRESERVE PWA**.
**Decision 12** (§8) — Stock value calculation (flat qty × rate) — **PRESERVE PWA**.
**Decision 13** (§9) — Item/location/staff/site selection pools — **PRESERVE PWA**.
**Decision 14** (§9) — Quantity validation against the chosen location specifically — **PRESERVE PWA**.
**Decision 15** (§9) — `returnable` snapshot behavior — **PRESERVE PWA**.
**Decision 16** (§10) — Return request does not move stock — **PRESERVE PWA**.
**Decision 17** (§10) — Return-request quantity rule and overwrite-on-repeat behavior — **PRESERVE PWA**.
**Decision 18** (§10) — Return-request rejection, including the `retReqDate`-not-cleared quirk — **PRESERVE PWA**.
**Decision 19** (§11) — Returnable-flag vs. actual returnability, kept as two independent rules — **PRESERVE PWA**.
**Decision 20** (§11) — Full/partial return and location choice — **PRESERVE PWA**.
**Decision 21** (§11) — Return-request clearing on any accepted return — **PRESERVE PWA**.
**Decision 22** (§11) — Combined return + mark-remaining-used action — **PRESERVE PWA**.
**Decision 23** (§12) — Damaged-return representation (no scrap-stock entity) — **PRESERVE PWA**.
**Decision 24** (§13) — Mark used never double-deducts stock — **PRESERVE PWA**.
**Decision 25** (§13) — Mark used: no self-service path, no notification — **PRESERVE PWA**.
**Decision 26** (§14) — Transfer semantics, including the same-location guard — **PRESERVE PWA** (semantics) / **INFRASTRUCTURE-ONLY** (atomic write).
**Decision 27** (§14) — Admin's missing Transfer menu link — **OPEN — REQUIRES BUSINESS DECISION** (UI/menu presentation only).
**Decision 28** (§15) — Transaction storage shape (full field set) — **PRESERVE PWA** + **INFRASTRUCTURE STORAGE ADAPTATION**.
**Decision 29** (§15) — Transaction immutability — **PRESERVE PWA**.
**Decision 30** (§15) — Eight-type transaction enum, closed — **PRESERVE PWA**.
**Decision 31** (§15) — Issue-transaction date discrepancy — **PRESERVE PWA**.
**Decision 32** (§16) — Dashboard KPI formulas — **PRESERVE PWA**.
**Decision 33** (§16) — Dashboard panel set and ordering — **PRESERVE PWA**.
**Decision 34** (§16) — Report behavior (5 reports, exact columns/filters/ordering) — **PRESERVE PWA**.
**Decision 35** (§16) — Report actor/access gating per report — **PRESERVE PWA** (visible intent) / **INFRASTRUCTURE-ONLY** (server enforcement).
**Decision 36** (§17) — Five-notification catalogue, verbatim, no dedup — **PRESERVE PWA**.
**Decision 37** (§17) — No notification for Transfer or Mark Used — **PRESERVE PWA**.
**Decision 38** (§17) — Low-stock notice fires only from the Issue path — **PRESERVE PWA**.
**Decision 39** (§18) — Function-level role enforcement for Inventory actions — **INFRASTRUCTURE-ONLY**.
**Decision 40** (§18) — Recipient role scope for issuance (every role except `admin`) — **PRESERVE PWA**.
**Decision 41** (§19) — Mandatory tenant isolation on every Inventory path — **INFRASTRUCTURE-ONLY**.
**Decision 42** (§20) — No division concept anywhere in Inventory — **PRESERVE PWA**.
**Decision 43** (§21) — `projectId` remains write-only/non-functional — **PRESERVE PWA**.
**Decision 44** (§22) — No structural ServiceCall↔Inventory link — **PRESERVE PWA**.
**Decision 45** (§28 item 13) — Large-ledger scalability/storage — **INFRASTRUCTURE-ONLY**, see §30.
**Decision 46** (§28 item 14) — Transaction atomicity across the log+move-stock pair — **INFRASTRUCTURE-ONLY**, see §30.
**Decision 47** (§28 item 15/16) — Concurrency on stock + duplicate issue/return protection — **INFRASTRUCTURE-ONLY** (concurrency) / **PRESERVE PWA** (no duplicate-prevention business rule), see §30.
**Decision 48** (§17) — Repeated-notification protection — **PRESERVE PWA** (none exists, none added as a business rule).
**Decision 49** (§24) — `"Returned"` reachability — **PWA FACT CORRECTION**.
**Decision 50** (§24) — `"Returned / Used"` spacing — **PWA FACT CORRECTION**.
**Decision 51** (§18/§30) — Staff identity as durable User ref — **INFRASTRUCTURE-ONLY**.

## 28. Remaining genuine open decisions

Exactly three items from the audit's own §28 list (plus one raised independently by this document) resist being folded into PRESERVE PWA / PWA FACT CORRECTION / INFRASTRUCTURE-ONLY / RESOLVED-EXISTING-RULE, because the PWA genuinely gives no answer and no already-approved infra category applies:

1. **Category name uniqueness** (Decision 1, §5). The PWA demonstrates the *absence* of a uniqueness check, not a decision either way — whether the new system should enforce per-company uniqueness on `InventoryCategory.name` is a real product question. **Left OPEN — REQUIRES BUSINESS DECISION.**
2. **Location name uniqueness** (Decision 4, §6). Identical reasoning to #1, for `InventoryLocation.name`. **Left OPEN — REQUIRES BUSINESS DECISION.**
3. **Admin's missing Transfer menu link** (Decision 27, §14). A demonstrated PWA UI-wiring gap (not a deliberate two-tier permission design) — whether the new frontend should give `admin` a Transfer entry point is a presentation/UX decision independent of the (already-resolved) backend authorization question. **Left OPEN — REQUIRES BUSINESS DECISION** (UI/menu presentation only; backend authorization for Transfer is already locked to `inventory`/`admin` regardless of this decision's outcome).
4. **Item deletion vs. archive** (audit §28 item 6, folded into Decision 6 above as PRESERVE PWA for the *default* behavior). The audit itself flags that whether the new system should eventually add a block-on-references guard or an archive state *instead of* the PWA's hard, unguarded delete is not answered by the PWA — this document locks the *default* (preserve exactly, no archive) but explicitly does not foreclose a future, separate business decision to add a safer delete guard later, since "add a delete guard" would be a genuine new safeguard (like ServiceCall's analogous re-completion-guard question, `SERVICECALL_DECISION_LOCK.md` §25 item 1), not a PWA-preserving choice. **Recorded here for completeness; the *locked default* for initial implementation is PRESERVE PWA (Decision 6) — this is not left ambiguous for implementation purposes, only flagged as a candidate for a future, separate hardening decision.**

All other items from the audit's §28 twenty-item list are resolved above as PRESERVE PWA, PWA FACT CORRECTION, or INFRASTRUCTURE-ONLY, per §27's final table.

## 29. Safety verification

Re-run at the end of this task, matching the values already recorded in the audit's own §2 baseline:

| Check | Before | After | Result |
|---|---|---|---|
| `git diff --name-status -- v2` (file count) | 37 | 37 | MATCH |
| `git diff --name-status -- v3` (file count) | 0 | 0 | MATCH |
| `md5sum index.html` (repo root) | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | MATCH |
| `md5sum MEP_PROJECTS_PWA/index.html` | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | MATCH |
| Inventory implementation under `new-app` | 5 Mongoose models only, no service/route/controller/repository | unchanged — 5 models only | MATCH |
| Mtimes of the 5 Inventory model files | recorded before this task | unchanged | MATCH |
| Mtimes of ServiceCall/Contract/Project/Payment/SalesOrder/Enquiry source files | recorded before this task | unchanged | MATCH |
| Files staged/committed by this task | none | none | MATCH |

No `inventoryService.js`, `inventoryRoutes.js`, controller, repository, or test file was created. `InventoryCategory.js`, `InventoryLocation.js`, `InventoryItem.js`, `InventoryIssue.js`, `InventoryTransaction.js` were read for comparison only and were not modified.

## 30. Implementation readiness

| Area | Status | Notes |
|---|---|---|
| Entity/schema shape | LOCKED, already built | All five models match this document's field lock (§4); the `Returned/Used` enum-spacing correction (§24) is a documented fix for whoever next implements the status-derivation service, not applied to the schema file by this task. |
| Category/Location CRUD | LOCKED, not yet implemented | §5/§6 — deletion guards and the two open uniqueness questions (Decisions 1, 4) are fully specified; no service/route exists. |
| Item CRUD + stock model | LOCKED, not yet implemented | §7/§8 — deletion behavior, `code` non-uniqueness, and the pure-derived-calculation model are fully specified; `totQty`/`stockState`/`stockValue`/`issuedQty` equivalents remain an implementation gap (per the audit's §26/§29). |
| Issue workflow | LOCKED, not yet implemented | §9 — selection pools, validation, and the `returnable` snapshot rule fully specified. |
| Return-request + return workflows | LOCKED, not yet implemented | §10/§11/§12 — the two-step request/return distinction, damaged-write-off model, and combined mark-used action fully specified. |
| Mark-used workflow | LOCKED, not yet implemented | §13 — no-double-deduction and no-self-service/no-notification rules fully specified. |
| Transfer workflow | LOCKED (semantics), not yet implemented | §14 — same-location guard and quantity validation fully specified; the Admin-menu question (Decision 27) is presentation-only and does not block backend implementation. |
| Transaction ledger | LOCKED, already built (schema) | §15 — full field shape, immutability, eight-type enum, and the Issue-date-discrepancy quirk fully specified; no writer/service exists yet. |
| Dashboard/reports | LOCKED, not yet implemented | §16 — exact KPI formulas, panel set, and five-report catalogue fully specified; `totQty`/`stockState`/`issuedQty` derivations are a shared prerequisite with the Item/Stock area above. |
| Notifications | LOCKED, mechanism exists project-wide, wiring absent | §17 — five events, verbatim text, no dedup, fully specified; `Notification.js` schema ready, no Inventory-specific trigger wired anywhere yet (same pre-existing, cross-module gap already noted for Contract/ServiceCall). |
| Role/access | LOCKED, pattern exists in `contractService.js`/`serviceCallService.js` | §18 — reuse the existing `MANAGE_ROLES`/`assertCanManage*` pattern directly; no new authorization scheme needed. |
| Tenant/security | LOCKED, mandatory, pattern exists everywhere else | §19 — reuse the `{ _id, companyId }` repository convention already used by every other collection. |
| Division | NOT APPLICABLE | §20 — PWA has none; nothing to implement. |
| Project/ServiceCall relationships | LOCKED (non-integration) | §21/§22 — both remain deliberately unintegrated, reconfirming the already-locked Project-side decisions (`OPEN_DECISIONS.md` #8/#33/#45). |
| `"Returned"` reachability | DOCUMENTATION CORRECTION, applied | §24 — corrects `OPEN_DECISIONS.md` #16 via a new, superseding entry (#78); no code exists yet to have been affected by the prior incorrect characterization. |
| `"Returned / Used"` spacing | DOCUMENTATION CORRECTION, applied to `DOMAIN_MODEL.md`/`DATABASE_SCHEMA.md` | §24 — the schema file's own enum value is left for the implementation task to correct, per the read-only ground rule. |
| Large-ledger scale, atomicity, concurrency | INFRASTRUCTURE-ONLY, deferred to implementation | §25 items 6–8 — no PWA guidance exists since the PWA's single-user in-memory model never faced these; deferred to the future Inventory implementation task, must not change any preserved single-user workflow. |
| Genuinely open decisions | 3–4 items, explicitly not resolved here | §28 — flagged for business/product review before or during implementation; none block a first cut of the rest of the locked behavior. |
