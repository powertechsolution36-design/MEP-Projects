/* MEP PROJECTS — kill-switch service worker
   Unregisters itself and clears all caches on load.
   This fixes broken SW state on old browsers that had the previous PWA installed. */

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Delete all caches
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      // Unregister this SW
      await self.registration.unregister();
      // Take control of all clients and reload them
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});

// Never intercept any fetch - let everything pass through to network
self.addEventListener('fetch', (e) => {
  // Intentionally empty - do not respond, browser handles normally
});
