// Reusable request validation (PHASE 1 STEP 17) — params/query/body, no per-route duplication, and
// runs before any business handler. Deliberately dependency-free (no joi/zod) for a foundation this
// thin; the schema shape below is small enough that swapping in a real validation library later is a
// mechanical change confined to this one file.
//
// Schema shape:
//   validate({
//     body:   { title: { type: 'string', required: true }, qty: { type: 'number', min: 0 } },
//     query:  { page: { type: 'number' } },
//     params: { id: { type: 'string', required: true } },
//   })
const { ApiError } = require('../utils/ApiError');

function checkField(part, field, rule, value) {
  const present = value !== undefined && value !== null && value !== '';
  if (rule.required && !present) return { field: `${part}.${field}`, message: 'is required' };
  if (!present) return null; // optional and absent — nothing else to check

  if (rule.type === 'string' && typeof value !== 'string') {
    return { field: `${part}.${field}`, message: 'must be a string' };
  }
  if (rule.type === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return { field: `${part}.${field}`, message: 'must be a number' };
    if (rule.min !== undefined && num < rule.min) return { field: `${part}.${field}`, message: `must be >= ${rule.min}` };
    if (rule.max !== undefined && num > rule.max) return { field: `${part}.${field}`, message: `must be <= ${rule.max}` };
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    return { field: `${part}.${field}`, message: 'must be a boolean' };
  }
  if (rule.enum && !rule.enum.includes(value)) {
    return { field: `${part}.${field}`, message: `must be one of: ${rule.enum.join(', ')}` };
  }
  if (rule.type === 'string' && rule.minLength !== undefined && value.length < rule.minLength) {
    return { field: `${part}.${field}`, message: `must be at least ${rule.minLength} characters` };
  }
  if (rule.type === 'string' && rule.maxLength !== undefined && value.length > rule.maxLength) {
    return { field: `${part}.${field}`, message: `must be at most ${rule.maxLength} characters` };
  }
  return null;
}

function validate(schema = {}) {
  return (req, res, next) => {
    const errors = [];
    for (const part of ['params', 'query', 'body']) {
      const partSchema = schema[part];
      if (!partSchema) continue;
      const data = req[part] || {};
      for (const [field, rule] of Object.entries(partSchema)) {
        const problem = checkField(part, field, rule, data[field]);
        if (problem) errors.push(problem);
      }
    }
    if (errors.length) return next(ApiError.validation('Validation failed', errors));
    next();
  };
}

module.exports = { validate };
