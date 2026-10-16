// @vitest-environment jsdom
//
// pointerGestures — the pure decisions + latch/suppression contracts behind press-drag-release
// input. controlOf / resolveRelease / resolveTriggerRelease / nextHilite / menuFor / bandDirection / scrollDelta are
// pure (or layout-free DOM reads) and tested directly; the controller's pointer latch, click suppression
// and group-drag hilite are tested by installing it and dispatching synthetic pointer events with a
// stubbed elementFromPoint. The full wiring (real pointer drags, hit-testing, edge auto-scroll feel) is
// verified on-device — jsdom has no layout engine, so elementFromPoint/getBoundingClientRect don't work
// there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  gestureTarget,
  controlOf,
  resolveRelease,
  resolveTriggerRelease,
  nextHilite,
  menuFor,
  bandDirection,
  scrollDelta,
  pressedHere,
  withholdsSecondTap,
  canStartScroll,
  scrollPlaces,
  movedSince,
  EDGE,
  MAX_SPEED,
  TAP_MS,
  TAP_SLOP_PX,
  DOUBLE_TAP_MS,
  installPointerGestures,
} from '../src/lib/pointerGestures.js'

const el = () => ({}) // identity-only stand-in for a DOM element
const groupContaining = (...members) => ({ contains: (n) => members.includes(n) })

describe('pointerGestures.resolveRelease — slide-off-to-cancel (no group)', () => {
  it('release ON the same button → activate (no suppress)', () => {
    const a = el()
    expect(resolveRelease(a, a, null)).toEqual({ suppressStart: false, activate: null })
  })
  it("release OFF onto a different button → suppress, NO cross-activation (the gesture is the first button's)", () => {
    const a = el()
    expect(resolveRelease(a, el(), null)).toEqual({ suppressStart: true, activate: null })
  })
  it('release on nothing → suppress (cancel)', () => {
    expect(resolveRelease(el(), null, null)).toEqual({ suppressStart: true, activate: null })
  })
})

describe('pointerGestures.resolveRelease — drag-to-select (answer-grid group)', () => {
  it('release on the SAME option → native click activates it (no suppress)', () => {
    const a = el()
    expect(resolveRelease(a, a, groupContaining(a))).toEqual({
      suppressStart: false,
      activate: null,
    })
  })
  it('drag to ANOTHER option in the grid → suppress start + activate the release option', () => {
    const a = el()
    const b = el()
    expect(resolveRelease(a, b, groupContaining(a, b))).toEqual({
      suppressStart: true,
      activate: b,
    })
  })
  it('release OFF the grid → suppress (cancel), activate nothing', () => {
    const a = el()
    expect(resolveRelease(a, el(), groupContaining(a))).toEqual({
      suppressStart: true,
      activate: null,
    })
  })
  it('release on nothing → suppress (cancel)', () => {
    const a = el()
    expect(resolveRelease(a, null, groupContaining(a))).toEqual({
      suppressStart: true,
      activate: null,
    })
  })
})

describe('pointerGestures.nextHilite — the group ring appears only after leaving the pressed option', () => {
  it('still on the start option (never left) → no hilite: a plain tap never flashes the ring', () => {
    const start = el()
    expect(nextHilite(start, start, false)).toEqual({ hasLeft: false, show: null })
  })
  it('over ANOTHER option → left the start + hilite the member under the pointer', () => {
    const start = el()
    const other = el()
    expect(nextHilite(other, start, false)).toEqual({ hasLeft: true, show: other })
  })
  it('off-grid (member null) COUNTS as leaving — armed, but nothing to hilite yet', () => {
    const start = el()
    expect(nextHilite(null, start, false)).toEqual({ hasLeft: true, show: null })
  })
  it('returning to the start AFTER leaving hilites it (a deliberate re-selection)', () => {
    const start = el()
    expect(nextHilite(start, start, true)).toEqual({ hasLeft: true, show: start })
  })
})

// ── resolveTriggerRelease — the press-drag MENU release decision. Uses real (layout-free)
// jsdom elements: the decision reads contains/hasAttribute/closest, which all work without layout.
const domEl = (tag, attrs = {}, parent = null) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (parent) parent.appendChild(node)
  return node
}

describe('pointerGestures.resolveTriggerRelease — press-drag menu release', () => {
  it('no paired menu (a press that CLOSED it) → inert', () => {
    expect(resolveTriggerRelease(null, domEl('button'))).toEqual({
      member: null,
      action: null,
      dismiss: false,
    })
  })
  it('release on nothing → inert', () => {
    expect(resolveTriggerRelease(domEl('div'), null)).toEqual({
      member: null,
      action: null,
      dismiss: false,
    })
  })
  it('release OUTSIDE the menu → inert (cancel)', () => {
    expect(resolveTriggerRelease(domEl('div'), domEl('button'))).toEqual({
      member: null,
      action: null,
      dismiss: false,
    })
  })
  it('button member of a data-drag-dismiss menu → click + dismiss (the Settings panel)', () => {
    const menu = domEl('div', { 'data-drag-dismiss': '' })
    const opt = domEl('button', {}, menu)
    expect(resolveTriggerRelease(menu, opt)).toEqual({
      member: opt,
      action: 'click',
      dismiss: true,
    })
  })
  it('button member of a NON-dismissing menu → click only (the mode menu closes itself)', () => {
    const menu = domEl('div')
    const opt = domEl('button', {}, menu)
    expect(resolveTriggerRelease(menu, opt)).toEqual({
      member: opt,
      action: 'click',
      dismiss: false,
    })
  })
  it('[data-drag-focus] member → focus, never dismiss (Year Range: the panel stays open for typing)', () => {
    const menu = domEl('div', { 'data-drag-dismiss': '' })
    const input = domEl('input', { 'data-drag-focus': '' }, menu)
    expect(resolveTriggerRelease(menu, input)).toEqual({
      member: input,
      action: 'focus',
      dismiss: false,
    })
  })
  it('member inside a [data-drag-stay] container → click, no dismiss (the ⚙ panel’s buttons and foot)', () => {
    const menu = domEl('div', { 'data-drag-dismiss': '' })
    const stay = domEl('div', { 'data-drag-stay': '' }, menu)
    const opt = domEl('button', {}, stay)
    expect(resolveTriggerRelease(menu, opt)).toEqual({
      member: opt,
      action: 'click',
      dismiss: false,
    })
  })
  it('member ITSELF marked data-drag-stay → click, no dismiss (closest matches self)', () => {
    const menu = domEl('div', { 'data-drag-dismiss': '' })
    const opt = domEl('button', { 'data-drag-stay': '' }, menu)
    expect(resolveTriggerRelease(menu, opt)).toEqual({
      member: opt,
      action: 'click',
      dismiss: false,
    })
  })
})

// ── gestureTarget — the announced-unavailable filter (round 15). Every target this controller
// resolves goes through it: the button a press latches onto, the member the ring is drawn on, and the
// member a release acts on. Until round 15 the filter was implicit — every withheld control also wore
// pointer-events-none, so elementFromPoint and pointerdown both walked past it — and round 15 removing that
// block from the ⚙ panel's three buttons is what made the rule need saying out loud.
describe('pointerGestures.gestureTarget — an announced-unavailable control is not a target', () => {
  it('an ordinary element passes through unchanged', () => {
    const b = domEl('button')
    expect(gestureTarget(b)).toBe(b)
  })
  it('aria-disabled="true" resolves to nothing — the pointer reads as landing on empty space', () => {
    expect(gestureTarget(domEl('button', { 'aria-disabled': 'true' }))).toBe(null)
  })
  it('aria-disabled="false" is NOT withheld — the attribute\'s value is the statement, not its presence', () => {
    const b = domEl('button', { 'aria-disabled': 'false' })
    expect(gestureTarget(b)).toBe(b)
  })
  it('null in, null out (no hit under the pointer)', () => {
    expect(gestureTarget(null)).toBe(null)
  })
})

// controlOf — what a pointer on an element belongs to: the button around it, or a SURFACE (a popup's
// dim, `data-press-surface`) where the pointer is on its bare self and nowhere else.
describe('pointerGestures.controlOf — a button, or a surface pressed on its bare self', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('the button around the pointer, as before', () => {
    const b = domEl('button', {}, document.body)
    expect(controlOf(domEl('span', {}, b), 'button')).toBe(b)
    expect(controlOf(b, 'button')).toBe(b)
  })
  it('a surface, where the pointer is on it — and only there', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const card = domEl('div', { role: 'dialog' }, dim)
    const text = domEl('p', {}, card)
    const close = domEl('button', {}, card)
    expect(controlOf(dim, 'button')).toBe(dim)
    expect(controlOf(card, 'button')).toBe(null) // drawn over the dim: not the dim's press
    expect(controlOf(text, 'button')).toBe(null)
    expect(controlOf(close, 'button')).toBe(close) // a button on the card is its own control
  })
  it('an announced-unavailable button is nothing, and so is no element at all', () => {
    expect(controlOf(domEl('button', { 'aria-disabled': 'true' }, document.body), 'button')).toBe(
      null,
    )
    expect(controlOf(null, 'button')).toBe(null)
    expect(controlOf(document, 'button')).toBe(null)
  })
})

describe('pointerGestures.menuFor — explicit trigger→menu pairing via aria-controls', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('resolves the mounted element the trigger names', () => {
    const menu = domEl('div', { id: 'paired-menu' }, document.body)
    const trigger = domEl('button', { 'aria-controls': 'paired-menu' }, document.body)
    expect(menuFor(trigger)).toBe(menu)
  })
  it('names an id that is NOT in the DOM (menu closed/unmounted) → null (gesture inert)', () => {
    const trigger = domEl('button', { 'aria-controls': 'not-mounted' }, document.body)
    expect(menuFor(trigger)).toBe(null)
  })
  it('no aria-controls attribute → null', () => {
    expect(menuFor(domEl('button', {}, document.body))).toBe(null)
  })
  it('null trigger → null', () => {
    expect(menuFor(null)).toBe(null)
  })
})

describe('pointerGestures.bandDirection — edge-band membership (scroller top/bottom = 100/400)', () => {
  it('within EDGE of the top → -1 (scroll up)', () => {
    expect(bandDirection(100, 100, 400)).toBe(-1)
    expect(bandDirection(100 + EDGE - 1, 100, 400)).toBe(-1)
  })
  it('within EDGE of the bottom → 1 (scroll down)', () => {
    expect(bandDirection(400, 100, 400)).toBe(1)
    expect(bandDirection(400 - EDGE + 1, 100, 400)).toBe(1)
  })
  it('between the bands (and exactly ON a band boundary) → 0 (no auto-scroll)', () => {
    expect(bandDirection(250, 100, 400)).toBe(0)
    expect(bandDirection(100 + EDGE, 100, 400)).toBe(0)
    expect(bandDirection(400 - EDGE, 100, 400)).toBe(0)
  })
  it('past the scroller edges (finger drifted off the panel) still engages the near band', () => {
    expect(bandDirection(20, 100, 400)).toBe(-1)
    expect(bandDirection(480, 100, 400)).toBe(1)
  })
})

describe('pointerGestures.scrollDelta — px/SECOND auto-scroll speed math', () => {
  it('full speed at (or clamped at, past) the edge', () => {
    expect(scrollDelta(10, 0)).toBeCloseTo(MAX_SPEED * 0.01, 10)
    expect(scrollDelta(10, -30)).toBeCloseTo(MAX_SPEED * 0.01, 10)
  })
  it("ramps linearly to zero at the band's inner limit (and never past it)", () => {
    expect(scrollDelta(10, EDGE / 2)).toBeCloseTo((MAX_SPEED * 0.01) / 2, 10)
    expect(scrollDelta(10, EDGE)).toBe(0)
    expect(scrollDelta(10, EDGE * 2)).toBe(0)
  })
  it('scales with the frame delta — frame-rate independent (120Hz ticks = half the px of 60Hz ticks)', () => {
    expect(scrollDelta(20, 0)).toBeCloseTo(scrollDelta(10, 0) * 2, 10)
  })
  it('clamps runaway frame deltas (tab jank/suspend) to the 40ms cap', () => {
    expect(scrollDelta(10000, 0)).toBeCloseTo(scrollDelta(40, 0), 10)
  })
  it('a negative delta contributes nothing', () => {
    expect(scrollDelta(-16, 0)).toBe(0)
  })
})

// ── Controller integration: pointer latch + click suppression. installPointerGestures runs against the
// real jsdom document; elementFromPoint (no layout in jsdom) is stubbed to return whatever `hit` holds,
// and pointer events are synthesized as MouseEvents carrying pointerId/isPrimary/pointerType.
describe('pointerGestures controller — pointer latch + click suppression', () => {
  let uninstall
  let hit
  let origEFP
  const ptr = (type, o = {}) => {
    const e = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: o.button ?? 0,
      clientX: o.x ?? 0,
      clientY: o.y ?? 0,
    })
    Object.defineProperty(e, 'pointerId', { value: o.pointerId ?? 1 })
    Object.defineProperty(e, 'isPrimary', { value: o.isPrimary ?? true })
    Object.defineProperty(e, 'pointerType', { value: o.pointerType ?? 'touch' })
    return e
  }
  const btn = (parent = document.body) => domEl('button', {}, parent)
  const clicksOn = (node) => {
    const spy = vi.fn()
    node.addEventListener('click', spy)
    return spy
  }
  beforeEach(() => {
    origEFP = document.elementFromPoint
    document.elementFromPoint = () => hit
    hit = null
    uninstall = installPointerGestures()
  })
  afterEach(() => {
    uninstall()
    if (origEFP) document.elementFromPoint = origEFP
    else delete document.elementFromPoint
    document.body.innerHTML = ''
  })

  it('slide-off arms suppression, and the swallowed click CONSUMES it (the next click passes)', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown'))
    hit = b // released over a different button
    document.dispatchEvent(ptr('pointerup'))
    a.click() // the browser's delayed click on the pressed button
    expect(aClicks).not.toHaveBeenCalled()
    a.click() // a later REAL tap must not be swallowed
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('release ON the same button → no suppression (the native click passes)', () => {
    const a = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown'))
    hit = a
    document.dispatchEvent(ptr('pointerup'))
    a.click()
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('a second (non-primary) finger cannot clear an armed suppression', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown'))
    hit = null
    document.dispatchEvent(ptr('pointerup')) // release on nothing → suppression armed on a
    b.dispatchEvent(ptr('pointerdown', { pointerId: 2, isPrimary: false })) // second finger taps elsewhere
    a.click()
    expect(aClicks).not.toHaveBeenCalled() // still suppressed — the second finger changed nothing
  })

  it('the gesture is latched to its pointerId — a second finger can neither restart nor resolve it', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    const bClicks = clicksOn(b)
    a.dispatchEvent(ptr('pointerdown', { pointerId: 7 }))
    b.dispatchEvent(ptr('pointerdown', { pointerId: 8, isPrimary: false })) // ignored (latched)
    hit = b
    document.dispatchEvent(ptr('pointerup', { pointerId: 8, isPrimary: false })) // ignored (wrong id)
    document.dispatchEvent(ptr('pointerup', { pointerId: 7 })) // the REAL release: slid off a onto b
    a.click()
    expect(aClicks).not.toHaveBeenCalled() // pointer 7 still owned the gesture → slide-off suppressed a
    expect(bClicks).not.toHaveBeenCalled() // and pointer 8 activated nothing
  })

  it('a stale TOUCH latch (lost pointerup/cancel) self-heals: the next primary touch press starts fresh', () => {
    const a = btn()
    const b = btn()
    // Touch contact 7 latches a gesture, then its pointerup/pointercancel are LOST (iOS suspending
    // the PWA mid-press). Touch contacts get fresh pointerIds, so the next press arrives as a NEW id
    // — but it's PRIMARY, which proves contact 7 already ended: the stale latch must clear.
    a.dispatchEvent(ptr('pointerdown', { pointerId: 7 }))
    b.dispatchEvent(ptr('pointerdown', { pointerId: 9 })) // new primary touch → stale latch cleared, b's gesture starts
    const bClicks = clicksOn(b)
    hit = b
    document.dispatchEvent(ptr('pointerup', { pointerId: 9 }))
    b.click() // release ON the pressed button → the native click passes (no suppression)
    expect(bClicks).toHaveBeenCalledTimes(1)
  })

  it('a primary press of a DIFFERENT pointer type never steals a live gesture', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown', { pointerId: 7 })) // touch gesture live
    // A mouse press is primary for ITS type even while a touch is down — it says nothing about the
    // touch latch and must be ignored, not treated as a stale-latch reset.
    b.dispatchEvent(ptr('pointerdown', { pointerId: 1, pointerType: 'mouse' }))
    hit = a
    document.dispatchEvent(ptr('pointerup', { pointerId: 7 })) // the touch resolves its own gesture normally
    a.click()
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('a right-click neither starts a gesture nor clears an armed suppression (a left press does clear)', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown'))
    hit = null
    document.dispatchEvent(ptr('pointerup')) // arm suppression on a
    b.dispatchEvent(ptr('pointerdown', { pointerType: 'mouse', button: 2 })) // right-click elsewhere
    a.click()
    expect(aClicks).not.toHaveBeenCalled() // right-click didn't clear it
    a.dispatchEvent(ptr('pointerdown'))
    hit = null
    document.dispatchEvent(ptr('pointerup')) // re-arm
    document.body.dispatchEvent(ptr('pointerdown', { pointerType: 'mouse' })) // a normal next press clears
    a.click()
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('group drag hilite: nothing on press or while resting on the pressed option; appears after leaving and follows the finger back', () => {
    const grid = domEl('div', { 'data-answer-grid': '' }, document.body)
    const a = domEl('button', {}, grid)
    const b = domEl('button', {}, grid)
    hit = a
    a.dispatchEvent(ptr('pointerdown'))
    expect(a.classList.contains('drag-target')).toBe(false) // no ring flash on press
    document.dispatchEvent(ptr('pointermove'))
    expect(a.classList.contains('drag-target')).toBe(false) // resting on the start: still none
    hit = b
    document.dispatchEvent(ptr('pointermove'))
    expect(b.classList.contains('drag-target')).toBe(true) // left the start → the member under the finger
    hit = a
    document.dispatchEvent(ptr('pointermove'))
    expect(a.classList.contains('drag-target')).toBe(true) // returning to the start AFTER leaving hilites it
    expect(b.classList.contains('drag-target')).toBe(false)
    document.dispatchEvent(ptr('pointerup'))
    expect(a.classList.contains('drag-target')).toBe(false) // release always clears the ring
  })

  it('trigger flow: aria-controls pairs the menu; drag-release clicks the member and drag-dismiss bubbles from it', () => {
    const trigger = domEl(
      'button',
      { 'data-select-trigger': '', 'aria-controls': 'menu-x' },
      document.body,
    )
    const menu = domEl('div', { id: 'menu-x', 'data-drag-dismiss': '' })
    const opt = domEl('button', {}, menu)
    const optClicks = clicksOn(opt)
    const dismiss = vi.fn()
    document.addEventListener('drag-dismiss', dismiss)
    trigger.dispatchEvent(ptr('pointerdown')) // the trigger's own pointerdown opens…
    document.body.appendChild(menu) // …the menu, which mounts a React render later
    hit = opt
    document.dispatchEvent(ptr('pointerup'))
    expect(optClicks).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(dismiss.mock.calls[0][0].target).toBe(opt) // bubbled FROM the member
    const trigClicks = clicksOn(trigger)
    trigger.click() // the browser's delayed click on the trigger — must not double-toggle
    expect(trigClicks).not.toHaveBeenCalled()
    document.removeEventListener('drag-dismiss', dismiss)
  })

  it('trigger flow: a WITHHELD member is never ringed and never activated — the ⚙ trio regression round 15 opened', () => {
    // The gesture is the app's signature one: press the ⚙ gear, drag into the panel, release on a
    // control. The panel holds three buttons that go aria-disabled when the app has nothing
    // to save / reset / clear. Round 15 took pointer-events-none off them so the not-allowed cursor could
    // paint — and pointer-events-none was the only thing keeping them out of this controller, so the
    // ring started appearing on a greyed-out button that then did nothing on release. A ring is a
    // promise that a release will act; this asserts the promise is never made.
    // ⚠ THE STAY MEMBER IS PART OF THE SHAPE, not decoration: the real button block carries
    // data-drag-stay, so even the release path resolved dismiss:false and the whole defect was
    // VISUAL. Nothing but a hilite assertion could have caught it.
    const trigger = domEl(
      'button',
      { 'data-select-trigger': '', 'aria-controls': 'menu-w' },
      document.body,
    )
    const menu = domEl('div', { id: 'menu-w', 'data-drag-dismiss': '' })
    const footer = domEl('div', { 'data-drag-stay': '' }, menu)
    const withheld = domEl('button', { 'aria-disabled': 'true' }, footer)
    const live = domEl('button', {}, footer)
    const withheldClicks = clicksOn(withheld)
    trigger.dispatchEvent(ptr('pointerdown'))
    document.body.appendChild(menu)
    hit = withheld
    document.dispatchEvent(ptr('pointermove'))
    expect(withheld.classList.contains('drag-target')).toBe(false) // no ring on a withheld control
    // …and the one beside it, offered, still rings — so this is a filter, not a dead hilite path.
    hit = live
    document.dispatchEvent(ptr('pointermove'))
    expect(live.classList.contains('drag-target')).toBe(true)
    hit = withheld
    document.dispatchEvent(ptr('pointerup'))
    expect(withheldClicks).not.toHaveBeenCalled() // nor does the release synthesize a click on it
  })

  it('a press that STARTS on a withheld button latches no gesture at all', () => {
    // The other half of the same rule, and the one that keeps a stray click-suppression from being
    // armed: with the start filtered, a dimmed panel button behaves exactly as it did when
    // pointer-events-none meant the pointerdown never found a button in the first place. Were the
    // start left unfiltered, targetAt would resolve its own release to null, resolveRelease would
    // read that as a slide-off, and the button's next second of clicks would be swallowed.
    const withheld = domEl('button', { 'aria-disabled': 'true' }, document.body)
    const clicks = clicksOn(withheld)
    withheld.dispatchEvent(ptr('pointerdown'))
    hit = null
    document.dispatchEvent(ptr('pointerup'))
    withheld.click() // the browser's own click still arrives — and must not be suppressed
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('trigger flow: releasing on a data-drag-focus member FOCUSES it — no click, no dismiss', () => {
    const trigger = domEl(
      'button',
      { 'data-select-trigger': '', 'aria-controls': 'menu-y' },
      document.body,
    )
    const menu = domEl('div', { id: 'menu-y', 'data-drag-dismiss': '' })
    const input = domEl('input', { 'data-drag-focus': '' }, menu)
    const inputClicks = clicksOn(input)
    const dismiss = vi.fn()
    document.addEventListener('drag-dismiss', dismiss)
    trigger.dispatchEvent(ptr('pointerdown'))
    document.body.appendChild(menu)
    hit = input
    document.dispatchEvent(ptr('pointerup'))
    expect(document.activeElement).toBe(input)
    expect(inputClicks).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
    document.removeEventListener('drag-dismiss', dismiss)
  })

  it('trigger flow: a press whose menu never appears (a CLOSING press) is inert beyond the click suppression', () => {
    const trigger = domEl(
      'button',
      { 'data-select-trigger': '', 'aria-controls': 'gone' }, // the panel just unmounted
      document.body,
    )
    trigger.dispatchEvent(ptr('pointerdown'))
    hit = trigger
    document.dispatchEvent(ptr('pointerup'))
    const trigClicks = clicksOn(trigger)
    trigger.click()
    expect(trigClicks).not.toHaveBeenCalled() // suppressed — pointerdown already toggled
  })

  // ── pointercancel (fixed 2026-08-07) ──────────────────────────────────────────────────────────
  // A gesture the system takes away (the touch became a scroll, the app was suspended mid-press)
  // arrives with no release point. For a [data-select-trigger] the browser's follow-on click is a
  // SECOND toggle — pointerdown already opened the menu — so it must be suppressed. For every other
  // button that click is a FIRST activation, so the cancel path leaves it strictly alone.
  it('a cancelled press on an ORDINARY button changes nothing — its delayed click still activates it', () => {
    // The scope guard. Suppressing here would be a NEW rule (onUp only suppresses when the release
    // target isn't the start button — a finger that never moved releases ON it and the click passes),
    // and its failure mode is eating an answer whose grid the engine reclaimed as a pan.
    const a = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown'))
    document.dispatchEvent(ptr('pointercancel'))
    a.click() // the click the browser delivers after the cancel
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('a cancelled press on the MODE SELECTOR cannot double-toggle it (open-then-instantly-shut)', () => {
    // The mode selector toggles on POINTERDOWN, so a click arriving after the cancel is a SECOND
    // toggle: the menu opens on the press and shuts again in the same gesture. This is the exact
    // shape of the owner's "the menu will not stay open" report, and reverting onCancel's
    // armSuppress makes this fail.
    const trigger = domEl(
      'button',
      { 'data-select-trigger': '', 'aria-controls': 'menu-c' },
      document.body,
    )
    const menu = domEl('div', { id: 'menu-c' })
    const trigClicks = clicksOn(trigger)
    trigger.dispatchEvent(ptr('pointerdown')) // opens the menu…
    document.body.appendChild(menu)
    document.dispatchEvent(ptr('pointercancel')) // …then iOS takes the touch away
    trigger.click()
    expect(trigClicks).not.toHaveBeenCalled() // no second toggle: the menu stays open
    trigger.click() // …and the arming is spent, so the next real tap still toggles
    expect(trigClicks).toHaveBeenCalledTimes(1)
  })

  it('…and so does a cancelled press on the ⚙ SETTINGS trigger, whose aria-controls appears only after', () => {
    // The gear's shape differs from the mode selector's: it carries data-select-trigger always but
    // names its panel (aria-controls="settings-popover") only while OPEN, so at pointerdown there is
    // no menu to pair with. The marker alone is what the cancel path keys on, so the closed→open
    // gear is covered too — main.tsx's gear carries the same onPointerDown-toggle + onClick-toggle
    // pair the mode selector does, and would double-toggle identically without this.
    const gear = domEl('button', { 'data-select-trigger': '' }, document.body)
    const gearClicks = clicksOn(gear)
    gear.dispatchEvent(ptr('pointerdown')) // opens the panel…
    gear.setAttribute('aria-controls', 'settings-popover')
    domEl('div', { id: 'settings-popover' }, document.body)
    document.dispatchEvent(ptr('pointercancel'))
    gear.click()
    expect(gearClicks).not.toHaveBeenCalled() // the panel stays open
  })

  it('a cancel belonging to ANOTHER pointer leaves the live gesture (and its outcome) alone', () => {
    const a = btn()
    const b = btn()
    const aClicks = clicksOn(a)
    a.dispatchEvent(ptr('pointerdown', { pointerId: 7 }))
    document.dispatchEvent(ptr('pointercancel', { pointerId: 8, isPrimary: false })) // must be ignored
    hit = b
    document.dispatchEvent(ptr('pointerup', { pointerId: 7 })) // pointer 7's real release: slid off a
    a.click()
    expect(aClicks).not.toHaveBeenCalled() // the slide-off still resolved → had the foreign cancel
    // ended the gesture, onUp would have bailed and this click would have gone through
  })
})

// ── Round 26: a touch that is not a quick tap is pressed by the controller (the owner's iPhone: a long
// or moved press that lifts on its button brings pointerup + touchend and NO click), and the second tap
// of a double tap is withheld at its touchstart (the text magnifier). The browser's click is simulated
// with .click(); a touch event is a plain Event carrying `touches`, which is all the controller reads.
describe('pointerGestures.scrollPlaces / movedSince — a scroll is a box that MOVED since the press', () => {
  afterEach(() => (document.body.innerHTML = ''))
  it('records every box holding the control, the page included, and says moved only when one has', () => {
    const outer = domEl('div', {}, document.body)
    const inner = domEl('div', {}, outer)
    const button = domEl('button', {}, inner)
    inner.scrollTop = 30
    const places = scrollPlaces(button)
    const page = document.scrollingElement ?? document.documentElement
    for (const box of [inner, outer, document.body, page])
      expect(places.some((p) => p.box === box)).toBe(true)
    expect(movedSince(places, inner)).toBe(false) // reported, but where it was at the press
    expect(movedSince(places, document)).toBe(false)
    inner.scrollTop = 31
    expect(movedSince(places, inner)).toBe(true)
    inner.scrollLeft = 5
    expect(movedSince(places, outer)).toBe(false)
    page.scrollTop = 12
    expect(movedSince(places, document)).toBe(true)
    page.scrollTop = 0
  })
  it('a box with no place recorded counts as moved, as every reported scroll once did', () => {
    const button = domEl('button', {}, document.body)
    expect(movedSince(scrollPlaces(button), domEl('div', {}, document.body))).toBe(true)
  })
})

describe('pointerGestures.pressedHere — a quick, still tap stays the browser’s; anything else is pressed here', () => {
  it('a quick still tap → the browser’s click', () => {
    expect(pressedHere(0, 0, false)).toBe(false)
    expect(pressedHere(TAP_MS - 1, TAP_SLOP_PX - 0.1, false)).toBe(false)
  })
  it('held to TAP_MS, or wandered TAP_SLOP_PX → pressed here', () => {
    expect(pressedHere(TAP_MS, 0, false)).toBe(true)
    expect(pressedHere(4196, 0, false)).toBe(true) // the owner's logged hold
    expect(pressedHere(0, TAP_SLOP_PX, false)).toBe(true)
  })
  it('a withheld touch (its touchstart cancelled) → pressed here however quick: no click is coming', () => {
    expect(pressedHere(0, 0, true)).toBe(true)
  })
  it('the limits sit under the engines’ own (Chromium: 400 ms long press, 8 px slop) and the window over a double tap', () => {
    expect(TAP_MS).toBeLessThan(400)
    expect(TAP_SLOP_PX).toBeLessThan(8)
    expect(DOUBLE_TAP_MS).toBeGreaterThanOrEqual(300)
  })
})

describe('pointerGestures.withholdsSecondTap — where a double tap’s second touch is cancelled', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('a control, the gaps of an answer grid, and a popup’s dim', () => {
    const b = domEl('button', {}, document.body)
    const inner = domEl('span', {}, b)
    const grid = domEl('div', { 'data-answer-grid': '' }, document.body)
    expect(withholdsSecondTap(b)).toBe(true)
    expect(withholdsSecondTap(inner)).toBe(true)
    expect(withholdsSecondTap(grid)).toBe(true)
    expect(withholdsSecondTap(domEl('div', { 'data-press-surface': '' }, document.body))).toBe(true)
  })
  it('…and everything that presses nothing — a label, a stat’s number, the page — where the lens is all there is to stop', () => {
    const row = domEl('div', {}, document.body)
    expect(withholdsSecondTap(domEl('span', {}, row))).toBe(true) // a label
    expect(withholdsSecondTap(domEl('span', { class: 'tabular-nums' }, row))).toBe(true) // a number
    expect(withholdsSecondTap(row)).toBe(true)
    expect(withholdsSecondTap(document.body)).toBe(true)
    // An announced-unavailable button: no click was going to act, so nothing is lost but the lens.
    expect(withholdsSecondTap(domEl('button', { 'aria-disabled': 'true' }, document.body))).toBe(
      true,
    )
  })
  it('never text a player can select or type in — not even inside a control', () => {
    const b = domEl('button', {}, document.body)
    const title = domEl('span', { class: 'select-text' }, b)
    expect(withholdsSecondTap(title)).toBe(false)
    expect(withholdsSecondTap(domEl('input', {}, document.body))).toBe(false)
    expect(withholdsSecondTap(domEl('input', { type: 'range' }, document.body))).toBe(false)
    expect(withholdsSecondTap(domEl('textarea', {}, document.body))).toBe(false)
    expect(withholdsSecondTap(domEl('div', { contenteditable: 'true' }, document.body))).toBe(false)
  })
  it('never a link — the browser presses it — and nothing at all for no element', () => {
    const link = domEl('a', { href: 'mailto:x@y.z' }, document.body)
    expect(withholdsSecondTap(link)).toBe(false)
    expect(withholdsSecondTap(domEl('span', {}, link))).toBe(false)
    expect(withholdsSecondTap(null)).toBe(false)
  })

  // ★ SCROLLING IS NEVER GIVEN UP FOR THE LENS (the owner's ruling, Round 26): where a touch could
  // start a scroll, only a control's second touch is held back. jsdom lays nothing out, so a box
  // that holds more than it shows is said so here, through its scroll and client heights.
  const scroller = (overflow = 'auto', holds = 900, shows = 400) => {
    const box = domEl('div', { style: `overflow-y:${overflow}` }, document.body)
    Object.defineProperty(box, 'scrollHeight', { value: holds })
    Object.defineProperty(box, 'clientHeight', { value: shows })
    return box
  }
  it('in a box that can scroll nothing is held back — a label, a button, a popup’s dim — so a flick from it scrolls', () => {
    const box = scroller()
    const label = domEl('span', {}, domEl('div', {}, box))
    expect(canStartScroll(label)).toBe(true)
    expect(withholdsSecondTap(label)).toBe(false)
    expect(withholdsSecondTap(domEl('button', {}, box))).toBe(false)
    expect(withholdsSecondTap(domEl('span', {}, domEl('button', {}, box)))).toBe(false)
    expect(withholdsSecondTap(domEl('div', { 'data-press-surface': '' }, box))).toBe(false)
  })
  it('a box that cannot scroll (it shows all it holds, or its overflow does not scroll) holds back a label and a button', () => {
    expect(withholdsSecondTap(domEl('span', {}, scroller('auto', 400, 400)))).toBe(true)
    expect(withholdsSecondTap(domEl('span', {}, scroller('hidden')))).toBe(true)
    expect(withholdsSecondTap(domEl('button', {}, scroller('hidden')))).toBe(true)
  })
  it('a touch-action:none box between the touch and the scroller (an answer grid) cannot scroll: held', () => {
    const grid = domEl('div', { 'data-answer-grid': '', style: 'touch-action:none' }, scroller())
    expect(canStartScroll(grid)).toBe(false)
    expect(withholdsSecondTap(grid)).toBe(true)
  })
  it('the page itself, when it can scroll, counts as a scroller', () => {
    const label = domEl('span', {}, document.body)
    const page = { scrollHeight: 2000, clientHeight: 800 }
    Object.defineProperty(document, 'scrollingElement', { value: page, configurable: true })
    try {
      expect(withholdsSecondTap(label)).toBe(false)
      page.scrollHeight = 800 // a page that shows all it holds
      expect(withholdsSecondTap(label)).toBe(true)
    } finally {
      delete document.scrollingElement
    }
  })
})

describe('pointerGestures controller — touches that are not quick taps, and the magnifier', () => {
  let uninstall
  let hit
  let origEFP
  let now
  const ptr = (type, o = {}) => {
    const e = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: o.x ?? 0,
      clientY: o.y ?? 0,
    })
    Object.defineProperty(e, 'pointerId', { value: o.pointerId ?? 1 })
    Object.defineProperty(e, 'isPrimary', { value: true })
    Object.defineProperty(e, 'pointerType', { value: o.pointerType ?? 'touch' })
    return e
  }
  const touch = (type, fingers = 0, cancelable = true) => {
    const e = new Event(type, { bubbles: true, cancelable })
    Object.defineProperty(e, 'touches', { value: { length: fingers } })
    return e
  }
  // One whole touch, as the phone sends it: pointerdown, touchstart, [wander, wait], pointerup,
  // touchend. Returns the touchstart and the touchend, so a test can ask whether either was cancelled.
  // `during`: anything else that happens while the finger is down (a scroll, say), after the moves.
  const press = (el, { held = 0, at = el, via = [], endCancelable = true, during } = {}) => {
    hit = el
    el.dispatchEvent(ptr('pointerdown'))
    const start = touch('touchstart', 1)
    el.dispatchEvent(start)
    for (const [over, px] of via) {
      hit = over
      document.dispatchEvent(ptr('pointermove', { x: px }))
    }
    during?.()
    now += held
    hit = at
    document.dispatchEvent(ptr('pointerup'))
    const end = touch('touchend', 0, endCancelable)
    el.dispatchEvent(end)
    return { start, end }
  }
  const counted = (node) => {
    const spy = vi.fn()
    node.addEventListener('click', spy)
    return spy
  }
  beforeEach(() => {
    origEFP = document.elementFromPoint
    document.elementFromPoint = () => hit
    hit = null
    now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    uninstall = installPointerGestures()
  })
  afterEach(() => {
    uninstall()
    vi.restoreAllMocks()
    if (origEFP) document.elementFromPoint = origEFP
    else delete document.elementFromPoint
    document.body.innerHTML = ''
  })

  it('a quick, still tap is left to the browser: its click is the one press, and its touchend is not touched', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    const { end } = press(a, { held: 40 })
    expect(clicks).not.toHaveBeenCalled() // nothing pressed by the controller…
    expect(end.defaultPrevented).toBe(false)
    a.click() // …the browser's click, 5–9 ms later
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('a touch HELD on a button and lifted on it is pressed at the lift, once — the owner’s lost answer', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    const { end } = press(a, { held: 4196 })
    expect(clicks).toHaveBeenCalledTimes(1) // at pointerup, without waiting for a click
    expect(end.defaultPrevented).toBe(true) // the browser's own tap is withheld
    a.click() // a later, separate press (keyboard, screen reader) is not swallowed
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('…and where its touchend cannot be cancelled, the click that may follow is swallowed WHEREVER it lands', () => {
    const a = domEl('button', {}, document.body)
    const appeared = domEl('button', {}, document.body) // say, a popup's button the press just opened
    const aClicks = counted(a)
    const newClicks = counted(appeared)
    press(a, { held: TAP_MS, endCancelable: false })
    expect(aClicks).toHaveBeenCalledTimes(1)
    appeared.click() // the browser's late click, on what is under the finger NOW
    expect(newClicks).not.toHaveBeenCalled()
    appeared.click() // the arming is spent: a real press after it goes through
    expect(newClicks).toHaveBeenCalledTimes(1)
    expect(aClicks).toHaveBeenCalledTimes(1)
  })

  it('a touch that WANDERED and came back to its button is pressed, once', () => {
    const a = domEl('button', {}, document.body)
    const b = domEl('button', {}, document.body)
    const clicks = counted(a)
    press(a, { via: [[b, 143]] })
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('answer grid: dragged around the grid and lifted back on the FIRST answer → that answer, once', () => {
    const grid = domEl('div', { 'data-answer-grid': '' }, document.body)
    const mon = domEl('button', {}, grid)
    const tue = domEl('button', {}, grid)
    const monClicks = counted(mon)
    const tueClicks = counted(tue)
    const { end } = press(mon, { held: 3600, via: [[tue, 48]] })
    expect(monClicks).toHaveBeenCalledTimes(1)
    expect(tueClicks).not.toHaveBeenCalled()
    expect(end.defaultPrevented).toBe(true) // so the browser adds no click of its own
  })

  it('answer grid: lifted on ANOTHER answer → that answer, once, and the first never (unchanged)', () => {
    const grid = domEl('div', { 'data-answer-grid': '' }, document.body)
    const mon = domEl('button', {}, grid)
    const tue = domEl('button', {}, grid)
    const monClicks = counted(mon)
    const tueClicks = counted(tue)
    press(mon, { held: 2500, via: [[tue, 48]], at: tue })
    mon.click() // the browser's click on the pressed answer, if one comes
    expect(tueClicks).toHaveBeenCalledTimes(1)
    expect(monClicks).not.toHaveBeenCalled()
  })

  it('a touch the browser took for a SCROLL presses nothing, however it ends', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    hit = a
    a.dispatchEvent(ptr('pointerdown'))
    a.dispatchEvent(touch('touchstart', 1))
    now += 900
    document.dispatchEvent(ptr('pointercancel'))
    a.dispatchEvent(touch('touchend'))
    expect(clicks).not.toHaveBeenCalled()
  })

  it('slid off and lifted elsewhere: still cancelled, however long the hold', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    press(a, { held: 2000, at: null })
    a.click()
    expect(clicks).not.toHaveBeenCalled()
  })

  it('a MOUSE held long is the browser’s, as before: its click is the press', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    hit = a
    a.dispatchEvent(ptr('pointerdown', { pointerType: 'mouse' }))
    now += 4000
    document.dispatchEvent(ptr('pointerup', { pointerType: 'mouse' }))
    expect(clicks).not.toHaveBeenCalled()
    a.click()
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('a long press that began on SELECTABLE text inside a control is left to the browser (its selection, its lens)', () => {
    const header = domEl('button', {}, document.body)
    const title = domEl('span', { class: 'select-text' }, header)
    const clicks = counted(header)
    hit = title
    title.dispatchEvent(ptr('pointerdown'))
    now += 2000
    document.dispatchEvent(ptr('pointerup'))
    const end = touch('touchend')
    title.dispatchEvent(end)
    expect(clicks).not.toHaveBeenCalled()
    expect(end.defaultPrevented).toBe(false)
  })

  it('a press made here lets the keyboard go first, so a box being typed in commits BEFORE the press acts', () => {
    const box = domEl('input', { type: 'text' }, document.body)
    const a = domEl('button', {}, document.body)
    box.focus()
    let focusAtPress = null
    a.addEventListener('click', () => (focusAtPress = document.activeElement))
    press(a, { held: 1000 })
    expect(focusAtPress).not.toBe(box)
    expect(document.activeElement).not.toBe(box)
  })

  it('…unless the control keeps focus (data-keep-focus — Lookup and Clear beside the date box)', () => {
    const box = domEl('input', { type: 'text' }, document.body)
    const lookup = domEl('button', { 'data-keep-focus': '' }, document.body)
    box.focus()
    press(lookup, { held: 1000 })
    expect(document.activeElement).toBe(box)
  })

  it('data-keep-focus: the mousedown of a press the browser makes is cancelled, so focus stays where it is', () => {
    const lookup = domEl('button', { 'data-keep-focus': '' }, document.body)
    const other = domEl('button', {}, document.body)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    lookup.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    const plain = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    other.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })

  it('THE MAGNIFIER: a double tap’s second touch on a control is cancelled at touchstart — and still pressed, once', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    press(a, { held: 50 })
    a.click() // the first tap's own click from the browser
    expect(clicks).toHaveBeenCalledTimes(1)
    now += DOUBLE_TAP_MS - 50
    const { start, end } = press(a, { held: 600 }) // …and the second, held: the lens gesture
    expect(start.defaultPrevented).toBe(true)
    expect(end.defaultPrevented).toBe(true)
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('…even when the second tap is quick: it gets no click from the browser, so the controller presses it', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    press(a, { held: 50 })
    a.click()
    now += 100
    press(a, { held: 50 })
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('…not once the window has passed, not after a SCROLL (a flick after a flick still scrolls), not on text', () => {
    const a = domEl('button', {}, document.body)
    const box = domEl('input', { type: 'text' }, document.body)
    press(a, { held: 50 })
    now += DOUBLE_TAP_MS
    expect(press(a, { held: 50 }).start.defaultPrevented).toBe(false) // too late to be a double tap

    now += DOUBLE_TAP_MS // a scroll, then a touch right after it
    hit = a
    a.dispatchEvent(ptr('pointerdown'))
    a.dispatchEvent(touch('touchstart', 1))
    document.dispatchEvent(ptr('pointercancel'))
    a.dispatchEvent(touch('touchend'))
    now += 50
    expect(press(a, { held: 50 }).start.defaultPrevented).toBe(false)

    now += 50 // a tap has just ended: a box still keeps its own double tap
    const onBox = touch('touchstart', 1)
    box.dispatchEvent(onBox)
    expect(onBox.defaultPrevented).toBe(false)
  })

  it('a second finger’s touchstart is never withheld', () => {
    const a = domEl('button', {}, document.body)
    press(a, { held: 50 })
    now += 50
    const second = touch('touchstart', 2)
    a.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
  })

  it('THE MAGNIFIER over what presses nothing: a second touch on a label is cancelled too, and presses nothing', () => {
    const a = domEl('button', {}, document.body)
    const label = domEl('span', {}, document.body)
    const pageClicks = counted(document.body)
    press(a, { held: 50 })
    a.click()
    now += 100
    const { start, end } = press(label, { held: 600 })
    expect(start.defaultPrevented).toBe(true) // no double tap for iOS to answer with its lens
    expect(end.defaultPrevented).toBe(false) // no press was made here, so there is none to withhold
    expect(pageClicks).toHaveBeenCalledTimes(1) // the button's own click, and nothing from the label
  })

  it('A POPUP’S DIM: held and lifted on it, it is pressed at the lift, once — the click it closes on', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const clicks = counted(dim)
    const { end } = press(dim, { held: 2000 })
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(clicks.mock.calls[0][0].target).toBe(dim) // on the dim's bare self: a tap on the dim
    expect(end.defaultPrevented).toBe(true)
  })

  it('…a quick tap on it is the browser’s click, as before', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const clicks = counted(dim)
    const { end } = press(dim, { held: 40 })
    expect(clicks).not.toHaveBeenCalled()
    expect(end.defaultPrevented).toBe(false)
  })

  it('…a press that began on the card drawn over it is no press of the dim, however long', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const card = domEl('div', { role: 'dialog' }, dim)
    const clicks = counted(dim)
    const { end } = press(card, { held: 2000 })
    expect(clicks).not.toHaveBeenCalled()
    expect(end.defaultPrevented).toBe(false)
  })

  it('…and a press on the dim slid onto the card is cancelled: its click, if one comes, is swallowed', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const card = domEl('div', { role: 'dialog' }, dim)
    const clicks = counted(dim)
    press(dim, { held: 2000, via: [[card, 80]], at: card })
    expect(clicks).not.toHaveBeenCalled()
    dim.click() // a mouse's click lands on the element holding both ends: the dim
    expect(clicks).not.toHaveBeenCalled()
  })

  it('…and a box being typed in on the card lets go before the dim is pressed, as a tap on the dim makes it', () => {
    const dim = domEl('div', { 'data-press-surface': '' }, document.body)
    const card = domEl('div', { role: 'dialog' }, dim)
    const box = domEl('input', { type: 'text' }, card)
    box.focus()
    let focusAtPress = null
    dim.addEventListener('click', () => (focusAtPress = document.activeElement))
    press(dim, { held: 1000 })
    expect(focusAtPress).not.toBe(box)
  })

  // ★ A TOUCH THAT SCROLLED ANYTHING IS A SCROLL (Round 26, the owner's "Open in" report): iOS can
  // end a touch that scrolled an inner region in a plain pointerup on the control it started on —
  // no pointercancel — and that used to be pressed as a "moved" touch.
  // A scroll MOVES its box and is then reported, as a browser does (onScroll's ⚠ is why both).
  const scrolls = (node) => {
    const box = node === document ? (document.scrollingElement ?? document.documentElement) : node
    box.scrollTop += 40
    node.dispatchEvent(new Event('scroll'))
  }
  it('a touch during which the region holding its button scrolled presses nothing — and no click it brings either', () => {
    const region = domEl('div', {}, document.body)
    const pill = domEl('button', {}, region)
    const clicks = counted(pill)
    press(pill, { held: 600, via: [[pill, 60]], during: () => scrolls(region) })
    expect(clicks).not.toHaveBeenCalled()
    pill.click() // a click a browser might still send for the scroll
    expect(clicks).not.toHaveBeenCalled()
    // …and the next real press is a press.
    press(pill, { held: 600 })
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  // ★ A SCROLL REPORTED DURING A PRESS IS NOT A SCROLL DURING IT (onScroll's ⚠): the browser reports
  // a scroll at the next frame it draws, so one that ended before the press — here the region moved,
  // and pressed, before its report arrives — can be heard mid-press. Found as a flaky lane test (How
  // to Play's headers, scrolled into view and pressed in one frame on a loaded machine).
  it('a scroll that happened BEFORE the press, reported during it, does not stop the press', () => {
    const region = domEl('div', {}, document.body)
    const pill = domEl('button', {}, region)
    const clicks = counted(pill)
    region.scrollTop = 120 // scrolled into view…
    press(pill, { held: 600, during: () => region.dispatchEvent(new Event('scroll')) }) // …reported late
    expect(clicks).toHaveBeenCalledTimes(1)
    // …and the same for the page.
    const page = document.scrollingElement ?? document.documentElement
    page.scrollTop = 80
    press(pill, { held: 600, during: () => document.dispatchEvent(new Event('scroll')) })
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('…the page scrolling counts too; a scroll of something that does NOT hold the button does not', () => {
    const pill = domEl('button', {}, document.body)
    const elsewhere = domEl('div', {}, document.body)
    const clicks = counted(pill)
    press(pill, { held: 600, during: () => scrolls(elsewhere) })
    expect(clicks).toHaveBeenCalledTimes(1)
    press(pill, { held: 600, during: () => scrolls(document) })
    expect(clicks).toHaveBeenCalledTimes(1)
  })

  it('an open list: a slide rings the option under the finger only once it is on ANOTHER one, and lifting there picks it', () => {
    const list = domEl('div', { role: 'listbox', 'data-select-group': '' }, document.body)
    const a = domEl('button', {}, list)
    const b = domEl('button', {}, list)
    const [aClicks, bClicks] = [counted(a), counted(b)]
    hit = a
    a.dispatchEvent(ptr('pointerdown'))
    document.dispatchEvent(ptr('pointermove', { x: 2 }))
    expect(a.classList.contains('drag-target')).toBe(false) // a plain touch rings nothing
    hit = b
    document.dispatchEvent(ptr('pointermove', { x: 40 }))
    expect(b.classList.contains('drag-target')).toBe(true)
    document.dispatchEvent(ptr('pointerup'))
    expect(bClicks).toHaveBeenCalledTimes(1)
    expect(aClicks).not.toHaveBeenCalled()
    expect(b.classList.contains('drag-target')).toBe(false)
  })

  it('…and a slide that SCROLLS the list picks nothing and drops its ring', () => {
    const list = domEl('div', { role: 'listbox', 'data-select-group': '' }, document.body)
    const a = domEl('button', {}, list)
    const b = domEl('button', {}, list)
    const bClicks = counted(b)
    hit = a
    a.dispatchEvent(ptr('pointerdown'))
    hit = b
    document.dispatchEvent(ptr('pointermove', { x: 40 }))
    expect(b.classList.contains('drag-target')).toBe(true)
    scrolls(list)
    expect(b.classList.contains('drag-target')).toBe(false)
    document.dispatchEvent(ptr('pointermove', { x: 50 }))
    expect(b.classList.contains('drag-target')).toBe(false)
    document.dispatchEvent(ptr('pointerup'))
    expect(bClicks).not.toHaveBeenCalled()
  })

  it('keyboard and screen-reader presses (a click with no pointer events) are untouched before and after', () => {
    const a = domEl('button', {}, document.body)
    const clicks = counted(a)
    a.click()
    press(a, { held: 1000 })
    a.click()
    expect(clicks).toHaveBeenCalledTimes(3)
  })
})
