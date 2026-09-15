// Phase 6.0 — permission administration controllers. Thin: every authorization decision has already
// been made by the route's middleware chain (middleware/chain.js buildProtectedRoute), and every
// business rule lives in services/permissionAdminService.js.
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const adminService = require('../services/permissionAdminService');
const { describeUserPermissions } = require('../services/permissionResolutionService');
const User = require('../models/User');

function handleServiceError(res, err) {
  if (err && err.status && err.code) {
    return sendError(res, err.status, err.message, { code: err.code, ...(err.details || {}) });
  }
  throw err;
}

function run(handler) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res); } catch (err) { handleServiceError(res, err); }
  });
}

// GET /api/v3/permissions — the platform catalog (ARCHITECTURE.md §P "list all permission codes").
const listPermissions = run(async (req, res) => {
  const permissions = await adminService.listCatalog({ includeInactive: req.query.includeInactive === 'true' });
  res.json({ permissions, count: permissions.length });
});

// GET /api/v3/roles/:role/permissions
const getRolePermissions = run(async (req, res) => {
  const result = await adminService.getRolePermissions({ req, role: req.params.role });
  res.json(result);
});

// PUT /api/v3/roles/:role/permissions
//   body: { permissions: [{ code, granted }], reason }   — explicit per-code grant/revoke
//     or:  { applyDefaults: true, reason }               — write the frozen ACCESS_MATRIX template
const putRolePermissions = run(async (req, res) => {
  const result = await adminService.setRolePermissions({
    req,
    role: req.params.role,
    permissions: req.body?.permissions,
    applyDefaults: req.body?.applyDefaults === true,
    reason: req.body?.reason,
  });
  res.json(result);
});

// GET /api/v3/users/:id/permissions — the resolved read model for one user, showing WHICH layer
// decided each code (dynamic grant/revoke vs the legacy compatibility baseline).
const getUserPermissions = run(async (req, res) => {
  const co = adminService.companyScopeFor(req);
  const query = User.findById(req.params.id);
  const target = typeof query?.lean === 'function' ? await query.lean() : await query;
  if (!target) return sendError(res, 404, 'User not found', { code: 'USER_NOT_FOUND' });
  if (String(target.co) !== String(co)) {
    return sendError(res, 403, 'Cross-company access denied', { code: 'CROSS_COMPANY_DENIED' });
  }
  const description = await describeUserPermissions({ user: target, companyId: co });
  res.json(description);
});

// PUT /api/v3/users/:id/permissions — body: { permissions: [{ code, granted }], reason }
const putUserPermissions = run(async (req, res) => {
  const result = await adminService.setUserPermissions({
    req,
    userId: req.params.id,
    permissions: req.body?.permissions,
    reason: req.body?.reason,
  });
  res.json(result);
});

module.exports = {
  listPermissions,
  getRolePermissions,
  putRolePermissions,
  getUserPermissions,
  putUserPermissions,
};
