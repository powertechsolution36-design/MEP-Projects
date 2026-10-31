/**
 * The customer app (owner decision, 31 Oct 2026).
 *
 * The portal is the app: a client adds it to their home screen and it opens
 * full screen, with its own icon and name, and keeps working on a bad signal.
 * Everything that makes that true is here, and every piece of it is mounted
 * by the portal alone — the staff application registers no service worker,
 * gets no manifest, and is not touched by any of this.
 *
 * Nothing here throws into the app. A browser that cannot install, cannot
 * run a service worker, or has notifications switched off at the operating
 * system is a browser the portal still works in; the extra is simply absent.
 */

import { portalApi } from './portalApi';

const MANIFEST_URL = '/portal/manifest.json';
const SW_URL = '/mep-portal-sw.js';
const APPLE_ICON = '/portal/apple-touch-180.png';
const THEME_COLOR = '#d92b2b';

/** Is the portal running from the home screen rather than in a browser tab? */
export function isInstalled() {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari does not report display-mode; it sets navigator.standalone.
  return Boolean(standalone || window.navigator.standalone);
}

/** iPhone and iPad, where installing is done from the Share sheet by hand. */
export function isApple() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports itself as a Mac; a touch screen gives it away.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return iOS || iPadOS;
}

/**
 * Put the app's own manifest, icon and colour on the page while the portal is
 * open, and take them off again when it is not. Done here rather than in
 * index.html because that file is shared with the staff application, which
 * must not advertise itself as the customer app.
 */
export function attachPortalAppChrome() {
  if (typeof document === 'undefined') return () => {};
  const added = [];

  const link = (rel, href, extra = {}) => {
    const el = document.createElement('link');
    el.rel = rel;
    el.href = href;
    Object.assign(el, extra);
    el.dataset.portalApp = 'true';
    document.head.appendChild(el);
    added.push(el);
  };

  // The staff page declares its own apple-touch-icon. Two of them leave the
  // choice to Safari, so the staff one is stood down while the portal is
  // open and put back on the way out — index.html itself is never edited.
  const staffAppleIcons = [...document.querySelectorAll('link[rel="apple-touch-icon"]')];
  staffAppleIcons.forEach((el) => { el.rel = 'portal-disabled-apple-touch-icon'; });

  link('manifest', MANIFEST_URL);
  link('apple-touch-icon', APPLE_ICON);

  // iOS reads these two; Android reads the manifest.
  const meta = (name, content) => {
    const el = document.createElement('meta');
    el.name = name;
    el.content = content;
    el.dataset.portalApp = 'true';
    document.head.appendChild(el);
    added.push(el);
  };
  meta('apple-mobile-web-app-capable', 'yes');
  meta('apple-mobile-web-app-title', 'MEP Service');
  meta('apple-mobile-web-app-status-bar-style', 'default');

  // The staff page already sets a theme colour; put it back on the way out.
  const existingTheme = document.querySelector('meta[name="theme-color"]');
  const previousTheme = existingTheme ? existingTheme.content : null;
  if (existingTheme) existingTheme.content = THEME_COLOR;

  return () => {
    added.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); });
    staffAppleIcons.forEach((el) => { el.rel = 'apple-touch-icon'; });
    if (existingTheme && previousTheme !== null) existingTheme.content = previousTheme;
  };
}

/**
 * Register the service worker. Only over https (or localhost, where browsers
 * allow it for development), and only under /portal/ — its scope cannot reach
 * a staff screen even if somebody later navigates there.
 */
export async function registerPortalServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/portal' });
  } catch {
    // An unregistered service worker costs the client nothing: the portal
    // keeps working as an ordinary web page.
    return null;
  }
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
