const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const { requirePlatformAdmin } = require('../middleware/platform');
const ctrl = require('../controllers/subscriptionController');

const router = express.Router();

// Reads are tenant-scoped inside the controller itself (a subscription's companyId comes from the
// record, not the URL, so the ownership-style cross-company check happens there — see
// controllers/subscriptionController.js's getSubscription). Writes are platform-admin only — "Do not
// allow a client user to directly assign itself a subscription" (V3 PHASE 3 spec §4).
router.get('/:id', auth, enforceTenantScope, ctrl.getSubscription);
router.post('/', auth, enforceTenantScope, requirePlatformAdmin, ctrl.createSubscription);
router.post('/:id/change-plan', auth, enforceTenantScope, requirePlatformAdmin, ctrl.changePlan);
router.post('/:id/cancel', auth, enforceTenantScope, requirePlatformAdmin, ctrl.cancelSubscription);
router.post('/:id/add-addon', auth, enforceTenantScope, requirePlatformAdmin, ctrl.addAddon);
router.post('/:id/remove-addon', auth, enforceTenantScope, requirePlatformAdmin, ctrl.removeAddon);

module.exports = router;
