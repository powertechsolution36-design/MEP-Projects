'use strict';

const { ServiceError } = require('../errors');
const projectService = require('./projectService');

/**
 * Contract (AMC / Warranty) business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_CONTRACT.md (442-line
 * independent functional audit of MEP_PROJECTS_PWA/index.html's Contract/
 * AMC/PM code — §§3-21) and new-app/docs/CONTRACT_DECISION_LOCK.md (469
 * lines, locking all 15 Contract/ServiceCall decisions the audit raised).
 * Every PWA-demonstrated behavior — including its quirks, asymmetries, and
 * the total absence of edit/delete/role-enforcement — is reproduced
 * exactly, per the locked "preserve PWA exactly" principle, EXCEPT the two
 * named infrastructure/security exceptions below.
 *
 * SCOPE: this module implements Contract only. ServiceCall, Inventory, and
 * every other module remain explicitly out of scope (per instruction) —
 * the only ServiceCall-facing surface this module exposes is the minimal
 * boundary a future ServiceCall implementation would need to call
 * (`computePmDueIndexes`/`completePmVisitForContract`, see Decision 4/12 of
 * CONTRACT_DECISION_LOCK.md, §7 "Contract -> ServiceCall boundary").
 *
 * The two infrastructure/security exceptions applied here (ground rules +
 * CONTRACT_DECISION_LOCK.md Decisions 6 and 10):
 *  1. Real server-side role enforcement reproducing the PWA's own VISIBLE
 *     role intent (the PWA itself has zero function-level role checks
 *     anywhere in the Contract code path — see assertCanManageContracts
 *     below).
 *  2. Reuse of projectService's existing prepareServiceConversion/
 *     isEligibleForServiceConversion eligibility stub as the safety gate
 *     for Project -> Contract conversion (Decision 10) — no ADDITIONAL
 *     eligibility condition is introduced beyond the PWA's own UI-visible
 *     one (status==="Completed" && division!=="MEP").
 *
 * DO NOT FIX list (CONTRACT_DECISION_LOCK.md §6) — every one of these is
 * intentionally preserved, not corrected, by this module:
 *  - No Contract edit/delete function exists, and none is added (Decisions
 *    2-3). This module exposes create + read + the one automatic
 *    `completedDate` stamp only.
 *  - Duplicate manual creation and duplicate Project->Contract conversion
 *    are never blocked (Decisions 9, and audit §18 #10).
 *  - Expired contracts continue to surface in the PM-Due computation
 *    forever (Decision 11).
 *  - `category` (AMC vs Warranty) is a label-only distinction — zero
 *    behavioral difference anywhere (Decision 15).
 *  - ServiceCall completion stamps the FIRST CURRENTLY-DUE scheduled-visit
 *    slot, recomputed fresh, never a slot specific to the triggering
 *    ServiceCall (Decision 4) — see completePmVisitForContract below.
 *  - `phone`/`email` are hardcoded blank ("") on Project->Contract
 *    (Warranty) conversion — never copied from the originating
 *    Project/SalesOrder contact (Decision 6 of PROJECT_DECISION_LOCK.md /
 *    audit §4/§18 #7).
 *  - Manual AMC/Warranty creation fires ZERO notifications, asymmetric
 *    with the conversion path's notification (Decision 7).
 *  - No Contract->Payment linkage of any kind, ever (Decision 1).
 *  - No Contract display/reference number (Decision 13).
 *  - Contract<->ServiceCall stays one-way: no reverse array/history is
 *    stored on Contract (Decision 12).
 *  - The 4-visit display/export cap for a Monthly (12-visit) contract's
 *    CSV export is preserved exactly (Decision 5) — see exportContractsCsv.
 *
 * STORAGE-LAYER RECONCILIATION (Decision 8, explicitly flagged in
 * CONTRACT_DECISION_LOCK.md as an open tension for whoever builds this
 * layer): the PWA's manual `saveContract()` stores `end` with NO fallback
 * and NO validation — a blank string is accepted and, combined with
 * `contractStatus()`'s plain string comparison, immediately reads as
 * "Expired" (a blank string sorts before any real date string). Mongo has
 * no equivalent of "an absent-but-present empty string" for a Date field,
 * so Contract.js's `endDate` was changed from `required: true` to
 * `default: null` (see that file's own comment) — a storage-representation
 * necessity, not a business-validation change: no create-Contract call is
 * ever rejected for omitting `end`, exactly matching the PWA. This
 * module's computeContractStatus treats a null endDate as unconditionally
 * "before any real date" (i.e. always Expired), reproducing the PWA's
 * observable outcome exactly, and exportContractsCsv prints a blank End
 * column for a null endDate (matching the PWA's own blank-string display),
 * never a fabricated sentinel date.
 */

const MANAGE_ROLES = Object.freeze(['admin', 'service_mgr']); // PWA FACT (§13): menu/button gate for create, PM-schedule, reports.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

/**
 * CONTRACT_DECISION_LOCK.md Decision 6: real server-side enforcement of the
 * PWA's own VISIBLE role intent for Contract create (both paths), PM-
 * schedule/ServiceCall creation (out of scope here — reserved for a future
 * ServiceCall module to call), and reports/CSV export. Do NOT add any
 * restriction beyond this (e.g. no division-scoping — Contract is not
 * division-scoped in the PWA at all, audit §2).
 */
function assertCanManageContracts(actorAuth, actionDescription) {
  if (!MANAGE_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'manage Contracts'} (must be admin or service_mgr).`,
      'FORBIDDEN',
      403
    );
  }
}

/**
 * PWA FACT (`vCall()`'s report-editing gate, §10, reused by Decision 6 for
 * PM-visit completion): the assigned engineer (identity match) OR
 * admin/service_mgr. `assignedEngineerUserId` is supplied by the (not yet
 * implemented) ServiceCall completion caller — this module has no
 * ServiceCall data of its own to derive it from.
 */
function assertCanCompletePmVisit(actorAuth, assignedEngineerUserId) {
  if (MANAGE_ROLES.includes(actorAuth.role)) return;
  if (assignedEngineerUserId && String(assignedEngineerUserId) === String(actorAuth.userId)) return;
  throw new ServiceError(
    `Role "${actorAuth.role}" is not permitted to mark a PM visit complete (must be the assigned engineer, admin, or service_mgr).`,
    'FORBIDDEN',
    403
  );
}

function todayDate() {
  return new Date();
}

// PWA FACT: today()/thisMonth() both derive from `toISOString()`, i.e. a
// UTC-based day/month key — reproduced here with explicit UTC accessors so
// server behavior does not depend on the host process's local timezone
// (a deterministic infra choice, not a business change: every valid
// PWA-representable date still produces the same Active/Expiring/Expired
// and due/not-due outcomes).
function dateOnlyUTC(d) {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function monthKeyUTC(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function dayKeyUTC(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * PWA FACT (§5, both generators, re-verified against the literal PWA
 * source — `saveContract`/`convertToService`): visit count/interval by
 * `amcType`, always anchored to the contract's own effective start month
 * (the conversion path's base happens to equal "today" since its `start`
 * is also "today", but the formula itself is start-anchored, not a
 * separate "today" special case).
 *
 * CONTRACT_DECISION_LOCK.md §11 — Monthly=12/1mo, Half-Yearly=2/6mo
 * (NOT 6 visits — a corrected assumption), Quarterly=4/3mo (also the
 * fallback for any unrecognized amcType, matching the PWA's own
 * ternary-chain fallback behavior).
 */
function generateScheduledVisits(startDate, amcType) {
  const n = amcType === 'Monthly' ? 12 : amcType === 'Half-Yearly' ? 2 : 4;
  const step = amcType === 'Monthly' ? 1 : amcType === 'Half-Yearly' ? 6 : 3;
  const base = startDate instanceof Date ? startDate : new Date(startDate);
  const visits = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i * step, base.getUTCDate()));
    visits.push({ month: monthKeyUTC(d), completedDate: null });
  }
  return visits;
}

/**
 * PWA FACT (`convertToService`, §4/§18 #5): `end = start + 1 calendar
 * year - 1 day`, computed via `setFullYear(+1)` then `setDate(getDate()-1)`
 * — which correctly rolls to the LAST day of the previous month when the
 * start date's day-of-month is 1 (e.g. 2026-01-01 -> 2026-12-31, not
 * 2027-01-01). Reproduced here with UTC accessors (see dateOnlyUTC note).
 */
function computeOneYearWarrantyEndDate(startDate) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const plusYear = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  return new Date(Date.UTC(plusYear.getUTCFullYear(), plusYear.getUTCMonth(), plusYear.getUTCDate() - 1));
}

/**
 * PWA FACT (`contractStatus`, §6/§11, re-verified literally): Expired if
 * `end < today`; else Expiring Soon if `today >= end-45days`; else Active.
 * A null `endDate` (Decision 8's storage reconciliation for a blank manual
 * `end`) is treated as "before any real date" — i.e. unconditionally
 * Expired, matching the PWA's own `""` < any real date-string outcome.
 */
function computeContractStatus(contract, refDate) {
  const today = dateOnlyUTC(refDate || todayDate());
  if (!contract.endDate) return 'Expired';
  const end = dateOnlyUTC(contract.endDate);
  if (end.getTime() < today.getTime()) return 'Expired';
  const soonThreshold = new Date(end.getTime() - 45 * MS_PER_DAY);
  if (today.getTime() >= soonThreshold.getTime()) return 'Expiring Soon';
  return 'Active';
}

/**
 * PWA FACT (`pmDue`, §6, re-verified literally): a scheduled-visit index is
 * due iff not completed AND its month <= the current month (string/
 * lexicographic comparison of "YYYY-MM" values). Computed entirely
 * independently of contractStatus — an Expired contract's overdue visits
 * still surface here forever (Decision 11, DO NOT FIX).
 */
function computePmDueIndexes(contract, refDate) {
  const tm = monthKeyUTC(refDate || todayDate());
  const out = [];
  (contract.scheduledVisits || []).forEach((visit, i) => {
    if (!visit.completedDate && visit.month <= tm) out.push(i);
  });
  return out;
}

/* ================= CREATION ================= */

/**
 * PWA FACT (`saveContract`, §4 Path B, §8): the only client-side validation
 * anywhere in either creation path is non-empty `site`. Every other field
 * — including a fully blank customer/phone/email/amount/end — is accepted
 * as-is. `start` falls back to today if blank; `amount` falls back to 0 if
 * non-numeric; `end` has NO fallback (Decision 8, see class doc). Schedule
 * is generated from the contract's own `start`, per the selected
 * `amcType`. No notification fires (Decision 7 — asymmetric with
 * conversion). No Payment is ever created (Decision 1).
 */
async function createManualContract(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageContracts(actorAuth, 'create a Contract');

  const site = input && typeof input.site === 'string' ? input.site.trim() : '';
  if (!site) {
    throw new ServiceError('Site name required.', 'VALIDATION_ERROR', 400); // PWA FACT: the one enforced field.
  }

  const startDate = input && input.start ? new Date(input.start) : todayDate();
  const endDate = input && input.end ? new Date(input.end) : null; // PWA FACT (Decision 8): no fallback.
  const amcType = (input && input.amcType) || 'Quarterly'; // PWA FACT: select defaults to Quarterly.
  const category = (input && input.category) || 'AMC'; // PWA FACT: select defaults to AMC.
  const amount = Number(input && input.amount) || 0; // PWA FACT.

  const contract = await deps.contractRepo.create({
    companyId: actorAuth.companyId,
    customer: (input && input.customer) || '',
    phone: (input && input.phone) || '',
    email: (input && input.email) || '',
    site,
    capacity: (input && input.capacity) || '',
    startDate,
    endDate,
    amcType,
    category,
    amount,
    scheduledVisits: generateScheduledVisits(startDate, amcType),
    originatingProjectId: null,
  });
  return contract;
}

/**
 * Project -> Warranty Contract conversion. PWA FACT (`convertToService`,
 * §4 Path A, §18 #5-#7): hardcoded `category="Warranty"`, `amount=0`,
 * `amcType="Quarterly"` (always 4 quarterly visits), 1-year term, blank
 * `phone`/`email`, `customer`=Project.customer||Project.name, `site`=
 * Project.name, `capacity`=Project.capacity, `originatingProjectId`=
 * Project.id. Fires the conversion notification. Sets
 * `Project.status="In Service"` unconditionally (no re-check of the prior
 * status inside this function itself, matching the PWA — the ONLY
 * eligibility re-check is the one already performed by
 * projectService.isEligibleForServiceConversion, per Decision 10). Never
 * creates a Payment, never creates a ServiceCall. Duplicate conversion of
 * the same Project is NOT guarded (Decision 9) — calling this twice for
 * the same project simply produces two independent Contracts, exactly
 * matching the PWA.
 */
async function convertProjectToContract(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  // PWA FACT (§18): the conversion button itself is rendered only for
  // service_mgr/admin — reproduced here, matching
  // projectService.prepareServiceConversion's own role gate exactly.
  if (!MANAGE_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(`Role "${actorAuth.role}" is not permitted to approve commissioning.`, 'FORBIDDEN', 403);
  }

  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);

  // CONTRACT_DECISION_LOCK.md Decision 10: reuse the existing eligibility
  // stub verbatim -- do NOT add any additional condition (e.g. no
  // "no prior Contract from this project" guard -- Decision 9 explicitly
  // forbids that).
  if (!projectService.isEligibleForServiceConversion(project)) {
    throw new ServiceError('Project is not eligible for service conversion (must be Completed and not MEP).', 'NOT_ELIGIBLE', 400);
  }

  const startDate = todayDate();
  const endDate = computeOneYearWarrantyEndDate(startDate);
  const amcType = 'Quarterly'; // PWA FACT: hardcoded, regardless of division/capacity/value.

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const contract = await txnDeps.contractRepo.create(
      {
        companyId: actorAuth.companyId,
        customer: project.customer || project.name,
        phone: '', // PWA QUIRK (Decision 6 of PROJECT_DECISION_LOCK.md / audit §4/§18 #7): hardcoded blank, never copied.
        email: '', // ditto.
        site: project.name,
        capacity: project.capacity,
        startDate,
        endDate,
        amcType,
        category: 'Warranty', // PWA FACT: hardcoded.
        amount: 0, // PWA FACT: hardcoded -- a warranty contract is never billed.
        scheduledVisits: generateScheduledVisits(startDate, amcType), // always exactly 4 quarterly visits (§5 Path A).
        originatingProjectId: project.id,
      },
      session
    );

    // PWA FACT: unconditional -- no re-check of the prior status here (only
    // the eligibility check above, matching Decision 10's scope exactly).
    await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { status: 'In Service' }, session);

    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `Commissioning approved: "${project.name}" converted to Service project — 1 year warranty, quarterly PM scheduled.`,
        date: todayDate(),
        targetRoles: ['service_mgr', 'admin'],
        readByUserIds: [],
      },
      session
    );

    return contract;
  });
}

/* ================= READ / SEARCH / DASHBOARD ================= */

async function getContract(contractId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const contract = await deps.contractRepo.findById(actorAuth.companyId, contractId);
  if (!contract) throw new ServiceError('Contract not found.', 'NOT_FOUND', 404);
  return contract;
}

// PWA FACT (`vPM`'s `hit(c,[...])`, §14, re-verified literally): ten-field
// case-insensitive substring search, no other filters, no sorting.
function contractMatchesQuery(contract, q) {
  const blob = [
    contract.customer, contract.phone, contract.email, contract.site, contract.capacity,
    contract.amcType, contract.category,
    contract.startDate ? dayKeyUTC(contract.startDate) : '',
    contract.endDate ? dayKeyUTC(contract.endDate) : '',
    contract.amount !== undefined && contract.amount !== null ? String(contract.amount) : '',
  ]
    .filter((v) => v !== undefined && v !== null)
    .join(' ')
    .toLowerCase();
  return blob.indexOf(q) >= 0;
}

/**
 * PWA FACT (`vPM`, §14): company-scoped, ten-field substring search, NO
 * sorting/reordering beyond natural (insertion) order -- unlike Project's
 * list, `vPM()` never reverses `mine(DB.contracts)`. Any authenticated
 * company member may call this (view is menu-gated only in the PWA, with
 * no division restriction -- §2/§13) -- CONTRACT_DECISION_LOCK.md Decision
 * 6 only requires server-side enforcement for CREATE/PM-schedule/reports,
 * not for viewing the list.
 */
async function listContracts(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  const all = await deps.contractRepo.listByCompany(actorAuth.companyId);
  const q = filters.q ? String(filters.q).toLowerCase() : '';
  if (!q) return all;
  return all.filter((c) => contractMatchesQuery(c, q));
}

/**
 * PWA FACT (`pmDuePanel`, §14): every currently-due visit across every
 * company contract, flattened to one row per {contract,visitIndex} pair --
 * a contract with 2 simultaneously-due visits appears twice. Expired
 * contracts are NOT excluded (Decision 11, DO NOT FIX).
 */
async function getPmDuePanel(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const all = await deps.contractRepo.listByCompany(actorAuth.companyId);
  const rows = [];
  all.forEach((c) => {
    computePmDueIndexes(c).forEach((i) => {
      rows.push({
        contractId: c.id,
        site: c.site,
        customer: c.customer,
        phone: c.phone,
        category: c.category,
        visitIndex: i,
        month: c.scheduledVisits[i].month,
        overdue: c.scheduledVisits[i].month < monthKeyUTC(todayDate()), // PWA FACT: display-layer-only "overdue" split.
      });
    });
  });
  return rows;
}

/**
 * PWA FACT (`vPM`'s bottom panel, §14): every contract whose status is not
 * "Active" -- purely informational, no "renew" action exists anywhere.
 */
async function getRenewalOpportunities(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const all = await deps.contractRepo.listByCompany(actorAuth.companyId);
  return all
    .map((c) => ({ contract: c, status: computeContractStatus(c) }))
    .filter((x) => x.status !== 'Active');
}

/* ================= REPORTS / EXPORT ================= */

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * PWA FACT (`dlContracts`, §15): exact 20-column header, exact row values
 * (raw fields + computed status/PM-due-count), exactly 4 visit-slot Due/
 * Done pairs (Decision 5 -- silently truncates a Monthly (12-visit)
 * contract's 5th-12th visits, matching the on-screen table's identical
 * cap), exact totals row, raw unconverted "YYYY-MM-DD" date strings (no
 * locale reformatting), company-scoped and filtered by the same search
 * predicate as listContracts. Requires the same manage-role gate as create
 * (Decision 6 -- the PWA's own "⬇ Report" button lives on the same
 * admin/service_mgr-gated pmlist page).
 */
async function exportContractsCsv(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageContracts(actorAuth, 'export the Contract report');
  const rows = await listContracts(actorAuth, { filters }, deps);

  const lines = [];
  lines.push(csvEscape('AMC / Warranty & PM Report'));
  lines.push(
    [
      'Customer', 'Phone', 'Email', 'Site', 'Capacity', 'Category', 'AMC Type', 'Amount', 'Start', 'End', 'Status',
      'PM Due Now', '1st Due', '1st Done', '2nd Due', '2nd Done', '3rd Due', '3rd Done', '4th Due', '4th Done',
    ].map(csvEscape).join(',')
  );

  let amountTotal = 0;
  let dueTotal = 0;
  for (const c of rows) {
    const status = computeContractStatus(c);
    const due = computePmDueIndexes(c);
    amountTotal += Number(c.amount) || 0;
    dueTotal += due.length;
    const row = [
      c.customer, c.phone, c.email, c.site, c.capacity, c.category, c.amcType,
      c.amount || '', c.startDate ? dayKeyUTC(c.startDate) : '', c.endDate ? dayKeyUTC(c.endDate) : '',
      status, due.length,
    ];
    for (let i = 0; i < 4; i += 1) {
      const v = (c.scheduledVisits || [])[i] || {};
      row.push(v.month || '', v.completedDate ? dayKeyUTC(v.completedDate) : '');
    }
    lines.push(row.map(csvEscape).join(','));
  }
  lines.push('');
  lines.push(
    ['TOTAL', `${rows.length} contracts`, '', '', '', '', '', amountTotal, '', '', '', `${dueTotal} PM due/overdue`]
      .map(csvEscape)
      .join(',')
  );
  return lines.join('\n');
}

/* ================= DEFERRED: SERVICECALL-FACING BOUNDARY ================= */

/**
 * The Contract-facing half of the ServiceCall completion side effect
 * (CONTRACT_DECISION_LOCK.md Decision 4/§7): on completing a ServiceCall
 * with a truthy contractId, the (future) ServiceCall module must call this
 * function, which recomputes the due-visit list FRESH and stamps the
 * FIRST currently-due index -- never the specific slot the triggering
 * ServiceCall was originally scheduled against. This is the single most
 * important "DO NOT FIX" in the whole audit -- preserved bug-for-bug.
 *
 * `assignedEngineerUserId` is supplied by the caller (the future
 * ServiceCall module, which alone knows which engineer that ServiceCall
 * was assigned to) -- this module has no ServiceCall data of its own.
 * ServiceCall itself is NOT implemented here; no route in
 * contractRoutes.js exposes this directly (it is an internal boundary API
 * only, per instruction).
 *
 * MINIMAL EXTENSION (ServiceCall implementation task, backwards-compatible):
 * threads `deps.session` (if present) through to `setVisitCompleted` so a
 * caller running this inside its own `deps.withTransaction` block (i.e.
 * ServiceCall completion, which must atomically combine this Contract-slot
 * write with its own ServiceCall-status write and the conditional
 * Chargeable Payment write) gets this write enlisted in that same
 * transaction. When `deps.session` is undefined (every existing call site,
 * including every existing Contract test), `setVisitCompleted`'s optional
 * 5th `session` parameter is simply `undefined`, exactly as before this
 * change -- no existing behavior changes.
 */
async function completePmVisitForContract(contractId, actorAuth, deps, { assignedEngineerUserId } = {}) {
  assertCompanyContext(actorAuth);
  assertCanCompletePmVisit(actorAuth, assignedEngineerUserId);
  const contract = await deps.contractRepo.findById(actorAuth.companyId, contractId);
  if (!contract) throw new ServiceError('Contract not found.', 'NOT_FOUND', 404);

  const due = computePmDueIndexes(contract);
  if (!due.length) return contract; // PWA FACT: `if(due.length) c.svcs[due[0]].done=today()` -- a no-op when nothing is due.

  return deps.contractRepo.setVisitCompleted(actorAuth.companyId, contractId, due[0], todayDate(), deps.session);
}

module.exports = {
  createManualContract,
  convertProjectToContract,
  getContract,
  listContracts,
  getPmDuePanel,
  getRenewalOpportunities,
  exportContractsCsv,
  completePmVisitForContract,
  // exported for tests / reuse
  generateScheduledVisits,
  computeOneYearWarrantyEndDate,
  computeContractStatus,
  computePmDueIndexes,
  assertCanManageContracts,
  MANAGE_ROLES,
};
