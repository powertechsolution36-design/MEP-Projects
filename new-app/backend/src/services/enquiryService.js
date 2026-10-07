'use strict';

const { ServiceError } = require('../errors');
const { PROJECT_STAGES_BY_DIVISION } = require('../models/shared/enums');
const cascade = require('./salesOrderCascade');

/**
 * Enquiry business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_ENQUIRY.md,
 * DOMAIN_MODEL.md, DATABASE_SCHEMA.md, and the locked decisions in
 * ENQUIRY_BUSINESS_DECISION_SHEET.md:
 *   #17 Edit History              = HOLD FOR #3 (no edit-history mechanism built here)
 *   #18 Lost Fields on Reopen     = A (preserve PWA behavior — do NOT clear lostReason/lostDate)
 *   #19 Won/Conversion Guard      = B (NEW BACKEND DESIGN — add backend protection)
 *   #20 SalesOrder Back-Reference = D (keep `enquiryId`, durable + enforced)
 *
 * Every function is pure business logic operating on injected repositories
 * (deps) — never touches Mongoose models directly — so it is fully unit
 * testable without any live database connection, matching the pattern
 * established by src/auth/authService.js and src/services/companyService.js.
 *
 * PWA API_BASE/TOKEN/SOCKET/API_MODE integration code is out of scope
 * (V2-connection-patch material) — the PWA's non-API `else` branches (local
 * DB.* array mutation, notify()'s local-push branch) are the sole functional
 * source of truth reproduced here.
 */

// PWA FACT (DOMAIN_MODEL.md "Divisions" + Enquiry "segment" note): a segment
// is one of the three divisions, or the literal "AMC" value (which maps to
// HVAC on conversion — see below). Not a Mongoose enum (Enquiry.js leaves
// `segment` as a plain required String, matching the audited schema), but
// validated here at the application layer so a nonsense value cannot be
// saved through this service.
const VALID_SEGMENTS = Object.freeze(['HVAC', 'Solar', 'MEP', 'AMC']);

// PWA FACT (verified against source, markLost's `lr_s` <select> options).
// Presented here for callers/UIs to build the same picklist; NOT enforced
// as a hard enum — the PWA's own `lr_s` allows the blank "— select —"
// option (no reason) and `lr_t` free text is combined in either case.
const LOST_REASON_OPTIONS = Object.freeze([
  'Price too high',
  'Lost to competitor',
  'Client dropped the project',
  'Budget not approved',
  'No response from client',
  'Other',
]);

// PWA FACT (verified: saveSO's fixed `terms` default when creating a fresh SO).
// Shared with the standalone-SO creation path — see src/services/salesOrderCascade.js.
const DEFAULT_TERMS_AND_CONDITIONS = cascade.DEFAULT_TERMS_AND_CONDITIONS;

// PWA FACT (DOMAIN_MODEL.md / roleDivision.js ROLE_DIVISION_MAP, inverted):
// which PM role a division's SO-creation notification targets.
// Shared with the standalone-SO creation path — see src/services/salesOrderCascade.js.
const DIVISION_PM_ROLE = cascade.DIVISION_PM_ROLE;

function todayDate() {
  return new Date();
}

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

// PWA FACT: only `sales` can create ("+ New Enquiry" is hidden for `admin`
// via `U.role!=="admin"`, and no other role has menu access to Enquiries at
// all). Enforced HERE, server-side — the PWA only ever hid the button.
const CREATE_ROLES = Object.freeze(['sales']);
// PWA FACT: `admin` can do everything `sales` can except create (edit,
// follow-up, mark Lost, reopen, convert — none of these carry a role gate
// in the PWA beyond menu access). Enforced HERE, server-side.
const MANAGE_ROLES = Object.freeze(['sales', 'admin']);

async function createEnquiry(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, CREATE_ROLES, 'create an Enquiry');

  const { name, siteType, capacity, segment, phone, referenceSource, rating, estimatedValue, remark } =
    input || {};

  if (!name) {
    throw new ServiceError('Project name is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("e_n")){toast(...)}`
  }
  if (!segment) {
    throw new ServiceError('Segment is required.', 'VALIDATION_ERROR', 400); // PWA FACT: segment is a required select
  }
  if (!VALID_SEGMENTS.includes(segment)) {
    throw new ServiceError(
      `Segment must be one of: ${VALID_SEGMENTS.join(', ')}.`,
      'VALIDATION_ERROR',
      400
    );
  }

  const data = {
    companyId: actorAuth.companyId,
    name,
    siteType,
    capacity,
    segment,
    phone,
    referenceSource,
    rating,
    estimatedValue,
    remark,
    lastReviewDate: todayDate(), // PWA FACT: `review:today()` set at creation
    status: 'Open',
    followUpLog: [],
  };

  return deps.enquiryRepo.create(data);
}

async function getEnquiry(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'view Enquiries');
  const enquiry = await deps.enquiryRepo.findById(actorAuth.companyId, id);
  if (!enquiry) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }
  return enquiry;
}

// PWA FACT: the Edit modal's editable fields (`e_n,e_st,e_c,e_s,e_p,e_r,e_rt,e_v,e_rm`).
const EDITABLE_FIELDS = ['name', 'siteType', 'capacity', 'segment', 'phone', 'referenceSource', 'rating', 'estimatedValue', 'remark'];

/**
 * Direct field edit. #17 = HOLD FOR #3: intentionally creates NO edit-history
 * record and does NOT append a followUpLog entry — this matches the PWA
 * exactly (verified: a direct Edit-modal save never touches `log`), and no
 * bespoke edit-history mechanism is built here per the locked decision.
 */
async function editEnquiry(id, patchInput, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'edit an Enquiry');

  const existing = await deps.enquiryRepo.findById(actorAuth.companyId, id);
  if (!existing) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }

  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patchInput || {}, field)) {
      patch[field] = patchInput[field];
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'name') && !patch.name) {
    throw new ServiceError('Project name is required.', 'VALIDATION_ERROR', 400);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'segment')) {
    if (!patch.segment) {
      throw new ServiceError('Segment is required.', 'VALIDATION_ERROR', 400);
    }
    if (!VALID_SEGMENTS.includes(patch.segment)) {
      throw new ServiceError(`Segment must be one of: ${VALID_SEGMENTS.join(', ')}.`, 'VALIDATION_ERROR', 400);
    }
  }

  return deps.enquiryRepo.updateFields(actorAuth.companyId, id, patch);
}

/**
 * PWA FACT (`addFollow`): requires `actionDone`; sets lastActionDone,
 * nextActionDescription, nextActionDate, refreshes lastReviewDate to today,
 * and appends one followUpLog entry combining the two into one line.
 */
async function addFollowUp(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'add a follow-up to an Enquiry');

  const existing = await deps.enquiryRepo.findById(actorAuth.companyId, id);
  if (!existing) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }

  const { actionDone, nextActionDescription, nextActionDate } = input || {};
  if (!actionDone) {
    throw new ServiceError('Action done is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("f_done")){toast(...)}`
  }

  const today = todayDate();
  const text = actionDone + (nextActionDescription ? ` | Next: ${nextActionDescription}` : ''); // PWA FACT, verified literal string

  const patch = {
    lastActionDone: actionDone,
    nextActionDescription: nextActionDescription || undefined,
    nextActionDate: nextActionDate || undefined,
    lastReviewDate: today,
  };

  return deps.enquiryRepo.pushFollowUp(actorAuth.companyId, id, patch, { date: today, text });
}

/**
 * PWA FACT (`markLost`/`doMarkLost`): reason picklist value and free-text
 * remark are joined with " — " (only the non-empty ones), stored verbatim
 * as `lostReason` — reason is NOT required (verified: both `lr_s` and
 * `lr_t` may be empty, producing an empty-string lostReason).
 */
async function markLost(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'mark an Enquiry as Lost');

  const existing = await deps.enquiryRepo.findById(actorAuth.companyId, id);
  if (!existing) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }

  const { reason, remark } = input || {};
  const combined = [reason, remark].filter(Boolean).join(' — '); // PWA FACT, verified literal join
  const today = todayDate();
  const logText = 'Marked lost' + (combined ? ` — ${combined}` : ''); // PWA FACT, verified literal string

  const patch = { status: 'Lost', lostReason: combined, lostDate: today };
  return deps.enquiryRepo.pushFollowUp(actorAuth.companyId, id, patch, { date: today, text: logText });
}

/**
 * PWA FACT (`reopenEnq`): status -> Open, one followUpLog entry appended.
 * #18 = A (locked, preserve PWA behavior): lostReason/lostDate are
 * INTENTIONALLY left untouched — do not clear them here.
 */
async function reopenEnquiry(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'reopen an Enquiry');

  const existing = await deps.enquiryRepo.findById(actorAuth.companyId, id);
  if (!existing) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }
  if (existing.status !== 'Lost') {
    throw new ServiceError('Only a Lost Enquiry can be reopened.', 'INVALID_STATE', 409);
  }

  const today = todayDate();
  const updated = await deps.enquiryRepo.reopenIfLost(actorAuth.companyId, id, {
    date: today,
    text: 'Enquiry reopened', // PWA FACT, verified literal string
  });
  if (!updated) {
    // Raced with something else that changed status away from Lost in between.
    throw new ServiceError('Only a Lost Enquiry can be reopened.', 'INVALID_STATE', 409);
  }
  return updated;
}

// PWA FACT (`applyEnqFilt`) — translated field names: seg->segment,
// ref->referenceSource, from/to->lastReviewDate range, ndFrom/ndTo->nextActionDate
// range, vmin/vmax->estimatedValue range, q-> free-text search over the same
// blob of fields (name, phone, referenceSource, segment, siteType,
// nextActionDescription, lastActionDone, remark, capacity).
function toComparableDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function applyEnquiryFilters(rows, filters) {
  const f = filters || {};
  return rows.filter((x) => {
    if (f.q) {
      const q = String(f.q).toLowerCase();
      const blob = [x.name, x.phone, x.referenceSource, x.segment, x.siteType, x.nextActionDescription, x.lastActionDone, x.remark, x.capacity]
        .filter((v) => v !== undefined && v !== null)
        .join(' ')
        .toLowerCase();
      if (blob.indexOf(q) < 0) return false;
    }
    if (f.segment && x.segment !== f.segment) return false;
    if (f.siteType && x.siteType !== f.siteType) return false;
    if (f.rating && String(x.rating) !== String(f.rating)) return false;
    if (f.status && x.status !== f.status) return false;
    if (f.referenceSource && x.referenceSource !== f.referenceSource) return false;

    if (f.reviewFrom) {
      const from = toComparableDate(f.reviewFrom);
      const val = toComparableDate(x.lastReviewDate);
      if (from && (!val || val < from)) return false;
    }
    if (f.reviewTo) {
      const to = toComparableDate(f.reviewTo);
      const val = toComparableDate(x.lastReviewDate);
      if (to && (!val || val > to)) return false;
    }
    if (f.nextActionFrom) {
      const from = toComparableDate(f.nextActionFrom);
      const val = toComparableDate(x.nextActionDate);
      if (from && (!val || val < from)) return false;
    }
    if (f.nextActionTo) {
      const to = toComparableDate(f.nextActionTo);
      const val = toComparableDate(x.nextActionDate);
      if (to && (!val || val > to)) return false;
    }
    if (f.valueMin !== undefined && f.valueMin !== null && f.valueMin !== '') {
      if ((x.estimatedValue || 0) < Number(f.valueMin)) return false;
    }
    if (f.valueMax !== undefined && f.valueMax !== null && f.valueMax !== '') {
      if ((x.estimatedValue || 0) > Number(f.valueMax)) return false;
    }
    return true;
  });
}

/**
 * PWA FACT: the Enquiry List screen excludes Lost by default
 * (`x.status!=="Lost"`); the Lost Enquiries screen shows only Lost. Both
 * apply the same `applyEnqFilt`. `includeLost: true` reproduces the Lost
 * Enquiries screen's scope; the default reproduces the Enquiry List screen.
 */
async function listEnquiries(actorAuth, { includeLost = false, filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'view Enquiries');

  const all = await deps.enquiryRepo.listByCompany(actorAuth.companyId);
  const scoped = includeLost ? all.filter((x) => x.status === 'Lost') : all.filter((x) => x.status !== 'Lost');
  return applyEnquiryFilters(scoped, filters);
}

/**
 * PWA FACT (`followupPanel`): Open enquiries whose nextActionDate is set and
 * <= today. NOTE — in the PWA this dashboard panel is rendered for `sales`
 * only (verified: `admin` does not see it, despite having full edit/lost/
 * reopen/convert access to every Enquiry — flagged in the audit as an
 * unexplained UI quirk, not a business rule). This service deliberately
 * makes the underlying data available to both `sales` and `admin` (the same
 * visibility as every other Enquiry read here), rather than reproducing
 * what the audit itself calls an inconsistent, undocumented UI restriction
 * with no stated business rationale — see PWA_COVERAGE_AUDIT_ENQUIRY.md §13.
 */
async function getFollowUpsDueToday(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'view the follow-ups-due dashboard');

  const all = await deps.enquiryRepo.listByCompany(actorAuth.companyId);
  const today = todayDate();
  return all.filter((x) => {
    if (x.status !== 'Open') return false;
    const nd = toComparableDate(x.nextActionDate);
    return Boolean(nd) && nd <= today;
  });
}

/**
 * Reporting/dashboard query — segment-wise summary (PWA FACT: "segment-wise
 * summary panel", DOMAIN_MODEL.md "PWA screens" bullet) plus a status
 * breakdown, the two dimensions the PWA's own Enquiry screens group by.
 */
async function getSegmentSummary(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'view Enquiry reporting');

  const all = await deps.enquiryRepo.listByCompany(actorAuth.companyId);
  const bySegment = new Map();
  const byStatus = { Open: 0, Won: 0, Lost: 0 };

  for (const x of all) {
    if (Object.prototype.hasOwnProperty.call(byStatus, x.status)) byStatus[x.status] += 1;
    const key = x.segment || 'Unknown';
    const entry = bySegment.get(key) || { segment: key, count: 0, totalValue: 0 };
    entry.count += 1;
    entry.totalValue += x.estimatedValue || 0;
    bySegment.set(key, entry);
  }

  return { bySegment: Array.from(bySegment.values()), byStatus };
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
 * PWA FACT (`dlEnq`): exact column order —
 * Sr, Project/Address, Site Type, Capacity, Customer Phone, Reference,
 * Segment, Review Date, Rating, Action Done, Next Action Date, Next Action,
 * Remark, Project Value, Status — plus a TOTAL row summing Project Value.
 * "Sr" uses this backend's own id (DOMAIN_MODEL.md: the PWA never shows an
 * enquiry number to the user in the first place, only an internal id).
 */
async function exportEnquiriesCsv(actorAuth, { includeLost = false, filters = {} } = {}, deps) {
  const rows = await listEnquiries(actorAuth, { includeLost, filters }, deps);

  const header = [
    'Sr', 'Project/Address', 'Site Type', 'Capacity', 'Customer Phone', 'Reference', 'Segment',
    'Review Date', 'Rating', 'Action Done', 'Next Action Date', 'Next Action', 'Remark', 'Project Value', 'Status',
  ];
  const lines = [header.map(csvEscape).join(',')];
  let total = 0;
  for (const x of rows) {
    total += x.estimatedValue || 0;
    lines.push(
      [
        x.id,
        x.name,
        x.siteType,
        x.capacity,
        x.phone,
        x.referenceSource,
        x.segment,
        formatDateForCsv(x.lastReviewDate),
        x.rating,
        x.lastActionDone,
        formatDateForCsv(x.nextActionDate),
        x.nextActionDescription,
        x.remark,
        x.estimatedValue || 0,
        x.status,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  lines.push(['', '', '', '', '', '', '', '', '', '', '', '', 'TOTAL', total, ''].map(csvEscape).join(','));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Enquiry -> SalesOrder conversion (the transactional cascade)
// ---------------------------------------------------------------------------

/**
 * PWA FACT (`mSO` pre-fill + `saveSO`): exact field-copy/transform/default
 * behavior verified against source. See PWA_COVERAGE_AUDIT_ENQUIRY.md §5 and
 * DOMAIN_MODEL.md/DATABASE_SCHEMA.md SalesOrder "Create" sections — this is
 * the same list, not re-invented here.
 *
 *   copied unchanged   — name->projectName, phone->contacts[0].phone, estimatedValue->totalCost
 *   transformed        — segment->division ("AMC"->"HVAC", else pass-through)
 *   defaulted          — startDate=today, salesTeam=converting user's name, terms=fixed boilerplate
 *   NOT derived at all — siteAddress, contacts[0].name/designation, contacts[1], projectTeam,
 *                        crucialPoints, endDate, cost-breakdown fields (highSideSelling/
 *                        highSidePurchase/lowSideCost/lowSideTargetExpense/lowSideActualExpense),
 *                        paymentMilestones — the PWA's own prefilled form starts these blank/empty
 *                        and requires the converting user to fill them in before saving; all
 *                        Enquiry-derived defaults above remain user-editable in that same form
 *                        before save, so `soOverrides` may override any of them here too.
 */
// Delegates to src/services/salesOrderCascade.js — the exact same
// field-copy/transform/default behavior described above, generalized so
// the standalone SalesOrder creation path (src/services/salesOrderService.js)
// can reuse it with enquiry=null instead of duplicating this logic.
const buildSalesOrderDraft = cascade.buildSalesOrderDraft;
const validateSalesOrderDraft = cascade.validateSalesOrderDraft;
/**
 * Implements the full, verified Enquiry -> SalesOrder conversion cascade:
 *   1. Load/lock/revalidate Enquiry (atomic conditional update, see below).
 *   2. Require status === Open (#19=B — rejected otherwise, race-safe).
 *   3/4. Prevent duplicate conversion (pre-check + DB-level unique index).
 *   5. Create SalesOrder with the exact audited field-copy/transform/default behavior.
 *   6. Set SalesOrder.enquiryId automatically (#20=D — never client-editable).
 *   7. Create the Project (division's first stage; checklist copied from the
 *      division's default ChecklistTemplate; customer = contacts[0].name).
 *   8. Create one Payment per milestone (all unreceived on a fresh SO).
 *   9. (done as part of 7) Apply the correct division ChecklistTemplate.
 *  10. Generate the two verified notifications.
 *  11. Mark Enquiry Won (the same atomic update as step 1/2).
 *  12. Apply the verified Enquiry remark overwrite (same update).
 *  13. Append the verified conversion followUpLog entry (same update).
 *  14. The whole cascade runs inside one DB transaction (deps.withTransaction)
 *      so it cannot partially succeed.
 */
async function convertEnquiryToSalesOrder(id, soOverrides, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, MANAGE_ROLES, 'convert an Enquiry to a SalesOrder');

  const companyId = actorAuth.companyId;

  // Pre-checks (fast-fail before opening a transaction) — the authoritative,
  // race-safe guards are still the atomic operations inside the transaction
  // below (markWonIfOpen's conditional update + SalesOrder's unique index).
  const enquiry = await deps.enquiryRepo.findById(companyId, id);
  if (!enquiry) {
    throw new ServiceError('Enquiry not found.', 'NOT_FOUND', 404);
  }
  if (enquiry.status !== 'Open') {
    throw new ServiceError('Only an Open Enquiry can be converted to a SalesOrder.', 'ENQUIRY_NOT_OPEN', 409); // #19=B
  }
  const existingSo = await deps.salesOrderRepo.findByEnquiryId(companyId, id);
  if (existingSo) {
    throw new ServiceError('This Enquiry has already been converted to a SalesOrder.', 'DUPLICATE_CONVERSION', 409); // #19=B
  }

  let actorName = actorAuth.name;
  if (!actorName && deps.userRepoForEnquiry) {
    const actorUser = await deps.userRepoForEnquiry.findById(actorAuth.userId);
    actorName = actorUser ? actorUser.name : '';
  }

  const draft = buildSalesOrderDraft(enquiry, soOverrides, actorName);
  validateSalesOrderDraft(draft);

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;

    // Steps 1/2/11/12/13 as one atomic, race-safe conditional update.
    // We need the orderNumber before we can build the remark/log text, but we
    // also need the atomic Won-guard to run before any SalesOrder is written
    // (so a losing race never leaves an orphan SalesOrder behind). To satisfy
    // both, the sequence number is reserved first (harmless if unused — it is
    // a monotonic counter, not a display gap-sensitive field per
    // DATABASE_SCHEMA.md "Sequences"), then the guard runs, then the rest of
    // the cascade proceeds only if the guard succeeded.
    const orderNumber = await txnDeps.counterRepo.getNextSequence(companyId, 'salesOrder', session);

    const remark = `Converted to SO-${orderNumber}`; // PWA FACT, verified literal string
    const logText = `Confirmed. SO-${orderNumber} created.`; // PWA FACT, verified literal string
    const today = todayDate();

    const wonEnquiry = await txnDeps.enquiryRepo.markWonIfOpen(
      companyId,
      id,
      { remark, logEntry: { date: today, text: logText } },
      session
    );
    if (!wonEnquiry) {
      throw new ServiceError(
        'Only an Open Enquiry can be converted to a SalesOrder.',
        'ENQUIRY_NOT_OPEN',
        409
      ); // Lost the race — someone else converted/changed status first.
    }

    // Steps 5-10 (SalesOrder + Project + Payments + notifications) are
    // IDENTICAL between this conversion path and the standalone "+ New SO"
    // path (PWA_COVERAGE_AUDIT_SALESORDER.md §5) — shared via
    // salesOrderCascade.js so the two paths cannot drift apart. Only the
    // Enquiry-specific Won-guard (above) and the enquiryId link differ.
    const { salesOrder, project, payments, notifications } = await cascade.runCreationCascade({
      draft,
      orderNumber,
      companyId,
      enquiryId: id,
      session,
      deps: txnDeps,
    });    return { enquiry: wonEnquiry, salesOrder, project, payments, notifications };
  });
}

module.exports = {
  createEnquiry,
  getEnquiry,
  editEnquiry,
  addFollowUp,
  markLost,
  reopenEnquiry,
  listEnquiries,
  getFollowUpsDueToday,
  getSegmentSummary,
  exportEnquiriesCsv,
  convertEnquiryToSalesOrder,
  // exported for tests / reuse
  applyEnquiryFilters,
  buildSalesOrderDraft,
  VALID_SEGMENTS,
  LOST_REASON_OPTIONS,
  DEFAULT_TERMS_AND_CONDITIONS,
  DIVISION_PM_ROLE,
};
