// node test/absolutize.test.js — relative links in feed html resolve against the post, not the reader
var assert = require('assert')
var {absolutizeHtml, baseUrlOf} = require('../bin/util.js')

var base = 'https://domoritz.de/blog/2026/11/vis-bluesky-retrospective.html'
var cases = [
  ['<a href="/blog/2026/09/vis-bluesky-discussions.html">', '<a href="https://domoritz.de/blog/2026/09/vis-bluesky-discussions.html">'],
  ['<img src="./a.png">', '<img src="https://domoritz.de/blog/2026/11/a.png">'],
  ['<img src=\'../b.png\'>', '<img src=\'https://domoritz.de/blog/2026/b.png\'>'],
  ['<a href="glossary.html#clamp">', '<a href="https://domoritz.de/blog/2026/11/glossary.html#clamp">'],
  ['<script src="//platform.instagram.com/embeds.js">', '<script src="https://platform.instagram.com/embeds.js">'],
  ['<svg><use xlink:href="/icons.svg#x"></use></svg>', '<svg><use xlink:href="https://domoritz.de/icons.svg#x"></use></svg>'],
  // left alone
  ['<a href="#fn1">', '<a href="#fn1">'],
  ['<a href="mailto:a@b.c">', '<a href="mailto:a@b.c">'],
  ['<a href="https://example.com/x">', '<a href="https://example.com/x">'],
  ['<img src="data:image/png;base64,AA==">', '<img src="data:image/png;base64,AA==">'],
  ['<p data-href="/x">text href="/y" in prose</p>', '<p data-href="/x">text href="/y" in prose</p>'],
]
cases.forEach(([input, want]) => assert.strictEqual(absolutizeHtml(input, base), want, input))

assert.strictEqual(absolutizeHtml('<a href="/x">', ''), '<a href="/x">')
assert.strictEqual(baseUrlOf('/post/1', 'https://site.com/'), 'https://site.com/post/1')
assert.strictEqual(baseUrlOf(undefined, 'https://site.com/'), 'https://site.com/')
assert.strictEqual(baseUrlOf('urn:uuid:123', 'https://site.com/'), 'https://site.com/')
console.log('absolutize: ' + cases.length + ' cases ok')
