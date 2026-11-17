'use strict';

/**
 * DEFECT, 17 Nov 2026: a client could not report a fault from the client app.
 *
 * "`` is not a valid enum value for path `division`" appeared on the
 * complaint form and the complaint was never raised.
 *
 * ServiceCall.division is an enum of the three divisions with no blank
 * member and no default — the field is simply absent on every call taken
 * before 14 Nov, and every read treats absent as "not set". A complaint
 * raised from the client app has no division to offer: a customer is asked
 * nothing, the login is not confined to a division, and their AMC contract
 * had never been tagged with one (that tagging is still outstanding). The
 * service put '' in the field anyway, Mongoose refused it, and the raw
 * schema message was handed to the customer.
 *
 * The same held for scheduling a PM visit for an untagged client.
 *
 * These tests put what the service writes through the REAL ServiceCall
 * schema, which is the step the in-memory fakes do not perform — and the
 * reason the fakes alone never caught this.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const serviceCallService = require('../src/services/serviceCallService');
const portalService = require('../src/services/portalService');
const { ServiceCall } = require('../src/models');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'service_mgr', name: 'Service Manager', ...o });

/**
 * What Mongoose would say about this document's `division`, or null if the
 * field is acceptable. Only that path reaches the schema: the in-memory
 * fakes use readable string ids ('co1', 'contract_1') which are not
 * ObjectIds, and those casts are the fakes' business, not this defect's.
 */
function schemaComplaint(data) {
  const probe = Object.prototype.hasOwnProperty.call(data || {}, 'division')
    ? { division: data.division }
    : {};
  const err = new ServiceCall(probe).validateSync(['division']);
  if (!err || !err.errors) return null;
  return Object.values(err.errors).map((e) => e.message).join('; ');
}

/** A fake store whose serviceCallRepo validates against the real schema. */
function strictStore() {
  const deps = createEnquiryFakeStore();
  const plainCreate = deps.serviceCallRepo.create.bind(deps.serviceCallRepo);
  deps.serviceCallRepo.create = async (data, session) => {
    const said = schemaComplaint(data);
    if (said) {
      const err = new Error(said);
      err.name = 'ValidationError';
      err.errors = { division: { message: said } };
      throw err;
    }
    return plainCreate(data, session);
  };
  return deps;
}

/** An AMC client that nobody ever tagged with a division. */
async function untaggedClient(deps) {
  return deps.contractRepo.create({
    companyId: 'co1', customer: 'TEST', site: 'University', phone: '9820011223',
    type: 'AMC', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
  });
}

test('a client with no division on their contract can still report a fault', async () => {
  const deps = strictStore();
  const contract = await untaggedClient(deps);

  const { serviceCall } = await serviceCallService.registerComplaint(
    { contractId: contract.id, complaintDescription: 'University', source: 'Customer' },
    auth(),
    deps
  );

  assert.equal(serviceCall.complaintDescription, 'University');
  assert.equal(serviceCall.status, 'Registered');
  // Absent, not blank — the same shape as every call taken before the field
  // existed. A blank is what the schema refuses.
  assert.ok(!('division' in serviceCall) || serviceCall.division === undefined,
    'an untagged client leaves the field off the call, it does not write ""');
});

test('a PM visit for an untagged client is scheduled the same way', async () => {
  const deps = strictStore();
  const contract = await untaggedClient(deps);

  const { serviceCall } = await serviceCallService.schedulePM(
    contract.id,
    { date: '2026-12-01', time: '10:30' },
    auth(),
    deps
  );

  assert.equal(serviceCall.type, 'PM');
  assert.ok(!('division' in serviceCall) || serviceCall.division === undefined);
});

test('a tagged client still puts its division on the call', async () => {
  const deps = strictStore();
  const contract = await deps.contractRepo.create({
    companyId: 'co1', customer: 'Poonawalla KP87', site: 'KP87', phone: '9820011224',
    type: 'AMC', division: 'HVAC',
    startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
  });

  const { serviceCall } = await serviceCallService.registerComplaint(
    { contractId: contract.id, complaintDescription: 'Indoor unit leaking', source: 'Customer' },
    auth(),
    deps
  );
  assert.equal(serviceCall.division, 'HVAC');
});

test('the blank really is what the schema refuses — the defect reproduces', () => {
  const base = {
    companyId: 'co1', complaintNumber: 1, type: 'Complaint', customer: 'TEST',
    status: 'Registered', registeredDate: new Date(),
  };
  assert.match(String(schemaComplaint({ ...base, division: '' })), /division/,
    'writing "" must still be refused — that is the behaviour being worked around');
  assert.equal(schemaComplaint(base), null, 'leaving the field off is acceptable');
  assert.equal(schemaComplaint({ ...base, division: 'HVAC' }), null);
});

test('the customer app raises the complaint end to end for an untagged client', async () => {
  const deps = strictStore();
  const contract = await untaggedClient(deps);
  const account = await deps.customerAccountRepo.create({
    companyId: 'co1', contractId: contract.id, name: 'TEST', phone: '9820011223', status: 'Active',
  });

  const complaint = await portalService.createMyComplaint(
    { companyId: 'co1', contractId: contract.id, accountId: account.id },
    { complaintDescription: 'University' },
    deps
  );

  assert.equal(complaint.complaintDescription, 'University');
  assert.ok(complaint.complaintNumber);
});

/* ------------------------------------------------------------------ *
 * The second half of the defect: what the customer was shown
 * ------------------------------------------------------------------ */

test('the client app never shows a customer a database message', async () => {
  // Whatever goes wrong behind it, a client reads a sentence meant for them.
  //
  // The portal's session check is replaced before the router is loaded: this
  // test is about the ANSWER a client gets when a write fails, not about how
  // they signed in (customerPortal.test.js covers that through the real app).
  const express = require('express');
  const portalAuthService = require('../src/services/portalAuthService');

  const deps = createEnquiryFakeStore();
  const contract = await untaggedClient(deps);
  const account = await deps.customerAccountRepo.create({
    companyId: 'co1', contractId: contract.id, name: 'TEST', phone: '9820011223', status: 'Active',
  });

  const realVerify = portalAuthService.verifyCustomerSession;
  portalAuthService.verifyCustomerSession = async () => ({
    companyId: 'co1', contractId: contract.id, accountId: account.id,
  });
  // Required AFTER the stub: the middleware reads the function once, at load.
  delete require.cache[require.resolve('../src/middleware/portalAuthMiddleware')];
  delete require.cache[require.resolve('../src/routes/portalRoutes')];
  const { createPortalRouter } = require('../src/routes/portalRoutes');

  // Make the write fail the way the schema failed on 17 Nov.
  deps.serviceCallRepo.create = async () => {
    const message = '`` is not a valid enum value for path `division`.';
    const err = new Error(message);
    err.name = 'ValidationError';
    err.errors = { division: { message } };
    throw err;
  };

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/portal', createPortalRouter(deps));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/portal/complaints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer stubbed' },
      body: JSON.stringify({ complaintDescription: 'University' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.ok(!/enum|path `|schema|mongo/i.test(String(body.error)),
      `a customer must not be shown schema wording — got: ${body.error}`);
    assert.match(String(body.error), /call us/i);
  } finally {
    server.close();
    portalAuthService.verifyCustomerSession = realVerify;
    delete require.cache[require.resolve('../src/middleware/portalAuthMiddleware')];
    delete require.cache[require.resolve('../src/routes/portalRoutes')];
  }
});

/* ------------------------------------------------------------------ *
 * The same blank, in the places that CREATE the untagged clients
 * ------------------------------------------------------------------ */

const contractService = require('../src/services/contractService');
const { Contract } = require('../src/models');

/** What Mongoose would say about a contract's `division`. */
function contractComplaint(data) {
  const probe = Object.prototype.hasOwnProperty.call(data || {}, 'division')
    ? { division: data.division }
    : {};
  const err = new Contract(probe).validateSync(['division']);
  if (!err || !err.errors) return null;
  return Object.values(err.errors).map((e) => e.message).join('; ');
}

function strictContractStore() {
  const deps = createEnquiryFakeStore();
  const plainCreate = deps.contractRepo.create.bind(deps.contractRepo);
  deps.contractRepo.create = async (data, session) => {
    const said = contractComplaint(data);
    if (said) {
      const err = new Error(said);
      err.name = 'ValidationError';
      err.errors = { division: { message: said } };
      throw err;
    }
    return plainCreate(data, session);
  };
  return deps;
}

test('an AMC client can be registered without choosing a division', async () => {
  const deps = strictContractStore();
  const contract = await contractService.createManualContract(
    {
      customer: 'TEST', site: 'University', phone: '9820011223',
      amcType: 'Quarterly', category: 'AMC',
      startDate: '2026-01-01', endDate: '2027-01-01',
    },
    auth({ role: 'admin' }),
    deps
  );
  assert.equal(contract.customer, 'TEST');
  assert.ok(!('division' in contract) || contract.division === undefined,
    'no division chosen leaves the field off, it does not write ""');
});

test('a division chosen at registration is still kept', async () => {
  const deps = strictContractStore();
  const contract = await contractService.createManualContract(
    {
      customer: 'Poonawalla KP87', site: 'KP87', phone: '9820011224',
      division: 'HVAC', amcType: 'Quarterly', category: 'AMC',
      startDate: '2026-01-01', endDate: '2027-01-01',
    },
    auth({ role: 'admin' }),
    deps
  );
  assert.equal(contract.division, 'HVAC');
});

test('clearing a division on an existing client removes it rather than blanking it', async () => {
  const deps = createEnquiryFakeStore();
  const made = await deps.contractRepo.create({
    companyId: 'co1', customer: 'TEST', site: 'University', phone: '9820011223',
    type: 'AMC', category: 'AMC', amcType: 'Quarterly', division: 'HVAC',
    startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
  });

  let written = null;
  const plainUpdate = deps.contractRepo.update.bind(deps.contractRepo);
  deps.contractRepo.update = async (companyId, id, patch, session) => {
    written = patch;
    return plainUpdate(companyId, id, patch, session);
  };

  await contractService.editContract(made.id, { division: '' }, auth({ role: 'admin' }), deps);
  assert.ok(written && 'division' in written);
  assert.equal(written.division, undefined,
    'a cleared division reaches the repository as undefined, which it turns into a $unset');
});
