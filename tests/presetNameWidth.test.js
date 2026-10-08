// fitsWithinWidth — the PURE comparison under lib/presetNameWidth's "is this name cut short".
//
// Deliberately apart from every DOM/canvas-touching function in that file (readNameRooms,
// measureTextWidthPx, isCutSomewhere — all covered in tests/presetNameWidth.dom.test.js): this is
// the one piece of the mechanism that is a plain number comparison, so it is exercised here with
// FABRICATED widths and no jsdom at all — jsdom's canvas measureText cannot be trusted to produce
// a real number (verified in the .dom test file), so the DECISION has to be provably correct
// independent of it.
import { describe, it, expect } from 'vitest'
import { fitsWithinWidth } from '../src/lib/presetNameWidth.js'

describe('fitsWithinWidth(measuredWidthPx, budgetPx)', () => {
  it('fits when the candidate is narrower than the budget', () => {
    expect(fitsWithinWidth(40, 80)).toBe(true)
  })
  it('fits at EXACTLY the budget — the boundary is inclusive, not a strict less-than', () => {
    expect(fitsWithinWidth(80, 80)).toBe(true)
  })
  it('does not fit one pixel over', () => {
    expect(fitsWithinWidth(80.01, 80)).toBe(false)
  })
  it('a zero-width measurement always fits (the jsdom / canvas-unavailable case)', () => {
    expect(fitsWithinWidth(0, 1)).toBe(true)
    expect(fitsWithinWidth(0, 0)).toBe(true)
  })
  it('a zero (or negative) budget fits nothing with real width', () => {
    expect(fitsWithinWidth(1, 0)).toBe(false)
    expect(fitsWithinWidth(1, -5)).toBe(false)
  })
})
