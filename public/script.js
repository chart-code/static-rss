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
  

// network first; sw.js keeps a copy of generated/*.json, so the list renders with no signal.
// The worker isn't controlling the page on a first visit, so also give up on a dead-slow network
// after 5s and look in the cache directly (keys match sw.js: absolute url, no query string)
function getJSON(path, bust){
  var url = new URL(window.datapath + 'generated/' + path + '.json', location.href).href
  var net = fetch(url + (bust ? '?' + Math.random() : '')).then(res => {
    if (!res.ok || res.redirected) throw new Error(res.status)
    return res.json()
  })
  var cached = () => !window.caches ?
    Promise.reject(new Error('no caches')) :
    caches.match(url).then(res => res ? res.json() : Promise.reject(new Error('no copy')))
  var slow = new Promise(resolve => setTimeout(() => resolve(cached().catch(() => net)), 5000))

  return Promise.race([net, slow]).catch(cached)
}

Promise.all([getJSON(itemURL, true), getJSON('favicons').catch(() => [])]).then(res => {

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

  // add today's and yesterday's posts
  var itemSel = d3.select('.items').html('')
  drawDays(items)

  // add posts from the last 90 days
  getJSON(itemURL.replace('today', 'recent'))
    .then(recent => drawDays(recent, itemSel.selectAll('div.date').data().map(d => d.key)))
    .catch(() => {})

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

        // long posts are saved to their own file and fetched on click
        if (!contentStr && d.longPost){
          var rawHTMLSel = sel.append('div.raw-html').html('<p style="opacity:.4">loading…</p>')
          getJSON('longposts/' + d.longPost)
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
})

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
}
