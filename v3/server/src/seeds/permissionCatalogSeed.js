// Phase 6.0 — PERMISSION CATALOG SEED.
//
// Guarantees (V3 PHASE 6.0 spec §C / §L):
//   * DETERMINISTIC   — iterates config/permissionCatalog.js CATALOG in its frozen declaration
//                       order; no generated ids, no timestamps in the identity, no Set iteration.
//   * IDEMPOTENT      — keyed on the unique `code`; a second run reports everything as unchanged.
//   * NON-DESTRUCTIVE — never deletes a row, never deactivates a code, and never touches a code it
//                       does not own. In particular it will NOT flip `active` back to true on a code
//                       an administrator deliberately deactivated: only descriptive metadata is
//                       refreshed on an existing row.
//   * V3-ONLY         — writes exactly one collection, `v3_permissions`. It never reads or writes any
//                       v2 collection, and it performs no migration of v2 data of any kind.
//
// It seeds the CATALOG (the vocabulary) only. It deliberately does NOT write RolePermission or
// UserPermissionOverride rows for any company: a company's matrix is populated by an explicit,
// audited administrative action (`PUT /api/v3/roles/:role/permissions`), never by a bulk backfill.
// That is the same discipline Phase 5 applied to legacy project conversion — no automatic migration.
const Permission = require('../models/Permission');
const { CATALOG, CATALOG_CODES, templateCodes } = require('../config/permissionCatalog');
const { logger } = require('../utils/logger');

const DESCRIPTIVE_FIELDS = ['name', 'description', 'category', 'module', 'resource', 'action'];

async function resolveQuery(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

/**
 * assertCatalogIntegrity — a template code that does not exist in the catalog would produce a role
 * assignment nothing could ever validate. Checked before any write, so a bad catalog fails fast and
 * writes nothing.
 */
function assertCatalogIntegrity() {
  const codes = CATALOG_CODES;
  const duplicates = codes.filter((code, i) => codes.indexOf(code) !== i);
  if (duplicates.length) {
    throw new Error(`[v3/permissionSeed] duplicate permission code(s) in catalog: ${[...new Set(duplicates)].join(', ')}`);
  }
  const missing = templateCodes().filter((code) => !codes.includes(code));
  if (missing.length) {
    throw new Error(`[v3/permissionSeed] DEFAULT_ROLE_PERMISSIONS references code(s) absent from the catalog: ${missing.join(', ')}`);
  }
  return true;
}

function descriptiveDiff(existing, entry) {
  return DESCRIPTIVE_FIELDS.filter((field) => (existing[field] ?? null) !== (entry[field] ?? null));
}

/**
 * seedPermissionCatalog — upserts every catalog entry. Safe to run any number of times.
 *
 * @param {Object}  [options]
 * @param {*}       [options.actorId]  stamped as `createdBy` on newly inserted rows
 * @returns {Promise<{created:string[], updated:string[], unchanged:string[], total:number}>}
 */
async function seedPermissionCatalog({ actorId = null } = {}) {
  assertCatalogIntegrity();

  const result = { created: [], updated: [], unchanged: [], total: CATALOG.length };

  for (const entry of CATALOG) {
    const existing = await resolveQuery(Permission.findOne({ code: entry.code }));

    if (!existing) {
      await Permission.create({
        code: entry.code,
        name: entry.name,
        description: entry.description,
        category: entry.category,
        module: entry.module,
        resource: entry.resource,
        action: entry.action,
        active: true,
        systemManaged: true,   // part of the frozen architecture — not deletable through any API
        createdBy: actorId,
      });
      result.created.push(entry.code);
      continue;
    }

    const changedFields = descriptiveDiff(existing, entry);
    if (changedFields.length === 0) {
      result.unchanged.push(entry.code);
      continue;
    }

    // Refresh descriptive metadata only. `active` and `systemManaged` are intentionally absent from
    // this $set — the seed must never undo an administrator's deactivation.
    await Permission.updateOne(
      { code: entry.code },
      {
        $set: {
          name: entry.name,
          description: entry.description,
          category: entry.category,
          module: entry.module,
          resource: entry.resource,
          action: entry.action,
        },
      },
    );
    result.updated.push(entry.code);
  }

  logger.info('permission_catalog_seeded', {
    created: result.created.length, updated: result.updated.length,
    unchanged: result.unchanged.length, total: result.total,
  });
  return result;
}

// Explicit CLI entry point: `node src/seeds/permissionCatalogSeed.js`. Connects, seeds, disconnects.
// Nothing runs on import — requiring this module has no side effects.
async function runAsScript() {
  const { connectV3DB, disconnectV3DB } = require('../db/connection');
  await connectV3DB();
  try {
    const result = await seedPermissionCatalog();
    // eslint-disable-next-line no-console
    console.log(`[v3/permissionSeed] created=${result.created.length} updated=${result.updated.length} unchanged=${result.unchanged.length} total=${result.total}`);
  } finally {
    await disconnectV3DB();
  }
}

if (require.main === module) {
  runAsScript().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[v3/permissionSeed] failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { seedPermissionCatalog, assertCatalogIntegrity, DESCRIPTIVE_FIELDS };
