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
import { ACCORDION_MS_FLOOR, accordionEase } from '../src/lib/accordionMotion.js'
import { readGuidePlace } from '../src/store/sessionGuide.js'

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
// …and a section given NO header top of its own has its header placed the way the browser's stick
// places it, from the section alone: at its natural spot, or at the line plus whatever `top` the
// app has written on the header (the stylesheet's is 0) when that is lower — and never out of the
// bottom of its own section. `room` is the height of the section under its header: 0 while closed.
const section = (id, natural, room, panelH) => {
  place[id] = { natural, floor: natural + HEAD_H + room, panelH }
}
// A CLOSED section, its header's top at `top`: exactly as tall as its header, with no room to stick.
const closedAt = (id, top) => {
  place[id] = { top, natural: top, floor: top + HEAD_H }
}
const stickTop = (el, sec) =>
  Math.min(Math.max(sec.natural, LINE + (parseFloat(el.style.top) || 0)), sec.floor - HEAD_H)

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
    if (head) {
      const top = head.top ?? stickTop(this, head)
      return rect(top, top + HEAD_H)
    }
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

// ── OPENING A SECTION WHOSE HEADER IS ABOVE THE LINE: THE HEADER'S OWN PLACE ─────────────────────
// Tapped while half under the bar (or opened from the keyboard after the page was scrolled on), the
// header used to be put on the line by the stick the moment its panel had opened far enough to
// give it room — in one frame, ahead of the glide bringing the rest of the section down. It is
// brought down on that glide's clock and curve now, starting from where it stood. The section here
// is placed the way a browser places it (`section`, above), and follows the page the glide moves.
describe('a header tapped above the line is brought down to it, never dropped on it', () => {
  const ABOVE = 30
  const PANEL_H = 400
  const START = 900
  // The section's top edge follows the page: every pixel the glide scrolls back brings it down one.
  const follow = (room = PANEL_H) =>
    section('stats', LINE - ABOVE + (START - guide.pos()), room, PANEL_H)
  const tapAboveTheLine = () => {
    const view = mount()
    guide.setContent(6000)
    guide.scrollTo(START)
    follow(0) // closed: exactly as tall as its header, so there is no room to stick in
    frames = holdFrames(vi)
    guide.clearWrites()
    tap(view.container, 'stats')
    follow() // its panel is open: the stick has room to work in from here on
    return view
  }
  const top = (container) => header(container, 'stats').getBoundingClientRect().top
  const offset = (container) => header(container, 'stats').style.top
  // One frame of the app, and the page it moved.
  const frame = (ms) => {
    act(() => frames.at(ms))
    follow()
  }

  it('is where it was on the frame of the tap, and rides its section down on the glide`s curve', () => {
    const { container } = tapAboveTheLine()
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('true')
    expect(top(container)).toBe(LINE - ABOVE) // the tap moved nothing
    frame(0) // the clock starts here
    expect(top(container)).toBe(LINE - ABOVE)
    let last = LINE - ABOVE
    for (let i = 1; i < 20; i++) {
      frame((FOLD_MS * i) / 20)
      const now = top(container)
      expect(now).toBeCloseTo(LINE - ABOVE * (1 - accordionEase(i / 20)), 9)
      expect(now).toBeCloseTo(place.stats.natural, 9) // on its section's own top edge, every frame
      expect(now).toBeGreaterThanOrEqual(last) // only ever down
      expect(now - last).toBeLessThan(ABOVE / 4) // and no frame is a drop
      last = now
    }
    frame(FOLD_MS)
    expect(top(container)).toBe(LINE) // landed, with its section
    expect(offset(container)).toBe('') // …and back on the stylesheet's own line
    expect(frames.pending()).toBe(0)
  })

  it.each([
    ['exactly on the line', 0],
    ['within the band that counts as on it', 0.3],
    ['below it', -50],
  ])('a header %s is left to the stylesheet`s line', (_where, above) => {
    const { container } = mount()
    guide.setContent(6000)
    guide.scrollTo(START)
    section('stats', LINE - above, 0, PANEL_H)
    frames = holdFrames(vi)
    tap(container, 'stats')
    expect(offset(container)).toBe('')
  })

  it('under Reduce Motion nothing is brought anywhere: the end state at once', () => {
    document.documentElement.style.setProperty('--motion-scale', '0')
    try {
      const { container } = tapAboveTheLine()
      expect(offset(container)).toBe('')
      expect(top(container)).toBe(LINE)
    } finally {
      document.documentElement.style.removeProperty('--motion-scale')
    }
  })

  it('a reader who takes the page over mid-glide stops the page, and the header still comes down', () => {
    const { container } = tapAboveTheLine()
    frame(0)
    frame(FOLD_MS * 0.2)
    const stoppedAt = guide.pos()
    act(() => window.dispatchEvent(new Event('wheel')))
    // The glide is theirs. The header`s own frame is still asked for, and the arrival`s clock`s.
    expect(frames.pending()).toBe(2)
    let last = top(container)
    for (const t of [0.4, 0.6, 0.8]) {
      frame(FOLD_MS * t)
      expect(guide.pos()).toBe(stoppedAt)
      expect(top(container)).toBeCloseTo(LINE - ABOVE * (1 - accordionEase(t)), 9)
      expect(top(container)).toBeGreaterThan(last)
      last = top(container)
    }
    frame(FOLD_MS)
    expect([top(container), offset(container)]).toEqual([LINE, ''])
    expect(frames.pending()).toBe(0)
  })

  it('closed again on the way, it is held where it stands until its panel has folded', () => {
    const { container } = tapAboveTheLine()
    frame(0)
    frame(FOLD_MS * 0.25)
    const stoodAt = top(container)
    const held = offset(container)
    expect(stoodAt).toBeLessThan(LINE - 1) // really still on its way
    tap(container, 'stats')
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    // The fold: the section still has room under its header until the end of it.
    for (const t of [0, 0.5, 0.9]) {
      frame(5000 + FOLD_MS * t)
      expect([top(container), offset(container)]).toEqual([stoodAt, held])
    }
    act(() => frames.at(5000 + FOLD_MS))
    follow(0) // folded: no room left to stick in
    expect([top(container), offset(container)]).toEqual([stoodAt, ''])
    expect(frames.pending()).toBe(0)
  })

  it('swapped out for another section on the way, it is held the same', () => {
    const { container } = tapAboveTheLine()
    frame(0)
    frame(FOLD_MS * 0.25)
    const stoodAt = top(container)
    const held = offset(container)
    expect(held).not.toBe('')
    below('overview', 300)
    tap(container, 'overview')
    expect(offset(container)).toBe(held) // the header left behind
    expect(header(container, 'overview').style.top).toBe('') // the one opened is below the line
    frame(5000)
    frame(5000 + FOLD_MS * 0.5)
    expect([top(container), offset(container)]).toEqual([stoodAt, held])
    act(() => frames.at(5000 + FOLD_MS))
    expect(offset(container)).toBe('')
  })

  it('opened again while it is being held, it sets off from where it stands', () => {
    const { container } = tapAboveTheLine()
    frame(0)
    frame(FOLD_MS * 0.25)
    const stoodAt = top(container)
    tap(container, 'stats') // closed…
    frame(5000)
    frame(5000 + FOLD_MS * 0.5)
    tap(container, 'stats') // …and opened again, half-way through the fold
    expect(top(container)).toBe(stoodAt)
    frame(9000)
    frame(9000 + FOLD_MS * 0.5)
    expect(top(container)).toBeGreaterThan(stoodAt)
    expect(top(container)).toBeLessThan(LINE)
    frame(9000 + FOLD_MS)
    expect(offset(container)).toBe('')
    expect(frames.pending()).toBe(0)
  })

  it('leaving the screen on the way gives it straight back to the stylesheet`s line', () => {
    const view = tapAboveTheLine()
    frame(0)
    frame(FOLD_MS * 0.25)
    const head = header(view.container, 'stats')
    expect(head.style.top).not.toBe('')
    act(() => view.unmount())
    expect(head.style.top).toBe('')
    expect(frames.pending()).toBe(0)
  })
})

// ── OPENING A SECTION WHOSE HEADER IS ABOVE THE LINE: THE SHADOWS ────────────────────────────────
// A header is carried DOWN from its natural spot — which is exactly what "text is under it" looks
// like to the tracker — whenever its section's top is above where the header is drawn. While a
// section opened above the line is on its way down that happens for the length of the glide if a
// section ABOVE it is folding at the same time (the fold runs a frame ahead of the page, so the
// section's top is pulled up past its header), and from the moment a reader takes the page over.
// An opening section must never look pinned: while the glide is in flight the header casts nothing,
// and it is looked at again the moment the glide is over. The header is placed BY HAND here, on the
// line with its section's top above it — the carried picture itself.
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

  // ★ TAKEN OVER MID-GLIDE. The arrival used to END there: the bar's share (and the page's top
  // fade, which is the same number) and the header's shadow were both put where the header's place
  // said, in the frame of the touch. The page has stopped; the section is still arriving.
  it('…and a reader who takes the page over mid-glide changes nothing on that frame: the bar goes on giving it up', () => {
    openAboveTheLine()
    act(() => frames.at(0))
    act(() => frames.at(FOLD_MS * 0.2))
    const before = barKeeps()
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(1)
    act(() => window.dispatchEvent(new Event('wheel')))
    expect(barKeeps()).toBe(before)
    let last = before
    let largestStep = 0
    for (let i = 5; i <= 20; i++) {
      act(() => frames.at((FOLD_MS * i) / 20))
      expect(barKeeps()).toBeLessThanOrEqual(last)
      largestStep = Math.max(largestStep, last - barKeeps())
      last = barKeeps()
    }
    expect(last).toBe(0) // the clock has run out: docked, and the bar keeps none
    expect(largestStep).toBeLessThan(0.25)
    expect(frames.pending()).toBe(0)
  })

  it('once the glide has landed the header answers to its place again', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 0)
    act(() => frames.at(FOLD_MS))
    scrollSo(() => stuck('stats', 40)) // the reader scrolls on: text really is under it now
    expect(shade(container, 'stats')).toBe('1.000')
  })

  it('a reader who takes the page over mid-glide: the header`s shadow comes in over the rest of the clock', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 26)
    act(() => frames.at(FOLD_MS * 0.2))
    expect(shade(container, 'stats')).toBe('0.000')
    act(() => window.dispatchEvent(new Event('wheel'))) // the glide is theirs now: the page stops
    expect(shade(container, 'stats')).toBe('0.000') // …and on that frame nothing else has changed
    let last = 0
    let largestStep = 0
    for (let i = 5; i <= 20; i++) {
      act(() => frames.at((FOLD_MS * i) / 20))
      const now = Number(shade(container, 'stats'))
      expect(now).toBeGreaterThanOrEqual(last)
      // Never more than the bar has given up: one shadow`s worth between the two, on every frame.
      expect(now + barKeeps()).toBeLessThanOrEqual(1.001)
      largestStep = Math.max(largestStep, now - last)
      last = now
    }
    expect(shade(container, 'stats')).toBe('1.000') // the header IS over 26px of its section
    expect(largestStep).toBeLessThan(0.25)
    expect(frames.pending()).toBe(0)
  })

  it('closed again mid-glide, it lets go from exactly what was on screen', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 26)
    act(() => frames.at(FOLD_MS * 0.2))
    const before = barKeeps()
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(1)
    closedAt('stats', LINE - 20) // closed on the way: left part-way under the bar, not on the line
    tap(container, 'stats')
    expect([barKeeps(), shade(container, 'stats')]).toEqual([before, '0.000'])
    act(() => frames.at(5000))
    let last = before
    for (const t of [0.25, 0.5, 0.75]) {
      act(() => frames.at(5000 + FOLD_MS * t))
      expect(barKeeps()).toBeGreaterThanOrEqual(last) // handed back over the fold, from there
      last = barKeeps()
    }
    act(() => frames.at(5000 + FOLD_MS))
    expect([barKeeps(), shade(container, 'stats')]).toEqual([1, '0.000'])
    expect(frames.pending()).toBe(0)
  })

  it('the app going to the background mid-glide ends the arrival: the header answers to its place', () => {
    const { container } = openAboveTheLine()
    act(() => frames.at(0))
    stuck('stats', 26)
    act(() => frames.at(FOLD_MS * 0.2))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    visibility.mockRestore()
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '1.000'])
    expect(frames.pending()).toBe(0)
  })
})

// ── A SECTION CLOSED FROM ITS DOCKED HEADER LEAVES THE HEADER RESTING ON THE LINE ────────────────
// The collapse keeps the header where the finger is: flush under the bar. Nothing is open any more,
// and the bar used to take its whole shadow back — and the page's top fade with it, which is the
// same number — over the header it had just been left against. A header resting on the line is
// still what meets the bar: the bar keeps none while it rests there, takes its shadow back as the
// reader scrolls the header away, and never gives it up again to a header that merely passes.
describe('a section closed with its header on the line leaves the header resting there', () => {
  const closeOnTheLine = () => {
    const view = mount()
    tap(view.container, 'stats')
    scrollSo(() => stuck('stats', 50))
    expect([barKeeps(), shade(view.container, 'stats')]).toEqual([0, '1.000'])
    frames = holdFrames(vi)
    tap(view.container, 'stats')
    return view
  }
  const settle = () => {
    act(() => frames.at(1000))
    act(() => frames.at(1000 + FOLD_MS))
    closedAt('stats', LINE)
  }

  it('the bar keeps none — on the tap, on every frame of the fold, and after it', () => {
    const { container } = closeOnTheLine()
    expect(header(container, 'stats').getAttribute('aria-expanded')).toBe('false')
    expect(barKeeps()).toBe(0)
    act(() => frames.at(1000))
    for (const t of [0.25, 0.5, 0.75, 1]) {
      act(() => frames.at(1000 + FOLD_MS * t))
      expect(barKeeps()).toBe(0)
    }
    expect(frames.pending()).toBe(0)
  })

  it('the header`s own shadow still goes out over the fold, with the text it was cast on', () => {
    const { container } = closeOnTheLine()
    expect(shade(container, 'stats')).toBe('1.000') // the frame of the tap
    act(() => frames.at(1000))
    act(() => frames.at(1000 + FOLD_MS / 4))
    expect(Number(shade(container, 'stats'))).toBeGreaterThan(0)
    expect(Number(shade(container, 'stats'))).toBeLessThan(1)
    act(() => frames.at(1000 + FOLD_MS))
    expect(shade(container, 'stats')).toBe('0.000')
  })

  it('scrolled away, the bar takes its shadow back over the ramp — and a header that then passes the line takes nothing', () => {
    closeOnTheLine()
    settle()
    scrollSo(() => closedAt('stats', LINE - 12.25)) // half the ramp, past the band
    expect(barKeeps()).toBe(0.5)
    scrollSo(() => closedAt('stats', LINE - 6.375))
    expect(barKeeps()).toBe(0.25) // …and back toward it: it is still the header on the line
    scrollSo(() => closedAt('stats', LINE - 40))
    expect(barKeeps()).toBe(1) // a ramp away: gone
    scrollSo(() => closedAt('stats', LINE)) // brought back by a scroll, it is passing by
    expect(barKeeps()).toBe(1)
    scrollSo(() => closedAt('stats', LINE + 5))
    expect(barKeeps()).toBe(1)
  })

  it('opened again from there, nothing at the bar changes', () => {
    const { container } = closeOnTheLine()
    settle()
    stuck('stats', 0)
    tap(container, 'stats')
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '0.000'])
    act(() => frames.at(9000))
    act(() => frames.at(9000 + FOLD_MS))
    expect([barKeeps(), shade(container, 'stats')]).toEqual([0, '0.000'])
  })

  it('opening ANOTHER section hands the bar`s share back over the fold, never in one frame', () => {
    const { container } = closeOnTheLine()
    settle()
    below('overview', 300) // far from the line: by its place, the bar keeps all
    tap(container, 'overview')
    expect(barKeeps()).toBe(0) // the frame of the tap
    act(() => frames.at(9000))
    act(() => frames.at(9000 + FOLD_MS / 4))
    expect(barKeeps()).toBeGreaterThan(0)
    expect(barKeeps()).toBeLessThan(1)
    act(() => frames.at(9000 + FOLD_MS))
    expect(barKeeps()).toBe(1)
    // …and the header left behind is no longer considered: on the line or off it, it takes nothing.
    tap(container, 'overview')
    act(() => frames.at(12000))
    act(() => frames.at(12000 + FOLD_MS))
    scrollSo(() => closedAt('stats', LINE))
    expect(barKeeps()).toBe(1)
  })

  it('a section closed OFF the line leaves nothing resting', () => {
    const { container } = mount()
    tap(container, 'stats')
    scrollSo(() => leaving('stats', 20)) // its foot is carrying it out under the bar
    frames = holdFrames(vi)
    closedAt('stats', LINE - 20)
    tap(container, 'stats')
    act(() => frames.at(1000))
    act(() => frames.at(1000 + FOLD_MS))
    expect(barKeeps()).toBe(1) // cut by the bar`s edge: the bar`s shadow, and the fade, in full
    scrollSo(() => closedAt('stats', LINE))
    expect(barKeeps()).toBe(1)
  })

  it('is parked with the place, for the reload that puts the page back exactly where it was', () => {
    closeOnTheLine()
    settle()
    guide.setPos(316)
    act(() => void window.dispatchEvent(new Event('pagehide')))
    expect(readGuidePlace()).toEqual({ open: null, y: 316, rested: 'stats' })
    // …and not once it has been scrolled away: there is no header on the line to come back to.
    scrollSo(() => closedAt('stats', LINE - 40))
    act(() => void window.dispatchEvent(new Event('pagehide')))
    expect(readGuidePlace()).toEqual({ open: null, y: 317, rested: null })
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
