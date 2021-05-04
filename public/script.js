console.clear()

d3.loadData('items.json', (err, res) => {
  window.items = _.sortBy(res[0], d => d.isoDate).reverse()

  var byDate = d3.nestBy(items, d => d.isoDate.split('T')[0])


  var dateSel = d3.select('.items').html('')
    .appendMany('div.date', byDate)
  dateSel.append('h3').text(d => d.key)

  var postSel = dateSel.appendMany('div.item', d => d)
    .call(d3.attachTooltip)

  postSel.append('div.post-title').text(d => d.title)
    .on('click', function(d){

      d.active = !d.active

      var sel = d3.select(this)
        .parent()
        .classed('active', d.active)
        .select('.content')

      if (!d.active) return sel.html('')

      var href = d.guid && d.guid.includes('//') ? d.guid : d.link
      var hrefPP = href.split('//')[1]
        .replace('www.', '')
        .replace('.html', '')
        .split('/')[0] //+ ' →'
      sel
        .append('p').st({marginTop: 0})
        .append('a').text(hrefPP).at({href}).st({opacity: .4})

      sel.append('div.raw-html').html(d['content:encoded'] || d.content)
    })

  postSel.append('div.content')


  // d3.select('.items').html(`${
  //   byDate.map(date =>
  //   `<div class='date'>
  //     <h3>${date.key}</h3>

  //     ${date.map(d => `
  //     <div class='post'>
  //       <div class='post-title'>${d.title}</div>
  //     </div>
  //     `).join('')}
  //   </div>
  //   `).join('')
  // }`)

})