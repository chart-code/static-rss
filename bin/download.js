var {fs, d3, _, request} = require('scrape-stl')
var xml2json = require('xml2json')

var feeds = []

var str = fs.readFileSync(__dirname + '/../subs.xml', 'utf8')
var feeds = xml2json.toJson(str, {object: true}).opml.body.outline
  .map(d => d.outline || d)

feeds = _.flatten(feeds)


feeds.forEach(feed => {
  console.log(feed)
  request({url: feed.xmlUrl}, (err, res, body) => {
    var dateStr = (new Date()).toISOString()
    console.log('new download', dateStr)
    fs.writeFileSync(`${rawdir}/${dateStr}.json`, body)

    merge()
  })
})
