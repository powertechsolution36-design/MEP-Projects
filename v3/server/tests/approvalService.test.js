// Tests for services/approvalService.js — submit/decide/execute, idempotency, duplicate-decision
// rejection, quorum, and invalidation-on-edit. Models and auditService are mocked so this file never
// needs a live DB connection.
jest.mock('../src/models/ApprovalRequest', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models/ApprovalStep', () => ({
  find: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/services/auditService', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));

const ApprovalRequest = require('../src/models/ApprovalRequest');
const ApprovalStep = require('../src/models/ApprovalStep');
const { audit } = require('../src/services/auditService');
const approvalService = require('../src/services/approvalService');

// approvalService.submit()/decide() call `.lean()` on findOne()/find() results (matching the
// .lean() convention used throughout the rest of the v3 codebase) — these mocks return the same
// chainable shape.
function lean(value) {
  return { lean: () => Promise.resolve(value) };
}

function mockReq(user) {
  return { user };
}

function fakeRequestDoc(overrides = {}) {
  const doc = {
    _id: 'req-1',
    co: 'co-a',
    requesterId: 'u-requester',
    resource: 'quotation',
    resourceId: 'quo-1',
    action: 'submit',
    status: 'pending',
    executionStatus: null,
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

describe('approvalService.submit', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates a new pending ApprovalRequest and writes a SUBMIT audit entry', async () => {
    ApprovalRequest.findOne.mockReturnValueOnce(lean(null)); // no idempotencyKey hit
    ApprovalRequest.findOne.mockReturnValueOnce(lean(null)); // no existing pending
    ApprovalRequest.create.mockResolvedValue(fakeRequestDoc());

    const req = mockReq({ _id: 'u1', co: 'co-a' });
    const result = await approvalService.submit({ req, resource: 'quotation', resourceId: 'quo-1', action: 'submit' });

    expect(ApprovalRequest.create).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBMIT' }));
    expect(result.status).toBe('pending');
  });

  test('a retried submit with the same idempotencyKey returns the existing request, never creates a second one', async () => {
    const existing = fakeRequestDoc({ idempotencyKey: 'key-1' });
    ApprovalRequest.findOne.mockReturnValueOnce(lean(existing));

    const req = mockReq({ _id: 'u1', co: 'co-a' });
    const result = await approvalService.submit({ req, resource: 'quotation', resourceId: 'quo-1', action: 'submit', idempotencyKey: 'key-1' });

    expect(result).toBe(existing);
    expect(ApprovalRequest.create).not.toHaveBeenCalled();
  });

  test('a second submit for the same (resource, resourceId, action) while one is already pending returns the existing pending request', async () => {
    const existingPending = fakeRequestDoc();
    // No idempotencyKey is passed in this call, so submit() issues exactly one findOne() — the
    // existing-pending-request check — which this single mock answers.
    ApprovalRequest.findOne.mockReturnValueOnce(lean(existingPending));

    const req = mockReq({ _id: 'u1', co: 'co-a' });
    const result = await approvalService.submit({ req, resource: 'quotation', resourceId: 'quo-1', action: 'submit' });

    expect(result).toBe(existingPending);
    expect(ApprovalRequest.create).not.toHaveBeenCalled();
  });
});

describe('approvalService.decide', () => {
  afterEach(() => jest.clearAllMocks());

  test('approve() with quorum 1 transitions to approved then executed, and executes exactly once', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([]));
    ApprovalStep.create.mockResolvedValue({});
    const execute = jest.fn().mockResolvedValue(undefined);

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    const result = await approvalService.decide({ req, requestId: 'req-1', decision: 'approve', rule: { approvers: [{ role: 'company_admin', quorum: 1 }] }, execute });

    expect(result.status).toBe('executed');
    expect(result.executionStatus).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('reject() transitions to rejected and never calls execute', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([]));
    ApprovalStep.create.mockResolvedValue({});
    const execute = jest.fn();

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin', permissions: ['REJECT'] });
    const result = await approvalService.decide({ req, requestId: 'req-1', decision: 'reject', note: 'Not valid', execute });

    expect(result.status).toBe('rejected');
    expect(execute).not.toHaveBeenCalled();
  });

  test('duplicate-approve: deciding an already-approved/executed request throws ALREADY_DECIDED, never re-executes', async () => {
    const request = fakeRequestDoc({ status: 'executed', executionStatus: 'succeeded' });
    ApprovalRequest.findById.mockResolvedValue(request);
    const execute = jest.fn();

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'approve', execute }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('duplicate-reject: deciding an already-rejected request throws ALREADY_DECIDED', async () => {
    const request = fakeRequestDoc({ status: 'rejected' });
    ApprovalRequest.findById.mockResolvedValue(request);

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'reject' }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  test('a user with no approval authority (no matching rule entry, no APPROVE/REJECT permission) is denied', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([]));

    const req = mockReq({ _id: 'u-nobody', co: 'co-a', role: 'engineer', designation: 'engineer', permissions: [] });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'approve', rule: { approvers: [{ role: 'company_admin' }] } }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('the same approver deciding twice on one request is rejected even before quorum is met', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([{ requestId: 'req-1', approverId: 'approver-1', decision: 'approve' }]));

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'approve', rule: { approvers: [{ role: 'company_admin', quorum: 2 }] } }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  test('quorum > 1: first approval keeps the request pending, does not execute', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([]));
    ApprovalStep.create.mockResolvedValue({});
    const execute = jest.fn();

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    const result = await approvalService.decide({ req, requestId: 'req-1', decision: 'approve', rule: { approvers: [{ role: 'company_admin', quorum: 2 }] }, execute });

    expect(result.status).toBe('pending');
    expect(execute).not.toHaveBeenCalled();
  });

  test('cross-company decide attempt is denied', async () => {
    const request = fakeRequestDoc({ co: 'co-a' });
    ApprovalRequest.findById.mockResolvedValue(request);

    const req = mockReq({ _id: 'approver-1', co: 'co-b', role: 'company_admin', designation: 'company_admin' });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'approve' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a failed execute() marks executionStatus failed and rethrows, never silently marks executed', async () => {
    const request = fakeRequestDoc();
    ApprovalRequest.findById.mockResolvedValue(request);
    ApprovalStep.find.mockReturnValue(lean([]));
    ApprovalStep.create.mockResolvedValue({});
    const execute = jest.fn().mockRejectedValue(new Error('downstream failure'));

    const req = mockReq({ _id: 'approver-1', co: 'co-a', role: 'company_admin', designation: 'company_admin' });
    await expect(approvalService.decide({ req, requestId: 'req-1', decision: 'approve', rule: { approvers: [{ role: 'company_admin', quorum: 1 }] }, execute }))
      .rejects.toThrow('downstream failure');
    expect(request.executionStatus).toBe('failed');
  });
});

describe('approvalService.invalidatePending', () => {
  afterEach(() => jest.clearAllMocks());

  test('an approval-relevant edit expires all pending requests for that resource, never silently deletes them', async () => {
    const pending = [fakeRequestDoc(), fakeRequestDoc({ _id: 'req-2' })];
    ApprovalRequest.find.mockResolvedValue(pending);

    const req = mockReq({ _id: 'editor-1', co: 'co-a' });
    const count = await approvalService.invalidatePending({ req, resource: 'quotation', resourceId: 'quo-1', reason: 'Amount changed' });

    expect(count).toBe(2);
    for (const p of pending) {
      expect(p.status).toBe('expired');
      expect(p.save).toHaveBeenCalled();
    }
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REJECT', reason: 'Amount changed' }));
  });
});
