const { isStateEditable } = require('../src/middleware/recordState');
const { RECORD_STATES } = require('../src/config/constants');

describe('isStateEditable', () => {
  test('DRAFT is editable', () => {
    expect(isStateEditable(RECORD_STATES.DRAFT)).toBe(true);
  });
  test('SUBMITTED is editable (workflow governs finer detail at the feature-module level)', () => {
    expect(isStateEditable(RECORD_STATES.SUBMITTED)).toBe(true);
  });
  test('REJECTED is editable (rework loop)', () => {
    expect(isStateEditable(RECORD_STATES.REJECTED)).toBe(true);
  });
  test.each([
    RECORD_STATES.APPROVED,
    RECORD_STATES.POSTED,
    RECORD_STATES.FINALIZED,
    RECORD_STATES.CLOSED,
    RECORD_STATES.LOCKED,
  ])('%s is NOT editable', (state) => {
    expect(isStateEditable(state)).toBe(false);
  });
});
