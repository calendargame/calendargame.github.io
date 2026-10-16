// engine/timesPool — the summary kept beside a pool of solve times. The one property that matters is
// that it never gives a different answer from working the pool out from scratch: the Mean is
// calcAvg's left-to-right sum from 0 divided by the count, and the Median is the value a full
// ascending sort puts in the middle (the two middles added lower first, then halved). Every case
// below compares with those two expressions, written out here independently, with Object.is — so a
// −0 against a 0, or a last-bit difference, is a failure.
import { describe, it, expect, beforeAll } from 'vitest'
import { appended, retimed, summaryOf, auditTimesPool } from '../../src/engine/timesPool.js'
import { calcAvg, calcMed, solveTimeFromMs } from '../../src/engine/stats.js'

const freshMean = (t) => (t.length ? t.reduce((a, b) => a + b, 0) / t.length : null)
const freshMedian = (t) => {
  if (!t.length) return null
  const s = [...t].sort((a, b) => a - b)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}
const freshValid = (t) => t.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const expectSame = (t, what) => {
  expect(
    Object.is(calcAvg(t), freshMean(t)),
    `${what}: mean ${calcAvg(t)} vs ${freshMean(t)}`,
  ).toBe(true)
  expect(
    Object.is(calcMed(t), freshMedian(t)),
    `${what}: median ${calcMed(t)} vs ${freshMedian(t)}`,
  ).toBe(true)
  expect(summaryOf(t).valid, `${what}: valid`).toBe(freshValid(t))
}

describe('engine/timesPool — the same Mean and Median as working the pool out from scratch', () => {
  // Every summary made from an earlier one is audited from scratch inside the module too.
  beforeAll(() => auditTimesPool(1))

  it('a pool built one answer at a time, and every pool along the way', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(seed)
      let t = []
      const kept = []
      const shape = seed % 3
      for (let i = 0; i < 200; i++) {
        const x =
          shape === 0
            ? solveTimeFromMs(500 + rnd() * 9000) // real grid times
            : shape === 1
              ? Math.floor(rnd() * 4) // heavy duplicates
              : (i % 7) / 10 + 0.1 // runs
        t = appended(t, x)
        kept.push(t)
      }
      // The newest pool, and the older ones still held (their answers must not move as later ones are made).
      for (const [i, p] of kept.entries()) expectSame(p, `seed ${seed}, pool ${i}`)
    }
  })

  it('an Override toggling one card in its own slot, at any depth, in both directions', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(1000 + seed)
      let t = []
      for (let i = 0; i < 120; i++) t = appended(t, solveTimeFromMs(500 + rnd() * 9000))
      for (let k = 0; k < 80; k++) {
        const at = Math.floor(rnd() * (t.length + 1))
        const op = rnd()
        if (op < 0.33 && at < t.length)
          t = retimed(t, at, true, null) // a credit taken away
        else if (op < 0.66)
          t = retimed(t, at, false, solveTimeFromMs(500 + rnd() * 9000)) // put back
        else if (at < t.length) t = retimed(t, at, true, solveTimeFromMs(500 + rnd() * 9000)) // replaced
        expectSame(t, `seed ${seed}, change ${k}`)
      }
    }
  })

  it('two changes made from the SAME pool (a fork): each answers for its own pool', () => {
    const rnd = mulberry32(77)
    let base = []
    for (let i = 0; i < 300; i++) base = appended(base, solveTimeFromMs(500 + rnd() * 9000))
    const a = appended(base, 1)
    const b = appended(base, 99) // base's buffer has gone to `a`: this one sorts its own
    const c = retimed(base, 10, true, null)
    for (const [p, what] of [
      [base, 'base'],
      [a, 'a'],
      [b, 'b'],
      [c, 'c'],
    ])
      expectSame(p, what)
    expectSame(appended(a, 50), 'a then more')
    expectSame(appended(b, 0), 'b then more')
  })

  it('a pool it has never seen (loaded, restored, built elsewhere) is worked out once, then carried', () => {
    const rnd = mulberry32(5)
    const loaded = Array.from({ length: 5001 }, () => solveTimeFromMs(500 + rnd() * 9000))
    expectSame(loaded, 'loaded')
    let t = loaded
    for (let i = 0; i < 50; i++) t = appended(t, solveTimeFromMs(500 + rnd() * 9000))
    expectSame(t, 'loaded, then answered')
    expectSame([], 'empty')
    expectSame([4.2], 'one')
    expectSame(appended([], 3), 'one, appended')
  })

  // Which zero a pool holding both −0 and 0 calls its middle is not something a sort settles either
  // (a comparator sees them as equal and keeps them in pool order); such a pool is SELECTED, exactly
  // as calcMed always did, so the value is the same — compared here by value. No such pool reaches
  // the engine: JSON cannot carry a −0 and solveTimeFromMs never makes one (below).
  it('a pool the buffer cannot order exactly (−0, a bad value) still answers as from scratch', () => {
    for (const [p, what] of [
      [[1, -0, 0, 2], '−0 in a loaded pool'],
      [appended([1, -0, 0, 2], 0), '…appended to'],
      [appended([1, 2], -0), '−0 appended'],
    ]) {
      expect(calcMed(p) === freshMedian(p), `${what}: the same value`).toBe(true)
      expect(Object.is(calcAvg(p), freshMean(p)), what).toBe(true)
      expect(summaryOf(p).buf, `${what}: no buffer`).toBe(null)
    }
    const bad = [1, NaN, 3]
    expect(summaryOf(bad).valid).toBe(false)
    expect(Object.is(calcAvg(bad), freshMean(bad))).toBe(true)
    expect(summaryOf(appended(bad, 2)).valid).toBe(false)
    expect(summaryOf(appended([1, 2], -1)).valid).toBe(false)
    expect(summaryOf(retimed([1, -1, 2], 1, true, null)).valid).toBe(true)
  })

  it('a solve time is never −0 (the buffer orders −0 apart from 0; the source keeps it out)', () => {
    expect(Object.is(solveTimeFromMs(-0.01), 0)).toBe(true)
    expect(Object.is(solveTimeFromMs(-0), 0)).toBe(true)
  })

  it('MEMORY: the sorted buffer belongs to the newest pool only — older pools keep a number', () => {
    let t = []
    const line = []
    for (let i = 0; i < 1000; i++) line.push((t = appended(t, i % 13)))
    const holding = line.filter((p) => summaryOf(p).buf !== null)
    expect(holding, 'one buffer for the whole line of pools').toEqual([t])
    // …and an Override hands it on the same way.
    const after = retimed(t, 5, true, null)
    expect(summaryOf(t).buf).toBe(null)
    expect(summaryOf(after).buf).not.toBe(null)
  })

  it('the pool itself is never changed or reordered', () => {
    const t = Object.freeze([5, 1, 4, 2, 3])
    const next = appended(t, 0)
    expect(t).toEqual([5, 1, 4, 2, 3])
    expect(next).toEqual([5, 1, 4, 2, 3, 0])
    expect(retimed(next, 1, true, 9)).toEqual([5, 9, 4, 2, 3, 0])
  })
})
