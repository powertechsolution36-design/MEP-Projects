'use strict';

/**
 * Owner request (17 Nov 2026): "in admin in client it will also have data of
 * admin/owner and can add multiple person under each client/company so if we
 * want to use those details in service call or in creating quotation we can
 * directly use that information to fill so it will be easy to fill."
 *
 * A client record already held the owner (clientName, designation, the main
 * number) and up to ten more people. What it could not do was hand any of
 * them to a form: the company's details filled in, the PERSON was still
 * typed. These tests cover the half of that which lives on the server — the
 * chosen person being carried on the record and printed on the document.
 *
 * The picking itself is a screen, and is covered by the e2e run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const serviceCallService = require('../src/services/serviceCallService');
const quotationService = require('../src/services/quotationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { ServiceCall, Quotation } = require('../src/models');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'service_mgr', name: 'Service Manager', ...o });

/* ------------------------------------------------------------------ *
 * The service call
 * ------------------------------------------------------------------ */

test('a complaint carries who reported it and which client they are', async () => {
  const store = createEnquiryFakeStore();
  const { serviceCall } = await serviceCallService.registerComplaint(
    {
      customer: 'Poona Stud Farm',
      phone: '9890000000',
      clientId: 'client_7',
      contactName: 'Mr. Rahul Deshmukh',
      contactDesignation: 'Maintenance In-charge',
    },
    auth(),
    store
  );
  assert.equal(serviceCall.clientId, 'client_7');
  assert.equal(serviceCall.contactName, 'Mr. Rahul Deshmukh');
  assert.equal(serviceCall.contactDesignation, 'Maintenance In-charge');
  // The number stays where the engineer already looks for it.
  assert.equal(serviceCall.phone, '9890000000');
});

test('a walk-in with nobody picked is stored exactly as it always was', async () => {
  const store = createEnquiryFakeStore();
  const { serviceCall } = await serviceCallService.registerComplaint(
    { customer: 'Somebody who walked in', phone: '9000000000' },
    auth(),
    store
  );
  // Not blank — ABSENT, the same shape every call taken before this has.
  assert.ok(!('clientId' in serviceCall) || serviceCall.clientId === undefined);
  assert.ok(!('contactName' in serviceCall) || serviceCall.contactName === undefined);
  assert.ok(!('contactDesignation' in serviceCall) || serviceCall.contactDesignation === undefined);
});

test('a name longer than the field is cut, not refused', async () => {
  const store = createEnquiryFakeStore();
  const { serviceCall } = await serviceCallService.registerComplaint(
    { customer: 'X', contactName: 'a'.repeat(400), contactDesignation: 'b'.repeat(400) },
    auth(),
    store
  );
  assert.equal(serviceCall.contactName.length, 120);
  assert.equal(serviceCall.contactDesignation.length, 120);
});

test('the schema accepts the person the service writes', () => {
  const err = new ServiceCall({
    contactName: 'Mr. Rahul Deshmukh',
    contactDesignation: 'Maintenance In-charge',
  }).validateSync(['contactName', 'contactDesignation']);
  assert.equal(err, undefined);
});

/* ------------------------------------------------------------------ *
 * The quotation
 * ------------------------------------------------------------------ */

const quotationInput = (extra = {}) => ({
  division: 'HVAC',
  customerName: 'Poona Stud Farm Pvt Ltd',
  customerPhone: '9890000000',
  equipmentItems: [{ description: 'Ducted unit', unit: 'Nos', qty: 1, supplyRate: 100 }],
  ...extra,
});

test('a quotation carries the person it is addressed to', async () => {
  const store = createEnquiryFakeStore();
  const q = await quotationService.createQuotation(
    'co1',
    quotationInput({ contactName: 'Mrs. Kavita Rao', contactDesignation: 'Purchase Manager' }),
    'u1',
    store
  );
  assert.equal(q.contactName, 'Mrs. Kavita Rao');
  assert.equal(q.contactDesignation, 'Purchase Manager');
});

test('a quotation with nobody picked carries a blank, not a guess', async () => {
  const store = createEnquiryFakeStore();
  const q = await quotationService.createQuotation('co1', quotationInput(), 'u1', store);
  assert.equal(q.contactName, '');
  assert.equal(q.contactDesignation, '');
});

test('the person can be changed afterwards, like any other field', async () => {
  const store = createEnquiryFakeStore();
  const q = await quotationService.createQuotation(
    'co1',
    quotationInput({ contactName: 'Mrs. Kavita Rao', contactDesignation: 'Purchase Manager' }),
    'u1',
    store
  );
  const after = await quotationService.updateQuotation(
    'co1',
    q.id,
    { contactName: 'Mr. Rahul Deshmukh', contactDesignation: 'Maintenance In-charge' },
    'u1',
    store
  );
  assert.equal(after.contactName, 'Mr. Rahul Deshmukh');
  assert.equal(after.contactDesignation, 'Maintenance In-charge');
});

test('the schema accepts the person the quotation service writes', () => {
  const err = new Quotation({
    contactName: 'Mrs. Kavita Rao',
    contactDesignation: 'Purchase Manager',
  }).validateSync(['contactName', 'contactDesignation']);
  assert.equal(err, undefined);
});

/* ------------------------------------------------------------------ *
 * What the documents print
 * ------------------------------------------------------------------ */

const { kindAttn } = require('../src/services/kindAttn');
const { buildQuotationPdf } = require('../src/services/quotationPdf');

test('the Kind Attn line names the person and what they do there', () => {
  assert.equal(kindAttn('Mr. Rahul Deshmukh', 'Maintenance In-charge'), 'Mr. Rahul Deshmukh, Maintenance In-charge');
});

test('a person with no designation is named on their own, with no stray comma', () => {
  assert.equal(kindAttn('Mr. Rahul Deshmukh', ''), 'Mr. Rahul Deshmukh');
  assert.equal(kindAttn('Mr. Rahul Deshmukh', '   '), 'Mr. Rahul Deshmukh');
});

test('nobody picked prints no line at all — not a designation on its own', () => {
  assert.equal(kindAttn('', 'Purchase Manager'), '');
  assert.equal(kindAttn('', ''), '');
  assert.equal(kindAttn(undefined, undefined), '');
});

test('the quotation PDF still builds, with a person and without one', async () => {
  const company = { name: 'MEP Powertech PVT. LTD.', shortName: 'Powertech' };
  const base = {
    quotationNumber: 'QTN-ATTN', division: 'HVAC', date: new Date('2026-11-17'),
    customerName: 'Poona Stud Farm Pvt Ltd', customerAddress: 'Pune', customerPhone: '9890000000',
    equipmentItems: [], accessoriesItems: [], paymentTerms: [], excludedWorks: [],
  };
  const withPerson = await buildQuotationPdf({
    company,
    quotation: { ...base, contactName: 'Mrs. Kavita Rao', contactDesignation: 'Purchase Manager' },
  });
  const without = await buildQuotationPdf({ company, quotation: base });
  assert.equal(withPerson.subarray(0, 5).toString(), '%PDF-');
  assert.equal(without.subarray(0, 5).toString(), '%PDF-');
  // The line is drawn, so the document is not byte-identical to the one
  // without it. (The text itself cannot be read back: PDFKit subsets the
  // font, so the page stream holds glyph ids, not letters. That is why the
  // wording is tested through kindAttn above and not through the PDF.)
  assert.ok(withPerson.length !== without.length);
});
