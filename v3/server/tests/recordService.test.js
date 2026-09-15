// Phase 4 — the common record mutation service (V3 PHASE 4 spec §14), the abstraction every future
// feature module consumes instead of re-implementing ownership/soft-delete/correction/audit.
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({ _id: 'a1' }) }));
jest.mock('../src/models/RecordCorrection', () => ({ create: jest.fn().mockResolvedValue({ _id: 'corr-1' }), deleteOne: jest.fn() }));

const AuditLog = require('../src/models/AuditLog');
const RecordCorrection = require('../src/models/RecordCorrection');
const {
  createRecord, updateOwnRecord, softDeleteRecord, deleteOwnRecord, restoreRecord,
  submitRecord, lockRecord, createRecordService, RecordServiceError,
} = require('../src/services/recordService');
const { RECORD_STATES } = require('../src/config/constants');
const { defineResourcePolicy, clearResourcePolicies } = require('../src/config/recordPolicy');
const { MIN_DELETION_REASON_LENGTH } = require('../src/models/plugins/ownershipPlugin');

const RESOURCE = 'Quotation';
const GOOD_REASON = 'Duplicate quotation raised in error by the sales team';
expect(GOOD_REASON.length).toBeGreaterThanOrEqual(MIN_DELETION_REASON_LENGTH);

function lean(value) { return { lean: () => Promise.resolve(value), setOptions() { return this; } }; }

function makeModel(record) {
  return {
    create: jest.fn(async (doc) => ({ _id: 'new-1', ...doc })),
    findById: jest.fn(() => lean(record)),
    findByIdAndUpdate: jest.fn(async (id, update) => ({ _id: id, ...record, ...update.$set })),
  };
}

function makeReq({ userId = 'u-a', decision = { allowed: true, requiresCorrection: false }, record } = {}) {
  return {
    user: { _id: userId, co: 'co-a', name: 'Asha' },
    method: 'PUT',
    originalUrl: `/api/v3/${RESOURCE}/rec-1`,
    headers: {},
    ownershipDecision: decision,
    record,
  };
}

const draft = () => ({ _id: 'rec-1', co: 'co-a', createdByUserId: 'u-a', status: RECORD_STATES.DRAFT, amount: 100 });

beforeEach(() => {
  AuditLog.create.mockClear().mockResolvedValue({ _id: 'a1' });
  RecordCorrection.create.mockClear().mockResolvedValue({ _id: 'corr-1' });
});
afterEach(() => clearResourcePolicies());

describe('createRecord — the creator becomes the owner', () => {
  test('stamps createdByUserId, company and DRAFT status, and audits CREATE', async () => {
    const Model = makeModel(null);
    const req = makeReq();
    const created = await createRecord({ req, Model, resource: RESOURCE, payload: { amount: 500 } });

    expect(created.createdByUserId).toBe('u-a');
    expect(created.co).toBe('co-a');
    expect(created.status).toBe(RECORD_STATES.DRAFT);
    expect(created.createdByName).toBe('Asha');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resource: RESOURCE }));
  });

  test('a client-supplied createdByUserId cannot claim ownership of a new record', async () => {
    const Model = makeModel(null);
    const created = await createRecord({
      req: makeReq(), Model, resource: RESOURCE, payload: { createdByUserId: 'u-someone-else' },
    });
    expect(created.createdByUserId).toBe('u-a');
  });
});

describe('§14 — authorization stays external and explicit', () => {
  test('a mutating operation with NO decision available is a hard error, never a silent allow', async () => {
    const req = makeReq();
    delete req.ownershipDecision;
    await expect(updateOwnRecord({ req, Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1', payload: {} }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_NOT_EVALUATED' });
  });

  test('a denied decision is refused with 403 even if the caller invokes the service anyway', async () => {
    const req = makeReq({ decision: { allowed: false, reason: 'Not the record owner and no override authority' } });
    await expect(updateOwnRecord({ req, Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1', payload: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

describe('updateOwnRecord', () => {
  test('the creator may edit their own DRAFT and an UPDATE audit entry is written', async () => {
    const Model = makeModel(draft());
    const after = await updateOwnRecord({
      req: makeReq(), Model, resource: RESOURCE, id: 'rec-1', payload: { amount: 250 },
    });
    expect(after.amount).toBe(250);
    expect(after.updatedByUserId).toBe('u-a');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    expect(RecordCorrection.create).not.toHaveBeenCalled();
  });

  test('§12/§16 — an update attempting to change createdByUserId is rejected 422', async () => {
    await expect(updateOwnRecord({
      req: makeReq(), Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1',
      payload: { createdByUserId: 'u-attacker' },
    })).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
  });

  test('§9 — an APPROVED record cannot be edited even by its creator', async () => {
    const approved = { ...draft(), status: RECORD_STATES.APPROVED };
    await expect(updateOwnRecord({
      req: makeReq(), Model: makeModel(approved), resource: RESOURCE, id: 'rec-1', payload: { amount: 1 },
    })).rejects.toMatchObject({ code: 'RECORD_LOCKED', status: 403 });
  });

  test('§6 — an override edit REQUIRES a reason and produces a RecordCorrection', async () => {
    const othersRecord = { ...draft(), createdByUserId: 'u-owner' };
    const decision = { allowed: true, requiresCorrection: true };

    await expect(updateOwnRecord({
      req: makeReq({ userId: 'u-manager', decision }), Model: makeModel(othersRecord),
      resource: RESOURCE, id: 'rec-1', payload: { amount: 250 },
    })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    await updateOwnRecord({
      req: makeReq({ userId: 'u-manager', decision }), Model: makeModel(othersRecord),
      resource: RESOURCE, id: 'rec-1', payload: { amount: 250 }, reason: 'Customer agreed a revised price',
    });
    expect(RecordCorrection.create).toHaveBeenCalledWith(expect.objectContaining({
      originalCreatedByUserId: 'u-owner', overrideByUserId: 'u-manager',
    }));
  });

  test('a missing record is 404, not a silent no-op', async () => {
    await expect(updateOwnRecord({
      req: makeReq(), Model: makeModel(null), resource: RESOURCE, id: 'nope', payload: {},
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('§10 / §11 — delete is always a soft delete', () => {
  test('deleteOwnRecord and softDeleteRecord are the same operation — no hard delete exists', () => {
    expect(deleteOwnRecord).toBe(softDeleteRecord);
  });

  test('a DRAFT delete stamps the full soft-delete triad and audits DELETE', async () => {
    const Model = makeModel(draft());
    const after = await softDeleteRecord({
      req: makeReq(), Model, resource: RESOURCE, id: 'rec-1', reason: GOOD_REASON,
    });
    expect(after.deleted).toBe(true);
    expect(after.deletedByUserId).toBe('u-a');
    expect(after.deletionReason).toBe(GOOD_REASON);
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(Model.findByIdAndUpdate).toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
  });

  test('a short deletion reason is refused (destructive action guard)', async () => {
    await expect(softDeleteRecord({
      req: makeReq(), Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1', reason: 'oops',
    })).rejects.toMatchObject({ code: 'DELETION_REASON_REQUIRED' });
  });

  test('a SUBMITTED record cannot be deleted normally even though it can still be edited', async () => {
    const submitted = { ...draft(), status: RECORD_STATES.SUBMITTED };
    await expect(softDeleteRecord({
      req: makeReq(), Model: makeModel(submitted), resource: RESOURCE, id: 'rec-1', reason: GOOD_REASON,
    })).rejects.toMatchObject({ code: 'DELETE_NOT_PERMITTED', status: 403 });

    await expect(updateOwnRecord({
      req: makeReq(), Model: makeModel(submitted), resource: RESOURCE, id: 'rec-1', payload: { amount: 7 },
    })).resolves.toBeDefined();
  });

  test('a POSTED record has no delete path — reversal only', async () => {
    const posted = { ...draft(), status: RECORD_STATES.POSTED };
    await expect(softDeleteRecord({
      req: makeReq(), Model: makeModel(posted), resource: RESOURCE, id: 'rec-1', reason: GOOD_REASON,
    })).rejects.toMatchObject({ code: 'DELETE_NOT_PERMITTED' });
  });

  test('§25 — a financial resource cannot be deleted in ANY state', async () => {
    defineResourcePolicy('Payment', { financial: true });
    await expect(softDeleteRecord({
      req: makeReq(), Model: makeModel({ ...draft(), status: RECORD_STATES.DRAFT }),
      resource: 'Payment', id: 'rec-1', reason: GOOD_REASON,
    })).rejects.toMatchObject({ code: 'DELETE_NOT_PERMITTED' });
  });
});

describe('restoreRecord', () => {
  test('restores a soft-deleted record and audits REOPEN', async () => {
    const deletedRecord = { ...draft(), deleted: true, deletionReason: GOOD_REASON };
    const Model = makeModel(deletedRecord);
    const after = await restoreRecord({
      req: makeReq(), Model, resource: RESOURCE, id: 'rec-1', reason: 'Deleted in error',
    });
    expect(after.deleted).toBe(false);
    expect(after.deletionReason).toBeNull();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'REOPEN' }));
  });

  test('restoring a record that is not deleted is refused', async () => {
    await expect(restoreRecord({
      req: makeReq(), Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1',
    })).rejects.toMatchObject({ code: 'NOT_DELETED' });
  });
});

describe('§5 — submit and lock are business/state transitions, not record edits', () => {
  test('the creator may submit their own DRAFT; a SUBMIT audit entry is written', async () => {
    const Model = makeModel(draft());
    const after = await submitRecord({ req: makeReq(), Model, resource: RESOURCE, id: 'rec-1' });
    expect(after.status).toBe(RECORD_STATES.SUBMITTED);
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBMIT' }));
  });

  test('a REJECTED record may be resubmitted (the rework loop)', async () => {
    const rejected = { ...draft(), status: RECORD_STATES.REJECTED };
    const after = await submitRecord({ req: makeReq(), Model: makeModel(rejected), resource: RESOURCE, id: 'rec-1' });
    expect(after.status).toBe(RECORD_STATES.SUBMITTED);
  });

  test('an already-APPROVED record cannot be re-submitted', async () => {
    const approved = { ...draft(), status: RECORD_STATES.APPROVED };
    await expect(submitRecord({ req: makeReq(), Model: makeModel(approved), resource: RESOURCE, id: 'rec-1' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  test('lockRecord freezes a record so future financial modules can protect posted history', async () => {
    const Model = makeModel({ ...draft(), status: RECORD_STATES.APPROVED });
    const after = await lockRecord({
      req: makeReq(), Model, resource: RESOURCE, id: 'rec-1', state: RECORD_STATES.FINALIZED,
    });
    expect(after.status).toBe(RECORD_STATES.FINALIZED);
    // No invented AuditLog action — the frozen set is reused (§8).
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
  });

  test('a non-lockable target state is refused', async () => {
    await expect(lockRecord({
      req: makeReq(), Model: makeModel(draft()), resource: RESOURCE, id: 'rec-1', state: RECORD_STATES.DRAFT,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  test('a locked record can no longer be edited by anyone, creator included', async () => {
    const locked = { ...draft(), status: RECORD_STATES.LOCKED };
    await expect(updateOwnRecord({
      req: makeReq(), Model: makeModel(locked), resource: RESOURCE, id: 'rec-1', payload: { amount: 1 },
    })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
  });
});

describe('§14 — operations are opt-in per module, never blanket-exposed', () => {
  test('a module receives only the operations it asked for', () => {
    const svc = createRecordService({
      resource: 'Enquiry', Model: makeModel(null), operations: ['createRecord', 'updateOwnRecord'],
    });
    expect(svc.operations).toEqual(['createRecord', 'updateOwnRecord']);
    expect(svc.softDeleteRecord).toBeUndefined();
    expect(svc.lockRecord).toBeUndefined();
  });

  test('a financial resource never receives a delete operation at all, even by default', () => {
    defineResourcePolicy('Invoice', { financial: true });
    const svc = createRecordService({ resource: 'Invoice', Model: makeModel(null) });
    expect(svc.operations).not.toContain('deleteOwnRecord');
    expect(svc.operations).not.toContain('softDeleteRecord');
    expect(svc.operations).toContain('createRecord');
  });

  test('an unknown operation name is a configuration error', () => {
    expect(() => createRecordService({ resource: 'X', Model: makeModel(null), operations: ['hardDelete'] }))
      .toThrow(/Unknown operation/);
  });

  test('bound operations carry the resource and model automatically', async () => {
    const Model = makeModel(draft());
    const svc = createRecordService({ resource: RESOURCE, Model });
    const after = await svc.updateOwnRecord({ req: makeReq(), id: 'rec-1', payload: { amount: 42 } });
    expect(after.amount).toBe(42);
  });

  test('RecordServiceError carries an HTTP status for the API layer', () => {
    const err = new RecordServiceError('nope', 'X', 403);
    expect(err.status).toBe(403);
  });
});
