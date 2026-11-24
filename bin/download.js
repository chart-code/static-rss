var {fs, d3, jp, request, io} = require('scrape-stl')
var sanitize = require('sanitize-filename')
var fetch = require('node-fetch')

var UA = 'static-rss/1.0 (+https://roadtolarissa.com/static-rss)'

async function main(){
  var feeds = []

  // Load feeds from subs.xml
  var xmlPath = process.env.STATIC_RSS_XML_PATH || __dirname + '/../feeds.xml'
  try {
    var xmlStr = fs.readFileSync(xmlPath, 'utf8')
    var xmlFeeds = [...xmlStr.matchAll(/<outline [^>]*xmlUrl="([^"]*)"[^>]*>/g)].map(([str, xmlUrl]) => {
      var title = str.match(/ (?:title|text)="([^"]*)"/)?.[1] || xmlUrl
      return {title, xmlUrl}
    })
    feeds = feeds.concat(xmlFeeds)
  } catch (e){
    console.log('Error loading: ', {xmlPath})
  }

  // Load feeds from feeds.csv
  var csvPath = process.env.STATIC_RSS_CSV_PATH || __dirname + '/../feeds.csv'
  try{
    feeds = feeds.concat(io.readDataSync(csvPath))
  } catch(e){
    console.log('Error loading: ', {csvPath})
  }

  // Also get list of feeds from a google doc after share -> publish to web -> csv
  // https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0 -> 
  // https://www.googleapis.com/drive/v3/files/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/export?mimeType=text/csv&key=AIzaSyAT-ALGW_bcmcvNs1dPgcV7fF6tR1vKY44
  var csvUrl = process.env.STATIC_RSS_CSV_URL || ''
  try {
    var csvStr = await (await fetch(csvUrl)).text()
    feeds = feeds.concat(d3.csvParse(csvStr))

    feeds.forEach(d => {
      d.xmlUrl = d.xmlUrl || d.feed
      d.title = d.title || d.org
    })
  } catch(e) {
    console.log('Error loading: ', {csvUrl})
  }

  // check for duplicate titles
  jp.nestBy(feeds, d => d.title)
    .forEach(d => d.length > 1 && console.log(d))

  var outdir = __dirname + `/cache/xml`
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, {recursive: true})

  // etag/last-modified from the previous run so we can make conditional requests
  // (sites like rachelbythebay.com block readers that re-download unchanged feeds)
  var headersPath = __dirname + '/cache/headers.json'
  var savedHeaders = fs.existsSync(headersPath) ? JSON.parse(fs.readFileSync(headersPath, 'utf8')) : {}

  var pending = 0
  feeds.forEach(feed => {
    if (feed.ignore) return console.log('IGNORE: ', feed.xmlUrl)
    if (!feed.xmlUrl) return console.log('NO URL: ', feed.title)

    var outpath = `${outdir}/${sanitize(feed.title)}.xml`
    var prev = savedHeaders[feed.xmlUrl] || {}
    var headers = {'User-Agent': UA}
    if (fs.existsSync(outpath)){
      if (prev.etag) headers['If-None-Match'] = prev.etag
      if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified
    }

    pending++
    request({url: feed.xmlUrl, timeout: 15*1000, headers, gzip: true}, async (err, res, body) => {
      if (res?.statusCode == 304){
        console.log('UNCHANGED: ', feed.xmlUrl)
      } else if (err || res.statusCode != 200 || !body){
        console.log(`ERROR ${err?.code || res?.statusCode}: `, feed.xmlUrl)
      } else {
        console.log(feed.xmlUrl)
        // a sitemap or a plain page stands in for a feed: what's new on it is written out as rss
        // for parse.js. Anything else (rss, atom) is saved as it came.
        var kind = pageKind(body)
        if (kind){
          var page = pages[feed.xmlUrl] = pages[feed.xmlUrl] || {}
          try {
            if (kind == 'sitemap') await addSitemapItems(page, body, feed.title, new Date(), fetchMeta)
            else addWatchItem(page, body, feed.xmlUrl, new Date())
            body = toRss(feed, page.items || [])
          } catch (e){ console.log('ERROR ' + kind + ': ', feed.xmlUrl, '' + e) }
        }
        fs.writeFileSync(outpath, body)
        savedHeaders[feed.xmlUrl] = {etag: res.headers.etag, lastModified: res.headers['last-modified']}
      }

      pending--
      if (!pending){
        fs.writeFileSync(headersPath, JSON.stringify(savedHeaders, null, 2))
        fs.writeFileSync(pagesPath, JSON.stringify(pages, null, 2))
      }
    })
  })
}

// Sites with no feed. pages.json, keyed by the sheet's xmlUrl, holds what each has shown us:
// a sitemap's seen urls ({url: iso date first seen}), a plain page's text hash, and the items
// made from them (the last 50, rewritten into cache/xml every run).
var pagesPath = __dirname + '/cache/pages.json'
var pages = fs.existsSync(pagesPath) ? JSON.parse(fs.readFileSync(pagesPath, 'utf8')) : {}

// the root element decides: <urlset> is a sitemap, an html page is watched, the rest is a feed
function pageKind(body){
  var s = String(body).replace(/^\uFEFF/, '')
  var root = s.match(/^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)*<([a-z][\w:.-]*)/i)?.[1].toLowerCase()
  if (root == 'urlset') return 'sitemap'
  if (/^\s*<!doctype html/i.test(s) || ['html', 'head', 'body'].includes(root)) return 'html'
  return ''
}

var decode = s => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(x?)([0-9a-f]+);/gi, (all, x, n) => { try { return String.fromCodePoint(parseInt(n, x ? 16 : 10)) } catch (e){ return all } })
  .replace(/&amp;/g, '&')
var textOf = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
var esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
var metaOf = (html, key) => {
  var tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i'))?.[0]
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '').trim() : ''
}

// a sitemap url's <title>, description and og:image; an unreachable page still becomes an item
async function fetchMeta(url){
  try {
    var res = await fetch(url, {headers: {'User-Agent': UA}, timeout: 15*1000})
    var html = res.ok ? await res.text() : ''
  } catch (e){ html = '' }
  return {
    title: textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description: metaOf(html, 'description') || metaOf(html, 'og:description'),
    image: metaOf(html, 'og:image'),
  }
}

// Every url not seen before is an item dated now. The first fetch only records what's there
// (dated by <lastmod>, else now) so a new sitemap row doesn't fill today's list with its back
// catalogue. At most 20 page fetches a run; the rest wait, unseen, for the next one.
async function addSitemapItems(page, xml, siteTitle, now, fetchMeta){
  var urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, d]) => ({
    loc: decode(d.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1] || ''),
    lastmod: d.match(/<lastmod>\s*([^<\s]+)/)?.[1],
  })).filter(d => d.loc)

  if (!page.seen){
    page.seen = {}
    urls.forEach(d => page.seen[d.loc] = d.lastmod && !isNaN(Date.parse(d.lastmod)) ? new Date(d.lastmod).toISOString() : now.toISOString())
    return
  }

  for (var d of urls.filter(d => !page.seen[d.loc]).slice(0, 20)){
    var meta = await fetchMeta(d.loc)
    // framer gives every page the site's own title; the url's last segment tells them apart
    var title = meta.title || siteTitle
    if (title.toLowerCase() == String(siteTitle).toLowerCase()) title += ': ' + decodeURIComponent(d.loc.replace(/\/+$/, '').split('/').pop()).replace(/[-_]+/g, ' ')
    page.seen[d.loc] = now.toISOString()
    page.items = (page.items || []).concat({
      title, link: d.loc, isoDate: now.toISOString(),
      html: (meta.description ? `<p>${esc(meta.description)}</p>` : '')
        + (meta.image ? `<p><img src="${esc(meta.image)}"></p>` : '')
        + `<p><a href="${esc(d.loc)}">${esc(d.loc)}</a></p>`,
    }).slice(-50)
  }
}

// A plain page gets an item when its visible text changes. The text is the body with scripts,
// styles, svg and comments gone, and with what churns on an unchanged page (times, iso dates,
// build hashes) taken out before hashing. The first sight is the baseline. One item a day at
// most: a change on a day that already has one keeps the old hash, so it shows up tomorrow.
function addWatchItem(page, html, url, now){
  var body = html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] || html
  body = body.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg)[\s>][\s\S]*?<\/\1>/gi, ' ')
  var text = textOf(body)
    .replace(/\b\d{4}-\d\d-\d\d(?:[T ][\d:.]+(?:Z|[+-]\d\d:?\d\d)?)?/g, '')
    .replace(/\b\d{1,2}:\d\d(?::\d\d)?(?:\s?[ap]m)?\b/gi, '')
    .replace(/\b(?=[\w-]*\d)[\w-]{16,}\b/g, '')
    .replace(/\s+/g, ' ').trim()
  var hash = require('crypto').createHash('sha1').update(text).digest('hex')

  if (!page.hash) return page.hash = hash
  if (hash == page.hash) return
  var day = now.toISOString().slice(0, 10)
  if ((page.items || []).some(d => d.isoDate.slice(0, 10) == day)) return

  page.hash = hash
  var title = textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || url
  var paras = [...body.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map(([p]) => textOf(p)).filter(d => d).slice(0, 2)
  if (!paras.length) paras = [text.slice(0, 400)]
  page.items = (page.items || []).concat({
    title: title + ' (changed)',
    // the day in the link keeps each change its own post in the archive (and out of fulltext.js)
    link: url + '#changed-' + day,
    isoDate: now.toISOString(),
    html: `<p><i>The page changed.</i></p>` + paras.map(d => `<p>${esc(d)}</p>`).join('')
      + `<p><a href="${esc(url)}">${esc(url)}</a></p>`,
  }).slice(-50)
}

function toRss(feed, items){
  var cdata = s => '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${esc(feed.title)}</title>
<link>${esc(feed.xmlUrl)}</link>
${items.map(d => `<item>
<title>${esc(d.title)}</title>
<link>${esc(d.link)}</link>
<guid isPermaLink="true">${esc(d.link)}</guid>
<pubDate>${new Date(d.isoDate).toUTCString()}</pubDate>
<content:encoded>${cdata(d.html)}</content:encoded>
</item>`).join('\n')}
</channel>
</rss>
`
}

module.exports = {pageKind, addSitemapItems, addWatchItem, toRss}
if (require.main == module) main()
