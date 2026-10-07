# PASS 3.6 — INVENTORY END-TO-END VERIFICATION

Date executed: 2026-09-24. Phase A (read-only verification) only — no `new-app/` application source or test files were modified in this pass.

## PASS 3.6 STATUS
**PASS**

## Inventory coverage

Fresh source trace of `MEP_PROJECTS_PWA/index.html` lines 2872–3480 (function bodies) plus call sites (menu, dashboard, reports), independently re-derived in this pass (not assumed from prior docs):

| Area | PWA functions traced | NEW APP equivalent |
|---|---|---|
| Category | `mCat`, `saveCat`, `delCat`, `vInvCats` (cat half) | `createCategory/listCategories/renameCategory/deleteCategory` |
| Location | `mLoc`, `saveLoc`, `delLoc`, `vInvCats` (loc half) | `createLocation/listLocations/renameLocation/deleteLocation` |
| Item | `mItem`, `saveItem`, `delItem`, `vInvItem`, `vStock` | `createItem/listItems/getItem/updateItem/deleteItem` |
| Issue | `mIssue`, `saveIssue`, `vIssue` | `issueMaterial` |
| Return (accept) | `mInvReturn`, `saveInvReturn` | `acceptReturn` |
| Return Request | `mReturnReq`, `saveReturnReq`, `rejectReturn` | `requestReturn`, `rejectReturn` |
| Mark Used | `mMarkUsed`, `saveMarkUsed`, `markConsumed` | `markUsed` |
| Transfer | `mTransfer`, `saveTransfer`, `vTransfer` | `transferStock` |
| Transactions/ledger | `invLog`, `vInvHistory`, `dlTxns` | `inventoryTransactionRepo` (append-only), `exportTransactionsCsv` |
| Dashboard | `invDash`, `catSummary` | `getDashboard` |
| Reports/Exports | `dlStock`, `dlIssued`, `dlTxns`, `dlMyMaterial`, `dlReturns` (**5 confirmed, not assumed**) | `exportStockCsv/exportIssuedCsv/exportTransactionsCsv/exportMyMaterialCsv/exportReturnsCsv` |
| My Material | `vMyMaterial`, `myIssues` | `listMyMaterial` |
| Notifications | 5 `notify()` call sites inside Inventory code (Issue, Low/Out stock, Return accepted, Return rejected, Return requested) | matching `notificationRepo.create` calls in `issueMaterial`, `acceptReturn`, `rejectReturn`, `requestReturn` |

All counts above were obtained by direct `grep`/`sed` extraction of `MEP_PROJECTS_PWA/index.html` in this pass, not copied from any prior audit doc.

## Stock behavior

Exact PWA source (index.html:2881, 2885–2904):

```js
function totQty(it){var s=(it&&it.stock)||{},n=0,t=0;for(var k in s){n++;t+=Number(s[k])||0}return n?t:(Number(it&&it.qty)||0)}
function stockState(it){
 var t=totQty(it);
 if(t<=0)return{txt:"Out of Stock",cls:"b-red",lvl:2};
 if(it.min&&t<=it.min)return{txt:"Low Stock",cls:"b-amb",lvl:1};
 return{txt:"In Stock",cls:"b-grn",lvl:0};
}
function moveStock(it,locId,delta){
 it.stock=it.stock||{};
 var k=String(locId);
 it.stock[k]=(Number(it.stock[k])||0)+delta;
 if(it.stock[k]<0)it.stock[k]=0;
}
function issBal(x){return Math.max(0,(Number(x.qty)||0)-(Number(x.rqty)||0)-(Number(x.used)||0))}
function issStatus(x){
 if(issBal(x)<=0)return (Number(x.rqty)||0)>0?(Number(x.used)||0>0?"Returned / Used":"Returned"):"Consumed";
 if((Number(x.rqty)||0)>0)return "Partially Returned";
 if(x.retReq)return "Return Requested";
 return "Issued";
}
```

Verified edge case: the inner ternary `Number(x.used)||0>0` parses (operator precedence: `>` binds tighter than `||`) as `Number(x.used) || (0>0)` = `Number(x.used) || false`. When `used` is 0 this is `false` -> `"Returned"` (reachable, confirmed by hand-executing with qty:10,rqty:10,used:0). When `used>0` it is truthy -> `"Returned / Used"` (exact spacing, with spaces around `/`, confirmed verbatim in source). This is NOT a precedence bug -- it produces the intended state machine.

NEW APP (`new-app/backend/src/services/inventoryService.js`): `totQty`, `stockState`, `issBal`, `issStatus` are line-for-line semantic ports (`stockByLocation` Map instead of `stock` object is the only structural change -- INFRASTRUCTURE-ONLY). `stockAtLocation`/`incrementStockAtLocation` (repository) clamp to zero on any negative result exactly as `moveStock` does (verified at `businessRepositories.mongoose.js:441-452`), independently of the separate pre-save "available quantity" checks in `issueMaterial`/`transferStock`/`adjustStock` -- both mechanisms exist, matching the PWA's redundant-but-present clamp.

Also verified: an item with `min`/`minimumStockLevel` falsy/unset can only ever be "In Stock" or "Out of Stock" (the `it.min&&` guard in `stockState` means Low Stock is unreachable) -- preserved exactly in NEW APP (`item.minimumStockLevel &&`).

## Connections

- **Account/User**: PWA `staff` field on Issue is a **name string** copied from `staffList()` (`mine(DB.users).filter(role!=="admin").map(name)`) at issue time -- not a foreign key. NEW APP uses a durable `staffId` ObjectId ref to `User`, resolved to a name at read time (`resolveUserName`) -- INFRASTRUCTURE-ONLY DIFFERENCE (approved: durable references). `RECIPIENT_ROLES` in NEW APP excludes only `admin`, matching PWA's `role!=="admin"` filter exactly (the PWA `super` role's seed user has `co:0`, so it can never appear in any real company's `mine(DB.users)` list -- its exclusion from `RECIPIENT_ROLES` is not a deviation, it is unreachable in PWA too, confirmed at index.html:277).
- **Project**: PWA writes `invIssues[].projId` at issue time (`saveIssue`, index.html:3130) from the selected site dropdown. Fresh trace of `vProject()` (index.html:2176 onward) and of every other PWA function referencing `invIssues`/`invItems`/`invTxns` found **zero reads of `projId`** anywhere in business logic -- it is resolved only for import/export local-ref mapping (`localRef(DB.projects,x.projId)`, index.html:977), never for any UI reads, filters, or reports. **Confirmed: NO PROJECT-SIDE FUNCTIONAL INTEGRATION DEMONSTRATED -- WRITE-ONLY REFERENCE.** NEW APP's `InventoryIssue.projectId` field matches this exactly: written by `issueMaterial`, never read back by any Inventory or Project service function. No ProjectPackage / material-allocation concept was created, per instruction.
- **ServiceCall**: fresh grep across the whole PWA source for any co-occurrence of Inventory identifiers (`invItems`/`invIssues`/`invTxns`/`stockState`/`moveStock`) with `svc`/`service` code found none inside function bodies (only a shared bulk-sync array `['invCats','invLocs','invItems','invIssues','invTxns','projects','contracts','svcCalls']`, index.html:972/1124, which is generic persistence plumbing, not a functional relation). **NO RELATION DEMONSTRATED.**
- **Finance**: same method -- no co-occurrence of Inventory identifiers with `pay`/`invoice`/finance code inside function bodies. **NO RELATION DEMONSTRATED.**
- **Checklist**: same method -- no co-occurrence inside function bodies (only the same generic bulk-sync array entries). **NO RELATION DEMONSTRATED.**
- **Notifications**: 5 `notify()` call sites confirmed inside Inventory code -- `saveIssue` (2 calls: general Issue notice to `["*"]`, and a conditional low/out-of-stock notice to `["inventory","admin"]` only when the post-issue `stockState().lvl>0`), `saveInvReturn` (1 call to `["*"]`, doubles as "return accepted"), `saveReturnReq` (1 call to `["inventory","admin"]`), `rejectReturn` (1 call to `["*"]`). Confirmed **absence** of any `notify()` call inside `saveTransfer` and inside `saveMarkUsed`/`markConsumed`. NEW APP's `issueMaterial`, `acceptReturn`, `requestReturn`, `rejectReturn` each fire exactly one matching `notificationRepo.create` call (plus the same conditional low-stock second call in `issueMaterial`); `transferStock` and `markUsed` fire none -- MATCH.

## PWA vs NEW APP — classifications found

- **MATCH** -- `totQty`, `stockState`, `moveStock`-equivalent clamp, `issBal`, `issStatus` (all 6 reachable states incl. exact "Returned / Used" spacing), `saveIssue`/`issueMaterial` validation set (item, quantity>0, available-stock check, staff, site, location, date, returnability copy), `saveInvReturn`/`acceptReturn` (positive qty, cannot exceed balance, rqty/used update, conditional stock credit, damaged-return special case, "mark remaining balance used" checkbox), Damaged Return semantics (quantityReturned still increments, stock not credited, separate "Damage / Write-off" ledger entry alongside "Return"), Return Request semantics (never moves stock/writes ledger -- only an accepted return does; reject clears `returnRequested`/`requestedQuantity`/`requestNote` but leaves `requestedDate` -- both preserved as-is, not "fixed"), `saveMarkUsed`/`markUsed` (increments `used`, writes one "Consumed" ledger entry, **never** re-decrements stock -- the single stock decrement happened once, at issue), Transfer (source/dest required and different, source-stock pre-check, both-sides `moveStock`, single "Transfer" ledger entry, **no notification**), the 8-type closed ledger enum (Opening Stock, Purchase In, Adjustment, Damage / Write-off, Issue, Return, Transfer, Consumed) with append-only behavior (no PWA function ever edits/deletes an `invTxns` row; NEW APP exposes no update/delete route for `InventoryTransaction`), Dashboard KPI formulas (Total Items, Categories, Stock Value, Low Stock = low-out, Out of Stock, Material With Staff, Return Requests), the exact 5 CSV report set and their column sets, My Material workflow and role restriction (self-service, own issues only), Category/Location delete guards (blocked if referenced/stocked), Item hard-delete with no guard (history is kept, matching PWA's own comment "Transaction history is kept").
- **INFRASTRUCTURE-ONLY DIFFERENCE** -- ObjectId references (`staffId`, `itemId`, `categoryId`, `fromLocationId`/`toLocationId`, `projectId`) replacing PWA's name/numeric-id fields; `stockByLocation` Map vs. plain object; `withTransaction`-wrapped multi-write operations (issue/return/transfer/adjust/create-item-with-opening-stock) for atomicity; MongoDB `$inc` + defensive clamp for concurrency-safe stock mutation; explicit server-side `assertCanManageInventory`/company-context checks and a return-request ownership check (`staffId === actorAuth.userId`) where the PWA client enforced nothing server-side (the PWA is a pure client SPA; these are "server-side authorization matching PWA-visible intent" per the approved exception list).
- **AUTHORIZATION GAP (non-blocking, P3)** -- see Fix tasks below (`FIX-3.6-01`).
- **OPEN/NOT DETERMINABLE** -- Category-name and Location-name uniqueness remain genuinely unresolved by PWA source (no uniqueness check anywhere in `saveCat`/`saveLoc`); NEW APP correctly does not invent one (no unique index on either). This decision is intentionally left open per the standing decision lock and this pass does not resolve it.
- **DOCUMENTATION GAP** -- none found beyond the item below; the two pre-existing Inventory audit documents (`PWA_COVERAGE_AUDIT_INVENTORY.md`, `INVENTORY_DECISION_LOCK.md`) were read for context only, and every substantive claim in this report was independently re-derived from source in this pass, not copied from them. Their claims about `issStatus()`'s "Returned" reachability and the "Returned / Used" spacing were independently confirmed correct by this pass's own hand-trace.
- **FUNCTIONAL GAP** -- none found. No genuine PWA Inventory business-logic behavior is missing or altered in NEW APP.
- **SECURITY/TENANT GAP** -- none found. Every Category/Location/Item/Issue/Transaction/User lookup and mutation in `inventoryService.js` is company-scoped (`actorAuth.companyId` from session only, never client-supplied -- `rejectClientSuppliedCompanyId` middleware mounted on the router). This is a permitted strengthening over the PWA's own tenant-lookup behavior, not a weakening.
- **ATOMICITY/CONCURRENCY GAP** -- none found. Every multi-document Inventory mutation (issue, accept-return, mark-used, transfer, adjust, create-item-with-opening-stock) is wrapped in `deps.withTransaction`.

## Fix tasks

- **FIX-3.6-01** (Priority **P3**, non-blocking, do NOT implement in this task): `STOCK_VIEW_ROLES` (`new-app/backend/src/services/inventoryService.js`, used by `assertCanViewStock` to gate `exportStockCsv` and `exportIssuedCsv`) is `['admin','inventory','hvac_pm','solar_pm','mep_pm','service_mgr']`. Fresh trace of PWA's `MENUS` object (index.html:1289-1300) shows `mep_pm`'s menu is `[dash, projects, sos, checklists]` -- it never includes `"stock"`, so PWA never shows the Stock Report button to `mep_pm`. Separately, `exportIssuedCsv` (the "Issued Material Report") reuses the same `STOCK_VIEW_ROLES` set, but PWA's `"invissue"` menu entry (which carries the `dlIssued()` report button) is visible only to `admin` and `inventory` -- never to `hvac_pm`, `solar_pm`, `mep_pm`, or `service_mgr`. Both are read-only, company-scoped CSV exports (no cross-tenant exposure, no mutation), so this is classified AUTHORIZATION GAP, not SECURITY/TENANT GAP, and does not block this pass. Recommended fix for a future Phase B task: split the gate into a `STOCK_REPORT_ROLES = ['admin','inventory','hvac_pm','solar_pm','service_mgr']` (drop `mep_pm`, matching the `"stock"` menu) for `exportStockCsv`, and a separate `ISSUED_REPORT_ROLES = ['admin','inventory']` (matching the `"invissue"` menu) for `exportIssuedCsv`.

No P0/P1 Inventory functional gap was found. This pass is **not BLOCKED**.

## Frontend Inventory build requirements

`new-app/frontend/` is confirmed still an empty placeholder (carried-forward Pass 3.5 finding, not reduced in this pass). The eventual frontend must implement the following PWA Inventory screens/functions (16 items, each independently confirmed against a `MENUS`/`TITLES`/`R` router entry or PWA function in this pass):

1. Inventory **Dashboard** (`invDash`) -- 7 KPI cards, Return Requests panel, Quick Actions, Low/Out of Stock panel, Returnable-With-Staff panel, Category-wise summary table.
2. **Categories & Locations** screen (`vInvCats`) -- combined category list + location list, add/rename/delete for both.
3. **Stock / Item list** (`vStock`) -- per-location stock columns, total/with-staff/min/rate/value/status columns, search, Add Item, Edit/Issue row actions.
4. **Item detail** (`vInvItem`) -- header KPIs, Stock by Location table, Issued/Allocated table (with per-row Return action), Transaction History table, Edit/Issue/Adjust actions.
5. **Add/Edit Item modal** (`mItem`/`saveItem`) -- code/name/category/unit/type(returnable)/min/rate fields, Opening Stock per-location inputs (create only).
6. **Add/Adjust Stock modal** (`mAdjust`/`saveAdjust`) -- 4-type selector, location, signed quantity, reference, remark.
7. **Issue Material** screen (`vIssue`) -- issue list with status badges, Return/Mark Used row actions, report download.
8. **Issue Material modal** (`mIssue`/`saveIssue`) -- item (with available qty in label), from-location, quantity, date, staff select, site/project select, remark.
9. **Material Returns** screen (`vReturns`) -- Return Requests panel (Receive/Reject), Pending Return table (Return/Mark Used actions), Return History table, 4 KPI cards.
10. **Receive Material Back modal** (`mInvReturn`/`saveInvReturn`) -- issue picker, full/partial toggle, quantity, into-location, condition (good/damaged), remark, "mark remaining balance used" checkbox.
11. **Return-to-Store modal** (`mReturnReq`/`saveReturnReq`, staff self-service) -- quantity, note.
12. **Mark Used modal** (`mMarkUsed`/`saveMarkUsed`) -- quantity, remark.
13. **Stock Transfer** screen + modal (`vTransfer`/`mTransfer`/`saveTransfer`) -- transfer history table, stock-by-location summary, from/to/quantity/reference/remark form.
14. **Inventory Transaction History** screen (`vInvHistory`) -- full ledger table with search, report download.
15. **My Material** screen (`vMyMaterial`) -- own-issues KPI cards, "material still with you" panel with Return-to-store action, full issue list with report download.
16. **5 CSV report/export actions** wired to the above screens (Stock, Issued Material, Transactions, My Material, Material Returns) and role-based visibility of every action/button per the `MENUS`/`canStock()` gates traced in this pass (Role Matrix below).

This is a requirements inventory only -- no frontend code was written in this pass.

### Inventory Relationship Matrix

| Source | Target | Type | PWA Write | PWA Read | NEW APP Write | NEW APP Read | Tenant | Auth | Result |
|---|---|---|---|---|---|---|---|---|---|
| InventoryItem | InventoryCategory | ref (name lookup) | `saveItem` sets `it.cat` | `catName()` throughout stock/dashboard views | `createItem`/`updateItem` set `categoryId` | `nameMaps()` in CSV exports, `getItem` | company-scoped both | manage=inventory/admin | MATCH |
| InventoryItem | stock-by-location | embedded map | `saveItem`(opening)/`moveStock` | `totQty`/`stockState`/`vInvItem` | same functions on `stockByLocation` | same | company-scoped | manage=inventory/admin | MATCH |
| InventoryIssue | InventoryItem | ref | `saveIssue` sets `x.item` | `itemById()` everywhere | `issueMaterial` sets `itemId` | `getItem`/CSV maps | company-scoped | manage=inventory/admin | MATCH |
| InventoryIssue | User (staff) | name string (PWA) / ObjectId ref (NEW APP) | `saveIssue` copies name | displayed verbatim | `issueMaterial` sets `staffId` | `resolveUserName` | company-scoped | staff must be same-company, non-admin role | INFRASTRUCTURE-ONLY DIFFERENCE |
| InventoryIssue | Project | write-only ref | `saveIssue` sets `x.projId` | **none found** | `issueMaterial` sets `projectId` | **none** | n/a | n/a | MATCH (both WRITE-ONLY, NO PROJECT-SIDE FUNCTIONAL INTEGRATION DEMONSTRATED) |
| InventoryIssue | ServiceCall | -- | -- | -- | -- | -- | -- | -- | NO RELATION DEMONSTRATED (MATCH: neither side creates one) |
| InventoryIssue | Payment/Finance | -- | -- | -- | -- | -- | -- | -- | NO RELATION DEMONSTRATED (MATCH) |
| InventoryIssue | Checklist | -- | -- | -- | -- | -- | -- | -- | NO RELATION DEMONSTRATED (MATCH) |
| InventoryTransaction | InventoryItem/Location | ref | `invLog()` | `vInvItem`/`vInvHistory`/CSV | `inventoryTransactionRepo.create` | same | company-scoped | append-only, no edit/delete route | MATCH |

### Inventory Field Matrix (InventoryIssue, representative)

| Entity | Field | PWA Meaning | PWA Write | PWA Read | NEW APP | Result |
|---|---|---|---|---|---|---|
| Issue | `qty`/`quantityIssued` | qty issued | `saveIssue` | `issBal`,`issStatus`,all views | same, matches | MATCH |
| Issue | `rqty`/`quantityReturned` | cumulative returned | `saveInvReturn` | `issBal`,`issStatus` | `acceptReturn` | MATCH |
| Issue | `used`/`quantityUsed` | cumulative consumed | `saveMarkUsed`, "mark remaining used" in return | `issBal`,`issStatus` | `markUsed`, `acceptReturn` | MATCH |
| Issue | `ret`/`returnable` | copied from item at issue time | `saveIssue` | dashboard "Returnable Material With Staff" filter only, NOT the return action itself | `issueMaterial` copies `item.returnable` | MATCH (incl. quirk: returnability doesn't gate the return action) |
| Issue | `retReq`/`returnRequested`, `retReqQty`/`requestedQuantity`, `retReqDate`/`requestedDate`, `retReqNote`/`requestNote` | pending self-service return request | `saveReturnReq` | `issStatus`, dashboard/returns panels | `requestReturn` | MATCH incl. reject-leaves-`requestedDate` quirk |
| Issue | `status` | derived display state | recomputed via `issStatus()` at each mutation | all list/detail views | stored + recomputed via `issStatus()` at every mutation | MATCH |

### Stock Mutation Matrix

| Operation | PWA Stock Effect | PWA Ledger | PWA Notification | NEW APP | Result |
|---|---|---|---|---|---|
| Opening Stock | set at item creation | "Opening Stock" per stocked location | none | matches | MATCH |
| Purchase In | `+q` at location | "Purchase In" | none | matches | MATCH |
| Adjustment | `+/-q` at location, pre-check blocks negative-below-zero | "Adjustment" | none | matches | MATCH |
| Damage / Write-off | none (stock untouched) -- used only from the damaged-return path | "Damage / Write-off" (alongside "Return") | none (return's own notif fires, no separate one) | matches | MATCH |
| Issue | `-q` at from-location | "Issue" (dated "today", not the issue's own date) | Issue notice `["*"]`; conditional low/out-of-stock `["inventory","admin"]` | matches | MATCH |
| Return (accepted, not damaged) | `+q` at into-location | "Return" | "Material returned" `["*"]` | matches | MATCH |
| Return (accepted, damaged) | none | "Return" + "Damage / Write-off" | same "Material returned" `["*"]` | matches | MATCH |
| Transfer | `-q` from-location, `+q` to-location | "Transfer" | **none** | matches | MATCH |
| Consumed (mark used) | **none** (no second decrement) | "Consumed" | **none** | matches | MATCH |

### Role Matrix

| Role | PWA Inventory Menu Access | PWA Mutation Gate | NEW APP Authorization | Result |
|---|---|---|---|---|
| inventory | dash,stock,invissue,invreturn,invtransfer,invcats,invhistory | `canStock()`=true | `MANAGE_ROLES` includes `inventory` | MATCH |
| admin | dash,...,stock,invissue,invreturn,invhistory (no explicit `invtransfer`/`invcats` menu entry, but `canStock()`=true so Transfer/Cat/Loc actions are reachable wherever the buttons render) | `canStock()`=true | `MANAGE_ROLES` includes `admin` for all Inventory mutations incl. transfer | MATCH |
| hvac_pm, solar_pm | dash,projects,sos,**stock**,checklists | view-only (no `canStock()`) | not in `MANAGE_ROLES`; included in `STOCK_VIEW_ROLES` for CSV export | MATCH |
| mep_pm | dash,projects,sos,checklists (**no stock**) | n/a | not in `MANAGE_ROLES`; **incorrectly** included in `STOCK_VIEW_ROLES` | AUTHORIZATION GAP -- FIX-3.6-01 |
| service_mgr | dash,service,pmlist,**stock** | view-only | not in `MANAGE_ROLES`; included in `STOCK_VIEW_ROLES` | MATCH |
| engineer, service_eng | dash,**mymaterial** (self-service only) | none (no `canStock()`) | `listMyMaterial`/`requestReturn` require only self-ownership, no `MANAGE_ROLES` check | MATCH |
| sales, finance | no Inventory menu entries at all | n/a | not in `MANAGE_ROLES`; not in `STOCK_VIEW_ROLES`; unauthenticated-for-Inventory reads are not blocked at `listItems`/`listCategories`/`listLocations` (matches PWA: those reads are never role-gated client-side either -- company-wide `DB` is loaded for any logged-in user, gating is by menu visibility only) | MATCH |
| super | platform-level only, `co:0`, never a company member | n/a | never resolvable as `actorAuth.companyId`-scoped user | MATCH (unreachable in both) |

## Tests

Ran `npm test` in `new-app/backend/` via `device_bash`. Exact observed result:

```
1..313
# tests 313
# suites 0
# pass 313
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

313/313 passing, matching the stated baseline exactly. `new-app/backend/tests/inventoryService.test.js` (651 lines) contributes 50 of these subtests. No test file was modified, weakened, or added in this pass.

## Files

Only one file created/changed by this pass:
- `new-app/docs/E2E_PASS_3_6_INVENTORY.md` (this document)

No `new-app/` application source, no test file, no `v2/`, no `v3/`, no PWA file was modified.

## Deadline status
**ON TRACK**

## Safety

Commands run against the repo root via `device_bash`:

- `git diff --name-status -- v2` -> **37 files** (matches the existing, expected, unchanged V2 drift baseline).
- `git diff --name-status -- v3` -> **0 files** (matches expected: V3 untouched).
- `md5sum index.html MEP_PROJECTS_PWA/index.html` -> both **`111b53dba91704f96b83dae96c7793c6`** (matches required hash, and the two copies are identical to each other).
- `git diff --cached --name-status` -> **empty** (nothing staged).
- `git status --short` -> **95 entries**, all pre-existing uncommitted working-tree modifications this session did not create (this session made zero `Write`/`Edit` calls against the repo prior to this report; only reads and `npm test` were run). Composition: the same 37 `v2/`+root-level files already covered by the `v2` diff above, plus root-level app files (`App.js`, `app.json`, `index.html`, `index.js`, etc.) and `MEP_PROJECTS_PWA/*` that were already modified relative to `HEAD` before this pass started, plus untracked `new-app/`, `.tmp_lock_copy`, and `Claude outputs/`. This is reported plainly per instruction; it reflects pre-existing repo state carried in from before this pass, not an action taken during Phase A verification. `new-app/` itself is entirely untracked (`??`), i.e. never committed -- consistent with prior passes' state.

## Next gate
NEXT ALLOWED: PASS 3.7 — NOTIFICATIONS
