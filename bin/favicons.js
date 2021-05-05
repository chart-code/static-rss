var {io, jp} = require('scrape-stl')
var fetch = require('node-fetch')

async function main(){
  var items = io.readDataSync(__dirname + '/../public/generated/items.json')

  var domains = jp.nestBy(items, d => d.feedName)
    .map(d => ({feedName: d.key, href: d[0].href}))

  for (d of domains){
    d.domain = getHostnameFromRegex(d.href)
    d.favicon = await (await fetch('http://favicongrabber.com/api/grab/' + d.domain)).json()
    console.log(d)
  }

  io.writeDataSync(__dirname + '/../public/generated/favicons.json', domains)

}
main()


function getHostnameFromRegex(url){
  var matches = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
  return matches && matches[1]
}