/* eslint-env serviceworker */
/* global clients */

/**
 * The customer app's service worker (owner decision, 31 Oct 2026).
 *
 * Registered only by the portal, with a scope of /portal, so nothing here
 * can touch a staff screen: the staff application is never controlled by a
 * service worker and never sees this file.
 *
 * It lives at the root rather than under /portal/ for one reason: a worker's
 * scope can never be broader than its own folder, and the dashboard's URL is
 * `/portal`, with no trailing slash. Served from /portal/sw.js the worker
 * would own `/portal/complaints/…` but not `/portal` itself — so the app
 * would come back offline on every screen except the first one a client
 * opens. From the root it can claim exactly `/portal`, and nothing else.
 *
 * It does three jobs and no more:
 *
 *   1. keeps the app shell, so the portal opens from the home screen even on
 *      a bad signal and shows a plain offline page instead of the browser's
 *      dinosaur;
 *   2. serves the build's own hashed asset files from the cache, because a
 *      file whose name contains its own hash can never be stale;
 *   3. shows a notification when the server pushes one, and takes the client
 *      to the right screen when they tap it.
 *
 * What it deliberately does NOT do: cache any /api/ response. A client must
 * never be shown a complaint status, an engineer's name or a visit date that
 * is quietly out of date — those come from the network or not at all.
 */

const VERSION = 'mep-portal-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const SHELL_URL = '/portal/';

const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No connection</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f4f6f8; color:#1d2733;
         font-family:system-ui,-apple-system,"Segoe UI",sans-serif; padding:24px; }
  .box { max-width:420px; text-align:center; background:#fff; border:1px solid #e3e8ee;
         border-radius:14px; padding:32px 28px; }
  h1 { font-size:20px; margin:0 0 10px; }
  p  { margin:0; color:#6c7c8c; line-height:1.55; }
</style></head>
<body><div class="box">
  <h1>You are offline</h1>
  <p>The app will work again as soon as your phone has a signal. Anything you
     have already opened is still here.</p>
</div></body></html>`;

/**
 * The build names its own files, so the worker cannot know them in advance.
 * It reads them off the shell it has just fetched instead — which is also
 * how it knows they are the files this build actually uses.
 */
function assetUrlsIn(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/(?:assets|fonts|icons)\/[^"]+)"/g;
  let m = re.exec(html);
  while (m) { urls.add(m[1]); m = re.exec(html); }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Best effort throughout: a failed pre-cache must never block the
    // install, or the app is left with no worker at all on a flaky signal.
    try {
      const res = await fetch(new Request(SHELL_URL, { cache: 'reload' }));
      if (res && res.ok) {
        const html = await res.clone().text();
        const shell = await caches.open(SHELL);
        await shell.put(SHELL_URL, res);
        const assets = await caches.open(ASSETS);
        // Without its script and stylesheet the shell is a blank page, so
        // they are fetched now rather than hoped for later.
        await Promise.all(assetUrlsIn(html).map((u) => assets.add(u).catch(() => {})));
      }
    } catch { /* the first online navigation will fill the cache */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/**
 * A build asset. Everything the build writes into /assets/ carries a hash in
 * its own name, so a cached copy can never be the wrong one; fonts and icons
 * are versioned by hand and change about once a year.
 */
function isHashedAsset(url) {
  return url.origin === self.location.origin && /^\/(assets|fonts|icons)\/[^/]+$/.test(url.pathname);
}

function isPortalAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/portal/') && url.pathname !== SHELL_URL;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never the API, never another origin: the client sees live data or none.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // A page the client navigated to: try the network, fall back to the shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const copy = fresh.clone();
        event.waitUntil((async () => {
          const cache = await caches.open(SHELL);
          await cache.put(SHELL_URL, copy);
        })());
        return fresh;
      } catch {
        const cached = await caches.match(SHELL_URL);
        if (cached) return cached;
        return new Response(OFFLINE_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (isHashedAsset(url) || isPortalAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(ASSETS);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});

/* ---- Notifications ---------------------------------------------- *
 * The payload is written by our own server (portalPush.js). It is read
 * defensively all the same: a push that cannot be parsed still shows
 * something true rather than nothing.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'MEP Powertech';
  const options = {
    body: data.body || 'There is an update on your service call.',
    icon: '/portal/icon-192.png',
    badge: '/portal/icon-192.png',
    tag: data.tag || 'mep-portal',
    renotify: true,
    data: { url: typeof data.url === 'string' && data.url.startsWith('/portal') ? data.url : SHELL_URL },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || SHELL_URL;
  event.waitUntil((async () => {
    const open = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).pathname.startsWith('/portal') && 'focus' in client) {
        if ('navigate' in client) { try { await client.navigate(target); } catch { /* focus is enough */ } }
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
