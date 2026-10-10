'use strict';

// Tests for the 5 PWA-coverage-audit corrections applied to the NEW APP
// documentation/schema layer only. Scope: stage enum (division-aware),
// checklist approval field split, and the InventoryIssue "Returned" bug
// documentation. No workflow/service/route/controller behavior is tested
// here because none was implemented as part of this task.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const { SalesOrder, Project, InventoryIssue } = require('../src/models');
const { PROJECT_STAGES_BY_DIVISION } = require('../src/models/shared/enums');

const oid = () => new Types.ObjectId();

function baseProjectAttrs(overrides = {}) {
  return {
    companyId: oid(),
    salesOrderId: oid(),
    division: 'HVAC',
    name: 'Test Project',
    stage: 'Planning',
    startDate: new Date(),
    ...overrides,
  };
}

// Correction 1: Project stage enum is division-aware, not a flattened enum.

test('audit-correction: PROJECT_STAGES_BY_DIVISION has the exact 3 verified per-division lists', () => {
  assert.deepEqual(PROJECT_STAGES_BY_DIVISION.HVAC, [
    'Planning', 'Piping', 'Installation', 'Testing', 'Finishing', 'Completed',
  ]);
  assert.deepEqual(PROJECT_STAGES_BY_DIVISION.Solar, [
    'Planning', 'Fabrication', 'Installation', 'Wiring', 'Net Metering', 'Completed',
  ]);
  assert.deepEqual(PROJECT_STAGES_BY_DIVISION.MEP, [
    'Concept', 'Design In Progress', 'Internal Review', 'Client Review', 'Delivered',
  ]);
});

test('audit-correction: Project.stage accepts every valid value for its own division', () => {
  for (const [division, stages] of Object.entries(PROJECT_STAGES_BY_DIVISION)) {
    for (const stage of stages) {
      const p = new Project(baseProjectAttrs({ division, stage }));
      const err = p.validateSync();
      assert.ok(!err, `division=${division} stage=${stage} should validate cleanly, got: ${err}`);
    }
  }
});

test('audit-correction: Project.stage rejects a value valid for a different division', () => {
  // 'Delivered' is valid only for MEP -- must be rejected for HVAC.
  const p = new Project(baseProjectAttrs({ division: 'HVAC', stage: 'Delivered' }));
  const err = p.validateSync();
  assert.ok(err, 'HVAC project with MEP-only stage "Delivered" should fail validation');
  assert.ok(err.errors.stage, 'the stage path specifically should carry the error');
});

test('audit-correction: Project.stage rejects an invented value not in any division list', () => {
  const p = new Project(baseProjectAttrs({ division: 'Solar', stage: 'Not A Real Stage' }));
  const err = p.validateSync();
  assert.ok(err, 'an invented stage value should fail validation');
  assert.ok(err.errors.stage);
});

test('audit-correction: MEP terminal stage is "Delivered", distinct from the literal "Completed" completion trigger', () => {
  // Mechanical fact underlying the Completion gate correction: MEP's stage
  // list does not contain the literal string "Completed" at all.
  assert.ok(!PROJECT_STAGES_BY_DIVISION.MEP.includes('Completed'));
  assert.equal(PROJECT_STAGES_BY_DIVISION.MEP[PROJECT_STAGES_BY_DIVISION.MEP.length - 1], 'Delivered');
});

// Correction 3: checklist approval field split (approverName free text + enteredByUserId ref).

test('audit-correction: checklist approval supports a free-text approverName (not a User ref)', () => {
  const approvalSub = Project.schema.path('checklist').schema.path('approval').schema;
  const approverName = approvalSub.path('approverName');
  assert.ok(approverName, 'approverName should exist');
  assert.equal(approverName.instance, 'String');
  assert.equal(approverName.options.ref, undefined, 'approverName must not be a ref -- it is free text');
});

test('audit-correction: checklist approval supports a durable enteredByUserId User reference', () => {
  const approvalSub = Project.schema.path('checklist').schema.path('approval').schema;
  const enteredBy = approvalSub.path('enteredByUserId');
  assert.ok(enteredBy, 'enteredByUserId should exist');
  assert.equal(enteredBy.instance, 'ObjectId');
  assert.equal(enteredBy.options.ref, 'User');
});

test('audit-correction: checklist approval accepts a CLIENT-style free-text approver alongside a staff enteredByUserId', () => {
  const p = new Project(baseProjectAttrs({
    checklist: [{
      text: 'Client sign-off',
      signResponsibility: 'CLIENT',
      approval: {
        approverName: 'Mr. Sharma (Client)',
        approvedByRole: 'CLIENT',
        approvedDate: new Date(),
        enteredByUserId: oid(),
      },
    }],
  }));
  const err = p.validateSync();
  assert.ok(!err, `project with CLIENT free-text approver should validate cleanly, got: ${err}`);
});

// Correction 5: InventoryIssue "Returned" bug -- enum unchanged at the time
// of the audit/documentation-only task, no derivation logic added then.
//
// UPDATE (Inventory module implementation): Inventory was subsequently
// authorized and implemented (see OPEN_DECISIONS.md #78/#79 and
// INVENTORY_DECISION_LOCK.md section 24). Decision-lock Corrections 1 and 2
// fixed two real defects found in the PWA-matching design at that time:
// (1) the "Returned" status IS reachable server-side (issBal<=0 with
// quantityReturned>0 and quantityUsed===0), matching the PWA; and
// (2) the enum value is spelled 'Returned / Used' (spaced) to exactly match
// the PWA's rendered text, not the unspaced 'Returned/Used' placeholder used
// before implementation. "Returned" itself remains in the enum, unchanged.
test('audit-correction: InventoryIssue.status enum still includes "Returned" (kept through the eventual Inventory implementation)', () => {
  assert.deepEqual(
    [...InventoryIssue.schema.path('status').enumValues].sort(),
    ['Issued', 'Return Requested', 'Partially Returned', 'Returned', 'Returned / Used', 'Consumed'].sort()
  );
});

test('audit-correction: no status-derivation function was introduced on the InventoryIssue model (derivation stays deferred to a future service layer)', () => {
  // The schema should expose no method/static that computes status from
  // quantities -- that logic is explicitly out of scope for this task.
  const methodNames = Object.keys(InventoryIssue.schema.methods || {});
  const staticNames = Object.keys(InventoryIssue.schema.statics || {});
  const suspicious = [...methodNames, ...staticNames].filter((n) => /status/i.test(n));
  assert.deepEqual(suspicious, [], `expected no status-derivation methods/statics, found: ${suspicious.join(', ')}`);
});

// Scope guard: this test originally asserted (at the time of the
// "APPLY THE 5 AUDIT CORRECTIONS" / documentation-only tasks) that no
// business workflow, route, or service code existed beyond the auth/company
// foundation. Enquiry, then SalesOrder/Payment, then Project Execution, then
// Contract (AMC/Warranty -- PWA_COVERAGE_AUDIT_CONTRACT.md /
// CONTRACT_DECISION_LOCK.md), then ServiceCall (Complaint/PM --
// PWA_COVERAGE_AUDIT_SERVICECALL.md / SERVICECALL_DECISION_LOCK.md), then
// Inventory (Stock/Issue/Return/Transfer -- PWA_COVERAGE_AUDIT_INVENTORY.md /
// INVENTORY_DECISION_LOCK.md) were each subsequently authorized and
// implemented as their own tasks -- this guard is updated to the new,
// explicitly-authorized scope each time rather than removed, so it still
// catches any UNAUTHORIZED module being added by mistake.

test('audit-correction scope guard: only the auth/company foundation plus the authorized Enquiry/SalesOrder/Payment/Project/Contract/ServiceCall/Inventory/ChecklistTemplate/Notification/User modules exist as routes/services', () => {
  const fs = require('fs');
  const path = require('path');
  const routesDir = path.join(__dirname, '..', 'src', 'routes');
  const servicesDir = path.join(__dirname, '..', 'src', 'services');
  const routeFiles = fs.existsSync(routesDir) ? fs.readdirSync(routesDir).sort() : [];
  const serviceFiles = fs.existsSync(servicesDir) ? fs.readdirSync(servicesDir).sort() : [];
  // UPDATE (Pass 3.3 Phase B, FIX-3.3-01 / FIX-B1): the Checklist Template
  // Library (checklistTemplateRoutes.js/checklistTemplateService.js) and
  // Notification list/read (notificationRoutes.js/notificationService.js)
  // modules were authorized and implemented in this task -- see
  // new-app/docs/E2E_PASS_3_3_CHECKLIST_COMPLETION.md.
  // UPDATE (Phase B, FIX-3.8-01, P0): the User Management module
  // (userRoutes.js/userService.js) was authorized and implemented in this
  // task -- see new-app/docs/E2E_PASS_3_8_MASTER_RECONCILIATION.md's
  // FIX-3.8-01 and new-app/docs/API_CONTRACT.md's Users section.
  // UPDATE (Subscription Integration Repair): subscriptionRoutes.js and
  // subscriptionService.js were authorized and wired in the subscription
  // integration repair task.
  assert.deepEqual(routeFiles, [
    'authRoutes.js', 'checklistTemplateRoutes.js', 'companyRoutes.js', 'contractRoutes.js', 'enquiryRoutes.js',
    'inventoryRoutes.js', 'notificationRoutes.js', 'paymentRoutes.js',
    'projectRoutes.js', 'salesOrderRoutes.js', 'serviceCallRoutes.js', 'subscriptionRoutes.js', 'userRoutes.js',
  ]);
  assert.deepEqual(serviceFiles, [
    'checklistTemplateService.js',
    'companyService.js',
    'contractService.js',
    'enquiryService.js',
    'inventoryService.js',
    'notificationService.js',
    'paymentService.js',
    'projectService.js',
    'salesOrderCascade.js',
    'salesOrderService.js',
    'serviceCallService.js',
    'subscriptionService.js',
    'userService.js',
  ]);
});
