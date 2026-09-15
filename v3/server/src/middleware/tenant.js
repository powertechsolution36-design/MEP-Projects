// Tenant/company scope + entitlement loading — steps 2–3 of the frozen middleware chain
// (API_ARCHITECTURE.md §1 / v3/docs STEP 13 authorization order).
//
// HARD RULE (STEP 6): a client-supplied company id — req.body.companyId, req.query.companyId,
// req.params.companyId, and their legacy `co` spellings — must NEVER override the authenticated
// company scope. enforceTenantScope() strips all of them from the request before any handler sees
// it, and sets req.tenantCompanyId from req.user.co (or an explicit, permission-gated Super Admin
// target — see below). No handler downstream may derive tenant scope any other way.
const Company = require('../models/Company');
const { sendError } = require('../utils/ApiError');

const CLIENT_COMPANY_KEYS = ['companyId', 'co'];

function stripClientCompanyId(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of CLIENT_COMPANY_KEYS) delete obj[key];
}

function enforceTenantScope(req, res, next) {
  if (!req.user) return sendError(res, 401, 'Auth required');

  stripClientCompanyId(req.body);
  stripClientCompanyId(req.query);
  stripClientCompanyId(req.params);

  if (req.user.role === 'super') {
    // Super Admin platform operations may target an explicit company ONLY via a dedicated,
    // permission-gated query param — never the generic companyId key a normal client would send,
    // and never as an implicit default. Business-record editing still goes through
    // requireOwnership()'s Support-Op path (middleware/ownership.js) regardless of this scope.
    req.tenantCompanyId = req.query.targetCompanyId || null;
  } else {
    req.tenantCompanyId = req.user.co;
  }

  next();
}

// loadEntitlements — reads the CACHE only (Company.entitlements). Real computation from
// Subscription/DivisionEntitlement/FeatureEntitlement/AddOn is services/entitlementService.js,
// wired in during Phase 3; this stub keeps the middleware chain shape stable so route wiring
// written now (Phase 4) does not need to change when Phase 3 lands.
async function loadEntitlements(req, res, next) {
  try {
    if (!req.user) return sendError(res, 401, 'Auth required');
    if (req.user.role === 'super') {
      req.entitlements = { modules: '*', divisions: '*', enforceEntitlements: false };
      return next();
    }
    const company = await Company.findById(req.user.co).lean();
    if (!company) return sendError(res, 400, 'Company not found for user');
    req.company = company;
    // CACHE ONLY — never `company.divs || [SOLAR, MEP, HVAC]`. See STEP 15 / entitlementService.js.
    req.entitlements = company.entitlements || {
      modules: [],
      divisions: [],
      enforceEntitlements: company.settings?.enforceEntitlements === true,
    };
    next();
  } catch (err) {
    sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
  }
}

function requireEntitlement({ module, division } = {}) {
  return (req, res, next) => {
    if (req.user?.role === 'super') return next();
    const ent = req.entitlements;
    if (!ent) return sendError(res, 500, 'Entitlements not loaded — loadEntitlements() must run first');
    if (ent.enforceEntitlements === false) return next(); // log-only mode (frozen default for legacy companies)
    if (module && ent.modules !== '*' && !(ent.modules || []).includes(module)) return sendError(res, 403, `Module not entitled: ${module}`);
    if (division && ent.divisions !== '*' && !(ent.divisions || []).includes(division)) return sendError(res, 403, `Division not entitled: ${division}`);
    next();
  };
}

module.exports = { enforceTenantScope, loadEntitlements, requireEntitlement, stripClientCompanyId };
