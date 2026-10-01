// StatPanel value auto-fit math. The pure scale function is unit-tested here; the wiring (measure
// each box + apply the font-size) is verified on-device — jsdom has no layout engine, so element widths
// are 0 there (fitScale then returns 1, a no-op, so the stat values still render at the base size, which
// the per-mode DOM tests already exercise via statValue()).
import { describe, it, expect } from 'vitest'
import { fitScale, sharedFitScale } from '../src/lib/statFit.js'

describe('StatPanel.fitScale — value auto-fit', () => {
  it('returns 1 (no shrink) when the value already fits', () => {
    expect(fitScale(40, 60)).toBe(1)
    expect(fitScale(60, 60)).toBe(1)
  })

  it('scales down proportionally when the value is too wide', () => {
    expect(fitScale(120, 60)).toBe(0.5)
    expect(fitScale(80, 60)).toBe(0.75)
  })

  it('never enlarges past 1, even with lots of room (short values stay at the base size)', () => {
    expect(fitScale(20, 200)).toBe(1)
  })

  it('returns 1 for zero/invalid inputs (jsdom safety — widths are 0 there)', () => {
    expect(fitScale(0, 60)).toBe(1)
    expect(fitScale(60, 0)).toBe(1)
    expect(fitScale(0, 0)).toBe(1)
    expect(fitScale(-5, 60)).toBe(1)
  })
})

// The GROUP version (Round-2): one shared scale for the ⚙ footer button trio — the tightest
// caption governs so all three shrink together (the DOM wiring is pinned in
// tests/footerFit.dom.test.jsx).
describe('sharedFitScale — footer-button group auto-fit (Round-2)', () => {
  it('returns the tightest pair ratio, capped at 1', () => {
    expect(sharedFitScale([120, 80, 40], [60, 60, 60])).toBe(0.5) // 120→60 governs
    expect(sharedFitScale([40, 50, 60], [60, 60, 60])).toBe(1) // everything already fits
  })

  it('invalid pairs contribute 1 exactly like fitScale — a partial measure never shrinks the group', () => {
    expect(sharedFitScale([0, 0, 0], [0, 0, 0])).toBe(1) // jsdom: every width 0 → no-op
    expect(sharedFitScale([120, 0, 40], [60, 0, 60])).toBe(0.5) // the dead pair is ignored
    expect(sharedFitScale([120], [])).toBe(1) // a missing avail reads as invalid, not as 0-wide
  })

  it('an empty set scales by 1', () => {
    expect(sharedFitScale([], [])).toBe(1)
  })
})
