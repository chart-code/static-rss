while true
do
  node download.js && node parse.js && node archive.js
  sleep 3600
done