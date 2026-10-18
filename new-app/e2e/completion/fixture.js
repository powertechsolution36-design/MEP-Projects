'use strict';

/**
 * Browser-acceptance fixture — realistic business data for one demo company.
 *
 * The dev server's own seed creates only the company and one user per role,
 * so every list screen renders empty and proves nothing. This fixture adds
 * the rows the acceptance run needs to assert real behaviour: a lost
 * enquiry with follow-up history, a sales order with milestones and costing,
 * a project with a checklist, a timeline, execution updates and two
 * delivery challans, and payments in three states (pending, part-paid and
 * raised to finance, fully settled).
 *
 * Isolated test data only — this runs against the in-memory dev
 * repositories, never a database.
 */

const CO = 'company_demo';
const ADMIN = 'seed_user_1';
const SALES = 'seed_user_2';
const ENGINEER = 'seed_user_6'; // Vinod — the engineer the project is assigned to

function d(s) {
  return new Date(`${s}T00:00:00Z`);
}

function seedBusinessData(deps) {
  const s = deps.store.state;

  /* ---- Enquiries: one open, one won, two lost (for the Lost screen) ---- */
  s.enquiries.push(
    {
      id: 'enq_open', companyId: CO, name: 'Sai Residency — 12 TR VRF', segment: 'HVAC', siteType: 'Residential',
      capacity: '12 TR', phone: '9820011223', referenceSource: 'Referral', rating: 4, estimatedValue: 850000,
      status: 'Open', lastReviewDate: d('2026-09-10'), lastActionDone: 'Site visit done',
      nextActionDescription: 'Send revised quotation', nextActionDate: d('2026-10-02'),
      remark: 'Client comparing two vendors', followUpLog: [],
    },
    {
      id: 'enq_won', companyId: CO, name: 'Poonawalla Group — Intervalve plant', segment: 'MEP', siteType: 'Factory',
      capacity: '—', phone: '9422011234', referenceSource: 'Existing client', rating: 5, estimatedValue: 2739492,
      status: 'Won', lastReviewDate: d('2026-08-01'), lastActionDone: 'Order received',
      nextActionDescription: '', nextActionDate: null, remark: '', followUpLog: [],
    },
    {
      id: 'enq_lost1', companyId: CO, name: 'Green Valley Banquet — chiller', segment: 'HVAC', siteType: 'Banquet Hall',
      capacity: '60 TR', phone: '9800000011', referenceSource: 'Website', rating: 3, estimatedValue: 1850000,
      status: 'Lost', lostReason: 'Price — competitor 12% lower', lostDate: d('2026-09-20'),
      lastReviewDate: d('2026-09-01'), lastActionDone: 'Final negotiation call',
      nextActionDescription: 'Revisit next season', nextActionDate: d('2026-12-01'),
      remark: 'Keep warm for next year', followUpLog: [],
    },
    {
      id: 'enq_lost2', companyId: CO, name: 'Nashik Textiles — 300 kW rooftop', segment: 'Solar', siteType: 'Factory',
      capacity: '300 kW', phone: '9422077889', referenceSource: 'MSEDCL empanelment', rating: 2, estimatedValue: 12500000,
      status: 'Lost', lostReason: 'Project deferred by client board', lostDate: d('2026-07-15'),
      lastReviewDate: d('2026-07-01'), lastActionDone: 'Technical presentation',
      nextActionDescription: '', nextActionDate: null, remark: '', followUpLog: [],
    }
  );

  /* ---- Sales order with costing and milestones ---- */
  s.salesOrders.push({
    id: 'so_demo', companyId: CO, orderNumber: 1001, division: 'HVAC', projectName: 'Poonawalla KP87 — AHU replacement',
    siteAddress: 'Undri, Pune', startDate: d('2026-02-01'), endDate: d('2026-06-30'),
    salesTeamUserId: SALES, projectTeam: 'Vinod', customerContacts: [{ name: 'Mr. Shah', designation: 'Owner', phone: '9820011223', email: '' }],
    totalCost: 1366200, highSideSelling: 810000, highSidePurchase: 600000,
    lowSideCost: 556200, lowSideTargetExpense: 361530, lowSideActualExpense: 0,
    termsAndConditions: '1) Fabrication not in our scope.',
    paymentMilestones: [
      { description: 'Advance 30%', amount: 409860, received: true },
      { description: 'On delivery 50%', amount: 683100, received: false },
      { description: 'After commissioning 20%', amount: 273240, received: false },
    ],
  });

  /* ---- Project: checklist, timeline, updates, two delivery challans ---- */
  s.projects.push({
    id: 'prj_demo', companyId: CO, salesOrderId: 'so_demo', division: 'HVAC',
    name: 'Poonawalla KP87 — AHU replacement', siteType: 'Factory', capacity: '40 TR', customer: 'Intervalve Poonawalla',
    stage: 'Installation', status: 'Ongoing', startDate: d('2026-02-01'), vendor: 'CoolTech Fabricators',
    assignedEngineerIds: [ENGINEER], timelineSet: true, checklistTemplateName: 'HVAC Installation — standard',
    revision: 0,
    checklist: [
      { text: 'Material at site', signResponsibility: 'ENGINEER', done: true, completedDate: d('2026-02-20'), targetDate: d('2026-02-18'), approval: { approverName: 'Amol', approvedDate: d('2026-02-21') }, photos: [] },
      { text: 'Ducting erection', signResponsibility: 'ENGINEER', done: true, completedDate: d('2026-03-15'), targetDate: d('2026-03-10'), approval: null, photos: [] },
      { text: 'AHU installation', signResponsibility: 'ENGINEER', done: false, targetDate: d('2026-04-05'), approval: null, photos: [] },
      { text: 'Testing and commissioning', signResponsibility: 'CLIENT', done: false, targetDate: d('2026-05-20'), approval: null, photos: [] },
    ],
    executionUpdates: [
      { date: d('2026-03-16'), workDone: 'Ducting 80% complete', nextAction: 'Start AHU positioning', nextActionDate: d('2026-03-25'), recordedByUserId: ENGINEER },
    ],
    // Two challans: DC 1 (mixed, part-returned) and DC 2 (consumables only)
    deliveryChallans: [
      { challanNumber: '1', date: d('2026-02-15'), materialName: 'GI duct sheet 24g', quantity: 120, unit: 'Kg', returnable: false, returnedQuantity: 0, receivedByName: 'Site supervisor Ramesh', remark: 'First lot' },
      { challanNumber: '1', date: d('2026-02-15'), materialName: 'Scaffolding set', quantity: 4, unit: 'Set', returnable: true, returnedQuantity: 1, receivedByName: 'Site supervisor Ramesh', remark: 'First lot' },
      { challanNumber: '2', date: d('2026-03-05'), materialName: 'Insulation roll 19mm', quantity: 8, unit: 'Roll', returnable: false, returnedQuantity: 0, receivedByName: 'Ramesh', remark: '' },
    ],
  });

  /* ---- Payments: raised + part paid, plain pending, fully settled ---- */
  s.payments.push(
    {
      id: 'pay_raised', companyId: CO, salesOrderId: 'so_demo', milestoneIndex: 1,
      projectOrReference: 'Poonawalla KP87 — AHU replacement', personName: 'Mr. Shah', phone: '9820011223',
      amount: 683100, status: 'Pending', remark: 'On delivery 50%',
      lastCallDate: d('2026-09-28'), discussionNotes: 'Accounts to release after invoice check', nextCallDate: d('2026-10-01'),
      partPayments: [
        { id: 'pp_1', amount: 200000, date: d('2026-09-15'), mode: 'Bank Transfer/NEFT', reference: 'NEFT0099', invoiceIssued: true, remark: 'part release', recordedByUserId: ADMIN },
      ],
      raisedToFinance: { raisedByUserId: 'seed_user_3', raisedByRole: 'hvac_pm', raisedDate: d('2026-09-25'), collectByDate: d('2026-10-05'), priority: 'Urgent', note: 'Material lot 2 blocked on this' },
    },
    {
      id: 'pay_plain', companyId: CO, salesOrderId: 'so_demo', milestoneIndex: 2,
      projectOrReference: 'Poonawalla KP87 — AHU replacement', personName: 'Mr. Shah', phone: '9820011223',
      amount: 273240, status: 'Pending', remark: 'After commissioning 20%',
      lastCallDate: null, discussionNotes: '', nextCallDate: null, partPayments: [],
    },
    {
      id: 'pay_settled', companyId: CO, salesOrderId: 'so_demo', milestoneIndex: 0,
      projectOrReference: 'Poonawalla KP87 — AHU replacement', personName: 'Mr. Shah', phone: '9820011223',
      amount: 409860, status: 'Received', remark: 'Advance 30%', receivedDate: d('2026-02-10'),
      partPayments: [
        { id: 'pp_2', amount: 209860, date: d('2026-02-05'), mode: 'Cheque', reference: 'CHQ11', invoiceIssued: true, remark: '', recordedByUserId: ADMIN },
        { id: 'pp_3', amount: 200000, date: d('2026-02-10'), mode: 'UPI', reference: 'UPI77', invoiceIssued: false, remark: 'balance', recordedByUserId: 'seed_user_10' },
      ],
      lastCallDate: null, discussionNotes: '', nextCallDate: null,
    }
  );

  /* ---- AMC contract + a service call, so those screens are not empty ---- */
  s.contracts.push({
    id: 'amc_demo', companyId: CO, customer: 'Intervalve Poonawalla', phone: '9422011234', site: 'KP87 plant, Pune',
    capacity: '40 TR', category: 'AMC', amcType: 'Quarterly', maintenanceCoverage: 'comprehensive',
    startDate: d('2026-04-01'), endDate: d('2027-03-31'), amount: 150000, visitsPerYear: 4, scheduledVisits: [],
  });
  s.serviceCalls.push({
    id: 'svc_demo', companyId: CO, complaintNumber: 1, type: 'Complaint', customer: 'Intervalve Poonawalla',
    phone: '9422011234', site: 'KP87 plant, Pune', status: 'Assigned', engineerId: ENGINEER,
    registeredDate: d('2026-09-30'), appointmentDate: d('2026-10-02'), complaintDescription: 'AHU 2 vibration',
    checklistItems: [], serviceType: '',
  });

  return { CO, ADMIN, SALES, ENGINEER };
}

module.exports = { seedBusinessData };
