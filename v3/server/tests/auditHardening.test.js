// Phase 4 — audit hardening (V3 PHASE 4 spec §8 / §17 / §18 / §19).
//
// §18 is the substantive change under test: "A mutation that requires an audit entry must not
// silently succeed while audit logging fails." An ordinary operational mutation keeps the Phase 1
// behavior (never crash the request over a logging outage); a critical one now fails loudly.
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn() }));
jest.mock('../src/models/RecordCorrection', () => ({ create: jest.fn(), deleteOne: jest.fn() }));

const AuditLog = require('../src/models/AuditLog');
const RecordCorrection = require('../src/models/RecordCorrection');
const { audit, auditCritical, runAudited, AuditFailureError } = require('../src/services/auditService');
const { recordOwnershipAction } = require('../src/services/ownershipService');
const { AUDIT_ACTIONS } = require('../src/config/constants');
const { REDACTED } = require('../src/utils/redact');

function mockReq(overrides = {}) {
  return {
    user: { _id: 'u-a', co: 'co-a', name: 'Asha' },
    method: 'PUT',
    originalUrl: '/api/v3/quotations/q1',
    ip: '10.0.0.1',
    headers: { 'user-agent': 'jest' },
    ...overrides,
  };
}

beforeEach(() => {
  AuditLog.create.mockReset().mockResolvedValue({ _id: 'audit-1' });
  RecordCorrection.create.mockReset().mockResolvedValue({ _id: 'corr-1' });
  RecordCorrection.deleteOne.mockReset().mockResolvedValue({});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('§8 — one AuditLog, the frozen action set', () => {
  test('every action the spec lists is available as a frozen constant', () => {
    for (const action of ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'APPROVE', 'REJECT', 'ASSIGN', 'CLOSE', 'REOPEN', 'CORRECT', 'REVERSE']) {
      expect(AUDIT_ACTIONS[action]).toBe(action);
    }
  });

  test('Phase 3 commercial actions still use the same AuditLog — no parallel audit system', () => {
    expect(AUDIT_ACTIONS.SUBSCRIPTION_CHANGED).toBe('SUBSCRIPTION_CHANGED');
    expect(AUDIT_ACTIONS.MANUAL_ENTITLEMENT_GRANTED).toBe('MANUAL_ENTITLEMENT_GRANTED');
  });
});

describe('§17 — before/after snapshots', () => {
  test('an UPDATE records both before and after', async () => {
    await audit({
      req: mockReq(), action: AUDIT_ACTIONS.UPDATE, resource: 'Quotation', resourceId: 'q1',
      before: { amount: 100 }, after: { amount: 200 },
    });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', resource: 'Quotation', resourceId: 'q1',
      before: { amount: 100 }, after: { amount: 200 },
    }));
  });

  test('the acting user, path and method are captured without the frontend supplying them', async () => {
    await audit({ req: mockReq(), action: AUDIT_ACTIONS.DELETE, resource: 'Quotation', resourceId: 'q1' });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      co: 'co-a', user: 'u-a', userName: 'Asha', method: 'PUT', path: '/api/v3/quotations/q1',
    }));
  });
});

describe('§19 — nothing sensitive is ever persisted to AuditLog', () => {
  test('nested secrets in a before/after snapshot are redacted', async () => {
    await audit({
      req: mockReq(), action: AUDIT_ACTIONS.UPDATE, resource: 'User', resourceId: 'u1',
      before: { profile: { name: 'A', password: 'hunter2' } },
      after: { profile: { name: 'A', password: 'hunter3' }, headers: { authorization: 'Bearer x' } },
    });
    const entry = AuditLog.create.mock.calls[0][0];
    expect(entry.before.profile.password).toBe(REDACTED);
    expect(entry.after.profile.password).toBe(REDACTED);
    expect(entry.after.headers.authorization).toBe(REDACTED);
    expect(entry.before.profile.name).toBe('A');
  });
});

describe('§18 — audit failure policy', () => {
  test('an ORDINARY mutation is not crashed by a logging outage (unchanged default)', async () => {
    AuditLog.create.mockRejectedValue(new Error('mongo down'));
    await expect(audit({
      req: mockReq(), action: AUDIT_ACTIONS.UPDATE, resource: 'Quotation', resourceId: 'q1',
    })).resolves.toBeUndefined();
  });

  test('a CRITICAL mutation rejects instead of silently succeeding unaudited', async () => {
    AuditLog.create.mockRejectedValue(new Error('mongo down'));
    await expect(auditCritical({
      req: mockReq(), action: AUDIT_ACTIONS.REVERSE, resource: 'Payment', resourceId: 'p1',
    })).rejects.toBeInstanceOf(AuditFailureError);
  });

  test('the critical failure carries a machine-readable code and the original cause', async () => {
    const cause = new Error('write concern failed');
    AuditLog.create.mockRejectedValue(cause);
    await expect(audit({
      req: mockReq(), action: AUDIT_ACTIONS.CORRECT, resource: 'Quotation', resourceId: 'q1', critical: true,
    })).rejects.toMatchObject({ code: 'AUDIT_WRITE_FAILED', cause });
  });
});

describe('§18 — runAudited(): the mutation and its audit entry succeed or fail together', () => {
  test('happy path returns the mutation result and writes exactly one audit entry', async () => {
    const mutate = jest.fn().mockResolvedValue({ _id: 'p1', amount: 500 });
    const result = await runAudited({
      req: mockReq(), action: AUDIT_ACTIONS.CREATE, resource: 'Payment', mutate,
      buildAudit: (r) => ({ resourceId: r._id, after: r }),
    });
    expect(result).toEqual({ _id: 'p1', amount: 500 });
    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    expect(AuditLog.create.mock.calls[0][0].resourceId).toBe('p1');
  });

  test('when the audit write fails, the compensating undo runs and the error propagates', async () => {
    AuditLog.create.mockRejectedValue(new Error('mongo down'));
    const compensate = jest.fn().mockResolvedValue();
    await expect(runAudited({
      req: mockReq(), action: AUDIT_ACTIONS.CREATE, resource: 'Payment',
      mutate: jest.fn().mockResolvedValue({ _id: 'p1' }),
      compensate,
    })).rejects.toBeInstanceOf(AuditFailureError);
    expect(compensate).toHaveBeenCalledWith({ _id: 'p1' });
  });

  test('a failing compensation is logged but never masks the original audit failure', async () => {
    AuditLog.create.mockRejectedValue(new Error('mongo down'));
    await expect(runAudited({
      req: mockReq(), action: AUDIT_ACTIONS.CREATE, resource: 'Payment',
      mutate: jest.fn().mockResolvedValue({ _id: 'p1' }),
      compensate: jest.fn().mockRejectedValue(new Error('undo failed too')),
    })).rejects.toBeInstanceOf(AuditFailureError);
  });
});

describe('§6 / §7 — correction history is audited and redacted', () => {
  const baseReq = () => mockReq({
    ownershipDecision: { allowed: true, requiresCorrection: true },
    record: { createdByUserId: 'u-owner', co: 'co-a' },
  });

  test('an override writes a RecordCorrection AND a CORRECT audit entry cross-referencing it', async () => {
    const req = baseReq();
    const { correctionId } = await recordOwnershipAction({
      req, resource: 'Quotation', resourceId: 'q1', action: 'UPDATE',
      oldValue: { amount: 100 }, newValue: { amount: 200 }, reason: 'Customer agreed revised price',
    });
    expect(correctionId).toBe('corr-1');
    expect(RecordCorrection.create).toHaveBeenCalledWith(expect.objectContaining({
      originalCollection: 'Quotation',
      originalRecordId: 'q1',
      originalCreatedByUserId: 'u-owner',   // the original owner is PRESERVED
      overrideByUserId: 'u-a',
      reason: 'Customer agreed revised price',
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CORRECT', correctionId: 'corr-1',
    }));
  });

  test('a correction refuses to proceed without a reason', async () => {
    await expect(recordOwnershipAction({
      req: baseReq(), resource: 'Quotation', resourceId: 'q1', action: 'UPDATE',
      oldValue: {}, newValue: {},
    })).rejects.toThrow(/reason is required/i);
    expect(RecordCorrection.create).not.toHaveBeenCalled();
  });

  test('secrets never reach the correction row itself, not just the audit log (§7)', async () => {
    await recordOwnershipAction({
      req: baseReq(), resource: 'User', resourceId: 'u1', action: 'UPDATE',
      oldValue: { nested: { password: 'old-secret' } },
      newValue: { nested: { password: 'new-secret', token: 'jwt.value' } },
      reason: 'Password reset performed on behalf of user',
    });
    const correction = RecordCorrection.create.mock.calls[0][0];
    expect(correction.oldValue.nested.password).toBe(REDACTED);
    expect(correction.newValue.nested.password).toBe(REDACTED);
    expect(correction.newValue.nested.token).toBe(REDACTED);
  });

  test('a Super Admin support-op is recorded as OVERRIDE with supportOp:true', async () => {
    const req = mockReq({
      user: { _id: 'u-super', co: 'co-a', name: 'Root' },
      ownershipDecision: { allowed: true, requiresCorrection: true, supportOp: true },
      record: { createdByUserId: 'u-owner', co: 'co-b' },
    });
    await recordOwnershipAction({
      req, resource: 'Quotation', resourceId: 'q1', action: 'UPDATE',
      oldValue: {}, newValue: {}, reason: 'Support ticket 4821 — data repair',
    });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'OVERRIDE', supportOp: true }));
  });

  test('an un-auditable correction is rolled back rather than left standing without a trail', async () => {
    AuditLog.create.mockRejectedValue(new Error('mongo down'));
    await expect(recordOwnershipAction({
      req: baseReq(), resource: 'Quotation', resourceId: 'q1', action: 'UPDATE',
      oldValue: {}, newValue: {}, reason: 'Correcting a mistyped amount',
    })).rejects.toBeInstanceOf(AuditFailureError);
    expect(RecordCorrection.deleteOne).toHaveBeenCalledWith({ _id: 'corr-1' });
  });

  test('an ordinary creator edit writes a plain audit entry and NO correction row', async () => {
    const req = mockReq({
      ownershipDecision: { allowed: true, requiresCorrection: false },
      record: { createdByUserId: 'u-a', co: 'co-a' },
    });
    await recordOwnershipAction({
      req, resource: 'Quotation', resourceId: 'q1', action: 'UPDATE', oldValue: {}, newValue: {},
    });
    expect(RecordCorrection.create).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
  });
});
