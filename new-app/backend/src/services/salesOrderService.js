'use strict';

const { ServiceError } = require('../errors');
const cascade = require('./salesOrderCascade');

/**
 * SalesOrder business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_SALESORDER.md,
 * DOMAIN_MODEL.md, DATABASE_SCHEMA.md, and the locked decisions from this
 * task's own instructions ("SALESORDER DECISIONS ARE LOCKED"):
 *   Checklist fallback              = A (reproduce the legacy DB.templates fallback — src/services/salesOrderCascade.js)
 *   Role enforcement                = A (PWA's VISIBLE role intent, enforced server-side)
 *   SO milestone amount sync        = A (asymmetric — see paymentService.js)
 *   Milestone received-flag preserve= A (index-based, preserved verbatim on edit)
 *
 * LOCKED PRINCIPLE: every PWA-demonstrated functional behavior is
 * reproduced exactly, including quirks. Only these infrastructure
 * differences are permitted: Mongo instead of localStorage, ObjectIds
 * instead of integer ids, hashed passwords, real tenant isolation, real
 * server-side authorization instead of UI-only security, and transactions
 * where required for data safety.
 *
 * Standalone creation and Enquiry-conversion creation share the exact same
 * cascade (src/services/salesOrderCascade.js) — see enquiryService.js's
 * convertEnquiryToSalesOrder, which was refactored to call the same
 * module so the two paths cannot drift apart.
 */

// PWA FACT (`vSOs`'s "+ New SO" button: `U.role==="sales"||U.role==="admin"`,
// and `vSO`'s "Edit" button, same gate). Enforced HERE, server-side — the
// PWA's own `saveSO`/`mSO` never checked role in code at all (a PWA
// weakness, not PWA business behavior — see PWA_COVERAGE_AUDIT_SALESORDER.md §12).
const CREATE_ROLES = Object.freeze(['sales', 'admin']);
const EDIT_ROLES = Object.freeze(['sales', 'admin']);

// PWA FACT (MENUS): only these roles have the "Sales Orders" menu item at
// all (admin, sales, hvac_pm, solar_pm, mep_pm, finance) — engineer/
// inventory/service_mgr/service_eng/super never reach vSOs()/vSO() through
// the PWA's own navigation. Enforced HERE, server-side.
const VIEW_ROLES = Object.freeze(['sales', 'admin', 'hvac_pm', 'solar_pm', 'mep_pm', 'finance']);

// PWA FACT (`vSO`'s `showCost = U.role!=="engineer"&&U.role!=="service_eng"`).
// Kept as a defensive second layer even though neither role is in
// VIEW_ROLES above (in the PWA those two roles never reach `vSO()` via its
// own menu either — this mirrors the PWA's own redundant check rather than
// silently dropping it).
const COST_HIDDEN_ROLES = Object.freeze(['engineer', 'service_eng']);
const COST_FIELDS = Object.freeze([
  'totalCost',
  'highSideSelling',
  'highSidePurchase',
  'lowSideCost',
  'lowSideTargetExpense',
  'lowSideActualExpense',
]);

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

function assertRole(actorAuth, allowedRoles, actionDescription) {
  if (!allowedRoles.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription}.`,
      'FORBIDDEN',
      403
    );
  }
}

function redactCostForRole(so, role) {
  if (!COST_HIDDEN_ROLES.includes(role)) return so;
  const clone = { ...so };
  for (const field of COST_FIELDS) delete clone[field];
  return clone;
}

/**
 * PWA FACT (`saveSO`'s milestone-collection loop, verified in the
 * SalesOrder audit §3/§7): at most 5 rows; a row is kept only when BOTH
 * description and amount are truthy — an incomplete row is silently
 * dropped, never rejected. Used by both create and edit.
 */
function collectMilestoneInputs(rawMilestones) {
  const rows = Array.isArray(rawMilestones) ? rawMilestones : [];
  return rows.slice(0, 5).filter((m) => m && m.description && Number(m.amount));
}

async function createSalesOrder(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, CREATE_ROLES, 'create a SalesOrder');

  const companyId = actorAuth.companyId;
  let actorName = actorAuth.name;
  if (!actorName && deps.userRepoForEnquiry) {
    const actorUser = await deps.userRepoForEnquiry.findById(actorAuth.userId);
    actorName = actorUser ? actorUser.name : '';
  }

  const overrides = { ...input, paymentMilestones: collectMilestoneInputs(input && input.paymentMilestones) };
  // PWA FACT (`mSO()` with no args, PWA_COVERAGE_AUDIT_SALESORDER.md §4):
  // no Enquiry is consulted at all for this path.
  const draft = cascade.buildSalesOrderDraft(null, overrides, actorName);
  cascade.validateSalesOrderDraft(draft);

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const orderNumber = await txnDeps.counterRepo.getNextSequence(companyId, 'salesOrder', session);
    return cascade.runCreationCascade({ draft, orderNumber, companyId, enquiryId: null, session, deps: txnDeps });
  });
}

async function getSalesOrder(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, VIEW_ROLES, 'view SalesOrders');
  const so = await deps.salesOrderRepo.findById(actorAuth.companyId, id);
  if (!so) {
    throw new ServiceError('SalesOrder not found.', 'NOT_FOUND', 404);
  }
  return redactCostForRole(so, actorAuth.role);
}

/**
 * PWA FACT (`saveSO`'s edit branch, verified in the SalesOrder audit §6):
 * plain field merge, no Project re-creation, no re-derivation of stage or
 * checklist, no Enquiry interaction. Milestone `rcv` is preserved BY ARRAY
 * INDEX from the existing SO's same-index milestone (locked decision
 * "Milestone received flag preservation = A" — reproduce this exactly,
 * including its possible misattribution after reorder/removal). The
 * milestone amount written here is the SO's OWN copy only — per the locked
 * asymmetric-synchronization decision, an SO-side edit never pushes the new
 * amount onto the linked Payment record (see paymentService.js, which is
 * the only direction that IS synchronized).
 */
async function editSalesOrder(id, patchInput, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, EDIT_ROLES, 'edit a SalesOrder');

  const existing = await deps.salesOrderRepo.findById(actorAuth.companyId, id);
  if (!existing) {
    throw new ServiceError('SalesOrder not found.', 'NOT_FOUND', 404);
  }

  const patch = {};
  const EDITABLE_FIELDS = [
    'division', 'projectName', 'startDate', 'endDate', 'siteAddress', 'contacts',
    'salesTeam', 'projectTeam', 'crucialPoints', 'totalCost', 'highSideSelling',
    'highSidePurchase', 'lowSideCost', 'lowSideTargetExpense', 'lowSideActualExpense',
    'termsAndConditions',
  ];
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patchInput || {}, field)) {
      patch[field] = patchInput[field];
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'projectName') && !patch.projectName) {
    throw new ServiceError('Project name is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("so_pn")){toast(...)}`
  }
  if (patch.contacts && patch.contacts.length > 2) {
    throw new ServiceError('A sales order has at most 2 contacts (PWA FACT).', 'VALIDATION_ERROR', 400);
  }

  if (Object.prototype.hasOwnProperty.call(patchInput || {}, 'paymentMilestones')) {
    const rows = collectMilestoneInputs(patchInput.paymentMilestones);
    patch.paymentMilestones = rows.map((m, i) => ({
      description: m.description,
      amount: m.amount,
      // PWA FACT: `(id&&DB.sos.find(...).pay[i]||{}).rcv||false` — preserved
      // by SAME ARRAY INDEX from the pre-edit milestone list, not by any
      // durable identity. Intentionally NOT "fixed."
      received: (existing.paymentMilestones[i] && existing.paymentMilestones[i].received) || false,
    }));
  }

  return deps.salesOrderRepo.update(actorAuth.companyId, id, patch);
}

// PWA FACT (`vSOs`): free-text search over these fields via the generic `hit()` helper.
function applySalesOrderFilters(rows, filters) {
  const f = filters || {};
  return rows.filter((x) => {
    if (f.q) {
      const q = String(f.q).toLowerCase();
      const blob = [x.orderNumber, x.projectName, x.division, x.siteAddress, x.salesTeam, x.projectTeam, x.startDate, x.totalCost]
        .filter((v) => v !== undefined && v !== null)
        .join(' ')
        .toLowerCase();
      if (blob.indexOf(q) < 0) return false;
    }
    if (f.division && x.division !== f.division) return false;
    return true;
  });
}

/**
 * PWA FACT (`vSOs`, PWA_COVERAGE_AUDIT_SALESORDER.md §13): the LIST view's
 * received/pending totals trust the SO's own `paymentMilestones[].received`
 * flags directly — NOT the reconciled `paySum()` calculation the CSV report
 * uses (see `computePaySummaryFromFlags` vs. `computeReconciledPaySummary`
 * below). This is a deliberately preserved PWA quirk, not a bug to fix.
 */
function computePaySummaryFromFlags(so) {
  const milestones = so.paymentMilestones || [];
  const received = milestones.filter((m) => m.received).reduce((a, m) => a + (m.amount || 0), 0);
  const pending = milestones.filter((m) => !m.received).reduce((a, m) => a + (m.amount || 0), 0);
  return { received, pending, total: received + pending };
}

async function listSalesOrders(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, VIEW_ROLES, 'view SalesOrders');
  const all = await deps.salesOrderRepo.listByCompany(actorAuth.companyId);
  const scoped = applySalesOrderFilters(all, filters);
  return scoped.map((so) => ({ ...redactCostForRole(so, actorAuth.role), paySummary: computePaySummaryFromFlags(so) }));
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function formatDateForCsv(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * PWA FACT (`paySum`, verified in the SalesOrder audit §8): reconciles each
 * milestone against its linked Payment record's actual part-payment ledger
 * when the milestone isn't already flagged `received` — used ONLY for the
 * CSV report (`dlSOs`), never the list view (see `computePaySummaryFromFlags`).
 */
async function computeReconciledPaySummary(companyId, so, deps) {
  const milestones = so.paymentMilestones || [];
  let received = 0;
  const total = milestones.reduce((a, m) => a + (m.amount || 0), 0);
  for (let i = 0; i < milestones.length; i += 1) {
    const m = milestones[i];
    if (m.received) {
      received += m.amount || 0;
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const payment = await deps.paymentRepo.findBySalesOrderAndMilestone(companyId, so.id, i);
    if (payment) {
      const recv = (payment.partPayments || []).reduce((a, p) => a + (p.amount || 0), 0);
      received += recv;
    }
  }
  return { received, pending: total - received, total };
}

/**
 * PWA FACT (`dlSOs`, PWA_COVERAGE_AUDIT_SALESORDER.md §14): exact column
 * order, a `rptHead`-style header block, and a TOTAL row. Margin is
 * computed on the fly, never stored (PWA FACT).
 */
async function exportSalesOrdersCsv(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, VIEW_ROLES, 'export SalesOrder reports');
  const all = await deps.salesOrderRepo.listByCompany(actorAuth.companyId);
  const rows = applySalesOrderFilters(all, filters);

  const lines = [];
  lines.push([csvEscape(`SALES ORDER REPORT`)].join(','));
  lines.push([csvEscape(`Generated ${formatDateForCsv(new Date())} by ${actorAuth.name || actorAuth.userId} (${actorAuth.role})`)].join(','));
  lines.push('');
  const header = [
    'SO No', 'Division', 'Project', 'Site Address', 'Start', 'End', 'Sales Team', 'Project Team',
    'Contact 1', 'Phone 1', 'Contact 2', 'Phone 2', 'Total Cost', 'High Side Selling',
    'High Side Purchase', 'Low Side Cost', 'Low Side Target Exp', 'Low Side Actual Exp',
    'Total Margin', 'Received', 'Pending', 'Terms',
  ];
  lines.push(header.map(csvEscape).join(','));

  let totalCost = 0;
  let totalReceived = 0;
  let totalPending = 0;
  for (const x of rows) {
    const c1 = (x.contacts && x.contacts[0]) || {};
    const c2 = (x.contacts && x.contacts[1]) || {};
    const margin = (x.highSideSelling || 0) - (x.highSidePurchase || 0) + ((x.lowSideCost || 0) - (x.lowSideActualExpense || x.lowSideTargetExpense || 0));
    // eslint-disable-next-line no-await-in-loop
    const ps = await computeReconciledPaySummary(actorAuth.companyId, x, deps);
    totalCost += x.totalCost || 0;
    totalReceived += ps.received;
    totalPending += ps.pending;
    lines.push(
      [
        x.orderNumber, x.division, x.projectName, x.siteAddress, formatDateForCsv(x.startDate), formatDateForCsv(x.endDate),
        x.salesTeam, x.projectTeam, c1.name || '', c1.phone || '', c2.name || '', c2.phone || '',
        x.totalCost, x.highSideSelling, x.highSidePurchase, x.lowSideCost, x.lowSideTargetExpense,
        x.lowSideActualExpense, margin, ps.received, ps.pending, x.termsAndConditions,
      ].map(csvEscape).join(',')
    );
  }
  lines.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', totalCost, '', '', '', '', '', '', totalReceived, totalPending, ''].map(csvEscape).join(','));
  return lines.join('\n');
}

module.exports = {
  createSalesOrder,
  getSalesOrder,
  editSalesOrder,
  listSalesOrders,
  exportSalesOrdersCsv,
  // exported for tests / reuse
  applySalesOrderFilters,
  collectMilestoneInputs,
  computePaySummaryFromFlags,
  computeReconciledPaySummary,
  CREATE_ROLES,
  EDIT_ROLES,
  VIEW_ROLES,
};
