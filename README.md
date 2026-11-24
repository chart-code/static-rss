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

Under the list is one muted line: how many posts are on screen, how old the list is and how many
of its long posts read with no signal ("312 posts · list 41m ago · 18/22 saved"), then which copy
of the app is running ("app v3"). It says "offline" when the list came out of the cache because
the network was dead (`sw.js` hands a saved copy over with `x-sw-cache` so the page can tell), and
"no answer" when a check fails.

Tapping the line asks for the list again, past the hourly rhythm and past `navigator.onLine`; a
list that has moved on reloads the page. Tapping the version asks the service worker which shell
cache it is serving (`postMessage('version', [port])`) and, tapped, throws that copy away — this
page's worker unregistered, this app's `shell-` caches deleted, the data cache with the saved long
posts kept — and loads the app from the server. It only ever touches this app's own worker and
caches, since `/reader/`, `/nyc-feed/` and every sketch share the origin. Bump `SHELL_CACHE` in
`sw.js` to move the version. goal, the diary editor and the reader have the same line.

Deliberately not installable: no manifest, no icons, no install prompt.

## Read marks across devices

A post opened is marked read in `localStorage` (keyed on its href), and the page paints from
that. When Adam is signed in, the marks also sync between his devices. Nobody is ever asked to
sign in, on purpose: there's no button, link or prompt. Sync only turns on when the rtl-auth cookie is
already there. It's set on `Domain=.roadtolarissa.com`, so signing in to the reader or goal
covers this page.

- `GET /static-rss-state/read` returns `{read: {href: iso}}`; `POST` merges `{read: {...}}`. Union, earliest date
  wins, marks older than 120 days are dropped. `server/readstate.js` on 127.0.0.1:3008, file
  `~/static-rss-state/read.json` (600, atomic writes), only `1wheel@gmail.com` (`EMAILS=`).
- nginx: `deploy/nginx-readstate.conf` is pasted into the default (apex) server in
  `/etc/nginx/sites-available/default`, next to the rtl-auth include. With no session it answers
  `401 {"error":"signed out"}`, not the sign-in redirect.
- Client (`read marks across devices` in `script.js`): after the list is drawn, one GET with a 10s
  deadline merges the server's marks in and re-marks rows, and pushes marks only this device
  has. New opens queue in `localStorage` (`rss-sync-queue`) and go up in small batches, on
  `online` and on the next load if there was no signal. A 401 sets `rss-sync-off` in
  `sessionStorage` and the tab stops asking. When sync is on, the footer says "synced", or
  "3 to sync" while some are waiting. When it's off, the footer says nothing about it. `sw.js` never touches
  `/static-rss-state/`.
- Kept up by `bin/readstate-forever.sh` (log `bin/readstate.log`) plus an `@reboot` crontab
  line. Restart with `cd ~/static-rss && setsid nohup bash bin/readstate-forever.sh >> bin/readstate.log 2>&1 < /dev/null &`.

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


