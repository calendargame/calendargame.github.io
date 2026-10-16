import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import Expander from './Expander.jsx'
import { Kbd, SectionLabel, SECTION_LABEL_CLASS } from './primitives.jsx'
import { DAY, DAY_LETTER } from '../lib/format.js'
import { DOT_CELLS, DOT_GRID_SIZE, DIAGONAL_DOT_SCALE, type DotCell } from '../lib/dotLayout.js'
import { selectionSuppressesToggle } from '../lib/selectionGuard.js'
import { useSettings } from '../store/settings.js'
import { readGuidePlace, writeGuidePlace, discardGuidePlace } from '../store/sessionGuide.js'
import { onPageHidden } from '../lib/pageHidden.js'
import { PAGES, PRACTICE_MODES, modeNames, modeList, type PracticeModeId } from '../lib/modes.js'
import {
  ACCORDION_EASE_CSS,
  accordionEase,
  accordionScrollTarget,
  accordionToggleMs,
} from '../lib/accordionMotion.js'
import { observeScrollExtent, readShadeRampPx, writeShade } from './scrollRegion.js'
import {
  dockShades,
  restGeometry,
  releaseShades,
  arrivingShades,
  NO_DOCK,
  DOCK_LINE_BAND_PX,
  type Arrival,
  type DockShades,
  type HeaderDockGeometry,
} from '../lib/guideDock.js'

// GuidePage / GuideSection — the How-to-Play tab: an accordion of documentation
// sections (each a GuideSection wrapping an Expander) covering every observable
// behavior on the site. GuideSection is the reusable open/close row; GuidePage
// lays them out with Divider separators and owns the toggle coordinator:
// per toggle it measures both affected panels, computes one distance-scaled
// duration for the shared clock, and — when the layout change would carry the
// tapped section off-screen or clamp the shrinking scroll range — drives the
// scroll per-frame on the panels' own clock and curve, so the slide and the
// travel read as one motion (the math lives in lib/accordionMotion).
//
// ⚠ THE SCROLLER IS HANDED IN (round 13), and that is a cost worth naming. Until
// then this component drove `window` — the guide released the app's clamps and the
// DOCUMENT scrolled it, so the thing to move needed no introduction. It now shares
// #appScroll with every other screen (the reversal is argued at `switchMode` in
// main.tsx), and an overflow div has to be named, so App passes `scroller`. Every
// read below that used to be a window global — scrollY, innerHeight,
// document.scrollingElement.scrollHeight — is that element's scrollTop, clientHeight
// and scrollHeight instead. The arithmetic in lib/accordionMotion did not move a byte:
// it was always about "a scroller", and only its INPUT NAMES still say document.
//
// Extracted from main.jsx in Stage C, Step 4e. Rewritten for scannability — every
// section now leads with a one-line summary, then tight chunks / bulleted lists;
// no documented behavior was dropped. GuideSection is exported named; GuidePage is
// the default export.

// DOM ids for a section's landmarks. panelDomId is first an accessibility
// contract — the header button's aria-controls points at the panel body, which
// carries the id — and the coordinator leans on the same ids to re-derive every
// element it needs at tap time (the wrapper for geometry, the body for heights)
// from nothing but the two section-id strings in state. That kept the whole
// component ref-free until round 13, when the scroller itself had to be handed in;
// it is still what keeps the SECTIONS ref-free, which is the part that scales with
// the number of sections.
const sectionDomId = (id: string) => `guide-sec-${id}`
const panelDomId = (id: string) => `guide-panel-${id}`
// …and the header button, which DOCKS under the bar while its section is open: the dock tracker
// and the collapse-in-place both measure it against its wrapper, and both find it from the open id.
const headerDomId = (id: string) => `guide-head-${id}`

// readBarHeight — the fixed bar's height in px, which is the viewport y of its underside: THE LINE
// an open section's header docks against, and the line a section you open is glided to (they are
// one line — index.css's .guide-head says why). --bar-h is a literal px token App writes on <html>
// from the bar's own measured height (main.tsx's syncBarHeight) and it inherits down to the
// scroller, so this is a plain number wherever a stylesheet is served. NaN where none is (jsdom);
// each caller says what it does then.
const readBarHeight = (scrollerStyle: CSSStyleDeclaration): number =>
  parseFloat(scrollerStyle.getPropertyValue('--bar-h'))

// headerDockGeometry — the open header measured against its own section and against the line, in
// one read: the five numbers lib/guideDock turns into the two shadow strengths. `lineY` is the
// caller's (the bar's underside, in viewport y); the rest come off two rectangles.
// The wrapper's border is what separates its edge from where the header can actually be — the
// header's natural spot is just INSIDE the top border, and the lowest its bottom can reach is just
// inside the bottom one. clientTop is that border's width; .panel draws the same border on every
// side, so it is the bottom's width too.
function headerDockGeometry(id: string, lineY: number): HeaderDockGeometry | null {
  const wrapper = document.getElementById(sectionDomId(id))
  const header = document.getElementById(headerDomId(id))
  if (!wrapper || !header) return null
  const w = wrapper.getBoundingClientRect()
  const h = header.getBoundingClientRect()
  return {
    lineY,
    headerTop: h.top,
    headerBottom: h.bottom,
    naturalTop: w.top + wrapper.clientTop,
    floorY: w.bottom - wrapper.clientTop,
  }
}

// stillToCome — what has yet to happen to the OPEN section's place before the page is at rest, as
// lib/guideDock's restGeometry takes it. Measured, on any frame:
//   • comingUp — how far its top has yet to come up the page. Everything still FOLDING AWAY above
//     it: the rendered height of every panel before it in the page. Only one section is open at a
//     time, so those all belong to closed sections — at rest that is nothing (a closed panel has no
//     height); while a tap's fold runs it is what has yet to go, and after a quick second tap, what
//     TWO folds have yet to give up between them. Plus what is left of the glide (`glideLeft`: the
//     page scrolling on by that much brings the section up by that much).
//   • growing — how far its foot has yet to go down: what its own panel has yet to open (the body's
//     natural height, less the track that already shows — the coordinator's own measure).
function stillToCome(openId: string, glideLeft: number): { comingUp: number; growing: number } {
  const section = document.getElementById(sectionDomId(openId))
  const guide = section?.closest('[data-guide]')
  const body = document.getElementById(panelDomId(openId))
  if (!section || !guide || !body) return { comingUp: glideLeft, growing: 0 }
  const shown = (el: Element | null | undefined) => el?.getBoundingClientRect().height ?? 0
  let folding = 0
  // In document order, so the sections met before this one are the ones above it.
  for (const other of guide.querySelectorAll(`[id^="${sectionDomId('')}"]`)) {
    if (other === section) break
    folding += shown(other.querySelector(':scope > .expander'))
  }
  return {
    comingUp: folding + glideLeft,
    growing: Math.max(0, shown(body) - shown(body.closest('.expander'))),
  }
}

// anyPanelFolding — is any section's panel in How to Play still opening or folding away? Read off
// the transitions the browser is drawing them with, like foldClock: a transition the browser lists
// is one still running, and every one of them ends. (No Web Animations — jsdom — means nothing can
// be followed, and nothing is.)
function anyPanelFolding(): boolean {
  const guide = document.querySelector('[data-guide]')
  return (
    guide
      ?.getAnimations?.({ subtree: true })
      .some((a) => 'transitionProperty' in a && a.transitionProperty === 'grid-template-rows') ??
    false
  )
}

// headerPinDepth — how far a section's header has been carried DOWN its own wrapper by the sticky
// pin, in px: 0 at its natural spot (the section's top edge, just inside the border), growing as
// content scrolls up under a docked header. It is deliberately the header's displacement rather
// than a comparison against the line: a sticky box is displaced from its in-flow spot exactly when
// it is stuck, so this is 0 on every frame where nothing is under the header — a header that has
// only just arrived at the line included. Clamped at 0 because a fractional layout can leave a
// −0.x residue at rest.
function headerPinDepth(id: string): number {
  const g = headerDockGeometry(id, NaN)
  return g ? Math.max(0, g.headerTop - g.naturalTop) : 0
}

// foldClock — HOW FAR THROUGH ITS MOTION THIS TAP'S FOLD IS, 0…1, asked once a frame by everything
// the tap set moving that is not the fold itself: the page's glide, a header being brought down to
// the line, a closing header's shadows, and an opening section's arrival.
//
// ★ IT IS THE FOLD'S OWN CLOCK, READ OFF THE TRANSITION THE BROWSER IS DRAWING THE PANEL WITH. Those
// four used to keep time themselves — the first animation frame after the tap was their t=0, and
// the tap's duration their length — on the reasoning that the panel's CSS transition first renders
// on that same frame. It usually does. But the browser starts a transition when IT is ready to, and
// after a slow frame — the very frame in which a tall section starts to fold — that was a frame
// later than the first callback: measured, the page ran two frames ahead of the fold for the whole
// of the glide, and with eight thousand pixels of section folding that put the tapped header well
// over a thousand pixels from where the fold had its section. Two clocks started by two parties
// cannot be kept together by starting them carefully; there has to be one. So:
//   • `panel` is the panel this tap folds (the closing one when there is one — the taller motion,
//     and the one whose error is the visible one — else the opening one), and its transition's own
//     time, as a fraction of its own length, is the answer: 0 while the browser has not started it,
//     then exactly what is drawn. (Its TIME, not the progress it reports: where an engine puts the
//     curve — on the effect, or on its keyframes — decides whether that number is already eased.)
//     That is also right where a second tap REVERSES a fold in flight, which the browser shortens
//     by its own rule (the transition's duration is then not the one this tap worked out).
//   • once it has been followed, a panel with no transition has FINISHED: the answer is 1.
//   • a fold with no time to take (Reduce Motion: --motion-scale 0) is over at once.
//   • and where there is no transition to follow at all — an engine without one, the layout-less
//     test environment — it keeps time from its first frame over the tap's own duration, as before.
// The curve is not this clock's business: each asker eases the answer with accordionEase, the
// numeric twin of the panels' cubic-bezier.
interface FoldClock {
  /** Nothing takes any time: the end state at once. */
  instant: boolean
  /** How far through, 0…1, at the frame whose timestamp is `now`. */
  at: (now: number) => number
}
function foldClock(panel: HTMLElement | null, durationMs: number): FoldClock {
  let start: number | null = null
  let followed = false
  const instant = durationMs <= 0
  return {
    instant,
    at: (now) => {
      if (instant) return 1
      // (Optional calls: jsdom has no Web Animations.)
      const fold = panel
        ?.getAnimations?.()
        .find((a) => 'transitionProperty' in a && a.transitionProperty === 'grid-template-rows')
      const elapsed = fold?.currentTime
      const timing = fold?.effect?.getComputedTiming()
      if (typeof elapsed === 'number' && timing && typeof timing.duration === 'number') {
        followed = true
        const run = elapsed - (timing.delay ?? 0)
        return timing.duration > 0 ? Math.min(1, Math.max(0, run / timing.duration)) : 1
      }
      if (followed) return 1
      if (start === null) start = now
      return Math.min(1, (now - start) / durationMs)
    },
  }
}
// scrollBack — move a scroller back by `px`, at once (the step that keeps a pinned header under the
// finger as its section closes; the toggle says why). Its own function because the scroller reaches
// GuidePage as a prop, and the page's position is the one thing about it this screen writes.
const scrollBack = (el: HTMLElement, px: number): void => {
  el.scrollTop -= px
}
// startScrollWriter — the coordinator's per-frame scroll driver, pointed at the element
// the guide scrolls. Runs on the fold's own clock (foldClock, above) and on its curve:
// accordionEase is the numeric twin of the panels' CSS cubic-bezier. A fold with no time to
// take jumps straight to the end state on the first pre-paint callback: the snapped layout
// and the corrected scroll appear together (the Reduce Motion instant path, which also fixes
// the old teleport-past-max clamp). Any real user scroll input (touchstart/wheel) cancels the writer instantly —
// the user always wins — and the returned cancel function serves mid-flight re-toggles,
// leaving the guide for another mode, the app being backgrounded, and unmount (see
// scrollWriterRef below). `onTakenOver` is told when it was the READER who ended it — the one
// ending that leaves the page somewhere the tap did not plan (startArrival's caller, below).
// ⚠ THE CANCEL LISTENERS STAY ON `window`, deliberately, now that the scrolled thing is
// not the window. They are not scroll listeners — they are "the reader touched the page"
// listeners, and a touch or a wheel anywhere on the screen means the same thing whether or
// not it landed inside the scroll box. Narrowing them to the element would let a wheel
// over the fixed bar, or a finger that starts on a panel's margin, run the glide on under
// a user who has already begun to take over.
function startScrollWriter(
  el: HTMLElement,
  from: number,
  to: number,
  clock: FoldClock,
  onTakenOver: () => void,
): () => void {
  let raf = 0
  const cancel = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('touchstart', takeOver)
    window.removeEventListener('wheel', takeOver)
  }
  const takeOver = () => {
    cancel()
    onTakenOver()
  }
  window.addEventListener('touchstart', takeOver, { passive: true })
  window.addEventListener('wheel', takeOver, { passive: true })
  const step = (now: number) => {
    const p = clock.at(now)
    el.scrollTop = from + (to - from) * accordionEase(p)
    if (p < 1) raf = requestAnimationFrame(step)
    else cancel()
  }
  raf = requestAnimationFrame(step)
  return cancel
}
// startArrival — a section ARRIVING (lib/guideDock), on the fold's clock and curve like the glide
// that carries it and the header's own offset, but on its own frames — because there is an arrival
// whether or not there is a glide (a header already on the line has none), and it outlasts the glide
// when a reader takes the page over (the header is still coming down, the panel still opening).
// `onStep` is told how far along the curve it is (0…1) on every frame, and `onEnd` when the clock
// has run out. It asks for its frame AFTER the header's offset and the scroll writer have asked for
// theirs (the toggle starts it last), so on every frame it is called with the page and the header
// already where that frame puts them. Returns the cancel; neither callback is called after it.
// ⚠ IT ALSO OUTLASTS ITS OWN CLOCK WHILE ANYTHING IS STILL FOLDING (`stillFolding`). The clock is
// this tap's fold; a tap made while an EARLIER tap's fold was still running — a taller section,
// given longer — leaves that one moving the page after this clock is over. Handing the header back
// to its place then would be handing it back mid-motion, which is the very thing an arrival is for:
// so it holds at the end of its curve, answering for where the header will rest, until the page is.
function startArrival(
  clock: FoldClock,
  stillFolding: () => boolean,
  onStep: (eased: number) => void,
  onEnd: () => void,
): () => void {
  let raf = 0
  const step = (now: number) => {
    const p = clock.at(now)
    if (p < 1 || stillFolding()) {
      onStep(accordionEase(p))
      raf = requestAnimationFrame(step)
    } else onEnd()
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
// startShadeRelease — a closing header letting go of its shadows over the fold of its own panel
// (lib/guideDock's "RELEASING"): `write` is handed the two strengths for every frame, from exactly
// what was on screen at the tap to none for the header and all of its own for the bar, on the
// clock and curve the panel folds on. With no time to take (Reduce Motion) it lands at once, in the
// tap itself. Returns the cancel; `write` is never called after it.
function startShadeRelease(
  from: DockShades,
  clock: FoldClock,
  write: (shades: DockShades, done: boolean) => void,
): () => void {
  if (clock.instant) {
    write(releaseShades(from, 1), true)
    return () => {}
  }
  let raf = 0
  const step = (now: number) => {
    const p = clock.at(now)
    write(releaseShades(from, accordionEase(p)), p >= 1)
    if (p < 1) raf = requestAnimationFrame(step)
  }
  write(from, false)
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
// startHeaderOffset — a header's own distance from THE LINE while it is being brought to it. The
// stick (index.css's .guide-head, `top:0`) holds an open section's header ON the line whenever its
// section's top is above it. So a header tapped while it stood ABOVE the line — partly behind the
// bar, or scrolled away with the keyboard still on it — was put on the line the moment its panel
// had opened far enough to give it room: in ONE frame, ahead of the glide that brings the rest of
// the section down to meet it, when every other open arrives on that glide. For the length of the
// motion the header's `top` is therefore written here, inline: `fromPx` at once (in the tap, so the
// frame of the tap shows the header exactly where it was), then on to `toPx` on the clock and curve
// the panels and the scroll writer run, and off the header altogether at the end — the stylesheet's
// own line again. It reads the same clock as the scroll writer (foldClock), so the two agree on
// every frame: while only the glide is moving the page, the header rides its section's top edge
// exactly, and lands as it lands. `fromPx` equal to `toPx` HOLDS
// the header where it stands for that long (a section closed again while its header was still on
// its way). Returns the cancel, which leaves `top` as it stands; `onEnd` is told only when it ran
// to its end.
function startHeaderOffset(
  header: HTMLElement,
  fromPx: number,
  toPx: number,
  clock: FoldClock,
  onEnd: () => void,
): () => void {
  let raf = 0
  header.style.top = `${fromPx}px`
  const step = (now: number) => {
    const p = clock.at(now)
    if (p < 1) {
      header.style.top = `${fromPx + (toPx - fromPx) * accordionEase(p)}px`
      raf = requestAnimationFrame(step)
      return
    }
    header.style.top = ''
    onEnd()
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
export function GuideSection({
  id,
  title,
  children,
  openId,
  onToggle,
  durationMs,
}: {
  id: string
  title: ReactNode
  children?: ReactNode
  openId: string | null
  onToggle: (id: string) => void
  durationMs?: number | null
}) {
  const isOpen = openId === id
  // The per-toggle motion clock: GuidePage's coordinator computes ONE duration per
  // toggle — d(max of the two panels' travels, lib/accordionMotion) — and hands the same
  // value to every section, so the closing and the opening panel of an accordion switch
  // tween on one shared clock (only the two toggled panels actually animate). It reaches
  // its two consumers as the --expander-ms var: the Expander stamps it on the panel (its
  // durationMs prop), and the header button stamps it for the chevron — the button is the
  // Expander's SIBLING, so no single placement could reach both by inheritance. The cast
  // is the standard React custom-property escape (CSSProperties has no --* signature).
  const motionVar =
    durationMs == null ? undefined : ({ '--expander-ms': `${durationMs}ms` } as CSSProperties)
  return (
    // overflow-clip, not overflow-hidden: both round the corners off the header's opaque fill, but
    // `hidden` would also make this wrapper a scroll container, and the header's sticky pin
    // (.guide-head, index.css) answers to its NEAREST scroll container — it would pin against this
    // unscrolling box, i.e. never. `clip` clips without becoming one, so the pin reaches #appScroll.
    <div id={sectionDomId(id)} className="rounded-2xl panel overflow-clip">
      <button
        type="button"
        id={headerDomId(id)}
        aria-expanded={isOpen}
        aria-controls={panelDomId(id)}
        style={motionVar}
        // Guide text is selectable (`select-text` on the title span + the body wrapper below) —
        // a desktop drag-select across a title fires this click on mouse-up, so skip the toggle
        // while such a selection stands (lib/selectionGuard owns the rule) rather than collapse
        // the panel out from under it.
        onClick={(e) => {
          if (selectionSuppressesToggle(window.getSelection(), e.currentTarget)) return
          onToggle(id)
        }}
        // guide-head is the sticky dock and its opaque fill; elev-shadow-down is the docked header's
        // shadow, held at --shade 0 until GuidePage's dock tracker says text is under it.
        className="guide-head elev-shadow-down w-full text-left px-4 py-3 flex items-center justify-between"
      >
        <span className="text-sm font-semibold text-(--tx-50) select-text">{title}</span>
        <span
          className={`text-[7px] text-(--tx-w90) leading-none transition-transform ${isOpen ? 'rotate-180' : ''}`}
          // Read the panel's clock and curve EXACTLY (.expander declares the identical calc —
          // same var, same .24s fallback — and the identical curve) so the triangle and the
          // slide finish together, and honor the reduce-motion --motion-scale, so both snap
          // instantly under "Reduce Motion" instead of the panel snapping while the triangle
          // spins. tests/expander.dom pins all three legs of the sync.
          style={{
            transitionDuration: 'calc(var(--expander-ms, .24s) * var(--motion-scale))',
            transitionTimingFunction: ACCORDION_EASE_CSS,
          }}
        >
          ▼
        </span>
      </button>
      <Expander open={isOpen} durationMs={durationMs ?? undefined}>
        <div
          id={panelDomId(id)}
          className="px-4 pb-4 pt-1 text-[13px] text-(--tx-100-90) leading-relaxed space-y-2 select-text"
        >
          {children}
        </div>
      </Expander>
    </div>
  )
}
// Section divider with a centered label, placed between GuideSection groups. Defined at
// module scope (not inside GuidePage) so it's a stable component type across renders —
// React's compiler flags components created during render. It closes over nothing but
// its `label` prop, so hoisting is behavior-identical.
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <div className="flex-1 h-px bg-(--bg-500-20)"></div>
      <span className={SECTION_LABEL_CLASS}>{label}</span>
      <div className="flex-1 h-px bg-(--bg-500-20)"></div>
    </div>
  )
}
// Lead — a one-line summary at the top of a GuideSection, so the section's gist is
// scannable before the details. Slightly brighter than body text — the same --tx-50
// ramp tier the section titles use (index.css), which every theme defines, so
// it stays legible on light/parchment by construction.
function Lead({ children }: { children: ReactNode }) {
  return <p className="text-(--tx-50)">{children}</p>
}
// Subhead — a small uppercase sub-label inside a section (the keyboard-group style),
// used to break a long section into scannable blocks. SectionLabel (primitives) owns
// the label styling; this only adds the in-section spacing.
function Subhead({ children }: { children: ReactNode }) {
  return <SectionLabel className="mb-1 mt-1">{children}</SectionLabel>
}
// Bulleted list helper — scannable detail with theme-legible bullets: the markers use
// the per-theme --mut-color var directly (the Tailwind v4 var shorthand — the precedent
// the text/rule ramp generalized app-wide), so they stay visible on every theme.
function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1 marker:text-(--mut-color)">{children}</ul>
}
// ModeItems — one bullet per practice mode, for a list that says what something does "per mode".
// Keyed by mode and emitted in the page list's order (lib/modes), so the bullets can never be in a
// different order from the mode menu. A mode with nothing to say is simply left out of `items`.
function ModeItems({ items }: { items: Partial<Record<PracticeModeId, ReactNode>> }) {
  return PRACTICE_MODES.map((m) => (m.id in items ? <li key={m.id}>{items[m.id]}</li> : null))
}
// DotDiagram — a small inline SVG of the 7-dot answer layout (Settings → Display →
// Input → Dots), each dot labelled with its weekday. Everything is DERIVED from the
// shared DOT_CELLS grid (lib/dotLayout — the same data that positions the real Dots
// input) + the DAY names (lib/format), and the aria-label sentence reads the filled cells
// in row order — no hand-kept copy of the layout exists here to drift. Drawn entirely in
// currentColor so it's legible on every theme.
// ★ IT SHOWS THE PLAYER'S OWN ROTATION (Settings → Display → Rotate Dots), not a fixed
// picture of the standard one: the section's heading is "Which dot is which", and there is
// exactly one honest answer to that — the layout currently on screen. A diagram per
// rotation was considered and rejected: it would document the setting three times (the
// words below already name all three) while making the answer to "which dot is which"
// ambiguous, which is the one thing the diagram is for. Changing the setting redraws this
// picture, which is its own documentation.
// THE FRAME NEVER CHANGES — viewBox, dot size, labels-below-dots, and the middle cell at (90, 90)
// — only the lattice around it. Standard and 90° are the 3×3, 60 across and 62 down between
// neighbours: cell (r,c) → (x = 30+(c-1)*60, y = 28+(r-1)*62). 45° is the 5×5 lattice
// (DOT_GRID_SIZE), drawn the way the real input draws it: the 3×3's spacing turned and scaled by
// DIAGONAL_DOT_SCALE, so a lattice step is that spacing × k/√2 (≈34 × 35). Its seven dots sit on a
// checkerboard, so a dot's nearest neighbour in its OWN column is two steps (~70) down — more room
// than the 3×3 gives a label — and a diagonal neighbour sits ~34 across, clear of a three-letter
// label either side; the outermost dots and the bottom label still fit the 180 × 192 frame.
//   ⚠ A STORE SELECTOR, where every other consumer of this setting takes a prop. It is
//     forced rather than chosen: GuidePage's props are all about scrolling (`visible`,
//     `scroller`, `readingOffset`), so a prop would mean opening a settings pipeline through the guide
//     for one decorative SVG at the bottom of it. Selecting here also keeps the
//     subscription at the leaf — the guide itself does not re-render on a change.
// Each rotation's grid → its step between neighbouring cells (x, y), per the note above; the 5×5's
// rounded to hundredths so the SVG carries short coordinates.
const DIAGONAL_STEP = (standardStep: number) =>
  Math.round(((standardStep * DIAGONAL_DOT_SCALE) / Math.SQRT2) * 100) / 100
const DIAGRAM_STEP: Record<3 | 5, { x: number; y: number }> = {
  3: { x: 60, y: 62 },
  5: { x: DIAGONAL_STEP(60), y: DIAGONAL_STEP(62) },
}
// The diagram's middle cell — (2,2) on the 3×3, (3,3) on the 5×5 — sits here on every grid.
const DIAGRAM_CENTRE = { x: 90, y: 90 }
// A cell's position in words, per grid. The 3×3's centre reads "centre" and every other filled
// cell is row-column ("top-left", "middle-right", …). The 5×5's seven lie on the turned H: the
// four tips of the diamond read as plain compass words ("top", "left", …) and the in-between cells
// as "upper-right" / "lower-left" style, so each name still says where to look.
const posName = (cell: DotCell, size: 3 | 5): string => {
  if (size === 3)
    return cell.r === 2 && cell.c === 2
      ? 'centre'
      : `${['top', 'middle', 'bottom'][cell.r - 1]}-${['left', 'centre', 'right'][cell.c - 1]}`
  const v = ['top', 'upper', '', 'lower', 'bottom'][cell.r - 1]
  const h = ['left', 'left', '', 'right', 'right'][cell.c - 1]
  return [v, h].filter(Boolean).join('-') || 'centre'
}
function DotDiagram() {
  // Read RAW, deliberately not gated on inputStyle — the diagram documents what the chosen
  // rotation looks like even when Buttons is the player's current Input, the same way it renders
  // at all regardless of Input.
  const dotRotation = useSettings((s) => s.dotRotation)
  const DOT_CELL = DOT_CELLS[dotRotation]
  const size = DOT_GRID_SIZE[dotRotation]
  const step = DIAGRAM_STEP[size]
  const mid = (size + 1) / 2
  // Hundredths again, so float residue (90 − 2 × 33.94 = 22.120000000000005) never reaches the SVG.
  const at = (centre: number, offset: number, stepLen: number) =>
    Math.round((centre + offset * stepLen) * 100) / 100
  const dotX = (cell: DotCell) => at(DIAGRAM_CENTRE.x, cell.c - mid, step.x)
  const dotY = (cell: DotCell) => at(DIAGRAM_CENTRE.y, cell.r - mid, step.y)
  const ariaLabel = `Dots layout: ${DAY.map((day, i) => ({ day, cell: DOT_CELL[i] }))
    .sort((a, b) => a.cell.r - b.cell.r || a.cell.c - b.cell.c)
    .map(({ day, cell }) => `${day} ${posName(cell, size)}`)
    .join(', ')}.`
  return (
    <svg
      viewBox="0 0 180 192"
      width="156"
      role="img"
      aria-label={ariaLabel}
      className="my-1 text-(--tx-100-90)"
    >
      {DAY.map((day, i) => (
        <g key={day}>
          <circle cx={dotX(DOT_CELL[i])} cy={dotY(DOT_CELL[i])} r="11" fill="currentColor" />
          <text
            x={dotX(DOT_CELL[i])}
            y={dotY(DOT_CELL[i]) + 27}
            textAnchor="middle"
            fontSize="13"
            fill="currentColor"
            opacity="0.9"
          >
            {day.slice(0, 3)}
          </text>
        </g>
      ))}
    </svg>
  )
}
// `visible` is the same prop the five game modes take, and it does the same two jobs: it drives
// the display toggle on this component's own root (App keeps every screen mounted, so leaving How
// to Play no longer destroys the open panel or the reading position), and it tells the component
// it has left the screen — the moment a running scroll glide has to be dropped, since there is no
// unmount left to do it.
// `scroller` is the element this screen scrolls: App's one #appScroll container, shared with
// every other screen (round 13) — or null on the one render before App has it.
// ★ THE ELEMENT, HELD IN APP'S STATE — NOT A REF TO IT. It was a ref, on the reasoning that a value
// read during render is null on the first pass. That is exactly why it must not be one: the dock
// tracker below needs the scroller in an EFFECT, and on the first commit a parent's ref is filled
// AFTER its children's effects have run. So a guide that was on screen from the first render with
// a section already open found no scroller, gave up, and — a ref changing is not a render — was
// never asked again. As state, the element arriving IS a render, and every effect that names it
// runs again with it: nothing here depends on who mounts first.
// `readingOffset` is how far down the reader is, for the place this screen parks for a reload
// (round 23, below). App owns that number — it is what App restores on the way back into the
// guide (main.tsx's guideScrollYRef) — so App answers it: live while the guide is on screen,
// remembered while it is not. A function, asked at the moment the page hides: the offset then is
// the only one worth parking.
// `onBarYield` hands App the share of its own shadow the top bar should keep, 0…1 — 0 while the
// open section's header is docked against the bar and wearing the shadow itself, 1 whenever no
// header is docked (the dock tracker below; lib/guideDock is the rule). App owns the bar and the
// rest of what decides its shadow, so App does the multiplying.
export default function GuidePage({
  visible,
  scroller,
  readingOffset,
  onBarYield,
}: {
  visible: boolean
  scroller: HTMLDivElement | null
  readingOffset: () => number
  onBarYield: (share: number) => void
}) {
  // The open section — seeded from the place parked before a reload (store/sessionGuide), so a reload
  // reopens the section the reader had open; App seeds the offset from the same place. Read once.
  const [open, setOpen] = useState<string | null>(() => readGuidePlace()?.open ?? null)
  // THE PLACE, PARKED FOR A RELOAD (store/sessionGuide argues the lifecycle): the open section and the
  // reading offset, written when the page hides (lib/pageHidden — every reload, and a tab going to
  // the background) and discarded when this screen unmounts, which a reload never does. The listener
  // is registered once per mount and reads the latest open section through a ref written after every
  // commit, so it parks what was on screen, never an uncommitted render.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  useEffect(() => {
    const stop = onPageHidden(() => writeGuidePlace({ open: openRef.current, y: readingOffset() }))
    return () => {
      stop()
      discardGuidePlace()
    }
  }, [readingOffset])
  // The shared per-toggle motion clock (ms), stamped onto every section (see GuideSection).
  // null until the first toggle — pre-toggle renders never animate, so the sections simply
  // fall back to the CSS default duration.
  const [motionMs, setMotionMs] = useState<number | null>(null)
  // The in-flight scroll writer's cancel function (null = none running). Canceled on any
  // user scroll input by the writer itself, on re-toggle mid-flight by the coordinator
  // below, and by the effect on three occasions: leaving the guide for another mode, the app
  // being BACKGROUNDED, and unmount. Leaving matters MORE since round 13, not less: the writer
  // drives the shared #appScroll container, so a survivor would literally be scrolling the
  // screen that replaced the guide, in that screen's own scroll units — and it would not be
  // FIGHTING the mode switch's reset but landing after it, since the switch writes the top once
  // and never again (and this component stays mounted, so nothing else would stop it). Which is
  // why the effect below has to run in the layout phase; the ⚠ block on it argues that in full.
  // The backgrounded case matters because rAF stops firing while hidden: a writer caught
  // mid-flight would resume on return against a timestamp gap, snapping the page to a target
  // computed for a tap the reader has long since forgotten. Cancelling leaves the panels to
  // finish their CSS transition and the browser to hold position (the guide-scoped
  // overflow-anchor:none in index.css guarantees "hold"). Nothing is re-armed on return:
  // foregrounding is not a navigation and must never move the reading position.
  const scrollWriterRef = useRef<(() => void) | null>(null)
  const cancelScrollWriter = useCallback(() => {
    scrollWriterRef.current?.()
    scrollWriterRef.current = null
  }, [])
  // ── THE BAR'S SHARE OF ITS SHADOW HAS TWO SOURCES, AND ONE WRITER ──────────────────────────────
  // `tracked` is what the open header's place says (the dock tracker, below) — all of it while
  // nothing is open. The other is every RELEASE in flight: the share a header that has just been
  // CLOSED is still handing back while its panel folds (startShadeRelease). The bar is told the
  // smallest of them, so a release can hold the bar's shadow down for the length of a fold and can
  // never lift it above what the open header allows.
  // ★ MORE THAN ONE HEADER CAN BE LETTING GO AT ONCE, each over its own panel's fold: close a
  // section and tap another before the fold is over, or go from one to the next to the next. So the
  // releases are kept by the header each is fading — with the strength it last wrote on that header
  // and the share it is holding the bar to — and a new tap leaves the ones already running to
  // finish. (There was one slot: a tap ended whatever release was in it, which dropped that
  // header's shadow and freed the bar's share in the frame of the tap.)
  const barShareRef = useRef({ tracked: NO_DOCK.barYield })
  const releasesRef = useRef(
    new Map<HTMLElement, { strength: number; share: number; cancel: () => void }>(),
  )
  // What the bar is told: the smaller of the open header's word and every release's.
  const barShare = useCallback(() => {
    let share = barShareRef.current.tracked
    for (const release of releasesRef.current.values()) share = Math.min(share, release.share)
    return share
  }, [])
  const paintBarShare = useCallback(() => onBarYield(barShare()), [onBarYield, barShare])
  // What the tracker last wrote for the open header — where a release starts from.
  const openShadesRef = useRef<DockShades>(NO_DOCK)
  // End every release in flight and put what each was fading at rest — its header shadowless, the
  // bar's share no longer held: for when nothing else is about to write them (the guide leaving the
  // screen, the app going to the background).
  const restReleases = useCallback(() => {
    for (const [header, release] of releasesRef.current) {
      release.cancel()
      writeShade(header, NO_DOCK.header)
    }
    releasesRef.current.clear()
    paintBarShare()
  }, [paintBarShare])
  // The section still ARRIVING (lib/guideDock) — with what was on screen at the tap, how far along
  // the motion's clock it is, and where the glide carrying the page is taking it (`glideTo`: null
  // once nothing is — no glide, or a reader has the page) — and the clock's cancel. And the
  // tracker's own evaluate, which every frame of that clock asks for: the two strengths are
  // measured, never guessed.
  const arrivingRef = useRef<{
    id: string
    arrival: Arrival
    glideTo: number | null
    cancel: () => void
  } | null>(null)
  const trackerRef = useRef<(() => void) | null>(null)
  // Stop the arrival's clock where it stands, and write nothing: what is on screen stays on screen
  // for whatever takes over (a tap's release starts from it; a tracker that goes on looking writes
  // what the place says the next time it looks).
  const endArrival = useCallback(() => {
    arrivingRef.current?.cancel()
    arrivingRef.current = null
  }, [])
  // The headers whose own distance from the line is being written (startHeaderOffset), each with
  // its cancel: the one being brought down to the line, and any that was closed again on the way
  // and is held where it stood until its panel has folded. A header has one at a time.
  const headerOffsetsRef = useRef(new Map<HTMLElement, () => void>())
  // Take a header's offset off it where it stands. `rest`: and give it back to the stylesheet's
  // line — right whenever nothing is about to write it again.
  const endHeaderOffset = useCallback((header: HTMLElement, rest: boolean) => {
    headerOffsetsRef.current.get(header)?.()
    headerOffsetsRef.current.delete(header)
    if (rest) header.style.top = ''
  }, [])
  const runHeaderOffset = useCallback(
    (header: HTMLElement, fromPx: number, toPx: number, clock: FoldClock) => {
      endHeaderOffset(header, false)
      headerOffsetsRef.current.set(
        header,
        startHeaderOffset(header, fromPx, toPx, clock, () =>
          headerOffsetsRef.current.delete(header),
        ),
      )
    },
    [endHeaderOffset],
  )
  const restHeaderOffsets = useCallback(() => {
    for (const header of [...headerOffsetsRef.current.keys()]) endHeaderOffset(header, true)
  }, [endHeaderOffset])
  // ⚠ A LAYOUT EFFECT, and that is the whole of the guard's correctness since round 13. React runs
  // layout effects child-first and passive effects in a LATER task, so a passive version of this
  // would be ordered AFTER App's mode-switch layout effect (main.tsx), which resets #appScroll to
  // the top. A frame that slipped into that gap would write a guide-space offset onto the game
  // screen that had just replaced the guide, and nothing would put it back — the reset had already
  // run. As a layout effect the cancel lands BEFORE the reset, in the same commit, with no window
  // for a frame at all. It cost nothing before the move only because the writer drove `window` in a
  // clamped mode, where the write was a guaranteed no-op; the move removed that accident, so the
  // ordering has to be stated rather than inherited. The touchstart/wheel cancels do not cover it:
  // the keyboard mode shortcuts, a desktop mouse click on the mode selector and Android Back all
  // change modes without either event. tests/guideScroll.dom pins the ordering.
  useLayoutEffect(() => {
    // Off-screen: drop anything in flight, and listen for nothing — a hidden guide can neither
    // start a glide nor be scrolled, so there is no visibility case left to handle.
    // …and a closing header's shadows are put at rest rather than left mid-fade (restReleases): rAF
    // stops while hidden for the release exactly as it does for the glide. A header still on its
    // way to the line is given back to the stylesheet's line for the same reason.
    // An arrival is ended with them, for the same reason — and the open header, which is still on
    // screen when it is the APP that was hidden, is looked at again where the stylesheet's line has
    // now put it.
    if (!visible) {
      cancelScrollWriter()
      endArrival()
      restReleases()
      restHeaderOffsets()
      return
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      cancelScrollWriter()
      endArrival()
      restReleases()
      restHeaderOffsets()
      trackerRef.current?.()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelScrollWriter()
      endArrival()
      restReleases()
      restHeaderOffsets()
    }
  }, [visible, cancelScrollWriter, endArrival, restReleases, restHeaderOffsets])
  // The toggle coordinator — hooked into the single toggle callback, never pointer
  // events. Everything is measured at tap time, pre-animation: the closing panel's
  // RENDERED height (its grid track — a mid-flight re-toggle reads the interpolated
  // value, so the retarget stays exact), the opening panel's remaining travel (the body's
  // natural height minus whatever track already shows — its full height at rest), and the
  // tapped wrapper's document position. lib/accordionMotion turns those into the shared
  // clock d(max(hClosing, hOpening)) and the scroll target (above-the-reading-line rule for
  // opens, clamp rule for shrinks, null when the current position stays coherent); the
  // writer then glides the scroller on that same clock and curve. --motion-scale
  // pre-multiplies the writer's duration exactly as the panels' CSS calc does, so Reduce
  // Motion (scale 0) jumps instantly to the correct end state (jsdom's empty var read is
  // NaN → treated as 1, animate).
  // THE DOCK TRACKER — one shadow, under whichever edge the text is sliding beneath. While a
  // section is open its header docks flush against the bar, and from then on the header's underside
  // is the edge the section's text slides under, not the bar's. So on every frame this measures the
  // open header (headerDockGeometry), asks lib/guideDock for the two strengths, and writes both in
  // the same breath: the header's own --shade, and the share of its shadow the bar keeps
  // (onBarYield). lib/guideDock argues the rule and proves the two are never on together; what
  // matters HERE is that both leave from one measurement in one callback, so there is no frame
  // that has one side of the hand-off and not the other.
  // That is also the owner's first rule for these headers, kept: OPENING a section never makes it
  // look pinned. The glide brings the header to the line with nothing under it, where both
  // strengths are 0; the header's shadow appears only as text really goes under it, and goes again
  // on the way back up.
  // It re-reads on the scroller's scroll AND on any change to its extent (observeScrollExtent):
  // the geometry also moves without a scroll event whenever layout above the header changes — the
  // panel above it collapsing as this one opens, above all. Both write paint only (two shadow
  // strengths), which is the contract observeScrollExtent's callback must keep.
  // A LAYOUT effect for the same reason as useScrollEdgeState: evaluated after paint, a return to a
  // guide left mid-section would show one frame of the bar's shadow over a docked header.
  // Only the OPEN header is tracked — a closed one has no room to dock in (index.css .guide-head),
  // and a closed header is page content wherever it lies — and the cleanup stops speaking for it:
  // the bar is owed its whole shadow as far as this header goes, and the header rests at 0 —
  // UNLESS it is the one a release has just taken over (the toggle below starts that before this
  // cleanup runs), in which case its shadow is the release's to take down over the fold, and the
  // bar's share is held by the release too. A section that loses the SCREEN has no release, so it
  // leaves nothing behind. Off-screen there is nothing to track: a hidden guide cannot scroll.
  useLayoutEffect(() => {
    const header = visible && open ? document.getElementById(headerDomId(open)) : null
    if (!open || !scroller || !header) return
    // Live: the same object answers with the current --bar-h on every read, so a bar that changes
    // height (a rotation, the fluid root font) moves the line with it.
    const scrollerStyle = getComputedStyle(scroller)
    // One object each for the component's life (never reassigned): held here so the cleanup reads
    // and writes the same ones.
    const share = barShareRef.current
    const releases = releasesRef.current
    const evaluate = () => {
      // The bar is fixed to the top of the viewport and the scroller's box starts there too, so the
      // bar's underside is the scroller's top plus the bar's height. Unmeasurable (NaN, where no
      // stylesheet is served) leaves the bar's shadow alone — lib/guideDock's own rule.
      const lineY = scroller.getBoundingClientRect().top + readBarHeight(scrollerStyle)
      const geometry = headerDockGeometry(open, lineY)
      const rampPx = readShadeRampPx()
      const arriving = arrivingRef.current?.id === open ? arrivingRef.current : null
      // An ARRIVING header answers for where it will come to REST, not for where it is
      // (lib/guideDock argues it): the same rule, asked about the place it is headed for.
      const settle = (g: HeaderDockGeometry): HeaderDockGeometry => {
        if (!arriving) return g
        const glideLeft = arriving.glideTo === null ? 0 : arriving.glideTo - scroller.scrollTop
        const { comingUp, growing } = stillToCome(open, glideLeft)
        return restGeometry(g, comingUp, growing)
      }
      const place = geometry ? dockShades(settle(geometry), rampPx) : NO_DOCK
      const shades = arriving && geometry ? arrivingShades(arriving.arrival, place) : place
      openShadesRef.current = shades
      writeShade(header, shades.header)
      share.tracked = shades.barYield
      paintBarShare()
    }
    trackerRef.current = evaluate
    evaluate()
    // ★ WHERE AN ARRIVING HEADER WILL REST CAN CHANGE IN ONE FRAME FOR A REASON THAT IS NOT THE
    // CLOCK'S: the reader scrolls the page themselves, or the screen is turned. The arrival then
    // sets off again from exactly what is on screen — the last thing written, before this event is
    // looked at — over what is left of its clock, so the new resting place is come to, not jumped
    // to. (A scroll while the glide is carrying the page is the glide's own, and changes nothing
    // about where the header will rest; the glide being TAKEN OVER does this itself, in the toggle.)
    const setOffAgain = () => {
      const arriving = arrivingRef.current
      if (arriving?.id !== open) return
      arriving.arrival.from = openShadesRef.current
      arriving.arrival.since = arriving.arrival.progress
    }
    const onScroll = () => {
      if (arrivingRef.current?.glideTo === null) setOffAgain()
      evaluate()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', setOffAgain)
    const stopExtent = observeScrollExtent(scroller, evaluate)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', setOffAgain)
      stopExtent()
      trackerRef.current = null
      openShadesRef.current = NO_DOCK
      if (!releases.has(header)) writeShade(header, NO_DOCK.header)
      share.tracked = NO_DOCK.barYield
      paintBarShare()
    }
  }, [visible, open, scroller, paintBarShare])
  const toggle = useCallback(
    (id: string) => {
      // Whatever the last tap set moving stops where it stands — the glide, and the arrival's clock
      // with it. Neither writes anything on its way out, so everything below reads, and starts
      // from, exactly what is on screen.
      cancelScrollWriter()
      endArrival()
      const opens = open !== id
      // COLLAPSING FROM A PINNED HEADER (round 23). The header is pinned under the bar with the
      // section's top edge scrolled away above it, and the collapse is about to shrink that section
      // to just the header — at its natural spot, i.e. up there under the bar, taking the header the
      // reader just tapped out from under their finger and dropping them among whatever sections
      // follow. So the scroller first moves back by exactly the pin depth, which puts the header's
      // natural spot where the pinned header already IS: nothing on screen moves in this step, and
      // the header stays put while its panel folds away beneath it. It happens HERE, synchronously in
      // the tap and before the state flip, so this write and the collapse's first frame paint
      // together — no frame of either without the other — and before everything below reads
      // scrollTop, so the coordinator plans the rest of the motion (the end-of-page clamp, if the
      // collapse shortens the page past the reader) from the corrected position. A close of an
      // UNPINNED section, and every open, have a depth of 0 and skip it.
      const pinDepth = opens ? 0 : headerPinDepth(id)
      if (pinDepth > 0 && scroller) scrollBack(scroller, pinDepth)
      const tapped = document.getElementById(sectionDomId(id))
      const closingExpander = open
        ? (document.getElementById(panelDomId(open))?.closest<HTMLElement>('.expander') ?? null)
        : null
      const openingBody = opens ? document.getElementById(panelDomId(id)) : null
      // ⚠ Both panel measures read getBoundingClientRect().height, never offsetHeight, which is
      // specified to round to a whole pixel (round 10 — the same sub-pixel fix as --bar-h, whose
      // ⚠ block in main.tsx carries the reader list and the transform caveat that applies here
      // too: a transform on a panel would make these VISUAL heights, not layout ones). The three
      // roundings this coordinator used to carry are not equal in cost:
      //   • closingH is the worst, worth about twice the bar: it is subtracted from the document
      //     height AND — when the closing panel sits above the tapped header — from that header's
      //     final position, so one rounding error moves the scroll target through two terms.
      //   • openingH moves the landing least of the three, but it is a DIFFERENCE OF TWO
      //     INDEPENDENTLY ROUNDED INTEGERS, so its own error reaches a full 1.0px — twice either
      //     other — and it feeds finalMaxScroll, the clamp that decides whether the target can
      //     reach the seat at all.
      const closingH = closingExpander?.getBoundingClientRect().height ?? 0
      const openingH = openingBody
        ? Math.max(
            0,
            openingBody.getBoundingClientRect().height -
              (openingBody.closest<HTMLElement>('.expander')?.getBoundingClientRect().height ?? 0),
          )
        : 0
      // The shared clock and the state flip depend on nothing but the panel measurements —
      // they land unconditionally, before the scroll coordination decides anything.
      const durationMs = accordionToggleMs(closingH, openingH)
      // --motion-scale is an app-wide token and stays a documentElement read. It scales everything
      // this tap sets moving that is not a CSS transition: the glide, and a closing header's
      // shadows. (jsdom's empty read is NaN → treated as 1.)
      const scaleRead = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--motion-scale'),
      )
      const scaledMs = durationMs * (Number.isFinite(scaleRead) ? scaleRead : 1)
      // …and all of it keeps the fold's own time (foldClock), off the panel this tap folds.
      const clock = foldClock(
        closingExpander ?? openingBody?.closest<HTMLElement>('.expander') ?? null,
        scaledMs,
      )
      // A SECTION THAT IS CLOSING LETS GO OF ITS SHADOWS OVER ITS OWN FOLD (lib/guideDock's
      // "RELEASING") — this tap's, or the open one a tap on another section swaps out. Started
      // HERE, before the state flips: the tracker's cleanup runs in the commit that follows, and by
      // then the release already owns the header's shadow and holds the bar's share where it was,
      // so the frame of the tap paints exactly what was on screen. A release still in flight from
      // an earlier tap is left to finish, on its own panel's fold — with one exception: the release
      // of the very header being opened again. That one's arrival (below) takes over both things
      // the release was holding, exactly where they stand: what is left of the header's shadow, and
      // the bar's share — which the release therefore stops holding down. (Left held, the bar's
      // shadow and the page's top fade stayed capped at wherever the fold had got to, for as long
      // as that section was open.)
      const releases = releasesRef.current
      const sharedBefore = barShare()
      const tappedHeader = opens ? document.getElementById(headerDomId(id)) : null
      const interrupted = tappedHeader ? releases.get(tappedHeader) : undefined
      const headerBefore = interrupted?.strength ?? NO_DOCK.header
      if (tappedHeader && interrupted) {
        interrupted.cancel()
        releases.delete(tappedHeader)
      }
      const closingHeader = open ? document.getElementById(headerDomId(open)) : null
      if (closingHeader) {
        const from = { header: openShadesRef.current.header, barYield: sharedBefore }
        // In the map BEFORE it starts: its first word is written as it starts, and (with no time to
        // take) so is its last.
        const release = { strength: from.header, share: from.barYield, cancel: () => {} }
        releases.set(closingHeader, release)
        release.cancel = startShadeRelease(from, clock, (shades, done) => {
          writeShade(closingHeader, shades.header)
          release.strength = shades.header
          release.share = shades.barYield
          if (done) releases.delete(closingHeader)
          paintBarShare()
        })
      }
      setMotionMs(durationMs)
      setOpen(opens ? id : null)
      // AN OPENING SECTION IS ARRIVING for the length of this motion (lib/guideDock) — EVERY one,
      // whether or not the page glides for it: the bar's share and the header's shadow go from what
      // is on screen now to what they will be where the header comes to rest, over the clock rather
      // than in the frame of the tap. Each frame of that clock moves it on and has the tracker
      // measure and write; when the clock has run out the header is looked at once more, as it
      // stands. `glideTo`: where the page is being carried to, or null when it is not.
      // ⚠ CALLED AT EVERY WAY OUT OF THIS TAP, AND ONLY THERE — after the glide and the header's own
      // offset have asked for their frames, so each of its frames finds the page and the header
      // already where that frame puts them (startArrival). It was once started only on the way out
      // that had a glide: a header tapped while it was already on the line — every section closed
      // from its docked header and opened again — had no arrival, and the bar's shadow and the page's
      // top fade went out in the frame of the tap.
      // (With no time to take — Reduce Motion — its first frame is its last: the page has landed by
      // then, and the place answers before anything is painted.)
      const arrive = (glideTo: number | null): void => {
        if (!opens) return
        const arrival: Arrival = {
          from: { header: headerBefore, barYield: sharedBefore },
          since: 0,
          progress: 0,
        }
        const cancelArrival = startArrival(
          clock,
          anyPanelFolding,
          (eased) => {
            arrival.progress = eased
            // (The glide ends with the clock: from there nothing is carrying the page.)
            if (eased >= 1 && arrivingRef.current?.arrival === arrival)
              arrivingRef.current.glideTo = null
            trackerRef.current?.()
          },
          () => {
            arrivingRef.current = null
            trackerRef.current?.()
          },
        )
        arrivingRef.current = { id, arrival, glideTo, cancel: cancelArrival }
      }
      // Scroll coordination needs the scroller's geometry on top of the two panel measurements.
      // TWO preconditions, and they are not the same guard wearing two shapes:
      //   • a scroller to read at all — App's container, which is null only before it mounts.
      //   • a scroller with MEASURABLE EXTENT. scrollHeight 0 means the platform has laid nothing
      //     out: there is no scroll range, every number the target would be built from is a zero,
      //     and gliding is meaningless. A real engine cannot report it — a rendered overflow box is
      //     at least as tall as its own content — so this costs production nothing.
      // ⚠ THE SECOND ONE IS THE TEST SEAM, and round 13 is exactly the change it was written for.
      // It used to read document.scrollingElement, and the first guard held the writer out of a
      // layout-less DOM only by accident of jsdom not implementing that property. Now that the
      // scroller is a ref to a real element it can never be absent, and a writer gated on presence
      // alone would drive a zero-height page in every test that so much as taps a guide header.
      // Stating the precondition in terms of the GEOMETRY survived the move untouched: a test that
      // wants the writer stands up the extent the glide travels through, which is the same geometry
      // the target is computed from anyway.
      if (!tapped || !scroller || scroller.scrollHeight <= 0) return arrive(null)
      // ★ A HEADER TAPPED ABOVE THE LINE IS BROUGHT DOWN TO IT, NOT DROPPED ON IT
      // (startHeaderOffset says what used to happen). Measured here, in the tap, before the commit
      // that opens its panel: how far above the line the tapped header's top stands. Past the band
      // in which a header counts as ON the line (lib/guideDock), its own offset starts at exactly
      // that — where it is — and runs out to nothing over this tap's motion. Anything else leaves
      // the header to the stylesheet's line: one already on or below it, an instant open (Reduce
      // Motion: no motion, so the end state at once), and a line that cannot be read (jsdom's NaN).
      // The section this tap closes — its own, or the one a tap elsewhere swaps out — may still be
      // carrying an offset from an open a moment ago. Given back to the line mid-fold, the stick
      // would drop its header there for as long as the folding panel left it room; so it is HELD
      // where it stands for the length of the fold, and let go when there is no room left to stick
      // in.
      if (closingHeader && headerOffsetsRef.current.has(closingHeader)) {
        const standsAt = parseFloat(closingHeader.style.top)
        if (scaledMs > 0) runHeaderOffset(closingHeader, standsAt, standsAt, clock)
        else endHeaderOffset(closingHeader, true)
      }
      if (tappedHeader) {
        const aboveLine =
          scroller.getBoundingClientRect().top +
          readBarHeight(getComputedStyle(scroller)) -
          tappedHeader.getBoundingClientRect().top
        if (scaledMs > 0 && aboveLine > DOCK_LINE_BAND_PX)
          runHeaderOffset(tappedHeader, -aboveLine, 0, clock)
        else endHeaderOffset(tappedHeader, true)
      }
      const scrollY = scroller.scrollTop
      const tappedRect = tapped.getBoundingClientRect()
      const target = accordionScrollTarget({
        scrollY,
        // The scroller's own visible height. This is where round 10's caveat about
        // window.innerHeight vs documentElement.clientHeight DIES rather than moves: the question
        // was which of two whole-viewport measures the document scroller meant, and there is no
        // longer a document scroller. clientHeight is the box's content height by definition —
        // including the padding-top that seats the content below the fixed bar, which is inside the
        // box and therefore inside scrollHeight too, so the two agree by construction.
        viewportH: scroller.clientHeight,
        // THE LINE a tapped section is glided to: the bar's underside, which is exactly where its
        // header docks while the section scrolls (index.css .guide-head) — one docking position,
        // whether you arrive by opening the section or by scrolling it. Where no stylesheet is
        // served (jsdom) the token is empty and this lands on 0; there the panels still toggle on
        // the shared clock, writer-less.
        seatTop: readBarHeight(getComputedStyle(scroller)) || 0,
        // The height of everything the scroller can scroll through. scrollHeight has no fractional
        // twin to switch to — the spec defines it as a rounded integer and exposes nothing else, so
        // this one read stays as it is. Its error is bounded at half a pixel and lands only in
        // finalMaxScroll, which is itself a clamp. (lib/accordionMotion still calls this field
        // docH; it was named when the document was the scroller and its test pins the name.)
        docH: scroller.scrollHeight,
        // The tapped HEADER's natural top in the SCROLLER's content space: the wrapper's viewport y
        // plus its top border (the header sits just inside it), minus the scroller's own viewport
        // y, plus how far the scroller has already been scrolled. The header's top, not the
        // wrapper's, is what has to land on the line: that is the edge the stick holds there, so a
        // section you open comes to rest on the very pixel it docks at — its border tucked behind
        // the bar, as it is whenever the header is docked. (The scroller's own y was structurally 0
        // while the document scrolled, and #appScroll is `absolute inset-0` so it is 0 today too,
        // but that is a layout choice rather than a definition, and the general form costs one
        // rect read.)
        headerDocTop:
          tappedRect.top + tapped.clientTop - scroller.getBoundingClientRect().top + scrollY,
        closingH,
        // A closing panel above the tapped header pulls it up by its own collapse; the
        // tapped section's own panel sits BELOW its header, so a plain close never does.
        closingAbove:
          closingExpander !== null && closingExpander.getBoundingClientRect().top < tappedRect.top,
        openingH,
      })
      if (target === null) return arrive(null)
      // The glide. A reader who takes the page over stops it: nothing is carrying the page any more,
      // so where the header will come to rest has just changed — and the arrival sets off again from
      // exactly what is on screen (the tracker's last word), over what is left of its clock.
      scrollWriterRef.current = startScrollWriter(scroller, scrollY, target, clock, () => {
        const arriving = arrivingRef.current
        if (arriving?.id !== id) return
        arriving.glideTo = null
        arriving.arrival.from = openShadesRef.current
        arriving.arrival.since = arriving.arrival.progress
      })
      arrive(target)
    },
    [
      open,
      cancelScrollWriter,
      endArrival,
      barShare,
      endHeaderOffset,
      runHeaderOffset,
      paintBarShare,
      scroller,
    ],
  )
  return (
    // This root is the whole screen, so it carries all three of the screen's outer properties:
    //   • the display toggle — App keeps every screen mounted, and the toggle has to sit on the
    //     element that carries the margin below, or a hidden guide would still push 10px of
    //     margin into App's flex column on every other screen.
    //   • mt-2.5 — half of the 20px this screen used to carry as a single mt-5 on its wrapper.
    //     The guide-only pb-2.5 on the fixed bar (main.tsx) absorbs the other half, which centres
    //     the bar's shadow line in the same 20px gap. Both halves are guide-only, and neither is
    //     what the other screens use (the game modes open on StatPanel's mt-4).
    //   • the panel gap as a TOKEN, not a utility step: --guide-panel-gap (index.css) is the one
    //     home of that number, and tests pin this className to it. A literal space-y-2 here would
    //     be a second home and the two would drift.
    // data-guide is a STYLING HOOK, not state: index.css kills scroll anchoring across this
    // subtree, which is the pair to the coordinator above (an engine that anchors would move the
    // scroller underneath the writer while the panels grow). It sits on this element because this
    // element IS the guide's subtree, and it is a separate attribute rather than another class so
    // the className stays the one literal the panel-gap pin reads.
    <div
      data-guide
      className="mt-2.5 space-y-(--guide-panel-gap)"
      style={{ display: visible ? 'block' : 'none' }}
    >
      <GuideSection
        id="overview"
        title="What Is Calendar Game?"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>A training tool for working out the day of the week of any date, in your head.</Lead>
        <p>
          You're given a date and must identify which weekday it falls on — as quickly and
          accurately as possible. Dates on or before October 4, 1582 (the day before the Gregorian
          reform took effect) are treated as Julian, matching history — the Julian Calendar setting,
          on by default, controls this. Every later date is Gregorian.
        </p>
        <Subhead>Install and offline</Subhead>
        <p>
          It runs entirely in your browser and saves your progress on this device. Add it to your
          home screen to use it like an app:
        </p>
        <UL>
          <li>
            <b>iPhone</b> — Safari's Share button → Add to Home Screen.
          </li>
          <li>
            <b>Android</b> — Chrome's Install app / Add to Home screen.
          </li>
        </UL>
        <p>
          Give the sheet a moment to show the app's icon before tapping <b>Add</b> — it can briefly
          show a generic placeholder while the icon loads.
        </p>
        <p>
          Once it has loaded it works fully offline, with no connection needed to practice. A brief{' '}
          <b>loading screen</b> (the app logo) shows while it starts up.
        </p>
        <p>
          The app is designed portrait-only. An Android install locks itself to portrait; on iPhone
          and other phones that still rotate, turning the device sideways brings up a full-screen{' '}
          <b>Rotate back to portrait</b> screen until you turn it upright again — any running Flash
          or Blitz countdown pauses while it's up, so an accidental rotation mid-round never costs
          time. Desktop windows and tablets are never blocked.
        </p>
        <Subhead>Updates</Subhead>
        <p>
          Updates take care of themselves: while you use the app, any new version quietly downloads
          in the background and takes effect the next time the app loads — when you open it again,
          or reload it. A short <b>updating screen</b> marks the change — it appears once for each
          new version, even when the switch already finished quietly between visits. Switching back
          from another app never triggers it; the update waits for the next load. To ask right now
          instead, the Settings (⚙) panel has a <b>Check for updates</b> link. It really does check:
          the link reads <b>Checking…</b> while it looks, then answers in the same spot —{' '}
          <b>Up to date</b> if you already have the newest version the site is handing out, or{' '}
          <b>No connection</b> if it could not reach the internet. The answer stays for a few
          seconds and the link goes back to normal. Only when there genuinely is something new does
          it install it there and then, behind the same updating screen (your saved progress is kept
          either way) — unless something is still waiting to be saved, when it holds off instead and
          says why (see <b>Saved Progress</b>). A brand-new version can take up to about ten minutes
          to reach everywhere, so a check in that window can still answer <b>Up to date</b> — asking
          again a little later finds it.
        </p>
        <p>
          To see what an update actually changed, the <b>Changelog</b> link — at the right-hand end
          of the ⚙ panel&apos;s last line, with Check for updates before it — opens a plain-words
          list of what recent updates changed, each entry dated and listed newest first — the dates
          use the numeric form of your selected format, and the list scrolls within the popup once
          it grows long. Its heading also carries the app&apos;s <b>version number</b>, dimmed in
          the top-right corner — that is the one to quote if you ever need to say exactly which copy
          of the app you have. Each dated entry covers a whole day: if a day brought more than one
          update, that day's changes are gathered under the one date. The list shows the ten most
          recent days that had an update — anything older than that is no longer listed. After an
          update, a small <b>light-blue dot</b> points the way there: it appears in the top-right
          corner of the gear button (⚙) until you open the menu, and just after the Changelog link's
          own text until the first time you open the changelog. The one beside Changelog appears
          only when this list has actually gained something since you last saw it, so it never sends
          you to something you have already read; the gear's dot marks every update either way. The
          gear's dot is separate from the small violet bar that marks modified settings (see the
          Save Defaults section), and the two can show at once. The gear&apos;s dot has one other
          colour: <b>amber</b> means this device is running short of room for the app (see Saved
          Progress), not an update — and if both are true at once, it is amber.
        </p>
        <Subhead>The book and contact</Subhead>
        <p>
          It pairs with the book{' '}
          <i>Day-of-the-Week Calculation: A Highly Optimized Mental Method</i>.
        </p>
        <p>
          Questions, ideas, bugs, or mistakes — about the site or the book — are welcome:{' '}
          <a href="mailto:dayoftheweekcalculation@gmail.com" className="underline break-all">
            dayoftheweekcalculation@gmail.com
          </a>
          . Nothing is too small to mention — even a typo or a detail that looks slightly off.
        </p>
      </GuideSection>
      <Divider label="Interface" />
      <GuideSection
        id="buttons"
        title="Buttons"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>How tapping, dragging, and each on-screen button work.</Lead>
        <Subhead>Tapping and dragging</Subhead>
        <UL>
          <li>Tap any button to use it.</li>
          <li>
            Press a button but slide your finger off before lifting and nothing happens — the tap is
            cancelled — so a misclick is easy to back out of.
          </li>
          <li>
            How long you hold a button before lifting makes no difference: a long press works just
            like a tap, and so does sliding off a button and back onto it before you lift. Only a
            press that turns into a scroll does nothing.
          </li>
          <li>
            On an iPhone, a quick double tap and hold on a button doesn&apos;t bring up the
            magnifier. Text you can select, and the boxes you type in, still have it.
          </li>
          <li>
            Answer options reach a little further than they look. Each one responds across its whole
            rectangle, rounded corners included, and half way into the space beside it — so the gap
            between two options belongs to them, split down the middle, and a tap that lands between
            two buttons goes to the nearer one instead of nowhere. In the seven-dot layout each dot
            answers to its whole square, not just the circle. This is only about where you can
            press: nothing moves, and nothing changes size.
          </li>
          <li>
            The space <i>around</i> the answer grid stays dead on purpose, and so do the two spots
            in the seven-dot layout that have no dot. Where those are turns with the layout:
            top-middle and bottom-middle in the standard one, upper-left and lower-right at 45°, and
            middle-left and middle-right at 90°. That is where a press goes to be cancelled: slide
            onto any of them — or onto an option you have already tried — and lifting your finger
            does nothing.
          </li>
          <li>
            On the weekday answer grid you can slide between options: press one, drag to the option
            you want (it highlights as you move, including over an already-answered option), and
            release on it to choose it — the one you started on included, if you come back to it.
          </li>
          <li>
            The mode selector at the top works this way too — press it and drag down to a mode, then
            release to switch (or just tap to open the menu and tap a mode, as before). Once it's
            open, five things close it: choosing a mode, pressing anywhere outside it, Esc, Tab or
            Shift+Tab (Tab is also the key that opens it; see Keyboard Input), and your device's
            Back button (described below). Starting a scroll by touching the page outside the menu
            is one of those presses outside, so that closes it — but a touch that lands on the menu
            itself is not, and neither is the page moving on its own: it stays put under its button
            in the bar while the page coasts to a stop behind it, and you can open it mid-glide.
          </li>
          <li>
            So does the preset control on the other side of the bar, which is the same kind of list
            and behaves the same way — see <b>Presets</b> below.
          </li>
          <li>
            So does the Settings gear (⚙): press it and drag straight into the panel — it
            auto-scrolls when you drag near its top or bottom edge — then release on a setting to
            change it; the panel closes and the change applies. Releasing on a Year Range field
            opens the keyboard to type instead, and the buttons at the foot of the panel keep the
            panel open.
          </li>
          <li>
            Your device's own Back — Android's Back button, or your browser's back arrow or
            back-swipe — closes whatever is open on top rather than leaving the app: the mode menu,
            the ⚙ panel, any popup, Show Codes, or this guide. Press it again for the next layer
            down. (This is the phone or browser's Back, not the <b>&lt;</b> button inside the game,
            which walks back through dates.) Installed on an iPhone home screen there's no Back to
            press, and the app deliberately adds none.
          </li>
          <li>
            Timer sliders (Flash speed and both Blitz timers) — tap the value beside the slider to
            type an exact number of seconds instead of dragging.
          </li>
          <li>
            Every box you can type into arrives with all of it already highlighted, so the first
            thing you type replaces what was there and you never have to clear a box first. That
            holds however you got in — a tap, <Kbd>Tab</Kbd>, dragging from the ⚙ gear onto a Year
            Range box, or tapping a timer value to type it. Once you&apos;re in the box it behaves
            normally again: tap a second time to put the cursor somewhere, or drag across part of
            the value to select just that part.
          </li>
          <li>
            Opening anything puts the keyboard away. Start typing in a box, then open the ⚙ panel,
            the mode menu, Show Codes, or this guide, and the keyboard closes with it instead of
            sitting on top of what you opened. What you typed is <i>kept</i> — the box commits it
            exactly as if you had tapped away from it. <Kbd>Esc</Kbd> is what throws an edit away.
          </li>
          <li>
            The sections of this guide open one at a time — opening a section closes the one before
            it. When a section opens or closes, the page scrolls along with the motion whenever
            that's needed to keep your place: instead of sliding off-screen, the section you tapped
            comes to rest right under the bar at the top, with its title fully readable — a title
            that was partly tucked under the bar when you tapped it slides down into place with the
            rest of its section, it doesn't jump there ahead of it. The last section or two are the
            exception — the page has already run out of room to scroll by then, so they settle
            wherever the bottom of the page allows.
          </li>
          <li>
            While you read down a long section, its title stays docked right under the bar at the
            top — the same spot a section you open comes to rest in — so you can always see which
            section you&apos;re in and tap it closed from anywhere in it. The title picks up a soft
            shadow only once the text starts scrolling underneath it, and loses it again when you
            scroll back up; while a title is docked, the bar&apos;s own shadow steps aside for it,
            so the shadow is always under whichever edge the text is sliding beneath. The soft fade
            at the top of this page steps aside with it — a docked title is never faded — and
            returns as the title leaves. Closing a section from its docked title leaves the title
            right where it is while the section folds away below it.
          </li>
          <li>
            The guide holds its place while you're in the app: switch to a mode, play, and come back
            and the same section is still open at the same point on the page. Switching presets,
            changing Amnesic, and deleting a preset keep it too — the guide isn't any one preset's —
            and so does a reload (reloading the page, or the app updating itself). Only a fresh
            start — closing the app and launching it again, or a Full Reset — returns it to the top
            with every section closed. Switching to another app and back is not a fresh start: that
            keeps your place, here as everywhere else.
          </li>
          <li>
            Text around the app can't be selected or highlighted, so presses and drags always
            operate the game. The exceptions are anywhere you type (the Year Range, Lookup, and MoX
            run length fields, plus any timer value you've tapped to type), the contact email, and
            everything in this How to Play guide, section titles included — guide text selects and
            copies like a normal page.
          </li>
        </UL>
        <p>
          It all works the same way with a mouse. The weekday answer grid comes in two layouts —
          labelled buttons (default) or the seven-dot logo layout — chosen under{' '}
          <b>Settings → Display → Input</b>; tapping and dragging work the same in either.
        </p>
        <Subhead>Loading dates</Subhead>
        <UL>
          <li>
            <b>New</b> — {modeNames('classic', 'deduction')}: load a fresh date.
          </li>
          <li>
            <b>Begin</b> — timer modes only ({modeList('flash', 'aox', 'blitz')}). In Flash it
            flashes the next date, hiding it after the configured duration. In{' '}
            {modeNames('aox', 'blitz')} it starts a run or round: the timer starts and the date is
            shown (MoX hides it between solves only when One-by-One is on, and a <b>Continue</b>{' '}
            button shows each one).
          </li>
          <li>
            <b>Reset</b> — timer modes only. In Flash it stands in for Begin while a date is in
            play: it ends that question and clears your question history, keeping your stats. In
            MoX, it ends the current run; in Blitz, it ends the current round and unlocks settings.
            Saved bests are preserved either way. Press Reset then Begin to start a fresh run/round.
          </li>
          <li>
            <b>Reset Stats</b> — casual modes only ({modeList('classic', 'deduction', 'flash')}).
            See below.
          </li>
        </UL>
        <Subhead>Reset Stats (casual modes)</Subhead>
        <p>
          Clears your stats, all-time bests, and question history for the current mode (Deduction
          only resets the current sub-type's), for the preset you are on. The other modes keep
          theirs, and no other preset is touched. While the preset&apos;s Amnesic is on Stats Only
          or Full, the stats on screen are that session&apos;s, and those are all it clears: your
          saved stats are set aside behind the session and stay exactly as they were — the popup
          says so. Details:
        </p>
        <UL>
          <li>
            <b>Asks first, in a popup</b> that names what it does, that the other modes keep theirs,
            and that no other preset is touched. The rose button confirms; tapping outside the
            popup, pressing <Kbd>Esc</Kbd>, or using your device&apos;s Back leaves everything as it
            was. (The button no longer changes colour or text on its own — the popup is the whole
            confirmation.)
          </li>
          <li>
            Generates a new date when timing stats are visible, or when you've burned the current
            date (answered wrong, revealed, or shown codes); otherwise the current date is kept.
          </li>
          <li>
            In Flash, a mid-question Reset Stats always generates a new date and returns to dash.
          </li>
          <li>Does not affect timer-mode bests.</li>
        </UL>
        <Subhead>Browsing history — Back / Forward</Subhead>
        <UL>
          <li>
            <b>Back (&lt;)</b> — return to the previous date. The answer is shown and the card is
            locked; no stat penalty. You can go back through everything you have played this visit
            in {modeNames('classic', 'deduction', 'flash')} (a reload keeps it, and each preset
            keeps its own while you are in another); in {modeNames('aox', 'blitz')}, through the
            current run or round once it has ended.
          </li>
          <li>
            Every history entry shows the correct answer in green; a wrong guess appears as dimmed
            red alongside the green.
          </li>
          <li>
            While browsing back, a small <b>Q#</b> label at the top-right of the date card numbers
            the card you are looking at, and it counts whatever the <b>Score</b> box beside it
            counts. In {modeNames('classic', 'deduction', 'flash')} that score is your lifetime
            total, so browsing back to the card you just answered on a 471/501 shows <b>Q501</b> —
            the 501st card you have ever played, not the first of this sitting. Anything with its
            own Score box is numbered on its own: Deduction's Day, Month, and Year each count
            separately, and in {modeNames('aox', 'blitz')} — where Begin and Reset clear the score —
            the numbering restarts at Q1 with it. Reset Stats likewise re-starts the count along
            with the score it clears.
          </li>
          <li>
            <b>Forward (&gt;)</b> — move forward through dates you browsed past with Back. Forward
            history clears whenever you answer a new question, press New/Begin/Reset, or take any
            action that advances the date. Overriding while browsing back does <i>not</i> clear it.
          </li>
          <li>
            Each entry remembers its date format and calendar system, so a back-then-forward round
            trip never alters how a date was originally shown.
          </li>
        </UL>
        <Subhead>Reveal, Override, and Show Codes</Subhead>
        <p>
          <b>Reveal</b> — show the correct answer without guessing. Counts as a wrong attempt. No
          penalty on unanswered dates while browsing back.
        </p>
        <p>
          <b>Override</b> — fix a mistake. Override any date in your history by browsing to it with
          Back/Forward. Once there is a date behind you, the one button always tells you which state
          that date is in: it reads <b>Override</b> when the date still counts the way you answered
          it, and <b>Undo</b> when you have already overridden it. It is dimmed only when there is
          no date for it to mean yet — a mode just opened, or a run or round just begun, with
          nothing answered behind the date on screen — and, in the casual modes, by Save Stats (see
          the last bullet below). A dimmed button still shows the right word for its date.
        </p>
        <UL>
          <li>
            After a wrong answer (or a Reveal, or a Show Codes): credits the date and adjusts your
            score. On the date you are playing, it then moves you on to a new date, just as a
            correct answer would — except where a MoX run or Blitz round stays ended, or the credit
            completes a MoX run: then the date stays on screen (see below). The credit brings a time
            with it — how long you took over your first attempt on that date — but only if timing
            stats were showing the first time you overrode that date (in {modeNames('aox', 'blitz')}{' '}
            they always are). That time is fixed from then on: a date first overridden with timing
            hidden adds nothing to your mean, and never will, however many times you switch it
            later.
          </li>
          <li>After a correct answer: takes the credit away, and its time leaves your mean.</li>
          <li>
            Either way, your streak and best streak are worked out again from every date in play, so
            crediting a date in the middle of your history can join two runs of correct answers into
            one, and taking one away splits them.
          </li>
          <li>
            You can also override the most recent past date directly from a fresh, untouched live
            question (any mode) — the button points at that past date, so it reads <b>Undo</b> there
            when that date is already overridden, and tapping it flips its right/wrong status either
            way.
          </li>
          <li>
            A date the clock ran out on before you touched it (Blitz, Per Question) can never be
            overridden — running out of time is not a misclick. While it is on screen the button
            points at the date <i>before</i> it, so a tap changes that earlier date, not the one you
            are looking at. A date you had already answered wrong when its clock ran out is
            different: that wrong answer can still be credited.
          </li>
          <li>
            A previously correct date flipped to wrong shows a green-and-red diagonal split:
            green-upper-left (originally correct), red-lower-right (now counted wrong). Undo puts
            the plain green back.
          </li>
          <li>
            Overriding a wrong answer (however you do it) shows only the correct answer — but your
            wrong highlights are not lost, they are stored with that date. Undo brings back exactly
            the reds you left there.
          </li>
          <li>
            <b>Undo</b> — when the button reads Undo, tapping it puts that date back the way you
            answered it: its original right/wrong marks, its own solve time, and your score, streak,
            and mean with it. Then it reads Override again. You can switch back and forth as many
            times as you like, forever. A second tap within about a third of a second of the first
            is ignored, so a quick double-tap can&apos;t override and then immediately undo it — tap
            again a moment later. (The <Kbd>O</Kbd> key is never held back this way.)
          </li>
          <li>
            There is no time limit and nothing is ever used up. Every date in your history remembers
            how you answered it and whether it is overridden — so you can answer more questions,
            browse away, and come back to it, and the button still reads Undo there and still works.
            What clears these dates is what clears the history itself. In every mode: a Reset (Reset
            Stats; the Reset button in {modeNames('flash', 'aox', 'blitz')}; or Begin in{' '}
            {modeNames('aox', 'blitz')}), a Full Reset, and closing the app. In{' '}
            {modeNames('aox', 'blitz')}, also changing a setting the run or round depends on (it
            resets when you close the ⚙ menu) and leaving the mode while a run or round is still
            going. In {modeNames('classic', 'deduction', 'flash')} the history belongs to this visit
            and to its preset: a reload keeps it, every date&apos;s Override state included;
            switching presets sets it aside and it is there when you switch back; and putting
            Amnesic on Stats Only or Full sets yours aside and gives it back when Amnesic returns to
            Off (the session&apos;s own is discarded with the rest of that session). After a very
            long sitting — getting on for a thousand dates or more in one mode — only the most
            recent of them may come back: about three thousand in Classic and Flash, about two
            thousand in Deduction&apos;s Day and Year puzzles, and a little under a thousand in its
            Month puzzle. And if several modes hold very long histories at once, the history of a
            mode you are not in may not come back at all; the one you are in always does. Your
            scores and the date numbers are unaffected either way. A MoX run or Blitz round that has{' '}
            <i>ended</i> comes back the same ways, with every date&apos;s Override state — unless a
            setting it was played under was changed in the meantime, in which case it is not brought
            back (the bests it set are kept).
          </li>
        </UL>
        <p>Override in the run modes:</p>
        <UL>
          <ModeItems
            items={{
              blitz: (
                <>
                  <b>Blitz</b> — override past dates after the round ends to adjust your score and
                  saved bests. With Allow Mistakes off, any tap that leaves a date wrong during a
                  round — Override or Undo — ends the round, just like a wrong answer; with it on,
                  the round keeps going.
                </>
              ),
              aox: (
                <>
                  <b>MoX</b> — with Allow Mistakes off, any tap that leaves a date wrong ends the
                  run. With Allow Mistakes on, taking the credit off the solve that finished the run
                  hands the run back to you: that date stays on screen as a resolved miss and a{' '}
                  <b>Next</b> button carries the run on.
                </>
              ),
            }}
          />
          <li>
            In both run modes, if a run/round ended because you answered wrong, revealed, or showed
            codes, crediting that date continues it — picking up where it left off instead of
            staying ended. Two things hold that back. With Allow Mistakes off, nothing else in the
            run/round may still be wrong: if something is, the credit counts and the date stays on
            screen, but the run/round stays ended. And a tap made while browsing back never restarts
            a run or round under you — it comes back only on a tap made at the live date.
          </li>
          <li>
            Because the button works both ways, a tap can also end a run or round that is still
            going (a flip to wrong with Allow Mistakes off) and then put it back. In Blitz the clock
            tells you which happened. A round that ended because its date was answered, revealed, or
            show-coded has that answer on screen, so its clock stops while it waits; crediting that
            date resumes Per Round from exactly the time it had left, and Per Question with a fresh
            question clock on the next date. A round a tap ended still has its live date on screen,
            unanswered — so its clock keeps counting down while the round sits ended, in full view,
            and putting the round back costs you every second of that. Waiting is never free, and if
            the clock runs out while the round waits, the round is over for good.
          </li>
          <li>
            Save Stats in the casual modes ({modeList('classic', 'deduction', 'flash')}): the button
            follows the Save Stats setting that was in force when the date on screen was played. A
            date played with it off was never scored, so it can&apos;t be overridden; one played
            with it on still can, even after you turn it off. On a fresh, untouched date the button
            follows the setting as it is now, so with Save Stats off it is dimmed there. Browsing
            back, it always works — every date in your history was scored. In{' '}
            {modeNames('aox', 'blitz')} it works the same whether Save Stats is on or off (the run
            still tracks internally; it&apos;s just not saved).
          </li>
        </UL>
        <p>
          <b>Show Codes</b> — reveals the calculation codes for the current date. Counts as a miss
          on a date you haven't answered yet. On a date you've already answered wrong it can't count
          a second miss, but it does show the answer and ends your tries on that date. Once you've
          answered it right, revealed it, or are browsing back, opening the codes is just a review
          and changes nothing. Per mode:
        </p>
        <UL>
          <ModeItems
            items={{
              blitz: (
                <>
                  <b>Blitz</b> — opening Show Codes during a round ends the round and records your
                  bests.
                </>
              ),
              flash: (
                <>
                  <b>Flash</b> — freezes the countdown so the date stays on screen while you study.
                </>
              ),
              aox: (
                <>
                  <b>MoX</b> — without Allow Mistakes, opening Show Codes ends the run.
                </>
              ),
            }}
          />
        </UL>
      </GuideSection>
      {/* PRESETS — the app's biggest feature, and the guide section that documents all of it. The
          top-bar rebuild put the SWITCHER on screen and this section described it; sub-group 4C
          added the MANAGER (⚙ → Presets → Manage Presets), which is the half that lets a player
          have more than one preset at all — so the "there is no way to make a second preset yet"
          paragraph that stood here has been DELETED rather than softened, together with the ⚠ in
          this comment that said the change adding a create/delete UI would own that sentence. This
          is that change.
          ★ THE SECTION LEADS WITH THE OWNER'S OWN RULE, in his words' plain sense: "only the current
          preset, ALL settings apply to that preset only including defaults and all that." It is
          stated ONCE, here, as its own block — and every other section that used to say "your
          stats" or "your settings" as though there were one set of them now points at it instead of
          repeating it. That sweep is the largest rule-4 obligation this guide has had; the sections
          it touched are Saved Progress, Save Defaults / Reset Settings / Full Reset, Settings
          Overview, and Accessibility.
          Sources, so a reader can check any sentence against the code: the control = components/
          PresetSwitcher (its ariaLabel, its options list, the sr-only "<name>, amnesic" phrases); the
          manager = components/PresetManager (every button's accessible name, the delete
          confirmation's two views, the withheld ✕ on a last preset); what a switch actually swaps =
          store/presetControl's PER_PRESET_STORES, all four of them; what a delete actually removes =
          its clearPresetStorage, which is derived from store/presets' PRESET_STORE_KEYS; which
          presets skip the confirmation entirely = that file's isPresetFactory, whose comment
          also argues the one entry of clearPresetStorage it deliberately does not count; the screen
          clear = main.tsx's registry subscription calling remountScreens; a name of any length =
          store/presets' normalizePresetName (it trims, and names an empty one — nothing else);
          whether a name is cut short, and the note that says so = lib/presetNameWidth, measured
          against every cell components/PresetSwitcher's PresetOptionLabel draws (the control, a row
          of its list, and Open in's); the short form of a ready-made name = store/presets'
          shortStockName, drawn by PresetOptionLabel on lib/presetNameWidth's stockNamesAreCut; how
          much of a very long name is drawn or quoted = lib/presetNameText; a name the device has
          no room for = store/presetControl's renamePreset ('no-room'); the list being exactly its
          control's width = components/CustomSelect's 'match-trigger'. */}
      <GuideSection
        id="presets"
        title="Presets"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Everything the app remembers belongs to a <b>preset</b>, and the control at the top left —
          beside the logo, where the app&apos;s name used to be — says which one you are on.
        </Lead>
        <p>A preset is a complete, separate copy of the app. Each one keeps its own:</p>
        <UL>
          <li>stats and all-time bests;</li>
          <li>per-mode setup — timers, run length, the Deduction sub-type, the stat toggles;</li>
          <li>
            every setting in the <b>Per-preset</b> half of the ⚙ menu, theme and <b>Default Mode</b>{' '}
            (the page it opens on) included;
          </li>
          <li>saved defaults;</li>
          <li>
            its <b>Amnesic</b> setting — each preset is on Off, Stats Only, or Full in its own
            right, whichever one you happen to be on.
          </li>
        </UL>
        <p>
          <b>Only the preset you are on is ever touched.</b> Every setting in the <b>Per-preset</b>{' '}
          half of the ⚙ menu, every default you save, <b>Reset Settings</b>, <b>Full Reset</b>, and
          each mode&apos;s <b>Reset Stats</b> apply to that preset and to no other. The ⚙
          menu&apos;s <b>Global</b> section (the <b>Open in</b> setting — which preset the app opens
          into) sits outside all of that: it is one app-wide choice, in no preset. Nothing
          per-preset is shared or merged: switching swaps all of it at once, and the preset you left
          is exactly where you left it when you come back — including, for the rest of the visit,
          the page you were on.
        </p>
        <p>
          <b>
            Lookup history is the one thing that is <i>not</i> in that list.
          </b>{' '}
          It is shared by every preset — the same list, however many presets you have or whichever
          one you switch to — because a Lookup is a question you asked, not a record of how you did.
          See <b>Saved Progress</b> below for what that means for Amnesic and for Full Reset.
        </p>
        <Subhead>Switching</Subhead>
        <UL>
          <li>
            Tap the control for the list, then tap a preset to switch. Press and drag down to a row
            and release, exactly like the mode selector beside it — and the same five things close
            it (choosing, pressing outside, <Kbd>Esc</Kbd>, <Kbd>Tab</Kbd>, and your device&apos;s
            Back).
          </li>
          <li>
            A preset&apos;s name is all its row shows, whatever its <b>Amnesic</b> setting (⚙ &rarr;
            Stats) — so a long name is not cut short to make room for a mark. What tells you a
            preset forgets is on the screen once you are in it: the dashed outline round the numbers
            that will not be kept (see <b>Stats &mdash; Amnesic</b>).
          </li>
          <li>
            Switching re-reads every mode screen from the copy of your stats that is now live, so an
            MoX run or a Blitz round still in progress is ended by it. (This guide and the Lookup
            page are not any one preset&apos;s, and stay exactly as they are.) What a preset had on
            its screens otherwise waits for you: a run or round that has already <i>ended</i>, and
            the dates you can browse back through in {modeNames('classic', 'deduction', 'flash')},
            are still there when you switch back, until you press Reset or close the app.
          </li>
          <li>
            The mode selector is exactly as wide as its longest mode name needs, and this control
            fills the rest of the bar. Its list is exactly as wide as the control — one column under
            it — and the same goes for the ⚙ menu&apos;s <b>Open in</b> list. The one exception is a
            very narrow screen, where the bar leaves the control too little for a row of its list to
            show anything: the list is never narrower than a row needs to show a name like
            &quot;P10&quot; in full. There it is a little wider than the control: it starts at the
            control&apos;s left edge and reaches part of the way over the mode selector. A name can
            be any length (see <b>Rename</b> below), so it does not always fit: where it does not,
            it is shown on one line, cut short with an …, and nothing gets wider to make room for
            it. A row of the list is where a name has the least room — the row keeps its ✓ column
            and its own spacing, like every list here — so a name can be whole on the control and
            cut short in the list under it.
          </li>
          <li>
            A ready-made name — &quot;Preset 1&quot;, &quot;Preset 2&quot;, and so on, or a name you
            typed that reads exactly like one — is shown in a short form, &quot;P1&quot;,
            &quot;P2&quot;, where it would otherwise be cut. It is all or none: if any one of those
            names would be cut in any of these four places — the control, its list, <b>Open in</b>,
            and its list — every one of them is shown short in all four, so the control and its list
            always match and a list never reads &quot;Preset 1&quot; above &quot;P10&quot;. On a
            very narrow phone that is how a new app starts. Give it more room — a wider window, the
            phone turned — and the full names come back by themselves. Only what is shown changes:
            the name is still &quot;Preset 1&quot; in its box in Manage Presets, in every sentence
            that names it, and to a screen reader.
          </li>
        </UL>
        <Subhead>Making and managing them</Subhead>
        <p>
          The <b>Global</b> section at the top of the ⚙ menu names the preset you are on and holds
          the <b>Manage Presets</b> button. Everything you can do to the set of presets is in that
          one popup:
        </p>
        <UL>
          <li>
            <b>New Preset</b> — adds one at the foot of the list, starting from the{' '}
            <i>factory defaults</i>. It is not a copy of the preset you are on, and it does not
            switch you into it, so making one never disturbs the round you are in. Use the control
            at the top left when you want to go there. There is no limit on how many presets you can
            have; a long list scrolls, here and in both preset lists.
          </li>
          <li>
            <b>Rename</b> — the name in each row is a box; tap it and it is all selected, so you can
            just type. <Kbd>Enter</Kbd> or tapping away keeps the new name, <Kbd>Esc</Kbd> throws it
            away. A name can be as long as you like: nothing you type or paste is turned away, and
            the only thing changed is the spaces at its two ends, which are dropped when it is kept.
            While what you have typed would not fit somewhere it is shown, a note under the box says
            so — &quot;Some places will show this name cut short.&quot; It appears at the exact
            character that stops fitting in the tightest of those places (usually a row of the
            top-left list) and goes as soon as the name fits again; it is also there when you tap
            into a name that is already too long. How much fits depends on the screen, so the same
            name can be whole on one device and cut short on another, and the note follows if you
            turn the phone while the box is open. A ready-made name only gets the note where even
            its short form (&quot;P1&quot;) would be cut. A very long name — a pasted page, say — is
            kept whole in its box and shown by its beginning everywhere else: where a sentence names
            a preset it quotes the first 80 characters, and a letter piled high with accents is
            trimmed there to the line it is on. Two presets can have the same name. A name with
            nothing in it to see goes back to &quot;Preset 2&quot;, &quot;Preset 3&quot;, and so on:
            that is one left blank, or one made up only of spaces and other characters that show
            nothing on screen. (While you type, the note under the box treats such a name as the
            &quot;Preset&quot; name it is about to become.) If the device has no room left to save a
            name, it is not changed: the box goes back to the name it had, and a note under it says
            &quot;This device has no room to save that name, so it was not changed.&quot; That is so
            however you left the box — Enter, Tab, a tap on another row, the app going to the
            background. The note stays under its row until you next type in a name box. If what you
            tapped was the dimmed area outside the popup, that tap shows you the note instead of
            closing the popup; tap there again to close it.
          </li>
          <li>
            <b>Order</b> — drag a row by its grip, the three small bars at its right-hand end, to
            move it; hold it near the top or bottom of the list and the list scrolls to bring the
            rest to you. The whole row travels with your finger, but only its ✕ button and its name
            box lift — each gets a shadow — and the other rows step aside as the one you hold passes
            their halfway point. Or select the grip and press the up/down arrow keys — the list
            scrolls to keep the row you are moving in view. That order is the order the top-left
            list shows them in, and nothing else: moving a preset changes no stats and no settings.
          </li>
          <li>
            <b>Delete</b> — the ✕ at the left-hand end of each row, kept well away from the grip so
            a drag never lands on it. It asks first, in the same popup, and names what is about to
            go. Back out of the question and you are on the list again, with the popup still open. A
            preset that is still completely untouched goes straight away, with nothing to ask. See
            below.
          </li>
          <li>
            After each name, a <b>✓</b> marks the preset you are on.
          </li>
        </UL>
        <Subhead>Deleting is permanent</Subhead>
        <UL>
          <li>
            The question has one button, the rose <b>Delete</b>. Tapping outside the popup, pressing{' '}
            <Kbd>Esc</Kbd>, or using your device&apos;s Back takes you back to the list without
            deleting anything, and doing it again from there closes the popup.
          </li>
          <li>
            <b>An untouched preset is not worth a question, so it does not get one.</b> If a preset
            still holds nothing at all — every ⚙ setting at its launch value; each mode&apos;s setup
            at its launch value too (the Deduction type, Flash speed, the MoX run length,
            One-by-One, both Blitz timers, Blitz&apos;s Per Round / Per Question choice, Allow
            Mistakes in MoX and in Blitz, and which stats are shown or hidden); no stats and no
            all-time bests; no saved defaults of its own; and nothing on its screens, whether a run
            or round still going or a finished one waiting — the ✕ deletes it on the spot. That is
            the state a brand-new preset is in, and the state <b>Clear Saved Defaults</b> followed
            by <b>Full Reset</b> would put one back into. Anything else at all — even a MoX run or
            Blitz round you have only just begun — and the question appears as described here.
            Having <b>Amnesic</b> on Stats Only or Full does not count as holding something: there
            is nothing being kept for it to be about.
          </li>
          <li>
            Deleting a preset removes <i>everything</i> it holds — its stats and all-time bests, its
            per-mode setup, every ⚙ setting it was on, its saved defaults, and any finished run or
            round it was keeping. It cannot be undone, and no other preset is touched. Your Lookup
            history is untouched too, for the same reason switching presets does not change what
            Lookup shows: it was never any preset&apos;s to hold.
          </li>
          <li>
            You can delete the preset you are currently on. The popup says so, and names the one it
            will open instead — the row below it, or the row above when it was the last. That is a
            switch like any other, so the mode screens clear with it — a MoX run or Blitz round in
            progress included.
          </li>
          <li>
            The <i>last</i> preset cannot be deleted — there is always at least one — so its ✕ is
            greyed out and the popup says why. <b>Full Reset</b> is how you empty a preset without
            removing it.
          </li>
        </UL>
      </GuideSection>
      <GuideSection id="stats" title="Stats" openId={open} onToggle={toggle} durationMs={motionMs}>
        <Lead>What each stat means, how times are measured, and hiding stats.</Lead>
        <Subhead>The stats</Subhead>
        <UL>
          <li>
            <b>Score</b> — dates that count as correct (a first-try correct answer, or a date you
            credited with Override) out of total attempts. In MoX, the run ends once that count
            reaches the set number. In Blitz, only the current round.
          </li>
          <li>
            <b>Accuracy</b> — the Score as a percentage. Shows "—" until your first attempt.
          </li>
          <li>
            <b>Streak</b> — your current run of consecutive correct dates / your longest. In{' '}
            {modeNames('aox', 'blitz')} the longest is this run's or round's; in{' '}
            {modeNames('classic', 'deduction', 'flash')} it is kept with your other stats until you
            press Reset Stats.
          </li>
          <li>
            <b>Last / Mean / Median</b> — timing stats, built only from dates that count as correct.
            Each adds at most one time: a first-try correct answer adds how long it took (if timing
            was showing), and a date you credited with Override adds how long your first attempt on
            it took — or nothing, if timing was hidden the first time you overrode it. Last = the
            newest of those times, in the order you played the dates; Mean = the arithmetic mean of
            all of them, with nothing dropped; Median = the middle one (less skewed by outliers). If
            you cube: this Mean is an <i>untrimmed</i> mean, the Mo3 sense of the word, not a
            trimmed average.
          </li>
        </UL>
        <Subhead>How times are counted</Subhead>
        <UL>
          <li>
            <b>A time is always shown as a time</b>, however long it took. Under a minute reads as
            seconds — <b>9.30s</b>. A minute or more switches to minutes — <b>1m 2.34s</b> — and an
            hour or more adds hours, <b>1h 2m 3.45s</b>. Nothing is ever hidden for being slow, so a
            dash in a time box only ever means nothing has been recorded there yet.
          </li>
          <li>
            <b>Every solve time is kept</b>, so in {modeNames('classic', 'deduction', 'flash')} the
            Mean and Median are all-time numbers — every timed solve in that mode since you last
            reset its stats — and closing or reloading the app never changes them. (Earlier versions
            of the app kept only the newest 1000 saved times in each mode; if you had played more
            than that, the older ones were already gone and can&apos;t be counted.)
          </li>
          <li>
            <b>Formatting (WCA speedcubing convention)</b> — single times (Last, and each solve and
            the fastest and slowest in a breakdown) are <i>truncated</i> to hundredths (the third
            decimal is dropped, never rounded); means, medians, and bests are <i>rounded</i> to the
            nearest hundredth. Truncating singles prevents fortunate rounding boundaries; rounding
            aggregates avoids systematic downward bias.
          </li>
          <li>
            One question = one attempt. Getting a question wrong then right still counts as one
            attempt, and it counts as a miss — the right answer turns green, but only a first try
            scores (or an Override).
          </li>
          <li>
            In {modeNames('aox', 'blitz')}, a small ★ next to a best means the run or round on
            screen set it. It stays for as long as that run or round is on screen — including after
            a preset switch or a reload — and goes when you press Reset or start another. If an
            Override takes the best away again, the ★ goes with it.
          </li>
        </UL>
        <Subhead>Reading a stat box</Subhead>
        <p>
          Every stat box uses the same signals site-wide, in every mode, and each one means exactly
          one thing:
        </p>
        <UL>
          <li>
            <b>A dash ("—")</b> — nothing has been recorded yet, but it will be. Accuracy before
            your first attempt, or a timing stat before your first correct answer. That is the only
            thing it means: a slow solve is shown as a slow time, never as a dash.
          </li>
          <li>
            <b>A blank box</b> — that group is hidden. The label stays so you know what it is.
            Hiding is usually just hiding: Score, Accuracy, and Streak keep recording in every mode,
            and so do the timing stats in {modeNames('aox', 'blitz')}, so tapping brings the
            up-to-date numbers back. The timing stats in{' '}
            {modeNames('classic', 'deduction', 'flash')} are the exception — hiding those genuinely
            stops the clock. &quot;Hiding stats&quot; below covers both cases, including what
            turning timing back on costs.
          </li>
          <li>
            <b>The whole strip dimmed</b> — nothing is being recorded at all. That only happens with
            Save Stats off, and it always dims the entire strip, never a single box.
          </li>
          <li>
            <b>A dashed outline round the whole strip</b> — the numbers are being recorded, but only
            for this visit: the preset is on Amnesic: Stats Only or Full, and the strip is gone when
            the app closes. It always goes round the entire strip, never a single box, and in{' '}
            {modeNames('aox', 'blitz')} on Full the one outline goes round the strip and the Best
            readouts under it together, because neither will be kept. See{' '}
            <b>Stats &mdash; Amnesic</b>.
          </li>
        </UL>
        <p>
          So a blank box and a box showing a dash are never the same thing: one is a group that is
          hidden, the other is a number that hasn&apos;t happened yet. The two can appear together:
          with Save Stats off, a group you had already hidden stays blank while the rest of the
          dimmed strip shows dashes — your choice is still visible, and still there when Save Stats
          comes back on. (While the strip is dimmed the boxes don&apos;t respond to taps at all.)
        </p>
        <Subhead>Hiding stats ({modeList('classic', 'deduction', 'flash')})</Subhead>
        <p>
          These casual modes let you tap any stat to hide it. Tapping Score, Accuracy, or Streak
          hides all three; tapping any timing stat hides all three. A hidden group's boxes go blank
          — the labels stay, and nothing else on the strip moves. Score, Accuracy, and Streak keep
          tracking in the background while hidden — re-enabling brings the same numbers back.
        </p>
        <p>
          Timing stats behave differently: timing pauses entirely while hidden — no times are
          recorded. Classic and Deduction start out this way, with their timing stats already hidden
          and paused until you tap one; Flash starts with them shown. When you turn timing back on,
          the current date is regenerated if still unanswered; if you've already answered wrong,
          revealed, or shown codes, the date stays until you advance. A flash that was running in
          Flash ends when its date is regenerated, and keeps going when the date stays. If a date
          came to count as correct while timing was hidden — a correct answer, or a credit from
          Override — it has no time, so your score and your times no longer match; turning timing
          back on then opens an "Enable and Reset Stats?" popup — which says, like Reset Stats does,
          that the other modes keep theirs and no other preset is touched — confirm to turn it on
          and reset this mode's stats, or dismiss the popup (tap outside it, <Kbd>Esc</Kbd>, or
          Back) to leave timing hidden.
        </p>
        <p>
          Deduction has one timing switch for its three sub-types, so turning it back on settles all
          three at once, whichever one is on screen: each sub-type gets a new puzzle (unless its
          puzzle was already answered wrong, revealed, or shown codes), and the popup opens if the
          score and times no longer match in any of them. It names the sub-types that will be reset
          — only those are; the others keep their stats. One of them can be Year while the Year
          button is greyed out (your Year Range no longer allows a Year puzzle): its stats are still
          saved and still reset, and the popup says so.
        </p>
        <p>
          When Save Stats is off, the whole stats strip dims site-wide (every mode, including MoX)
          and every box that isn't already blank shows "—", because nothing is being recorded. (A
          strip that was wearing Amnesic&apos;s dashed outline drops it while it is dimmed — there
          are no numbers on it to mark.) The boxes also become non-interactive — toggling timing or
          scoring is disabled until Save Stats is turned back on, which prevents accidental stat
          desyncs. Turning Save Stats back on while a mode&apos;s timing is showing regenerates that
          mode&apos;s unanswered date for a clean start, when you close the ⚙ menu: a time can be
          recorded for it again, and you may already have looked at it. As with turning timing back
          on, a date you&apos;ve already answered wrong, revealed, or shown codes on stays until you
          advance; a flash that was running in Flash ends with a regenerated date and keeps going on
          one that stays; and in Deduction all three sub-types get a new puzzle. With timing hidden
          nothing changes, and neither does turning Save Stats off.
        </p>
        <p>
          Leaving one of these modes for another and coming back preserves the current question
          exactly as you left it — same date, same answers, codes panel in the same state — whether
          its timing is shown or hidden. (A flash that was running in Flash ends when you leave.)
        </p>
        <p>
          The same rule decides what happens to the date that was waiting when the screen itself
          comes back — after a reload, a switch to another preset and back, or a spell on Amnesic:
          Stats Only or Full. Your history returns exactly as it was. The waiting date returns too,
          with one exception: if a time could be recorded for it when you come back — that
          mode&apos;s timing is showing and Save Stats is on — and you had not yet answered the date
          (no wrong answer, no Reveal, no Show Codes), a new date is drawn instead. Its timer starts
          again when the screen comes back, so the old date would have recorded a time that left out
          however long you had already looked at it. With timing hidden, or with Save Stats off, no
          time is recorded, so the same date is waiting, even if you had not played anything yet.
          (An unanswered date is also redrawn if a date setting was changed while you were away —
          the same as changing it with the date on screen.)
        </p>
        <Subhead>The breakdown ({modeList('aox', 'blitz')})</Subhead>
        <p>
          When a MoX run ends — whether you completed it or it failed — or a Blitz round ends, tap{' '}
          <i>anywhere</i> on the stats strip to see that run or round solve by solve (with Save
          Stats on — a dimmed strip does not open it). A failed run shows every date up to and
          including the one that ended it, and its mean is the mean of the solves you did make. A
          summary sits at the top — solves, accuracy, mean, median, fastest, slowest, and the spread
          between the fastest and the slowest — over a scrolling list of every date you were asked,
          in order. Each row reads, left to right: its number, the day of the week that date fell on
          (as one letter — the key is below), the date, any note about it, and its time, with the
          times lined up in a column on the right.
        </p>
        <UL>
          <li>
            <b>The day letters.</b> Each weekday gets a single letter, chosen so no two days share
            one — Thursday is R and Sunday is U, keeping them apart from Tuesday&apos;s T and
            Saturday&apos;s S. It is the day in the calendar that date was answered in — the same
            one its highlighted answer and its codes use — so a date answered as Julian shows its
            Julian weekday.
            {/* THE KEY, rendered FROM lib/format's DAY_LETTER + DAY rather than typed out, so it
                cannot disagree with the letters the rows print. A <dl> because it IS a list of
                term → meaning pairs, which is also how a screen reader announces it; each pair
                wraps as a unit on a narrow phone. */}
            <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {DAY_LETTER.map((letter, i) => (
                <div key={letter} className="whitespace-nowrap">
                  <dt className="inline font-semibold">{letter}</dt>{' '}
                  <dd className="inline">{DAY[i]}</dd>
                </div>
              ))}
            </dl>
          </li>
          <li>
            <b>The fastest and the slowest are marked</b>, with the word just before the time it
            describes. Those are the two a <i>trimmed</i> average would throw away. This app does
            not trim — every solve counts toward the mean — so they are pointed out and then counted
            like any other.
          </li>
          <li>
            <b>A solve that didn't count is marked too</b>, in the same place — <i>missed</i> if you
            picked a wrong day, <i>shown</i> if the answer was put on screen for you (Reveal, Show
            Codes, or a Blitz Per Question clock running out), or <i>overridden</i> if you took a
            credit back. A date you credited with Override is a solve like any other, timed by your
            first attempt on it. A date with a dash instead of a time contributed nothing to the
            mean: a miss, or a correct answer that came after a wrong one.
          </li>
          <li>
            <b>The list always adds up to the mean above it.</b> The summary is worked out from the
            rows themselves, not from a second running total, so the two cannot drift apart — and an
            Override or an Undo on an ended run moves the rows and the mean together.
          </li>
          <li>
            <b>It isn't saved.</b> The breakdown is built from the ended run or round on your
            screen, each time you open it, and exists only as long as that run or round does — which
            includes going to another mode or another preset and coming back, and a reload. Reset
            (or Full Reset) clears it along with the run, and so do closing the app and changing a
            setting the run or round was played under.
          </li>
        </UL>
        <Subhead>Hiding stats ({modeList('aox', 'blitz')})</Subhead>
        <p>
          {modeNames('aox', 'blitz')} hide timing <i>visually only</i>. Because a run's mean and a
          round's score depend on timing, the clock never stops in these modes: tap Last, Mean, or
          Median to blank all three, and the times keep being recorded in the background — tap again
          and the same numbers reappear. There is no pause and no "Enable and Reset Stats?" step,
          since hiding can never cause a desync. Score and Accuracy always stay visible, along with
          Streak wherever the mode shows it — the score is the whole point of these modes. In both
          modes hiding quiets the trio only while play is going: a MoX run that has ended —
          completed or failed — and an ended Blitz round always show their times, and there the
          three boxes stop toggling — what you are looking at is the result, not a control. A tap on
          the ended strip does something else instead: it opens the breakdown of that run or round,
          solve by solve (see above). Your hide setting is not forgotten, only set aside; it applies
          again the moment the next run or round starts — or the moment a tap of Override or Undo
          puts the ended one back into play.
        </p>
      </GuideSection>
      <GuideSection
        id="keyboard"
        title="Keyboard Input"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          On any device with a hardware keyboard (typically desktop), press keys instead of tapping.
        </Lead>
        <p>
          The on-screen layout is identical to mobile — keyboard input is the only desktop-specific
          addition.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <SectionLabel className="mb-1.5">Answer Grid</SectionLabel>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>0</Kbd>
                <span>Sunday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>1</Kbd>
                <span>Monday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>2</Kbd>
                <span>Tuesday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>3</Kbd>
                <span>Wednesday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>4</Kbd>
                <span>Thursday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>5</Kbd>
                <span>Friday</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>6</Kbd>
                <span>Saturday</span>
              </div>
            </div>
            <p className="mt-2 text-xs italic">
              The same keys work whether the answer grid shows labelled buttons or the seven dots.
              In Deduction Month and Year, the keys map positionally to the boxes or year options on
              screen.
            </p>
          </div>
          <div>
            <SectionLabel className="mb-1.5">Game Actions</SectionLabel>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>N</Kbd>
                <span>New / Begin / Reset (and MoX&apos;s Next / Continue)</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>R</Kbd>
                <span>Reveal</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>O</Kbd>
                <span>Override / Undo</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>C</Kbd>
                <span>Show / Hide Codes</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>S</Kbd>
                <span>Reset Stats</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>←</Kbd>
                <span>Back</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>→</Kbd>
                <span>Forward</span>
              </div>
            </div>
          </div>
          <div>
            <SectionLabel className="mb-1.5">Lookup</SectionLabel>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>Select the history row above / below</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>Backspace</Kbd>
                <Kbd>Delete</Kbd>
                <span>Clear (when the date box isn&apos;t being typed in)</span>
              </div>
            </div>
          </div>
          <div>
            <SectionLabel className="mb-1.5">Overlays</SectionLabel>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>H</Kbd>
                <span>How to Play (toggle)</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>G</Kbd>
                <span>Settings ⚙ (toggle)</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>Tab</Kbd>
                <span>Mode selector (toggle) — on the page; see the notes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap">
                  <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>
                </span>
                <span>
                  With ⚙ open: back to the ⚙ button, then the mode selector, then the preset list —
                  see the notes
                </span>
              </div>
            </div>
          </div>
          <div>
            <SectionLabel className="mb-1.5">Mode Switching</SectionLabel>
            {/* One row per page that has a letter of its own, in the page list's order. How to
                Play's letter is left out: it TOGGLES rather than goes, so it is listed with the
                other toggles under Overlays. */}
            <div className="space-y-1 text-sm">
              {PAGES.filter((p) => p.id !== 'guide').map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Kbd>{p.key}</Kbd>
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <Subhead>Notes</Subhead>
        <UL>
          <li>Letter keys are case-insensitive.</li>
          <li>
            Letter and number keys are ignored while you're typing in an input field or when a
            modifier (Ctrl/Cmd/Alt/Shift) is held.
          </li>
          <li>
            The answer keys, the Game Actions, and the Lookup keys above are ignored while the ⚙
            menu, a popup, or a list (the mode selector, the preset list, <b>Open in</b>) is open,
            too — whatever is behind one is out of the keyboard&apos;s reach until you close it, so
            an answer, a New, a Back, an Override, or an Undo can't be pressed through it, and on
            Lookup the arrows, <Kbd>Backspace</Kbd>, and <Kbd>Delete</Kbd> leave the page behind it
            alone. That goes for a button you had just pressed on the page as well: opening the ⚙
            menu or a popup takes the keyboard off it, so <Kbd>Enter</Kbd> and <Kbd>Space</Kbd>{' '}
            can&apos;t press it again from behind, and closing gives the keyboard back to it. The
            mode letters and <Kbd>H</Kbd> still work: they leave the screen, closing the ⚙ menu and
            any list that was open, and taking any popup that belongs to the screen with them.{' '}
            <Kbd>G</Kbd> still opens the ⚙ menu, or closes it together with any of its popups, and
            closes an open list as it does either — but it does nothing while a game screen&apos;s
            own popup (such as a Reset Stats question or a breakdown) is open. The two popups those
            keys can&apos;t take with them are the ones that belong to no screen — the &quot;Your
            progress isn&apos;t being saved&quot; notice and the <b>Storage used</b> breakdown:
            while one of them is up the mode letters, <Kbd>H</Kbd>, and <Kbd>G</Kbd> do nothing
            either, until you close it.
          </li>
          <li>
            <Kbd>Tab</Kbd> means three things, by what is open. <b>On the page</b> it opens the mode
            selector — even from an input (use <Kbd>Esc</Kbd> or <Kbd>Enter</Kbd> to leave an input
            first if you'd rather; a later note says what each of those does).{' '}
            <b>With the ⚙ menu or a popup open</b> it walks that menu&apos;s or popup&apos;s own
            controls one at a time, and <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> walks them backwards; both
            wrap round at the ends, neither steps out to the page behind, and each step scrolls the
            control it lands on into view. The ⚙ menu&apos;s walk takes in the three buttons of the
            top bar it hangs from as well — the preset list, the mode selector, and ⚙ itself, in
            that order, ahead of the menu&apos;s own controls — so from the menu&apos;s first
            control <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> steps back onto ⚙, then the mode selector, then
            the preset list, and <Kbd>Tab</Kbd> from its last control comes round to them. It opens
            no list on the way. <b>With a list open</b>, <Kbd>Tab</Kbd> or <Kbd>Shift</Kbd>+
            <Kbd>Tab</Kbd> closes the list and leaves the keyboard on its button. On the page,{' '}
            <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> is the browser&apos;s own step backwards, and it is how
            the keyboard reaches the page&apos;s controls that have no key of their own — a section
            of this guide, a stats box, a time readout, the strip of an ended run or round (
            <Kbd>Enter</Kbd> or <Kbd>Space</Kbd> then presses what it is on). Tab plus any other
            modifier (Ctrl+Tab, Ctrl+Shift+Tab, etc.) passes through to the browser.
          </li>
          <li>
            Every list opens from the keyboard once the keyboard is on its button: <Kbd>Enter</Kbd>{' '}
            or <Kbd>Space</Kbd> opens it, and inside the ⚙ menu <Kbd>↑</Kbd> and <Kbd>↓</Kbd> do too
            (on the open page those two are Lookup&apos;s keys, so there they are left alone).
            Getting the keyboard onto each button: the <b>mode selector</b> — <Kbd>Tab</Kbd> on the
            page opens it outright. The <b>preset list</b> — <Kbd>Tab</Kbd>, then <Kbd>Tab</Kbd>{' '}
            again (which closes the mode list and leaves the keyboard on its button), then{' '}
            <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> steps back to the preset button beside it.{' '}
            <b>Open in</b> — <Kbd>G</Kbd>, then <Kbd>Tab</Kbd>: it is the first control in the ⚙
            menu. And <b>with the ⚙ menu open</b>, where <Kbd>Tab</Kbd> is the menu&apos;s and the
            mode letters are otherwise the only way to another mode: <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>{' '}
            from the menu steps back to the ⚙ button, once more to the mode selector, and once more
            to the preset list, and <Kbd>Enter</Kbd>, <Kbd>Space</Kbd>, <Kbd>↑</Kbd>, or{' '}
            <Kbd>↓</Kbd> opens the one the keyboard is on, over the menu. What the keys do once a
            list is open is under Accessibility.
          </li>
          <li>
            In every box you can type into — the Year Range boxes, the MoX run length, every time
            readout you tap to type into, and the date box on the Lookup screen — those two keys do
            opposite things: <Kbd>Enter</Kbd> keeps what you typed and leaves the box,{' '}
            <Kbd>Esc</Kbd> throws the typing away and leaves the box. Whatever the box sits inside
            stays open — a second <Kbd>Esc</Kbd> closes that. What <Kbd>Esc</Kbd> puts back is the
            value the setting is really on: for a Year Range box that&apos;s the stored year, for
            the others the value the box held when you started typing. A time readout you typed into
            takes the keyboard back when either key closes its box, so the next <Kbd>Tab</Kbd>{' '}
            carries on from there rather than from the top.
          </li>
          <li>
            On the Lookup screen, &quot;keeps what you typed&quot; means it runs the lookup:{' '}
            <Kbd>Enter</Kbd> answers the date and lets go of the box, unless it can&apos;t read what
            you typed — then it says so and keeps the box, so you can fix it without reaching for it
            again.
          </li>
          <li>Locked or already-pressed buttons are skipped, just like a click would be.</li>
          <li>
            Inside the ⚙ menu, once the keyboard is on a setting — <Kbd>Tab</Kbd> to it, or click
            one of its options — the arrow keys move along that setting's options and choose each
            one as you land on it (<Kbd>Home</Kbd> and <Kbd>End</Kbd> jump to its first and last,
            and the ends wrap around). What counts as one setting is the choice, not the row: Date
            Format is a single five-way choice, so the arrows carry straight from the Written row
            into the Numeric one — and Theme does the same across Dark and Light whenever Use System
            Settings is off, since that's when the five themes are one pick. A locked setting
            ignores the keys. No key reaches past the open menu, so these never step the date behind
            it — and inside the menu <Kbd>Esc</Kbd> and typing in its boxes work as they do
            everywhere.
          </li>
          <li>
            Reset Stats (<Kbd>S</Kbd>) only applies to the casual modes (
            {modeList('classic', 'deduction', 'flash')}); pressing it in MoX, Blitz, or Lookup is a
            no-op, since those modes have no separate Reset Stats button (their run/round Reset
            clears in-run/in-round stats; persistent bests update only when set).
          </li>
        </UL>
      </GuideSection>
      {/* ACCESSIBILITY — its own section, deliberately, rather than more bullets under
          Keyboard Input. The URL is printed in the book, so readers arrive cold with no way to
          discover what is supported by poking at it; a titled row in the accordion is findable and
          a bullet buried in another section's Notes is not. It leans on Keyboard Input above for
          every KEY (the arrow contract, Enter/Esc, the letter map) and never restates one — this
          section is about how the app is MARKED UP and what it does with focus and motion.
          ★ EVERY CLAIM BELOW WAS READ OUT OF THE CODE, and nothing here describes what a screen
          reader SAYS. Sources, in order: the NAME-AND-BANNER paragraph = src/main.tsx's bar markup
          — the sr-only <h1> and the <header> element that makes the bar a banner landmark, added
          when the visible wordmark was removed (that markup argues why one without the other is not
          the fix, and tests/topBar.dom pins both); the bar's two lists = CustomSelect's
          COMPOSED trigger name (the caller's label plus the selected option's own text, which is
          what carries PresetSwitcher's sr-only "<name>, amnesic" phrases into the bar), plus that
          component's key handler for "the same keys do the same things" — open (the arrows, Home /
          End, Enter, Tab and Shift+Tab) and closed (Enter or Space opens; ↑ / ↓ too while the page
          is covered); its GAP line = main.tsx's global Tab binding, which resolves modeSelectRef
          and nothing else, so on the page the keyboard reaches the preset button only by the
          browser's own Shift+Tab from the mode button; the named groups = PillGroup's role/aria-label (every
          picker passes a `label`; the Theme block's name follows Use System Settings, which is why
          the wording is "the setting you're changing" and not a fixed list); the four switches +
          both year boxes = their aria-labels in components/SettingsPanel; the gear = its computed
          aria-label in main.tsx (three parts: modified, update, storage almost full) and the
          Storage used line's two sr-only spans in components/SettingsPanel; the dots = WeekdayAnswer's per-dot aria-label; the stats strip's
          words = the sr-only spans StatPanel renders — "Off" beside an `off` cell's value,
          "Stats are not being saved" at the top of the strip when `dimmed` (round 16; both
          pinned in tests/statBoxSignals.dom), and "These stats are for this session only" there
          when the strip wears the dashed outline (with BestReadout's "Bests are for this session
          only" beside it under Full; tests/sessionOnlyOutline.dom). ⚠ THAT BULLET NAMES EVERY ONE
          ON PURPOSE: the round-16
          review found the dim was the one signal of the three with no non-visual form, while the
          blank had one, and the section may not claim coverage it only gives to some of them. If
          either span goes, the bullet goes with it; the guide's Known-gaps list below is where a
          purely-visual signal belongs instead; the popups =
          components/Popup, the shell every popup is drawn in (the one dim, and what it tells the
          stack about where its keyboard may be), and components/overlayStack for the
          one-layer-at-a-time rule and for "THE KEYBOARD'S REACH" — the one rule that puts the
          keyboard in a popup, the ⚙ menu or a list as it opens, walks Tab inside it, and hands the
          keyboard back; the count of ⚙ popups = every <Popup> the panel can open, plus
          components/StorageUsagePopup, which the panel's Storage used line opens and App mounts;
          the ⚙ menu holding the keyboard = the `reach` src/main.tsx registers for it; the accordions =
          aria-expanded/aria-controls here and in MethodBreakdown; the mode list = CustomSelect's
          open-state key handler; the motion paragraph = a full grep of --motion-scale, which now
          has SIX consumers — index.css's .expander rule, this file's own inline transitionDuration
          + scroll glide (and, on that same read, a closing header's shadow hand-back and a header
          tapped above the line being brought down to it), the three
          `transition:background-color` surface fades, and .boot-d's bootPulse — so those are the only things the paragraph may claim, and index.css's own
          words for the rest are "Functional motion — the .bar countdown and the color flashes — is
          deliberately NOT scaled". ⚠ THE PARAGRAPH IS NOW A COMPLETE ACCOUNT, WHICH IT WAS NOT
          BEFORE, and that is exactly what makes it fragile: round 15 had to add a sentence naming
          two decorative things that ignored the setting (the boot dots and the button fade),
          because the token then had only two consumers. Round 16 scaled all four stragglers and
          DELETED that sentence — a claim that had gone false the moment the CSS changed. Anything
          decorative added without var(--motion-scale) makes "nothing decorative moves" false again;
          index.css's --motion-scale block carries the same list and the same warning. (An earlier
          round-15 draft said "sliding panels, fades, and this guide's own scrolling" when no fade
          was scaled at all; the word is honest now, which is why it is back.)
          ★ THE KNOWN-GAPS BLOCK IS LOAD-BEARING, not throat-clearing. Each line is a thing the
          code does NOT do, checked one at a time: on the open page plain Tab is bound to the mode
          selector (main.tsx's key handler), so the page's own controls are reached by the
          browser's Shift+Tab alone and no key puts the keyboard on the preset button directly
          (the focus ring is NOT one of the gaps any more: index.css's "THE KEYBOARD FOCUS RING"
          draws it wherever the keyboard is, and lib/keyboardFocus says which keys count);
          index.html
          sets user-scalable=no on purpose; the < and > history buttons carry only their glyph and
          the mode-screen range inputs carry no aria-label (the DefaultsCard copies do); and the
          GAME SCREENS' dimmed buttons are opacity-60 + pointer-events-none and announce nothing.
          ⚠ THAT LAST ONE IS ABOUT THE GAME SCREENS, NOT ABOUT aria-disabled BEING RARE — the
          attribute appears in five places (the ⚙ footer's three buttons, MethodBreakdown's Show
          Codes, the locked ⚙ pickers via PillGroup/PillTray, and SliderValueEditor's accented
          readout). The ⚙ footer and Show Codes are the two the prose names as announced; the
          pickers and the readout are announced too but are also pointer-blocked, which is why the
          bullet is about the game's Reveal/Override/history buttons specifically. An earlier draft
          of this note claimed the footer was aria-disabled's only site, which the section's own
          Show Codes sentence — and GAP 4's exemption for it — already contradicted.
          If any of these is ever fixed, delete its
          line here in the same change. Overstating support would be worse than saying nothing. */}
      <GuideSection
        id="accessibility"
        title="Accessibility"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          How the app is built for screen readers, keyboards, and reduced-motion settings — and
          where it falls short.
        </Lead>
        <p>
          This describes what the app does, not what any particular screen reader says about it.
          Wording varies between VoiceOver, TalkBack, NVDA, and the rest, and the site hasn&apos;t
          been tested against each of them.
        </p>
        <p>
          The app&apos;s name is not printed anywhere on screen — the bar at the top is the logo,
          the preset you&apos;re on, the mode, and ⚙. It is still the page&apos;s heading, carried
          by a hidden line in that bar, and the bar itself is marked as the page&apos;s banner. So
          the app still says &quot;Calendar Game&quot; to a screen reader, and its top-of-page
          controls are reachable as one named region rather than as four loose buttons under a
          picture.
        </p>
        <Subhead>Controls that name themselves</Subhead>
        <UL>
          <li>
            Every picker in the ⚙ menu is one named group of choices, not a row of loose buttons,
            and it&apos;s named for the setting you&apos;re changing — Default Mode, Date Format,
            Input, Rotate Dots, Theme, Leap Year Chance, Jan/Feb Chance on Leap Years, Julian
            Chance, Amnesic. Landing on an option is choosing it; the keys that move within a group
            are under Keyboard Input above. <b>Open in</b> is the one list instead of a group,
            because it holds every preset you make; like the lists in the top bar it reads its name
            and then what it is set to.
          </li>
          <li>
            The four On/Off switches carry their setting&apos;s name — Random Format, Use System
            Settings, Julian Calendar, Save Stats — rather than reading as four identical buttons
            called &quot;On&quot;. Both Year Range boxes name themselves Earliest Year and Latest
            Year.
          </li>
          <li>
            The ⚙ button says what&apos;s behind it: that a setting has been changed, that an update
            is waiting, and that storage is almost full, whenever any of them is true. Inside the
            menu the <b>Storage used</b> line says the same of itself — it adds &quot;almost
            full&quot; while it is in its warning colour — and reads &quot;not measured yet&quot;
            while it shows a dash. The one figure written with a sign, &quot;&lt;0.1%&quot;, is read
            as &quot;under 0.1%&quot; wherever it is shown: on that line, in the title of the
            breakdown it opens, and beside each thing the breakdown lists.
          </li>
          <li>
            The two lists in the top bar say what they are set to, not just what they are: the
            preset control reads &quot;Preset&quot; and then the preset you are on, and the mode
            selector reads &quot;Mode&quot; and then the mode you are in — so a closed list still
            tells you where you are. Every preset in the list reads its own name, and a preset that
            forgets reads its name followed by what it is — &quot;amnesic&quot; for one on Full,
            &quot;amnesic, stats only&quot; for one on Stats Only — in the list and in the bar
            alike. Nothing is drawn there for it, so this is where that fact is said. The same words
            follow the names in the ⚙ menu&apos;s <b>Open in</b> list. A ready-made name shown as
            &quot;P1&quot; is still read &quot;Preset 1&quot; in all of them.
          </li>
          <li>
            Inside <b>Manage Presets</b>, each row&apos;s name box is called Preset name — the name
            itself is the box&apos;s contents, so it is read out with it — and the two controls
            beside it name the preset they act on: the reorder handle reads &quot;Reorder Weekend,
            position 2 of 3&quot; (the position updates after every move, so the same name is
            announced again with a new number), and &quot;Delete Weekend&quot;. The <b>✓</b> on the
            row you are on says &quot;Current preset&quot;, so it is not only a shape, and a preset
            that forgets is followed by the same words as in the top bar&apos;s list —
            &quot;amnesic&quot;, or &quot;amnesic, stats only&quot;. <Kbd>Tab</Kbd> walks each row
            in the order it is read out — the name, then the reorder handle, then <b>✕</b> — rather
            than left to right, so the first thing the keyboard reaches in this popup is a name and
            never a delete. The reorder handle has no box of its own, so the outline described under
            Panels and popups below is the only thing that shows the keyboard is on it; ↑ and ↓ move
            the preset from there. The note that can appear under a name box — that the name will be
            shown cut short, or that the device had no room to save it — is read out once when it
            appears, after whatever is being read, and not again while it stays.
          </li>
          <li>
            In the seven-dot answer layout every dot carries its weekday name, so the dots offer the
            same seven named choices the labelled buttons do.
          </li>
          <li>
            Both of the stats strip&apos;s quiet signals say themselves out loud. A hidden stat box
            reads as &quot;Off&quot; rather than as a nameless gap — the box goes blank on screen
            and keeps its label, and the word carries that same fact to anyone who can&apos;t see
            the blank. And a strip dimmed because Save Stats is off opens with &quot;Stats are not
            being saved&quot;, so the dashes in it aren&apos;t mistaken for a strip that simply has
            no numbers yet. A strip wearing the dashed outline (Amnesic on Stats Only or Full) opens
            with &quot;These stats are for this session only&quot;, and on Full the Best readouts
            under it open with &quot;Bests are for this session only&quot; — the outline itself is
            only a line.
          </li>
        </UL>
        <Subhead>Panels and popups</Subhead>
        <UL>
          <li>
            The ⚙ menu opens eight popups — Save Defaults, the saved-defaults list, the three
            confirmations (Reset Settings, Full Reset, and clearing your saved defaults), the
            Changelog, Manage Presets, and the Storage used breakdown — and every one, like every
            other popup in the app, is a proper dialog. Opening one puts the keyboard inside it,{' '}
            <Kbd>Tab</Kbd> and <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> cycle that popup&apos;s own controls
            and wrap around at the ends rather than wandering into the menu beneath, and{' '}
            <Kbd>Esc</Kbd> closes it. The Changelog and the Storage used breakdown are the two with
            no controls to cycle — they are read-only, closed by tapping outside, <Kbd>Esc</Kbd>, or
            Back — so there the keyboard simply stays on the dialog. The saved-defaults list is not
            read-only: its rows can be edited in place (see <b>Save Defaults</b>), and{' '}
            <Kbd>Tab</Kbd> cycles them. (The Storage used breakdown is the one of the eight that
            belongs to the app rather than to the menu — Keyboard Input says what that changes.)
          </li>
          <li>
            Manage Presets asks its delete question — when there is one to ask; an untouched preset
            is deleted outright — <i>in place</i>: the list is replaced by the confirmation inside
            the same popup, rather than a second popup opening on top of the first. The keyboard
            moves to the question when it appears and back to the list when you back out of it. From
            the question, one dismiss — an outside tap, <Kbd>Esc</Kbd>, or your device&apos;s Back —
            returns to the list, and a second closes the popup; from the list, a dismiss closes it
            straight away. As in every other box in the app, the first <Kbd>Esc</Kbd> belongs to a
            name you are typing in.
          </li>
          <li>
            Wherever the keyboard is, the control it is on is outlined — on the game screens,
            Lookup, this guide, and the top bar as much as in the ⚙ menu and the popups: a solid
            ring just inside its edge — white on a filled button (a purple one, a rose one, a day
            you have answered), following the circle of an answer dot, round the handle on a slider,
            and round the outside of a time readout, which is no bigger than its digits. It is drawn
            only while you are finding your way by keyboard, which means after <Kbd>Tab</Kbd> or{' '}
            <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>, or an arrow key that moves you from one control to the
            next (along a setting&apos;s options, through a list, on a slider). A tap or a click
            never draws it, on anything, and puts it out if it was showing. So does a shortcut, the
            moment it does something: the answer keys, the Game Actions, the Lookup keys, the mode
            letters, <Kbd>H</Kbd>, and <Kbd>G</Kbd> never start it, and put it out — so playing with
            the number keys and a mouse never lights a ring on the button you last clicked, and
            after <Kbd>Tab</Kbd> and a choice from the mode list the ring on the Mode button is gone
            with your first answer. <Kbd>Enter</Kbd>, <Kbd>Space</Kbd>, a key that does nothing
            where you are, and anything typed in a box leave things as they are. A control that is
            greyed out and marked unavailable can still be reached, and its ring is <i>dotted</i>{' '}
            rather than solid: the keyboard is there, and pressing will do nothing. Nothing inside
            an open list is outlined, in the top bar or in the menu: the soft grey box on an option
            is where the keyboard is, and the ring stays on the list&apos;s button. None of this is
            the dashed outline Amnesic puts round numbers that won&apos;t be kept — that one is
            dashed and fainter, marks numbers rather than a control, and has nothing to do with the
            keyboard; where the stats strip is inside it and has the keyboard too, the solid ring
            sits just inside the dashes.
          </li>
          <li>
            The ⚙ menu itself is not a dialog — it&apos;s a menu hanging off its button — but it
            holds the keyboard like one while it is open. Opening it puts the keyboard on the menu
            (or leaves it where it was, if it was already in the top bar: on the ⚙ button after a
            click, or on one of the two lists); <Kbd>Tab</Kbd> and <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd>{' '}
            walk its controls, with the top bar&apos;s three buttons (the preset list, the mode
            selector, and ⚙) ahead of them, and wrap at the ends; and closing it gives the keyboard
            back to whatever on the page had it. <Kbd>Esc</Kbd> closes it, unless you&apos;re typing
            in one of its boxes, in which case the first <Kbd>Esc</Kbd> belongs to the box.
          </li>
          <li>
            Each section header in this guide, and the Show Codes button, states whether it&apos;s
            open and which panel it opens.
          </li>
          <li>
            The mode selector is a list of modes. Once it&apos;s open, ↑ and ↓ move through it,{' '}
            <Kbd>Home</Kbd> and <Kbd>End</Kbd> jump to the ends, <Kbd>Enter</Kbd> chooses, and{' '}
            <Kbd>Esc</Kbd>, <Kbd>Tab</Kbd>, or <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> closes it and leaves
            the keyboard on its button. While it&apos;s closed, <Kbd>Tab</Kbd> opens it from
            anywhere on the page, and <Kbd>Enter</Kbd> or <Kbd>Space</Kbd> opens it when the
            keyboard is on its button.
          </li>
          <li>
            The preset control is the same kind of list, and the same keys do the same things —
            opening it included, once the keyboard is on its button. So is <b>Open in</b> in the ⚙
            menu, where ↑ and ↓ open it as well, and where <Kbd>Esc</Kbd> closes just the list — the
            ⚙ menu stays open until a second <Kbd>Esc</Kbd>. Opening any of these lists puts the
            keyboard on its button, however you opened it, so the keys work straight away; and while
            one is open, nothing behind it takes a key. (Keyboard Input above says how the keyboard
            gets onto each button.)
          </li>
          <li>
            Whatever is open closes one layer at a time, the one in front first. With a list open
            over the ⚙ menu, a popup open over the menu, or the &quot;isn&apos;t being saved&quot;
            notice open over another popup, <Kbd>Esc</Kbd>, your device&apos;s Back, and a tap
            outside each close only the one in front — do it again for the one behind it. However
            many popups are open the screen is dimmed once, behind the popup in front, and a popup
            waiting underneath is dimmed with the page. Closing a popup hands the keyboard back to
            where it was: the control that opened it, or the popup underneath. Closing the ⚙ menu
            does the same — back to the button on the page, or the button in the top bar, that had
            the keyboard when the menu opened.
          </li>
        </UL>
        <Subhead>Motion</Subhead>
        <p>
          If your device is set to reduce motion, nothing decorative moves. The panels that slide
          open — the sections of this guide, and Show Codes — open instantly instead, this guide
          stops gliding when it scrolls itself, the short colour fade a button does under your
          finger arrives at once, and the three dots on the updating screen stop pulsing. Countdown
          bars and the right/wrong colour flashes are unchanged, because those are telling you
          something rather than decorating.
        </p>
        <Subhead>Where it falls short</Subhead>
        <p>Stated plainly, so you know before you try:</p>
        <UL>
          <li>
            On the page, <Kbd>Tab</Kbd> is the mode selector&apos;s and does not walk forwards from
            control to control. The page&apos;s own controls that have no key of their own — a
            section of this guide, the stats boxes, a time readout, the strip of an ended run or
            round, the preset list&apos;s button — are reached only by <Kbd>Shift</Kbd>+
            <Kbd>Tab</Kbd>, which steps backwards through them from wherever the keyboard is
            (Keyboard Input has the steps for the preset button). Inside the ⚙ menu and the popups{' '}
            <Kbd>Tab</Kbd> walks both ways.
          </li>
          <li>
            Pinch-to-zoom is switched off deliberately, to keep the app feeling like an app rather
            than a page.
          </li>
          <li>
            Not everything is named yet: the <b>&lt;</b> and <b>&gt;</b> history buttons are only
            their symbols, and the timer sliders on the Flash and Blitz screens have no name of
            their own (the copies inside Save Defaults do).
          </li>
          <li>
            Two kinds of greying out, not one. Marked unavailable while they&apos;re greyed: the
            three buttons at the foot of the ⚙ menu and the Clear Saved Defaults link under them,
            Show Codes, every locked picker (Amnesic while Save Stats is off is one of them), a
            timer value you can&apos;t type into right now, and — in Manage Presets — <b>✕</b> when
            only one preset is left. The reorder grip at the end of each row never greys out; it has
            no end it cannot move toward. The rest of the game&apos;s buttons — Reveal, Override /
            Undo, <b>&lt;</b>, and <b>&gt;</b> — are only dimmed, so they still read as ordinary
            buttons even when pressing one would do nothing.
          </li>
        </UL>
      </GuideSection>
      <Divider label="Settings" />
      <GuideSection
        id="settings-overview"
        title="Settings Overview"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          The ⚙ menu opens on the preset you are in, and it is in two halves. A <b>Global</b>{' '}
          section at the top holds the two settings that apply to the whole app; a heavier line
          across the menu, with <b>Per-preset</b> centred under it, marks everything below as
          belonging to the preset you are on, grouped into three categories. Those two centred
          headings are the only ones of their kind — <b>Display</b>, <b>Dates</b>, and <b>Stats</b>{' '}
          sit inside the second half rather than beside it. The Save Defaults and Reset buttons stay
          at the bottom.
        </Lead>
        <UL>
          <li>
            <b>Global</b> — first, and app-wide, not per-preset: <b>Open in</b> (which preset a
            fresh open of the app lands in — &quot;Last used&quot;, or a preset you pin), and the
            door to <b>Manage Presets</b> (see <b>Presets</b> above). Neither is part of any preset,
            and neither is touched by the Reset buttons or Save Defaults. <b>Open in</b> is a list
            like the preset control at the top left — tap it, then tap &quot;Last used&quot; or a
            preset. It stays one row however many presets you have; the list floats over the menu,
            scrolls when it is long, and the menu behind it holds still until you have picked. If
            you open the ⚙ menu by pressing and dragging, letting go on <b>Open in</b> opens its
            list; tap your choice from there.
          </li>
          <li>
            <b>Per-preset</b> — the label over everything that is saved for the current preset and
            captured by <b>Save Defaults</b>. Directly under it: <b>Default Mode</b> — the page this
            preset opens on (any of the six modes, or How to Play). Whatever page you were last on
            in a preset comes back if you switch away and return during the same visit; a fresh
            start of the app uses Default Mode instead.
          </li>
          <li>
            <b>Display</b> — how dates are shown and how you answer: Date Format (incl. Random
            Format), Input (Buttons / Dots), Rotate Dots, and Theme.
          </li>
          <li>
            <b>Dates</b> — which dates get generated: Year Range, Leap Year Chance, Jan/Feb Chance
            on Leap Years, and Julian Calendar (+ Julian Chance).
          </li>
          <li>
            <b>Stats</b> — Save Stats, and Amnesic (Off / Stats Only / Full) directly under it.
          </li>
        </UL>
        <p>
          At the foot of the menu, in one block: <b>Save Defaults</b>, <b>Reset Settings</b>, and{' '}
          <b>Full Reset</b> (see the Data section), and directly under them the{' '}
          <b>View Saved Defaults</b> and <b>Clear Saved Defaults</b> links — both always there;
          Clear dims and locks until you&apos;ve saved your own defaults, the same way the three
          buttons above it do. Those two sit in the gaps between the three buttons above rather than
          under them. Below the block: your Contact email; then <b>Storage used</b> on a line of its
          own — how much of this device&apos;s room for the app is in use, as a percentage to one
          decimal place (a dash if the app could not measure the device), and a tap on it opens the
          breakdown (see Saved Progress); then a last line with the Last Updated timestamp at the
          left edge, the <b>Changelog</b> link at the right edge, and <b>Check for updates</b>{' '}
          midway between the two.
        </p>
        <p>
          Each of those three buttons greys out whenever pressing it would do nothing — there is
          nothing to save, nothing to reset, or nothing left to clear. A greyed one really is
          inactive: it does nothing to a tap, a keypress, or a screen reader's press. The keyboard
          and a screen reader can still land on it, and it's marked unavailable rather than left
          looking like an ordinary button: the keyboard's ring on it is dotted instead of solid, and
          on a computer the pointer shows the not-allowed cursor over it. (See Accessibility.)
        </p>
        <p className="text-(--tx-300-70) text-[12px]">
          Settings changes apply when you <b>close</b> the ⚙ menu, not on each adjustment — so
          changing several at once regenerates the date just once (and never restarts your solve
          timer mid-adjustment). The sections below cover each setting and exactly when a change
          regenerates a date or resets a run/round. A flash running in Flash goes with its date: if
          closing the menu regenerates the date, the flash ends and Begin starts a new one; if the
          date stays (you had already answered it wrong), the flash carries on.
        </p>
      </GuideSection>
      <GuideSection
        id="dateformat"
        title="Display — Date Format"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>Choose how dates are written, or roll a random format each time.</Lead>
        <p>Five real-world formats:</p>
        <UL>
          <li>
            <b>Written MDY</b> — April 27, 1828
          </li>
          <li>
            <b>Written DMY</b> — 27 April 1828
          </li>
          <li>
            <b>Numeric MDY</b> — 4/27/1828 (separator "/")
          </li>
          <li>
            <b>Numeric DMY</b> — 27.4.1828 (separator ".")
          </li>
          <li>
            <b>Numeric YMD</b> — 1828-4-27 (separator "-")
          </li>
        </UL>
        <p>
          Years always show in full, never abbreviated. Only DMY, MDY, and YMD orderings are offered
          — they're the only orderings used in real life (orderings like YDM aren't standard
          anywhere).
        </p>
        <Subhead>Random Format</Subhead>
        <p>
          When on, it rolls one of the five formats per date in game modes only — your selected
          format is preserved underneath (the panels just lock visually). Lookup and the Last
          Updated timestamp ignore Random and always use the selected format; the timestamp uses the
          numeric version of whichever format you've selected.
        </p>
        <Subhead>When a format change regenerates the date</Subhead>
        <UL>
          <li>
            In Classic, Deduction, Flash, and MoX (idle), any format change — the Random Format
            toggle or the Date Format pick — regenerates an unanswered date so you don't return to a
            previously-seen date in a now-mismatched format. This applies across all modes at once.
          </li>
          <li>
            If you've already wrong-guessed, revealed, or shown codes on the displayed date, the
            change is deferred — the burned state is preserved and the new format applies on the
            next date.
          </li>
          <li>
            In MoX runs and Blitz rounds — active or just ended — a format change resets the
            run/round when you close the ⚙ menu, so the round on screen always matches your
            settings.
          </li>
        </UL>
        <p>
          In game modes' Show Codes, codes appear in the order the date is read (left to right),
          with Leap shown once you've seen both the year and month.
        </p>
      </GuideSection>
      <GuideSection
        id="input"
        title="Display — Input & Rotate Dots"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Answer with labelled weekday buttons, or with the seven-dot logo layout — and turn that
          layout 45° or 90° if you like.
        </Lead>
        <Subhead>Input</Subhead>
        <UL>
          <li>
            <b>Buttons</b> (default) — the seven weekdays as labelled buttons.
          </li>
          <li>
            <b>Dots</b> — seven unlabelled circles in the same layout as the app's logo (see below).
          </li>
        </UL>
        <p>
          Tap a dot, or press and slide to the one you want and release — exactly like the buttons.
          The setting applies to the weekday modes ({modeList('classic', 'flash', 'aox', 'blitz')}).
          In Deduction the answers aren't weekdays, so the setting is shown but locked there (it
          keeps whatever you last chose and applies again in the weekday modes).
        </p>
        <Subhead>Which dot is which</Subhead>
        <div className="flex justify-center">
          <DotDiagram />
        </div>
        <p className="text-(--tx-300-70) text-[12px] text-center">
          Sunday sits in the centre. The dots are deliberately unlabelled — their positions follow
          the day-of-week practice movement, so choosing one is the same motion you trace when
          calculating. The diagram above always matches your Rotate Dots setting.
        </p>
        <Subhead>Rotate Dots</Subhead>
        <p>Three choices, each turning the dots further counterclockwise (CCW):</p>
        <UL>
          <li>
            <b>Standard</b> (default) — the two runs of three weekdays go down the sides: Sat, Fri,
            Thu down the left and Wed, Tue, Mon down the right.
          </li>
          <li>
            <b>45° CCW</b> — the same seven dots turned an eighth of a turn, so the pattern stands
            on a corner: Wed at the top, Sat at the left, Mon at the right, and Thu at the bottom,
            with Tue between Wed and Mon and Fri between Sat and Thu. The two runs now slant along
            the diagonals. The whole pattern — dots and the spaces between them — is drawn at about
            four-fifths of the usual size, because a turned square needs more room than the same
            square standing straight, and the answer area doesn&apos;t grow.
          </li>
          <li>
            <b>90° CCW</b> — a quarter turn, so the two runs lie along the top and bottom instead:
            Wed, Tue, Mon across the top and Sat, Fri, Thu across the bottom.
          </li>
        </UL>
        <p>
          Sunday stays in the centre in all three, and the dots keep their tap-and-slide behaviour
          and their keyboard numbers unchanged — only where each one sits on screen moves. Each dot
          still answers to a touch anywhere in its own share of the space, up to halfway to its
          neighbours; the two empty gaps and the space around the pattern stay dead, so sliding off
          onto them still cancels a press. Rotate Dots is locked whenever there are no dots to turn:
          in Deduction, alongside Input and for the same reason, and in every mode while Input is
          set to Buttons. While locked it keeps whatever you last chose. Your choice doesn&apos;t
          affect your stats: bests and history are shared across all three.
        </p>
        <p>
          <b>The logo turns with it — but only while Dots is your Input.</b> The mark at the top
          left of every screen <i>is</i> this seven-dot layout, so turning the dots turns that mark
          too (by the same amount, and at 45° shrunk the same way), whenever Input is set to Dots —
          on every page, including the ones with no weekday dots of their own (Deduction, Lookup,
          and this guide), where Rotate Dots is locked but the mark still shows the rotation you
          chose. While Input is set to Buttons the mark stays upright on every page: with Buttons
          there are no dots anywhere in the app for a turned mark to correspond to. What can&apos;t
          follow even when Dots is your Input are the pictures your device saved earlier: the
          home-screen icon, the launch screen, and the link preview image are fixed image files, so
          those keep the upright logo whatever you choose here. The full-screen launch screen and
          the <b>Rotate back to portrait</b> screen keep the upright mark to match them.
        </p>
      </GuideSection>
      <GuideSection
        id="theme"
        title="Display — Theme"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>Five themes, with an option to follow your device's light/dark mode.</Lead>
        <UL>
          <li>
            <b>Dusk</b> — default dark navy
          </li>
          <li>
            <b>Midnight</b> — true black with purple
          </li>
          <li>
            <b>Nebula</b> — deep purple
          </li>
          <li>
            <b>Light</b> — clean white
          </li>
          <li>
            <b>Parchment</b> — warm cream
          </li>
        </UL>
        <p>
          Accessible from the ⚙ menu in any tab, where the five themes sit as buttons in two
          labelled rows — <b>Dark</b> (Dusk, Midnight, Nebula) and <b>Light</b> (Light, Parchment).
          Both rows are always shown, so the menu never changes height. Enable{' '}
          <b>Use System Settings</b> to match your device's light/dark mode automatically: each row
          then holds its own separate pick, and your device decides which of the two is in use.
          Disable it to pick one theme manually — now it is a single choice across both rows, so
          only the theme you picked stays lit. Turning Use System Settings off keeps whichever theme
          is already on screen, so the look never changes on you as you flip the switch.
        </p>
      </GuideSection>
      <GuideSection
        id="range"
        title="Dates — Year Range"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>Controls which years dates are drawn from. Defaults to 1–10000 AD.</Lead>
        <UL>
          <li>
            A year you type counts once you leave the box — press <Kbd>Enter</Kbd>, or tap anywhere
            else. <Kbd>Esc</Kbd> does the opposite: it throws the typing away, puts the stored year
            back, and leaves the ⚙ menu open.
          </li>
          <li>
            Dates keep coming from the stored range until the year counts — but the menu notices the
            typing straight away. As soon as a box shows something other than the stored year, the ⚙
            button&apos;s violet bar lights and all three buttons at the foot of the menu become
            active, the same as any other change. Finishing the year does not put them back: once it
            counts, your range differs from your defaults, which is a change in its own right. They
            settle only when nothing is left that differs — so pressing <Kbd>Esc</Kbd> on a year you
            never meant to type clears them, while typing 1900 and pressing <Kbd>Enter</Kbd> keeps
            them lit, now for something you really can save.
          </li>
          <li>
            Changing the range always regenerates the current date — but if you've already
            wrong-guessed on the current date, the change is deferred so the wrong-state is
            preserved; the new range applies to the next date.
          </li>
          <li>
            While browsing back, a settings-driven regen leaves your history alone: the date you are
            viewing and everything between it and the live date stay exactly where they are, and
            only the unanswered live date waiting at the front is replaced.
          </li>
          <li>
            In MoX runs and Blitz rounds (active or just ended), a range change resets the run/round
            when you close the ⚙ menu.
          </li>
        </UL>
        <Subhead>Year sub-mode auto-disable</Subhead>
        <p>
          Deduction's Year sub-mode requires either a range of at least 5 years (so a 5-year window
          can be built) or, with Julian on, a range that contains October 15, 1582 (so a 2-year Jul
          Cross window can be built). When neither holds, the Year sub-type button greys out, and if
          you were already in Year mode when the range changed, you're auto-switched to Day mode.
          Day and Month sub-modes work for any valid range.
        </p>
      </GuideSection>
      <GuideSection
        id="leap"
        title="Dates — Leap Year Settings"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Two controls for how often leap years appear and which months they're paired with.
        </Lead>
        <UL>
          <li>
            <b>Leap Year Chance</b> — how often a generated date lands on a leap year. Random uses
            the natural rate (~24%); 50%, 75%, and 100% force higher rates.
          </li>
          <li>
            <b>Jan/Feb Chance on Leap Years</b> — how often a leap-year date lands on January or
            February. Random uses the natural rate (~17%, since 2 of 12 months are Jan/Feb); 25%,
            50%, 75%, and 100% force higher rates. The listed percentage is the exact final rate of
            Jan/Feb on leap-year dates, not just a force probability — under 50%, exactly half of
            leap-year dates are Jan/Feb.
          </li>
        </UL>
        <p>
          Both apply to all game modes' date generation; Lookup is unaffected. Changing any value
          regenerates the displayed date so the new setting takes effect when you close the ⚙ menu.
          If you've already wrong-guessed, revealed, or shown codes on the current date, the change
          is deferred and applies to the next date. In MoX runs and Blitz rounds (active or just
          ended), a chance change resets the run/round when you close the ⚙ menu.
        </p>
        <Subhead>Locking</Subhead>
        <UL>
          <li>
            If your year range contains no leap years (under the active calendar), the four Leap
            Year Chance options lock and fade; the previously-selected value stays visually selected
            so it's restored when you change the range back to one with a leap year reachable.
          </li>
          <li>
            Jan/Feb Chance stays unlocked, since the setting still applies on whatever leap years
            exist in the range.
          </li>
        </UL>
      </GuideSection>
      <GuideSection
        id="julian"
        title="Dates — Julian Calendar"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Treats early dates as Julian; on by default. Includes the Julian Chance frequency control.
        </Lead>
        <p>
          When on, dates on or before October 4, 1582 are treated as Julian, which has different
          leap year rules — every year divisible by 4 is a leap year, with no century exception.
          This affects weekday calculation and the codes shown in Show Codes. October 5–14, 1582 are
          always excluded since those dates never existed; the Gregorian calendar skipped them to
          correct accumulated drift.
        </p>
        <Subhead>Toggling Julian</Subhead>
        <UL>
          <li>
            A date after October 4, 1582 reads the same either way: the setting only changes the
            weekday, and the codes, of a date on or before it.
          </li>
          <li>
            <b>One date, one calendar.</b> The first time a date is judged — you pick a day (right
            or wrong), Reveal it, open Show Codes on it, or a Blitz clock runs out on it — it takes
            the calendar the setting stood at in that moment, and keeps it for good. From then on
            its green and red marks, Reveal, Override and Undo, Show Codes, its weekday letter in a
            run or round breakdown, and coming back to it with &lt; all read that one calendar,
            whatever the setting says later. So the highlighted answer is always the one its codes
            arrive at. (A Deduction puzzle takes the calendar it was drawn under instead, because
            the weekday it shows you was worked out in it.)
          </li>
          <li>
            <b>Classic and Flash</b> — the date on screen stays when you change the setting. If
            nothing has been judged on it yet, its correct answer and its codes follow the new
            setting. If you&apos;ve already answered it wrong, revealed it, or shown its codes, it
            keeps the calendar it was first judged in — a day that would be right under the new
            setting is still a wrong answer on that date — and the change applies from the next
            date.
          </li>
          <li>
            <b>The one date that cannot stay</b> — February 29 of a year like 1500 is a day in the
            Julian calendar and no day at all in the Gregorian one, so it is only ever drawn with
            the setting on. Switch the setting off with one waiting untouched and it is replaced
            when you close the ⚙ menu (a flash that was showing it ends, as with any regenerated
            date); the same happens if it was waiting when the page reloads with the setting now
            off. One you&apos;ve already answered wrong, revealed, or shown codes on stays, and is
            always read as the Julian date it is — whatever the setting says.
          </li>
          <li>
            <b>Deduction and MoX (idle)</b> — the change is treated like any other date setting: an
            unanswered puzzle (in all three Deduction sub-types) or the date MoX has waiting is
            redrawn when you close the ⚙ menu, and a puzzle you&apos;ve already answered wrong,
            revealed, or shown codes on stays, in its own calendar.
          </li>
          <li>
            In MoX runs and Blitz rounds (active or just ended), a Julian toggle resets the
            run/round when you close the ⚙ menu.
          </li>
          <li>
            In Lookup the setting changes no answer at all: a date on or before October 4, 1582 is
            shown in both calendars either way. It only picks which one Show Codes works through —
            and even then it defers to the date, since February 29 of a year like 1500 exists in the
            Julian calendar only.
          </li>
        </UL>
        <Subhead>Julian Chance</Subhead>
        <p>
          Sets how often a generated date lands in the Julian period (pre-Oct 15, 1582). Random uses
          the natural rate (depends on your year range, ~16% on the default 1–10000 range); 25%,
          50%, 75%, and 100% force higher rates. The listed percentage is the exact final rate of
          Julian dates, not a force probability. Changing the value always regenerates an unanswered
          date; burned dates defer like every other setting.
        </p>
        <p>The five options lock and fade in three cases:</p>
        <UL>
          <li>The Julian Calendar toggle above is off (no Julian dates can be generated).</li>
          <li>
            Your range is entirely post-Gregorian (minimum year 1583+), so no Julian dates exist in
            range.
          </li>
          <li>
            Your range is entirely pre-Gregorian (maximum year 1581 or earlier), so every date is
            already Julian and the setting has nothing to do.
          </li>
        </UL>
        <p>
          Year 1582 itself contains both Julian (Jan–Sep + Oct 1–4) and Gregorian (Oct 15+ + Nov +
          Dec) dates, so any range that includes 1582 counts as mixed and the row stays unlocked.
          The previously-selected value stays visually selected while locked, so it's restored when
          the lock condition clears.
        </p>
      </GuideSection>
      <GuideSection
        id="savestats"
        title="Stats — Save Stats"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          On by default. When off, your answers don't update stats or saved bests, and the stats
          panel dims.
        </Lead>
        <UL>
          <li>
            In the casual modes ({modeList('classic', 'deduction', 'flash')}), Override / Undo
            follows the Save Stats setting that was on when the date on screen was played: a date
            played with it off was never scored, so it can&apos;t be overridden, and on a fresh,
            untouched date the button is dimmed while Save Stats is off. Dates you browse back to
            were all scored, so there it always works (see Reveal, Override, and Show Codes).
          </li>
          <li>
            In the run modes ({modeList('aox', 'blitz')}), Override works the same whether Save
            Stats is on or off, so a misclick can never throw away a whole run or round even in
            practice mode.
          </li>
        </UL>
        <p>The toggle works differently per mode:</p>
        <UL>
          <li>
            <b>Classic, Deduction, Flash (per-question)</b> — the value is locked in at your first
            stat-affecting action on the question (your first wrong guess, or your correct answer if
            you got it on the first try). Toggling afterward doesn't change that question's outcome
            but applies to the next. If you've already wrong-guessed, toggling does not regenerate
            the date — the frozen value sticks for the question. When off, the question doesn't
            update stats and isn't pushed to history (Back can't browse to it).
          </li>
          <li>
            <b>MoX (run-level)</b> — in-run score, streak, times, and Back/Forward all work normally
            regardless of the toggle. Whatever the toggle is when the run first ends — completed or
            failed — determines whether Best Mean and Best Median update.
          </li>
          <li>
            <b>Blitz (round-level)</b> — in-round score, accuracy, streak, and Back/Forward all work
            normally regardless of the toggle. Whatever the toggle is when the round first ends
            determines whether the round's Best Score and Best Streak update.
          </li>
        </UL>
        <p>
          That decision is made once, the first time the run or round ends, and nothing changes it
          afterward until you press Reset or Begin. A run or round that first ended with Save Stats
          off is never recorded — not by turning Save Stats back on while it is still on screen, and
          not by an Override on it, even one that puts it back in play so that it ends a second
          time. One that first ended with Save Stats on stays recorded: if an Override then changes
          its result, its Bests follow, even while Save Stats is off.
        </p>
      </GuideSection>
      <GuideSection
        id="amnesic"
        title="Stats — Amnesic"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          How much of what you play on this preset is kept: all of it (<b>Off</b>, the default),
          only new Bests (<b>Stats Only</b>), or none of it (<b>Full</b>).
        </Lead>
        <Subhead>The three values</Subhead>
        <UL>
          <li>
            <b>Off</b> — everything is saved, as usual.
          </li>
          <li>
            <b>Stats Only</b> — for playing around without it counting. The stats strip starts from
            zero and is thrown away when the app closes, in every mode: score, accuracy, streak
            (both numbers — the best streak too), and every solve time. Your saved stats are set
            aside, untouched, and are back when you return to Off. The <b>Bests</b> in{' '}
            {modeNames('aox', 'blitz')} are the exception — they stay your real, saved ones. You see
            them, you can beat them, and a new one is saved for good the moment you set it.
          </li>
          <li>
            <b>Full</b> — a guest mode. Hand the phone over, let someone play, and when the app
            closes nothing they scored is kept: the stats strip and the Bests both start from zero,
            and both are thrown away. Your own saved stats and Bests are set aside, untouched.
            Nothing is deleted to make that happen — while a preset is on Full, nothing is written
            to them at all.
          </li>
        </UL>
        <p>
          Either way it sets apart how you <i>did</i>, never how the preset is set up: a setting
          changed during a Stats Only or Full session stays changed afterward, for you as well (see{' '}
          <b>What it keeps</b>).
        </p>
        <Subhead>The dashed outline</Subhead>
        <p>
          Whatever on the screen is not going to be kept sits inside one dashed outline, so you
          never have to remember which value a preset is on:
        </p>
        <UL>
          <li>
            On <b>Stats Only</b>, the outline goes round the stats strip, on every mode&apos;s
            screen. The Best readouts under it in {modeNames('aox', 'blitz')} are left outside it —
            those are being kept.
          </li>
          <li>
            On <b>Full</b>, one outline goes round the stats strip and the Best readouts together.
          </li>
          <li>
            On <b>Off</b>, nothing is.
          </li>
        </UL>
        <p>
          With Save Stats off the strip is dimmed instead, with no outline: nothing is being counted
          at all then, so there are no numbers on it to call temporary. (On Full the outline is then
          drawn round the Best readouts alone — they are still showing the session&apos;s Bests.)
          The outline changes nothing else: every box stays exactly where it is and works exactly as
          it did. Nothing is drawn beside a preset&apos;s name in the preset lists; see{' '}
          <b>Accessibility</b> for what a screen reader says there instead.
        </p>
        <Subhead>What it forgets</Subhead>
        <UL>
          <li>
            <b>On Stats Only and on Full</b> — score, accuracy, streak, and solve times: the whole
            stats strip. And the question history you browse with Back and Forward in{' '}
            {modeNames('classic', 'deduction', 'flash')} — the session&apos;s, that is. Your own is
            set aside and is back when you return to Off.
          </li>
          <li>
            <b>On Full only</b> — all-time bests: MoX mean and median, Blitz score and streak, and
            Per Question sudden-death score. And any finished run or round on screen — the
            guest&apos;s, that is. Your own is set aside and is back when you leave Full, except one
            whose setup was changed in the meantime (see <b>Changing it</b>).
          </li>
        </UL>
        <Subhead>What it keeps</Subhead>
        <UL>
          <li>Every ⚙ setting, theme included.</li>
          <li>
            Your per-mode setup — timers, run length, the Deduction sub-type, and the show / hide
            stat toggles.
          </li>
          <li>Your saved defaults.</li>
          <li>
            On Stats Only, your Bests in {modeNames('aox', 'blitz')}, and any new one you set.
          </li>
          <li>
            Your saved stats, through a <b>Reset Stats</b>: on Stats Only or Full that button clears
            the session&apos;s numbers — the ones on screen — and leaves the saved ones set aside as
            they were. (Full Reset is the one that clears those too.)
          </li>
          <li>
            The Amnesic value itself, for as long as the app stays open — a reload included. When
            the app is closed and opened again, each preset goes back to the value in its saved
            defaults (Off, if you have not saved any), so guest mode ends with the guest. The value
            belongs to the window the app is open in: if you have the app open twice, changing it in
            one does not change it in the other.
          </li>
        </UL>
        <p>
          So the split is how you did, not how it is set up: a preset stays itself across a close,
          and only forgets its numbers.
        </p>
        <Subhead>Lookup history</Subhead>
        <p>
          Lookup history is shared across every preset (see <b>Presets</b> above), so it is not this
          preset&apos;s to forget or to keep. On Off and on Stats Only a lookup is saved exactly as
          normal — a lookup is a question you asked, not a stat. On Full it still works exactly as
          normal, but it is never written to that saved list — the same &quot;never written
          down&quot; treatment the guest&apos;s stats get. It stays in the History list for as long
          as the app is open, in every preset and after you leave Full, and it is gone when the app
          is really closed: it never becomes a permanent entry.
        </p>
        <Subhead>Changing it</Subhead>
        <p>
          One rule covers every change between the three: whatever the session was holding is thrown
          away, and nothing from it is ever added to your saved numbers. What you see afterward
          depends only on the value you moved to:
        </p>
        <UL>
          <li>
            <b>To Off</b> — your saved stats and Bests are back exactly as they were, along with any
            Best you set during a Stats Only session, which was saved as you set it.
          </li>
          <li>
            <b>To Stats Only</b> — the stats strip starts from zero. The Bests shown are your saved
            ones.
          </li>
          <li>
            <b>To Full</b> — the stats strip and the Bests both start from zero. Everything saved is
            set aside, untouched.
          </li>
        </UL>
        <p>
          That holds whichever value you came from. Moving between Stats Only and Full starts from
          zero as well, so a guest never sees what you were doing and you never inherit what the
          guest did. Nothing is ever merged: the one thing a session adds to your saved numbers is a
          Best set on Stats Only.
        </p>
        <p>
          Any change clears the five mode screens, including a MoX run or a Blitz round in progress
          — the same discard switching preset makes, and for the same reason: every mode screen has
          to be re-read from whichever copy of your numbers is now live. (This guide and the Lookup
          page hold no stats, so they stay as they are.) A run or round that had already{' '}
          <i>ended</i> belongs to the Bests it was played for, and only ever comes back with them.
          Off and Stats Only share your saved Bests, so a finished run or round stays on screen when
          you move between those two. Going to Full puts it aside, and it is back on screen, exactly
          as you left it, when you leave Full — unless a setting it was played under was changed
          while it was set aside, in which case it is not brought back (any Best it had set is
          kept). A run or round finished on Full is discarded with the rest of that session when you
          leave Full, and never touches your saved Bests.
        </p>
        <Subhead>Two things it deliberately is not</Subhead>
        <UL>
          <li>
            <b>It is not Save Stats.</b> The switch above decides whether a question counts at all;
            this one decides whether what was counted lasts. They are independent, so you can leave
            Save Stats off inside an amnesic preset for throwaway questions and not even move the
            session&apos;s count. With Save Stats off there is nothing being recorded for Amnesic to
            be about, so this row dims and locks — it keeps its value, and comes back the moment you
            turn Save Stats on. Save Stats has no middle value of its own: Stats Only is the way to
            keep Bests without keeping stats.
          </li>
          <li>
            <b>It is not a menu setting.</b> It is held for the visit rather than saved with the
            menu — but it is saved and restored through your defaults exactly like a menu setting,
            so it counts like one too. Save Defaults captures it, silently, alongside the snapshot;
            both Reset Settings and Full Reset restore it along with everything else they cover; and
            moving it away from what your defaults hold lights the ⚙ button&apos;s small violet
            &quot;modified&quot; line, just as changing a menu setting does. See{' '}
            <b>Save Defaults, Reset Settings, and Full Reset</b> below.
          </li>
        </UL>
        <Subhead>What &quot;closed&quot; honestly means</Subhead>
        <p>
          A session&apos;s numbers last for the browsing session, and it is the browser that decides
          when one ends. A refresh or a reload does not end it — come straight back and the session
          is still going, with the preset still on Stats Only or Full, any finished round still on
          screen, and the dates you played still there to browse back through. Closing the app does.
        </p>
        <p>
          On a phone there is no way to tell that apart from the inside. An app the system shuts
          down in the background — because you left it a while, or because something else needed the
          memory — looks exactly like one you closed yourself, and takes the session&apos;s numbers
          with it either way. That is true on iOS in particular, and no web app can promise
          otherwise, so this one will not: treat an amnesic session as something you could lose at
          any moment, because you can. (A Best set on Stats Only is the exception — it was saved the
          moment you set it.)
        </p>
      </GuideSection>
      <Divider label="Data" />
      <GuideSection
        id="saved-progress"
        title="Saved Progress"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>What persists on this device between visits — and what resets each time.</Lead>
        <p>
          Everything in this section is saved <b>per preset</b> — except your Lookup history, which
          is shared by every preset instead (see <b>Presets</b> above, and the note below the list).
          Each preset has its own complete copy of the per-preset list below, and only the one you
          are on is ever read or written. Which preset you were on is remembered too, so the app
          opens where you left it.
        </p>
        <p>
          For that preset, the app saves the following on this device and restores them when you
          return — after closing the app, refreshing, updating to a new version, or revisiting later
          (an app update never resets your saved data):
        </p>
        <UL>
          <li>
            <b>⚙ Settings</b> — date format, answer input (Buttons / Dots), Rotate Dots, calendar
            system, year range, the leap / Jan-Feb / Julian chances, Save Stats, theme, and this
            preset&apos;s Default Mode (the page it opens on).
          </li>
          <li>
            <b>Your saved defaults</b> — the Save Defaults snapshot (next section), which even
            survives Full Reset.
          </li>
          <li>
            <b>Per-mode setup</b> — the Deduction sub-type; Flash speed; MoX run length, Allow
            Mistakes, and One-by-One; both Blitz timer lengths, Allow Mistakes, and Per Round vs Per
            Question; and each mode's show / hide stat toggles.
          </li>
          <li>
            <b>Stats</b> in the casual modes ({modeList('classic', 'deduction', 'flash')}).
          </li>
          <li>
            <b>All-time bests</b> — MoX mean and median, Blitz score and streak (kept separately for
            Per Round and for Per Question with Allow Mistakes), and Per Question sudden-death
            score.
          </li>
        </UL>
        <p>
          A device gives the app a fixed amount of room for all of this, and the ⚙ menu always shows
          how much of it is in use: <b>Storage used</b>, at the foot of the menu, as a percentage to
          one decimal place — &quot;Storage used: 0.3%&quot;. The last digit is never rounded up: a
          figure appears only once it has been reached, so the line reads 80.0% exactly when the
          warning below begins, and 100.0% only when the room is all used. Anything in use but
          smaller than a tenth of a percent reads &quot;&lt;0.1%&quot;, never &quot;0.0%&quot;. Tap
          the line to see what is using the room — the solve times of each mode that saves them (
          {modeList('classic', 'deduction', 'flash')}; Deduction&apos;s three puzzle types
          separately), the Lookup history, each preset&apos;s other data, and the names of your
          presets together (a name can be any length, so a very long one takes real room) — each
          with its own share of the room beside it, written the same way. The list is largest first;
          anything holding 1% or more is named, and so are the largest few however little they hold
          — though never something with nothing in it, such as a mode you have not played — with
          whatever is left gathered into one last line, &quot;Everything else&quot;. Under it is
          what you can clear to get some room back: <b>Clear History</b> in Lookup, deleting a
          preset you no longer use, and <b>Reset Stats</b> in a mode — that last one only while the
          preset&apos;s Amnesic is <b>Off</b>. Shortening your preset names is suggested there too,
          first in the list, but only when it would be enough on its own: the warning below is on,
          and shortening them alone would end it. Otherwise names are not mentioned. On Stats Only
          or Full, Reset Stats clears that session&apos;s numbers and leaves the saved solve times
          where they are, so it makes no room; the popup says so there instead of offering it, and
          says what does (set Amnesic to Off first, then Reset Stats).
        </p>
        <p>
          How much room a device gives is something the app has to measure. It does that the first
          time it opens on a device, as it starts — behind the Loading screen, before any question
          is on screen — so the line shows a percentage from the first moment you can see it. If the
          figure later proves wrong (the device refuses a save, or holds more than the measurement
          said it could), the app measures again the next time it starts, or the next time you open
          ⚙ or this breakdown with no flash, run, or round under way. If a device can&apos;t be
          measured at all there is no percentage to give: the line shows a dash, and the
          breakdown&apos;s title reads &quot;not measured yet&quot; and lists what is saved with no
          figures beside it.
        </p>
        <p>
          When the number reaches 80% the line turns amber and the ⚙ button gains an amber dot at
          once (an update&apos;s dot is light blue; with both, it is amber), and that same breakdown
          opens by itself — once each time the number climbs to 80%, so if you make room and it
          later fills up again, you are told again. It never opens while you are in the middle of
          something: a Flash, a MoX run, or a Blitz round under way, a question you are being timed
          on (also while you browse back from it to an earlier one), or a box you are typing in. It
          waits for the next moment you are free — or until you open ⚙, unless a flash, run, or
          round is still running behind the menu. Tapping the amber line yourself counts as having
          been told; and if the device is already full, the &quot;isn&apos;t being saved&quot;
          notice speaks instead and the breakdown does not open on top of it. After that it stays
          out of your way, but the colour and the dot stay until the number is back under 80%.
        </p>
        <p>
          If this device ever runs out of room for the app&apos;s saved data, a popup tells you so.
          You can keep playing — nothing already saved is lost, and your newest answers and changes
          are held exactly where they belong, so switching presets and back, or changing Amnesic and
          changing it back, still shows them. But they are only held until you close or reload the
          app. Deleting a preset you no longer use makes room, and so does Reset Stats in a mode
          whose history you don&apos;t need — while that preset&apos;s Amnesic is Off; on Stats Only
          or Full the popup names <b>Clear History</b> instead, for the reason above. Everything
          that couldn&apos;t be saved is then saved by itself. While anything is waiting like that,{' '}
          <b>Check for updates</b> won&apos;t reload the app, because a reload would lose it.
        </p>
        <p>
          <b>Lookup history</b> — the dates you&apos;ve looked up — is saved on this device too, the
          same way and through the same visits, but it is not part of the per-preset list above: it
          is <i>one</i> list, the same one no matter which preset is open, and it survives a preset
          switch and a preset delete alike &mdash; but not a <b>Full Reset</b>, which clears it from
          wherever you press it, exactly because there is only one copy to clear. See <b>Presets</b>{' '}
          above for why, and <b>Stats &mdash; Amnesic</b> for the one thing that changes what it
          does while a preset is on Full.
        </p>
        <Subhead>Kept for the visit only (cleared when you fully close the app)</Subhead>
        <p>
          A reload — reloading the page, or the app updating itself — is not a close: each
          preset&apos;s page, any ended run or round, your Back / Forward history in{' '}
          {modeNames('classic', 'deduction', 'flash')}, what you had on the Lookup page, and your
          place in this guide are all still there afterward. A run or round still in progress is
          not; a reload stops it, just as a preset switch does — and a Flash date that was still
          showing goes back to Begin, as it does when you leave the mode. Nor does anything that was
          open over the page come back: the ⚙ menu, a popup, and an open list are all closed after a
          reload, and your device&apos;s Back then leaves the app, as it does from any page with
          nothing open.
        </p>
        <UL>
          <li>
            <b>Which page each preset is on.</b> Change page, switch preset, come back &mdash; the
            preset is on the page you left it on. This lasts as long as the app stays open (a reload
            keeps it); a full close clears it, and the next open of each preset uses that
            preset&apos;s <b>Default Mode</b> (⚙ &rarr; Per-preset). Which preset the app opens{' '}
            <i>into</i> is the <b>Open in</b> setting (⚙ &rarr; Global) — and which preset you are{' '}
            <i>on</i> is kept per window: a reload stays on your preset even when another one is set
            in Open in, and switching preset in a second window does not move this one.
          </li>
          <li>
            <b>A timed run or round that has ended</b> but not yet been Reset. It is kept through a
            reload and as you switch presets and return, the same as the page above; a fresh close
            of the app or a manual Reset clears it, and so does a change to any setting it was
            played under while it was set aside (a guest changing the setup while the preset is on
            Amnesic: Full, say). A run or round still <i>in progress</i> is not kept: a reload, a
            preset switch, a change of Amnesic, or leaving the mode ends it. Either way, only a Best
            it already recorded persists.
          </li>
          <li>
            <b>The dates you can browse back through</b> in{' '}
            {modeNames('classic', 'deduction', 'flash')}, each with how you answered it and whether
            it is overridden — and Deduction&apos;s puzzle filters with them. A reload keeps them;
            each preset keeps its own while you are in another; and yours are set aside while the
            preset is on Amnesic: Stats Only or Full, and returned when it is back on Off. A Reset
            or a Full Reset starts the history over, and deleting a preset takes its history with
            it. The stats those dates earned are saved separately and are not affected.
          </li>
          <li>
            <b>What is on the Lookup page</b> — the date in the box, the answer or message under it,
            the history row you had selected, and whether Show Codes is open. A reload keeps them,
            and so does a preset switch, a change of Amnesic, or deleting a preset: like the history
            list under it, the Lookup page is not any one preset&apos;s. If the preset you switch to
            uses a different Date Format, the page follows it exactly as it does when you change the
            setting yourself (see <b>Lookup</b>). A Full Reset clears the page, as Clear does. (The
            history list itself is saved — see above.)
          </li>
          <li>
            <b>Your place in this guide</b> — the open section and how far down you had read. A
            reload keeps it, and so does a preset switch, a change of Amnesic, or deleting a preset;
            a Full Reset closes it back to the top.
          </li>
        </UL>
        <p>
          There is one exception, and it applies to a whole preset at a time. With <b>Amnesic</b> (⚙
          &rarr; Stats) on <b>Full</b>, the last two entries in the first list — your stats and your
          all-time bests — are not written to this device at all for that preset. They last as long
          as the app is open and are gone once it closes. On <b>Stats Only</b> that is true of the
          stats alone: the all-time bests are still saved. Everything else in that list still saves
          normally. Lookup history follows a related but separate rule of its own, because it is not
          this preset&apos;s to begin with — see <b>Stats &mdash; Amnesic</b> above.
        </p>
        <p>
          <b>Full Reset</b> (below) clears everything that is saved for the preset you are on —
          except that preset&apos;s saved defaults, which it restores rather than clears. Every
          other preset is left exactly as it was, with one exception: your <b>Lookup history</b>{' '}
          isn&apos;t any preset&apos;s alone, so it goes too — press Full Reset from any preset and
          the one shared list is gone for all of them. Removing a preset&apos;s saved copy outright
          is <b>Delete</b>, in ⚙ &rarr; Global &rarr; Manage Presets.
        </p>
      </GuideSection>
      <GuideSection
        id="reset-settings"
        title="Save Defaults, Reset Settings, and Full Reset"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Three buttons at the foot of the ⚙ menu — save your own defaults, restore the menu, or
          reset the preset you are on.
        </Lead>
        <p>
          All three, and the saved defaults they read and write, belong to{' '}
          <b>the preset you are on</b> and reach no other one. A second preset has its own defaults,
          its own settings, and its own stats, and none of these buttons can touch them — see{' '}
          <b>Presets</b>. They act only on the <b>Per-preset</b> half of the ⚙ menu; the{' '}
          <b>Global</b> section at the top (the <b>Open in</b> setting) is outside every one of them
          — it is not captured by Save Defaults and not moved by either Reset.
        </p>
        <p>
          Every reset-style action in the app now asks the same way: a <b>popup</b> that spells out
          what it does and whether it is <b>per-preset</b> or app-wide. That covers{' '}
          <b>Reset Settings</b>, <b>Full Reset</b>, <b>Clear Saved Defaults</b>, each casual mode's{' '}
          <b>Reset Stats</b> (see <b>Buttons — Reset Stats</b>), and the "Enable and Reset Stats?"
          case when you un-hide timing after a desync. The one exception is <b>deleting a preset</b>
          , which asks in place inside <b>Manage Presets</b> rather than in a separate popup — and
          does not ask at all when the preset is still completely untouched, since there would be
          nothing to warn you about.
        </p>
        <Subhead>Save Defaults (left)</Subhead>
        <p>
          Makes the current setup <i>your</i> defaults — from then on, the two Reset buttons restore
          these values instead of the launch ones. One snapshot captures:
        </p>
        <UL>
          <li>
            Every setting in the <b>Per-preset</b> half of the ⚙ menu: <b>Default Mode</b>, and all
            of Display (Input and Rotate Dots included), Dates, and Stats. (The <b>Global</b>{' '}
            section — <b>Open in</b> — is not part of it.)
          </li>
          <li>
            Four values from the mode screens: Flash speed, MoX run length, and both Blitz timers
            (Per Round and Per Question).
          </li>
          <li>
            This preset&apos;s <b>Amnesic</b> value (⚙ &rarr; Stats) at the moment you save — Off,
            Stats Only, or Full — captured silently alongside the rest; it is not shown or editable
            in this popup, or in <b>View Saved Defaults</b> below. It is also the value the preset
            starts on every time the app is opened afresh.
          </li>
        </UL>
        <p>
          Nothing else from the mode screens is captured — the Deduction sub-type, One-by-One, Allow
          Mistakes, Blitz's Per Round vs Per Question, and the show/hide stat toggles always reset
          to their launch values.
        </p>
        <UL>
          <li>
            Tapping the button opens a confirmation popup where the four mode-screen values can be
            edited before saving — so you can make, say, a different Flash speed your default
            without changing the live one. As on the mode screens, tap the time readout beside any
            of the popup's three sliders to type an exact value; a value you've changed highlights
            in violet. The menu settings are captured exactly as they are. <b>Save</b> is the only
            button on it: leaving the popup any other way — tapping outside it, <Kbd>Esc</Kbd>, or
            your device&apos;s Back — discards the edits and saves nothing.
          </li>
          <li>
            While anything the snapshot covers differs from your defaults, the closed gear (⚙) shows
            a small violet bar along its bottom edge, and the Save Defaults button is active; once
            everything already matches your defaults, the bar disappears and the button dims —
            nothing new to save. <b>Amnesic</b> counts here like any other value the snapshot
            covers: move it away from what your defaults hold and the bar lights and Save Defaults
            comes alive, so &quot;Amnesic: Stats Only&quot; or &quot;Amnesic: Full&quot; can be
            saved as a default on its own. A year you have typed but not yet left also lights the
            bar, even though there is nothing to save for it yet — pressing Save Defaults then saves
            everything else and leaves the bar lit until the year is finished or dropped. Finishing
            it does not clear the bar either, unless the year you finished on is the one your
            defaults already hold: a stored range that differs from your defaults lights the bar in
            its own right. <Kbd>Esc</Kbd> is what puts a year you never meant to type back. The bar
            is separate from the light-blue update dot at the gear&apos;s top-right corner (see
            Updates in the first section), and the two can show at once.
          </li>
          <li>
            Your saved defaults survive Full Reset — that's the point: Full Reset restores{' '}
            <i>them</i>. <b>View Saved Defaults</b>, at the foot of the ⚙ menu (below the reset
            buttons), opens a popup with the same four rows as the Save Defaults popup, showing your
            saved mode-screen values (every menu setting is also part of the snapshot, captured as
            it was when you saved). The link is always there: before you've saved any defaults it
            shows the factory values instead, labelled as such. At rest the popup carries no buttons
            — tap outside it, press <Kbd>Esc</Kbd>, or use your device's Back to close it.
          </li>
          <li>
            That popup is also where you edit your defaults directly. Adjust any row — here the run
            length is a tap-to-type readout too, like the timer readouts — and the changed value
            highlights in violet, a <b>Save</b> button appears, and a note shows: saving there
            updates only those four values, while every menu setting in the snapshot stays exactly
            as it was. Leaving the popup instead — outside tap, <Kbd>Esc</Kbd>, or Back — throws the
            edits away. Saving from the factory view creates your saved defaults, with the menu
            settings captured at their launch values.
          </li>
          <li>
            <b>Clear Saved Defaults</b>, to the right of View Saved Defaults, is the way back to the
            launch defaults. It is always there too, but dims and locks until you have saved
            defaults to clear — the same treatment the three buttons above it use for "nothing to do
            right now". Tapping it asks for confirmation in a small popup before it forgets the
            snapshot; your current settings are untouched. The links live in the footer rather than
            the Save Defaults popup because that button — and with it its popup — dims whenever
            everything already matches your defaults; the footer links are always reachable.
          </li>
        </UL>
        <Subhead>Reset Settings (middle)</Subhead>
        <p>
          Asks first, in a popup that names what it restores and that it is per-preset. Confirm and
          it restores everything the snapshot covers to your saved defaults — or, if you haven't
          saved any, to the launch defaults. That is the whole ⚙ menu:
        </p>
        <UL>
          <li>Random Format off, Written MDY</li>
          <li>Input on Buttons, Rotate Dots on Standard</li>
          <li>Default Mode back to Classic</li>
          <li>Julian on, Julian Chance Random</li>
          <li>Year range 1–10000</li>
          <li>Leap Year Chance Random, Jan/Feb Chance Random</li>
          <li>Save Stats on, Amnesic Off</li>
          <li>
            Theme back to Use System Settings, with Dusk on the Dark row and Light on the Light row
          </li>
        </UL>
        <p className="text-(--tx-300-70) text-[12px]">
          Default Mode is restored like any other value, but it only decides where a preset{' '}
          <i>opens</i> — pressing Reset Settings does not move you off the page you are on now.
        </p>
        <p>
          …plus the same four mode-screen values Save Defaults captures: the Flash speed, the MoX
          run length, and both Blitz timers. That makes Reset Settings the exact mirror of Save
          Defaults — one copies your live setup into your defaults, the other copies your defaults
          back over your live setup — across the very same values the gear's violet bar watches, so
          a single tap clears that bar whatever changed.
        </p>
        <p>
          It also restores this preset&apos;s <b>Amnesic</b> value to what it was at the moment you
          saved your defaults — exactly as if you had changed <b>Amnesic</b> yourself (see{' '}
          <b>Stats &mdash; Amnesic</b> above for what a change does). That means pressing Reset
          Settings for an unrelated reason, mid-session, can move it too: whatever the session had
          recorded is discarded the same as always, and if it lands on Stats Only or Full, your
          saved stats are set aside exactly as they were the moment before.
        </p>
        <p>
          It still leaves the other mode-screen choices alone: the Deduction sub-type, One-by-One,
          Allow Mistakes, Blitz's Per Round versus Per Question, and the show/hide stat toggles all
          stay exactly as you have them. Your stats and history are untouched too — <i>unless</i>{' '}
          the <b>Amnesic</b> restore above actually changes the value, in which case whatever that
          change discards or sets aside (see the paragraph above) is gone the moment you tap, not
          held back until anything closes. Restoring one of the four capturable mode-screen values
          while a MoX run or a Blitz round is going resets that run or round when you close the
          menu, exactly as an ordinary ⚙ panel change does — but an <b>Amnesic</b> change is not a
          menu value reconciling on close, it changes which numbers the preset is showing outright,
          so it (and the run or round it can take with it) lands immediately on the tap itself,
          before the menu is ever closed. The popup confirms the restore itself; an <b>Amnesic</b>{' '}
          change it carries out still lands on the tap, before the menu closes. When everything the
          snapshot covers is already at your defaults, the button dims and locks, since tapping it
          would have no effect.
        </p>
        <Subhead>Full Reset (right)</Subhead>
        <p>Restores the preset you are on to its launch state:</p>
        <UL>
          <li>
            Wipes all stats, all-time bests ({modeNames('aox', 'blitz')}), your{' '}
            <b>Lookup history</b>, and every run and round — the ones in progress and the finished
            ones still on screen. Your stats and all-time bests are saved on this device, so Full
            Reset clears that saved copy permanently. That is true in a preset with <b>Amnesic</b>{' '}
            on Stats Only or Full as well: it clears both the session you are in and the saved stats
            and bests waiting behind it, so nothing comes back when you return to Off. Amnesic stops
            your play from being recorded; it does not shield anything from a reset you asked for.
            Lookup history is the one thing on this list that isn&apos;t only this preset&apos;s —
            it is shared by every preset (see <b>Presets</b> above), so Full Reset clears it for all
            of them, not just this one.
          </li>
          <li>
            Resets every setting and toggle across all modes — both the ⚙ menu and the per-mode
            toggles. The menu settings and the four Save Defaults values (Flash speed, MoX run
            length, both Blitz timers) restore to <i>your</i> saved defaults; everything else
            (Deduction sub-types and toggles, One-by-One, Allow Mistakes, Per Round / Per Question,
            the show/hide stat toggles) returns to its launch value. The saved defaults themselves
            survive. Full Reset also restores the preset&apos;s <b>Amnesic</b> value to whatever you
            last saved — the same restore <b>Reset Settings</b> makes, above — but it changes
            nothing about the wipe just above: the session&apos;s numbers and the saved ones are
            both gone, whichever value Amnesic ends up on afterward.
          </li>
          <li>
            Closes any open overlay (⚙ menu, codes, method breakdown) and switches to Classic —
            regardless of this preset&apos;s <b>Default Mode</b>, which Full Reset restores along
            with the rest of the menu but does not act on now. How to Play goes back to the top with
            every section closed, so nothing is left open behind you.
          </li>
        </UL>
        <p>
          Asks first, in a popup: it names what it wipes and what it keeps (your saved defaults),
          and that it is per-preset — plus that the one shared thing, your Lookup history, goes too.
          The rose button fires it; dismissing the popup — tapping outside it, <Kbd>Esc</Kbd>, or
          Back — backs out. When every setting, toggle, stat, best, history entry, and live state in
          the preset you are on is already where Full Reset would put it, the button dims and locks
          since tapping it would have no effect. It never counts anything in another preset, and it
          never clears one — the way to remove a whole preset is <b>Delete</b>, in ⚙ &rarr; Global
          &rarr; Manage Presets.
        </p>
      </GuideSection>
      <Divider label="Modes" />
      {/* One section per practice mode, in the page list's order (lib/modes). The title is the
          page's own label and the body is MODE_SECTION_BODY's entry for it, at the foot of this file. */}
      {PRACTICE_MODES.map((m) => (
        <GuideSection
          key={m.id}
          id={m.id}
          title={m.label}
          openId={open}
          onToggle={toggle}
          durationMs={motionMs}
        >
          {MODE_SECTION_BODY[m.id]}
        </GuideSection>
      ))}
      <GuideSection
        id="lookup"
        title="Lookup"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>Enter any AD date to instantly see its weekday.</Lead>
        <UL>
          <li>
            Lookup input is always numeric and follows your selected Date Format (m/d/y, d.m.y, or
            y-m-d). It ignores Random Format and always uses the selected format directly. Changing
            the Date Format rewrites the box into the new one: a date you have selected comes back
            written the new way, and if nothing is selected the box is emptied instead, since
            half-typed text in the old format would no longer read.
          </li>
          <li>
            Supports years 1–10000. The note under the box says which order to type the date in.
          </li>
          <li>
            The answer has three fixed lines under that note — the date, then its weekday — and
            always keeps its space, so nothing on the page shifts as answers come and go. It sits at
            the foot of that space, directly on top of Show Codes: an answer that needs only two
            lines leaves the spare one above it. With nothing to report — before your first lookup,
            or after Clear — it simply invites you to enter a date.
          </li>
          <li>
            Show Codes sits directly under the answer — the same button the game modes have under
            their controls. It is available for all results and stays open as you browse your
            history; while it is open, the history panel below gives up the room it needs.
          </li>
          <li>
            <b>Dates before the Gregorian switch have two weekdays, and Lookup shows both.</b> On or
            before October 4, 1582 a date can be read in the Julian calendar or in the Gregorian one
            projected back, and the two rarely agree — so the answer names each: "Julian: Saturday",
            "Gregorian: Wednesday". Nothing is chosen for you, and the Julian Calendar setting makes
            no difference here. From October 15, 1582 onwards there is only one reading, and it is
            shown on its own with no label.
          </li>
          <li>
            Some of those early dates exist in one calendar only — February 29 of a year like 1500
            is a real Julian date and no Gregorian date at all, because the two disagree about which
            years are leap years. That reads as "Gregorian: Does Not Exist", and Show Codes works
            through the calendar the date actually has.
          </li>
          <li>
            The history panel keeps every date you look up — there is no limit, and nothing drops
            off the end. Each new one goes on top, and looking a date up again moves it back to the
            top rather than listing it twice. From the second entry onwards the number saved is
            shown beside the History heading. The list scrolls within its own box whenever it is
            taller than the room available, however long it gets, and softly fades out at the top or
            bottom edge wherever there are more entries that way. <b>Clear History</b> empties it.
          </li>
          <li>
            History rows say the same thing in short, so each stays on one line: "J: Sat · G: Wed"
            for a date with two readings, and just the weekday on its own for every other date. Tap
            a row to see it spelled out in full above; the row you tapped is tinted and marked with
            a coloured edge down its left side, so you can always tell which one you are reading.
            The list keeps that row in view: ↑ and ↓ walk it along with the selection, and a new
            lookup brings the list back to the top, where the new entry is.
          </li>
          <li>
            A reload keeps the page as you had it — the date in the box, its answer, the selected
            row (scrolled back into view, wherever in the list it is), and Show Codes open or
            closed. So does switching presets, changing Amnesic, or deleting a preset: the page,
            like its history list, is the same one in every preset. Closing the app or a Full Reset
            starts it empty again; closing the app leaves the history list as it was.
          </li>
          <li>
            Nothing in Lookup is frozen at the moment you look it up: the answer and every history
            row are worked out afresh from the date itself, so changing the Date Format updates the
            answer and the whole list together — an older entry can never disagree with the one
            above it.
          </li>
          <li>
            October 5–14, 1582 never existed — they are neither calendar's dates, not an early date
            with two readings — and will appear in history as "Does Not Exist" with Show Codes
            unavailable.
          </li>
        </UL>
      </GuideSection>
    </div>
  )
}

// MODE_SECTION_BODY — what each practice mode's section under the "Modes" divider says. A RECORD
// KEYED BY MODE, not a run of sections in the page, so the ORDER they appear in is the page list's
// (lib/modes' PAGES) and nowhere else: GuidePage maps PRACTICE_MODES over this. The Record type
// makes a mode with no entry a compile error, so a new mode cannot ship without its section.
// Module scope because every body is fixed text — none reads anything of GuidePage's.
const MODE_SECTION_BODY: Record<PracticeModeId, ReactNode> = {
  classic: (
    <>
      <Lead>The main practice mode — no time pressure, answer at your own pace.</Lead>
      <UL>
        <li>
          Override works after both wrong and correct answers, and Undo takes it back — on that
          date, whenever you next point the button at it.
        </li>
        <li>
          Reset Stats clears your stats and question history; when timing stats are hidden and you
          haven't burned the current date, the date is kept.
        </li>
      </UL>
    </>
  ),
  aox: (
    <>
      <Lead>
        The mean of your times over a set number of correct solves (2–1000) — every solve counts and
        nothing is trimmed, which is why this mode is Mo(X) and not Ao(X).
      </Lead>
      <p>
        The score shows correct answers out of total attempts; the run ends when correct answers
        reach your target. Press Begin to start a run.
      </p>
      <Subhead>Run options</Subhead>
      <UL>
        <li>
          <b>Allow Mistakes</b> — wrong answers don't end the run but don't count toward your score.
          With it on, Reveal and Show Codes also count as a miss but keep the run going: Reveal
          flashes the answer then automatically moves on; Show Codes opens the codes so you can
          study, then a <b>Next</b> button moves you on (it waits, since you need time to read).
          With One-by-One on, Reveal also waits on a Next button so you can see the answer before
          the next hidden date. With Allow Mistakes off, Reveal or Show Codes ends the run.
        </li>
        <li>
          <b>One-by-One</b> — hides the date between solves. Press Continue to reveal each new date.
          That holds however the run moves on — a correct answer, <b>Next</b>, or an Override that
          credits a date and moves you along: the new date always waits for Continue, and its clock
          starts when you press it.
        </li>
        <li>
          <b>Last / Mean / Med</b> — tap any of these to show or hide all three time stats. Hiding
          is visual only: your times keep recording, the clock never stops, and a run that has ended
          — completed or failed — always shows its times.
        </li>
      </UL>
      <Subhead>Back / Forward and Override</Subhead>
      <UL>
        <li>
          <b>Back / Forward</b> — once a run has ended (completed or failed), browse every date from
          that run. They are unavailable while a run is still going, so a run is always played at
          its live date; press Reset to start fresh.
        </li>
        <li>
          <b>Override</b> — after a wrong answer (or a Reveal, or a Show Codes): credits it, with
          the time you took over your first attempt on it, and moves you on to a new date. After a
          correct answer: takes the credit away. Either way your streak and best streak are worked
          out again from every date in the run, so taking the credit off a date in the middle of a
          run splits the streak around it rather than wiping it. With Allow Mistakes off, any tap
          that leaves a date wrong ends the run. With it on, taking the credit off the solve that
          finished the run hands the run back to you: the date stays on screen as a resolved miss
          and a <b>Next</b> button carries the run on — as it also does when an Undo puts a revealed
          miss back on screen.
        </li>
        <li>
          If a run failed — on a wrong answer, a Reveal, a Show Codes, or a tap that left a date
          wrong (all with Allow Mistakes off) — crediting the date that failed it continues the run
          where it left off, as long as nothing else in the run is still wrong. If something is, the
          credit counts and the date stays on screen, but the run stays failed. Crediting the date
          that brings the run to its target completes it right there, on that date; no extra date is
          drawn.
        </li>
        <li>
          On an ended run you can override any of its dates while browsing back; a tap made while
          browsing never restarts the run under you. When a date is already overridden the button
          reads <b>Undo</b> for it, which puts back the score, that date&apos;s own marks and time,
          and the run&apos;s state with them — a failed run fails again, a completed one completes
          again. There is no time limit and nothing is used up: you can switch a date between
          Override and Undo as often as you like, now or after browsing back to it later. Override
          works the same whether Save Stats is on or off.
        </li>
      </UL>
      <Subhead>Stats and bests</Subhead>
      <p>
        Stats in MoX always track — the clock never stops. You can blank the timing trio (Last /
        Mean / Median) with a tap while a run is going, but it's visual only, and a run that has
        ended — completed or failed — always shows its times. Best mean and best median are tracked
        independently — they can come from different runs. Beneath each best, the companion metric
        from the run that set it is also shown (e.g. the median from the run that set your best
        mean). A <i>Same Run</i> or <i>Different Runs</i> tag tells you whether your best mean and
        best median came from the same exceptional run, or from two different strong ones. On a
        narrow screen the tag is left out when there is no room for it beside the two bests.
      </p>
      <p>
        Bests stay honest under Override: a finished run's record follows its corrected stats —
        overriding away one of its credited solves (on the last question or while browsing back)
        restores the best that stood before the run, and a correction that changes the run's mean or
        median updates its record to match. That holds however many times you toggle a date,
        including after a preset switch: a best follows the run it belongs to, and the last tap
        decides. When a run ends its score stays on screen — changing only when you override one of
        its dates — until you press Reset. Leaving MoX mid-run resets it; a run that has ended —
        completed or failed — stays on screen when you come back, from another mode or from another
        preset, until you press Reset or Full Reset, close the app, or change a setting it was
        played under.
      </p>
      <p>
        Bests are tracked per exact configuration: MoX run length, Allow Mistakes, Date Format (or
        Random Format on its own bucket), Leap Year Chance, Jan/Feb Chance on Leap Years, Julian
        Chance, year range, and Calendar System (Julian on/off). Changing any of these creates a
        separate bucket — your previous bests remain stored and reappear when you switch back to
        that exact config. Everything else leaves your bests where they are: the mode&apos;s name
        (so the AoX &rarr; MoX rename kept everyone&apos;s), your answer input style, Rotate Dots
        (all three rotations share one set of bests), and the theme.
      </p>
      <p>
        The small <b>Q#</b> label at the top-right of the date card appears not only while
        back-browsing but also at run end (done/failed), so you can identify which question of the
        run you're viewing in the summary.
      </p>
      <Subhead>Mean Breakdown</Subhead>
      <p>
        Once a run has ended — completed, or failed on a mistake — tapping anywhere on the stats
        strip opens the run solve by solve: the numbers behind the mean, each date with its day of
        the week, the fastest and slowest marked, and any solve that didn't count called out. A
        failed run lists every date up to the one that ended it. It's described in full under Stats.
        It's available while the ended run is on screen, and only when Save Stats is on: with Save
        Stats off the strip is showing dashes, and it won't hand over numbers it is declining to
        display.
      </p>
    </>
  ),
  deduction: (
    <>
      <Lead>Identify the missing piece of a date given the rest plus the weekday.</Lead>
      <p>
        Choose Day, Month, or Year mode. The displayed date follows your selected Date Format (or
        random format snapshot, if Random Format is on), with a fixed-width underscore placeholder
        where the missing piece would normally appear.
      </p>
      <Subhead>Day</Subhead>
      <p>
        Seven consecutive days are shown, each with a unique day code. The correct day can appear in
        any position. <i>October 1582:</i> days 5–14 don't exist (the Gregorian transition skipped
        them), so the valid days are 1–4 and 15–31. When the window can't fit seven days on one side
        of the gap, it shrinks to four — codes 1, 2, 3, 4 repeat at days 15, 16, 17, 18, so a
        five-day window crossing the gap would have a duplicate code.
      </p>
      <Subhead>Month</Subhead>
      <p>
        Seven fixed boxes group months that share the same month code, so tapping any month within a
        box gives the same weekday for that date. Tap the box containing the correct month. The
        boxes are always in the same position. In leap years, January shifts into the Apr/Jul box
        (becoming Jan/Apr/Jul) and February shifts into the Aug box (becoming Feb/Aug); the other
        boxes are unchanged.
      </p>
      <p>
        <i>Year 1582 with Julian on:</i> a special layout applies because the Julian/Gregorian
        transition splits the year — January through September and October 1–4 use Julian (year code
        +1), while October 15+ and November/December use Gregorian (year code −2). October's box
        position depends on the day: for days 1–4 it joins Jan and Nov ("Jan/Oct/Nov"); for days
        15–31 it joins Jun ("Jun/Oct"); for days 5–14 it's excluded since those dates don't exist.
        The other six boxes are arranged differently from the standard layout — practice carefully.
      </p>
      <Subhead>Year</Subhead>
      <p>
        Five consecutive year options. Each has a unique year code, so only the correct year matches
        the displayed weekday. The correct year can appear in any position. <i>With Julian on:</i>{' '}
        when the five-year window would cross October 15, 1582 (the Julian/Gregorian boundary), it
        shrinks to two years — the calendar's 10-day jump produces a +5 weekday shift across that
        boundary that breaks distinctness for any longer window. <i>February 29:</i> only allowed
        when the window contains at least one leap year (Gregorian or Julian as appropriate).
        Non-leap years still appear as options but trivially can't be the answer, since Feb 29
        doesn't exist in those years.
      </p>
      <Subhead>Per-mode toggles</Subhead>
      <p>
        These are mode-specific, not in the ⚙ Settings menu, since they only apply to one Deduction
        sub-mode. Year mode adds <i>ab</i> Cross (left of Day/Month/Year) and Jul Cross (right);
        Month mode adds 1582 Only (right).
      </p>
      <UL>
        <li>
          <b>
            <i>ab</i> Cross
          </b>{' '}
          (Year mode) — when on, the five-year window must cross a year ending in 00 (any 100-year
          boundary, both leap and non-leap centuries). Practice the <i>ab</i> code change
          mid-window. Disabled when your year range doesn't span any 100-year boundary.
        </li>
        <li>
          <b>Jul Cross</b> (Year mode) — when on, the two-year window must cross October 15, 1582
          (the Julian/Gregorian transition). N=2 always. Disabled when the Julian setting is off, or
          when your year range doesn't contain 1582 plus at least one of its neighbors (1581 or
          1583).
        </li>
        <li>
          <b>Both Year toggles on</b> — each puzzle randomly picks (50/50) which constraint to
          enforce. The two can't both be true for the same window. While both are on, two-year
          puzzles are centred in the space the five-year layout uses, so the answer area and the
          buttons below hold still as the two layouts alternate.
        </li>
        <li>
          <b>1582 Only</b> (Month mode) — when on, every puzzle uses year 1582, forcing the special
          split layout described above. Disabled when the Julian setting is off or your year range
          excludes 1582. When the answer's cell groups months from both calendars, Show Codes uses
          slash notation (e.g., 1/-3, Julian/Gregorian) for any value that differs across the cell's
          months; values that are the same across all months collapse to a single value.
        </li>
      </UL>
      <p>
        A correct answer briefly pulses the chosen option green, and when the next puzzle keeps the
        same answer layout the pulse carries over onto it. When the layout itself changes between
        puzzles — a two-year window after a five-year one, or October 1582's four-day window after a
        seven-day one — the new layout appears clean, with nothing carried over.
      </p>
      <Subhead>Sub-types and stats</Subhead>
      <p>
        Switch sub-types anytime — progress in each is preserved, including question history. Stats
        are tracked separately for each sub-type, and Back/Forward only walks the current sub-type's
        entries. Reset Stats clears the current sub-type's stats and history only; the others are
        untouched. Override and its Undo work as they do in Classic, and each sub-type keeps its own
        dates and their own Override records: the button always means a date in the sub-type you are
        playing. When timing stats are hidden and you haven't burned the current question, the
        question is kept.
      </p>
    </>
  ),
  flash: (
    <>
      <Lead>The date is shown briefly, then hidden — answer from memory.</Lead>
      <UL>
        <li>
          The date is revealed for 0.1s–5.0s (default 2.0s; drag the slider or tap its value to
          type) then hidden.
        </li>
        <li>
          Reset Stats clears your stats and question history. Mid-question, Reset Stats always
          generates a new date and returns to the dash state.
        </li>
      </UL>
      <Subhead>While the date is showing</Subhead>
      <p>
        You can press Reveal or Show Codes — both freeze the countdown (the timer bar and the number
        stop together) and keep the date on screen. Reveal shows the answer and counts a miss; Show
        Codes does the same and also opens the calculation breakdown.
      </p>
      <p>
        Crediting the flashed date ends that flash, because the credit moves you on to a new date —
        the reveal window belonged to the date you just left. Nothing brings a finished flash back:
        undoing that credit changes the score and nothing on screen. A tap aimed at an{' '}
        <i>earlier</i> date instead (the one behind this one) leaves the flash running on its own
        date, right where it was, so it is never a free extra look.
      </p>
    </>
  ),
  blitz: (
    <>
      <Lead>Answer as many dates as possible before time runs out.</Lead>
      <p>Score shows correct answers for the current round only.</p>
      <p>
        Tap Last, Mean, or Median to hide the timing stats. This is visual only — the clock keeps
        running and your times reappear unchanged when you tap again (see Stats). Score and Accuracy
        stay visible, along with Streak wherever the mode shows it. Hiding applies to a round in
        progress: once a round ends, the three time boxes show that round's times and stop toggling
        — a tap on the ended strip opens that round's breakdown instead (see Stats). Your hide
        setting comes back with the next round, or as soon as a tap of Override or Undo puts the
        ended round back on the clock.
      </p>
      <Subhead>Round options</Subhead>
      <UL>
        <li>
          <b>Allow Mistakes</b> — when on, wrong answers count against accuracy and break your
          streak but don't end the round: in Per Round the countdown just keeps running, and in Per
          Question the current question's clock keeps running while you retry the same date (you
          advance — with a fresh question clock — only by answering correctly, or by crediting the
          date with Override). When off, a wrong answer ends the round immediately in either
          sub-mode.
        </li>
        <li>
          <b>Per Round / Per Question</b> — tap to switch. Per Round uses a single countdown for the
          whole round (10s–5m, default 60s). Per Question gives each question its own countdown
          (1s–30s, in half-seconds, default 10s); running out of time ends the round. Adjust either
          with its slider or tap the value to type. The two switches are independent — any
          combination of Per Round / Per Question and Allow Mistakes plays (and keeps its own
          bests).
        </li>
      </UL>
      <Subhead>Ending a round and Override</Subhead>
      <p>
        When the round ends, your bests are recorded and — unless a tap of Override / Undo ended it
        (see below) — the correct answer for the current date is highlighted. A round ends when time
        runs out — the round countdown in Per Round, or any single question's clock in Per Question.
        It also ends if you give up on the current date with Reveal or Show Codes, or — with Allow
        Mistakes off — on a wrong answer or if a tap of the Override / Undo button flips any date to
        wrong.
      </p>
      <p>
        You can then browse your round's history with Back/Forward and override past dates to adjust
        your score and saved bests. Crediting the date that ended the round — whether it ended on a
        wrong answer, a Reveal, or a Show Codes (in Per Question with Allow Mistakes, this includes
        a round that timed out on a date you&apos;d already answered wrong) — resumes the round, as
        long as you are at the live date and not browsing back, and, with Allow Mistakes off,
        nothing else in the round is still wrong. If something is, the credit counts and the date
        stays on screen, but the round stays ended. A round the clock ended — the Per Round
        countdown, or a Per Question clock on a date you hadn&apos;t touched — is over for good; you
        can still override its dates. Override works the same whether Save Stats is on or off.
      </p>
      <p>
        The button reads <b>Undo</b> for any date you have already overridden, with no time limit —
        answer more questions, browse away, come back to that date later, even after a preset
        switch, and it still undoes there. Tapping it moves the round as well as the score, and the
        clock tells you how:
      </p>
      <UL>
        <li>
          A round that ended because its date was <b>answered, revealed, or show-coded</b> has that
          answer on screen, so its clock stops while it waits. Credit that date and Per Round
          resumes with exactly the time it had left; Per Question moves on to the next date with a
          fresh question clock. Either way, fixing a misclick costs you nothing, and waiting before
          you fix it gains you nothing either.
        </li>
        <li>
          A round a <b>tap ended</b> (a flip to wrong with Allow Mistakes off) still has its live
          date on screen and unanswered — so its clock keeps counting down while the round sits
          ended, in full view (time the phone spends turned sideways doesn&apos;t count, as in
          play). Putting that flipped date&apos;s credit back resumes the round on the <i>same</i>{' '}
          live date, charged for every second of the wait: no new date is drawn, and there is no
          free pause. If the clock runs out while the round waits, the round is over for good.
        </li>
        <li>
          Opening Show Codes on the live date of a round waiting after a tap counts that date as a
          miss, like any Show Codes, and stops the countdown where it stands. From then on the round
          waits like one that ended on a Show Codes: credit that date too, and it resumes from there
          (Per Round) or with a fresh question clock on the next date (Per Question). Opened on a
          past date while browsing back, the codes are only a review, and the countdown keeps going.
        </li>
      </UL>
      <p>
        A round&apos;s bests aren&apos;t locked in until it ends for real, so a misclick you fix
        doesn&apos;t update them. Your bests and their ★ markers follow every tap: a ★ marks a best
        the round on screen set, so a tap that hands a best back to an earlier round takes the ★
        away with it.
      </p>
      <Subhead>Streak and bests</Subhead>
      <UL>
        <li>
          Streak is hidden in Per Question only when Allow Mistakes is off, since there a wrong
          answer ends the round and streak always equals score. With Allow Mistakes on, streak works
          exactly as in Per Round: a wrong answer breaks it, and Best Streak is the highest streak
          the round reached.
        </li>
        <li>
          Best scores are tracked per exact configuration: timer duration, Allow Mistakes, Per
          Round/Per Question, Date Format (or Random Format as its own bucket), Leap Year Chance,
          Jan/Feb Chance on Leap Years, Julian Chance, year range, and Calendar System (Julian
          on/off). Changing any of these creates a separate bucket — your previous bests remain
          stored and reappear when you switch back. Everything else leaves your bests untouched: the
          mode&apos;s name, your answer input style, Rotate Dots (all three rotations share one set
          of bests), and the theme.
        </li>
        <li>
          Best score and best streak are tracked independently in Per Round and in Per Question with
          Allow Mistakes on; a <i>Same Round</i> or <i>Different Rounds</i> tag tells you whether
          they came from the same exceptional round or two different strong ones. On a narrow screen
          the tag is left out when there is no room for it beside the two bests. Per Question with
          Allow Mistakes off keeps a single best score (streak would equal it).
        </li>
      </UL>
      <Subhead>Leaving and resetting</Subhead>
      <p>
        Leaving Blitz mid-round abandons it — you return to a fresh, idle Blitz (no hidden countdown
        keeps running while you're away). If you leave after a round ends without pressing Reset,
        the round state (bests, history, final date) is preserved when you return. Press Reset to
        clear your current round, unlock the settings, and start fresh. Changing a setting the round
        depends on — while a round is going or has ended — resets it when you close the ⚙ menu.
      </p>
    </>
  ),
}
