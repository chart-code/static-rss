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
var isDefaultView = itemURL == 'items-today'

// the same script runs standalone (datapath '') and embedded in the blog posts at /static-rss/
// and /nyc-feed/ (datapath points at /slinks/<name>/). Caches and the post store are named
// after the data's path so the two feeds, and /reader/ on the same origin, never share
var basePath = new URL(window.datapath || './', location.href).pathname
var DATA_CACHE = 'static-rss ' + basePath + ' data'
var dataURL = path => new URL(window.datapath + 'generated/' + path + '.json', location.href).href

var itemSel = d3.select('.items').html('')
var statusSel = d3.select(itemSel.node().parentNode)
  .insert('div', () => itemSel.node().nextSibling).attr('class', 'rss-status')

// one object store of posts keyed by href; a failure anywhere (private mode) just means no store
var store = (() => {
  var open = new Promise((resolve, reject) => {
    var req = indexedDB.open('static-rss ' + basePath, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('posts', {keyPath: 'href'})
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  open.catch(() => {})

  var tx = (mode, fn) => open.then(db => new Promise((resolve, reject) => {
    var t = db.transaction('posts', mode)
    var req = fn(t.objectStore('posts'))
    t.oncomplete = () => resolve(req && req.result)
    t.onerror = t.onabort = () => reject(t.error)
  }))

  return {
    all: () => tx('readonly', s => s.getAll()),
    put: list => list.length ? tx('readwrite', s => list.forEach(d => s.put(d))) : Promise.resolve(),
    del: hrefs => hrefs.length ? tx('readwrite', s => hrefs.forEach(d => s.delete(d))) : Promise.resolve(),
  }
})()

var posts = {}        // href → drawn post
var groups = {}       // yyyy-mm-dd → div.date node
var name2icons = {}

// posts from every load are kept in indexeddb and redrawn instantly on the next one — no
// network wait, and a full page with no signal. items-today/recent are merged in as they arrive
if (isDefaultView){
  store.all().catch(() => []).then(stored => {
    addPosts(stored)
    var hadPosts = stored.length > 0

    getJSON('items-today', !hadPosts)
      .then(mergePosts)
      .catch(() => {})
      .then(() => getJSON('items-recent', !hadPosts && !itemSel.select('.item').size()))
      .then(recent => {
        mergePosts(recent)
        expirePosts(recent)
        saveLongPosts(true)
      })
      .catch(() => saveLongPosts(false))
      .then(() => {
        if (!itemSel.select('.item').size()) itemSel.html('<p style="opacity:.4;padding:10px">couldn\'t load posts</p>')
      })
  })
} else {
  getJSON(itemURL, true)
    .then(addPosts)
    .catch(() => itemSel.html('<p style="opacity:.4;padding:10px">couldn\'t load posts</p>'))
}

getJSON('favicons', false).then(favicons => {
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
  itemSel.selectAll('img.icon').at({src: d => name2icons[d.feedName]?.src})
}).catch(() => {})


/* merging ************************************************************************/

var dayKey = d => d.isoDate.split('T')[0]
var storable = d => _.omit(d, 'active', 'node', 'expired')

function mergePosts(fresh){
  var now = new Date().toISOString(), put = [], add = [], added = {}

  fresh.forEach(d => {
    if (!d.href || !d.isoDate || added[d.href]) return
    var old = posts[d.href]
    if (!old){
      d.seenAt = now
      added[d.href] = true
      put.push(d)
      return add.push(d)
    }
    // changed upstream (full text arrived, title fixed): update in place; an open post keeps what it rendered
    var next = Object.assign({}, storable(old), d)
    if (_.isEqual(next, storable(old))) return
    Object.assign(old, d)
    put.push(storable(old))
    if (old.node) d3.select(old.node).select('.post-title span').html(old.title)
  })

  store.put(put.map(storable)).catch(() => {})
  addPosts(add)
}

// items-recent is the last 31 days; drop anything older that isn't in it. Measured from its
// newest post rather than today, so a feed whose update loop has stopped doesn't empty out
function expirePosts(recent){
  var tomorrow = Date.now() + 24*60*60*1000
  var newest = d3.max(recent, d => new Date(d.isoDate) < tomorrow ? d.isoDate : null)
  if (!newest) return
  var cutoff = new Date(+new Date(newest) - 31*24*60*60*1000).toISOString()
  var inRecent = new Set(recent.map(d => d.href))

  var old = _.values(posts).filter(d => d.isoDate < cutoff && !inRecent.has(d.href))
  store.del(old.map(d => d.href)).catch(() => {})
  // left on screen until the next load; an open one stays put
  old.forEach(d => d.expired = true)
}

// posts are slotted into their date, newest first, without redrawing anything. An open post,
// or the first one on screen, is held at the same screen position while posts land above it
// (manually — overflow-anchor is off, iOS safari doesn't do it)
function addPosts(list){
  list = _.sortBy(list.filter(d => d.href && d.isoDate && !posts[d.href]), d => d.isoDate).reverse()
    .filter(d => new Date(dayKey(d)) < +(new Date()) + 24*60*60*1000)
  if (!list.length) return

  var anchor = scrollAnchor()
  var anchorTop = anchor && anchor.getBoundingClientRect().top

  list.forEach(d => {
    if (posts[d.href]) return
    posts[d.href] = d
    var key = dayKey(d)
    if (!groups[key]){
      var next = _.sortBy(Object.keys(groups).filter(k => k < key)).reverse()[0]
      var dateSel = itemSel.insert('div', () => groups[next] || null).attr('class', 'date').datum(key)
      dateSel.append('h3').text(key)
      groups[key] = dateSel.node()
    }
    var before = _.find(groups[key].children, n => n.__data__ && n.__data__.isoDate < d.isoDate)
    d3.select(groups[key]).insert('div', () => before || null).datum(d).call(drawItem)
  })

  if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop)
}

function scrollAnchor(){
  if (window.scrollY < 1 && !itemSel.select('.item.active').size()) return
  var onScreen = n => { var r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }
  var items = itemSel.selectAll('.item').nodes()
  return _.find(itemSel.selectAll('.item.active').nodes(), onScreen) || _.find(items, onScreen)
}

function drawItem(postSel){
  var d = postSel.datum()
  d.node = postSel.node()

  postSel
    .attr('class', 'item')
    .classed('read', window.localStorage.getItem(d.href))

  var titleSel = postSel.append('div.post-title')
    .on('click', function(d){
      d.active = !d.active

      var sel = d3.select(this.parentNode)
        .classed('read', 1)
        .classed('active', d.active)
        .select('.content')

      if (!d.active){
        var node = this.parentNode
        if (node.getBoundingClientRect().top < 0) node.scrollIntoView(true)
        return sel.html('')
      }

      var hrefPP = d.href.split('//')[1].replace('www.', '').replace('.html', '').split('/')[0]
      sel
        .append('p').st({marginTop: 5, opacity: .4})
        .append('a').text(hrefPP).at({href: d.href, target: '_blank'})
        .parent()
        .append('a').text('>').at({href: '?feed=' + hrefPP}).st({marginLeft: '1em'})

      var width = sel.select('p').node().offsetWidth

      var contentStr = d['content:encoded'] || d.content || d.summary || ''

      // long posts are saved to their own file and fetched on click (and saved for offline, below)
      if (!contentStr && d.longPost){
        var rawHTMLSel = sel.append('div.raw-html').html('<p style="opacity:.4">loading…</p>')
        loadLongPost(d.longPost)
          .then(res => renderContent(res[0].html))
          .catch(() => rawHTMLSel.html('<p style="opacity:.4">couldn\'t load post</p>'))
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

      if (hrefPP == 'xkcd.com'){
        rawHTMLSel.append('p').text(rawHTMLSel.select('img').attr('title'))
      }
      if (hrefPP == 'thecity.nyc'){
        rawHTMLSel.selectAll('.Enhancement-item').remove()
      }
      }

      window.localStorage.setItem(d.href, new Date().toISOString())
    })

  titleSel.append('img.icon')
    .at({src: d => name2icons[d.feedName]?.src, width: 20})
    .on('error', function(d){ d3.select(this).st({opacity: 0})})
  titleSel.append('span').html(d => d.title)

  postSel.append('div.content')
}


/* offline ************************************************************************/

// generated/*.json goes through the data cache (sw.js keeps it up to date when it controls the
// page; before that, and in the blog embeds it never controls, the page saves copies itself).
// Keys match sw.js: absolute url, no query string. Cross-origin favicons and post images are
// never cached — opaque responses count ~7MB each against chrome's quota
var swControlled = () => navigator.serviceWorker && navigator.serviceWorker.controller
var isJSON = res => (res.headers.get('content-type') || '').includes('json')
var saveProgress = null   // {n, m} while long posts are being saved
var saving = false

function fromCache(url){
  if (!window.caches) return Promise.resolve()
  return caches.open(DATA_CACHE).then(c => c.match(url)).catch(() => {})
}

function putData(url, res){
  if (window.caches) caches.open(DATA_CACHE).then(c => c.put(url, res)).catch(() => {})
}

// network first with the saved copy as a fallback. Underground the phone can sit on a dead
// connection for a minute, so `slow` also gives up on the network after 5s
function getJSON(path, slow){
  var url = dataURL(path)
  var fallback = () => fromCache(url).then(res => { if (!res) throw new Error('no copy'); return res.json() })
  var req = !navigator.onLine ? fallback() : fetch(url + '?' + Math.random())
    .then(res => {
      if (!res.ok || res.redirected || !isJSON(res)) throw new Error(res.status)
      if (!swControlled()) putData(url, res.clone())
      return res.json()
    })
    .catch(fallback)
  if (!slow) return req

  var timeout = new Promise(resolve => setTimeout(() => fromCache(url).then(res => res && resolve(res.json())), 5000))
  return Promise.race([req, timeout])
}

// a saved copy opens instantly; otherwise the network, then whatever copy turns up
function loadLongPost(id){
  var url = dataURL('longposts/' + id)
  return fromCache(url).then(res => res || fetch(url + '?offline')
    .then(res => {
      if (!res.ok || res.redirected || !isJSON(res)) throw new Error(res.status)
      putData(url, res.clone())
      return res
    })
    .catch(() => fromCache(url)))
    .then(res => res.json())
}

// save every long post the list points at, newest first, three at a time; ?offline keeps sw.js
// out of it. `prune` (only after a fresh items-recent) drops ones that have left the list
function saveLongPosts(prune){
  if (!window.caches || saving) return
  saving = true
  var ids = _.uniq(_.sortBy(_.values(posts), d => d.isoDate).reverse()
    .filter(d => d.longPost && !d.expired).map(d => d.longPost))
  var urls = ids.map(id => dataURL('longposts/' + id))
  var keep = new Set(urls)

  caches.open(DATA_CACHE).then(cache => cache.keys().then(reqs => {
    var have = new Set(reqs.map(d => d.url))
    var dels = reqs
      .filter(d => prune && d.url.includes('/generated/longposts/') && !keep.has(d.url))
      .map(d => cache.delete(d))

    var todo = urls.filter(d => !have.has(d))
    saveProgress = {n: urls.length - todo.length, m: urls.length}
    drawStatus()

    function next(){
      var url = todo.shift()
      if (!url || !navigator.onLine) return
      return fetch(url + '?offline', {cache: 'no-cache'})
        .then(res => {
          if (!res.ok || res.redirected || !isJSON(res)) return
          return cache.put(url, res).then(() => { saveProgress.n++; drawStatus() })
        })
        .catch(() => {})
        .then(next)
    }
    return Promise.all(dels).then(() => Promise.all([next(), next(), next()]))
  }))
    .catch(() => {})
    .then(() => {
      saving = false
      saveProgress = null
      drawStatus()
    })
}

function drawStatus(){
  var str = ''
  if (!navigator.onLine) str = 'offline'
  else if (saveProgress) str = `${saveProgress.n}/${saveProgress.m} saved`
  statusSel.text(str)
}
drawStatus()

d3.select(window)
  .on('online', () => {
    drawStatus()
    if (isDefaultView) saveLongPosts(false)
  })
  .on('offline', drawStatus)

// ask to be spared from eviction; browsers are free to say no
if (navigator.storage && navigator.storage.persist){
  navigator.storage.persisted()
    .then(yes => yes || navigator.storage.persist())
    .catch(() => {})
}

// only the standalone page is inside sw.js's scope
if (!window.datapath && 'serviceWorker' in navigator && (location.protocol == 'https:' || location.hostname == 'localhost')){
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
