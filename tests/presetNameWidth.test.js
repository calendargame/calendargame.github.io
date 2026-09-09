// fitsWithinWidth — the PURE half of lib/presetNameWidth's live typing cap (Q6, round 20).
//
// Deliberately apart from every DOM/canvas-touching function in that file (readSwitcherBudget,
// measureTextWidthPx, fitTextToWidth, capCandidateToSwitcherWidth — all covered in
// tests/presetNameWidth.dom.test.js): this is the one piece of the mechanism that is a plain
// number comparison, so it is exercised here with FABRICATED widths and no jsdom at all, per the
// brief's own reasoning — jsdom's canvas measureText cannot be trusted to produce a real number
// (verified in the .dom test file), so the DECISION has to be provably correct independent of it.
import { describe, it, expect } from 'vitest'
import { fitsWithinWidth } from '../src/lib/presetNameWidth.js'

describe('fitsWithinWidth(measuredWidthPx, budgetPx)', () => {
  it('fits when the candidate is narrower than the budget', () => {
    expect(fitsWithinWidth(40, 80)).toBe(true)
  })
  it('fits at EXACTLY the budget — the boundary is inclusive, not a strict less-than', () => {
    expect(fitsWithinWidth(80, 80)).toBe(true)
  })
  it('refuses one pixel over', () => {
    expect(fitsWithinWidth(80.01, 80)).toBe(false)
  })
  it('a zero-width measurement always fits (the jsdom / canvas-unavailable case)', () => {
    expect(fitsWithinWidth(0, 1)).toBe(true)
    expect(fitsWithinWidth(0, 0)).toBe(true)
  })
  it('a zero (or negative) budget refuses anything with real width', () => {
    expect(fitsWithinWidth(1, 0)).toBe(false)
    expect(fitsWithinWidth(1, -5)).toBe(false)
  })
})
