var {io, jp} = require('scrape-stl')
var fetch = require('node-fetch')

const request = require('request')
const cheerio = require("cheerio")

async function main(){
  // favicon api frequently errors; only look up new domains
  var outpath = __dirname + '/../public/generated/favicons.json'
  var favicons = []
  try {
    io.readDataSync(outpath)
  } catch(e){

  }
  var name2favicon = Object.fromEntries(favicons.map(d => [d.feedName, d.favicon]))

  var util = require('./util.js')
  var items = util.loadItems()

  var domains = jp.nestBy(items, d => d.feedName)
    .map(d => ({feedName: d.key, href: d[0].href}))

  for (d of domains){
    d.domain = getHostnameFromRegex(d.href)

    var m = name2favicon[d.feedName]
    if (m && m.icons && m.icons.length){
      d.favicon = m
    } else {
      try{
        console.log('loading...', d)
        d.favicon = await getFavicon(d.href)
        console.log('getFavicon', d.favicon)
        if (!d.favicon.icons.length){
          d.favicon = await (await fetch('http://favicongrabber.com/api/grab/' + d.domain)).json()
          console.log('favicongrabber', d.favicon)
        }
        
      } catch(e){
        console.log({e, d})
      }
    }

    if (d.domain == 'gettingsimple.com') d.favicon = {}
  }

  io.writeDataSync(outpath, domains, {indent: 2})

}
main()

async function getFavicon(url) {
  var domain = getHostnameFromRegex(url)
  return new Promise((resolve, reject) => {
    request({url, timeout: 3000}, (error, response, body) => {
      if (error) return reject(error)

      var $ = cheerio.load(body)
      var favicon = {domain, icons: []}
      $("link[rel='icon'], link[rel='shortcut icon']").each((i, el) => {
        var src = $(el).attr("href")
        if (src[0] == '/') src = 'https://' + domain + src
        var sizes = $(el).attr("sizes")
        favicon.icons.push({src, sizes})
      })
      resolve(favicon)
    })
  })
}




function getHostnameFromRegex(url){
  var matches = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i)
  return matches && matches[1]
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
