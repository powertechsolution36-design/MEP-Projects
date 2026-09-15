// GET/PUT /api/v3/users/:id/permissions — per-user grant/revoke overrides (ARCHITECTURE.md §P,
// API_ARCHITECTURE.md §2).
//
// V3-ADDITIVE ONLY: the legacy `/api/users` endpoints v2 serves in production are untouched
// (API_ARCHITECTURE.md §10). This router adds the permission sub-resource and nothing else — v3 does
// not take over user CRUD in this phase.
//
// The target user is always re-read from the database and checked against the administrator's own
// company scope before anything is written, so a permission granted in one company can never land on
// a user in another (V3 PHASE 6.0 spec §H).
const express = require('express');
const { buildProtectedRoute } = require('../middleware/chain');
const { validate } = require('../middleware/validate');
const { PERMISSION_ADMIN } = require('../config/permissionCatalog');
const { USER_PERMISSION_OVERRIDE_RESOURCE } = require('../config/permissionPolicy');
const ctrl = require('../controllers/permissionController');

const router = express.Router();

router.get(
  '/:id/permissions',
  ...buildProtectedRoute({ resource: USER_PERMISSION_OVERRIDE_RESOURCE, permission: PERMISSION_ADMIN.VIEW }),
  validate({ params: { id: { type: 'string', required: true } } }),
  ctrl.getUserPermissions,
);

router.put(
  '/:id/permissions',
  ...buildProtectedRoute({ resource: USER_PERMISSION_OVERRIDE_RESOURCE, permission: PERMISSION_ADMIN.MANAGE }),
  validate({ params: { id: { type: 'string', required: true } } }),
  ctrl.putUserPermissions,
);

module.exports = router;
