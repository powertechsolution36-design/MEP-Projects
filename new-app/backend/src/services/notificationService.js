'use strict';

const { ServiceError } = require('../errors');

/**
 * Notification list/read (FIX-B1).
 *
 * Source of truth: MEP_PROJECTS_PWA/index.html `notify()`/`myNotifs()`/
 * `unread()`/`vNotifs()` (~lines 1267-1866). PWA FACTS:
 *  - Targeting is role-based only (`roles` array, or the literal `"*"`
 *    meaning "every role"); notify() never targets an individual user.
 *  - `myNotifs()`: a company-scoped notification is visible to a user
 *    when their OWN role appears in `n.roles`, or `n.roles` contains `"*"`.
 *  - Read tracking is append-only per-user (`n.read` array of user ids);
 *    `vNotifs()` marks every currently-visible notification read the
 *    moment the Notifications view is opened, one `PATCH
 *    .../:id/read` call per not-yet-read item (already anticipated by the
 *    PWA's own `API_MODE` branch of `notify()`/`vNotifs()`, which calls
 *    exactly this endpoint shape) -- there is no separate "mark unread"
 *    action anywhere in the PWA.
 *  - No dedup beyond what already exists (none), no new notification
 *    triggers are added here -- this module only adds the READ side
 *    (list + mark-read) on top of the already-existing
 *    `notificationRepo.create()` call sites in every module's service.
 */

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

// PWA FACT (`myNotifs`): role-targeted (own role, or the "*" all-roles
// marker), scoped to the actor's own company. Newest first (PWA FACT:
// `vNotifs` does `.slice().reverse()` on an append-ordered array).
async function listNotifications(actorAuth, options, deps) {
  assertCompanyContext(actorAuth);
  return deps.notificationRepo.listForRole(actorAuth.companyId, actorAuth.role, options);
}

// PWA FACT (`vNotifs`): append the acting user's id to `read` if not
// already present; idempotent (no-op if already read); no un-read action.
async function markNotificationRead(notificationId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const updated = await deps.notificationRepo.markRead(actorAuth.companyId, notificationId, actorAuth.userId);
  if (!updated) throw new ServiceError('Notification not found.', 'NOT_FOUND', 404);
  return updated;
}

module.exports = { listNotifications, markNotificationRead };
