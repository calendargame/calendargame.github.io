import {
  useState,
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import Expander from './Expander.jsx'
import { Kbd, SectionLabel, SECTION_LABEL_CLASS } from './primitives.jsx'
import { DAY } from '../lib/format.js'
import { DOT_CELLS, dotOrientationFor } from '../lib/dotLayout.js'
import { selectionSuppressesToggle } from '../lib/selectionGuard.js'
import { useSettings } from '../store/settings.js'
import {
  ACCORDION_EASE_CSS,
  accordionEase,
  accordionScrollTarget,
  accordionToggleMs,
} from '../lib/accordionMotion.js'

// GuidePage / GuideSection — the How-to-Play tab: an accordion of documentation
// sections (each a GuideSection wrapping an Expander) covering every observable
// behavior on the site. GuideSection is the reusable open/close row; GuidePage
// lays them out with Divider separators and owns the toggle coordinator (Q8):
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
// main.tsx), and an overflow div has to be named, so App passes `scrollerRef`. Every
// read below that used to be a window global — scrollY, innerHeight,
// document.scrollingElement.scrollHeight — is that element's scrollTop, clientHeight
// and scrollHeight instead. The arithmetic in lib/accordionMotion did not move a byte:
// it was always about "a scroller", and only its INPUT NAMES still say document.
//
// Extracted from main.jsx in Stage C, Step 4e. Rewritten for scannability — every
// section now leads with a one-line summary, then tight chunks / bulleted lists;
// no documented behavior was dropped. GuideSection is exported named; GuidePage is
// the default export.

// DOM ids for a section's two landmarks. panelDomId is first an accessibility
// contract — the header button's aria-controls points at the panel body, which
// carries the id — and the coordinator leans on the same ids to re-derive every
// element it needs at tap time (the wrapper for geometry, the body for heights)
// from nothing but the two section-id strings in state. That kept the whole
// component ref-free until round 13, when the scroller itself had to be handed in;
// it is still what keeps the SECTIONS ref-free, which is the part that scales with
// the number of sections.
const sectionDomId = (id: string) => `guide-sec-${id}`
const panelDomId = (id: string) => `guide-panel-${id}`

// startScrollWriter — the coordinator's per-frame scroll driver, pointed at the element
// the guide scrolls. Runs the SAME clock and curve as the panel transitions: durationMs
// is the very value stamped into --expander-ms (pre-multiplied by --motion-scale, so
// Reduce Motion passes 0 here), and accordionEase is the numeric twin of the panels' CSS
// cubic-bezier. rAF callbacks fire before a frame's style/paint, so the first callback
// lands on the same frame the CSS transition first renders — treating its timestamp as
// t=0 keeps writer and panels in step — and a 0 duration jumps straight to the end state
// on that first pre-paint callback: the snapped layout and the corrected scroll appear
// together (the Reduce Motion instant path, which also fixes the old teleport-past-max
// clamp). Any real user scroll input (touchstart/wheel) cancels the writer instantly —
// the user always wins — and the returned cancel function serves mid-flight re-toggles,
// leaving the guide for another mode, the app being backgrounded, and unmount (see
// scrollWriterRef below).
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
  durationMs: number,
): () => void {
  let raf = 0
  let start: number | null = null
  const cancel = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('touchstart', cancel)
    window.removeEventListener('wheel', cancel)
  }
  window.addEventListener('touchstart', cancel, { passive: true })
  window.addEventListener('wheel', cancel, { passive: true })
  const step = (now: number) => {
    if (start === null) start = now
    const p = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs)
    el.scrollTop = from + (to - from) * accordionEase(p)
    if (p < 1) raf = requestAnimationFrame(step)
    else cancel()
  }
  raf = requestAnimationFrame(step)
  return cancel
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
  // The per-toggle motion clock (Q8): GuidePage's coordinator computes ONE duration per
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
    <div id={sectionDomId(id)} className="rounded-2xl panel overflow-hidden">
      <button
        type="button"
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
        className="w-full text-left px-4 py-3 flex items-center justify-between"
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
// ramp tier the section titles use (Q16, index.css), which every theme defines, so
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
// the Q16 text/rule ramp generalized app-wide), so they stay visible on every theme.
function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1 marker:text-(--mut-color)">{children}</ul>
}
// DotDiagram — a small inline SVG of the 7-dot answer layout (Settings → Display →
// Input → Dots), each dot labelled with its weekday. Everything is DERIVED from the
// shared DOT_CELLS grid (lib/dotLayout — the same data that positions the real Dots
// input) + the DAY names (lib/format): grid cell (r,c) → SVG centre
// (x = 30+(c-1)*60, y = 28+(r-1)*62), the label is the day's first three letters,
// and the aria-label sentence reads the filled cells in row order — no hand-kept
// copy of the layout exists here to drift. Drawn entirely in currentColor so it's
// legible on every theme.
// ★ IT SHOWS THE PLAYER'S OWN ORIENTATION (Settings → Display → Dot Layout), not a
// fixed picture of the upright one: the section's heading is "Which dot is which",
// and there is exactly one honest answer to that — the layout currently on screen.
// A second diagram of the other orientation was considered and rejected: it would
// document the setting twice (the words below already name both) while making the
// answer to "which dot is which" ambiguous, which is the one thing the diagram is
// for. Flipping the setting flips this picture, which is its own documentation.
// The whole 3×3 frame is unchanged by the turn — only which cell each day occupies —
// so the viewBox, the spacing and the labels-below-dots layout all still hold, and
// the two rows of three labels the rotated form produces are the same count the
// upright form's middle row already had.
//   ⚠ A STORE SELECTOR, where every other consumer of this setting takes a prop. It is
//     forced rather than chosen: GuidePage's entire signature is `visible` +
//     `scrollerRef`, so a prop would mean opening a settings pipeline through the guide
//     for one decorative SVG at the bottom of it. Selecting here also keeps the
//     subscription at the leaf — the guide itself does not re-render on a flip.
function DotDiagram() {
  // Q3 (round 20): the store field is the boolean `rotateDots`; dotOrientationFor is the one place
  // it is turned back into DotOrientation. Read RAW, deliberately not gated on inputStyle — see the
  // header comment above (the diagram documents what turning the toggle ON would look like even
  // when Buttons is the player's current Input, the same way it renders at all regardless of Input).
  const DOT_CELL = DOT_CELLS[dotOrientationFor(useSettings((s) => s.rotateDots))]
  const dotX = (cell: { r: number; c: number }) => 30 + (cell.c - 1) * 60
  const dotY = (cell: { r: number; c: number }) => 28 + (cell.r - 1) * 62
  // The cell's position in words: the centre cell reads "centre"; every other filled
  // cell is edge-row-edge-column, so "row-column" ("top-left", "middle-right", …).
  const posName = (cell: { r: number; c: number }) =>
    cell.r === 2 && cell.c === 2
      ? 'centre'
      : `${['top', 'middle', 'bottom'][cell.r - 1]}-${['left', 'centre', 'right'][cell.c - 1]}`
  const ariaLabel = `Dots layout: ${DAY.map((day, i) => ({ day, cell: DOT_CELL[i] }))
    .sort((a, b) => a.cell.r - b.cell.r || a.cell.c - b.cell.c)
    .map(({ day, cell }) => `${day} ${posName(cell)}`)
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
// `scrollerRef` is the element this screen scrolls: App's one #appScroll container, shared with
// every other screen (round 13). Passed as a REF rather than an element because App fills it on
// mount, so a value read during render would be null on the first pass — and because the
// coordinator reads it at tap time, when "current" is the only honest answer.
export default function GuidePage({
  visible,
  scrollerRef,
}: {
  visible: boolean
  scrollerRef: RefObject<HTMLDivElement | null>
}) {
  const [open, setOpen] = useState<string | null>(null)
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
    if (!visible) {
      cancelScrollWriter()
      return
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelScrollWriter()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelScrollWriter()
    }
  }, [visible, cancelScrollWriter])
  // The toggle coordinator (Q8) — hooked into the single toggle callback, never pointer
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
  const toggle = useCallback(
    (id: string) => {
      cancelScrollWriter()
      const opens = open !== id
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
      setMotionMs(durationMs)
      setOpen(opens ? id : null)
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
      const scroller = scrollerRef.current
      if (!tapped || !scroller || scroller.scrollHeight <= 0) return
      const scrollY = scroller.scrollTop
      const tappedRect = tapped.getBoundingClientRect()
      // --motion-scale is an app-wide token and stays a documentElement read. The SEAT is read off
      // the scroller, because that is where index.css now declares it — and rung 2 of the ladder
      // below, scroll-padding-top, is a non-inherited property that would answer `auto` anywhere
      // else. --seat-top itself is registered inherits:true, so it resolves here whether it is
      // declared on this element or above it.
      const motionScale = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--motion-scale'),
      )
      const scrollerStyle = getComputedStyle(scroller)
      const seatTop = parseFloat(scrollerStyle.getPropertyValue('--seat-top'))
      const target = accordionScrollTarget({
        scrollY,
        // The scroller's own visible height. This is where round 10's caveat about
        // window.innerHeight vs documentElement.clientHeight DIES rather than moves: the question
        // was which of two whole-viewport measures the document scroller meant, and there is no
        // longer a document scroller. clientHeight is the box's content height by definition —
        // including the padding-top that seats the content below the fixed bar, which is inside the
        // box and therefore inside scrollHeight too, so the two agree by construction.
        viewportH: scroller.clientHeight,
        // The guide's READING LINE (index.css): the fixed bar's height plus ONE panel gap, so a
        // tapped panel seated there pushes the bottom edge of the panel above it exactly onto the
        // bar's underside. --seat-top is registered with @property, so on engines that implement
        // @property this read is already a resolved px length. On engines that DON'T — Safari
        // ≤16.3 and Firefox <128, both inside this build's target set, which is exactly why
        // Tailwind emits its own @supports fallback for the same token into the same stylesheet —
        // an unregistered custom property computes to its substituted token stream, i.e. the
        // literal "calc(var(--bar-h) + var(--guide-panel-gap))", which parseFloats to NaN.
        // Defaulting that NaN to 0 would seat every tapped panel at viewport y = 0, UNDER the
        // fixed bar: a worse bug than the one this token exists to fix, and a silent one. So the
        // read walks DOWN a ladder, each rung strictly weaker and strictly safer than the one
        // above, and nothing but the last can reach 0:
        //   1. --seat-top itself, already a resolved px length wherever @property is implemented.
        //   2. scroll-padding-top — the SAME declaration through a standard property, which is
        //      expected to resolve its calc() to an absolute length at computed-value time. That
        //      is the behaviour of every engine we can test, but it is an expectation about the
        //      untestable ones, not a proof, which is why it is not the last rung.
        //   3. --bar-h, a literal px token written by App's syncBarHeight onto <html> (and
        //      defaulted in index.css) — fractional since round 10, which parseFloat handles
        //      exactly as well as a whole number, and it INHERITS down to this element, so this
        //      rung cannot fail on any engine that inherits custom properties. It is the seat minus
        //      one panel gap — a few px shallow, hiding the panel above a hair less completely, and
        //      nothing worse. --guide-panel-gap cannot be added back here: it computes to
        //      calc(.25rem * 2), NaN by the same rule as rung 1.
        // jsdom applies no stylesheets and returns '' for all three, landing on 0 — there the
        // panels still toggle on the shared clock, writer-less.
        seatTop: Number.isFinite(seatTop)
          ? seatTop
          : parseFloat(scrollerStyle.scrollPaddingTop) ||
            parseFloat(scrollerStyle.getPropertyValue('--bar-h')) ||
            0,
        // The height of everything the scroller can scroll through. scrollHeight has no fractional
        // twin to switch to — the spec defines it as a rounded integer and exposes nothing else, so
        // this one read stays as it is. Its error is bounded at half a pixel and lands only in
        // finalMaxScroll, which is itself a clamp. (lib/accordionMotion still calls this field
        // docH; it was named when the document was the scroller and its test pins the name.)
        docH: scroller.scrollHeight,
        // The tapped wrapper's top in the SCROLLER's content space: its viewport y, minus the
        // scroller's own viewport y, plus how far the scroller has already been scrolled. The
        // middle term was structurally 0 while the document scrolled — the document's box starts at
        // the viewport origin by definition — which is why this used to read `rect.top + scrollY`.
        // #appScroll is `absolute inset-0` so it too is at the origin today, but that is a layout
        // choice rather than a definition, and the general form costs one rect read.
        headerDocTop: tappedRect.top - scroller.getBoundingClientRect().top + scrollY,
        closingH,
        // A closing panel above the tapped header pulls it up by its own collapse; the
        // tapped section's own panel sits BELOW its header, so a plain close never does.
        closingAbove:
          closingExpander !== null && closingExpander.getBoundingClientRect().top < tappedRect.top,
        openingH,
      })
      if (target !== null)
        scrollWriterRef.current = startScrollWriter(
          scroller,
          scrollY,
          target,
          durationMs * (Number.isFinite(motionScale) ? motionScale : 1),
        )
    },
    [open, cancelScrollWriter, scrollerRef],
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
    //   • the panel gap as a TOKEN, not a utility step: index.css derives the accordion's reading
    //     line (--seat-top) from the same --guide-panel-gap, so seating a tapped panel one gap
    //     below the fixed bar hides the panel above it exactly. A literal space-y-2 here would be
    //     a second home for that number and the two would drift.
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
          in the background and takes effect the next time you open the app fresh. A short{' '}
          <b>updating screen</b> marks the change — it appears once for each new version, even when
          the switch already finished quietly between visits. Switching back from another app never
          triggers it; the update waits for a fresh open. To ask right now instead, the Settings (⚙)
          panel has a <b>Check for updates</b> link. It really does check: the link reads{' '}
          <b>Checking…</b> while it looks, then answers in the same spot — <b>Up to date</b> if you
          already have the newest version the site is handing out, or <b>No connection</b> if it
          could not reach the internet. The answer stays for a few seconds and the link goes back to
          normal. Only when there genuinely is something new does it install it there and then,
          behind the same updating screen (your saved progress is kept either way). A brand-new
          version can take up to about ten minutes to reach everywhere, so a check in that window
          can still answer <b>Up to date</b> — asking again a little later finds it.
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
          Save Defaults section), and the two can show at once.
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
            Answer options reach a little further than they look. Each one responds across its whole
            rectangle, rounded corners included, and half way into the space beside it — so the gap
            between two options belongs to them, split down the middle, and a tap that lands between
            two buttons goes to the nearer one instead of nowhere. In the seven-dot layout each dot
            answers to its whole square, not just the circle. This is only about where you can
            press: nothing moves, and nothing changes size.
          </li>
          <li>
            The space <i>around</i> the answer grid stays dead on purpose, and so do the two unused
            spots in the seven-dot layout (top-middle and bottom-middle). That is where a press goes
            to be cancelled: slide onto any of them — or onto an option you have already tried — and
            lifting your finger does nothing.
          </li>
          <li>
            On the weekday answer grid you can slide between options: press one, drag to the option
            you want (it highlights as you move, including over an already-answered option), and
            release on it to choose it.
          </li>
          <li>
            The mode selector at the top works this way too — press it and drag down to a mode, then
            release to switch (or just tap to open the menu and tap a mode, as before). Once it's
            open, five things close it: choosing a mode, pressing anywhere outside it, Esc, Tab (the
            same key that opens it — see Keyboard Input), and your device's Back button (described
            below). Starting a scroll by touching the page outside the menu is one of those presses
            outside, so that closes it — but a touch that lands on the menu itself is not, and
            neither is the page moving on its own: it stays put under its button in the bar while
            the page coasts to a stop behind it, and you can open it mid-glide.
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
            the ⚙ panel and its popups, Show Codes, or this guide. Press it again for the next layer
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
            the mode menu, Show Codes or this guide, and the keyboard closes with it instead of
            sitting on top of what you opened. What you typed is <i>kept</i> — the box commits it
            exactly as if you had tapped away from it. <Kbd>Esc</Kbd> is what throws an edit away.
          </li>
          <li>
            The sections of this guide open one at a time — opening a section closes the one before
            it. When a section opens or closes, the page scrolls along with the motion whenever
            that's needed to keep your place: instead of sliding off-screen, the section you tapped
            comes to rest just clear of the bar at the top, with its title fully readable. The last
            section or two are the exception — the page has already run out of room to scroll by
            then, so they settle wherever the bottom of the page allows.
          </li>
          <li>
            The guide holds its place while you're in the app: switch to a mode, play, and come back
            and the same section is still open at the same point on the page. Only a fresh start —
            closing the app and launching it again, reloading it, or a Full Reset — returns it to
            the top with every section closed. Switching to another app and back is not a fresh
            start: that keeps your place, here as everywhere else.
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
            <b>New</b> — load a fresh date. In timer modes, only available after pressing Begin.
          </li>
          <li>
            <b>Begin</b> — timer modes only (Blitz, Flash, MoX). Starts a round or run; the timer
            starts and the date is shown (Flash hides it after the configured duration; MoX hides it
            between solves only when One-by-One is on).
          </li>
          <li>
            <b>Reset</b> — timer modes only. In Blitz, ends the current round and unlocks settings;
            in MoX, ends the current run. Saved bests are preserved either way. Press Reset then
            Begin to start a fresh round/run.
          </li>
          <li>
            <b>Reset Stats</b> — casual modes only (Classic, Flash, Deduction). See below.
          </li>
        </UL>
        <Subhead>Reset Stats (casual modes)</Subhead>
        <p>
          Clears your stats and question history for the current mode (Deduction only resets the
          current sub-type's stats). Details:
        </p>
        <UL>
          <li>
            <b>Two taps to confirm</b> — the first arms it (it turns red and reads "Reset Stats?");
            a second tap within 3 seconds confirms. Tapping anywhere else or waiting cancels.
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
            locked; no stat penalty. You can go back through your entire history in Classic, Flash,
            and Deduction; in Blitz and MoX, through the current round or run.
          </li>
          <li>
            Every history entry shows the correct answer in green; a wrong guess appears as dimmed
            red alongside the green.
          </li>
          <li>
            While browsing back, a small <b>Q#</b> label at the top-right of the date card numbers
            the card you are looking at, and it counts whatever the <b>Score</b> box beside it
            counts. In Classic, Flash and Deduction that score is your lifetime total, so browsing
            back to the card you just answered on a 471/501 shows <b>Q501</b> — the 501st card you
            have ever played, not the first of this sitting. Anything with its own Score box is
            numbered on its own: Deduction's Day, Month and Year each count separately, and in Blitz
            and MoX — where Begin and Reset clear the score — the numbering restarts at Q1 with it.
            Reset Stats likewise re-starts the count along with the score it clears.
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
          Back/Forward:
        </p>
        <UL>
          <li>After a wrong answer: gives you credit with time recorded and adjusts your score.</li>
          <li>After a correct answer: undoes the credit and adjusts your score.</li>
          <li>
            You can also override the most recent past date directly from a fresh, untouched live
            question (any mode) — Override is enabled when the live date hasn't been answered yet,
            and tapping it flips your previous date's right/wrong status.
          </li>
          <li>
            A previously correct date flipped to wrong shows a green-and-red diagonal split:
            green-upper-left (originally correct), red-lower-right (now counted wrong).
          </li>
          <li>You can only override each date once.</li>
          <li>
            Overriding a wrong answer (however you do it) clears any wrong highlights; only the
            correct answer is shown.
          </li>
        </UL>
        <p>Override in the run modes:</p>
        <UL>
          <li>
            <b>Blitz</b> — override past dates after the round ends to adjust your score and saved
            bests. With Allow Mistakes off, overriding a correct answer to wrong during a round ends
            the round, just like a wrong answer; with it on, the round keeps going.
          </li>
          <li>
            <b>MoX</b> — without Allow Mistakes, overriding a correct answer ends the run.
          </li>
          <li>
            In both run modes, if a round/run ended because you answered wrong, revealed, or showed
            codes, Override credits that question and it continues — picking up where it left off
            instead of staying ended.
          </li>
          <li>
            Override is <b>locked</b> when Save Stats is off in the casual modes (Classic, Flash,
            Deduction) — there's nothing to record. In Blitz and MoX it works the same whether Save
            Stats is on or off (the run still tracks internally; it's just not saved).
          </li>
        </UL>
        <p>
          <b>Show Codes</b> — reveals the calculation codes for the current date. Counts as a miss
          only while the date is still unresolved; once you've answered it (right or wrong),
          revealed it, or are browsing back, opening the codes is just a review and changes nothing.
          Per mode:
        </p>
        <UL>
          <li>
            <b>Blitz</b> — opening Show Codes during a round ends the round and records your bests.
          </li>
          <li>
            <b>Flash</b> — freezes the countdown so the date stays on screen while you study.
          </li>
          <li>
            <b>MoX</b> — without Allow Mistakes, opening Show Codes ends the run.
          </li>
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
          PresetSwitcher (its ariaLabel, its options list, the ", amnesic" sr-only sibling); the
          manager = components/PresetManager (every button's accessible name, the delete
          confirmation's two views, the withheld ✕ on a last preset); what a switch actually swaps =
          store/presetControl's PER_PRESET_STORES, all four of them; what a delete actually removes =
          its clearPresetStorage, which is derived from store/presets' PRESET_STORE_KEYS; the screen
          clear = main.tsx's registry subscription calling remountScreens; the live typing cap that
          replaced the old fixed character count (Q6, round 20) = lib/presetNameWidth, measured
          against components/PresetSwitcher's own rendered cell; store/presets' MAX_PRESET_NAME is
          now a separate, more generous backstop for a name this app never watched get typed. */}
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
          <li>every ⚙ setting, theme included;</li>
          <li>saved defaults;</li>
          <li>
            its <b>Amnesic</b> switch — a preset is amnesic or not in its own right, whichever one
            you happen to be on.
          </li>
        </UL>
        <p>
          <b>Only the preset you are on is ever touched.</b> Every setting in the ⚙ menu, every
          default you save, <b>Reset Settings</b>, <b>Full Reset</b>, and each mode&apos;s{' '}
          <b>Reset Stats</b> apply to that preset and to no other. Nothing above is shared between
          presets, and nothing is merged: switching swaps all of it at once, and the preset you left
          is exactly where you left it when you come back.
        </p>
        <p>
          <b>Lookup history is the one thing that is NOT in that list.</b> It is shared by every
          preset — the same list, however many presets you have or whichever one you switch to —
          because a Lookup is a question you asked, not a record of how you did. See{' '}
          <b>Saved Progress</b> below for what that means for Amnesic and for Full Reset.
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
            A preset with <b>Amnesic</b> on (⚙ &rarr; Stats) carries a small <b>A</b> at the right
            of its name in the list, so you can see which ones forget before you switch into one.
          </li>
          <li>
            Switching clears the screens, including a Blitz round or an MoX run in progress — every
            screen has to be re-read from the copy of your stats that is now live.
          </li>
          <li>
            A long name is cut short with an … so the bar can never be pushed wider than the screen.
          </li>
        </UL>
        <Subhead>Making and managing them</Subhead>
        <p>
          ⚙ &rarr; <b>Presets</b>, at the top of the menu, names the preset you are on and opens{' '}
          <b>Manage Presets</b>. Everything you can do to the set of presets is in that one popup:
        </p>
        <UL>
          <li>
            <b>New Preset</b> — adds one at the foot of the list, starting from the{' '}
            <i>factory defaults</i>. It is not a copy of the preset you are on, and it does not
            switch you into it, so making one never disturbs the round you are in. Use the control
            at the top left when you want to go there.
          </li>
          <li>
            <b>Rename</b> — the name in each row is a box; tap it and it is all selected, so you can
            just type. <Kbd>Enter</Kbd> or tapping away keeps the new name, <Kbd>Esc</Kbd> throws it
            away. Typing stops taking new characters once the name is as wide as the control at the
            top left can currently show — that limit moves with the screen, not with a fixed
            character count, so how many letters fit can differ by device; leave one blank and it
            goes back to &quot;Preset 2&quot;, &quot;Preset 3&quot; and so on.
          </li>
          <li>
            <b>Order</b> — drag a row by the handle beside it (the three small bars) to move it, or
            select the handle and press the up/down arrow keys. That order is the order the top-left
            list shows them in, and nothing else: moving a preset changes no stats and no settings.
          </li>
          <li>
            <b>Delete</b> — the ✕ asks first, in the same popup, and names what is about to go. See
            below.
          </li>
          <li>
            A <b>✓</b> marks the preset you are on, and the same <b>A</b> marks the amnesic ones.
          </li>
        </UL>
        <Subhead>Deleting is permanent</Subhead>
        <UL>
          <li>
            Deleting a preset removes <i>everything</i> it holds — its stats and all-time bests, its
            per-mode setup, every ⚙ setting it was on, and its saved defaults. It cannot be undone,
            and no other preset is touched. Your Lookup history is untouched too, for the same
            reason switching presets does not change what Lookup shows: it was never any
            preset&apos;s to hold.
          </li>
          <li>
            You can delete the preset you are currently on. The popup says so, and names the one it
            will open instead — the row below it, or the row above when it was the last. That is a
            switch like any other, so the screens clear with it.
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
            <b>Score</b> — correct first-try answers out of total attempts. In Blitz, only the
            current round. In MoX, correct answers out of total attempts; the run ends once correct
            answers reach the set number.
          </li>
          <li>
            <b>Accuracy</b> — percentage answered correctly on the first try. Shows "—" until your
            first attempt.
          </li>
          <li>
            <b>Streak</b> — your current consecutive correct streak / your best this session.
          </li>
          <li>
            <b>Last / Mean / Median</b> — timing stats from correct answers only. Last = most recent
            correct time; Mean = the arithmetic mean of every correct answer's time, with nothing
            dropped; Median = the middle time (less skewed by outliers). If you cube: this Mean is
            an <i>untrimmed</i> mean, the Mo3 sense of the word, not a trimmed average.
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
            Saved solve times keep a rolling window of the most recent 1000 (older ones roll off so
            saved progress stays small), so after a lot of practice Mean and Median reflect your
            recent 1000 rather than all-time. Within a single visit, every solve still counts.
          </li>
          <li>
            <b>Formatting (WCA speedcubing convention)</b> — single times (Last) are{' '}
            <i>truncated</i> to hundredths (the third decimal is dropped, never rounded); means,
            medians, and bests are <i>rounded</i> to the nearest hundredth. Truncating singles
            prevents fortunate rounding boundaries; rounding aggregates avoids systematic downward
            bias.
          </li>
          <li>
            One question = one attempt. Getting a question wrong then right still counts as one
            attempt, marked correct.
          </li>
          <li>When you set a new best, a small ★ appears next to the value to flag it.</li>
        </UL>
        <Subhead>Reading a stat box</Subhead>
        <p>
          Every stat box uses the same three signals site-wide, in every mode, and each one means
          exactly one thing:
        </p>
        <UL>
          <li>
            <b>A dash ("—")</b> — nothing has been recorded yet, but it will be. Accuracy before
            your first attempt, or a timing stat before your first correct answer. That is the only
            thing it means: a slow solve is shown as a slow time, never as a dash.
          </li>
          <li>
            <b>A blank box</b> — that group is hidden. The label stays so you know what it is.
            Hiding is usually just hiding: Score, Accuracy and Streak keep recording in every mode,
            and so do the timing stats in Blitz and MoX, so tapping brings the up-to-date numbers
            back. The timing stats in Classic, Deduction and Flash are the exception — hiding those
            genuinely stops the clock. &quot;Hiding stats&quot; below covers both cases, including
            what turning timing back on costs.
          </li>
          <li>
            <b>The whole strip dimmed</b> — nothing is being recorded at all. That only happens with
            Save Stats off, and it always dims the entire strip, never a single box.
          </li>
        </UL>
        <p>
          So a blank box and a dashed box are never the same thing: one is a group that is hidden,
          the other is a number that hasn&apos;t happened yet. The two can appear together: with
          Save Stats off, a group you had already hidden stays blank while the rest of the dimmed
          strip shows dashes — your choice is still visible, and still there when Save Stats comes
          back on. (While the strip is dimmed the boxes don&apos;t respond to taps at all.)
        </p>
        <Subhead>Hiding stats (Classic, Deduction, Flash)</Subhead>
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
          revealed, or shown codes, the date stays until you advance. If any questions were answered
          while timing was hidden, a desync would arise on re-enable, so the three timing boxes
          merge into a single "Enable and Reset Stats?" confirmation — tap again within 3 seconds to
          confirm (turn on and full reset), or tap anywhere else to cancel.
        </p>
        <p>
          When Save Stats is off, the whole stats strip dims site-wide (every mode, including MoX)
          and every box that isn't already blank shows "—", because nothing is being recorded. The
          boxes also become non-interactive — toggling timing or scoring is disabled until Save
          Stats is turned back on, which prevents accidental stat desyncs. Turning Save Stats on
          while timing is also on regenerates an unanswered date for a clean start.
        </p>
        <p>
          When timing stats are off, leaving and returning to one of these modes preserves the
          current question exactly as you left it — same date, same answers, codes panel in the same
          state.
        </p>
        <Subhead>The breakdown (Blitz, MoX)</Subhead>
        <p>
          When a MoX run finishes or a Blitz round ends, tap <i>anywhere</i> on the stats strip to
          see that run or round solve by solve. A summary sits at the top — solves, accuracy, mean,
          median, fastest, slowest, and the spread between the fastest and the slowest — over a
          scrolling list of every date you were asked, in order, with its number and its time.
        </p>
        <UL>
          <li>
            <b>The fastest and the slowest are marked.</b> Those are the two a <i>trimmed</i>{' '}
            average would throw away. This app does not trim — every solve counts toward the mean —
            so they are pointed out and then counted like any other.
          </li>
          <li>
            <b>A solve that didn't count is marked too</b> — <i>missed</i> if you picked a wrong
            day, <i>shown</i> if the answer was put on screen for you (Reveal, Show Codes, or a
            Blitz clock running out), or <i>overridden</i> if you took a credit back. A date with a
            dash instead of a time contributed nothing to the mean: a miss, or a correct answer that
            came after a wrong one.
          </li>
          <li>
            <b>The list always adds up to the mean above it.</b> The summary is worked out from the
            rows themselves, not from a second running total, so the two cannot drift apart — and an
            Override on a finished run moves the rows and the mean together.
          </li>
          <li>
            <b>It isn't saved.</b> The breakdown exists for as long as the finished run or round is
            on screen; Reset clears it along with everything else, and nothing about it persists
            between visits.
          </li>
        </UL>
        <Subhead>Hiding stats (Blitz, MoX)</Subhead>
        <p>
          Blitz and MoX hide timing <i>visually only</i>. Because a round's score and a run's mean
          depend on timing, the clock never stops in these modes: tap Last, Mean, or Median to blank
          all three, and the times keep being recorded in the background — tap again and the same
          numbers reappear. There is no pause and no "Enable and Reset Stats?" step, since hiding
          can never cause a desync. Score and Accuracy always stay visible, along with Streak
          wherever the mode shows it — the score is the whole point of these modes. In both modes
          hiding quiets the trio only while play is going: a finished MoX run and an ended Blitz
          round always show their times, and there the three boxes stop toggling — what you are
          looking at is the result, not a control. A tap on the finished strip does something else
          instead: it opens the breakdown of that run or round, solve by solve (see below). Your
          hide setting is not forgotten, only set aside; it applies again the moment the next round
          or run starts.
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
                <span>New / Begin / Reset</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>R</Kbd>
                <span>Reveal</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>O</Kbd>
                <span>Override</span>
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
                <span>Mode selector (toggle)</span>
              </div>
            </div>
          </div>
          <div>
            <SectionLabel className="mb-1.5">Mode Switching</SectionLabel>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Kbd>K</Kbd>
                <span>Classic</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>F</Kbd>
                <span>Flash</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>B</Kbd>
                <span>Blitz</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>A</Kbd>
                <span>MoX</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>D</Kbd>
                <span>Deduction</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>L</Kbd>
                <span>Lookup</span>
              </div>
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
            The answer keys and the Game Actions above are ignored while a popup is open, too —
            whatever is behind a popup is out of reach until you close it, so an answer or an
            Override can't be pressed through one. The Overlays and Mode Switching keys still work:
            a mode letter or <Kbd>H</Kbd> leaves the screen, and any popup belonging to it goes at
            the same moment, while <Kbd>G</Kbd> opens and closes the ⚙ menu with its own popups.
          </li>
          <li>
            <Kbd>Tab</Kbd> is the exception — it toggles the mode selector even from inputs (use{' '}
            <Kbd>Esc</Kbd> or <Kbd>Enter</Kbd> to leave an input first if you'd rather; the next
            note says what each of those does). Tab plus any modifier (Ctrl+Tab, Ctrl+Shift+Tab,
            etc.) passes through to the browser.
          </li>
          <li>
            In every box you can type into — the Year Range boxes, the MoX run length, every time
            readout you tap to type into, and the date box on the Lookup screen — those two keys do
            opposite things: <Kbd>Enter</Kbd> keeps what you typed and leaves the box,{' '}
            <Kbd>Esc</Kbd> throws the typing away and leaves the box. Whatever the box sits inside
            stays open — a second <Kbd>Esc</Kbd> closes that. What <Kbd>Esc</Kbd> puts back is the
            value the setting is really on: for a Year Range box that&apos;s the stored year, for
            the others the value the box held when you started typing.
          </li>
          <li>
            On the Lookup screen, &quot;keeps what you typed&quot; means it runs the lookup:{' '}
            <Kbd>Enter</Kbd> answers the date and lets go of the box, unless it can&apos;t read what
            you typed — then it says so and keeps the box, so you can fix it without reaching for it
            again.
          </li>
          <li>Locked or already-pressed buttons are skipped, just like a click would be.</li>
          <li>
            Inside the ⚙ menu, once you've clicked one option of a setting, the arrow keys move
            along that setting's options and choose each one as you land on it (<Kbd>Home</Kbd> and{' '}
            <Kbd>End</Kbd> jump to its first and last, and the ends wrap around). What counts as one
            setting is the choice, not the row: Date Format is a single five-way choice, so the
            arrows carry straight from the Written row into the Numeric one — and Theme does the
            same across Dark and Light whenever Use System Settings is off, since that's when the
            five themes are one pick. A locked setting ignores the keys. None of these presses reach
            past the menu, so they never step the date behind it.
          </li>
          <li>
            Reset Stats (<Kbd>S</Kbd>) only applies to the casual modes (Classic, Deduction, Flash);
            pressing it in Blitz, MoX, or Lookup is a no-op, since those modes have no separate
            Reset Stats button (their round/run Reset clears in-round/in-run stats; persistent bests
            update only when set).
          </li>
        </UL>
      </GuideSection>
      {/* ACCESSIBILITY (B4) — its own section, deliberately, rather than more bullets under
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
          what carries PresetSwitcher's ", amnesic" sr-only sibling into the bar), plus that
          component's open-state key handler for "the same keys do the same things"; its GAP line = the same
          handler's closed branch ("NO key opens the dropdown from the trigger") together with
          main.tsx's global Tab binding, which resolves modeSelectRef and nothing else — so a
          keyboard genuinely cannot open the preset list, and that is a thing the code does not do
          rather than a thing not yet written about; the named groups = PillGroup's role/aria-label (every
          picker passes a `label`; the Theme block's name follows Use System Settings, which is why
          the wording is "the setting you're changing" and not a fixed list); the four switches +
          both year boxes = their aria-labels in components/SettingsPanel; the gear = its computed
          aria-label in main.tsx; the dots = WeekdayAnswer's per-dot aria-label; the stats strip's
          two words = the sr-only spans StatPanel renders — "Off" beside an `off` cell's value, and
          "Stats are not being saved" at the top of the strip when `dimmed` (C1, round 16; both
          pinned in tests/statBoxSignals.dom). ⚠ THAT BULLET NAMES BOTH ON PURPOSE: the round-16
          review found the dim was the one signal of the three with no non-visual form, while the
          blank had one, and the section may not claim coverage it only gives to two of three. If
          either span goes, the bullet goes with it; the guide's Known-gaps list below is where a
          purely-visual signal belongs instead; the popups =
          SettingsPanel's four focus-on-open effects and the shared trapModalTab; the panel NOT
          taking focus = the absence of any such effect for settingsOpen; the accordions =
          aria-expanded/aria-controls here and in MethodBreakdown; the mode list = CustomSelect's
          open-state key handler; the motion paragraph = a full grep of --motion-scale, which now
          has SIX consumers — index.css's .expander rule, this file's own inline transitionDuration
          + scroll glide, the three `transition:background-color` surface fades, and .boot-d's
          bootPulse — so those are the only things the paragraph may claim, and index.css's own
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
          code does NOT do, checked one at a time: button:focus{outline:none} is global
          (index.css) and .focus-ring has been a no-op since the Tab binding landed; index.html
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
          Wording varies between VoiceOver, TalkBack, NVDA and the rest, and the site hasn&apos;t
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
            and it&apos;s named for the setting you&apos;re changing — Date Format, Input, Theme,
            Leap Year Chance, Jan/Feb Chance on Leap Years, Julian Chance. Landing on an option is
            choosing it; the keys that move within a group are under Keyboard Input above.
          </li>
          <li>
            The six On/Off switches carry their setting&apos;s name — Random Format, Dot Layout, Use
            System Settings, Julian Calendar, Save Stats, Amnesic — rather than reading as six
            identical buttons called &quot;On&quot;. Both Year Range boxes name themselves Earliest
            Year and Latest Year.
          </li>
          <li>
            The ⚙ button says what&apos;s behind it: that a setting has been changed, and that an
            update is waiting, whenever either is true.
          </li>
          <li>
            The two lists in the top bar say what they are set to, not just what they are: the
            preset control reads &quot;Preset&quot; and then the preset you are on, and the mode
            selector reads &quot;Mode&quot; and then the mode you are in — so a closed list still
            tells you where you are. Every preset in the list reads its own name, and a preset that
            forgets reads its name followed by &quot;amnesic&quot;, in the list and in the bar
            alike, so the small <b>A</b> beside it isn&apos;t the only place that fact is said.
          </li>
          <li>
            Inside <b>Manage Presets</b>, each row&apos;s name box is called Preset name — the name
            itself is the box&apos;s contents, so it is read out with it — and the two controls
            beside it name the preset they act on: the reorder handle reads &quot;Reorder Weekend,
            position 2 of 3&quot; (the position updates after every move, so the same name is
            announced again with a new number), and &quot;Delete Weekend&quot;. The <b>✓</b> on the
            row you are on says &quot;Current preset&quot; and the <b>A</b> says
            &quot;Amnesic&quot;, so neither marker is only a shape.
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
            no numbers yet.
          </li>
        </UL>
        <Subhead>Panels and popups</Subhead>
        <UL>
          <li>
            The five ⚙ popups — Save Defaults, the saved-defaults list, the confirmation before
            clearing them, the Changelog, and Manage Presets — are proper dialogs. Opening one puts
            the keyboard inside it, <Kbd>Tab</Kbd> and <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> cycle that
            popup&apos;s own controls and wrap around at the ends rather than wandering into the
            menu beneath, and <Kbd>Esc</Kbd> closes it.
          </li>
          <li>
            Manage Presets asks its delete question <i>in place</i>: the list is replaced by the
            confirmation inside the same popup, rather than a second popup opening on top of the
            first. The keyboard moves to the question when it appears and back to the list when you
            cancel, and <Kbd>Esc</Kbd> and your device&apos;s Back close the whole popup from either
            view. As in every other box in the app, the first <Kbd>Esc</Kbd> belongs to a name you
            are typing in.
          </li>
          <li>
            The ⚙ menu itself is not a dialog — it&apos;s a menu hanging off its button, and it
            doesn&apos;t take the keyboard when it opens. <Kbd>Esc</Kbd> closes it, unless
            you&apos;re typing in one of its boxes, in which case the first <Kbd>Esc</Kbd> belongs
            to the box.
          </li>
          <li>
            Each section header in this guide, and the Show Codes button, states whether it&apos;s
            open and which panel it opens.
          </li>
          <li>
            The mode selector is a list of modes. Once it&apos;s open, ↑ and ↓ move through it,{' '}
            <Kbd>Home</Kbd> and <Kbd>End</Kbd> jump to the ends, <Kbd>Enter</Kbd> chooses, and{' '}
            <Kbd>Esc</Kbd> or <Kbd>Tab</Kbd> closes it. While it&apos;s closed, <Kbd>Tab</Kbd> is
            the only key that opens it.
          </li>
          <li>
            The preset control is the same kind of list, and once it&apos;s open the same keys do
            the same things.
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
            Nothing on the site draws a focus ring, so on a computer there&apos;s no outline showing
            which button the keyboard is on. Inside a ⚙ picker the selection stands in for one —
            landing on an option chooses it, so the option you&apos;re on is the lit one — but
            inside the popups above, <Kbd>Tab</Kbd> moves with nothing drawn to say where it went.
          </li>
          <li>
            The preset list can only be opened by tapping or clicking it. <Kbd>Tab</Kbd> opens the
            mode selector from anywhere in the app, and no key opens this one — not even with the
            control itself selected.
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
            three buttons at the foot of the ⚙ menu, Show Codes, every locked picker and the Amnesic
            switch while Save Stats is off, and — in Manage Presets — <b>✕</b> when only one preset
            is left. The reorder handle beside each row never greys out; it has no end it cannot
            move toward. The rest of the game&apos;s buttons — Reveal, Override, <b>&lt;</b> and
            <b>&gt;</b> — are only dimmed, so they still read as ordinary buttons even when pressing
            one would do nothing.
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
          The ⚙ menu opens on the preset you are in, groups every setting into three categories, and
          keeps the Save Defaults and Reset buttons at the bottom.
        </Lead>
        <UL>
          <li>
            <b>Presets</b> — first, and not a setting: it names the preset you are on, says that
            everything below it belongs to that preset alone, and opens <b>Manage Presets</b> (see{' '}
            <b>Presets</b> in the first section).
          </li>
          <li>
            <b>Display</b> — how dates are shown and how you answer: Date Format (incl. Random
            Format), Input (Buttons / Dots), Dot Layout, and Theme.
          </li>
          <li>
            <b>Dates</b> — which dates get generated: Year Range, Leap Year Chance, Jan/Feb Chance
            on Leap Years, and Julian Calendar (+ Julian Chance).
          </li>
          <li>
            <b>Stats</b> — Save Stats, and Amnesic directly under it.
          </li>
        </UL>
        <p>
          At the foot of the menu, in one block: <b>Save Defaults</b>, <b>Reset Settings</b> and{' '}
          <b>Full Reset</b> (see the Data section), and directly under them the{' '}
          <b>View Saved Defaults</b> and <b>Clear Saved Defaults</b> links — both always there;
          Clear dims and locks until you&apos;ve saved your own defaults, the same way the three
          buttons above it do. Those two sit in the gaps between the three buttons above rather than
          under them. Below the block: your Contact email, then a last line with the Last Updated
          timestamp at the left edge, the <b>Changelog</b> link at the right edge, and{' '}
          <b>Check for updates</b> midway between the two.
        </p>
        <p>
          Each of those three buttons greys out whenever pressing it would do nothing — there is
          nothing to save, nothing to reset, or nothing left to clear. A greyed one really is
          inactive: it does nothing to a tap, a keypress, or a screen reader's press. You can still
          reach it with <Kbd>Tab</Kbd>, and it's marked unavailable rather than left looking like an
          ordinary button; on a computer the pointer shows the not-allowed cursor over it. (See
          Accessibility.)
        </p>
        <p className="text-(--tx-300-70) text-[12px]">
          Settings changes apply when you <b>close</b> the ⚙ menu, not on each adjustment — so
          changing several at once regenerates the date just once (and never restarts your solve
          timer mid-adjustment). The sections below cover each setting and exactly when a change
          regenerates a date or resets a round/run.
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
            In Blitz rounds and MoX runs — active or just ended — a format change resets the
            round/run when you close the ⚙ menu, so the round on screen always matches your
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
        title="Display — Input & Dot Layout"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Answer with labelled weekday buttons, or with the seven-dot logo layout — and turn that
          layout a quarter turn if you like.
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
          The setting applies to the weekday modes (Classic, Flash, Blitz, MoX). In Deduction the
          answers aren't weekdays, so the setting is shown but locked there (it keeps whatever you
          last chose and applies again in the weekday modes).
        </p>
        <Subhead>Which dot is which</Subhead>
        <div className="flex justify-center">
          <DotDiagram />
        </div>
        <p className="text-(--tx-300-70) text-[12px] text-center">
          Sunday sits in the centre. The dots are deliberately unlabelled — their positions follow
          the day-of-week practice movement, so choosing one is the same motion you trace when
          calculating. The diagram above always shows your current Dot Layout.
        </p>
        <Subhead>Dot Layout</Subhead>
        <p>
          <b>Off</b> (default) — the two runs of three weekdays go down the sides: Sat, Fri, Thu
          down the left and Wed, Tue, Mon down the right.
        </p>
        <p>
          <b>On</b> — the same seven dots turned a quarter turn anticlockwise, so those two runs lie
          along the top and bottom instead: Wed, Tue, Mon across the top and Sat, Fri, Thu across
          the bottom.
        </p>
        <p>
          Sunday stays in the centre either way, and the dots keep their tap-and-slide behaviour and
          their keyboard numbers unchanged — only where each one sits on screen moves. Dot Layout is
          locked whenever there are no dots to turn: in Deduction, alongside Input and for the same
          reason, and in every mode while Input is set to Buttons. It keeps whatever you last chose
          — and so does the logo below.
        </p>
        <p>
          <b>The logo turns with it — but only while Dots is your Input.</b> The mark at the top
          left of every screen <i>is</i> this seven-dot layout, so turning Dot Layout on turns that
          mark too, whenever Input is set to Dots. The rest of the time — in Deduction, or in any
          mode while Input is set to Buttons — the mark stays upright, for the same reason Dot
          Layout itself locks there: with no dots anywhere on screen, there is nothing for a turned
          mark to correspond to. What can't follow even when Dots is your Input are the pictures
          your device saved earlier: the home-screen icon, the launch screen and the link preview
          image are fixed image files, so those keep the upright logo whatever you choose here. The
          full-screen launch screen and the <b>Rotate back to portrait</b> screen keep the upright
          mark to match them.
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
            While browsing back, settings-driven regen always preserves your history: the date you
            were viewing and any forward entries are pushed back to history before the live slot is
            regenerated.
          </li>
          <li>
            In Blitz rounds and MoX runs (active or just ended), a range change resets the round/run
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
          is deferred and applies to the next date. In Blitz rounds and MoX runs (active or just
          ended), a chance change resets the round/run when you close the ⚙ menu.
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
          <li>For dates after October 4, 1582, Julian has no effect.</li>
          <li>
            For Julian-eligible dates (October 4, 1582 or earlier), the date stays if you haven't
            wrong-guessed yet — the answer and codes simply update.
          </li>
          <li>
            If you've already wrong-guessed, the date regenerates and is added to your history with
            both your red guess and a green for the day that was correct under the calendar system
            in effect when it was first generated.
          </li>
          <li>
            Each date snapshots its calendar system at generation, so revisiting an earlier question
            via Back shows the highlights and codes correct under the system in effect when that
            date was generated.
          </li>
          <li>
            In Blitz rounds and MoX runs (active or just ended), a Julian toggle resets the
            round/run when you close the ⚙ menu.
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
            In the casual modes (Classic, Deduction, Flash), Override is locked when Save Stats is
            off — there's nothing to record.
          </li>
          <li>
            In the run modes (Blitz, MoX), Override works the same whether Save Stats is on or off,
            so a misclick can never throw away a whole round or run even in practice mode.
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
            <b>Blitz (round-level)</b> — in-round score, accuracy, streak, and Back/Forward all work
            normally regardless of the toggle. Whatever the toggle is when the round ends determines
            whether the round's Best Score and Best Streak update.
          </li>
          <li>
            <b>MoX (run-level)</b> — in-run score, streak, times, and Back/Forward all work normally
            regardless of the toggle. Whatever the toggle is when the run ends determines whether
            Best Mean, Best Median, and Best Streak update.
          </li>
        </UL>
      </GuideSection>
      <GuideSection
        id="amnesic"
        title="Stats — Amnesic"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>
          Off by default. When on, this preset stops writing its stats down — they last for as long
          as the app is open, and are gone once it closes.
        </Lead>
        <p>
          It is a guest mode. Hand the phone over, let someone play, and when the app closes nothing
          they did is kept — while everything <i>you</i> had is still exactly where you left it.
          Nothing is deleted to make that happen: while Amnesic is on, your saved stats are simply
          never written to.
        </p>
        <Subhead>What it forgets</Subhead>
        <UL>
          <li>Score, accuracy, streak, and your solve times.</li>
          <li>
            The question history you browse with Back and Forward, and any round or run on screen.
          </li>
          <li>
            All-time bests — Blitz score and streak, Per Question sudden-death score, and MoX mean
            and median.
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
          <li>The Amnesic switch itself. A preset stays amnesic until you turn it off.</li>
        </UL>
        <p>
          So the split is stats, not setup: a preset stays itself across a close, and only forgets
          how you did.
        </p>
        <Subhead>Lookup history is neither, quite</Subhead>
        <p>
          Lookup history is shared across every preset (see <b>Presets</b> above), so it is not this
          preset&apos;s to forget or to keep. A lookup you make while a preset is amnesic still
          works exactly as normal, but it does not join that shared list — it is held only for the
          rest of this browsing session, the same &quot;never written down&quot; treatment your
          parked stats get, and it never becomes a permanent entry afterwards. Switching to a
          different preset, turning Amnesic off, or coming back later all leave it exactly as gone
          as closing the app does.
        </p>
        <Subhead>Turning it on and off</Subhead>
        <UL>
          <li>
            <b>On</b> — your saved stats are parked, untouched, and the session starts from zero.
          </li>
          <li>
            <b>Off</b> — the session&apos;s stats are discarded, and your saved stats come back
            exactly as they were. The two are never merged: nothing done while Amnesic was on is
            ever added to your real numbers.
          </li>
        </UL>
        <p>
          Either direction clears the screens, including a Blitz round or an MoX run in progress —
          the same discard switching preset makes, and for the same reason: every screen has to be
          re-read from whichever copy of your stats is now live.
        </p>
        <Subhead>Two things it deliberately is not</Subhead>
        <UL>
          <li>
            <b>It is not Save Stats.</b> The switch above decides whether a question counts at all;
            this one decides whether what was counted lasts. They are independent, so you can leave
            Save Stats off inside an amnesic preset for throwaway questions and not even move the
            session&apos;s count. With Save Stats off there is nothing being recorded for Amnesic to
            be about, so this row dims and locks — it keeps its value, and comes back the moment you
            turn Save Stats on.
          </li>
          <li>
            <b>It is not a menu setting.</b> It belongs to the preset, the way its name does, so it
            never lights the ⚙ button&apos;s &quot;modified&quot; line the way a setting would. Save
            Defaults does capture it, silently, alongside the snapshot, and both Reset Settings and
            Full Reset restore it along with everything else they cover — see{' '}
            <b>Save Defaults, Reset Settings, and Full Reset</b> below.
          </li>
        </UL>
        <Subhead>What &quot;closed&quot; honestly means</Subhead>
        <p>
          The stats last for the browsing session, and it is the browser that decides when one ends.
          A refresh or a reload does not end it — come straight back and the session is still going.
          Closing the app does.
        </p>
        <p>
          On a phone there is no way to tell that apart from the inside. An app the system shuts
          down in the background — because you left it a while, or because something else needed the
          memory — looks exactly like one you closed yourself, and takes the session&apos;s stats
          with it either way. That is true on iOS in particular, and no web app can promise
          otherwise, so this one will not: treat an amnesic session as something you could lose at
          any moment, because you can.
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
            <b>⚙ Settings</b> — date format, answer input (Buttons / Dots), dot layout, calendar
            system, year range, the leap / Jan-Feb / Julian chances, Save Stats, and theme.
          </li>
          <li>
            <b>Your saved defaults</b> — the Save Defaults snapshot (next section), which even
            survives Full Reset.
          </li>
          <li>
            <b>Per-mode setup</b> — Flash speed; both Blitz timer lengths, Allow Mistakes, and Per
            Round vs Per Question; MoX run length, Allow Mistakes, and One-by-One; the Deduction
            sub-type; and each mode's show / hide stat toggles.
          </li>
          <li>
            <b>Stats</b> in the casual modes (Classic, Flash, Deduction).
          </li>
          <li>
            <b>All-time bests</b> — Blitz score and streak (kept separately for Per Round and for
            Per Question with Allow Mistakes), Per Question sudden-death score, and MoX mean and
            median.
          </li>
        </UL>
        <p>Saved Mean and Median use a rolling window of your most recent 1000 solves.</p>
        <p>
          <b>Lookup history</b> — the dates you&apos;ve looked up — is saved on this device too, the
          same way and through the same visits, but it is not part of the per-preset list above: it
          is <i>one</i> list, the same one no matter which preset is open, and it survives a preset
          switch and a preset delete alike &mdash; but not a <b>Full Reset</b>, which clears it from
          wherever you press it, exactly because there is only one copy to clear. See <b>Presets</b>{' '}
          above for why, and <b>Stats &mdash; Amnesic</b> for the one thing that changes what it
          does while a preset is amnesic.
        </p>
        <Subhead>Not saved (resets each visit)</Subhead>
        <UL>
          <li>
            Any timed round or run on screen — whether still in progress OR ended but not yet Reset
            — and the current question. The round/run itself is discarded; only a Best it already
            recorded persists.
          </li>
          <li>The current tab — the app always opens to Classic.</li>
        </UL>
        <p>
          There is one exception, and it applies to a whole preset at a time. With <b>Amnesic</b> on
          (⚙ &rarr; Stats), the last two entries in the first list — your stats and your all-time
          bests — are not written to this device at all for that preset. They last as long as the
          app is open and are gone once it closes. Everything else in that list still saves
          normally. Lookup history follows a related but separate rule of its own, because it is not
          this preset&apos;s to begin with — see <b>Stats &mdash; Amnesic</b> above.
        </p>
        <p>
          <b>Full Reset</b> (below) clears everything that is saved for the preset you are on —
          except that preset&apos;s saved defaults, which it restores rather than clears. Every
          other preset is left exactly as it was, with one exception: your <b>Lookup history</b>{' '}
          isn&apos;t any preset&apos;s alone, so it goes too — press Full Reset from any preset and
          the one shared list is gone for all of them. Removing a preset&apos;s saved copy outright
          is <b>Delete</b>, in ⚙ &rarr; Presets &rarr; Manage Presets.
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
          its own settings and its own stats, and none of these buttons can touch them — see{' '}
          <b>Presets</b>.
        </p>
        <Subhead>Save Defaults (left)</Subhead>
        <p>
          Makes the current setup <i>your</i> defaults — from then on, the two Reset buttons restore
          these values instead of the launch ones. One snapshot captures:
        </p>
        <UL>
          <li>
            Every setting in the ⚙ menu (all of Display — Input and Dot Layout included — Dates, and
            Stats).
          </li>
          <li>
            Four values from the mode screens: MoX run length, Flash speed, and both Blitz timers
            (Per Round and Per Question).
          </li>
          <li>
            Whether this preset is <b>Amnesic</b> (⚙ &rarr; Stats) at the moment you save — captured
            silently alongside the rest; it is not shown or editable in this popup, or in{' '}
            <b>View Saved Defaults</b> below.
          </li>
        </UL>
        <p>
          Nothing else from the mode screens is captured — Blitz's Per Round vs Per Question, the
          Deduction sub-type, Allow Mistakes, One-by-One, and the show/hide stat toggles always
          reset to their launch values.
        </p>
        <UL>
          <li>
            Tapping the button opens a confirmation popup where the four mode-screen values can be
            edited before saving — so you can make, say, a different Flash speed your default
            without changing the live one. As on the mode screens, tap the time readout beside any
            of the popup's three sliders to type an exact value; a value you've changed highlights
            in violet. The menu settings are captured exactly as they are. Cancel discards any
            edits.
          </li>
          <li>
            While anything the snapshot covers differs from your defaults, the closed gear (⚙) shows
            a small violet bar along its bottom edge, and the Save Defaults button is active; once
            everything already matches your defaults, the bar disappears and the button dims —
            nothing new to save. A year you have typed but not yet left also lights the bar, even
            though there is nothing to save for it yet — pressing Save Defaults then saves
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
            shows the factory values instead, labelled as such.
          </li>
          <li>
            That popup is also where you edit your defaults directly. Adjust any row — here the run
            length is a tap-to-type readout too, like the timer readouts — and the changed value
            highlights in violet, the Close button becomes Cancel and Save, and a note appears:
            saving there updates only those four values, while every menu setting in the snapshot
            stays exactly as it was. Saving from the factory view creates your saved defaults, with
            the menu settings captured at their launch values.
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
          Restores everything the snapshot covers to your saved defaults — or, if you haven't saved
          any, to the launch defaults. That is the whole ⚙ menu:
        </p>
        <UL>
          <li>Random Format off, Written MDY</li>
          <li>Input on Buttons</li>
          <li>Julian on, Julian Chance Random</li>
          <li>Year range 1–10000</li>
          <li>Leap Year Chance Random, Jan/Feb Chance Random</li>
          <li>Save Stats on</li>
          <li>
            Theme back to Use System Settings, with Dusk on the Dark row and Light on the Light row
          </li>
        </UL>
        <p>
          …plus the same four mode-screen values Save Defaults captures: the MoX run length, the
          Flash speed, and both Blitz timers. That makes Reset Settings the exact mirror of Save
          Defaults — one copies your live setup into your defaults, the other copies your defaults
          back over your live setup — across the very same values the gear's violet bar watches, so
          a single tap clears that bar whatever changed.
        </p>
        <p>
          It also restores whether this preset was <b>Amnesic</b> at the moment you saved your
          defaults, switching it on or off to match — exactly as if you had flipped the{' '}
          <b>Amnesic</b> switch yourself (see <b>Stats &mdash; Amnesic</b> above for what that
          switch does). That means pressing Reset Settings for an unrelated reason, mid-session, can
          move it too: if it turns Amnesic off, whatever the session had recorded is discarded the
          same as always, and if it turns Amnesic on, your saved stats are parked exactly as they
          were the moment before.
        </p>
        <p>
          It still leaves the other mode-screen choices alone: Blitz's Per Round versus Per
          Question, Allow Mistakes, One-by-One, the Deduction sub-type, and the show/hide stat
          toggles all stay exactly as you have them. Your stats and history are untouched too —
          <i>unless</i> the <b>Amnesic</b> restore above actually moves the switch, in which case
          whatever that flip discards or parks (see the paragraph above) is gone the moment you tap,
          not held back until anything closes. Restoring one of the four capturable mode-screen
          values while a Blitz round or an MoX run is going resets that round or run when you close
          the menu, exactly as an ordinary ⚙ panel change does — but an <b>Amnesic</b> flip is not a
          menu value reconciling on close, it is a preset property changing outright, so it (and the
          run or round it can take with it) lands immediately on the tap itself, before the menu is
          ever closed. No confirmation prompt either way — tap to apply. When everything the
          snapshot covers is already at your defaults, the button dims and locks, since tapping it
          would have no effect.
        </p>
        <Subhead>Full Reset (right)</Subhead>
        <p>Restores the preset you are on to its launch state:</p>
        <UL>
          <li>
            Wipes all stats, all-time bests (Blitz and MoX), your <b>Lookup history</b>, and
            in-progress rounds and runs. Your stats and all-time bests are saved on this device, so
            Full Reset clears that saved copy permanently. That is true in a preset with{' '}
            <b>Amnesic</b> on as well: it clears both the session you are in and the saved stats
            waiting behind it, so nothing comes back when you turn Amnesic off again. Amnesic stops
            your play from being recorded; it does not shield anything from a reset you asked for.
            Lookup history is the one thing on this list that isn&apos;t only this preset&apos;s —
            it is shared by every preset (see <b>Presets</b> above), so Full Reset clears it for all
            of them, not just this one.
          </li>
          <li>
            Resets every setting and toggle across all modes — both the ⚙ menu and the per-mode
            toggles. The menu settings and the four Save Defaults values (MoX run length, Flash
            speed, both Blitz timers) restore to <i>your</i> saved defaults; everything else (Per
            Round / Per Question, Deduction sub-types and toggles, Allow Mistakes, One-by-One, the
            show/hide stat toggles) returns to its launch value. The saved defaults themselves
            survive. Full Reset also restores whether the preset was <b>Amnesic</b> to whatever you
            last saved — the same restore <b>Reset Settings</b> makes, above — but it changes
            nothing about the wipe just above: both copies of your stats are already gone by the
            time it happens, whichever way Amnesic ends up afterward.
          </li>
          <li>
            Closes any open overlay (⚙ menu, codes, method breakdown) and switches to Classic. How
            to Play goes back to the top with every section closed, so nothing is left open behind
            you.
          </li>
        </UL>
        <p>
          Requires two taps to confirm: tap once and the button changes to "Confirm?"; tap again to
          fire. Auto-cancels after a few seconds, when you close ⚙, or if you tap any other control.
          When every setting, toggle, stat, best, history entry, and live state in the preset you
          are on is already where Full Reset would put it, the button dims and locks since tapping
          it would have no effect. It never counts anything in another preset, and it never clears
          one — the way to remove a whole preset is <b>Delete</b>, in ⚙ &rarr; Presets.
        </p>
      </GuideSection>
      <Divider label="Modes" />
      <GuideSection
        id="classic"
        title="Classic"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>The main practice mode — no time pressure, answer at your own pace.</Lead>
        <UL>
          <li>Override works after both wrong and correct answers.</li>
          <li>
            Reset Stats clears your stats and question history; when timing stats are hidden and you
            haven't burned the current date, the date is kept.
          </li>
        </UL>
      </GuideSection>
      <GuideSection id="aox" title="MoX" openId={open} onToggle={toggle} durationMs={motionMs}>
        <Lead>
          The mean of your times over a set number of correct solves (2–1000) — every solve counts
          and nothing is trimmed, which is why this mode is Mo(X) and not Ao(X).
        </Lead>
        <p>
          The score shows correct answers out of total attempts; the run ends when correct answers
          reach your target. Press Begin to start a run.
        </p>
        <Subhead>Run options</Subhead>
        <UL>
          <li>
            <b>Allow Mistakes</b> — wrong answers don't end the run but don't count toward your
            score. With it on, Reveal and Show Codes also count as a miss but keep the run going:
            Reveal flashes the answer then automatically moves on; Show Codes opens the codes so you
            can study, then a <b>Next</b> button moves you on (it waits, since you need time to
            read). With One-by-One on, Reveal also waits on a Next button so you can see the answer
            before the next hidden date. With Allow Mistakes off, Reveal or Show Codes ends the run.
          </li>
          <li>
            <b>One-by-One</b> — hides the date between solves. Press Continue to reveal each new
            date.
          </li>
          <li>
            <b>Last / Mean / Med</b> — tap any of these to show or hide all three time stats. Hiding
            is visual only: your times keep recording, the clock never stops, and a finished run
            always shows its result.
          </li>
        </UL>
        <Subhead>Back / Forward and Override</Subhead>
        <UL>
          <li>
            <b>Back / Forward</b> — browse previous dates from the current run without affecting it.
            Press Continue to resume; the date you were viewing and any forward entries are pushed
            back to your run history before a fresh date is generated, so nothing is lost. After a
            run completes, Back and Forward browse all dates from that run; press Reset to start
            fresh.
          </li>
          <li>
            <b>Override</b> — after wrong: gives credit with time recorded, preserves streak. After
            correct: undoes the credit, resets streak, and either ends the run (Allow Mistakes off)
            or advances to a new date (Allow Mistakes on). If a run ended (a wrong answer, a Reveal,
            or a Show Codes with Allow Mistakes off), Override credits that question and the run
            continues where it left off. You can also override past dates while browsing back. If
            overriding on the last question with Allow Mistakes on, a new date is generated to
            complete the mean. One override per question. Override works the same whether Save Stats
            is on or off.
          </li>
        </UL>
        <Subhead>Stats and bests</Subhead>
        <p>
          Stats in MoX always track — the clock never stops. You can blank the timing trio (Last /
          Mean / Median) with a tap while a run is going, but it's visual only, and a completed run
          always shows its result. Best mean and best median are tracked independently — they can
          come from different runs. Beneath each best, the companion metric from the run that set it
          is also shown (e.g. the median from the run that set your best mean). A <i>Same Round</i>{' '}
          or <i>Different Rounds</i> tag tells you whether your best mean and best median came from
          the same exceptional run, or from two different strong ones.
        </p>
        <p>
          Bests stay honest under Override: a finished run's record follows its corrected stats —
          overriding away one of its credited solves (on the last question or while browsing back)
          restores the best that stood before the run, and a correction that changes the run's mean
          or median updates its record to match. The score display freezes when a run ends and only
          resets after pressing Reset. Leaving MoX mid-run resets it; a finished run's summary is
          preserved when you return.
        </p>
        <p>
          Bests are tracked per exact configuration: MoX run length, Allow Mistakes, Date Format (or
          Random Format on its own bucket), Leap Year Chance, Jan/Feb Chance on Leap Years, Julian
          Chance, year range, and Calendar System (Julian on/off). Changing any of these creates a
          separate bucket — your previous bests remain stored and reappear when you switch back to
          that exact config.
        </p>
        <p>
          The small <b>Q#</b> label at the top-right of the date card appears not only while
          back-browsing but also at run end (done/failed), so you can identify which question of the
          run you're viewing in the summary.
        </p>
        <Subhead>Run breakdown</Subhead>
        <p>
          Once a run is finished, tapping anywhere on the stats strip opens the run solve by solve —
          the numbers behind the mean, with the fastest and slowest marked and any solve that didn't
          count called out. It's described in full under Stats. It's available while the finished
          run is on screen, and only when Save Stats is on: with Save Stats off the strip is showing
          dashes, and it won't hand over numbers it is declining to display.
        </p>
      </GuideSection>
      <GuideSection
        id="deduction"
        title="Deduction"
        openId={open}
        onToggle={toggle}
        durationMs={motionMs}
      >
        <Lead>Identify the missing piece of a date given the rest plus the weekday.</Lead>
        <p>
          Choose Day, Month, or Year mode. The displayed date follows your selected Date Format (or
          random format snapshot, if Random Format is on), with a fixed-width underscore placeholder
          where the missing piece would normally appear.
        </p>
        <Subhead>Day</Subhead>
        <p>
          Seven consecutive days are shown, each with a unique day code. The correct day can appear
          in any position. <i>October 1582:</i> days 5–14 don't exist (the Gregorian transition
          skipped them), so the valid days are 1–4 and 15–31. When the window can't fit seven days
          on one side of the gap, it shrinks to four — codes 1, 2, 3, 4 repeat at days 15, 16, 17,
          18, so a five-day window crossing the gap would have a duplicate code.
        </p>
        <Subhead>Month</Subhead>
        <p>
          Seven fixed boxes group months that share the same month code, so tapping any month within
          a box gives the same weekday for that date. Tap the box containing the correct month. The
          boxes are always in the same position. In leap years, January shifts into the Apr/Jul box
          (becoming Jan/Apr/Jul) and February shifts into the Aug box (becoming Feb/Aug); the other
          boxes are unchanged.
        </p>
        <p>
          <i>Year 1582 with Julian on:</i> a special layout applies because the Julian/Gregorian
          transition splits the year — January through September and October 1–4 use Julian (year
          code +1), while October 15+ and November/December use Gregorian (year code −2). October's
          box position depends on the day: for days 1–4 it joins Jan and Nov ("Jan/Oct/Nov"); for
          days 15–31 it joins Jun ("Jun/Oct"); for days 5–14 it's excluded since those dates don't
          exist. The other six boxes are arranged differently from the standard layout — practice
          carefully.
        </p>
        <Subhead>Year</Subhead>
        <p>
          Five consecutive year options. Each has a unique year code, so only the correct year
          matches the displayed weekday. The correct year can appear in any position.{' '}
          <i>With Julian on:</i> when the five-year window would cross October 15, 1582 (the
          Julian/Gregorian boundary), it shrinks to two years — the calendar's 10-day jump produces
          a +5 weekday shift across that boundary that breaks distinctness for any longer window.{' '}
          <i>February 29:</i> only allowed when the window contains at least one leap year
          (Gregorian or Julian as appropriate). Non-leap years still appear as options but trivially
          can't be the answer, since Feb 29 doesn't exist in those years.
        </p>
        <Subhead>Per-mode toggles</Subhead>
        <p>
          These are mode-specific, not in the ⚙ Settings menu, since they only apply to one
          Deduction sub-mode. Year mode adds <i>ab</i> Cross (left of Day/Month/Year) and Jul Cross
          (right); Month mode adds 1582 Only (right).
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
            (the Julian/Gregorian transition). N=2 always. Disabled when the Julian setting is off,
            or when your year range doesn't contain 1582 plus at least one of its neighbors (1581 or
            1583).
          </li>
          <li>
            <b>Both Year toggles on</b> — each puzzle randomly picks (50/50) which constraint to
            enforce. The two can't both be true for the same window. While both are on, two-year
            puzzles are centred in the space the five-year layout uses, so the answer area and the
            buttons below hold still as the two layouts alternate.
          </li>
          <li>
            <b>1582 Only</b> (Month mode) — when on, every puzzle uses year 1582, forcing the
            special split layout described above. Disabled when the Julian setting is off or your
            year range excludes 1582. When the answer's cell groups months from both calendars, Show
            Codes uses slash notation (e.g., 1/-3, Julian/Gregorian) for any value that differs
            across the cell's months; values that are the same across all months collapse to a
            single value.
          </li>
        </UL>
        <p>
          A correct answer briefly pulses the chosen option green, and when the next puzzle keeps
          the same answer layout the pulse carries over onto it. When the layout itself changes
          between puzzles — a two-year window after a five-year one, or October 1582's four-day
          window after a seven-day one — the new layout appears clean, with nothing carried over.
        </p>
        <Subhead>Sub-types and stats</Subhead>
        <p>
          Switch sub-types anytime — progress in each is preserved, including question history.
          Stats are tracked separately for each sub-type, and Back/Forward only walks the current
          sub-type's entries. Reset Stats clears the current sub-type's stats and history only; the
          others are untouched. When timing stats are hidden and you haven't burned the current
          question, the question is kept.
        </p>
      </GuideSection>
      <GuideSection id="flash" title="Flash" openId={open} onToggle={toggle} durationMs={motionMs}>
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
          You can press Reveal or Show Codes — both freeze the countdown (the timer bar and the
          number stop together) and keep the date on screen. Reveal shows the answer and counts a
          miss; Show Codes does the same and also opens the calculation breakdown.
        </p>
      </GuideSection>
      <GuideSection id="blitz" title="Blitz" openId={open} onToggle={toggle} durationMs={motionMs}>
        <Lead>Answer as many dates as possible before time runs out.</Lead>
        <p>Score shows correct answers for the current round only.</p>
        <p>
          Tap Last, Mean, or Median to hide the timing stats. This is visual only — the clock keeps
          running and your times reappear unchanged when you tap again (see Stats). Score and
          Accuracy stay visible, along with Streak wherever the mode shows it. Hiding applies to a
          round in progress: once a round ends, the three time boxes show that round's times and
          stop toggling — a tap on the ended strip opens that round's breakdown instead (see Stats).
          Your hide setting comes back with the next round.
        </p>
        <Subhead>Round options</Subhead>
        <UL>
          <li>
            <b>Allow Mistakes</b> — when on, wrong answers count against accuracy and break your
            streak but don't end the round: in Per Round the countdown just keeps running, and in
            Per Question the current question's clock keeps running while you retry the same date
            (you advance — with a fresh question clock — only by answering correctly). When off, a
            wrong answer ends the round immediately in either sub-mode.
          </li>
          <li>
            <b>Per Round / Per Question</b> — tap to switch. Per Round uses a single countdown for
            the whole round (10s–5m, default 60s). Per Question gives each question its own
            countdown (1s–30s, in half-seconds, default 10s); running out of time ends the round.
            Adjust either with its slider or tap the value to type. The two switches are independent
            — any combination of Per Round / Per Question and Allow Mistakes plays (and keeps its
            own bests).
          </li>
        </UL>
        <Subhead>Ending a round and Override</Subhead>
        <p>
          When the round ends, the correct answer for the current date is highlighted and your bests
          are recorded. A round ends when time runs out — the round countdown in Per Round, or any
          single question's clock in Per Question. It also ends if you give up on the current date
          with Reveal or Show Codes, or — with Allow Mistakes off — on a wrong answer or if you
          override a correct answer to wrong.
        </p>
        <p>
          You can then browse your round's history with Back/Forward and override past dates to
          adjust your score and saved bests. Overriding the question that ended the round — whether
          it ended on a wrong answer, a Reveal, or a Show Codes (in Per Question with Allow
          Mistakes, this includes a round that timed out on a question you'd answered wrong —
          crediting that answer resumes the round with a fresh question clock) — credits it and
          resumes the round: the countdown picks up where it left off (Per Round) or a fresh
          question timer starts on the next date (Per Question), and the round's bests aren't locked
          in until the round ends for real (so a misclick you fix doesn't update your bests).
          Override works the same whether Save Stats is on or off.
        </p>
        <Subhead>Streak and bests</Subhead>
        <UL>
          <li>
            Streak is hidden in Per Question only when Allow Mistakes is off, since there a wrong
            answer ends the round and streak always equals score. With Allow Mistakes on, streak
            works exactly as in Per Round: a wrong answer breaks it, and Best Streak is the highest
            streak the round reached.
          </li>
          <li>
            Best scores are tracked per exact configuration: timer duration, Allow Mistakes, Per
            Round/Per Question, Date Format (or Random Format as its own bucket), Leap Year Chance,
            Jan/Feb Chance on Leap Years, Julian Chance, year range, and Calendar System (Julian
            on/off). Changing any of these creates a separate bucket — your previous bests remain
            stored and reappear when you switch back.
          </li>
          <li>
            Best score and best streak are tracked independently in Per Round and in Per Question
            with Allow Mistakes on; a <i>Same Round</i> or <i>Different Rounds</i> tag tells you
            whether they came from the same exceptional round or two different strong ones. Per
            Question with Allow Mistakes off keeps a single best score (streak would equal it).
          </li>
        </UL>
        <Subhead>Leaving and resetting</Subhead>
        <p>
          Leaving Blitz mid-round abandons it — you return to a fresh, idle Blitz (no hidden
          countdown keeps running while you're away). If you leave after a round ends without
          pressing Reset, the round state (bests, history, final date) is preserved when you return.
          Press Reset to clear your current round, unlock the settings, and start fresh. Changing
          settings while idle resets the current round.
        </p>
      </GuideSection>
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
          <li>Supports years 1–10000.</li>
          <li>
            Show Codes is available for all results and stays open as you browse your history.
          </li>
          <li>
            The answer sits on three fixed lines below the input — the date, then its weekday — and
            always keeps its space, so nothing on the page shifts as answers come and go. With
            nothing to report — before your first lookup, or after Clear — it simply invites you to
            enter a date.
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
            The history panel keeps your 100 most recent lookups: each new one goes on top, and once
            the list is full the oldest drops off the bottom on its own. From the second entry
            onwards the number saved is shown beside the History heading. The panel scrolls within
            its own box whenever the list is taller than the room available.
          </li>
          <li>
            History rows say the same thing in short, so each stays on one line: "J: Sat · G: Wed"
            for a date with two readings, and just the weekday on its own for every other date. Tap
            a row to see it spelled out in full above; the row you tapped is tinted and marked with
            a coloured edge down its left side, so you can always tell which one you are reading.
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
