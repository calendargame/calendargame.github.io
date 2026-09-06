// ─────────────────────────────────────────────────────────────────────────
// answerGrid.ts — the CELL geometry every gap-spaced answer grid shares: the Tailwind col-span
// class a span number wears, and which SIDES of an option are allowed to claim half of the gutter
// beside them (the extended hit areas, sub-group 1B).
//
// WHY THE HIT PADDING EXISTS. An answer button's PRESSABLE shape used to be exactly the rounded
// rectangle it draws, and that threw away two things. Its four CORNERS are inside its box and
// outside its rounded shape — hit-testing honours border-radius — so a finger landing on one fell
// straight through to the panel behind it. And the whole ANSWER_GRID_GAP gutter between two
// options was dead across its full width, though every point in it is NEARER to one of the two
// options than to anything else. Neither loss buys anybody anything, so each answer button now
// wears an invisible rectangular ::after (index.css, `[data-hit-pad]`) that covers its whole box
// and reaches HALF the gutter into every side that actually has a neighbour.
//
// THE RULES, SETTLED BY THE OWNER. This module encodes the third one; the first two are the CSS's.
//   1. A button owns its FULL RECTANGLE. Free — it takes nothing from anyone.
//   2. A gutter between two options splits DOWN THE MIDDLE, unconditionally — ⚠ INCLUDING beside
//      an option that is already answered, or otherwise inert. A live neighbour swallowing a dead
//      one's half was proposed and REJECTED: dead space is a FEATURE, because sliding a press onto
//      it is how you CANCEL that press (lib/pointerGestures' slide-off-to-cancel), and the owner
//      aims for dead buttons deliberately to do exactly that.
//   3. NOTHING reaches past the OUTER edge of the grid. The panel padding around it stays dead for
//      that same cancelling reason, plus it keeps a live hit area clear of the screen edge.
// Rule 3 is why the padding has to be COMPUTED rather than written once as a constant inset: which
// sides of an option are outer depends on where auto-placement actually put it, and that depends on
// the column count and the col-spans — which differ per grid (the weekday grid's 2 columns,
// Deduction Day's 3, Deduction Year's 2/3/6 with spans) and, in Deduction, per puzzle.
// ─────────────────────────────────────────────────────────────────────────

// The Tailwind col-span class for a column span, and the ONLY place a span number becomes a class.
// SPELLED OUT AS LITERALS on purpose: Tailwind v4 emits only the utilities it can SEE in the
// scanned source (index.css's @source lines), so a template `col-span-${span}` scans as nothing and
// ships no CSS at all — the grid would silently lose its spans. Keeping the numbers primary and
// deriving the class from them is what makes the shape a grid RENDERS and the shape
// answerGridHitPad MODELS one decision read twice, instead of two decisions kept in sync by hand.
export const colSpanClass = (span: number): string =>
  span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : ''

// answerGridHitPad(cols, spans) — the `data-hit-pad` value for each option, in DOM order: a
// space-separated subset of 't' 'r' 'b' 'l' naming the sides that may claim half a gutter. index.css
// turns each letter into half an ANSWER_GRID_GAP of ::after overhang on that side; a letter's
// ABSENCE leaves that side flush with the button's own edge (it still reclaims the corners — every
// option gets the attribute, and an empty value is a real opt-in, not a no-op).
//
// It replays CSS grid's own auto-placement: row-major, SPARSE (nothing in the app sets
// grid-auto-flow:dense), the cursor never moves backwards, and an item that doesn't fit in what's
// left of the current row starts the next one. Replaying it is the only way to know an option's row
// and columns without a layout engine — which is precisely what a React render, and jsdom, do not
// have.
//
// A side is padded only when a cell ACROSS that gutter is genuinely OCCUPIED — the owner's rule is
// about the gap between two BUTTONS. An outer edge has no cell beyond it (rule 3), and neither does
// a hole left behind when a wide span wrapped early, so both stay dead. No answer grid has a hole
// today (7 options over 2 columns with the last spanning both; 7 or 4 over 3 columns with the last
// spanning three; 5 over 6 columns as 2+2+2 then 3+3), so this costs nothing today — but phrasing
// the test as "is there a button there?" instead of "am I on the outer edge?" is the honest reading
// of the rule, and it is what keeps a future hole dead instead of half-claimed.
//
// ⚠ A span WIDER than the grid is modelled as an item overflowing to the right; real CSS would
// instead widen the implicit grid to fit it. No caller does that, and the disagreement could only
// ever REMOVE padding (the overflowing side finds no occupied cell), never invent it — so it is
// recorded here rather than defended against with a throw in a render path.
export function answerGridHitPad(cols: number, spans: readonly number[]): string[] {
  const placed: { row: number; from: number; to: number }[] = []
  let row = 1,
    col = 1
  for (const raw of spans) {
    const span = Math.max(1, Math.trunc(raw))
    if (col > 1 && col + span - 1 > cols) {
      row += 1
      col = 1
    }
    placed.push({ row, from: col, to: col + span - 1 })
    col += span
    if (col > cols) {
      row += 1
      col = 1
    }
  }
  const filled = new Set(
    placed.flatMap((p) =>
      Array.from({ length: p.to - p.from + 1 }, (_, k) => `${p.row}:${p.from + k}`),
    ),
  )
  const taken = (r: number, c: number) => filled.has(`${r}:${c}`)
  // Ranged for the block axis (a col-span-2 option faces TWO cells across its top gutter, and one
  // neighbour is enough), single-cell for the inline axis (an option's left/right gutter faces
  // exactly one column). Emitted in CSS inset order so a rendered value reads like the rule it is.
  return placed.map((p) => {
    const anyIn = (r: number) => {
      for (let c = p.from; c <= p.to; c++) if (taken(r, c)) return true
      return false
    }
    const sides: string[] = []
    if (anyIn(p.row - 1)) sides.push('t')
    if (taken(p.row, p.to + 1)) sides.push('r')
    if (anyIn(p.row + 1)) sides.push('b')
    if (taken(p.row, p.from - 1)) sides.push('l')
    return sides.join(' ')
  })
}
