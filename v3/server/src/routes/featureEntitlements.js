// POST /api/v3/feature-entitlements — manual feature override (platform-admin only).
const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const { requirePlatformAdmin } = require('../middleware/platform');
const ctrl = require('../controllers/entitlementController');

const router = express.Router();
router.post('/', auth, enforceTenantScope, requirePlatformAdmin, ctrl.setFeatureEntitlement);
module.exports = router;
