// @vitest-environment jsdom
//
// HOW TO PLAY — THE SCROLL BEHAVIOUR NET. ⚠ NOTHING IN THIS FILE MAY NAME THE MECHANISM.
//
// The guide is the app's one long reading page. Until round 13 it was also the only screen that did
// not scroll an inner box — <html data-doc-scroll> released the app's three clamps and the DOCUMENT
// scrolled it — and it now scrolls #appScroll like every other screen.
//
// Rule 10 says a restructuring of live logic happens behind tests written FIRST, against the app as
// a black box, that stay valid on BOTH sides of the change. A test that read window.scrollY,
// document.scrollingElement or the attribute would have failed that test of a test: every assertion
// would have needed rewriting on the far side, and a net you rewrite proves nothing. So every
// question this file asks goes through tests/helpers/guideScroller — "where is the reader", "how
// much content is there", "how strong is each edge", "what has the app written" — and that helper
// RESOLVES the live scroller rather than assuming one, by walking up from the guide's own root for
// the shared overflow token.
//
// ★ THE GATE WAS MET: every case here passed the move UNCHANGED, all 34 of them, which is the
// move's proof and is banked in the history (git diff cd10065..8197fa5). One case has been ADDED
// since — the glide-versus-mode-switch ordering, a hazard the move created by giving the two
// writers the same element, which no pre-move test could have had a reason to ask about. Anything
// that depends on WHICH element scrolls still lives in tests/docScroll.dom.test.jsx instead, the
// complete inventory of the mechanism.
//
// WHAT JSDOM CANNOT DO, stated plainly: it lays nothing out, so the scroller's three numbers are
// supplied by the model and rAF is driven by hand. This is a test of the app's decisions — where
// the reader is put, what the coordinator targets, what each boundary is told — never of real
// layout. The FEEL (a real status-bar tap, rubber-band, a 60fps glide) stays on-device truth.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { usePresets, makePresetRegistryDefaults } from '../src/store/presets.js'
import { createPreset, switchPreset } from '../src/store/presetControl.js'
import { installGuideScroller } from './helpers/guideScroller.jsx'
import { installResizeObserver } from './helpers/scrollGeometry.js'

// CustomSelect and the Save Defaults popup portal into #root, so the harness must provide one.
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// Keyboard mode switching, the same lever the other mode tests use: H toggles to/from the guide,
// K jumps to Classic, F to Flash.
const pressKey = (key) =>
  act(() => {
    fireEvent.keyDown(window, { key })
  })

// The app's main scroll container — the div carrying the inline paddingTop:var(--bar-h). Used only
// by the CLAMPED-mode tests below, where it is the game screens' own scroll box; the guide's
// scroller is never reached this way (that is the helper's job).
const scrollContainer = (container) =>
  [...container.querySelectorAll('div')].find((d) => d.style.paddingTop === 'var(--bar-h)')

// A backgrounding round trip. jsdom always reports 'visible', so the state is overridden for the
// duration of each event (the afterEach deletes the own property, restoring the prototype getter).
// Deliberately WITHOUT a pageshow — foregrounding is not a navigation, and the distinction between
// the two is the whole point of the tests below.
function resumeFromBackground() {
  for (const state of ['hidden', 'visible']) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    act(() => {
      fireEvent(document, new Event('visibilitychange'))
    })
  }
}

// A pageshow with an explicit `persisted` flag: false = a genuine (re)load, true = a
// back-forward-cache restore. jsdom implements no PageTransitionEvent, and a plain Event leaves
// `persisted` undefined — which reads as false and would make the restore case pass for the wrong
// reason — so the flag is defined on the event object itself.
function pageShowEvent(persisted) {
  const ev = new Event('pageshow')
  Object.defineProperty(ev, 'persisted', { value: persisted })
  return ev
}

// rAF under manual control, so "mid-glide" is an exact moment rather than a timing race. ids are
// 1-based indices into `frames`, so cancelling nulls its slot. Install AFTER mounting and entering
// the guide, so the boot's own frames run for real.
const manualFrames = () => {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    frames[id - 1] = null
  })
  return frames
}

// Every element reports height h and top 0 unless `taller` claims it. jsdom runs no layout, so the
// coordinator's panel measurements have to be supplied; a plain function so `this` is the measured
// element. Restored by the afterEach.
let rectSpy = null
const mockRects = (taller) => {
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const height = taller(this)
    return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 }
  })
}

const tap = (container, id) =>
  act(() => {
    fireEvent.click(container.querySelector(`#guide-sec-${id} button`))
  })

let guide = null
const installGuide = (container) => {
  guide = installGuideScroller(container)
  return guide
}

beforeEach(() => {
  localStorage.clear()
  useSettings.getState().resetToFactory()
  // index.css is not loaded here, so the ramp distance the shade writer reads is stood up by hand
  // at its real value. Without it the ramp degrades to the boolean — the documented fallback, and
  // what the one test that clears it checks.
  document.documentElement.style.setProperty('--fade-h', '24px')
})
afterEach(() => {
  guide?.restore()
  guide = null
  rectSpy?.mockRestore()
  rectSpy = null
  vi.unstubAllGlobals()
  cleanup()
  document.getElementById('root')?.remove()
  delete document.visibilityState
  document.documentElement.scrollTop = 0
  // --seat-top is NOT in this list, deliberately: the model writes it on the scroll box alone (the
  // element the app reads it from), which dies with the tree cleanup() takes down.
  for (const prop of ['--fade-h', '--bar-h', '--motion-scale'])
    document.documentElement.style.removeProperty(prop)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE READING POSITION. The owner asked for this in round 9 and reversed his own round-8 spec to
// get it, which makes it the highest-value thing in the net.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the guide remembers where you were reading', () => {
  it('keeps the reader’s place through a detour into a game mode', () => {
    // ⚠ WHY THIS IS DISCRIMINATING, and not merely a formality. The model reports 0 for a scroller
    // whose screen is off — which is the platform's own behaviour: a display:none element has no
    // layout, and a document whose clamps have just come back has collapsed to a screenful and
    // clamped its offset. So the position CANNOT be read after React has hidden the guide; it has
    // to be taken synchronously, inside the event that changes the mode. An implementation that
    // read it one commit later — from an effect cleanup, the obvious place — would capture the 0
    // asserted in the middle of this test and land the reader at the top on the way back.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(640)
    expect(g.pos()).toBe(640)
    pressKey('K')
    expect(g.pos()).toBe(0) // off screen: nothing to report
    pressKey('H')
    expect(g.pos()).toBe(640)
  })

  it('keeps the open panel through that same detour', () => {
    const { container } = mountApp()
    pressKey('H')
    const header = container.querySelector('#guide-sec-overview button')
    tap(container, 'overview')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    pressKey('K')
    expect(container.querySelector('#guide-sec-overview button')).toBe(header) // same node
    pressKey('H')
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens at the top on a FRESH app instance, whatever the scroller was left holding', () => {
    // Nothing here is enforced by a guard: the app never stores which mode you were in, the
    // reading position lives in a per-instance ref, and the open panel lives in GuidePage's own
    // state — so a refresh, a cold start or an update reload gets all three back at launch values.
    // The scroller is deliberately left sitting at 400 when the second instance takes it over (a
    // reload's history scroll restoration does exactly that), so "opens at the top" has to be an
    // act rather than an accident.
    const first = mountApp()
    pressKey('H')
    const g = installGuide(first.container)
    g.setContent(3000)
    g.scrollTo(400)
    tap(first.container, 'overview')
    pressKey('K') // this instance now remembers 400
    first.unmount()
    document.getElementById('root').remove()
    const { container } = mountApp()
    g.retarget(container)
    g.setPos(400)
    pressKey('H')
    expect(g.pos()).toBe(0)
    const headers = [...container.querySelectorAll('[aria-controls^="guide-panel-"]')]
    expect(headers.length).toBeGreaterThan(1)
    expect(headers.every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  it('gives the game modes no scroll memory — each one opens at its own top', () => {
    const { container } = mountApp() // Classic
    const el = scrollContainer(container)
    el.scrollTop = 77
    pressKey('F') // → Flash: same container, new content, back to the top
    expect(el.scrollTop).toBe(0)
    el.scrollTop = 120
    pressKey('K')
    expect(el.scrollTop).toBe(0)
  })

  it('leaves the other screens pixel-identical — the hidden guide generates no box', () => {
    // The trap in always-mounting this one: its mt-2.5 must ride on the SAME element as the
    // display toggle. Hang the toggle one level down and the margin stays in App's flex column on
    // every other screen — 10px of invisible content that lengthens each of them past the
    // viewport, for a phantom bottom fade and a scrollbar on modes that used to fit exactly.
    const { container } = mountApp() // Classic
    const root = [...container.querySelectorAll('div')].find((d) =>
      d.className.includes('space-y-(--guide-panel-gap)'),
    )
    expect(root.className).toContain('mt-2.5')
    expect(root.style.display).toBe('none')
    // …and nothing sits between it and the flex column, which is the only way that holds.
    const column = scrollContainer(container).firstElementChild
    expect(root.parentElement).toBe(column)
    // Every always-mounted screen is either the one on show or display:none — no third state.
    const screens = [...column.children]
    expect(screens.length).toBe(6) // 5 game modes + the guide (Lookup is still conditional)
    expect(screens.filter((c) => c.style.display === 'block')).toHaveLength(1)
    expect(screens.filter((c) => c.style.display === 'none')).toHaveLength(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A PRESET SWITCH IS A FRESH CONTEXT — the incoming preset's How to Play opens at its own top, and
// the outgoing preset's live reading offset must not leak across (round-21 A1). The switch
// subscription in main.tsx runs switchMode + remountScreens + a scroller reset in the same order
// fullReset uses; get that order wrong and switchMode's saveReadingPosRef read (taken on the way
// out of the guide) lands AFTER remountScreens has zeroed the saved offset.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a preset switch opens the incoming guide at the top', () => {
  beforeEach(() => {
    usePresets.setState(makePresetRegistryDefaults())
  })
  const open = (id) => act(() => switchPreset(id))

  it('both presets resolve to the guide — the switch does not carry preset 1’s scroll across', () => {
    // Here `mode` never changes across the switch (guide → guide), so the scroll-ownership layout
    // effect never re-runs: only remountScreens' zero + the subscription's explicit scroller reset
    // put the incoming reader at the top.
    const { container } = mountApp()
    act(() => createPreset('Two'))
    open(2)
    pressKey('H') // preset 2's session page is now the guide
    open(1)
    pressKey('H') // preset 1's too
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(600)
    expect(g.pos()).toBe(600)
    open(2) // → preset 2, which also resolves to the guide
    expect(g.pos()).toBe(0)
  })

  it('does not leak preset 1’s offset into a later in-preset return to the guide', () => {
    const { container } = mountApp()
    act(() => createPreset('Two'))
    pressKey('H') // preset 1 → guide, session page recorded
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(600)
    open(2) // → preset 2, first visit → Classic (the guide is left behind)
    pressKey('H') // first time INTO preset 2's guide this session
    expect(g.pos()).toBe(0) // its own top, not preset 1's 600
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// FULL RESET. "A new launch starts at the top with every panel closed" has to hold for the reset
// that MEANS a new launch, from inside the guide and from outside it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Full Reset returns the guide to a launch state', () => {
  // The footer button is dimmed and short-circuited while the whole app sits at launch state, so
  // every case here has to diverge something first. The gear is scoped to the sticky bar: the
  // guide itself has a section titled "Settings", so a bare name match finds two buttons.
  const fullReset = (container) => {
    const bar = container.querySelector('.htp-sticky-bar')
    act(() => fireEvent.click(within(bar).getByRole('button', { name: /^Settings/ })))
    // Q7 round 21: the footer button opens a ConfirmModal; its own "Full Reset" button confirms
    // (resolved within the dialog so it never collides with the footer button of the same name).
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Full Reset' })))
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Full Reset this preset?' })).getByRole(
          'button',
          { name: 'Full Reset' },
        ),
      ),
    )
  }

  it('sends the reader back to the top when it fires from inside the guide', () => {
    useSettings.getState().setLeapChance('75') // diverged → Full Reset is live
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(500)
    fullReset(container)
    expect(g.pos()).toBe(0)
  })

  it('forgets the saved place, so returning to the guide afterwards opens at the top', () => {
    useSettings.getState().setLeapChance('75')
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(500)
    pressKey('K') // the place is now saved, and the guide is off screen
    fullReset(container)
    pressKey('H')
    expect(g.pos()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RESUME. Round 8 Q6 deleted a visibilitychange→scroll-reset that threw the reader back to the top
// of How to Play on every app switch; round 11 Q3 found the same mistake surviving in a second
// event, because a BFCache restore reaches the app through `pageshow` wearing a navigation's
// clothes. Both halves are held from both sides here.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('coming back to the app moves nothing', () => {
  it('leaves the guide reading position exactly where it was', () => {
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(640)
    g.clearWrites()
    resumeFromBackground()
    // Not "put back to 640" — never touched. A single write would be the bug.
    expect(g.pos()).toBe(640)
    expect(g.writes).toEqual([])
  })

  it('leaves the guide reading position alone on a BFCache restore (pageshow persisted)', () => {
    // A restore keeps the JS heap, so the app comes back in the same mode with the same DOM, and
    // the offsets the browser hands back are the ones that belong to it.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.scrollTo(640)
    g.clearWrites()
    act(() => {
      fireEvent(window, pageShowEvent(true))
    })
    expect(g.pos()).toBe(640)
    expect(g.writes).toEqual([])
  })

  it("leaves a clamped mode's container scroll exactly where it was", () => {
    const { container } = mountApp() // launch mode: Classic, clamped
    const el = scrollContainer(container)
    el.scrollTop = 77
    resumeFromBackground()
    expect(el.scrollTop).toBe(77)
  })

  it('leaves an open guide section open', () => {
    const { container } = mountApp()
    pressKey('H')
    const header = container.querySelector('#guide-sec-overview button')
    tap(container, 'overview')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    resumeFromBackground()
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('STILL zeroes a bogus root scroll on a FRESH load (pageshow), unlike a resume', () => {
    // The other half of the contract, and it is about the CLAMPED layout rather than the guide:
    // history scroll restoration on a reload can hand it a non-zero root scrollTop — the offset
    // the document had last session, in a mode that allowed one — which would permanently offset
    // the fixed #root. Deleting the resume listener must not cost us this guard, and neither must
    // the BFCache gate above.
    const { container } = mountApp() // Classic — clamped
    const el = scrollContainer(container)
    el.scrollTop = 77
    document.documentElement.scrollTop = 310
    act(() => {
      fireEvent(window, pageShowEvent(false))
    })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(el.scrollTop).toBe(0)
  })

  it('leaves that same bogus root scroll alone on a BFCache restore', () => {
    const { container } = mountApp() // Classic — clamped
    const el = scrollContainer(container)
    el.scrollTop = 77
    document.documentElement.scrollTop = 310
    act(() => {
      fireEvent(window, pageShowEvent(true))
    })
    expect(document.documentElement.scrollTop).toBe(310)
    expect(el.scrollTop).toBe(77)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ACCORDION COORDINATOR. lib/accordionMotion's own tests own the MATH; what these own is the
// wiring — that GuidePage measures the right things, reads the reading line off the stylesheet,
// runs the writer on the panels' clock and curve, and gets out of the way the moment the reader
// touches the page.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('tapping a section carries the reading position with it', () => {
  // Only the opening panel BODY is tall: its .expander wrapper measures 0, so the opening travel
  // is the body's own height — the difference of two rect reads, which is what the coordinator
  // computes and what round 10 stopped rounding to integers.
  const openingPanelHeight = (px) => mockRects((el) => (el.id?.startsWith('guide-panel-') ? px : 0))
  // Run the glide the last tap scheduled to completion: the first frame is t=0, and the next is
  // handed a timestamp past any duration this app uses, so it lands exactly on the target.
  const runGlide = (frames) => {
    act(() => frames.at(-1)(0))
    act(() => frames.at(-1)(10000))
  }
  // The state every case here starts from: a real reading page, the reader partway down it, and
  // the reading line stood up at the owner's own fractional seat (57px bar + 8.46px gap at his
  // 16.92px fluid root).
  const readingPage = (at = 500, seat = 65.46) => {
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(3000)
    g.setSeat(seat)
    g.scrollTo(at)
    g.clearWrites()
    return { container, g }
  }

  it('seats the tapped panel on the reading line, landing on a WHOLE pixel', () => {
    // Scenario A end to end. headerDocTop 0 + 500, seat 65.46 → a raw target of 434.54, which the
    // engine used to be free to round either way. Integers are the one offset every quantisation
    // grid represents exactly, and CEIL is the safe direction: overshooting hides a fraction more
    // of a panel nobody is reading, undershooting reveals the previous panel's translucent bottom
    // border as a hairline under the bar — the owner's report that started this.
    const { container, g } = readingPage()
    openingPanelHeight(400.4)
    const frames = manualFrames()
    tap(container, 'overview')
    runGlide(frames)
    expect(g.pos()).toBe(435)
  })

  it('glides to the end of the shrunken page on a close, and never past it', () => {
    // Scenario B: the toggle shrinks the page past where the reader is standing, so the browser
    // would clamp in a single frame (the captured 744px/150ms fling). The target IS the far edge
    // of the new scroll range, carrying the closing panel's fraction straight through — which is
    // also why it is deliberately NOT ceiled: rounding it up aims past the end of the page, where
    // the engine's own clamp eats the last frames and the motion reads as stalling.
    const { container, g } = readingPage(2500)
    mockRects((el) => (el.classList.contains('expander') ? 600.5 : 0))
    const frames = manualFrames()
    tap(container, 'overview')
    tap(container, 'buttons')
    runGlide(frames)
    expect(g.pos()).toBe(3000 - 600.5 - g.viewport)
  })

  it('moves nothing when the tap leaves the reading position coherent', () => {
    // The stay-put default, which is most taps. The reader is at the top, so the tapped header is
    // already at (in fact above) the reading line: no compensation is owed, and animating one
    // anyway would be visible motion for no correction.
    const { container, g } = readingPage(0)
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    expect(
      container.querySelector('#guide-sec-overview button').getAttribute('aria-expanded'),
    ).toBe('true') // the tap landed …
    expect(g.writes).toEqual([]) // … and moved nothing
    expect(frames).toEqual([]) // no writer was even scheduled
  })

  it('rides the panels’ own clock and curve, landing exactly on the target', () => {
    // The writer runs the SAME duration the panels are stamped with — d(400px) bottoms out at the
    // 240ms floor — and the numeric twin of their cubic-bezier(.2,0,0,1). Decelerate-dominant, so
    // by the halfway point of the clock most of the distance is already spent; the point of
    // pinning it here rather than in the math tests is that the two are actually WIRED to each
    // other, and that t=0 starts from where the reader was rather than jumping.
    const { container, g } = readingPage()
    g.setSeat(60)
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    act(() => frames.at(-1)(0))
    expect(g.pos()).toBe(500) // the first frame is the starting position, not a jump
    act(() => frames.at(-1)(120)) // half of the 240ms clock
    expect(g.pos()).toBeLessThan(455) // well past halfway of the 60px travel
    expect(g.pos()).toBeGreaterThan(440)
    act(() => frames.at(-1)(240))
    expect(g.pos()).toBe(440) // ceil(500 − 60)
  })

  it('jumps straight to the end state under Reduce Motion', () => {
    // --motion-scale pre-multiplies the writer's duration exactly as the panels' CSS calc does, so
    // a 0 scale collapses the glide to its first pre-paint callback: the snapped layout and the
    // corrected position appear together, on one frame, with nothing scheduled after it.
    const { container, g } = readingPage()
    g.setSeat(60)
    document.documentElement.style.setProperty('--motion-scale', '0')
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    act(() => frames.at(-1)(0))
    expect(g.pos()).toBe(440)
    expect(frames.length).toBe(1) // one callback, and no successor
  })

  it.each(['touchstart', 'wheel'])('lets a real %s cancel the glide where it stands', (type) => {
    // The user always wins. A glide that kept running under a finger would fight it.
    const { container, g } = readingPage()
    g.setSeat(60)
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    act(() => frames.at(-1)(0))
    act(() => frames.at(-1)(120))
    const stopped = g.pos()
    const pending = frames.length
    act(() => {
      fireEvent(window, new Event(type))
    })
    expect(frames[pending - 1]).toBeNull() // the scheduled frame was cancelled …
    expect(frames.length).toBe(pending) // … and nothing re-armed
    expect(g.pos()).toBe(stopped)
  })

  it('drops a glide already in flight when another section is tapped', () => {
    // A mid-flight re-toggle measures the closing panel's INTERPOLATED height, so the retarget
    // stays exact — but only if the previous writer is gone rather than racing the new one.
    const { container, g } = readingPage()
    g.setSeat(60)
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    act(() => frames.at(-1)(0))
    const pending = frames.length
    tap(container, 'buttons')
    expect(frames[pending - 1]).toBeNull() // the first writer's next frame is cancelled
    expect(frames.length).toBeGreaterThan(pending) // and a second writer took over
    runGlide(frames)
    expect(g.pos()).toBeLessThan(500) // the retarget still landed somewhere coherent
  })

  it('cancels an in-flight glide when the app is backgrounded, and never re-arms it', () => {
    // rAF stops firing while hidden, so a writer caught mid-flight would wake against a stale
    // clock and fling the page to a target computed for a tap the reader has long since forgotten.
    // Cancelling leaves the panels to finish their CSS transition and the browser to hold position.
    const { container, g } = readingPage(2500)
    const frames = manualFrames()
    tap(container, 'overview') // pure scenario B: nothing measurable opens, the page shrinks
    const step = frames.at(-1)
    expect(step).toBeTypeOf('function')
    act(() => step(0))
    expect(g.writes).toHaveLength(1)
    const pending = frames.length
    resumeFromBackground()
    expect(frames[pending - 1]).toBeNull() // cancelled on hide …
    expect(frames.length).toBe(pending) // … and never re-armed on the way back
    expect(g.writes).toHaveLength(1)
  })

  it('drops an in-flight glide the instant the mode changes, before the switch moves the scroller', () => {
    // ⚠ AN ORDERING CLAIM, and the reason it is worth a test of its own: the glide and the mode
    // switch write the SAME element now, and the switch writes the top exactly once. So a frame
    // that survived the switch would not be fighting the reset, it would be landing after it —
    // scrolling a game screen to a position computed for a guide, with nothing left to put it
    // back. None of the cancels the reader can trigger covers the case: leaving by the H shortcut,
    // by a mode letter, by a desktop mouse click on the mode selector or by Android Back involves
    // neither a touch nor a wheel.
    // ⚠ THE FRAME IS DELIVERED AT THE INSTANT THE APP MOVES THE PAGE (onWrite), and that is what
    // makes this discriminating rather than decorative. A test cannot otherwise stand inside the
    // switch: React hands control back only once the whole thing has run, so anything the test does
    // is wholly before or wholly after, and both orderings look identical from there. Writing the
    // frame INTO the app's own write puts it exactly where a browser's next paint could fall — and
    // a drop that waited any longer would leave the writer armed to run right over the reset.
    const { container, g } = readingPage(2500)
    const frames = manualFrames()
    tap(container, 'overview') // scenario B: nothing measurable opens, the page shrinks
    act(() => frames.at(-1)(0))
    g.clearWrites()
    g.onWrite(() => frames.at(-1)?.(10000)) // whatever the glide has scheduled RIGHT NOW
    pressKey('K')
    // One write, and it is the switch's own reset. A second would be the glide finishing its
    // journey on the screen that had already replaced the guide, with nothing left to undo it.
    expect(g.writes).toEqual([0])
  })

  it('refuses to glide a scroller it cannot measure', () => {
    // ⚠ THE SEAM, pinned so it cannot be quietly removed. A scroller reporting no extent has been
    // laid out by nobody: there is no scroll range, so every number a target would be built from
    // is a zero — and the arithmetic does NOT degrade gracefully, it concludes that the reader is
    // standing past the end of a zero-height page and flings them to the top. A real engine never
    // reports this; a layout-less test environment reports nothing else, which is exactly why the
    // coordinator has to state the precondition instead of inheriting it from whichever API
    // happens to be missing.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setSeat(60)
    g.scrollTo(500) // …but no content height was ever stood up
    g.clearWrites()
    openingPanelHeight(400)
    const frames = manualFrames()
    tap(container, 'overview')
    expect(g.writes).toEqual([])
    expect(frames).toEqual([])
    expect(g.pos()).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE EDGE INDICATORS. Round 10 item B made them PROGRESSIVE — a continuous 0…1 --shade per
// boundary instead of a class toggled by a boolean and cross-faded by a CSS transition — and
// round 11 Q4 made them answer to content changes no scroll event reports. jsdom paints nothing,
// but it can prove the number that reaches each surface.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the guide’s edges track the reading position and the content', () => {
  let ro = null
  beforeEach(() => {
    ro = installResizeObserver() // BEFORE mount — the app builds its observers in layout effects
  })
  afterEach(() => {
    ro.restore()
    ro = null
  })

  it('ramps both boundaries with the position, and clamps at each end', () => {
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    const bar = container.querySelector('.htp-sticky-bar')
    const barClass = bar.className
    // Before any content exists this is an unscrollable page — and both boundaries must be WRITTEN
    // to a resting 0, never left at @property's initial-value of 1 (a full-strength 50%-black
    // shadow, which is exactly how round 10's ship-blocker looked).
    expect([g.topShade(), g.bottomShade()]).toEqual(['0.000', '0.000'])
    g.setContent(2000)
    g.scrollTo(6)
    expect(g.topShade()).toBe('0.250') // 6px into a 24px ramp
    expect(g.bottomShade()).toBe('1.000') // 1226px still below → pinned at full
    g.scrollTo(1000) // past the ramp at the top → CLAMPS instead of growing
    expect([g.topShade(), g.bottomShade()]).toEqual(['1.000', '1.000'])
    g.scrollTo(0) // back at the top, with no timer left running late
    expect([g.topShade(), g.bottomShade()]).toEqual(['0.000', '1.000'])
    // The bottom ramp starts where the 4px dead band ends, so it reaches 0 at the same place the
    // banded "arrived" answer does: 12px out is (12 − 4) / (24 − 4).
    g.scrollTo(2000 - g.viewport - 12)
    expect(g.bottomShade()).toBe('0.400')
    g.scrollTo(2000 - g.viewport - 3) // inside the dead band
    expect(g.bottomShade()).toBe('0.000')
    // …and through all of that, not one class changed. Strength is a function of position now, so
    // a stopped scroller is already at its final value — which is what killed the shadow that used
    // to linger for 0.15-0.2s after a status-bar tap had stopped the page dead.
    expect(bar.className).toBe(barClass)
  })

  it('falls back to full strength — never to no shadow — if the ramp distance cannot be read', () => {
    // The documented degradation is the pre-round-10 behaviour: on the moment the edge is live, at
    // full strength. A shadow that silently vanished would be the unacceptable failure.
    document.documentElement.style.removeProperty('--fade-h')
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    g.setContent(2000)
    g.scrollTo(6)
    expect(g.topShade()).toBe('1.000')
  })

  it('watches the guide’s CONTENT, not just the box it sits in', () => {
    // scrollHeight is the children's stacked height, so the children are the subject. An observer
    // on the box alone can only ever report a viewport change — which is the shape the clamped
    // branch's freeze had, and the guide branch had no observer at all.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    expect([ro.isObserved(g.extentHost), ro.isObserved(g.contentEl)]).toEqual([true, true])
  })

  it('follows the page growing under a stationary reader — no scroll, no resize', () => {
    // The doc-fade freeze. An accordion toggle changes the page's height with neither event: a tap
    // that seats an already-seated panel scrolls nowhere, and the panel keeps growing for the rest
    // of its animation after the glide's last scroll event. This test fires neither, deliberately,
    // and steps the growth one animation frame at a time — the strip's strength is continuous, so
    // it must TRACK the growth rather than snap at the end of it.
    const { container } = mountApp()
    pressKey('H')
    const g = installGuide(container)
    for (const [content, expected] of [
      [g.viewport, '0.000'], // exactly fills the screen: nothing below to signal
      [780, '0.400'], // 12px below → (12 − 4) / (24 − 4)
      [790, '0.900'],
      [800, '1.000'], // 32px below → past the feather, clamped
    ]) {
      g.setContent(content)
      act(() => ro.resize(g.contentEl))
      expect(g.bottomShade()).toBe(expected)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE STYLESHEET HALF. jsdom applies no stylesheets, so the declarations the numbers above feed
// can only be asserted against index.css itself. Everything here is independent of WHICH element
// scrolls; the rules that are not live in tests/docScroll.dom.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
)
const ruleBody = (re) => {
  const m = css.match(re)
  expect(m, `index.css: no rule matched ${re}`).not.toBeNull()
  return m[1]
}
// The DECLARATIONS only. index.css documents itself heavily, and the comments name the very things
// some of these pins ban — the deleted `transition: box-shadow` among them — so a must-NOT-appear
// assertion has to read the code, not the prose that explains it.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('index.css — the feather token and the reading line it is NOT derived from', () => {
  it('feathers every scroll-region edge from the one --fade-h token, with no hardcoded twin', () => {
    for (const re of [
      /\.fade-scroll-top\{([^}]*)\}/,
      /\.fade-scroll-bottom\{([^}]*)\}/,
      /\.fade-scroll-both\{([^}]*)\}/,
    ]) {
      const body = ruleBody(re)
      expect(body).toContain('var(--fade-h)')
      expect(body).not.toContain('24px')
    }
    expect(css).toContain(':root{--fade-h:24px}') // the single home of the value
  })

  it('REGISTERS --seat-top as a <length> so JS reads a resolved px value, not a calc string', () => {
    // Load-bearing, not decorative: unregistered, getComputedStyle hands back the literal "calc(…)"
    // token stream → parseFloat NaN. GuidePage survives that (it walks down a ladder to
    // scroll-padding-top and then --bar-h), but this registration is what makes the direct read
    // exact on every engine that has @property — i.e. the owner's.
    const prop = ruleBody(/@property --seat-top\{([^}]*)\}/)
    expect(prop).toContain('syntax:"<length>"')
    expect(prop).toContain('inherits:true')
    expect(prop).toContain('initial-value:0px')
  })

  it('keeps ONE home for the panel gap — the token the guide lays out with and the seat derives from', () => {
    // The gap the reader sees and the gap the scroll math assumes are the same declaration. A
    // literal space-y-2 back on the guide's section list would silently restore the Q5 bug the next
    // time either number moved.
    expect(css).toContain(':root{--guide-panel-gap:calc(var(--spacing) * 2)}')
    const guideSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'GuidePage.tsx'),
      'utf8',
    )
    expect(guideSource).toContain('className="mt-2.5 space-y-(--guide-panel-gap)"')
    expect(guideSource).not.toContain('space-y-2"')
  })
})

describe('index.css — the progressive boundary shadow (round 10 item B)', () => {
  it('composes the shadow from per-theme channels × alpha × --shade — and never from color-mix()', () => {
    // ⚠ The one that would have shipped a silent, untestable bug. A hand-written color-mix() holding
    // var(--shade) cannot be constant-folded by Lightning CSS (the value is only known at runtime)
    // and gets no automatic @supports fallback, so on an engine without color-mix the WHOLE
    // box-shadow declaration is invalid at parse and every boundary shadow in the app disappears.
    // The channels-and-alpha form is pixel-identical and works back to Safari 12.1.
    for (const [re, offset] of [
      [/\.elev-shadow-down\{([^}]*)\}/, '0 4px 6px -2px'],
      [/\.elev-shadow-up\{([^}]*)\}/, '0 -4px 6px -2px'],
    ]) {
      const body = ruleBody(re)
      expect(body).toBe(
        `box-shadow:${offset} rgb(var(--shadow-elev-c) / calc(var(--shadow-elev-a) * var(--shade,1)))`,
      )
      expect(body).not.toContain('color-mix')
    }
  })

  it('leaves NO box-shadow transition anywhere — the lag this replaced had nowhere else to hide', () => {
    // The owner's symptom was a shadow still fading ~0.15-0.2s after a status-bar tap had stopped
    // the page dead. Progressive strength only removes that if no duration survives beside it, so
    // this bans the property outright rather than checking the one rule that used to carry it.
    expect(cssCode).not.toMatch(/transition[^;}]*box-shadow/)
    expect(cssCode).not.toContain('.htp-sticky-bar,.popover-sticky-footer')
  })

  it('REGISTERS --shade as a non-inherited <number>, defaulting to a VISIBLE shadow', () => {
    // Registration is the safety net: with a syntax, a malformed JS write is rejected and the last
    // good value survives; unregistered it would substitute garbage into the calc() and take the
    // whole shadow with it. initial-value 1 (and the literal `,1)` fallback for engines with no
    // @property) means an unwritten boundary shows its full static shadow — never an invisible one.
    const prop = ruleBody(/@property --shade\{([^}]*)\}/)
    expect(prop).toContain('syntax:"<number>"')
    expect(prop).toContain('inherits:false')
    expect(prop).toContain('initial-value:1')
  })

  it('splits the shadow token per theme, with no survivor of the single rgba it replaced', () => {
    // Verified against the pre-split values: black/50% for the default row (dusk and nebula inherit
    // it), midnight's violet glow on pure black, and the two light rows' dark tints. Alpha 0 is
    // fully transparent whatever the channels hold, so multiplying the alpha behaves in all five.
    for (const pair of [
      '--shadow-elev-c:0 0 0;--shadow-elev-a:.5',
      '--shadow-elev-c:139 92 246;--shadow-elev-a:.18',
      '--shadow-elev-c:46 16 101;--shadow-elev-a:.18',
      '--shadow-elev-c:30 27 75;--shadow-elev-a:.15',
    ])
      expect(cssCode).toContain(pair)
    expect(cssCode.match(/--shadow-elev-c:/g)).toHaveLength(4)
    expect(cssCode.match(/--shadow-elev-a:/g)).toHaveLength(4)
    expect(cssCode).not.toMatch(/--shadow-elev:/) // the un-split token is gone, not shadowed
  })
})
