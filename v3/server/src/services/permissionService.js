// Permission-checking logic, decoupled from Express so middleware/authorization.js stays a thin
// wrapper. Permission/RolePermission/UserPermissionOverride collections are Phase 3+; until they
// exist, this reads a lightweight fallback (User.permissions[], a v3-additive array field already
// declared on models/User.js) — real callers will be pointed at the RolePermission +
// UserPermissionOverride merge in a later phase without changing this function's signature.
const { PERMISSIONS } = require('../config/constants');

function hasPermission(user, code) {
  if (!user) return false;
  if (user.role === 'super') return true;
  const effective = user.permissions || [];
  return effective.includes(code) || effective.includes('*');
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
