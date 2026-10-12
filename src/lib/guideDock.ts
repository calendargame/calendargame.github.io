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
//   arrivingShades — never by this rule applied to where the header IS.
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
//     whether or not the page has to glide to bring the section to the line.
//     ★ THE RULE: BOTH STRENGTHS GO FROM WHAT THEY WERE AT THE TAP TO WHAT THEY WILL BE WHERE THE
//     HEADER COMES TO REST, OVER THE CLOCK. Not to what the header's place says on each frame of
//     the way there — which is true on every frame, and the wrong picture on most of them:
//       • A HEADER BEING BROUGHT DOWN TO THE LINE WOULD LOOK PINNED. One tapped while its natural
//         spot was ABOVE the line has been carried down from it by the stick (all the way, when a
//         section above it is folding at the same time), so by place it casts its shadow for the
//         length of the glide that is bringing its section down to meet it, going out as the glide
//         lands. A section being OPENED looking pinned is the one thing these headers must never
//         do. Where it will REST it has nothing under it, so it casts nothing on the way.
//       • THE BAR'S SHARE WOULD GO IN ONE FRAME, OR OVER THE LAST FEW PIXELS. For a header that is
//         ALREADY on the line when it is tapped — every section closed from its docked header and
//         opened again — the place takes the bar's whole share away in the frame of the tap. For
//         one that a long glide, or a tall section folding above it, is bringing in, the header is
//         far from the line until the motion's last few pixels, and the place takes the share away
//         there: on a swap from one docked section to the next (the bar keeping nothing, the old
//         header letting go) the bar's shadow and the page's top fade came fully ON over the fold
//         and went off again in three frames. A section opened from a docked one and brought to
//         the line is a move from one docked header to another: the bar keeps nothing at the
//         start, will keep nothing at the end, and keeps nothing in between.
//     WHERE IT WILL REST is restGeometry: where the header is now, moved by what is still to come —
//     whatever is still folding away above it and what is left of the glide bring it up the page,
//     and what its own panel has yet to open puts its section's foot further down. The caller
//     measures those afresh on every frame, so nothing depends on a plan having been right: a
//     second fold started by a quick second tap, a reader's own scroll (which moves where the
//     header will rest, and so what it will have under it), and a screen turned mid-way are all
//     simply in the numbers.
//       • A HEADER OPENED AGAIN WHILE ITS CLOSE WAS STILL LETTING GO (RELEASING, below) has some of
//         its own shadow left, and the bar only part of its share back. Those are what the arrival
//         starts from: nothing changes on the frame of the second tap.
//       • A READER WHO TAKES THE PAGE OVER MID-GLIDE STOPS THE PAGE, NOT THE ARRIVAL. The header
//         is still on its way down and the panel is still opening, for the rest of the same clock.
//         But the page has stopped short, so where the header will rest has changed — in that one
//         frame. So the arrival sets off again from exactly what is on screen (`from`, `since`),
//         for the new resting place, over what is left of the clock. (Ending the arrival there
//         instead, and answering by place at once, put the header's shadow on and the bar's — and
//         the page's top fade — off in ONE frame.)
//     The header never wears more than the bar has given up, so the two are one shadow's worth
//     between them on every frame. At the end of the clock the header is at rest, and both are
//     exactly what its place says.
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
 * WHERE A HEADER WILL BE AT REST (ARRIVING, above), from where it is now (`g`) and what is still to
 * come: its section has yet to come `comingUpPx` up the page (what is still folding away above it,
 * and what is left of the glide), and its section's foot has yet to go `growingPx` further down
 * (what its own panel has yet to open). The header is put where the stick will hold it: on the line
 * once its natural spot is above it, and never out of the bottom of its own section.
 */
export function restGeometry(
  g: HeaderDockGeometry,
  comingUpPx: number,
  growingPx: number,
): HeaderDockGeometry {
  const naturalTop = g.naturalTop - comingUpPx
  const floorY = g.floorY - comingUpPx + growingPx
  const height = g.headerBottom - g.headerTop
  const headerTop = Math.min(Math.max(naturalTop, g.lineY), floorY - height)
  return { lineY: g.lineY, headerTop, headerBottom: headerTop + height, naturalTop, floorY }
}

export interface Arrival {
  /**
   * What was on screen when this stretch of the arrival began: the header's own strength and the
   * share the bar was keeping. At the tap — or, once a reader has taken the page over mid-glide, at
   * that moment.
   */
  from: DockShades
  /** Where on the clock that was (eased, like `progress`): 0 for the tap. */
  since: number
  /** How far through the motion's clock, eased on its curve: 0 at the tap, 1 as it ends. */
  progress: number
}

/**
 * The two strengths while a section is ARRIVING (above). `rest` is what the header's place will say
 * where it comes to rest (dockShades of restGeometry), worked out this frame. Both go from what
 * they were to that, over the clock — so neither has a step the clock does not have — and the
 * header never wears more than the bar has given up.
 */
export function arrivingShades(arrival: Arrival, rest: DockShades): DockShades {
  const p = Math.min(1, Math.max(0, arrival.progress))
  const done = arrival.since >= 1 ? 1 : Math.max(0, (p - arrival.since) / (1 - arrival.since))
  const barYield = arrival.from.barYield * (1 - done) + rest.barYield * done
  const header = arrival.from.header * (1 - done) + rest.header * done
  return { header: Math.min(header, 1 - barYield), barYield }
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
