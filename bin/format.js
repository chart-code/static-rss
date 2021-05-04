var {fs, d3, io, jp, _, glob, request} = require('scrape-stl')


var items = io.readDataSync(__dirname + '/items.json')

console.log(items[8])
console.log(items[8].isoDate > '2021')

console.log(items.length)