var {fs, d3, jp, _, request} = require('scrape-stl')
var xml2json = require('xml2json')
var sanitize = require('sanitize-filename')
var {execSync} = require('child_process')
var fetch = require('node-fetch')


async function main(){
  try {
    var xmlStr = fs.readFileSync(__dirname + '/../subs.xml', 'utf8')
    var feeds = xml2json.toJson(xmlStr, {object: true}).opml.body.outline
      .map(d => d.outline || d)
    feeds = _.flatten(feeds)
  } catch (e){
    console.log(e)
    feeds = []
  }

  // Also get list of feeds from
  // https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0
  var csvUrl = 'https://www.googleapis.com/drive/v3/files/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/export?mimeType=text/csv&key=AIzaSyAT-ALGW_bcmcvNs1dPgcV7fF6tR1vKY44'
  var csvStr = await (await fetch(csvUrl)).text()
  feeds = feeds.concat(d3.csvParse(csvStr))

  // check for duplicate titles
  jp.nestBy(feeds, d => d.title)
    .forEach(d => d.length > 1 && console.log(d))

  var outdir = __dirname + `/cache/xml`
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir)

  feeds.forEach(feed => {
    if (feed.ignore) return console.log('ignore', feed)

    request({url: feed.xmlUrl, timeout: 15*1000}, (err, res, body) => {
      if (!body) return
      console.log(feed.title)
      fs.writeFileSync(`${outdir}/${sanitize(feed.title)}.xml`, body)
    })
  })
}
main()
