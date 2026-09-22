# static-rss

- https://rss.roadtolarissa.com/ (the app, installable, works offline)
- https://roadtolarissa.com/static-rss/ (blog post embedding it)
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

The standalone page (https://roadtolarissa.com/slinks/static-rss/, `/slinks/nyc-feed/`; add it to the home screen) works with no signal:

- Every post seen is kept in IndexedDB and redrawn instantly on load; `items-today` and `items-recent` are merged in by href as they arrive (anything older than 31 days before the newest post in `items-recent` is dropped). An open post stays open and in place while posts land above it.
- `public/sw.js` serves the app shell from cache and `generated/*.json` network-first with a cache fallback. With no store yet, a connection that hangs for 5s falls back to the saved lists.
- After `items-recent` loads, every `longposts/<id>.json` the list points at is saved in the background (about 10MB for ~115 posts); the footer shows `N/M saved`, or `offline`.
- Caches and the store are named after the app's path, so the two feeds and `/reader/` on the same origin never touch each other's. Cross-origin favicons and images aren't cached.
- The blog posts at `/static-rss/` and `/nyc-feed/` embed the same script; they share the store and saved posts but sit outside the service worker's scope.

Shell files are cache-first, so a deploy shows up one load late (bump `SHELL_CACHE` in `sw.js` to force it).

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


