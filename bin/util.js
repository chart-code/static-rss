var {fs, jp, glob} = require('scrape-stl')

var rootdir = __dirname + '/../public/generated/items-all/'

function saveItems(items){
  mkdir(rootdir)
  jp.nestBy(items, d => d.isoDate ? d.isoDate.split('-')[0] : '1234')
    .forEach(year => {
      writeAtomic(rootdir + year.key + '.json', JSON.stringify(year))
    })
}

// the corpus is ~100 MB of json across the per-year files; holding all of it at once is what
// OOM killed archive.js and favicons.js on a 2 GB box, so hand out one year at a time. Same
// glob order as before, so 'first item per feed' style logic is unchanged.
function eachItem(fn){
  mkdir(rootdir)
  glob.sync(rootdir + '*.json').forEach(path => {
    JSON.parse(fs.readFileSync(path, 'utf8')).forEach(fn)
  })
}

// write via a tmp file in the same directory, so a crash (or an OOM kill) leaves the previous
// complete file rather than a truncated one — items-*.json can never go stale next to fresh day files
function writeAtomic(path, str){
  var tmp = path + '.tmp'
  fs.writeFileSync(tmp, str)
  fs.renameSync(tmp, path)
}

function mkdir(path){
  if (!fs.existsSync(path)) fs.mkdirSync(path, {recursive: true})
}

function hostname(url){
  var matches = (url || '').match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
  return matches && matches[1]
}

// the key the archive and the feeds/*.json files are named by: hostname without a www.
// (favicons.json keeps the full hostname, so it uses hostname() directly)
function domainOf(url){
  return hostname((url || '').replace('www.', ''))
}

module.exports = { eachItem, saveItems, writeAtomic, mkdir, hostname, domainOf }
