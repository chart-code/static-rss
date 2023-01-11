# static-rss

https://roadtolarissa.com/static-rss/

## Dev

Replace `subs.xml` with your own [OPML file](https://blog.feedly.com/opml/). Or replace the google sheet in [bin/download.js](https://github.com/chart-code/static-rss/blob/main/bin/download.js#L20-L21) with your [own sheet](https://docs.google.com/spreadsheets/d/14nBbfTEPPzncQhRXuNkSUjBWwPc3OCH3bibuB9UbwfM/edit#gid=0) containing `title`, `xmlUrl` and `ignore` headers.

Then run: 

```bash
yarn
bin/download.js && bin/parse.js # update feeds
npx hot-server # start a local server to render feeds
```

## Prior work

- http://kouio.com/
- https://github.com/osmoscraft/osmosfeed


