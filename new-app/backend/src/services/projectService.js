'use strict';

const { ServiceError } = require('../errors');
const { SIGN_RESPONSIBILITIES, PROJECT_STAGES_BY_DIVISION } = require('../models/shared/enums');
const { DIVISION_PM_ROLE } = require('./salesOrderCascade');
// FIX-6-07: reuse the already-reconciled `paySum()` port (verified against
// PWA `paySum`/`projPayInfo`) instead of re-deriving milestone-vs-Payment
// reconciliation a second time in this file.
const { computeReconciledPaySummary } = require('./salesOrderService');

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
function daysBetween(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return Math.round((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000));
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
  };
}

// PWA FACT (`canPM(p) = U.role==="admin" || PM_DIV[U.role]===p.div`, §15).
function isPmForProject(actorAuth, project) {
  if (actorAuth.role === 'admin') return true;
  return PM_DIVISION_FOR_ROLE[actorAuth.role] === project.division;
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
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'edit this project'} (must be the matching division's PM, or admin).`,
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
  return project;
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
async function listProjects(actorAuth, { filters = {} } = {}, deps) {
  assertCompanyContext(actorAuth);
  const all = await deps.projectRepo.listByCompany(actorAuth.companyId);
  const pmDiv = PM_DIVISION_FOR_ROLE[actorAuth.role];
  const scoped = pmDiv ? all.filter((p) => p.division === pmDiv) : all;

  const q = filters.q ? String(filters.q).toLowerCase() : '';
  if (!q) return [...scoped].reverse();

  const [users, salesOrders] = await Promise.all([
    deps.userRepoForEnquiry.listByCompany(actorAuth.companyId),
    deps.salesOrderRepo.listByCompany(actorAuth.companyId),
  ]);
  const nameById = new Map(users.map((u) => [String(u.id), u.name]));
  const soOrderNumberById = new Map(salesOrders.map((s) => [String(s.id), s.orderNumber]));

  const filtered = scoped.filter((p) => {
    const engNames = (p.assignedEngineerIds || []).map((id) => nameById.get(String(id)) || '').join(' ');
    return projectMatchesQuery(p, soOrderNumberById.get(String(p.salesOrderId)), engNames, q);
  });
  return filtered.reverse();
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
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, patch, session);
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
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, patch, session);
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
async function editChecklistItemDate(projectId, itemIndex, targetDate, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const project = await deps.projectRepo.findById(actorAuth.companyId, projectId);
  if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
  assertIsPM(actorAuth, project, 'edit a checklist point\'s target date');
  const item = project.checklist[itemIndex];
  if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);

  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, targetDate: targetDate || null } : c));
  const endDate = computeTargetEnd(checklist) || project.endDate;
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist, endDate });
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

  return deps.withTransaction(deps, async (txnDeps) => {
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
    const project = await txnDeps.projectRepo.findById(actorAuth.companyId, projectId);
    if (!project) throw new ServiceError('Project not found.', 'NOT_FOUND', 404);
    const item = project.checklist[itemIndex];
    if (!item) throw new ServiceError('Checklist item not found.', 'NOT_FOUND', 404);
    const checklist = project.checklist.map((c, i) => {
      if (i !== Number(itemIndex)) return c;
      return done
        ? { ...c, done: true, completedDate: today }
        : { ...c, done: false, completedDate: null, approval: null, pmSigned: false }; // PWA QUIRK, preserved
    });
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, session);
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    const updated = await txnDeps.projectRepo.update(actorAuth.companyId, projectId, { checklist }, session);
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
  const checklist = project.checklist.map((c, i) => (i === Number(itemIndex) ? { ...c, pmSigned: true } : c));
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { checklist });
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

  const freshItems = template.items.map((t) => freshChecklistItem(t));
  const patch =
    mode === 'replace'
      ? { checklist: freshItems, checklistTemplateName: template.name }
      : { checklist: [...project.checklist, ...freshItems] };
  return deps.projectRepo.update(actorAuth.companyId, projectId, patch);
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
  const { actionDone, nextAction, nextActionDate } = input || {};
  if (!actionDone) {
    throw new ServiceError('Action Done is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("up_done")){toast(...)}`
  }
  const update = {
    date: todayDate(),
    actionDone,
    nextAction: nextAction || '',
    nextActionDate: nextActionDate || null,
    enteredByUserId: actorAuth.userId,
  };
  const executionUpdates = [...(project.executionUpdates || []), update];
  return deps.projectRepo.update(actorAuth.companyId, projectId, { executionUpdates });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans });
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
  return deps.projectRepo.update(actorAuth.companyId, projectId, { deliveryChallans }); // no notification, PWA FACT
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
  lines.push(csvEscape('PROJECT LIST'));
  lines.push('');
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

module.exports = {
  getProject,
  listProjects,
  setStage,
  setVendor,
  assignEngineers,
  saveTimeline,
  editChecklistItemDate,
  setChecklistItemDone,
  setChecklistItemRemark,
  addChecklistItemPhoto,
  approveChecklistItem,
  counterSignChecklistItem,
  addChecklistItem,
  editChecklistItem,
  removeChecklistItem,
  applyChecklistTemplate,
  addExecutionUpdate,
  addDeliveryChallan,
  editDeliveryChallanItem,
  removeDeliveryChallanItem,
  recordDeliveryChallanReturn,
  runDelayCheckForProject,
  exportProjectsCsv,
  exportDeliveryChallanCsv,
  getProjectReport,
  exportProjectReportCsv,
  prepareServiceConversion,
  isEligibleForServiceConversion,
  listEngineerCandidates,
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
