// Permission-checking logic, decoupled from Express so middleware/authorization.js stays a thin
// wrapper.
//
// PHASE 6.0: the Phase 1 stub ("reads a lightweight fallback through User.permissions[] ... real
// callers will be pointed at the RolePermission + UserPermissionOverride merge in a later phase
// WITHOUT CHANGING THIS FUNCTION'S SIGNATURE") is now fulfilled, and that promise is kept literally:
// hasPermission(user, code) is still a SYNCHRONOUS two-argument predicate, so all ~6 existing call
// sites (middleware/authorization.js, middleware/ownership.js, services/authorizationEngine.js,
// services/approvalService.js) are unchanged.
//
// The asynchronous part — reading the two company-scoped assignment collections — happens ONCE per
// request in middleware/permissions.js, which attaches the resolved decision set to
// `req.user._permissionResolution`. This mirrors exactly how Phase 1 handles entitlements
// (loadEntitlements() attaches req.entitlements; scopeFilterV3 reads user._entitledDivisions) rather
// than introducing a second, different pattern.
//
// Full precedence and its rationale: services/permissionResolutionService.js.
const { PERMISSIONS } = require('../config/constants');

const WILDCARD = '*';

/**
 * hasPermission — synchronous, side-effect-free.
 *
 *   super                       -> true   (API_ARCHITECTURE.md §7, unchanged)
 *   dynamic revoke (user/role)  -> false  (beats every grant below, including the '*' wildcard)
 *   dynamic grant  (user/role)  -> true
 *   legacy User.permissions[]   -> true   (Phase 1-5 compatibility baseline)
 *   otherwise                   -> false
 *
 * A user object with no `_permissionResolution` (a plain object in a unit test, or a request in a
 * process with no database connection) behaves EXACTLY as it did in Phases 1-5.
 */
function hasPermission(user, code) {
  if (!user) return false;
  if (user.role === 'super') return true;

  const resolution = user._permissionResolution;
  if (resolution) {
    // An explicit revoke is final. Checked before any grant, and before the legacy layer, so a
    // revoked code cannot be re-acquired through a role default or a stale User.permissions[] entry.
    if (resolution.revoked && resolution.revoked.includes(code)) return false;
    if (resolution.granted && resolution.granted.includes(code)) return true;
  }

  const legacy = user.permissions || [];
  return legacy.includes(code) || legacy.includes(WILDCARD);
}

function assertKnownPermission(code) {
  if (!Object.values(PERMISSIONS).includes(code) && !code.includes('.')) {
    // Bare frozen-constant codes (VIEW/CREATE/...) must be one of the ten; resource-scoped codes
    // like "quotation.override" are allowed through (module-specific extensions), matching how
    // ACCESS_MATRIX.md's per-module override permissions are named.
    throw new Error(`[v3/permissionService] Unknown permission constant "${code}"`);
  }
}

module.exports = { hasPermission, assertKnownPermission, PERMISSIONS };
