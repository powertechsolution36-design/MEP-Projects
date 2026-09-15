// GET/PUT /api/v3/roles/:role/permissions — the per-company role → permission matrix
// (ARCHITECTURE.md §P, API_ARCHITECTURE.md §2).
//
// `:role` accepts either a frozen DESIGNATION or a legacy v2 role, normalized by
// services/permissionAdminService.js normalizeDesignation() — see models/RolePermission.js for the
// disclosed reasoning (a legacy `role` key alone could not express the frozen Sales Manager vs
// Sales Executive distinction).
const express = require('express');
const { buildProtectedRoute } = require('../middleware/chain');
const { validate } = require('../middleware/validate');
const { PERMISSION_ADMIN } = require('../config/permissionCatalog');
const { ROLE_PERMISSION_RESOURCE } = require('../config/permissionPolicy');
const ctrl = require('../controllers/permissionController');

const router = express.Router();

router.get(
  '/:role/permissions',
  ...buildProtectedRoute({ resource: ROLE_PERMISSION_RESOURCE, permission: PERMISSION_ADMIN.VIEW }),
  validate({ params: { role: { type: 'string', required: true } } }),
  ctrl.getRolePermissions,
);

router.put(
  '/:role/permissions',
  ...buildProtectedRoute({ resource: ROLE_PERMISSION_RESOURCE, permission: PERMISSION_ADMIN.MANAGE }),
  validate({ params: { role: { type: 'string', required: true } } }),
  ctrl.putRolePermissions,
);

module.exports = router;
