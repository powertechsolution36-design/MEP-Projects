// GET /api/v3/permissions — the platform permission catalog (ARCHITECTURE.md §P,
// API_ARCHITECTURE.md §2).
//
// Permission administration is itself permission-protected (V3 PHASE 6.0 spec §D): reading the
// matrix requires `permissions.view`, which no ordinary employee holds — neither the frozen
// ACCESS_MATRIX.md template (config/permissionCatalog.js) nor any legacy `User.permissions[]` array
// grants it to engineer/technician/sales_executive/viewer designations.
const express = require('express');
const { buildProtectedRoute } = require('../middleware/chain');
const { PERMISSION_ADMIN } = require('../config/permissionCatalog');
const { PERMISSION_RESOURCE } = require('../config/permissionPolicy');
const ctrl = require('../controllers/permissionController');

const router = express.Router();

router.get(
  '/',
  ...buildProtectedRoute({ resource: PERMISSION_RESOURCE, permission: PERMISSION_ADMIN.VIEW }),
  ctrl.listPermissions,
);

module.exports = router;
