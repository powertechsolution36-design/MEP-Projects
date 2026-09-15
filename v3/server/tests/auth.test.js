// Unit tests for the auth() middleware (src/middleware/auth.js) — STEP 17 "Authentication" tests.
// models/User is mocked so this file never needs a live DB connection; the token itself is a REAL
// JWT signed with the same secret env.js resolves (mirroring a v2-issued token in dev/test mode).
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));

const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const { auth } = require('../src/middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware', () => {
  afterEach(() => jest.clearAllMocks());

  test('valid V2-compatible JWT + enabled user -> accepted, req.user and req.authContext set', async () => {
    const token = jwt.sign({ id: 'u1' }, env.JWT_SECRET, { expiresIn: '1h' });
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'u1', name: 'Test', co: 'co-1', role: 'engineer', disabled: false }) }) });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user._id).toBe('u1');
    // A legacy 'engineer' role with no designation/department set gets normalized via
    // services/roleResolver.js (ROLE_HIERARCHY.md §5) — designation resolves to 'engineer',
    // department/division stay null per "Do NOT assume new engineers have a division set".
    expect(req.authContext).toEqual({
      userId: 'u1', companyId: 'co-1', role: 'engineer', legacyRole: 'engineer',
      designation: 'engineer', department: null, division: null,
    });
    expect(req.user.designation).toBe('engineer');
  });

  test('legacy role with no designation/department resolves via roleResolver (hvac_dm -> hvac_manager)', async () => {
    const token = jwt.sign({ id: 'u3' }, env.JWT_SECRET);
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'u3', co: 'co-1', role: 'hvac_dm', disabled: false }) }) });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(req.user.designation).toBe('hvac_manager');
    expect(req.user.department).toBe('HVAC');
    expect(req.user.division).toBe('HVAC');
    expect(req.user.role).toBe('hvac_dm'); // legacy role field itself is never rewritten
  });

  test('v3-native user with designation+department already set is passed through unchanged', async () => {
    const token = jwt.sign({ id: 'u4' }, env.JWT_SECRET);
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'u4', co: 'co-1', role: 'admin', designation: 'sales_manager', department: 'SALES', division: null, disabled: false }) }) });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(req.user.designation).toBe('sales_manager');
    expect(req.user.department).toBe('SALES');
  });

  test('no token -> 401', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('invalid JWT (wrong signature) -> 401', async () => {
    const badToken = jwt.sign({ id: 'u1' }, 'a-completely-different-secret');
    const req = { headers: { authorization: `Bearer ${badToken}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('malformed token -> 401 (never a crash)', async () => {
    const req = { headers: { authorization: 'Bearer not-a-jwt-at-all' } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('disabled user -> rejected (401), even with a valid signature', async () => {
    const token = jwt.sign({ id: 'u2' }, env.JWT_SECRET);
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'u2', disabled: true }) }) });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('user not found -> 401', async () => {
    const token = jwt.sign({ id: 'ghost' }, env.JWT_SECRET);
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('password field is never present on req.user (queried out, not just filtered)', async () => {
    const token = jwt.sign({ id: 'u1' }, env.JWT_SECRET);
    // Simulate the DB genuinely not returning `pw` because .select('-pw') was applied — the mock
    // itself proves the query chain was called correctly.
    const selectMock = jest.fn().mockReturnValue({ lean: () => Promise.resolve({ _id: 'u1', name: 'Test', disabled: false }) });
    User.findById.mockReturnValue({ select: selectMock });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    await auth(req, res, next);
    expect(selectMock).toHaveBeenCalledWith('-pw');
    expect(req.user.pw).toBeUndefined();
  });
});
