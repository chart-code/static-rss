# static-rss

- https://roadtolarissa.com/static-rss/
- https://roadtolarissa.com/nyc-feed/

## Dev

- Replace `subs.xml` or `feeds.csv` with your own [OPML file](https://blog.feedly.com/opml/).
- You can also set `STATIC_RSS_CSV_URL=$yoursheeturl` to your [own sheet](https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0) containing `title`, `feed` and `ignore` headers. 

Then run: 

```bash
yarn
bin/download.js && bin/parse.js # update feeds
npx hot-server # start a local server to render feeds
```

## How it works

`bin/update.sh` loops forever: `download.js` (fetch feeds, conditional GET w/ etags) → `parse.js` (parse xml, drop paywalled posts, fetch full text for summary-only feeds via `fulltext.js`) → `archive.js` (bake out `public/generated/*.json`) → `favicons.js`.

The live feed list is the google sheet (`STATIC_RSS_CSV_URL`); `feeds.csv` is a checked-in copy.

## Offline

`public/sw.js` caches the page, `script.js`/`style.css`/`d3_.js` and the `generated/*.json` it has
fetched, so the list (and any long post opened once) still renders with no signal. Cache-first for
the app shell, network-first for the feed JSON; caches are named after the app folder so
`/slinks/static-rss/`, `/slinks/nyc-feed/` and other apps on the origin don't collide.

Deliberately not installable: no manifest, no icons, no install prompt.

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


