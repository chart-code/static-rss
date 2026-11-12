// node test/network.test.js — the page and its service worker against a network that is slow,
// hung, down or broken, in headless Chromium. Every row is measured, not eyeballed.
//
//   RSS_DATA=dir   a copy of generated/ (items-today.json, items-recent.json, favicons.json) to
//                  test against; without it a synthetic list stands in
//   PLAYWRIGHT=... where playwright lives, if it isn't installed here
//   ONLY=substr    run only the rows whose name contains it
//
// The blog post at /static-rss/ (worker in /slinks/static-rss/, scoped to the post) is the live
// setup, so most rows run there.
var fs = require('fs')
var path = require('path')
var assert = require('assert')
var {start} = require('./server')

function loadPlaywright(){
  var tries = [process.env.PLAYWRIGHT, 'playwright', path.join(require('os').homedir(), '.npm/_npx/e41f203b7505f1fb/node_modules/playwright')]
  for (var p of tries.filter(d => d)) try { return require(p) } catch (e){}
  throw new Error('playwright not found: set PLAYWRIGHT=/path/to/node_modules/playwright')
}
var {chromium} = loadPlaywright()

var sleep = ms => new Promise(r => setTimeout(r, ms))

// the fresh list is the real one; the stale one is missing its newest 20 posts
function fixtures(){
  var dir = process.env.RSS_DATA
  var read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  var today, recent, favicons
  if (dir){
    today = read('items-today.json')
    recent = read('items-recent.json')
    favicons = read('favicons.json')
  } else {
    var now = Date.now()
    today = Array.from({length: 120}, (_, i) => ({
      title: 'post ' + i, href: 'https://example.com/post-' + i, feedName: 'feed ' + (i % 7),
      isoDate: new Date(now - i*20*60e3).toISOString(),
      'content:encoded': i % 9 ? '<p>body of post ' + i + '</p>' : '',
      longPost: i % 9 ? undefined : 'example.com-post-' + i,
    }))
    recent = today.map(d => Object.assign({}, d, {href: d.href + '-old', isoDate: new Date(Date.parse(d.isoDate) - 3*864e5).toISOString()}))
    favicons = []
  }
  var sorted = today.slice().sort((a, b) => a.isoDate < b.isoDate ? 1 : -1)
  var newest = new Set(sorted.slice(0, 20).map(d => d.href))
  return {lists: {fresh: today, stale: today.filter(d => !newest.has(d.href))}, recent, favicons, marker: sorted[0].href}
}

async function main(){
  var fx = fixtures()
  var PORT = 30000 + Math.floor(Math.random()*20000)
  var S = await start({port: PORT, lists: fx.lists, recent: fx.recent, favicons: fx.favicons})
  var POST = S.url('/static-rss/')
  var STANDALONE = S.url('/slinks/static-rss/')
  var SHELL_NAME = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8').match(/shell-v\d+/)[0]
  var browser = await chromium.launch({headless: true})
  var results = []
  var failed = 0

  function row(name, numbers, checks){
    var bad = Object.keys(checks).filter(k => !checks[k])
    if (bad.length) failed++
    results.push({name, ok: !bad.length, bad, numbers})
    console.log((bad.length ? 'FAIL ' : 'ok   ') + name + '  ' + JSON.stringify(numbers) + (bad.length ? '  failed: ' + bad.join(', ') : ''))
  }

  async function context(){
    var ctx = await browser.newContext()
    // nothing leaves localhost
    await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort())
    return ctx
  }

  // what is on screen right now
  var look = page => page.evaluate(marker => {
    var items = Array.from(document.querySelectorAll('.item'))
    var footer = document.querySelector('.rss-status')
    var box = document.querySelector('.items')
    return {
      items: items.length,
      fresh: items.some(n => n.__data__ && n.__data__.href == marker),
      text: box ? box.textContent.trim().slice(0, 80) : '',
      footer: footer ? footer.textContent : '',
      retry: !!Array.from(document.querySelectorAll('.items a')).find(a => a.textContent == 'retry'),
      build: window.__build || 0,
      controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    }
  }, fx.marker).catch(() => null)

  // open url in a new tab and watch it for ms: when something first showed, when the list first
  // showed, when the fresh list first showed, and how many times the page navigated
  async function visit(ctx, url, ms, during){
    var page = await ctx.newPage()
    page.on('pageerror', e => console.log('    page error:', e.message))
    var navs = 0
    page.on('framenavigated', f => { if (f == page.mainFrame()) navs++ })
    var t0 = Date.now()
    page.goto(url, {waitUntil: 'commit', timeout: ms + 5000}).catch(() => {})
    var m = {firstText: null, firstItem: null, firstFresh: null, retryAt: null}
    var last = null
    while (Date.now() - t0 < ms){
      var s = await look(page)
      var t = Date.now() - t0
      if (s){
        last = s
        if (m.firstText == null && (s.text || s.items)) m.firstText = t
        if (m.firstItem == null && s.items) m.firstItem = t
        if (m.firstFresh == null && s.fresh) m.firstFresh = t
        if (m.retryAt == null && s.retry) m.retryAt = t
        if (during) await during(page, s, t)
      }
      await sleep(40)
    }
    last = (await look(page)) || last || {}
    return Object.assign(m, {reloads: Math.max(0, navs - 1), page}, last)
  }

  // a first visit on a good connection, then wait for the worker to take over and save the list
  async function prime(ctx, url = POST, list = 'stale'){
    S.reset()
    S.state.list = list
    var v = await visit(ctx, url, 1500)
    await v.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, {timeout: 10e3})
    await waitCached(v.page)
    await v.page.close()
    S.reset()
    return v
  }
  var waitCached = page => page.waitForFunction(() => caches.keys().then(async keys => {
    for (var k of keys) if (k.endsWith(' data') && await (await caches.open(k)).match(location.origin + '/slinks/static-rss/generated/items-today.json')) return true
    return false
  }), null, {timeout: 10e3, polling: 200})

  var only = process.env.ONLY
  var rows = []
  var test = (name, fn) => rows.push([name, fn])

  test('first visit, normal', async () => {
    S.reset()
    var ctx = await context()
    var v = await visit(ctx, POST, 2500)
    var cached = await waitCached(v.page).then(() => true, () => false)
    row('first visit, normal', {firstItem: v.firstItem, items: v.items, cachedForNextTime: cached},
      {renders: v.fresh, fast: v.firstItem < 1500, cached})
    await ctx.close()
  })

  test('first visit, no worker, list saved by the page', async () => {
    // the worker never installs (it is refused), so only the page's own putData can save it
    S.reset()
    var ctx = await context()
    await ctx.route('**/sw.js', r => r.abort())
    var v = await visit(ctx, POST, 2500)
    var cached = await waitCached(v.page).then(() => true, () => false)
    await v.page.close()
    S.set('data', 'down')
    var w = await visit(ctx, POST, 2500)
    row('first visit with no worker, then down', {firstItem: w.firstItem, items: w.items, footer: w.footer},
      {cached, secondVisitRenders: w.fresh, saysOffline: /offline/.test(w.footer)})
    await ctx.close()
  })

  for (var [mode, ms] of [['normal', 0], ['slow', 1000], ['slow', 2000], ['slow', 3000], ['hang', 0], ['down', 0]]){
    ;((mode, ms) => test(`repeat visit, stale cache, ${mode}${ms ? ' ' + ms : ''}, idle`, async () => {
      var ctx = await context()
      await prime(ctx)
      S.set('data', mode, ms)
      var v = await visit(ctx, POST, mode == 'normal' ? 3000 : 7000)
      var canBeFresh = mode == 'normal' || mode == 'slow'
      row(`repeat visit, stale cache, ${mode}${ms ? ' ' + ms : ''}, idle`,
        {firstItem: v.firstItem, firstFresh: v.firstFresh, reloads: v.reloads, items: v.items, footer: v.footer},
        Object.assign({paintsBy1500: v.firstItem != null && v.firstItem < 1500, atMostOneReload: v.reloads <= 1},
          canBeFresh ? {endsFresh: v.fresh} : {staysStale: !v.fresh && v.items > 0},
          mode == 'down' ? {saysOffline: /offline/.test(v.footer)} : {}))
      await ctx.close()
    }))(mode, ms)
  }

  test('repeat visit, stale cache, slow 2000, reading', async () => {
    var ctx = await context()
    await prime(ctx)
    S.set('data', 'slow', 2000)
    var scrolled = false
    var v = await visit(ctx, POST, 5000, async (page, s) => {
      if (s.items && !scrolled){ scrolled = true; await page.evaluate(() => scrollTo(0, 800)) }
    })
    var hint = /new posts, tap to load/.test(v.footer)
    // the hint leads to the fresh list
    S.reset()
    await v.page.click('.rss-status span').catch(() => {})
    await sleep(2500)
    var after = await look(v.page)
    row('repeat visit, stale cache, slow 2000, reading (scrolled)', {firstItem: v.firstItem, reloads: v.reloads, footer: v.footer, freshAfterTap: after && after.fresh},
      {noReload: v.reloads == 0, hint, ageOfWhatIsShown: /list 3h ago/.test(v.footer), freshAfterTap: !!(after && after.fresh)})
    await ctx.close()
  })

  test('repeat visit, stale cache, slow 2000, post open', async () => {
    var ctx = await context()
    await prime(ctx)
    S.set('data', 'slow', 2000)
    var opened = false
    var v = await visit(ctx, POST, 5000, async (page, s) => {
      if (s.items && !opened){ opened = true; await page.click('.item .post-title') }
    })
    row('repeat visit, stale cache, slow 2000, post open', {reloads: v.reloads, footer: v.footer},
      {noReload: v.reloads == 0, hint: /new posts, tap to load/.test(v.footer)})
    await ctx.close()
  })

  test('no reload loop: list changes on every request', async () => {
    var ctx = await context()
    await prime(ctx)
    S.set('data', 'slow', 1000)
    // every answer differs from the saved copy: flip the list after each request
    var timer = setInterval(() => { S.state.list = S.state.list == 'fresh' ? 'stale' : 'fresh' }, 300)
    var v = await visit(ctx, POST, 12e3)
    clearInterval(timer)
    row('no reload loop when the list never settles', {reloads: v.reloads}, {atMostOneReload: v.reloads <= 1})
    await ctx.close()
  })

  for (var mode of ['hang', 'down', '500']){
    ;(mode => test(`first visit, data ${mode}`, async () => {
      S.reset()
      S.set('data', mode)
      var ctx = await context()
      var v = await visit(ctx, POST, 13e3)
      row(`first visit, no cache, data ${mode}`, {firstText: v.firstText, retryAt: v.retryAt, text: v.text},
        {visibleBy1500: v.firstText != null && v.firstText < 1500, retryOffered: v.retry, retryAtOnce: mode == 'hang' || (v.retryAt != null && v.retryAt < 1500), notWaitingAfterFailure: mode == 'hang' || !/waiting/.test(v.text)})
      await ctx.close()
    }))(mode)
  }

  for (var [mode, ms] of [['hang', 0], ['slow', 3000], ['down', 0], ['500', 0]]){
    ;((mode, ms) => test(`repeat visit, shell ${mode}`, async () => {
      // everything hangs, the shell included: the saved copy has to carry the whole page
      var ctx = await context()
      await prime(ctx, POST, 'fresh')
      S.set('shell', mode, ms)
      S.set('data', mode, ms)
      var v = await visit(ctx, POST, 5000)
      // the floor on a hung connection: sw.js's 1s race for the page, then the page's 400ms wait
      // before it reads the saved list, then drawing
      row(`repeat visit, shell+data ${mode}${ms ? ' ' + ms : ''}`, {firstText: v.firstText, firstItem: v.firstItem, items: v.items},
        {paintsBy1600: v.firstItem != null && v.firstItem < 1600, renders: v.items > 0})
      await ctx.close()
    }))(mode, ms)
  }

  // Not this repo's to fix, so it never fails the run: the blog template's google fonts
  // stylesheet is render blocking and cross-origin, so the worker can't answer it, and on a
  // connection where it hangs too the post stays blank until the browser gives up on it.
  test('info: blog post with google fonts hung too', async () => {
    var ctx = await browser.newContext()
    var hangFonts = false
    await ctx.route(/^https?:\/\/(?!localhost)/, r => { if (!hangFonts || !/fonts\.googleapis/.test(r.request().url())) r.abort() })
    await prime(ctx, POST, 'fresh')
    hangFonts = true
    S.set('shell', 'hang')
    S.set('data', 'hang')
    var v = await visit(ctx, POST, 6000)
    row('info: blog post, everything hung incl. google fonts', {firstItem: v.firstItem, items: v.items}, {})
    await ctx.close()
  })

  test('footer: version and tap to check', async () => {
    var ctx = await context()
    await prime(ctx, POST, 'fresh')
    var v = await visit(ctx, POST, 2500)
    var page = v.page
    var ver = await page.textContent('.rss-status a')
    // a tap right after a good load still asks the server
    var before = S.state.hits['/slinks/static-rss/generated/items-today.json'] || 0
    await page.click('.rss-status span')
    await sleep(800)
    var asked = (S.state.hits['/slinks/static-rss/generated/items-today.json'] || 0) - before
    var okText = await page.textContent('.rss-status span')
    // tap with the server down: says so
    S.set('data', 'down')
    await page.click('.rss-status span')
    await sleep(1500)
    var downText = await page.textContent('.rss-status span')
    // tap with the connection hung: has to give up and say so, and a later tap has to try again
    S.set('data', 'hang')
    await page.click('.rss-status span')
    await sleep(16e3)
    var hangText = await page.textContent('.rss-status span')
    S.reset()
    await page.click('.rss-status span')
    await sleep(1500)
    var recovered = await page.textContent('.rss-status span')
    row('footer: version, tap-to-check', {ver, asked, okText, downText, hangText, recovered},
      {version: ver == SHELL_NAME.replace('shell-', 'app '), tapAsks: asked >= 1, okClean: !/no answer|offline|checking/.test(okText),
        downSaysNoAnswer: /no answer/.test(downText), hangGivesUp: /no answer/.test(hangText), tapsAgainAfterHang: !/no answer|checking/.test(recovered)})
    await ctx.close()
  })

  test('worker update across a deploy, decoy caches', async () => {
    var ctx = await context()
    await prime(ctx, POST, 'fresh')
    var page = await ctx.newPage()
    await page.goto(S.url('/slinks/static-rss/'), {waitUntil: 'load'})
    var decoys = ['reader-shell-v19', 'reader-data', 'reader-img', 'static-rss /slinks/nyc-feed/ shell-v4', 'static-rss /slinks/nyc-feed/ data',
      'goal-shell-v3', 'goal-data', 'diary-shell-v2', 'diary-data', 'static-rss / shell-v1']
    await page.evaluate(names => Promise.all(names.map(n => caches.open(n).then(c => c.put('/decoy', new Response('x'))))), decoys)
    await page.close()
    S.state.build = 7
    var v = await visit(ctx, POST, 4000)
    var keys = await v.page.evaluate(() => caches.keys())
    var ver = await v.page.textContent('.rss-status a').catch(() => '')
    var ownOld = keys.filter(k => k.startsWith('static-rss /slinks/static-rss/ shell-') && !k.includes('b7'))
    // tapping the version throws away this app's worker and shell, and nobody else's
    var navs = 0
    v.page.on('framenavigated', f => { if (f == v.page.mainFrame()) navs++ })
    await v.page.click('.rss-status a')
    await sleep(3000)
    var keys2 = await v.page.evaluate(() => caches.keys())
    var after = await look(v.page)
    row('deploy lands on the next load; other apps\' caches survive', {build: v.build, reloads: v.reloads, ver, missing: decoys.filter(d => !keys.includes(d)), ownOld,
      forceUpdate: {navs, missing: decoys.filter(d => !keys2.includes(d)), items: after && after.items, dataKept: keys2.includes('static-rss /slinks/static-rss/ data')}},
      {newCodeRuns: v.build == 7, decoysKept: decoys.every(d => keys.includes(d)), oldShellDropped: !ownOld.length,
        forceUpdateReloads: navs == 1, forceUpdateKeepsOthers: decoys.every(d => keys2.includes(d)), forceUpdateKeepsData: keys2.includes('static-rss /slinks/static-rss/ data'), rendersAfter: !!(after && after.items)})
    await ctx.close()
  })

  test('long post: cache-first after a full reload, offline', async () => {
    var ctx = await context()
    await prime(ctx, POST, 'fresh')
    var v = await visit(ctx, POST, 2000)
    var page = v.page
    var opened = await page.evaluate(() => {
      var n = Array.from(document.querySelectorAll('.item')).find(n => n.__data__.longPost)
      if (!n) return null
      n.querySelector('.post-title').dispatchEvent(new MouseEvent('click', {bubbles: true}))
      return n.__data__.longPost
    })
    await sleep(1500)
    await page.close()
    if (!opened) return row('long post', {opened}, {hasLongPost: false})
    var rendered = async (mode) => {
      S.reset()
      S.set('data', mode)
      var w = await visit(ctx, POST, 2500)
      var t0 = Date.now()
      await w.page.evaluate(lp => {
        var n = Array.from(document.querySelectorAll('.item')).find(n => n.__data__.longPost == lp)
        n.querySelector('.post-title').dispatchEvent(new MouseEvent('click', {bubbles: true}))
      }, opened)
      var ok = await w.page.waitForFunction(lp => {
        var n = Array.from(document.querySelectorAll('.item')).find(n => n.__data__.longPost == lp)
        return n && /long post/.test(n.querySelector('.raw-html').textContent)
      }, opened, {timeout: 3000}).then(() => Date.now() - t0, () => null)
      await w.page.close()
      return ok
    }
    var down = await rendered('down')
    var hang = await rendered('hang')
    // a never-opened long post on a hung connection must not say loading… forever
    S.reset()
    S.set('data', 'hang')
    var w = await visit(ctx, POST, 2000)
    var other = await w.page.evaluate(lp => {
      var n = Array.from(document.querySelectorAll('.item')).find(n => n.__data__.longPost && n.__data__.longPost != lp)
      if (!n) return null
      n.querySelector('.post-title').dispatchEvent(new MouseEvent('click', {bubbles: true}))
      return n.__data__.longPost
    }, opened)
    await sleep(16e3)
    var neverOpened = other && await w.page.evaluate(lp => {
      var n = Array.from(document.querySelectorAll('.item')).find(n => n.__data__.longPost == lp)
      return n.querySelector('.raw-html').textContent
    }, other)
    row('long post: opened before renders with no network; never-opened gives up', {downMs: down, hangMs: hang, neverOpened},
      {down: down != null && down < 500, hang: hang != null && hang < 500, neverOpenedGivesUp: !other || /couldn't load/.test(neverOpened)})
    await ctx.close()
  })

  test('standalone /slinks/static-rss/, stale cache, slow 2000', async () => {
    var ctx = await context()
    await prime(ctx, STANDALONE)
    S.set('data', 'slow', 2000)
    var v = await visit(ctx, STANDALONE, 7000)
    row('standalone, stale cache, slow 2000, idle', {firstItem: v.firstItem, firstFresh: v.firstFresh, reloads: v.reloads},
      {paintsBy1500: v.firstItem < 1500, endsFresh: v.fresh, atMostOneReload: v.reloads <= 1})
    await ctx.close()
  })

  for (var [name, fn] of rows) if (!only || name.includes(only)) await fn().catch(e => { failed++; console.log('FAIL ' + name + ' threw ' + e.message) })

  await browser.close()
  S.stop()
  console.log(failed ? `\n${failed} failed` : '\nall ok')
  if (process.env.RESULTS) fs.writeFileSync(process.env.RESULTS, JSON.stringify(results, null, 2))
  process.exitCode = failed ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
