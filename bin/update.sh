#!/bin/bash

while true
do
  node download.js && node parse.js && node archive.js && node favicon.js
  sleep 3600
done