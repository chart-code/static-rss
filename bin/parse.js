var {fs, d3, io, jp, _, glob, request} = require('scrape-stl')
var util = require('./util.js')

var Parser = require('rss-parser')
var parser = new Parser()

async function main(){
  var items = []

  for (path of glob.sync(__dirname + '/cache/xml/*.xml')){
    var feedName = path.split('/').slice(-1)[0].replace('.xml', '')

    try {
      var feed = await parser.parseString(fs.readFileSync(path, 'utf8'))

      feed.items.forEach((d, i) => {
        d.feedName = feedName
        d.feedIndex = i
        d.href = d.guid && d.guid.includes && d.guid.includes('//') ? d.guid : d.link

        // trim feeds and delete unused properties
        delete d['content:encodedSnippet']
        delete d['content:contentSnippet']
        if (d['content:encoded']) delete d.content

        'content content:encoded'.split(' ').forEach(str => {
          if (d[str] && d[str].length > 40000) d[str] = ''// || console.log('LONG', d.href)
        })

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

  util.saveItems(items)

  // // debug large feed files
  // jp.nestBy(items, d => d.feedName).forEach(feed => {
  //   io.writeDataSync(__dirname + '/../cache/feed-json/' + feed.key + '.json', feed)
  // })
}
main()

