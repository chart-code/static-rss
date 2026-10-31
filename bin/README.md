# Update scripts

`update.sh` loops forever — `download.js` → `parse.js` → `archive.js` → `favicons.js`, then sleeps an
hour. It runs in tmux on roadtolarissa.com: `tmux attach -t main`, first window, `~/static-rss/bin`.

https://roadtolarissa.com/static-rss/

```
STATIC_RSS_CSV_URL="https://www.googleapis.com/drive/v3/files/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/export?mimeType=text/csv&key=AIzaSyAT-ALGW_bcmcvNs1dPgcV7fF6tR1vKY44" \
STATIC_RSS_CSV_PATH="skip" \
STATIC_RSS_XML_PATH="skip" \
./update.sh
```

https://roadtolarissa.com/nyc-feed/ — same code, its own feed list. Its loop isn't running.

```
STATIC_RSS_CSV_URL="https://www.googleapis.com/drive/v3/files/1zzrLPJQqxatd5CNhyjcAnjlbGM2haqDL2YY3SCgJ1PA/export?mimeType=text/csv&key=AIzaSyAT-ALGW_bcmcvNs1dPgcV7fF6tR1vKY44" \
STATIC_RSS_CSV_PATH="skip" \
STATIC_RSS_XML_PATH="skip" \
./update.sh
```

## Data

- `cache/xml/<feed>.xml` — the last download of each feed; etags in `cache/headers.json`
- `cache/fulltext/<url>.json` — article text fetched for summary-only feeds, cached forever
- `cache/days/<YYYY-MM-DD>/<site>_.._<url>.json` — one json per post, the archive of record (~72k
  files, 830 MB). The day is in the path, so a run picks the last 31 days with a readdir and a
  string compare — a readdir of the whole archive is 0.25s, reading all of it is 18s, so nothing
  reads all of it
- `cache/feed-authors.json` — how often each byline appears per feed, for the guest-author line
- `public/generated/items-all/<year>.json` — parse.js's handoff to archive.js and favicons.js
- `public/generated/items-{today,recent}.json`, `feeds/<site>.json`, `favicons.json` — the reader

## archive.js

```
node archive.js          # incremental: the 31 day window, plus sites that got a post this run
node archive.js --full   # also rewrite every feeds/<site>.json from the archive
```

`feeds/<site>.json` (the `?feed=` view) holds a site's 100 most recent posts, and the hourly run
only rewrites the sites that moved. Run `--full` after changing a filter in parse.js or archive.js
so those views drop (or pick up) older posts too; items-today/items-recent are rebuilt from the
window on every run either way.

`public/generated/dates/*.json` (the `?date=` view) is no longer written. archive.js only ever
generated 2022, from a one-off; the files that exist are left in place.

# TODO

Switch to `config.json`
