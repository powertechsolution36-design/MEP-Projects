'use strict';

/**
 * Stage 7 — New Feature Tests
 *
 * Tests for: Subscription/Plans, Item Name Library, Quotation,
 * Payment Term Templates, AMC Document Services, Company Profile,
 * and Division Entitlement.
 *
 * All tests use in-memory fake repositories — NO database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { createEnquiryFakeStore } = require('./enquiryFakes');

// Services under test
const {
  listPlans, getPlan, createPlan, seedDefaultPlans,
  getSubscription, createOrUpdateSubscription, getEffectiveDivisions,
} = require('../src/services/subscriptionService');

const {
  normalizeName, upsertItemName, bulkUpsertFromLineItems,
  autocomplete, listItems, deleteItemName,
} = require('../src/services/itemNameService');

const {
  calculateLineTotals, calculateTotals, generateQuotationNumber,
  createQuotation, updateQuotation, getQuotation,
  listQuotations, duplicateQuotation, deleteQuotation, exportQuotationsCsv,
} = require('../src/services/quotationService');

const {
  getDefaultTemplate, getTemplate, saveTemplate, generateAmcDocument, listTemplates,
} = require('../src/services/amcDocumentService');

// ── Helpers ──

function createTestDeps(seed = {}) {
  const store = createEnquiryFakeStore(seed);
  // Wrap companyRepo with missing methods (matching devServer.js pattern)
  const companyRepo = {
    findById: (id) => store.companyRepo.findById(id),
    delete: (id) => store.companyRepo.delete(id),
    async create(data) {
      const c = { id: `company_${Date.now()}`, ...data };
      store.state.companies.push(c);
      return { ...c };
    },
    async listAll() {
      return store.state.companies.map(c => ({ ...c }));
    },
    async updateFields(id, fields) {
      const idx = store.state.companies.findIndex(c => String(c.id) === String(id));
      if (idx < 0) return null;
      Object.assign(store.state.companies[idx], fields);
      return { ...store.state.companies[idx] };
    },
  };
  return {
    store,
    planRepo: store.planRepo,
    subscriptionRepo: store.subscriptionRepo,
    companyRepo,
    counterRepo: store.counterRepo,
    itemNameRepo: store.itemNameRepo,
    quotationRepo: store.quotationRepo,
    paymentTermTemplateRepo: store.paymentTermTemplateRepo,
    amcTemplateRepo: store.amcTemplateRepo,
    contractRepo: store.contractRepo,
    withTransaction: store.withTransaction,
  };
}

const CID = 'company_test';
const ACTOR = 'user_test';

// ═══════════════════════════════════════════════════════════════════
// SUBSCRIPTION / PLAN SERVICE
// ═══════════════════════════════════════════════════════════════════

test('subscription: seedDefaultPlans creates 7 plans', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  const plans = await seedDefaultPlans(deps);
  assert.equal(plans.length, 7);
  const codes = plans.map(p => p.code).sort();
  assert.deepEqual(codes, [
    'FULL_ENTERPRISE', 'HVAC_STARTER', 'MEP_HVAC_PRO', 'MEP_SOLAR_PRO',
    'MEP_STARTER', 'SOLAR_HVAC_PRO', 'SOLAR_STARTER',
  ]);
});

test('subscription: listPlans returns all seeded plans', async () => {
  const deps = createTestDeps();
  await seedDefaultPlans(deps);
  const plans = await listPlans(deps);
  assert.equal(plans.length, 7);
});

test('subscription: getPlan returns a specific plan', async () => {
  const deps = createTestDeps();
  await seedDefaultPlans(deps);
  const plan = await getPlan('HVAC_STARTER', deps);
  assert.equal(plan.code, 'HVAC_STARTER');
  assert.deepEqual(plan.availableDivisions, ['HVAC']);
});

test('subscription: getPlan throws for unknown code', async () => {
  const deps = createTestDeps();
  await assert.rejects(() => getPlan('NONEXISTENT', deps), /not found/i);
});

test('subscription: createPlan adds a new plan', async () => {
  const deps = createTestDeps();
  const plan = await createPlan({
    code: 'CUSTOM', name: 'Custom Plan', availableDivisions: ['HVAC', 'Solar'],
  }, deps);
  assert.equal(plan.code, 'CUSTOM');
});

test('subscription: createOrUpdateSubscription creates a subscription', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  const sub = await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);
  assert.equal(sub.planCode, 'HVAC_STARTER');
  assert.deepEqual(sub.purchasedDivisions, ['HVAC']);
});

test('subscription: createOrUpdateSubscription rejects division not in plan', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  await assert.rejects(
    () => createOrUpdateSubscription(CID, {
      planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC', 'Solar'], status: 'active',
    }, ACTOR, deps),
    /not available in plan/i
  );
});

test('subscription: getEffectiveDivisions returns subscription divisions', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['MEP'] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'SOLAR_HVAC_PRO', purchasedDivisions: ['HVAC', 'Solar'], status: 'active',
  }, ACTOR, deps);
  const divs = await getEffectiveDivisions(CID, deps);
  assert.deepEqual(divs.sort(), ['HVAC', 'Solar']);
});

test('subscription: getEffectiveDivisions falls back to company.divisions', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'MEP'] }] });
  // No subscription created
  const divs = await getEffectiveDivisions(CID, deps);
  assert.deepEqual(divs.sort(), ['HVAC', 'MEP']);
});

// ═══════════════════════════════════════════════════════════════════
// ITEM NAME LIBRARY
// ═══════════════════════════════════════════════════════════════════

test('itemName: normalizeName lowercases, trims, collapses spaces', () => {
  assert.equal(normalizeName('  Hello   World  '), 'hello world');
  assert.equal(normalizeName('VRF Unit'), 'vrf unit');
});

test('itemName: upsertItemName creates and increments', async () => {
  const deps = createTestDeps();
  const item1 = await upsertItemName(CID, 'HVAC', 'VRF Unit', { unit: 'Nos' }, deps);
  assert.equal(item1.name, 'VRF Unit');
  assert.equal(item1.usageCount, 1);

  const item2 = await upsertItemName(CID, 'HVAC', 'VRF Unit', {}, deps);
  assert.equal(item2.usageCount, 2);
  assert.equal(item2.id, item1.id); // same item
});

test('itemName: upsertItemName normalizes for dedup', async () => {
  const deps = createTestDeps();
  await upsertItemName(CID, 'HVAC', 'VRF Unit', {}, deps);
  const item = await upsertItemName(CID, 'HVAC', '  vrf   unit  ', {}, deps);
  assert.equal(item.usageCount, 2);
});

test('itemName: bulkUpsertFromLineItems processes multiple items', async () => {
  const deps = createTestDeps();
  const items = [
    { description: 'Copper Pipe', section: 'Equipment' },
    { description: 'AC Unit', section: 'Equipment' },
    { description: 'Copper Pipe', section: 'Equipment' }, // duplicate
  ];
  await bulkUpsertFromLineItems(CID, 'HVAC', items, deps);
  const list = await listItems(CID, 'HVAC', deps);
  assert.equal(list.length, 2); // deduped
});

test('itemName: autocomplete finds by prefix', async () => {
  const deps = createTestDeps();
  await upsertItemName(CID, 'HVAC', 'VRF Indoor Unit', {}, deps);
  await upsertItemName(CID, 'HVAC', 'VRF Outdoor Unit', {}, deps);
  await upsertItemName(CID, 'HVAC', 'Copper Pipe', {}, deps);
  const results = await autocomplete(CID, 'HVAC', 'vrf', 10, deps);
  assert.equal(results.length, 2);
});

test('itemName: autocomplete finds by substring', async () => {
  const deps = createTestDeps();
  await upsertItemName(CID, 'HVAC', 'VRF Indoor Unit', {}, deps);
  await upsertItemName(CID, 'HVAC', 'Split Indoor Unit', {}, deps);
  const results = await autocomplete(CID, 'HVAC', 'indoor', 10, deps);
  assert.equal(results.length, 2);
});

test('itemName: deleteItemName removes an item', async () => {
  const deps = createTestDeps();
  const item = await upsertItemName(CID, 'HVAC', 'Test Item', {}, deps);
  await deleteItemName(CID, item.id, deps);
  const list = await listItems(CID, 'HVAC', deps);
  assert.equal(list.length, 0);
});

test('itemName: items are scoped by division', async () => {
  const deps = createTestDeps();
  await upsertItemName(CID, 'HVAC', 'VRF Unit', {}, deps);
  await upsertItemName(CID, 'Solar', 'Solar Panel', {}, deps);
  const hvac = await listItems(CID, 'HVAC', deps);
  const solar = await listItems(CID, 'Solar', deps);
  assert.equal(hvac.length, 1);
  assert.equal(solar.length, 1);
  assert.equal(hvac[0].name, 'VRF Unit');
  assert.equal(solar[0].name, 'Solar Panel');
});

// ═══════════════════════════════════════════════════════════════════
// QUOTATION SERVICE
// ═══════════════════════════════════════════════════════════════════

test('quotation: calculateLineTotals computes amounts correctly', () => {
  const items = [
    { description: 'Unit A', qty: 2, supplyRate: 1000, installationRate: 500 },
    { description: 'Unit B', qty: 3, supplyRate: 2000, installationRate: 0 },
  ];
  const result = calculateLineTotals(items);
  assert.equal(result[0].supplyAmount, 2000);
  assert.equal(result[0].installationAmount, 1000);
  assert.equal(result[0].totalAmount, 3000);
  assert.equal(result[1].supplyAmount, 6000);
  assert.equal(result[1].installationAmount, 0);
  assert.equal(result[1].totalAmount, 6000);
});

test('quotation: calculateTotals computes equipment + accessories + GST', () => {
  const eq = [{ supplyAmount: 5000, installationAmount: 2000 }];
  const acc = [{ supplyAmount: 1000, installationAmount: 500 }];
  const totals = calculateTotals(eq, acc, 18);
  assert.equal(totals.equipmentTotal, 7000);
  assert.equal(totals.accessoriesTotal, 1500);
  assert.equal(totals.subtotal, 8500);
  assert.equal(totals.gstPercent, 18);
  assert.equal(totals.gstAmount, 1530);
  assert.equal(totals.grandTotal, 10030);
});

test('quotation: createQuotation succeeds with valid data', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const q = await createQuotation(CID, {
    division: 'HVAC', customerName: 'Mr. Test',
    equipmentItems: [{ description: 'VRF Unit', qty: 1, supplyRate: 10000, installationRate: 5000 }],
  }, ACTOR, deps);
  assert.ok(q.id);
  assert.ok(q.quotationNumber);
  assert.equal(q.division, 'HVAC');
  assert.equal(q.customerName, 'Mr. Test');
  assert.equal(q.grandTotal, 17700); // (10000+5000) + 18% GST = 15000 + 2700
});

test('quotation: createQuotation rejects missing division', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }] });
  await assert.rejects(
    () => createQuotation(CID, { customerName: 'Test' }, ACTOR, deps),
    /division is required/i
  );
});

test('quotation: createQuotation rejects missing customerName', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }] });
  await assert.rejects(
    () => createQuotation(CID, { division: 'HVAC' }, ACTOR, deps),
    /customer name is required/i
  );
});

test('quotation: generateQuotationNumber uses company prefix', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'], quotationPrefix: 'MPT' }],
  });
  const num = await generateQuotationNumber(CID, deps);
  assert.ok(num.startsWith('MPT-'));
});

test('quotation: generateQuotationNumber defaults to QTN', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }] });
  const num = await generateQuotationNumber(CID, deps);
  assert.ok(num.startsWith('QTN-'));
});

test('quotation: updateQuotation recalculates totals', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const q = await createQuotation(CID, {
    division: 'HVAC', customerName: 'Mr. Test',
    equipmentItems: [{ description: 'Item', qty: 1, supplyRate: 1000, installationRate: 0 }],
  }, ACTOR, deps);

  const updated = await updateQuotation(CID, q.id, {
    equipmentItems: [{ description: 'Item', qty: 2, supplyRate: 1000, installationRate: 0 }],
  }, ACTOR, deps);
  assert.equal(updated.subtotal, 2000);
  assert.equal(updated.grandTotal, 2360); // 2000 + 18% GST
});

test('quotation: listQuotations returns company quotations', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  await createQuotation(CID, { division: 'HVAC', customerName: 'A' }, ACTOR, deps);
  await createQuotation(CID, { division: 'Solar', customerName: 'B' }, ACTOR, deps);
  const list = await listQuotations(CID, {}, deps);
  assert.equal(list.length, 2);
});

test('quotation: listQuotations filters by division', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  await createQuotation(CID, { division: 'HVAC', customerName: 'A' }, ACTOR, deps);
  await createQuotation(CID, { division: 'Solar', customerName: 'B' }, ACTOR, deps);
  const list = await listQuotations(CID, { division: 'HVAC' }, deps);
  assert.equal(list.length, 1);
  assert.equal(list[0].division, 'HVAC');
});

test('quotation: duplicateQuotation creates new Draft copy', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const original = await createQuotation(CID, {
    division: 'HVAC', customerName: 'Test',
    equipmentItems: [{ description: 'Item', qty: 1, supplyRate: 1000, installationRate: 0 }],
  }, ACTOR, deps);

  const copy = await duplicateQuotation(CID, original.id, ACTOR, deps);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.quotationNumber, original.quotationNumber);
  assert.equal(copy.status, 'Draft');
  assert.equal(copy.customerName, 'Test');
});

test('quotation: deleteQuotation only works on Draft/Cancelled', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const q = await createQuotation(CID, {
    division: 'HVAC', customerName: 'Test',
  }, ACTOR, deps);

  // Draft — should work
  const result = await deleteQuotation(CID, q.id, deps);
  assert.equal(result.deleted, true);
});

test('quotation: deleteQuotation rejects non-Draft/Cancelled', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const q = await createQuotation(CID, {
    division: 'HVAC', customerName: 'Test',
  }, ACTOR, deps);

  // Change to Sent
  await updateQuotation(CID, q.id, { status: 'Sent' }, ACTOR, deps);
  await assert.rejects(
    () => deleteQuotation(CID, q.id, deps),
    /only draft or cancelled/i
  );
});

test('quotation: exportQuotationsCsv produces valid CSV', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  await createQuotation(CID, {
    division: 'HVAC', customerName: 'Test Customer',
    equipmentItems: [{ description: 'Item', qty: 1, supplyRate: 1000, installationRate: 0 }],
  }, ACTOR, deps);
  const csv = await exportQuotationsCsv(CID, deps);
  assert.ok(csv.includes('Quotation No'));
  assert.ok(csv.includes('Test Customer'));
});

// ═══════════════════════════════════════════════════════════════════
// AMC DOCUMENT SERVICE
// ═══════════════════════════════════════════════════════════════════

test('amcDocument: getDefaultTemplate returns sections for each type', () => {
  for (const type of ['comprehensive', 'non-comprehensive', 'amc-letter']) {
    const tmpl = getDefaultTemplate(type);
    assert.ok(tmpl, `should return template for ${type}`);
    assert.ok(tmpl.sections.length > 0, `${type} should have sections`);
    assert.equal(tmpl.type, type);
  }
});

test('amcDocument: comprehensive has 16 sections', () => {
  const tmpl = getDefaultTemplate('comprehensive');
  assert.equal(tmpl.sections.length, 16);
});

test('amcDocument: non-comprehensive has 15 sections', () => {
  const tmpl = getDefaultTemplate('non-comprehensive');
  assert.equal(tmpl.sections.length, 15);
});

test('amcDocument: amc-letter has 23 sections', () => {
  const tmpl = getDefaultTemplate('amc-letter');
  assert.equal(tmpl.sections.length, 23);
});

test('amcDocument: getTemplate falls back to system default', async () => {
  const deps = createTestDeps();
  const tmpl = await getTemplate(CID, 'comprehensive', deps);
  assert.equal(tmpl.type, 'comprehensive');
  assert.ok(tmpl.sections.length > 0);
});

test('amcDocument: saveTemplate saves company override', async () => {
  const deps = createTestDeps();
  const saved = await saveTemplate(CID, {
    type: 'comprehensive',
    name: 'Custom Comprehensive',
    sections: [{ key: 'intro', title: 'Introduction', content: 'Custom intro', order: 1 }],
  }, deps);
  assert.equal(saved.name, 'Custom Comprehensive');

  // Now getTemplate should return the override
  const tmpl = await getTemplate(CID, 'comprehensive', deps);
  assert.equal(tmpl.name, 'Custom Comprehensive');
  assert.equal(tmpl.sections[0].content, 'Custom intro');
});

test('amcDocument: listTemplates returns available templates', async () => {
  const deps = createTestDeps();
  const list = await listTemplates(CID, deps);
  // Should return at least the 3 default types
  assert.ok(list.length >= 3);
});

test('amcDocument: generateAmcDocument merges contract + company + template', async () => {
  const deps = createTestDeps({
    companies: [{
      id: CID, name: 'MEP Powertech', displayName: 'MEP Powertech Pvt Ltd',
      phone: '9876543210', email: 'info@mep.com', divisions: ['HVAC'],
    }],
    contracts: [{
      id: 'contract_1', companyId: CID, contractNumber: 'AMC-001',
      customer: 'Mr. Client', site: 'Client Site', division: 'HVAC',
      amcType: 'Quarterly', maintenanceCoverage: 'Comprehensive',
      startDate: '2024-01-01', endDate: '2024-12-31',
      amount: 50000, category: 'HVAC',
    }],
  });

  const doc = await generateAmcDocument(CID, 'contract_1', 'comprehensive', deps);
  assert.ok(doc);
  assert.equal(doc.contract.customer, 'Mr. Client');
  assert.equal(doc.company.name, 'MEP Powertech Pvt Ltd');
  assert.ok(doc.template.sections.length > 0);
  assert.equal(doc.contract.visitsPerYear, 4); // Quarterly = 4
});

test('amcDocument: generateAmcDocument rejects unknown contract', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co' }] });
  await assert.rejects(
    () => generateAmcDocument(CID, 'nonexistent', 'comprehensive', deps),
    /not found/i
  );
});

// ═══════════════════════════════════════════════════════════════════
// PAYMENT TERM TEMPLATE SERVICE (route-level, tested via fakes)
// ═══════════════════════════════════════════════════════════════════

test('paymentTermTemplate: CRUD via fake repo', async () => {
  const deps = createTestDeps();
  const repo = deps.paymentTermTemplateRepo;

  // Create
  const created = await repo.create({
    companyId: CID, name: 'Standard 40-40-20', division: 'HVAC',
    documentType: 'quotation',
    rows: [
      { sequence: 1, label: 'Advance', percentage: 40 },
      { sequence: 2, label: 'Delivery', percentage: 40 },
      { sequence: 3, label: 'Completion', percentage: 20 },
    ],
  });
  assert.ok(created.id);
  assert.equal(created.name, 'Standard 40-40-20');

  // Read
  const found = await repo.findById(CID, created.id);
  assert.equal(found.name, 'Standard 40-40-20');

  // Update
  const updated = await repo.updateFields(CID, created.id, { name: 'Updated Template' });
  assert.equal(updated.name, 'Updated Template');

  // List
  const list = await repo.listByCompany(CID, {});
  assert.equal(list.length, 1);

  // Delete
  await repo.delete(CID, created.id);
  const listAfter = await repo.listByCompany(CID, {});
  assert.equal(listAfter.length, 0);
});

// ═══════════════════════════════════════════════════════════════════
// COMPANY PROFILE FIELDS (model-level check)
// ═══════════════════════════════════════════════════════════════════

test('companyProfile: Company model declares profile fields', () => {
  const { Company } = require('../src/models');
  const schema = Company.schema;
  const profileFields = [
    'displayName', 'subtitle', 'tagline', 'phone', 'email', 'website',
    'gstNumber', 'logoBase64', 'quotationPrefix',
  ];
  for (const field of profileFields) {
    assert.ok(schema.path(field), `Company should have ${field} field`);
  }
  // Bank details sub-doc
  assert.ok(schema.path('bankDetails.bankName'), 'Company should have bankDetails.bankName');
  assert.ok(schema.path('bankDetails.ifscCode'), 'Company should have bankDetails.ifscCode');
  // Authorized person sub-doc
  assert.ok(schema.path('authorizedPerson.name'), 'Company should have authorizedPerson.name');
  assert.ok(schema.path('authorizedPerson.designation'), 'Company should have authorizedPerson.designation');
});

test('companyProfile: quotationPrefix defaults to QTN', () => {
  const { Company } = require('../src/models');
  const doc = new Company({ name: 'Test' });
  assert.equal(doc.quotationPrefix, 'QTN');
});

// ═══════════════════════════════════════════════════════════════════
// DIVISION ENTITLEMENT (subscription → quotation integration)
// ═══════════════════════════════════════════════════════════════════

test('divisionEntitlement: createQuotation rejects unpurchased division', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }],
  });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);

  // Try creating quotation for Solar (not purchased)
  await assert.rejects(
    () => createQuotation(CID, { division: 'Solar', customerName: 'Test' }, ACTOR, deps),
    /not available/i
  );
});

test('divisionEntitlement: createQuotation succeeds for purchased division', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }],
  });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);

  const q = await createQuotation(CID, { division: 'HVAC', customerName: 'Test' }, ACTOR, deps);
  assert.ok(q.id);
  assert.equal(q.division, 'HVAC');
});

// ═══════════════════════════════════════════════════════════════════
// COUNTER INTEGRATION
// ═══════════════════════════════════════════════════════════════════

test('counter: quotation numbers increment', async () => {
  const deps = createTestDeps({
    companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  const n1 = await generateQuotationNumber(CID, deps);
  const n2 = await generateQuotationNumber(CID, deps);
  // Extract sequence numbers
  const seq1 = parseInt(n1.split('-')[1], 10);
  const seq2 = parseInt(n2.split('-')[1], 10);
  assert.equal(seq2, seq1 + 1);
});
