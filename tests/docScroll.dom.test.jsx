// @vitest-environment jsdom
//
// THE GUIDE'S SCROLLER, AS A MECHANISM — the complete inventory of HOW How to Play scrolls, and
// nothing else. Round 13 replaced that mechanism wholesale, so this file was rewritten wholesale;
// every assertion below is the REPLACEMENT for one that named the shape it superseded.
//
// WHAT CHANGED. Rounds 7-12 stamped data-doc-scroll on <html> for the whole of guide mode, which
// released the app's three scroll clamps (html/body overflow:hidden + the fixed 100dvh #root) and
// made the DOCUMENT the scroller on that one screen. It bought iOS's tap-the-status-bar-to-
// scroll-to-top, which targets the root scroller exclusively. It cost the mode selector's first
// tap while the page was coasting, on the owner's own device, twice. He established the fix
// himself by testing the app's inner scrollers, and accepted the price knowingly: the status-bar
// gesture is GONE on How to Play, permanently, and no substitute is to be built. The guide now
// scrolls #appScroll, the same container every other screen scrolls. The argument in full lives at
// `switchMode` in src/main.tsx.
//
// ★ THE FILENAME IS DELIBERATELY UNCHANGED even though "doc scroll" is exactly what went away.
// The reason is not that anything is frozen — tests/expander.dom, which points here by name for
// two of its own pins, was reopened the moment the move gave GuidePage a required prop its
// standalone renders did not pass. It is that a rename buys nothing a reader does not get from the
// first paragraph, and costs every cross-reference in the suite. Read the name as a fossil and the
// describes below as the truth.
//
// ★ THE BEHAVIOUR the mechanism exists to deliver is pinned in tests/guideScroll.dom, through an
// abstraction that resolves whichever scroller is live — the reading position surviving a mode
// switch and a resume, the accordion seating a tapped panel, the progressive edges. Every case it
// held passed the move UNCHANGED, which is the move's proof; the one case added afterwards is the
// hazard the move itself created (a glide and a mode switch now write the same element). Nothing
// from that file is repeated here; nothing here is a substitute for it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { SCROLLER_CORE_CLASS } from '../src/components/scrollRegion.js'
import { installGuideScroller } from './helpers/guideScroller.jsx'
import { setScrollGeometry } from './helpers/scrollGeometry.js'

// CustomSelect portals into #root, so the harness must provide one (see app-mount.dom).
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// H toggles to/from the guide, K jumps to Classic.
const pressKey = (key) =>
  act(() => {
    fireEvent.keyDown(window, { key })
  })

// The app scroll container — found by the inline paddingTop:var(--bar-h) rather than by its id or
// its classes, so these tests keep working the way they did when the guide rendered this same node
// classless. It is the ONE scroller now, in every mode.
const scrollContainer = (container) =>
  [...container.querySelectorAll('div')].find((d) => d.style.paddingTop === 'var(--bar-h)')

// The guide's own root — the element carrying the display toggle and the panel-gap token.
const guideRoot = (container) =>
  [...container.querySelectorAll('div')].find((d) =>
    d.className.includes('space-y-(--guide-panel-gap)'),
  )

const shade = (el) => Number(el.style.getPropertyValue('--shade'))

const srcFile = (...parts) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', ...parts), 'utf8')

describe('How to Play scrolls the app container — one scroller, every screen', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    document.documentElement.style.setProperty('--fade-h', '24px')
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    document.documentElement.scrollTop = 0
    document.documentElement.style.removeProperty('--fade-h')
  })

  // ── REPLACES: "stamps data-doc-scroll on <html> in guide mode only" ────────────────────────
  it('never unclamps the document — no mode stamps anything on <html>, and the release is gone', () => {
    // The old mechanism's entire footprint outside the app tree was one attribute, so its
    // replacement is the claim that NOTHING is written there any more: the guide is now a change
    // of what a container shows, not a change of what the page is. Asserted twice over — the live
    // DOM across a full round trip, and the source, so a dormant copy of the rule cannot survive.
    const { unmount } = mountApp()
    const html = document.documentElement
    const names = () => [...html.attributes].map((a) => a.name).sort()
    const launch = names()
    expect(launch).not.toContain('data-doc-scroll')
    for (const key of ['H', 'K', 'H']) {
      pressKey(key)
      expect(names()).toEqual(launch)
    }
    unmount()
    expect(names()).toEqual(launch)
    // …and in the source, as DECLARATIONS and CALLS rather than text: both files still discuss the
    // old mechanism at length, and a must-not-appear pin has to read the code, not the prose that
    // explains why the code is gone.
    expect(cssCode).not.toContain('data-doc-scroll')
    expect(srcFile('main.tsx')).not.toMatch(/(?:set|remove|has)Attribute\(\s*'data-doc-scroll'/)
  })

  // ── REPLACES: "is what the behaviour net resolves to today — the document" ─────────────────
  it('is what the behaviour net resolves to today — the app container, not the document', () => {
    // The bridge between the two files, stated once. tests/helpers/guideScroller resolves the
    // guide's scroller by walking up from the guide's root for the shared SCROLLER_CORE_CLASS
    // token; this asserts what that walk finds, so the day it changes it changes HERE and the
    // behaviour net simply keeps passing. The old version of this test asserted 'document'.
    const { container } = mountApp()
    pressKey('H')
    const el = scrollContainer(container)
    expect(el.className).toContain(SCROLLER_CORE_CLASS)
    expect(el.contains(guideRoot(container))).toBe(true)
    const g = installGuideScroller(container)
    expect(g.extentHost).toBe(el)
    g.restore()
  })

  // ── REPLACES: "renders the container clamped in game modes and classless in guide" ─────────
  it('renders the container IDENTICALLY in the guide and in a game mode', () => {
    // The old test's whole point was the difference — an absolute overflow box in the clamped
    // modes, a bare classless flow block in the guide, with the inner wrapper swapping pb-3 for a
    // safe-area-aware padding because document flow had no 100dvh clamp keeping the last panel
    // above the home indicator. The replacement is the opposite claim, and it is stronger: same
    // node, same classes, same padding, both ways.
    const { container } = mountApp()
    const el = scrollContainer(container)
    const clamped = el.className
    const wrapper = el.firstElementChild
    expect(clamped).toContain('absolute')
    expect(clamped).toContain('inset-0')
    expect(clamped).toContain(SCROLLER_CORE_CLASS)
    expect(wrapper.className).toContain('pb-3')
    pressKey('H')
    expect(scrollContainer(container)).toBe(el) // same node, same ref
    expect(el.className).toBe(clamped)
    expect(el.style.paddingTop).toBe('var(--bar-h)')
    expect(el.firstElementChild).toBe(wrapper)
    expect(wrapper.className).toContain('pb-3')
    // The safe-area variant existed ONLY to survive document flow; inside the clamped box it would
    // pad the guide past every sibling screen. (env(safe-area-inset-bottom) itself is still very
    // much alive elsewhere — the settings popover's max-height — so the pin names the dead utility.)
    expect(wrapper.className).not.toContain('safe-area-inset-bottom')
    expect(srcFile('main.tsx')).not.toContain('pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]')
  })

  // ── REPLACES: "zeroes the window scroll BEFORE re-clamping on leave" ───────────────────────
  it('resets that one container on leave, and touches neither the window nor the document', () => {
    // The ordering hazard this replaces is gone with the thing that caused it: there is no
    // re-clamp to race, because nothing was ever unclamped. What remains is the positive claim —
    // the mode switch moves the container and NOTHING else — and the negative one it used to make
    // in passing, that a stray document offset must not be introduced (only a fresh load may zero
    // the root, and that is tests/guideScroll.dom's pageshow pair).
    const { container } = mountApp()
    pressKey('H')
    const el = scrollContainer(container)
    el.scrollTop = 77
    document.documentElement.scrollTop = 310
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    pressKey('K')
    expect(el.scrollTop).toBe(0)
    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(document.documentElement.scrollTop).toBe(310)
    scrollToSpy.mockRestore()
  })

  // ── REPLACES: "takes the reading position from window.scrollY AT the switch" ★ ──────────────
  it('takes the reading position AT the switch — a hidden screen reports 0', () => {
    // ★ THE LOAD-BEARING ONE, and the move made it SHARPER rather than softer. The old version
    // could only state the point indirectly: jsdom lays nothing out, so a document's offset stayed
    // honestly readable after the switch and the test had to move window.scrollY afterwards to
    // force the issue.
    // An inner scroller states it exactly. display:none generates no box, so a hidden element's
    // scrollTop is a flat 0 on every engine — the same 0 a re-clamped document collapsed to, minus
    // the layout that used to hide it. So the getter here reports the real reading position while
    // the guide is on screen and 0 the instant React hides it, which is precisely what a browser
    // does. An implementation that read the position one commit later — from an effect cleanup,
    // the obvious place — captures that 0 and lands the reader at the top.
    // The hidden-reports-0 model is the SHARED one (tests/helpers/guideScroller), not a private
    // copy: it is the same piece of platform fidelity the behaviour net's own cases rest on, and
    // two hand-rolled copies of one platform rule is exactly the drift that rule cannot afford.
    // What this test adds on top is the WRITE LOG, which is mechanism and therefore this file's:
    // the net can only say where the reader ended up, and "ended up at 640" does not distinguish
    // an app that restored 640 from an app that never moved the scroller at all.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuideScroller(container)
    g.setContent(3000)
    g.scrollTo(640)
    g.clearWrites()
    pressKey('K') // leave — the capture has to happen inside this event, before the re-render
    expect(g.writes).toEqual([0]) // the mode switch reset the container it handed over
    // …and for good measure the OTHER way an implementation can cheat: reading the live position
    // back at restore time instead of the number the door saved.
    g.setPos(12345)
    g.clearWrites()
    pressKey('H')
    expect(g.writes).toEqual([640])
    expect(container.querySelector('#guide-sec-overview button')).not.toBeNull()
    g.restore()
  })

  // ── REPLACES: "sources the edge indicators from window scroll AND resize" ──────────────────
  it('sources the edge indicators from the container’s own scroll event — the window feeds nothing', () => {
    // Two claims the behaviour net cannot make, because both are about the mechanism: which event
    // is the source, and that the top strip is handed the SAME number as the bar's shadow — one
    // edge, two surfaces, so they can never disagree. The ramp's arithmetic is the net's, not this
    // file's — so the numbers here are CAPTURED and compared, never restated. The old version
    // asserted the mirror image of the first claim (window scroll AND window resize, read off
    // document.scrollingElement); both of those listeners are gone, and the second half of this
    // test is what proves it rather than assuming it.
    const { container } = mountApp()
    pressKey('H')
    const el = scrollContainer(container)
    const bar = container.querySelector('.htp-sticky-bar')
    const top = container.querySelector('.doc-fade-top')
    setScrollGeometry(el, { scrollTop: 6, scrollHeight: 2000, clientHeight: 768 })
    act(() => {
      fireEvent.scroll(el)
    })
    const nearTheTop = shade(bar)
    expect(nearTheTop).toBeGreaterThan(0) // the container's own event was heard …
    expect(shade(top)).toBe(nearTheTop) // … and both surfaces of that edge got the one number
    // Move the scroller and announce it the two ways the old mechanism listened for. Neither is
    // subscribed any more, so neither may move a boundary.
    setScrollGeometry(el, { scrollTop: 24, scrollHeight: 2000, clientHeight: 768 })
    act(() => {
      fireEvent.scroll(window)
      fireEvent(window, new Event('resize'))
    })
    expect(shade(bar)).toBe(nearTheTop)
    // The container's own event does.
    act(() => {
      fireEvent.scroll(el)
    })
    expect(shade(bar)).toBeGreaterThan(nearTheTop)
    expect(shade(top)).toBe(shade(bar))
  })

  // ── REPLACES: "drives the scroll state from the container — never the document" ────────────
  it('speaks the boolean mask language in a game mode and the progressive one in the guide', () => {
    // The old test proved the clamped modes read their own container and ignored the document.
    // With one scroller that half is trivially true, and what is left is the distinction that
    // actually matters and is easy to lose: the SAME boundary, at the SAME strength, expressed two
    // ways. A game screen gets the fade-scroll-* masks, which are boolean state classes. The guide
    // gets the two fixed strips, which are progressive — and its masks are PINNED OFF, because a
    // feather that snaps on at 4px of overflow painted over one that ramps is round 10 reverted on
    // the one page it was built for. Both languages are driven by the one --shade the bar shows.
    const { container } = mountApp()
    const el = scrollContainer(container)
    const bar = container.querySelector('.htp-sticky-bar')
    const geometry = { scrollTop: 12, scrollHeight: 1500, clientHeight: 700 }
    setScrollGeometry(el, geometry)
    act(() => {
      fireEvent.scroll(el)
    })
    expect(shade(bar)).toBe(0.5) // half the ramp
    expect(el.className).toContain('fade-scroll-both')
    expect(container.querySelector('.doc-fade-top')).toBeNull() // strips are guide-only
    expect(container.querySelector('.doc-fade-bottom')).toBeNull()
    pressKey('H')
    setScrollGeometry(el, geometry) // the identical scroller state, on the other screen
    act(() => {
      fireEvent.scroll(el)
    })
    expect(shade(bar)).toBe(0.5) // same boundary, same strength …
    expect(el.className).not.toMatch(/fade-scroll-/) // … and no mask at all
    expect(shade(container.querySelector('.doc-fade-top'))).toBe(0.5)
    expect(shade(container.querySelector('.doc-fade-bottom'))).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DESKTOP KEYBOARD SCROLLING — a REGRESSION the move had to prevent, not a feature it added.
// A document scroller is the browser's default keyboard scroll target, so Space / PageDown / Home
// / End worked on How to Play for free. An overflow div is not: the keys do nothing until the
// element has focus, and nothing on this page gives it any. So App focuses the container on entry
// to the guide. jsdom implements no key-driven scrolling, so what is pinned here is the whole of
// what the app decides — who has focus, and what that costs everyone else.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the scroll container is the guide’s keyboard target', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('focuses the container on entering the guide, and hands the focus back on the way out', () => {
    // BOTH halves, because the second one is the half that can rot silently. Focus is taken FOR the
    // guide — it is what makes Space/PageDown scroll a reading page — and every other screen is a
    // set of controls where a scroll box holding focus is simply wrong. Left held, it also made the
    // result depend on the door: leaving through the mode menu takes it away as a side effect
    // (CustomSelect returns focus to its trigger), while H, the mode letters and Android Back do
    // not — so one route left every game screen quietly keyboard-scrollable and the other did not.
    const { container } = mountApp() // Classic
    const el = scrollContainer(container)
    expect(document.activeElement).not.toBe(el)
    pressKey('H')
    expect(document.activeElement).toBe(el)
    pressKey('K') // out by the keyboard, the door that has no focus restore of its own
    expect(document.activeElement).not.toBe(el)
  })

  it('is focusable only programmatically — the tab order and the modal traps are untouched', () => {
    // tabIndex −1, not 0, is the whole safety of this. The app binds Tab globally to the mode
    // selector and the four settings modals trap it across `button,input`; a container that joined
    // either set would be a keyboard dead end wearing no label. −1 keeps it reachable by .focus()
    // and by nothing else, which is the standard skip-target shape.
    const { container } = mountApp()
    const el = scrollContainer(container)
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect(el.tabIndex).toBe(-1)
    expect(el.matches('button,input')).toBe(false) // trapModalTab's enumeration
    expect(
      [...container.querySelectorAll('[tabindex]')].filter((n) => n.tabIndex >= 0),
    ).not.toContain(el)
  })

  it('draws no focus ring — the app draws none anywhere, and this one would frame the screen', () => {
    // Not an oversight and not a WCAG hole: a scroll container is not a control, it is never
    // focused by a user gesture, and its "indicator" is the page moving. `outline:none` flatly
    // rather than :focus-visible, so the result cannot depend on an engine's guess about whether a
    // programmatic focus followed a keypress.
    expect(srcFile('index.css')).toContain('#appScroll{outline:none}')
  })
})

// The stylesheet half of the same mechanism: the two rules the move RE-HOSTED (they had been
// scoped to the released document scroller and had to land somewhere real), and the two strips
// that survived it unchanged.
const css = srcFile('index.css')
// The DECLARATIONS only. index.css documents itself heavily, and this round's comments name the
// very rules these pins ban — the four released clamps among them — so a must-NOT-appear assertion
// has to read the code, not the prose that explains its removal. (Same device as guideScroll.dom.)
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')
const ruleBody = (re) => {
  const m = css.match(re)
  expect(m, `index.css: no rule matched ${re}`).not.toBeNull()
  return m[1]
}

describe('index.css — the rules the move re-hosted, and the clamps it made permanent', () => {
  it('hosts the reading line on the scrollport itself, as bar + ONE PANEL GAP', () => {
    // The gap, not the feather (round 9). The fixed bar hides everything above --bar-h, so
    // seating the tapped panel one panel-gap below it lands the bottom edge of the panel above
    // exactly on the bar's underside — out of frame. bar + --fade-h overshot by 24 − 8.46 = 15.5px
    // and left that much of the previous panel showing, which is the bug that fixed.
    // It rode on html[data-doc-scroll] until round 13 and now rides on #appScroll — unconditionally,
    // because the bar is fixed over the top of that scrollport on EVERY screen, so a seat below the
    // bar is a property of the scroller rather than of the guide. scroll-padding-top is what the
    // native focus path honours (tests/expander.dom points here for that).
    const body = ruleBody(/#appScroll\{--seat-top:([^}]*)\}/)
    expect(body).toContain('calc(var(--bar-h) + var(--guide-panel-gap))')
    expect(body).not.toContain('--fade-h')
    expect(body).toContain('scroll-padding-top:var(--seat-top)')
  })

  it('kills overflow-anchor across the guide’s subtree — and no wider', () => {
    // Paired with the scroll writer: the coordinator computes where the scroller must land from
    // pre-animation geometry, and scroll anchoring would move it underneath the writer while the
    // panels grow. It used to be scoped to html[data-doc-scroll] *, i.e. every node in the
    // document; [data-guide] is GuidePage's own root, so the game screens keep native anchoring
    // for their own scrolling. The descendant half is written out rather than left to inheritance,
    // so no engine's reading of "excluded, and its descendants with it" can matter.
    expect(css).toContain('[data-guide],[data-guide] *{overflow-anchor:none}')
    // …and the selector has a subject: the attribute is on GuidePage's root, as an ATTRIBUTE. That
    // it is not folded into the className is what leaves that string the one literal the panel-gap
    // pin in tests/guideScroll.dom reads — which is that file's assertion, not a second copy here.
    expect(srcFile('components', 'GuidePage.tsx')).toContain('data-guide')
  })

  it('clamps html, body and #root unconditionally — nothing releases them in any mode', () => {
    // The release was four rules and a caveat (overscroll-behavior-y had to flip none → contain,
    // because `none` kills iOS ≥16.4's rubber-band outright as well as pull-to-refresh). All five
    // are gone, and the owner's hard no-pull-to-refresh constraint stops being a rule that has to
    // stay right: there is no scrollable root for the gesture to fire from, in any mode.
    expect(cssCode).toContain('html,body{overflow:hidden;overscroll-behavior:none}')
    expect(ruleBody(/#root\{([^}]*)\}/)).toContain('overflow:hidden')
    expect(cssCode).not.toMatch(/overscroll-behavior-y/)
    // The stylesheet declares no vertical scroller at all now; it used to declare exactly one, the
    // guide's. This is the STYLESHEET half of "every scroll region comes from
    // components/scrollRegion" and it is asserted here rather than in tests/scrollRegionGuard
    // because that guard scans markup with utility-shaped patterns and cannot read a CSS
    // declaration (its header argues why it is not being taught to). index.css's scroll story is
    // this file's subject, so the pin belongs to this file.
    expect(cssCode).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/)
  })

  it('feathers the guide’s two fixed strips from the same --fade-h token, with no hardcoded twin', () => {
    for (const re of [/\.doc-fade-top\{([^}]*)\}/, /\.doc-fade-bottom\{([^}]*)\}/]) {
      const body = ruleBody(re)
      expect(body).toContain('var(--fade-h)')
      expect(body).not.toContain('24px')
    }
  })

  it('makes those strips progressive, on the same --shade as the bar’s shadow', () => {
    // Their opacity IS the shade, so "unreached edge" and "invisible strip" are the same fact
    // rather than two that can disagree — which is why they mount for the whole of guide mode
    // instead of appearing and disappearing per edge state, and why they were KEPT across a move
    // that removed their original justification. position:fixed still resolves against the
    // viewport, and #appScroll's box IS the viewport, so the strips sit exactly over its edges.
    for (const re of [/\.doc-fade-top\{([^}]*)\}/, /\.doc-fade-bottom\{([^}]*)\}/])
      expect(ruleBody(re)).toContain('opacity:var(--shade,1)')
  })
})
