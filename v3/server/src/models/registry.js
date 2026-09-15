// Model registry for v3 — every v3 model MUST be defined through this helper, on v3's own
// connection (db/connection.js), never on the default mongoose connection. This is the single
// place that enforces "v3 never collides with v2's model registry" (BUILD_BASELINE.md §12, item 1).
//
// LAZY BY DESIGN: model files are required at module-load time throughout the app (middleware
// files require their models at the top), which happens BEFORE index.js calls connectV3DB() in
// start(). If defineModel() called connection.model(...) eagerly, every such require would throw
// "connectV3DB() must be called before getV3Connection()" before the server ever got a chance to
// connect. The Proxy below defers the actual connection/model lookup until the model is first
// USED (e.g. `User.findById(...)`), by which point the app has finished connecting.
const { getV3Connection } = require('../db/connection');

function defineModel(name, schema, collectionName) {
  let cached = null;
  function resolve() {
    if (!cached) {
      const conn = getV3Connection();
      cached = conn.models[name] || conn.model(name, schema, collectionName);
    }
    return cached;
  }
  return new Proxy(function () {}, {
    get(_target, prop) {
      const model = resolve();
      const value = model[prop];
      return typeof value === 'function' ? value.bind(model) : value;
    },
    apply(_target, _thisArg, args) {
      // Supports `new Model(...)` style construction if ever needed.
      const Model = resolve();
      return new Model(...args);
    },
    construct(_target, args) {
      const Model = resolve();
      return new Model(...args);
    },
  });
}

module.exports = { defineModel };
