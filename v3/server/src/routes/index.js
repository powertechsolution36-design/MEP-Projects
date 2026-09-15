const express = require('express');
const router = express.Router();

router.use('/health', require('./health'));
router.use('/me', require('./me'));

// Phase 3 — commercial entitlement routes (API_ARCHITECTURE.md §3).
router.use('/plans', require('./plans'));
router.use('/subscriptions', require('./subscriptions'));
router.use('/addons', require('./addons'));
router.use('/entitlements', require('./entitlements'));
router.use('/division-entitlements', require('./divisionEntitlements'));
router.use('/feature-entitlements', require('./featureEntitlements'));

module.exports = router;
