// tests/dashedFrame.test.js — AMNESIC'S DASHED FRAME HAS THE SAME GAP ALL THE WAY ROUND
// (components/DashedFrame says why it is drawn rather than a dashed border: the owner saw one long
// gap on his iPhone). The pattern closes on itself because the path's length is counted as a whole
// number of dash-and-gap periods; what is pinned here is the arithmetic that number comes from —
// a whole number, the nearest one, never stretching a period by more than half a period over the
// whole frame — and the path's shape, at the sizes the frame really has. That the browser then draws
// it evenly is tests/browser/sessionOnlyFrame's to say.
import { describe, it, expect } from 'vitest'
import {
  dashedOutline,
  DASH,
  GAP,
  DASH_PATTERN,
  DASHED_LINE,
} from '../src/components/DashedFrame.jsx'

const PERIOD = DASH + GAP

describe('components/DashedFrame', () => {
  it('goes round in a whole number of periods, each within a pixel of DASH + GAP', () => {
    for (const width of [270.5, 300, 357.09375, 600, 900])
      for (const height of [40, 47.75, 120, 133.4])
        for (const radius of [0, 16, 16.458]) {
          const line = dashedOutline({ width, height, radius })
          expect(Number.isInteger(line.periods)).toBe(true)
          const stretched = line.length / line.periods
          expect(Math.abs(stretched - PERIOD)).toBeLessThanOrEqual(PERIOD / 2 / line.periods + 1e-9)
          expect(Math.abs(stretched - PERIOD)).toBeLessThan(1)
        }
  })

  it('runs along the inside of the box, half the line in from each edge, with the box’s corner', () => {
    const { d, length } = dashedOutline({ width: 300, height: 100, radius: 16 })
    const h = DASHED_LINE / 2
    const r = 16 - h
    expect(d.startsWith(`M 150 ${h} H ${300 - h - r}`)).toBe(true)
    expect(d.endsWith(`A ${r} ${r} 0 0 1 ${h + r} ${h} H 150 Z`)).toBe(true)
    expect(d).toContain(`A ${r} ${r} 0 0 1 ${300 - h} ${h + r}`)
    expect(d.endsWith('Z')).toBe(true)
    expect(length).toBeCloseTo(
      2 * (300 - 2 * h - 2 * r) + 2 * (100 - 2 * h - 2 * r) + 2 * Math.PI * r,
      9,
    )
  })

  it('writes the pattern in periods: a dash and a gap that add up to one', () => {
    const [dash, gap] = DASH_PATTERN.split(' ').map(Number)
    expect(dash + gap).toBeCloseTo(1, 12)
    expect(dash / gap).toBeCloseTo(DASH / GAP, 12)
  })

  it('draws nothing in a box too small to hold the line', () => {
    expect(dashedOutline({ width: 0, height: 0, radius: 16 })).toBeNull()
    expect(dashedOutline({ width: 300, height: DASHED_LINE, radius: 16 })).toBeNull()
  })
})
