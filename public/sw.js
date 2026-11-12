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
var SHELL_CACHE = PREFIX + 'shell-v5'
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

// the page's footer asks which copy is running (see drawFooter in script.js). The answer is
// this worker's own shell cache, so a browser sitting on an old one says so
self.addEventListener('message', e => {
  if (e.data == 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(SHELL_CACHE.replace(PREFIX + 'shell-', 'app '))
})

self.addEventListener('fetch', e => {
  var url = new URL(e.request.url)
  // cross-origin favicons and post images pass straight through: opaque responses are huge in quota
  if (e.request.method != 'GET' || url.origin != location.origin) return
  // a long post's file never changes once written — its name is built from the post's href — so
  // serve the saved copy at once and refresh it in the background. The rest of generated/
  // (items-today, items-recent, favicons) is rewritten hourly and stays network-first
  if (url.pathname.includes('/generated/longposts/') && url.pathname.endsWith('.json')) return e.respondWith(cacheFirstData(e.request))
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
    }).catch(() => c.match(key).then(hit => hit ? marked(hit) : Response.error())))
}

// A saved copy standing in for a dead network is still a 200 to the page, so it would look
// freshly fetched. Hand it over with a header saying where it came from, which is what the
// footer's "offline" is read from (drawCount in script.js). Last-Modified is kept, so the
// line can still say how old the list is.
function marked(hit){
  return hit.blob().then(body => {
    var headers = new Headers(hit.headers)
    headers.set('x-sw-cache', '1')
    return new Response(body, {status: 200, statusText: hit.statusText, headers})
  })
}

// same cache as networkFirst, opposite order: a hit answers immediately and the refresh lands in
// the cache for next time
function cacheFirstData(req){
  var key = noSearch(req)
  return caches.open(DATA_CACHE).then(c => c.match(key).then(hit => {
    var net = fetch(req).then(res => {
      if (res.ok && !res.redirected && isJSON(res)) c.put(key, res.clone())
      return res
    }).catch(() => hit || Response.error())
    return hit || net
  }))
}

// The shell races the network against the cache: whatever the network returns inside
// SHELL_TIMEOUT wins, so a deploy shows up on the next load instead of the one after it;
// past that, or offline, the cached copy answers and the fresh one is stored for later. 1s, not
// the 1.5s this started at: on a hung connection the page's own 400ms wait for the list comes on
// top, and 1.5s + 0.4s is a blank screen for two seconds. A shell file that takes a second to
// arrive is on a connection where last load's copy is the better answer anyway.
var SHELL_TIMEOUT = 1000

// A race lost to the clock means the network isn't answering, and the rest of this load's shell
// — the page first, then its scripts and styles — would each wait out SHELL_TIMEOUT in turn
// (3.5s to a list on a hung connection). So for STALL_MS after one is lost, the saved copy
// answers at once.
var STALL_MS = 10e3
var stalledAt = -Infinity

// On a connection the phone itself calls slow — or none at all — racing the network is a
// guaranteed wait for an answer that is not coming, so the saved copy goes out immediately and
// the request only refreshes the cache for next time.
function raceMs(){
  if (Date.now() - stalledAt < STALL_MS) return 0
  var nav = self.navigator
  if (nav && nav.onLine === false) return 0
  var c = nav && nav.connection
  if (c && (c.saveData || /^(slow-)?2g$/.test(c.effectiveType || ''))) return 0
  return SHELL_TIMEOUT
}

function cacheFirst(req){
  var key = noSearch(req)
  return caches.open(SHELL_CACHE).then(c => c.match(key).then(hit => {
    var net = fetch(key, {cache: 'no-cache'}).then(res => {
      if (res.ok && !res.redirected) c.put(key, res.clone())
      // a navigation can't be answered with a redirected response — pass the redirect through
      if (res.redirected && req.mode == 'navigate') return Response.redirect(res.url, 302)
      return res
    })
    if (!hit) return net.catch(() => Response.error())

    // the cached copy steps in if the network is slow or dead, or answers with an error page: a
    // 502 from nginx mid-deploy must not replace a working app with a blank one
    net.catch(() => {})
    var ms = raceMs()
    if (!ms) return hit
    var answered = false
    var good = net.then(res => { answered = true; return res.ok || res.status == 302 ? res : hit }, () => hit)
    return Promise.race([good, new Promise(resolve => setTimeout(() => {
      if (!answered) stalledAt = Date.now()
      resolve(hit)
    }, ms))])
  }))
}
