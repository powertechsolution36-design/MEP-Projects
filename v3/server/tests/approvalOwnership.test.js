// Phase 4 — approval authority vs record ownership (V3 PHASE 4 spec §5 / §24).
//
// "Creator → cannot approve own record when self-approval is prohibited by workflow" and
// "Approver → does NOT automatically gain Edit/Delete of creator's record". These are two different
// directions of the same rule: approval authority and ownership are independent axes, and neither
// one ever implies the other.
jest.mock('../src/models/ApprovalRequest', () => ({ findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/ApprovalStep', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({}) }));

const ApprovalRequest = require('../src/models/ApprovalRequest');
const ApprovalStep = require('../src/models/ApprovalStep');
const approvalService = require('../src/services/approvalService');
const { canDecide, isSelfApproval } = approvalService;
const { checkOwnership } = require('../src/middleware/ownership');
const { PERMISSIONS, RECORD_STATES } = require('../src/config/constants');

function lean(value) { return { lean: () => Promise.resolve(value) }; }

function requestDoc(overrides = {}) {
  const doc = {
    _id: 'req-1', co: 'co-a', requesterId: 'u-creator',
    resource: 'Quotation', resourceId: 'q1', action: 'submit',
    status: 'pending', executionStatus: null, ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  ApprovalRequest.findById.mockReset();
  ApprovalStep.find.mockReset().mockReturnValue(lean([]));
  ApprovalStep.create.mockReset().mockResolvedValue({});
});

describe('§24 — the creator cannot approve their own record', () => {
  test('isSelfApproval identifies the requester', () => {
    expect(isSelfApproval({ _id: 'u-creator' }, requestDoc())).toBe(true);
    expect(isSelfApproval({ _id: 'u-other' }, requestDoc())).toBe(false);
  });

  test('canDecide refuses the requester by DEFAULT — a workflow must opt in, never opt out', () => {
    const rule = { approvers: [{ role: 'company_admin' }] };
    expect(canDecide({ _id: 'u-creator', role: 'admin' }, rule, requestDoc())).toBe(false);
  });

  test('decide() rejects self-approval with its own error code', async () => {
    ApprovalRequest.findById.mockResolvedValue(requestDoc());
    await expect(approvalService.decide({
      req: { user: { _id: 'u-creator', co: 'co-a', permissions: [PERMISSIONS.APPROVE] } },
      requestId: 'req-1', decision: 'approve',
      rule: { approvers: [{ role: 'company_admin' }] },
    })).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(ApprovalStep.create).not.toHaveBeenCalled();
  });

  test('self-REJECTION of your own request is blocked by the same rule', async () => {
    ApprovalRequest.findById.mockResolvedValue(requestDoc());
    await expect(approvalService.decide({
      req: { user: { _id: 'u-creator', co: 'co-a', permissions: [PERMISSIONS.REJECT] } },
      requestId: 'req-1', decision: 'reject',
    })).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  test('a Super Admin has no standing exemption from separation of duties on their OWN request', async () => {
    ApprovalRequest.findById.mockResolvedValue(requestDoc({ requesterId: 'u-super' }));
    await expect(approvalService.decide({
      req: { user: { _id: 'u-super', co: 'co-a', role: 'super' } },
      requestId: 'req-1', decision: 'approve',
    })).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  test('a workflow that explicitly permits self-approval is honored', () => {
    const rule = { approvers: [{ role: 'company_admin' }], allowSelfApproval: true };
    expect(canDecide({ _id: 'u-creator', role: 'admin', designation: 'company_admin' }, rule, requestDoc())).toBe(true);
  });

  test('an authorized approver who is NOT the requester may decide', async () => {
    ApprovalRequest.findById.mockResolvedValue(requestDoc());
    const result = await approvalService.decide({
      req: { user: { _id: 'u-approver', co: 'co-a', role: 'admin', permissions: [PERMISSIONS.APPROVE] } },
      requestId: 'req-1', decision: 'approve',
      rule: { approvers: [{ role: 'admin', quorum: 1 }] },
      execute: jest.fn().mockResolvedValue({}),
    });
    expect(result.status).toBe('executed');
  });
});

describe('§24 / §5 — approval authority never confers Edit or Delete', () => {
  const othersDraft = { co: 'co-a', createdByUserId: 'u-creator', status: RECORD_STATES.DRAFT };

  test('an approver holding APPROVE cannot EDIT the creator\'s record', () => {
    const decision = checkOwnership({
      record: othersDraft,
      user: { id: 'u-approver', co: 'co-a', role: 'engineer', permissions: [PERMISSIONS.APPROVE] },
      action: 'edit', resource: 'Quotation',
    });
    expect(decision.allowed).toBe(false);
  });

  test('an approver holding APPROVE cannot DELETE the creator\'s record', () => {
    const decision = checkOwnership({
      record: othersDraft,
      user: { id: 'u-approver', co: 'co-a', role: 'engineer', permissions: [PERMISSIONS.APPROVE] },
      action: 'delete', resource: 'Quotation',
    });
    expect(decision.allowed).toBe(false);
  });

  test('the ownership gate refuses a BUSINESS action outright — it is not an edit decision (§5)', () => {
    for (const action of ['APPROVE', 'REJECT', 'ASSIGN', 'VERIFY', 'CLOSE', 'REVERSE']) {
      const decision = checkOwnership({
        record: { co: 'co-a', createdByUserId: 'u-creator', status: RECORD_STATES.DRAFT },
        user: { id: 'u-creator', co: 'co-a', role: 'engineer', permissions: ['*'] },
        action, resource: 'Quotation',
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/business action/i);
    }
  });

  test('...even for the record\'s own creator — owning a record is not authority to approve it', () => {
    const decision = checkOwnership({
      record: othersDraft,
      user: { id: 'u-creator', co: 'co-a', role: 'engineer', permissions: [PERMISSIONS.APPROVE] },
      action: 'APPROVE', resource: 'Quotation',
    });
    expect(decision.allowed).toBe(false);
  });
});
