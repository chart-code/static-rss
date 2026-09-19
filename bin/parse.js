var {fs, d3, io, jp, _, glob, request} = require('scrape-stl')
var util = require('./util.js')
var fulltext = require('./fulltext.js')

var sanitize = require('sanitize-filename')

var longpostdir = __dirname + '/../public/generated/longposts/'
var fs2 = require('fs')
if (!fs2.existsSync(longpostdir)) fs2.mkdirSync(longpostdir, {recursive: true})

var Parser = require('rss-parser')
var parser = new Parser()

// drop newsletter sponsor blocks: a short label-like element matching a marker,
// plus following siblings until the next heading/hr (capped so a bad match can't eat a post)
var sponsorRegex = /^(a word from our sponsors?|together with|presented by|sponsored by|in partnership with|todays? (newsletter|issue|edition) is (sponsored|presented))\b/i
function stripSponsors(d){
  var str = 'content:encoded' in d ? 'content:encoded' : 'content'
  var html = d[str]
  // cheap strict pre-check so we only pay for jsdom when a sponsor LABEL is present
  if (!html || html.length > 120000 || !/>\s*(a word from our sponsors?|together with\b|presented by\b|sponsored by\b|in partnership with\b)/i.test(html)) return
  try {
    var {JSDOM, VirtualConsole} = require('jsdom')
    var dom = new JSDOM('<body>' + html, {virtualConsole: new VirtualConsole()})
    var doc = dom.window.document
    var removed = 0
    doc.body.querySelectorAll('*').forEach(el => {
      if (!el.isConnected) return
      var own = el.textContent.replace(/\s+/g, ' ').trim()
      if (own.length > 60 || !sponsorRegex.test(own)) return
      var chunk = [el], n = el.nextElementSibling
      while (n && removed < 4000 && !/^(h1|h2|h3|h4|h5|h6|hr)$/i.test(n.tagName)){
        chunk.push(n)
        removed += n.textContent.length
        n = n.nextElementSibling
      }
      if (removed < 4000) chunk.forEach(c => c.remove())
    })
    if (removed){
      d[str] = doc.body.innerHTML
      console.log('SPONSOR stripped', removed, 'chars:', d.href)
    }
    dom.window.close()
  } catch (e){}
}

async function main(){
  var items = []

  for (path of glob.sync(__dirname + '/cache/xml/*.xml')){
    var feedName = path.split('/').slice(-1)[0].replace('.xml', '')

    try {
      var xmlStr = fs.readFileSync(path, 'utf8')
        .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;')
        .replace(/<(?!\/?[a-zA-Z!?\[])/g, '&lt;')
      var feed = await parser.parseString(xmlStr)

      feed.items.forEach((d, i) => {
        d.feedName = feedName
        d.feedIndex = i
        if (d.title && typeof d.title !== 'string') d.title = d.title._ || d.title.toString()
        d.href = d.guid && d.guid.includes && d.guid.includes('//') ? d.guid : d.link

        // trim feeds and delete unused properties
        delete d['content:encodedSnippet']
        delete d['content:contentSnippet']
        if (d['content:encoded']) delete d.content



        items.push(d)
      })
    } catch (e){ console.log(feedName, '////', ('' + e).split('\n')[0]) }
  }

  items = items
    .filter(d => {
      if (!d['content:encoded']) return true

      var paywallStr = '              Read more'
      var isPaywall = d['content:encoded'].includes(paywallStr)

      if (isPaywall) console.log('PAYWALL', d.href)
      return !isPaywall
    }) 
    .filter(d => {
      return !d['content:encoded'] || !d['content:encoded'].includes('Listen to more mind-expanding audio on')
    })

  items = await fulltext.addFullText(items)
  items.forEach(stripSponsors)

  // long posts are saved to their own file and fetched on click
  items.forEach(d => {
    'content content:encoded'.split(' ').forEach(str => {
      if (d[str] && d[str].length > 40000){
        d.longPost = sanitize(d.href || d.title).slice(-150)
        fs.writeFileSync(longpostdir + d.longPost + '.json', JSON.stringify([{html: d[str]}]))
        d[str] = ''
      }
    })
  })

  util.saveItems(items)

  // // debug large feed files
  // jp.nestBy(items, d => d.feedName).forEach(feed => {
  //   io.writeDataSync(__dirname + '/../cache/feed-json/' + feed.key + '.json', feed)
  // })
}
main()

