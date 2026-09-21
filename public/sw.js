// app shell is served from cache (and refreshed in the background); generated/*.json is
// network-first with a cache fallback. script.js saves long posts into DATA_CACHE itself
// (fetching them with ?offline, which this worker leaves alone)
//
// /slinks/static-rss/, /slinks/nyc-feed/ and /reader/ all live on one origin and share its
// caches: every cache here is named after this worker's scope, and activate only ever deletes
// caches carrying that prefix. The trailing space keeps a worker at / from matching /nyc-feed/
var PREFIX = 'static-rss ' + new URL(self.registration.scope).pathname + ' '
var SHELL_CACHE = PREFIX + 'shell-v1'
var DATA_CACHE = PREFIX + 'data'
var SHELL = ['./', 'index.html', 'script.js', 'style.css', 'd3_.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png']
var shellPaths = new Set(SHELL.map(d => new URL(d, self.registration.scope).pathname))

self.addEventListener('install', e => {
  // 'reload' skips the http cache: nginx sends no cache headers, so the browser may be holding an old script.js
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(d => new Request(d, {cache: 'reload'}))))
    .then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k.startsWith(PREFIX) && k != SHELL_CACHE && k != DATA_CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  var url = new URL(e.request.url)
  // cross-origin favicons and post images pass straight through: opaque responses are huge in quota
  if (e.request.method != 'GET' || url.origin != location.origin) return
  if (url.searchParams.has('offline')) return
  if (url.pathname.includes('/generated/') && url.pathname.endsWith('.json')) return e.respondWith(networkFirst(e.request))
  if (shellPaths.has(url.pathname)) return e.respondWith(cacheFirst(e.request))
})

var isJSON = res => (res.headers.get('content-type') || '').includes('json')
var noSearch = req => { var u = new URL(req.url); u.search = ''; return u.href }

function networkFirst(req){
  // drop the ?random cache-buster so items-today.json always maps to one cache entry
  var key = noSearch(req)
  return caches.open(DATA_CACHE).then(c =>
    fetch(req).then(res => {
      if (res.ok && !res.redirected && isJSON(res)) c.put(key, res.clone())
      return res
    }).catch(() => c.match(key).then(hit => hit || Response.error())))
}

function cacheFirst(req){
  var key = noSearch(req)
  return caches.open(SHELL_CACHE).then(c => c.match(key).then(hit => {
    var net = fetch(key, {cache: 'no-cache'}).then(res => {
      if (res.ok && !res.redirected) c.put(key, res.clone())
      return res
    }).catch(() => hit || Response.error())
    return hit || net
  }))
}
