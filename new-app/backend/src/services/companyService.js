'use strict';

const { assertRoleAllowedForCompany } = require('../auth/roleDivision');

/**
 * Company creation — isolated into its own service (per instruction) so
 * Super Admin company-management behavior can be expanded later without
 * touching this foundation.
 *
 * Reproduces the PWA's *outcome* (creating a company also creates exactly
 * one admin-role login for it) without reproducing its insecure mechanism
 * (the PWA shows the newly created plaintext password once). Here the
 * password is hashed before persistence and the plaintext is never returned,
 * stored, or logged — only the hash and a safe admin profile come back.
 *
 * All persistence is via injected repositories — see
 * src/auth/repositories.mongoose.js for the real, Mongoose-backed wiring
 * used by the HTTP routes; tests inject in-memory fakes.
 */

/**
 * @param {{
 *   company: { name: string, divisions: string[], status?: string, since?: Date, [k: string]: any },
 *   admin: { name: string, username: string, password: string },
 * }} input
 * @param {{
 *   companyRepo: { create: (data: object) => Promise<object> },
 *   userWriteRepo: {
 *     existsByCompanyAndUsername: (companyId: string, username: string) => Promise<boolean>,
 *     create: (data: object) => Promise<object>,
 *   },
 *   passwordHasher: { hashPassword: (plain: string) => Promise<string> },
 * }} deps
 * @returns {Promise<{ company: object, admin: object }>} admin never includes the plaintext password or its hash.
 */
async function createCompanyWithAdmin({ company: companyInput, admin: adminInput }, deps) {
  const { companyRepo, userWriteRepo, passwordHasher } = deps;

  if (!companyInput || !companyInput.name) {
    throw new Error('Company name is required.');
  }
  if (!adminInput || !adminInput.username || !adminInput.password || !adminInput.name) {
    throw new Error('Initial admin name, username, and password are required.');
  }

  const companyData = {
    since: new Date(),
    status: 'Trial',
    ...companyInput,
  };

  const company = await companyRepo.create(companyData);

  // 'admin' is never a PM role, so this call is a documented no-op today —
  // kept so every role assignment in this service path goes through the
  // same division-binding gate, including future PM-role bootstrap paths.
  assertRoleAllowedForCompany('admin', company);

  const alreadyTaken = await userWriteRepo.existsByCompanyAndUsername(company.id, adminInput.username);
  if (alreadyTaken) {
    throw new Error(`Username "${adminInput.username}" is already taken in this company.`);
  }

  const passwordHash = await passwordHasher.hashPassword(adminInput.password);

  const adminUser = await userWriteRepo.create({
    companyId: company.id,
    name: adminInput.name,
    username: adminInput.username,
    role: 'admin',
    passwordHash,
    active: true,
  });

  return {
    company,
    admin: {
      id: adminUser.id,
      name: adminUser.name,
      username: adminUser.username,
      role: adminUser.role,
      companyId: adminUser.companyId,
      active: adminUser.active !== false,
    },
  };
}

module.exports = { createCompanyWithAdmin };

/**
 * FIX-6-03 (B2 -- Company deletion/cascade).
 *
 * PWA FACT (`delCompany`, MEP_PROJECTS_PWA/index.html:1811-1817):
 *   - Only reachable by the `super` role -- "Companies" is a nav item that
 *     exists ONLY in the `super` role's menu (index.html:1290); no other
 *     role can even open the Companies list this action lives on.
 *   - Confirmation: a browser `confirm("Remove company and all its data?")`
 *     gate before anything happens (a UI-layer concern -- the server-side
 *     equivalent is simply requiring an explicit call to this endpoint;
 *     there is no server-side "confirm" primitive to reproduce).
 *   - Hard delete: the Company record itself is removed immediately, no
 *     soft-delete/status flag.
 *   - Cascade: exactly 8 collections are purged by company id --
 *     `["users","enquiries","sos","projects","svcCalls","contracts",
 *     "payments","notifs"]` (that literal array, read directly from the
 *     PWA source).
 *   - NOT cascaded (verified by the SAME literal array above -- these
 *     collection names are simply absent from it): Inventory data
 *     (categories/locations/items/issues/transactions) and Checklist
 *     Templates. This is preserved exactly, not "fixed" -- inventing a
 *     wider cascade than the PWA demonstrates would violate the absolute
 *     parity rule, even though leaving Inventory/ChecklistTemplate records
 *     orphaned looks like an oversight in the PWA itself.
 *   - The PWA also guards `id===1` ("Cannot remove the primary company in
 *     demo") -- that guard is specific to the PWA's own hardcoded demo
 *     company id 1 in its localStorage-only demo mode and has no equivalent
 *     concept in a real multi-tenant Mongo deployment (there is no
 *     "always-id-1" company); this is OPEN/NOT DETERMINABLE as a concept to
 *     port 1:1 and is intentionally NOT reproduced as an arbitrary
 *     "first company" special case, which would be an invented rule the PWA
 *     itself does not generalize (a demo-mode literal, not a business rule).
 *
 * Approved infrastructure-only differences: (1) the whole cascade runs
 * inside `withTransaction` so a failure partway through cannot leave the
 * Company gone but its data behind (or vice versa) -- the PWA's synchronous
 * in-memory array filters have no equivalent atomicity concern because
 * there is no concurrent writer and no partial-failure mode to guard
 * against; (2) tenant scoping is by the server-derived `companyId`
 * (ObjectId), never a client-supplied value.
 */
async function deleteCompany(companyId, actorAuth, deps) {
  const { ServiceError } = require('../errors');
  if (!actorAuth || actorAuth.role !== 'super') {
    throw new ServiceError('Only the super role may delete a company.', 'FORBIDDEN', 403);
  }
  const { companyRepo, userWriteRepo, enquiryRepo, salesOrderRepo, projectRepo, serviceCallRepo, contractRepo, paymentRepo, notificationRepo, withTransaction } = deps;
  const company = await companyRepo.findById(companyId);
  if (!company) {
    throw new ServiceError('Company not found.', 'NOT_FOUND', 404);
  }

  return withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // PWA FACT: exactly these 8 collections, in the PWA's own order.
    await userWriteRepo.deleteManyByCompany(companyId, session);
    await enquiryRepo.deleteManyByCompany(companyId, session);
    await salesOrderRepo.deleteManyByCompany(companyId, session);
    await projectRepo.deleteManyByCompany(companyId, session);
    await serviceCallRepo.deleteManyByCompany(companyId, session);
    await contractRepo.deleteManyByCompany(companyId, session);
    await paymentRepo.deleteManyByCompany(companyId, session);
    await notificationRepo.deleteManyByCompany(companyId, session);
    await companyRepo.delete(companyId, session);
    return { deletedCompanyId: companyId };
  });
}

module.exports.deleteCompany = deleteCompany;

