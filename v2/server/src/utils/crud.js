const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

// Generic CRUD router factory - drastically reduces route boilerplate
function buildCrud({ model, resource, extraFilter, before, after, allowedRoles }) {
  const express = require('express');
  const router = express.Router();
  const { auth, requireRole } = require('../middleware/auth');

  function coFilter(req, id) {
    const f = id ? { _id: id } : {};
    if (req.user.role !== 'super') f.co = req.user.co;
    if (extraFilter) Object.assign(f, extraFilter(req));
    return f;
  }

  router.use(auth);
  if (allowedRoles?.length) router.use(requireRole(...allowedRoles));

  // LIST
  router.get('/', async (req, res) => {
    try {
      const f = coFilter(req);
      // Apply query filters (?status=active&div=MEP)
      for (const k of Object.keys(req.query)) {
        if (k === 'sort' || k === 'limit' || k === 'skip' || k === 'search') continue;
        f[k] = req.query[k];
      }
      let q = model.find(f);
      if (req.query.sort) q = q.sort(req.query.sort); else q = q.sort({ createdAt: -1 });
      q = q.limit(Math.min(parseInt(req.query.limit) || 500, 2000));
      if (req.query.skip) q = q.skip(parseInt(req.query.skip));
      const docs = await q.lean();
      res.json(docs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET ONE
  router.get('/:id', async (req, res) => {
    try {
      const doc = await model.findOne(coFilter(req, req.params.id)).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // CREATE
  router.post('/', async (req, res) => {
    try {
      const data = { ...req.body };
      if (req.user.role !== 'super') data.co = req.user.co;
      if (before?.create) await before.create(data, req);
      const doc = await model.create(data);
      if (after?.create) await after.create(doc, req);
      broadcastUpdate(global.io, doc.co, resource, doc);
      res.status(201).json(doc);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // UPDATE
  router.put('/:id', async (req, res) => {
    try {
      const data = { ...req.body };
      delete data.co; delete data._id;
      if (before?.update) await before.update(data, req);
      const doc = await model.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (after?.update) await after.update(doc, req);
      broadcastUpdate(global.io, doc.co, resource, doc);
      res.json(doc);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // DELETE
  router.delete('/:id', async (req, res) => {
    try {
      const doc = await model.findOneAndDelete(coFilter(req, req.params.id));
      if (!doc) return res.status(404).json({ error: 'Not found' });
      broadcastDelete(global.io, doc.co, resource, doc._id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

module.exports = { buildCrud };
