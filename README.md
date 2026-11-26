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

On a flaky connection (a train) the saved list is drawn first and the page keeps asking for the
real one until the server answers: on a backoff (1s, 2s, 4s … every 30s) while the tab is
visible, at once on `online` and on becoming visible, never while hidden, one request at a time.
Every fetch that holds a flag has a deadline: 15s for the answer to start and 60s for the body in
the page, 12s in `sw.js` for the feed JSON, after which the worker hands over the saved copy. A
fresh list is merged into the one on screen, not reloaded: new posts go in by date, open posts
and read marks stay, and the row at the top of the screen stays put.

Under the list is one muted line: how many posts are on screen, whether they are the server's list
or the saved copy, how old the list is and how many of its long posts read with no signal ("312
posts · fresh · list 41m ago · 18/22 saved"), then which copy of the app is running ("app v3").
It says "cached · … · offline" while the saved copy is showing and the last ask failed (`sw.js`
hands a saved copy over with `x-sw-cache` so the page can tell), and "no answer" when a tapped
check fails.

Tapping the line asks for the list again, past the hourly rhythm and past `navigator.onLine`; new
posts are merged in. Tapping the version asks the service worker which shell
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
  `~/static-rss-state/read.json` (600, atomic writes), only `<owner email>`. The allowlist is not
  in git: `EMAILS=a,b` in the environment, else `{"emails": ["<owner email>"]}` in
  `~/static-rss-state/config.json` (600), read at startup. With neither, it logs
  `NO EMAILS ALLOWED` and every request is a 401. `yarn test` runs it against
  `owner@example.test` in a temp dir.
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

## Reading log

Signed in, each post open is also logged, for a chart later. Same on/off as the read marks:
signed out, nothing is measured, kept or sent. An event ends on collapse, on opening another post
and on the tab going hidden (`visibilitychange`/`pagehide`); a post still open when the tab comes
back starts a new event. Scroll is a passive listener, measured at most every 250ms.

- One JSON line per event in `~/static-rss-state/log.jsonl` (600):
  `{"id":"mwx3ewv2-eiv63lep","at":"2026-11-26T05:09:23.294Z","href":"https://…","feed":"simonwillison","title":"…","maxScroll":0.66,"seconds":42,"device":"phone"}`.
  `maxScroll` is how far down the post body the bottom of the screen got (0-1), `seconds` the time
  open with the tab visible, `device` `phone`, `eink` (Android Chrome < 120, the Boox) or `desktop`,
  `title` at most 120 characters.
- `POST /static-rss-state/log` `{log: [event]}` appends the valid ones it hasn't seen (the page
  makes the id, so a resend after a lost answer adds nothing) and answers `{ok, n}` with the
  number added. `GET` returns `{log: [event]}`, oldest first. Same gate, allowlist and
  same-origin JSON check as `/read`.
- Client: events wait in `localStorage` (`rss-log-queue`, newest 5000) and go up 50 at a time with
  `keepalive`, after the read marks and through the same queue, deadline and 401 switch. The
  footer's "n to sync" counts them too.

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


