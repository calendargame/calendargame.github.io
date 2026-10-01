// presetReorder — the PURE arithmetic behind PresetManager's drag handle (round 20).
//
// Exercised here against FABRICATED numbers, no jsdom at all, for the exact reason the file's own
// header comment gives: jsdom has no layout engine, so "which slot is the pointer over right now"
// has to be provably correct independent of any real render. The DOM half — reading real rects,
// writing the live transform, calling movePreset — lives in components/PresetManager and is
// covered in tests/presetManager.dom.test.jsx instead.
import { describe, it, expect } from 'vitest'
import {
  targetIndexForCenter,
  stepsToReorder,
  previewShift,
  averageRowHeight,
  clampDragCenter,
  edgeFadeInset,
  autoScrollDirection,
} from '../src/lib/presetReorder.js'

describe('targetIndexForCenter(centerY, slotMidpoints)', () => {
  // Three evenly-spaced rows, centers at 50 / 150 / 250 — matches a 100px row height.
  const midpoints = [50, 150, 250]

  // ★★ THE LOAD-BEARING INVARIANT, and the one this file exists to prove first: a drag that has
  // not moved AT ALL — centerY sitting exactly at the dragged row's OWN starting center — must
  // resolve to that SAME index, for every row, not only the one at the end. This is the bug the
  // function's own header comment now argues in full: a `<` comparison here made a completely
  // stationary press already preview a swap for every row except the last (the last one alone
  // passed by accident, via the fallback return, which is exactly why it went unnoticed until
  // every index — not just the edges — was checked here).
  it('AT REST — landing exactly on a slot`s own center resolves to that SAME index, for every slot', () => {
    expect(targetIndexForCenter(50, midpoints)).toBe(0)
    expect(targetIndexForCenter(150, midpoints)).toBe(1)
    expect(targetIndexForCenter(250, midpoints)).toBe(2)
  })

  it('resolves to slot 0 when the center sits before the first midpoint', () => {
    expect(targetIndexForCenter(-1000, midpoints)).toBe(0)
    expect(targetIndexForCenter(0, midpoints)).toBe(0)
  })

  it('resolves to the slot whose midpoint the center has not yet reached', () => {
    // Strictly between two midpoints: still counts as "not yet reached" the far one.
    expect(targetIndexForCenter(60, midpoints)).toBe(1)
    expect(targetIndexForCenter(149, midpoints)).toBe(1)
  })

  it('is INCLUSIVE at a midpoint — landing exactly on one counts as having reached (arrived at) it', () => {
    // centerY <= slotMidpoints[i] is the comparison, so centerY===midpoints[i] itself satisfies
    // the test and the loop stops AT i rather than moving past it.
    expect(targetIndexForCenter(150, midpoints)).toBe(1)
    expect(targetIndexForCenter(250, midpoints)).toBe(2) // the last slot's own midpoint too
  })

  it('clamps to the LAST index once the center has passed every midpoint', () => {
    expect(targetIndexForCenter(9999, midpoints)).toBe(2)
  })

  it('a single-row list always resolves to index 0', () => {
    expect(targetIndexForCenter(-50, [75])).toBe(0)
    expect(targetIndexForCenter(75, [75])).toBe(0)
    expect(targetIndexForCenter(500, [75])).toBe(0)
  })
})

describe('stepsToReorder(fromIndex, toIndex)', () => {
  it('is empty when nothing moved', () => {
    expect(stepsToReorder(2, 2)).toEqual([])
    expect(stepsToReorder(0, 0)).toEqual([])
  })

  it('steps DOWN (+1) one at a time when moving to a later index', () => {
    expect(stepsToReorder(0, 3)).toEqual([1, 1, 1])
    expect(stepsToReorder(1, 2)).toEqual([1])
  })

  it('steps UP (-1) one at a time when moving to an earlier index', () => {
    expect(stepsToReorder(3, 0)).toEqual([-1, -1, -1])
    expect(stepsToReorder(2, 1)).toEqual([-1])
  })

  it('every step is exactly ±1 — never a jump — for a longer span in either direction', () => {
    const down = stepsToReorder(0, 5)
    expect(down).toHaveLength(5)
    expect(down.every((s) => s === 1)).toBe(true)
    const up = stepsToReorder(5, 0)
    expect(up).toHaveLength(5)
    expect(up.every((s) => s === -1)).toBe(true)
  })
})

describe('previewShift(index, startIndex, previewIndex, rowHeight)', () => {
  const H = 40

  it('the dragged row itself is never the concern of this function (caller never calls it for that index), and a row outside the drag span gets no nudge', () => {
    // Dragging index 1 down to preview index 3: rows 0 and 4 sit entirely outside [1..3].
    expect(previewShift(0, 1, 3, H)).toBe(0)
    expect(previewShift(4, 1, 3, H)).toBe(0)
  })

  it('dragging DOWNWARD (previewIndex > startIndex): every row strictly between start and preview shifts UP one row height', () => {
    // Rows 2 and 3 are between start(1) and preview(3) — they slide up to fill the gap the
    // dragged row left behind.
    expect(previewShift(2, 1, 3, H)).toBe(-H)
    expect(previewShift(3, 1, 3, H)).toBe(-H)
  })

  it('dragging UPWARD (previewIndex < startIndex): every row strictly between preview and start shifts DOWN one row height', () => {
    // Dragging index 3 up to preview index 1: rows 1 and 2 slide down to make room.
    expect(previewShift(1, 3, 1, H)).toBe(H)
    expect(previewShift(2, 3, 1, H)).toBe(H)
  })

  it('a no-op preview (still hovering the start slot) shifts nothing', () => {
    expect(previewShift(0, 2, 2, H)).toBe(0)
    expect(previewShift(1, 2, 2, H)).toBe(0)
    expect(previewShift(3, 2, 2, H)).toBe(0)
  })

  it('the boundary rows (exactly at startIndex or exactly at previewIndex) are included in the shifted span', () => {
    // previewShift is never actually called for the dragged row (index === startIndex) by the
    // component, but the function's own boundary is worth pinning: index<=previewIndex (down) and
    // index>=previewIndex (up) both include the landing slot itself.
    expect(previewShift(3, 1, 3, H)).toBe(-H) // landing slot, dragging down
    expect(previewShift(1, 3, 1, H)).toBe(H) // landing slot, dragging up
  })
})

describe('averageRowHeight(slotMidpoints)', () => {
  it('is 0 for an empty list', () => {
    expect(averageRowHeight([])).toBe(0)
  })

  it('is 0 for a single row — nothing to measure a spacing against', () => {
    expect(averageRowHeight([75])).toBe(0)
  })

  it('is the exact spacing for two evenly-spaced rows', () => {
    expect(averageRowHeight([50, 150])).toBe(100)
  })

  it('averages across the WHOLE span for many rows, smoothing one uneven gap', () => {
    // Spacing is 100, 100, then a 102 outlier — averaged across the full first-to-last span
    // rather than just the first pair, so the outlier is diluted rather than driving the result.
    const midpoints = [0, 100, 200, 302]
    expect(averageRowHeight(midpoints)).toBeCloseTo(302 / 3, 10)
  })

  it('handles a descending (reverse-order) list the same way — the span, not a sign assumption', () => {
    expect(averageRowHeight([150, 50])).toBe(-100)
  })
})

// ── Round 23: where the dragged row may be DRAWN ─────────────────────────────────────────────
describe('clampDragCenter(centerY, slotMidpoints, visibleTop, visibleBottom, halfRow)', () => {
  // Five 40px rows, centers 20 … 180, in content coordinates.
  const slots = [20, 60, 100, 140, 180]

  it('passes a center that is already inside the list straight through', () => {
    expect(clampDragCenter(85, slots, 0, 1000, 20)).toBe(85)
  })

  // ★ THE OWNER'S BUG: the row escaped the list — up over the popup's description, down past its
  // foot. The row's center can never go past the first or last slot's center.
  it('never lets the row past the FIRST slot or the LAST slot, however far the pointer goes', () => {
    expect(clampDragCenter(-500, slots, 0, 1000, 20)).toBe(20)
    expect(clampDragCenter(5000, slots, 0, 1000, 20)).toBe(180)
  })

  it('keeps the whole row inside the part of the list on screen', () => {
    // Showing content 60 … 140 (scrolled 60, 80px tall): a 40px row's center lives in 80 … 120.
    expect(clampDragCenter(20, slots, 60, 140, 20)).toBe(80)
    expect(clampDragCenter(180, slots, 60, 140, 20)).toBe(120)
    expect(clampDragCenter(100, slots, 60, 140, 20)).toBe(100)
  })

  it('the slot bound wins where the two disagree', () => {
    // Visible 0 … 400 would allow 20 … 380, but the last slot is 180.
    expect(clampDragCenter(390, slots, 0, 400, 20)).toBe(180)
  })

  it('ignores a region too short to hold one whole row, rather than inverting the range', () => {
    // 0 … 0 is what a layout-free environment reports; only the slot bound applies.
    expect(clampDragCenter(85, slots, 0, 0, 20)).toBe(85)
    expect(clampDragCenter(900, slots, 0, 0, 20)).toBe(180)
  })
})

describe('autoScrollDirection(pointerY, startY, inBand)', () => {
  // ★ Grab the TOP visible row and the finger is already in the top band before it has moved.
  // A band only counts in the direction the finger has travelled, so that press does not start the
  // list scrolling away under a row about to be dragged DOWN.
  it('a band only counts in the direction the finger has travelled', () => {
    expect(autoScrollDirection(100, 100, -1)).toBe(0) // pressed in the top band, not moved
    expect(autoScrollDirection(110, 100, -1)).toBe(0) // moving DOWN inside the top band
    expect(autoScrollDirection(90, 100, -1)).toBe(-1) // moved up into it
    expect(autoScrollDirection(500, 500, 1)).toBe(0)
    expect(autoScrollDirection(490, 500, 1)).toBe(0)
    expect(autoScrollDirection(510, 500, 1)).toBe(1)
  })

  it('outside both bands, never', () => {
    expect(autoScrollDirection(10, 300, 0)).toBe(0)
    expect(autoScrollDirection(900, 300, 0)).toBe(0)
  })
})

// The list's edge fades are a mask on the scroll region, so they paint over everything inside it —
// the row in the player's hand included. The dragged row therefore stops short of an edge by the
// depth of that edge's fade, for exactly as long as the fade is showing.
describe('edgeFadeInset(gap, band, fadeDepth)', () => {
  it('is the full fade depth while there is more content past the edge than the fade is deep', () => {
    expect(edgeFadeInset(500, 0, 24)).toBe(24)
    expect(edgeFadeInset(500, 4, 24)).toBe(24)
    expect(edgeFadeInset(28, 4, 24)).toBe(24)
  })

  it('is zero at the edge itself — no fade there, so the row may go all the way', () => {
    expect(edgeFadeInset(0, 0, 24)).toBe(0)
    // The bottom edge counts as reached inside its tolerance band, which is where its fade ends.
    expect(edgeFadeInset(4, 4, 24)).toBe(0)
    expect(edgeFadeInset(2, 4, 24)).toBe(0)
  })

  it('shrinks with the gap over the last stretch, so the row arrives at the end without a jump', () => {
    // A step from 24 to 0 would snap the row a whole fade-depth in the frame the list stops.
    const steps = [28, 22, 16, 10, 6, 4].map((gap) => edgeFadeInset(gap, 4, 24))
    expect(steps).toEqual([24, 18, 12, 6, 2, 0])
  })

  it('is zero where there is no fade to keep clear of (a layout-free environment reads none)', () => {
    expect(edgeFadeInset(500, 0, 0)).toBe(0)
    expect(edgeFadeInset(500, 0, -1)).toBe(0)
  })

  it('pulls clampDragCenter`s visible window in, so the row`s edge meets the fade and no further', () => {
    // Twenty 40px rows, a 200px window scrolled to the middle: both fades are showing.
    const slots = Array.from({ length: 20 }, (_, i) => 20 + i * 40)
    const top = 300 + edgeFadeInset(300, 0, 24)
    const bottom = 500 - edgeFadeInset(300, 4, 24)
    // Held at the bottom: the row's lower edge (center + 20) is 24px above the window's.
    expect(clampDragCenter(9999, slots, top, bottom, 20) + 20).toBe(500 - 24)
    // …and at the top, its upper edge is 24px below the window's.
    expect(clampDragCenter(-9999, slots, top, bottom, 20) - 20).toBe(300 + 24)
  })
})
