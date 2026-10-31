var {io} = require('scrape-stl')
var fetch = require('node-fetch')
var util = require('./util.js')

const request = require('request')
const cheerio = require("cheerio")

async function main(){
  var outpath = __dirname + '/../public/generated/favicons.json'
  var favicons = []
  try {
    favicons = io.readDataSync(outpath)
  } catch(e){}

  var name2favicon = Object.fromEntries(favicons.map(d => [d.feedName, d.favicon]))

  // one href per feed, the first one seen. Streamed a year at a time: loading the whole
  // ~100 MB corpus for this was the other way to OOM a 2 GB box.
  var firstHref = new Map()
  util.eachItem(d => {
    if (!firstHref.has(d.feedName)) firstHref.set(d.feedName, d.href)
  })
  var domains = [...firstHref].map(([feedName, href]) => ({feedName, href}))

  var newCount = 0
  var cachedCount = 0
  var errorCount = 0

  for (d of domains){
    d.domain = util.hostname(d.href)

    var m = name2favicon[d.feedName]
    if (m && m.icons && m.icons.length){
      d.favicon = m
      cachedCount++
    } else {
      try{
        d.favicon = await getFavicon(d.href)
        if (!d.favicon.icons.length){
          d.favicon = await fetchWithTimeout('http://favicongrabber.com/api/grab/' + d.domain, 5000)
        }
        newCount++
      } catch(e){
        errorCount++
        d.favicon = {domain: d.domain, icons: []}
      }
    }

    if (d.domain == 'gettingsimple.com') d.favicon = {}
  }

  console.log(`favicons: ${cachedCount} cached, ${newCount} new, ${errorCount} errors`)
  util.writeAtomic(outpath, JSON.stringify(domains, null, 2))
}
main()

async function fetchWithTimeout(url, ms){
  var controller = new AbortController()
  var timeout = setTimeout(() => controller.abort(), ms)
  try {
    var res = await fetch(url, {signal: controller.signal})
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function getFavicon(url) {
  var domain = util.hostname(url)
  return new Promise((resolve, reject) => {
    request({url, timeout: 5000}, (error, response, body) => {
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

