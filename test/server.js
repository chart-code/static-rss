// A stand-in for nginx on roadtolarissa.com that can misbehave on demand, for test/network.test.js.
//
// Serves public/ at /slinks/static-rss/ and /slinks/nyc-feed/, and a blog post at /static-rss/
// that embeds the app the way the live one does (window.datapath, the worker scoped to the post).
// The feed data never comes from disk: the test hands over a stale and a fresh items-today list
// and flips between them. Every request is either 'data' (generated/*.json) or 'shell'
// (everything else), and each kind has its own mode:
//
//   normal   answer at once
//   slow     answer after ms
//   hang     accept the request and never answer (a phone underground)
//   down     drop the connection
//   500      an error page
//
// state.build > 0 serves a new deploy: sw.js gets a new shell cache name and script.js sets
// window.__build, so a test can tell which code is running.
var http = require('http')
var fs = require('fs')
var path = require('path')

var PUBLIC = path.join(__dirname, '../public')
var TYPES = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}

function start({port, lists, recent, favicons}){
  var state = {
    data: {mode: 'normal', ms: 0},
    shell: {mode: 'normal', ms: 0},
    list: 'fresh',
    build: 0,
    hits: {},
    hung: [],
  }
  var listAt = {stale: Date.now() - 3*3600e3, fresh: Date.now() - 5*60e3}
  var json = v => Buffer.from(JSON.stringify(v))
  var bufs = {stale: json(lists.stale), fresh: json(lists.fresh), recent: json(recent), favicons: json(favicons)}

  function post(app){
    var base = `http://localhost:${port}/slinks/${app}/`
    return `<!DOCTYPE html><html><head><meta charset='utf-8'>
<link rel='stylesheet' href='/style.css'>
<link href='https://fonts.googleapis.com/css?family=Roboto+Slab:400,700|Roboto:700,500' rel='stylesheet' type='text/css'>
<link rel='stylesheet' href='${base}style.css'></head><body>
<h1>${app}</h1><p>a blog post with the app in it</p>
<div class='items' id='items'></div>
<script>window.datapath = '${base}'</script>
<script src='${base}d3_.js'></script>
<script src='${base}script.js'></script>
</body></html>`
  }

  function body(url){
    if (url == '/static-rss/' || url == '/static-rss/index.html') return [post('static-rss'), 'text/html']
    if (url == '/nyc-feed/' || url == '/nyc-feed/index.html') return [post('nyc-feed'), 'text/html']
    if (url == '/style.css') return ['body{background:#111;color:#fff}', 'text/css']
    var m = url.match(/^\/slinks\/(static-rss|nyc-feed)\/(.*)$/)
    if (!m) return null
    var file = m[2] || 'index.html'
    var g = file.match(/^generated\/(.+)\.json$/)
    if (g){
      var name = g[1]
      if (name == 'items-today') return [bufs[state.list], 'application/json', listAt[state.list]]
      if (name == 'items-recent') return [bufs.recent, 'application/json', listAt.fresh]
      if (name == 'favicons') return [bufs.favicons, 'application/json', listAt.fresh]
      if (name.startsWith('longposts/')) return [json([{html: '<p>long post ' + name + '</p>'.repeat(20)}]), 'application/json', listAt.stale]
      return null
    }
    var full = path.join(PUBLIC, file)
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return null
    var text = fs.readFileSync(full)
    if (state.build && file == 'sw.js') text = String(text).replace(/shell-v(\d+)/, `shell-v$1b${state.build}`)
    if (state.build && file == 'script.js') text = String(text) + `\n;window.__build = ${state.build}\n`
    return [text, TYPES[path.extname(file)] || 'application/octet-stream']
  }

  var server = http.createServer((req, res) => {
    var url = req.url.split('?')[0]
    state.hits[url] = (state.hits[url] || 0) + 1
    var kind = url.includes('/generated/') ? 'data' : 'shell'
    var {mode, ms} = state[kind]
    if (mode == 'down') return req.socket.destroy()
    if (mode == 'hang') return state.hung.push(res)
    var send = () => {
      if (mode == '500'){ res.writeHead(500, {'Content-Type': 'text/html'}); return res.end('<h1>502 bad gateway</h1>') }
      var hit = body(url)
      if (!hit){ res.writeHead(404); return res.end() }
      var headers = {'Content-Type': hit[1], 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/'}
      if (hit[2]) headers['Last-Modified'] = new Date(hit[2]).toUTCString()
      res.writeHead(200, headers)
      res.end(hit[0])
    }
    mode == 'slow' ? setTimeout(send, ms) : send()
  })
  server.keepAliveTimeout = 1

  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({
    state,
    url: p => `http://localhost:${port}${p}`,
    set(kind, mode, ms = 0){ state[kind] = {mode, ms} },
    reset(){
      state.data = {mode: 'normal', ms: 0}
      state.shell = {mode: 'normal', ms: 0}
      state.list = 'fresh'
      state.build = 0
      state.hits = {}
      state.hung.forEach(r => { try { r.socket.destroy() } catch (e){} })
      state.hung = []
    },
    stop(){ state.hung.forEach(r => { try { r.socket.destroy() } catch (e){} }); server.close() },
  })))
}

module.exports = {start}
