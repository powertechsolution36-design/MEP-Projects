'use strict';

const { ServiceError } = require('../errors');

/**
 * Inventory (Category/Location/Item/Issue/Transaction) business/application
 * layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_INVENTORY.md (741-line
 * independent functional audit of MEP_PROJECTS_PWA/index.html's Inventory
 * code, lines 2872-3480 + call sites) and new-app/docs/
 * INVENTORY_DECISION_LOCK.md (576 lines, 51 decisions, locking every item
 * the audit raised except 3-4 genuinely OPEN business decisions, listed
 * below). Every PWA-demonstrated behavior -- including its quirks -- is
 * reproduced exactly, per the locked "preserve PWA exactly" principle,
 * EXCEPT the approved infrastructure/security exceptions named throughout
 * (tenant isolation on every lookup, server-side role enforcement matching
 * PWA-visible intent, concurrency-safe stock mutation, transaction
 * atomicity for multi-write actions, durable ObjectId/User references).
 *
 * DO NOT FIX list (INVENTORY_DECISION_LOCK.md section 23) -- every one of these is
 * intentionally preserved, not corrected, by this module:
 *  - moveStock-equivalent clamps a location's stock to zero on any delta
 *    that would take it negative, INDEPENDENTLY of the separate pre-save
 *    "available quantity" checks that normally make the clamp unreachable
 *    (Decision 10) -- both mechanisms are implemented, not collapsed into one.
 *  - (RETIRED 26 Nov 2026 at the owner's request -- an item with no
 *    minimum used to be unable to read "Low Stock" at all, Decision 11.
 *    A house floor of five now applies to every item. See
 *    LOW_STOCK_FLOOR below and docs/INVENTORY_DECISION_LOCK.md.)
 *  - Return requests never move stock or write a ledger transaction --
 *    only the eventual accepted return does (Decision 16).
 *  - Repeated return-request calls on the same issue simply overwrite the
 *    prior request's fields, no guard, no history (Decision 17).
 *  - Rejecting a request clears returnRequested/requestedQuantity/
 *    requestNote but leaves requestedDate untouched (Decision 18).
 *  - Any issued material's balance is returnable regardless of the item's
 *    returnable flag -- that flag only affects the dashboard's
 *    "Returnable Material With Staff" PANEL filter, never the return
 *    ACTION itself (Decision 19).
 *  - Accepting a return unconditionally clears any pending return request
 *    on the row, whether or not that specific accept was triggered by it
 *    (Decision 21).
 *  - Damaged returns still increment quantityReturned (clearing the
 *    staff-side balance) even though stock is NOT credited; a
 *    "Damage / Write-off" transaction is written alongside the "Return"
 *    transaction -- no separate scrap-stock entity, no scrapQty field
 *    (Decision 23).
 *  - Marking material used NEVER calls the stock-mutation primitive a
 *    second time -- the only stock decrement happened once, at issue time
 *    (Decision 24) -- see markUsed()'s own comment; a dedicated regression
 *    test asserts this explicitly, per the task's instruction.
 *  - Mark-Used has no self-service path and fires no notification
 *    (Decision 25).
 *  - Same-location transfer is explicitly blocked; no notification is ever
 *    fired for Transfer (Decision 26).
 *  - The eight-type transaction enum is closed; InventoryTransaction is
 *    append-only -- no update/delete function is ever exposed (Decisions
 *    29-30).
 *  - The "Issue" transaction's logged date is always "today", never the
 *    issue's own (possibly backdated) date field (Decision 31).
 *  - Exact 5-event, no-dedup notification catalogue; low-stock notice
 *    fires ONLY from the Issue path, never Adjustment/Transfer/Return
 *    (Decisions 36-38).
 *  - The recipient candidate pool for issuance is every company role
 *    except admin (Decision 40).
 *  - No division concept anywhere (Decision 42); projectId remains
 *    write-only/non-functional (Decision 43); no structural ServiceCall
 *    link (Decision 44).
 *
 * GENUINELY OPEN decisions (INVENTORY_DECISION_LOCK.md section 28) -- NONE of
 * these is resolved by this module:
 *  1. InventoryCategory.name uniqueness -- NOT enforced (no unique index).
 *  2. InventoryLocation.name uniqueness -- NOT enforced (no unique index).
 *  3. Admin's missing Transfer-menu entry -- a frontend/UX presentation
 *     question only; this module's Transfer authorization is inventory/
 *     admin regardless (matching what canStock() would allow if reached).
 *  4. Item deletion vs. a future archive/guard state -- this module
 *     implements today's LOCKED DEFAULT (hard, unguarded delete, PRESERVE
 *     PWA), and does not foreclose a future, separate hardening decision.
 */

const MANAGE_ROLES = Object.freeze(['inventory', 'admin']);
// FIX-3.6-01 (P3): split into two role sets matching PWA's exact menu-gated
// access, traced fresh from index.html MENUS (L1289-1300). PWA's mep_pm menu
// (`[dash,projects,sos,checklists]`) never includes "stock" -- mep_pm never
// sees the Stock Report button. PWA's "invissue" menu entry (dlIssued()'s
// button) is visible only to admin/inventory, never hvac_pm/solar_pm/mep_pm/
// service_mgr. The old single STOCK_VIEW_ROLES over-granted both exports.
const STOCK_REPORT_ROLES = Object.freeze(['admin', 'inventory', 'hvac_pm', 'solar_pm', 'service_mgr']);
const ISSUED_REPORT_ROLES = Object.freeze(['admin', 'inventory']);
// Owner request (14 Nov 2026): the Solar Manager has Issue Material on its
// menu, so it may issue stock the way admin and the store can. Only issuing
// — the rest of the store (items, categories, locations, adjustments,
// transfers) stays with MANAGE_ROLES.
const ISSUE_ROLES = Object.freeze(['inventory', 'admin', 'solar_pm']);
const RECIPIENT_ROLES = Object.freeze(['sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance']);
const UNITS = Object.freeze(['Nos', 'Mtr', 'Kg', 'Set', 'Box', 'Roll', 'Ltr']);
const ADJUSTMENT_TYPES = Object.freeze(['Purchase In', 'Opening Stock', 'Damage / Write-off', 'Adjustment']);

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

/**
 * Issuing material only (owner request, 14 Nov 2026). Separate from
 * assertCanManageInventory so the Solar Manager gains the Issue Material
 * screen without gaining the rest of the store.
 */
function assertCanIssueInventory(actorAuth, actionDescription) {
  if (!ISSUE_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'issue material'} (must be ${ISSUE_ROLES.join(', ')}).`,
      'FORBIDDEN',
      403
    );
  }
}

function assertCanManageInventory(actorAuth, actionDescription) {
  if (!MANAGE_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'manage Inventory'} (must be inventory or admin).`,
      'FORBIDDEN',
      403
    );
  }
}

function assertCanViewStockReport(actorAuth, actionDescription) {
  if (!STOCK_REPORT_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'view the Inventory Stock report'}.`,
      'FORBIDDEN',
      403
    );
  }
}

function assertCanViewIssuedReport(actorAuth, actionDescription) {
  if (!ISSUED_REPORT_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'view the Issued Material report'}.`,
      'FORBIDDEN',
      403
    );
  }
}

/**
 * Every location / category id a client sends must belong to the caller's
 * company -- otherwise stock could be credited to, or an item filed under,
 * another tenant's location/category id.
 */
async function assertOwnLocation(companyId, locationId, deps) {
  if (!locationId) return;
  const loc = await deps.inventoryLocationRepo.findById(companyId, locationId);
  if (!loc) throw new ServiceError('Location not found.', 'NOT_FOUND', 404);
}

async function assertOwnCategory(companyId, categoryId, deps) {
  if (!categoryId) return;
  const cat = await deps.inventoryCategoryRepo.findById(companyId, categoryId);
  if (!cat) throw new ServiceError('Category not found.', 'NOT_FOUND', 404);
}

function todayDate() {
  return new Date();
}

function toNum(v) {
  return Number(v) || 0;
}

function stockEntries(stockByLocation) {
  if (!stockByLocation) return [];
  if (stockByLocation instanceof Map) return Array.from(stockByLocation.entries());
  return Object.entries(stockByLocation);
}

function stockAtLocation(item, locationId) {
  for (const [k, v] of stockEntries(item && item.stockByLocation)) {
    if (String(k) === String(locationId)) return toNum(v);
  }
  return 0;
}

function totQty(item) {
  let sum = 0;
  for (const [, v] of stockEntries(item && item.stockByLocation)) sum += toNum(v);
  return sum;
}

/*
 * Owner request (26 Nov 2026): "show low stock when anything is below 5
 * quantity." Until now an item with no minimum could never read Low --
 * a PWA quirk kept on purpose (Decision 11) -- and since every item on
 * file has no minimum, the warning had never once fired. The owner has
 * now set a house floor, so the quirk is retired: below five is low,
 * whatever the item.
 *
 * A minimum of its own still counts, and still wins when it is higher:
 * twenty refnuts can be low while four drills are not a worry.
 */
const LOW_STOCK_FLOOR = 5;

/** The level an item is judged against: its own, or the house floor. */
function effectiveMinimum(item) {
  return Math.max(toNum(item && item.minimumStockLevel), LOW_STOCK_FLOOR - 1);
}

function stockState(item) {
  const t = totQty(item);
  if (t <= 0) return { label: 'Out of Stock', cls: 'b-red', level: 2 };
  if (t <= effectiveMinimum(item)) return { label: 'Low Stock', cls: 'b-amb', level: 1 };
  return { label: 'In Stock', cls: 'b-grn', level: 0 };
}

function stockValue(item) {
  return totQty(item) * toNum(item.ratePerUnit);
}

function issBal(issue) {
  return Math.max(0, toNum(issue.quantityIssued) - toNum(issue.quantityReturned) - toNum(issue.quantityUsed));
}

function issStatus(issue) {
  if (issBal(issue) <= 0) {
    if (toNum(issue.quantityReturned) > 0) {
      return toNum(issue.quantityUsed) > 0 ? 'Returned / Used' : 'Returned';
    }
    return 'Consumed';
  }
  if (toNum(issue.quantityReturned) > 0) return 'Partially Returned';
  if (issue.returnRequested) return 'Return Requested';
  return 'Issued';
}

function issuedQtyForItem(itemId, issues) {
  return issues.filter((x) => String(x.itemId) === String(itemId)).reduce((sum, x) => sum + issBal(x), 0);
}

function lowStockItems(items) {
  return items.filter((i) => stockState(i).level > 0);
}

async function resolveUserName(companyId, userId, deps) {
  if (!userId || !deps.userRepoForEnquiry || typeof deps.userRepoForEnquiry.findById !== 'function') return '';
  const user = await deps.userRepoForEnquiry.findById(userId);
  if (!user || String(user.companyId) !== String(companyId)) return '';
  return user.name || '';
}

async function createCategory(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'create an Inventory category');
  const name = input && typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ServiceError('Category name required.', 'VALIDATION_ERROR', 400);
  return deps.inventoryCategoryRepo.create({ companyId: actorAuth.companyId, name });
}

async function listCategories(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  return deps.inventoryCategoryRepo.listByCompany(actorAuth.companyId);
}

async function renameCategory(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'rename an Inventory category');
  const category = await deps.inventoryCategoryRepo.findById(actorAuth.companyId, id);
  if (!category) throw new ServiceError('Category not found.', 'NOT_FOUND', 404);
  const name = input && typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ServiceError('Category name required.', 'VALIDATION_ERROR', 400);
  return deps.inventoryCategoryRepo.rename(actorAuth.companyId, id, name);
}

async function deleteCategory(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'delete an Inventory category');
  const category = await deps.inventoryCategoryRepo.findById(actorAuth.companyId, id);
  if (!category) throw new ServiceError('Category not found.', 'NOT_FOUND', 404);
  const items = await deps.inventoryItemRepo.listByCompany(actorAuth.companyId);
  const referenced = items.some((i) => i.categoryId && String(i.categoryId) === String(id));
  if (referenced) {
    throw new ServiceError('Move or delete items in this category first.', 'CATEGORY_IN_USE', 400);
  }
  await deps.inventoryCategoryRepo.remove(actorAuth.companyId, id);
  return { deleted: true };
}

async function createLocation(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'create an Inventory location');
  const name = input && typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ServiceError('Location name required.', 'VALIDATION_ERROR', 400);
  return deps.inventoryLocationRepo.create({ companyId: actorAuth.companyId, name });
}

async function listLocations(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  return deps.inventoryLocationRepo.listByCompany(actorAuth.companyId);
}

async function renameLocation(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'rename an Inventory location');
  const location = await deps.inventoryLocationRepo.findById(actorAuth.companyId, id);
  if (!location) throw new ServiceError('Location not found.', 'NOT_FOUND', 404);
  const name = input && typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ServiceError('Location name required.', 'VALIDATION_ERROR', 400);
  return deps.inventoryLocationRepo.rename(actorAuth.companyId, id, name);
}

async function deleteLocation(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'delete an Inventory location');
  const location = await deps.inventoryLocationRepo.findById(actorAuth.companyId, id);
  if (!location) throw new ServiceError('Location not found.', 'NOT_FOUND', 404);
  const items = await deps.inventoryItemRepo.listByCompany(actorAuth.companyId);
  const hasStock = items.some((i) => stockAtLocation(i, id) > 0);
  if (hasStock) {
    throw new ServiceError('Move the stock out of this location first.', 'LOCATION_HAS_STOCK', 400);
  }
  await deps.inventoryLocationRepo.remove(actorAuth.companyId, id);
  return { deleted: true };
}

function validateUnit(unit) {
  if (unit !== undefined && !UNITS.includes(unit)) {
    throw new ServiceError(`Invalid unit "${unit}". Must be one of: ${UNITS.join(', ')}.`, 'VALIDATION_ERROR', 400);
  }
}

/**
 * Which side of the business an item belongs to (owner request, 24 Nov
 * 2026): HVAC, Solar, MEP — or "Common", which says out loud that it is
 * everybody's rather than leaving the field blank and having people guess.
 *
 * Blank is still allowed and means nobody has said yet, which is every
 * item that was on file before the field existed.
 */
const ITEM_DIVISIONS = Object.freeze(['HVAC', 'Solar', 'MEP', 'Common']);
function validateItemDivision(value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (v && !ITEM_DIVISIONS.includes(v)) {
    throw new ServiceError(`Division must be one of ${ITEM_DIVISIONS.join(', ')}.`, 'VALIDATION_ERROR', 400);
  }
  return v;
}


/**
 * The drawers of the Stock screen, and the shelves inside Machines
 * (owner request, 26 Nov 2026). The screen shows one drawer at a time:
 * standing in Machines you see machines, not refnuts or boards.
 *
 * Blank is allowed and means nobody has sorted the item yet. Those are
 * gathered under "Not sorted yet" rather than hidden -- 19 Nov taught us
 * what a silent filter does to a list.
 */
const ITEM_GROUPS = Object.freeze(['Machines', 'Piping & Refnuts', 'PCB', 'Permanent Stock']);
/*
 * A split is sold as a set -- "1 split indoor needs 1 outdoor" -- so the
 * two halves are shelved apart and the screen pairs them back up through
 * fitsItemIds. Hence Split Indoor and Split Outdoor rather than one
 * "Split" shelf: without the distinction there is no way to count sets.
 */
const MACHINE_SUBGROUPS = Object.freeze([
  'Indoor', 'Outdoor', 'Panels', 'Remote', 'Split Indoor', 'Split Outdoor',
]);
/*
 * Owner request (26 Nov 2026): shelves inside Piping & Refnuts as well.
 * "Other" is deliberate -- a drawer with no home for the odd item ends
 * up with everything filed wrongly rather than filed honestly.
 */
const PIPING_SUBGROUPS = Object.freeze([
  'Copper Piping', 'Refnuts', 'Joints', 'Drain', 'Other',
]);
/* Which shelves each drawer has. A drawer absent here has none. */
const SUBGROUPS_BY_GROUP = Object.freeze({
  Machines: MACHINE_SUBGROUPS,
  'Piping & Refnuts': PIPING_SUBGROUPS,
});

function validateItemGroup(value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (v && !ITEM_GROUPS.includes(v)) {
    throw new ServiceError(`Group must be one of ${ITEM_GROUPS.join(', ')}.`, 'VALIDATION_ERROR', 400);
  }
  return v;
}

/**
 * A shelf only exists inside Machines. Asking for "Indoor" on a PCB is a
 * mistake worth refusing rather than quietly dropping, because the item
 * would then sit in a drawer the owner never meant.
 */
function validateSubGroup(value, group) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (!v) return '';
  const allowed = SUBGROUPS_BY_GROUP[group];
  if (!allowed) {
    throw new ServiceError(
      `${group || 'An ungrouped item'} has no shelves.`, 'VALIDATION_ERROR', 400
    );
  }
  if (!allowed.includes(v)) {
    throw new ServiceError(
      `A ${group} sub-group must be one of ${allowed.join(', ')}.`, 'VALIDATION_ERROR', 400
    );
  }
  return v;
}

/**
 * Which units a part fits. Every id must be this company's own item, and
 * an item cannot be said to fit itself.
 */
async function readFitsItemIds(value, companyId, selfId, deps) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const ids = [];
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!id) continue;
    if (selfId && String(selfId) === id) {
      throw new ServiceError('An item cannot fit itself.', 'VALIDATION_ERROR', 400);
    }
    if (ids.includes(id)) continue;
    const other = await deps.inventoryItemRepo.findById(companyId, id);
    if (!other) throw new ServiceError('One of the units chosen is not on file.', 'NOT_FOUND', 404);
    ids.push(id);
  }
  if (ids.length > 50) {
    throw new ServiceError('That is more units than one part can list.', 'VALIDATION_ERROR', 400);
  }
  return ids;
}

async function createItem(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'create an Inventory item');
  const src = input || {};
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!name) throw new ServiceError('Item name required.', 'VALIDATION_ERROR', 400);
  const unit = src.unit || 'Nos';
  validateUnit(unit);

  let categoryId = src.categoryId || null;
  await assertOwnCategory(actorAuth.companyId, categoryId, deps);
  if (!categoryId) {
    const categories = await deps.inventoryCategoryRepo.listByCompany(actorAuth.companyId);
    categoryId = categories.length ? categories[0].id : null;
  }

  // openingStock: { <locationId>: qty } (PWA FACT: per-location opening
  // entry, index.html:2950-2953). Also accepts the single-location form
  // { openingStock: <qty>, openingLocationId } some clients send.
  let openingStockInput = src.openingStock || src.stock || {};
  if (typeof openingStockInput !== 'object') {
    openingStockInput = src.openingLocationId ? { [src.openingLocationId]: openingStockInput } : {};
  }
  // Which drawer it belongs in, and -- for a machine -- which shelf.
  const group = validateItemGroup(src.group);
  const subGroup = validateSubGroup(src.subGroup, group);
  const fitsItemIds = await readFitsItemIds(src.fitsItemIds, actorAuth.companyId, null, deps);
  /*
   * Permanent Stock IS the returnable drawer -- that is what the owner
   * asked for ("can be used on site and again return back to office"),
   * so choosing it decides `returnable` rather than leaving two switches
   * that can disagree with each other.
   */
  const returnable = group === 'Permanent Stock' ? true : !!src.returnable;

  const stockByLocation = {};
  for (const [locId, qty] of Object.entries(openingStockInput)) {
    const n = toNum(qty);
    if (n < 0) throw new ServiceError('Opening stock cannot be negative.', 'VALIDATION_ERROR', 400);
    if (n !== 0) {
      await assertOwnLocation(actorAuth.companyId, locId, deps);
      stockByLocation[String(locId)] = n;
    }
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const item = await txnDeps.inventoryItemRepo.create(
      {
        companyId: actorAuth.companyId,
        code: src.code || '',
        name,
        categoryId,
        unit,
        returnable,
        minimumStockLevel: toNum(src.minimumStockLevel),
        ratePerUnit: toNum(src.ratePerUnit),
        division: validateItemDivision(src.division),
        group,
        subGroup,
        fitsItemIds,
        stockByLocation,
      },
      session
    );
    for (const [locId, qty] of Object.entries(stockByLocation)) {
      await txnDeps.inventoryTransactionRepo.create(
        {
          companyId: actorAuth.companyId,
          date: todayDate(),
          type: 'Opening Stock',
          itemId: item.id,
          quantity: Math.abs(qty),
          fromLocationId: null,
          toLocationId: locId,
          recordedByUserId: actorAuth.userId,
          referenceText: '',
          remark: 'opening balance',
        },
        session
      );
    }
    return item;
  });
}

async function listItems(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  return deps.inventoryItemRepo.listByCompany(actorAuth.companyId);
}

async function getItem(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const item = await deps.inventoryItemRepo.findById(actorAuth.companyId, id);
  if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
  return item;
}

async function updateItem(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'edit an Inventory item');
  const item = await deps.inventoryItemRepo.findById(actorAuth.companyId, id);
  if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
  const src = input || {};
  const patch = {};
  if (src.code !== undefined) patch.code = src.code;
  if (src.name !== undefined) {
    const name = String(src.name).trim();
    if (!name) throw new ServiceError('Item name required.', 'VALIDATION_ERROR', 400);
    patch.name = name;
  }
  if (src.categoryId !== undefined) {
    await assertOwnCategory(actorAuth.companyId, src.categoryId, deps);
    patch.categoryId = src.categoryId || null;
  }
  if (src.unit !== undefined) {
    validateUnit(src.unit);
    patch.unit = src.unit;
  }
  if (src.returnable !== undefined) patch.returnable = !!src.returnable;
  if (src.division !== undefined) patch.division = validateItemDivision(src.division);
  // The drawer, the shelf, and the units a part fits. The sub-group is
  // checked against the group the item will END UP with, not the one it
  // had, so moving a machine out of Machines clears its shelf with it.
  const nextGroup = src.group !== undefined ? validateItemGroup(src.group) : (item.group || '');
  if (src.group !== undefined) {
    patch.group = nextGroup;
    // A shelf belongs to one drawer, so moving drawers drops it unless
    // the new drawer happens to have a shelf of the same name.
    const keeps = SUBGROUPS_BY_GROUP[nextGroup] || [];
    if (!keeps.includes(item.subGroup || '')) patch.subGroup = '';
    if (nextGroup === 'Permanent Stock') patch.returnable = true;
  }
  if (src.subGroup !== undefined) patch.subGroup = validateSubGroup(src.subGroup, nextGroup);
  if (src.fitsItemIds !== undefined) {
    patch.fitsItemIds = await readFitsItemIds(src.fitsItemIds, actorAuth.companyId, id, deps);
  }
  if (src.minimumStockLevel !== undefined) patch.minimumStockLevel = toNum(src.minimumStockLevel);
  if (src.ratePerUnit !== undefined) patch.ratePerUnit = toNum(src.ratePerUnit);
  return deps.inventoryItemRepo.update(actorAuth.companyId, id, patch);
}

async function deleteItem(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'delete an Inventory item');
  const item = await deps.inventoryItemRepo.findById(actorAuth.companyId, id);
  if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
  await deps.inventoryItemRepo.remove(actorAuth.companyId, id);
  return { deleted: true };
}

async function adjustStock(itemId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'adjust Inventory stock');
  const src = input || {};
  if (!ADJUSTMENT_TYPES.includes(src.type)) {
    throw new ServiceError(`Invalid adjustment type "${src.type}". Must be one of: ${ADJUSTMENT_TYPES.join(', ')}.`, 'VALIDATION_ERROR', 400);
  }
  const q = Number(src.quantity);
  if (!q) throw new ServiceError('A non-zero quantity is required.', 'VALIDATION_ERROR', 400);
  if (!src.locationId) throw new ServiceError('Location required.', 'VALIDATION_ERROR', 400);
  await assertOwnLocation(actorAuth.companyId, src.locationId, deps);

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const item = await txnDeps.inventoryItemRepo.findById(actorAuth.companyId, itemId, session);
    if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
    const current = stockAtLocation(item, src.locationId);
    if (current + q < 0) {
      throw new ServiceError('This adjustment would take the location below zero stock.', 'INSUFFICIENT_STOCK', 400);
    }
    const updated = await txnDeps.inventoryItemRepo.incrementStockAtLocation(actorAuth.companyId, itemId, src.locationId, q, session);
    await txnDeps.inventoryTransactionRepo.create(
      {
        companyId: actorAuth.companyId,
        date: todayDate(),
        type: src.type,
        itemId,
        quantity: Math.abs(q),
        fromLocationId: q < 0 ? src.locationId : null,
        toLocationId: q > 0 ? src.locationId : null,
        recordedByUserId: actorAuth.userId,
        referenceText: src.reference || '',
        remark: src.remark || '',
      },
      session
    );
    return updated;
  });
}

async function issueMaterial(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanIssueInventory(actorAuth, 'issue Inventory material');
  const src = input || {};
  const q = Number(src.quantity);
  if (!(q > 0)) throw new ServiceError('Quantity must be greater than zero.', 'VALIDATION_ERROR', 400);
  if (!src.itemId) throw new ServiceError('Item required.', 'VALIDATION_ERROR', 400);
  if (!src.fromLocationId) throw new ServiceError('From-location required.', 'VALIDATION_ERROR', 400);
  if (!src.staffId) throw new ServiceError('Recipient (staff) required.', 'VALIDATION_ERROR', 400);
  if (!src.site) throw new ServiceError('Site required.', 'VALIDATION_ERROR', 400);
  await assertOwnLocation(actorAuth.companyId, src.fromLocationId, deps);
  if (src.projectId) {
    // PWA FACT (mIssue, index.html:3015-3020): the site is picked from the
    // company's own open projects; a linked project must be this tenant's.
    const project = deps.projectRepo && (await deps.projectRepo.findById(actorAuth.companyId, src.projectId));
    if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  }

  const staff = deps.userRepoForEnquiry && (await deps.userRepoForEnquiry.findById(src.staffId));
  if (!staff || String(staff.companyId) !== String(actorAuth.companyId)) {
    throw new ServiceError('Recipient not found.', 'NOT_FOUND', 404);
  }
  if (!RECIPIENT_ROLES.includes(staff.role)) {
    throw new ServiceError(
      `User's role "${staff.role}" is not a valid Inventory issue recipient (every role except admin is eligible).`,
      'VALIDATION_ERROR',
      400
    );
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const item = await txnDeps.inventoryItemRepo.findById(actorAuth.companyId, src.itemId, session);
    if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
    const available = stockAtLocation(item, src.fromLocationId);
    if (q > available) {
      throw new ServiceError(`Only ${available} ${item.unit} available at this location.`, 'INSUFFICIENT_STOCK', 400);
    }
    const updatedItem = await txnDeps.inventoryItemRepo.incrementStockAtLocation(actorAuth.companyId, src.itemId, src.fromLocationId, -q, session);

    const issue = await txnDeps.inventoryIssueRepo.create(
      {
        companyId: actorAuth.companyId,
        itemId: src.itemId,
        quantityIssued: q,
        staffId: src.staffId,
        site: src.site,
        projectId: src.projectId || null,
        fromLocationId: src.fromLocationId,
        date: src.date ? new Date(src.date) : todayDate(),
        returnable: !!item.returnable,
        quantityReturned: 0,
        quantityUsed: 0,
        status: 'Issued',
        returnRequested: false,
        requestedQuantity: null,
        requestedDate: null,
        requestNote: null,
        issuedByUserId: actorAuth.userId,
        remark: src.remark || null,
      },
      session
    );

    await txnDeps.inventoryTransactionRepo.create(
      {
        companyId: actorAuth.companyId,
        date: todayDate(),
        type: 'Issue',
        itemId: src.itemId,
        quantity: q,
        fromLocationId: src.fromLocationId,
        toLocationId: null,
        recordedByUserId: actorAuth.userId,
        referenceText: `${staff.name} / ${src.site}`,
        remark: src.remark || '',
      },
      session
    );

    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `Material issued to ${staff.name}: ${q} ${item.unit} ${item.name} for ${src.site}${item.returnable ? ' (returnable)' : ''}`,
        date: todayDate(),
        targetRoles: ['*'],
        readByUserIds: [],
        // Phone push goes to the staff member who received it (owner decision 21 Oct 2026).
        push: { userIds: [staff.id], path: '/my-material' },
      },
      session
    );

    const state = stockState(updatedItem);
    if (state.level > 0) {
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `⚠ ${state.label}: ${item.name} — ${totQty(updatedItem)} ${item.unit} left (min ${effectiveMinimum(item)})`,
          date: todayDate(),
          targetRoles: ['inventory', 'admin'],
          readByUserIds: [],
        },
        session
      );
    }

    return { issue, item: updatedItem };
  });
}

async function requestReturn(issueId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const issue = await deps.inventoryIssueRepo.findById(actorAuth.companyId, issueId);
  if (!issue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);
  if (String(issue.staffId) !== String(actorAuth.userId)) {
    throw new ServiceError('You can only request a return for material issued to you.', 'FORBIDDEN', 403);
  }
  const balance = issBal(issue);
  const q = Number(input && input.quantity);
  if (!(q >= 1) || q > balance) {
    throw new ServiceError(`Quantity must be between 1 and the current balance (${balance}).`, 'VALIDATION_ERROR', 400);
  }
  const note = (input && input.note) || '';

  const patch = { returnRequested: true, requestedQuantity: q, requestedDate: todayDate(), requestNote: note };
  patch.status = issStatus({ ...issue, ...patch });
  const updated = await deps.inventoryIssueRepo.update(actorAuth.companyId, issueId, patch);

  const item = await deps.inventoryItemRepo.findById(actorAuth.companyId, issue.itemId);
  await deps.notificationRepo.create({
    companyId: actorAuth.companyId,
    text: `📥 Return request: ${actorAuth.name || ''} is returning ${q} ${(item && item.unit) || ''} ${(item && item.name) || ''} from ${issue.site}${note ? ' — ' + note : ''}`,
    date: todayDate(),
    targetRoles: ['inventory', 'admin'],
    readByUserIds: [],
  });

  return updated;
}

async function acceptReturn(issueId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'accept a returned Inventory issue');
  const src = input || {};
  // Pre-check (fast-fail before opening a transaction) -- kept only as an
  // early user-facing rejection; NOT the authoritative guard (see FIX-5-01
  // below, which is what actually protects against a concurrent accept).
  const precheckIssue = await deps.inventoryIssueRepo.findById(actorAuth.companyId, issueId);
  if (!precheckIssue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);
  const precheckBalance = issBal(precheckIssue);
  const q = Number(src.quantity);
  if (!(q >= 1) || q > precheckBalance) {
    throw new ServiceError(`Quantity must be between 1 and the current balance (${precheckBalance}).`, 'VALIDATION_ERROR', 400);
  }
  const damaged = !!src.damaged;
  // toLocationId (API name) or locationId (frontend name); defaults to the
  // location the material was issued from.
  const toLocationId = src.toLocationId || src.locationId || precheckIssue.fromLocationId;
  await assertOwnLocation(actorAuth.companyId, toLocationId, deps);
  const markRemainingUsed = !!src.markRemainingUsed;

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // FIX-5-01 (STEP_5_CONCURRENCY_ATOMICITY.md): re-fetch the Issue AND
    // re-validate its balance fresh, inside the transaction, on every
    // attempt (including retries after a write-conflict). The pre-check
    // above can be stale by the time this runs -- e.g. two concurrent
    // accepts against the same Issue must each see the OTHER's
    // already-committed return before computing quantityReturned/
    // quantityUsed, or the loser's stale-snapshot patch silently
    // overwrites the winner's committed ledger values and credits stock
    // that was never actually returned (phantom stock).
    const issue = await txnDeps.inventoryIssueRepo.findById(actorAuth.companyId, issueId, session);
    if (!issue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);
    const balance = issBal(issue);
    if (!(q >= 1) || q > balance) {
      throw new ServiceError(`Quantity must be between 1 and the current balance (${balance}).`, 'VALIDATION_ERROR', 400);
    }
    const item = await txnDeps.inventoryItemRepo.findById(actorAuth.companyId, issue.itemId, session);
    if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
    const staffName = await resolveUserName(actorAuth.companyId, issue.staffId, txnDeps);

    let updatedItem = item;
    if (!damaged) {
      updatedItem = await txnDeps.inventoryItemRepo.incrementStockAtLocation(actorAuth.companyId, issue.itemId, toLocationId, q, session);
    }

    const remainingBalance = Math.max(0, balance - q);
    const newRqty = toNum(issue.quantityReturned) + q;
    let newUsed = toNum(issue.quantityUsed);
    if (markRemainingUsed && remainingBalance > 0) newUsed += remainingBalance;

    const patch = {
      quantityReturned: newRqty,
      quantityUsed: newUsed,
      returnRequested: false,
      requestedQuantity: 0,
    };
    patch.status = issStatus({ ...issue, ...patch });
    const updatedIssue = await txnDeps.inventoryIssueRepo.update(actorAuth.companyId, issueId, patch, session);

    // PWA FACT (saveInvReturn, index.html:3110): exact wording incl. em dash.
    const returnRemark = (damaged ? 'DAMAGED — not added to stock. ' : '') + (src.remark || '');
    await txnDeps.inventoryTransactionRepo.create(
      {
        companyId: actorAuth.companyId,
        date: todayDate(),
        type: 'Return',
        itemId: issue.itemId,
        quantity: q,
        fromLocationId: null,
        toLocationId: damaged ? null : toLocationId,
        recordedByUserId: actorAuth.userId,
        referenceText: staffName,
        remark: returnRemark,
      },
      session
    );
    if (damaged) {
      await txnDeps.inventoryTransactionRepo.create(
        {
          companyId: actorAuth.companyId,
          date: todayDate(),
          type: 'Damage / Write-off',
          itemId: issue.itemId,
          quantity: q,
          fromLocationId: null,
          toLocationId: null,
          recordedByUserId: actorAuth.userId,
          referenceText: staffName,
          remark: 'damaged material returned',
        },
        session
      );
    }
    if (markRemainingUsed && remainingBalance > 0) {
      await txnDeps.inventoryTransactionRepo.create(
        {
          companyId: actorAuth.companyId,
          date: todayDate(),
          type: 'Consumed',
          itemId: issue.itemId,
          quantity: remainingBalance,
          fromLocationId: null,
          toLocationId: null,
          recordedByUserId: actorAuth.userId,
          referenceText: `${staffName} / ${issue.site}`,
          remark: 'balance marked used on site',
        },
        session
      );
    }

    const finalBalance = issBal(updatedIssue);
    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `Material returned by ${staffName}: ${q} ${item.unit} ${item.name}${finalBalance > 0 ? ` — ${finalBalance} ${item.unit} still pending` : ' — issue closed'}`,
        date: todayDate(),
        targetRoles: ['*'],
        readByUserIds: [],
        // Phone push goes to the store and admin (owner decision 21 Oct 2026).
        push: { roles: ['inventory', 'admin'], path: '/inventory/returns' },
      },
      session
    );

    return { issue: updatedIssue, item: updatedItem };
  });
}

async function rejectReturn(issueId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'reject an Inventory return request');
  const issue = await deps.inventoryIssueRepo.findById(actorAuth.companyId, issueId);
  if (!issue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);

  const patch = { returnRequested: false, requestedQuantity: 0, requestNote: null };
  patch.status = issStatus({ ...issue, ...patch });
  const updated = await deps.inventoryIssueRepo.update(actorAuth.companyId, issueId, patch);

  const item = await deps.inventoryItemRepo.findById(actorAuth.companyId, issue.itemId);
  const staffName = await resolveUserName(actorAuth.companyId, issue.staffId, deps);
  await deps.notificationRepo.create({
    companyId: actorAuth.companyId,
    text: `Return request for ${(item && item.name) || ''} from ${staffName} was not accepted — please check with the store.`,
    date: todayDate(),
    targetRoles: ['*'],
    readByUserIds: [],
    // Phone push goes to the staff member whose return was refused (owner decision 21 Oct 2026).
    push: { userIds: [issue.staffId], path: '/my-material' },
  });

  return updated;
}

async function markUsed(issueId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'mark Inventory material used');
  const src = input || {};
  // Pre-check (fast-fail before opening a transaction) -- kept only as an
  // early user-facing rejection; NOT the authoritative guard (see FIX-5-01
  // below, which is what actually protects against a concurrent call).
  const precheckIssue = await deps.inventoryIssueRepo.findById(actorAuth.companyId, issueId);
  if (!precheckIssue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);
  const precheckBalance = issBal(precheckIssue);
  const q = Number(src.quantity);
  if (!(q >= 1) || q > precheckBalance) {
    throw new ServiceError(`Quantity must be between 1 and the current balance (${precheckBalance}).`, 'VALIDATION_ERROR', 400);
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // FIX-5-01 (STEP_5_CONCURRENCY_ATOMICITY.md): re-fetch the Issue AND
    // re-validate its balance fresh, inside the transaction, on every
    // attempt (including retries after a write-conflict) -- see the
    // matching comment in acceptReturn() above for why the pre-check alone
    // is not safe: two concurrent Mark-Used calls against the same Issue
    // must each see the OTHER's already-committed quantityUsed before
    // computing their own new total, or the loser's stale-snapshot patch
    // silently overwrites (loses) the winner's committed value.
    const issue = await txnDeps.inventoryIssueRepo.findById(actorAuth.companyId, issueId, session);
    if (!issue) throw new ServiceError('Issue not found.', 'NOT_FOUND', 404);
    const balance = issBal(issue);
    if (!(q >= 1) || q > balance) {
      throw new ServiceError(`Quantity must be between 1 and the current balance (${balance}).`, 'VALIDATION_ERROR', 400);
    }
    const item = await txnDeps.inventoryItemRepo.findById(actorAuth.companyId, issue.itemId, session);
    if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
    const staffName = await resolveUserName(actorAuth.companyId, issue.staffId, txnDeps);

    const newUsed = toNum(issue.quantityUsed) + q;
    const patch = { quantityUsed: newUsed };
    patch.status = issStatus({ ...issue, ...patch });
    // NOTE: deliberately no inventoryItemRepo.incrementStockAtLocation call
    // anywhere in this function (PWA FACT, Decision 24 -- see module header).
    const updatedIssue = await txnDeps.inventoryIssueRepo.update(actorAuth.companyId, issueId, patch, session);

    await txnDeps.inventoryTransactionRepo.create(
      {
        companyId: actorAuth.companyId,
        date: todayDate(),
        type: 'Consumed',
        itemId: issue.itemId,
        quantity: q,
        fromLocationId: null,
        toLocationId: null,
        recordedByUserId: actorAuth.userId,
        referenceText: `${staffName} / ${issue.site}`,
        remark: src.remark || 'used on site',
      },
      session
    );

    return updatedIssue;
  });
}

/**
 * The stock point this end of a transfer means.
 *
 * Owner request (21 Nov 2026): "or Customer name or site Name will Show in
 * Stock transfer in from location and To location." Stock does sit at a
 * job — the model has always called a location "a godown, site store or
 * service van" — but a site only became one if somebody remembered to add
 * it under Categories & Locations first.
 *
 * So a transfer may name its end instead of choosing an id, and a name we
 * do not hold yet becomes a stock point as the transfer is made. Matching
 * ignores case and spacing, so "KP87" does not become a second "kp87".
 */
async function resolveTransferLocation(value, actorAuth, deps) {
  const id = value && value.id ? String(value.id) : '';
  if (id) {
    await assertOwnLocation(actorAuth.companyId, id, deps);
    return id;
  }
  const name = String((value && value.name) || '').trim();
  if (!name) return '';
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  const existing = (await deps.inventoryLocationRepo.listByCompany(actorAuth.companyId))
    .find((l) => String(l.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === key);
  if (existing) return String(existing.id);
  const made = await deps.inventoryLocationRepo.create({ companyId: actorAuth.companyId, name });
  return String(made.id);
}

async function transferStock(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'transfer Inventory stock');
  const src = input || {};
  if (!src.itemId) throw new ServiceError('Item required.', 'VALIDATION_ERROR', 400);
  // Either end may arrive as a name — a customer or a site — rather than as
  // a stock point already on file.
  src.fromLocationId = await resolveTransferLocation(
    { id: src.fromLocationId, name: src.fromLocationName }, actorAuth, deps
  );
  src.toLocationId = await resolveTransferLocation(
    { id: src.toLocationId, name: src.toLocationName }, actorAuth, deps
  );
  if (!src.fromLocationId || !src.toLocationId) {
    throw new ServiceError('From and To locations are both required.', 'VALIDATION_ERROR', 400);
  }
  if (String(src.fromLocationId) === String(src.toLocationId)) {
    throw new ServiceError('From and To locations must be different.', 'VALIDATION_ERROR', 400);
  }
  const q = Number(src.quantity);
  if (!(q > 0)) throw new ServiceError('Quantity must be greater than zero.', 'VALIDATION_ERROR', 400);

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const item = await txnDeps.inventoryItemRepo.findById(actorAuth.companyId, src.itemId, session);
    if (!item) throw new ServiceError('Item not found.', 'NOT_FOUND', 404);
    const available = stockAtLocation(item, src.fromLocationId);
    if (q > available) {
      throw new ServiceError(`Only ${available} ${item.unit} available at the From location.`, 'INSUFFICIENT_STOCK', 400);
    }
    await txnDeps.inventoryItemRepo.incrementStockAtLocation(actorAuth.companyId, src.itemId, src.fromLocationId, -q, session);
    const updatedItem = await txnDeps.inventoryItemRepo.incrementStockAtLocation(actorAuth.companyId, src.itemId, src.toLocationId, q, session);

    await txnDeps.inventoryTransactionRepo.create(
      {
        companyId: actorAuth.companyId,
        date: todayDate(),
        type: 'Transfer',
        itemId: src.itemId,
        quantity: q,
        fromLocationId: src.fromLocationId,
        toLocationId: src.toLocationId,
        recordedByUserId: actorAuth.userId,
        referenceText: src.reference || '',
        remark: src.remark || '',
      },
      session
    );
    return updatedItem;
  });
}

async function getDashboard(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'view the Inventory dashboard');
  const [items, categories, issues] = await Promise.all([
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    deps.inventoryCategoryRepo.listByCompany(actorAuth.companyId),
    deps.inventoryIssueRepo.listByCompany(actorAuth.companyId),
  ]);
  const lowOrOut = lowStockItems(items);
  const outCount = items.filter((i) => totQty(i) <= 0).length;
  const lowCount = lowOrOut.length - outCount;
  const stockValueSum = items.reduce((sum, i) => sum + stockValue(i), 0);
  const materialWithStaff = issues.filter((x) => issBal(x) > 0 && issStatus(x) !== 'Returned').length;
  const returnRequests = issues.filter((x) => x.returnRequested && issBal(x) > 0).length;

  const catName = new Map(categories.map((c) => [String(c.id), c.name]));
  return {
    // PWA FACT (invDash, index.html:2873-2877): Low / Out of Stock table.
    lowStockList: lowOrOut.map((i) => {
      const st = stockState(i);
      return {
        id: i.id, code: i.code || '', name: i.name, category: catName.get(String(i.categoryId)) || '',
        // The level it is actually judged against, so the table and the
        // badge cannot disagree with each other.
        inStock: totQty(i), unit: i.unit, min: effectiveMinimum(i),
        shortfall: Math.max(0, effectiveMinimum(i) - totQty(i)), status: st.label, level: st.level,
      };
    }),
    totalItems: items.length,
    categories: categories.length,
    stockValue: stockValueSum,
    lowStock: lowCount,
    outOfStock: outCount,
    materialWithStaff,
    returnRequests,
  };
}

async function listMyMaterial(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const [issues, items] = await Promise.all([
    deps.inventoryIssueRepo.listByStaff(actorAuth.companyId, actorAuth.userId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  return issues.map((x) => {
    const item = itemById.get(String(x.itemId)) || {};
    // PWA FACT (vMyMaterial, index.html:3241-3260): shows item name/unit.
    return { ...x, itemName: item.name || '', itemCode: item.code || '', unit: item.unit || '', balance: issBal(x), status: issStatus(x) };
  });
}

/**
 * PWA FACT (vIssue / vReturns, index.html:3022-3044, 3264-3307): the store
 * sees every issue of the company with its balance/status and the Return /
 * Receive / Reject / Mark Used actions. Company-scoped; inventory/admin.
 * filters: { open: true } -> only issues with a balance still out;
 * { returnRequested: true } -> only pending return requests.
 */
async function listIssues(actorAuth, filters, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'view issued material');
  const f = filters || {};
  const [issues, items, maps] = await Promise.all([
    deps.inventoryIssueRepo.listByCompany(actorAuth.companyId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  return issues
    .map((x) => {
      const item = itemById.get(String(x.itemId)) || {};
      return {
        ...x,
        itemName: item.name || '',
        itemCode: item.code || '',
        unit: item.unit || '',
        staffName: maps.userName.get(String(x.staffId)) || '',
        issuedByName: maps.userName.get(String(x.issuedByUserId)) || '',
        fromLocationName: maps.locName.get(String(x.fromLocationId)) || '',
        balance: issBal(x),
        status: issStatus(x),
      };
    })
    .filter((x) => !f.open || x.balance > 0)
    .filter((x) => !f.returnRequested || (x.returnRequested && x.balance > 0))
    .reverse(); // newest first, as the PWA lists `.slice().reverse()`
}

/**
 * Where material can be issued to.
 *
 * PWA FACT (siteList(), index.html:3016-3021): the projects that are not
 * yet "In Service", the open service calls, then "Office / Godown". Only a
 * project carries a projectId link, which is what ties issued material to
 * the job it was issued for.
 *
 * Owner request (21 Nov 2026): "In inventory use location from Won
 * Enquiries, Sales Order, AMC PM/List, Client, Project." Material goes out
 * to jobs that have no project record yet — a lead just won, an order
 * raised this morning, an AMC site — and storekeepers were typing those by
 * hand or picking the nearest wrong thing. Every place the company already
 * keeps a site name now feeds this list.
 *
 * Each entry says which list it came from, so the picker can group them.
 * A name already on the list is not repeated: the first source wins, and
 * projects come first precisely so that a name they share keeps the
 * project link rather than losing it to a plain label.
 */
async function listSiteOptions(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'list issue sites');
  const list = (repo) => (repo && repo.listByCompany ? repo.listByCompany(actorAuth.companyId) : []);
  const [projects, calls, salesOrders, enquiries, contracts, clients] = await Promise.all([
    list(deps.projectRepo), list(deps.serviceCallRepo), list(deps.salesOrderRepo),
    list(deps.enquiryRepo), list(deps.contractRepo), list(deps.clientRepo),
  ]);

  const sites = [];
  const seen = new Set();
  const add = (label, group, projectId = null) => {
    const text = String(label === undefined || label === null ? '' : label).trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    sites.push({ label: text, group, projectId });
  };

  for (const p of projects.filter((x) => x.status !== 'In Service')) add(p.name, 'Projects', p.id);
  for (const s of salesOrders) add(s.projectName, 'Sales Orders');
  for (const e of enquiries.filter((x) => x.status === 'Won')) add(e.name, 'Won Enquiries');
  for (const c of contracts) add(c.site, 'AMC / PM');
  for (const c of clients) add(c.companyName || c.clientName, 'Clients');
  for (const c of calls.filter((x) => x.status !== 'Completed')) {
    add(`Service - ${c.site} (PSC-${c.complaintNumber})`, 'Service Calls');
  }
  add('Office / Godown', 'Other');
  return sites;
}

/** PWA FACT (vInvHistory / vInvItem, index.html:2971-2992): on-screen ledger. */
async function listTransactions(actorAuth, filters, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'view the Inventory ledger');
  const f = filters || {};
  const [txns, items, maps] = await Promise.all([
    f.itemId
      ? deps.inventoryTransactionRepo.listByItem(actorAuth.companyId, f.itemId)
      : deps.inventoryTransactionRepo.listByCompany(actorAuth.companyId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  return txns
    .map((t) => {
      const item = itemById.get(String(t.itemId)) || {};
      return {
        ...t,
        itemName: item.name || '',
        itemCode: item.code || '',
        unit: item.unit || '',
        fromLocationName: t.fromLocationId ? maps.locName.get(String(t.fromLocationId)) || '' : '',
        toLocationName: t.toLocationId ? maps.locName.get(String(t.toLocationId)) || '' : '',
        recordedByName: maps.userName.get(String(t.recordedByUserId)) || '',
      };
    })
    .reverse();
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function nameMaps(actorAuth, deps) {
  const [categories, locations, users] = await Promise.all([
    deps.inventoryCategoryRepo.listByCompany(actorAuth.companyId),
    deps.inventoryLocationRepo.listByCompany(actorAuth.companyId),
    deps.userRepoForEnquiry && typeof deps.userRepoForEnquiry.listByCompany === 'function'
      ? deps.userRepoForEnquiry.listByCompany(actorAuth.companyId)
      : Promise.resolve([]),
  ]);
  return {
    catName: new Map(categories.map((c) => [String(c.id), c.name])),
    locName: new Map(locations.map((l) => [String(l.id), l.name])),
    userName: new Map(users.map((u) => [String(u.id), u.name])),
    locations,
  };
}

async function exportStockCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanViewStockReport(actorAuth, 'export the Inventory Stock report');
  const [items, issues, maps] = await Promise.all([
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    deps.inventoryIssueRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const locations = maps.locations;
  // 'Division' joined the item on 24 Nov 2026 — HVAC, Solar, MEP or Common.
  // 'Group'/'Sub-group' joined on 26 Nov 2026 — the Stock screen's drawers.
  const itemName = new Map(items.map((i) => [String(i.id), i.name]));
  const header = ['Code', 'Name', 'Category', 'Division', 'Group', 'Sub-group', 'Fits', 'Unit', ...locations.map((l) => l.name), 'Total Stock', 'With Staff', 'Min Level', 'Status', 'Stock Value'];
  const lines = [header.map(csvEscape).join(',')];
  let grandValue = 0;
  for (const item of items) {
    const withStaff = issuedQtyForItem(item.id, issues);
    const state = stockState(item);
    const value = stockValue(item);
    grandValue += value;
    const row = [
      item.code || '',
      item.name,
      maps.catName.get(String(item.categoryId)) || '',
      item.division || '',
      item.group || '',
      item.subGroup || '',
      (item.fitsItemIds || []).map((x) => itemName.get(String(x)) || '').filter(Boolean).join('; '),
      item.unit,
      ...locations.map((l) => stockAtLocation(item, l.id)),
      totQty(item),
      withStaff,
      item.minimumStockLevel || 0,
      state.label,
      value,
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  lines.push(['TOTAL', ...Array(header.length - 2).fill(''), grandValue].map(csvEscape).join(','));
  return lines.join('\n');
}

async function exportIssuedCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanViewIssuedReport(actorAuth, 'export the Issued Material report');
  const [issues, items, maps] = await Promise.all([
    deps.inventoryIssueRepo.listByCompany(actorAuth.companyId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  const header = ['Date', 'Item Code', 'Item', 'Type', 'Qty', 'Unit', 'Staff', 'Site', 'Returned', 'Used', 'Balance', 'Status', 'Return Requested', 'Issued By', 'Remark'];
  const lines = [header.map(csvEscape).join(',')];
  let pending = 0;
  for (const x of issues) {
    const item = itemById.get(String(x.itemId)) || {};
    const balance = issBal(x);
    if (balance > 0) pending += 1;
    const row = [
      x.date, item.code || '', item.name || '', x.returnable ? 'Returnable' : 'Consumable', x.quantityIssued, item.unit || '',
      maps.userName.get(String(x.staffId)) || '', x.site, x.quantityReturned || 0, x.quantityUsed || 0, balance,
      issStatus(x), x.returnRequested ? 'Yes' : 'No', maps.userName.get(String(x.issuedByUserId)) || '', x.remark || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  lines.push([`PENDING RETURNS: ${pending}`].map(csvEscape).join(','));
  return lines.join('\n');
}

async function exportTransactionsCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'export the Inventory Transaction report');
  const [txns, items, maps] = await Promise.all([
    deps.inventoryTransactionRepo.listByCompany(actorAuth.companyId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  const header = ['Date', 'Type', 'Item', 'Item Code', 'Qty', 'From', 'To', 'Reference', 'By', 'Remark'];
  const lines = [header.map(csvEscape).join(',')];
  for (const t of txns) {
    const item = itemById.get(String(t.itemId)) || {};
    const row = [
      t.date, t.type, item.name || '', item.code || '', t.quantity,
      t.fromLocationId ? maps.locName.get(String(t.fromLocationId)) || '' : '',
      t.toLocationId ? maps.locName.get(String(t.toLocationId)) || '' : '',
      t.referenceText || '', maps.userName.get(String(t.recordedByUserId)) || '', t.remark || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

async function exportMyMaterialCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const [issues, items] = await Promise.all([
    deps.inventoryIssueRepo.listByStaff(actorAuth.companyId, actorAuth.userId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  const header = ['Date', 'Item Code', 'Item', 'Type', 'Qty', 'Unit', 'Site/Project', 'Returned', 'Used', 'Balance', 'Status', 'Return Requested', 'Issued By', 'Remark'];
  const lines = [header.map(csvEscape).join(',')];
  for (const x of issues) {
    const item = itemById.get(String(x.itemId)) || {};
    const row = [
      x.date, item.code || '', item.name || '', x.returnable ? 'Returnable' : 'Consumable', x.quantityIssued, item.unit || '',
      x.site, x.quantityReturned || 0, x.quantityUsed || 0, issBal(x), issStatus(x), x.returnRequested ? 'Yes' : 'No',
      x.issuedByUserId, x.remark || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

async function exportReturnsCsv(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageInventory(actorAuth, 'export the Material Return report');
  const [issues, items, txns, maps] = await Promise.all([
    deps.inventoryIssueRepo.listByCompany(actorAuth.companyId),
    deps.inventoryItemRepo.listByCompany(actorAuth.companyId),
    deps.inventoryTransactionRepo.listByCompany(actorAuth.companyId),
    nameMaps(actorAuth, deps),
  ]);
  const itemById = new Map(items.map((i) => [String(i.id), i]));
  const header = ['Date', 'Item', 'Staff', 'Site', 'Qty Issued', 'Returned', 'Used', 'Balance', 'Status', 'Return Requested'];
  const lines = [header.map(csvEscape).join(',')];
  let totalIssued = 0;
  let totalReturned = 0;
  for (const x of issues) {
    const item = itemById.get(String(x.itemId)) || {};
    totalIssued += toNum(x.quantityIssued);
    totalReturned += toNum(x.quantityReturned);
    lines.push(
      [x.date, item.name || '', maps.userName.get(String(x.staffId)) || '', x.site, x.quantityIssued, x.quantityReturned || 0, x.quantityUsed || 0, issBal(x), issStatus(x), x.returnRequested ? 'Yes' : 'No']
        .map(csvEscape)
        .join(',')
    );
  }
  lines.push(['TOTAL', '', '', '', totalIssued, totalReturned, '', '', '', ''].map(csvEscape).join(','));

  lines.push('');
  lines.push('RETURN HISTORY');
  lines.push(['Date', 'Item', 'Qty', 'Into Location', 'Remark', 'Received By'].map(csvEscape).join(','));
  for (const t of txns.filter((x) => x.type === 'Return')) {
    const item = itemById.get(String(t.itemId)) || {};
    lines.push(
      [t.date, item.name || '', t.quantity, t.toLocationId ? maps.locName.get(String(t.toLocationId)) || '' : '', t.remark || '', maps.userName.get(String(t.recordedByUserId)) || '']
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

/**
 * List recipient candidates for the inventory issue UI.
 * Infrastructure-only addition: the PWA resolves names from its client-side
 * users collection; we expose a dedicated endpoint so the frontend can
 * populate the staff dropdown without admin-level user list access.
 */
async function listRecipientCandidates(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  if (!deps.userRepoForEnquiry || typeof deps.userRepoForEnquiry.listByCompany !== 'function') {
    return [];
  }
  const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  return users
    .filter((u) => RECIPIENT_ROLES.includes(u.role))
    .map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

module.exports = {
  ITEM_DIVISIONS,
  ITEM_GROUPS,
  LOW_STOCK_FLOOR,
  MACHINE_SUBGROUPS,
  PIPING_SUBGROUPS,
  SUBGROUPS_BY_GROUP,
  MANAGE_ROLES,
  STOCK_REPORT_ROLES,
  ISSUED_REPORT_ROLES,
  RECIPIENT_ROLES,
  UNITS,
  ADJUSTMENT_TYPES,
  totQty,
  stockAtLocation,
  stockState,
  stockValue,
  listRecipientCandidates,
  issBal,
  issStatus,
  issuedQtyForItem,
  lowStockItems,
  createCategory,
  listCategories,
  renameCategory,
  deleteCategory,
  createLocation,
  listLocations,
  renameLocation,
  deleteLocation,
  createItem,
  listItems,
  getItem,
  updateItem,
  deleteItem,
  adjustStock,
  issueMaterial,
  requestReturn,
  acceptReturn,
  rejectReturn,
  markUsed,
  transferStock,
  getDashboard,
  listMyMaterial,
  listIssues,
  listTransactions,
  listSiteOptions,
  exportStockCsv,
  exportIssuedCsv,
  exportTransactionsCsv,
  exportMyMaterialCsv,
  exportReturnsCsv,
};
