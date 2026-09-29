// @vitest-environment jsdom
//
// HOW TO PLAY — THE PINNED SECTION HEADER (Q9, round 23).
//
// The open section's header sticks under the fixed bar while its content scrolls beneath it, and
// the owner's one requirement shapes every case here: OPENING A SECTION MUST NOT PIN IT. The glide
// seats a tapped header at its natural spot, and the pinned look (the header's progressive shadow,
// its --shade) appears only once content is really under the header — then goes again on the way
// back up. Collapsing from a pinned header keeps it where the finger is.
//
// WHAT JSDOM CANNOT DO, stated plainly: it applies no stylesheet and lays nothing out, so the stick
// itself (position:sticky) cannot happen here. The model stands in for the one number the app reads
// off a stuck header — how far down its own wrapper the pin has carried it (the header's rect top
// minus the wrapper's) — and asks what the app DOES with that number. Whether the browser really
// pins at the bar's underside was measured in Chromium and WebKit at phone size (round 23); the
// feel on a real iPhone stays on-device truth. The stylesheet half is pinned against index.css at
// the bottom of this file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderGuidePage } from './helpers/guideScroller.jsx'
import { installResizeObserver } from './helpers/scrollGeometry.js'

// The pin depth of each section's header, by section id — 0 (its natural spot) unless a case says
// otherwise. Every other element reports a zero rect, so the toggle coordinator sees panels with no
// height and plans no glide of its own: the only scroll writes left are the ones this feature makes.
let depth = {}
let rectSpy = null
beforeEach(() => {
  depth = {}
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const id = this.id?.startsWith('guide-head-') ? this.id.slice('guide-head-'.length) : null
    const top = id ? (depth[id] ?? 0) : 0
    return { height: 0, width: 0, top, left: 0, right: 0, bottom: top, x: 0, y: top }
  })
  // index.css is not loaded, so the ramp distance is stood up at its real value.
  document.documentElement.style.setProperty('--fade-h', '24px')
})
let guide = null
afterEach(() => {
  guide?.restore()
  guide = null
  rectSpy.mockRestore()
  cleanup()
  document.documentElement.style.removeProperty('--fade-h')
})

const mount = () => {
  const view = renderGuidePage()
  guide = view.guide
  return view
}
const header = (container, id) => container.querySelector(`#guide-sec-${id} button`)
const shade = (container, id) => header(container, id).style.getPropertyValue('--shade')
const tap = (container, id) =>
  act(() => {
    fireEvent.click(header(container, id))
  })

describe('the open section’s header pins only once content is under it', () => {
  it('opening a section leaves its header unpinned — the glide seats it, it does not stick it', () => {
    const { container } = mount()
    guide.scrollTo(500)
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('true')
    expect(shade(container, 'stats')).toBe('0.000')
  })

  it('shows the pinned look as content scrolls under it, ramping in, and drops it on the way back', () => {
    const { container } = mount()
    tap(container, 'stats')
    for (const [px, expected] of [
      [6, '0.250'], // 6px of content under a 24px ramp
      [12, '0.500'],
      [24, '1.000'],
      [300, '1.000'], // well past the ramp: clamped, not growing
      [0, '0.000'], // scrolled back to its natural spot: unpinned again
    ]) {
      depth.stats = px
      guide.scrollTo(500 + px)
      expect(shade(container, 'stats')).toBe(expected)
    }
  })

  it('tracks only the OPEN header, and rests one it stops tracking at 0', () => {
    const { container } = mount()
    tap(container, 'stats')
    depth.stats = 30
    guide.scrollTo(530)
    expect(shade(container, 'stats')).toBe('1.000')
    // Every closed header is left alone: it has no room to pin, so nothing is ever written to it
    // and it rests on the stylesheet's --shade:0.
    expect(shade(container, 'overview')).toBe('')
    // Switching sections moves the tracking with it and leaves the old header shadowless.
    tap(container, 'overview')
    expect(shade(container, 'stats')).toBe('0.000')
    expect(shade(container, 'overview')).toBe('0.000')
  })

  it('re-reads on a layout change with no scroll at all — a panel above collapsing, say', () => {
    const ro = installResizeObserver() // BEFORE mount: the tracker builds its observer in an effect
    try {
      const { container } = mount()
      tap(container, 'stats')
      depth.stats = 12
      act(() => ro.resize(guide.contentEl))
      expect(shade(container, 'stats')).toBe('0.500')
    } finally {
      ro.restore()
    }
  })

  it('is the same button, with the same state and name, pinned or not', () => {
    const { container } = mount()
    tap(container, 'stats')
    const before = header(container, 'stats')
    depth.stats = 40
    guide.scrollTo(540)
    const after = header(container, 'stats')
    expect(after).toBe(before)
    expect(after.getAttribute('aria-expanded')).toBe('true')
    expect(after.getAttribute('aria-controls')).toBe('guide-panel-stats')
  })
})

describe('collapsing from a pinned header keeps it under your finger', () => {
  it('steps the page back by exactly the pin depth, before anything else moves it', () => {
    const { container } = mount()
    tap(container, 'stats')
    depth.stats = 140.5
    guide.scrollTo(900)
    guide.clearWrites()
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    // The header's natural spot now sits where the pinned header was, so the fold happens below it.
    expect(guide.writes).toEqual([900 - 140.5])
  })

  it('moves nothing when the section being closed was not pinned', () => {
    const { container } = mount()
    tap(container, 'stats')
    guide.scrollTo(900)
    guide.clearWrites()
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    expect(guide.writes).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE STYLESHEET HALF — the stick itself, which only a browser can perform.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const cssCode = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('index.css — .guide-head', () => {
  const rule = cssCode.match(/\.guide-head\{([^}]*)\}/)?.[1]

  it('sticks at the scroller’s padding edge — the bar’s underside — not a bar lower', () => {
    expect(rule).toBeDefined()
    expect(rule).toContain('position:sticky')
    expect(rule).toMatch(/(^|;)top:0(;|$)/)
  })

  it('is opaque — the panel’s fill over the page — and lifted over the top feather', () => {
    expect(rule).toContain('background:linear-gradient(var(--panel-bg),var(--panel-bg)) var(--bg1)')
    expect(rule).toContain('z-index:1')
  })

  it('rests shadowless — --shade:0 overrides @property’s visible default', () => {
    expect(rule).toContain('--shade:0')
  })

  it('is carried by every header, whose wrapper CLIPS rather than scrolls', () => {
    const { container } = mount()
    const wrappers = [...container.querySelectorAll('[id^="guide-sec-"]')]
    expect(wrappers.length).toBeGreaterThan(10)
    for (const w of wrappers) {
      const classes = w.className.split(' ')
      // overflow-hidden would make the wrapper a scroll container, and the pin would stick to it.
      expect(classes).toContain('overflow-clip')
      expect(classes).not.toContain('overflow-hidden')
      expect(w.querySelector('button').className.split(' ')).toEqual(
        expect.arrayContaining(['guide-head', 'elev-shadow-down']),
      )
    }
  })
})
