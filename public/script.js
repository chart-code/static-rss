console.clear()

d3.loadData(
  window.datapath + 'generated/items.json', 
  window.datapath + 'generated/favicons.json', 
  (err, res) => {

  window.items = _.sortBy(res[0], d => d.isoDate).reverse()

  window.favicons = res[1]
  favicons.forEach(d => {
    if (!d.favicon.icons) return d.img = {}

    d.img = _.sortBy(d.favicon.icons, d => {
      if (d.src.includes('svg')) return 10000
      if (d.src.includes('apple')) return 1000
      if (d.sizes) return +d.sizes.split('x')[0]

    }).reverse()[0] || {}

    // d.img = d.favicon.icons.filter(d => d.src.includes('png')).slice(-1)[0] || d.favicon.icons[0] || {}
  })
  var name2icons = Object.fromEntries(favicons.map(d => [d.feedName, d.img]))

  items.forEach(d => {
    d.read = window.localStorage.getItem(d.href)
  })

  var dateSel = d3.select('.items').html('')
    .appendMany('div.date', d3.nestBy(items, d => d.isoDate.split('T')[0]))
  dateSel.append('h3').text(d => d.key)

  var postSel = dateSel.appendMany('div.item', d => d)
    .call(d3.attachTooltip)
    .classed('read', d => d.read)

  var titleSel = postSel.append('div.post-title')
    .on('click', function(d){
      d.active = !d.active
      // window.str = d['content:encoded'].slice(-100)

      var sel = d3.select(this.parentNode)
        .classed('read', 1)
        .classed('active', d.active)
        .select('.content')

      if (!d.active){
        var node = this.parentNode
        if (node.getBoundingClientRect().top < 0) node.scrollIntoView(true)
        return sel.html('')
      }

      var hrefPP = d.href.split('//')[1]
        .replace('www.', '')
        .replace('.html', '')
        .split('/')[0]
      sel
        .append('p').st({marginTop: 0})
        .append('a').text(hrefPP).at({href: d.href, target: '_blank'}).st({opacity: .4})

      var contentStr = (d['content:encoded'] || d.content)
        .replaceAll('width: ', 'x-width: ')
        .replaceAll('height: ', 'x-height: ')
      sel.append('div.raw-html').html(contentStr)

      var paywallStr = "Read more\n                            </a>\n                        </p>\n"
      paywallStr = 'Read more'
      console.log(!contentStr.includes(paywallStr))

      window.localStorage.setItem(d.href, new Date().toISOString())
    })

  titleSel.append('img.icon')
    .at({src: d => name2icons[d.feedName]?.src, width: 20})

  titleSel.append('span').html(d => d.title)


  postSel.append('div.content')
})