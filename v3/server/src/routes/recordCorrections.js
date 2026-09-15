const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/authorization');
const { PERMISSIONS } = require('../config/constants');
const ctrl = require('../controllers/recordCorrectionController');

const router = express.Router();

// GET /api/v3/record-corrections        — list, always tenant-scoped
// GET /api/v3/record-corrections/:id    — single row, tenant-checked in the controller
//
// Read-only by design (API_ARCHITECTURE.md §2). POST/PUT/DELETE are wired to an explicit 405 rather
// than left unhandled, so "a client can never post a correction directly" is an asserted behavior
// instead of an accident of routing.
router.get('/', auth, enforceTenantScope, requirePermission(PERMISSIONS.VIEW), ctrl.listCorrections);
router.get('/:id', auth, enforceTenantScope, requirePermission(PERMISSIONS.VIEW), ctrl.getCorrection);

router.post('/', auth, ctrl.rejectDirectWrite);
router.put('/:id', auth, ctrl.rejectDirectWrite);
router.patch('/:id', auth, ctrl.rejectDirectWrite);
router.delete('/:id', auth, ctrl.rejectDirectWrite);

module.exports = router;
