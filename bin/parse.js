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
        if ('' + d.isoData > '2021') items.push(d)
      })
    } catch (e){
      e = ('' + e).split('\n')[0]
      console.log(-1, feedName, '////', e)
    }
  }

  io.writeDataSync(__dirname + '/items.json', items)
}
main()
