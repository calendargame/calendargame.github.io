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
// BEST_COLUMN_CLASS — the least width of one readout's column (Best Mean beside Best Median, Best
// Score beside Best Streak), which every mode's readouts wear so the second one starts at the same
// place on every screen. 125px, MEASURED FROM THE PAGE COLUMN'S EDGE: the row's inset is taken out
// of it, so the second readout — and the "Same Run" / "Different Runs" tag after it — is exactly
// where it was before the row had an inset, and the tag wraps on no screen it did not wrap on.
export const BEST_COLUMN_CLASS = 'min-w-[calc(125px_-_0.75rem)]'

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
