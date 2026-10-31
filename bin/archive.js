// Bakes bin/cache/days (one json per post, in a directory per day) out to public/generated/:
// items-today.json and items-recent.json, the two files the reader loads, plus the most recent
// posts of each site for the ?feed= view.
//
//   node archive.js          incremental: only the 31 day window and the sites that got a post
//   node archive.js --full   rebuild every feeds/*.json from the archive (after a filter change)
//
// Nothing here holds more than one year of the parse handoff, the 31 day window or one site's
// 100 posts at a time: a run costs a readdir of the day directories and a couple of thousand
// small reads, not the whole 70k file archive.
var {fs, _} = require('scrape-stl')
var sanitize = require('sanitize-filename')
var util = require('./util.js')

var daysdir = __dirname + '/cache/days'
var gendir = __dirname + '/../public/generated'

var full = process.argv.includes('--full')
// the reader only ever shows a site's recent posts, and a 67 MB thecity.nyc.json was most of
// what made this script slow and fat
var feedCap = 100

// glob.sync sorted its matches with localeCompare; same-timestamp posts in items-recent.json
// come out in the order it produced, so keep sorting the same way
var alphasort = (a, b) => a.localeCompare(b)
var isoDaysAgo = n => new Date(Date.now() - 1000*60*60*24*n).toISOString().split('T')[0]

function main(){
  var start = Date.now()
  var timings = []
  var lap = label => timings.push(label + ' ' + ((Date.now() - start)/1000).toFixed(1) + 's')

  // One file per post, in a directory per day — the archive. The parse handoff streams in a year
  // at a time; only a post that actually changed is written, which is also how the feeds/ step
  // below knows which sites moved this cycle.
  var changedFeeds = new Set()
  var written = 0
  util.mkdir(daysdir)
  util.eachItem(d => {
    if (!d.isoDate) d.isoDate = '2020-01-01T'

    d.domain = util.domainOf(d.href)
    if (!d.domain) return console.log('missing domain', d.link)
    d.slug = sanitize(d.domain) + '_.._' + sanitize(d.href).slice(-30)

    var dir = daysdir + '/' + d.isoDate.split('T')[0]
    util.mkdir(dir)

    var path = dir + '/' + d.slug + '.json'
    var str = JSON.stringify(d)
    if (fs.existsSync(path) && fs.readFileSync(path, 'utf8') == str) return
    fs.writeFileSync(path, str)
    changedFeeds.add(d.slug.split('_.._')[0])
    written++
  })
  lap('day files (' + written + ' changed)')

  // Index the archive by site: file names only, never contents. The day a post belongs to is in
  // its path, so picking the window below is a string compare on directory names.
  var dayDirs = fs.readdirSync(daysdir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(alphasort)
  var byFeed = new Map()
  dayDirs.forEach(dir => {
    fs.readdirSync(daysdir + '/' + dir).filter(d => d.endsWith('.json')).sort(alphasort).forEach(file => {
      var key = file.split('_.._')[0]
      if (!byFeed.has(key)) byFeed.set(key, [])
      byFeed.get(key).push(dir + '/' + file)
    })
  })
  lap('index (' + dayDirs.length + ' days, ' + byFeed.size + ' sites)')

  // items-today.json and items-recent.json. Written before the per-site files below, and written
  // atomically: this script used to be OOM killed partway through with the day files already
  // fresh and these two not, leaving the reader on stale posts until a later run survived.
  var recentCutoff = isoDaysAgo(31)
  var todayCutoff = isoDaysAgo(2)

  var posts = []
  byFeed.forEach(paths => paths.forEach(path => {
    if (path.split('/')[0] < recentCutoff) return
    posts.push(readPost(path))
  }))

  posts = posts
    .filter(d => d.isoDate >= recentCutoff)
    // natesilver.net reposts its poll trackers ('How popular is the ...') every day or two under
    // a new url, which would otherwise fill the list. ~18 of them in a window.
    .filter(d => !(d.feedName === 'nate silver' && typeof d.title == 'string' && d.title.includes('How popular is the')))

  posts = _.sortBy(posts, d => d.isoDate).reverse()

  util.writeAtomic(gendir + '/items-recent.json', JSON.stringify(posts))
  util.writeAtomic(gendir + '/items-today.json', JSON.stringify(posts.filter(d => d.isoDate >= todayCutoff), null, 2))
  lap('items-*.json (' + posts.length + ' posts)')

  // The ?feed= view: a site's most recent posts, capped — the reader never pages back further.
  // Only sites with a post this cycle are rewritten (everything, with --full).
  var feeddir = gendir + '/feeds'
  util.mkdir(feeddir)
  var feedCount = 0
  byFeed.forEach((paths, key) => {
    var outpath = feeddir + '/' + key + '.json'
    if (!full && !changedFeeds.has(key) && fs.existsSync(outpath)) return

    feedCount++
    util.writeAtomic(outpath, JSON.stringify(paths.slice(-feedCap).map(readPost)))
  })
  lap('feeds/*.json (' + feedCount + ' written)')

  console.log(timings.join(', '))
}

function readPost(path){
  return JSON.parse(fs.readFileSync(daysdir + '/' + path, 'utf8'))
}

main()
