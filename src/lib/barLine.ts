// THE LINE UNDER THE BAR — the usable top of the app's one scrolling area (main.tsx's #appScroll),
// and where the keyboard brings a control it steps onto from above it.
//
// The fixed bar owns the top of the screen on every screen, so the line under it is where a screen
// really begins: index.css gives #appScroll a scroll-padding-top of exactly the bar's height for that
// reason, and How to Play docks its section titles on the same line (index.css's .guide-head).
//
// ★ WHERE A TAB LANDS. The browsers' own focus scroll keeps the line's promise only for a control
// PARTLY under the bar: they align its nearest edge, and the scroll-padding makes that edge the line.
// A control WHOLLY behind the opaque bar, or scrolled further away above it, counts to both engines
// as not visible at all, and for that they CENTRE it — measured on a short Classic, Deduction, MoX, or
// Blitz page, Shift+Tab onto a control just behind the bar left it 13 to 101px below the line, and a
// How to Play title near the top was centred past the top, so the page jumped to the very top
// (Chromium synchronously, before the focus event; WebKit a moment later). installTabLanding puts it on the line instead, for every screen:
//   • from where the page was when the Tab went DOWN (the key's own snapshot — Chromium has already
//     moved the page by the time focus arrives);
//   • by where the control stood then: where it is now, carried back by however far the browser has
//     already scrolled — or, for an element that does not simply ride with the page (How to Play's
//     sticky section titles), by the rule its own screen registers (addStandingRule);
//   • to the first WHOLE pixel of scroll at which it is wholly below the line (the scroll position is
//     a whole number in both engines, and the page's content usually is not): exactly where both
//     engines put a control PARTLY under the bar themselves (measured), so a control stepped onto
//     from just above the line and one from far above it rest on the same pixel. Rounded the other
//     way — a fraction of it still behind the bar — WebKit's own pass after the focus event counted
//     it as partly hidden and moved it there anyway, and the two engines rested a pixel apart;
//   • written inside the focus event, so no frame shows where the browser put it; WebKit's own pass
//     after it then finds the control in view and has nothing to do.
// Anything else is left to the browser: a control that stood on or below the line, focus moved by
// anything but Tab, and a control inside a scroller of its own (a list that scrolls by itself
// brings its own rows into view).
import { DOCK_LINE_BAND_PX } from './guideDock.js'
import { nearestScrollRegion } from '../components/scrollRegion.js'

/**
 * The fixed bar's height in px — the viewport y of its underside. --bar-h is a literal px token App
 * writes on <html> from the bar's own measured height (main.tsx's syncBarHeight) and it inherits
 * down to the scroller, so this is a plain number wherever a stylesheet is served. NaN where none is
 * (jsdom); each caller says what it does then.
 */
export const readBarHeight = (scrollerStyle: CSSStyleDeclaration): number =>
  parseFloat(scrollerStyle.getPropertyValue('--bar-h'))

/**
 * Where an element the keyboard has just moved onto stood when the Tab went down, as the viewport
 * y of its top — for an element whose screen knows better than "it rode with the page". The page was
 * `comingUpPx` further on then than it is now (the browser's own focus scroll since the key went
 * down). Returns null for an element the rule is not about.
 */
export type StandingRule = (el: HTMLElement, comingUpPx: number, lineY: number) => number | null

const standingRules = new Set<StandingRule>()

/** Register a StandingRule for as long as its screen is mounted; hands back the removal. */
export function addStandingRule(rule: StandingRule): () => void {
  standingRules.add(rule)
  return () => standingRules.delete(rule)
}

// Is `el` inside a scroller of its own — one with something to scroll — between it and the app's
// scroller? That scroller brings its own content into view, and the page's place is not this
// module's to correct.
function inOwnScroller(el: HTMLElement, scroller: HTMLElement): boolean {
  for (let r = nearestScrollRegion(el); r && r !== scroller; r = nearestScrollRegion(r))
    if (r.scrollHeight > r.clientHeight) return true
  return false
}

/** Bring a control the keyboard steps onto from above the line to rest on it. Hands back the removal. */
export function installTabLanding(scroller: HTMLElement): () => void {
  let tabFrom: number | null = null
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    tabFrom = scroller.scrollTop
    // Only for this key's own turn: a Tab that moved nothing here must not speak for a later focus.
    setTimeout(() => {
      tabFrom = null
    })
  }
  const onFocusIn = (e: FocusEvent) => {
    const from = tabFrom
    tabFrom = null
    const el = e.target
    if (
      from === null ||
      !(el instanceof HTMLElement) ||
      el === scroller ||
      !scroller.contains(el) ||
      inOwnScroller(el, scroller)
    )
      return
    const lineY = scroller.getBoundingClientRect().top + readBarHeight(getComputedStyle(scroller))
    if (!Number.isFinite(lineY)) return
    const comingUp = from - scroller.scrollTop
    let thenTop: number | null = null
    for (const rule of standingRules) {
      thenTop = rule(el, comingUp, lineY)
      if (thenTop !== null) break
    }
    thenTop ??= el.getBoundingClientRect().top - comingUp
    if (thenTop >= lineY - DOCK_LINE_BAND_PX) return
    scroller.scrollTop = Math.floor(from - (lineY - thenTop))
  }
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('focusin', onFocusIn, true)
  }
}
