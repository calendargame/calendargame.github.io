// engine/stats — the time-stat helpers every stat strip, the run breakdown and the MoX bests read.
//
// ★ WHY THIS FILE EXISTS NOW (round 23): every solve time is kept, so a casual mode's pool grows
// without bound — 100,000 times is a year and a half of heavy daily play in one mode. Median used to
// SORT a copy of the whole pool, and the casual modes' stat strip computes it on every render (not
// just when a time is added): at 100,000 times that was ~50-60 ms per render in Chromium, several
// renders per answer. It now SELECTS the middle instead of sorting — linear time — and must return
// exactly what the sort returned, which the reference comparison below proves.
import { describe, it, expect } from 'vitest'
import { calcAvg, calcMed, calcLast, solveTimeFromMs } from '../../src/engine/stats.js'

// The old definition, kept here as the oracle.
const sortedMedian = (t) => {
  if (!t.length) return null
  const s = [...t].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('calcMed — the middle of the pool, selected rather than sorted', () => {
  it('empty → null; one → itself; two → their mean', () => {
    expect(calcMed([])).toBeNull()
    expect(calcMed([4.2])).toBe(4.2)
    expect(calcMed([3, 1])).toBe(2)
  })

  it('agrees EXACTLY with the sorted median on random pools, duplicates and runs included', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = mulberry32(seed)
      const n = 1 + Math.floor(rnd() * 60)
      const shape = seed % 4
      const t = Array.from(
        { length: n },
        (_, i) =>
          shape === 0
            ? solveTimeFromMs(500 + rnd() * 9000) // real grid times
            : shape === 1
              ? Math.floor(rnd() * 4) // heavy duplicates
              : shape === 2
                ? i / 10 // already sorted
                : (n - i) / 10, // reverse sorted
      )
      expect(calcMed(t), `seed ${seed}`).toBe(sortedMedian(t))
    }
  })

  it('does not reorder the pool it is given — the pool is in PLAY order and Last reads its end', () => {
    const t = [5, 1, 4, 2, 3]
    calcMed(t)
    expect(t).toEqual([5, 1, 4, 2, 3])
    expect(calcLast(t)).toBe(3)
  })

  // A generous bound (a sort of this pool takes several times longer than it on any machine this
  // runs on), so a loaded test run cannot flake it; it fails only if the median goes back to sorting.
  it('stays fast on a very large pool (200,000 times)', () => {
    const rnd = mulberry32(7)
    const t = Array.from({ length: 200_000 }, () => solveTimeFromMs(500 + rnd() * 9000))
    calcMed(t) // warm
    const start = performance.now()
    const m = calcMed(t)
    const took = performance.now() - start
    expect(m).toBe(sortedMedian(t))
    expect(took).toBeLessThan(40)
  })
})

describe('calcAvg', () => {
  it('the arithmetic mean, null when empty', () => {
    expect(calcAvg([])).toBeNull()
    expect(calcAvg([1, 2, 6])).toBe(3)
  })
})

describe('solveTimeFromMs — the 0.1 ms grid', () => {
  it('removes the subtraction noise and keeps every measured digit', () => {
    expect(solveTimeFromMs(126913.4 - 123456.7)).toBe(3.4567)
    expect(solveTimeFromMs(1000)).toBe(1)
    expect(solveTimeFromMs(0)).toBe(0)
  })
})
