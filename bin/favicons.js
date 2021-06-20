var {io, jp} = require('scrape-stl')
var fetch = require('node-fetch')

async function main(){
  // favicon api frequently errors; only look up new domains
  var outpath = __dirname + '/../public/generated/favicons.json'
  var favicons  = io.readDataSync(outpath)
  var name2favicon = Object.fromEntries(favicons.map(d => [d.feedName, d.favicon]))

  var items = io.readDataSync(__dirname + '/../public/generated/items-all.json')

  var domains = jp.nestBy(items, d => d.feedName)
    .map(d => ({feedName: d.key, href: d[0].href}))

  for (d of domains){
    d.domain = getHostnameFromRegex(d.href)

    var m = name2favicon[d.feedName]
    if (m && m.icons){
      d.favicon = m
    } else {
      console.log(d)
      try {
        d.favicon = await (await fetch('http://favicongrabber.com/api/grab/' + d.domain)).json()
      } catch (e){ console.log(e) }
      await sleep(3000)
    }

    if (d.domain == 'gettingsimple.com') d.favicon = {}
  }

  io.writeDataSync(outpath, domains, {indent: 2})

}
main()

function getHostnameFromRegex(url){
  var matches = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
  return matches && matches[1]
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
