// TEMPORARY — the status-bar diagnostic. Loaded ONLY on the test site (main.tsx gates it on the
// /test_version/ path) and removed again once the owner has reported what his iPhone does.
//
// WHY IT EXISTS: three attempts to dim the installed app's status bar behind a popup each put the
// right colour somewhere iOS turned out not to read (the theme-color tag, <body>'s background,
// <html>'s background). iOS picks the status-bar colour itself and does not document from what. So
// instead of a fourth guess this paints every candidate a DIFFERENT vivid colour at once, on the
// real app's own elements, and the owner reads the answer off the status bar.
//
// Plain DOM, no framework, nothing imported: it must not be able to change how the app behaves, and
// it has to be deletable as one file plus the one loader line.
;(function () {
  'use strict'
  if (window.__sbTest) return
  window.__sbTest = true

  var SECONDS = 8
  var COLORS = {
    meta: ['#ff0000', 'RED'],
    html: ['#00b400', 'GREEN'],
    body: ['#0050ff', 'BLUE'],
    root: ['#ff8800', 'ORANGE'],
    bar: ['#a000ff', 'PURPLE'],
    strip: ['#ffe600', 'YELLOW'],
  }
  var NAMES = {
    meta: 'the theme colour tag',
    html: 'the outer page background',
    body: 'the body background',
    root: 'the full-screen page layer',
    bar: 'the top bar',
    strip: 'a new strip at the very top',
  }

  // What each test paints. `dim` draws the same see-through black layer a popup does.
  var TESTS = [
    {
      n: 1,
      label: 'Everything at once, each a different colour — NO dim',
      paint: 'rainbow',
      dim: false,
    },
    {
      n: 2,
      label: 'Everything at once, each a different colour — WITH the popup dim',
      paint: 'rainbow',
      dim: true,
    },
    { n: 3, label: 'Only the theme colour tag (red)', paint: ['meta'], dim: true },
    { n: 4, label: 'Only the outer page background (red)', paint: ['html'], dim: true },
    { n: 5, label: 'Only the body background (red)', paint: ['body'], dim: true },
    { n: 6, label: 'Only the full-screen page layer (red)', paint: ['root'], dim: true },
    { n: 7, label: 'Only the top bar (red)', paint: ['bar'], dim: true },
    {
      n: 8,
      label: 'Only a thin new strip at the very top, above the dim (red)',
      paint: ['strip'],
      dim: true,
    },
    {
      n: 9,
      label: 'Only a TALL new strip covering the top bar, above the dim (red)',
      paint: ['tallstrip'],
      dim: true,
    },
    {
      n: 10,
      label: 'The theme colour tag, removed and added back (red)',
      paint: ['metaswap'],
      dim: true,
    },
    {
      n: 11,
      label: 'Just the popup dim, nothing else (what the app does today)',
      paint: [],
      dim: true,
    },
  ]

  var el = function (tag, css, text) {
    var e = document.createElement(tag)
    if (css) e.style.cssText = css
    if (text) e.textContent = text
    return e
  }
  var FONT = 'font:600 14px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
  var Z = 2147483000

  // ── the things a test can paint, each returning its own undo ──────────────────────────────────
  var painters = {
    meta: function (c) {
      var m = document.querySelector("meta[name='theme-color']")
      if (!m) return function () {}
      var was = m.getAttribute('content')
      m.setAttribute('content', c)
      return function () {
        m.setAttribute('content', was)
      }
    },
    metaswap: function (c) {
      var m = document.querySelector("meta[name='theme-color']")
      if (!m) return function () {}
      var was = m.getAttribute('content')
      var fresh = document.createElement('meta')
      fresh.setAttribute('name', 'theme-color')
      fresh.setAttribute('content', c)
      m.replaceWith(fresh)
      return function () {
        fresh.setAttribute('content', was)
      }
    },
    html: function (c) {
      return inline(document.documentElement, 'background', c)
    },
    body: function (c) {
      return inline(document.body, 'background-color', c)
    },
    root: function (c) {
      return inline(document.getElementById('root'), 'background', c)
    },
    bar: function (c) {
      return inline(document.querySelector('.htp-sticky-bar'), 'background', c)
    },
    strip: function (c) {
      return addStrip(c, '14px')
    },
    tallstrip: function (c) {
      var bar = document.querySelector('.htp-sticky-bar')
      var h = bar ? Math.ceil(bar.getBoundingClientRect().height) + 'px' : '64px'
      return addStrip(c, h)
    },
  }
  function inline(node, prop, value) {
    if (!node) return function () {}
    var was = node.style.getPropertyValue(prop)
    var wasPriority = node.style.getPropertyPriority(prop)
    node.style.setProperty(prop, value, 'important')
    return function () {
      if (was) node.style.setProperty(prop, was, wasPriority)
      else node.style.removeProperty(prop)
    }
  }
  function addStrip(c, height) {
    // Above the dim (which is drawn at Z + 1), so the dim never darkens it.
    var s = el(
      'div',
      'position:fixed;top:0;left:0;right:0;height:' +
        height +
        ';z-index:' +
        (Z + 2) +
        ';background:' +
        c,
    )
    document.body.appendChild(s)
    return function () {
      s.remove()
    }
  }

  // ── the launcher button and the list of tests ────────────────────────────────────────────────
  var launcher = el(
    'button',
    'position:fixed;left:10px;bottom:10px;z-index:' +
      Z +
      ';padding:8px 12px;border-radius:999px;border:1px solid #888;' +
      'background:#111;color:#fff;opacity:.85;' +
      FONT,
    'Status bar test',
  )
  launcher.type = 'button'

  var sheet = el(
    'div',
    'position:fixed;left:0;right:0;bottom:0;max-height:72%;overflow:auto;z-index:' +
      Z +
      ';display:none;' +
      'background:#111;color:#fff;padding:14px 14px 22px;border-top:2px solid #888;' +
      FONT +
      '-webkit-overflow-scrolling:touch',
  )
  var intro = el(
    'div',
    'font-weight:500;margin-bottom:10px',
    'Tap a test, then watch the strip at the very top of the phone (clock, wifi, battery) for ' +
      SECONDS +
      ' seconds. Write down what colour it turns. The screen itself will change colour too — ignore that.',
  )
  sheet.appendChild(intro)
  var env = el('div', 'font-weight:400;font-size:12px;opacity:.7;margin-bottom:10px')
  env.textContent =
    (window.navigator.standalone
      ? 'Opened from the home screen: YES'
      : 'Opened from the home screen: NO — add this site to your home screen and open it from there') +
    ' · ' +
    (/OS (\d+[_\d]*)/.exec(navigator.userAgent) || ['', '?'])[1].replace(/_/g, '.')
  sheet.appendChild(env)
  TESTS.forEach(function (t) {
    var b = el(
      'button',
      'display:block;width:100%;text-align:left;margin:6px 0;padding:11px 12px;border-radius:10px;border:1px solid #666;' +
        'background:#222;color:#fff;' +
        FONT,
      'Test ' + t.n + ' — ' + t.label,
    )
    b.type = 'button'
    b.addEventListener('click', function () {
      run(t)
    })
    sheet.appendChild(b)
  })
  var close = el(
    'button',
    'display:block;width:100%;margin-top:10px;padding:11px 12px;border-radius:10px;border:1px solid #666;background:#444;color:#fff;' +
      FONT,
    'Close',
  )
  close.type = 'button'
  close.addEventListener('click', function () {
    sheet.style.display = 'none'
    launcher.style.display = ''
  })
  sheet.appendChild(close)
  launcher.addEventListener('click', function () {
    launcher.style.display = 'none'
    sheet.style.display = 'block'
  })

  // ── running one test ─────────────────────────────────────────────────────────────────────────
  function run(t) {
    sheet.style.display = 'none'
    var undo = []
    var legend = []
    if (t.paint === 'rainbow') {
      Object.keys(COLORS).forEach(function (k) {
        undo.push(painters[k](COLORS[k][0]))
        legend.push(COLORS[k][1] + ' = ' + NAMES[k])
      })
    } else {
      t.paint.forEach(function (k) {
        undo.push(painters[k]('#ff0000'))
      })
    }
    var dim = null
    if (t.dim) {
      // The app's own popup dim, exactly: a fixed, full-screen, 40% black layer.
      dim = el('div', 'position:fixed;inset:0;z-index:' + (Z + 1) + ';background:rgba(0,0,0,.4)')
      document.body.appendChild(dim)
    }
    var card = el(
      'div',
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:' +
        (Z + 3) +
        ';width:min(86vw,340px);' +
        'background:#111;color:#fff;border:2px solid #888;border-radius:14px;padding:14px;text-align:center;' +
        FONT,
    )
    var title = el('div', 'font-size:16px;margin-bottom:6px', 'Test ' + t.n)
    var what = el(
      'div',
      'font-weight:500;margin-bottom:8px',
      'Look at the status bar. What colour is it?',
    )
    var count = el('div', 'font-size:22px', String(SECONDS))
    card.appendChild(title)
    card.appendChild(what)
    if (legend.length) {
      var lg = el('div', 'text-align:left;font-weight:500;font-size:13px;margin-bottom:8px')
      legend.forEach(function (line) {
        lg.appendChild(el('div', '', line))
      })
      card.appendChild(lg)
    }
    card.appendChild(count)
    document.body.appendChild(card)

    // Read layout once so every change above is committed before the countdown starts.
    void document.body.offsetHeight
    var left = SECONDS
    var timer = setInterval(function () {
      left -= 1
      count.textContent = String(left)
      if (left > 0) return
      clearInterval(timer)
      undo.reverse().forEach(function (u) {
        u()
      })
      if (dim) dim.remove()
      card.remove()
      sheet.style.display = 'block'
    }, 1000)
  }

  var mount = function () {
    document.body.appendChild(launcher)
    document.body.appendChild(sheet)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
})()
