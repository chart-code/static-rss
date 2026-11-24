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

async function get(port, email, opts = {}){
  var headers = Object.assign(email ? {'X-Auth-Email': email} : {}, opts.headers || {})
  var r = await fetch('http://127.0.0.1:' + port + '/static-rss-state/read', Object.assign({}, opts, {headers}))
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
  } finally { s.p.kill() }

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
