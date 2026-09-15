// Phase 4 — reporting/history query foundation (V3 PHASE 4 spec §26). No reporting UI is built in
// this phase; these are the tenant-safe query shapes the future screens will call.
jest.mock('../src/models/AuditLog', () => ({ find: jest.fn() }));
jest.mock('../src/models/RecordCorrection', () => ({ find: jest.fn() }));

const AuditLog = require('../src/models/AuditLog');
const RecordCorrection = require('../src/models/RecordCorrection');
const {
  buildRecordQuery, buildAuditQuery, buildCorrectionQuery,
  queryAuditTrail, queryCorrections, getRecordHistory, HistoryQueryError,
} = require('../src/services/recordHistoryService');

function chain(value) {
  const q = {
    sort: jest.fn(() => q), skip: jest.fn(() => q), limit: jest.fn(() => q),
    lean: jest.fn(() => Promise.resolve(value)),
  };
  return q;
}

beforeEach(() => {
  AuditLog.find.mockReset().mockReturnValue(chain([{ action: 'UPDATE' }]));
  RecordCorrection.find.mockReset().mockReturnValue(chain([{ reason: 'fix' }]));
});

describe('tenant safety — a history query is never cross-company', () => {
  test.each([
    ['buildRecordQuery', () => buildRecordQuery({ createdBy: 'u1' })],
    ['buildAuditQuery', () => buildAuditQuery({ resource: 'Quotation' })],
    ['buildCorrectionQuery', () => buildCorrectionQuery({ resource: 'Quotation' })],
  ])('%s throws without a companyId', (_name, fn) => {
    expect(fn).toThrow(HistoryQueryError);
  });

  test('every builder pins `co` to the supplied company', () => {
    expect(buildRecordQuery({ companyId: 'co-a' }).co).toBe('co-a');
    expect(buildAuditQuery({ companyId: 'co-a' }).co).toBe('co-a');
    expect(buildCorrectionQuery({ companyId: 'co-a' }).co).toBe('co-a');
  });
});

describe('§26 — created by / modified by / deleted by / date range / status', () => {
  test('created by', () => {
    expect(buildRecordQuery({ companyId: 'co-a', createdBy: 'u1' }).createdByUserId).toBe('u1');
  });

  test('modified by', () => {
    expect(buildRecordQuery({ companyId: 'co-a', modifiedBy: 'u2' }).updatedByUserId).toBe('u2');
  });

  test('deleted by — and asking the question implies the administrative view', () => {
    const filter = buildRecordQuery({ companyId: 'co-a', deletedBy: 'u3' });
    expect(filter.deletedByUserId).toBe('u3');
    expect(filter.deleted).toBeUndefined();   // not forced to $ne:true, or the answer is always empty
  });

  test('an ordinary query still excludes soft-deleted rows', () => {
    expect(buildRecordQuery({ companyId: 'co-a' }).deleted).toEqual({ $ne: true });
  });

  test('an explicit administrative view includes them', () => {
    expect(buildRecordQuery({ companyId: 'co-a', includeDeleted: true }).deleted).toBeUndefined();
  });

  test('date range maps to createdAt bounds', () => {
    const filter = buildRecordQuery({ companyId: 'co-a', from: '2026-01-01', to: '2026-02-01' });
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$lte).toBeInstanceOf(Date);
  });

  test('status accepts one value or a list', () => {
    expect(buildRecordQuery({ companyId: 'co-a', status: 'DRAFT' }).status).toBe('DRAFT');
    expect(buildRecordQuery({ companyId: 'co-a', status: ['DRAFT', 'SUBMITTED'] }).status)
      .toEqual({ $in: ['DRAFT', 'SUBMITTED'] });
  });
});

describe('§26 — approved by / corrected by / reversed by come from AuditLog actions', () => {
  test('approvedBy filters on the APPROVE action and that user', () => {
    const filter = buildAuditQuery({ companyId: 'co-a', approvedBy: 'u-mgr' });
    expect(filter.user).toBe('u-mgr');
    expect(filter.action).toBe('APPROVE');
  });

  test('correctedBy covers both CORRECT and OVERRIDE', () => {
    const filter = buildAuditQuery({ companyId: 'co-a', correctedBy: 'u-mgr' });
    expect(filter.action.$in).toEqual(expect.arrayContaining(['CORRECT', 'OVERRIDE']));
  });

  test('reversedBy filters on REVERSE', () => {
    expect(buildAuditQuery({ companyId: 'co-a', reversedBy: 'u-fin' }).action).toBe('REVERSE');
  });

  test('deletedBy filters on DELETE', () => {
    expect(buildAuditQuery({ companyId: 'co-a', deletedBy: 'u-a' }).action).toBe('DELETE');
  });

  test('module and record scoping plus an explicit action list', () => {
    const filter = buildAuditQuery({
      companyId: 'co-a', resource: 'Quotation', resourceId: 'q1', actions: ['CREATE', 'UPDATE'],
    });
    expect(filter.resource).toBe('Quotation');
    expect(filter.resourceId).toBe('q1');
    expect(filter.action.$in).toEqual(['CREATE', 'UPDATE']);
  });

  test('a timestamp range is applied to AuditLog.timestamp', () => {
    const filter = buildAuditQuery({ companyId: 'co-a', from: '2026-01-01' });
    expect(filter.timestamp.$gte).toBeInstanceOf(Date);
  });
});

describe('correction history queries', () => {
  test('by record, by overriding user, by original owner, and by support-op flag', () => {
    const filter = buildCorrectionQuery({
      companyId: 'co-a', resource: 'Quotation', recordId: 'q1',
      overrideBy: 'u-mgr', originalOwner: 'u-a', supportOp: true,
    });
    expect(filter).toMatchObject({
      co: 'co-a', originalCollection: 'Quotation', originalRecordId: 'q1',
      overrideByUserId: 'u-mgr', originalCreatedByUserId: 'u-a', supportOp: true,
    });
  });
});

describe('query execution', () => {
  test('queryAuditTrail sorts newest-first and applies the limit', async () => {
    await queryAuditTrail({ companyId: 'co-a' }, { limit: 10 });
    const q = AuditLog.find.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(q.limit).toHaveBeenCalledWith(10);
  });

  test('queryCorrections sorts by overrideAt', async () => {
    await queryCorrections({ companyId: 'co-a' });
    expect(RecordCorrection.find.mock.results[0].value.sort).toHaveBeenCalledWith({ overrideAt: -1 });
  });

  test('getRecordHistory returns the combined audit trail and corrections for one record', async () => {
    const history = await getRecordHistory({ companyId: 'co-a', resource: 'Quotation', recordId: 'q1' });
    expect(history).toMatchObject({ resource: 'Quotation', recordId: 'q1' });
    expect(history.auditTrail).toHaveLength(1);
    expect(history.corrections).toHaveLength(1);
  });
});
