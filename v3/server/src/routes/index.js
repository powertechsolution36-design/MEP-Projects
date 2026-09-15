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

// Phase 4 — global record ownership / audit hardening (API_ARCHITECTURE.md §2 rev 12).
router.use('/record-corrections', require('./recordCorrections'));

// Phase 5 — Project shell + ProjectPackage division units. V3-ADDITIVE: the legacy /api/projects
// endpoints v2 serves in production are untouched (API_ARCHITECTURE.md §10).
router.use('/projects', require('./projects'));

module.exports = router;
