const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope, loadEntitlements } = require('../middleware/tenant');
const { requirePlatformAdmin, isPlatformAdmin } = require('../middleware/platform');
const ctrl = require('../controllers/planController');

const router = express.Router();

function markPlatformAdmin(req, res, next) {
  req.__isPlatformAdmin = isPlatformAdmin(req.user);
  next();
}

// STEP 20 chain: Authentication -> Tenant -> Platform/company scope -> Commercial permission ->
// (Ownership n/a — platform catalog record) -> Business validation -> Handler.
router.get('/', auth, enforceTenantScope, loadEntitlements, markPlatformAdmin, ctrl.listPlans);
router.get('/:id', auth, enforceTenantScope, loadEntitlements, markPlatformAdmin, ctrl.getPlan);
router.post('/', auth, enforceTenantScope, requirePlatformAdmin, ctrl.createPlan);
router.put('/:id', auth, enforceTenantScope, requirePlatformAdmin, ctrl.updatePlan);
router.post('/:id/activate', auth, enforceTenantScope, requirePlatformAdmin, ctrl.activatePlan);
router.post('/:id/deactivate', auth, enforceTenantScope, requirePlatformAdmin, ctrl.deactivatePlan);

module.exports = router;
