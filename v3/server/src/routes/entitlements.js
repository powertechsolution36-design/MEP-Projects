const express = require('express');
const { auth } = require('../middleware/auth');
const { enforceTenantScope } = require('../middleware/tenant');
const ctrl = require('../controllers/entitlementController');

const router = express.Router();

// GET /api/v3/entitlements/:targetCompanyId — read-only view (API_ARCHITECTURE.md §3 names this
// route `/entitlements/:companyId`, but the param is deliberately named `targetCompanyId` here: it
// is the one place a same-named `:companyId`/`:co` URL param would collide with
// middleware/tenant.js's enforceTenantScope(), which strips exactly those two client-supplied key
// names from req.params as an anti-spoofing measure (STEP 6) — that strip is for body/query fields
// impersonating the caller's OWN scope, not for a legitimate path parameter naming the resource being
// read, so the param is named to avoid the collision rather than special-casing the strip. Tenant
// isolation itself is enforced inside the controller (Super Admin may target any company; anyone
// else only their own — see controllers/entitlementController.js).
router.get('/:targetCompanyId', auth, enforceTenantScope, ctrl.getEntitlements);

module.exports = router;
