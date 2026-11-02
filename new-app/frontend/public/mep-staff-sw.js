/* eslint-env serviceworker */

/**
 * The staff application's service worker (owner request, 2 Nov 2026).
 *
 * It exists so MEP PROJECTS can be installed on a phone from the login
 * page — a browser will not offer to install an application that cannot
 * open without a network — and so a site engineer who walks into a plant
 * room with no signal gets the app rather than the browser's error page.
 *
 * Registered by the staff application only. A client who ever visits
 * /portal keeps the portal's own worker, whose narrower scope wins for
 * every /portal page.
 *
 * WHAT IT WILL NOT DO, and the reasons matter:
 *
 *   · It never caches an /api/ response. Staff act on what they read here —
 *     a stock figure, a payment balance, an engineer's assignment. A stale
 *     number shown as current is worse than no number at all, so an API
 *     request goes to the network or it fails.
 *   · It never caches a POST, PUT, PATCH or DELETE.
 *   · It keeps only the build's own files, whose names carry their hashes,
 *     and one copy of the page shell.
 */

const VERSION = 'mep-staff-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const SHELL_URL = '/';

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
  <p>MEP PROJECTS needs a connection to show live figures. It will work again
     as soon as this device has a signal.</p>
</div></body></html>`;

/** The build names its own files; they are read off the shell it fetched. */
function assetUrlsIn(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/(?:assets|fonts|icons)\/[^"]+)"/g;
  let m = re.exec(html);
  while (m) { urls.add(m[1]); m = re.exec(html); }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch(new Request(SHELL_URL, { cache: 'reload' }));
      if (res && res.ok) {
        const html = await res.clone().text();
        const shell = await caches.open(SHELL);
        await shell.put(SHELL_URL, res);
        const assets = await caches.open(ASSETS);
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

function isBuildAsset(url) {
  return url.origin === self.location.origin && /^\/(assets|fonts|icons|staff-app)\/[^/]+$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never the API: staff read live figures or none.
  if (url.pathname.startsWith('/api/')) return;
  // The portal has a worker of its own; this one keeps out of its way.
  if (url.pathname.startsWith('/portal')) return;

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

  if (isBuildAsset(url)) {
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
