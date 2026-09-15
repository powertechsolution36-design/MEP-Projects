// Phase 4 — reusable record policy (V3 PHASE 4 spec §5 / §9 / §11 / §12 / §15 / §16).
const {
  isRecordMutationAction, isBusinessAction,
  canEditInState, canDeleteInState, canMutateInState,
  defineResourcePolicy, getResourcePolicy, clearResourcePolicies,
  immutableFieldsFor, GLOBAL_IMMUTABLE_FIELDS, DELETE_POLICY,
} = require('../src/config/recordPolicy');
const { RECORD_STATES } = require('../src/config/constants');

afterEach(() => clearResourcePolicies());

describe('§5 — BUSINESS ACTION ≠ RECORD EDIT', () => {
  test('edit/update/delete/correct/restore are record mutations', () => {
    for (const action of ['edit', 'update', 'delete', 'correct', 'restore']) {
      expect(isRecordMutationAction(action)).toBe(true);
      expect(isBusinessAction(action)).toBe(false);
    }
  });

  test('APPROVE/REJECT/ASSIGN/VERIFY/CLOSE/SUBMIT/RAISE_TO_FINANCE/REVERSE are business actions, never mutations', () => {
    for (const action of ['APPROVE', 'REJECT', 'ASSIGN', 'VERIFY', 'CLOSE', 'SUBMIT', 'RAISE_TO_FINANCE', 'REVERSE']) {
      expect(isBusinessAction(action)).toBe(true);
      expect(isRecordMutationAction(action)).toBe(false);
    }
  });

  test('the two sets are disjoint — no action is ever both', () => {
    const all = ['edit', 'update', 'delete', 'correct', 'restore', 'APPROVE', 'REJECT', 'ASSIGN', 'VERIFY', 'CLOSE', 'SUBMIT', 'REVERSE'];
    for (const a of all) expect(isRecordMutationAction(a) && isBusinessAction(a)).toBe(false);
  });
});

describe('§9 — edit eligibility by state', () => {
  test('DRAFT / SUBMITTED / REJECTED are editable by default', () => {
    for (const state of [RECORD_STATES.DRAFT, RECORD_STATES.SUBMITTED, RECORD_STATES.REJECTED]) {
      expect(canEditInState(state, 'Quotation').allowed).toBe(true);
    }
  });

  test('APPROVED / POSTED / FINALIZED / CLOSED / LOCKED block a normal edit', () => {
    for (const state of [RECORD_STATES.APPROVED, RECORD_STATES.POSTED, RECORD_STATES.FINALIZED, RECORD_STATES.CLOSED, RECORD_STATES.LOCKED]) {
      const d = canEditInState(state, 'Quotation');
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/locked/i);
    }
  });

  test('a module may declare a NARROWER edit window than the platform default', () => {
    defineResourcePolicy('StrictThing', { editableStates: [RECORD_STATES.DRAFT] });
    expect(canEditInState(RECORD_STATES.DRAFT, 'StrictThing').allowed).toBe(true);
    expect(canEditInState(RECORD_STATES.SUBMITTED, 'StrictThing').allowed).toBe(false);
  });
});

describe('§11 — delete policy is STRICTER than edit', () => {
  test('DRAFT is the only state with a normal creator delete', () => {
    expect(canDeleteInState(RECORD_STATES.DRAFT, 'Quotation').allowed).toBe(true);
  });

  test('SUBMITTED and APPROVED are restricted — editable but NOT normally deletable', () => {
    for (const state of [RECORD_STATES.SUBMITTED, RECORD_STATES.APPROVED]) {
      expect(canDeleteInState(state, 'Quotation').allowed).toBe(false);
    }
    // the asymmetry is the whole point: SUBMITTED can still be edited
    expect(canEditInState(RECORD_STATES.SUBMITTED, 'Quotation').allowed).toBe(true);
  });

  test('POSTED / FINALIZED / CLOSED / LOCKED have no normal delete at all — reversal only', () => {
    for (const state of [RECORD_STATES.POSTED, RECORD_STATES.FINALIZED, RECORD_STATES.CLOSED, RECORD_STATES.LOCKED]) {
      const d = canDeleteInState(state, 'Quotation');
      expect(d.allowed).toBe(false);
      expect(d.policy).toBe('NONE');
      expect(DELETE_POLICY[state]).toBe('NONE');
    }
  });

  test('a financial resource has NO delete in any state, including DRAFT (§25)', () => {
    defineResourcePolicy('Payment', { financial: true });
    for (const state of Object.values(RECORD_STATES)) {
      const d = canDeleteInState(state, 'Payment');
      expect(d.allowed).toBe(false);
    }
    expect(canDeleteInState(RECORD_STATES.DRAFT, 'Payment').reason).toMatch(/reversal/i);
  });

  test('a financial resource cannot re-enable delete by declaring deletableStates', () => {
    defineResourcePolicy('Invoice', { financial: true, deletableStates: [RECORD_STATES.DRAFT, RECORD_STATES.POSTED] });
    expect(getResourcePolicy('Invoice').deletableStates).toEqual([]);
    expect(canDeleteInState(RECORD_STATES.DRAFT, 'Invoice').allowed).toBe(false);
  });

  test('canMutateInState routes delete and edit to different rules', () => {
    expect(canMutateInState(RECORD_STATES.SUBMITTED, 'edit', 'Quotation').allowed).toBe(true);
    expect(canMutateInState(RECORD_STATES.SUBMITTED, 'delete', 'Quotation').allowed).toBe(false);
  });
});

describe('§12 / §16 — immutable fields', () => {
  test('the global minimum set is always present for any resource, declared or not', () => {
    const fields = immutableFieldsFor('NeverDeclared');
    for (const field of ['_id', 'co', 'companyId', 'createdByUserId', 'createdAt']) {
      expect(fields).toContain(field);
    }
    expect(GLOBAL_IMMUTABLE_FIELDS).toContain('createdByUserId');
  });

  test('approval / audit / ledger history fields are immutable to an ordinary update', () => {
    const fields = immutableFieldsFor('Quotation');
    for (const field of ['approvalHistory', 'auditTrail', 'postedAt', 'ledgerEntries', 'reversedAt']) {
      expect(fields).toContain(field);
    }
  });

  test('a module adds its own immutable fields ON TOP of the global set, never instead of it', () => {
    defineResourcePolicy('StockLedgerLine', { immutableFields: ['postedQty', 'batchNo'] });
    const fields = immutableFieldsFor('StockLedgerLine');
    expect(fields).toContain('postedQty');
    expect(fields).toContain('batchNo');
    expect(fields).toContain('createdByUserId');
  });
});

describe('§15 — resource policy registry', () => {
  test('an undeclared resource still gets a safe default policy', () => {
    const policy = getResourcePolicy('BrandNewModule');
    expect(policy.overridePermission).toBe('BrandNewModule.override');
    expect(policy.deletableStates).toEqual([RECORD_STATES.DRAFT]);
    expect(policy.financial).toBe(false);
  });

  test('the override permission is resource-scoped, never a generic role', () => {
    defineResourcePolicy('Quotation');
    expect(getResourcePolicy('Quotation').overridePermission).toBe('Quotation.override');
  });

  test('softDelete:false removes the delete path entirely', () => {
    defineResourcePolicy('AuditView', { softDelete: false });
    expect(canDeleteInState(RECORD_STATES.DRAFT, 'AuditView').allowed).toBe(false);
  });
});
