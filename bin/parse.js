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
      feed.items.forEach(d => {
        d.feedName = feedName
        d.href = d.guid && d.guid.includes && d.guid.includes('//') ? d.guid : d.link
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
      if (isPaywall) console.log(d.href)
      return !isPaywall
    })

    

                    

  io.writeDataSync(__dirname + '/../public/generated/items-all.json', items)
  io.writeDataSync(__dirname + '/../public/generated/items.json', items
    .filter(d => d.isoDate > '2021'))
}
main()
