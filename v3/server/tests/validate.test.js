// Unit tests for the reusable request-validation middleware (PHASE 1 STEP 17).
const { validate } = require('../src/middleware/validate');

function run(schema, req) {
  const next = jest.fn();
  validate(schema)(req, {}, next);
  return next;
}

describe('validate', () => {
  test('passes through when all required fields are present and well-typed', () => {
    const next = run(
      { body: { title: { type: 'string', required: true }, qty: { type: 'number', min: 0 } } },
      { body: { title: 'Quotation A', qty: 3 }, query: {}, params: {} }
    );
    expect(next).toHaveBeenCalledWith(); // called with no error
  });

  test('missing required field -> next(ApiError) with 422 and field-level detail', () => {
    const next = run(
      { body: { title: { type: 'string', required: true } } },
      { body: {}, query: {}, params: {} }
    );
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.details[0]).toEqual({ field: 'body.title', message: 'is required' });
  });

  test('wrong type is rejected', () => {
    const next = run(
      { query: { page: { type: 'number' } } },
      { body: {}, query: { page: 'not-a-number' }, params: {} }
    );
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.details[0].field).toBe('query.page');
  });

  test('enum violation is rejected', () => {
    const next = run(
      { body: { division: { type: 'string', enum: ['SOLAR', 'MEP', 'HVAC'] } } },
      { body: { division: 'PLUMBING' }, query: {}, params: {} }
    );
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(422);
  });

  test('an optional, absent field is not an error', () => {
    const next = run(
      { body: { notes: { type: 'string' } } },
      { body: {}, query: {}, params: {} }
    );
    expect(next).toHaveBeenCalledWith();
  });

  test('params are validated too', () => {
    const next = run(
      { params: { id: { type: 'string', required: true } } },
      { body: {}, query: {}, params: {} }
    );
    const err = next.mock.calls[0][0];
    expect(err.details[0].field).toBe('params.id');
  });
});
