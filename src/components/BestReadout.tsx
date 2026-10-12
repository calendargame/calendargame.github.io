import type { ReactNode } from 'react'

// BestReadout — the row a round mode shows its all-time Bests in, directly under its stats strip:
// Blitz's Best Score / Best Streak (components/BlitzBestRow, and the score-only sudden-death row in
// modes/BlitzMode) and MoX's Best Mean / Best Median (modes/AoxMode). One component because all
// three are the same row — the same place under the strip, the same small muted type.
//
// ★ ONLY components/StatPanel RENDERS IT (a mode hands the strip its readouts as `bests`), because
// the question it has to answer is answered for the strip and the Bests TOGETHER:
// WILL THESE BESTS BE KEPT? Under Amnesic: Full they will not — they are the session's, gone when
// the app is closed — so the row is inside the dashed frame (index.css's .session-only) that marks
// whatever on the page is temporary, and says so in words for a screen reader (`sessionOnly`).
// Under Off they are the saved ones; under Stats Only they are the saved ones too, read from and
// written to the permanent copy (store/amnesic) — so on both of those the row is outside any frame,
// and that difference from the stats strip above it (framed on Stats Only AND Full) is exactly how
// the two kinds of Amnesic are told apart at a glance.
// `framed` is the rarer half: the row draws the frame ITSELF only when it is the one temporary thing
// there (Full with Save Stats off — the strip is dimmed and holds no numbers to mark). When the
// strip is temporary too, ONE frame goes round both, and StatPanel's group draws it.
// ⚠ IT DOES NOT FOLLOW SAVE STATS, unlike the strip's dim. With Save Stats off no NEW Best is
// recorded, but the Bests shown are still real records, and under Full they are still the
// session's — so the frame still tells the truth about what is on screen.
//
// ⚠ THE ROW IS THE SAME SIZE AND IN THE SAME PLACE IN EVERY ONE OF THOSE STATES — the padding below
// is there always, framed or not, so that turning Amnesic on or off moves nothing:
//   • px-3 — the frame's line is the page column's edge (it is the strip's edge, and never wider),
//     so the text has to start inside it, clear of the dashes and of the frame's round corner.
//   • mt-1.5 + py-1.5 — the readouts sit .75rem under the strip, where they always did; the row's
//     own box starts half-way down that gap and ends .375rem under its text, so a frame round the
//     row alone clears the strip above it, and a frame round both closes just under the text and
//     leaves the row beneath its full gap.
//   • rounded-2xl — the strip's radius, the one radius the frame has, for when the row wears it.
//
// ── BestColumn — ONE READOUT'S COLUMN (Best Mean beside Best Median, Best Score beside Best Streak),
// which every mode's readouts are drawn in, so the row wraps where it always did.
//
// ★ THE ROW'S INSET MUST NOT COST THE TAG ITS PLACE ON THE LINE. The readouts sit in a wrapping row
// with the "Same Run" / "Different Runs" tag at its far end (BestLine, below), and the tag is left
// out on a screen too narrow for all three. The inset above takes .75rem off each end of that
// line. Taking it out of the columns' least width (125px less the inset, as this once did) only
// gave it back while a readout was SHORTER than that — a time of a minute or more, or one with its
// ★, is not, and the tag then lost its place on screens that had always had room for it.
// So the line is measured exactly as it was before there was an inset, whatever the readouts say:
//   • a column has the least width it always had (BEST_COLUMN_FLOOR, below), and hands the next
//     thing on the line .75rem of its own width (-mr-3) — two columns, the two ends' inset, given
//     back in full;
//   • and a SLACK follows each column: nothing wide, growing to that same .75rem (max-w-3) whenever
//     the line has it to spare, which puts back exactly the space the column gave up. (Its -ml-4
//     cancels the row gap in front of it, so it adds nothing to the line itself.)
// With room, then, the readouts stand a full gap apart, .75rem in from the frame at both ends. On
// a screen with none to spare they close up by that much rather than push the tag off the line —
// the room they had before the inset, used the same way. And the tag has a place on the line at
// every width it would have had one with no inset, no narrower and no wider.
// ⚠ THREE NUMBERS ARE ONE: the row's px-3, the column's -mr-3, and the slack's max-w-3 — and the
// slack's -ml-4 is the readouts' gap-4. tests/sessionOnlyOutline.dom reads them off the page and
// holds them together.
// ★ THE LEAST WIDTH IS WRITTEN AGAINST THE ROOT FONT, NOT IN PIXELS: 125px at the 16.458px root of
// a 390×844 phone, which is where that number was tuned (the root is 1.95vh there — index.css's
// html rule), and the same share of the line everywhere else. Everything a column HOLDS is
// rem-sized, so it shrinks with the root; a flat 125px did not. At the 12px root of a short screen
// (every phone on its side, a 320×568 one upright) the columns held 9px text in the room 12px text
// needs, and the tag, which gets what is left of the line, had no place at ANY width — with half
// the line standing empty. tests/textSizeGuard fails the suite on a box width written in pixels.
const BEST_COLUMN_FLOOR = 'min-w-[calc(125rem/16.458)]'
const BEST_COLUMN_CLASS = `${BEST_COLUMN_FLOOR} -mr-3`
const BEST_SLACK_CLASS = '-ml-4 grow shrink-0 basis-0 max-w-3'
export function BestColumn({ children }: { children: ReactNode }) {
  return (
    <>
      <div className={BEST_COLUMN_CLASS}>{children}</div>
      <span aria-hidden="true" className={BEST_SLACK_CLASS} />
    </>
  )
}

// ── BestLine — THE READOUTS' LINE, AND THE TAG AT THE END OF IT ("Same Run" / "Different Runs" in
// MoX, "Same Round" / "Different Rounds" in Blitz: did one run set both Bests, or two?).
//
// ★ THE TAG IS SHOWN FOR BOTH WORDINGS OR FOR NEITHER, AND IT NEVER TAKES A LINE OF ITS OWN (the
// owner's rule: "if 'Different Runs' would get cut off or overlap with anything then both go"). It
// used to drop under the readouts on a narrow phone, making the row a line taller — and the
// shorter wording stayed up on screens where the longer one dropped, so a new Best could move it.
// Both halves are true BY LAYOUT here; nothing is measured, and no script decides:
//   • THE TAG'S PLACE IS ALWAYS THE LONGER WORDING'S WIDTH. The stylesheet draws `longest` in the
//     place, invisible and no taller than nothing (the ::before, from data-longest — generated
//     content, so the page's text and what a screen reader hears hold the tag once). The words that
//     ARE showing sit over it at its far end. Whether there is room is therefore one question with
//     one answer for the pair, and the readouts stand in the same spot whichever wording is up.
//   • A PLACE WITH NO ROOM ON THE READOUTS' LINE GOES TO A LINE THAT HAS NO HEIGHT. The line wraps,
//     as it always did, but the place's own height is nothing (the sizer is h-0, the words are out
//     of the flow) and there is no gap ACROSS lines here (gap-x only) — so the wrapped line adds
//     nothing to the row. The place is as tall as the line it is on (self-stretch) and cuts what is
//     above or below itself (overflow-y-clip): beside the readouts that is their line, and the words
//     show whole; on a line of its own it is nothing, and they are not drawn. Never cut part-way —
//     the two cases are the only two — and never over a readout, because a place that is on the
//     readouts' line is beside them, the line's full gap away.
//   • THE READOUTS ARE ONE ITEM ON THAT LINE, and keep their own wrapping inside it (a pair of very
//     long times still goes to two lines, a full gap apart). The item takes whatever the line has
//     left — all of it once the tag has gone, so the readouts spread out again — and is never cut
//     for the tag's sake: the line is asked for the readouts at their full width first.
// ⚠ THE WORDS STAY ON THE PAGE WHEN THEY ARE NOT DRAWN — clipped, not removed — because which run
// set which Best is as true on a narrow phone as on a wide one, and a screen reader says it. Nothing
// here takes the keyboard, so there is no invisible stop.
// tests/bestTag.dom holds the construction together; the widths were measured in a browser.
const BEST_TAG_PLACE_CLASS =
  'relative self-stretch shrink-0 overflow-y-clip whitespace-nowrap before:content-[attr(data-longest)] before:invisible before:block before:h-0'
export interface BestTag {
  /** The wording to show. */
  wording: string
  /** The longer wording of its pair — the room the tag is given, whichever is showing. */
  longest: string
}
export function BestLine({
  children,
  tag = null,
}: {
  children: ReactNode
  /** The tag at the end of the line — null (or left out) while there is nothing to compare. */
  tag?: BestTag | null
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-4">
      <div className="flex flex-wrap items-start gap-4 grow min-w-0">{children}</div>
      {tag && (
        <span data-longest={tag.longest} className={BEST_TAG_PLACE_CLASS}>
          <span className="absolute top-0 right-0">{tag.wording}</span>
        </span>
      )}
    </div>
  )
}

export default function BestReadout({
  children,
  sessionOnly,
  framed,
}: {
  children: ReactNode
  sessionOnly: boolean
  framed: boolean
}) {
  return (
    <div
      className={`mt-1.5 px-3 py-1.5 rounded-2xl text-xs text-(--tx-300-60) ${framed ? 'session-only' : ''}`}
    >
      {/* `sr-only` is positioned out of flow, so the word costs no layout. First, so it is heard
          before the readouts it qualifies. */}
      {sessionOnly && <span className="sr-only">Bests are for this session only</span>}
      {children}
    </div>
  )
}
