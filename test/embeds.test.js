// node test/embeds.test.js — substack embeds that its javascript fills in become plain html
var assert = require('assert')
var {rewriteEmbeds} = require('../bin/embeds.js')

var base = 'https://www.chinatalk.media/p/we-went-to-austin-to-see-robots'
// data-attrs as substack writes them: json, html-escaped into a double-quoted attribute
var attrs = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
var div = (cls, o, extra = '', inner = '') => `<div class="${cls}" data-attrs="${attrs(o)}"${extra}>${inner}</div>`
var run = html => rewriteEmbeds(html, base)
var has = (html, ...parts) => parts.forEach(p => assert.ok(html.includes(p), `missing ${p}\nin ${html}`))
var n = 0
function test(name, fn){ fn(); n++ }

test('tweet: text, author, date, link, photo', () => {
  var out = run('<p>a</p>' + div('twitter-embed', {
    url: 'https://x.com/SwannAiden/status/2118741112227774702',
    // tweet text carries the odd tag, and a '>' inside the attribute must not end the tag
    full_text: 'Quick chat with <span class="tweet-fake-link">@JasonMa2020</span> at CoRL\n\nso > than &#129525;',
    username: 'SwannAiden', name: '&#26234;&#19996; Aiden', date: '2026-11-06T16:23:40.000Z',
    photos: [{img_url: 'https://pbs.substack.com/media/a.jpg', link_url: 'https://t.co/x'}],
    quoted_tweet: {}, expanded_url: null, video_url: null,
  }, ' data-component-name="Twitter2ToDOM"', ' ') + '<p>b</p>')
  has(out, '<p>a</p><blockquote class="rss-embed rss-tweet"', 'Quick chat with @JasonMa2020 at CoRL<br><br>so &gt; than 🧵',
    '智东 Aiden @SwannAiden', '<a href="https://x.com/SwannAiden/status/2118741112227774702">Nov 6, 2026</a>',
    '<a href="https://t.co/x"><img src="https://pbs.substack.com/media/a.jpg"', '</blockquote><p>b</p>')
  assert.ok(!out.includes('data-attrs') && !out.includes('<span'))
})

test('tweet video: still image links to the mp4 with no referer', () => {
  var out = run(div('twitter-embed', {
    url: 'https://x.com/a/status/1', full_text: 'robot', username: 'a', name: 'A', date: '2026-11-10T11:25:32.000Z',
    photos: [{img_url: 'https://substackcdn.com/still.jpg', link_url: 'https://t.co/k'}],
    video_url: 'https://video.twimg.com/amplify_video/1/vid/a.mp4',
  }))
  has(out, '<a href="https://video.twimg.com/amplify_video/1/vid/a.mp4" rel="noreferrer"><img src="https://substackcdn.com/still.jpg"')
  assert.ok(!out.includes('https://t.co/k'), 'the still is not repeated as a photo')
})

test('quoted tweet and link card', () => {
  var out = run(div('twitter-embed', {url: 'https://x.com/a/status/1', full_text: 'look', username: 'a', name: 'A',
    quoted_tweet: {full_text: 'inner', username: 'mattyglesias', name: 'Matthew Yglesias'},
    expanded_url: {url: 'https://trib.al/x', title: 'Trump Moves', domain: 'trib.al'}}))
  has(out, 'inner', 'Matthew Yglesias @mattyglesias', '<a href="https://trib.al/x">Trump Moves</a>')
})

test('substack video: the stable /src url on the publication', () => {
  var out = run(div('native-video-embed', {mediaUploadId: '687992c0-bd4b-4090-bf72-bfa8014be0a2', duration: 25.5}, ' data-component-name="VideoPlaceholder"'))
  has(out, '<video controls preload="none" playsinline src="https://www.chinatalk.media/api/v1/video/upload/687992c0-bd4b-4090-bf72-bfa8014be0a2/src"', 'video · 0:26')
})

test('substack audio', () => {
  var out = run(div('native-audio-embed', {mediaUploadId: 'c5e87f40-0791-4329-95a2-cd8588ef8ef0', duration: 828.4}))
  has(out, '<audio controls preload="none" src="https://www.chinatalk.media/api/v1/audio/upload/c5e87f40-0791-4329-95a2-cd8588ef8ef0/src"', 'audio · 13:48')
})

test('youtube: empty wrap gets a nocookie iframe, a rendered one is left alone', () => {
  var empty = `<div id="youtube2-4v837X1Py4M" class="youtube-wrap" data-attrs="${attrs({videoId: '4v837X1Py4M', startTime: 30})}" data-component-name="Youtube2ToDOM">\n<div class="youtube-inner"></div>\n</div><p>after</p>`
  var out = run(empty)
  has(out, '<iframe src="https://www.youtube-nocookie.com/embed/4v837X1Py4M?rel=0&start=30"', '</div><p>after</p>')
  assert.strictEqual((out.match(/<\/div>/g) || []).length, 1)
  var rendered = `<div class="youtube-wrap" data-attrs="${attrs({videoId: 'QTqezuPjSdU'})}"><div class="youtube-inner"><iframe src="https://www.youtube-nocookie.com/embed/QTqezuPjSdU"></iframe></div></div>`
  assert.strictEqual(run(rendered), rendered)
})

test('digest post: a link card', () => {
  var out = run(div('digest-post-embed', {title: 'Let The Games Begin ', caption: 'A series&#8230;',
    canonical_url: 'https://news.educationprogress.org/p/games', publication_name: 'Education Progress',
    publishedBylines: [{name: 'Sebastian Garren'}], post_date: '2026-08-13T12:00:55.715Z'}))
  has(out, '<a href="https://news.educationprogress.org/p/games"><strong>Let The Games Begin</strong></a>',
    'Education Progress · Sebastian Garren · Aug 13, 2026', 'A series…')
})

test('image3, gallery, instagram', () => {
  has(run(div('image3', {src: 'https://substack-post-media.s3.amazonaws.com/a.png', alt: null, href: null, width: 548, height: 463.8})),
    '<img src="https://substack-post-media.s3.amazonaws.com/a.png" alt="" width="548" height="464">')
  has(run(div('image3', {src: 'https://s3/b.png'}, '', 'Click to expand. Source: x')), '<img src="https://s3/b.png" alt="">', '>Click to expand. Source: x</figcaption>')
  var g = run(div('image-gallery-embed', {gallery: {images: [{src: 'https://s3/1.jpg'}, {src: 'https://s3/2.jpg'}], caption: 'cap', staticGalleryImage: {src: 'https://s3/collage.png'}}}))
  has(g, '<img src="https://s3/collage.png"', 'cap')
  assert.ok(!g.includes('1.jpg'))
  has(run(div('image-gallery-embed', {gallery: {images: [{src: 'https://s3/1.jpg'}, {src: 'https://s3/2.jpg'}]}})), 'https://s3/1.jpg', 'https://s3/2.jpg')
  has(run(div('instagram-embed-wrap', {instagram_id: 'C7o0eQZI_zp', title: 'A post shared by @hot', thumbnail_url: 'https://s3/ig.jpg'})),
    '<a href="https://www.instagram.com/p/C7o0eQZI_zp/"><img src="https://s3/ig.jpg"', 'A post shared by @hot')
})

test('comment, bluesky', () => {
  has(run(div('comment', {comment: {body: 'They know.\n\nhttps://www.nytimes.com/x.html?smid=a', name: 'Ted Gioia', date: '2026-11-03T23:44:14.320Z'}})),
    'They know.<br><br><a href="https://www.nytimes.com/x.html?smid=a">', '— Ted Gioia · Nov 3, 2026')
  var bsky = `<div class="bluesky-wrap outer" style="height: auto;" data-attrs="${attrs({postId: '3mk67u3bb3e2a', authorName: 'Hagen Blix',
    authorHandle: 'hagenblix.bsky.social', text: 'Moving from kids', createdAt: '2026-04-23T14:27:51.849Z', imageUrls: ['https://cdn.bsky.app/i.jpg']})}"><iframe src="https://embed.bsky.app/embed/x" frameborder="0"></iframe></div>`
  var out = run(bsky)
  has(out, 'Moving from kids', 'Hagen Blix @hagenblix.bsky.social', '<a href="https://bsky.app/profile/hagenblix.bsky.social/post/3mk67u3bb3e2a">Apr 23, 2026</a>', 'https://cdn.bsky.app/i.jpg')
  assert.ok(!out.includes('<iframe'))
})

test('poll, latex, polymarket, sponsor', () => {
  has(run(div('poll-embed', {id: 226392})), `<a href="${base}">Poll · vote on the post</a>`)
  has(run(div('latex-rendered', {persistentExpression: '\n\\text{a} < b\n'})), '<pre class="rss-embed rss-latex"><code>\\text{a} &lt; b</code></pre>')
  has(run(div('polymarket-embed', {eventSlug: 'michigan-democratic-senate-primary-winner'})),
    '<a href="https://polymarket.com/event/michigan-democratic-senate-primary-winner">Polymarket: michigan democratic senate primary winner</a>')
  assert.strictEqual(run('<p>a</p>' + div('sponsorship-campaign-embed', {id: 'x'}) + '<p>b</p>'), '<p>a</p><p>b</p>')
})

test('left alone: plain html, unknown embeds, bad json, already rewritten', () => {
  ;['<p>no embeds</p>', div('subscription-widget-wrap', {url: 'x'}), '<div class="twitter-embed" data-attrs="{nope">\n</div>', '', undefined]
    .forEach(h => assert.strictEqual(run(h), h))
  var once = run(div('twitter-embed', {url: 'https://x.com/a/status/1', full_text: 'hi', username: 'a', name: 'A'}))
  assert.strictEqual(run(once), once)
  // a javascript: url in the data is not linked
  assert.ok(!run(div('digest-post-embed', {title: 't', canonical_url: 'javascript:alert(1)'})).includes('javascript:'))
})

console.log('embeds: ' + n + ' cases ok')
