// @vitest-environment jsdom
//
// pointerGestures — the pure decisions + latch/suppression contracts behind press-drag-release
// input. resolveRelease / resolveTriggerRelease / nextHilite / menuFor / bandDirection / scrollDelta are
// pure (or layout-free DOM reads) and tested directly; the controller's pointer latch, click suppression
// and group-drag hilite are tested by installing it and dispatching synthetic pointer events with a
// stubbed elementFromPoint. The full wiring (real pointer drags, hit-testing, edge auto-scroll feel) is
// verified on-device — jsdom has no layout engine, so elementFromPoint/getBoundingClientRect don't work
// there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  gestureTarget,
  resolveRelease,
  resolveTriggerRelease,
  nextHilite,
  menuFor,
  bandDirection,
  scrollDelta,
  EDGE,
  MAX_SPEED,
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
  it('member inside a [data-drag-stay] container → click, no dismiss (the footer rows)', () => {
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
// block from the ⚙ footer's three buttons is what made the rule need saying out loud.
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

  it('trigger flow: a WITHHELD member is never ringed and never activated — the ⚙ footer regression round 15 opened', () => {
    // The gesture is the app's signature one: press the ⚙ gear, drag into the panel, release on a
    // control. The panel's footer holds three buttons that go aria-disabled when the app has nothing
    // to save / reset / clear. Round 15 took pointer-events-none off them so the not-allowed cursor could
    // paint — and pointer-events-none was the only thing keeping them out of this controller, so the
    // ring started appearing on a greyed-out button that then did nothing on release. A ring is a
    // promise that a release will act; this asserts the promise is never made.
    // ⚠ THE STAY MEMBER IS PART OF THE SHAPE, not decoration: the real footer row carries
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
    // armed: with the start filtered, a dimmed footer button behaves exactly as it did when
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
