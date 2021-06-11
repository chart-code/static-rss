var {fs, d3, io, jp, glob, _, glob, request} = require('scrape-stl')
var sanitize = require('sanitize-filename')
  
var items = io.readDataSync(__dirname + '/../public/generated/items-all.json')

var cachedir = __dirname + '/cache/days'
if (!fs.existsSync(cachedir)) fs.mkdirSync(cachedir)

items.forEach((d, i) => {
  if (!d.isoDate) d.isoDate = '2020-01-01T'

  d.domain = getHostnameFromRegex(d.href)
  if (!d.domain) return console.log(d.link)
  d.slug = sanitize(d.domain) + '_.._' + sanitize(d.href).slice(-30)

  var date = d.isoDate.split('T')[0]
  var outdir = cachedir + '/' + date
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir)

  io.writeDataSync(outdir + '/' + d.slug + '.json', d)
})


var allFiles = glob.sync(cachedir + '/**/*.json')

var datedir = __dirname + '/../public/generated/dates'
if (!fs.existsSync(datedir)) fs.mkdirSync(datedir)

jp.nestBy(allFiles, d => d.split('bin/cache/days/')[1].split('/')[0]).forEach(files => {
  var posts = files.map(io.readDataSync)
  io.writeDataSync(datedir + '/' + files.key + '.json', posts)
})



var feeddir = __dirname + '/../public/generated/feeds'
if (!fs.existsSync(feeddir)) fs.mkdirSync(feeddir)

var last10Posts = []

jp.nestBy(allFiles, d => d.split('_.._')[0].split('/').slice(-1)[0]).forEach(files => {
  var posts = files.map(io.readDataSync)
  io.writeDataSync(feeddir + '/' + files.key + '.json', posts)

  last10Posts = last10Posts.concat(posts.slice(-10))
})


last10Posts = last10Posts.filter(d => {

  if (d.domain == 'westsiderag.com' && d.content?.includes('SPONSORED: ')) return false

  return true
})

last10Posts = _.sortBy(last10Posts, d => d.isoDate).reverse()


// TODO switch to archive
io.writeDataSync(__dirname + '/../public/generated/items-recent.json', itemsFromLastNdays(90))
io.writeDataSync(__dirname + '/../public/generated/items-today.json', itemsFromLastNdays(2), {indent: 2})

function itemsFromLastNdays(n){
  var isostr = (new Date(new Date() - 1000*60*60*24*n)).toISOString().split('T')[0]

  return last10Posts.filter(d => d.isoDate >= isostr)
}


function getHostnameFromRegex(url){
  var matches = url.replace('www.', '').match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
  return matches && matches[1]
}
