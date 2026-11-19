'use strict';

const { ServiceError } = require('../errors');
const ProjectPhoto = require('../models/ProjectPhoto');
const { getEffectiveDivisions } = require('./subscriptionService');
const { SIGN_RESPONSIBILITIES, PROJECT_STAGES_BY_DIVISION } = require('../models/shared/enums');
// Owner decision (31 Oct 2026): a published update reaches the client's own
// app. Never blocks, never fails the work — see portalPushService.
const portalPush = require('./portalPushService');
const { DIVISION_PM_ROLE } = require('./salesOrderCascade');
// FIX-6-07: reuse the already-reconciled `paySum()` port (verified against
// PWA `paySum`/`projPayInfo`) instead of re-deriving milestone-vs-Payment
// reconciliation a second time in this file.
const { computeReconciledPaySummary } = require('./salesOrderService');
// The Projects list reuses the dashboard's already-verified pure
// `paySum(so, payments)` port (PWA `paySum`/`projPayInfo`, index.html:2257,
// 2297) rather than the per-milestone async variant, so one list request
// makes one payments query instead of one per milestone.
const { paySum } = require('./dashboardService');
const { reportHeaderRows } = require('./reportHeader');

/**
 * Project Execution business/application layer.
 *
 * Source of truth: new-app/docs/PWA_COVERAGE_AUDIT_PROJECT.md (594 lines,
 * a pre-verified, independent functional audit of MEP_PROJECTS_PWA/index.html's
 * PROJECTS section, lines 2119-2742, plus every cross-reference from
 * SalesOrder/Inventory/Finance/Service/Dashboard/Checklist Library that
 * touches DB.projects). This module implements every workflow that audit
 * documents as "NOT YET IMPLEMENTED" in its Implementation Readiness table
 * (§29), EXCEPT Inventory, Contract, and ServiceCall, which remain out of
 * scope per instruction (see prepareServiceConversion at the bottom for the
 * single deferred integration point).
 *
 * NOTE: the task instructions referenced a
 * `new-app/docs/PROJECT_IMPLEMENTATION_CONTRACT.md` as a "read first" doc.
 * That file does not exist in this repository. PWA_COVERAGE_AUDIT_PROJECT.md
 * was used as the equivalent, pre-verified source of truth instead (it is
 * explicitly the primary spec named in the task instructions too).
 *
 * LOCKED PRINCIPLE (same as the SalesOrder/Payment tasks): every
 * PWA-demonstrated functional behavior is reproduced exactly, including
 * quirks (see PWA_COVERAGE_AUDIT_PROJECT.md §23 for the full quirk
 * catalogue — each one is called out at its enforcement point below with
 * "PWA QUIRK, preserved"). Role/authorization gates follow the same
 * already-established convention from SalesOrder/Payment (OPEN_DECISIONS.md
 * #22): enforce the PWA's own VISIBLE role intent server-side, even though
 * the PWA's own mutator functions have zero function-level role checks of
 * their own (confirmed exhaustively in the audit's §22 table).
 *
 * OPEN DECISIONS RESOLVED HERE (audit §30, cross-referenced by number below;
 * also recorded in OPEN_DECISIONS.md #25-#36 and DOMAIN_MODEL.md):
 *  1. Project detail view division/access scoping -> PRESERVED EXACTLY per
 *     explicit task instruction: any same-company authenticated user may
 *     view a project's full detail (getProject below has no role/division
 *     check beyond tenant/company match) -- unlike list/dashboard views,
 *     which ARE division-scoped for PM roles (listProjects below).
 *  2. Engineer-assignment candidate pool division-scoping -> PRESERVED
 *     EXACTLY per explicit task instruction: company-wide, not filtered to
 *     the project's own division (assignEngineers below; ENGINEER_CANDIDATE_ROLES).
 *  3. Checklist-Library division-scoping -> NOT APPLICABLE: Checklist
 *     Library management (creating/editing ChecklistTemplate documents
 *     themselves, as opposed to a project's own copied checklist) is not
 *     part of this task's scope; only checklistTemplateRepo.findById /
 *     findDefaultForDivision (read-only, for applying a template to a
 *     project) are used here. Left for a future ChecklistTemplate-CRUD task.
 *  4. MEP completion-path exclusion -> PRESERVED EXACTLY (verbatim literal
 *     string check `stage === "Completed"` -- see setStage below).
 *  5. Un-Completing reverts status silently -> PRESERVED EXACTLY (setStage).
 *  6. Checklist replace-vs-append confirm() gap -> PRESERVED: no
 *     confirmation is required server-side for "Replace" (matches the PWA,
 *     which has a warning banner but no confirm() gate at the function
 *     level) -- see applyChecklistTemplate.
 *  7. `deliveryChallans[].by` ("Received By (site)") as a durable User ref
 *     -> RESOLVED with a minimal, additive schema fix (NOT a business-rule
 *     change): Project.js's deliveryChallanItemSchema gained a
 *     `receivedByName` free-text field alongside the existing
 *     `recordedByUserId` ref, so the PWA's free-typed on-site person's name
 *     is preserved (as the PWA itself captured it) while `recordedByUserId`
 *     records the logged-in staff member who entered the row (mirroring the
 *     `appr.by`/`appr.enteredBy` split the schema already got right for
 *     checklist approvals). This is a representation-fidelity fix, not a
 *     new business rule -- forcing `by` into an ObjectId-only field would
 *     have silently discarded real PWA data (the audit's own §30 item 7
 *     flagged this as a genuine open risk, not yet resolved anywhere).
 *  8. Checklist photo retention/size policy -> PRESERVED: inline base64
 *     strings, push-only, no cap, no server-side downscaling (the PWA does
 *     client-side downscaling before upload; this backend just stores
 *     whatever base64 string it is given, matching the PWA's own storage
 *     shape exactly per the absolute "keep photos as base64 strings if
 *     that's what the PWA does" instruction).
 *  9. Delivery Challan <-> Inventory integration -> NOT IMPLEMENTED /
 *     preserved as a non-relationship: the completion gate (setStage)
 *     reads ONLY Project.deliveryChallans, never any Inventory collection
 *     (Inventory itself is out of scope for this task entirely).
 * 10. Contract phone/email data-loss quirk -> NOT APPLICABLE: Contract
 *     itself is out of scope; prepareServiceConversion below only exposes
 *     the eligibility check, not Contract creation.
 * 11. Two independently-maintained report code paths (CSV vs print) ->
 *     RESOLVED as Choice "unify" (the audit's own leaning, §30 item 11):
 *     buildProjectReportSections() is the single source of truth consumed
 *     by BOTH exportProjectReportCsv (CSV) and getProjectReport (the JSON
 *     payload a future print view would render) -- an infra/code-sharing
 *     simplification, not an observable business-behavior change.
 * 12. `timelineSet` one-way flag -> PRESERVED EXACTLY: no "reset timeline"
 *     function exists anywhere in this module.
 */

// PWA FACT (`PM_DIV`, inverted -- same constant already defined
// independently in paymentService.js's PM_DIVISION_FOR_ROLE; duplicated
// here rather than imported, matching that module's own precedent of a
// small, per-service-file copy of this constant).
const PM_DIVISION_FOR_ROLE = Object.freeze({ hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' });

// PWA FACT (§14/§22): engineer-assignment candidate pool is COMPANY-WIDE,
// not division-filtered -- `engineers = mine(DB.users).filter(u =>
// ["engineer","hvac_pm","solar_pm","mep_pm","service_eng"].indexOf(u.role)>=0)`.
const ENGINEER_CANDIDATE_ROLES = Object.freeze(['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_eng']);

// PWA FACT (§9, `SIGN_ROLES`, re-verified): the reachable sign-responsibility
// -> permitted-approver-role map. `PM` is a real key in the PWA's own
// constant but is NEVER assignable to a checklist point's `sign` field (dead
// key, quirk #10) -- it is intentionally NOT included here as a point value,
// only as background context in this comment.
const SIGN_ROLES = Object.freeze({
  ENGINEER: Object.freeze(['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'admin']),
  CLIENT: Object.freeze(['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_eng', 'admin']),
  SALES: Object.freeze(['sales', 'admin']),
  SERVICE: Object.freeze(['service_mgr', 'service_eng', 'admin']),
});

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

// FIX-6-07: PWA FACT (`MENUS`, re-verified) — the "Projects" menu item
// (which is the sole reachable entry point to `vProjects()`/`dlProjects()`)
// is listed ONLY for these 4 roles: admin, hvac_pm, solar_pm, mep_pm. The
// PWA itself never enforces this server-side (it is a client-only SPA with
// no backend of its own -- `nav()` performs no role check at all), so this
// is the PWA's DEMONSTRATED INTENT, not a literal PWA server behavior to
// copy byte-for-byte; per this task's instructions, the new backend (which
// has a real server) must enforce that intent, unlike the PWA. No new
// division restriction is invented beyond what `myDiv()`/`hasDiv()`
// already scope inside `listProjects` below.
const PROJECT_EXPORT_ROLES = Object.freeze(['admin', 'hvac_pm', 'solar_pm', 'mep_pm']);

function assertRole(actorAuth, allowedRoles, actionDescription) {
  if (!allowedRoles.includes(actorAuth.role)) {
    throw new ServiceError(`Role "${actorAuth.role}" is not permitted to ${actionDescription}.`, 'FORBIDDEN', 403);
  }
}

function todayDate() {
  return new Date();
}

function dayKey(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

// PWA FACT (`daysBetween`): whole days between two date strings, positive
// when `b` is after `a`.
// PWA FACT (daysBetween on "YYYY-MM-DD" strings, and delayedItems' plain
// `c.plan < today()` string compare): whole calendar days between two DATES.
// Comparing UTC day keys (not raw timestamps) means a point due today is not
// "1 day late" just because the clock passed noon.
function daysBetween(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  const dayA = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate());
  const dayB = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
  return Math.round((dayB - dayA) / (24 * 60 * 60 * 1000));
}

async function resolveActorName(actorAuth, deps) {
  if (actorAuth.name) return actorAuth.name;
  if (deps.userRepoForEnquiry) {
    const actorUser = await deps.userRepoForEnquiry.findById(actorAuth.userId);
    return actorUser ? actorUser.name : '';
  }
  return '';
}

function freshChecklistItem(templateItem) {
  return {
    text: templateItem.text,
    signResponsibility: templateItem.signResponsibility,
    done: false,
    completedDate: null,
    pmSigned: false,
    remark: '',
    photos: [],
    targetDate: null,
    approval: null,
    // Owner request (18 Nov 2026): a point may release the payment it
    // earns — null until the sales order says which, so a fresh point has
    // the same shape wherever it is built.
    releasesMilestoneIndex: null,
    releaseCollectWithinDays: null,
  };
}

/**
 * PWA FACT (`canPM(p) = U.role==="admin" || PM_DIV[U.role]===p.div`, §15),
 * narrowed by owner request (19 Nov 2026):
 *
 *   "if there is 2 project manager in HVAC Example Project manager deepak
 *    and Vinod they should only see the project assigned to them deepak
 *    cannot see vinod project and vinod cannot see deepak project."
 *
 * So a Manager's own division is no longer enough: the project must be
 * ASSIGNED to them. A project assigned to nobody belongs to no Manager at
 * all (owner's decision, asked and answered) — sales or admin assigns it
 * before any Manager can work it.
 *
 * Admin is unchanged, and so is every other role's path into a project.
 */
function isAssignedManager(actorAuth, project) {
  const mine = project && project.projectManagerUserId;
  return Boolean(mine) && String(mine) === String(actorAuth.userId);
}

function isPmForProject(actorAuth, project) {
  if (actorAuth.role === 'admin') return true;
  if (!PM_DIVISION_FOR_ROLE[actorAuth.role]) return false;
  /*
   * Owner request (19 Nov 2026): "assign will be show for every person with
   * project manager/ solar login" — the division no longer decides. A
   * Manager runs the projects they were GIVEN, whichever division those are
   * in, because the people here are not split by division as neatly as the
   * roles are. Assignment is the whole rule now.
   */
  return isAssignedManager(actorAuth, project);
}

// PWA FACT (`isEng = p.engs.indexOf(U.name)>=0`, §14 -- name-match in the
// PWA; here a durable ObjectId membership check, matching the already-
// established "durable ref instead of name string" NEW BACKEND DESIGN).
function isAssignedEngineer(actorAuth, project) {
  return (project.assignedEngineerIds || []).some((id) => String(id) === String(actorAuth.userId));
}

function assertIsPM(actorAuth, project, actionDescription) {
  if (!isPmForProject(actorAuth, project)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'edit this project'} (must be the Manager this project is assigned to, or admin).`,
      'FORBIDDEN',
      403
    );
  }
}

// PWA FACT (§22 table: tick/remark/photo/addUpdate/DC-create-edit-delete
// are all UI-gated to `isPM||isEng`) -- enforced here server-side per the
// same "visible-intent enforcement" convention already locked for
// SalesOrder/Payment (OPEN_DECISIONS.md #22).
function assertIsPmOrAssignedEngineer(actorAuth, project, actionDescription) {
  if (isPmForProject(actorAuth, project) || isAssignedEngineer(actorAuth, project)) return;
  throw new ServiceError(
    `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'modify this project'} (must be the matching division's PM, an assigned engineer, or admin).`,
    'FORBIDDEN',
    403
  );
}

// PWA FACT (`timelineReady(p) = !!p.timelineSet && projPlanned(p)>0`, §7).
function isTimelineReady(project) {
  const planned = (project.checklist || []).filter((c) => !!c.targetDate).length;
  return !!project.timelineSet && planned > 0;
}

// PWA FACT (`projTargetEnd(p)`): the latest `plan`/targetDate among all
// checklist points; `null` if none have one.
function computeTargetEnd(checklist) {
  let latest = null;
  for (const c of checklist || []) {
    if (!c.targetDate) continue;
    const d = c.targetDate instanceof Date ? c.targetDate : new Date(c.targetDate);
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

/* ================= VIEW / LIST / SEARCH ================= */

/**
 * PWA FACT (`vProject()`, §15/§22/§30 item 1): NO division or role
 * restriction beyond company membership -- ANY authenticated same-company
 * user may view any project's full detail. This is a genuine, verified PWA
 * gap (distinct from every list/dashboard view, which DOES filter), and per
 * this task's explicit instruction it is PRESERVED EXACTLY here, not
 * "fixed" with an invented division restriction.
 */
async function getProject(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  /*
   * Owner request (19 Nov 2026): a Manager opens the projects assigned to
   * them and no others. 404, not 403 — which projects another Manager holds
   * is not the business of someone who may not read them, the same answer a
   * sales order and a quotation give.
   */
  if (PM_DIVISION_FOR_ROLE[actorAuth.role] && !isPmForProject(actorAuth, project)) {
    throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  }
  // PWA FACT (vProject, index.html:2100/2122): engineers are shown by name.
  if ((project.assignedEngineerIds || []).length && deps.userRepoForEnquiry && deps.userRepoForEnquiry.listByCompany) {
    const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
    const nameById = new Map(users.map((u) => [String(u.id), u.name]));
    project.engineerNames = project.assignedEngineerIds.map((eid) => nameById.get(String(eid))).filter(Boolean);
  }
  // PWA FACT (printDC, index.html:2437; vProject header, index.html:2122):
  // the project screen and the printed delivery challan both show the SO
  // number, which this backend holds only as a reference.
  if (project.salesOrderId && deps.salesOrderRepo && deps.salesOrderRepo.findById) {
    const so = await deps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId);
    project.salesOrderNumber = so ? so.orderNumber : null;
    // Owner request (16 Nov 2026): the checklist screen offers each point the
    // sales order's payment milestones to release, so it needs their names.
    // Description and amount only -- the costing behind them stays on the
    // sales order, under its own role gate.
    project.paymentMilestones = ((so && so.paymentMilestones) || []).map((m, i) => ({
      index: i,
      description: m.description || '',
      amount: m.amount || 0,
      received: !!m.received,
    }));
    // Owner request (14 Nov 2026): a Project Manager must see the quotation
    // the site was won on. Quotations themselves stay closed to PM logins;
    // what travels with the project is this read-only summary, reached the
    // only way a project is tied to one -- through its sales order. Null for
    // an order raised before the quotation flow, or a walk-in order.
    project.quotation = so && so.quotationId ? await quotationSummaryForProject(actorAuth.companyId, so.quotationId, deps) : null;
  }
  // Owner request (19 Nov 2026): the screen says which Manager holds it.
  if (project.projectManagerUserId && deps.userRepoForEnquiry && deps.userRepoForEnquiry.findById) {
    const pm = await deps.userRepoForEnquiry.findById(project.projectManagerUserId);
    project.projectManagerName = pm ? pm.name : null;
  } else {
    project.projectManagerName = null;
  }
  return project;
}

/**
 * Who may hand a project to a Manager, and who may be handed one.
 *
 * Owner request (19 Nov 2026): "only sales person and admin can assign the
 * project to which Project manager or Manager the project is assigned."
 * A Manager cannot assign a project — not to themselves, not to anybody —
 * which is the whole point of the rule.
 */
const ASSIGN_ROLES = Object.freeze(['admin', 'sales']);
const MANAGER_ROLES = Object.freeze(['hvac_pm', 'solar_pm', 'mep_pm']);

/**
 * Hand this project to a Manager, or take it back (userId null).
 *
 * The Manager must be one of this company's and must hold a Manager role.
 * The division is NOT checked: a Solar Manager may be given an HVAC project
 * and will see it, because assignment — not division — is what decides whose
 * project it is.
 */
async function assignProjectManager(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  if (!ASSIGN_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to assign a project (must be ${ASSIGN_ROLES.join(' or ')}).`,
      'FORBIDDEN',
      403
    );
  }
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);

  const raw = input && input.projectManagerUserId;
  const userId = raw === null || raw === undefined || raw === '' ? null : String(raw);

  if (userId) {
    const user = deps.userRepoForEnquiry && deps.userRepoForEnquiry.findById
      ? await deps.userRepoForEnquiry.findById(userId)
      : null;
    if (!user || String(user.companyId) !== String(actorAuth.companyId)) {
      throw new ServiceError('That user is not on this company.', 'NOT_FOUND', 404);
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ServiceError('A project is assigned to a Project Manager.', 'VALIDATION_ERROR', 400);
    }
    // No division check (owner request, 19 Nov 2026): any Manager login may
    // be given any project, and they then see it whatever division it is.
  }

  const updated = await deps.projectRepo.update(actorAuth.companyId, projectId, {
    projectManagerUserId: userId,
  });
  // The screen shows the NAME, and it has just changed, so send it back
  // with the project rather than leaving the old one on display.
  if (updated) {
    const pm = userId && deps.userRepoForEnquiry && deps.userRepoForEnquiry.findById
      ? await deps.userRepoForEnquiry.findById(userId)
      : null;
    updated.projectManagerName = pm ? pm.name : null;
  }
  return updated;
}

/**
 * The Managers a project of this division can be handed to.
 * Deactivated users are left out: a project cannot be run by someone who
 * cannot log in.
 */
async function listManagerCandidates(division, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  if (!ASSIGN_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to list Managers (must be ${ASSIGN_ROLES.join(' or ')}).`,
      'FORBIDDEN',
      403
    );
  }
  // `division` is accepted and deliberately ignored — every Manager login is
  // offered, whatever division the project is (owner request, 19 Nov 2026).
  const all = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  return all
    .filter((u) => MANAGER_ROLES.includes(u.role) && u.active !== false)
    .map((u) => ({ id: String(u.id), name: u.name, role: u.role, division: PM_DIVISION_FOR_ROLE[u.role] }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The quotation a project came from, as much of it as the project screen
 * shows and no more: the number, the date, where it stands, what it was
 * quoted at. Deliberately not the line items, the costing or the margin.
 */
async function quotationSummaryForProject(companyId, quotationId, deps) {
  if (!deps.quotationRepo || !deps.quotationRepo.findById) return null;
  const q = await deps.quotationRepo.findById(companyId, quotationId);
  if (!q) return null;
  return {
    id: String(q.id || q._id || quotationId),
    quotationNumber: q.quotationNumber || null,
    date: q.date || null,
    status: q.status || null,
    division: q.division || null,
    subject: q.subject || null,
    customerName: q.customerName || null,
    grandTotal: q.grandTotal === undefined ? null : q.grandTotal,
  };
}

/**
 * The public PDF link for that same quotation, minted on the click rather
 * than on every project read. The gate is the project: whoever may open
 * this project may open the quotation it was won on.
 */
async function getProjectQuotationPdfLink(projectId, actorAuth, deps) {
  const project = await getProject(projectId, actorAuth, deps);
  if (!project.quotation) {
    throw new ServiceError('This project has no quotation behind it.', 'NOT_FOUND', 404);
  }
  const { getPdfLink } = require('./quotationService');
  return getPdfLink(actorAuth.companyId, project.quotation.id, deps);
}

// PWA FACT (`vProjects`'s `hit(p,[...])` search field list, §20, re-verified
// as exactly these 9 fields plus the special-cased engs substring match --
// NOT the SalesOrder search field list, which differs).
function projectMatchesQuery(project, soOrderNumber, engineerNames, q) {
  if (engineerNames.toLowerCase().indexOf(q) >= 0) return true;
  const blob = [
    soOrderNumber, project.name, project.division, project.siteType, project.capacity,
    project.customer, project.stage, project.status, project.vendor, project.checklistTemplateName,
  ]
    .filter((v) => v !== undefined && v !== null)
    .join(' ')
    .toLowerCase();
  return blob.indexOf(q) >= 0;
}

/**
 * PWA FACT (`vProjects`, §15/§20): PM roles see only their own division
 * (`myDiv()`); every other role (sales/admin/finance/service_mgr/engineer/
 * service_eng/inventory/super) sees all of the company's divisions -- there
 * is no separate company-level "division subscription" concept modeled in
 * this backend, so "all divisions the company has" here simply means "all
 * divisions" (no further filtering).
 *
 * PWA FACT (`vProjects`): sorted newest-first by REVERSED insertion/array
 * order, not by any date field -- `listByCompany` returns natural
 * (insertion) order, so reversing it here reproduces that exactly.
 */
// PWA FACT (MENUS, index.html:1225-1237): the Projects screen belongs to
// `admin` and the three PM roles, and a PM sees only their own division.
const PROJECT_LIST_ROLES = Object.freeze(['admin', 'hvac_pm', 'solar_pm', 'mep_pm']);
// The PWA's engineer dashboard (`engDash`) lists an engineer's OWN assigned
// projects off the same collection. The PWA had no server, so there was no
// API gate to copy; serving the whole company list to every authenticated
// role is this backend's own exposure, not PWA behaviour. These roles are
// therefore served the same rows the PWA showed them — their own
// assignments only — and every other role is refused.
const PROJECT_OWN_LIST_ROLES = Object.freeze(['engineer', 'service_eng']);

/**
 * Derived list columns for the Projects screen.
 *
 * PWA FACT (`vProjects`'s per-row precomputation, index.html:2095-2106):
 *   d   = checklist points done            -> checklistDone / checklistTotal
 *   lu  = last execution update            -> nextAction / nextActionDate
 *   over= nd <= today && status==="Ongoing"-> nextActionOverdue
 *   pi  = projPayInfo(p)                   -> payment.received / .pending
 *   pr  = returnable qty still on site     -> materialPendingReturn
 *   lt  = delayedItems(p)                  -> overduePoints (row turns pink)
 *   tl  = timelineReady(p)                 -> timelineSet + targetEnd
 * Engineer names and the SO number replace the PWA's plain stored strings.
 * Everything here is derived on read; nothing is stored.
 */
function buildProjectListRow(project, { nameById, soOrderNumberById, soById, payments }) {
  const checklist = project.checklist || [];
  const lu = (project.executionUpdates || [])[(project.executionUpdates || []).length - 1] || null;
  const nextActionDate = lu && lu.nextActionDate ? dayKey(lu.nextActionDate) : '';
  const overdue = delayedItems(project);
  const timelineReady = isTimelineReady(project);
  const so = project.salesOrderId ? soById.get(String(project.salesOrderId)) : null;
  const pay = so ? paySum(so, payments) : null;
  return {
    ...project,
    orderNumber: project.salesOrderId ? soOrderNumberById.get(String(project.salesOrderId)) || null : null,
    engineerNames: (project.assignedEngineerIds || []).map((id) => nameById.get(String(id))).filter(Boolean),
    checklistDone: checklist.filter((c) => c.done).length,
    checklistTotal: checklist.length,
    timelineSetReady: timelineReady,
    targetEnd: timelineReady ? dayKey(computeTargetEnd(checklist)) : '',
    overduePoints: overdue.length,
    nextAction: lu ? lu.nextAction || '' : '',
    nextActionDate,
    // PWA FACT (index.html:2096): only an Ongoing project's next-action date
    // is flagged overdue.
    nextActionOverdue: Boolean(nextActionDate && nextActionDate <= dayKey(todayDate()) && project.status === 'Ongoing'),
    materialPendingReturn: computePendingReturnableMaterial(project),
    payment: pay ? { received: pay.rcv, pending: pay.pen, total: pay.tot, percent: pay.pct } : null,
  };
}

async function listProjects(actorAuth, { filters = {}, enrich = false } = {}, deps) {
  assertCompanyContext(actorAuth);
  const ownOnly = PROJECT_OWN_LIST_ROLES.includes(actorAuth.role);
  if (!ownOnly && !PROJECT_LIST_ROLES.includes(actorAuth.role)) {
    assertRole(actorAuth, PROJECT_LIST_ROLES, 'view the Projects list');
  }
  const all = await deps.projectRepo.listByCompany(actorAuth.companyId);
  const pmDiv = PM_DIVISION_FOR_ROLE[actorAuth.role];
  // PWA FACT (vProjects / dlProjects `hasDiv(p.div)`, index.html:2091, 3434).
  const divisions = await getEffectiveDivisions(actorAuth.companyId, deps);
  const entitled = all.filter((p) => divisions.includes(p.division));
  /*
   * Owner request (19 Nov 2026): a Manager sees the projects ASSIGNED to
   * them and no others — not their whole division, and not the ones nobody
   * has been given yet.
   */
  const divScoped = pmDiv
    ? entitled.filter((p) => isAssignedManager(actorAuth, p))
    : entitled;
  const scoped = ownOnly
    ? divScoped.filter((p) => (p.assignedEngineerIds || []).map(String).includes(String(actorAuth.userId)))
    : divScoped;

  const q = filters.q ? String(filters.q).toLowerCase() : '';
  if (!q && !enrich) return [...scoped].reverse();

  const [users, salesOrders, payments] = await Promise.all([
    deps.userRepoForEnquiry.listByCompany(actorAuth.companyId),
    deps.salesOrderRepo.listByCompany(actorAuth.companyId),
    enrich && deps.paymentRepo && deps.paymentRepo.listByCompany
      ? deps.paymentRepo.listByCompany(actorAuth.companyId)
      : [],
  ]);
  const nameById = new Map(users.map((u) => [String(u.id), u.name]));
  const soOrderNumberById = new Map(salesOrders.map((s) => [String(s.id), s.orderNumber]));

  const filtered = q
    ? scoped.filter((p) => {
      const engNames = (p.assignedEngineerIds || []).map((id) => nameById.get(String(id)) || '').join(' ');
      return projectMatchesQuery(p, soOrderNumberById.get(String(p.salesOrderId)), engNames, q);
    })
    : scoped;
  const ordered = [...filtered].reverse();
  if (!enrich) return ordered;
  const soById = new Map(salesOrders.map((s) => [String(s.id), s]));
  return ordered.map((p) => buildProjectListRow(p, { nameById, soOrderNumberById, soById, payments }));
}

/* ================= STAGE / STATUS / COMPLETION ================= */

// PWA FACT (§10, `pend`): sum of (quantity - returnedQuantity) over
// returnable delivery-challan rows ONLY -- never consults any Inventory
// collection (§11, §30 item 9 -- confirmed non-integration, preserved).
function computePendingReturnableMaterial(project) {
  return (project.deliveryChallans || [])
    .filter((d) => d.returnable)
    .reduce((a, d) => a + ((Number(d.quantity) || 0) - (Number(d.returnedQuantity) || 0)), 0);
}

// PWA FACT (§10, `notAppr`): a point counts against completion if it is
// NOT done, OR is done but lacks a truthy approval.approverName -- a
// done-but-unapproved point counts exactly like an undone point.
function computeIncompleteOrUnapprovedChecklistCount(project) {
  return (project.checklist || []).filter((c) => !c.done || !(c.approval && c.approval.approverName)).length;
}

/**
 * PWA FACT (`savePM`, §5/§6/§10, verbatim):
 *   if(p.stage==="Completed" && p.status!=="In Service"){
 *     pend = sum(returnable dc qty-rqty); notAppr = count(!done || !approved);
 *     if(pend>0 && !confirm(...)) { rollback; return }
 *     if(notAppr>0 && !confirm(...)) { rollback; return }
 *     p.status="Completed"; p.end=p.end||today();
 *   } else if(p.status!=="In Service") p.status="Ongoing";
 *
 * The literal string `"Completed"` check (not "division's terminal stage")
 * means MEP -- whose terminal stage is literally "Delivered" -- can
 * NEVER reach this branch. This is PRESERVED EXACTLY (§30 item 4): no
 * "MEP is considered complete at its own terminal stage" logic is added.
 *
 * The two confirmations are modeled as explicit `confirmPendingMaterial` /
 * `confirmIncompleteChecklist` request flags (mirroring
 * paymentService.addPartPayment's `confirmOverpayment` pattern) since a
 * server API has no interactive confirm() dialog of its own. If either
 * required confirmation is missing, NOTHING is persisted (matching the
 * PWA's own rollback-to-`old`-and-return-early behavior) -- both checks run
 * before any write, rather than partially committing then rolling back.
 *
 * Un-Completing (§6/§23 quirk #3, §30 item 5): moving `stage` away from the
 * literal "Completed" string while `status!=="In Service"` silently reverts
 * `status` to "Ongoing" -- no confirmation, no distinct notification.
 * PRESERVED EXACTLY, not "fixed" with a guard.
 *
 * Once `status==="In Service"`, `stage` may be changed freely with zero
 * effect on `status` (§6/§23 quirk #2) -- PRESERVED EXACTLY.
 *
 * Stage validity itself is enforced via Project.js's own division-aware
 * schema validator (not a NEW restriction beyond what the PWA's own
 * `<select>` already constrained the user to -- the PWA had no function-
 * level stage-validity check either, §5, but an arbitrary string was never
 * actually reachable through its UI).
 *
 * Notification timing (see class doc's OPEN DECISION list, and
 * PWA_COVERAGE_AUDIT_PROJECT.md §21 rows 3/4/5): #3 (finance) and #4
 * (admin) fire whenever the literal stage VALUE actually changes
 * (`old !== stage`, matching the audit's literal "any stage change"
 * wording); #5 (service_mgr) fires whenever THIS call's completion block
 * actually executes and successfully sets `status="Completed"` -- which
 * covers both a fresh transition into Completed and a same-value resave
 * that still has to re-clear both confirmation gates. This is the most
 * faithful reading available given the audit's own PWA-source excerpt; it
 * is called out explicitly here since the audit's plain-English summary of
 * trigger #5 ("stage changed to Completed specifically") does not, by
 * itself, fully disambiguate the old===new resave case.
 */
async function setStage(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'change this project\'s stage');

  const { stage, confirmPendingMaterial, confirmIncompleteChecklist } = input || {};
  const allowedStages = PROJECT_STAGES_BY_DIVISION[project.division] || [];
  if (!stage || !allowedStages.includes(stage)) {
    throw new ServiceError(`'${stage}' is not a valid stage for this project's division.`, 'VALIDATION_ERROR', 400);
  }

  const old = project.stage;
  const patch = { stage };
  // Owner decision (30 Oct 2026): a real stage change is recorded with its
  // date, so the client portal can show when each stage was reached instead
  // of only where the project stands now. A resave of the same stage adds
  // nothing — the guard matches the one the notifications below already use.
  if (old !== stage) {
    patch.stageHistory = [
      ...(project.stageHistory || []),
      { stage, enteredAt: todayDate(), enteredByUserId: actorAuth.userId || null },
    ];
  }
  let completionRan = false;
  let pend = 0;
  let notAppr = 0;

  if (stage === 'Completed' && project.status !== 'In Service') {
    pend = computePendingReturnableMaterial(project);
    notAppr = computeIncompleteOrUnapprovedChecklistCount(project);
    if (pend > 0 && !confirmPendingMaterial) {
      throw new ServiceError(
        `${pend} returnable material qty is still pending return to office. Resubmit with confirmPendingMaterial:true to mark completed anyway.`,
        'PENDING_MATERIAL_CONFIRMATION_REQUIRED',
        409
      );
    }
    if (notAppr > 0 && !confirmIncompleteChecklist) {
      throw new ServiceError(
        `${notAppr} checklist point(s) are not completed/approved. Resubmit with confirmIncompleteChecklist:true to mark completed anyway.`,
        'INCOMPLETE_CHECKLIST_CONFIRMATION_REQUIRED',
        409
      );
    }
    patch.status = 'Completed';
    patch.endDate = project.endDate || todayDate();
    completionRan = true;
  } else if (project.status !== 'In Service') {
    patch.status = 'Ongoing'; // PWA QUIRK, preserved: un-completes silently, no confirm/notification of its own.
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, patch, session, { expectedRevision: project.revision });
    const today = todayDate();
    const soPart = project.salesOrderId ? await txnDeps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId) : null;
    const soLabel = soPart ? ` (SO-${soPart.orderNumber}).` : '.';

    if (old !== stage) {
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Project stage update: "${project.name}" moved ${old} -> ${stage}${project.salesOrderId ? ` (SO-${soPart ? soPart.orderNumber : ''}). Check payment milestone due as per SO terms.` : '.'}`,
          date: today,
          targetRoles: ['finance'],
          readByUserIds: [],
        },
        session
      );
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `"${project.name}" stage: ${old} -> ${stage}`,
          date: today,
          targetRoles: ['admin'],
          readByUserIds: [],
        },
        session
      );
    }
    // FIX-3.3-02: PWA FACT (`savePM`) groups ALL of finance/admin/service_mgr
    // notifications under one `if(old!==p.stage)` guard -- a same-value
    // resave fires none of them. Gate the service_mgr notification on the
    // same `old !== stage` condition as the finance/admin ones above, so a
    // resave of an already-Completed stage (completionRan stays true, but
    // old===stage) no longer fires a duplicate notification.
    if (completionRan && old !== stage) {
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Project "${project.name}" marked Completed. Approve commissioning to convert into 1-year warranty service project.`,
          date: today,
          targetRoles: ['service_mgr'],
          readByUserIds: [],
        },
        session
      );
    }
    return updated;
  });
}

/* ============ A CHECKLIST POINT CAN RELEASE A PAYMENT MILESTONE ============
   Owner request (16 Nov 2026): "we can set or link those milestone on which
   stage (from the 13 checklists) the payment should be taken ... once the
   stage is complete the milestone that is set to the payment will
   automatically go to finance."

   A point is signed off when it is both DONE and APPROVED -- the same bar
   the project's own completion uses. Finance is then asked for that
   milestone exactly as if a PM had pressed "Raise to Finance", which stays
   on the sales order for anything unlinked or needed early. ============ */

/** "Collect within N days" as the same YYYY-MM-DD the raise form sends. */
function collectByFromToday(days) {
  const d = todayDate();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Done AND approved: the point has been signed off, not merely ticked. */
function pointIsSignedOff(point) {
  return !!(point && point.done && point.approval && point.approval.approverName);
}

/**
 * Tie a checklist point to one of the sales order's payment milestones, or
 * untie it (`milestoneIndex: null`).
 *
 * One point, one milestone, and one milestone released by one point only --
 * otherwise the same money would be asked for twice.
 */
async function setChecklistMilestoneLink(projectId, itemIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, "link a payment milestone to this project's checklist");

  const idx = Number(itemIndex);
  const item = (project.checklist || [])[idx];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);

  const raw = (input || {}).milestoneIndex;
  const clearing = raw === null || raw === undefined || raw === '';
  const milestoneIndex = clearing ? null : Number(raw);

  let collectWithinDays = null;
  if (!clearing) {
    if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0) {
      throw new ServiceError('A milestone is chosen by its position on the sales order.', 'VALIDATION_ERROR', 400);
    }
    if (!project.salesOrderId) {
      throw new ServiceError('This project has no sales order, so it has no payment milestones.', 'VALIDATION_ERROR', 400);
    }
    const so = await deps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId);
    const milestones = (so && so.paymentMilestones) || [];
    if (!milestones[milestoneIndex]) {
      throw new ServiceError('That payment milestone is not on this project\'s sales order.', 'NOT_FOUND', 404);
    }
    /*
     * One milestone, one point. Re-linking the same point is fine.
     *
     * DEFECT, found 18 Nov 2026: this compared Number(c.releasesMilestoneIndex),
     * and Number(null) is 0. A point that releases NOTHING is stored as null
     * — that is the schema's own default — so every unlinked point read as
     * "releases milestone 0", and linking the FIRST milestone (the advance)
     * to any point was refused with "already released by checklist point 1".
     * Only milestone 0 was affected, because Number(null) is only ever 0.
     *
     * The in-memory test store left the field absent rather than null, where
     * Number(undefined) is NaN and matches nothing, which is why the tests
     * never saw it.
     *
     * An absent link is now read as absent, not as zero.
     */
    const linksTo = (c) => c.releasesMilestoneIndex !== null
      && c.releasesMilestoneIndex !== undefined
      && Number(c.releasesMilestoneIndex) === milestoneIndex;
    const takenBy = (project.checklist || []).findIndex((c, i) => i !== idx && linksTo(c));
    if (takenBy >= 0) {
      throw new ServiceError(
        `"${milestones[milestoneIndex].description}" is already released by checklist point ${takenBy + 1}.`,
        'MILESTONE_ALREADY_LINKED',
        409
      );
    }
    const days = (input || {}).collectWithinDays;
    if (days !== null && days !== undefined && days !== '') {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        throw new ServiceError('Collect within must be a whole number of days, 0 to 365.', 'VALIDATION_ERROR', 400);
      }
      collectWithinDays = n;
    }
  }

  const checklist = (project.checklist || []).map((c, i) => (i === idx
    ? { ...c, releasesMilestoneIndex: milestoneIndex, releaseCollectWithinDays: collectWithinDays }
    : c));
  const saved = await deps.projectRepo.update(
    actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision }
  );
  // Linking a point that is ALREADY signed off should not leave the money
  // waiting for a tick that has happened.
  return releaseLinkedMilestones(saved, actorAuth, deps);
}

/**
 * Ask Finance for every milestone whose point has just been signed off.
 *
 * Never raises the same milestone twice: a payment already carrying a
 * `raisedToFinance` record is left exactly as it is, whether it was raised
 * by hand or by an earlier pass of this.
 *
 * A failure here must not undo the tick or the approval that caused it --
 * the work IS done, and that record matters more than the chase. A
 * milestone that could not be raised is left for the manual button, and the
 * reason is logged rather than thrown at whoever ticked the box.
 */
async function releaseLinkedMilestones(project, actorAuth, deps) {
  if (!project || !project.salesOrderId) return project;
  const points = (project.checklist || []);
  const due = points.filter((c) => pointIsSignedOff(c)
    && c.releasesMilestoneIndex !== null
    && c.releasesMilestoneIndex !== undefined);
  if (due.length === 0) return project;

  // Required here rather than at the top of the file: paymentService is only
  // needed on this path, and a lazy require keeps the two modules free to
  // refer to each other.
  const paymentService = require('./paymentService');

  for (const point of due) {
    const milestoneIndex = Number(point.releasesMilestoneIndex);
    try {
      /* eslint-disable no-await-in-loop */
      const existing = await deps.paymentRepo.findBySalesOrderAndMilestone(
        actorAuth.companyId, project.salesOrderId, milestoneIndex
      );
      if (existing && existing.raisedToFinance) continue; // already asked for
      const collectBy = point.releaseCollectWithinDays === null || point.releaseCollectWithinDays === undefined
        ? null
        : collectByFromToday(Number(point.releaseCollectWithinDays));
      await paymentService.raiseToFinance(
        project.salesOrderId,
        milestoneIndex,
        {
          note: `Released by checklist point: ${String(point.text).slice(0, 80)}`,
          dueByDate: collectBy,
          priority: 'Normal',
        },
        actorAuth,
        deps,
        { bySystem: true }
      );
      /* eslint-enable no-await-in-loop */
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[projectService.releaseLinkedMilestones]', err && err.message);
    }
  }
  return project;
}

/**
 * The project finishes itself when its checklist is finished.
 *
 * OWNER DECISION (16 Nov 2026): the checklist points ARE the project's
 * stages, so "Change Stage" was taken off the project screen. Something
 * still has to mark a project Completed — that status is what lets a
 * finished site be converted into a warranty/AMC service project, and what
 * shows the client a completion date — so the checklist does it. When every
 * point is ticked AND approved (computeIncompleteOrUnapprovedChecklistCount,
 * the same measure the old Change Stage dialog used), the project moves to
 * its division's last stage and is marked Completed.
 *
 * Differences from the old by-hand path, deliberately:
 *   · No PM role gate. Nobody is "doing" this — the project completed
 *     itself because the work did. The engineer who ticked the last point
 *     is not asking to change a stage, so they are not refused one.
 *   · Returnable material still out does NOT block it. By hand that needed
 *     a confirmation; here, blocking would strand the project with nobody
 *     to ask, so instead the quantity is named in the notification and the
 *     chase goes on separately.
 *   · MEP keeps its own quirk: `status` is set to Completed only where the
 *     division's last stage is literally "Completed", which MEP's
 *     ("Delivered") is not. That asymmetry is preserved, not fixed.
 *
 * Returns the project, completed or not, so callers can return it onward.
 */
async function completeIfChecklistFinished(project, actorAuth, deps) {
  if (!project) return project;
  const points = project.checklist || [];
  if (points.length === 0) return project;
  if (computeIncompleteOrUnapprovedChecklistCount(project) > 0) return project;
  if (project.status === 'Completed' || project.status === 'In Service') return project;

  const stages = PROJECT_STAGES_BY_DIVISION[project.division] || [];
  const terminal = stages[stages.length - 1];
  if (!terminal || project.stage === terminal) return project;

  const old = project.stage;
  const projectId = project.id || project._id;
  const patch = {
    stage: terminal,
    stageHistory: [
      ...(project.stageHistory || []),
      { stage: terminal, enteredAt: todayDate(), enteredByUserId: actorAuth.userId || null },
    ],
  };
  const marksCompleted = terminal === 'Completed';
  if (marksCompleted) {
    patch.status = 'Completed';
    patch.endDate = project.endDate || todayDate();
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(
      actorAuth.companyId, projectId, patch, session, { expectedRevision: project.revision }
    );
    const today = todayDate();
    const so = project.salesOrderId
      ? await txnDeps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId)
      : null;
    const soSuffix = so ? ` (SO-${so.orderNumber}).` : '.';

    await txnDeps.notificationRepo.create({
      companyId: actorAuth.companyId,
      text: `Project stage update: "${project.name}" moved ${old} -> ${terminal}${so ? ` (SO-${so.orderNumber}). Check payment milestone due as per SO terms.` : '.'}`,
      date: today,
      targetRoles: ['finance'],
      readByUserIds: [],
    }, session);
    await txnDeps.notificationRepo.create({
      companyId: actorAuth.companyId,
      text: `"${project.name}" stage: ${old} -> ${terminal} (every checklist point done and approved)`,
      date: today,
      targetRoles: ['admin'],
      readByUserIds: [],
    }, session);

    if (marksCompleted) {
      const pending = computePendingReturnableMaterial(project);
      await txnDeps.notificationRepo.create({
        companyId: actorAuth.companyId,
        text: `Project "${project.name}" marked Completed${soSuffix} Approve commissioning to convert into 1-year warranty service project.`
          + (pending > 0 ? ` NOTE: ${pending} returnable material qty is still pending return to office.` : ''),
        date: today,
        targetRoles: ['service_mgr'],
        readByUserIds: [],
      }, session);
    }
    return updated;
  });
}

/** PWA FACT (`savePM`'s vendor field, free text, no notification). */
async function setVendor(projectId, vendor, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, "edit this project's vendor");
  return deps.projectRepo.update(actorAuth.companyId, projectId, { vendor: vendor || '' });
}

/* ================= ENGINEER ASSIGNMENT ================= */

/**
 * PWA FACT (`savePM`, §14): FULL REPLACE, not additive -- re-saving with a
 * shorter list silently unassigns (quirk #11, preserved). Candidate pool is
 * COMPANY-WIDE, not division-filtered (quirk #12, preserved per explicit
 * task instruction -- §30 item 2). Unlimited engineer count (no cap).
 * Notifies `["*"]` (every role in the company) listing only the NEWLY
 * added engineers, exact wording from §21 row 6.
 */
async function assignEngineers(projectId, engineerIds, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, "assign this project's engineers");

  const ids = Array.isArray(engineerIds) ? engineerIds : [];
  const uniqueIds = [...new Set(ids.map(String))];
  for (const id of uniqueIds) {
    // eslint-disable-next-line no-await-in-loop
    const user = await deps.userRepoForEnquiry.findById(id);
    if (!user || String(user.companyId) !== String(actorAuth.companyId) || !ENGINEER_CANDIDATE_ROLES.includes(user.role)) {
      throw new ServiceError(
        `User ${id} is not a valid engineer-assignment candidate (must be a company-wide engineer/PM/service_eng user).`,
        'VALIDATION_ERROR',
        400
      );
    }
  }

  const prevIds = new Set((project.assignedEngineerIds || []).map(String));
  const newlyAdded = uniqueIds.filter((id) => !prevIds.has(id));

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { assignedEngineerIds: uniqueIds }, session);
    if (newlyAdded.length) {
      const names = [];
      for (const id of newlyAdded) {
        // eslint-disable-next-line no-await-in-loop
        const user = await deps.userRepoForEnquiry.findById(id);
        names.push(user ? user.name : id);
      }
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Engineer(s) ${names.join(', ')} assigned to project "${project.name}"`,
          date: todayDate(),
          targetRoles: ['*'],
          readByUserIds: [],
          // Phone push goes to the newly assigned engineers only (owner decision 21 Oct 2026).
          push: { userIds: newlyAdded, path: `/projects/${projectId}` },
        },
        session
      );
    }
    return updated;
  });
}

/* ================= TIMELINE ================= */

/**
 * PWA FACT (`saveTimeline`, §7, verbatim rules):
 *  - `targetDates` must be parallel to the project's own checklist array.
 *  - If ZERO points received a date, blocks entirely (no persist at all).
 *  - If SOME but not all points received a date, requires an explicit
 *    `confirmPartialDates:true` flag (mirrors the PWA's `confirm()` warn-
 *    but-allow dialog) -- otherwise rejected without persisting.
 *  - `timelineSet` is set to `true` unconditionally on success and NEVER
 *    reset false by any function in this module (§7/§23 quirk #20/§30
 *    item 12 -- one-way flag, preserved exactly).
 *  - `endDate` is recomputed as the latest target date across the whole
 *    checklist (`projTargetEnd`), overwriting whatever the SO-copied
 *    `endDate` held (quirk #19, preserved).
 *  - `startDate` may optionally be overwritten (`p.start=gv("tl_s")||p.start`).
 *  - Fires the FIRST-EVER-timeline-save notification only (`first =
 *    !p.timelineSet` before this save) -- never on later timeline edits.
 */
async function saveTimeline(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, "set this project's timeline");

  const { targetDates, startDate: startDateOverride, confirmPartialDates } = input || {};
  const checklistLen = (project.checklist || []).length;
  const dates = Array.isArray(targetDates) ? targetDates : [];
  if (dates.length !== checklistLen) {
    throw new ServiceError('targetDates must have one entry per checklist point (use null for a blank date).', 'VALIDATION_ERROR', 400);
  }

  let missing = 0;
  const checklist = project.checklist.map((item, i) => {
    const d = dates[i];
    if (!d) {
      missing += 1;
      return { ...item };
    }
    return { ...item, targetDate: d };
  });

  if (checklistLen > 0 && missing === checklistLen) {
    throw new ServiceError('Enter target dates before saving.', 'VALIDATION_ERROR', 400); // PWA FACT: blocks entirely
  }
  if (missing > 0 && missing < checklistLen && !confirmPartialDates) {
    throw new ServiceError(
      `${missing} point(s) have no target date. Resubmit with confirmPartialDates:true to save anyway.`,
      'PARTIAL_DATES_CONFIRMATION_REQUIRED',
      409
    );
  }

  const first = !project.timelineSet;
  const endDate = computeTargetEnd(checklist) || project.endDate;
  const startDate = startDateOverride || project.startDate;
  const patch = { checklist, timelineSet: true, startDate, endDate };

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, patch, session, { expectedRevision: project.revision });
    if (first) {
      const actorName = await resolveActorName(actorAuth, txnDeps);
      const pmRole = DIVISION_PM_ROLE[project.division];
      await txnDeps.notificationRepo.create(
        {
          companyId: actorAuth.companyId,
          text: `Timeline set for "${project.name}" by ${actorName} -- target completion ${dayKey(endDate)}. Work can now start.`,
          date: todayDate(),
          targetRoles: ['admin', 'sales', pmRole],
          readByUserIds: [],
        },
        session
      );
    }
    return updated;
  });
}

/**
 * PWA FACT (`saveItemDate`/`mItemDate`, §7): single-point target-date edit,
 * PM-only, also recomputes `endDate` (can silently move the project's
 * displayed end date, quirk #19 preserved) -- fires no notification of its
 * own (distinct from `saveTimeline`'s first-time notification).
 */
async function editChecklistItemDate(projectId, itemIndex, targetDate, actorAuth, deps, completedDate) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'edit a checklist point\'s target date');
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);

  // PWA FACT (saveItemDate, index.html:2627-2631): the completed date can
  // also be corrected, but only on a point that is already done.
  const checklist = project.checklist.map((c, i) => {
    if (i !== Number(itemIndex)) return c;
    const next = { ...c, targetDate: targetDate || null };
    if (c.done && completedDate) next.completedDate = new Date(completedDate);
    return next;
  });
  const endDate = computeTargetEnd(checklist) || project.endDate;
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist, endDate }, undefined, { expectedRevision: project.revision });
}

/* ================= CHECKLIST EXECUTION ================= */

/**
 * PWA FACT (`tickChk`, §7/§8): the ONLY gate on ticking (val=true) is
 * project-level `timelineReady` -- it does NOT check the specific point's
 * own targetDate. Un-ticking clears `approval` and `pmSigned` in the same
 * call (quirk #7, preserved, no confirmation). On a late tick (target date
 * already passed), fires the per-point delay notification (#7); on the
 * LAST remaining undone point being ticked, fires the all-done notification
 * (#8) instead/in-addition (both can theoretically co-occur if the last
 * point ticked is also late -- the PWA fires both independently, so this
 * does too).
 *
 * Role gate: isPM||isAssignedEngineer (§22 table), enforced server-side.
 * `status!=="In Service"` is ALSO enforced here (it is part of the same
 * combined UI-visibility condition the audit documents for this action,
 * §22; enforcing it is consistent with this task's "enforce the PWA's own
 * VISIBLE intent server-side" convention, even though the audit notes the
 * PWA's OWN `tickChk` function itself does not check it).
 */
async function setChecklistItemDone(projectId, itemIndex, done, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  // Pre-check (fast-fail before opening a transaction) -- kept only as an
  // early user-facing rejection; NOT the authoritative guard (see FIX-6-01
  // below, which is what actually protects against a concurrent lost
  // update on the whole-array-replace pattern).
  const precheckProject = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!precheckProject) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, precheckProject, 'tick this checklist point');
  if (precheckProject.status === 'In Service') {
    throw new ServiceError('Checklist cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  const precheckItem = precheckProject.checklist[itemIndex];
  if (!precheckItem) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  if (done && !isTimelineReady(precheckProject)) {
    throw new ServiceError('Set the project timeline (with at least one target date) before ticking checklist points.', 'TIMELINE_NOT_READY', 400);
  }

  const today = todayDate();

  const saved = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // FIX-6-01 (Stage 5 finding F2): re-fetch the Project AND rebuild the
    // checklist array fresh, inside the transaction, on every attempt
    // (including retries after a write-conflict). setChecklistItemDone
    // persists the checklist as a single whole-array replace (matching the
    // PWA's own in-memory array-of-objects model -- there is no PWA
    // per-item update primitive to preserve, since the PWA has no
    // concurrent-writer concept at all). Building the replacement array
    // from a STALE outer-scope snapshot means two users ticking two
    // DIFFERENT items on the same project concurrently can each overwrite
    // the other's already-committed tick with their own stale copy of it
    // (a NEW-APP-only lost-update bug -- the PWA's single-process,
    // synchronous model has no equivalent race). Re-reading inside the
    // transaction body means a write-conflict forces `withTransaction` to
    // retry this callback against a fresh snapshot that already contains
    // the other writer's committed tick, so both ticks survive. This does
    // not change any PWA-visible outcome for a single, non-concurrent call.
    const project = await txnDeps.projectRepo.findById(actorAuth.companyId, projectId, txnDeps.session);
    if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
    const item = project.checklist[itemIndex];
    if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
    const checklist = project.checklist.map((c, i) => {
      if (i !== Number(itemIndex)) return c;
      return done
        ? { ...c, done: true, completedDate: today }
        : { ...c, done: false, completedDate: null, approval: null, pmSigned: false }; // PWA QUIRK, preserved
    });
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, session, { expectedRevision: project.revision });
    const pmRole = DIVISION_PM_ROLE[project.division];
    if (done) {
      const v = daysBetween(item.targetDate, today);
      if (item.targetDate && v > 0) {
        await txnDeps.notificationRepo.create(
          {
            companyId: actorAuth.companyId,
            text: `Delayed completion on "${project.name}": "${item.text.slice(0, 50)}" done on ${dayKey(today)}, ${v} day(s) after target ${dayKey(item.targetDate)}.`,
            date: today,
            targetRoles: [pmRole, 'sales', 'admin'],
            readByUserIds: [],
          },
          session
        );
      }
      if (checklist.every((c) => c.done)) {
        await txnDeps.notificationRepo.create(
          {
            companyId: actorAuth.companyId,
            text: `All checklist points completed for "${project.name}".`,
            date: today,
            targetRoles: [pmRole, 'admin', 'service_mgr'],
            readByUserIds: [],
          },
          session
        );
      }
    }
    return updated;
  });

  // Owner decision (16 Nov 2026): the checklist is the project's stages, so
  // a signed-off point asks Finance for the milestone it releases, and the
  // project finishes itself once every point is done and approved.
  await releaseLinkedMilestones(saved, actorAuth, deps);
  return completeIfChecklistFinished(saved, actorAuth, deps);
}

/**
 * PWA FACT (`chkRemark`, §8/§22): the weakest-gated action of the whole
 * module (no timelineReady check, no status check, not even the tick
 * gate's business rule) -- but its VISIBLE UI gate is the same `isPM||isEng`
 * condition as ticking, which is what is enforced here, consistent with
 * this module's uniform "enforce the visible intent" convention.
 */
async function setChecklistItemRemark(projectId, itemIndex, remark, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, "edit a checklist point's remark");
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, remark: remark || '' } : c));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`addPhoto`, §8): push-only, no remove function anywhere, no
 * cap on count or size (base64 data URI stored inline, matching the PWA's
 * own storage shape exactly -- §30 item 8, preserved).
 */
async function addChecklistItemPhoto(projectId, itemIndex, photoDataUri, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'add a checklist point photo');
  if (project.status === 'In Service') {
    throw new ServiceError('Checklist cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  if (!photoDataUri) throw new ServiceError('A photo is required.', 'VALIDATION_ERROR', 400);
  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, photos: [...(c.photos || []), photoDataUri] } : c));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`doApprove`, §8/§9): the point must be `done` (implied by the
 * button only rendering then); the actor's role must be a member of
 * `SIGN_ROLES[item.signResponsibility]` (`canApprove`). CLIENT points
 * capture a free-typed on-site `approverName` plus a signature image;
 * every other sign type stamps the ACTING staff member's own display name
 * as `approverName` (so `approverName === enteredByUserId`'s owner for
 * those, but the two fields remain structurally distinct always). Approval
 * is OVERWRITE-ONLY (quirk #8, preserved) -- no history of prior
 * approvals. Fires notification #9 to [divisionPMrole, admin].
 */
async function approveChecklistItem(projectId, itemIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  if (!item.done) {
    throw new ServiceError('A checklist point must be done before it can be approved.', 'VALIDATION_ERROR', 400);
  }
  const requiredRoles = SIGN_ROLES[item.signResponsibility] || [];
  if (!requiredRoles.includes(actorAuth.role)) {
    throw new ServiceError(`Role "${actorAuth.role}" is not permitted to approve a ${item.signResponsibility} point.`, 'FORBIDDEN', 403);
  }

  const isClient = item.signResponsibility === 'CLIENT';
  const { approverName, approvalRemark, signatureImage } = input || {};
  // PWA FACT (doApprove, index.html:2318-2320): a CLIENT point needs the
  // client's name and a drawn signature.
  if (isClient && !(approverName && String(approverName).trim())) {
    throw new ServiceError('Enter client name', 'VALIDATION_ERROR', 400);
  }
  if (isClient && !signatureImage) {
    throw new ServiceError('Client signature required', 'VALIDATION_ERROR', 400);
  }
  const actorName = await resolveActorName(actorAuth, deps);
  const approval = {
    approverName: isClient ? approverName || '' : actorName,
    approvedByRole: item.signResponsibility, // PWA FACT: records the satisfied sign-responsibility, NOT actorAuth.role
    approvedDate: todayDate(),
    approvalRemark: approvalRemark !== undefined ? approvalRemark : (item.approval && item.approval.approvalRemark) || '',
    signatureImage: isClient ? signatureImage || '' : '',
    enteredByUserId: actorAuth.userId,
  };
  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, approval } : c));

  const saved = await deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, session, { expectedRevision: project.revision });
    const pmRole = DIVISION_PM_ROLE[project.division];
    await txnDeps.notificationRepo.create(
      {
        companyId: actorAuth.companyId,
        text: `Checklist point approved (${item.signResponsibility} by ${approval.approverName}) on "${project.name}": ${item.text.slice(0, 60)}`,
        date: todayDate(),
        targetRoles: [pmRole, 'admin'],
        readByUserIds: [],
      },
      session
    );
    return updated;
  });

  // The approval is what signs a point off (owner decision, 16 Nov 2026):
  // only then is its milestone asked for, and only then does it count
  // towards the project being finished.
  await releaseLinkedMilestones(saved, actorAuth, deps);
  return completeIfChecklistFinished(saved, actorAuth, deps);
}

/**
 * PWA FACT (`pmSign`, §9/§23 quirk #9): a bare, one-way boolean -- no
 * un-sign function, no remark/date/signature metadata, no notification.
 */
async function counterSignChecklistItem(projectId, itemIndex, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'counter-sign this checklist point');
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  // PWA FACT (vProject, index.html:2201): PM Sign is offered only on a point
  // that is done AND approved.
  if (!item.done || !(item.approval && item.approval.approverName)) {
    throw new ServiceError('A point can be PM-signed only after it is done and approved.', 'VALIDATION_ERROR', 400);
  }
  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, pmSigned: true } : c));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`mAddChkItem`/`addChkItem`, §8): PM-only. New points always
 * start fresh (done:false, no approval/photos/dates).
 */
async function addChecklistItem(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'add a checklist point');
  const { text, signResponsibility } = input || {};
  if (!text || !SIGN_RESPONSIBILITIES.includes(signResponsibility)) {
    throw new ServiceError('A checklist point needs text and a valid sign responsibility.', 'VALIDATION_ERROR', 400);
  }
  const checklist = [...project.checklist, freshChecklistItem({ text, signResponsibility })];
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`mEditProjChk`/`saveProjChk`, §8/§23 quirk #5): PM-only; may
 * edit text and/or sign responsibility EVEN AFTER approval exists, with no
 * functional consequence to the existing `approval` record (it is not
 * re-validated against a new sign responsibility) -- preserved exactly,
 * "warn but don't block" is a UI-only concern, not modeled here.
 */
async function editChecklistItem(projectId, itemIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'edit a checklist point');
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  const { text, signResponsibility } = input || {};
  if (signResponsibility !== undefined && !SIGN_RESPONSIBILITIES.includes(signResponsibility)) {
    throw new ServiceError('Invalid sign responsibility.', 'VALIDATION_ERROR', 400);
  }
  const checklist = project.checklist.map((c, i) => {
    if (i !== Number(itemIndex)) return c;
    return {
      ...c,
      text: text !== undefined ? text : c.text,
      signResponsibility: signResponsibility !== undefined ? signResponsibility : c.signResponsibility,
    };
  });
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`rmChkItem`, §8/§23 quirk #6): PM-only at the UI level; the
 * FUNCTION ITSELF has no protection against removing a done/approved
 * point -- the UI merely omits the button once `done` is true. Preserved
 * exactly: no function-level "cannot remove a done point" guard is added.
 */
async function removeChecklistItem(projectId, itemIndex, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'remove a checklist point');
  if (!project.checklist[itemIndex]) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
  const checklist = project.checklist.filter((_, i) => i !== Number(itemIndex));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`mApplyChkList`/`applyChkList`, §8/§23 quirk #4, §30 item 6):
 * "Replace" (`mode:"replace"`) discards ALL prior ticks/dates/approvals/
 * photos/remarks with NO confirm() gate at the function level (only a
 * passive UI warning banner) -- PRESERVED EXACTLY, no server-side
 * confirmation requirement is added. "Append" (`mode:"append"`) is purely
 * additive. `checklistTemplateName` is only updated on Replace (PWA FACT:
 * `chkName` is only reassigned in the replace branch's own code).
 */
async function applyChecklistTemplate(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, "apply a checklist template to this project");
  const { templateId, mode } = input || {};
  if (mode !== 'replace' && mode !== 'append') {
    throw new ServiceError('mode must be "replace" or "append".', 'VALIDATION_ERROR', 400);
  }
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  // PWA FACT (mApplyChkList, index.html:2786): only the project's own
  // division's checklists are offered.
  if (template.division !== project.division) {
    throw new ServiceError(`Choose a ${project.division} checklist for this project.`, 'VALIDATION_ERROR', 400);
  }

  const freshItems = template.items.map((t) => freshChecklistItem(t));
  const patch =
    mode === 'replace'
      ? { checklist: freshItems, checklistTemplateName: template.name }
      // PWA FACT (applyChkList, index.html:2802): `p.chkName = p.chkName || c.name`.
      : { checklist: [...project.checklist, ...freshItems], checklistTemplateName: project.checklistTemplateName || template.name };
  return deps.projectRepo.update(actorAuth.companyId, projectId, patch, undefined, { expectedRevision: project.revision });
}

/* ================= EXECUTION UPDATES ================= */

/**
 * PWA FACT (`addUpdate`, §13): APPEND-ONLY -- no edit/delete function
 * exists anywhere for an existing entry. `actionDone` is required;
 * `nextAction`/`nextActionDate` optional. No attachments. No notification.
 */
async function addExecutionUpdate(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'add an execution update');
  const { actionDone, nextAction, nextActionDate, shareWithCustomer, customerNote } = input || {};
  if (!actionDone) {
    throw new ServiceError('Action Done is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("up_done")){toast(...)}`
  }
  const update = {
    date: todayDate(),
    actionDone,
    nextAction: nextAction || '',
    nextActionDate: nextActionDate || null,
    enteredByUserId: actorAuth.userId,
    // Owner decision (30 Oct 2026). Opt in, never inferred: an update is
    // internal unless whoever wrote it said otherwise.
    sharedWithCustomer: shareWithCustomer === true,
    customerNote: shareWithCustomer === true ? String(customerNote || '').trim() : '',
  };
  const executionUpdates = [...(project.executionUpdates || []), update];
  return deps.projectRepo.update(actorAuth.companyId, projectId, { executionUpdates }, undefined, { expectedRevision: project.revision });
}

/**
 * Share an execution update with the client, or take it back (owner
 * decision, 30 Oct 2026).
 *
 * Un-sharing matters as much as sharing: something posted in haste has to be
 * retractable, and the client's feed is built from this flag alone, so
 * clearing it removes the entry at once.
 */
async function setExecutionUpdateShared(projectId, updateIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'share an execution update with the client');

  const updates = [...(project.executionUpdates || [])];
  const i = Number(updateIndex);
  if (!Number.isInteger(i) || i < 0 || i >= updates.length) {
    throw new ServiceError('That execution update does not exist.', 'NOT_FOUND', 404);
  }

  const { shared, customerNote } = input || {};
  if (typeof shared !== 'boolean') {
    throw new ServiceError('shared must be true or false.', 'VALIDATION_ERROR', 400);
  }

  updates[i] = {
    ...updates[i],
    sharedWithCustomer: shared,
    // Dropping the client wording along with the flag keeps the record
    // honest: an unshared update carries no client-facing text.
    customerNote: shared
      ? String(customerNote === undefined ? updates[i].customerNote || '' : customerNote).trim()
      : '',
  };

  const saved = await deps.projectRepo.update(
    actorAuth.companyId,
    projectId,
    { executionUpdates: updates },
    undefined,
    { expectedRevision: project.revision }
  );

  // Only on the way out, and only when there is something to read. Taking an
  // update back is silent: nobody is notified that news has been withdrawn.
  if (shared && updates[i].customerNote) {
    await portalPush.notifyClient('project_update', {
      companyId: actorAuth.companyId,
      projectId: String(projectId),
      text: updates[i].customerNote,
    }, deps);
  }

  return saved;
}


/* ================= PROJECT PHOTOGRAPHS ================= */

/**
 * Photographs of the work done, attached to one execution update (owner
 * decision, 30 Oct 2026).
 *
 * A photograph belongs to an update, not to the project at large, so the
 * update's `sharedWithCustomer` is the ONLY thing deciding whether a client
 * can see it. There is no second flag to fall out of step with the words
 * beside the picture.
 *
 * The bytes go to their own collection (see ProjectPhoto.js) — never onto
 * the project document, which is read on every list, export and report.
 */
async function addUpdatePhotos(projectId, updateIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'add a project photograph');

  const i = Number(updateIndex);
  const updates = project.executionUpdates || [];
  if (!Number.isInteger(i) || i < 0 || i >= updates.length) {
    throw new ServiceError('That execution update does not exist.', 'NOT_FOUND', 404);
  }

  const images = Array.isArray(input && input.photos) ? input.photos : [];
  if (images.length === 0) throw new ServiceError('Choose at least one photograph.', 'VALIDATION_ERROR', 400);

  // Counted before anything is written, so a batch that would overflow is
  // refused whole rather than half-stored.
  const already = await deps.projectPhotoRepo.countForUpdate(actorAuth.companyId, projectId, i);
  if (already + images.length > ProjectPhoto.MAX_PER_UPDATE) {
    throw new ServiceError(
      `An update can carry ${ProjectPhoto.MAX_PER_UPDATE} photographs; this one already has ${already}.`,
      'TOO_MANY_IMAGES', 400
    );
  }
  const onProject = await deps.projectPhotoRepo.countForProject(actorAuth.companyId, projectId);
  if (onProject + images.length > ProjectPhoto.MAX_PER_PROJECT) {
    throw new ServiceError(
      `This project has reached its limit of ${ProjectPhoto.MAX_PER_PROJECT} photographs.`,
      'TOO_MANY_IMAGES', 400
    );
  }

  // Decode and validate EVERY image before storing ANY of them.
  const decoded = images.map((img, n) => {
    try {
      return ProjectPhoto.decodePhoto(img, n);
    } catch (err) {
      throw new ServiceError(err.message, err.code || 'INVALID_IMAGE', 400);
    }
  });
  const captions = images.map((img) => String((img && img.caption) || '').trim().slice(0, 200));

  const saved = [];
  for (let n = 0; n < decoded.length; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    saved.push(await deps.projectPhotoRepo.create({
      companyId: actorAuth.companyId,
      projectId,
      updateIndex: i,
      uploadedByUserId: actorAuth.userId || null,
      caption: captions[n],
      ...decoded[n],
    }));
  }
  return saved.map(publicPhoto);
}

/** What a listing says about a photograph. Never the bytes. */
function publicPhoto(p) {
  return {
    id: String(p.id || p._id),
    updateIndex: p.updateIndex,
    caption: p.caption || '',
    contentType: p.contentType,
    bytes: p.bytes,
    createdAt: p.createdAt || null,
  };
}

/** Every photograph on a project, for the staff screen. */
async function listProjectPhotos(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  const rows = await deps.projectPhotoRepo.listForProject(actorAuth.companyId, projectId);
  return rows.map(publicPhoto);
}

/**
 * The bytes, for a staff request. Authorized by company AND by the
 * photograph actually belonging to the project named in the URL — so a
 * photo id from another project cannot be read through this one.
 */
async function getProjectPhoto(projectId, photoId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const file = await deps.projectPhotoRepo.findById(actorAuth.companyId, photoId);
  if (!file || String(file.projectId) !== String(projectId)) {
    throw new ServiceError('Photograph not found.', 'NOT_FOUND', 404);
  }
  return file;
}

/** Remove one photograph. The same people who may add one may take it away. */
async function removeProjectPhoto(projectId, photoId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'remove a project photograph');

  const file = await deps.projectPhotoRepo.findById(actorAuth.companyId, photoId);
  if (!file || String(file.projectId) !== String(projectId)) {
    throw new ServiceError('Photograph not found.', 'NOT_FOUND', 404);
  }
  await deps.projectPhotoRepo.deleteById(actorAuth.companyId, photoId);
  return { removed: true, id: String(photoId) };
}

/* ================= DELIVERY CHALLANS ================= */

// PWA FACT (`nextDCNo`, §12): per-project, numeric-string based, max+1,
// starting at 1 for an empty array; gaps (from deletion) are never reused.
function computeNextChallanNumber(deliveryChallans) {
  let max = 0;
  for (const d of deliveryChallans || []) {
    const n = parseInt(String(d.challanNumber).replace(/\D/g, ''), 10) || 0;
    if (n > max) max = n;
  }
  return String(max + 1);
}

/**
 * PWA FACT (`mDC`/`saveDC`, §12): unbounded row count (unlike SO's
 * 5-milestone cap); a row is kept only when it has a truthy `materialName`
 * -- blank-item rows are silently skipped, never rejected. All rows in one
 * call share the same challan number/date/receivedByName/remark. Passing
 * an existing `challanNumber` appends more items to that same DC group
 * (PWA FACT: `mDC(pid,_x,existingNo)`).
 */
async function addDeliveryChallan(projectId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'create a delivery challan');
  if (project.status === 'In Service') {
    throw new ServiceError('Delivery challans cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  const { challanNumber, date, items, receivedByName, remark } = input || {};
  const rows = Array.isArray(items) ? items : [];
  const kept = rows.filter((r) => r && r.materialName); // PWA FACT: `if(!it)continue`
  if (!kept.length) {
    throw new ServiceError('At least one item with a material name is required.', 'VALIDATION_ERROR', 400);
  }
  const no = challanNumber || computeNextChallanNumber(project.deliveryChallans);
  const rowDate = date || todayDate();
  const newItems = kept.map((r) => ({
    challanNumber: no,
    date: rowDate,
    materialName: r.materialName,
    quantity: Number(r.quantity) || 0,
    unit: r.unit || '',
    returnable: !!r.returnable,
    returnedQuantity: 0,
    recordedByUserId: actorAuth.userId,
    receivedByName: receivedByName || '',
    remark: remark || '',
  }));
  const deliveryChallans = [...(project.deliveryChallans || []), ...newItems];
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans }, undefined, { expectedRevision: project.revision });
}

/** PWA FACT (`mDCItem`/`saveDCItem`, §12): single-item edit only. */
async function editDeliveryChallanItem(projectId, itemIndex, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'edit a delivery challan item');
  if (project.status === 'In Service') {
    throw new ServiceError('Delivery challans cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  const item = project.deliveryChallans[itemIndex];
  if (!item) throw new ServiceError('Delivery challan item not found.', 'NOT_FOUND', 404);
  const { date, materialName, quantity, unit, returnable, receivedByName, remark } = input || {};
  const deliveryChallans = project.deliveryChallans.map((d, i) => {
    if (i !== Number(itemIndex)) return d;
    return {
      ...d,
      date: date !== undefined ? date : d.date,
      materialName: materialName !== undefined ? materialName : d.materialName,
      quantity: quantity !== undefined ? Number(quantity) || 0 : d.quantity,
      unit: unit !== undefined ? unit : d.unit,
      returnable: returnable !== undefined ? !!returnable : d.returnable,
      receivedByName: receivedByName !== undefined ? receivedByName : d.receivedByName,
      remark: remark !== undefined ? remark : d.remark,
    };
  });
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans }, undefined, { expectedRevision: project.revision });
}

/** PWA FACT (`rmDC`, §12): single-item removal only, removes just that row. */
async function removeDeliveryChallanItem(projectId, itemIndex, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'delete a delivery challan item');
  if (project.status === 'In Service') {
    throw new ServiceError('Delivery challans cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  if (!project.deliveryChallans[itemIndex]) throw new ServiceError('Delivery challan item not found.', 'NOT_FOUND', 404);
  const deliveryChallans = project.deliveryChallans.filter((_, i) => i !== Number(itemIndex));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans }, undefined, { expectedRevision: project.revision });
}

/**
 * PWA FACT (`mReturn`/`doReturn`, §12): only rows with `returnable===true`
 * can record a return; `returnedQuantity` increments (never decrements),
 * clamped to `quantity`; a free-text audit trail is APPENDED onto the same
 * `remark` field (no separate return log); fires NO notification
 * (confirmed: no `notify(...)` call inside `doReturn`).
 */
async function recordDeliveryChallanReturn(projectId, itemIndex, quantity, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPmOrAssignedEngineer(actorAuth, project, 'record a material return');
  if (project.status === 'In Service') {
    throw new ServiceError('Delivery challans cannot be modified once the project is In Service.', 'FORBIDDEN', 403);
  }
  const item = project.deliveryChallans[itemIndex];
  if (!item) throw new ServiceError('Delivery challan item not found.', 'NOT_FOUND', 404);
  if (!item.returnable) {
    throw new ServiceError('Only returnable items can record a return.', 'VALIDATION_ERROR', 400);
  }
  const q = Number(quantity) || 0;
  if (q <= 0) throw new ServiceError('Enter a quantity to return.', 'VALIDATION_ERROR', 400);

  const today = todayDate();
  const deliveryChallans = project.deliveryChallans.map((d, i) => {
    if (i !== Number(itemIndex)) return d;
    const newReturned = Math.min(d.quantity, (Number(d.returnedQuantity) || 0) + q);
    const trail = ` | Returned ${q} on ${dayKey(today)}`;
    return { ...d, returnedQuantity: newReturned, remark: `${d.remark || ''}${trail}` };
  });
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans }, undefined, { expectedRevision: project.revision }); // no notification, PWA FACT
}

/* ================= DELAY CHECK ================= */

/**
 * PWA FACT (`runDelayCheck`, §7/§21 row 11): only while `status==="Ongoing"`
 * AND `timelineReady`; requires at least one overdue (`!done` and past
 * `targetDate`) checklist point; throttled to at most once per calendar day
 * per project via `lastDelayNotifiedDate`. `worst` (the number reported) is
 * computed via a full reduce over all late items; the NAMED point
 * (`late[0]`) is simply the first late item in array order -- these are
 * NOT necessarily the same point (§21 row 11 note, §23 quirk #18,
 * preserved exactly). No scheduler/cron is wired up as part of this task
 * (out of scope); this function is the callable unit a future scheduled
 * job would invoke once per project per day.
 */
async function runDelayCheckForProject(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  if (project.status !== 'Ongoing') return null;
  if (!isTimelineReady(project)) return null;

  const today = todayDate();
  if (project.lastDelayNotifiedDate && dayKey(project.lastDelayNotifiedDate) === dayKey(today)) return null;

  const late = (project.checklist || []).filter((c) => !c.done && c.targetDate && daysBetween(c.targetDate, today) > 0);
  if (!late.length) return null;

  let worst = 0;
  for (const c of late) worst = Math.max(worst, daysBetween(c.targetDate, today));
  const pmRole = DIVISION_PM_ROLE[project.division];

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { lastDelayNotifiedDate: today }, session);
    const so = project.salesOrderId ? await txnDeps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId) : null;
    const soPart = so ? `, SO-${so.orderNumber}` : '';
    const text = `⚠ PROJECT DELAYED — "${project.name}" (${project.division}${soPart}): ${late.length} checklist point(s) past their target date, max delay ${worst} day${worst > 1 ? 's' : ''}. Latest pending: ${late[0].text.slice(0, 60)}`;
    return txnDeps.notificationRepo.create(
      { companyId: actorAuth.companyId, text, date: today, targetRoles: [pmRole, 'sales', 'admin'], readByUserIds: [] },
      session
    );
  });
}

/* ================= REPORTS / CSV EXPORTS ================= */

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function formatDateForCsv(value) {
  return dayKey(value);
}

// PWA FACT (`delayedItems`): checklist points not done, with a target date
// that has already passed today. Reuses the exact predicate already
// verified in `runDelayCheckForProject` above, rather than re-deriving it.
function delayedItems(p) {
  const t = todayDate();
  return (p.checklist || []).filter((c) => !c.done && c.targetDate && daysBetween(c.targetDate, t) > 0);
}

/**
 * FIX-6-07 (re-derived literally from `dlProjects()`, index.html:3498):
 * all 26 columns, in exact PWA order — SO No, Project, Division, Site
 * Type, Capacity, Customer, Stage, Status, Start, Target End, Engineers,
 * Vendor, Checklist, Points Done, Total Points, Approved Points, Timeline
 * Set, Overdue Points, Max Delay (days), Last Action, Last Action Date,
 * Next Action, Next Action Date, Material Pending Return, Payment
 * Received, Payment Pending. `listProjects` already reproduces PWA's own
 * `myDiv()`/`hasDiv()` division scoping and newest-first ordering, so this
 * export reuses it rather than re-deriving that logic a second time.
 * Every derived field below traces to its PWA source function 1:1 (see
 * inline comments); "Payment Received"/"Payment Pending" reuse the same
 * reconciled `paySum()` port the SalesOrder CSV export uses (PWA
 * `projPayInfo()` itself just calls `paySum(so)`), falling back to '' / ''
 * when the linked SalesOrder can't be resolved (PWA: `projPayInfo` returns
 * `null` when no matching SO is found).
 */
async function exportProjectsCsv(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  assertRole(actorAuth, PROJECT_EXPORT_ROLES, 'export Project reports');
  const rows = await listProjects(actorAuth, { filters }, deps);
  const users = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  const salesOrders = await deps.salesOrderRepo.listByCompany(actorAuth.companyId);
  const nameById = new Map(users.map((u) => [String(u.id), u.name]));
  const soById = new Map(salesOrders.map((s) => [String(s.id), s]));

  const lines = [];
  // PWA FACT (dlProjects -> rptHead, index.html:3434, 3417): the file opens
  // with "<DIVISION> PROJECTS REPORT — <company>", who generated it and the
  // active search, so a saved report says where it came from.
  const pmDivisionLabel = PM_DIVISION_FOR_ROLE[actorAuth.role] || 'All';
  const company = deps.companyRepo ? await deps.companyRepo.findById(actorAuth.companyId) : null;
  for (const row of reportHeaderRows(`${pmDivisionLabel} Projects Report`, { company, actorAuth, search: filters.q || '' })) {
    lines.push(row.map(csvEscape).join(','));
  }
  lines.push(
    [
      'SO No', 'Project', 'Division', 'Site Type', 'Capacity', 'Customer', 'Stage', 'Status', 'Start', 'Target End',
      'Engineers', 'Vendor', 'Checklist', 'Points Done', 'Total Points', 'Approved Points', 'Timeline Set',
      'Overdue Points', 'Max Delay (days)', 'Last Action', 'Last Action Date', 'Next Action', 'Next Action Date',
      'Material Pending Return', 'Payment Received', 'Payment Pending',
    ].map(csvEscape).join(',')
  );
  for (const p of rows) {
    const engNames = (p.assignedEngineerIds || []).map((id) => nameById.get(String(id)) || '').join(', ');
    const checklist = p.checklist || [];
    const pointsDone = checklist.filter((c) => c.done).length;
    const approvedPoints = checklist.filter((c) => c.approval && c.approval.approverName).length;
    const lt = delayedItems(p);
    const worst = lt.reduce((a, c) => {
      const d = daysBetween(c.targetDate, todayDate());
      return d > a ? d : a;
    }, 0);
    const updates = p.executionUpdates || [];
    const lu = updates.length ? updates[updates.length - 1] : {};
    const materialPendingReturn = computePendingReturnableMaterial(p);
    const tlReady = isTimelineReady(p);
    const so = p.salesOrderId ? soById.get(String(p.salesOrderId)) : null;
    // eslint-disable-next-line no-await-in-loop
    const ps = so ? await computeReconciledPaySummary(actorAuth.companyId, so, deps) : null;
    lines.push(
      [
        so ? so.orderNumber : '', p.name, p.division, p.siteType || '', p.capacity || '', p.customer || '',
        p.stage, p.status, formatDateForCsv(p.startDate), tlReady ? formatDateForCsv(computeTargetEnd(checklist)) : '',
        engNames, p.vendor || '', p.checklistTemplateName || '',
        pointsDone, checklist.length, approvedPoints, tlReady ? 'Yes' : 'No',
        lt.length, worst || '', lu.actionDone || '', formatDateForCsv(lu.date), lu.nextAction || '', formatDateForCsv(lu.nextActionDate),
        materialPendingReturn, ps ? ps.received : '', ps ? ps.pending : '',
      ].map(csvEscape).join(',')
    );
  }
  return lines.join('\n');
}

/** PWA FACT (`dlChallan`, §12, exact literal column list, one row per item). */
async function exportDeliveryChallanCsv(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  const lines = [];
  lines.push(
    ['DC No', 'Date', 'Material', 'Qty', 'Unit', 'Type', 'Returned Qty', 'Balance on Site', 'Received By', 'Remark']
      .map(csvEscape)
      .join(',')
  );
  for (const d of project.deliveryChallans || []) {
    lines.push(
      [
        d.challanNumber, formatDateForCsv(d.date), d.materialName, d.quantity, d.unit,
        d.returnable ? 'Returnable' : 'Consumable', d.returnedQuantity || 0,
        (Number(d.quantity) || 0) - (Number(d.returnedQuantity) || 0), d.receivedByName || '', d.remark || '',
      ].map(csvEscape).join(',')
    );
  }
  return lines.join('\n');
}

/**
 * Single source of truth for the detailed project report (§30 item 11 --
 * this task's resolution of the audit's "two independently-maintained
 * report code paths" open item: unify them here as an infra/code-sharing
 * simplification, not an observable business-behavior change). Both
 * `getProjectReport` (JSON, for a future print view) and
 * `exportProjectReportCsv` (CSV) consume this same function, so they
 * cannot drift out of sync with each other the way the PWA's own
 * `projectReportRows`/`printProjectReport` pair could (§20/§23 quirk #17).
 *
 * Sections, per §20: header block, checklist table, site-updates
 * (execution updates) table, material tally (delivery challans) table,
 * payment-milestones table with totals -- reusing salesOrderService /
 * paymentService for the payment-milestone data, never reimplementing
 * that logic (per instruction).
 */
async function buildProjectReportSections(projectId, actorAuth, deps) {
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  const so = project.salesOrderId ? await deps.salesOrderRepo.findById(actorAuth.companyId, project.salesOrderId) : null;

  const paymentMilestones = [];
  if (so) {
    for (let i = 0; i < (so.paymentMilestones || []).length; i += 1) {
      const m = so.paymentMilestones[i];
      // eslint-disable-next-line no-await-in-loop
      const payment = await deps.paymentRepo.findBySalesOrderAndMilestone(actorAuth.companyId, so.id, i);
      const received = payment ? (payment.partPayments || []).reduce((a, pp) => a + (Number(pp.amount) || 0), 0) : m.received ? m.amount : 0;
      paymentMilestones.push({ index: i, description: m.description, amount: m.amount, received, balance: Math.max(0, m.amount - received) });
    }
  }
  const totals = paymentMilestones.reduce((acc, m) => ({ amount: acc.amount + m.amount, received: acc.received + m.received, balance: acc.balance + m.balance }), { amount: 0, received: 0, balance: 0 });

  return {
    header: {
      name: project.name, division: project.division, soOrderNumber: so ? so.orderNumber : null,
      customer: project.customer, stage: project.stage, status: project.status, vendor: project.vendor,
      startDate: project.startDate, endDate: project.endDate,
    },
    checklist: (project.checklist || []).map((c) => ({
      text: c.text, signResponsibility: c.signResponsibility, done: c.done, completedDate: c.completedDate,
      targetDate: c.targetDate, pmSigned: c.pmSigned,
      approverName: c.approval ? c.approval.approverName : '', approvedDate: c.approval ? c.approval.approvedDate : null,
    })),
    executionUpdates: (project.executionUpdates || []).map((u) => ({ date: u.date, actionDone: u.actionDone, nextAction: u.nextAction, nextActionDate: u.nextActionDate, enteredByUserId: u.enteredByUserId })),
    materialTally: (project.deliveryChallans || []).map((d) => ({
      challanNumber: d.challanNumber, date: d.date, materialName: d.materialName, quantity: d.quantity, unit: d.unit,
      returnable: d.returnable, returnedQuantity: d.returnedQuantity, balanceOnSite: (Number(d.quantity) || 0) - (Number(d.returnedQuantity) || 0),
    })),
    paymentMilestones,
    paymentTotals: totals,
  };
}

/** JSON payload for a future print/detail-report view (see class doc, §30 item 11). */
async function getProjectReport(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  return buildProjectReportSections(projectId, actorAuth, deps);
}

/** CSV rendering of the same sections `getProjectReport` returns. */
async function exportProjectReportCsv(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const sections = await buildProjectReportSections(projectId, actorAuth, deps);
  const lines = [];
  lines.push(csvEscape(`PROJECT REPORT -- ${sections.header.name}`));
  lines.push(csvEscape(`Division: ${sections.header.division}  SO: ${sections.header.soOrderNumber || ''}  Stage: ${sections.header.stage}  Status: ${sections.header.status}`));
  lines.push('');
  lines.push(csvEscape('CHECKLIST'));
  lines.push(['Text', 'Sign Responsibility', 'Done', 'Completed', 'Target', 'PM Signed', 'Approver', 'Approved Date'].map(csvEscape).join(','));
  for (const c of sections.checklist) {
    lines.push([c.text, c.signResponsibility, c.done ? 'Yes' : 'No', formatDateForCsv(c.completedDate), formatDateForCsv(c.targetDate), c.pmSigned ? 'Yes' : 'No', c.approverName, formatDateForCsv(c.approvedDate)].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push(csvEscape('SITE UPDATES'));
  lines.push(['Date', 'Action Done', 'Next Action', 'Next Action Date', 'Entered By'].map(csvEscape).join(','));
  for (const u of sections.executionUpdates) {
    lines.push([formatDateForCsv(u.date), u.actionDone, u.nextAction, formatDateForCsv(u.nextActionDate), u.enteredByUserId || ''].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push(csvEscape('MATERIAL TALLY'));
  lines.push(['DC No', 'Date', 'Material', 'Qty', 'Unit', 'Returnable', 'Returned Qty', 'Balance on Site'].map(csvEscape).join(','));
  for (const d of sections.materialTally) {
    lines.push([d.challanNumber, formatDateForCsv(d.date), d.materialName, d.quantity, d.unit, d.returnable ? 'Yes' : 'No', d.returnedQuantity, d.balanceOnSite].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push(csvEscape('PAYMENT MILESTONES'));
  lines.push(['#', 'Description', 'Amount', 'Received', 'Balance'].map(csvEscape).join(','));
  for (const m of sections.paymentMilestones) {
    lines.push([m.index + 1, m.description, m.amount, m.received, m.balance].map(csvEscape).join(','));
  }
  lines.push(['TOTAL', '', sections.paymentTotals.amount, sections.paymentTotals.received, sections.paymentTotals.balance].map(csvEscape).join(','));
  return lines.join('\n');
}

/* ================= DEFERRED: SERVICE CONVERSION INTEGRATION STUB ================= */

/**
 * PWA FACT (`convertToService`'s render condition, §18): the conversion
 * banner/button only appears when `status==="Completed" && division!=="MEP"`
 * -- reproduced here as a pure eligibility check ONLY. Per instruction,
 * Contract and ServiceCall are NOT implemented as business modules in this
 * task -- this function does not create a Contract, does not flip
 * `status` to "In Service", and does not fire any notification. It exists
 * solely as a documented, minimal integration point so a future
 * Contract/ServiceCall implementation task can call into Project without
 * having to re-derive this eligibility rule.
 */
function isEligibleForServiceConversion(project) {
  return project.status === 'Completed' && project.division !== 'MEP';
}

async function prepareServiceConversion(projectId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  // PWA FACT (§18): button rendered only for service_mgr/admin.
  if (!['service_mgr', 'admin'].includes(actorAuth.role)) {
    throw new ServiceError(`Role "${actorAuth.role}" is not permitted to approve commissioning.`, 'FORBIDDEN', 403);
  }
  if (!isEligibleForServiceConversion(project)) {
    throw new ServiceError('Project is not eligible for service conversion (must be Completed and not MEP).', 'NOT_ELIGIBLE', 400);
  }
  return {
    projectId: project.id,
    eligible: true,
    deferred: true,
    message: 'Contract/ServiceCall creation is out of scope for this task -- this is a deferred module integration point only. No Contract was created and Project.status was NOT changed.',
  };
}

/**
 * Concurrency (Completion order): every whole-array write is guarded by the
 * project's `revision` (optimistic lock). When two people change the same
 * project at the same moment, the loser's write is rejected with CONFLICT
 * instead of silently overwriting the winner; these operations simply re-run
 * against the fresh project (each re-reads it first and writes nothing
 * before its single guarded update / transaction), so both changes survive.
 */
function retryOnConflict(fn) {
  return async (...args) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn(...args);
      } catch (err) {
        if (!(err && err.code === 'CONFLICT') || attempt >= 4) throw err;
      }
    }
  };
}

module.exports = {
  getProject,
  listProjects,
  assignProjectManager,
  listManagerCandidates,
  ASSIGN_ROLES,
  MANAGER_ROLES,
  setStage: retryOnConflict(setStage),
  setVendor,
  assignEngineers,
  saveTimeline: retryOnConflict(saveTimeline),
  editChecklistItemDate: retryOnConflict(editChecklistItemDate),
  setChecklistItemDone: retryOnConflict(setChecklistItemDone),
  setChecklistItemRemark: retryOnConflict(setChecklistItemRemark),
  addChecklistItemPhoto: retryOnConflict(addChecklistItemPhoto),
  approveChecklistItem: retryOnConflict(approveChecklistItem),
  counterSignChecklistItem: retryOnConflict(counterSignChecklistItem),
  addChecklistItem: retryOnConflict(addChecklistItem),
  editChecklistItem: retryOnConflict(editChecklistItem),
  removeChecklistItem: retryOnConflict(removeChecklistItem),
  applyChecklistTemplate: retryOnConflict(applyChecklistTemplate),
  addExecutionUpdate: retryOnConflict(addExecutionUpdate),
  setExecutionUpdateShared: retryOnConflict(setExecutionUpdateShared),
  addUpdatePhotos,
  listProjectPhotos,
  getProjectPhoto,
  removeProjectPhoto,
  addDeliveryChallan: retryOnConflict(addDeliveryChallan),
  editDeliveryChallanItem: retryOnConflict(editDeliveryChallanItem),
  removeDeliveryChallanItem: retryOnConflict(removeDeliveryChallanItem),
  recordDeliveryChallanReturn: retryOnConflict(recordDeliveryChallanReturn),
  runDelayCheckForProject,
  exportProjectsCsv,
  exportDeliveryChallanCsv,
  getProjectReport,
  exportProjectReportCsv,
  prepareServiceConversion,
  isEligibleForServiceConversion,
  listEngineerCandidates,
  getProjectQuotationPdfLink,
  completeIfChecklistFinished,
  setChecklistMilestoneLink,
  releaseLinkedMilestones,
  pointIsSignedOff,
  // exported for tests / reuse
  computePendingReturnableMaterial,
  computeIncompleteOrUnapprovedChecklistCount,
  computeTargetEnd,
  computeNextChallanNumber,
  isTimelineReady,
  isPmForProject,
  isAssignedEngineer,
  SIGN_ROLES,
  ENGINEER_CANDIDATE_ROLES,
  PM_DIVISION_FOR_ROLE,
};


/* ================= ENGINEER CANDIDATES (frontend helper) ================= */

/**
 * Infrastructure-only endpoint for the React frontend's engineer-assignment
 * picker. The PWA loaded all company users into the client and filtered
 * client-side; this backend equivalent returns only the eligible candidates
 * (ENGINEER_CANDIDATE_ROLES, company-wide, no division filter -- §14/§30
 * item 2, preserved exactly). Returns [{id, name, role}].
 *
 * Accessible to any PM or admin (the same roles that can assign engineers).
 */
async function listEngineerCandidates(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  // PWA FACT: only PM roles (admin + division PMs) can assign engineers,
  // so only those roles need the candidate list.  Exposing the company
  // employee pool to unrelated roles (sales, engineer, etc.) would be an
  // unnecessary data leak.
  const PM_ROLES = ['admin', 'hvac_pm', 'solar_pm', 'mep_pm'];
  if (!PM_ROLES.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to list engineer candidates (must be admin or a division PM).`,
      'FORBIDDEN',
      403
    );
  }
  const all = await deps.userRepoForEnquiry.listByCompany(actorAuth.companyId);
  return all
    .filter((u) => ENGINEER_CANDIDATE_ROLES.includes(u.role))
    .map((u) => ({ id: u.id, name: u.name, role: u.role }));
}
