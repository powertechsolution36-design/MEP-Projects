/**
 * Bridge to the MEP PROJECTS Android app for phone push notifications
 * (owner decision, 21 Oct 2026).
 *
 * Inside the app the website runs in a WebView that exposes
 * window.ReactNativeWebView. The website asks the app for this phone's Expo
 * push token; the app answers by dispatching a `mep:pushToken` event (and
 * keeps the latest in window.__mepPushToken). In a normal browser none of
 * this exists and every function here is a no-op.
 */

export function inNativeApp() {
  return typeof window !== 'undefined' && !!window.ReactNativeWebView;
}

export function currentPushToken() {
  if (typeof window === 'undefined') return null;
  const t = window.__mepPushToken;
  return t && typeof t.token === 'string' ? t : null;
}

/** Calls `cb({ token, platform })` once the app provides a token. Returns an unsubscribe function. */
export function onPushToken(cb) {
  if (!inNativeApp()) return () => {};
  const handler = (e) => { if (e && e.detail && e.detail.token) cb(e.detail); };
  window.addEventListener('mep:pushToken', handler);
  const existing = currentPushToken();
  if (existing) cb(existing);
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mep:requestPushToken' }));
  } catch {
    /* older app without push support: nothing to do */
  }
  return () => window.removeEventListener('mep:pushToken', handler);
}
