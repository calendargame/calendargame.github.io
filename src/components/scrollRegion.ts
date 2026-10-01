import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'

// The site-wide scroll-region treatment (round 7) — the ⚙ Settings recipe, extracted here so
// no scroll region can quietly diverge from it again (settings, the changelog popup, and the
// Lookup history list each once carried their own copy of parts of it, and each drifted). There
// is deliberately NO scrollbar CSS anywhere — the treatment is two halves, applied together:
//
//   1. The PADDING LANE. The card owns vertical padding only (py-4); the scroll region itself
//      carries the horizontal px-4. That puts the 1rem right padding INSIDE the scroller — a
//      text-free lane where the iOS overlay scrollbar paints clear of the content. (Padding on
//      the card instead would leave the scroller's right edge flush against the text, with the
//      scrollbar painting on top of it.)
//   2. The EDGE FADES. The fade-scroll-* masks (index.css) — top/bottom feathers that appear
//      exactly when content extends past that edge — driven by useScrollEdgeState below.
//
// SCROLLER_CORE_CLASS exists for the scrollers that need no lane of their own. The app's main
// container (main.tsx appScrollRef / #appScroll) fills the viewport, so its scrollbar already
// paints at the screen edge past the content wrapper's own px-4 — it takes the core without the
// lane (its fades still come from scrollFadeClass). And since round 23 the option list inside
// a dropdown's panel (components/CustomSelect): every option row carries its own 1rem of side
// padding, so the text already sits clear of an overlay scrollbar, and a lane on top would also
// widen the panel away from the hidden width-mirror that must match it to the pixel. Since round 13 that container is
// the WHOLE app: How to Play used to scroll the document instead and was exempt from this file
// entirely, and it is now governed code like everything else. tests/scrollRegionGuard.test.js
// fails the suite on any raw vertical-overflow literal outside this file, so every scroll region
// must come through these tokens — with no scroller left anywhere that the guard cannot see.
export const SCROLLER_CORE_CLASS = 'overflow-y-auto overscroll-contain'
export const SCROLL_REGION_CLASS = `${SCROLLER_CORE_CLASS} px-4`

// The conditional fade-mask suffix for a scroll region's className, from the two edge flags.
// Both edges overflowing must yield the single combined class — CSS mask-image declarations
// don't stack across classes (see the index.css fade-scroll-both note). Branches carry their
// own leading space, the codebase's conditional-class idiom (a doubled space in a class
// attribute is meaningless to the browser and to Tailwind's scanner alike).
export const scrollFadeClass = (scrolledFromTop: boolean, atBottom: boolean): string =>
  scrolledFromTop && !atBottom
    ? ' fade-scroll-both'
    : scrolledFromTop
      ? ' fade-scroll-top'
      : !atBottom
        ? ' fade-scroll-bottom'
        : ''

// ── The edge arithmetic — ONE owner (round 10 item B) ────────────────────────────────────────
// Everything downstream of "where is this scroller relative to its two edges" is derived from
// scrollEdgeGaps, and nothing re-derives it: the two booleans that drive the mask fades, and the
// continuous --shade that drives the boundary shadows and the guide's soft edges, all read the
// same pair of numbers. That is the whole point of the function existing. Before this round the
// same expression was written out three times (here, and twice in main.tsx's bespoke effect), and
// a progressive shadow computing "how far from the bottom" independently of the mask's atBottom
// was how the two would have started disagreeing: a popover that overflows by 3px is shadowless
// today because of the dead band below, and under a naive continuous rule it would have grown a
// permanent ~12% footer shadow while the bottom mask — still banded — stayed off. One boundary,
// two answers. Not possible from here.
//
// The gaps are px of unreached content at each edge, clamped at 0 so iOS rubber-band overscroll
// (negative scrollTop at the top, a negative remainder at the bottom) reads as "you are at the
// edge" rather than going negative.
export type ScrollEdgeGaps = { top: number; bottom: number }

// A scroller with nothing to scroll has no edges to signal, so both gaps collapse to 0. The 1px
// slack absorbs the sub-pixel difference between a fractional content height and a fractional box
// height — without it a region that fits exactly reports a fraction of a pixel of overflow and
// paints indicators forever.
export function scrollEdgeGaps(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ScrollEdgeGaps {
  if (scrollHeight <= clientHeight + 1) return { top: 0, bottom: 0 }
  return {
    top: Math.max(scrollTop, 0),
    bottom: Math.max(scrollHeight - scrollTop - clientHeight, 0),
  }
}

// The bottom dead band: within 4px of the end counts as arrived. It exists because the bottom gap
// is a DIFFERENCE of two measured numbers (scrollHeight − scrollTop − clientHeight), so fractional
// layout, zoom and the browser's own scroll clamping leave a couple of stray pixels on a scroller
// the user has scrolled fully to the end — and a footer shadow that never quite goes away is worse
// than one that gives up a hair early. The top edge needs no twin: scrollTop 0 is exact, not a
// difference, so isScrolledFromTop tests > 0.
export const BOTTOM_EDGE_BAND_PX = 4
export const isAtBottom = (gaps: ScrollEdgeGaps): boolean => gaps.bottom <= BOTTOM_EDGE_BAND_PX
export const isScrolledFromTop = (gaps: ScrollEdgeGaps): boolean => gaps.top > 0

// gap → --shade, the 0…1 strength of that edge's boundary shadow (index.css). The band is that
// edge's "arrived" tolerance, so the ramp starts where the boolean flips and the two can never
// contradict each other: shade > 0 exactly when the edge is live. rampPx is --fade-h, read once
// per listener attach — CSS cannot do this arithmetic itself (calc() has no length ÷ length), so
// the number crosses into JS rather than being duplicated as a literal.
// If rampPx fails to parse the ramp DEGRADES TO THE BOOLEAN — full strength the moment the edge
// is live — which is the pre-round-10 behaviour, never a missing shadow.
export function edgeShade(gap: number, band: number, rampPx: number): number {
  if (gap <= band) return 0
  const span = rampPx - band
  return span > 0 ? Math.min((gap - band) / span, 1) : 1
}

// --fade-h is a literal px token on :root (index.css), so it cannot fail to parse anywhere that
// serves the stylesheet; the guard in edgeShade covers the environment that serves none (jsdom).
export const readShadeRampPx = (): number =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fade-h'))

// The ONE way --shade reaches the DOM. A custom property set straight on the element, NOT React
// state: a state update per scroll frame would re-render the whole host component to move a
// shadow. This write invalidates style for one element and touches no layout (box-shadow and
// opacity are paint-only), and it is skipped outright when the rounded value has not changed —
// which is most frames, since a scroller more than --fade-h from both edges sits pinned at 1 and
// one at rest sits pinned at 0. So there is no rAF throttle and deliberately so: scroll events
// are already coalesced to at most one per frame, and deferring the write by a frame would put
// the shadow one frame behind the content — reintroducing, in miniature, the lag this replaced.
// 3 decimals is ~1/1000 of the shadow's alpha, far below any perceptible step.
export function writeShade(el: HTMLElement | null | undefined, shade: number): void {
  if (!el) return
  const next = shade.toFixed(3)
  if (el.style.getPropertyValue('--shade') !== next) el.style.setProperty('--shade', next)
}

// ── Watching the SCROLL EXTENT, not the scroller's box (round 11) ─────────────────────────
// The edge answer is a function of THREE numbers — scrollTop, scrollHeight, clientHeight — and
// the platform only gives an event for the first. A scroll listener therefore covers exactly one
// third of the question, and the other two thirds change silently: a panel opens, a list gains a
// row, an animation grows a section frame by frame, and the indicators keep painting the answer
// to a question nobody is asking any more.
//
// The obvious guard — a ResizeObserver on the scroller — covers only clientHeight, and only on
// the scrollers whose box can actually change. That is the bug this replaces: the app's main
// container is `absolute inset-0`, so its box is pinned to the viewport BY CONSTRUCTION and no
// content change can ever resize it; observing it meant observing the one number that could not
// move. The settings popover has the same shape once its content passes the card's max-height —
// the flex child stops growing, and every further change is invisible to an observer watching it.
//
// scrollHeight is the CONTENT's height, so the content is what has to be watched:
//   • the scroller itself — clientHeight (a viewport rotation, a flex re-layout, --bar-h moving).
//   • each of its element CHILDREN — scrollHeight is their stacked height, so a child growing
//     (including once per frame through a CSS transition, which is what makes the fades track an
//     accordion instead of snapping after it) is the content growing.
//   • a childList MutationObserver — a child ADDED or REMOVED changes the same total while
//     resizing none of the survivors, so no ResizeObserver could see it. It re-observes BEFORE it
//     reports, because an arriving child has to be under observation by the time it grows, and a
//     removed child's own observation left with it.
//     ⚠ WHERE THAT THIRD MECHANISM IS LOAD-BEARING, stated exactly so nobody trims it after a
//     half-check: the only region whose children change today is the Lookup history <ul>, and
//     there the hook ALSO re-attaches (its `active` is the history array, so adding an entry
//     changes the identity the effect depends on). So today it is the belt to that braces. It
//     stops being redundant the moment a region has conditional children and an `active` that
//     does not change with them — a shape this file cannot see and a caller has no reason to
//     think about. Keeping it is what makes the three mechanisms cover the three numbers BY
//     CONSTRUCTION instead of by an audit of every call site, and an audit of every call site
//     silently going stale is precisely this round's bug.
// Re-observing is a disconnect-and-re-add rather than a diff: observe() on an already-observed
// target is idempotent, the child count here is small, and the alternative is a second copy of
// the child list to keep honest. onChange is called explicitly after it because a real engine's
// initial delivery for the newly observed targets is asynchronous and a removal delivers nothing
// at all — the caller must not have to know which.
//
// ⚠ The callback must not change LAYOUT, or the engine reports a resize-observer loop. Every
// caller here writes --shade (paint) and toggles a mask class (paint), which is why this is safe
// and why it must stay that way.
export function observeScrollExtent(el: HTMLElement, onChange: () => void): () => void {
  const ro = new ResizeObserver(onChange)
  const observeAll = () => {
    ro.disconnect()
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
  }
  observeAll()
  const mo = new MutationObserver(() => {
    observeAll()
    onChange()
  })
  mo.observe(el, { childList: true })
  return () => {
    ro.disconnect()
    mo.disconnect()
  }
}

// Scroll-edge state for one scroll region: which edges have content extending past them.
//   scrolledFromTop → feed the top fade mask
//   atBottom        → feed the bottom fade mask
// plus the continuous --shade written onto whichever boundary surfaces the host names:
// topShadeRef gets the top edge's strength (a layered header's elev-shadow-down), bottomShadeRef
// the bottom edge's (a sticky footer's elev-shadow-up). Both optional — the changelog popup has
// fades and no boundary surface at all. They are POSITIONAL REFS rather than one options object
// on purpose: eslint.config.js runs react-hooks/exhaustive-deps at ERROR, an object literal at the
// call site would be demanded in the dep array, and a fresh literal each render would re-attach
// the listener and the ResizeObserver on every render. Ref identities are stable, so the deps stay
// honest with no memo and no dependence on the React Compiler.
// `active` gates the listener. Truthy = attach; the effect re-runs whenever `active`'s IDENTITY
// changes, so hosts whose region mounts with content pass the content itself (LookupCard passes
// its history array — a change re-attaches to the freshly (re)mounted list) and overlay hosts
// pass their open flag. The DETACH CLEANUP snaps the flags back to the defaults (scrolledFromTop
// false, atBottom true) and the shades to 0 — the reset lives there, not in the effect body (a
// synchronous body setState cascades an extra render; react-hooks/set-state-in-effect fails the
// lint gate on it), so a closed region is already clean and reopening never flashes stale
// indicators.
// A scroll listener tracks the user; observeScrollExtent above tracks everything else the answer
// depends on — the region's own box AND its content (the history list gaining its tenth entry
// mid-view, or Show Codes opening in the card above it and taking the list's height with it).
// A LAYOUT effect, matching the app-scroller effect in main.tsx that already argues the point:
// evaluated after paint, a region would show one frame with no fade and no boundary shadow before
// the indicators arrive. That frame is cheap to avoid and it is the frame the eye lands on when a
// popover opens.
export function useScrollEdgeState<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: unknown,
  topShadeRef?: RefObject<HTMLElement | null>,
  bottomShadeRef?: RefObject<HTMLElement | null>,
): { scrolledFromTop: boolean; atBottom: boolean } {
  const [atBottom, setAtBottom] = useState(true)
  const [scrolledFromTop, setScrolledFromTop] = useState(false)
  useLayoutEffect(() => {
    // The boundary surfaces are captured HERE, not read per frame off the refs: React attaches
    // child refs before a parent's layout effect runs, so they are already the elements this
    // attachment is about — and anything that could replace one (a region mounting with different
    // content) changes `active` and re-runs the whole effect. Capturing is also what lets the
    // cleanup reset the surfaces it actually wrote to, which is the rule react-hooks enforces.
    //
    // ⚠ CAPTURED BEFORE THE GUARDS, and the no-scroller path RESTS THEM AT 0. A boundary surface
    // can exist whether or not there is a scroller to track. The case that taught this was Lookup's
    // old framed history list (round 10): its heading and its Show Codes section were surfaces that
    // rendered unconditionally around a <ul> that only exists once there is at least one entry, and
    // bailing without writing left `--shade` at @property's initial-value of 1 — a full-strength
    // 50%-black shadow above and below an empty "No lookups yet" panel, on every cold start of a
    // fresh install, self-healing after the first lookup so a casual pass missed it. (Round 23
    // took that frame away; the rule belongs to the hook, not to one host, so it stays.) The initial-value of 1 is there for a boundary with NO writer at all (so an
    // engine without @property degrades to the old always-on look, never to a missing shadow) —
    // NOT for one whose writer simply has nothing to measure. This is the rule scrollEdgeGaps
    // already states: nothing to scroll means no edges to signal, so both gaps collapse to 0.
    const topEl = topShadeRef?.current ?? null
    const bottomEl = bottomShadeRef?.current ?? null
    const el = active ? ref.current : null
    if (!el) {
      writeShade(topEl, 0)
      writeShade(bottomEl, 0)
      return
    }
    const rampPx = readShadeRampPx()
    const evaluate = () => {
      const gaps = scrollEdgeGaps(el.scrollTop, el.scrollHeight, el.clientHeight)
      setAtBottom(isAtBottom(gaps))
      setScrolledFromTop(isScrolledFromTop(gaps))
      writeShade(topEl, edgeShade(gaps.top, 0, rampPx))
      writeShade(bottomEl, edgeShade(gaps.bottom, BOTTOM_EDGE_BAND_PX, rampPx))
    }
    evaluate()
    el.addEventListener('scroll', evaluate, { passive: true })
    const stopExtent = observeScrollExtent(el, evaluate)
    return () => {
      el.removeEventListener('scroll', evaluate)
      stopExtent()
      // Deactivation reset. The FLAGS can only reset here — they are React state, and writing
      // them from the effect body would trip react-hooks/set-state-in-effect (a CI error here).
      // The SHADES reset in both places: here on teardown, and in the no-scroller path above,
      // because writeShade is a direct DOM write with no such constraint and an untracked
      // surface has to rest at 0 rather than at @property's initial 1.
      setAtBottom(true)
      setScrolledFromTop(false)
      writeShade(topEl, 0)
      writeShade(bottomEl, 0)
    }
  }, [ref, active, topShadeRef, bottomShadeRef])
  return { scrolledFromTop, atBottom }
}

// holdScrollRegion (round 23) — freeze the nearest scroll region around `from` (a computed overflow-y of auto
// or scroll, stopping short of <body>: the document is never a menu's to freeze) and return the
// function that lets it go, restoring the element's own inline values exactly. No region → a no-op.
// Its one caller is components/CustomSelect, which holds the region around a trigger still while
// that trigger's panel is open (its caller contract says why). It lives HERE because freezing a
// scroller is scroller machinery, and this file is the one place allowed to touch a scroller's
// overflow (tests/scrollRegionGuard).
//   • overflow-y:hidden, NOT a listener that undoes scrolls: hidden is still a scroll container, so
//     scrollTop is kept exactly and nothing jumps, but no wheel, drag, key or momentum can move it.
//     Undoing a scroll after it lands would paint the moved frame first — a flicker per wheel tick.
//   • ⚠ A CLASSIC SCROLLBAR (desktop Windows) takes width from the region, and hiding the overflow
//     would give that width back — the region's whole content, the trigger included, would shift
//     sideways by a scrollbar's width under an open menu. So when the region has one (offsetWidth
//     beyond clientWidth and its borders), scrollbar-gutter:stable keeps the space reserved while
//     the bar itself is gone. Overlay scrollbars (iOS, macOS, Android) take no width, so there is
//     nothing to reserve and the gutter is left alone.
export function holdScrollRegion(from: Element | null): (() => void) | undefined {
  let el = from?.parentElement ?? null
  while (el && el !== document.body) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') break
    el = el.parentElement
  }
  if (!el || el === document.body) return undefined
  const region = el
  const cs = getComputedStyle(region)
  const borders = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
  const classicBar = region.offsetWidth - region.clientWidth - borders > 0
  const prevOverflowY = region.style.overflowY
  const prevGutter = region.style.scrollbarGutter
  region.style.overflowY = 'hidden'
  if (classicBar) region.style.scrollbarGutter = 'stable'
  return () => {
    region.style.overflowY = prevOverflowY
    region.style.scrollbarGutter = prevGutter
  }
}

// ── WINDOWED ROWS — a list of any length that only ever draws what is near the screen ──────────
//
// Lookup's history is unlimited, so its list can hold thousands of rows. Drawing them all costs
// time in proportion to the list on every render of the card around it, and the scroll itself
// stutters once the browser is laying out thousands of buttons it is not showing. So the list
// draws only the rows in and around the viewport, and stands in for the rest with two blank
// spacers — one above, one below — whose heights are exactly the rows they replace. The scroller's
// content is therefore as tall as the full list at all times: the scrollbar, the edge fades
// (useScrollEdgeState above reads scrollHeight) and "scroll to row N" all behave as if every row
// were there.
//
// WHAT THE CALLER OWES: every row the same height (Lookup's rows are one line tall by
// construction), each drawn row carrying `data-row`, the gap between rows written as a top margin
// on every row but the list's first (a `space-y` utility would also put a margin on the spacers),
// and the two spacers drawn from `padTop` / `padBottom`.
//
// HOW IT KNOWS THE GEOMETRY: it measures it. Row height and the row-to-row pitch are read off two
// neighbouring drawn rows, never written down as numbers — the app's root font is fluid, so a row
// is a different number of pixels on every screen, and re-measured whenever the scroller's box
// changes (a rotation changes the font, and so the rows).
//   • BEFORE THE FIRST MEASUREMENT it draws a first batch from the top; the measuring layout
//     effect runs before the browser paints, so that frame is never seen.
//   • WHERE NOTHING CAN BE MEASURED (a layout-free test environment reports every size as 0, and so
//     does a list that is not displayed) it draws EVERY row: correct, and only as slow as the list
//     is long.
//
// `revealIndex` / `revealKey` — the row the list is asked to show, and its identity (Lookup's
// selected row and its id).
//
// ★ WHAT MOVES THE LIST, AND WHAT DOES NOT — one rule, in three parts:
//   • A CHANGE OF WHICH ROW IS WANTED scrolls the least it has to for that row to be whole and clear
//     of the edge fades (scrollBandIntoView): arrowing through the history walks the list with the
//     selection, and a new lookup (added at the top) brings the top into view. The first reveal
//     after the list mounts CENTRES the row instead — that is coming back to Lookup, or a reload,
//     with a row already selected somewhere far down a long list.
//   • A SCROLL IS THE PLAYER'S. Nothing brings the wanted row back once they have scrolled away
//     from it — not until they pick another.
//   • A CHANGE OF GEOMETRY (the list's box resized — Show Codes opening in the card above takes its
//     room — or the rows themselves changing size with the font) KEEPS WHAT THE PLAYER WAS LOOKING
//     AT: the row at the top of the view stays at the top, and the wanted row is brought back into
//     view IF it was whole in view before the change. So opening Show Codes on the selected row does
//     not push that row out of sight; and a row the player had scrolled away from stays away.
//     (It used to answer every geometry change by revealing the wanted row — which threw a player who
//     had scrolled down the list back to the selection — while a shrinking box, which changes no
//     row's size, revealed nothing and let the selected row slide out under the fold.)
//     ★ EXACTLY, HOWEVER MANY TIMES IT HAPPENS — a window dragged to a new size is a geometry change
//     per frame. Two things make that true, and each was once a way the list crept:
//       – THE SPACERS ARE RESIZED BEFORE THE POSITION IS PUT BACK. The rows change size by
//         themselves; the two spacers are this hook's, drawn from the last measurement, and stay the
//         old size until React draws them again. Putting the position back in between sets a number
//         of pixels into content that is about to change height above the view: the browser then
//         keeps whatever row that showed in place as the spacer resizes (scroll anchoring), or cuts
//         the position short near the end of a list that is momentarily too short — and reports
//         either as a scroll, which is taken for the player's. So a reported resize commits the new
//         measurement first (flushSync), and only then moves the list.
//       – THE POSITION IS REMEMBERED IN ROWS, and a browser only ever holds a scroller at a pixel
//         position it can show: on a whole pixel, and no further than the end of the content. Read
//         back and divided by the row size at every change, that rounding adds up, and a list at
//         the very end comes back short of it. So the remembered rows are kept for as long as the
//         list is where they put it, and only a scroll that really moves it replaces them.
const WINDOW_FIRST_BATCH = 60
// At least this many rows are kept drawn beyond each edge of the viewport, and never less than one
// viewport's worth: a fling scrolls on the compositor ahead of the next render, and the rows it
// arrives at have to exist already or it shows a blank band.
const WINDOW_MIN_OVERSCAN = 12

export interface RowWindow {
  /** The first row to draw, and one past the last. */
  start: number
  end: number
  /** The heights, in px, of the undrawn rows above and below — one spacer each. */
  padTop: number
  padBottom: number
}

// What was measured. `pitch` is the distance from one row's top to the next row's; 0 means there was
// nothing to measure against (see above), and every row is drawn.
type RowMetrics = { rowHeight: number; pitch: number }
// The geometry and the position as last seen — what a geometry change is compared against, because
// by the time the browser reports a resize the old numbers are gone from the element. `rows` is the
// position in the list's own unit: how many rows are scrolled past the top of the view, fractions
// included — the one number about the position that a change of row size does not change.
type RowView = RowMetrics & { clientHeight: number; scrollTop: number; rows: number }

/**
 * Scroll `el` the least it has to for the band of its content from `top` to `top + height` (content
 * coordinates) to be whole in view AND clear of the edge fades — a row sitting at the very edge is
 * half-dissolved by the fade there. At either end of the content the browser's own clamp wins: there
 * is nothing further to scroll to, and no fade at that edge to clear. Plain scrollTop arithmetic,
 * never scrollIntoView, which scrolls every scrollable ancestor as well.
 * The one "bring this row into view" for every list in the app: Lookup's history (below), a
 * dropdown's keyboard cursor (components/CustomSelect) and a preset row moved or annotated in
 * Manage Presets (components/PresetManager).
 */
export function scrollBandIntoView(el: HTMLElement, top: number, height: number): void {
  // No fade depth to read where no stylesheet is served.
  const margin = readShadeRampPx() || 0
  if (top - margin < el.scrollTop) el.scrollTop = top - margin
  else if (top + height + margin > el.scrollTop + el.clientHeight)
    el.scrollTop = top + height + margin - el.clientHeight
}

export function useWindowedRows<T extends HTMLElement>(
  ref: RefObject<T | null>,
  count: number,
  revealIndex: number,
  revealKey: unknown,
): RowWindow {
  const [metrics, setMetrics] = useState<RowMetrics | null>(null)
  // The first row in the viewport, and how many rows the viewport holds.
  const [view, setView] = useState({ first: 0, rows: WINDOW_FIRST_BATCH })
  // The effect's own "re-read the scroll position now", for the reveal below: a programmatic
  // scroll reports itself a frame late, and the rows it lands on must be drawn in the same frame.
  const syncRef = useRef<() => void>(() => {})
  // The wanted row, readable by the measuring effect (which re-runs only with the list's length).
  const revealIndexRef = useRef(revealIndex)
  useLayoutEffect(() => {
    revealIndexRef.current = revealIndex
  })
  const seenRef = useRef<RowView | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let pitch = 0
    let rowHeight = 0
    // Note the position (and the geometry it was read under) for the next geometry change.
    // The rows last noted STAND while the list is where they put it — to the pixel the browser
    // could give them: a whole one, and never past the end of the content. Anything else is a
    // scroll that moved the list, and the rows are read off where it is now.
    const see = () => {
      const scrollTop = el.scrollTop
      const was = seenRef.current
      const end = Math.max(el.scrollHeight - el.clientHeight, 0)
      const held = was !== null && Math.abs(Math.min(was.rows * pitch, end) - scrollTop) < 1
      seenRef.current = {
        rowHeight,
        pitch,
        clientHeight: el.clientHeight,
        scrollTop,
        rows: held ? was.rows : scrollTop / pitch,
      }
    }
    const sync = () => {
      if (pitch <= 0) return
      see()
      const first = Math.floor(Math.max(el.scrollTop, 0) / pitch)
      const rows = Math.ceil(el.clientHeight / pitch)
      setView((prev) => (prev.first === first && prev.rows === rows ? prev : { first, rows }))
    }
    // Read the rows' size off the page, and hand it to the spacers (which are drawn from it)…
    const measure = () => {
      const [a, b] = el.querySelectorAll<HTMLElement>('[data-row]')
      const top = a?.getBoundingClientRect()
      rowHeight = top?.height ?? 0
      // Two drawn rows are always neighbours, so the difference of their tops IS the pitch.
      pitch = a && b ? b.getBoundingClientRect().top - top!.top : 0
      if (!(pitch > 0)) pitch = 0
      const next = { rowHeight, pitch }
      setMetrics((prev) =>
        prev && prev.rowHeight === next.rowHeight && prev.pitch === next.pitch ? prev : next,
      )
    }
    // …then put the list back where it was, against what was last seen.
    const settle = () => {
      // ★ THE GEOMETRY CHANGED UNDER A LIST THAT WAS ALREADY ON SCREEN (the third part of the rule
      // at the top of this section).
      const was = seenRef.current
      if (
        was &&
        was.pitch > 0 &&
        pitch > 0 &&
        (was.pitch !== pitch || was.rowHeight !== rowHeight || was.clientHeight !== el.clientHeight)
      ) {
        // The row at the top of the view stays at the top: the same number of rows scrolled past,
        // at the rows' new size. (A box that only changed height needs nothing — scrollTop held.)
        if (was.pitch !== pitch) el.scrollTop = was.rows * pitch
        // …and the wanted row stays in view if it was whole in view.
        const wanted = revealIndexRef.current
        const wasTop = wanted * was.pitch
        if (
          wanted >= 0 &&
          wasTop >= was.scrollTop &&
          wasTop + was.rowHeight <= was.scrollTop + was.clientHeight
        )
          scrollBandIntoView(el, wanted * pitch, rowHeight)
      }
      sync()
    }
    syncRef.current = sync
    // At mount, and when the list's length changes, this is inside a layout effect: React draws the
    // spacers from the measurement before the browser paints, and cannot be asked to any sooner.
    measure()
    settle()
    // ★ A SCROLL RE-DRAWS THE WINDOW INSIDE THE SCROLL EVENT (flushSync), not on React's own
    // schedule. Left to the scheduler the new rows arrive a frame after the scroll that needed
    // them, and a hard fling or a scrollbar drag — which can cross more than the margin of rows
    // kept drawn — shows a blank band for that frame. It costs nothing while the first visible row
    // has not changed (setView returns the same object, so there is nothing to flush), and it is
    // only ever called from the event: a flushSync inside a layout effect is an error.
    const onScroll = () => flushSync(sync)
    el.addEventListener('scroll', onScroll, { passive: true })
    // ★ A REPORTED RESIZE COMMITS THE MEASUREMENT BEFORE IT MOVES THE LIST (flushSync — the rule at
    // the top of this section says why), and commits the move too, so the rows it lands on are drawn
    // in the frame that shows it. The observer calls from outside React, which is what allows it.
    const ro = new ResizeObserver(() => {
      flushSync(measure)
      flushSync(settle)
    })
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
    // `count` is a dependency because a list of ONE row has no neighbour to measure a pitch from:
    // the second row arriving is what makes the geometry measurable.
  }, [ref, count])

  const pitch = metrics?.pitch ?? 0
  const rowHeight = metrics?.rowHeight ?? 0
  // Which row was last revealed (null: none yet, i.e. the list has just mounted). The reveal below
  // answers a CHANGE of the wanted row; this is how it tells that from the geometry it also has to
  // read (and so re-runs for).
  const revealedRef = useRef<{ index: number; key: unknown } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || pitch <= 0) return
    const last = revealedRef.current
    if (last && last.index === revealIndex && last.key === revealKey) return
    revealedRef.current = { index: revealIndex, key: revealKey }
    if (revealIndex < 0) return
    const top = revealIndex * pitch
    if (last === null) el.scrollTop = top - (el.clientHeight - rowHeight) / 2
    else scrollBandIntoView(el, top, rowHeight)
    syncRef.current()
  }, [ref, revealIndex, revealKey, pitch, rowHeight])

  if (metrics === null)
    return { start: 0, end: Math.min(count, WINDOW_FIRST_BATCH), padTop: 0, padBottom: 0 }
  if (pitch <= 0) return { start: 0, end: count, padTop: 0, padBottom: 0 }
  const overscan = Math.max(view.rows, WINDOW_MIN_OVERSCAN)
  const end = Math.min(count, view.first + view.rows + overscan)
  const start = Math.max(0, Math.min(view.first - overscan, end - 1))
  return {
    start,
    end,
    // Everything above the first drawn row: `start` rows and the gaps between them. The gap before
    // the first drawn row is that row's own margin.
    padTop: start === 0 ? 0 : start * pitch - (pitch - rowHeight),
    padBottom: (count - end) * pitch,
  }
}
