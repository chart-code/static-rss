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
var netOk = null     // did the network answer for the list, or is this a saved copy
function stamp(path, res){
  if (path != itemURL) return
  var lm = Date.parse(res.headers.get('last-modified'))
  if (lm) listAt = lm
}

// network first; sw.js keeps a copy of generated/*.json, so the list renders with no signal.
// The worker isn't controlling the page on a first visit, so also give up on a dead-slow network
// after 5s and look in the cache directly
var CACHE_WINS_MS = 400

function getJSON(path, bust, onLate){
  var url = dataURL(path)
  var net = fetch(url + (bust ? '?' + Math.random() : '')).then(res => {
    if (!res.ok || res.redirected) throw new Error(res.status)
    if (!swControlled()) putData(path, res.clone())
    // sw.js hands over a saved copy with x-sw-cache when the network is dead (it is still a
    // 200 here), so a list that didn't really come from the server says "offline"
    if (path == itemURL) netOk = !res.headers.get('x-sw-cache')
    stamp(path, res)
    return res.json()
  }).catch(err => { if (path == itemURL) netOk = false; throw err })
  var cached = () => getCached(path)
  // Underground the phone holds a connection that accepts the request and never answers, so the
  // saved copy goes out after CACHE_WINS_MS rather than a 5s stare at nothing. The request is
  // still running: onLate gets the real answer whenever it lands.
  var slow = new Promise(resolve => setTimeout(() => resolve(cached().catch(() => net)), CACHE_WINS_MS))

  if (onLate) net.then(json => onLate(json), () => {})
  return Promise.race([net, slow]).catch(cached)
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

  return {cancel: stop}
}

var newerList = null

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

Promise.all([
  getJSON(itemURL, true, json => {
    // the network answered after the saved copy had already been drawn: say so rather than
    // redrawing under him — drawDays only adds dates it hasn't drawn, so a new post on a day
    // already on screen would be missed
    if (!listKey || keyOf(json) == listKey) return
    newerList = json
    drawCount()
  }),
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
  var name2icons = Object.fromEntries(favicons.map(d => [d.feedName, d.img]))

  clearTimeout(waitTimer)
  clearTimeout(giveUpTimer)

  // add today's and yesterday's posts
  var itemSel = d3.select('.items').html('')
  drawDays(items)
  listKey = keyOf(items)
  drawFooter()

  // add posts from the last 90 days. Additive, so a failure shows nothing — but it is picked up
  // if a dead connection comes back
  retrier(() => getJSON(itemURL.replace('today', 'recent'))
    .then(recent => {
      drawDays(recent, itemSel.selectAll('div.date').data().map(d => d.key))
      readSaved()
    }), () => {})

  function drawDays(items, prevDates=[]){
    var byDate = d3.nestBy(items, d => d.isoDate.split('T')[0])
      .filter(d => !prevDates.includes(d.key))
      .filter(d => new Date(d.key) < +(new Date()) + 24*60*60*1000)

    var dateSel = itemSel.appendMany('div.date', _.sortBy(byDate, d => d.key).reverse())

    dateSel.append('h3').text(d => d.key)

    var postSel = dateSel.appendMany('div.item', d => d)
      .classed('read', d => window.localStorage.getItem(d.href))

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
                return getJSON('longposts/' + d.longPost).then(render)
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

        window.localStorage.setItem(d.href, new Date().toISOString())
      })

    // titleSel.each(function(d){ d3.select(this).on('click').call(this, d) })

    titleSel.append('img.icon')
      .at({src: d => name2icons[d.feedName]?.src, width: 20})
      .on('error', function(d){ d3.select(this).st({opacity: 0})})
    titleSel.append('span').html(d => d.title)
    // only set on feeds with more than one author whose posts don't name them (see bin/parse.js)

    postSel.append('div.content')
  }
}).catch(err => {
  console.log(err)
  d3.select('.items').html('<p style="opacity:.4;padding:10px">couldn\'t load posts</p>')
  // nothing rendered and no state to lose, so the cheapest recovery is to start the page over
  window.addEventListener('online', () => location.reload(), {once: true})
})

/* the footer ****************************************************************************/

// One muted line under the list, the same one the reader, goal and the diary have. It says how
// much is on screen, how old the list is and how much of it reads with no signal, and it says
// "offline" or "no answer" rather than looking fresh when it isn't.
//
// Tapping the line asks for the list again, past the hourly rhythm and past navigator.onLine,
// which lies both ways on a phone. A list that has moved on reloads the page: nothing here is
// unsaved, and redrawing in place would miss a new post on a day already on screen.
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
var listKey = null       // the posts drawn, so a check can tell a changed list from the same one

// sorted, so the order the list was drawn in doesn't read as a changed list
var keyOf = list => JSON.stringify(list.map(d => d.href).sort())

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
  var drawn = d3.selectAll('.item').data()
  var str = drawn.length + ' posts'
  str += ' · ' + (listAt ? 'list ' + relTime(listAt) : 'list age unknown')
  if (newerList) str += ' · new posts, tap to load'
  else if (checking) str += ' · checking…'
  else if (checkFailed) str += ' · no answer'
  else if (netOk === false) str += ' · offline'
  else if (savedSet){
    var longs = drawn.filter(d => d.longPost)
    if (longs.length) str += ' · ' + longs.filter(d => savedSet.has(dataURL('longposts/' + d.longPost))).length + '/' + longs.length + ' saved'
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
  if (newerList) return location.reload()
  if (checking) return
  checking = true
  checkFailed = false
  drawCount()
  fetch(dataURL(itemURL) + '?' + Math.random())
    .then(res => {
      if (!res.ok || res.redirected) throw new Error(res.status)
      if (res.headers.get('x-sw-cache')) throw new Error('no network')
      netOk = true
      stamp(itemURL, res)
      return res.json()
    })
    .then(list => {
      if (keyOf(list) != listKey) return location.reload()
      checking = false
      drawCount()
    })
    .catch(() => {
      checking = false
      checkFailed = true
      drawCount()
    })
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
