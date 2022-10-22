var {fs, d3, io, jp, glob, _, glob, request} = require('scrape-stl')
var sanitize = require('sanitize-filename')
var util = require('./util.js')
  
var cachedir = __dirname + '/cache/days'
if (!fs.existsSync(cachedir)) fs.mkdirSync(cachedir)

async function main(){
  await util.sleep(10)

  var items = util.loadItems()
  items.forEach((d, i) => {
    if (!d.isoDate) d.isoDate = '2020-01-01T'

    d.domain = getHostnameFromRegex(d.href)
    if (!d.domain) return console.log('missing domain', d.link)
    d.slug = sanitize(d.domain) + '_.._' + sanitize(d.href).slice(-30)

    var date = d.isoDate.split('T')[0]
    var outdir = cachedir + '/' + date
    if (!fs.existsSync(outdir)) fs.mkdirSync(outdir)

    io.writeDataSync(outdir + '/' + d.slug + '.json', d)
  })
  delete items


  var allFiles = glob.sync(cachedir + '/**/*.json')

  // Save items by date
  console.log('saving items by date')
  var datedir = __dirname + '/../public/generated/dates'
  if (!fs.existsSync(datedir)) fs.mkdirSync(datedir)

  jp.nestBy(allFiles, d => d.split('bin/cache/days/')[1].split('/')[0]).forEach(files => {
    if (!files.key.includes('2022')) return
    var posts = files.map(path => JSON.parse(fs.readFileSync(path, 'utf8')))
    fs.writeFileSync(datedir + '/' + files.key + '.json', JSON.stringify(posts))
  })

  // Save items by feed
  console.log('saving items by feed')
  var feeddir = __dirname + '/../public/generated/feeds'
  if (!fs.existsSync(feeddir)) fs.mkdirSync(feeddir)

  var last10Posts = []

  var byFeed = jp.nestBy(allFiles, d => d.split('_.._')[0].split('/').slice(-1)[0])
  for (files of byFeed){
    // fixes OOM error
    console.log('saving feed', files.key)
    await util.sleep(100)

    // TODO only parse 10 most recent posts
    var posts = files.map(path => JSON.parse(fs.readFileSync(path, 'utf8')))
    if (!['slowboring.com', 'marginalrevolution.com', 'propublica.org'].includes(files.key)){
      fs.writeFileSync(feeddir + '/' + files.key + '.json', JSON.stringify(posts))
    }

    last10Posts.push(...posts.slice(-10))
  }


  console.log('filtering last10posts items by feed')
  last10Posts = last10Posts
    .filter(d => {
      if (d.domain == 'westsiderag.com' && d.content?.includes('SPONSORED: ')) return false
      return true
    })
    // TODO filter future posts
    .filter(d => !d.title || !d.title.includes('0021: hytradboi schedule + tickets'))

  last10Posts = _.sortBy(last10Posts, d => d.isoDate).reverse()


  // TODO switch to archive
  console.log('saving items-*.json')
  io.writeDataSync(__dirname + '/../public/generated/items-recent.json', itemsFromLastNdays(10))
  io.writeDataSync(__dirname + '/../public/generated/items-today.json', itemsFromLastNdays(2), {indent: 2})

  function itemsFromLastNdays(n){
    var isostr = (new Date(new Date() - 1000*60*60*24*n)).toISOString().split('T')[0]

    return last10Posts.filter(d => d.isoDate >= isostr)
  }


  function getHostnameFromRegex(url){
    var matches = url.replace('www.', '').match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
    return matches && matches[1]
  }
}
main()
