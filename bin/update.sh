#!/bin/bash

# Since 2026-11-28 systemd runs this loop as its own user (unit rtl-static-rss, see ~/ops/README.md).
# Run by hand as demo, it restarts that unit instead of starting a second copy.
if [ "$(id -un)" = demo ] && [ -f /etc/systemd/system/rtl-static-rss.service ]; then
  exec sudo -n systemctl restart rtl-static-rss
fi

# a step that exits non-zero gets a line in bin/update.log — an oom kill (137) used to leave
# fresh day files, stale items-*.json and nothing to say so
log="$(dirname "$0")/update.log"
run(){
  "$@" || { code=$?; echo "$(date '+%F %T') FAILED exit $code : $*" >> "$log"; }
}

while true
do
  run node download.js
  run node parse.js
  run node archive.js
  run node favicons.js
  sleep 3600
done
