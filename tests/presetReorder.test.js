// presetReorder — the PURE arithmetic behind PresetManager's drag handle (Q7, round 20).
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
