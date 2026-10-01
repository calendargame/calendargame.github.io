// ─────────────────────────────────────────────────────────────────────────
// lib/pointerGestures.ts — the global press-drag-release input controller.
//
// Makes button activation RELEASE-based instead of press-based, with three behaviours:
//
//   • SLIDE-OFF-TO-CANCEL (every <button>): a press fires the button only if you RELEASE on it. Slide
//     your finger off and release → nothing happens (cancelled). This matches the mobile convention and
//     what a desktop mouse already does, and finally lets you escape a misclick. (Today on touch the
//     browser's implicit pointer-capture fires the ORIGINAL button no matter where the finger drifts.)
//
//   • DRAG-TO-SELECT (inside a [data-answer-grid] or [data-select-group] — "selection groups"): press an
//     option, drag across (the option under your finger highlights live — but only once you've LEFT the
//     pressed option, so a plain tap never flashes the ring; see nextHilite), release on an option →
//     THAT option activates; release outside → cancel. So a wrong first touch can be corrected by
//     sliding to the right one. Outside a group, dragging onto another button never activates it — the
//     gesture belongs to the button you pressed.
//
//   • PRESS-DRAG MENU: a press on a [data-select-trigger] (the mode selector, or the ⚙ Settings
//     button) whose own pointerdown opens a menu — you can drag straight into the menu and release on an
//     option to pick it, in one gesture. The trigger NAMES its menu via aria-controls, resolved live by
//     id (menuFor) since the menu mounts a React render after pointerdown; a press that CLOSED the menu
//     resolves to nothing and the gesture is inert. The menu is whatever element that id names — the
//     mode menu (a [data-select-group]) or the Settings panel card (deliberately NOT a drag-select
//     group, so a drag that STARTS inside the panel still scrolls natively instead of selecting).
//     Release resolution inside a
//     menu is widened to [data-drag-focus] opt-ins (the Year Range inputs): releasing on one FOCUSES it
//     (typing can start) instead of clicking. After a click-activation, a menu marked data-drag-dismiss
//     is asked to close via a bubbling "drag-dismiss" CustomEvent from the member (App listens and closes
//     Settings — its apply-on-close pass then runs naturally) unless the member sits inside a
//     [data-drag-stay] opt-out container (both footer rows, which must stay open).
//     For a menu taller than its viewport, dragging near its scroller's ([data-drag-scroll] wrapper, else
//     the menu itself) top/bottom edge AUTO-SCROLLS it so options below the fold are reachable in the one
//     gesture (autoScroll, below). Because the trigger toggles on pointerdown, its click is ALWAYS
//     suppressed (else it would double-toggle); a quick tap with no menu-open still toggles via pointerdown.
//
// HOW: one set of document capture-phase Pointer-Event listeners (unifying mouse + touch + pen). The
// gesture LATCHES onto the first PRIMARY pointer: onDown ignores non-primary pointers (a second finger
// can neither restart the gesture nor clear an armed click-suppression), and onMove/onUp/onCancel
// ignore every other pointerId. A PRIMARY press of the latched pointer's OWN type while latched means
// the latched contact already ended with its up/cancel LOST (only one pointer of a type is primary at a
// time) — the stale gesture is cleared and the press starts fresh, so a wedged latch self-heals instead
// of eating every future gesture (see onDown). On `pointerup` we read the
// element under the release point (elementFromPoint) and decide. To override the native click — which on
// touch targets the pressed button regardless of drift — we SUPPRESS it in a capture-phase `click`
// listener (it runs before React's root listener, so a suppressed click never reaches the component's
// onClick), and for a drag-to-select we synthesize a `.click()` on the release member instead. Programmatic
// `.click()`s — the keyboard shortcut handler (main.tsx: Tab → the mode trigger, 0–9 → the answer grid, the
// [data-key] walk) and PillGroup's roving-focus arrows — pass through that same capture listener and so are
// NOT exempt by construction: one is swallowed if it targets the exact element an armed suppression names,
// while that arming is live (armed by a slide-off release, or by a cancelled press on a [data-select-trigger]
// — see onCancel; cleared when a click consumes it, when the next pointerdown lands, or by armSuppress's 1s
// fallback). Reaching that needs a keyboard activation of the very button a gesture just cancelled on, within
// a second of it — and the swallowed click consumes the arming, so the next one passes.
//
// TESTABILITY: gestureTarget, resolveRelease, resolveTriggerRelease, nextHilite, menuFor, bandDirection, and scrollDelta are pure
// (or layout-free DOM reads) and unit-tested, as are the pointer latch + click suppression via synthetic
// events; the full wiring (real pointer drags + elementFromPoint + auto-scroll feel) is verified
// on-device — jsdom has no layout engine, so elementFromPoint/getBoundingClientRect don't work there.
// ─────────────────────────────────────────────────────────────────────────

const HILITE = 'drag-target' // the live "this will be selected" class toggled during a drag (index.css)
const GROUP_SELECTOR = '[data-answer-grid],[data-select-group]'
const TARGET_SELECTOR = 'button,[data-drag-focus]' // what a release can land on: buttons everywhere, plus focus opt-ins (the Year Range inputs) inside a menu
const WITHHELD_SELECTOR = '[aria-disabled="true"]' // …and what a gesture must never land on, however it matched above

// ★ ANNOUNCED-UNAVAILABLE CONTROLS ARE NOT GESTURE TARGETS (round 15). Every element this controller
// treats as a target — the press it latches onto, the member it rings under the finger, the member a
// release acts on — goes through here first, and an `aria-disabled="true"` element resolves to
// nothing, exactly as if the pointer had landed on the empty row behind it.
//
// ⚠ WHY IT HAD TO BECOME EXPLICIT. Until round 15 every withheld control in the app also wore
// `pointer-events-none`, and THAT is what kept them out of this file: a pointer-events:none element is
// never returned by elementFromPoint and never targeted by a pointerdown, so `closest('button')` walked
// straight past it. Round 15 removed the pointer block from the ⚙ footer's three buttons (so the not-allowed
// cursor could paint at all — see controlClasses' NOT_OFFERED_BTN_CLASS), and with it went the only
// thing keeping them out: a press-drag from the ⚙ gear into the panel started drawing the drag ring on
// a greyed-out Save Defaults / Reset Settings / Full Reset, which then did nothing on release. A ring
// is a promise that a release will act; drawing one on a control the app has just announced as
// unavailable is the UI lying about what pressing will do — the very defect that change was made to fix, one
// channel over. So the invariant moves off a CSS side effect and into the controller, where it is
// stated once and cannot be undone by a className.
//
// ⚠ ENUMERATED BY HAND, because a green suite is not a blast radius. Every OTHER aria-disabled element
// in src/ still carries pointer-events-none as well and so was already invisible here — the locked ⚙
// pickers (PillGroup's LOCK_CLASS on the container, PillTray's segments inside it), SliderValueEditor's
// accented readout, and MethodBreakdown's Show Codes. The ⚙ footer's three buttons are the only
// hit-testable aria-disabled controls in the app, so this predicate changes the behaviour of exactly
// those three, and changes it back to what it was before round 15.
//
// Exported for the unit net: jsdom has no layout, so elementFromPoint never fires there and the full
// gesture cannot be driven — the predicate is the testable seam (tests/pointerGestures).
export function gestureTarget(el: Element | null): HTMLElement | null {
  return el && !el.matches(WITHHELD_SELECTOR) ? (el as HTMLElement) : null
}

// Pure decision: given where the press STARTED, the release target under the release point (or null),
// and the selection group the press began inside (or null), decide whether to suppress the native click
// on the start button and which button (if any) to activate instead.
//   • In a group: release on the SAME option → let the native click activate it (suppress nothing). Drag
//     to ANOTHER option → suppress the start's click + activate the release option. Release OFF the grid
//     → suppress (cancel), activate nothing.
//   • Not in a group: activate only if released on the SAME button; otherwise suppress (slide-off cancel).
export function resolveRelease(
  startEl: Element,
  releaseBtn: Element | null,
  group: Element | null,
): { suppressStart: boolean; activate: Element | null } {
  if (group) {
    const member = releaseBtn && group.contains(releaseBtn) ? releaseBtn : null
    if (member === startEl) return { suppressStart: false, activate: null }
    return { suppressStart: true, activate: member }
  }
  return { suppressStart: releaseBtn !== startEl, activate: null }
}

// Pure decision for the GROUP drag hilite: given the group member under the pointer (null = off-grid),
// the element the press started on, and whether the pointer has already left the start element, decide
// the new hasLeft state and which element (if any) to hilite. The ring appears only AFTER the pointer
// leaves the start element — a plain tap never flashes it — where "leaving" includes drifting off-grid
// (member null). Once left, the member under the pointer hilites, INCLUDING the start element itself
// (returning to it is a deliberate re-selection, so the ring confirms it like any other option).
export function nextHilite(
  member: Element | null,
  startEl: Element,
  hasLeft: boolean,
): { hasLeft: boolean; show: Element | null } {
  const left = hasLeft || member !== startEl
  return { hasLeft: left, show: left ? member : null }
}

// Pure decision for a press-drag TRIGGER release: given the trigger's live-resolved menu and the element
// under the release point (a <button> or a [data-drag-focus] opt-in), decide the member to act on, the
// action, and whether the menu should be dismissed afterwards. Focus targets never dismiss (the whole
// point is leaving the panel open to type); click targets dismiss only when the menu opted in
// (data-drag-dismiss) and the member has no [data-drag-stay] ancestor opt-out (closest, so a container
// exempts its whole region — the footer rows).
export function resolveTriggerRelease(
  menu: Element | null,
  releaseEl: Element | null,
): { member: Element | null; action: 'click' | 'focus' | null; dismiss: boolean } {
  const member = menu && releaseEl && menu.contains(releaseEl) ? releaseEl : null
  if (!member || !menu) return { member: null, action: null, dismiss: false }
  if (member.hasAttribute('data-drag-focus')) return { member, action: 'focus', dismiss: false }
  return {
    member,
    action: 'click',
    dismiss: menu.hasAttribute('data-drag-dismiss') && !member.closest('[data-drag-stay]'),
  }
}

// The menu a [data-select-trigger] opens, resolved LIVE from its aria-controls id — explicit pairing, no
// "last menu in the DOM" heuristic, so a still-open Settings panel can never be mistaken for the mode
// dropdown (or vice versa). Live because the menu isn't in the DOM at pointerdown (the trigger's own
// pointerdown opens it a React render later), and because a press that CLOSED the menu must resolve to
// null (attribute gone / panel unmounted) so the gesture is inert.
export function menuFor(trigger: Element | null): Element | null {
  const id = trigger?.getAttribute('aria-controls')
  return (id && document.getElementById(id)) || null
}

// EDGE AUTO-SCROLL math — pure + unit-tested. Speed is px/SECOND (frame-rate independent: 60Hz and
// a 120Hz iPhone scroll at the same speed), applied per rAF frame as MAX_SPEED · ramp · dt. The ramp
// rises linearly from 0 at EDGE px inside the scroller's edge to 1 at (or past) the edge itself; dt is
// clamped so a janky/suspended frame can't teleport the scroll.
export const EDGE = 56 // px band inside the scroller's top/bottom edge where auto-scroll engages
export const MAX_SPEED = 900 // px/second at the very edge (feel tuned in the on-device round)
const DT_CLAMP_MS = 40 // frame deltas beyond this (tab jank/suspend) are clamped, not integrated
// Which edge band (if any) y sits in, given the scroller's top/bottom: -1 = top band (scroll up),
// 1 = bottom band (scroll down), 0 = neither (no auto-scroll).
export const bandDirection = (y: number, top: number, bottom: number): -1 | 0 | 1 =>
  y < top + EDGE ? -1 : y > bottom - EDGE ? 1 : 0
// Unsigned px to scroll this frame: dtMs = the rAF timestamp delta, distFromEdge = the pointer's
// distance inside the scroller from the engaged edge (≤0 = at/past the edge → full speed; ≥EDGE → 0).
export const scrollDelta = (dtMs: number, distFromEdge: number): number =>
  MAX_SPEED *
  Math.min(1, Math.max(0, (EDGE - distFromEdge) / EDGE)) *
  (Math.min(Math.max(dtMs, 0), DT_CLAMP_MS) / 1000)

// Install the controller on `document`. Returns a cleanup that removes every listener. Call once (an App
// effect). Safe to call where `document` exists; a no-op-ish guard keeps it import-safe in non-DOM envs.
export function installPointerGestures(): () => void {
  if (typeof document === 'undefined') return () => {}

  let pointerId: number | null = null // the latched pointer — all other ids are ignored until endGesture
  let pointerKind: string | null = null // the latched pointer's pointerType — a stale-latch reset is only safe within the same type (onDown)
  let startEl: HTMLElement | null = null
  let group: Element | null = null // a direct group (an answer grid the press began inside)
  let trigger: Element | null = null // the [data-select-trigger] the press began on — its menu is paired via aria-controls (menuFor)
  let suppressEl: Element | null = null
  let hilited: Element | null = null
  let hasLeftStart = false // group path: true once the pointer has left the pressed option (nextHilite)
  let clearTimer: ReturnType<typeof setTimeout> | null = null
  let lastX = 0 // latest pointer position, kept current for the edge auto-scroll loop
  let lastY = 0
  // Per-gesture auto-scroll cache, built ONCE when the paired menu first appears (ensureMenuCache): the
  // menu, its scroller ([data-drag-scroll] wrapper, else the menu itself), the scroller's border-box rect
  // (stable — the panel doesn't move during a drag), and whether it can scroll at all. Only scrollTop is
  // touched per frame. Dropped at endGesture.
  let menuCache: {
    menu: Element
    scroller: HTMLElement
    rect: DOMRect
    scrollable: boolean
  } | null = null
  let rafId: number | null = null
  let prevTs: number | null = null // previous rAF timestamp; null = first frame after a (re)start → dt 0

  const targetAt = (x: number, y: number): HTMLElement | null =>
    gestureTarget(document.elementFromPoint(x, y)?.closest(TARGET_SELECTOR) ?? null)
  const memberAt = (g: Element | null, x: number, y: number): Element | null => {
    if (!g) return null
    const t = targetAt(x, y)
    return t && g.contains(t) ? t : null
  }
  const setHilite = (el: Element | null) => {
    if (hilited === el) return
    if (hilited) hilited.classList.remove(HILITE)
    if (el) el.classList.add(HILITE)
    hilited = el
  }
  const ensureMenuCache = () => {
    if (menuCache || !trigger) return
    const menu = menuFor(trigger)
    if (!menu) return
    const scroller =
      (menu.querySelector('[data-drag-scroll]') as HTMLElement | null) ?? (menu as HTMLElement)
    menuCache = {
      menu,
      scroller,
      rect: scroller.getBoundingClientRect(),
      scrollable: scroller.scrollHeight > scroller.clientHeight + 1,
    }
  }
  // EDGE AUTO-SCROLL loop: runs ONLY while the pointer rides a scrollable menu's edge band (started and
  // stopped by onMove's band check; self-stops if a frame finds the pointer outside). While it runs it
  // owns the hilite and does the gesture's single elementFromPoint per frame — onMove then only records
  // the pointer position, so there is never more than one hit-test per frame from either path. rAF
  // timestamps drive the px/s speed math (scrollDelta). Verified on-device (jsdom has no layout, so the
  // cache is never scrollable there and the loop never engages in tests).
  const autoScroll = (ts: number) => {
    rafId = null
    if (!startEl || !menuCache) return
    const { menu, scroller, rect } = menuCache
    const dir = bandDirection(lastY, rect.top, rect.bottom)
    if (dir === 0) {
      prevTs = null // left the band between frames — onMove restarts the loop on re-entry
      return
    }
    const dt = prevTs == null ? 0 : ts - prevTs
    prevTs = ts
    scroller.scrollTop += dir * scrollDelta(dt, dir < 0 ? lastY - rect.top : rect.bottom - lastY)
    setHilite(memberAt(menu, lastX, lastY)) // content moved under the finger
    rafId = requestAnimationFrame(autoScroll)
  }
  const startAutoScroll = () => {
    if (rafId == null) {
      prevTs = null
      rafId = requestAnimationFrame(autoScroll)
    }
  }
  const stopAutoScroll = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    prevTs = null
  }
  const endGesture = () => {
    stopAutoScroll()
    setHilite(null)
    pointerId = null
    pointerKind = null
    startEl = null
    group = null
    trigger = null
    menuCache = null
    hasLeftStart = false
  }
  // Suppress the start button's native click. On touch that click fires the ORIGINAL button regardless
  // of drift AND is DELAYED/async after release (a long press makes the browser "commit" to the pressed
  // button, so it still fires that button's click even after you drag away). So the flag must OUTLAST the
  // click delay: it persists until the click consumes it (onClick) or the next gesture clears it
  // (onDown), with a generous fallback timer only for the no-click case (a mouse drag-off fires none) so
  // a much-later real click on the same button isn't swallowed. (A 0ms tick lost this race — held-then-
  // dragged taps and the mode-selector re-toggle leaked through.)
  const armSuppress = (el: Element) => {
    suppressEl = el
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      suppressEl = null
      clearTimer = null
    }, 1000)
  }

  const onDown = (e: PointerEvent) => {
    // Pointer latch: only the primary pointer starts a gesture, and non-left mouse buttons are rejected
    // BEFORE any state mutation — so neither a second finger nor a right-click can clear an armed
    // suppression or restart an active gesture.
    if (!e.isPrimary) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (startEl) {
      // A gesture is latched, yet a PRIMARY pointer pressed. Same type as the latch → the latched
      // contact must already have ended with its up/cancel LOST (a pointer is primary only while no
      // other pointer of its type is active): mouse released off-window uncaptured (same pointerId),
      // or a touch whose events iOS dropped suspending the PWA mid-press (touch contacts get FRESH
      // pointerIds, so an id check alone would wedge the latch forever). Clear the stale gesture and
      // start fresh. A primary pointer of a DIFFERENT type (a touch during a live mouse drag) says
      // nothing about the latch — ignore it.
      if (e.pointerType !== pointerKind) return
      endGesture()
    }
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
    suppressEl = null
    // gestureTarget on the START too, not only on the release/hilite hit-tests: an announced-unavailable
    // button must latch no gesture at all, which is precisely what pointer-events-none used to give
    // these for free (the pointerdown landed on the row behind and closest('button') found nothing).
    // Without it a press on a dimmed ⚙ footer button would latch, then resolve its own release to null
    // through targetAt, and resolveRelease would read that as a slide-off — arming a click suppression
    // on a button that was never going to act. Same predicate, same reason, one gesture earlier.
    const el = gestureTarget((e.target as Element | null)?.closest?.('button') ?? null)
    if (!el) return
    pointerId = e.pointerId
    pointerKind = e.pointerType
    startEl = el
    group = el.closest(GROUP_SELECTOR)
    trigger = group ? null : el.closest('[data-select-trigger]')
    hasLeftStart = false
    lastX = e.clientX
    lastY = e.clientY
    // Deliberately NO hilite on press: in a group the ring appears only after the pointer LEAVES the
    // pressed option (nextHilite, applied in onMove) — a plain tap never flashes it.
  }
  const onMove = (e: PointerEvent) => {
    if (!startEl || e.pointerId !== pointerId) return
    lastX = e.clientX
    lastY = e.clientY
    if (trigger) {
      ensureMenuCache() // the menu mounts a render after pointerdown — pair with it the moment it exists
      if (!menuCache) return
      const { menu, rect, scrollable } = menuCache
      if (scrollable && bandDirection(e.clientY, rect.top, rect.bottom) !== 0) {
        startAutoScroll() // the loop owns the hilite + the per-frame hit-test while in the band
        return
      }
      stopAutoScroll()
      setHilite(memberAt(menu, e.clientX, e.clientY))
      return
    }
    if (!group) return
    const h = nextHilite(memberAt(group, e.clientX, e.clientY), startEl, hasLeftStart)
    hasLeftStart = h.hasLeft
    setHilite(h.show)
  }
  const onUp = (e: PointerEvent) => {
    if (!startEl || e.pointerId !== pointerId) return
    const start = startEl
    const relTarget = targetAt(e.clientX, e.clientY)
    if (trigger) {
      // The trigger's own pointerdown already toggled its menu; ALWAYS suppress its click (else it
      // double-toggles). Then act on the member under the release (resolveTriggerRelease): focus it
      // (data-drag-focus — the panel stays open for typing) or click it — and, when the menu opted into
      // data-drag-dismiss with no data-drag-stay opt-out, ask it to close via a bubbling drag-dismiss
      // CustomEvent from the member (App's listener closes Settings; React batches the click's state
      // update with the close, and the settings apply-on-close pass fires naturally).
      const { member, action, dismiss } = resolveTriggerRelease(menuFor(trigger), relTarget)
      endGesture()
      armSuppress(start)
      if (member) {
        if (action === 'focus') (member as HTMLElement).focus()
        else {
          ;(member as HTMLElement).click()
          if (dismiss) member.dispatchEvent(new CustomEvent('drag-dismiss', { bubbles: true }))
        }
      }
      return
    }
    const { suppressStart, activate } = resolveRelease(start, relTarget, group)
    endGesture()
    if (suppressStart) armSuppress(start)
    if (activate && activate !== start) (activate as HTMLElement).click()
  }
  // A gesture the SYSTEM took away (pointercancel: the touch became a scroll/pinch, the app was
  // suspended mid-press, an OS gesture won). There is no release point, so nothing may activate — and
  // for a [data-select-trigger] press the click the browser still delivers afterwards must be
  // suppressed. WHY ONLY TRIGGERS: a trigger's pointerdown has ALREADY acted (it toggled its menu),
  // and the ⚙ Settings button + the mode selector are the app's only two press-acting controls — both
  // carry the marker, so it is the exact discriminator, not a special case. A click after the cancel is
  // therefore a SECOND toggle: the menu opens on the press and shuts again in the same gesture, which
  // is the owner's "the menu will not stay open" report. onUp's trigger branch suppresses
  // unconditionally for that same reason; a cancel is that situation with the release lost.
  // Every OTHER button is deliberately left exactly as it was: its pointerdown did nothing, so a
  // delayed click is a FIRST activation rather than a duplicate — and onUp would not suppress it
  // either when the finger never left it, because onUp feeds resolveRelease the REAL release target
  // (targetAt) and a release on the start element returns suppressStart FALSE. Suppressing there would
  // be a new rule resting on an untestable claim about what a real browser delivers after
  // pointercancel, and its failure mode is swallowing an answer whose grid the engine reclaimed.
  // The arming is cleared by the click that consumes it, by the next pointerdown, or by armSuppress's
  // fallback timer — so a later genuine tap is never swallowed.
  const onCancel = (e: PointerEvent) => {
    if (!startEl || e.pointerId !== pointerId) return
    const start = startEl
    const wasTrigger = trigger !== null // endGesture clears it — read before
    endGesture()
    if (wasTrigger) armSuppress(start)
  }
  const onClick = (e: MouseEvent) => {
    if (
      suppressEl &&
      (e.target === suppressEl || (suppressEl as Element).contains(e.target as Node))
    ) {
      suppressEl = null
      if (clearTimer) {
        clearTimeout(clearTimer)
        clearTimer = null
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('click', onClick, true)
  return () => {
    if (clearTimer) clearTimeout(clearTimer)
    stopAutoScroll()
    setHilite(null)
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('pointercancel', onCancel, true)
    document.removeEventListener('click', onClick, true)
  }
}
