'use strict';

/**
 * Phone push notifications (owner decision, 21 Oct 2026).
 *
 * Every in-app notification is also sent to the phones (Android app) of the
 * people it concerns, through the Expo Push Service
 * (https://docs.expo.dev/push-notifications/sending-notifications/):
 *
 *   * role-targeted notifications  -> every user of the company with one of
 *     those roles;
 *   * "*" (everyone) notifications -> only the person concerned, named by the
 *     creating code in `push.userIds` (e.g. the engineer a call is assigned
 *     to), or the roles in `push.roles`. Without either, nobody is pushed --
 *     the in-app bell still shows it to everyone, as before.
 *
 * The push is sent a few seconds after the notification is created and only
 * if the notification still exists then, so a save that was rolled back
 * never pushes. Sending never blocks or fails the business action.
 */

const { ServiceError } = require('../errors');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
const PLATFORMS = ['android', 'ios'];
const BATCH = 100; // Expo: at most 100 messages per request

function assertCompanyUser(actorAuth) {
  if (!actorAuth || !actorAuth.companyId || !actorAuth.userId) {
    throw new ServiceError('Push notifications are only available for company users.', 'COMPANY_CONTEXT_REQUIRED', 403);
  }
}

function validToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token.trim());
}

async function registerDevice(input, actorAuth, deps) {
  assertCompanyUser(actorAuth);
  const token = input && typeof input.token === 'string' ? input.token.trim() : '';
  if (!validToken(token)) throw new ServiceError('Invalid push token.', 'VALIDATION_ERROR', 400);
  const platform = input && PLATFORMS.includes(input.platform) ? input.platform : 'android';
  await deps.pushDeviceRepo.upsert({ token, userId: actorAuth.userId, companyId: actorAuth.companyId, platform });
  return { registered: true };
}

async function unregisterDevice(input, actorAuth, deps) {
  assertCompanyUser(actorAuth);
  const token = input && typeof input.token === 'string' ? input.token.trim() : '';
  if (!validToken(token)) throw new ServiceError('Invalid push token.', 'VALIDATION_ERROR', 400);
  const removed = await deps.pushDeviceRepo.removeByToken(token, { userId: actorAuth.userId });
  return { removed };
}

/** User ids (as strings) a notification should be pushed to. */
async function resolveRecipientIds(notification, push, deps) {
  const roles = new Set(
    push && Array.isArray(push.roles)
      ? push.roles
      : (notification.targetRoles || []).filter((r) => r !== '*')
  );
  const ids = new Set(((push && push.userIds) || []).filter(Boolean).map(String));
  const users = deps.userRepoForEnquiry ? await deps.userRepoForEnquiry.listByCompany(notification.companyId) : [];
  const live = new Map(users.filter((u) => u.active !== false).map((u) => [String(u.id), u]));
  for (const u of live.values()) if (roles.has(u.role)) ids.add(String(u.id));
  // Only current users of this company, never anyone else.
  return [...ids].filter((id) => live.has(id));
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Push one notification. Returns { sent, removed } for tests/logging.
 * `fetchImpl` is injectable for tests.
 */
async function deliverNotification(notification, push, deps, { fetchImpl = globalThis.fetch, accessToken, logger = console } = {}) {
  const recipientIds = await resolveRecipientIds(notification, push, deps);
  if (!recipientIds.length) return { sent: 0, removed: 0 };
  const devices = await deps.pushDeviceRepo.listByUserIds(notification.companyId, recipientIds);
  if (!devices.length) return { sent: 0, removed: 0 };

  const path = push && typeof push.path === 'string' && push.path.startsWith('/') ? push.path : '/notifications';
  const messages = devices.map((d) => ({
    to: d.token,
    title: 'MEP PROJECTS',
    body: String(notification.text || '').slice(0, 900),
    data: { path, notificationId: String(notification.id || notification._id || '') },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  }));

  let sent = 0;
  let removed = 0;
  for (const batch of chunk(messages, BATCH)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json().catch(() => null);
      const tickets = (json && Array.isArray(json.data) && json.data) || [];
      for (let i = 0; i < batch.length; i += 1) {
        const t = tickets[i];
        if (t && t.status === 'ok') sent += 1;
        else if (t && t.details && t.details.error === 'DeviceNotRegistered') {
          // eslint-disable-next-line no-await-in-loop
          if (await deps.pushDeviceRepo.removeByToken(batch[i].to)) removed += 1;
        } else if (t && t.status === 'error') {
          logger.warn('[push] not sent:', t.message || (t.details && t.details.error) || 'error');
        }
      }
      if (!res.ok) logger.warn('[push] Expo push service answered', res.status, json && json.errors ? JSON.stringify(json.errors).slice(0, 300) : '');
    } catch (err) {
      logger.warn('[push] could not reach the Expo push service:', err && err.message);
    }
  }
  return { sent, removed };
}

/**
 * Wraps a notification repository so every create() also schedules a phone
 * push. Business code may pass an optional `push` object in the create data
 * ({ userIds?, roles?, path? }); it is removed before saving.
 */
function withPushNotifications(notificationRepo, deps, { delayMs = 3000, fetchImpl, accessToken, logger = console, schedule = setTimeout } = {}) {
  return {
    ...notificationRepo,
    async create(data, session) {
      const { push, ...rest } = data || {};
      const doc = await notificationRepo.create(rest, session);
      schedule(async () => {
        try {
          const id = doc && (doc.id || doc._id);
          const still = id && notificationRepo.findById ? await notificationRepo.findById(doc.companyId, id) : doc;
          if (!still) return; // the save was rolled back -- do not push
          await deliverNotification(still, push, deps, { fetchImpl, accessToken, logger });
        } catch (err) {
          logger.warn('[push] failed:', err && err.message);
        }
      }, delayMs);
      return doc;
    },
  };
}

module.exports = {
  registerDevice,
  unregisterDevice,
  resolveRecipientIds,
  deliverNotification,
  withPushNotifications,
  validToken,
  EXPO_PUSH_URL,
};
