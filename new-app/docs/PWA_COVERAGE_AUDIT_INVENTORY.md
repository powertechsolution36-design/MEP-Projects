# PWA Coverage Audit — Inventory

**Status:** Read-only audit. No implementation performed. No files created other than this one.
**Audited by:** Engineering audit pass, 2026-09-23.
**Source of truth:** `MEP_PROJECTS_PWA/index.html` (live PWA, single-file app), lines 289, 362–408, 421–458, 525–1003, 1260–1330, 1400–1480, 2872–3480, 3579–3705 (as cited throughout). Root `index.html` is a byte-identical copy (md5 verified, see §2).

---

## 1. Scope & source

**Audited:** the Inventory subsystem's *local/functional* JavaScript behavior in `MEP_PROJECTS_PWA/index.html` — every function under the `/* ================= INVENTORY ================= */` block (lines 2872–3480) plus every call site into it from Dashboard, Project, Router/Menu, and seed-data code.

**Explicitly ignored (infrastructure noise, not business logic):**
- `API_BASE`, `TOKEN`, `fetch()`/`api()` calls, `API_MODE` branching.
- The WebSocket (`SOCKET`) layer.
- The "V2 connection adapter" — `fromV2*`/`toV2*` mapping functions, `serverRef`/`localRef`, `normalizeLegacyRefs`, and the entity-name maps at lines 530–539, 1002–1003 (these exist only to talk to the V2 backend and carry no PWA-local business rule).
- Backend sync/remote entity mapping and server persistence generally.

**Explicitly NOT used as a source:** any older NEW APP / V3 architecture document proposing `ProjectPackage`, `MaterialRequest`, BOQ material linkage, division-specific material allocation, physical verification workflow, excess-material approval workflow, `scrapQty`/project material ledger, new approval states, or any other new entity. None of those proposals appear anywhere in the PWA source, and none are treated as requirements here. Where the PWA is silent on something those documents propose, this audit records it as "NOT PRESENT IN PWA" and nothing more.

**Method:** every function, field, and behavior described below was read directly from source with `grep -n` / targeted line reads and, in one case (§9/§25, the `issStatus()` derivation), independently re-verified by executing the exact PWA expression in Node to confirm reachability rather than relying on manual operator-precedence reasoning. No fact in this document is inferred from a name alone — each is traced to the function that creates, reads, or displays it.

---

## 2. Safety baseline

Run before any reading began, and again after this document was written (see §"Required final verification" at the end of this file for the after-values):

| Check | Before | Expected | Result |
|---|---|---|---|
| `git diff --name-status -- v2` (file count) | 37 | 37 (pre-existing baseline drift) | ✅ MATCH |
| `git diff --name-status -- v3` (file count) | 0 | 0 | ✅ MATCH |
| `md5sum index.html` (repo root) | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | ✅ MATCH |
| `md5sum MEP_PROJECTS_PWA/index.html` | `111b53dba91704f96b83dae96c7793c6` | `111b53dba91704f96b83dae96c7793c6` | ✅ MATCH |
| Existing Inventory implementation under `new-app` | 5 Mongoose models only (`InventoryCategory.js`, `InventoryLocation.js`, `InventoryItem.js`, `InventoryIssue.js`, `InventoryTransaction.js`) under `new-app/backend/src/models/` — **no service, no route, no controller, no repository, no workflow** | models-only, no workflow | ✅ MATCH — confirmed no `services/inventory*`, `routes/inventory*`, or `*inventory*controller*` anywhere in `new-app/backend/src` |

`git status --porcelain` at the start showed a broad pre-existing modified-working-tree state (root config files, `server/`, etc.) — this is the pre-existing state of the working tree, not something this audit touched; this audit made zero edits to any of those files.

The five Inventory models already carry substantial "PWA FACT" / "NEW BACKEND DESIGN" annotation and even reference an `OPEN_DECISIONS.md` item (#16) about `issStatus()`. That prior analysis was independently re-derived in §9 below rather than taken on faith, per the task's re-verification requirement (see the finding at the end of §9).

---

## 3. Entity inventory

Five collections, all tenant-scoped by `co` (see §19), all populated only from the seed data (`DB.invCats`, `DB.invLocs`, `DB.invItems`, `DB.invIssues`, `DB.invTxns` — index.html lines 362–406) and mutated only by the functions below. Field-by-field detail is broken out per entity in §4–§9; this table is the master index of every field found, with its type as actually used and its origin.

| Entity | Field | Type (as used) | Required? | Default | Created | Updated | Editable via UI | Deletable |
|---|---|---|---|---|---|---|---|---|
| `invCats` | `id` | Number (seq) | yes | `DB.seq.invCat++` | `saveCat()` | never | no | — (row deleted, not field) |
| `invCats` | `co` | Number/String | yes | `U.co` | `saveCat()` | never | no | — |
| `invCats` | `name` | String | yes (UI blocks empty) | — | `saveCat()` | `saveCat()` (rename) | yes | — |
| `invLocs` | `id` | Number (seq) | yes | `DB.seq.invLoc++` | `saveLoc()` | never | no | — |
| `invLocs` | `co` | Number/String | yes | `U.co` | `saveLoc()` | never | no | — |
| `invLocs` | `name` | String | yes (UI blocks empty) | — | `saveLoc()` | `saveLoc()` (rename) | yes | — |
| `invItems` | `id` | Number (seq) | yes | `DB.seq.invItem++` | `saveItem()` | never | no | — |
| `invItems` | `co` | Number/String | yes | `U.co` | `saveItem()` | never | no | — |
| `invItems` | `code` | String | **no** (UI does not block empty) | `""` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `name` | String | yes (UI blocks empty) | — | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `cat` | Number (→ `invCats.id`) | yes (defaults to first category in dropdown) | first `invCats()[0].id` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `unit` | String enum: `Nos, Mtr, Kg, Set, Box, Roll, Ltr` | yes | `"Nos"` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `ret` | Boolean | yes | `false` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `min` | Number | no | `0` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `rate` | Number | no | `0` | `saveItem()` | `saveItem()` | yes | — |
| `invItems` | `stock` | Object map `{locId(string): qty(number)}` | yes (starts `{}`) | `{}` | `saveItem()` (opening-stock inputs, add-only) | `moveStock()` (every stock movement) | indirectly (via Adjust/Issue/Return/Transfer, never a raw edit field) | — |
| `invItems` | (legacy) `qty` | Number | no — only read as a fallback | n/a | never written by any live function | never | no | — |
| `invIssues` | `id` | Number (seq) | yes | `DB.seq.invIssue++` | `saveIssue()` | never | no | — |
| `invIssues` | `co` | Number/String | yes | `U.co` | `saveIssue()` | never | no | — |
| `invIssues` | `item` | Number (→ `invItems.id`) | yes | — | `saveIssue()` | never | no | — |
| `invIssues` | `qty` | Number | yes | — | `saveIssue()` | never (original issued qty is immutable) | no | — |
| `invIssues` | `staff` | String (user's `name`, not an id) | yes | — | `saveIssue()` | never | no | — |
| `invIssues` | `site` | String (free text, copied from `<select>` option text at issue time) | yes | — | `saveIssue()` | never | no | — |
| `invIssues` | `projId` | Number (→ `projects.id`, or `0`) | yes (always set, may be `0`) | `0` | `saveIssue()` | never | no | — |
| `invIssues` | `loc` | Number (→ `invLocs.id`, "from" location) | yes | — | `saveIssue()` | never | no | — |
| `invIssues` | `date` | String `YYYY-MM-DD` | yes | `today()` | `saveIssue()` | never | no | — |
| `invIssues` | `ret` | Boolean (copied from `item.ret` at issue time) | yes | — | `saveIssue()` | never (does not follow later item edits — see §25) | no | — |
| `invIssues` | `rqty` | Number (cumulative returned) | yes | `0` | `saveIssue()` | `saveInvReturn()` (increments) | no (system-derived) | — |
| `invIssues` | `used` | Number (cumulative marked-used) | no | `0`/undefined until first use | — | `saveInvReturn()` (balance-checkbox), `saveMarkUsed()`, `markConsumed()` | no (system-derived) | — |
| `invIssues` | `status` | String, persisted but always overwritten by `issStatus(x)` result immediately after every mutating action | yes | `"Issued"` | `saveIssue()` | `saveInvReturn()`, `saveMarkUsed()`, `markConsumed()` | no | — |
| `invIssues` | `by` | String (issuer's `U.name`) | yes | — | `saveIssue()` | never | no | — |
| `invIssues` | `remark` | String | no | `""` | `saveIssue()` | never | no | — |
| `invIssues` | `retReq` | Boolean | no | `false`/undefined | — | `saveReturnReq()` sets true; `saveInvReturn()`/`rejectReturn()` reset to `false` | no (system-derived) | — |
| `invIssues` | `retReqQty` | Number | no | `0`/undefined | — | `saveReturnReq()`; reset on accept/reject | no | — |
| `invIssues` | `retReqDate` | String date | no | undefined | — | `saveReturnReq()` | no | — |
| `invIssues` | `retReqNote` | String | no | `""` | — | `saveReturnReq()` | no | — |
| `invTxns` | `id` | Number (seq) | yes | `DB.seq.invTxn++` | `invLog()` | never | no | **no** (append-only) |
| `invTxns` | `co` | Number/String | yes | `U.co` | `invLog()` | never | no | no |
| `invTxns` | `date` | String `YYYY-MM-DD` | yes | `today()` (always "today", never backdated) | `invLog()` | never | no | no |
| `invTxns` | `type` | String enum (see §8) | yes | — | `invLog()` | never | no | no |
| `invTxns` | `item` | Number (→ `invItems.id`) | yes | — | `invLog()` | never | no | no |
| `invTxns` | `qty` | Number (always non-negative — sign carried by `type`/`from`/`to`, not the number) | yes | — | `invLog()` | never | no | no |
| `invTxns` | `from` | Number (→ `invLocs.id`) or `""` | no | `""` | `invLog()` | never | no | no |
| `invTxns` | `to` | Number (→ `invLocs.id`) or `""` | no | `""` | `invLog()` | never | no | no |
| `invTxns` | `by` | String (`U.name` of the actor performing the action, always the *current* session user, not necessarily the staff member) | yes | — | `invLog()` | never | no | no |
| `invTxns` | `ref` | String (free text; meaning varies per call site — see §8) | no | `""` | `invLog()` | never | no | no |
| `invTxns` | `remark` | String | no | `""` | `invLog()` | never | no | no |

Displayed/search/report usage for each field is covered per-entity in §4–§9 and per-report in §16 to avoid duplication.

---

## 4. Category (`invCats`)

- **Creation:** `mCat()` opens a modal with one field (`ct_n2`, category name); `saveCat(id)` (line 3264) validates non-empty name only, assigns next `DB.seq.invCat`, and pushes `{id, co:U.co, name}`.
- **Editing:** same modal, `id` passed in — `saveCat(id)` with an `id` simply overwrites `.name` on the existing object in place (rename only — no other field to edit).
- **Deletion:** `delCat(id)` (line 3270) — **blocked** if any `invItems()` row currently has `cat===id` ("Move or delete items in this category first"); otherwise `confirm()` then removed from `DB.invCats`.
- **Duplicate behavior:** **NOT PRESENT IN PWA** — no uniqueness check on `name` exists anywhere in `saveCat()`. Two categories with the identical name in the same company are fully permitted (confirmed: no `find`/`some` check before push).
- **Company scoping:** `co: U.co` set at creation; all reads go through `invCats()` = `DB.invCats.filter(x => x.co === U.co)` (line 2874). `catName(id)`, used for display, does **not** re-check `co` — it looks up by `id` across the whole `DB.invCats` array (line 2879), so it is only tenant-safe because `id`s are globally unique in the in-memory seed (see §19 tenant caveat).
- **Fields:** `id`, `co`, `name` only. No description, no code, no parent/child, no icon, no `div`.
- **Display usage:** category dropdown in `mItem()`; `catName()` lookup on stock table (`vStock`), item detail (`vInvItem`), dashboard `catSummary()`, category management screen (`vInvCats`), CSV stock/issued reports.
- **Relation to `InventoryItem`:** one-to-many via numeric `invItems.cat === invCats.id`; not a durable database reference, just an in-memory integer match (see §7 for the durability discussion).
- **Deletion blocked when items use it:** confirmed yes (see above) — this is the one deletion guard implemented in the whole Category/Location/Item trio.
- **Division meaning:** **NOT PRESENT IN PWA.** No `div` field on `invCats`; category names are freely mixed division-wise in the seed data (e.g. "Solar Components" exists as its own category, but nothing prevents assigning a Solar-only category to an item used on an HVAC project — there is no such check anywhere).
- **Name uniqueness:** **NOT PRESENT IN PWA** (see duplicate behavior above).

---

## 5. Location (`invLocs`)

- **Creation:** `mLoc()` / `saveLoc(id)` (lines 3275–3285) — identical shape to Category: single `name` field, next-`id` from `DB.seq.invLoc`, `co: U.co`.
- **Editing:** rename-only, same pattern as Category.
- **Deletion:** `delLoc(id)` (line 3286) — **blocked** if any item currently has non-zero stock at that location (`((i.stock||{})[String(id)]||0)>0` for any item) — "Move the stock out of this location first"; otherwise `confirm()` then removed.
- **Duplicate behavior:** **NOT PRESENT IN PWA** — no uniqueness check, same as Category.
- **Company scoping:** identical pattern to Category (`co: U.co`, `invLocs()` filters by `co`, `locName()` looks up by `id` alone across the whole array without a `co` check).
- **Stock interaction:** Locations are **stock-affecting**, not lookup-only — every `invItems.stock` key is a location id, `moveStock(item, locId, delta)` is the sole mutator of per-location quantity, and `totQty()` sums across all location keys present on the item. A location is meaningful only insofar as it appears as a key in one or more items' `stock` maps.
- **Multi-location stock per item:** confirmed — `stock` is a map keyed by every location the item has ever held quantity at (seed data shows items split across 2–3 locations, e.g. item 1 `stock:{1:450,2:80,3:0}`).
- **Deletion-with-existing-stock behavior:** blocked (see above) — the only place this is enforced is the explicit `delLoc()` guard; nothing else in the app (e.g. `moveStock`) prevents a location's stock key from independently going to 0 without deleting the location itself.
- **Division meaning:** **NOT PRESENT IN PWA.** No `div` field. Locations are purely operational (e.g. "Main Godown - Undri", "Site Store - Kharadi", "Service Van 1") with zero relationship to `HVAC`/`Solar`/`MEP` divisions.
- **Searchable/exported status:** Locations are not independently searchable as their own list (no `hit()` filter over `invLocs` anywhere) but their `name` appears as dynamic **columns** in `vStock()`/`dlStock()` (one column per location) and as `from`/`to` display values in transaction/report tables.

---

## 6. Item (`invItems`)

**Fields verified:** `id, co, code, name, cat, unit, ret, min, rate, stock` — plus the dormant legacy fallback field `qty`. No other field exists (confirmed by reading `mItem()`'s complete input set and `saveItem()`'s complete `d` object at line 3020 — nothing else is ever assigned to a newly created item).

- **`stock` structure — verified exact shape:** `it.stock[String(locationId)] = quantity` (Number). Confirmed in `moveStock()` (line 2897: `var k=String(locId); it.stock[k]=(Number(it.stock[k])||0)+delta`) and in every stock-table render, which reads `(i.stock||{})[String(l.id)]||0`. Keys are always coerced to `String`, values are always `Number`.
- **`moveStock(it, locId, delta)`** (line 2897): the single low-level stock mutator used by every stock-affecting action (`saveAdjust`, `saveIssue`, `saveInvReturn`, `saveTransfer`). It **clamps to zero**: `if(it.stock[k]<0)it.stock[k]=0` — negative stock at a location is never persisted, no matter what delta is applied (see §25 quirk).
- **`stockState(it)`** (line 2885): `t = totQty(it)`. If `t<=0` → `{txt:"Out of Stock", cls:"b-red", lvl:2}`. Else if `it.min && t<=it.min` → `{txt:"Low Stock", cls:"b-amb", lvl:1}`. Else → `{txt:"In Stock", cls:"b-grn", lvl:0}`. Note: with `min` falsy/unset (`0` or `""`), the low-stock branch is unreachable (`it.min &&` short-circuits) — such items can only ever be "Out of Stock" or "In Stock", never "Low Stock".
- **`totQty(it)`** (line 2881): sums every numeric value across `it.stock`'s keys (`n` counts the keys present). If **no keys exist at all** (`n===0`, e.g. a never-stocked item with `stock:{}`), it falls back to `Number(it.qty)||0` — a vestigial pre-multi-location `qty` field that no live UI path ever writes; in practice this fallback always evaluates to `0` for any item created through `saveItem()` today.
- **`stockValue(it)`** (line 2891): `totQty(it) * (Number(it.rate)||0)`. Straight quantity × unit rate; no separate valuation method (no FIFO/weighted-average — `rate` is a single flat field per item, not per-batch).
- **`lowStockItems()`** (line 2903): `invItems().filter(i => stockState(i).lvl > 0)` — i.e. both "Low Stock" and "Out of Stock" items combine into this one list; the dashboard KPI (§14) subtracts to show them separately.
- **Opening stock:** entered only at item-creation time via `mItem()`'s per-location inputs (`it_s{locId}`), applied in `saveItem()` by building a `st` object from those inputs (only non-zero entries are stored) and, for each non-zero location, calling `invLog("Opening Stock", it.id, st[k], "", Number(k), "", "opening balance")`. **Opening Stock can only be recorded once, at creation** — there is no "add opening stock" action for an existing item; any later addition uses `mAdjust()` with type `"Purchase In"`, `"Opening Stock"` (re-usable, see §8), `"Damage / Write-off"`, or `"Adjustment"`.
- **Purchase-in / manual adjustment / damage-write-off:** all three route through `mAdjust(id)` / `saveAdjust(id)` (lines 3061–3078) — one shared modal, transaction-type chosen from a dropdown (`Purchase In`, `Opening Stock`, `Damage / Write-off`, `Adjustment`), a single signed quantity field (`+` in, `-` out), a location, reference, and remark. `saveAdjust()`: if `q<0` and would make that location negative, blocks with a toast; otherwise `moveStock(i, loc, q)` then `invLog(ty, i.id, Math.abs(q), q<0?loc:"", q>0?loc:"", ref, remark)` — note the **absolute value** is what's logged as `qty`, with the `from`/`to` fields (not the sign) carrying the direction.
- **Transfers, issue, return, consumption:** covered in §8/§9/§10/§11/§12 (all ultimately call `moveStock()` except "Consumed", which never touches item stock — see §11).
- **Item deletion (`delItem`, line 3032):** removes the item row from `DB.invItems` after `confirm()`. **No block for outstanding issues or transaction history** — the confirmation text itself says "Transaction history is kept," and indeed `invTxns`/`invIssues` rows referencing the deleted item's id are left in place; every downstream `itemById(x.item)` lookup on them then resolves to `undefined`, and every render defensively falls back to `it.name||""` (blank name shown, no crash) — see §25 quirk.

---

## 7. Stock model

**Item identity — `id` vs. `code`:**
- `id` is the internal, PWA-generated sequence number (`DB.seq.invItem`), never shown as a primary label to the user except implicitly as the URL/nav parameter (`nav('invitem', id)`).
- `code` is a **free-text, user-entered, optional** field (`it_c` input in `mItem()`). It is **not** validated for uniqueness anywhere (`saveItem()` performs no duplicate-`code` check), **not** required (`saveItem()`'s only validation is on `name`), and **not** auto-generated. The seed data even demonstrates the same code (`"CU-14"`) reused across two different companies for two different items (id 1, co 1 and id 18, co 2) — proving the PWA does not even implicitly enforce per-tenant code uniqueness.
- All transactions and issues reference the item by its numeric **`id`** (`invTxns.item`, `invIssues.item`), never by `code`. `code` is purely a *display* label — shown in the stock table, item detail page, and every CSV export — never a lookup key.
- **This is a PWA-functional-identity vs. MongoDB-ObjectId distinction that must be respected, not redesigned:** the PWA's `id` plays the role a durable primary key would play in the new backend (an ObjectId), while `code` remains a free, optional, non-unique display/reference string with no numbering scheme implied by the PWA. Nothing in the PWA source proposes or requires a new auto-numbering scheme for `code`.

**Category→Item relationship:**
- `invItems.cat` stores the numeric `invCats.id` — an in-memory integer, **not** a durable/typed reference distinguishable from any other number; there is no schema enforcing it stays valid.
- **Survival of category deletion:** category deletion is *blocked* whenever any item still references it (§4), so in practice an item's `cat` can never be orphaned through the UI. However, nothing re-validates this invariant elsewhere (e.g. nothing prevents a future bulk-import or console edit from creating an orphan), and the display path (`catName(id)`) defensively returns `"—"` for any unmatched id rather than crashing.
- **Live-resolved, not copied:** `catName()` is called fresh on every render — category names are never snapshotted onto the item or onto any transaction/issue row. Renaming a category instantly changes what every item, report, and history row displays for that category, with zero data migration needed (and zero record of what the name used to be).

**Stock calculation model — exact:**
- **Total stock per item** = sum of every location key's quantity in `it.stock` (`totQty()`), i.e. **sum across all locations**, not per-location alone.
- **Issued/with-staff quantity** (`issuedQty(it)`, line 2882) = sum of `issBal(x)` (§9 formula) over every `invIssues` row for that item — entirely derived from `InventoryIssue`, **not** stored as a stock-location entry; material with staff is *not* part of `totQty()`/warehouse stock once issued (issuing decrements warehouse stock immediately — see §9).
- **Stock value** = `totQty(it) * rate` (flat, no per-batch costing).
- **Minimum level** = `it.min`, a single scalar per item (not per-location).
- **Low-stock condition** = `min` is truthy AND `totQty(it) <= min`. **Out-of-stock condition** = `totQty(it) <= 0` (checked first, takes priority over low-stock).

---

## 8. Transaction ledger

**Exact shape** (confirmed at `invLog()`, line 2893, and independently at the seed data, lines 399–406):
```
{ id, co, date, type, item, qty, from, to, by, ref, remark }
```
- `id` — `DB.seq.invTxn` sequence.
- `co` — `U.co` of the actor at write time.
- `date` — always `today()`; **never** backdated, never editable — there is no date input for any transaction-creating action except the *Issue* form's own `date` field, which is stored on `invIssues.date`, **not** propagated into the corresponding `invLog()` call's `date` (the Issue transaction row's `date` is always "today", even if the issue's own `date` field was set to a different day). This is a real, source-confirmed discrepancy: `saveIssue()` stores `gv("is_d")||today()` on the issue but calls `invLog("Issue", ..., gv("is_s")+" / "+siteTxt, gv("is_r"))` with no date argument at all, so `invLog()`'s own `date:today()` default is what lands on the transaction row.
- `type` — string, one of the types enumerated below.
- `item` — `invItems.id`.
- `qty` — always the **absolute** quantity moved (never negative); direction is carried by which of `from`/`to` is populated, and by `type`.
- `from` / `to` — `invLocs.id` or `""`. Not always both populated — see per-type table below.
- `by` — `U.name` of whoever is logged in and performing the action (the current session's actor, which for Issue/Return/etc. performed by an inventory manager is the manager's name, not the staff member's — the staff member's name lives in `ref` for Issue, or elsewhere).
- `ref` — free text, meaning varies per call site (see table).
- `remark` — free text.

**Every `invLog()` call site found (exhaustive search of the whole file):**

| Type string | Call site | Trigger | `from` | `to` | `qty` meaning | `ref` | `remark` |
|---|---|---|---|---|---|---|---|
| `"Opening Stock"` | `saveItem()` (new item) | Item created with non-zero opening qty at one or more locations | `""` | that location | qty entered | `""` | `"opening balance"` |
| `"Purchase In"` / `"Opening Stock"` / `"Damage / Write-off"` / `"Adjustment"` | `saveAdjust()` | Add/Adjust Stock modal, one of the 4 dropdown choices (yes — `"Opening Stock"` is also selectable here again for an *existing* item, not just at creation) | `loc` if `q<0`, else `""` | `loc` if `q>0`, else `""` | `Math.abs(q)` | free-text PO/bill no. entered by user | free-text remark entered by user |
| `"Issue"` | `saveIssue()` | Material issued to staff | issuing location (`loc`) | `""` | qty issued | `staff + " / " + siteTxt` | remark from issue form |
| `"Return"` | `saveInvReturn()` (good condition) | Material received back, condition = Good | `""` | return-into location | qty returned | `x.staff` | return-modal remark, or `"DAMAGED — not added to stock. " + remark` when damaged (see next row) |
| `"Return"` **and** `"Damage / Write-off"` (both logged) | `saveInvReturn()` (Damaged condition) | Damaged item returned by staff | `""` (Return row) / `""` (Damage row) | `""` (both — stock is NOT credited; see §10) | qty returned (both rows use the same qty) | `x.staff` (both) | Return row remark prefixed `"DAMAGED — not added to stock. "`; Damage row remark `"damaged material returned"` |
| `"Consumed"` | `saveInvReturn()` (via "mark remaining balance as used" checkbox), `saveMarkUsed()`, `markConsumed()` | Balance marked used on site (never returns to stock) | `""` | `""` | qty marked used | `staff + " / " + site` | `"balance marked used on site"` or user-entered remark or `"used on site"` |
| `"Transfer"` | `saveTransfer()` | Stock moved location→location | source location | destination location | qty transferred | free-text reference entered by user | free-text remark entered by user |

**No other `invLog()` call sites exist** — this is the complete, exhaustive list of transaction types the live PWA can produce: **Opening Stock, Purchase In, Damage / Write-off, Adjustment, Issue, Return, Consumed, Transfer**. (Eight distinct type strings, though "Opening Stock" and "Damage / Write-off" each have two distinct trigger paths as shown above.)

**Editability/deletability:** confirmed **none** — no function anywhere mutates an existing `invTxns` row, and no function removes one. `invTxns` is a strictly append-only ledger, matching the annotation already present in the new-app `InventoryTransaction.js` model.

---

## 9. Issue lifecycle

**Complete `invIssues` shape** — verified field-by-field against `saveIssue()` (creation, line 3130) and every subsequent mutator: `id, co, item, qty, staff, site, projId, loc, date, ret, rqty, status, by, remark`, plus the return-request fields `retReq, retReqQty, retReqDate, retReqNote` (added only once a request is made) and `used` (added only once anything is marked used/returned-with-balance-closed). This matches the candidate shape given in the task exactly, with no additional fields found.

**Who may issue:** UI-gated to `canStock()` roles (`inventory`, `admin`) via the `+ Issue Material` button in `vIssue()`/`invDash()`/`vStock()`; the underlying `mIssue()`/`saveIssue()` functions themselves perform **no** role check (see §18 for the UI-vs-enforcement distinction).

**Item/location/recipient/site selection:**
- Item: dropdown of `invItems().filter(i => totQty(i) > 0)` — only items with stock somewhere are offered; if none, `mIssue()` short-circuits with a toast and never opens the modal.
- From-location: dropdown of all `invLocs()` (no filtering to "locations where this item has stock" — a location with 0 stock for the chosen item can be selected and will simply fail validation at save time).
- Staff: `staffList()` (line 3081) = every user in the company (`mine(DB.users)`) **except role `admin`** — i.e. any of `sales, hvac_pm, solar_pm, mep_pm, engineer, inventory, service_mgr, service_eng, finance` can be selected as an issue recipient, by name only (no id captured, no role captured).
- Site: `siteList()` (line 3082) = every project not `"In Service"` status (`{t:name, id:projectId}`) **plus** every non-Completed service call (`{t:"Service - "+site+" (PSC-"+psc+")", id:0}` — service-call sites are **never** given a real id, always `0`) **plus** a static `"Office / Godown"` entry (also `id:0`). The dropdown's *displayed text* is stored verbatim onto `invIssues.site`; the *value* (`id`) is stored onto `invIssues.projId`.

**Quantity/stock validation:** `saveIssue()` checks `q>0` and `q <= (it.stock[String(loc)]||0)` (available at the *chosen location specifically*, not total item stock) — blocks with a toast naming the shortfall otherwise.

**Returnable-flag behavior:** `ret: !!it.ret` is a **snapshot copied from the item at issue time** — see §25; a later edit to the item's `ret` flag does not retroactively change already-issued rows.

**Issuer identity:** `by: U.name` — the person performing the Issue action (typically `inventory`/`admin`), distinct from `staff` (the recipient).

**Project/service-call relationship:** `projId` is written (real project id, or `0` for a service call or "Office/Godown"). See §21 — this is a write-only field, never functionally read back by any Project code.

**Notification:** two possible notifications on save (line 3132, 3134) — see §17 for exact text.

**Ledger entry:** one `"Issue"` transaction logged (§8).

**Stock decrease:** `moveStock(it, loc, -q)` — immediate, at save time.

---

## 10. Return lifecycle

**Balance formula (verified exact, and independently re-executed in Node — see §2):**
```
issBal(x) = Math.max(0, (Number(x.qty)||0) - (Number(x.rqty)||0) - (Number(x.used)||0))
```
Clamped to never go negative — over-returning or over-using beyond `qty` is prevented at the UI-input level (both `saveInvReturn()` and `saveMarkUsed()` reject a quantity greater than the current balance with a toast), so in practice this floor is a defensive backstop, not something reachable through the normal flows.

**Status derivation — `issStatus(x)` (verified exact, line 2910, and independently executed in Node):**
```js
if (issBal(x) <= 0)
  return (Number(x.rqty)||0) > 0
    ? (Number(x.used)||0 > 0 ? "Returned / Used" : "Returned")
    : "Consumed";
if ((Number(x.rqty)||0) > 0) return "Partially Returned";
if (x.retReq) return "Return Requested";
return "Issued";
```
**Reachable outcomes, independently verified by direct execution** (not by manual precedence reasoning alone):
- `qty:10, rqty:10, used:0` → **`"Returned"`** — reachable.
- `qty:10, rqty:5, used:5` (balance 0) → `"Returned / Used"`.
- `qty:10, rqty:0, used:10` → `"Consumed"`.
- `rqty>0` but balance still `>0` → `"Partially Returned"`.
- `retReq===true`, balance `>0`, `rqty===0` → `"Return Requested"`.
- Otherwise → `"Issued"`.

This directly contradicts the "unreachable" characterization recorded for this expression in `new-app/docs/OPEN_DECISIONS.md` item #16 (which was read for comparison only, per this task's ground rules, and is **not** modified by this audit). That document's own precedence derivation (`Number(x.used) || (0 > 0)` = `Number(x.used) || false`) is algebraically identical to what this audit derived — the disagreement is in the conclusion drawn from it, not the parse: a falsy left side (`used === 0`) makes the whole expression `false`, which selects the **`else`** branch of the ternary, i.e. **`"Returned"`**, not the reverse. This audit's conclusion (`"Returned"` is reachable whenever an issue is fully balanced with nothing marked used) was checked by literally running the extracted expression, not just by re-reading it, specifically because the existing document's claim needed independent re-verification per this task's instructions. **This is flagged here as a factual finding for the eventual decision-lock/documentation-correction pass; this audit does not edit `OPEN_DECISIONS.md` or `InventoryIssue.js`, per the read-only/single-file constraint.**

**Status field persistence vs. derivation:** `status` is a **persisted** field but is unconditionally overwritten by a fresh `issStatus(x)` call at the end of every single mutating function (`saveIssue`, `saveInvReturn`, `saveMarkUsed`, `markConsumed`) — so in practice the stored value and the derived value are always identical at rest; nothing ever reads the stale `status` before it's recomputed.

**Partially-returned + partially-used interaction:** both `rqty` and `used` are independent cumulative counters against the same `qty`; any mix is allowed as long as `rqty+used <= qty` (enforced by the balance-based input caps in each save function, not by a joint validation).

**Return requests do NOT move stock or write a transaction** — confirmed: `saveReturnReq()` (line 3410) only sets `x.retReq=true, x.retReqQty, x.retReqDate, x.retReqNote`, calls `notify()`, and saves — **no** `moveStock()` call, **no** `invLog()` call. A request is purely a staff-side signal to the inventory manager; the actual stock movement only happens when `saveInvReturn()` is later run by the manager.

### Staff return request — `mReturnReq()` / `saveReturnReq()`
- **Who requests:** any staff member viewing their own "My Material" page (any role with an `invIssues` row where `staff === U.name` and balance `> 0`) — no role restriction inside the function itself.
- **Quantity rules:** `1 <= q <= issBal(x)`; partial or full both allowed.
- **Note:** free-text, optional.
- **State set:** `retReq=true, retReqQty=q, retReqDate=today(), retReqNote`.
- **Notification:** to `["inventory","admin"]` (see §17 for exact text).
- **Stock/transaction behavior:** confirmed **none** — request ≠ movement (see above).

### Inventory-manager return — `mInvReturn()` / `saveInvReturn()`
- **Who accepts:** UI-gated to `canStock()` (button only rendered for `inventory`/`admin`); function itself has no internal role check.
- **Quantity rules:** `1 <= q <= issBal(x)`. The modal pre-fills a "suggested" quantity = `min(retReqQty, balance)` if a request exists, else the full balance; the "Return Type" dropdown (`full`/`part`) is a UI convenience only (`rtTypeChg()` just auto-fills the quantity field) — the actual save always uses whatever is in the quantity input, not a stored flag.
- **Full/partial:** both supported via the same function; `rqty` accumulates by `+q` each time (so a balance can be returned across multiple partial-return actions).
- **Return location:** a dropdown of `invLocs()`, defaulting to the original issue location (`x.loc`) but freely changeable — an item can be returned into a *different* location than it was issued from.
- **Condition/damage handling:** a `Condition` dropdown, `"Good — back to stock"` or `"Damaged — write off"`. Damaged: stock is **not** credited (`moveStock` is skipped), but `rqty` is still incremented by the full amount (so the balance clears / the item is no longer "with staff" from a balance-tracking point of view) and a `"Damage / Write-off"` transaction is separately logged. This is the PWA's entire model for write-offs — there is **no** separate scrap-stock entity, no `scrapQty` field, nothing beyond this one condition toggle plus the transaction log. (Confirms the task's directive not to invent a separate scrap-stock system — none exists to preserve or extend.)
- **Stock movement:** `moveStock(it, loc, q)` only when not damaged.
- **`rqty` update:** `x.rqty = (Number(x.rqty)||0) + q` always (damaged or not).
- **Status:** recomputed via `issStatus(x)`.
- **Transaction(s):** `"Return"` always; `"Damage / Write-off"` additionally when damaged (see §8 table).
- **Notification:** to `["*"]` (all roles) — see §17.
- **Return-request clearing:** `x.retReq=false; x.retReqQty=0;` unconditionally on every accepted return (whether or not the return was actually triggered by a pending request) — so a manager can record an ad-hoc return and it will silently clear any unrelated pending request state on that same issue row.
- **"Mark remaining balance as used" checkbox:** if checked and a balance still remains after the return quantity is applied, that remaining balance is added to `x.used` and a `"Consumed"` transaction is logged in the same save — a return and a "mark used" can happen in one action.

### Return-request rejection — `rejectReturn(id)`
- **Who may reject:** UI-gated to `canStock()` (button next to "Receive" in `vReturns()`); function has no internal role check.
- **Fields reset:** `retReq=false, retReqQty=0, retReqNote=""` (note: `retReqDate` is **not** cleared — a minor, harmless quirk, since the date is never displayed once `retReq` is false).
- **Notification:** to `["*"]` — see §17 for exact text.
- **Stock changes:** none.
- **Transaction:** none created.
- **Returned-quantity (`rqty`) changes:** none — a rejection does not touch `rqty`/`used`; the material remains fully "with staff" at its prior balance, simply no longer flagged as request-pending.

---

## 11. Used-on-site lifecycle

Two entry points reach the same effect: `mMarkUsed()`/`saveMarkUsed()` (a dedicated modal, reachable from `vIssue()`, `vReturns()`, and the item detail's issue table) and `markConsumed(id)` (a one-shot helper with no modal, found in source but with **no visible call site anywhere in the UI** — i.e. it exists in the code but is not wired to any button; functionally equivalent to `saveMarkUsed()` for the full balance).

- **Who can perform:** UI-gated to `canStock()` for the buttons in `vIssue()`/`vReturns()`; the modal itself performs no role check.
- **Quantity validation:** `saveMarkUsed()` requires `1 <= q <= issBal(x)`.
- **Partial usage:** supported — any amount up to the balance.
- **Remaining balance:** whatever is left after subtracting `q` from balance continues to show as pending (still returnable or usable again later).
- **`used` field update:** `x.used = (Number(x.used)||0) + q` (cumulative, mirrors `rqty`'s accumulation pattern).
- **Status update:** `x.status = issStatus(x)`.
- **Transaction type:** `"Consumed"` — logged with `ref: staff+" / "+site`, `remark` = user-entered or default `"used on site"`.
- **Stock behavior — verified, does NOT double-decrease warehouse stock:** confirmed by reading `saveMarkUsed()` line-by-line — it never calls `moveStock()`. The only stock decrement for this material happened once, at `saveIssue()` time; marking it "used" merely closes out the staff-side balance bookkeeping (`used`/`status`) and records an audit-trail transaction. This matches the task's expected finding exactly.
- **Notification:** confirmed **none** — neither `saveMarkUsed()` nor `markConsumed()` calls `notify()` anywhere. This is a real gap relative to every other inventory action (Issue, Return, Return-Request, Reject all notify; Mark-Used does not).
- **Remarks:** optional free text, stored only in the transaction's `remark`, not on the `invIssues` row itself.

---

## 12. Transfer

Single function pair, `mTransfer()`/`saveTransfer()` (lines 3219–3239), plus the read-only `vTransfer()` screen.

- **Who can transfer:** UI-gated — the `+ New Transfer` button only renders for `canStock()`; the function itself performs no role check. `mTransfer()` additionally self-guards: if fewer than 2 locations exist company-wide, it toasts "Add at least two locations first" and never opens.
- **Source/target location:** two independent `invLocs()` dropdowns (`tr_f`, `tr_t`); the "To" dropdown defaults to the *second* location in the list (`ix===1`), not "not-the-from-location" — it's simply a fixed index default, not smart.
- **Item:** dropdown of `invItems().filter(i => totQty(i)>0)` (any item with stock *somewhere*, not specifically at the chosen From location — that's checked at save time).
- **Quantity validation:** `saveTransfer()` requires an item and a truthy `q`; checks `q <= (it.stock[String(f)]||0)` (available at the *From* location specifically) and blocks with a toast if insufficient.
- **Same-location-transfer behavior:** explicitly blocked — `if(f===t){toast("From and To locations must be different");return}`. This is the one deliberate guard against a no-op transfer.
- **Transaction created:** one `"Transfer"` row, `from`/`to` both populated, `qty` = amount moved, `ref`/`remark` free text from the form.
- **Actor:** `by: U.name` implicitly via `invLog()`.
- **Notification:** confirmed **none** — `saveTransfer()` never calls `notify()`.
- **Atomicity:** both `moveStock(it,f,-q)` and `moveStock(it,t,q)` are called back-to-back synchronously in the same function before `save()` — there is no intermediate state visible to the rest of the (single-threaded, no-backend) app; this is "atomic" only in the trivial sense of running as one synchronous JS call, not via any transaction/lock mechanism (there is none in the PWA's in-memory model).
- **Negative-stock behavior:** the From-location decrement is clamped to zero by `moveStock()`'s own floor (§6), same as every other stock movement — though the pre-check against `avail` should normally prevent this from ever being hit for a legitimate transfer.

---

## 13. Low/out-of-stock

Already derived precisely in §6 (`stockState()`), repeated here for completeness:
- **Out of Stock:** `totQty(it) <= 0` (checked first — takes priority even if `min` is also breached).
- **Low Stock:** `it.min` is truthy AND `totQty(it) <= it.min` (and not already `<=0`).
- **In Stock:** neither condition met.
- **Surfaced at:** stock table row shading/badge (`vStock`), item detail badge (`vInvItem`), inventory dashboard's "Low / Out of Stock" panel and its shortfall column (`Math.max(0, min-totQty)`), the admin general dashboard's mirrored low-stock panel (`vDash()` line 1469–1476), the Stock Report CSV (`dlStock`), and the one-time notification fired at Issue time (§17) — **not** re-evaluated/re-notified on Adjustment, Transfer, or Return, even though those actions can also push a level below minimum (see §25).

---

## 14. Dashboard

`invDash()` (line 2919), shown to role `inventory` as its home `dash` view (and role `admin`'s general dashboard additionally shows a subset, `vDash()` lines 1469–1477).

**KPI cards, exact formulas:**
| KPI | Formula |
|---|---|
| Total Items | `invItems().length` |
| Categories | `invCats().length` |
| Stock Value | `sum(stockValue(item))` over all items |
| Low Stock | `lowStockItems().length - out.length` (i.e. Low-but-not-Out count; note this is a *subtraction* of the combined low∪out list, not a separately filtered "exactly Low" count — functionally equivalent since Out is a strict subset of the `lvl>0` set, but implemented as a subtraction, not a distinct predicate) |
| Out of Stock | `items.filter(totQty(i)<=0).length` |
| Material With Staff | `returnableNow().length` — count of **issue rows** (not items, not quantity) where balance `>0` and status ≠ `"Returned"` |
| Return Requests | `reqReturns().length` — count of issue rows with `retReq===true && balance>0` |

**Panels (conditionally rendered only when non-empty, in this order):**
1. **Return Requests from Staff** (only if any) — table of pending requests with a one-click "Receive" button straight into `mInvReturn(x.id)`.
2. **Quick Actions** — always shown, buttons to Add Item / Issue / Returns / Transfer / Categories / Transactions.
3. **Low / Out of Stock** (only if any) — full item table with a "Report" download button (`dlStock()`), row-shaded red for Out-of-Stock rows specifically.
4. **Returnable Material With Staff** (only if any `pendingReturns()`, defined as `x.ret && issBal(x)>0 && status!=="Returned"` — i.e. only *returnable-type* issues, unlike the KPI above which is `returnableNow()` = balance>0 regardless of `ret`) — table with Days-Out coloring (`>30` days shaded red) and a "Receive Back" button gated by `canStock()`.
5. **Category-wise Inventory** (`catSummary()`, always last) — per-category rollup table (items count, total qty, stock value, low/out count, returnable-items count) with a clickable row that pre-fills the global search box with the category name and navigates to Stock.

**Search/filter behavior:** the dashboard itself has no search bar; search only applies within the individual list screens (`vStock`, `vIssue`, `vReturns`, `vInvHistory`, `vMyMaterial`), each via the shared `hit()`/`srchBar()` substring-match helpers against a per-screen field allowlist (documented per-screen above).

---

## 15. My Material

`vMyMaterial()` (line 3307), the sole `dash`-adjacent Inventory view for `engineer` and `service_eng` roles (both have only `["dash","mymaterial"]` in their `MENUS` entry).

- **Who sees it:** any logged-in user, via `myIssues()` = `invIssues().filter(x => x.staff === U.name)` — matched purely by **name string**, not by user id (see §25 quirk: if two users share a display name, or a user's name changes, the match breaks).
- **Filtering:** no role gate inside the function itself — any role could reach it if navigated to directly (menu-only restriction, as with everything else — §18).
- **Search:** `hit()` over `site, date, status, remark` plus item `name`/`code`.
- **Records shown:** two sections — (a) "Material still with you" (only rows with `issBal(x)>0`, always shown regardless of search filter, with Days-With-You coloring), and (b) the full "Material Issued To Me" table (search-filtered), showing item, code, type (Returnable/Consumable badge), qty, site, returned qty, balance, status, and an action column.
- **Balances:** `issBal(x)` per row, as everywhere else.
- **Return-request button:** rendered per pending row as `"Return to store"` (or `"Update request"` if one is already pending) → opens `mReturnReq(x.id)`.
- **Used-on-site button:** **NOT PRESENT on this screen** — confirmed by reading `vMyMaterial()` fully: only the return-request action is offered to staff; "Mark Used" is exclusively an inventory-manager action (`canStock()`-gated, on `vIssue()`/`vReturns()`/item-detail), never self-service.
- **Status labels:** `issStatus(x)` badges via `issCls()`.
- **Report/export:** `dlMyMaterial()` — CSV of the logged-in user's own issues only (`myIssues()`), columns: Date, Item Code, Item, Type, Qty, Unit, Site/Project, Returned, Used, Balance, Status, Return Requested, Issued By, Remark. Filename includes the sanitized user name.

---

## 16. Reports/export

Every Inventory report function found (exhaustive):

| Function | Title | Source | Filters applied | Notable columns/derived values |
|---|---|---|---|---|
| `dlStock()` | Stock Report | `invItems()` | current search-box text (via `hit()` on code/name/unit/category/status/returnable-label) | one column per location, Total Stock, With Staff (`issuedQty`), Min Level, Status, Stock Value; grand-total stock-value row |
| `dlIssued()` | Issued Material Report | `invIssues()` (all, unfiltered by search) | none | Returned/Used/Balance/Status/Return-Requested columns, Days Out; a trailing "PENDING RETURNS" count line |
| `dlTxns()` | Inventory Transaction Report | `invTxns()` | current search-box text (via `hit()` on date/type/qty/ref/by/remark/item name/code/from/to location names) | straight ledger dump, no totals |
| `dlMyMaterial()` | My Material Report — `<name>` | `myIssues()` | none (always the full personal list) | same columns as Issued report, scoped to one staff member |
| `dlReturns()` | Material Return Report | `invIssues()` (all) | none | full issue+return+used+balance+status+days-out+return-request columns, grand totals row, **plus** a second section appending all `"Return"`-typed `invTxns` rows (date/item/qty/returned-by/into-location/remark/received-by) |

All reports share `rptHead(title)` (line 3483) — a standard header block: `[TITLE — companyName]`, `[Generated, date by user (Role)]`, and, only if a search filter is currently active, `[Filter, "search: <text>"]`. All export via `dlCSV()` to a `.csv` file named with the report type and today's date (or the user's name for My Material).

**Date behavior:** reports have no date-range picker of their own — they either dump the full unfiltered collection (`dlIssued`, `dlTxns`'s underlying rows before search, `dlMyMaterial`, `dlReturns`) or respect whatever the global search box currently contains (`dlStock`, `dlTxns`).

**Actor:** any user who can reach the screen with the download button — gated only by which menu item exposes it (`dlStock`/`dlIssued` on Stock, gated to all roles that can see Stock — including `hvac_pm`/`solar_pm`/`mep_pm`/`service_mgr`, not just `inventory`/`admin`; `dlTxns` only reachable via `invhistory`, which is only in `admin`/`inventory` menus; `dlMyMaterial` on My Material, reachable by `engineer`/`service_eng`; `dlReturns` on Material Returns, reachable by `admin`/`inventory`).

**Ordering:** transaction and issue reports iterate the underlying array in **insertion order** (oldest-first) — none of the CSV exports reverse the order the way the on-screen tables do (`vIssue()`, `vInvHistory()`, `vReturns()` all `.slice().reverse()` for newest-first *display*, but the corresponding `dl*()` functions iterate `invIssues()`/`invTxns()` directly without reversing).

### Inventory Returns screen — `vReturns()` (line 3330)
- **Records shown:** three groupings — (1) pending return requests (`reqReturns()`) with Receive/Reject actions; (2) all currently-outstanding balances (`returnableNow()` filtered by search) with Return/Mark-Used actions, row-tinted purple if a request is pending or red if >30 days out; (3) a "Return History" table (`invTxns` filtered to `type==="Return"`, newest-first).
- **Pending-return criteria:** `issBal(x) > 0 && status !== "Returned"`.
- **Request criteria:** `retReq===true && issBal(x)>0`.
- **Completed-return behavior:** once `issBal(x)` reaches 0, a row disappears from both the pending list and the requests list (naturally, by the same filter predicates), but its `"Return"` transaction(s) remain permanently visible in Return History.
- **Rejection behavior:** rejected requests simply drop out of the requests panel (no distinct "rejected" list/history is kept anywhere — see §25, a rejected request leaves no persistent trace beyond the one-time notification text).
- **Inventory-manager controls:** Receive / Reject buttons, `canStock()`-gated.
- **Search:** over the pending list only (staff/site/date/remark/by/item name/code); Return History is unfiltered.
- **Ordering:** pending list in natural array order (not reversed); Return History newest-first (`.reverse()`).

### Transaction history — `vInvHistory()` (line 3293)
- **Transactions shown:** all `invTxns()` for the company, search-filtered.
- **Ordering:** newest-first (`.slice().reverse()`).
- **Filters/search:** date/type/qty/ref/by/remark plus item name/code and from/to location names.
- **Fields shown:** Date, Type (badge), Item (name+code), Qty, From, To, Reference, By, Remark.
- **Edit/delete capability:** confirmed **none** — purely a read table with a Report download button.
- **Export:** `dlTxns()` (above).
- **Tenant scope:** via `invTxns()`'s `co` filter (§19).

### Stock item detail — `vInvItem()` (line 3037)
Shown for a single item (`PARAM` = item id). Sections, in order:
1. Header: name, code badge, returnable/consumable badge, stock-state badge; Edit/Issue/Adjust buttons if `canStock()`.
2. Summary grid: Category, Unit, Rate, Total Stock, Minimum Level, Stock Value.
3. **Stock by Location** table — every company location's row, quantity at that location (0 if none), total row.
4. **Issued / Allocated** table — every `invIssues` row for this item (newest-first), with Date/Staff/Site/Qty/Returned/Used/Balance/Status, and (if `canStock()`) a per-row "Return" button when balance `>0`.
5. **Transaction History** table — every `invTxns` row for this item (newest-first), with Date/Type/Qty/From/To/Reference/By.
- **Role-based visibility:** the Edit/Issue/Adjust action buttons and the per-row Return button are `canStock()`-gated; the rest of the page (all four sections' data) is visible to anyone who can navigate to `invitem` (menu-gated to whoever's role menu includes `stock`, i.e. `admin, inventory, hvac_pm, solar_pm, service_mgr` — see §18).

---

## 17. Notifications

Exhaustive list of every `notify()` call inside the Inventory module (5 call sites; verbatim text quoted, variables noted):

1. **Material issued** (`saveIssue()`, line 3132) — recipients `["*"]` (all roles):
   > `Material issued to `+gv("is_s")+`: `+q+` `+it.unit+` `+it.name+` for `+siteTxt+(it.ret?" (returnable)":"")
   Fires **every time** an issue is saved — no de-duplication, repeats identically for repeated issues of the same item to the same staff member.

2. **Low/Out-of-stock warning** (`saveIssue()`, line 3134, conditional on `stockState(it).lvl>0` **after** the issue's decrement) — recipients `["inventory","admin"]`:
   > `⚠ `+st.txt+`: `+it.name+` — `+totQty(it)+` `+it.unit+` left (min `+(it.min||0)+`)`
   (`st.txt` is either `"Low Stock"` or `"Out of Stock"`.) **Fires only from the Issue path** — confirmed no equivalent check exists in `saveAdjust()`, `saveTransfer()`, or `saveInvReturn()`, even though all three can also push an item below its minimum (e.g. a Damage/Write-off adjustment, or transferring stock away from a location). Repeats on every qualifying issue, uncapped.

3. **Material returned** (`saveInvReturn()`, line 3185) — recipients `["*"]`:
   > `Material returned by `+x.staff+`: `+q+` `+it.unit+` `+it.name+(issBal(x)>0?" — "+issBal(x)+" "+it.unit+" still pending":" — issue closed")
   Fires on every accepted return, whether full or partial, whether damaged or not.

4. **Return request rejected** (`rejectReturn()`, line 3397) — recipients `["*"]`:
   > `Return request for `+(itemById(x.item)||{}).name+` from `+x.staff+` was not accepted — please check with the store.`

5. **Return request raised** (`saveReturnReq()`, line 3416) — recipients `["inventory","admin"]`:
   > `📥 Return request: `+U.name+` is returning `+q+` `+(it.unit||"")+` `+it.name+` from `+x.site+(gv("rr_n")?" — "+gv("rr_n"):"")

**Confirmed absent — no notification exists for:** Transfer (any), Damage/Write-off specifically (it rides on the generic "Material returned" text above, which doesn't distinguish damaged from good-condition returns), Mark-Used/Consumed (neither `saveMarkUsed()` nor `markConsumed()` calls `notify()`), and no threshold-crossing-only suppression — every qualifying issue re-fires the low-stock warning even if the item was already below minimum before this issue.

**Duplication-on-repeated-action:** confirmed — nothing in `notify()` itself or any call site checks for an existing unread/identical notification before pushing a new one; every qualifying action creates a brand-new row in `DB.notifs` every time.

---

## 18. Roles/access

`canStock()` (line 2892) = `U.role==="inventory" || U.role==="admin"` — the single boolean gate used throughout the Inventory module to decide whether to *render* mutating buttons/menu links. There is **no second, independent server-side check** in the PWA (it is a single-tier, client-only app) — every "gate" below is a **UI-visibility** decision, not an enforced authorization boundary; the underlying `mXxx()`/`saveXxx()` functions themselves never re-check `U.role`.

| Capability | admin | inventory | engineer | service_eng | hvac_pm | solar_pm | mep_pm | service_mgr | sales | finance | super |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Category management (`invcats` menu item, `mCat`/`delCat`) | ✅ menu+buttons | ✅ menu+buttons | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu | ❌ no menu |
| Location management (same `invcats` screen, `mLoc`/`delLoc`) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Item management (`mItem`/`saveItem`/`delItem`, Add/Edit buttons) | ✅ (`canStock`) | ✅ (`canStock`) | ❌ button hidden (no `stock` menu item at all) | ❌ | ❌ button hidden (`stock` menu present, view-only) | ❌ view-only | ❌ no `stock` menu item | ❌ view-only (`stock` menu present) | ❌ no `stock` menu item | ❌ no `stock` menu item | ❌ (has no Inventory menu items at all) |
| Stock adjustment (`mAdjust`/`saveAdjust`) | ✅ | ✅ | ❌ | ❌ | ❌ (button hidden on item detail — `canStock()`-gated) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Issue material (`mIssue`/`saveIssue`, `invissue` menu) | ✅ (has `invissue` in menu) | ✅ (has `invissue` in menu) | ❌ | ❌ | ❌ no menu item (only `stock` view) | ❌ | ❌ | ❌ no menu item | ❌ | ❌ | ❌ |
| Return material (`mInvReturn`/`saveInvReturn`, `invreturn` menu) | ✅ | ✅ | ❌ (self-service *request* only, via My Material — see below) | ❌ (same) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve/reject return request (`mInvReturn` from request panel, `rejectReturn`) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mark used (`mMarkUsed`/`saveMarkUsed`) | ✅ (buttons on `invissue`/`invreturn`) | ✅ | ❌ (no button anywhere on `mymaterial`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Transfer (`mTransfer`/`saveTransfer`, `invtransfer` menu) | ❌ **no `invtransfer` menu item for admin** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Transaction history (`invhistory` menu) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reports (`dlStock`/`dlIssued` on Stock; `dlTxns` on Transactions; `dlReturns` on Returns; `dlMyMaterial` on My Material) | all four available (has all menu items) | all five available | `dlMyMaterial` only | `dlMyMaterial` only | `dlStock`/`dlIssued` only (has `stock` menu) | same as hvac_pm | ❌ (no `stock` menu item) | `dlStock`/`dlIssued` only | ❌ | ❌ | ❌ |
| Self-service return request (`mReturnReq`, on `mymaterial`) | n/a (no personal issues expected but functionally works if any exist) | n/a | ✅ (only Inventory capability this role has) | ✅ (only Inventory capability this role has) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

**Notable finding — Admin has no Transfer menu item.** `MENUS.admin` (line 1291) lists `stock, invissue, invreturn, invhistory` but **not** `invtransfer` — Admin can view the Stock Transfer *history table* only by navigating there indirectly (there's no menu link), and cannot reach the `+ New Transfer` button through normal navigation, even though `canStock()` (which the button rendering depends on) would allow it if reached. This is a genuine PWA quirk, not a design choice documented anywhere in the code.

**PWA UI visibility vs. server-side enforcement (for the new backend):** the new backend must **enforce** at minimum the *visible intent* shown above (e.g., only `inventory`/`admin` should be able to call issue/return/adjust/transfer endpoints; only `inventory`/`admin` should manage categories/locations) — it must **not** broaden the PWA's implicit access model by, e.g., allowing every role to issue material just because the client-side gate was UI-only. But nothing here should be read as license to *narrow* it either (e.g., inventing new role restrictions the PWA doesn't demonstrate, such as gating My-Material's self-return-request to only `engineer`/`service_eng` — the PWA lets *any* user with a personal issue row use it).

---

## 19. Tenant behavior

Every one of the five collections is filtered by `co` at read time via `invCats()/invLocs()/invItems()/invIssues()/invTxns()` (`x.co === U.co`, lines 2873–2877) and stamped with `co: U.co` at write time in every `save*`/`invLog()` call.

**Direct detail routes — company check gap, confirmed:**
- `itemById(id)` (line 2878): `DB.invItems.filter(x => x.id === Number(id))[0]` — **no `co` check at all.** `vInvItem()` (item detail screen) is reached via `nav('invitem', id)` and calls `itemById(PARAM)` directly — a user could, by manipulating the `nav()` call (e.g. from the browser console, since there's no server round-trip to intercept), view **another company's** item detail page (its category name via `catName()`, its stock-by-location, its full issue and transaction history) as long as they know or guess the numeric `id`. There is no tenant check on this path.
- `catName(id)` / `locName(id)` (lines 2879–2880): also **no `co` check** — same cross-tenant lookup risk, though these are only used to resolve a *display label* for an id already obtained through a tenant-scoped list, so the practical exposure is confined to the `itemById()` gap above.
- `mAdjust(id)`, `mIssue(itemId)`, `mInvReturn(id)`, `mMarkUsed(id)`, `mReturnReq(id)` (and their `save*` counterparts) all resolve their target row via `itemById()` / a raw `.filter(x=>x.id===id)[0]` over `DB.invIssues` with **no `co` check** either — the *listing* screens that normally supply these ids are themselves tenant-filtered, so this is only exploitable via direct/manual invocation, not through ordinary navigation, but it is a real gap in the PWA's own code, not an inference.

**Tenant isolation is the one mandatory infrastructure requirement** carried over from prior audits in this series — the new backend must scope every Inventory read/write server-side by the authenticated user's company, including on every single-record lookup (item detail, issue detail, etc.), closing exactly the gap the PWA itself has. This audit does not otherwise propose "fixing" any other PWA business behavior.

---

## 20. Division behavior

Searched exhaustively for a `div` field or division-based filter anywhere in the Inventory module and its five entity shapes (seed data, `saveCat`, `saveLoc`, `saveItem`, `saveIssue`, `invLog`): **NOT PRESENT IN PWA**, on every axis asked:
- InventoryCategory: no `div` field.
- InventoryLocation: no `div` field; not division-specific in any way — the same physical godown/van serves every division's material.
- InventoryItem: no `div` field; a single "Solar Components" category exists purely as a category *name*, not a system-enforced division tag — nothing stops an HVAC project's issue from drawing an item in that category.
- InventoryIssue: no `div` field; `siteList()` (§9) pulls from *all* the company's non-completed projects and service calls regardless of division, with no division filter applied anywhere.
- InventoryTransaction: no `div` field.
- Reports: none of `dlStock`, `dlIssued`, `dlTxns`, `dlMyMaterial`, `dlReturns` filter or group by division.

Since the PWA contains no division restriction anywhere in Inventory, this audit records nothing further to invent here — any division-based Inventory scoping mentioned in older architecture proposals is, per the task's ground rules, out of scope and not a PWA requirement.

---

## 21. Project relationship

**Re-verified independently, per this task's explicit instruction, rather than assumed from the prior audit series' conclusion.**

- `invIssues.projId` is written exactly once, at issue-creation time (`saveIssue()`, line 3127/3130): `projId = siteSel ? Number(siteSel.value)||0 : 0` — the numeric value of whichever `siteList()` option was chosen (a real `projects.id` if a project was picked; `0` for a service call or "Office/Godown").
- **Grep across the entire file for every use of `projId`** turned up exactly: (a) this one write in `saveIssue()`; (b) three occurrences inside the V2-connection-adapter code (lines 712, 859, 977 — `['projId','project',...]` mapping and `x.projId=localRef(...)`), which is explicitly out-of-scope infrastructure per §1, not PWA business logic. **No Project-side function anywhere reads `invIssues.projId`.**
- Project completion, Project material-balance calculations, the Project dashboard, Project reports (`dlProjects()`), and Project-side returnable-material figures are all built exclusively from **`Project.dc[]`** (the "Delivery Challan" sub-array on the Project document, lines 421–458, 2440–2529) — a completely separate, independently-modeled structure:
  - `dc[]` rows have their own shape (`no, date, item(string), qty, unit, ret, rqty, by, remark`) — `item` here is **free text**, not a reference to `invItems.id`.
  - `dc[]` has its own return-tracking (`mReturn()`/`doReturn()`, lines 2514–2528), its own balance formula (`qty - rqty`, no `used`/consumption concept at all), and its own printable Delivery-Challan document (`printDC()`).
  - `dlProjects()` (line 3498) computes `pr = sum over dc[].filter(ret) of (qty - rqty)` — its "Material Pending Return" column is derived **solely from `Project.dc[]`**, with zero reference to `invIssues` or `invItems`.
- **Conclusion, classified explicitly as instructed:**
  - **PWA fact:** `InventoryIssue.projId` exists as a field and is populated with a real project id when the issue's site is a project.
  - **NOT an actual functional relationship:** nothing in Project code (dashboard, report, completion logic, material-balance logic) ever reads `invIssues` filtered by `projId`, or joins `InventoryIssue` to `Project` in any way. The two material-tracking mechanisms (`invIssues`/`invItems`/`invTxns` vs. `Project.dc[]`) are entirely parallel and disconnected in the live PWA — this independently re-confirms the prior audit series' finding rather than merely repeating it.
- **This audit does not propose integrating them.** `projId` being write-only is recorded as a fact and, separately, as an open decision (§28, item 12) — not as something requiring a fix.

---

## 22. ServiceCall relationship

- **ServiceCall IDs stored on Issue:** **NOT PRESENT** — `invIssues.projId` is a `Project.id` (or `0`), never a `svcCalls.id`. When a service call is chosen as the issue site, `siteList()` (line 3082) gives it `id:0` explicitly, discarding any way to trace back to the specific service call.
- **Service-call site text — copied display context only:** `siteList()` builds the *display text* `"Service - "+s.site+" (PSC-"+s.psc+")"` for the dropdown option; whichever option is chosen, its **text** (not any structured reference) is what's stored onto `invIssues.site`. This is a one-time text copy at issue time — later renaming/changes to the service call's `site` or `psc` fields do not propagate back to the already-issued row's `site` text.
- **Does any ServiceCall code read InventoryIssue data?** Searched `vCall()`, `saveCall()`/service-call report-completion code (lines ~3579–3705) for any `invIssues`/`invItems`/`invTxns` reference: **none found.** ServiceCall's own "Material Used" concept is a **completely separate, free-text field** — `report.material` (`r_mat` input, line 3641) — filled in manually by the engineer when completing the call, with zero structural connection to the Inventory module.
- **Does inventory issuance affect ServiceCall completion?** **No** — confirmed no code path from `saveIssue()`/`saveInvReturn()`/etc. touches `DB.svcCalls`, and no ServiceCall completion check (`doneService()` or equivalent) reads `invIssues`.
- **Conclusion:** no functional relationship exists between ServiceCall and Inventory beyond the one-way, one-time, free-text display copy described above. Nothing here should be invented as a relationship in the new design.

---

## 23. Relationship matrix

| From | To | Cardinality | Persistence form | How created | How read | Reverse ref exists? | Actually functional? | PWA Fact / New Design |
|---|---|---|---|---|---|---|---|---|
| Company | InventoryCategory | 1:N | `invCats.co` (int/string, matches `Company.id`) | `saveCat()` | `invCats()` filter | no (Company doesn't list its categories) | Yes (tenant scoping) | PWA Fact |
| Company | InventoryLocation | 1:N | `invLocs.co` | `saveLoc()` | `invLocs()` filter | no | Yes | PWA Fact |
| InventoryCategory | InventoryItem | 1:N | `invItems.cat` (int, matches `invCats.id`; in-memory, not a durable typed ref) | `saveItem()` (dropdown selection) | `catName(i.cat)` (live-resolved, not copied — §7) | no (category doesn't list its items; computed ad hoc via filter wherever needed) | Yes — deletion is even blocked while referenced (§4) | PWA Fact |
| InventoryLocation | InventoryItem.stock | 1:N (per item, one qty entry per location it has ever held stock at) | `invItems.stock[String(locId)] = qty` | `moveStock()` (all stock-affecting actions) | every stock table/report, keyed by location id | no (location doesn't list which items are on it directly — computed via filter, e.g. in `vInvCats()`/`vTransfer()`) | Yes — core to the stock model | PWA Fact |
| InventoryItem | InventoryIssue | 1:N | `invIssues.item` (int, matches `invItems.id`) | `saveIssue()` | `itemById(x.item)` everywhere an issue is displayed | no (item doesn't list its issues; computed via filter in `vInvItem()`) | Yes | PWA Fact |
| InventoryItem | InventoryTransaction | 1:N | `invTxns.item` | `invLog()` | `itemById(x.item)` in every transaction display | no | Yes | PWA Fact |
| InventoryIssue | InventoryTransaction | 1:N (logical — an issue generates one or more txns over its life, but no stored link) | **no direct field** — correlated only by matching `item` + approximate `date`/`ref` text; `invTxns.ref` for an Issue-type row happens to contain `staff+"/"+site`, which loosely mirrors an issue row, but this is never used as a join key by any function | `saveIssue()`, `saveInvReturn()`, `saveMarkUsed()`, `saveTransfer()`, `saveAdjust()` each call `invLog()` alongside their own state changes | never joined programmatically — the UI shows an item's issues and an item's transactions as two independent tables on `vInvItem()`, side by side, not cross-referenced | no | No structural link — only observationally correlated | PWA Fact (absence of a link) |
| InventoryIssue | Project / ServiceCall site context | Issue→Project: N:1 via `projId` (real id or 0); Issue→ServiceCall: **none** (only free-text `site`) | `invIssues.projId` (int, or 0); `invIssues.site` (free text) | `saveIssue()` | **`projId` is written but never read back by any Project code** (§21); `site` is display-only, copied once | no | **Not functional** — field-only, non-functional relationship (Project side); no relationship at all to ServiceCall beyond display text | PWA Fact (field exists, non-functional) |
| Inventory (various actions) | Notification | N:1 fan-out (one action → 0–2 `notify()` calls → 1 row per call, fanned out at read time to every user whose role matches) | `DB.notifs` row `{roles:[...], text, date}` | `notify(roles, text)` (§17) | `myNotifs()` filters by role match at read time (no per-recipient row) | no | Yes | PWA Fact |

---

## 24. Workflow matrix

| PWA Workflow | Trigger | Actor | Reads | Writes | Stock Movement | Status | Transaction | Notification | Downstream Relationship | Exact Guard |
|---|---|---|---|---|---|---|---|---|---|---|
| Category creation/edit | `mCat()`/`saveCat()` | UI-gated `canStock()` | `invCats` (for rename) | `invCats` row | none | n/a | none | none | Category→Item (dropdown source) | non-empty name only |
| Location creation/edit | `mLoc()`/`saveLoc()` | UI-gated `canStock()` | `invLocs` | `invLocs` row | none | n/a | none | none | Location→Item.stock keys | non-empty name only |
| Item creation/edit | `mItem()`/`saveItem()` | UI-gated `canStock()` | `invCats`, `invLocs` (for opening-stock inputs) | `invItems` row (+ `invIssues`/`invTxns` untouched on edit) | opening stock only, on create | n/a | `"Opening Stock"` per non-zero location, on create only | none | Item→Category, Item→Location.stock | non-empty item name only |
| Opening stock | part of item creation (see above); or via `mAdjust()` type=`"Opening Stock"` on an existing item | UI-gated `canStock()` | item | `stock[loc]`, one `invTxns` row | `+q` at chosen location | n/a | `"Opening Stock"` | none | — | negative-result check only via `saveAdjust`'s guard (creation path has no negative possible) |
| Purchase in | `mAdjust()` type=`"Purchase In"` | UI-gated `canStock()` | item | `stock[loc]`, `invTxns` | `+q` | n/a | `"Purchase In"` | none | — | `q` truthy |
| Manual adjustment | `mAdjust()` type=`"Adjustment"` | UI-gated `canStock()` | item | `stock[loc]`, `invTxns` | `±q` | n/a | `"Adjustment"` | none | — | negative result blocked if it would go below 0 at that location |
| Damage/write-off (direct adjust) | `mAdjust()` type=`"Damage / Write-off"` | UI-gated `canStock()` | item | `stock[loc]`, `invTxns` | typically `-q` (user enters negative) | n/a | `"Damage / Write-off"` | none | — | same negative-result guard |
| Issue material | `mIssue()`/`saveIssue()` | UI-gated `canStock()` | items w/ stock, `invLocs`, `staffList()`, `siteList()` | new `invIssues` row, `stock[loc]`, `invTxns` | `-q` at issue location | `"Issued"` | `"Issue"` | issue notice (`*`); low/out-of-stock notice (`inventory`,`admin`) if applicable | `projId` written (non-functional, §21) | `q<=available@location` |
| Return request (staff) | `mReturnReq()`/`saveReturnReq()` | any user with a personal balance | own `invIssues` row | `retReq`,`retReqQty`,`retReqDate`,`retReqNote` | none | recomputed (no change — request doesn't affect balance) | none | request notice (`inventory`,`admin`) | none | `1<=q<=balance` |
| Accept return | `mInvReturn()`/`saveInvReturn()` | UI-gated `canStock()` | issue, item, `invLocs` | `rqty`+=q, `status`, clears `retReq*`; possibly `used`+=rest | `+q` at chosen return location (skipped if damaged) | recomputed | `"Return"` (+ `"Damage / Write-off"` if damaged; + `"Consumed"` if balance-checkbox used) | return notice (`*`) | clears any pending request regardless of origin | `1<=q<=balance` |
| Reject return | `rejectReturn()` | UI-gated `canStock()` | issue | clears `retReq`,`retReqQty`,`retReqNote` (not `retReqDate`) | none | unchanged | none | rejection notice (`*`) | none | none beyond row lookup |
| Partial return | same as "Accept return" with `q < balance` | UI-gated `canStock()` | — | `rqty` incremented by partial amount only | `+q` (partial) | → `"Partially Returned"` if balance remains | `"Return"` | return notice (mentions "still pending") | — | `1<=q<=balance` |
| Mark used on site | `mMarkUsed()`/`saveMarkUsed()` (or unused `markConsumed()`) | UI-gated `canStock()` | issue, item | `used`+=q, `status` | **none** (verified — no `moveStock()` call) | recomputed | `"Consumed"` | **none** | none | `1<=q<=balance` |
| Stock transfer | `mTransfer()`/`saveTransfer()` | UI-gated `canStock()`; **admin has no menu path to reach the create action** (§18) | items w/ stock, `invLocs` (≥2 required) | `stock[from]`, `stock[to]`, `invTxns` | `-q` from, `+q` to | n/a | `"Transfer"` | **none** | none | `f!==t`; `q<=available@from` |
| Low-stock notification | fires only as a side effect of Issue | system (embedded in `saveIssue()`) | — | — | — | — | — | low/out-of-stock notice (`inventory`,`admin`) | — | `stockState(it).lvl>0` post-issue |
| Out-of-stock behavior | same trigger path as low-stock notification (shared `lvl` check); otherwise purely a display state (`stockState().lvl===2`) | — | `stock` | — | — | — | — | (shares the same notify call as low-stock, no separate one) | — | `totQty(it)<=0` |
| Item report export | `dlStock()` | anyone who can see `stock` menu | `invItems`, `invLocs`, `invCats` | none (download only) | none | — | none | none | none | search-box filter applied |
| Issue report export | `dlIssued()` | anyone who can see `stock` menu (Issued button lives on `vStock`/`vIssue`) | `invIssues` | none | none | — | none | none | none | none |
| Return report export | `dlReturns()` | `canStock()` (button on `invreturn` screen) | `invIssues`, `invTxns` | none | none | — | none | none | none | none |
| Transaction report export | `dlTxns()` | `admin`/`inventory` (only roles with `invhistory` menu) | `invTxns` | none | none | — | none | none | none | search-box filter applied |

---

## 25. PWA quirks

Each independently verified against source, not assumed:

1. **`ret` is copied to the issue at issue time and never re-synced.** `saveIssue()` sets `ret: !!it.ret` once; if an item's `ret` flag is edited later via `saveItem()`, every already-issued row keeps its old snapshot. Verified: `saveItem()`'s edit branch (`Object.assign(itemById(id), d)`) never touches `DB.invIssues`.
2. **Return requests never affect stock or the transaction ledger** — confirmed in §10; only the eventual accepted return does.
3. **Any issued material is "returnable" through the UI regardless of the item's `ret` flag** — `mInvReturn()`/`returnableNow()`/`pendingReturns()` operate on *balance*, not on `ret`; even a non-returnable consumable's un-used balance can be formally "returned" through this same flow (the flowinfo text on `vReturns()` says this explicitly: "tools, or unused leftover consumables").
4. **Partial return is fully supported and can be repeated** — `rqty` accumulates additively across multiple partial-return actions on the same issue row.
5. **Damaged return is a write-off, not a separate scrap-stock entity** — confirmed in §10; the only representation is the "Damaged" condition toggle plus a `"Damage / Write-off"` transaction; `rqty` still increases (clears the staff-side balance) even though stock is not credited.
6. **`used` (Consumed) behavior never decrements stock a second time** — confirmed in §11; the balance mechanism is purely about closing out the "with staff" bookkeeping, not a second stock-affecting event.
7. **`issBal()` clamps to zero** — `Math.max(0, qty-rqty-used)` — confirmed; a hypothetical over-return/over-use (were the UI's own caps somehow bypassed) cannot produce a negative displayed balance.
8. **Status is derived fresh on every mutation, not trusted from storage** — confirmed at every `save*` call site; the persisted `status` value is always immediately overwritten by `issStatus(x)`.
9. **`"Returned"` IS reachable** (fully returned, nothing marked used) — independently re-verified by direct execution (§10), not assumed. This should be treated as the correct PWA behavior to preserve/decide against, not as evidence of a genuinely unreachable branch.
10. **`moveStock()` clamps negative location stock to zero** — confirmed (§6); no stock-affecting action can leave a location with a negative quantity on record, though the various pre-save `avail`/`q<=avail` checks are what normally prevent this from ever being exercised.
11. **`invTxns` rows are append-only** — confirmed no edit/delete function exists anywhere for this collection.
12. **`invIssues.projId` is written but never functionally read back** — confirmed independently (§21); a genuine "write-only" field in the live PWA.
13. **`invIssues.site` is free text, copied once at issue time from whatever the site dropdown's option text was** — never re-synced if the underlying project/service-call's name later changes (§9, §22).
14. **The staff/recipient "candidate pool" for issuing excludes only `admin`** — `staffList()` (§9) offers every other role including `inventory` and `finance` as possible material recipients; there is no narrower "field staff only" pool.
15. **Duplicate issues are fully possible** — nothing prevents issuing the same item to the same staff member for the same site twice in a row (no uniqueness/dedup check in `saveIssue()`).
16. **Duplicate return requests are fully possible in effect** — `saveReturnReq()` simply overwrites `retReq*` fields each time it's called on the same issue row (no guard against calling it again while a request is already pending — the UI *labels* the button "Update request" in that case, but the underlying function performs the identical overwrite either way).
17. **Repeated-notification is the norm, not the exception** — confirmed in §17: every qualifying action fires its notification every time, with no suppression/dedup of any kind.
18. **Same-location transfer is explicitly blocked** — the one deliberate guard of its kind in the whole module (§12) — worth calling out precisely because most other "duplicate/no-op" scenarios in this module are *not* guarded.
19. **Admin has `canStock()` privileges but no menu path to the Transfer *create* screen** — confirmed (§18); a UI gap, not a deliberate two-tier permission design (nothing else distinguishes Admin's Inventory capabilities from Inventory Manager's).
20. **Category and Location deletion are blocked only by "is it currently referenced" checks, with zero uniqueness enforcement on the way in** — you can create ten identically-named categories, but you cannot delete the one category an item still points to (§4/§5).
21. **Item `code` can duplicate across items, even within the same company** (no in-company check either, not just cross-tenant — seed data only demonstrates the cross-tenant case, but the *validation* — its total absence — is identical for both scopes; confirmed by reading the entirety of `saveItem()`, which contains no `code` uniqueness check at all, tenant-scoped or otherwise).
22. **Item deletion leaves dangling references** — confirmed (§6); `invIssues`/`invTxns` rows referencing a deleted item resolve their `itemById()` lookups to `undefined` and render blank names rather than erroring, but the historical rows are not cleaned up, re-pointed, or flagged.
23. **Cross-tenant direct-lookup gap on item/issue detail routes** — confirmed (§19); `itemById`/`catName`/`locName` and the various `mXxx(id)` action-openers have no `co` check.
24. **`saveAdjust()`'s "Opening Stock" transaction type is reusable on an existing item**, not restricted to first-creation only, despite the name implying a one-time event (§6/§8) — this is source-confirmed, not a naming assumption.
25. **The Issue transaction's logged `date` does not match the issue's own (possibly backdated) `date` field** — confirmed in §8; `invLog()`'s own `date:today()` default is what actually lands on the `"Issue"` transaction row, regardless of what date was chosen in the Issue form.
26. **A rejected return request leaves no persistent history** — beyond the one-time notification text, nothing records that a request was ever made and rejected (§16, Returns screen section).

No item on this list is labeled a "bug" unless demonstrated directly in code as shown above; several (e.g. #9, the reachability of `"Returned"`) are presented specifically because they contradict a characterization made elsewhere, and are backed by direct execution, not just re-reading.

---

## 26. NEW APP gap analysis

Inspected only — nothing modified.

| Area | Status | Notes |
|---|---|---|
| `InventoryCategory` schema | **COVERED** (schema only) | `new-app/backend/src/models/InventoryCategory.js` — `companyId`, `name`. Matches PWA fields exactly (§4). No uniqueness index enforced beyond a non-unique compound index `{companyId:1, name:1}` (an index for query performance, not a `unique:true` constraint — confirmed by reading the file; this correctly does *not* invent a uniqueness rule the PWA doesn't have). |
| `InventoryLocation` schema | **COVERED** (schema only) | Same pattern as Category. |
| `InventoryItem` schema | **PARTIALLY COVERED** (schema only) | Fields match PWA (`code, name, categoryId, unit, returnable, minimumStockLevel, ratePerUnit, stockByLocation`); `stockByLocation` correctly modeled as a `Map<String, Number>`, mirroring the PWA's `stock[String(locId)]` shape (§6/§7). Derived fields (`totQty`/`stockState`/`stockValue`) are correctly *not* stored, matching the PWA's pure-function computation model — but this also means **no service-layer implementation of those derivations exists yet** (see "Inventory repository support" row below). |
| `InventoryIssue` schema | **PARTIALLY COVERED** (schema only) | Field mapping is thorough and mostly faithful (`itemId, quantityIssued, staffId(durable ref — NEW BACKEND DESIGN, since PWA only has a name string — §9), site, projectId, fromLocationId, date, returnable, quantityReturned, quantityUsed, status, returnRequested, requestedQuantity, requestedDate, requestNote, issuedByUserId(durable ref), remark`). The `status` enum lists `Returned/Used` (no spaces) where the PWA's actual derived string is `"Returned / Used"` (with spaces) — a cosmetic mismatch worth flagging for whoever eventually writes the derivation service, though not itself business logic. No `issStatus()`/`issBal()` equivalent exists yet anywhere in `new-app` (confirmed no `services/inventory*` file exists at all) — the derivation logic described in §9/§10 has **not** been implemented. |
| `InventoryTransaction` schema | **PARTIALLY COVERED** (schema only) | Type enum (`Opening Stock, Purchase In, Damage / Write-off, Adjustment, Issue, Return, Transfer, Consumed`) exactly matches this audit's independently-derived exhaustive list in §8 — a strong sign the schema author already did a `invLog()` call-site sweep. Immutability is correctly modeled via `immutable:true` on every content field, matching §8's confirmed append-only behavior. No writer/service exists to actually populate this collection yet. |
| Inventory repository support | **MISSING** | `new-app/backend/src/repositories/businessRepositories.mongoose.js` — inspected: contains repository functions for Company/User/Enquiry/SalesOrder/Contract/Project/ServiceCall/Payment areas only; grep for any Inventory-related export or query returns nothing. No `stockRepo`/`inventoryIssueRepo`/etc. exists. |
| Inventory service layer | **MISSING** | `new-app/backend/src/services/` contains `companyService.js, contractService.js, enquiryService.js, paymentService.js, projectService.js, salesOrderCascade.js, salesOrderService.js, serviceCallService.js` — no `inventoryService.js` or equivalent. |
| Inventory routes/controllers | **MISSING** | `new-app/backend/src/routes/` has no `inventoryRoutes.js` (compare: `authRoutes.js, companyRoutes.js, contractRoutes.js, enquiryRoutes.js, paymentRoutes.js, projectRoutes.js, salesOrderRoutes.js, serviceCallRoutes.js` all exist for their respective modules); no `new-app/backend/src` directory contains any `*controller*` file at all for any module (this codebase appears to route directly to services, so "no Inventory controller" is consistent with the existing pattern, not evidence of a gap specific to Inventory — noted for accuracy). |
| Transaction/ledger helper support | **MISSING** | No helper anywhere computes `totQty`/`stockState`/`stockValue`/`issBal`/`issStatus` equivalents for the new backend; these pure functions (§6/§10) have no counterpart yet. |
| Notification support (generic) | **COVERED (generic infra), MISSING (Inventory-specific triggers)** | Not directly inspected in depth here (out of this audit's five-entity scope), but no Inventory action anywhere in `new-app` calls any notification mechanism, since no Inventory service exists to call from. |
| User references for staff/actor fields | **COVERED (design decision made, not yet wired)** | `InventoryIssue.js`/`InventoryTransaction.js` already commit to durable `ObjectId` refs (`staffId`, `issuedByUserId`, `recordedByUserId`) in place of the PWA's plain name strings — a NEW BACKEND DESIGN choice, correctly labeled as such in the model comments, not mislabeled as a PWA fact. |
| Tenant (`companyId`) helpers | **COVERED (schema level)** | Every one of the five models carries a required `companyId` field and a `companyId`-leading compound index, consistent with §19's finding that tenant scoping is the one mandatory infra requirement. No repository/service exists yet to actually *enforce* this at query time (there's nothing to enforce it in, since no repository/service exists) — this is the natural next-layer gap, not a schema defect. |

**Schemas existing alone do not mean workflow coverage exists** — confirmed and worth restating plainly: all five collections are represented as Mongoose models with careful, mostly-accurate PWA-fact annotation, but **zero** or the workflows in §24 (issue, return, transfer, adjust, mark-used, notifications, reporting, dashboard KPIs) have any executable counterpart anywhere in `new-app` today. This audit did not write any of that counterpart code, per its read-only mandate.

---

## 27. Facts vs decisions

### (A) PWA FACTS
- Five entities (`invCats`, `invLocs`, `invItems`, `invIssues`, `invTxns`) with the exact field sets in §3.
- `stock` is a per-item map keyed by location id; `totQty`/`stockState`/`stockValue` are pure, always-recomputed functions, never stored.
- Eight transaction types, exhaustively enumerated in §8, logged by an append-only `invLog()`.
- `issBal = max(0, qty - rqty - used)`; `issStatus()` derives one of `Issued, Return Requested, Partially Returned, Returned, Returned / Used, Consumed` — all six reachable, independently re-verified by execution.
- Return requests never move stock or write a transaction; only the accepted return does.
- Damaged returns clear the staff balance (`rqty` increments) but are not credited back to stock; a `"Damage / Write-off"` transaction is the sole record of the write-off.
- Marking material used never decrements warehouse stock a second time.
- `invIssues.projId` exists and is populated but is never functionally read back by any Project code; Project's own material tracking (`dc[]`) is entirely separate.
- No functional relationship exists between ServiceCall and Inventory beyond a one-time free-text display copy of the site name.
- No `div` field exists anywhere in the Inventory module.
- Access control is UI-only (`canStock()`), never re-checked inside the mutating functions themselves; cross-tenant lookups on single-record routes have no `co` check.
- Five `notify()` call sites, verbatim text as quoted in §17; no notification for Transfer or Mark-Used; low-stock notice fires only from the Issue path.

### (B) PWA QUIRKS
See the full, independently-verified list in §25 (26 items) — not repeated here to avoid duplication.

### (C) ALREADY-APPROVED NEW APP INFRASTRUCTURE
(Carried forward from the prior audits in this series, applied here only where the Inventory schemas already reflect them — not proposed fresh by this audit)
- MongoDB/Mongoose as the persistence layer.
- Durable ObjectIds in place of the PWA's in-memory numeric ids (all five models already use `ObjectId` primary/foreign keys).
- Server-side tenant isolation via `companyId` (schema-level groundwork already present; enforcement layer not yet built).
- Durable `User` ObjectId references in place of the PWA's plain name strings for `staff`/`by` fields (already a stated design choice in `InventoryIssue.js`/`InventoryTransaction.js`, correctly labeled NEW BACKEND DESIGN, not PWA fact).
- Server-side authorization (replacing the PWA's UI-only `canStock()` gate) — not yet built for Inventory, but consistent with the pattern already established for Enquiry/SalesOrder/Contract/Project/ServiceCall/Payment.
- Concurrency-safe stock mutation (the PWA's `moveStock()` is a synchronous, single-threaded, no-lock, no-transaction operation — appropriate for a demo in-memory app, not for a multi-user server) — an infrastructure necessity, not a new business feature, for any real implementation of §9/§10/§12's workflows.
- Append-only/immutable storage for `InventoryTransaction`, matching the PWA's own demonstrated behavior (§8/§11 of this document; §21 item 8 of `OPEN_DECISIONS.md`'s numbering scheme, referenced for comparison only).

New business fields or workflow redesigns are **not** classified as infrastructure here just because they might sound useful — none were proposed by this audit.

### (D) GENUINE OPEN DECISIONS
See the complete, numbered list in §28 below.

---

## 28. Open decision list

For each: whether the PWA itself answers the question, or leaves it open. This audit does **not** answer any of these — it records what the PWA does and does not settle.

1. **InventoryItem `code` uniqueness.** PWA does not answer this — no uniqueness check exists at all, per-company or globally (§7, §25 item 21); the seed data even demonstrates the same code reused across two companies.
2. **Category uniqueness.** PWA does not answer this — `saveCat()` has no duplicate-name check (§4).
3. **Location uniqueness.** PWA does not answer this — `saveLoc()` has no duplicate-name check (§5).
4. **Category deletion with dependent items.** PWA answers this — deletion is hard-blocked while any item references the category; the PWA does not offer a "delete and reassign" or "delete and orphan" option (§4).
5. **Location deletion with existing stock.** PWA answers this — deletion is hard-blocked while stock exists at that location; no "delete and zero-out" option (§5).
6. **Item deletion vs. archive behavior.** PWA answers this partially — deletion is hard, immediate, and unguarded (no block for outstanding issues/history); there is no archive/soft-delete concept at all (§6, §25 item 22). Whether the new system should add a block or an archive state instead of hard-delete is not answered by the PWA.
7. **InventoryIssue deletion/editability after stock movement.** PWA answers this — there is no deletion or direct-field-edit function for `invIssues` anywhere; the only mutations are the specific state-machine transitions (issue, return, mark-used, reject) covered in §9–§11.
8. **InventoryTransaction immutable storage.** PWA answers this — confirmed append-only, no edit/delete function exists (§8, §16).
9. **Staff identity name-string→durable-User-ID.** PWA does not answer this — `staff`/`by` are plain name strings throughout (§9); matching by name (`myIssues()`) is fragile if names collide or change (§25 item — implicitly, via §15). The new backend's models already commit to durable refs here (§26), which is a NEW BACKEND DESIGN decision, not something the PWA itself resolves.
10. **Recipient role scope for issuance.** PWA answers this loosely — `staffList()` = every role except `admin` (§9); it does not restrict to "field staff only." Whether the new system should narrow this is not answered by the PWA (the PWA's own answer is "broad, exclude admin only").
11. **Division filtering.** PWA answers this — there is none, anywhere in Inventory (§20). Whether the new system should add any is a decision the PWA gives no guidance for (its own answer is simply "no division filtering exists").
12. **Project/service-call relation.** PWA answers this — `projId` is write-only/non-functional; no ServiceCall link exists at all (§21, §22). Whether the new system should make this relationship real (e.g. actually joining Issue↔Project) is not answered by the PWA — it demonstrates the *absence* of such a join, not a decision to add one.
13. **Large-ledger scalability/storage.** PWA does not answer this — it is an in-memory, seed-data-sized array with no pagination, archiving, or partitioning strategy anywhere in the transaction/issue/report code (§8, §16).
14. **Transaction atomicity.** PWA does not meaningfully answer this — `invLog()`+`moveStock()` calls are simply sequential synchronous JS statements with no rollback path if, hypothetically, one succeeded and a later one in the same function failed (not observed to happen in practice, since there's no I/O between them, but nothing enforces it as a database transaction either) (§8, §12).
15. **Concurrency on stock.** PWA does not answer this — it is single-user, single-threaded, in-memory; `moveStock()` has no locking or optimistic-concurrency concept whatsoever (§6, §12).
16. **Duplicate issue/return protection.** PWA answers this — there is none; duplicates of both are fully possible (§25 items 15–16).
17. **Repeated-notification protection.** PWA answers this — there is none; every qualifying action notifies every time (§17, §25 item 17).
18. **Stock-adjustment semantics.** PWA answers this mostly — a single shared `mAdjust()`/`saveAdjust()` flow covers Purchase In/Opening Stock/Damage-Write-off/Adjustment with one signed-quantity input and a location (§6, §8); it does not answer whether the new system should split these into more structured, type-specific input flows (e.g. a dedicated Purchase-In screen with PO-line detail) — the PWA's own answer is "one generic form for all four."
19. **Damaged-return representation.** PWA answers this — a condition toggle plus a paired `Return`+`Damage / Write-off` transaction pair, no separate scrap-stock entity, no `scrapQty` field (§10, §25 item 5). Whether the new system should model damage more richly is not something the PWA's own design calls for.
20. **Additional question genuinely unanswered by the PWA:** **`"Returned"` vs. `"Returned / Used"` status-string formatting for the new schema's enum** — the PWA's live output is `"Returned / Used"` (with spaces around the slash); the new backend's `InventoryIssue.js` enum currently has `'Returned/Used'` (no spaces) — this is a small but real mismatch between the schema-as-written and the string the PWA actually produces, worth resolving explicitly (not to be silently "fixed" without a decision, per this audit's mandate) whenever the status-derivation service is eventually built. This audit records the fact and does not resolve it.

---

## 29. Implementation readiness

| Finding | Classification |
|---|---|
| Five-entity field set (§3) | COVERED (schema) / DOC GAP closed by this audit |
| `stock` per-location map model (§6/§7) | COVERED (schema) |
| `totQty`/`stockState`/`stockValue`/`issBal`/`issStatus` derivations (§6/§9/§10) | IMPLEMENTATION GAP — no service-layer counterpart exists |
| Eight-type transaction enum (§8) | COVERED (schema) |
| Append-only transaction ledger (§8) | COVERED (schema, `immutable:true` fields) |
| Issue/Return/Mark-Used/Transfer workflows (§9–§12, §24) | IMPLEMENTATION GAP — no service/route/controller exists |
| Notification catalogue (§17) | IMPLEMENTATION GAP — no Inventory-specific trigger exists in `new-app` |
| Role/access model (§18) | DESIGN DECISION — PWA is UI-only; server-side enforcement is a NEW BACKEND requirement (already an approved infra pattern per §27(C)), not yet implemented for Inventory |
| Tenant scoping incl. single-record lookup gap (§19) | SCHEMA GAP (partially closed — `companyId` present) + IMPLEMENTATION GAP (no query-time enforcement exists yet) |
| Division behavior | NOT APPLICABLE — PWA has none; nothing to implement per this audit's scope |
| Project relationship (`projId` write-only) (§21) | DESIGN DECISION — whether to keep it non-functional or make it real is open (§28 item 12) |
| ServiceCall relationship (none) | NOT APPLICABLE — nothing to implement; PWA demonstrates no relationship |
| `"Returned"` status reachability (§10, §25 item 9) | DOC GAP — this audit's independently-verified correction to the prior document's characterization; no code changed |
| `Returned/Used` vs `"Returned / Used"` enum-string mismatch (§28 item 20) | SCHEMA GAP — flagged, unresolved |
| `code` / Category / Location uniqueness (§28 items 1–3) | DESIGN DECISION — PWA demonstrates no constraint; new system must choose |
| Category/Location deletion guards (§28 items 4–5) | COVERED (as a PWA-fact behavior to preserve) — reimplementation is an IMPLEMENTATION GAP, the *rule itself* is not a DESIGN DECISION |
| Item deletion (hard, unguarded) (§28 item 6) | DESIGN DECISION |
| InventoryIssue/InventoryTransaction immutability (§28 items 7–8) | COVERED (schema, `InventoryTransaction`) / DESIGN DECISION already resolved in the PWA's own behavior for Issue (no delete/edit function exists) — reimplementation is an IMPLEMENTATION GAP |
| Staff identity as durable User ref (§28 item 9) | DESIGN DECISION — already made in schema (§26), not yet wired to any service |
| Recipient role scope (§28 item 10) | DESIGN DECISION — PWA's own default is broad; new system may narrow or keep |
| Division filtering (§28 item 11) | NOT APPLICABLE |
| Large-ledger scalability, transaction atomicity, concurrency (§28 items 13–15) | IMPLEMENTATION GAP — infra-level, no PWA guidance to preserve since none of this exists in the PWA's single-user in-memory model |
| Duplicate issue/return & repeated-notification protection (§28 items 16–17) | DESIGN DECISION — PWA has none of either; new system may add |
| Stock-adjustment semantics granularity (§28 item 18) | DESIGN DECISION |
| Damaged-return representation (§28 item 19) | COVERED (as a PWA-fact behavior to preserve, if choice A is made) / DESIGN DECISION (if a richer model is wanted instead) |
| Admin missing Transfer menu link (§18, §25 item 19) | PWA QUIRK-BUG — a plausible PWA oversight, not a deliberate two-tier design; flagged for a business decision, not silently "fixed" here |
| Cross-tenant single-record lookup gap (§19, §25 item 23) | PWA QUIRK-BUG relative to intended tenant isolation — but tenant isolation itself is the one already-approved mandatory infra fix (§27(C)), so closing this specific gap is IMPLEMENTATION GAP, not a new design decision |

---

*End of audit. No Inventory implementation (service, route, controller, repository, workflow, UI, or migration) was created or modified. This document is the sole file created by this task.*
