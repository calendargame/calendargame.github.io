// StatPanel value auto-fit math. The pure scale function is unit-tested here; the wiring (measure
// each box + apply the font-size) is verified on-device — jsdom has no layout engine, so element widths
// are 0 there (fitScale then returns 1, a no-op, so the stat values still render at the base size, which
// the per-mode DOM tests already exercise via statValue()).
import { describe, it, expect } from 'vitest'
import { fitScale } from '../src/lib/statFit.js'

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
