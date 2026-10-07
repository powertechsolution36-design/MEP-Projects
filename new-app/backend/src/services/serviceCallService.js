'use strict';

const { ServiceError } = require('../errors');
const contractService = require('./contractService');

/**
 * ServiceCall (Complaint / PM visit) business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_SERVICECALL.md (558-line
 * independent functional audit of MEP_PROJECTS_PWA/index.html's ServiceCall
 * code — §§1-27) and new-app/docs/SERVICECALL_DECISION_LOCK.md (356 lines,
 * locking all 13 open items the audit raised, plus explicitly restating the
 * 5 items that remain genuinely open -- see "GENUINELY OPEN" comments
 * below, none of which is silently resolved by this module). Every
 * PWA-demonstrated behavior -- including its quirks and asymmetries -- is
 * reproduced exactly, per the locked "preserve PWA exactly" principle,
 * EXCEPT the approved infrastructure/security exceptions named throughout.
 *
 * DO NOT FIX list (SERVICECALL_DECISION_LOCK.md §21/§23) -- every one of
 * these is intentionally preserved, not corrected, by this module:
 *  - Separate PSC/id "sequences" (superseded numerically only by the
 *    per-company Counter -- see registerComplaint/schedulePM).
 *  - PM-type calls never transition to "Assigned" via assignEngineer.
 *  - Assignment notification fires on every save with a non-blank
 *    engineer, no dedup.
 *  - `service_mgr` is a valid engineer-assignment candidate.
 *  - No division filtering of the engineer candidate pool.
 *  - Draft/completion allowed with a blank checklist/report/no engineer/no
 *    appointment date-time -- the ONLY hard completion guard is a
 *    non-empty client signature.
 *  - Negative/non-numeric report amounts are not rejected.
 *  - The `due[0]` PM-slot-stamping quirk (via contractService's own
 *    completePmVisitForContract -- SERVICECALL_DECISION_LOCK.md §15, the
 *    single most important DO NOT FIX in the whole document).
 *  - No reverse Contract->ServiceCall list; no duplicate-PM-call guard.
 *  - CSV total sums every report's amount, not only Chargeable ones.
 *  - List sort is insertion-order-reverse, not a true date sort.
 *  - The "PSC-" (msgDone only) vs "PSC " punctuation inconsistency.
 *  - No delete/cancel/reopen action of any kind.
 *
 * GENUINELY OPEN decisions (SERVICECALL_DECISION_LOCK.md §25) -- NONE of
 * these is resolved by this module; each is implemented as the
 * locked/common (non-deciding) behavior and left exactly as open as the
 * lock document leaves it:
 *  1. Completed-ServiceCall re-completion guard: NOT added (see
 *     completeServiceCall's own comment for how concurrent/retried
 *     completion is still made safe WITHOUT adding a rejection guard).
 *  2. Division-scoping of the engineer candidate pool: NOT added (see
 *     ENGINEER_CANDIDATE_ROLES below -- no division check exists).
 *  3. Report/signature draft-history/versioning: NOT added (whole-object
 *     replace only, exactly as locked).
 *  4. Reverse Payment reference on ServiceCall (`paymentId`): NOT added.
 *  5. Customer-message automated delivery: NOT built -- this module only
 *     returns the verbatim preview text a frontend would show/copy/hand
 *     off to WhatsApp, exactly as the PWA's own `showMsg()` does.
 */

const MANAGE_ROLES = Object.freeze(['admin', 'service_mgr']); // PWA FACT (§18): register/assign/PM-schedule/list gate.
// PWA FACT (§19, `vCall()` L3628): exactly these three roles, no division filter (GENUINELY OPEN #2, not added).
const ENGINEER_CANDIDATE_ROLES = Object.freeze(['service_eng', 'engineer', 'service_mgr']);
// PWA FACT (§9, SVC_CHK, exact order): the only 6 keys the PWA's own UI can ever submit.
const CHECKLIST_KEYS = Object.freeze(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning']);
// PWA FACT (§14, the report's `<select id="r_st">` options, exact order/values).
const SERVICE_TYPES = Object.freeze(['Installation', 'Warranty', 'AMC', 'Chargeable']);

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

/** PWA FACT (§18): register/assign/PM-schedule/register-list gated to admin/service_mgr only. */
function assertCanManageServiceCalls(actorAuth, actionDescription) {
  if (!MANAGE_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'manage Service Calls'} (must be admin or service_mgr).`,
      'FORBIDDEN',
      403
    );
  }
}

function isManager(actorAuth) {
  return MANAGE_ROLES.includes(actorAuth.role);
}

/** PWA FACT (§7/§18): `isEng = s.eng===U.name` -> durable `engineerId===actorAuth.userId` (Decision 4). */
function isAssignedEngineer(actorAuth, serviceCall) {
  return Boolean(serviceCall.engineerId) && String(serviceCall.engineerId) === String(actorAuth.userId);
}

/**
 * PWA FACT (`vCall()`'s report-editing gate, §18): the assigned engineer OR
 * admin/service_mgr -- governs BOTH draft-save and completion (same
 * conditional block in the PWA gates the Save Draft and Complete buttons
 * together).
 */
function assertCanEditReport(actorAuth, serviceCall) {
  if (isManager(actorAuth)) return;
  if (isAssignedEngineer(actorAuth, serviceCall)) return;
  throw new ServiceError(
    `Role "${actorAuth.role}" is not permitted to edit or complete this Service Call's report (must be the assigned engineer, admin, or service_mgr).`,
    'FORBIDDEN',
    403
  );
}

function todayDate() {
  return new Date();
}

function dateOnlyUTC(d) {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// "YYYY-MM-DD", matching the PWA's own today()/date-input format.
function dayKeyUTC(d) {
  if (!d) return '';
  const date = dateOnlyUTC(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// PWA FACT: `money(n){if(!n&&n!==0)return"";n=Number(n)||0;return "₹ "+n.toLocaleString("en-IN",{maximumFractionDigits:0})}`.
function money(n) {
  if (!n && n !== 0) return '';
  const num = Number(n) || 0;
  return `₹ ${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/* ================= Customer message templates (PWA FACT, verbatim, §6/§16) ================= */
// NOTE the "PSC-" (msgDone only) vs "PSC " (everywhere else) inconsistency
// below is INTENTIONALLY preserved -- SERVICECALL_DECISION_LOCK.md §17,
// explicit DO NOT FIX (Explicitly Forbidden Redesigns #9).

function companyFirstWord(company) {
  return ((company && company.name) || '').split(' ')[0];
}

function msgReg(psc, company) {
  const first = companyFirstWord(company);
  return (
    `Thank you for contacting ${first}!\n\n` +
    `We are always here to help you. Please be rest assured that your service call has been registered with us, and your complaint will be attended within working 48 hr.\n\n` +
    `Service call registration no – PSC ${psc}\n\n` +
    `If any query feel free to contact us.\n` +
    `${(company && company.phone) || ''}\n` +
    `${(company && company.email) || ''}\n\n` +
    `Thank you, and have a great day.\n\n` +
    `Best Regards,\n` +
    `Team ${first}!`
  );
}

function msgPM(psc, date, time, company) {
  const first = companyFirstWord(company);
  return (
    `Thank you for your time!\n\n` +
    `We are always here to give quality service to make your AC system maintenance free.\n\n` +
    `Your AC system servicing call has been registered with us.\n\n` +
    `Service call registration no – PSC ${psc}\n` +
    `Service call date – ${date || ''}\n` +
    `Service call time – ${time || ''}\n\n` +
    `If any query feel free to contact us.\n` +
    `${(company && company.phone) || ''}\n` +
    `${(company && company.email) || ''}\n\n` +
    `Thank you, and have a great day.\n\n` +
    `Best Regards,\n` +
    `Team ${first}!`
  );
}

function msgDone(psc, company) {
  const first = companyFirstWord(company);
  return (
    `Thank you for your patience!\n\n` +
    `Congratulations your call is attended and solved successfully against your service call registered with us.\n\n` +
    `Please give us your valuable feedback.\n\n` +
    `Service call registration no – PSC-${psc}\n\n` + // PWA FACT: hyphen here only, do not normalize.
    `If any query feel free to contact us.\n` +
    `${(company && company.phone) || ''}\n` +
    `${(company && company.email) || ''}\n\n` +
    `Thank you, and have a great day.\n\n` +
    `Best Regards,\n` +
    `Team ${first}!`
  );
}

function msgPMdone(psc, date, time, company) {
  const first = companyFirstWord(company);
  return (
    `Thank you for your time!\n\n` +
    `Congratulations, your AC system is serviced and ready to use against your service call registered.\n\n` +
    `Please give us your valuable feedback.\n\n` +
    `Service call registration no – PSC ${psc}\n` +
    `Service call date – ${date || ''}\n` +
    `Service call time – ${time || ''}\n\n` +
    `If any query feel free to contact us.\n` +
    `${(company && company.phone) || ''}\n` +
    `${(company && company.email) || ''}\n\n` +
    `Thank you, and have a great day.\n\n` +
    `Best Regards,\n` +
    `Team ${first}!`
  );
}

async function loadCompany(actorAuth, deps) {
  if (!deps.companyRepo) return null;
  return deps.companyRepo.findById(actorAuth.companyId);
}

/* ================= Report building ================= */

/**
 * PWA FACT (§8/§9): `saveReport()` -- draft or complete -- replaces the
 * WHOLE report object every time, never merges; every field is optional
 * (no server-side "required field" beyond the signature-at-completion
 * guard, handled separately in completeServiceCall). `checklistResults`
 * keys are constrained to the fixed 6 (SERVICECALL_DECISION_LOCK.md §10,
 * Decision 1: INFRASTRUCTURE-ONLY -- the PWA's UI can never submit any
 * other key, so this closes an API surface the UI never exposed, not a
 * business-rule narrowing).
 */
function buildReport(input) {
  const src = input || {};
  const checklistInput = src.checklistResults || src.chk || {};
  const checklistResults = {};
  for (const [key, value] of Object.entries(checklistInput)) {
    if (!CHECKLIST_KEYS.includes(key)) {
      throw new ServiceError(
        `Invalid checklist item "${key}". Only the fixed set is permitted: ${CHECKLIST_KEYS.join(', ')}.`,
        'VALIDATION_ERROR',
        400
      );
    }
    checklistResults[key] = value === undefined || value === null ? '' : String(value);
  }
  let serviceType = src.serviceType || src.stype || undefined;
  if (serviceType !== undefined && !SERVICE_TYPES.includes(serviceType)) {
    throw new ServiceError(`Invalid service type "${serviceType}". Must be one of: ${SERVICE_TYPES.join(', ')}.`, 'VALIDATION_ERROR', 400);
  }
  return {
    make: src.make || '',
    model: src.model || '',
    capacity: src.capacity || '',
    type: src.type || src.rtype || '',
    materialUsed: src.materialUsed || src.material || '',
    serviceDescription: src.serviceDescription || src.service || '',
    checklistResults,
    serviceType: serviceType, // PWA FACT: no server-enforced default here -- see draft/complete callers.
    amount: Number(src.amount) || 0, // PWA FACT: non-numeric/blank -> 0; negative is NOT rejected (§14/§21.13).
    engineerRemark: src.engineerRemark || src.remark || '',
    customerRemark: src.customerRemark || src.custRemark || '',
  };
}

/* ================= Creation: Complaint ================= */

/**
 * PWA FACT (`mCall()`/`saveCall()`, §6): the ONLY enforced validation for
 * either creation path is a non-blank customer name. Role gate is
 * INFRASTRUCTURE-ONLY (§19/§22.4): admin/service_mgr, mirroring
 * contractService's MANAGE_ROLES pattern exactly.
 */
async function registerComplaint(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'register a Service complaint');

  const customer = input && typeof input.customer === 'string' ? input.customer.trim() : '';
  if (!customer) {
    throw new ServiceError('Customer name required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("sc_n"))`.
  }

  const site = (input && input.site) || '';
  const phone = (input && input.phone) || '';
  const complaintDescription = (input && input.complaint) || '';

  const { serviceCall, psc } = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const nextPsc = await txnDeps.counterRepo.getNextSequence(actorAuth.companyId, 'serviceCall', session);
    const created = await txnDeps.serviceCallRepo.create(
      {
        companyId: actorAuth.companyId,
        complaintNumber: nextPsc,
        type: 'Complaint',
        customer,
        phone,
        site,
        appointmentDate: null,
        appointmentTime: '',
        complaintDescription,
        status: 'Registered',
        engineerId: null,
        registeredDate: todayDate(),
        report: null,
        clientSignatureImage: null,
        contractId: null,
      },
      session
    );
    // PWA FACT (§6/§15): `notify(["service_mgr","admin"], "New complaint registered: PSC-"+psc+" — "+customer+" ("+site+")")`.
    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `New complaint registered: PSC-${nextPsc} — ${customer} (${site})`,
        date: todayDate(),
        targetRoles: ['service_mgr', 'admin'],
        readByUserIds: [],
      },
      session
    );
    return { serviceCall: created, psc: nextPsc };
  });

  const company = await loadCompany(actorAuth, deps);
  return { serviceCall, customerMessage: msgReg(psc, company) };
}

/* ================= Creation: PM ================= */

/**
 * PWA FACT (`mCall(contractId)`/`saveCall(contractId)`, §7/§12): customer/
 * phone/site are pre-filled from the Contract (one-time copy, not a live
 * link); only customer non-blank is enforced (same rule as Complaint); no
 * Contract-validity/status check beyond existence (§7 lock: "the PWA only
 * checks if(c) existence, never expiry"); no duplicate-slot guard (§7/§14
 * lock, Explicitly Forbidden Redesign #7).
 */
async function schedulePM(contractId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'schedule a PM visit');

  const contract = await deps.contractRepo.findById(actorAuth.companyId, contractId);
  if (!contract) throw new ServiceError('Contract not found.', 'NOT_FOUND', 404);

  const rawCustomer = (input && input.customer !== undefined ? input.customer : contract.customer) || '';
  const customer = String(rawCustomer).trim();
  if (!customer) {
    throw new ServiceError('Customer name required.', 'VALIDATION_ERROR', 400);
  }
  const phone = (input && input.phone !== undefined ? input.phone : contract.phone) || '';
  const site = (input && input.site !== undefined ? input.site : contract.site) || '';
  const appointmentDate = input && input.date ? new Date(input.date) : null;
  const appointmentTime = (input && input.time) || '';

  const { serviceCall, psc } = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const nextPsc = await txnDeps.counterRepo.getNextSequence(actorAuth.companyId, 'serviceCall', session);
    const created = await txnDeps.serviceCallRepo.create(
      {
        companyId: actorAuth.companyId,
        complaintNumber: nextPsc,
        type: 'PM',
        customer,
        phone,
        site,
        appointmentDate,
        appointmentTime,
        complaintDescription: '', // PWA FACT: `complaint:contractId?"":gv("sc_c")` -- always blank for PM.
        status: 'Scheduled',
        engineerId: null,
        registeredDate: todayDate(),
        report: null,
        clientSignatureImage: null,
        contractId,
      },
      session
    );
    // PWA FACT (§6/§15): `notify(["service_mgr","admin"], "PM scheduled: PSC-"+psc+" — "+customer+" ("+site+")")`.
    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `PM scheduled: PSC-${nextPsc} — ${customer} (${site})`,
        date: todayDate(),
        targetRoles: ['service_mgr', 'admin'],
        readByUserIds: [],
      },
      session
    );
    return { serviceCall: created, psc: nextPsc };
  });

  const company = await loadCompany(actorAuth, deps);
  return { serviceCall, customerMessage: msgPM(psc, dayKeyUTC(appointmentDate), appointmentTime, company) };
}

/* ================= Read / search / report ================= */

/**
 * PWA FACT (`vCall()`, §20, "the single most significant PWA-source
 * weakness found in this module"): the PWA's lookup has NO company guard at
 * all -- MANDATORY server-side fix here (SERVICECALL_DECISION_LOCK.md §20):
 * every read is `{ _id, companyId }`-scoped. No role gate beyond company
 * membership is added (§19/§23 #15: "no role gate to the completed-report
 * read path beyond ordinary tenant scoping" -- generalized here to every
 * read, since the PWA's own `vCall()` had none once a user could reach it).
 */
async function getServiceCall(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const serviceCall = await deps.serviceCallRepo.findById(actorAuth.companyId, id);
  if (!serviceCall) throw new ServiceError('Service Call not found.', 'NOT_FOUND', 404);
  return serviceCall;
}

async function engineerNameMap(actorAuth, deps) {
  if (!deps.userRepoForEnquiry || typeof deps.userRepoForEnquiry.listByCompany !== 'function') return new Map();
  const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  return new Map(users.map((u) => [String(u.id), u.name]));
}

// PWA FACT (`hit()` over `["psc","type","customer","phone","site","status","eng","regDate","date","complaint"]`, §17): nine-field case-insensitive substring search.
function serviceCallMatchesQuery(serviceCall, q, engineerName) {
  const blob = [
    String(serviceCall.complaintNumber),
    serviceCall.type,
    serviceCall.customer,
    serviceCall.phone,
    serviceCall.site,
    serviceCall.status,
    engineerName || '',
    dayKeyUTC(serviceCall.registeredDate),
    dayKeyUTC(serviceCall.appointmentDate),
    serviceCall.complaintDescription,
  ]
    .filter((v) => v !== undefined && v !== null)
    .join(' ')
    .toLowerCase();
  return blob.indexOf(q) >= 0;
}

/**
 * PWA FACT (`vService()`, §17): company-scoped, nine-field search, list
 * shown newest-inserted-first (`.slice().reverse()` -- NOT a true date
 * sort, SERVICECALL_DECISION_LOCK.md §18/Explicitly Forbidden Redesign
 * #10). Role gate: same admin/service_mgr menu gate as the "service"
 * register page itself (§18).
 */
async function listServiceCalls(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'view the Service Call register');
  const all = await deps.serviceCallRepo.listByCompany(actorAuth.companyId);
  const engineers = await engineerNameMap(actorAuth, deps);
  const q = filters.q ? String(filters.q).toLowerCase() : '';
  const filtered = q ? all.filter((s) => serviceCallMatchesQuery(s, q, engineers.get(String(s.engineerId)))) : all;
  return filtered.slice().reverse(); // PWA FACT: newest-pushed-first.
}

/**
 * PWA FACT (`openCallsPanel()`, §17): `mine(DB.svcCalls).filter(status!=="Completed")`.
 * The audit's own §17 description of this panel does not document any
 * reversal (unlike vService()'s explicit `.slice().reverse()`) -- natural
 * (insertion) order is used here rather than inventing an unspecified sort.
 * CURRENT IMPLEMENTATION DESIGN: gated the same as listServiceCalls
 * (admin/service_mgr) -- the audit records this panel as rendered only
 * inside service_mgr's own dashboard, but admin already reaches the same
 * underlying data via the "service" menu's Register list (§18), so this is
 * not a broadening beyond MANAGE_ROLES, only a decision about where the
 * line is drawn for this narrower dashboard-widget query.
 */
async function getOpenServiceCalls(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'view the Open Service Calls panel');
  const all = await deps.serviceCallRepo.listByCompany(actorAuth.companyId);
  return all.filter((s) => s.status !== 'Completed');
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * PWA FACT (`dlService()`, §17): same nine-field search filter as
 * `vService()` but NOT reversed (natural order); exact 22-column header;
 * `Client Signed` is a Yes/No flag only (raw signature data never
 * exported); TOTAL row sums EVERY report's `amount`, regardless of
 * `serviceType` (Explicitly Forbidden Redesign #11 -- do not narrow this to
 * Chargeable-only).
 */
async function exportServiceCallsCsv(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'export the Service Call report');
  const all = await deps.serviceCallRepo.listByCompany(actorAuth.companyId);
  const engineers = await engineerNameMap(actorAuth, deps);
  const q = filters.q ? String(filters.q).toLowerCase() : '';
  const rows = q ? all.filter((s) => serviceCallMatchesQuery(s, q, engineers.get(String(s.engineerId)))) : all;

  const lines = [];
  lines.push(
    [
      'PSC No', 'Type', 'Registered On', 'Customer', 'Phone', 'Site', 'Appt Date', 'Appt Time', 'Engineer', 'Status',
      'Complaint', 'Make', 'Model', 'Capacity', 'Unit Type', 'Material Used', 'Service Done', 'Service Type', 'Amount',
      'Engineer Remark', 'Customer Remark', 'Client Signed',
    ].map(csvEscape).join(',')
  );

  let amountTotal = 0;
  for (const s of rows) {
    const r = s.report || {};
    amountTotal += Number(r.amount) || 0;
    const row = [
      s.complaintNumber, s.type, dayKeyUTC(s.registeredDate), s.customer, s.phone, s.site,
      dayKeyUTC(s.appointmentDate), s.appointmentTime, engineers.get(String(s.engineerId)) || '', s.status,
      s.complaintDescription, r.make, r.model, r.capacity, r.type, r.materialUsed, r.serviceDescription,
      r.serviceType, r.amount, r.engineerRemark, r.customerRemark, s.clientSignatureImage ? 'Yes' : 'No',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  // PWA FACT (§17): `["TOTAL CALLS", rows.length, "","","","","","","","","","","","","","","","", amt]`
  // -- 16 blank cells between the row-count and the total amount, landing `amt` on the Amount column (#19).
  lines.push(['TOTAL CALLS', rows.length, ...Array(16).fill(''), amountTotal].map(csvEscape).join(','));
  return lines.join('\n');
}

/* ================= Assignment ================= */

/**
 * PWA FACT (`assignCall()`, §7/§8): only admin/service_mgr, only while not
 * Completed; unconditionally overwrites engineer/date/time with whatever is
 * submitted (including blanks -- clearing is allowed); status flips
 * "Registered"->"Assigned" ONLY from "Registered" (PM calls, starting
 * "Scheduled", never pass through this -- DO NOT FIX); notifies `["*"]`
 * whenever the resulting engineer is truthy, on EVERY save, with no dedup
 * against a prior identical assignment (DO NOT FIX).
 */
async function assignEngineer(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanManageServiceCalls(actorAuth, 'assign an engineer to a Service Call');

  const serviceCall = await deps.serviceCallRepo.findById(actorAuth.companyId, id);
  if (!serviceCall) throw new ServiceError('Service Call not found.', 'NOT_FOUND', 404);
  if (serviceCall.status === 'Completed') {
    // PWA FACT: the assignment block only renders `if(isMgr && s.status!=="Completed")`.
    throw new ServiceError('A Completed Service Call cannot be reassigned.', 'INVALID_STATUS_TRANSITION', 400);
  }

  let engineerId = null;
  let engineerName = '';
  const rawEngineerId = input && input.engineerId;
  if (rawEngineerId) {
    const candidate = deps.userRepoForEnquiry && (await deps.userRepoForEnquiry.findById(rawEngineerId));
    if (!candidate || String(candidate.companyId) !== String(actorAuth.companyId)) {
      throw new ServiceError('Engineer not found.', 'ENGINEER_NOT_FOUND', 404);
    }
    if (!ENGINEER_CANDIDATE_ROLES.includes(candidate.role)) {
      // PWA FACT (§19): candidate pool is exactly service_eng/engineer/service_mgr, no division filter.
      throw new ServiceError(
        `User's role "${candidate.role}" is not a valid Service Call engineer candidate (must be one of: ${ENGINEER_CANDIDATE_ROLES.join(', ')}).`,
        'VALIDATION_ERROR',
        400
      );
    }
    engineerId = candidate.id;
    engineerName = candidate.name;
  }

  const appointmentDate = input && input.date ? new Date(input.date) : null; // PWA FACT: unconditional overwrite, blank tolerated.
  const appointmentTime = (input && input.time) || '';
  const nextStatus = engineerId && serviceCall.status === 'Registered' ? 'Assigned' : serviceCall.status; // PWA FACT: DO NOT FIX.

  const updated = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const patched = await txnDeps.serviceCallRepo.update(
      actorAuth.companyId,
      id,
      { engineerId, appointmentDate, appointmentTime, status: nextStatus },
      session
    );
    if (engineerId) {
      // PWA FACT (§7/§15): `notify(["*"], ...)` on every save with a truthy resulting engineer, no dedup.
      const suffix = appointmentDate ? ` for ${dayKeyUTC(appointmentDate)} ${appointmentTime}` : '';
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Service call PSC-${serviceCall.complaintNumber} (${serviceCall.customer}) assigned to ${engineerName}${suffix}`,
          date: todayDate(),
          targetRoles: ['*'],
          readByUserIds: [],
        },
        session
      );
    }
    return patched;
  });

  return updated;
}

/* ================= Report draft ================= */

/**
 * PWA FACT (`saveReport(id,false)`, §8/§9): whole-object report replace, no
 * gate on any field, never touches `sig`, fires no notification. Editable
 * only pre-completion, by the assigned engineer or a manager.
 */
async function saveReportDraft(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const serviceCall = await deps.serviceCallRepo.findById(actorAuth.companyId, id);
  if (!serviceCall) throw new ServiceError('Service Call not found.', 'NOT_FOUND', 404);
  if (serviceCall.status === 'Completed') {
    // PWA FACT: the report form is only rendered `if(s.status!=="Completed"&&(isEng||isMgr))`.
    throw new ServiceError('A Completed Service Call\'s report can no longer be edited.', 'INVALID_STATUS_TRANSITION', 400);
  }
  assertCanEditReport(actorAuth, serviceCall);

  const report = buildReport(input);
  return deps.serviceCallRepo.update(actorAuth.companyId, id, { report });
}

/* ================= Completion ================= */

/**
 * PWA FACT (`saveReport(id,true)`, §11/§12/§13, exact verified order):
 * rebuild+replace report (no gate) -> signature check (SOLE hard guard) ->
 * signature write -> status="Completed" -> conditional Contract PM-slot
 * update (`due[0]` quirk, via contractService.completePmVisitForContract,
 * DO NOT FIX) -> conditional Chargeable Payment creation + finance notify
 * -> unconditional completion notify -> (PWA: save(); here: transaction
 * commit) -> customer-message preview.
 *
 * GENUINELY OPEN #1 (re-completion guard, SERVICECALL_DECISION_LOCK.md
 * §25.1): per explicit task instruction, NO rejection guard is added for
 * an already-Completed record (the PWA itself has none). Concurrency
 * safety (no duplicate Payment / no double-stamped Contract slot from a
 * network retry or a genuine race between two simultaneous completion
 * requests) is instead achieved via `serviceCallRepo.completeIfNotCompleted`
 * -- an ATOMIC conditional transition (the same class of primitive already
 * used by `enquiryRepo.markWonIfOpen`), inside one Mongo transaction with
 * the Contract-slot and Payment writes. A losing/retried call is never
 * rejected with an error; it silently receives the already-Completed
 * record back and performs NO side effects again -- an idempotent no-op,
 * not a business-rule guard.
 */
async function completeServiceCall(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const existing = await deps.serviceCallRepo.findById(actorAuth.companyId, id);
  if (!existing) throw new ServiceError('Service Call not found.', 'NOT_FOUND', 404);
  assertCanEditReport(actorAuth, existing);

  const signature = input && input.signature;
  if (!signature) {
    // PWA FACT (§10/§11): `if(_sg&&_sg.empty){toast("Client signature required to complete the call");return}` -- the ONLY hard completion guard.
    throw new ServiceError('Client signature required to complete the call.', 'MISSING_SIGNATURE', 400);
  }

  const report = buildReport(input && (input.report || input));

  // PWA FACT: completion notification text uses `s.eng||U.name` -- the
  // assigned engineer's display NAME if one was ever assigned, else the
  // completing actor's own name. Resolved once, up front (a plain read,
  // not part of the atomic transition/transaction below).
  let completedByName = actorAuth.name || actorAuth.role;
  if (existing.engineerId && deps.userRepoForEnquiry) {
    const engineerUser = await deps.userRepoForEnquiry.findById(existing.engineerId);
    if (engineerUser && engineerUser.name) completedByName = engineerUser.name;
  }

  const result = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.serviceCallRepo.completeIfNotCompleted(
      actorAuth.companyId,
      id,
      { report, clientSignatureImage: signature, status: 'Completed' },
      session
    );

    if (!updated) {
      // Lost the atomic race (already Completed by a concurrent/retried
      // request) -- idempotent no-op, per the "no re-completion guard, but
      // no duplicate side effects" design above.
      const current = await txnDeps.serviceCallRepo.findById(actorAuth.companyId, id);
      return { serviceCall: current, completedNow: false };
    }

    if (updated.contractId) {
      // SERVICECALL_DECISION_LOCK.md §14/§15: reuse the existing Contract-facing
      // boundary EXACTLY as built -- do not reimplement PM-slot logic here.
      await contractService.completePmVisitForContract(updated.contractId, actorAuth, txnDeps, {
        assignedEngineerUserId: updated.engineerId,
      });
    }

    if (report.serviceType === 'Chargeable' && report.amount > 0) {
      // SERVICECALL_DECISION_LOCK.md §13: exact field mapping, hardcoded
      // literal remark, always-null salesOrderId. Written directly via
      // paymentRepo (the same repository paymentService.js itself writes
      // through, and the same Payment schema) rather than through
      // paymentService.createManualPayment, because that function's
      // LEDGER_ROLES gate (finance/admin only) does not match the PWA's
      // actual ServiceCall-completion actor (the completing engineer or
      // service_mgr/admin) -- the PWA itself pushes this Payment directly
      // with no separate role check of its own (§14/§21.14: "Direct,
      // un-mediated Payment creation ... no separate Payment-service
      // abstraction exists in the PWA").
      await txnDeps.paymentRepo.create(
        {
          companyId: actorAuth.companyId,
          projectOrReference: `${updated.site} (PSC-${updated.complaintNumber})`,
          personName: updated.customer,
          phone: updated.phone,
          amount: report.amount,
          remark: 'Chargeable service call',
          lastCallDate: null,
          discussionNotes: '',
          nextCallDate: null,
          status: 'Pending',
          salesOrderId: null,
          milestoneIndex: null,
          partPayments: [],
          raisedToFinance: null,
          receivedDate: null,
        },
        session
      );
      // PWA FACT (§14/§15): `notify(["finance"], "Chargeable service PSC-"+psc+" completed — "+money(amount)+" to collect from "+customer)`.
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Chargeable service PSC-${updated.complaintNumber} completed — ${money(report.amount)} to collect from ${updated.customer}`,
          date: todayDate(),
          targetRoles: ['finance'],
          readByUserIds: [],
        },
        session
      );
    }

    // PWA FACT (§11/§15): unconditional -- fires regardless of the Contract/Payment branches above.
    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `PSC-${updated.complaintNumber} completed by ${completedByName} — ${updated.customer}`,
        date: todayDate(),
        targetRoles: ['service_mgr', 'admin'],
        readByUserIds: [],
      },
      session
    );

    return { serviceCall: updated, completedNow: true };
  });

  const company = await loadCompany(actorAuth, deps);
  const sc = result.serviceCall;
  const customerMessage =
    sc.type === 'PM'
      ? msgPMdone(sc.complaintNumber, dayKeyUTC(sc.appointmentDate), sc.appointmentTime, company)
      : msgDone(sc.complaintNumber, company);

  return { serviceCall: sc, completedNow: result.completedNow, customerMessage };
}

/**
 * List engineer candidates for the service-call engineer-assignment UI.
 * Infrastructure-only addition (same pattern as projectService.listEngineerCandidates):
 * the PWA resolves names from its client-side users collection; we expose a
 * dedicated endpoint so the frontend can populate the assignment dropdown
 * without admin-level access to the full users list.
 */
async function listEngineerCandidates(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  if (!deps.userRepoForEnquiry || typeof deps.userRepoForEnquiry.listByCompany !== 'function') {
    return [];
  }
  const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  return users
    .filter((u) => ENGINEER_CANDIDATE_ROLES.includes(u.role))
    .map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

module.exports = {
  registerComplaint,
  schedulePM,
  getServiceCall,
  listServiceCalls,
  getOpenServiceCalls,
  exportServiceCallsCsv,
  assignEngineer,
  saveReportDraft,
  completeServiceCall,
  listEngineerCandidates,
  // exported for tests / reuse
  MANAGE_ROLES,
  ENGINEER_CANDIDATE_ROLES,
  CHECKLIST_KEYS,
  SERVICE_TYPES,
  msgReg,
  msgPM,
  msgDone,
  msgPMdone,
  money,
};
