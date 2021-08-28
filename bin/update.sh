#!/bin/bash

while true
do
  node download.js && node parse.js && node archive.js && node favicons.js
  sleep 3600
done