// Exercises the real frozen middleware chain (auth -> tenant -> entitlements) on an already-
// documented route (API_ARCHITECTURE.md §2 `/api/v3/me/*`) without inventing a new business model —
// deliberately the only authenticated route in this foundation pass.
const { asyncHandler } = require('../utils/asyncHandler');

const getMe = asyncHandler(async (req, res) => {
  res.json({
    user: req.authContext,
    entitlements: req.entitlements,
  });
});

module.exports = { getMe };
