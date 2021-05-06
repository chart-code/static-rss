var {fs, d3, io, jp, _, glob, request} = require('scrape-stl')

var Parser = require('rss-parser')
var parser = new Parser()

async function main(){
  var items = []

  for (path of glob.sync(__dirname + '/cache/*.xml')){
    var feedName = path.split('/').slice(-1)[0].replace('.xml', '')

    try {
      var feed = await parser.parseString(fs.readFileSync(path, 'utf8'))
      console.log(feed.items.length, feedName)
      
      feed.items.slice(0, 10).forEach(d => {
        d.feedName = feedName
        d.href = d.guid && d.guid.includes && d.guid.includes('//') ? d.guid : d.link

        delete d['content:encodedSnippet']
        delete d['content:contentSnippet']
        if (d['content:encoded']) delete d.content

        'content content:encoded'.split(' ').forEach(str => {
          if (d[str] && d[str].length > 40000){
            d[str] = ''
            console.log('LONG', d.href)
          }
        })

        items.push(d)
      })
    } catch (e){
      e = ('' + e).split('\n')[0]
      console.log(-1, feedName, '////', e)
    }
  }

  items = items
    .filter(d => {
      if (!d['content:encoded']) return true

      var paywallStr = 'Read more\n                            </a>'
      var isPaywall = d['content:encoded'].includes(paywallStr)
      if (isPaywall) console.log('PAYWALL', d.href)
      return !isPaywall
    })     

  var recentItems = items.filter(d => d.isoDate > '2021')

  io.writeDataSync(__dirname + '/../public/generated/items-all.json', items)
  io.writeDataSync(__dirname + '/../public/generated/items.json', recentItems)


  jp.nestBy(recentItems, d => d.feedName).forEach(feed => {
    io.writeDataSync(__dirname + '/../cache/feed-json/' + feed.key + '.json', feed)
  })
}
main()
