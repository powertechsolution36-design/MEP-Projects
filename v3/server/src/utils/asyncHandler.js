// Wraps an async Express handler so a rejected promise reaches the error middleware instead of
// crashing the process — used by controllers/ so every handler doesn't need its own try/catch.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
