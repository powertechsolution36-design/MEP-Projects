/**
 * The customer app (owner decision, 31 Oct 2026).
 *
 * The portal is the app: a client adds it to their home screen and it opens
 * full screen, with its own icon and name, and keeps working on a bad signal.
 *
 * The install mechanics are shared with the staff application (src/pwa/
 * installable.js) — identical on both sides since 2 Nov 2026, when the
 * login page's dead "Download APK" button was replaced by a real one. What
 * stays here is the portal's own: which manifest and icon are its, and the
 * notifications, which only a client receives.
 */

import { portalApi } from './portalApi';
import { attachAppChrome, registerWorker } from '../pwa/installable';

export { isInstalled, isApple, watchInstall, showInstallPrompt } from '../pwa/installable';

const MANIFEST_URL = '/portal-app/manifest.json';
const SW_URL = '/mep-portal-sw.js';
const APPLE_ICON = '/portal-app/apple-touch-180.png';
const THEME_COLOR = '#d92b2b';

/** The portal's own manifest and icon, while the portal is on screen. */
export function attachPortalAppChrome() {
  return attachAppChrome({
    manifestUrl: MANIFEST_URL,
    appleIcon: APPLE_ICON,
    appleTitle: 'MEP Service',
    themeColor: THEME_COLOR,
  });
}

/**
 * Scoped to /portal, so it cannot reach a staff screen. The staff worker's
 * scope is the whole site, but a narrower scope wins, so a client who has
 * both keeps this one for every portal page.
 */
export function registerPortalServiceWorker() {
  return registerWorker(SW_URL, '/portal');
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

/** The server's public key arrives as base64url; the browser wants bytes. */
function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function notificationPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Is this device already subscribed? */
export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Ask the browser for permission, subscribe, and hand the subscription to our
 * server. Returns a short reason rather than throwing, so the screen can say
 * something a client understands.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const key = await portalApi.get('/api/portal/push/key').catch(() => null);
  if (!key || !key.publicKey) return { ok: false, reason: 'not-configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    });
  }
  await portalApi.post('/api/portal/push/subscribe', sub.toJSON());
  return { ok: true };
}

/** Switch them off on this device, both here and at the server. */
export async function disablePush() {
  const sub = await currentPushSubscription();
  if (!sub) return { ok: true };
  try {
    await portalApi.post('/api/portal/push/unsubscribe', { endpoint: sub.endpoint });
  } catch { /* the browser end still comes off below */ }
  try { await sub.unsubscribe(); } catch { /* already gone */ }
  return { ok: true };
}
