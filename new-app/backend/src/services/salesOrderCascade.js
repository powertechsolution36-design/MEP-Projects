'use strict';

const { ServiceError } = require('../errors');
const { PROJECT_STAGES_BY_DIVISION } = require('../models/shared/enums');
const { LEGACY_CHECKLIST_FALLBACK } = require('../models/shared/legacyChecklists');

/**
 * Shared SalesOrder creation cascade — the exact PWA `saveSO` behavior that
 * is IDENTICAL regardless of which of the PWA's two creation paths is used
 * (Enquiry conversion, verified in PWA_COVERAGE_AUDIT_ENQUIRY.md §7 and
 * re-verified independently in PWA_COVERAGE_AUDIT_SALESORDER.md §5; or the
 * standalone "+ New SO" path, PWA_COVERAGE_AUDIT_SALESORDER.md §4).
 *
 * Factored out of src/services/enquiryService.js (which used to inline this
 * logic) so src/services/salesOrderService.js's standalone-create path
 * cannot drift from the already-verified conversion path — both call this
 * same module. This is an integration change required by the SalesOrder
 * implementation, not a redesign of the Enquiry module's own business rules
 * (createEnquiry/editEnquiry/addFollowUp/markLost/reopenEnquiry and the
 * Won/duplicate-conversion guard logic all remain in enquiryService.js,
 * untouched).
 *
 * LOCKED PRINCIPLE (this task): every PWA-demonstrated functional behavior
 * is reproduced exactly, including quirks — see PWA_COVERAGE_AUDIT_SALESORDER.md.
 */

// PWA FACT (verified: saveSO's fixed `terms` default when creating a fresh SO).
const DEFAULT_TERMS_AND_CONDITIONS =
  '1) Fabrication not in our scope. 2) Civil and interior work not in our scope. 3) Mathadi not in our scope.';

// PWA FACT (DOMAIN_MODEL.md / roleDivision.js ROLE_DIVISION_MAP, inverted):
// which PM role a division's SO-creation notification targets.
const DIVISION_PM_ROLE = Object.freeze({ HVAC: 'hvac_pm', Solar: 'solar_pm', MEP: 'mep_pm' });

function todayDate() {
  return new Date();
}

/**
 * Builds the SalesOrder draft PWA `mSO(0, enqId)` / `mSO()` would produce.
 * `enquiry` is the source Enquiry object for a conversion, or `null` for a
 * standalone "+ New SO" (PWA FACT: `mSO()` with no args — `e=null` in the
 * PWA's own `var e=enqId?DB.enquiries.find(...):null`).
 */
function buildSalesOrderDraft(enquiry, soOverrides, actorUserName) {
  const overrides = soOverrides || {};
  const division = enquiry
    ? enquiry.segment === 'AMC'
      ? 'HVAC' // PWA FACT, verified transform
      : enquiry.segment
    : undefined;

  const contactsInput = Array.isArray(overrides.contacts) ? overrides.contacts : [];
  const contact0 = contactsInput[0] || {};
  const contact1 = contactsInput[1] || {};

  const contacts = [
    {
      name: contact0.name || '',
      designation: contact0.designation || '',
      // PWA FACT: e.phone copied unless overridden — only applies to a
      // conversion; a standalone SO has no Enquiry phone to copy.
      phone: contact0.phone !== undefined ? contact0.phone : (enquiry && enquiry.phone) || '',
      email: contact0.email || '',
    },
    {
      name: contact1.name || '',
      designation: contact1.designation || '',
      phone: contact1.phone || '',
      email: contact1.email || '',
    },
  ];

  return {
    division: overrides.division || division,
    projectName: overrides.projectName || (enquiry && enquiry.name), // PWA FACT: e.name copied unless overridden
    startDate: overrides.startDate || todayDate(), // PWA FACT: today() default
    endDate: overrides.endDate || undefined,
    siteAddress: overrides.siteAddress || '',
    contacts,
    salesTeam: overrides.salesTeam || actorUserName || '', // PWA FACT: U.name default
    projectTeam: overrides.projectTeam || '',
    crucialPoints: overrides.crucialPoints || '',
    // PWA FACT: e.value copied unless overridden — only applies to a conversion.
    totalCost: overrides.totalCost !== undefined ? overrides.totalCost : (enquiry && enquiry.estimatedValue) || 0,
    highSideSelling: overrides.highSideSelling || 0,
    highSidePurchase: overrides.highSidePurchase || 0,
    lowSideCost: overrides.lowSideCost || 0,
    lowSideTargetExpense: overrides.lowSideTargetExpense || 0,
    lowSideActualExpense: overrides.lowSideActualExpense || 0,
    termsAndConditions: overrides.termsAndConditions || DEFAULT_TERMS_AND_CONDITIONS, // PWA FACT: fixed boilerplate default
    // PWA FACT (`saveSO`'s milestone-collection loop): at most 5 rows, and a
    // row is kept only when BOTH description and amount are present —
    // callers are expected to have already applied that drop rule the same
    // way `saveSO` does (see salesOrderService.js's `collectMilestoneInputs`).
    paymentMilestones: Array.isArray(overrides.paymentMilestones) ? overrides.paymentMilestones : [],
  };
}

function validateSalesOrderDraft(draft) {
  if (!draft.projectName) {
    throw new ServiceError('Project name is required.', 'VALIDATION_ERROR', 400); // PWA FACT: `if(!gv("so_pn")){toast(...)}`
  }
  if (!draft.division) {
    throw new ServiceError('Division is required.', 'VALIDATION_ERROR', 400);
  }
  if (draft.contacts.length > 2 || draft.paymentMilestones.length > 5) {
    // Matches SalesOrder.js's own validators — checked early here for a clearer error.
    throw new ServiceError(
      'A sales order has at most 2 contacts and 5 payment milestones (PWA FACT).',
      'VALIDATION_ERROR',
      400
    );
  }
  for (const m of draft.paymentMilestones) {
    if (!m || !m.description || typeof m.amount !== 'number') {
      throw new ServiceError(
        'Each payment milestone requires a description and a numeric amount.',
        'VALIDATION_ERROR',
        400
      );
    }
  }
}

/**
 * PWA FACT (`defaultChkList(div)` + `saveSO`'s own fallback,
 * PWA_COVERAGE_AUDIT_SALESORDER.md §10): default ChecklistTemplate -> first
 * ChecklistTemplate for the division -> legacy hardcoded fallback -> empty
 * only when none of those exist. Locked decision "Checklist fallback = A":
 * reproduce this whole chain exactly, including the legacy step (which the
 * original Enquiry-only cascade did not yet implement).
 */
async function resolveChecklist(companyId, division, deps) {
  const template = await deps.checklistTemplateRepo.findDefaultForDivision(companyId, division);
  if (template) {
    return {
      checklistTemplateName: template.name,
      checklist: template.items.map((t) => ({
        text: t.text,
        signResponsibility: t.signResponsibility,
        done: false,
        completedDate: null,
        pmSigned: false,
        remark: '',
        photos: [],
        targetDate: null,
        approval: null,
      })),
    };
  }
  const legacy = LEGACY_CHECKLIST_FALLBACK[division];
  if (legacy && legacy.length) {
    return {
      checklistTemplateName: '', // PWA FACT: `chkName:cl?cl.name:""` — the legacy fallback has no template name
      checklist: legacy.map((t) => ({
        text: t.text,
        signResponsibility: t.signResponsibility,
        done: false,
        completedDate: null,
        pmSigned: false,
        remark: '',
        photos: [],
        targetDate: null,
        approval: null,
      })),
    };
  }
  return { checklistTemplateName: '', checklist: [] };
}

/**
 * Runs the shared creation cascade inside the caller's transaction
 * (txnDeps must already carry `session`, i.e. this must be called from
 * inside `deps.withTransaction(deps, async (txnDeps) => { ... })`).
 *
 * Steps (PWA_COVERAGE_AUDIT_SALESORDER.md §5/§9/§10/§11, identical for both
 * creation paths):
 *  1. Create the SalesOrder (enquiryId set only for a conversion — null for
 *     a standalone SO, matching the schema's own `default: null`).
 *  2. Resolve the checklist via the full 3-step fallback chain (locked
 *     decision "Checklist fallback = A").
 *  3. Create exactly one Project (division's first stage; customer from
 *     the SO's own contacts[0], NEVER the Enquiry, even for a conversion —
 *     PWA FACT, independently re-verified in the SalesOrder audit).
 *  4. Create one Payment per milestone (all unreceived on a fresh SO).
 *  5. Create the two verified notifications (exact literal text/roles).
 */
async function runCreationCascade({ draft, orderNumber, companyId, enquiryId, session, deps }) {
  const salesOrder = await deps.salesOrderRepo.create(
    {
      companyId,
      orderNumber,
      enquiryId: enquiryId || null,
      division: draft.division,
      projectName: draft.projectName,
      startDate: draft.startDate,
      endDate: draft.endDate,
      siteAddress: draft.siteAddress,
      contacts: draft.contacts,
      salesTeam: draft.salesTeam,
      projectTeam: draft.projectTeam,
      crucialPoints: draft.crucialPoints,
      totalCost: draft.totalCost,
      highSideSelling: draft.highSideSelling,
      highSidePurchase: draft.highSidePurchase,
      lowSideCost: draft.lowSideCost,
      lowSideTargetExpense: draft.lowSideTargetExpense,
      lowSideActualExpense: draft.lowSideActualExpense,
      termsAndConditions: draft.termsAndConditions,
      paymentMilestones: draft.paymentMilestones.map((m) => ({
        description: m.description,
        amount: m.amount,
        received: false, // PWA FACT: a fresh SO's milestones all start unreceived
      })),
    },
    session
  );

  const { checklistTemplateName, checklist } = await resolveChecklist(companyId, draft.division, deps);
  const stage = PROJECT_STAGES_BY_DIVISION[draft.division][0]; // PWA FACT: `STAGES[so.div][0]`
  const contact0Name = (draft.contacts[0] && draft.contacts[0].name) || ''; // PWA FACT: `(so.contacts[0]||{}).n||""`

  const project = await deps.projectRepo.create(
    {
      companyId,
      salesOrderId: salesOrder.id,
      division: draft.division,
      name: draft.projectName,
      siteType: '', // PWA FACT: left blank, not copied from Enquiry or SO
      capacity: '', // PWA FACT: left blank, not copied from Enquiry or SO
      customer: contact0Name,
      stage,
      startDate: draft.startDate,
      endDate: draft.endDate,
      assignedEngineerIds: [],
      vendor: '',
      status: 'Ongoing',
      checklistTemplateName,
      checklist,
      executionUpdates: [],
      deliveryChallans: [],
      timelineSet: false,
      lastDelayNotifiedDate: null,
    },
    session
  );

  const payments = [];
  for (let i = 0; i < draft.paymentMilestones.length; i += 1) {
    const m = draft.paymentMilestones[i];
    // eslint-disable-next-line no-await-in-loop
    const payment = await deps.paymentRepo.create(
      {
        companyId,
        projectOrReference: draft.projectName, // PWA FACT: `so.project`
        personName: contact0Name, // PWA FACT: `(so.contacts[0]||{}).n||""`
        phone: (draft.contacts[0] && draft.contacts[0].phone) || '', // PWA FACT: `(so.contacts[0]||{}).ph||""`
        amount: m.amount,
        remark: `SO ${orderNumber} milestone ${i + 1}: ${m.description}`, // PWA FACT, verified literal string
        status: 'Pending',
        salesOrderId: salesOrder.id,
        milestoneIndex: i,
        partPayments: [],
        raisedToFinance: null,
        receivedDate: null,
      },
      session
    );
    payments.push(payment);
  }

  const pmRole = DIVISION_PM_ROLE[draft.division];
  const today = todayDate();
  const notifications = [];
  notifications.push(
    await deps.notificationRepo.create(
      {
        companyId,
        text: `New SO-${orderNumber} received from Sales: ${draft.projectName} (${draft.division}). Project created — assign engineer.`,
        date: today,
        targetRoles: [pmRole, 'admin'],
        readByUserIds: [],
      },
      session
    )
  );
  notifications.push(
    await deps.notificationRepo.create(
      {
        companyId,
        text: `New SO-${orderNumber} (${draft.projectName}): payment terms added to pending payment list.`,
        date: today,
        targetRoles: ['finance'],
        readByUserIds: [],
      },
      session
    )
  );

  return { salesOrder, project, payments, notifications };
}

module.exports = {
  DEFAULT_TERMS_AND_CONDITIONS,
  DIVISION_PM_ROLE,
  buildSalesOrderDraft,
  validateSalesOrderDraft,
  resolveChecklist,
  runCreationCascade,
};
