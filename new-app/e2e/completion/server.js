'use strict';
const path = require('path');
const B = path.resolve(__dirname, '../../backend');
const express = require(path.join(B, 'node_modules', 'express'));
const { createDevApp, createDevRepositories, seedDevData } = require(path.join(B, 'src/devServer'));
const { seedBusinessData } = require('./fixture');
const dist = path.resolve(__dirname, '../../frontend/dist');
(async () => {
  const deps = createDevRepositories();
  await seedDevData(deps);
  const c = deps.store.state.companies[0];
  Object.assign(c, { status: 'Active', since: new Date('2026-01-05'), city: 'Pune', subscriptionRate: 2500, subscriptionCycle: 'Monthly', subscriptionStart: new Date('2026-01-05'), subscriptionEnd: new Date(Date.now() + 10 * 86400000) });
  seedBusinessData(deps);
  const app = createDevApp(deps, { authTokenSecret: 'e2e-only-secret', authTokenExpiry: '12h' });
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.listen(4100, '127.0.0.1', () => console.log('e2e server on 4100'));
})();
