var {fs, d3, io, jp, _, glob} = require('scrape-stl')

var rootdir = __dirname + '/../public/generated/items-all/'
if (!fs.existsSync(rootdir)) fs.mkdirSync(rootdir)

function saveItems(items){
  jp.nestBy(items, d => d.isoDate ? d.isoDate.split('-')[0] : '1234')
    .forEach(year => {
      io.writeDataSync(rootdir + year.key + '.json', year)
    })
}

function loadItems(){
  var items = []
  glob.sync(rootdir + '*.json').forEach(path => {
    items = items.concat(io.readDataSync(path))
  })

  return items
}



module.exports = {loadItems, saveItems}