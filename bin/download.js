var {fs, d3, jp, _, request, io} = require('scrape-stl')
var sanitize = require('sanitize-filename')
var fetch = require('node-fetch')

var UA = 'static-rss/1.0 (+https://roadtolarissa.com/static-rss)'

async function main(){
  var feeds = []

  // Load feeds from subs.xml
  var xmlPath = process.env.STATIC_RSS_XML_PATH || __dirname + '/../feeds.xml'
  try {
    var xmlStr = fs.readFileSync(xmlPath, 'utf8')
    var xmlFeeds = [...xmlStr.matchAll(/<outline [^>]*xmlUrl="([^"]*)"[^>]*>/g)].map(([str, xmlUrl]) => {
      var title = str.match(/ (?:title|text)="([^"]*)"/)?.[1] || xmlUrl
      return {title, xmlUrl}
    })
    feeds = feeds.concat(xmlFeeds)
  } catch (e){
    console.log('Error loading: ', {xmlPath})
  }

  // Load feeds from feeds.csv
  var csvPath = process.env.STATIC_RSS_CSV_PATH || __dirname + '/../feeds.csv'
  try{
    feeds = feeds.concat(io.readDataSync(csvPath))
  } catch(e){
    console.log('Error loading: ', {csvPath})
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
    console.log('Error loading: ', {csvUrl})
  }

  // check for duplicate titles
  jp.nestBy(feeds, d => d.title)
    .forEach(d => d.length > 1 && console.log(d))

  var outdir = __dirname + `/cache/xml`
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, {recursive: true})

  // etag/last-modified from the previous run so we can make conditional requests
  // (sites like rachelbythebay.com block readers that re-download unchanged feeds)
  var headersPath = __dirname + '/cache/headers.json'
  var savedHeaders = fs.existsSync(headersPath) ? JSON.parse(fs.readFileSync(headersPath, 'utf8')) : {}

  var pending = 0
  feeds.forEach(feed => {
    if (feed.ignore) return console.log('IGNORE: ', feed.xmlUrl)
    if (!feed.xmlUrl) return console.log('NO URL: ', feed.title)

    var outpath = `${outdir}/${sanitize(feed.title)}.xml`
    var prev = savedHeaders[feed.xmlUrl] || {}
    var headers = {'User-Agent': UA}
    if (fs.existsSync(outpath)){
      if (prev.etag) headers['If-None-Match'] = prev.etag
      if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified
    }

    pending++
    request({url: feed.xmlUrl, timeout: 15*1000, headers, gzip: true}, (err, res, body) => {
      if (res?.statusCode == 304){
        console.log('UNCHANGED: ', feed.xmlUrl)
      } else if (err || res.statusCode != 200 || !body){
        console.log(`ERROR ${err?.code || res?.statusCode}: `, feed.xmlUrl)
      } else {
        console.log(feed.xmlUrl)
        fs.writeFileSync(outpath, body)
        savedHeaders[feed.xmlUrl] = {etag: res.headers.etag, lastModified: res.headers['last-modified']}
      }

      pending--
      if (!pending) fs.writeFileSync(headersPath, JSON.stringify(savedHeaders, null, 2))
    })
  })
}
main()
