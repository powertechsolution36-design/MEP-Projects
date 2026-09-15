const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const { requirePlatformAdmin, isPlatformAdmin } = require('../middleware/platform');
const ctrl = require('../controllers/addOnController');

const router = express.Router();

function markPlatformAdmin(req, res, next) {
  req.__isPlatformAdmin = isPlatformAdmin(req.user);
  next();
}

router.get('/', auth, enforceTenantScope, markPlatformAdmin, ctrl.listAddOns);
router.post('/', auth, enforceTenantScope, requirePlatformAdmin, ctrl.createAddOn);
router.put('/:id', auth, enforceTenantScope, requirePlatformAdmin, ctrl.updateAddOn);

module.exports = router;
