'use strict';

const { ServiceError } = require('../errors');
const { DIVISIONS, SIGN_RESPONSIBILITIES } = require('../models/shared/enums');
const { PM_DIVISION_FOR_ROLE } = require('./projectService');

/**
 * Checklist Template Library (FIX-3.3-01).
 *
 * Source of truth: MEP_PROJECTS_PWA/index.html "CHECKLIST LIBRARY" section
 * (`chkLists`, `defaultChkList`, `chkListById`, `canEditChk`, `vChecklists`,
 * `mNewChkList`/`createChkList`, `dupChkList`, `setDefChkList`,
 * `delChkList`, `vChklist`, `mRenameChkList`/`doRenameChkList`,
 * `mChkPoint`/`saveChkPoint`, `rmChkPoint`, `moveChkPoint` -- lines
 * ~2744-2868). This is a distinct feature from `applyChecklistTemplate`
 * in projectService.js (which reads a template to seed/replace a
 * *project's own* checklist and is unaffected by this module).
 *
 * PWA QUIRK, preserved exactly: `canEditChk()` is
 * `U.role==="admin"||U.role in PM_DIV` -- ANY division-PM role (hvac_pm,
 * solar_pm, mep_pm) may create/edit/delete/duplicate/set-default a
 * checklist template in ANY division, not just their own. There is no
 * per-division match check on the edit gate in the PWA source. Viewing
 * (list/detail) is open to every authenticated company user; the PWA's
 * `vChecklists()` scopes the divisions *shown by default* to
 * `myDiv()` for a division-PM (their own division only) and to all
 * company divisions otherwise (admin, or any other role, since
 * `myDiv()` is `null` for non-PM/non-admin roles and `chkLists(div)`
 * treats a falsy `div` as "no filter" -- `!div||c.div===div`).
 */

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

// PWA FACT (`canEditChk`). See module comment for the "any PM role, any
// division" quirk.
function canEditChecklistLibrary(actorAuth) {
  return actorAuth.role === 'admin' || Boolean(PM_DIVISION_FOR_ROLE[actorAuth.role]);
}

function assertCanEditChecklistLibrary(actorAuth, actionDescription) {
  if (!canEditChecklistLibrary(actorAuth)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription || 'edit the checklist library'} (must be admin or a division PM).`,
      'FORBIDDEN',
      403
    );
  }
}

function validateDivision(division) {
  if (!DIVISIONS.includes(division)) {
    throw new ServiceError(`'${division}' is not a valid division.`, 'VALIDATION_ERROR', 400);
  }
}

function validateSign(sign) {
  if (!SIGN_RESPONSIBILITIES.includes(sign)) {
    throw new ServiceError(`'${sign}' is not a valid sign/approval responsibility.`, 'VALIDATION_ERROR', 400);
  }
}

async function resolveActorName(actorAuth, deps) {
  if (actorAuth.name) return actorAuth.name;
  if (deps.userRepoForEnquiry) {
    const actorUser = await deps.userRepoForEnquiry.findById(actorAuth.userId);
    return actorUser ? actorUser.name : '';
  }
  return '';
}

/**
 * PWA FACT (`vChecklists`): a division-PM only ever sees their own
 * division's templates (`myDiv()`); every other role (admin included, and
 * any non-PM role via the `myDiv()===null` quirk) sees all divisions,
 * or one division if explicitly filtered.
 */
async function listTemplates(actorAuth, filters, deps) {
  assertCompanyContext(actorAuth);
  const pmDivision = PM_DIVISION_FOR_ROLE[actorAuth.role];
  const requestedDivision = filters && filters.division;
  if (pmDivision) {
    return deps.checklistTemplateRepo.listByDivision(actorAuth.companyId, pmDivision);
  }
  if (requestedDivision) {
    validateDivision(requestedDivision);
    return deps.checklistTemplateRepo.listByDivision(actorAuth.companyId, requestedDivision);
  }
  return deps.checklistTemplateRepo.listByCompany(actorAuth.companyId);
}

// PWA FACT (`vChklist`/`chkListById`): no extra role/division restriction on
// viewing a single template's detail -- consistent with the same
// "detail view has no extra restriction" convention already locked for
// Project.getProject.
async function getTemplate(templateId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  return template;
}

/**
 * PWA FACT (`createChkList`): name required; optional "start from" source
 * template (items copied by value, sign carried, nothing else); if marked
 * default, every other template in that division has its default flag
 * cleared first (mirrors `chkLists(dv).forEach(c=>c.def=false)`).
 */
async function createTemplate(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'create a checklist template');
  const { division, name, sourceTemplateId, isDefault } = input || {};
  validateDivision(division);
  if (!name || !String(name).trim()) {
    throw new ServiceError('Enter checklist name.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("nl_n")){toast("Enter checklist name")}`
  }

  let items = [];
  if (sourceTemplateId) {
    const source = await deps.checklistTemplateRepo.findById(actorAuth.companyId, sourceTemplateId);
    if (source) items = source.items.map((i) => ({ text: i.text, signResponsibility: i.signResponsibility }));
  }

  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    if (isDefault) {
      await txnDeps.checklistTemplateRepo.unsetDefaultsForDivision(actorAuth.companyId, division, session);
    }
    const actorName = await resolveActorName(actorAuth, deps);
    return txnDeps.checklistTemplateRepo.create(
      {
        companyId: actorAuth.companyId,
        division,
        name,
        items,
        isDefault: !!isDefault,
        createdByUserId: actorAuth.userId,
        createdDate: new Date(),
      },
      session
    );
  });
}

/**
 * PWA FACT (`dupChkList`): name+" (copy)"; items copied by value; the
 * duplicate is NEVER marked default (`def:false`); `by`/`date` reset to the
 * acting user/today; no notification (Checklist Library has zero notify()
 * call sites, preserved).
 */
async function duplicateTemplate(templateId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'duplicate a checklist template');
  const source = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!source) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  const actorName = await resolveActorName(actorAuth, deps);
  return deps.checklistTemplateRepo.create({
    companyId: actorAuth.companyId,
    division: source.division,
    name: `${source.name} (copy)`,
    items: source.items.map((i) => ({ text: i.text, signResponsibility: i.signResponsibility })),
    isDefault: false,
    createdByUserId: actorAuth.userId,
    createdDate: new Date(),
  });
}

// PWA FACT (`doRenameChkList`): name required.
async function renameTemplate(templateId, name, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'rename a checklist template');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  if (!name || !String(name).trim()) {
    throw new ServiceError('Enter name.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("rn_n")){toast("Enter name")}`
  }
  return deps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { name });
}

/**
 * PWA FACT (`setDefChkList`): unsets every other template's default flag in
 * the SAME division, then sets this one. One-default-per-division is thus
 * enforced by this always-unset-then-set sequence (never reachable with
 * multiple defaults through this code path).
 */
async function setDefaultTemplate(templateId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'set a checklist template as default');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  return deps.withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    await txnDeps.checklistTemplateRepo.unsetDefaultsForDivision(actorAuth.companyId, template.division, session);
    return txnDeps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { isDefault: true }, session);
  });
}

/**
 * PWA FACT (`delChkList`): a minimum of 1 template per division is
 * enforced (`if(chkLists(c.div).length<2){toast("Keep at least one
 * checklist per division");return}` -- i.e. delete is refused when the
 * division would be left with zero). Deleting a template never touches
 * any Project/SalesOrder that already copied its items by value (PWA FACT,
 * confirmed by `delChkList`'s own comment: "Existing projects keep their
 * own copy" -- and by there being no back-reference from a template to any
 * project). If the deleted template was the division default, no other
 * template is auto-promoted to default (PWA FACT: `delChkList` never
 * touches `def` on the remaining templates -- `defaultChkList`'s own
 * fallback, `l.filter(def)[0]||l[0]`, simply picks the first remaining
 * template until an admin/PM explicitly sets a new default).
 */
async function deleteTemplate(templateId, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'delete a checklist template');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  const countInDivision = await deps.checklistTemplateRepo.countByDivision(actorAuth.companyId, template.division);
  if (countInDivision < 2) {
    throw new ServiceError('Keep at least one checklist per division.', 'MIN_ONE_PER_DIVISION', 409);
  }
  await deps.checklistTemplateRepo.deleteById(actorAuth.companyId, templateId);
  return { deleted: true };
}

// PWA FACT (`saveChkPoint`, add branch: `i<0`): text required; sign one of
// the fixed 4 values.
async function addTemplateItem(templateId, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'add a checklist template point');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  const { text, signResponsibility } = input || {};
  if (!text || !String(text).trim()) {
    throw new ServiceError('Enter description.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("cp_t")){toast("Enter description")}`
  }
  validateSign(signResponsibility);
  const items = [...template.items, { text, signResponsibility }];
  return deps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { items });
}

// PWA FACT (`saveChkPoint`, edit branch: `i>=0`).
async function editTemplateItem(templateId, index, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'edit a checklist template point');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  if (index < 0 || index >= template.items.length) {
    throw new ServiceError('Checklist point not found.', 'NOT_FOUND', 404);
  }
  const { text, signResponsibility } = input || {};
  if (!text || !String(text).trim()) {
    throw new ServiceError('Enter description.', 'VALIDATION_ERROR', 400);
  }
  validateSign(signResponsibility);
  const items = template.items.map((it, i) => (i === index ? { text, signResponsibility } : it));
  return deps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { items });
}

// PWA FACT (`rmChkPoint`): unconditional splice (the PWA gates this only
// with a client-side confirm(), which carries no server obligation, same
// convention as the rest of this task's "confirm() is UI-only" precedent).
async function removeTemplateItem(templateId, index, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'remove a checklist template point');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  if (index < 0 || index >= template.items.length) {
    throw new ServiceError('Checklist point not found.', 'NOT_FOUND', 404);
  }
  const items = template.items.filter((_, i) => i !== index);
  return deps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { items });
}

/**
 * PWA FACT (`moveChkPoint(id,i,d)`): a plain adjacent swap between index
 * `i` and `i+direction` (direction is -1 or 1); out-of-range moves are a
 * silent no-op (`if(j<0||j>=c.items.length)return`) -- NOT alphabetical or
 * any other reordering rule.
 */
async function moveTemplateItem(templateId, index, direction, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertCanEditChecklistLibrary(actorAuth, 'reorder a checklist template point');
  const template = await deps.checklistTemplateRepo.findById(actorAuth.companyId, templateId);
  if (!template) throw new ServiceError('Checklist template not found.', 'NOT_FOUND', 404);
  const d = Number(direction);
  const j = index + d;
  if (j < 0 || j >= template.items.length) {
    return template; // PWA FACT: silent no-op out of range
  }
  const items = template.items.slice();
  const tmp = items[index];
  items[index] = items[j];
  items[j] = tmp;
  return deps.checklistTemplateRepo.updateFields(actorAuth.companyId, templateId, { items });
}

module.exports = {
  canEditChecklistLibrary,
  listTemplates,
  getTemplate,
  createTemplate,
  duplicateTemplate,
  renameTemplate,
  setDefaultTemplate,
  deleteTemplate,
  addTemplateItem,
  editTemplateItem,
  removeTemplateItem,
  moveTemplateItem,
};
