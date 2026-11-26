// Read marks for the rss page, shared across Adam's devices. Zero dependencies, Node 18.
//
//   GET  /static-rss-state/read  -> {read: {href: iso}}
//   POST /static-rss-state/read  <- {read: {href: iso}}   merged, answers {ok, n}
//   GET  /static-rss-state/log   -> {log: [event]}        the reading log, oldest first
//   POST /static-rss-state/log   <- {log: [event]}        appended, answers {ok, n: new ones}
//
// A log event is one post open: {id, at, href, feed, title, maxScroll, seconds, device}, one
// JSON line each in log.jsonl. The page makes the id, so a batch sent again after a lost answer
// adds nothing.
//
// Union merge, the earliest date wins, so pushes from any device in any order land in the
// same place. Marks older than KEEP_DAYS are dropped on every write, which keeps the file
// to a few hundred KB.
//
// Who is asking comes from X-Auth-Email, which nginx sets from the rtl-auth gate's
// /auth/check answer (proxy_set_header overwrites anything a client sends). That is only
// safe because this listens on 127.0.0.1. Only EMAILS get in, so a second account allowed
// somewhere else by the gate still can't read or write these marks.
//
//   PORT=3008 node server/readstate.js      (bin/readstate-forever.sh keeps it up)

var http = require('http')
var fs = require('fs')
var path = require('path')
var os = require('os')

var PORT = +process.env.PORT || 3008
var HOST = '127.0.0.1'
var STATE_DIR = process.env.STATE_DIR || path.join(os.homedir(), 'static-rss-state')
var FILE = path.join(STATE_DIR, 'read.json')
var CONFIG = path.join(STATE_DIR, 'config.json')
var LOG_FILE = path.join(STATE_DIR, 'log.jsonl')
// Who may sync: EMAILS=a,b, else {"emails": [...]} in STATE_DIR/config.json (600, not in git).
// Neither means nobody: every request answers 401.
var EMAILS = (process.env.EMAILS || (fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')).emails.join(',') : '')).split(',').map(d => d.trim().toLowerCase()).filter(d => d)
if (!EMAILS.length) console.error('NO EMAILS ALLOWED: set EMAILS or write {"emails": [...]} to ' + CONFIG + '. Every request will 401.')
var KEEP_DAYS = 120
var MAX_MARKS = 50000
var MAX_BODY = 512*1024
var URL_PATH = '/static-rss-state/read'
var LOG_PATH = '/static-rss-state/log'
var LOG_BATCH = 500

fs.mkdirSync(STATE_DIR, {recursive: true, mode: 0o700})

var isHref = v => typeof v == 'string' && v.length <= 2048 && /^https?:\/\//.test(v)
var isTime = v => typeof v == 'string' && v.length < 40 && !isNaN(Date.parse(v))

// Only a missing file means "nothing yet". A parse error or EACCES throws, so the request
// 500s and the file is left on disk to look at instead of being overwritten by the next POST.
function load(){
  var text
  try { text = fs.readFileSync(FILE, 'utf8') }
  catch (e){ if (e.code == 'ENOENT') return {}; throw e }
  var d = JSON.parse(text)
  return d && typeof d.read == 'object' && d.read ? d.read : {}
}

// tmp + fsync + rename, so a crash mid-write never leaves half a file. 600 from the start.
function save(read){
  var tmp = FILE + '.' + process.pid + '.tmp'
  var fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, JSON.stringify({read}))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, FILE)
  try {
    var dfd = fs.openSync(STATE_DIR, 'r')
    try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
  } catch (e){}
}

function merge(read, marks){
  var future = Date.now() + 864e5
  Object.keys(marks && typeof marks == 'object' ? marks : {}).forEach(href => {
    var v = marks[href]
    if (!isHref(href) || !isTime(v) || Date.parse(v) > future) return
    var iso = new Date(Date.parse(v)).toISOString()
    if (!read[href] || Date.parse(iso) < Date.parse(read[href])) read[href] = iso
  })
  return read
}

// drop marks past KEEP_DAYS, then the oldest if it is somehow still over MAX_MARKS
function prune(read){
  var cutoff = Date.now() - KEEP_DAYS*864e5
  var keep = Object.keys(read).filter(k => Date.parse(read[k]) >= cutoff)
  if (keep.length > MAX_MARKS) keep = keep.sort((a, b) => Date.parse(read[b]) - Date.parse(read[a])).slice(0, MAX_MARKS)
  var out = {}
  keep.forEach(k => out[k] = read[k])
  return out
}

// every line of log.jsonl; a line that doesn't parse is skipped, not fatal
function loadLog(){
  var text
  try { text = fs.readFileSync(LOG_FILE, 'utf8') }
  catch (e){ if (e.code == 'ENOENT') return []; throw e }
  return text.split('\n').filter(d => d).map(d => { try { return JSON.parse(d) } catch (e){ return null } }).filter(d => d && d.id)
}

// ids already in the file, read once; this process is its only writer
var logIds = null

// the valid, new events of a batch as JSON lines, in a fixed field order
function logLines(events){
  if (!logIds) logIds = new Set(loadLog().map(d => d.id))
  var future = Date.now() + 864e5
  var num = (v, max) => typeof v == 'number' && isFinite(v) ? Math.min(max, Math.max(0, v)) : 0
  return (Array.isArray(events) ? events.slice(0, LOG_BATCH) : []).filter(e => e && typeof e == 'object' &&
    typeof e.id == 'string' && /^[\w-]{6,64}$/.test(e.id) && isHref(e.href) && isTime(e.at) && Date.parse(e.at) < future &&
    // last, so a repeat inside one batch is caught too
    !logIds.has(e.id) && logIds.add(e.id)
  ).map(e => JSON.stringify({
      id: e.id,
      at: new Date(Date.parse(e.at)).toISOString(),
      href: e.href,
      feed: String(e.feed || '').slice(0, 200),
      title: String(e.title || '').slice(0, 120),
      maxScroll: Math.round(num(e.maxScroll, 1)*100)/100,
      seconds: Math.round(num(e.seconds, 864e2)),
      device: ['phone', 'eink', 'desktop'].includes(e.device) ? e.device : 'desktop',
    }) + '\n')
}

function send(res, code, body){
  res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
  res.end(JSON.stringify(body))
}

// A write must come from the page itself: a JSON body (a cross-site form can't send that type
// without a preflight, which nothing here answers) and, where the browser says, same-origin.
// The cookie is on .roadtolarissa.com, so a request from any subdomain carries it.
function crossSiteWrite(req){
  if (req.method == 'GET' || req.method == 'HEAD') return false
  var site = req.headers['sec-fetch-site']
  return !/^application\/json\b/i.test(req.headers['content-type'] || '') || (site != null && site != 'same-origin')
}

http.createServer((req, res) => {
  var email = (req.headers['x-auth-email'] || '').trim().toLowerCase()
  var url = req.url.split('?')[0]
  var log = code => console.log(new Date().toISOString(), req.method, url, code, email || '-')

  if (url != URL_PATH && url != LOG_PATH){ log(404); return send(res, 404, {error: 'not found'}) }
  if (!EMAILS.includes(email)){ log(401); return send(res, 401, {error: 'signed out'}) }
  if (crossSiteWrite(req)){ log(403); return send(res, 403, {error: 'not from this page'}) }

  if (req.method == 'GET' && url == LOG_PATH){
    try { var events = loadLog() } catch (e){
      console.error('could not load', LOG_FILE, e.code || e.name)
      log(500); return send(res, 500, {error: 'could not load'})
    }
    log(200); return send(res, 200, {log: events})
  }
  if (req.method == 'GET'){
    try { var read = prune(load()) } catch (e){
      console.error('could not load', FILE, e.code || e.name)
      log(500); return send(res, 500, {error: 'could not load'})
    }
    log(200); return send(res, 200, {read})
  }
  if (req.method != 'POST'){ log(405); return send(res, 405, {error: 'GET or POST'}) }

  var chunks = [], size = 0, over = false
  req.on('data', c => {
    if (over) return
    size += c.length
    if (size <= MAX_BODY) return chunks.push(c)
    over = true
    log(413)
    res.setHeader('Connection', 'close')
    send(res, 413, {error: 'too big'})
  })
  req.on('end', () => {
    if (over) return
    var body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e){ log(400); return send(res, 400, {error: 'bad json'}) }
    if (url == LOG_PATH){
      try {
        var lines = logLines(body && body.log)
        if (lines.length){
          fs.appendFileSync(LOG_FILE, lines.join(''), {mode: 0o600})
          fs.chmodSync(LOG_FILE, 0o600)
        }
        log(200)
        return send(res, 200, {ok: true, n: lines.length})
      } catch (e){
        // ids taken from a batch that never landed would turn its resend away
        logIds = null
        console.error('could not save', LOG_FILE, e.code || e.name)
        log(500)
        return send(res, 500, {error: 'could not save'})
      }
    }
    try {
      // sync read-merge-write: node runs one request at a time, so two devices can't interleave
      var read = prune(merge(load(), body && body.read))
      save(read)
      log(200)
      send(res, 200, {ok: true, n: Object.keys(read).length})
    } catch (e){
      console.error('could not save', FILE, e.code || e.name)
      log(500)
      send(res, 500, {error: 'could not save'})
    }
  })
}).listen(PORT, HOST, () => console.log('readstate on', HOST + ':' + PORT, 'file', FILE, EMAILS.length + ' allowed'))
