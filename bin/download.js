var {fs, d3, jp, _, request, io} = require('scrape-stl')
var xml2json = require('xml2json')
var sanitize = require('sanitize-filename')
var {execSync} = require('child_process')
var fetch = require('node-fetch')

async function main(){
  var feeds = []

  // Load feeds from subs.xml
  var xmlPath = process.env.STATIC_RSS_XML_PATH || __dirname + '/../feeds.xml'
  try {
    var xmlStr = fs.readFileSync(xmlPath, 'utf8')
    var xmlFeeds = xml2json.toJson(xmlStr, {object: true}).opml.body.outline
      .map(d => d.outline || d)
    xmlFeeds = _.flatten(xmlFeeds)
    feeds = feeds.concat(xmlFeeds)
  } catch (e){
    console.log('Missing ', {xmlPath})
  }

  // Load feeds from feeds.csv
  var csvPath = process.env.STATIC_RSS_CSV_PATH || __dirname + '/../feeds.csv'
  try{
    feeds = feeds.concat(io.readDataSync(csvPath))
  } catch(e){
    console.log('Missing ', {csvPath})
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
    console.log('Missing ', {csvUrl})
  }

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
