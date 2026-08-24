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

function textOf(html){ 
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() 
}

function feedHtml(d){ 
  return d['content:encoded'] || d.content || d.summary || '' 
}

function needsFullText(d){
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
    doc.querySelectorAll('script, style, nav, footer, form, iframe, noscript').forEach(d => d.remove())
    doc.querySelectorAll('img[src], a[href]').forEach(d => {
      if (d.src) d.setAttribute('src', d.src)
      if (d.href) d.setAttribute('href', d.href)
    })

    var article = doc.querySelector('article')
    rv.html = article && textOf(article.innerHTML).length > 200 
      ? article.innerHTML 
      : new Readability(doc).parse()?.content || ''
    rv.text = textOf(rv.html)
    // only short posts get here, so a short page with subscribe language is almost always a teaser
    rv.paywall = rv.text.length < 5000 && paywallRegex.test(rv.text)
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
    if (article.paywall){
      console.log('PAYWALL', d.href)
      d.paywall = true
    } else if (article.text && article.text.length > textOf(feedHtml(d)).length && article.html.length < 40000){
      d['content:encoded'] = article.html
    }
  }

  console.log(`fulltext: ${todo.length} short posts, ${fetched} fetched`)
  return items.filter(d => !d.paywall)
}

module.exports = {addFullText, fetchArticle, needsFullText}
