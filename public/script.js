console.clear()

d3.loadData(window.datapath + 'items.json', (err, res) => {
  window.items = _.sortBy(res[0], d => d.isoDate).reverse()

  items.forEach(d => {
    d.href = d.guid && d.guid.includes && d.guid.includes('//') ? d.guid : d.link
    d.read = window.localStorage.getItem(d.href)
  })

  var dateSel = d3.select('.items').html('')
    .appendMany('div.date', d3.nestBy(items, d => d.isoDate.split('T')[0]))
  dateSel.append('h3').text(d => d.key)

  var postSel = dateSel.appendMany('div.item', d => d)//.call(d3.attachTooltip)
    .classed('read', d => d.read)

  postSel.append('div.post-title').text(d => d.title)
    .on('click', function(d){
      d.active = !d.active

      var sel = d3.select(this.parentNode)
        .classed('read', 1)
        .classed('active', d.active)
        .select('.content')

      if (!d.active){
        var node = this.parentNode
        if (node.parentNode.getBoundingClientRect().top < 0) node.scrollIntoView(true)
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

      window.localStorage.setItem(d.href, new Date().toISOString())
    })

  postSel.append('div.content')
})