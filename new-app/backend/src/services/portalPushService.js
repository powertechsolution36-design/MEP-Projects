'use strict';

/**
 * Notifications to the customer app (owner decision, 31 Oct 2026).
 *
 * The customer app is the portal added to a client's home screen, so these
 * are Web Push messages, signed with a VAPID key pair and encrypted to the
 * one browser that subscribed. They are nothing to do with the Expo push
 * the staff Android app uses (services/pushService.js) and share no key,
 * no table and no code path with it.
 *
 * TWO RULES GOVERN EVERYTHING HERE.
 *
 * 1. A client is told only about their own contract. A send is addressed by
 *    (companyId, contractId) — never by an endpoint a request supplied, and
 *    never to a list assembled anywhere but this file.
 *
 * 2. Sending never fails the work. An engineer gets assigned, a report gets
 *    filed, whatever the push service is doing. Every failure here is
 *    swallowed and logged without its payload.
 *
 * UNCONFIGURED IS A SUPPORTED STATE. Without WEB_PUSH_PUBLIC_KEY and
 * WEB_PUSH_PRIVATE_KEY in the environment the feature is simply off: the key
 * endpoint says so, the app hides the switch, and a send is a no-op. That is
 * what runs until somebody generates a pair, so it is the state that must
 * behave well.
 */

const { ServiceError } = require('../errors');

let webpush = null;
try {
  // eslint-disable-next-line global-require
  webpush = require('web-push');
} catch {
  // The library is a dependency; if it is somehow absent the feature is off
  // rather than the server being unstartable.
  webpush = null;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

let cached = null;

/**
 * Read the key pair from the environment. A public key without a private one
 * (or the other way round) is a misconfiguration, not a half-working
 * feature: it is treated as off.
 */
function config(env = process.env) {
  if (cached && cached.env === env) return cached.value;
  const publicKey = String(env.WEB_PUSH_PUBLIC_KEY || '').trim();
  const privateKey = String(env.WEB_PUSH_PRIVATE_KEY || '').trim();
  const subject = String(env.WEB_PUSH_SUBJECT || 'mailto:service@mep-powertech.invalid').trim();
  const value = publicKey && privateKey && webpush ? { publicKey, privateKey, subject } : null;
  cached = { env, value };
  return value;
}

/** Tests and a changed environment both need the cache to let go. */
function resetConfigCache() {
  cached = null;
}

function isConfigured(env = process.env) {
  return Boolean(config(env));
}

/** What the browser needs to subscribe. Empty when the feature is off. */
function publicKey(env = process.env) {
  const c = config(env);
  return c ? c.publicKey : '';
}

/* ------------------------------------------------------------------ *
 * Subscribing
 * ------------------------------------------------------------------ */

const ENDPOINT_MAX = 1000;

/**
 * A subscription as the browser minted it. Checked for shape only — the
 * endpoint belongs to Google, Apple or Mozilla, so there is nothing here we
 * could meaningfully verify beyond that it is an https URL we can post to.
 */
function readSubscription(body) {
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const keys = (body && body.keys) || {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

  if (!endpoint || endpoint.length > ENDPOINT_MAX) {
    throw new ServiceError('That notification subscription is not valid.', 'VALIDATION_ERROR', 400);
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ServiceError('That notification subscription is not valid.', 'VALIDATION_ERROR', 400);
  }
  if (url.protocol !== 'https:') {
    throw new ServiceError('That notification subscription is not valid.', 'VALIDATION_ERROR', 400);
  }
  if (!p256dh || !auth) {
    throw new ServiceError('That notification subscription is not valid.', 'VALIDATION_ERROR', 400);
  }
  return { endpoint, p256dh, auth };
}

/**
 * Remember this device for this client. The company and the contract come
 * from the session, never from the request, so a client can only ever
 * subscribe themselves to their own record.
 */
async function subscribe(auth, body, deps, { env = process.env } = {}) {
  if (!deps.portalPushRepo) return { subscribed: false, reason: 'NOT_AVAILABLE' };
  if (!isConfigured(env)) return { subscribed: false, reason: 'NOT_CONFIGURED' };

  const sub = readSubscription(body);
  await deps.portalPushRepo.upsert({
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    companyId: auth.companyId,
    contractId: auth.contractId,
    customerAccountId: auth.accountId,
    userAgent: typeof (body && body.userAgent) === 'string' ? body.userAgent.slice(0, 200) : '',
  });
  return { subscribed: true };
}

/**
 * Stop notifications on one device. Scoped to the caller's own account, so
 * knowing another client's endpoint does not let anybody switch theirs off.
 */
async function unsubscribe(auth, body, deps) {
  if (!deps.portalPushRepo) return { removed: false };
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!endpoint) return { removed: false };
  const removed = await deps.portalPushRepo.removeForAccount(auth.accountId, endpoint);
  return { removed: Boolean(removed) };
}

/** Every device signed in on this account — used when the client signs out. */
async function removeAllForAccount(accountId, deps) {
  if (!deps.portalPushRepo || !accountId) return { removed: 0 };
  return { removed: await deps.portalPushRepo.removeAllForAccount(accountId) };
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

const MAX_BODY = 160;

/** What is actually shown on the lock screen. Short, true, and no money. */
function buildPayload({ title, body, url, tag }) {
  return JSON.stringify({
    title: String(title || 'MEP Powertech').slice(0, 80),
    body: String(body || '').slice(0, MAX_BODY),
    url: typeof url === 'string' && url.startsWith('/portal') ? url : '/portal/',
    tag: String(tag || 'mep-portal').slice(0, 60),
  });
}

/**
 * Send to every device registered against one contract.
 *
 * A push service answering 404 or 410 means that browser is gone for good
 * (the app was uninstalled, or the subscription expired); the row is deleted
 * so the list does not grow stale forever. Any other failure is left alone —
 * it is usually the network, and the device is still real.
 *
 * @returns {Promise<{sent:number, removed:number, reason?:string}>}
 */
async function sendToContract(companyId, contractId, message, deps, { env = process.env, logger = console, sender } = {}) {
  const cfg = config(env);
  if (!cfg || !deps.portalPushRepo || !companyId || !contractId) {
    return { sent: 0, removed: 0, reason: cfg ? 'NOT_AVAILABLE' : 'NOT_CONFIGURED' };
  }

  let devices = [];
  try {
    devices = await deps.portalPushRepo.listForContract(companyId, contractId);
  } catch (err) {
    logger.warn('[portalPush] could not read the subscriptions:', err && err.message);
    return { sent: 0, removed: 0, reason: 'READ_FAILED' };
  }
  if (!devices.length) return { sent: 0, removed: 0 };

  const payload = buildPayload(message);
  // `deps.webPushSender` exists so a test can watch what would be sent
  // without a network call. Production leaves it unset and uses the library.
  const send = sender || deps.webPushSender || ((device, data) => webpush.sendNotification(
    { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
    data,
    { vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, TTL: 60 * 60 * 24 }
  ));

  let sent = 0;
  let removed = 0;
  await Promise.all(devices.map(async (device) => {
    try {
      await send(device, payload);
      sent += 1;
    } catch (err) {
      const status = err && (err.statusCode || err.status);
      if (status === 404 || status === 410) {
        try {
          if (await deps.portalPushRepo.removeByEndpoint(device.endpoint)) removed += 1;
        } catch { /* it will be tried again next time */ }
      } else {
        // Never the payload, never the endpoint: a push endpoint is a secret
        // belonging to that one browser.
        logger.warn('[portalPush] not delivered:', status || (err && err.name) || 'error');
      }
    }
  }));

  return { sent, removed };
}

/* ---- The four things a client is told --------------------------- *
 * Each one is written here rather than at the call site, so the wording a
 * client sees is in one place and cannot drift between screens.
 */

function messageFor(event, ctx = {}) {
  const ref = ctx.complaintNumber ? `PSC-${ctx.complaintNumber}` : 'your complaint';
  const url = ctx.complaintId ? `/portal/complaints/${ctx.complaintId}` : '/portal/';
  const tag = ctx.complaintId ? `complaint-${ctx.complaintId}` : 'mep-portal';

  switch (event) {
    case 'engineer_assigned':
      return {
        title: 'An engineer is on the way',
        body: ctx.engineerName
          ? `${ctx.engineerName} has been assigned to ${ref}.`
          : `An engineer has been assigned to ${ref}.`,
        url,
        tag,
      };
    case 'visit_arranged':
      return {
        title: 'Your visit is arranged',
        body: `${ref}: ${ctx.appointmentText || 'a date has been set'}.`,
        url,
        tag,
      };
    case 'work_completed':
      return {
        title: 'Your service report is ready',
        body: `The visit for ${ref} is finished. Tap to read the report.`,
        url,
        tag,
      };
    case 'project_update':
      return {
        title: 'An update on your project',
        body: String(ctx.text || 'There is news on your project.').slice(0, MAX_BODY),
        url: ctx.projectId ? `/portal/projects/${ctx.projectId}` : '/portal/',
        tag: ctx.projectId ? `project-${ctx.projectId}` : 'mep-portal',
      };
    default:
      return null;
  }
}

/**
 * A project update reaches whoever is watching that project, which is a
 * different list from a complaint's: project access is a link on the
 * client's account, not a contract. The contracts behind those accounts are
 * resolved here, so sending still goes through the one addressed path above.
 */
async function sendToProjectWatchers(companyId, projectId, message, deps, options = {}) {
  if (!deps.customerAccountRepo || typeof deps.customerAccountRepo.listByCompany !== 'function') {
    return { sent: 0, removed: 0, reason: 'NOT_AVAILABLE' };
  }
  const accounts = await deps.customerAccountRepo.listByCompany(companyId);
  const contractIds = [...new Set(
    (accounts || [])
      .filter((a) => a.status === 'Active' && (a.linkedProjectIds || []).map(String).includes(String(projectId)))
      .map((a) => String(a.contractId || ''))
      .filter(Boolean)
  )];

  let sent = 0;
  let removed = 0;
  for (const contractId of contractIds) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendToContract(companyId, contractId, message, deps, options);
    sent += r.sent;
    removed += r.removed;
  }
  return { sent, removed };
}

/**
 * The one call business code makes. Never throws, never waits on anything it
 * does not have to, and does nothing at all when the feature is off.
 */
async function notifyClient(event, ctx, deps, options = {}) {
  try {
    const message = messageFor(event, ctx);
    if (!message) return { sent: 0, removed: 0, reason: 'UNKNOWN_EVENT' };
    if (event === 'project_update') {
      return await sendToProjectWatchers(ctx.companyId, ctx.projectId, message, deps, options);
    }
    return await sendToContract(ctx.companyId, ctx.contractId, message, deps, options);
  } catch (err) {
    const logger = options.logger || console;
    logger.warn('[portalPush] failed:', err && err.message);
    return { sent: 0, removed: 0, reason: 'ERROR' };
  }
}

module.exports = {
  config,
  resetConfigCache,
  isConfigured,
  publicKey,
  readSubscription,
  subscribe,
  unsubscribe,
  removeAllForAccount,
  buildPayload,
  messageFor,
  sendToContract,
  sendToProjectWatchers,
  notifyClient,
};
