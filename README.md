# static-rss

- https://roadtolarissa.com/static-rss/
- https://roadtolarissa.com/nyc-feed/

## Dev

- Replace `feeds.xml` or `feeds.csv` with your own [OPML file](https://blog.feedly.com/opml/).
- You can also set `STATIC_RSS_CSV_URL=$yoursheeturl` to your [own sheet](https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0) containing `title`, `feed` and `ignore` headers. 

Then run: 

```bash
yarn
bin/download.js && bin/parse.js # update feeds
npx hot-server # start a local server to render feeds
```

## How it works

`bin/update.sh` loops forever: `download.js` (fetch feeds, conditional GET w/ etags) → `parse.js` (parse xml, drop paywalled posts, fetch full text for summary-only feeds via `fulltext.js`) → `archive.js` (bake out `public/generated/*.json`) → `favicons.js`.

Every post is kept as its own file under `bin/cache/days/<day>/`; `archive.js` reads the last 31 days
out of it for `items-today.json`/`items-recent.json` and the sites that got a post for the `?feed=`
views, so an hourly run costs a readdir and a couple of thousand small reads rather than the whole
830 MB archive. `bin/README.md` has the layout and the `--full` rebuild.

The live feed list is the google sheet (`STATIC_RSS_CSV_URL`); `feeds.csv` is a checked-in copy.

## Offline

`public/sw.js` caches the page, `script.js`/`style.css`/`d3_.js` and the `generated/*.json` it has
fetched, so the list (and any long post opened once) still renders with no signal. Cache-first for
the app shell and for `generated/longposts/` — a long post's file never changes, so one opened
before opens again with no network wait; network-first for the hourly feed JSON. Caches are named
after the app folder so `/slinks/static-rss/`, `/slinks/nyc-feed/` and other apps on the origin
don't collide.

Deliberately not installable: no manifest, no icons, no install prompt.

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


