// lib/accordionMotion.ts — the pure math of every accordion in the app (round 8).
//
// Kept apart from the component (components/GuidePage.tsx) for the lib/selectionGuard
// reasons: the component file only exports components (the react-refresh rule), and every
// decision here is trivially unit-testable without rendering anything. GuidePage owns the
// DOM reads (rendered heights, rects, the --seat-top / --motion-scale vars) and the rAF
// scroll writer; this module owns what the numbers MEAN: how long a toggle takes, the
// curve the panels and the writer both run, and where the scroller must land.
//
// Round 8 widened it from "the HTP coordinator's math" to the ONE motion law: the
// codes panel (components/MethodBreakdown) now runs the same duration floor and the same
// curve, and its freeze window is derived here rather than hand-synced in a file of its
// own. The scroll math below stays guide-only — the codes panel is the last element in a
// scroll column and moves nothing above itself, so it has nothing to compensate for.

// ── Duration: d(h) = clamp(180ms + 0.14ms/px × h, ACCORDION_MS_FLOOR, 440ms) ─────────
// h = the animated content height in px. The guide's panel heights span an 18.5:1 range,
// far too wide for either one fixed duration (giants blur) or a pure per-px rate (giants
// crawl); the 180ms base + shallow 0.14ms/px slope + [240, 440] clamp compress the felt
// speed to a calm register — small panels never feel snippy (240ms floor: Classic), the
// giants stay under half a second (440ms cap, Material long1 territory: Deduction,
// Save Defaults, Buttons; Julian ≈ 329ms sits mid-slope). Rounded to whole ms: the value
// is stamped into inline styles and test pins, and sub-ms precision is imperceptible.
//
// The FLOOR is the only clamp with consumers outside this curve, so it is the only one
// named: the app's OTHER accordion — the codes panel (components/MethodBreakdown) — runs
// at exactly this duration by passing it as Expander's durationMs, CODES_CLOSE_MS below
// derives its freeze window from it, and index.css carries it as the --expander-ms
// fallback. One number, one home. (Before round 8 the codes panel ran 280ms and the guide's
// short panels 240ms — two hand-tuned literals that happened to be close; the guide's
// formula returns this floor for anything under ~429px, and the codes panel is ~72-97px,
// so the two were only ever going to be the same value. Now they ARE the same value.)
// The 440ms cap has no consumer beyond this formula and stays a literal.
export const ACCORDION_MS_FLOOR = 240
export const accordionMs = (heightPx: number): number =>
  Math.round(Math.min(440, Math.max(ACCORDION_MS_FLOOR, 180 + 0.14 * heightPx)))

// CODES_CLOSE_MS — how long the codes panel holds its FROZEN inputs (date, format,
// cellDates, Julian) after Hide Codes before releasing them to the latest values, so the
// panel's contents cannot change while it is still sliding shut. Derived, not hand-synced:
// the panel's slide IS ACCORDION_MS_FLOOR (it opts in explicitly), plus a 30ms buffer for
// the gap between the CSS transition ending and the timer firing. Owned by
// MethodBreakdownSection, which is the single implementation behind all six codes toggles.
// One caveat the arithmetic hides: under prefers-reduced-motion the slide is INSTANT
// (--motion-scale multiplies the CSS duration to 0s) while this timeout still runs its full
// length. Harmless — the panel is already closed, so the release is invisible either way —
// but the derivation is only tight at --motion-scale: 1.
export const CODES_CLOSE_MS = ACCORDION_MS_FLOOR + 30

// The twin-toggle shared clock: an exclusive-open accordion switch animates TWO panels
// (one closing, one opening) whose travels differ. One duration — d of the LARGER travel
// — applies to both: equal duration plus equal easing keeps the net layout delta a single
// monotonic curve, so the coordinator's scroll math stays exact and nothing wobbles.
// Single toggles pass 0 for the missing side, collapsing to d(h) of the real one.
export const accordionToggleMs = (closingH: number, openingH: number): number =>
  accordionMs(Math.max(closingH, openingH))

// ── Easing: the Material standard curve, cubic-bezier(.2,0,0,1) ──────────────────────
// Decelerate-dominant calm landings. ONE curve everywhere — both panels (.expander in
// index.css must declare this exact string; tests/expander.dom pins the sync), the
// GuideSection chevron, and the coordinator's scroll writer — so the collapse, the
// expansion, and the scroll ride a single coherent motion.
export const ACCORDION_EASE_CSS = 'cubic-bezier(.2,0,0,1)'

// The same curve numerically, for the rAF scroll writer. Control points P1=(0.2,0),
// P2=(0,1) give x(u) = 0.6u − 1.2u² + 1.6u³ and y(u) = 3u² − 2u³; easing evaluates
// y at the u where x(u) = t. x′(u) = 4.8u² − 2.4u + 0.6 has negative discriminant with
// a 0.3 minimum on [0,1], so x is strictly increasing and Newton's method from u = t
// converges safely (eight iterations lands far below any sub-pixel scroll tolerance).
export const accordionEase = (t: number): number => {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let u = t
  for (let i = 0; i < 8; i++) {
    const x = 0.6 * u - 1.2 * u * u + 1.6 * u * u * u - t
    u -= x / (4.8 * u * u - 2.4 * u + 0.6)
    u = Math.min(1, Math.max(0, u))
  }
  return 3 * u * u - 2 * u * u * u
}

// ── Scroll target: where the scroller must land for the toggle to read as ONE motion ─
// ⚠ NOTHING HERE IS ABOUT A DOCUMENT, and three of the field names below say otherwise. They were
// coined in round 7, when the guide released the app's clamps and the DOCUMENT scrolled it; round
// 13 moved it onto App's #appScroll container and NOT ONE LINE of the arithmetic changed, because
// the arithmetic was always about "a scroller" — an offset, a visible height, a content height, a
// target's position in content space. Read scrollY/docH/headerDocTop as scrollTop/scrollHeight/
// content-space-top and the module is exactly what it claims to be. (They keep their names because
// tests/accordionMotion pins them; a rename is a separate, test-touching change.)
// All inputs are pre-computed geometry, fully known at tap time (before any animation). They
// arrive FRACTIONAL — GuidePage measures every one of them with getBoundingClientRect (round 10),
// and docH is the single exception, an integer because the platform offers nothing else:
//   scrollY       the scroller's offset at the tap (may sit negative mid rubber-band)
//   viewportH     the scroller's own clientHeight — the height of the box the reader sees through.
//                 Round 10 argued at length here about window.innerHeight vs
//                 documentElement.clientHeight, because with a document scroller there were two
//                 plausible whole-viewport measures and no definition to choose between them. That
//                 question is GONE, not answered: a scroll box's clientHeight is its visible
//                 content height by definition, it includes the padding-top that seats the content
//                 below the fixed bar, and scrollHeight includes that same padding — so the two
//                 terms of every range below are measured in one consistent frame.
//   seatTop       the reading line: the viewport y a tapped panel's top edge should land on,
//                 = the fixed bar's height PLUS one guide panel gap (--seat-top, registered in
//                 index.css as --bar-h + --guide-panel-gap). The gap is what makes it exact —
//                 seat the tapped panel one gap below the bar and the BOTTOM edge of the panel
//                 above it lands precisely on the bar's underside, out of frame. NOT the bar
//                 alone (that seats the previous panel's bottom a full gap into view) and NOT
//                 bar + fade, which round 8 used and which overshot by fade − gap, leaving a
//                 15.5px sliver of the previous panel showing.
//   docH          the scroller's current scrollHeight — an INTEGER by spec, with no fractional
//                 twin to switch to. Its half-pixel worst case reaches only finalMaxScroll,
//                 which is a clamp, so nothing downstream compounds it.
//   headerDocTop  the tapped section wrapper's current top in the scroller's content space
//   closingH      the closing panel's current RENDERED height (0 when nothing closes;
//                 mid-flight re-toggles pass the interpolated value, keeping the math exact)
//   closingAbove  true when that panel sits above the tapped header, so its collapse
//                 pulls the header up by closingH
//   openingH      the opening panel's remaining travel to its natural height (0 when the
//                 tap only closes; its full body height at rest)
export interface AccordionToggleGeometry {
  scrollY: number
  viewportH: number
  seatTop: number
  docH: number
  headerDocTop: number
  closingH: number
  closingAbove: boolean
  openingH: number
}

// Returns the document-space scrollY the coordinator's writer should glide to, or null
// when the layout change leaves the current scroll position coherent (no writer runs —
// the panels animate in place and the browser holds still; the paired guide-scoped
// overflow-anchor:none rule in index.css guarantees "holds still" on every engine).
//
// Scenario A — a panel OPENS (owner rule): compensate ONLY when the opened panel's start
// (its header) would land above the reading line. The comparison baseline is where the
// browser will have settled AFTER the toggle — scrollY clamped into the final scroll
// range — plus the seat the header must clear. Target: the header seated exactly on the
// reading line. (The final-range clamps on the target are pure defense: A's own inequality
// already bounds it below the settled position.) A returns null when the glide would be
// under a pixel: the target is built from fractional rects and the position it is measured
// against can itself be fractional, so a page already at rest can sit a sliver from its own
// recomputed seat, and running a 240-440ms animation to erase a third of a pixel is visible
// motion for no visible correction. Scenario B has no such epsilon on purpose — there the
// current position is genuinely OUT of the final scroll range, so the browser is going to move
// it whatever we do; the only question is whether the move rides the panels' clock or snaps in
// one frame.
//
// A cannot always DELIVER the seat, and that is a fact about the page, not a bug in the rule:
// tap one of the last section or two and finalMaxScroll is smaller than the seat the header
// wants, so the target clamps short and the panel above stays partly visible. The document
// simply cannot scroll far enough. The only "fix" would be padding the bottom of the guide
// with empty space to buy scroll range, which is visible dead space on every other tap. Do
// not add one.
//
// A's target is CEILED to a whole pixel (round 10), and that is a policy, not a tuned number:
// integers are the only scroll offsets every engine can represent EXACTLY — whatever a platform's
// quantisation grid is (1px, 1/DPR, 1/64px), it contains the integers — so handing over a whole
// number turns the engine's own rounding into a no-op instead of a coin flip the geometry cannot
// see. CEIL rather than round because the two directions do not cost the same: overshooting hides
// a fraction more of a panel nobody is reading, while undershooting reveals the previous panel's
// translucent bottom border (45% alpha in the default theme) as a hairline touching the bar —
// the owner's report that started this. Two placements are load-bearing. INSIDE the clamps, so a
// target the document is too short to reach still resolves to the exact finalMaxScroll (B says
// why that value must not be pushed up). BEFORE the epsilon, which is the honest order: the
// epsilon asks "would the writer travel less than a pixel", and after the ceil that is a question
// about the distance actually travelled. Against a whole-pixel resting position it now fires only
// at zero — correct, since any other integer target is a full pixel away — and it still earns its
// keep at fractional ones (a rubber-band release, a native smooth-scroll landing).
//
// Scenario B — the toggle SHRINKS the document past the current position: the browser
// would clamp scrollY the instant the panel finished, flinging the page in a single
// frame (the captured 744px/150ms clamp-fling). Gliding to the final max-scroll on the
// panels' own clock makes the collapse and the travel one coherent motion. Checked for
// closes AND as the fallback for a net-shrinking switch where A declined.
// B's target is deliberately NOT ceiled. It already IS the far edge of the scroll range, so
// rounding it up aims the writer PAST the end of the document, where the browser's own clamp
// absorbs every frame beyond the edge: the last stretch of the glide would move nothing and the
// motion could read as stalling just before it stops.
export const accordionScrollTarget = (g: AccordionToggleGeometry): number | null => {
  const finalDocH = g.docH - g.closingH + g.openingH
  const finalMaxScroll = Math.max(0, finalDocH - g.viewportH)
  if (g.openingH > 0) {
    const finalHeaderTop = g.headerDocTop - (g.closingAbove ? g.closingH : 0)
    const settledY = Math.min(Math.max(g.scrollY, 0), finalMaxScroll)
    if (finalHeaderTop < settledY + g.seatTop) {
      const target = Math.min(Math.max(Math.ceil(finalHeaderTop - g.seatTop), 0), finalMaxScroll)
      return Math.abs(target - g.scrollY) < 1 ? null : target
    }
  }
  if (g.scrollY > finalMaxScroll) return finalMaxScroll
  return null
}
