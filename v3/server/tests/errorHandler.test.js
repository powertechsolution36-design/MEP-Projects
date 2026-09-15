// Unit tests for the centralized error handler (PHASE 1 STEP 16) — one consistent JSON shape for
// every error response, no stack traces or internals leaked in production.
const { ApiError } = require('../src/utils/ApiError');
const { notFound, errorHandler } = require('../src/middleware/errorHandler');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('notFound', () => {
  test('404 with a consistent { error: { code, message } } shape', () => {
    const req = { method: 'GET', path: '/api/v3/nope' };
    const res = mockRes();
    notFound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });
});

describe('errorHandler', () => {
  const req = { method: 'POST', path: '/api/v3/whatever' };

  test('an ApiError is serialized with its own status/code/message', () => {
    const res = mockRes();
    errorHandler(ApiError.forbidden('Not the record owner'), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: { code: 'FORBIDDEN', message: 'Not the record owner' } });
  });

  test('a validation ApiError includes field-level details', () => {
    const res = mockRes();
    const err = ApiError.validation('Validation failed', [{ field: 'body.title', message: 'is required' }]);
    errorHandler(err, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.error.details).toEqual([{ field: 'body.title', message: 'is required' }]);
  });

  test('a raw (non-ApiError) exception becomes a generic 500 in production — message never leaked', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    const originalCors = process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-real-production-secret-value';
    process.env.CORS_ORIGIN = 'https://mep-projects.spereon.codes';
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { errorHandler: prodErrorHandler } = require('../src/middleware/errorHandler');
    const res = mockRes();
    prodErrorHandler(new Error('ECONNREFUSED 10.0.0.5:27017 — some internal DB detail'), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toMatch(/10\.0\.0\.5/);
    process.env.NODE_ENV = originalEnv;
    process.env.JWT_SECRET = originalSecret;
    process.env.CORS_ORIGIN = originalCors;
    jest.resetModules();
    jest.resetModules();
  });

  test('a raw exception in development includes the real message (useful for local debugging)', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error.message).toBe('boom');
  });
});
