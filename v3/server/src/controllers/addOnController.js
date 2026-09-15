// AddOn CATALOG management (platform-wide, no companyId) — assignment to a company happens through
// subscriptionController.js's addAddon/removeAddon instead.
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const AddOn = require('../models/AddOn');
const { audit } = require('../services/auditService');

const listAddOns = asyncHandler(async (req, res) => {
  const filter = req.__isPlatformAdmin ? {} : { active: true, sellable: true };
  const addOns = await AddOn.find(filter).sort({ code: 1 }).lean();
  res.json({ addOns });
});

const createAddOn = asyncHandler(async (req, res) => {
  const addOn = await AddOn.create({ ...req.body, createdBy: req.user._id });
  await audit({ req, action: 'ADDON_ASSIGNED', resource: 'addOnCatalog', resourceId: addOn._id, after: { code: addOn.code, catalogCreate: true } });
  res.status(201).json({ addOn });
});

const updateAddOn = asyncHandler(async (req, res) => {
  const addOn = await AddOn.findById(req.params.id);
  if (!addOn) return sendError(res, 404, 'Add-on not found');
  Object.assign(addOn, req.body);
  await addOn.save();
  res.json({ addOn });
});

module.exports = { listAddOns, createAddOn, updateAddOn };
