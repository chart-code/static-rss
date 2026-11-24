#!/bin/bash
#
# Keep server/readstate.js (read marks synced across devices) up on 127.0.0.1:3008.
#
#   ssh demo@roadtolarissa.com 'cd static-rss && setsid nohup bash bin/readstate-forever.sh >> bin/readstate.log 2>&1 < /dev/null &'
#
# Re-running it replaces the old copy, so that one line is also "restart". crontab has the
# same line under @reboot.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

PORT=${PORT:-3008}
STATE_DIR=${STATE_DIR:-$HOME/static-rss-state}
mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
PIDFILE=$STATE_DIR/forever.pid

# Kill the previous loop by pidfile, not `pgrep -f`: over ssh the invoking shell's own command
# line contains the script name, so a -f match would kill the ssh session too.
if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null; then
    kill -9 "$old" 2>/dev/null
  fi
fi
echo $$ > "$PIDFILE"

# ...then whatever still holds the port (the node the old loop was supervising)
port_pids=$(lsof -t -i:$PORT -sTCP:LISTEN 2>/dev/null)
[ -n "$port_pids" ] && kill -9 $port_pids 2>/dev/null

trap 'rm -f "$PIDFILE"' EXIT

while true
do
  PORT=$PORT STATE_DIR=$STATE_DIR node server/readstate.js
  sleep 1
done
