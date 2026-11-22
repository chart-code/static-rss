// Substack ships most embeds as an empty <div class="twitter-embed" data-attrs="{json}"></div> that
// its own javascript fills in on substack.com, so in the reader they render as nothing. Everything
// the embed shows is already in data-attrs; this turns each one into plain html that needs no third
// party script: a tweet is a blockquote, a substack video a <video>, a linked post a small card.
//
// A regex pass, not a dom, like absolutizeHtml: parse.js runs it on every post every hour, and only
// a post with data-attrs in it pays for more than an includes(). Only an element whose body is
// empty (or the one known placeholder child) is replaced, so an embed substack did render
// server-side (embedded-post-wrap, the iframe in a youtube-inner) is left alone.

// a whole open tag, quoted attribute values allowed to hold '>' (tweet text in data-attrs does)
var openTagRegex = /<(div|iframe)\b((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/gi

var named = {quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' '}
function decodeEntities(s){
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] == '#'){
      var n = e[1] == 'x' || e[1] == 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)
      try { return String.fromCodePoint(n) } catch (err){ return all }
    }
    return named[e.toLowerCase()] ?? all
  })
}

var esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// strings in data-attrs are text with the odd tag (tweet text wraps @mentions in a span)
// and their entities are sometimes encoded twice, so decode again once the tags are out
var text = s => esc(decodeEntities(String(s ?? '').replace(/<\/?[a-z][^>]*>/gi, ''))).trim()
var para = s => text(s).replace(/\n/g, '<br>')
var url = s => typeof s == 'string' && /^https?:\/\//i.test(s.trim()) ? esc(s.trim()) : ''
var link = (href, label) => url(href) ? `<a href="${url(href)}">${label}</a>` : label

function day(iso){
  var d = new Date(iso)
  if (!iso || isNaN(d)) return ''
  return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
}
function clock(seconds){
  if (!(seconds > 0)) return ''
  var s = Math.round(seconds), m = Math.floor(s/60)
  return m + ':' + String(s % 60).padStart(2, '0')
}

// the reader rewrites 'width: ' and ' width=' in post html (script.js), so inline sizes are written
// with no space after the colon
var boxStyle = 'border-left:3px solid #555;margin:1em 0;padding:.1em 0 .1em 1em'
var cardStyle = 'border:1px solid #555;margin:1em 0;padding:.5em 1em'
var mutedStyle = 'opacity:.6;font-size:14px'
var mediaStyle = 'display:block;width:100%;max-height:70vh;background:#000'
// a tall phone screenshot in a tweet shouldn't fill the whole screen
var photoStyle = 'max-height:60vh;width:auto'

function originOf(base){
  try {
    var u = new URL(base)
    if (/^https?:$/.test(u.protocol)) return u.origin
  } catch (e){}
  return 'https://substack.com'
}

function tweet(a){
  if (!a.full_text && !a.url) return null
  var out = [`<blockquote class="rss-embed rss-tweet" style="${boxStyle}">`]
  if (a.full_text) out.push(`<p>${para(a.full_text)}</p>`)

  var photos = Array.isArray(a.photos) ? a.photos : []
  if (url(a.video_url)){
    // video.twimg.com answers 403 to any referer but x.com, and a <video> can't be told to send
    // none, so the tweet's video opens in its own tab from a noreferrer link. The first photo is
    // substack's still of it with a play button baked in.
    var poster = photos[0] && url(photos[0].img_url)
    var still = poster ? `<img src="${poster}" alt="play video" style="${photoStyle}">` : '▶ play video'
    out.push(`<p><a href="${url(a.video_url)}" rel="noreferrer">${still}</a></p>`)
    photos = photos.slice(1)
  }
  photos.forEach(p => {
    if (url(p.img_url)) out.push(`<p>${link(p.link_url || p.img_url, `<img src="${url(p.img_url)}" alt="" style="${photoStyle}">`)}</p>`)
  })

  var e = a.expanded_url
  if (e && typeof e == 'object' && url(e.url)){
    out.push(`<p style="${cardStyle}">${link(e.url, text(e.title) || text(e.domain) || esc(e.url))}` +
      (e.domain ? `<br><span style="${mutedStyle}">${text(e.domain)}</span>` : '') + '</p>')
  }

  var q = a.quoted_tweet
  if (q && typeof q == 'object' && (q.full_text || q.username)){
    out.push(`<blockquote style="${boxStyle}"><p>${para(q.full_text)}</p>` +
      (Array.isArray(q.photos) ? q.photos.filter(p => url(p.img_url)).map(p => `<p><img src="${url(p.img_url)}" alt=""></p>`).join('') : '') +
      `<p style="${mutedStyle}">${text(q.name)} @${text(q.username)}</p></blockquote>`)
  }

  var who = [text(a.name), a.username ? '@' + text(a.username) : ''].filter(d => d).join(' ')
  var when = day(a.date) || 'tweet'
  out.push(`<p style="${mutedStyle}">— ${who}${who ? ' · ' : ''}${link(a.url, when)}</p>`)
  return out.join('') + '</blockquote>'
}

function bluesky(a){
  if (!a.text && !a.postId) return null
  var did = (a.authorDid || '').replace(/[^\w:.-]/g, '')
  var href = a.authorHandle && a.postId ? `https://bsky.app/profile/${encodeURIComponent(a.authorHandle)}/post/${encodeURIComponent(a.postId)}`
    : did && a.postId ? `https://bsky.app/profile/${did}/post/${encodeURIComponent(a.postId)}` : ''
  var imgs = (Array.isArray(a.imageUrls) ? a.imageUrls : []).filter(url).map(u => `<p><img src="${url(u)}" alt=""></p>`).join('')
  var who = [text(a.authorName), a.authorHandle ? '@' + text(a.authorHandle) : ''].filter(d => d).join(' ')
  return `<blockquote class="rss-embed rss-bluesky" style="${boxStyle}"><p>${para(a.text)}</p>${imgs}` +
    `<p style="${mutedStyle}">— ${who}${who ? ' · ' : ''}${link(href, day(a.createdAt) || 'bluesky')}</p></blockquote>`
}

function youtube(a){
  var id = String(a.videoId || '')
  if (!/^[\w-]{6,20}$/.test(id)) return null
  var start = a.startTime > 0 ? '&start=' + Math.floor(a.startTime) : ''
  // script.js sizes every iframe in a post to the column width at 16:9
  return `<div class="rss-embed rss-youtube"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0${start}" frameborder="0" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen="true"></iframe></div>`
}

// /api/v1/video/upload/<id>/src on the publication answers with a 307 to a signed mp4 that expires
// in a day, so the stable url goes in the page and the browser follows the redirect when played
function video(a, base){
  var id = String(a.mediaUploadId || '')
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) return null
  var src = `${originOf(base)}/api/v1/video/upload/${id}/src`
  var len = clock(a.duration)
  return `<figure class="rss-embed rss-video" style="margin:1em 0"><video controls preload="none" playsinline src="${src}" style="${mediaStyle};min-height:200px"></video>` +
    `<figcaption style="${mutedStyle}">video${len ? ' · ' + len : ''}${url(base) ? ' · ' + link(base, 'on the post') : ''}</figcaption></figure>`
}

function audio(a, base){
  var id = String(a.mediaUploadId || '')
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) return null
  var src = `${originOf(base)}/api/v1/audio/upload/${id}/src`
  var len = clock(a.duration)
  return `<figure class="rss-embed rss-audio" style="margin:1em 0">${a.label ? `<figcaption>${text(a.label)}</figcaption>` : ''}` +
    `<audio controls preload="none" src="${src}" style="display:block;width:100%"></audio>` +
    (len ? `<figcaption style="${mutedStyle}">audio · ${len}</figcaption>` : '') + '</figure>'
}

function digestPost(a){
  var href = a.canonical_url || a.url
  if (!a.title && !url(href)) return null
  var by = (Array.isArray(a.publishedBylines) ? a.publishedBylines : []).map(b => text(b && b.name)).filter(d => d)
  var meta = [text(a.publication_name), by.filter(b => b != text(a.publication_name)).join(', '), day(a.post_date)].filter(d => d).join(' · ')
  return `<div class="rss-embed rss-card" style="${cardStyle}"><p style="margin:.3em 0">${link(href, `<strong>${text(a.title) || esc(href)}</strong>`)}</p>` +
    (meta ? `<p style="${mutedStyle};margin:.3em 0">${meta}</p>` : '') +
    (a.caption ? `<p style="margin:.3em 0">${para(a.caption)}</p>` : '') + '</div>'
}

function image3(a, base, caption){
  if (!url(a.src)) return null
  // astral codex ten writes the caption as the div's text
  caption = text(caption) || text(a.title)
  var w = +a.width, h = +a.height
  var size = w > 0 && h > 0 ? ` width="${Math.round(w)}" height="${Math.round(h)}"` : ''
  var img = `<img src="${url(a.src)}" alt="${text(a.alt)}"${size}>`
  return `<figure class="rss-embed rss-image" style="margin:1em 0">${url(a.href) ? link(a.href, img) : img}` +
    (caption ? `<figcaption style="${mutedStyle}">${caption}</figcaption>` : '') + '</figure>'
}

function gallery(a){
  var g = a.gallery || {}
  var still = g.staticGalleryImage && url(g.staticGalleryImage.src)
  // substack renders a collage of the gallery for email; it's one picture instead of a dozen
  var imgs = still ? [still] : (Array.isArray(g.images) ? g.images : []).map(i => url(i && i.src)).filter(d => d)
  if (!imgs.length) return null
  return `<figure class="rss-embed rss-gallery" style="margin:1em 0">${imgs.map(s => `<img src="${s}" alt="${text(g.alt)}">`).join('')}` +
    (g.caption ? `<figcaption style="${mutedStyle}">${text(g.caption)}</figcaption>` : '') + '</figure>'
}

function comment(a){
  var c = a.comment
  if (!c || typeof c != 'object' || !c.body) return null
  // bare urls in a comment body are plain text; make them links
  var body = para(c.body).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, u => `<a href="${u}">${u}</a>`)
  var imgs = (Array.isArray(c.attachments) ? c.attachments : []).filter(d => d && d.type == 'image' && url(d.imageUrl))
    .map(d => `<p><img src="${url(d.imageUrl)}" alt=""></p>`).join('')
  return `<blockquote class="rss-embed rss-comment" style="${boxStyle}"><p>${body}</p>${imgs}` +
    `<p style="${mutedStyle}">— ${text(c.name) || 'comment'}${day(c.date) ? ' · ' + day(c.date) : ''}</p></blockquote>`
}

var postLink = (base, label) => `<p class="rss-embed" style="${cardStyle}">${url(base) ? link(base, label) : label}</p>`
var poll = (a, base) => postLink(base, 'Poll · vote on the post')

function latex(a){
  if (!a.persistentExpression) return null
  return `<pre class="rss-embed rss-latex"><code>${esc(String(a.persistentExpression).trim())}</code></pre>`
}

function polymarket(a){
  var slug = String(a.eventSlug || '').replace(/[^\w-]/g, '')
  if (!slug) return null
  var name = slug.replace(/-\d{8,}$/, '').replace(/-/g, ' ')
  return `<p class="rss-embed rss-card" style="${cardStyle}"><a href="https://polymarket.com/event/${slug}">Polymarket: ${esc(name)}</a></p>`
}

function instagram(a){
  var id = String(a.instagram_id || '').replace(/[^\w-]/g, '')
  if (!id) return null
  var href = `https://www.instagram.com/p/${id}/`
  var label = text(a.title) || (a.author_name ? '@' + text(a.author_name) : 'Instagram post')
  return `<figure class="rss-embed rss-instagram" style="margin:1em 0">${url(a.thumbnail_url) ? link(href, `<img src="${url(a.thumbnail_url)}" alt="">`) : ''}` +
    `<figcaption style="${mutedStyle}">${link(href, label)}</figcaption></figure>`
}

var nothing = () => ''

// first class name -> render(attrs, base, text). inner: what may sit between the open and close
// tag, its first group handed to render as text
var emptyInner = /^\s*<\/div>/i
var embeds = {
  'twitter-embed': {render: tweet},
  'bluesky-wrap': {render: bluesky, inner: /^\s*<iframe\b[^>]*>\s*<\/iframe>\s*<\/div>/i},
  'youtube-wrap': {render: youtube, inner: /^\s*<div class="youtube-inner">\s*<\/div>\s*<\/div>/i},
  'native-video-embed': {render: video},
  'native-audio-embed': {render: audio},
  'digest-post-embed': {render: digestPost},
  'image3': {render: image3, inner: /^([^<]*)<\/div>/i},
  'image-gallery-embed': {render: gallery},
  'comment': {render: comment},
  'poll-embed': {render: poll},
  'latex-rendered': {render: latex},
  'polymarket-embed': {render: polymarket},
  'instagram-embed-wrap': {render: instagram},
  // a subscribe-to-sponsor box and a 'message me' button: nothing to show without substack's app
  'sponsorship-campaign-embed': {render: nothing},
  'directMessage': {render: nothing},
}

function rewriteEmbeds(html, base){
  if (typeof html != 'string' || !html.includes('data-attrs=')) return html
  var re = new RegExp(openTagRegex.source, 'gi'), m, out = '', last = 0
  while ((m = re.exec(html))){
    var cls = (m[2].match(/\sclass\s*=\s*"([^"]*)"/i) || [])[1]
    var embed = cls && embeds[cls.trim().split(/\s+/)[0]]
    if (!embed) continue
    var raw = (m[2].match(/\sdata-attrs\s*=\s*"([^"]*)"/i) || [])[1]
    if (raw == null) continue
    var close = html.slice(re.lastIndex, re.lastIndex + 2000).match(embed.inner || emptyInner)
    if (!close) continue
    var rep = null
    try { rep = embed.render(JSON.parse(decodeEntities(raw)) || {}, base, close[1]) } catch (e){}
    if (rep == null) continue
    out += html.slice(last, m.index) + rep
    last = re.lastIndex = re.lastIndex + close[0].length
  }
  return last ? out + html.slice(last) : html
}

module.exports = {rewriteEmbeds}
