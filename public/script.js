console.clear()

window.params = (() => {
  var url = new URL(window.location)
  var searchParams = new URLSearchParams(url.search) 

  var rv = {}

  rv.get = key => {
    return searchParams.get(key)
  }

  rv.set = (key, value) => {
    searchParams.set(key, value)

    url.search = searchParams.toString()
    history.replaceState(null, '', url)
  }

  return rv
})()

var itemURL = 'items-today'
if (params.get('date')) itemURL = 'dates/' + params.get('date')
if (params.get('feed')) itemURL = 'feeds/' + params.get('feed')
  

d3.loadData(
  window.datapath + `generated/${itemURL}.json?` + Math.random(), 
  window.datapath + 'generated/favicons.json', 
  (err, res) => {

  window.items = _.sortBy(res[0], d => d.isoDate).reverse()
  window.favicons = res[1]

  favicons.forEach(d => {
    if (!d.favicon || !d.favicon.icons) return d.img = {}

    d.img = _.sortBy(d.favicon.icons, d => {
      if (d.src.includes('svg')) return 10000
      if (d.src.includes('apple')) return 1000
      if (d.sizes) return +d.sizes.split('x')[0]
    }).reverse()[0] || {}

    d.img = d.favicon.icons.filter(d => d.src.includes('png')).slice(-1)[0] || d.favicon.icons[0] || {}
  })
  var name2icons = Object.fromEntries(favicons.map(d => [d.feedName, d.img]))

  // add today's and yesterday's posts
  var itemSel = d3.select('.items').html('')
  drawDays(items)

  // add posts from the last 90 days
  d3.loadData(
    window.datapath + `generated/${itemURL.replace('today', 'recent')}.json`, 
    (err, res) => drawDays(res[0], itemSel.selectAll('div.date').data().map(d => d.key)))

  function drawDays(items, prevDates=[]){
    var byDate = d3.nestBy(items, d => d.isoDate.split('T')[0])
      .filter(d => !prevDates.includes(d.key))
      .filter(d => new Date(d.key) < +(new Date()) + 24*60*60*1000)

    var dateSel = itemSel.appendMany('div.date', _.sortBy(byDate, d => d.key).reverse())

    dateSel.append('h3').text(d => d.key)

    var postSel = dateSel.appendMany('div.item', d => d)
      .classed('read', d => window.localStorage.getItem(d.href))

    var titleSel = postSel.append('div.post-title')
      .on('click', function(d){
        d.active = !d.active

        var sel = d3.select(this.parentNode)
          .classed('read', 1)
          .classed('active', d.active)
          .select('.content')

        if (!d.active){
          var node = this.parentNode
          if (node.getBoundingClientRect().top < 0) node.scrollIntoView(true)
          return sel.html('')
        }

        var hrefPP = d.href.split('//')[1].replace('www.', '').replace('.html', '').split('/')[0]
        sel
          .append('p').st({marginTop: 5, opacity: .4})
          .append('a').text(hrefPP).at({href: d.href, target: '_blank'})
          .parent()
          .append('a').text('>').at({href: '?feed=' + hrefPP}).st({marginLeft: '1em'})

        var width = sel.select('p').node().offsetWidth

        var contentStr = (d['content:encoded'] || d.content || d.summary || '')
          .replaceAll('width: ', 'x-width: ')
          .replaceAll(' width=', ' x-width=')
          .replaceAll('height: ', 'x-height: ')
        var rawHTMLSel = sel.append('div.raw-html').html(contentStr)

        // responsive youtube embed
        rawHTMLSel.selectAll('iframe').at({width, height: width*9/16})

        // open all links in a new tab
        rawHTMLSel.selectAll('a').at({target: 'blank'})

        if (hrefPP == 'xkcd.com'){
          rawHTMLSel.append('p').text(rawHTMLSel.select('img').attr('title'))
        }

        window.localStorage.setItem(d.href, new Date().toISOString())
      })

    // titleSel.each(function(d){ d3.select(this).on('click').call(this, d) })

    titleSel.append('img.icon')
      .at({src: d => name2icons[d.feedName]?.src, width: 20})
      .on('err', function(d){ d3.select(this).st({opacity: 0})})
    titleSel.append('span').html(d => d.title)

    postSel.append('div.content')
  }

  
})