// lib/guideDock.ts — ONE SHADOW, UNDER WHICHEVER EDGE THE TEXT IS SLIDING BENEATH.
//
// How to Play has two edges that text can slide under: the fixed top bar's underside, and — while
// a section is open — the underside of that section's header, which docks flush against the bar
// and stays there as the section scrolls (components/GuidePage; index.css's .guide-head is the
// stick itself). A boundary shadow means "content is sliding under this edge", so at any moment
// only ONE of the two may wear it:
//
//   • while the open header is docked against the bar, the BAR'S shadow is off — what is directly
//     under the bar is the header, which is not sliding anywhere — and the HEADER wears the shadow
//     once the section's text is actually under it;
//   • while no header is docked, the bar's shadow is whatever the page's scroll position makes it,
//     exactly as on every other screen, and the header wears none.
//
// This file is that decision and nothing else: pure arithmetic over five numbers read off the
// screen, so the hand-off can be proved for every position without a layout engine (jsdom has
// none). The component measures and writes; it decides nothing.
//
// ── THE THREE DISTANCES ─────────────────────────────────────────────────────────────────────
// All in px, all in viewport coordinates, all read in the same frame:
//
//   depth   how far the stick has carried the header DOWN from its natural spot in its section
//           (headerTop − naturalTop). 0 until the header docks; from then on it is exactly how much
//           of the section has scrolled up under the header.
//   room    how much of the section is still BELOW the header (floorY − headerBottom). A sticky
//           header cannot leave its own section, so when this reaches 0 the section's foot has
//           arrived and starts carrying the header up under the bar with it.
//   offset  how far the header's top is from the bar's underside (|headerTop − lineY|), either way:
//           below it while the header is still on its way up the page, above it while the section's
//           foot is carrying it out.
//
// ── THE TWO STRENGTHS, AND WHY THEY CAN NEVER BOTH BE ON ────────────────────────────────────
//
//   header   = the weaker of ramp(depth) and ramp(room). Text has to be under the header for it to
//              cast a shadow (depth), and there has to be section left below it for the shadow to
//              fall on (room) — it fades out over the section's last stretch rather than vanishing
//              when the foot arrives.
//   barYield = ramp(offset): the fraction of its own shadow the bar keeps. 0 with the header docked
//              flush, back to 1 once the header is a ramp's length away in either direction — so
//              the bar's shadow fades out as an opening section glides up to dock, and fades back
//              in as a finished section slides away under the bar. The caller multiplies the bar's
//              ordinary scroll-driven strength by it.
//
// The ramp is the app's one "near a boundary" distance (--shade-ramp, components/scrollRegion's
// edgeShade), so both shadows speak the language every other boundary shadow speaks.
//
// A header casts a shadow only while it is STUCK (depth > 0 and room > 0), and the stylesheet's
// stick holds a stuck header's top on the line (offset 0), where the bar keeps nothing. A header off
// the line is either not yet docked (depth 0) or being carried out (room 0), and casts nothing. So
// the two are never on together, at any position — and the function ENFORCES that rather than
// trusting it: whenever the header's strength is above 0 the bar's share is 0 outright, so no
// sub-pixel disagreement between two measured rectangles can ever light both.
//   ⚠ ONE HEADER IS STUCK AND NOT ON THE LINE: the one tapped while it stood above the line, for the
//   length of the motion that brings it down (components/GuidePage's startHeaderOffset holds it at a
//   distance of its own, running out to nothing). That is ARRIVING, below, and it is answered by
//   arrivingShades — never by this rule alone, which would put the bar's share out in one frame.
//
// There is also no position with NEITHER while text is under an edge: off the line the bar keeps a
// share of its shadow; on the line, the header's shadow is on whenever text is under the header.
// The one place both are 0 is a header docked with nothing under it yet — a section just opened —
// which is exactly the case that must not look pinned.
//
// ── TWO MOMENTS THE POSITION ALONE GETS WRONG ───────────────────────────────────────────────
// Both follow a tap on a header, and in both the numbers above are true and the picture is not:
//
//   ARRIVING — a section is opened. For the length of its opening (the fold's own clock —
//     components/GuidePage runs the page's glide, the panels, and this on one) the header and the
//     bar answer to arrivingShades, not to the header's place alone. EVERY open is an arrival,
//     whether or not the page has to glide to bring the section to the line:
//       • THE HEADER CASTS NOTHING WHILE THE GLIDE IS CARRYING ITS SECTION TO IT. A header tapped
//         while its natural spot was ABOVE the line is brought down to the line over the glide, and
//         whenever its section's top is above where it is drawn it has been carried down from its
//         natural spot — all the way, when a section above it is folding at the same time (the fold
//         runs ahead of the page, and pulls the section's top up past its header). Then `depth` is
//         above 0 and the rule above would light its shadow for the length of the glide that is
//         bringing the section down to meet it, going out as the glide lands. That is a section
//         being OPENED looking pinned, which is the one thing these headers must never do.
//       • THE BAR GIVES ITS SHARE UP OVER THE WHOLE OPENING (arrivingBarYield): from what it was
//         keeping at the tap to what the header's place says, on the fold's clock — where the
//         place alone would take it away over the last few pixels before the line, or, for a
//         header that is ALREADY on the line when it is tapped, in the frame of the tap. That last
//         one is every section closed from its docked header and opened again, and it has no glide
//         at all: the page is where it should be. (The arrival was once started only with a glide,
//         and there the bar's shadow and the page's top fade went from all to nothing in one frame.)
//       • WITH NO GLIDE THE PAGE IS THE READER'S FROM THE TAP (`takenOverAt` 0), so whatever they
//         scroll under the header while its panel opens comes in over the clock, as below.
//       • A HEADER OPENED AGAIN WHILE ITS CLOSE WAS STILL LETTING GO (RELEASING, below) has some of
//         its own shadow left. The arrival takes that over where it stands (`headerFrom`) and lets
//         it go on out over the clock — the release it interrupts would have — rather than dropping
//         it in the frame of the tap.
//       • A READER WHO TAKES THE PAGE OVER MID-GLIDE STOPS THE PAGE, NOT THE ARRIVAL. The header
//         is still on its way down and the panel is still opening, for the rest of the same clock.
//         The page has stopped short, though, so text really is under the header now — and from
//         that moment its shadow comes IN over what is left of the clock (`takenOverAt`), as the
//         bar's goes on out. (Ending the arrival there instead, and answering by place at once,
//         put the header's shadow on and the bar's — and the page's top fade — off in ONE frame.)
//         The header never takes more than the bar has given up, so the two are one shadow's worth
//         between them on every frame.
//     At the end of the clock the header is on the line and both are exactly what the place says.
//
//   RELEASING — a section is closed, or swapped for another, from its docked header. The moment it
//     is no longer the open section nothing is docked, and by position alone the bar is owed its
//     whole shadow and the header none: the bar's went from nothing to full, and the header's from
//     full to nothing, in ONE frame, while the panel under the header took a third of a second to
//     fold away. So the hand-back is spread over that same fold (releaseShades): the header's
//     shadow goes out as the text it was cast on does, and the bar's share rises to meet whatever
//     the position then says — never above it (the caller takes the smaller of the two).
//     ★ AND ONLY AN OPEN HEADER EVER TAKES THE BAR'S EDGE OVER (the owner's rule). Once the fold is
//     done the header that was closed is page content like any other, wherever it has been left —
//     flush under the bar included, which is where a section closed from its docked header leaves
//     it: the bar's shadow and the page's top fade are drawn over it in full.
import { edgeShade } from '../components/scrollRegion.js'

// A docked header counts as having text under it only past this depth. A section that has just been
// opened is glided to the line and lands on a whole pixel (lib/accordionMotion ceils its target, and
// says why), which can leave the header carried a fraction of a pixel down its section — over the
// first sliver of the panel's own empty top padding, not over text. One pixel absorbs that, so a
// freshly opened section shows no shadow at all, and it is far inside the padding (4px) that sits
// above the first line of text.
export const DOCK_SETTLE_PX = 1

// Within this much of the line the header counts as ON it. The header's rectangle and the bar's are
// two separate fractional measurements of what layout treats as one line; half a pixel is far more
// than they can disagree by and far less than anyone can see.
export const DOCK_LINE_BAND_PX = 0.5

export interface HeaderDockGeometry {
  /** The bar's underside — the line a header docks against. */
  lineY: number
  /** The open header's rectangle, top and bottom. */
  headerTop: number
  headerBottom: number
  /** Where the header's top would be with no stick: its section's top edge, inside the border. */
  naturalTop: number
  /** The lowest the header's bottom can reach: its section's bottom edge, inside the border. */
  floorY: number
}

export interface DockShades {
  /** The open header's own shadow strength, 0…1. */
  header: number
  /** The share of its ordinary shadow the bar keeps, 0…1. */
  barYield: number
}

/** With no header to consider — no section open, or the guide off screen — the bar is unaffected. */
export const NO_DOCK: DockShades = { header: 0, barYield: 1 }

/**
 * The share of its shadow the bar keeps by a header's PLACE alone: none with the header's top on the
 * line, all of it a ramp's length away in either direction. A line that cannot be measured (no bar
 * to read) leaves the bar's shadow exactly as it is.
 */
export function lineShare(g: HeaderDockGeometry, rampPx: number): number {
  const offset = Math.abs(g.headerTop - g.lineY)
  return Number.isFinite(offset) ? edgeShade(offset, DOCK_LINE_BAND_PX, rampPx) : 1
}

export function dockShades(g: HeaderDockGeometry, rampPx: number): DockShades {
  const depth = g.headerTop - g.naturalTop
  const room = g.floorY - g.headerBottom
  const header = Math.min(edgeShade(depth, DOCK_SETTLE_PX, rampPx), edgeShade(room, 0, rampPx))
  return header > 0 ? { header, barYield: 0 } : { header: 0, barYield: lineShare(g, rampPx) }
}

/**
 * The share of its shadow the bar keeps while an opening section is still on its way to the line
 * (ARRIVING, above), `progress` of the way through the motion (0 at the tap, 1 as it ends — the
 * caller eases it on the glide's own curve). `from` is the share the bar was keeping at the tap,
 * `place` the share the header's place allows it now. It falls from the one to the other and is
 * never under `place`: a bar that was keeping LESS than the place allows simply follows the place.
 */
export function arrivingBarYield(from: number, place: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return place + Math.max(0, from - place) * (1 - p)
}

export interface Arrival {
  /** The share of its shadow the bar was keeping at the tap. */
  from: number
  /** The header's own strength at the tap: what a close it interrupts had left on it, else 0. */
  headerFrom: number
  /** How far through the motion's clock, eased on its curve: 0 at the tap, 1 as it ends. */
  progress: number
  /**
   * The `progress` at which a reader took the page over — null while the glide is carrying it, and
   * 0 from the start when there is no glide to carry it.
   */
  takenOverAt: number | null
}

/**
 * The two strengths while a section is ARRIVING (above). `at` is what the open header's place says
 * (dockShades) and `line` what its place alone allows the bar (lineShare), both measured this
 * frame. The bar's share falls from what it was keeping to `line` over the clock. The header casts
 * nothing of its place's while the glide carries its section to it; from the moment a reader has
 * the page, what its place says comes in over the rest of the clock. What it still had at the tap
 * goes out over the whole of it. Whichever of the two is the stronger is what it wears — and never
 * more than the bar has given up.
 */
export function arrivingShades(arrival: Arrival, at: DockShades, line: number): DockShades {
  const barYield = arrivingBarYield(arrival.from, line, arrival.progress)
  const p = Math.min(1, Math.max(0, arrival.progress))
  const settled =
    arrival.takenOverAt === null
      ? 0
      : arrival.takenOverAt >= 1
        ? 1
        : Math.max(0, (p - arrival.takenOverAt) / (1 - arrival.takenOverAt))
  const leaving = arrival.headerFrom * (1 - p)
  const coming = at.header * settled
  return { header: Math.min(Math.max(leaving, coming), 1 - barYield), barYield }
}

/**
 * A header letting go of the shadows it held, `progress` of the way through (0 at the tap, 1 when
 * its panel has finished folding away — the caller eases it on the fold's own curve). `from` is what
 * was on screen at the tap: the header's strength, and the share the bar was keeping. The header's
 * goes to nothing and the bar's share to all of it, in step.
 */
export function releaseShades(from: DockShades, progress: number): DockShades {
  const p = Math.min(1, Math.max(0, progress))
  return { header: from.header * (1 - p), barYield: from.barYield + (1 - from.barYield) * p }
}
