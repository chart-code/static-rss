// Feeds like robinsloan.com only include a one line summary; fetch the post and pull out the article text.
// Also drops paywalled posts (e.g. stratechery daily updates) that only have a teaser in the feed. 
var {fs} = require('scrape-stl')
var sanitize = require('sanitize-filename')
var {JSDOM, VirtualConsole} = require('jsdom')
var {Readability} = require('@mozilla/readability')

var UA = 'static-rss/1.0 (+https://roadtolarissa.com/static-rss)'

var cachedir = __dirname + '/cache/fulltext'
if (!fs.existsSync(cachedir)) fs.mkdirSync(cachedir, {recursive: true})

var paywallRegex = /paid subscribers|paying subscribers|subscribers only|subscribe to (read|continue|keep reading|unlock)|to continue reading|already (a (paid )?subscriber|subscribed)|members only|sign in to (read|continue)|this post is for|available to subscribers|become a (paid )?subscriber|for full access|free trial/i

// only short posts get here, so a short page with subscribe language is almost always a teaser.
// Some teaser pages carry enough site chrome to pass 5000 chars (stratechery's paid updates run
// ~5700), so an explicit "subscribe to X for full access" counts at any length.
var hardPaywallRegex = /subscribe to [\w .’'-]{1,40} for full access/i
function isPaywall(text){
  text = text || ''
  return (text.length < 5000 && paywallRegex.test(text)) || hardPaywallRegex.test(text)
}

function textOf(html){ 
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() 
}

function feedHtml(d){ 
  return d['content:encoded'] || d.content || d.summary || '' 
}

// feeds whose pages are richer than their feed content (e.g. stratechery strips
// the bolded highlights); always prefer the fetched article
var alwaysFetchRegex = /stratechery\.com/

function needsFullText(d){
  if (d.longPost) return false
  if (alwaysFetchRegex.test(d.href || '')) return true
  var html = feedHtml(d)
  return textOf(html).length < 400 && !/<img/i.test(html)
}

function cachePath(url){
  return cachedir + '/' + sanitize(url).slice(-150) + '.json'
}

async function fetchArticle(url){
  var path = cachePath(url)
  if (fs.existsSync(path)) return JSON.parse(fs.readFileSync(path, 'utf8'))

  var rv = {url}
  try {
    var controller = new AbortController()
    var timer = setTimeout(() => controller.abort(), 20*1000)
    var res = await fetch(url, {headers: {'User-Agent': UA}, signal: controller.signal})
    clearTimeout(timer)
    rv.status = res.status
    var pageHtml = await res.text()

    var doc = new JSDOM(pageHtml, {url, virtualConsole: new VirtualConsole()}).window.document // VirtualConsole hides css parse errors
    doc.querySelectorAll('script, style, nav, footer, form, iframe, noscript, header').forEach(d => d.remove())
    // lazy-loaded images: promote data-src to src so they show up
    doc.querySelectorAll('img').forEach(d => {
      var lazy = d.getAttribute('data-src') || d.getAttribute('data-lazy-src') || d.getAttribute('data-original')
      if (lazy && !d.getAttribute('src')) d.setAttribute('src', lazy)
    })
    doc.querySelectorAll('img[src], a[href]').forEach(d => {
      if (d.src) d.setAttribute('src', d.src)
      if (d.href) d.setAttribute('href', d.href)
    })

    // article, then main (readability often drops figures), then readability
    var container = null
    for (var sel of ['article', 'main']){
      var el = doc.querySelector(sel)
      if (el && textOf(el.innerHTML).length > 200){ container = el; break }
    }
    if (container){
      // cruft: the reader already shows the title, so drop a leading h1/dateline;
      // drop nav links like 'to the blog home page'
      var h1 = container.querySelector('h1')
      if (h1) h1.remove()
      var first = container.firstElementChild
      for (var i = 0; i < 3 && first; i++){
        var t = first.textContent.replace(/\s+/g, ' ').trim()
        var next = first.nextElementSibling
        if (t.length < 40 && /^\w+ \d{1,2}, \d{4}$/.test(t)) first.remove()
        first = next
      }
      container.querySelectorAll('a').forEach(a => {
        var t = a.textContent.trim()
        if (/^((back |go |return )?to the (blog )?home ?page|home|back to top|read more posts)$/i.test(t)){
          var p = a.closest('p, div')
          ;(p && textOf(p.innerHTML).length < 60 ? p : a).remove()
        }
      })
    }
    rv.html = container 
      ? container.innerHTML 
      : new Readability(doc).parse()?.content || ''
    rv.text = textOf(rv.html)
    rv.paywall = isPaywall(rv.text)
  } catch (e){ 
    rv.error = '' + e 
  }

  fs.writeFileSync(path, JSON.stringify(rv))
  return rv
}

// Replace short feed content with the article text for recent posts, drop paywalled posts.
// Articles are cached forever; at most maxFetches new pages are downloaded per run.
async function addFullText(items, maxFetches=100){
  var cutoff = new Date(Date.now() - 1000*60*60*24*31).toISOString()
  var todo = items.filter(d => d.href && d.isoDate > cutoff && needsFullText(d))
  todo.sort((a, b) => a.isoDate < b.isoDate ? 1 : -1) // newest first, so a fetch cap doesn't starve new posts

  var fetched = 0
  for (var d of todo){
    if (!fs.existsSync(cachePath(d.href))){
      if (fetched >= maxFetches) continue
      fetched++
    }

    var article = await fetchArticle(d.href)
    // re-judged every run from the cached text, so a rule change applies to pages fetched before it
    if (isPaywall(article.text)){
      console.log('PAYWALL', d.href)
      d.paywall = true
    } else if (article.text && article.html.length < 300000 &&
        (alwaysFetchRegex.test(d.href) || article.text.length > textOf(feedHtml(d)).length)){
      d['content:encoded'] = article.html // oversize posts are offloaded to longposts/ later in parse.js
    }
  }

  console.log(`fulltext: ${todo.length} short posts, ${fetched} fetched`)
  return items.filter(d => !d.paywall)
}

module.exports = {isPaywall, addFullText, fetchArticle, needsFullText}
