// node test/pages.test.js — sites with no feed: a sitemap's new urls and a plain page's changes
// become items, as rss parse.js reads like any other feed
var assert = require('assert')
var Parser = require('rss-parser')
var {pageKind, addSitemapItems, addWatchItem, toRss} = require('../bin/download.js')

var day1 = new Date('2026-11-24T12:00:00Z')
var day1later = new Date('2026-11-24T18:00:00Z')
var day2 = new Date('2026-11-25T12:00:00Z')

var sitemap = urls => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(d => `<url><loc>${d}</loc>${d.includes('old') ? '<lastmod>2025-03-01</lastmod>' : ''}</url>`).join('\n')}
</urlset>`
var page = (header, build) => `<!doctype html>
<html><head><title>Quincuncial</title><script src="/main.${build}.js"></script><style>p{}</style></head>
<body data-build="${build}"><header>${header}</header><main><p>An occasional journal.</p><p>Second para.</p></main>
<script>window.__b = "${build}"</script><footer>built 2026-11-24T10:${10 + build.length}:07Z at 10:${10 + build.length}</footer></body></html>`

async function main(){
  // the kind of thing that came back
  assert.equal(pageKind(sitemap(['https://a.com/'])), 'sitemap')
  assert.equal(pageKind(page('No. 1', 'abc')), 'html')
  assert.equal(pageKind('﻿<?xml version="1.0"?>\n<?xml-stylesheet href="x"?>\n<rss version="2.0"><channel></channel></rss>'), '')
  assert.equal(pageKind('<?xml version="1.0"?><!-- hi --><feed xmlns="http://www.w3.org/2005/Atom"></feed>'), '')

  // sitemap: the first fetch seeds, a later new url is one item
  var fetched = []
  var meta = async url => (fetched.push(url), {title: 'Mechanical Pencil', description: 'Illustrating & more', image: 'https://img/x.png'})
  var st = {}
  await addSitemapItems(st, sitemap(['https://mp.com/', 'https://mp.com/products/old-pez', 'https://mp.com/products/car']), 'Mechanical Pencil', day1, meta)
  assert.equal((st.items || []).length, 0, 'seeding makes no items')
  assert.equal(fetched.length, 0, 'seeding fetches no pages')
  assert.equal(st.seen['https://mp.com/products/old-pez'], '2025-03-01T00:00:00.000Z')
  assert.equal(st.seen['https://mp.com/products/car'], day1.toISOString())

  await addSitemapItems(st, sitemap(['https://mp.com/', 'https://mp.com/products/old-pez', 'https://mp.com/products/car']), 'Mechanical Pencil', day1later, meta)
  assert.equal((st.items || []).length, 0, 'same sitemap, no items')

  await addSitemapItems(st, sitemap(['https://mp.com/', 'https://mp.com/products/old-pez', 'https://mp.com/products/car', 'https://mp.com/in-progress/ipod-2']), 'Mechanical Pencil', day2, meta)
  assert.deepEqual(fetched, ['https://mp.com/in-progress/ipod-2'])
  assert.equal(st.items.length, 1)
  assert.equal(st.items[0].title, 'Mechanical Pencil: ipod 2')
  assert.equal(st.items[0].isoDate, day2.toISOString())
  assert.ok(st.items[0].html.includes('Illustrating &amp; more') && st.items[0].html.includes('<img src="https://img/x.png">'))

  // plain page: baseline, unchanged (build hashes and times churn), changed, capped at one a day
  var w = {}
  addWatchItem(w, page('No. 1 · In preparation', '3f9a2b1c4d5e6f70'), 'https://q.com/', day1)
  assert.ok(w.hash && !(w.items || []).length, 'first sight is a baseline')
  addWatchItem(w, page('No. 1 · In preparation', '9d8e7f6a5b4c3d2e1f'), 'https://q.com/', day1)
  assert.equal((w.items || []).length, 0, 'churn only, no item')
  addWatchItem(w, page('No. 1 · Out now', '1111aaaa2222bbbb'), 'https://q.com/', day1)
  assert.equal(w.items.length, 1, 'a change is one item')
  assert.equal(w.items[0].title, 'Quincuncial (changed)')
  assert.equal(w.items[0].link, 'https://q.com/#changed-2026-11-24')
  assert.ok(w.items[0].html.includes('An occasional journal.') && w.items[0].html.includes('Second para.'))
  addWatchItem(w, page('No. 1 · Out now', '1111aaaa2222bbbb'), 'https://q.com/', day1later)
  addWatchItem(w, page('No. 2 · Out now', '1111aaaa2222bbbb'), 'https://q.com/', day1later)
  assert.equal(w.items.length, 1, 'one item per page per day')
  addWatchItem(w, page('No. 2 · Out now', '1111aaaa2222bbbb'), 'https://q.com/', day2)
  assert.equal(w.items.length, 2, 'the held-back change comes the next day')

  // the rss parse.js reads
  var feed = await new Parser().parseString(toRss({title: 'Quincuncial', xmlUrl: 'https://q.com/'}, w.items))
  assert.equal(feed.items.length, 2)
  assert.equal(feed.items[0].isoDate, day1.toISOString())
  assert.equal(feed.items[0].guid, 'https://q.com/#changed-2026-11-24')
  assert.ok(feed.items[0]['content:encoded'].includes('The page changed'))
  var empty = await new Parser().parseString(toRss({title: 'X', xmlUrl: 'https://x.com/'}, []))
  assert.equal(empty.items.length, 0)

  console.log('pages: ok')
}
main().catch(e => { console.error(e); process.exit(1) })
