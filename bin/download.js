var {fs, d3, jp, _, request} = require('scrape-stl')
var xml2json = require('xml2json')
var sanitize = require('sanitize-filename')

var feeds = []

var str = fs.readFileSync(__dirname + '/../subs.xml', 'utf8')
var feeds = xml2json.toJson(str, {object: true}).opml.body.outline
  .map(d => d.outline || d)
feeds = _.flatten(feeds)


// Check for duplicate titles
jp.nestBy(feeds, d => d.title).forEach(d => {
  if (d.length > 1) console.log(d)
})

feeds.forEach(feed => {
  request({url: feed.xmlUrl}, (err, res, body) => {
    if (!body) return

    fs.writeFileSync(`${__dirname}/cache/${sanitize(feed.title)}.xml`, body)
  })
})
