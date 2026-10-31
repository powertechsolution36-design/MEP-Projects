'use strict';
const path = require('path');
const B = path.resolve(__dirname, '../../backend');
const express = require(path.join(B, 'node_modules', 'express'));
const { createDevApp, createDevRepositories, seedDevData } = require(path.join(B, 'src/devServer'));
const { seedBusinessData } = require('./fixture');
const dist = path.resolve(__dirname, '../../frontend/dist');
// Owner decision (31 Oct 2026): the customer app can notify the client, and
// that is only switched on when a VAPID key pair is configured. A throwaway
// pair is generated here so the e2e run exercises the switched-on path; the
// real server reads its pair from the environment and never invents one.
if (!process.env.WEB_PUSH_PUBLIC_KEY || !process.env.WEB_PUSH_PRIVATE_KEY) {
  const keys = require(path.join(B, 'node_modules', 'web-push')).generateVAPIDKeys();
  process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
}

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
