// @vitest-environment jsdom
//
// The Lookup history list on the shared scroll-region recipe (round 7). The recipe itself —
// the tokens, the fade truth table, and the no-raw-literals rule — is pinned in
// scrollRegionGuard.test.js; the changelog popup's adoption (structure + live fades) is pinned
// in changelog.dom; the settings popover was already the reference. What's left is Lookup's
// GEOMETRY: the history panel owns py-4 only while every child carries its own px-4, so the
// list's 1rem right padding sits INSIDE the scroller (the text-free lane the iOS scrollbar
// paints in) and the header/method dividers cut edge-to-edge without the older -mx-4
// counter-margins. Content widths are unchanged by construction — only the paint lane moved.
// Round 8 then took the list's fixed pixel cap away and let the column measure itself, so
// the shrink chain is pinned here too. Also here, because this is the file that renders
// LookupCard directly: the round 7 interactive-border pin for the typed date box (the
// describe at the bottom).
// Round 10 (item B) added the third piece: the boundary SHADOWS around this list — the History
// header above it and the Show Codes section below — are progressive, driven by a continuous
// --shade the same hook writes, so nothing about them is a class toggle any more. The arithmetic
// behind that shade is pinned first, as pure functions, because it is the piece that had to have
// exactly one owner: the shadow's strength and the mask's on/off are two readings of one
// measurement, and this file proves they cannot disagree.
// Round 11 then generalized the ship-blocker pinned at the bottom of this file: the STATES it
// hid in — resting, empty, exactly fitting, growing with no scroll event — are named fixtures now
// (tests/helpers/scrollGeometry) swept across every region in tests/scrollExtent.dom, instead of
// being pinned one point test at a time here after each one ships.
// Round 13 added the fourth region and the last describe here: the shared defaults card. It is the
// one region whose reason for existing is a SHORT VIEWPORT rather than long content — the card
// cannot shrink past the fluid root font's floor, so below ~615px of viewport it is a fixed 269.5px
// hanging out of both ends of a scrim that cannot scroll. Nothing pinned that before.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import LookupCard from '../src/components/LookupCard.jsx'
import DefaultsCard from '../src/components/DefaultsCard.jsx'
import { setScrollGeometry } from './helpers/scrollGeometry.js'
import {
  SCROLL_REGION_CLASS,
  BOTTOM_EDGE_BAND_PX,
  scrollEdgeGaps,
  isAtBottom,
  isScrolledFromTop,
  edgeShade,
  readFadeDepthPx,
  readShadeRampPx,
} from '../src/components/scrollRegion.js'

// The saved entry shape (store/progress): the date the user typed and nothing else — every
// rendered string is derived from it (round 8).
const entry = (i) => ({ id: `e${i}`, y: 1592, m: 3, d: i + 1 })

describe('Lookup history on the shared scroll-region recipe (round 7)', () => {
  afterEach(cleanup)

  it('the list wears the shared token; the panel owns vertical padding only', () => {
    const { container } = render(
      <LookupCard history={Array.from({ length: 12 }, (_, i) => entry(i))} />,
    )
    const list = container.querySelector('ul')
    expect(list.className).toContain(SCROLL_REGION_CLASS) // the px-4 lane lives INSIDE the scroller
    const panel = list.parentElement
    // Vertical only — the lane moved inward. A rem top and bottom, the bottom one a pixel less
    // since Round 26: the list carries that pixel as its own end padding, so a last row's bottom
    // border is never left under the list's edge at the end of a scroll (LookupCard says why).
    expect(panel.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['pt-4', 'pb-[calc(var(--spacing)*4_-_1px)]']),
    )
    expect(list.className.split(/\s+/)).toContain('pb-px')
    expect(panel.className.split(/\s+/)).not.toContain('p-4')
  })

  // Round 8 replaced the list's fixed 440-pixel cap with measured layout: the list takes the
  // room the header and method section leave and scrolls past that, at any screen height. The
  // shrink chain is what makes that work, and every link is a class — jsdom lays nothing out, so
  // the classes are the contract. (tests/heightGuard.test.js bans the pixel cap coming back.)
  it('the column can shrink end to end: list gives, the heading and the top card hold', () => {
    const { container } = render(<LookupCard history={[entry(0)]} />)
    const list = container.querySelector('ul')
    expect(list.className).toContain('flex-auto') // takes what's left
    expect(list.className).toContain('min-h-0') // …and is allowed to give it back
    const panel = list.parentElement
    expect(panel.className).toContain('flex flex-col')
    expect(panel.className).toContain('min-h-0') // the panel shrinks; it does NOT grow
    expect(panel.className.split(/\s+/)).not.toContain('flex-auto')
    expect(container.querySelector('.lookup-history-header').className).toContain('shrink-0')
    const root = panel.parentElement
    expect(root.className).toContain('flex flex-col')
    expect(root.className).toContain('min-h-0')
    expect(root.className.split(/\s+/)).not.toContain('mt-1') // would no longer margin-collapse
    // Since round 23 Show Codes lives in the TOP card, which holds its size: opening the codes
    // grows that card, and the history panel below is what gives the room back.
    const topCard = root.firstElementChild
    expect(topCard).not.toBe(panel)
    expect(topCard.className).toContain('shrink-0')
    expect(topCard.contains(container.querySelector('.lookup-method-section'))).toBe(true)
  })

  it('the heading carries its own px-4 lane, with no -mx-4 counter-margin', () => {
    const { container } = render(<LookupCard history={[entry(0)]} />)
    const el = container.querySelector('.lookup-history-header')
    expect(el.className).toContain('px-4')
    expect(el.className).not.toContain('-mx-4')
  })

  it('the empty state keeps the lane padding too', () => {
    render(<LookupCard history={[]} />)
    expect(screen.getByText('No lookups yet').className).toContain('px-4')
  })
})

// ── THE TWO EDGE DISTANCES, AS JS READS THEM ─────────────────────────────────────────────────
// index.css writes both in rem (the fade's depth was the app's one fixed-pixel measure until the
// fades were given one standard), and a custom property reaches JS as the text in the stylesheet —
// so a bare parseFloat would read ".75rem" as three-quarters of a PIXEL: an edge shadow at full
// strength after a hair of scroll, a dragged row let in under the fade. The readers resolve the
// rem against the root's own font size; and they are two readers because the tokens are two
// things (how deep a fade is drawn; how far a scroller travels before an edge is fully asserted).
describe('the fade depth and the shade ramp reach JS in px, whatever unit the stylesheet writes', () => {
  const root = document.documentElement
  afterEach(() => {
    for (const p of ['--fade-h', '--shade-ramp', 'font-size']) root.style.removeProperty(p)
  })

  it('resolves rem against the root font size, and passes px through', () => {
    root.style.setProperty('font-size', '16.5px')
    root.style.setProperty('--fade-h', '.75rem')
    root.style.setProperty('--shade-ramp', '1.5rem')
    expect(readFadeDepthPx()).toBeCloseTo(12.375, 6)
    expect(readShadeRampPx()).toBeCloseTo(24.75, 6)
    root.style.setProperty('--fade-h', '12px')
    root.style.setProperty('--shade-ramp', ' 24px ')
    expect([readFadeDepthPx(), readShadeRampPx()]).toEqual([12, 24])
  })

  it('reads each token and not the other', () => {
    root.style.setProperty('--fade-h', '7px')
    expect(readFadeDepthPx()).toBe(7)
    expect(readShadeRampPx()).toBeNaN()
    root.style.removeProperty('--fade-h')
    root.style.setProperty('--shade-ramp', '9px')
    expect(readShadeRampPx()).toBe(9)
    expect(readFadeDepthPx()).toBeNaN()
  })

  it('answers NaN — "no distance known" — where nothing usable is served', () => {
    expect(readFadeDepthPx()).toBeNaN() // no stylesheet at all
    for (const value of ['2em', '10%', 'calc(1rem + 2px)', 'rem', '']) {
      root.style.setProperty('--shade-ramp', value)
      expect(readShadeRampPx(), value).toBeNaN()
    }
  })

  it('the stylesheet gives both in rem: the fade half as deep as it was, the ramp unchanged', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain(':root{--fade-h:.75rem;--shade-ramp:1.5rem;--fade-reach:0px}')
    // …and each is declared exactly once.
    expect(css.match(/--fade-h:/g)).toHaveLength(1)
    expect(css.match(/--shade-ramp:/g)).toHaveLength(1)
  })
})

describe('the edge arithmetic — ONE owner for both indicator languages (round 10 item B)', () => {
  const RAMP = 24 // --shade-ramp, the app's one "you are near a boundary" distance

  it('collapses both gaps when there is nothing to scroll, with a 1px slack for fractional layout', () => {
    // A region that fits exactly has no edges to signal. Without the slack, a fractional content
    // height against a fractional box height reports a sliver of overflow and paints indicators
    // forever — which for a progressive shadow would mean a permanent faint one.
    expect(scrollEdgeGaps(0, 300, 300)).toEqual({ top: 0, bottom: 0 })
    expect(scrollEdgeGaps(0, 300.6, 300)).toEqual({ top: 0, bottom: 0 })
    expect(scrollEdgeGaps(0, 302, 300)).toEqual({ top: 0, bottom: 2 })
  })

  it('reads iOS rubber-band overscroll as "at the edge" rather than going negative', () => {
    // Bounce hands back a negative scrollTop at the top and a negative remainder at the bottom.
    // Clamped at 0, so the shade sits at rest through the bounce instead of inverting.
    expect(scrollEdgeGaps(-40, 900, 300)).toEqual({ top: 0, bottom: 640 })
    expect(scrollEdgeGaps(660, 900, 300)).toEqual({ top: 660, bottom: 0 })
  })

  it('gives the shadow and the mask ONE answer at the bottom: the dead band ends both', () => {
    // The reviewer's catch, and the reason this is a shared function rather than two expressions.
    // A popover that overflows by 3px is shadowless today because of the band; a progressive rule
    // that measured the bottom independently would have given it a permanent ~12% footer shadow
    // while the bottom MASK — still banded — stayed off. One boundary, two disagreeing answers.
    const almost = scrollEdgeGaps(0, 303, 300) // 3px of overflow, inside the band
    expect(almost.bottom).toBe(3)
    expect(isAtBottom(almost)).toBe(true)
    expect(edgeShade(almost.bottom, BOTTOM_EDGE_BAND_PX, RAMP)).toBe(0)
    // And they turn on together, continuously: at the band edge the ramp is still 0, so there is
    // no step where the mask is off and the shadow has already jumped to a visible value.
    expect(edgeShade(BOTTOM_EDGE_BAND_PX, BOTTOM_EDGE_BAND_PX, RAMP)).toBe(0)
    expect(edgeShade(BOTTOM_EDGE_BAND_PX + 0.0001, BOTTOM_EDGE_BAND_PX, RAMP)).toBeCloseTo(0, 4)
  })

  it('needs no band at the TOP — scrollTop 0 is exact, not a difference of two measurements', () => {
    const gaps = scrollEdgeGaps(0.5, 900, 300)
    expect(isScrolledFromTop(gaps)).toBe(true)
    expect(edgeShade(gaps.top, 0, RAMP)).toBeCloseTo(0.5 / RAMP, 6)
  })

  it('ramps over --shade-ramp and CLAMPS to [0, 1] — never past full, never below nothing', () => {
    expect(edgeShade(0, 0, RAMP)).toBe(0)
    expect(edgeShade(6, 0, RAMP)).toBe(0.25)
    expect(edgeShade(RAMP, 0, RAMP)).toBe(1)
    expect(edgeShade(100000, 0, RAMP)).toBe(1) // clamped, not 4166
    expect(edgeShade(-12, 0, RAMP)).toBe(0)
    // The bottom's ramp spans band → --shade-ramp, so it also reaches exactly 1 at the ramp's end.
    expect(edgeShade(RAMP, BOTTOM_EDGE_BAND_PX, RAMP)).toBe(1)
    expect(edgeShade(14, BOTTOM_EDGE_BAND_PX, RAMP)).toBe(0.5)
  })

  it('degrades to FULL strength, never to none, if the ramp distance is unreadable', () => {
    // parseFloat('') on a stylesheet-less environment. The documented fallback is the
    // pre-round-10 boolean behaviour; a silent zero would be an invisible boundary.
    for (const bad of [NaN, 0, -1]) expect(edgeShade(10, 0, bad)).toBe(1)
    expect(edgeShade(0, 0, NaN)).toBe(0) // …but "at the edge" still means no shadow
  })
})

describe('Lookup’s history list is unframed — its fades alone mark scrolling (round 23)', () => {
  afterEach(cleanup)

  // The list used to be walled off: a divider line + a progressive shadow under the History heading,
  // and another pair above Show Codes at the panel's foot. No other main page frames its scroller
  // like that, and the list's own fades already say "there is more this way", so both are gone.
  const FRAME = ['elev-shadow-down', 'elev-shadow-up', 'border-b', 'border-t']

  it('the History heading is a plain row: no divider line, no shadow, nothing written to it', () => {
    const { container } = render(
      <LookupCard history={Array.from({ length: 12 }, (_, i) => entry(i))} />,
    )
    const heading = container.querySelector('.lookup-history-header')
    for (const cls of FRAME) expect(heading.className.split(/\s+/)).not.toContain(cls)
    expect(heading.style.getPropertyValue('--shade')).toBe('')
    // …and nothing ANYWHERE in the history panel is a boundary surface any more.
    const panel = container.querySelector('ul').parentElement
    for (const el of panel.querySelectorAll('*'))
      expect(el.style.getPropertyValue('--shade')).toBe('')
  })

  it('Show Codes sits in the top card directly under the answer, not at the history panel’s foot', () => {
    const { container } = render(<LookupCard history={[entry(0)]} />)
    const codes = container.querySelector('.lookup-method-section')
    // Its wrapper is a bare name: the full-width button and thin panel the game modes use, no frame.
    expect(codes.className).toBe('lookup-method-section')
    // Directly after the answer slot (the text that invites you to enter a date).
    expect(codes.previousElementSibling.textContent).toBe('Enter a date to see its weekday.')
    expect(container.querySelector('ul').parentElement.contains(codes)).toBe(false)
  })

  it('the list still fades at whichever edge has more, as a state class', () => {
    const { container } = render(
      <LookupCard history={Array.from({ length: 12 }, (_, i) => entry(i))} />,
    )
    const list = container.querySelector('ul')
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => 900 },
      clientHeight: { configurable: true, get: () => 300 },
    })
    list.scrollTop = 12
    act(() => {
      fireEvent.scroll(list)
    })
    expect(list.className).toContain('fade-scroll-both')
    list.scrollTop = 900 - 300 - 3 // inside the dead band: arrived at the bottom
    act(() => {
      fireEvent.scroll(list)
    })
    expect(list.className).toContain('fade-scroll-top')
    expect(list.className).not.toContain('fade-scroll-both')
  })
})

describe('Lookup date input on the interactive-border rule (round 7)', () => {
  afterEach(cleanup)

  it('wears the shared interactive surface (border surface-tray), never the container panel', () => {
    // The rule's Lookup site, mirroring the aox.dom and saveDefaults pins: inputs are controls,
    // so the typed date box carries the same sbtn-bd border tier as the Lookup/Clear buttons
    // beside it — not the fainter container .panel it once borrowed. (Added by the round-7
    // fixer: the round-7 input inventory missed this box.)
    const { container } = render(<LookupCard history={[]} />)
    const input = container.querySelector('input')
    expect(input.className).toContain('border surface-tray')
    expect(input.className).not.toContain('panel')
  })

  it('states its text tier out loud — the page’s primary entry field, not a compact stepper', () => {
    // Round 8: the box kept its larger size only by inheriting the root font, so any future
    // change to an ancestor could have shrunk it silently. text-base is the same rendered size,
    // now declared. (Deliberately NOT the text-sm the compact steppers elsewhere use.)
    const { container } = render(<LookupCard history={[]} />)
    const cls = container.querySelector('input').className.split(/\s+/)
    expect(cls).toContain('text-base')
    expect(cls).not.toContain('text-sm')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The shared defaults card on the same recipe (round 13) — the region a SHORT VIEWPORT creates.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const CARD_PREFS = { aoxN: '12', flashMs: 2000, blitzSec: 60, blitzQSec: 10 }
const noop = () => {}
const defaultsCard = (props) => (
  <DefaultsCard
    cardRef={{ current: null }}
    titleId="defaults-title"
    title="Your saved defaults"
    prefs={CARD_PREFS}
    seed={CARD_PREFS}
    setPrefs={noop}
    onSave={noop}
    {...props}
  />
)
// Found by the shared token rather than by position, so the structure can move without the tests
// quietly measuring a different element.
const scrollerOf = (container) =>
  [...container.querySelectorAll('div')].find((d) => d.className.startsWith(SCROLL_REGION_CLASS))

// THE REPRODUCTION, in the numbers it was measured with (Chromium, see the note at the top of
// components/DefaultsCard). Below ~615px of viewport the fluid root font sits on its 0.75rem
// floor and the card is a fixed 269.5px; at 480×236 CSS px — Chrome at 400% zoom on a maximised
// 1080p window, the level WCAG 2.1 SC 1.4.10 asks to work — the title sat at y −3.8 and Save's
// bottom edge 3.8px below a viewport with no scrollbar and no scroll position. Capped, the same
// card fits in 212px: the header and footer take what they take and the four rows are what gives.
const SHORT_VIEWPORT = { scrollTop: 0, scrollHeight: 172, clientHeight: 88 }

describe('the shared defaults card caps itself against a short viewport (round 13)', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.style.removeProperty('--shade-ramp')
  })

  it('caps against the VIEWPORT in fluid units, and the column is allowed to give', () => {
    const { container } = render(defaultsCard())
    const card = container.querySelector('[role="dialog"]')
    // Viewport-relative and rem-based on purpose: the root font is clamp()-fluid, so a px cushion
    // could not equal the scrim's own 1rem side inset on any two devices
    // (tests/heightGuard.test.js is the standing ban).
    expect(card.className).toContain('max-h-[calc(100dvh_-_2rem)]')
    expect(card.className).toContain('flex flex-col')
    // The scroll recipe's padding rule: the card owns vertical padding only, every child carries
    // its own px-4, so the scroller's 1rem right padding is the lane the scrollbar paints in.
    expect(card.className).toContain('py-4')
    expect(card.className.split(/\s+/)).not.toContain('p-4')
    expect(scrollerOf(container).className).toContain('min-h-0')
  })

  it('the four rows are the part that gives — and they are what the shared region holds', () => {
    // Two claims, and the finder carries the first: scrollerOf resolves by SCROLL_REGION_CLASS, so
    // finding one at all IS "a scroller built from the shared recipe, px-4 lane included". The
    // fades are a live state rather than a fixed class, so they are the test below's, not this
    // one's. What is left here is WHICH content the region holds.
    const { container } = render(defaultsCard())
    const scroller = scrollerOf(container)
    expect(scroller).toBeTruthy()
    for (const label of [
      'MoX Run Length',
      'Flash Speed',
      'Blitz Round Timer',
      'Blitz Question Timer',
    ])
      expect(scroller.contains(screen.getByLabelText(label))).toBe(true)
  })

  it('the chrome the bug put off-screen is OUTSIDE the scroller and holds its size', () => {
    // The whole point of the cap: the button row went past the fold with no way to reach it, so it
    // may never become scroll-to-reach either. Same for the title that names the dialog. (That row
    // was Cancel + Save when the bug was measured; round 22 removed every Cancel in the app, so Save is
    // the whole row now — the claim is about WHERE the row lives, which is unchanged.)
    const { container } = render(defaultsCard())
    const scroller = scrollerOf(container)
    const title = container.querySelector('#defaults-title')
    expect(scroller.contains(title)).toBe(false)
    expect(scroller.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false)
    for (const el of [scroller.previousElementSibling, scroller.nextElementSibling]) {
      expect(el.className).toContain('shrink-0')
      expect(el.className).toContain('px-4')
    }
  })

  it('the two boundaries speak the directional scroll language, not the card’s own lift', () => {
    // The card keeps the FLOATING shadow that says "this surface floats above the page"; a scroll
    // boundary is a different statement and takes the EDGE pair (index.css's three shadow roles
    // argue the distinction out loud). Unconditional classes — strength is the --shade below.
    const { container } = render(defaultsCard())
    const scroller = scrollerOf(container)
    expect(scroller.previousElementSibling.className).toContain('elev-shadow-down')
    expect(scroller.nextElementSibling.className).toContain('elev-shadow-up')
    const card = container.querySelector('[role="dialog"]')
    expect(card.classList.contains('float-shadow')).toBe(true)
    expect(card.style.boxShadow).toBe('') // the class is the whole of it: no literal beside it
  })

  // "The cap is invisible on every ordinary screen" — no mask, both boundaries written to a
  // resting 0 — is NOT asserted here. It is the shared hook's resting contract, proved once
  // against the hook in tests/scrollExtent.dom for all four of its callers; what this file owes is
  // the proof that this card is wired to that hook, which the live-edge test below is.
  it('at the viewport that produced the bug, the rows scroll and each boundary takes its turn', () => {
    document.documentElement.style.setProperty('--shade-ramp', '24px')
    const { container } = render(defaultsCard())
    const scroller = scrollerOf(container)
    const head = scroller.previousElementSibling
    const foot = scroller.nextElementSibling
    setScrollGeometry(scroller, SHORT_VIEWPORT)
    act(() => {
      fireEvent.scroll(scroller)
    })
    // Resting at the top of 84px of unreached content: the bottom fades and the FOOTER asserts.
    expect(scroller.className).toContain('fade-scroll-bottom')
    expect([
      head.style.getPropertyValue('--shade'),
      foot.style.getPropertyValue('--shade'),
    ]).toEqual(['0.000', '1.000'])
    scroller.scrollTop = SHORT_VIEWPORT.scrollHeight - SHORT_VIEWPORT.clientHeight
    act(() => {
      fireEvent.scroll(scroller)
    })
    // At the end, the answer flips whole: the top fades and the HEADER is the live boundary.
    expect(scroller.className).toContain('fade-scroll-top')
    expect(scroller.className).not.toContain('fade-scroll-bottom')
    expect([
      head.style.getPropertyValue('--shade'),
      foot.style.getPropertyValue('--shade'),
    ]).toEqual(['1.000', '0.000'])
  })

  // ★ THE RAMP IS READ WHEN AN EDGE IS PAINTED, NOT WHEN THE REGION STARTED LISTENING. It is
  // written in rem and the root's font size is fluid, so its length in px changes with a rotation
  // or a resize — while the region stays mounted, with the distance it read on the way in.
  it('a ramp that changes under a mounted region is the ramp its next paint uses', () => {
    document.documentElement.style.setProperty('--shade-ramp', '24px')
    const { container } = render(defaultsCard())
    const scroller = scrollerOf(container)
    const head = scroller.previousElementSibling
    setScrollGeometry(scroller, SHORT_VIEWPORT)
    scroller.scrollTop = 12
    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(head.style.getPropertyValue('--shade')).toBe('0.500') // 12px into a 24px ramp
    document.documentElement.style.setProperty('--shade-ramp', '48px') // the screen was turned
    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(head.style.getPropertyValue('--shade')).toBe('0.250')
  })
})

// ── The fade arrives in the frame that shows the scroll (round 24) ───────────────────────────────
// A region's boundary shadow is written straight to the DOM and its fade-mask class is React state.
// The browser dispatches a scroll event in the frame's own rendering steps, just before it paints,
// and React does not render an update made there until a later task — so the fade used to land one
// frame behind the shadow. The watcher now commits inside the event (scrollRegion's
// watchScrollEdges), and that is what these pin: the scroll event is dispatched OUTSIDE act(), as
// the browser dispatches it, and the class must already be right when the dispatch returns.
describe('a scroll region’s fade class is committed inside the scroll event', () => {
  afterEach(cleanup)
  const history = Array.from({ length: 12 }, (_, i) => entry(i))
  const fades = (el) => el.className.split(/\s+/).filter((c) => c.startsWith('fade-scroll-'))

  it('scrolling off the top edge, into the middle, and down to the end', () => {
    const { container } = render(<LookupCard history={history} />)
    const list = container.querySelector('ul')
    act(() => {
      setScrollGeometry(list, { scrollTop: 0, scrollHeight: 1800, clientHeight: 600 })
      list.dispatchEvent(new Event('scroll'))
    })
    expect(fades(list)).toEqual(['fade-scroll-bottom'])
    // From here on: no act(). Each assertion reads the DOM straight after the event returns.
    list.scrollTop = 300
    list.dispatchEvent(new Event('scroll'))
    expect(fades(list)).toEqual(['fade-scroll-both'])
    list.scrollTop = 1200
    list.dispatchEvent(new Event('scroll'))
    expect(fades(list)).toEqual(['fade-scroll-top'])
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll'))
    expect(fades(list)).toEqual(['fade-scroll-bottom'])
  })

  it('a scroll that crosses no boundary commits nothing and changes nothing', () => {
    const { container } = render(<LookupCard history={history} />)
    const list = container.querySelector('ul')
    act(() => {
      setScrollGeometry(list, { scrollTop: 300, scrollHeight: 1800, clientHeight: 600 })
      list.dispatchEvent(new Event('scroll'))
    })
    const before = list.className
    list.scrollTop = 400
    list.dispatchEvent(new Event('scroll'))
    expect(list.className).toBe(before)
  })
})
