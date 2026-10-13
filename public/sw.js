// static-rss / nyc-feed no longer work offline (2026-10-13). Phones and laptops that
// installed the old worker get this one on their next update check: it deletes this app's
// caches, unregisters itself and reloads open pages from the network. Only 'static-rss /...'
// caches: the origin is shared with /reader/ and others.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil((async () => {
  var keys = await caches.keys()
  await Promise.all(keys.filter(k => k.startsWith('static-rss /')).map(k => caches.delete(k)))
  await self.registration.unregister()
  await self.clients.claim().catch(() => {})
  var clients = await self.clients.matchAll({type: 'window'})
  clients.forEach(c => c.navigate(c.url).catch(() => {}))
})()))
