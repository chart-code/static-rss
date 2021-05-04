var {fs, cheerio, d3} = require('scrape-stl')
var xml2json = require('xml2json')


var subsStr = fs.readFileSync(__dirname + '/../subs.xml', 'utf8')
var subs = JSON.parse(xml2json.toJson(subsStr))

console.log(subs.opml.body)