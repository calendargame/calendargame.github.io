// @vitest-environment jsdom
//
// ROUND 11 — the two fade/shadow freezes, and the fixture gap underneath them.
//
// THE BUGS. Every scroll indicator answers one question — "how far is this scroller from each of
// its edges" — from three numbers: scrollTop, scrollHeight, clientHeight. The platform gives an
// event for the first only. Both freezes are the other two changing silently:
//   • CLAMPED modes: the app's scroll container is `absolute inset-0`, so its box is pinned to the
//     viewport BY CONSTRUCTION. The ResizeObserver watching it was watching the one number no
//     content change can ever move — open Show Codes while resting at the top and the bottom fade
//     kept painting the answer from before it opened.
//   • GUIDE mode: the guide's scroller had no observer at all, only scroll + resize. An accordion
//     toggle produces neither (a tap that seats an already-seated panel scrolls nowhere, and the
//     panel keeps growing for the rest of its animation after the glide's last scroll event), so
//     the bottom edge froze. That half is pinned in tests/guideScroll.dom, through the scroller
//     abstraction that carried it unchanged across the guide's move onto an inner scroller.
// Both are now `observeScrollExtent` (components/scrollRegion), which watches the CONTENT: the
// scroller, each of its element children, and a childList MutationObserver for children arriving
// or leaving.
//
// THE FIXTURE GAP, which is the actual recurring defect. The suite was green over both bugs, and
// over round 10's ship-blocker before them, because every scroll fixture in it renders the same
// shape: a populated, comfortably overflowing region, driven by a scroll event. It never rendered
// a resting state and never performed a transition without a scroll. tests/helpers/scrollGeometry
// names those states; this file sweeps them, and the two regressions below are pinned inside that
// sweep rather than beside it.
//
// WHAT jsdom CANNOT DO, stated plainly: it lays nothing out and its ResizeObserver is an inert
// stub, so the three numbers and the resize notification are supplied by the fixture. That makes
// this a test of the app's WIRING — which element is watched, which number is re-read, what is
// written where — and not of real layout. The feel of a fade tracking a real accordion at 60fps
// is the owner's device.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCallback, useRef } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import LookupCard from '../src/components/LookupCard.jsx'
import {
  observeScrollExtent,
  scrollFadeClass,
  useScrollEdgeState,
} from '../src/components/scrollRegion.js'
import { useSettings } from '../src/store/settings.js'
import {
  installResizeObserver,
  setScrollGeometry,
  RESTING_GEOMETRIES,
  OVERFLOWING_GEOMETRY,
} from './helpers/scrollGeometry.js'

const shade = (el) => el.style.getPropertyValue('--shade')

// A MutationObserver delivers on a microtask; a timeout is queued behind all of them.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The primitive, on plain DOM. No React, no app — just "what does it watch, and when does it
// report".
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('observeScrollExtent — the content, not the box', () => {
  let ro
  let stop
  beforeEach(() => {
    ro = installResizeObserver()
  })
  afterEach(() => {
    stop?.()
    stop = null
    ro.restore()
    document.body.innerHTML = ''
  })

  // A scroller with two children, the shape of every region in the app.
  function region() {
    const el = document.createElement('div')
    const first = document.createElement('div')
    const second = document.createElement('div')
    el.append(first, second)
    document.body.appendChild(el)
    return { el, first, second }
  }

  it('watches the scroller AND every element child', () => {
    // The clamped-mode freeze, stated structurally. `absolute inset-0` pins the scroller's box to
    // the viewport, so an observer on the box alone is an observer on the one number content can
    // never move. scrollHeight is the CHILDREN's stacked height — so the children are the subject.
    const { el, first, second } = region()
    stop = observeScrollExtent(el, () => {})
    expect([ro.isObserved(el), ro.isObserved(first), ro.isObserved(second)]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('reports a child growing frame by frame — an animation is tracked, not waited out', () => {
    // The accordion case. A CSS transition resizes its element once per frame; each of those is a
    // new answer to the edge question, which is why the indicators follow the panel open instead
    // of snapping to the end of it.
    const { el, first } = region()
    const onChange = vi.fn()
    stop = observeScrollExtent(el, onChange)
    for (let frame = 0; frame < 3; frame++) ro.resize(first)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('still reports the scroller’s own box changing — a rotation is a resize too', () => {
    const { el } = region()
    const onChange = vi.fn()
    stop = observeScrollExtent(el, onChange)
    ro.resize(el)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a child ADDED, and watches it from then on', async () => {
    // No ResizeObserver can see this one: the total changes while no survivor resizes. The
    // re-observe is what makes it more than a notification — a child that arrives and THEN grows
    // (a history row animating in) has to be under observation by the time it does.
    const { el } = region()
    const onChange = vi.fn()
    stop = observeScrollExtent(el, onChange)
    const added = document.createElement('li')
    el.appendChild(added)
    await flushMicrotasks()
    expect(onChange).toHaveBeenCalled()
    expect(ro.isObserved(added)).toBe(true)
  })

  it('reports a child REMOVED — its own observation left with it', async () => {
    const { el, second } = region()
    const onChange = vi.fn()
    stop = observeScrollExtent(el, onChange)
    second.remove()
    await flushMicrotasks()
    expect(onChange).toHaveBeenCalled()
  })

  it('stops watching on teardown — both observers, not just the resize one', async () => {
    const { el, first } = region()
    const onChange = vi.fn()
    observeScrollExtent(el, onChange)()
    ro.resize(first)
    ro.resize(el)
    el.appendChild(document.createElement('div'))
    await flushMicrotasks()
    expect(onChange).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The RESTING states, through the shared hook — so Lookup's history list, the settings popover,
// the changelog popup and the shared defaults card (round 13) are all covered by construction
// (they are its only four callers).
// ★ THE DIVISION OF LABOUR that claim rests on, so it is not taken on trust: the resting ARITHMETIC
// — every geometry with nothing to scroll writes both boundaries to a literal 0 rather than leaving
// them at @property's initial-value of 1 — is proved here, once, against the hook itself. What each
// caller's own file has left to prove is that it is WIRED to the hook at all, which its live-edge
// test does (scrollRegion.dom for the defaults card and Lookup, changelog.dom for the popup). A
// caller re-asserting the resting numbers would be the same fact twice with two places to drift.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The hook's whole public surface in one component: a scroller, the two boundary surfaces it can
// be handed, and the mask class its two booleans produce.
function Region({ geometry, active = true }) {
  const scrollerRef = useRef(null)
  const topRef = useRef(null)
  const bottomRef = useRef(null)
  // A CALLBACK ref, so the geometry is in place before the hook's layout effect measures: React
  // attaches refs during the commit, ahead of every layout effect. The ordering is the point —
  // round 10's shadow bug was wrong on the FIRST painted frame, and a fixture that applied its
  // geometry after mounting could never have caught it.
  const attach = useCallback(
    (node) => {
      scrollerRef.current = node
      if (node) setScrollGeometry(node, geometry)
    },
    [geometry],
  )
  const { scrolledFromTop, atBottom } = useScrollEdgeState(scrollerRef, active, topRef, bottomRef)
  return (
    <div>
      <div ref={topRef} data-testid="top" />
      <div
        ref={attach}
        data-testid="scroller"
        className={`region${scrollFadeClass(scrolledFromTop, atBottom)}`}
      >
        <div data-testid="child" />
      </div>
      <div ref={bottomRef} data-testid="bottom" />
    </div>
  )
}

describe('the resting states — nothing to scroll means nothing to signal', () => {
  beforeEach(() => {
    document.documentElement.style.setProperty('--fade-h', '24px')
  })
  afterEach(() => {
    cleanup()
    document.documentElement.style.removeProperty('--fade-h')
  })

  it.each(RESTING_GEOMETRIES)(
    '%s: no mask, and both boundaries written to 0',
    (_name, geometry) => {
      const { getByTestId } = render(<Region geometry={geometry} />)
      // WRITTEN, not merely absent: an unset --shade inherits @property's initial-value of 1, which
      // is a full-strength 50%-black shadow. That is exactly how round 10's ship-blocker looked.
      expect(shade(getByTestId('top'))).toBe('0.000')
      expect(shade(getByTestId('bottom'))).toBe('0.000')
      expect(getByTestId('scroller').className).toBe('region')
    },
  )

  it('is not passing by writing nothing — a live edge still lights up', () => {
    const { getByTestId } = render(<Region geometry={OVERFLOWING_GEOMETRY} />)
    expect(shade(getByTestId('bottom'))).toBe('1.000')
    expect(getByTestId('scroller').className).toBe('region fade-scroll-bottom')
  })

  it('rests everything again when the region deactivates', () => {
    // The other half of the round-10 class: a region that HAD something to scroll and then does
    // not. The teardown reset is what stops a closed popover reopening with stale indicators.
    const { getByTestId, rerender } = render(<Region geometry={OVERFLOWING_GEOMETRY} />)
    expect(shade(getByTestId('bottom'))).toBe('1.000')
    rerender(<Region geometry={OVERFLOWING_GEOMETRY} active={false} />)
    expect(shade(getByTestId('bottom'))).toBe('0.000')
    expect(getByTestId('scroller').className).toBe('region')
  })

  it('Lookup with ONE entry: the list exists and has nothing to scroll', () => {
    // Empty renders no <ul> at all (the null-scroller path); one entry renders a real scroller that
    // is simply not overflowing — the state every fresh install is in right after its first
    // lookup. Since round 23 the list has no boundary surfaces to rest, so the required
    // answer is the list's own: no fade at either edge.
    const { container } = render(<LookupCard history={[{ id: 'e0', y: 1592, m: 3, d: 1 }]} />)
    expect(container.querySelectorAll('ul li')).toHaveLength(1)
    expect(container.querySelector('ul').className).not.toContain('fade-scroll')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The app's own scroller. It was two branches when this was written — the clamped container and
// the guide's released document — and round 13 made it one container in every mode, so what is
// swept below is now the whole of it rather than one of a pair.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// The container is the div carrying the inline paddingTop. Found by that style rather than by its
// id or classes, which is how these tests kept working across round 13: the same node used to
// render classless in guide mode and now renders identically in every mode.
const scrollContainer = (container) =>
  [...container.querySelectorAll('div')].find((d) => d.style.paddingTop === 'var(--bar-h)')

describe('the app scroller — content changes with no scroll event (round 11)', () => {
  let ro
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    document.documentElement.style.setProperty('--fade-h', '24px')
    ro = installResizeObserver() // BEFORE mount — the app builds its observers in layout effects
  })
  afterEach(() => {
    cleanup()
    ro.restore()
    document.getElementById('root')?.remove()
    document.documentElement.style.removeProperty('--fade-h')
  })

  it('watches the mode-content wrapper, not only the pinned box', () => {
    // The root cause, stated where it can never quietly come back: `absolute inset-0` means the
    // container's own size is a constant, so an observer on it alone can only ever report a
    // viewport change. The wrapper below it is the element whose height IS this scroller's
    // scrollHeight.
    const { container } = mountApp()
    const el = scrollContainer(container)
    expect(el.className).toContain('absolute') // the precondition, stated
    expect(el.className).toContain('inset-0')
    expect([ro.isObserved(el), ro.isObserved(el.firstElementChild)]).toEqual([true, true])
  })

  it('sweeps the resting states with no residue between them', () => {
    // One mount, driven from state to state, so this also pins that leaving a live state cleans
    // up after itself — a mask left behind by the previous geometry is the freeze in miniature.
    const { container } = mountApp()
    const el = scrollContainer(container)
    const bar = container.querySelector('.htp-sticky-bar')
    for (const [, geometry] of RESTING_GEOMETRIES) {
      setScrollGeometry(el, OVERFLOWING_GEOMETRY)
      act(() => ro.resize(el))
      expect(el.className).toContain('fade-scroll-bottom') // live, so the next assertion means something
      setScrollGeometry(el, geometry)
      act(() => ro.resize(el))
      expect(el.className).not.toContain('fade-scroll')
      expect(shade(bar)).toBe('0.000')
    }
  })

  it('follows content growing under a stationary scroller — the freeze, fixed', () => {
    // Show Codes opens while the user rests at the top. No scroll event happens, and no resize of
    // the scroller can happen. Before this round the bottom fade kept the answer from before the
    // panel opened.
    const { container } = mountApp()
    const el = scrollContainer(container)
    const wrapper = el.firstElementChild
    setScrollGeometry(el, { scrollTop: 0, scrollHeight: 700, clientHeight: 700 })
    act(() => ro.resize(el))
    expect(el.className).not.toContain('fade-scroll')
    // The content grows; the box does not.
    setScrollGeometry(el, { scrollHeight: 1500 })
    act(() => ro.resize(wrapper))
    expect(el.className).toContain('fade-scroll-bottom')
    expect(el.className).not.toContain('fade-scroll-top') // still resting at the top
    expect(shade(container.querySelector('.htp-sticky-bar'))).toBe('0.000')
    // …and back: the panel closes, the fade goes with it.
    setScrollGeometry(el, { scrollHeight: 700 })
    act(() => ro.resize(wrapper))
    expect(el.className).not.toContain('fade-scroll')
  })

  it('re-answers after the BOX changes — a rotation, a keyboard, a --bar-h shift', () => {
    // The post-resize state, and the one direction an observer on the scroller's own box could
    // always see: the content is unchanged and the room for it shrinks. Kept as its own fixture
    // because "the box changed" and "the content changed" are two different halves of the same
    // question, and the round-11 fix must not have traded one for the other.
    const { container } = mountApp()
    const el = scrollContainer(container)
    setScrollGeometry(el, { scrollTop: 0, scrollHeight: 700, clientHeight: 700 })
    act(() => ro.resize(el))
    expect(el.className).not.toContain('fade-scroll')
    setScrollGeometry(el, { clientHeight: 420 })
    act(() => ro.resize(el))
    expect(el.className).toContain('fade-scroll-bottom')
  })

  // The guide's own branch — its content under observation, and the bottom edge following a panel
  // growing with neither a scroll nor a resize event — is pinned in tests/guideScroll.dom instead,
  // through the scroller abstraction, so it survives the guide moving onto an inner scroller.
})
