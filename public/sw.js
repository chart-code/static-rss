// the page caches itself and the feed JSON so the list still renders with no signal. Just a
// cache — deliberately not a PWA: no manifest, no icons, nothing installable.
//
// /slinks/static-rss/, /slinks/nyc-feed/, the blog posts that embed them and /reader/ all live on
// one origin and share its caches: every cache here carries this app's prefix, and activate only
// ever deletes caches carrying it. The trailing space keeps / from matching /nyc-feed/
// The worker lives with the app (/slinks/<app>/) and can also control a blog post that embeds the
// app (scope /static-rss/, allowed by nginx's Service-Worker-Allowed header). App files resolve
// against the worker's own folder, the page itself against the scope, so the post keeps its
// absolute /slinks/ links.
var APP = new URL('./', self.location).href
var SCOPE = self.registration.scope
var appPath = new URL(APP).pathname
var scopePath = new URL(SCOPE).pathname

var PREFIX = 'static-rss ' + appPath + ' '
var SHELL_CACHE = PREFIX + 'shell-v1'
var DATA_CACHE = PREFIX + 'data'

var SHELL = ['script.js', 'style.css', 'd3_.js'].map(d => new URL(d, APP).href)
SHELL.push(SCOPE)
SHELL = [...new Set(SHELL)]
// index.html, and the blog's own stylesheet when embedded in a post. Saved best-effort, so a
// change to the blog template can't break install
var EXTRA = [new URL('index.html', SCOPE).href]
if (scopePath != appPath) EXTRA.push(new URL('/style.css', SCOPE).href)
var shellPaths = new Set(SHELL.concat(EXTRA).map(d => new URL(d).pathname))

self.addEventListener('install', e => {
  // 'reload' skips the http cache: the browser may be holding an old script.js
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(d => new Request(d, {cache: 'reload'})))
      .then(() => Promise.all(EXTRA.map(d => c.add(new Request(d, {cache: 'reload'})).catch(() => {})))))
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
      // a navigation can't be answered with a redirected response — pass the redirect through
      if (res.redirected && req.mode == 'navigate') return Response.redirect(res.url, 302)
      return res
    }).catch(() => hit || Response.error())
    return hit || net
  }))
}
