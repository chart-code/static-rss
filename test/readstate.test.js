// server/readstate.js allowlist: the owner from STATE_DIR/config.json gets in, anyone else
// and a missing config get 401.   node test/readstate.test.js
var assert = require('assert')
var fs = require('fs')
var os = require('os')
var path = require('path')
var {spawn} = require('child_process')

var OWNER = 'owner@example.test'
var OTHER = 'other@example.test'

function start(dir, port){
  var env = Object.assign({}, process.env, {PORT: String(port), STATE_DIR: dir})
  delete env.EMAILS
  var p = spawn(process.execPath, [path.join(__dirname, '../server/readstate.js')], {env, stdio: ['ignore', 'pipe', 'pipe']})
  var err = ''
  p.stderr.on('data', d => err += d)
  return new Promise((resolve, reject) => {
    p.stdout.on('data', d => { if (/readstate on/.test(d)) resolve({p, err: () => err}) })
    p.on('exit', c => reject(new Error('exited ' + c + ' ' + err)))
  })
}

async function get(port, email, opts = {}, what = 'read'){
  var headers = Object.assign(email ? {'X-Auth-Email': email} : {}, opts.headers || {})
  var r = await fetch('http://127.0.0.1:' + port + '/static-rss-state/' + what, Object.assign({}, opts, {headers}))
  return {status: r.status, body: await r.json()}
}

;(async () => {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readstate-'))
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({emails: [OWNER]}), {mode: 0o600})
  var s = await start(dir, 3918)
  try {
    assert.equal((await get(3918, OWNER)).status, 200)
    assert.equal((await get(3918, OWNER.toUpperCase())).status, 200)
    assert.equal((await get(3918, OTHER)).status, 401)
    assert.equal((await get(3918, '')).status, 401)
    var post = await get(3918, OWNER, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({read: {'https://example.test/a': new Date().toISOString()}})})
    assert.deepEqual(post, {status: 200, body: {ok: true, n: 1}})
    assert.equal((await get(3918, OTHER, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401)

    // the reading log: appended once per id, so a resent batch adds nothing
    var ev = {id: 'abc123-x', at: new Date().toISOString(), href: 'https://example.test/a', feed: 'f', title: 't'.repeat(300), maxScroll: 1.7, seconds: 42.4, device: 'eink'}
    var postLog = (email, body, headers = {}) => get(3918, email, {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, headers), body: JSON.stringify(body)}, 'log')
    assert.deepEqual(await postLog(OWNER, {log: [ev, ev, {id: 'bad', href: 'nope'}]}), {status: 200, body: {ok: true, n: 1}})
    assert.deepEqual(await postLog(OWNER, {log: [ev]}), {status: 200, body: {ok: true, n: 0}})
    assert.equal((await postLog(OTHER, {log: [Object.assign({}, ev, {id: 'other-1'})]})).status, 401)
    assert.equal((await postLog(OWNER, {log: [Object.assign({}, ev, {id: 'cross-1'})]}, {'Sec-Fetch-Site': 'cross-site'})).status, 403)
    assert.equal((await get(3918, OWNER, {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: '{}'}, 'log')).status, 403)
    var lines = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    assert.equal(fs.statSync(path.join(dir, 'log.jsonl')).mode & 0o777, 0o600)
    var got = await get(3918, OWNER, {}, 'log')
    assert.equal(got.status, 200)
    assert.deepEqual(got.body.log.map(e => [e.id, e.title.length, e.maxScroll, e.seconds, e.device]), [['abc123-x', 120, 1, 42, 'eink']])
    assert.equal((await get(3918, OTHER, {}, 'log')).status, 401)
  } finally { s.p.kill() }

  // a restart still knows the ids already in the file
  var s3 = await start(dir, 3920)
  try {
    assert.deepEqual(await get(3920, OWNER, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({log: [ev]})}, 'log'), {status: 200, body: {ok: true, n: 0}})
  } finally { s3.p.kill() }

  // fail closed: no config, no EMAILS -> nobody, and it says so
  var empty = fs.mkdtempSync(path.join(os.tmpdir(), 'readstate-'))
  var s2 = await start(empty, 3919)
  try {
    assert.equal((await get(3919, OWNER)).status, 401)
    assert.match(s2.err(), /NO EMAILS ALLOWED/)
  } finally { s2.p.kill() }

  fs.rmSync(dir, {recursive: true, force: true})
  fs.rmSync(empty, {recursive: true, force: true})
  console.log('readstate: ok')
})().catch(e => { console.error(e); process.exit(1) })
