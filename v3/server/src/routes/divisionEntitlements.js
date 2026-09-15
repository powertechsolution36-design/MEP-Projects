// POST /api/v3/division-entitlements — manual division override (platform-admin only).
const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const { requirePlatformAdmin } = require('../middleware/platform');
const ctrl = require('../controllers/entitlementController');

const router = express.Router();
router.post('/', auth, enforceTenantScope, requirePlatformAdmin, ctrl.setDivisionEntitlement);
module.exports = router;
