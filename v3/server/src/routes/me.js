const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope, loadEntitlements } = require('../middleware/tenant');
const { getMe } = require('../controllers/meController');

const router = express.Router();
// GET /api/v3/me — exercises the frozen chain: auth -> tenant scope -> entitlements.
router.get('/', auth, enforceTenantScope, loadEntitlements, getMe);

module.exports = router;
