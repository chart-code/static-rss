# static-rss

https://roadtolarissa.com/static-rss/

## Dev

- Replace `subs.xml` with your own [OPML file](https://blog.feedly.com/opml/). Or replace the google sheet id `bin/download.js` with your [own sheet](https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0) containing `title`, `xmlUrl` and `ignore` headers.
- `yarn`
- `bin/download.js && bin/parse.js` update feeds
- `npx hot-server` start a local server

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


