'use strict';

const { ServiceError } = require('../errors');

/**
 * Normalize an item name for uniqueness checking.
 * Lowercase, trim, collapse multiple spaces.
 */
function normalizeName(name) {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Upsert an item name — called when a document (quotation, DC) is saved.
 * If already existing, increments usageCount and updates lastUsedAt.
 * Does NOT save merely because the user typed it — only on document save.
 */
async function upsertItemName(companyId, division, name, extraFields, deps) {
  if (!name || !name.trim()) return null;
  const normalizedName = normalizeName(name);
  const trimmedName = name.trim();

  const existing = await deps.itemNameRepo.findByNormalized(companyId, division, normalizedName);
  if (existing) {
    return deps.itemNameRepo.incrementUsage(existing.id);
  }

  return deps.itemNameRepo.create({
    companyId,
    division,
    name: trimmedName,
    normalizedName,
    defaultSection: (extraFields && extraFields.defaultSection) || '',
    unit: (extraFields && extraFields.unit) || '',
    usageCount: 1,
    lastUsedAt: new Date(),
  });
}

/**
 * Bulk upsert item names from a document's line items.
 * Called when a quotation or DC is saved.
 */
async function bulkUpsertFromLineItems(companyId, division, lineItems, deps) {
  const results = [];
  const seen = new Set();
  for (const item of lineItems) {
    if (!item.description || !item.description.trim()) continue;
    const normalized = normalizeName(item.description);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const result = await upsertItemName(companyId, division, item.description, {
      defaultSection: item.section || '',
      unit: item.unit || '',
    }, deps);
    if (result) results.push(result);
  }
  return results;
}

/**
 * Autocomplete search — prefix + substring, case-insensitive.
 * Returns up to `limit` suggestions sorted by usageCount desc.
 */
async function autocomplete(companyId, division, query, limit, deps) {
  if (!query || query.trim().length === 0) {
    // Return most-used items
    return deps.itemNameRepo.listByCompanyDivision(companyId, division, limit || 20);
  }
  return deps.itemNameRepo.search(companyId, division, query.trim(), limit || 20);
}

/**
 * List all items for a company/division.
 */
async function listItems(companyId, division, deps) {
  return deps.itemNameRepo.listByCompanyDivision(companyId, division, 500);
}

/**
 * Delete an item name (admin only).
 */
async function deleteItemName(companyId, itemId, deps) {
  const item = await deps.itemNameRepo.findById(companyId, itemId);
  if (!item) throw new ServiceError('Item name not found.', 'NOT_FOUND', 404);
  await deps.itemNameRepo.delete(companyId, itemId);
  return { deleted: true };
}

module.exports = {
  normalizeName,
  upsertItemName,
  bulkUpsertFromLineItems,
  autocomplete,
  listItems,
  deleteItemName,
};
