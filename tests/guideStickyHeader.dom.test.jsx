// @vitest-environment jsdom
//
// HOW TO PLAY — THE DOCKED SECTION HEADER, AND THE ONE SHADOW.
//
// The open section's header docks flush under the fixed bar while its content scrolls beneath it.
// Three things the owner asked for shape every case here:
//   • ONE DOCKING POSITION. A section you open is brought to rest on the same line its header docks
//     at when you scroll — the bar's underside — not a gap below it.
//   • ONE SHADOW, UNDER WHICHEVER EDGE THE TEXT IS SLIDING BENEATH. While a header is docked the
//     bar's own shadow is off and the header wears it; with no header docked the bar's shadow is
//     its own again. Never both, on any frame.
//   • OPENING A SECTION MUST NOT MAKE IT LOOK PINNED. The header's shadow appears only once text
//     is really under it, and goes again on the way back up. Collapsing from a docked header keeps
//     it where the finger is.
//
// WHAT JSDOM CANNOT DO, stated plainly: it applies no stylesheet and lays nothing out, so the stick
// itself (position:sticky) cannot happen here. The model stands in for what the app reads off the
// screen — the open header's rectangle and its section's — in the three situations a real browser
// produces (below the line, stuck on it, being carried out past it), and asks what the app DOES
// with them. The arithmetic of the hand-off is proved for every position in tests/guideDock; that
// the browser really docks at the bar's underside, and that the two shadows really trade places on
// screen, was measured in Chromium at phone and desktop size. The feel on a real iPhone stays
// on-device truth. The stylesheet half is pinned against index.css at the bottom of this file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderGuidePage } from './helpers/guideScroller.jsx'
import { installResizeObserver, holdFrames } from './helpers/scrollGeometry.js'
import { ACCORDION_MS_FLOOR } from '../src/lib/accordionMotion.js'

// The bar's underside — the docking line — and a header's height. Both arbitrary; the line is
// fractional because a real bar's height is.
const LINE = 71.75
const HEAD_H = 44

// Where each section's header and wrapper are, by section id: { top, natural, floor } in viewport
// y — the header's top, where its top would be with no stick (the wrapper's top), and the wrapper's
// bottom. A section with no entry reports zero rects, like every other element: a header at its
// natural spot at the very top of the viewport, far from the line. The toggle coordinator therefore
// sees panels with no height and plans no glide of its own — the only scroll writes left are the
// ones this feature makes.
let place = {}
// The three situations a browser produces for an OPEN header:
const below = (id, gap) => {
  // not yet docked — the section is still on its way up the page
  place[id] = { top: LINE + gap, natural: LINE + gap, floor: LINE + gap + 2000 }
}
const stuck = (id, depth, room = 2000) => {
  // docked on the line, `depth` px of the section scrolled up under it, `room` px still below it
  place[id] = { top: LINE, natural: LINE - depth, floor: LINE + HEAD_H + room }
}
const leaving = (id, carried) => {
  // the section's foot has arrived and is carrying the header up under the bar
  place[id] = { top: LINE - carried, natural: LINE - 3000, floor: LINE - carried + HEAD_H }
}

let rectSpy = null
beforeEach(() => {
  place = {}
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const rect = (top, bottom) => ({
      height: bottom - top,
      width: 0,
      top,
      left: 0,
      right: 0,
      bottom,
      x: 0,
      y: top,
    })
    const of = (prefix) =>
      this.id?.startsWith(prefix) ? place[this.id.slice(prefix.length)] : null
    const head = of('guide-head-')
    if (head) return rect(head.top, head.top + HEAD_H)
    const sec = of('guide-sec-')
    if (sec) return rect(sec.natural, sec.floor)
    // A section's panel body, for the one group below that needs the toggle to plan a glide: the
    // coordinator only glides for a panel with some height to open.
    const panel = of('guide-panel-')
    if (panel?.panelH) return rect(0, panel.panelH)
    return rect(0, 0)
  })
  // index.css is not loaded, so the ramp distance is stood up at its real value.
  document.documentElement.style.setProperty('--shade-ramp', '24px')
})
let guide = null
// The app's frames, held and run by hand (helpers/scrollGeometry's holdFrames) — set by a test that
// needs to look at one frame of a fold, restored here.
let frames = null
// The fold a tap on a header starts, in a layout-less DOM: both panels measure 0, so it is the
// floor of the accordion's clock (lib/accordionMotion).
const FOLD_MS = ACCORDION_MS_FLOOR
afterEach(() => {
  frames?.restore()
  frames = null
  guide?.restore()
  guide = null
  rectSpy.mockRestore()
  cleanup()
  document.documentElement.style.removeProperty('--shade-ramp')
})

const mount = () => {
  const view = renderGuidePage()
  guide = view.guide
  guide.setSeat(LINE)
  return view
}
const header = (container, id) => container.querySelector(`#guide-sec-${id} button`)
const shade = (container, id) => header(container, id).style.getPropertyValue('--shade')
// The share of its shadow the guide last told the bar to keep.
const barKeeps = () => guide.barYields.at(-1)
const tap = (container, id) =>
  act(() => {
    fireEvent.click(header(container, id))
  })
// Put the open header somewhere and let the app see it, the way a scroll does.
const scrollSo = (arrange) => {
  arrange()
  guide.scrollTo(guide.pos() + 1)
}

describe('the open section’s header wears a shadow only once text is under it', () => {
  it('opening a section leaves its header shadowless — it docks, it does not look pinned', () => {
    const { container } = mount()
    guide.scrollTo(500)
    stuck('stats', 0) // glided flush onto the line, nothing under it yet
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('true')
    expect(shade(container, 'stats')).toBe('0.000')
  })

  it('casts nothing for the fraction of a pixel a whole-pixel landing can carry it', () => {
    const { container } = mount()
    stuck('stats', 0.6)
    tap(container, 'stats')
    expect(shade(container, 'stats')).toBe('0.000')
  })

  it('ramps its shadow in as text scrolls under it, and drops it on the way back', () => {
    const { container } = mount()
    tap(container, 'stats')
    for (const [depth, expected] of [
      [1, '0.000'], // the settle pixel: still nothing under it
      [12.5, '0.500'], // halfway up the 24px ramp, past that pixel
      [24, '1.000'],
      [300, '1.000'], // well past the ramp: clamped, not growing
      [0, '0.000'], // scrolled back to its natural spot: nothing under it again
    ]) {
      scrollSo(() => stuck('stats', depth))
      expect(shade(container, 'stats')).toBe(expected)
    }
  })

  it('fades its shadow out over the section’s last stretch, as the foot arrives', () => {
    const { container } = mount()
    tap(container, 'stats')
    for (const [room, expected] of [
      [200, '1.000'],
      [24, '1.000'],
      [12, '0.500'],
      [0, '0.000'], // nothing of the section left below the header to cast a shadow on
    ]) {
      scrollSo(() => stuck('stats', 900, room))
      expect(shade(container, 'stats')).toBe(expected)
    }
  })

  it('tracks only the OPEN header, and rests one it stops tracking at 0', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 30))
    expect(shade(container, 'stats')).toBe('1.000')
    // Every closed header is left alone: it has no room to dock, so nothing is ever written to it
    // and it rests on the stylesheet's --shade:0.
    expect(shade(container, 'overview')).toBe('')
    // Switching sections moves the tracking with it and leaves the old header shadowless — once
    // its panel has folded away (the release, below; here the fold is simply run to its end).
    frames = holdFrames(vi)
    tap(container, 'overview')
    expect(shade(container, 'overview')).toBe('0.000')
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS))
    expect(shade(container, 'stats')).toBe('0.000')
    expect(frames.pending()).toBe(0)
  })

  it('re-reads on a layout change with no scroll at all — a panel above collapsing, say', () => {
    const ro = installResizeObserver() // BEFORE mount: the tracker builds its observer in an effect
    try {
      const { container } = mount()
      tap(container, 'stats')
      stuck('stats', 12.5)
      act(() => ro.resize(guide.contentEl))
      expect(shade(container, 'stats')).toBe('0.500')
      expect(barKeeps()).toBe(0)
    } finally {
      ro.restore()
    }
  })

  it('is the same button, with the same state and name, docked or not', () => {
    const { container } = mount()
    tap(container, 'stats')
    const before = header(container, 'stats')
    scrollSo(() => stuck('stats', 40))
    const after = header(container, 'stats')
    expect(after).toBe(before)
    expect(after.getAttribute('aria-expanded')).toBe('true')
    expect(after.getAttribute('aria-controls')).toBe('guide-panel-stats')
  })
})

describe('one shadow: the bar gives its own up while a header is docked against it', () => {
  it('with no section open, the bar keeps all of its shadow', () => {
    mount()
    guide.scrollTo(600)
    expect(guide.barYields.every((share) => share === 1)).toBe(true)
  })

  it('an open header far from the line leaves the bar’s shadow alone', () => {
    const { container } = mount()
    below('stats', 300)
    tap(container, 'stats')
    expect(barKeeps()).toBe(1)
    expect(shade(container, 'stats')).toBe('0.000')
  })

  it('the bar’s shadow fades out as the header comes up to dock, and is off once it has', () => {
    const { container } = mount()
    below('stats', 300)
    tap(container, 'stats')
    for (const [gap, keeps] of [
      [24.5, 1], // a ramp's length away (past the half-pixel that counts as ON the line)
      [12.5, 12 / 23.5],
      [0.5, 0],
      [0, 0],
    ]) {
      scrollSo(() => below('stats', gap))
      expect(barKeeps()).toBeCloseTo(keeps, 6)
      expect(shade(container, 'stats')).toBe('0.000') // not docked: the header wears nothing
    }
  })

  it('docked, the bar keeps none — whether or not text is under the header yet', () => {
    const { container } = mount()
    tap(container, 'stats')
    for (const depth of [0, 0.6, 5, 24, 800]) {
      scrollSo(() => stuck('stats', depth))
      expect(barKeeps()).toBe(0)
    }
  })

  it('the bar’s shadow comes back as a finished section carries its header out under the bar', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 900, 0))
    expect(barKeeps()).toBe(0)
    for (const [carried, keeps] of [
      [12.5, 12 / 23.5],
      [24.5, 1],
      [44, 1], // the header is wholly behind the bar now
    ]) {
      scrollSo(() => leaving('stats', carried))
      expect(barKeeps()).toBeCloseTo(keeps, 6)
      expect(shade(container, 'stats')).toBe('0.000') // nothing left under it to shade
    }
  })

  it('NEVER BOTH: on no frame of a whole scroll through a section are the two shadows on together', () => {
    const { container } = mount()
    below('stats', 400)
    tap(container, 'stats')
    const frames = [
      ...Array.from({ length: 81 }, (_, i) => () => below('stats', 40 - i * 0.5)), // coming up to dock
      ...Array.from({ length: 80 }, (_, i) => () => stuck('stats', i * 0.75, 600 - i * 0.75)), // reading
      ...Array.from({ length: 81 }, (_, i) => () => stuck('stats', 900, 40 - i * 0.5)), // the last stretch
      ...Array.from({ length: 81 }, (_, i) => () => leaving('stats', i * 0.5)), // carried out
    ]
    let sawHeader = false
    let sawBar = false
    for (const arrange of frames) {
      scrollSo(arrange)
      const headerOn = Number(shade(container, 'stats')) > 0
      const barOn = barKeeps() > 0
      expect(headerOn && barOn).toBe(false)
      sawHeader ||= headerOn
      sawBar ||= barOn
    }
    // …and the sweep really did pass through both states, so the case is not vacuous.
    expect(sawHeader).toBe(true)
    expect(sawBar).toBe(true)
  })

  // ── THE HAND-BACK TAKES THE LENGTH OF THE FOLD, NOT ONE FRAME ────────────────────────────────
  // Closing a section from its docked header used to give the bar its whole shadow, and take the
  // header's away, in the frame of the tap — while the panel under the header took a third of a
  // second to fold. Now both ride the fold: on the tap's own frame nothing has changed, and each
  // frame after hands a little more of it back.
  it('closing a docked section hands the bar its shadow back over the fold, never in one frame', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 50))
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    frames = holdFrames(vi)
    place = {} // the collapse puts the header back at its natural spot
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    // The frame of the tap: exactly what was on screen before it.
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    act(() => frames.at(1000)) // the fold's first frame — its clock starts here
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    // Part-way: both are in between, and they add up — what the header has let go of, the bar has.
    act(() => frames.at(1000 + FOLD_MS / 4))
    const mid = barKeeps()
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(Number(shade(container, 'stats'))).toBeCloseTo(1 - mid, 3)
    // Every later frame gives the bar more, never less.
    let last = mid
    for (const t of [0.4, 0.6, 0.8]) {
      act(() => frames.at(1000 + FOLD_MS * t))
      expect(barKeeps()).toBeGreaterThanOrEqual(last)
      last = barKeeps()
    }
    act(() => frames.at(1000 + FOLD_MS))
    expect([barKeeps(), shade(container, 'stats')]).toEqual([1, '0.000'])
    expect(frames.pending()).toBe(0) // and it stops asking for frames
  })

  it('switching to another section does the same for the header left behind, under the new one`s rule', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 50))
    frames = holdFrames(vi)
    below('overview', 300) // the section being opened is far from the line: by place, the bar keeps all
    tap(container, 'overview')
    // …but the bar's share is still held by the header that is letting go: no jump on the tap.
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    expect(shade(container, 'overview')).toBe('0.000')
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS / 4))
    expect(barKeeps()).toBeGreaterThan(0)
    expect(barKeeps()).toBeLessThan(1)
    act(() => frames.at(FOLD_MS))
    expect([barKeeps(), shade(container, 'stats')]).toEqual([1, '0.000'])
    // The bar is never told MORE than the open header's place allows: dock the new one mid-fold.
    tap(container, 'overview') // close it again…
    act(() => frames.at(2000))
    act(() => frames.at(2000 + FOLD_MS))
    stuck('stats', 0)
    tap(container, 'stats') // …and reopen stats, docked
    expect(barKeeps()).toBe(0)
  })

  it('opening the very section that is still letting go takes its shadow straight back', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 50))
    frames = holdFrames(vi)
    tap(container, 'stats') // close…
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS / 4)) // …part-way through the fold…
    tap(container, 'stats') // …open again: it is docked with text under it, as before
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    act(() => frames.at(FOLD_MS)) // the abandoned release writes nothing more
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
  })

  it('leaving the screen mid-fold puts both at rest at once', () => {
    const view = mount()
    const { container } = view
    tap(container, 'stats')
    scrollSo(() => stuck('stats', 50))
    frames = holdFrames(vi)
    tap(container, 'stats')
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS / 4))
    expect(barKeeps()).toBeLessThan(1)
    act(() => view.unmount())
    expect(barKeeps()).toBe(1)
    expect(frames.pending()).toBe(0)
  })
})

// ── OPENING A SECTION WHOSE HEADER IS ABOVE THE LINE ─────────────────────────────────────────────
// Tapped while half under the bar (or opened from the keyboard), the header is put on the line at
// once by the stick — carried DOWN from its natural spot, which is exactly what "text is under it"
// looks like to the tracker. It lit the header's shadow for the length of the glide that brings the
// section down to meet it. An opening section must never look pinned: while that glide is in flight
// the header casts nothing, and it is looked at again the moment the glide is over.
describe('a section opened with its header above the line shows no shadow while it glides into place', () => {
  const openAboveTheLine = () => {
    const view = mount()
    guide.setContent(6000)
    guide.scrollTo(900)
    stuck('stats', 30) // its natural spot is 30px above the line
    place.stats.panelH = 400 // …and it has a panel to open, so the toggle glides it to the line
    frames = holdFrames(vi)
    guide.clearWrites()
    tap(view.container, 'stats')
    return view
  }

  it('no header shadow on the tap, nor on any frame of the glide', () => {
    const { container } = openAboveTheLine()
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('true')
    expect(frames.pending()).toBeGreaterThan(0) // a glide really is in flight
    expect(shade(container, 'stats')).toBe('0.000')
    act(() => frames.at(0))
    for (const [t, depth] of [
      [0.25, 22],
      [0.5, 12],
      [0.75, 4],
    ]) {
      stuck('stats', depth)
      act(() => frames.at(FOLD_MS * t))
      expect(shade(container, 'stats')).toBe('0.000')
    }
    expect(guide.writes.length).toBeGreaterThan(0) // …and the glide really moved the page
    stuck('stats', 0)
    act(() => frames.at(FOLD_MS))
    expect(shade(container, 'stats')).toBe('0.000') // landed: nothing under it
    expect(frames.pending()).toBe(0)
  })

  // ★ THE BAR'S HALF. The stick has the header on the line in the frame of the tap, where by place
  // alone the bar keeps nothing — so the bar's shadow, in full on a scrolled page, went out in ONE
  // frame while the section took a third of a second to arrive. It rides the glide now.
  it('the bar gives its shadow up over the glide, never in one frame', () => {
    openAboveTheLine()
    expect(barKeeps()).toBe(1) // the frame of the tap: exactly what was on screen before it
    act(() => frames.at(0)) // the glide's first frame — its clock starts here
    expect(barKeeps()).toBe(1)
    let last = 1
    let largestStep = 0
    for (let i = 1; i <= 20; i++) {
      act(() => frames.at((FOLD_MS * i) / 20))
      const now = barKeeps()
      expect(now).toBeLessThanOrEqual(last) // every frame gives a little more up, never any back
      largestStep = Math.max(largestStep, last - now)
      last = now
    }
    expect(last).toBe(0) // landed: docked, and the bar keeps none
    expect(largestStep).toBeLessThan(0.25)
    expect(frames.pending()).toBe(0)
  })

  it('…and a reader who takes the page over mid-glide ends it: the bar keeps what its place says', () => {
    openAboveTheLine()
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS * 0.2))
    expect(barKeeps()).toBeGreaterThan(0)
    expect(barKeeps()).toBeLessThan(1)
    act(() => window.dispatchEvent(new Event('wheel')))
    expect(barKeeps()).toBe(0) // the header is docked — and wears the shadow itself now
  })

  it('once the glide has landed the header answers to its place again', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 0)
    act(() => frames.at(FOLD_MS))
    scrollSo(() => stuck('stats', 40)) // the reader scrolls on: text really is under it now
    expect(shade(container, 'stats')).toBe('1.000')
  })

  it('a reader who takes the page over mid-glide gets the truth at once', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 26)
    act(() => frames.at(FOLD_MS * 0.2))
    expect(shade(container, 'stats')).toBe('0.000')
    act(() => window.dispatchEvent(new Event('wheel'))) // the glide is theirs now: it stops
    expect(shade(container, 'stats')).toBe('1.000') // the header IS over 26px of its section
    expect(frames.pending()).toBe(0)
  })
})

describe('collapsing from a docked header keeps it under your finger', () => {
  it('steps the page back by exactly the pin depth, before anything else moves it', () => {
    const { container } = mount()
    tap(container, 'stats')
    stuck('stats', 140.5)
    guide.scrollTo(900)
    guide.clearWrites()
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    // The header's natural spot now sits where the docked header was, so the fold happens below it.
    expect(guide.writes).toEqual([900 - 140.5])
  })

  it('moves nothing when the section being closed had nothing scrolled under its header', () => {
    const { container } = mount()
    tap(container, 'stats')
    stuck('stats', 0)
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

  it('is opaque — the panel’s fill over the page', () => {
    expect(rule).toContain('background:linear-gradient(var(--panel-bg),var(--panel-bg)) var(--bg1)')
  })

  // ★ NO HEADER IS LIFTED OVER A FEATHER, AND THE DOCKED ONE IS NOT SPARED BY STACKING. The order
  // is one line, the same for every header and in every engine: section content < header (1) <
  // the guide's two fades (2). A header that is not docked is page content, and its title feathers
  // at the edges like the panel border beside it.
  // The DOCKED header is spared for a different reason altogether: the top feather is OFF while a
  // header is docked — the bar hands it over with its shadow (tests/docScroll pins that on the
  // mounted app). The OPEN header used to be lifted over the top strip instead (a z-index on
  // [aria-expanded="true"], the strip left at none), which one browser engine honoured and another
  // did not: on an iPhone the fade bled into the top of the docked header. So no rule may single
  // the open header out again, and no strip may sit under any header.
  it('lifts no header over either feather — a docked header is spared by the hand-off, not by stacking', () => {
    expect(rule).toMatch(/(^|;)z-index:1(;|$)/) // over its own section's content, and no higher
    // …and that is the only stacking any header has: nothing keyed to open, docked, or anything.
    expect(cssCode.match(/\.guide-head[^{}]*\{[^}]*z-index/g)).toHaveLength(1)
    for (const strip of ['top', 'bottom'])
      expect(cssCode.match(new RegExp(`\\.doc-fade-${strip}\\{([^}]*)\\}`))?.[1]).toContain(
        'z-index:2',
      )
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
