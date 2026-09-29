// lib/presetReorder.ts — the PURE decision logic behind dragging a preset row into a new position
// (components/PresetManager's reorder handle, Q7 round 20, replacing the ↑/↓ buttons). Split from
// the DOM/pointer wiring for the same reason lib/presetNameWidth splits its measurement from its
// decision: jsdom has no layout engine (getBoundingClientRect reports 0 for every element), so any
// claim about "which slot is the pointer over right now" has to be provably correct against
// FABRICATED numbers, independent of a real render. The DOM half — reading each row's real
// position via one getBoundingClientRect per row, writing the live transform, and calling
// store/presetControl's movePreset — lives in the component; this file owns only the arithmetic.
//
// ── THE MODEL, AND WHY IT COMMITS AT THE DROP RATHER THAN LIVE, CROSSING BY CROSSING ────────────
//
// A drag never rewrites the registry while it is in flight. The row list stays in its PRE-drag
// order for the whole gesture; what moves is only the DRAGGED row's own on-screen position (glued
// to the pointer via a transform) and, for every row between its start slot and wherever it is
// hovering now, a one-row-height nudge that previews where it will land (previewShift below).
// Nothing is written to the store until the finger lifts, at which point stepsToReorder turns
// "started at index A, released over index B" into the exact sequence of ±1 movePreset calls the
// KEYBOARD path already makes, one adjacent swap at a time — a splice-style move and a chain of
// adjacent swaps land on the identical final order (every element strictly between A and B shifts
// by exactly one slot, the moved element lands at B), so no new, position-based primitive is needed
// in store/presetControl.ts for this either: dragging and the arrow keys both ultimately do nothing
// but call the same bounds-checked ±1 swap.
//
// ⚠ THE LIVE, CROSSING-BY-CROSSING ALTERNATIVE WAS CONSIDERED AND DROPPED, and it is a legitimate
// design (Trello, Notion and iOS Reminders all do it that way) — the reason against it here is
// implementation risk, not correctness. It couples two things that are each simple alone and
// treacherous together: the dragged row's on-screen position (which must track the pointer exactly,
// every frame, or the drag feels broken) and its DOM-FLOW position (which would keep moving out
// from under it every time a live store write reordered the list mid-gesture) — keeping the two in
// agreement needs the transform to UN-DO the flow move on every single swap, and that correction is
// exactly the kind of arithmetic that is easy to get a sign wrong in, easy to pass in a Chromium
// preview with the wrong sign (the row would drift rather than glue, which reads as "a bit floaty"
// rather than "broken" on a mouse), and impossible to verify here at all. Committing once, at the
// finger lift, removes the feedback loop entirely: the dragged row's transform is always just "how
// far the pointer has moved since the grab," full stop, and the preview nudge on every OTHER row is
// a pure function of where the pointer is now — nothing here ever has to reconcile itself against a
// store write that already happened underneath it mid-gesture. The visible result during the drag
// is the same live "cards shifting to make room" feel a crossing-by-crossing design gives; only the
// moment the REGISTRY itself changes is different (once, at release, instead of many times during).

/**
 * Which slot the dragged row's current CENTER falls into, given the vertical centers every row
 * occupied at the moment the drag started — ascending, top to bottom, one entry per row in its
 * PRE-drag order (index i is where the row that started at position i was centered). Any one
 * coordinate space will do so long as `centerY` is in the same one — the caller uses the list's
 * scrollable CONTENT (see clampDragCenter).
 * Returns the index of the first slot the dragged row's center has REACHED (at-or-before it);
 * once it has passed every one of them, the last index (moving it there needs nothing to compare
 * past the final slot).
 *
 * ⚠⚠ THE COMPARISON IS `<=`, NOT `<`, AND THAT ONE CHARACTER IS LOAD-BEARING. The array always
 * contains the DRAGGED row's own starting center at `slotMidpoints[startIndex]` — there is no
 * other way for the caller to supply "every row's" centers, since this function has no notion of
 * which index is "self". A strict `<` makes a dragged row's OWN resting center compare as
 * "already passed" the instant `centerY` is not strictly less than it — true not only while the
 * pointer sits dead still (centerY === its own start center exactly) but for ANY reading at or
 * past it, so a completely stationary press (or a single no-op pointermove reporting the same Y,
 * which real touch hardware does report on a pressure change with zero spatial movement) already
 * resolves one slot past where the drag began. Released there, stepsToReorder swaps two presets
 * that nothing asked to move. `<=` closes exactly that gap: landing EXACTLY on your own center
 * counts as still being there (index unchanged), and only a genuine reading STRICTLY beyond a
 * slot's center counts as having passed it — for every slot, your own start slot included, with
 * no startIndex parameter needed to special-case it. Proved as the load-bearing invariant in
 * tests/presetReorder.test.js: `targetIndexForCenter(slotMidpoints[k], slotMidpoints) === k` for
 * every k, not only the last one (which passed even under the old `<`, by the fallback below —
 * the exact reason the bug went unnoticed until every index was checked, not only the edges).
 */
export function targetIndexForCenter(centerY: number, slotMidpoints: readonly number[]): number {
  for (let i = 0; i < slotMidpoints.length; i++) {
    if (centerY <= slotMidpoints[i]) return i
  }
  return slotMidpoints.length - 1
}

/**
 * The sequence of ±1 deltas that carries a preset from `fromIndex` to `toIndex` — one entry per
 * ADJACENT swap, in the order they must be applied. Feed each entry straight to
 * store/presetControl's movePreset: this is exactly the sequence of calls the old ↑/↓ buttons made
 * one press at a time, just computed all at once from where the finger let go. Empty when nothing
 * moved (a drag released back over its own start slot, or a no-op keyboard press at a list end).
 */
export function stepsToReorder(fromIndex: number, toIndex: number): (1 | -1)[] {
  const steps: (1 | -1)[] = []
  const step: 1 | -1 = toIndex > fromIndex ? 1 : -1
  for (let i = fromIndex; i !== toIndex; i += step) steps.push(step)
  return steps
}

/**
 * The live "make room" nudge for the row at `index` (never called for the dragged row itself, which
 * gets its own pointer-glued transform) — 0px while it sits outside the span the drag currently
 * covers, ±`rowHeight` while it is inside it: every row strictly between the drag's start slot and
 * its current preview target shifts one row toward the gap the dragged row left, exactly as far as
 * it will actually move once stepsToReorder's swaps land for real at the drop.
 */
export function previewShift(
  index: number,
  startIndex: number,
  previewIndex: number,
  rowHeight: number,
): number {
  if (previewIndex > startIndex && index > startIndex && index <= previewIndex) return -rowHeight
  if (previewIndex < startIndex && index < startIndex && index >= previewIndex) return rowHeight
  return 0
}

/**
 * The (near-enough) uniform row height implied by a set of slot midpoints, for previewShift's
 * nudge — the average spacing across the whole list rather than just the first pair, so one row
 * that happened to lay out a pixel or two taller than its neighbours (sub-pixel rounding; every row
 * in this list shares the same markup and classes, so real height differences are not expected)
 * does not throw off every other row's preview by that same pixel or two. 0 for a one-row list,
 * where there is no neighbour to measure against and nothing a drag could do anyway.
 */
export function averageRowHeight(slotMidpoints: readonly number[]): number {
  const n = slotMidpoints.length
  return n > 1 ? (slotMidpoints[n - 1] - slotMidpoints[0]) / (n - 1) : 0
}

/**
 * Where the dragged row's CENTER may actually be drawn, given where the pointer would put it
 * (`centerY`) — Q7, round 23, the fix for a dragged row that escaped the list. Every number is in
 * the list's own CONTENT coordinates (0 = the top of the scrollable content, not of the screen),
 * the same space `slotMidpoints` is captured in.
 *
 * Two bounds, applied in this order:
 *   1. THE LIST'S OWN SLOTS. A row can only ever land between the first slot and the last, so there
 *      is nothing for it to be dragged toward beyond them — and drawing it there is exactly the bug
 *      the owner photographed: the row sliding up over the Presets popup's description text, or
 *      down past the list's foot. Clamping the CENTER to the first/last slot's center keeps the row
 *      inside the band the list itself occupies.
 *   2. THE PART OF THE LIST THAT IS ON SCREEN (`visibleTop`/`visibleBottom`, i.e. scrollTop and
 *      scrollTop + clientHeight). Unlimited presets (Q8) make a list taller than its scroll region
 *      the ordinary case, and a row dragged past the region's edge would be clipped out of sight
 *      while it was still in the player's hand. So it stops, whole, at the edge — `halfRow` in from
 *      it — and the edge auto-scroll (autoScrollDirection below) brings the rest of the list to it,
 *      the way iOS's own reorder lists behave.
 *      ⚠ SKIPPED WHEN THE REGION CANNOT HOLD ONE WHOLE ROW (visibleBottom − visibleTop < 2·halfRow),
 *      where "fully visible" has no answer at all. No real layout of this card gets there (the list
 *      is at least one row tall by construction); it is the honest answer rather than an inverted
 *      range, and it is also what a layout-free test environment reports (every size 0).
 * The slot bound wins wherever the two disagree: it is the one that is about the list's meaning.
 */
export function clampDragCenter(
  centerY: number,
  slotMidpoints: readonly number[],
  visibleTop: number,
  visibleBottom: number,
  halfRow: number,
): number {
  const first = slotMidpoints[0] ?? centerY
  const last = slotMidpoints[slotMidpoints.length - 1] ?? centerY
  let y = centerY
  if (visibleBottom - visibleTop >= 2 * halfRow) {
    y = Math.min(Math.max(y, visibleTop + halfRow), visibleBottom - halfRow)
  }
  return Math.min(Math.max(y, first), last)
}

/**
 * Which way (if any) a drag should auto-scroll the list this frame: −1 up, 1 down, 0 not at all.
 * `pointerY`/`startY` are the pointer's current and starting VIEWPORT y; `inBand` is lib/
 * pointerGestures' bandDirection for the list's own rect — the SAME edge band and the same speed
 * curve the ⚙ panel's press-drag auto-scroll uses, so the two scrolling drags in this app feel alike.
 *
 * ★ A BAND ONLY COUNTS IN THE DIRECTION THE FINGER HAS TRAVELLED. The band is 56px deep, which on a
 * phone is well over a row: grab the TOP visible row and your finger is already inside the top band
 * before it has moved at all. Honouring the band on its own would start scrolling the list upward
 * the instant you pressed — the list sliding away under a row you meant to drag DOWN. So the top
 * band engages only once the pointer is above where it started, and the bottom band only once it is
 * below.
 */
export function autoScrollDirection(
  pointerY: number,
  startY: number,
  inBand: -1 | 0 | 1,
): -1 | 0 | 1 {
  if (inBand < 0 && pointerY < startY) return -1
  if (inBand > 0 && pointerY > startY) return 1
  return 0
}
