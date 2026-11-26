console.clear()

window.params = (() => {
  var url = new URL(window.location)
  var searchParams = new URLSearchParams(url.search)

  var rv = {}

  rv.get = key => {
    return searchParams.get(key)
  }

  rv.set = (key, value) => {
    searchParams.set(key, value)

    url.search = searchParams.toString()
    history.replaceState(null, '', url)
  }

  return rv
})()

var itemURL = 'items-today'
if (params.get('date')) itemURL = 'dates/' + params.get('date')
if (params.get('feed')) itemURL = 'feeds/' + params.get('feed')
  

function dataURL(path){
  return new URL(window.datapath + 'generated/' + path + '.json', location.href).href
}

// straight from the cache sw.js filled, no network. Keys match sw.js: absolute url, no query
// string. caches is missing outside a secure context
// same name sw.js uses (see APP_PATH/PREFIX below, which run later in the file)
var DATA_CACHE_NAME = 'static-rss ' + new URL(window.datapath || './', location.href).pathname + ' data'

// A first visit has no worker in control, so nothing it fetches gets saved and the next load
// has nothing to fall back on. Store the list as it arrives.
function putData(path, res){
  if (!window.caches || !res || !res.ok) return
  caches.open(DATA_CACHE_NAME).then(c => c.put(dataURL(path), res)).catch(() => {})
}

function swControlled(){
  return !!(navigator.serviceWorker && navigator.serviceWorker.controller)
}

function getCached(path){
  return !window.caches ?
    Promise.reject(new Error('no caches')) :
    caches.match(dataURL(path)).then(res => res ? (stamp(path, res), res.json()) : Promise.reject(new Error('no copy')))
}

// when the list on screen was written: Last-Modified on the items file, which the hourly run
// rewrites. A cached response keeps its headers, so this is honest offline too
var listAt = null
function stamp(path, res){
  if (path != itemURL) return
  var lm = Date.parse(res.headers.get('last-modified'))
  if (lm) listAt = lm
}

// network first; sw.js keeps a copy of generated/*.json, so the list renders with no signal.
// The worker isn't controlling the page on a first visit, so also give up on a dead-slow network
// after 5s and look in the cache directly
var CACHE_WINS_MS = 400

// Underground a connection can accept a request and never answer. Anything that shows
// "loading…" or "checking…" while it waits gets a deadline, or that word stays up for good.
var FETCH_MS = 15e3
// The deadline above is for the answer to start. The list is ~800 KB, which on a train can take
// a while to arrive and can also stop arriving halfway, so reading the body gets its own, longer
// one — without it res.json() can wait forever just the same.
var BODY_MS = 60e3
function fetchBy(url, ms, opts){
  var ctrl = window.AbortController ? new AbortController() : null
  var timer
  var late = new Promise((resolve, reject) => timer = setTimeout(() => {
    if (ctrl) ctrl.abort()
    reject(new Error('timeout'))
  }, ms))
  return Promise.race([fetch(url, Object.assign({}, opts, ctrl ? {signal: ctrl.signal} : {})), late])
    .then(res => { clearTimeout(timer); res.abort = () => ctrl && ctrl.abort(); return res }, err => { clearTimeout(timer); throw err })
}

function jsonBy(res, ms = BODY_MS){
  var timer
  var late = new Promise((resolve, reject) => timer = setTimeout(() => {
    if (res.abort) res.abort()
    reject(new Error('timeout'))
  }, ms))
  return Promise.race([res.json(), late])
    .then(json => { clearTimeout(timer); return json }, err => { clearTimeout(timer); throw err })
}

// The network's answer as {json, res, real}: real is false when sw.js handed over its saved copy
// because the network was dead (x-sw-cache — still a 200 here). Rejects on an error or a deadline.
function fetchData(path, bust, ms = FETCH_MS){
  var url = dataURL(path) + (bust ? '?' + Math.random() : '')
  return fetchBy(url, ms).then(res => {
    if (!res.ok || res.redirected) throw new Error(res.status)
    var real = !res.headers.get('x-sw-cache')
    if (real && !swControlled()) putData(path, res.clone())
    return jsonBy(res).then(json => ({json, res, real}))
  })
}

// Network first, with the saved copy standing in. Underground the phone holds a connection that
// accepts the request and never answers, so the saved copy goes out after CACHE_WINS_MS rather
// than a stare at nothing. onNet gets the network's answer, saved copy or not, whenever it lands.
function getJSON(path, bust, onNet, ms){
  var net = fetchData(path, bust, ms)
  if (onNet) net.then(onNet, () => onNet(null))
  var cached = () => getCached(path)
  var slow = new Promise(resolve => setTimeout(() => resolve(cached().catch(() => net.then(r => r.json))), CACHE_WINS_MS))
  // a late answer isn't what's on screen, so it doesn't get to say how old the list is
  var settled = false
  var first = net.then(r => { if (!settled) stamp(path, r.res); return r.json })
  return Promise.race([first, slow]).catch(cached).then(json => { settled = true; return json })
}

// A failed load retries itself instead of sitting on an error: as soon as the browser fires
// 'online', and on a short backoff meanwhile before giving up after ~a minute. The failure is
// never stashed, so the next click starts over, and cancel() leaves no timer or listener behind.
function retrier(load, onFail){
  var timer, delays, done, inFlight

  function attempt(){
    if (done || inFlight) return
    inFlight = true
    load().then(stop, () => {
      inFlight = false
      if (done) return
      onFail()
      var ms = delays.shift()
      if (ms) timer = setTimeout(attempt, ms)
      else timer = null
    })
  }

  function start(){
    clearTimeout(timer)
    delays = [2000, 5000, 15000, 40000]
    attempt()
  }

  function stop(){
    done = true
    clearTimeout(timer)
    window.removeEventListener('online', start)
  }

  window.addEventListener('online', start)
  start()

  // given up until the next 'online': nothing in flight, nothing waiting
  var idle = () => done || (!inFlight && !timer)
  return {cancel: stop, idle}
}

// Nothing should ever be a blank page on a dead connection: say what is happening at WAIT_MS,
// and offer a retry at GIVE_UP_MS. Drawing the list clears both.
var WAIT_MS = 1200
var GIVE_UP_MS = 12e3
var waitSel = null

function sayWaiting(str, retry){
  if (d3.select('.items').select('.item').size()) return
  waitSel = waitSel || d3.select('.items').append('p.waiting').st({opacity: .4, padding: 10})
  waitSel.html('').append('span').text(str)
  if (retry) waitSel.append('a').text('retry').at({href: '#'}).st({marginLeft: '1em'})
    .on('click', () => { d3.event.preventDefault(); location.reload() })
}

var waitTimer = setTimeout(() => sayWaiting('waiting for the list…'), WAIT_MS)
var giveUpTimer = setTimeout(() => sayWaiting("couldn't load posts — no answer from the server", true), GIVE_UP_MS)

/* keeping the list fresh ****************************************************************/

// On a train the list usually comes out of the cache first: the request for the real one hangs
// in a dead patch, or fails, and the saved copy is drawn. Until the server has answered for the
// list on screen, the page keeps asking: on a backoff while the tab is visible, at once on
// 'online' and on becoming visible, and never while hidden. One request at a time, and every one
// has a deadline (FETCH_MS, BODY_MS, and sw.js's own), so a hung one can't hold 'busy' for good.
//
// A fresh list is merged into the one on screen rather than reloading the page: new posts go in
// at their place by date, rows already drawn are left alone — an open post stays open, read marks
// stay — and the row at the top of the screen stays where it is, so the list doesn't jump.
var RETRY_MS = [1e3, 2e3, 4e3, 8e3, 15e3, 30e3]   // then every 30s while visible
var STALE_MS = 10*60e3     // a fresh list this old is asked for again on coming back to the tab
var refresh = {busy: false, timer: null, tries: 0, at: 0, manual: false}
var listFresh = false      // the server answered for the list on screen
var netOk = null           // the last ask for the list: true, false (failed or saved copy), null
var drawn = false          // the list is on screen
var failedToDraw = false   // nothing could be drawn at all
var pendingFresh = null    // a fresh list that landed before the first draw

function onFresh(r){
  netOk = true
  refresh.at = Date.now()
  refresh.tries = 0
  if (failedToDraw) return location.reload()   // nothing on screen to lose
  if (!drawn) return pendingFresh = r
  mergeList(r)
}

function onNetFailed(){
  netOk = false
  scheduleRefresh()
  drawCount()
}

function refreshList(manual){
  if (manual){
    refresh.manual = true
    checking = true
    checkFailed = false
    drawCount()
  }
  if (refresh.busy) return
  clearTimeout(refresh.timer)
  refresh.busy = true
  fetchData(itemURL, true).then(settled, () => settled(null))
}

// the answer to one ask, the first load's included: r is null on a failure or a deadline
function settled(r){
  refresh.busy = false
  var manual = refresh.manual
  checking = refresh.manual = false
  if (r && r.real){
    if (manual) checkFailed = false
    onFresh(r)
    drawCount()
  } else {
    if (manual) checkFailed = true
    onNetFailed()
  }
}

function scheduleRefresh(){
  clearTimeout(refresh.timer)
  if (listFresh || document.hidden || refresh.busy) return
  var ms = RETRY_MS[Math.min(refresh.tries++, RETRY_MS.length - 1)]
  refresh.timer = setTimeout(() => refreshList(), ms)
}

// back in signal, or back on the tab: ask now, with the backoff started over. A fresh list is
// asked for again only once it is STALE_MS old, and only once: it is still the server's answer
function refreshNow(){
  if (document.hidden) return clearTimeout(refresh.timer)
  if (listFresh && Date.now() - refresh.at < STALE_MS) return
  refresh.tries = 0
  refreshList()
}
window.addEventListener('online', refreshNow)
document.addEventListener('visibilitychange', refreshNow)

function mergeList(r){
  var list = r.json
  var shown = new Map(d3.selectAll('.item').data().map(d => [d.href, d]))
  // a post already on screen keeps its row; its fields follow the server (a long post's file
  // name, say), and what the page hung on it (open, loaded html) stays
  list.forEach(d => { if (shown.has(d.href)) Object.assign(shown.get(d.href), d) })
  var add = list.filter(d => !shown.has(d.href))
  if (add.length) keepScroll(() => insertPosts(add))
  listFresh = true
  stamp(itemURL, r.res)
  drawCount()
  if (recent.retry) loadRecent()
}

// the first row with any of it on screen stays put while rows go in above it. At the very top
// nothing is held, so the new posts are what shows
function keepScroll(fn){
  var anchor = scrollY > 0 && d3.selectAll('.item').nodes().find(n => n.getBoundingClientRect().bottom > 0)
  var top = anchor && anchor.getBoundingClientRect().top
  fn()
  // a browser with scroll anchoring of its own has already done this, and the difference is 0
  if (anchor){
    var moved = anchor.getBoundingClientRect().top - top
    if (Math.abs(moved) >= 1) scrollBy(0, moved)
  }
}

// within a day, posts from feeds that post more than once a day (bin/archive.js) go after the
// rest, feed by feed in this order (feedName as in the data), newest first within a feed. A feed
// that turns prolific later goes after these, newest first
var PROLIFIC_ORDER = ['simonwillison', 'Statistical Modeling, Causal Inference, and Social Science', 'FlowingData',
  'openai', 'westsiderag', 'The City', 'Streetsblog NYC', 'ProPublica Articles and Investigations']
var feedRank = d => (i => i < 0 ? PROLIFIC_ORDER.length : i)(PROLIFIC_ORDER.indexOf(d.feedName))
// sorted descending: rarer feeds first, then the lowest rank first
var dayOrder = d => d.prolific ? '0' + String.fromCharCode(65 + PROLIFIC_ORDER.length - feedRank(d)) + d.isoDate : '1' + d.isoDate
var rareFirst = day => day.filter(d => !d.prolific).concat(_.sortBy(day.filter(d => d.prolific), feedRank))

// days newest first, posts in a day newest first, the same order drawDays makes
function insertPosts(add){
  var box = d3.select('.items').node()
  d3.nestBy(add, d => d.isoDate.split('T')[0])
    .filter(d => new Date(d.key) < +(new Date()) + 24*60*60*1000)
    .forEach(day => {
      var dateNode = Array.from(box.querySelectorAll('div.date')).find(n => n.__data__.key == day.key)
      if (!dateNode){
        var before = Array.from(box.querySelectorAll('div.date')).find(n => n.__data__.key < day.key)
        dateNode = box.insertBefore(document.createElement('div'), before || null)
        dateNode.className = 'date'
        d3.select(dateNode).datum([]).append('h3').text(day.key)
        dateNode.__data__.key = day.key
      }
      _.sortBy(day, dayOrder).reverse().forEach(d => {
        var before = Array.from(dateNode.querySelectorAll('div.item')).find(n => dayOrder(n.__data__) < dayOrder(d))
        var node = dateNode.insertBefore(document.createElement('div'), before || null)
        node.className = 'item'
        dateNode.__data__.push(d)
        drawPosts(d3.select(node).datum(d))
      })
    })
}

/* the list ******************************************************************************/

var name2icons = {}

refresh.busy = true
Promise.all([
  // the first ask is the first try of the backoff above: one request at a time
  getJSON(itemURL, true, settled),
  getJSON('favicons').catch(() => []),
]).then(res => {

  window.items = _.sortBy(res[0], d => d.isoDate).reverse()
  window.favicons = res[1]

  favicons.forEach(d => {
    if (!d.favicon || !d.favicon.icons) return d.img = {}

    d.img = _.sortBy(d.favicon.icons, d => {
      if (d.src.includes('svg')) return 10000
      if (d.src.includes('apple')) return 1000
      if (d.sizes) return +d.sizes.split('x')[0]
    }).reverse()[0] || {}

    d.img = d.favicon.icons.filter(d => d.src.includes('png')).slice(-1)[0] || d.favicon.icons[0] || {}
  })
  name2icons = Object.fromEntries(favicons.map(d => [d.feedName, d.img]))

  clearTimeout(waitTimer)
  clearTimeout(giveUpTimer)

  // add today's and yesterday's posts
  d3.select('.items').html('')
  drawDays(items)
  drawn = true
  // the server's list landed while this was drawing, or was what got drawn
  if (pendingFresh){ mergeList(pendingFresh); pendingFresh = null }
  drawFooter()
  // after the list is on screen, never before it: the marks from other devices
  syncPull()
  if (!listFresh) scheduleRefresh()

  loadRecent()
}).catch(err => {
  console.log(err)
  // said at once, with the retry: the timers would put "waiting for the list…" under it
  clearTimeout(waitTimer)
  clearTimeout(giveUpTimer)
  sayWaiting("couldn't load posts", true)
  // nothing rendered and no state to lose, so the cheapest recovery is to start the page over:
  // on 'online', or when the backoff above gets an answer
  failedToDraw = true
  if (pendingFresh) return location.reload()
  window.addEventListener('online', () => location.reload(), {once: true})
})

// add posts from the last 90 days. Additive, so a failure shows nothing — but it is picked up
// if a dead connection comes back: on 'online', and again when a fresh list lands, since the
// retrier gives up after about a minute and a dead patch on a train can last longer
var recent = {done: false, retry: null}
function loadRecent(){
  if (recent.done || (recent.retry && !recent.retry.idle())) return
  if (recent.retry) recent.retry.cancel()
  recent.retry = retrier(() => getJSON(itemURL.replace('today', 'recent'))
    .then(json => {
      if (recent.done) return
      recent.done = true
      drawDays(json, d3.select('.items').selectAll('div.date').data().map(d => d.key))
      readSaved()
    }), () => {})
}

function drawDays(items, prevDates=[]){
  var byDate = d3.nestBy(items, d => d.isoDate.split('T')[0])
    .filter(d => !prevDates.includes(d.key))
    .filter(d => new Date(d.key) < +(new Date()) + 24*60*60*1000)

  var dateSel = d3.select('.items').appendMany('div.date', _.sortBy(byDate, d => d.key).reverse())

  dateSel.append('h3').text(d => d.key)

  drawPosts(dateSel.appendMany('div.item', rareFirst))
}

function drawPosts(postSel){
  postSel.classed('read', d => window.localStorage.getItem(d.href))

  var titleSel = postSel.append('div.post-title')
    .on('click', function(d){
      d.active = !d.active

      var sel = d3.select(this.parentNode)
        .classed('read', 1)
        .classed('active', d.active)
        .select('.content')

      // a pending retry belongs to the post that was open; collapsing or reopening drops it
      if (d.retry) d.retry = d.retry.cancel()

      if (!d.active){
        if (logCur && logCur.d == d) logEnd()
        var node = this.parentNode
        if (node.getBoundingClientRect().top < 0) node.scrollIntoView(true)
        return sel.html('')
      }

      var hrefPP = d.href.split('//')[1].replace('www.', '').replace('.html', '').split('/')[0]
      var headSel = sel.append('p').st({marginTop: 5, opacity: .4})
      headSel.append('a').text(hrefPP).at({href: d.href, target: '_blank'})
      headSel.append('a').text('>').at({href: '?feed=' + hrefPP}).st({marginLeft: '1em'})
      // only set on feeds with more than one author whose posts don't name them (bin/parse.js)
      if (d.byline) headSel.append('span').text(d.byline).st({float: 'right'})

      var width = sel.select('p').node().offsetWidth

      var contentStr = d['content:encoded'] || d.content || d.summary || ''

      // Long posts are saved to their own file. A post opened once before is already here — on
      // the datum within this page, otherwise in the cache, since sw.js keeps longposts/
      // cache-first and their files never change. Either way it renders with no network wait and
      // no 'loading…': the placeholder is only for a post that has never been opened.
      // The datum copy is keyed on longPost, so a post whose file changed drops the stale copy.
      if (!contentStr && d.longPost){
        var rawHTMLSel = sel.append('div.raw-html')
        if (d.longKey == d.longPost){
          renderContent(d.longHtml)
        } else {
          var render = res => {
            d.longKey = d.longPost
            d.longHtml = res[0].html
            renderContent(d.longHtml)
          }
          d.retry = retrier(
            () => getCached('longposts/' + d.longPost).then(render, () => {
              rawHTMLSel.html('<p style="opacity:.4">loading…</p>')
              return getJSON('longposts/' + d.longPost, false, null, FETCH_MS).then(render)
            }),
            () => rawHTMLSel.html('<p style="opacity:.4">couldn\'t load post</p>'))
        }
      } else {
        var rawHTMLSel = sel.append('div.raw-html')
        renderContent(contentStr)
      }

      function renderContent(contentStr){
      contentStr = contentStr
        .replaceAll('width: ', 'x-width: ')
        .replaceAll(' width=', ' x-width=')
        .replaceAll('height: ', 'x-height: ')

      if (hrefPP == 'thecity.nyc'){
        contentStr = contentStr
          .replaceAll(` src="`, ` x-src="`)
          .replaceAll(` srcset="`, ` x-srcset="`)
          .replaceAll(` data-src="`, ` src="`)
      }

      rawHTMLSel.html(contentStr)

      // responsive youtube embed
      rawHTMLSel.selectAll('iframe').at({width, height: width*9/16})

      // open all links in a new tab
      rawHTMLSel.selectAll('a').at({target: 'blank'})

      rawHTMLSel.selectAll('.subscription-widget-wrap,.button-wrapper').remove()
      // substack's zoom/restack buttons under every image
      rawHTMLSel.selectAll('.image-link-expand,.restack-image').remove()

      // Substack serves a 248px image with srcset variants up to 1456w and sizes="100vw",
      // which lays it out at the full viewport width — a small picture blown up and blurry.
      // The width/height attributes that would have said otherwise are neutered above, so
      // put them back on images and drop the srcset/sizes that override them.
      rawHTMLSel.selectAll('picture source').remove()
      rawHTMLSel.selectAll('img').each(function(){
        this.removeAttribute('srcset')
        this.removeAttribute('sizes')
        'width height'.split(' ').forEach(d => {
          var v = this.getAttribute('x-' + d)
          if (v && +v) this.setAttribute(d, v)
        })
      })

      if (hrefPP == 'xkcd.com'){
        rawHTMLSel.append('p').text(rawHTMLSel.select('img').attr('title'))
      }
      if (hrefPP == 'thecity.nyc'){
        rawHTMLSel.selectAll('.Enhancement-item').remove()
      }
      }

      var openedAt = new Date().toISOString()
      try { window.localStorage.setItem(d.href, openedAt) } catch (e){}
      syncQueue(d.href, openedAt)
      logStart(d, this)
    })

  // titleSel.each(function(d){ d3.select(this).on('click').call(this, d) })

  titleSel.append('img.icon')
    .at({src: d => name2icons[d.feedName]?.src, width: 20})
    .on('error', function(d){ d3.select(this).st({opacity: 0})})
  titleSel.append('span').html(d => d.title)
  // only set on feeds with more than one author whose posts don't name them (see bin/parse.js)

  postSel.append('div.content')
}

/* read marks across devices *************************************************************/

// A post opened on one device shows as read on the others, for Adam only. The page never asks
// anyone to sign in: the endpoint sits behind the rtl-auth gate on this origin, and the gate's
// cookie (Domain=.roadtolarissa.com) is already there if he signed in to the reader or goal.
// Without it the endpoint answers one 401, which turns sync off for the rest of this tab, and
// the page is exactly what it was before: read marks in localStorage, nothing said about it.
//
// localStorage is still the record the page paints from. After the list is drawn, one GET (with
// a deadline, like every fetch that holds a word on screen) merges the server's marks in, the
// earliest date winning, and re-marks the rows; marks only this device has go up with it. A post
// opened after that is queued in localStorage and sent in a small batch a moment later, so an
// open with no signal goes up on 'online' or on the next load. One request in flight at a time.
var SYNC_URL = '/static-rss-state/read'
var SYNC_MS = 10e3
var SYNC_DAYS = 120       // the server drops marks older than this, so don't send them
var SYNC_BATCH = 300
var SYNC_QUEUE = 'rss-sync-queue'
var SYNC_OFF = 'rss-sync-off'
var sync = {on: false, busy: false, failed: false, timer: null}

var isMark = (k, v) => /^https?:\/\//.test(k) && !!v && !isNaN(Date.parse(v))

function syncIsOff(){
  if (!/^https?:$/.test(location.protocol)) return true
  try { return !!sessionStorage.getItem(SYNC_OFF) } catch (e){ return false }
}

function readQueue(){
  try { var q = JSON.parse(localStorage.getItem(SYNC_QUEUE) || '{}'); return q && typeof q == 'object' ? q : {} }
  catch (e){ return {} }
}
function writeQueue(q, key = SYNC_QUEUE){
  try { Object.keys(q).length ? localStorage.setItem(key, JSON.stringify(q)) : localStorage.removeItem(key) } catch (e){}
}

// signed out (or not Adam, or no endpoint here): stop for this tab and forget the queue
function syncStop(){
  sync.on = false
  try { sessionStorage.setItem(SYNC_OFF, '1') } catch (e){}
  writeQueue({})
  writeQueue([], LOG_QUEUE)
  logCur = null
  drawCount()
}

// redirect: 'manual' so a gate that ever sends the sign-in page back is read as signed out
// rather than followed
function syncFetch(method, body, url = SYNC_URL){
  var opts = {method, credentials: 'same-origin', redirect: 'manual', cache: 'no-store'}
  if (body){
    opts.headers = {'Content-Type': 'application/json'}
    opts.body = JSON.stringify(body)
  }
  // keepalive: a batch sent as the tab goes away still gets there
  if (url == LOG_URL) opts.keepalive = true
  return fetchBy(url, SYNC_MS, opts).then(res => {
    if (res.status == 401 || res.status == 403 || res.status == 404 || res.type == 'opaqueredirect'){
      syncStop()
      throw new Error('sync off')
    }
    if (!res.ok) throw new Error(res.status)
    return res.json()
  })
}

function syncPull(){
  if (syncIsOff() || sync.busy) return
  sync.busy = true
  syncFetch('GET').then(json => {
    sync.busy = false
    sync.on = true
    sync.failed = false
    var remote = json && json.read && typeof json.read == 'object' ? json.read : {}

    Object.keys(remote).forEach(href => {
      if (!isMark(href, remote[href])) return
      var local = localStorage.getItem(href)
      if (!local || isNaN(Date.parse(local)) || Date.parse(remote[href]) < Date.parse(local)){
        try { localStorage.setItem(href, remote[href]) } catch (e){}
      }
    })
    d3.selectAll('.item').classed('read', function(d){ return this.classList.contains('read') || !!localStorage.getItem(d.href) })

    // whatever this device read that the server hasn't got: its first sync, or opens that
    // happened while signed out
    var cutoff = Date.now() - SYNC_DAYS*864e5
    var q = readQueue()
    for (var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i), v = localStorage.getItem(k)
      if (!isMark(k, v) || q[k] || Date.parse(v) < cutoff) continue
      if (!remote[k] || Date.parse(v) < Date.parse(remote[k])) q[k] = v
    }
    writeQueue(q)
    drawCount()
    syncFlush()
  }, () => { sync.busy = false; sync.failed = true })
}

function syncFlush(){
  if (syncIsOff() || sync.busy) return
  // not known to be on yet (offline at load, or the GET timed out): a pull sends the queue
  if (!sync.on) return syncPull()
  var q = readQueue()
  var batch = {}
  Object.keys(q).slice(0, SYNC_BATCH).forEach(k => batch[k] = q[k])
  if (!Object.keys(batch).length) return logFlush()
  sync.busy = true
  syncFetch('POST', {read: batch}).then(() => {
    sync.busy = false
    sync.failed = false
    var q = readQueue()
    Object.keys(batch).forEach(k => { if (q[k] == batch[k]) delete q[k] })
    writeQueue(q)
    drawCount()
    syncFlush()
  }, () => { sync.busy = false; sync.failed = true; drawCount() })
}

// the reading log goes up after the read marks, in the same one-at-a-time line
function logFlush(){
  var batch = readLog().slice(0, LOG_BATCH)
  if (!batch.length) return drawCount()
  sync.busy = true
  syncFetch('POST', {log: batch}, LOG_URL).then(() => {
    sync.busy = false
    sync.failed = false
    var sent = new Set(batch.map(e => e.id))
    writeQueue(readLog().filter(e => !sent.has(e.id)), LOG_QUEUE)
    syncFlush()
  }, () => { sync.busy = false; sync.failed = true; drawCount() })
}

function syncQueue(href, iso){
  if (syncIsOff()) return
  var q = readQueue()
  if (!q[href]) q[href] = iso
  writeQueue(q)
  drawCount()
  clearTimeout(sync.timer)
  sync.timer = setTimeout(syncFlush, 1500)
}

window.addEventListener('online', () => syncFlush())

/* reading log ***************************************************************************/

// One event per post open, for a chart later: when, which post, how far down its body the
// screen got (0-1), seconds open with the tab visible, and which device. Only while sync can be
// on, so signed out nothing is measured, kept or sent. An event ends on collapse, on opening
// another post and on the tab going hidden; coming back to a post still open starts a new one.
// Events wait in localStorage (rss-log-queue) and go up with the read marks; the id made here
// lets the server drop a batch sent twice.
var LOG_URL = '/static-rss-state/log'
var LOG_QUEUE = 'rss-log-queue'
var LOG_BATCH = 50        // keepalive bodies are capped at 64 KB
var LOG_MAX = 5000
var logCur = null
var logResume = null      // the post open when the tab went hidden
// the Boox is an old Android WebView (Chrome/111), the Pixel a current Chrome
var logDevice = /Android/.test(navigator.userAgent) && +(navigator.userAgent.match(/Chrome\/(\d+)/) || [0, 999])[1] < 120 ? 'eink' :
  /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 'phone' : 'desktop'

function readLog(){
  try { var q = JSON.parse(localStorage.getItem(LOG_QUEUE) || '[]'); return Array.isArray(q) ? q : [] }
  catch (e){ return [] }
}

function logStart(d, titleNode){
  if (logCur) logEnd()
  if (syncIsOff() || document.hidden) return
  logCur = {d, titleNode, node: titleNode.parentNode.querySelector('.content'), from: Date.now(), maxScroll: 0, timer: null, ev: {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
    at: new Date().toISOString(),
    href: d.href,
    feed: d.feedName || '',
    title: titleNode.textContent.trim().slice(0, 120),
  }}
  // measured on scroll and at the end, not now: a long post's body may still be loading
  window.addEventListener('scroll', logScroll, {passive: true})
}

// how far down the post body the bottom of the screen has been
function logMeasure(){
  if (!logCur) return
  logCur.timer = null
  var r = logCur.node.getBoundingClientRect()
  if (r.height > 0) logCur.maxScroll = Math.max(logCur.maxScroll, Math.min(1, Math.max(0, (innerHeight - r.top)/r.height)))
}
function logScroll(){
  if (logCur && !logCur.timer) logCur.timer = setTimeout(logMeasure, 250)
}

function logEnd(){
  var cur = logCur
  if (!cur) return
  logMeasure()
  clearTimeout(cur.timer)
  logCur = null
  window.removeEventListener('scroll', logScroll)
  if (syncIsOff()) return
  var ev = Object.assign(cur.ev, {maxScroll: Math.round(cur.maxScroll*100)/100, seconds: Math.round((Date.now() - cur.from)/1000), device: logDevice})
  writeQueue(readLog().concat([ev]).slice(-LOG_MAX), LOG_QUEUE)
  drawCount()
  clearTimeout(sync.timer)
  if (document.hidden) syncFlush()
  else sync.timer = setTimeout(syncFlush, 1500)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden){
    logResume = logCur
    return logEnd()
  }
  if (logResume && logResume.d.active && !logCur) logStart(logResume.d, logResume.titleNode)
  logResume = null
})
window.addEventListener('pagehide', logEnd)

/* the footer ****************************************************************************/

// One muted line under the list, the same one the reader, goal and the diary have. It says how
// much is on screen, whether it is the server's list ("fresh") or the saved copy ("cached"), how
// old the list is and how much of it reads with no signal, and it says "offline" or "no answer"
// rather than looking fresh when it isn't.
//
// Tapping the line asks for the list again, past the hourly rhythm and past navigator.onLine,
// which lies both ways on a phone. New posts are merged in where they belong, as with any fresh
// list (mergeList), so nothing open or scrolled to is lost.
//
// Tapping the version throws this copy of the app away and loads it from the server. It takes
// only this app's worker and caches: /reader/, /nyc-feed/ and every sketch share this origin,
// and taking theirs would break them offline. The caches carry the app's own path (sw.js), and
// the registration asked for is the one whose scope covers this page.
var APP_PATH = new URL(window.datapath || './', location.href).pathname
var PREFIX = 'static-rss ' + APP_PATH + ' '
var DATA_CACHE = PREFIX + 'data'

var countSel = null
var verSel = null
var checking = false
var checkFailed = false
var savedSet = null      // long posts in the data cache, once it has been read

function relTime(ms){
  var m = Math.round((Date.now() - ms)/6e4)
  if (!(m > 1)) return 'just now'
  if (m < 60) return m + 'm ago'
  if (m < 60*24) return Math.round(m/60) + 'h ago'
  return Math.round(m/60/24) + 'd ago'
}

function drawFooter(){
  var sel = d3.select('.rss-status')
  if (!sel.size()) sel = d3.select('body').append('div.rss-status')
  sel.html('')

  countSel = sel.append('span').at({title: 'tap to check for new posts'}).on('click', recheck)

  // a browser can get stuck on an old service worker — chrome picks up a deploy while firefox
  // keeps serving what it saved. This says which copy is running and clears it on demand
  verSel = sel.append('a').at({href: '#', title: 'tap to load the app again from the server'}).text('app …')
  verSel.on('click', () => {
    d3.event.preventDefault()
    forceUpdate()
  })
  swVersion().then(v => verSel.text(v || 'no worker'))

  drawCount()
  readSaved()
}

function drawCount(){
  if (!countSel) return
  var rows = d3.selectAll('.item').data()
  var str = rows.length + ' posts'
  // fresh: the server answered for this list. cached: it is the saved copy, and the page is
  // still asking (see "keeping the list fresh")
  str += ' · ' + (listFresh ? 'fresh' : 'cached')
  str += ' · ' + (listAt ? 'list ' + relTime(listAt) : 'list age unknown')
  if (checking) str += ' · checking…'
  else if (checkFailed) str += ' · no answer'
  else if (netOk === false && !listFresh) str += ' · offline'
  else if (savedSet){
    var longs = rows.filter(d => d.longPost)
    if (longs.length) str += ' · ' + longs.filter(d => savedSet.has(dataURL('longposts/' + d.longPost))).length + '/' + longs.length + ' saved'
  }
  // nothing at all when sync is off: signed-out visitors see the line they always saw
  if (sync.on){
    var waiting = Object.keys(readQueue()).length + readLog().length
    str += waiting ? ' · ' + waiting + ' to sync' : ' · synced'
  }
  countSel.text(str)
}

// which long posts sw.js already has. caches.open would make the cache if it were missing, so
// look for it by name first
function readSaved(){
  if (!window.caches) return
  caches.keys()
    .then(keys => keys.includes(DATA_CACHE) ? caches.open(DATA_CACHE).then(c => c.keys()) : [])
    .then(reqs => {
      savedSet = new Set(reqs.map(r => r.url).filter(u => u.includes('/generated/longposts/')))
      drawCount()
    })
    .catch(() => {})
}

function recheck(){
  if (checking) return
  // and the marks from other devices, if sync is on for this tab
  syncPull()
  refreshList(true)
}

// the worker answers with its shell cache name, which carries the version
function swVersion(){
  return new Promise(resolve => {
    var sw = navigator.serviceWorker && navigator.serviceWorker.controller
    if (!sw) return resolve('no worker')
    var chan = new MessageChannel()
    chan.port1.onmessage = e => resolve(e.data)
    setTimeout(() => resolve('worker ?'), 1500)
    try { sw.postMessage('version', [chan.port2]) } catch (e){ resolve('worker ?') }
  })
}

function forceUpdate(){
  verSel.text('updating…')
  var done = () => location.reload()
  if (!navigator.serviceWorker) return done()
  navigator.serviceWorker.getRegistration()
    .then(reg => reg && reg.unregister())
    // the shell only: the data cache holds the long posts saved for offline, and throwing
    // those away would mean fetching them all again
    .then(() => window.caches && caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(PREFIX + 'shell-')).map(k => caches.delete(k)))))
    .catch(() => {})
    .then(done)
}

// the page used to keep every post in indexeddb (~30MB); drop the old stores once
if (window.indexedDB && !localStorage.getItem('idb-cleaned')){
  ['/slinks/static-rss/', '/slinks/nyc-feed/', '/static-rss/', '/nyc-feed/', '/']
    .forEach(d => { try { indexedDB.deleteDatabase('static-rss ' + d) } catch (e) {} })
  localStorage.setItem('idb-cleaned', 1)
}

// standalone: sw.js sits next to the page. Embedded in a blog post: the worker stays in the app
// folder (datapath) and takes the post's folder as its scope, which nginx allows with
// Service-Worker-Allowed. A worker must be same-origin, so a cross-origin datapath just fails here
if ('serviceWorker' in navigator && (location.protocol == 'https:' || location.hostname == 'localhost')){
  navigator.serviceWorker
    .register((window.datapath || '') + 'sw.js', window.datapath ? {scope: './'} : undefined)
    .catch(() => {})
  // a worker that takes over after this load (a first visit, or one thrown away above) answers
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (verSel) swVersion().then(v => verSel.text(v || 'no worker'))
  })
}
