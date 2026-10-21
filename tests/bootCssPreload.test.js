// The boot-splash first-paint unblock (vite.config.js swapBlockingStylesheet / bootCssPreload):
// Vite injects the bundled stylesheet as a render-blocking <link rel="stylesheet">, which blocks
// the whole document's first paint — including the inline-styled #boot splash built to cover that
// exact wait. The build transform must rewrite it into a self-swapping preload that signals the app
// (window.__cssReady + 'app-css-ready') and keep a <noscript> blocking copy, WITHOUT hardcoding the
// hashed filename and under any base (both sites use '/'; nothing in it may assume so). Driven here on
// representative built HTML (the real dist output shape, hashed names varied).
import { describe, it, expect } from 'vitest'
import { swapBlockingStylesheet } from '../vite.config.js'

const built = (base) => `<!doctype html>
<html lang="en">
<head>
  <link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
  <script type="module" crossorigin src="${base}assets/index-B7fJx2sQ.js"></script>
  <link rel="stylesheet" crossorigin href="${base}assets/index-w_CPcP2Q.css">
</head>
<body></body>
</html>`

describe('swapBlockingStylesheet (vite bootCssPreload transform)', () => {
  it('rewrites the injected blocking stylesheet to a preload-swap, preserving crossorigin + href', () => {
    const out = swapBlockingStylesheet(built('/'))
    expect(out).toContain(
      '<link rel="preload" as="style" crossorigin href="/assets/index-w_CPcP2Q.css"',
    )
    // The swap applies the stylesheet and signals the app — on load AND on error (a failed
    // stylesheet must surface the unstyled app, not an eternal splash).
    expect(out).toContain("this.rel='stylesheet'")
    expect(out).toContain('window.__cssReady=true')
    expect(out.match(/app-css-ready/g)).toHaveLength(2) // onload + onerror
  })

  it('keeps a <noscript> copy of the original blocking link (no-JS stays styled)', () => {
    const out = swapBlockingStylesheet(built('/'))
    expect(out).toContain(
      '<noscript><link rel="stylesheet" crossorigin href="/assets/index-w_CPcP2Q.css"></noscript>',
    )
  })

  it('leaves NO bare render-blocking stylesheet link outside the <noscript> fallback', () => {
    const out = swapBlockingStylesheet(built('/'))
    const outsideNoscript = out.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
    expect(outsideNoscript).not.toContain('rel="stylesheet"')
  })

  it('is base-agnostic: a non-root href passes through untouched', () => {
    const out = swapBlockingStylesheet(built('/sub/'))
    expect(out).toContain(
      '<link rel="preload" as="style" crossorigin href="/sub/assets/index-w_CPcP2Q.css"',
    )
    expect(out).toContain(
      '<noscript><link rel="stylesheet" crossorigin href="/sub/assets/index-w_CPcP2Q.css"></noscript>',
    )
  })

  it('touches nothing else — icon links and the module script are byte-identical', () => {
    const out = swapBlockingStylesheet(built('/'))
    expect(out).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">')
    expect(out).toContain(
      '<script type="module" crossorigin src="/assets/index-B7fJx2sQ.js"></script>',
    )
  })
})
