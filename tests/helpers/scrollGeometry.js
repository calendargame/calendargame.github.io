// Scroll-geometry FIXTURES — the states jsdom cannot produce on its own and the suite has never
// rendered (round 11).
//
// WHY THIS FILE EXISTS. Every scroll indicator in the app — the two mask fades, the bar's boundary
// shadow, the guide's doc-fade strips, Lookup's header/footer shadows — is a function of three
// numbers: scrollTop, scrollHeight, clientHeight. jsdom lays nothing out, so all three read 0
// unless a test stands them up by hand, and the tests that DO stand them up have always stood up
// the same one shape: a populated, comfortably overflowing region, driven by a scroll event.
//
// That gap is the actual recurring defect, and it has now shipped twice. Round 10: full-strength
// shadows framing an empty "No lookups yet" panel on every cold start of a fresh install — a
// RESTING state, which no fixture rendered, self-healing after the first lookup so an on-device
// pass missed it. Round 11: masks and fades frozen when content changed size without a scroll
// event — a TRANSITION, which no fixture performed. Each was answered with one more point test.
// This is the systematic replacement: name the states, and sweep the regions through them.
//
// Nothing here simulates layout. It supplies exactly what a real engine would supply and jsdom
// does not: the three numbers, and the notification that they changed.

// Stand up a scroller's geometry. scrollTop is a real stored property in jsdom; scrollHeight and
// clientHeight are read-only zeros, so they are defined as configurable getters — configurable so
// the same element can be moved from state to state (a growing accordion, a rotating viewport)
// rather than needing a fresh render per number.
export function setScrollGeometry(el, geometry) {
  for (const [prop, value] of Object.entries(geometry)) {
    if (prop === 'scrollTop') el.scrollTop = value
    else Object.defineProperty(el, prop, { configurable: true, get: () => value })
  }
  return el
}

// THE RESTING STATES: a scroller with no edge to signal. Every one of these must produce no mask,
// no shadow and no fade anywhere — `scrollEdgeGaps` collapses both gaps to 0 for all of them — and
// every one of them is a state the app is genuinely in on a cold start or a large screen. The
// suite rendered none of them before this round.
export const RESTING_GEOMETRIES = [
  ['empty — no content at all', { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }],
  ['one item, far short of the box', { scrollTop: 0, scrollHeight: 44, clientHeight: 600 }],
  ['content shorter than the viewport', { scrollTop: 0, scrollHeight: 320, clientHeight: 600 }],
  ['content that exactly fits', { scrollTop: 0, scrollHeight: 600, clientHeight: 600 }],
  // The 1px slack in scrollEdgeGaps: a fractional content height against a fractional box height
  // reports a sliver of overflow forever, and for a progressive shadow that means a permanent
  // faint one. This is the state that regression lands in, so it is a fixture, not a footnote.
  [
    'a sub-pixel over — inside the 1px slack',
    { scrollTop: 0, scrollHeight: 600.6, clientHeight: 600 },
  ],
]

// The contrast case. A sweep over resting states alone can be passed by an implementation that
// writes nothing at all, so every sweep pairs them with one live state.
export const OVERFLOWING_GEOMETRY = { scrollTop: 0, scrollHeight: 1800, clientHeight: 600 }

// A CONTROLLABLE ResizeObserver, replacing the inert no-op stub tests/setup/dom.js installs.
//
// The stub is right for the 58 files that only need `new ResizeObserver` not to throw, and it is
// exactly why the freeze this round fixes was invisible to the suite: with an observer that never
// fires, watching the correct element and watching the wrong one are indistinguishable. This one
// records what each observer holds and lets a test deliver a resize for one target, which is the
// engine's half of the contract.
//
// Install BEFORE mounting — the app constructs its observers in layout effects at mount — and
// restore in an afterEach, or the next file in the same worker inherits it.
export function installResizeObserver() {
  const instances = new Set()
  const previous = window.ResizeObserver
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback
      this.targets = new Set()
      instances.add(this)
    }
    observe(target) {
      this.targets.add(target)
    }
    unobserve(target) {
      this.targets.delete(target)
    }
    disconnect() {
      this.targets.clear()
    }
  }
  return {
    // Deliver a resize for one element to every observer watching it. A real engine batches an
    // entry per target; the app's callbacks ignore the entries and re-measure, so one target per
    // call is the honest granularity — and it is what makes "which element is watched" testable.
    resize: (el) => {
      for (const instance of instances)
        if (instance.targets.has(el)) instance.callback([{ target: el }], instance)
    },
    // Structural, not behavioural: "is this element watched at all". The clamped-mode freeze was
    // an observer pointed at a box that content can never resize, so the element under observation
    // is itself part of the contract.
    isObserved: (el) => [...instances].some((instance) => instance.targets.has(el)),
    restore: () => {
      window.ResizeObserver = previous
      instances.clear()
    },
  }
}
