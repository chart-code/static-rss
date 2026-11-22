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

// Feed html is written for the publisher's page, so href="/blog/x.html" or src="img.png" would
// resolve against roadtolarissa.com in the reader. Rewrite every quoted href/src that isn't
// already absolute (any scheme: http, mailto, data...) or a bare #fragment against the post's
// own url. A regex over the attributes, not a dom: parse.js runs it on every post every hour.
var attrRegex = /(\s(?:xlink:)?(?:href|src)\s*=\s*)(["'])(.*?)\2/gis
function absolutizeHtml(html, base){
  if (typeof html != 'string' || !base || !/\s(?:xlink:)?(?:href|src)\s*=/i.test(html)) return html
  // attributes inside tags only, so 'href="/x"' quoted in a post's prose is left as written
  return html.replace(/<[a-z][^>]*>/gi, tag => tag.replace(attrRegex, (all, pre, q, url) => {
    var u = url.trim()
    if (!u || u[0] == '#' || /^[a-z][a-z0-9+.-]*:/i.test(u)) return all
    try { return pre + q + new URL(u, base).href + q } catch (e){ return all }
  }))
}

// the url relative links in a post resolve against: the post's own link, else the feed's site.
// Only an absolute http(s) url will do, so a relative item link is resolved against the site first.
function baseUrlOf(itemUrl, siteUrl){
  for (var u of [itemUrl, siteUrl]){
    if (!u || typeof u != 'string') continue
    try {
      var url = new URL(u, siteUrl || undefined)
      if (/^https?:$/.test(url.protocol)) return url.href
    } catch (e){}
  }
  return ''
}

module.exports = { eachItem, saveItems, writeAtomic, mkdir, hostname, domainOf, absolutizeHtml, baseUrlOf }
