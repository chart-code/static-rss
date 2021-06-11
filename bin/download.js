var {fs, d3, jp, _, request} = require('scrape-stl')
var xml2json = require('xml2json')
var sanitize = require('sanitize-filename')
var {execSync} = require('child_process')

var str = fs.readFileSync(__dirname + '/../subs.xml', 'utf8')
var feeds = xml2json.toJson(str, {object: true}).opml.body.outline
  .map(d => d.outline || d)
feeds = _.flatten(feeds)

// check for duplicate titles
jp.nestBy(feeds, d => d.title)
  .forEach(d => d.length > 1 && console.log(d))

var outdir = __dirname + `/cache/xml`
if (!fs.existsSync(outdir)) fs.mkdirSync(outdir)

feeds.forEach(feed => {
  request({url: feed.xmlUrl, timeout: 15*1000}, (err, res, body) => {
    if (!body) return
    console.log(feed.title)
    fs.writeFileSync(`${outdir}/${sanitize(feed.title)}.xml`, body)
  })
})


