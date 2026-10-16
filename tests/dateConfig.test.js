// tests/dateConfig.test.js — lib/dateConfig: which date settings are in effect, and which Bests filed
// under stored values were played on the in-effect set-up's dates.
//
// inEffectBestKey describes what the generator DID before Round 26, so the evidence for it is that
// generator, RUN: tests/fixtures/olderBuilds/randomDate-v2.29.4.js is a verbatim copy, and every
// combination the table classifies is put through it.
import { describe, it, expect } from 'vitest'
import {
  dateSettingsInEffect,
  dateDrawKey,
  bestKeyTail,
  inEffectBestKey,
  leapChanceApplies,
  janFebChanceApplies,
  julianChanceApplies,
} from '../src/lib/dateConfig.js'
import { isJulianDate, isLeap, isLeapJulian } from '../src/lib/calendar.js'
import { randomDate as oldRandomDate } from './fixtures/olderBuilds/randomDate-v2.29.4.js'
import { mulberry32 } from './helpers/rng.js'

const LEAPS = ['random', '50', '75', '100']
const CHANCES = ['random', '25', '50', '75', '100']
const base = {
  randomFormat: false,
  dateFormat: 'written-mdy',
  useJulian: true,
  minY: 1,
  maxY: 10000,
  leapChance: 'random',
  janFebChance: 'random',
  julianChance: 'random',
}
// A Best key's tail as the builds before Round 26 wrote it: the stored values, dimmed or not.
const rawTail = (s) =>
  `${s.randomFormat ? 'random' : s.dateFormat}|${s.leapChance}|${s.janFebChance}|${s.julianChance}|${s.minY}-${s.maxY}|${s.useJulian}`

describe('dateSettingsInEffect', () => {
  it('with everything in effect it is the stored settings, and its key is the key the builds always wrote', () => {
    const s = { ...base, leapChance: '75', janFebChance: '25', julianChance: '50' }
    const d = dateSettingsInEffect(s)
    expect(d).toEqual({
      format: 'written-mdy',
      minY: 1,
      maxY: 10000,
      useJulian: true,
      leapChance: '75',
      janFebChance: '25',
      julianChance: '50',
    })
    expect(bestKeyTail(d)).toBe(rawTail(s))
    expect(`${dateDrawKey(d)}|true`).toBe(bestKeyTail(d))
  })
  it('Random Format on: the format is "random", whatever Date Format holds', () => {
    for (const dateFormat of ['written-mdy', 'numeric-ymd'])
      expect(dateSettingsInEffect({ ...base, randomFormat: true, dateFormat }).format).toBe(
        'random',
      )
  })
  it('no leap year in the range: Leap Year Chance and Jan/Feb Chance are Random', () => {
    const d = dateSettingsInEffect({
      ...base,
      minY: 1701,
      maxY: 1703,
      leapChance: '100',
      janFebChance: '75',
    })
    expect([d.leapChance, d.janFebChance]).toEqual(['random', 'random'])
  })
  it('Julian off, or a range without 1582: Julian Chance is Random', () => {
    for (const s of [
      { useJulian: false, minY: 1, maxY: 10000 },
      { useJulian: true, minY: 1583, maxY: 2000 },
      { useJulian: true, minY: 1, maxY: 1581 },
    ])
      expect(dateSettingsInEffect({ ...base, ...s, julianChance: '75' }).julianChance).toBe(
        'random',
      )
    expect(
      dateSettingsInEffect({ ...base, minY: 1582, maxY: 1582, julianChance: '75' }).julianChance,
    ).toBe('75')
  })
  it('a single leap year: Leap Year Chance does not apply (every date is in a leap year), Jan/Feb Chance does', () => {
    for (const [y, useJulian] of [
      [2000, false],
      [1100, true],
    ]) {
      const d = dateSettingsInEffect({
        ...base,
        useJulian,
        minY: y,
        maxY: y,
        leapChance: '50',
        janFebChance: '75',
      })
      expect([d.leapChance, d.janFebChance]).toEqual(['random', '75'])
    }
  })
  it('the "does it apply" questions are the ones the in-effect values follow', () => {
    expect(janFebChanceApplies(1100, 1100, true)).toBe(true) // the Julian rule: 1100 is a leap year
    expect(janFebChanceApplies(1100, 1100, false)).toBe(false) // the Gregorian rule: it is not
    expect(leapChanceApplies(1100, 1100, true)).toBe(false) // a leap year on its own
    expect(leapChanceApplies(1100, 1101, true)).toBe(true)
    expect(julianChanceApplies(1582, 1582, true)).toBe(true)
    expect(julianChanceApplies(1582, 1582, false)).toBe(false)
  })
})

describe('inEffectBestKey — the table, row by row', () => {
  const k = (s, head = '10|false') => `${head}|${rawTail({ ...base, ...s })}`
  const at = (s, head) => inEffectBestKey(k(s, head))
  const mapsTo = (s, head = '10|false') =>
    `${head}|${bestKeyTail(dateSettingsInEffect({ ...base, ...s }))}`

  it('a key already in effect maps to itself, on the same dates', () => {
    for (const s of [
      {},
      { leapChance: '50', janFebChance: '75', julianChance: '25' },
      { useJulian: false, minY: 1900, maxY: 2100, leapChance: '100' },
      { randomFormat: true },
    ])
      expect(at(s)).toEqual({ key: k(s), samePool: true })
  })
  it('the head segments are kept as they are (MoX, Blitz Per Round, Per Question)', () => {
    for (const head of ['10|false', '1000|true', 'm60', 'n300', '10']) {
      const s = { useJulian: false, julianChance: '50' }
      expect(at(s, head)).toEqual({ key: mapsTo(s, head), samePool: true })
    }
  })
  it('row 1: Jan/Feb Chance on a range with no leap year did nothing', () => {
    for (const janFebChance of CHANCES.slice(1))
      for (const julianChance of CHANCES) {
        // 1581-1583 holds 1582, so Julian Chance applies there and may be filtering.
        const s = { minY: 1581, maxY: 1583, janFebChance, julianChance }
        expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
      }
  })
  it('row 2: Julian Chance with Julian off did nothing', () => {
    for (const julianChance of CHANCES.slice(1))
      for (const leapChance of LEAPS) {
        const s = { useJulian: false, minY: 1900, maxY: 2100, julianChance, leapChance }
        expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
      }
  })
  it('row 3: Julian Chance 100% on a range entirely before 1582 did nothing', () => {
    for (const leapChance of LEAPS) {
      const s = { minY: 1, maxY: 1000, julianChance: '100', leapChance, janFebChance: '50' }
      expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
    }
  })
  it('row 4: Julian Chance on a range without 1582, with both leap settings Random: same dates', () => {
    for (const julianChance of ['25', '50', '75']) {
      const s = { minY: 1, maxY: 1000, julianChance }
      expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
    }
    for (const julianChance of CHANCES.slice(1)) {
      const s = { minY: 1900, maxY: 2100, julianChance }
      expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
    }
  })
  it('row 5: …with Leap Year Chance or Jan/Feb Chance not Random — the fault: different dates', () => {
    const cases = [
      { minY: 1900, maxY: 2100, julianChance: '100', leapChance: '100' },
      { minY: 1900, maxY: 2100, julianChance: '25', janFebChance: '25' },
      { minY: 1, maxY: 1000, julianChance: '75', leapChance: '50' },
      { minY: 1, maxY: 1000, julianChance: '25', janFebChance: '100' },
    ]
    for (const s of cases) expect(at(s)).toEqual({ key: mapsTo(s), samePool: false })
  })
  it('row 6: Julian Chance on a range without 1582 AND without a leap year: same dates', () => {
    for (const julianChance of CHANCES.slice(1))
      for (const leapChance of LEAPS) {
        const s = { minY: 1701, maxY: 1703, julianChance, leapChance, janFebChance: '75' }
        expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
      }
  })
  it('row 7: Leap Year Chance on a range with no leap year, Julian Chance not in effect or Random: same dates', () => {
    for (const leapChance of LEAPS.slice(1)) {
      for (const s of [
        { useJulian: false, minY: 1701, maxY: 1703, leapChance, julianChance: '50' },
        { minY: 1001, maxY: 1003, leapChance },
        { minY: 1581, maxY: 1583, leapChance },
      ])
        expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
    }
  })
  it('row 8: Leap Year Chance on a range with no leap year AND an active Julian Chance — the mirror fault', () => {
    for (const leapChance of LEAPS.slice(1))
      for (const julianChance of CHANCES.slice(1))
        for (const [minY, maxY] of [
          [1581, 1583],
          [1582, 1582],
          [1581, 1582],
        ]) {
          const s = { minY, maxY, leapChance, julianChance }
          expect(at(s)).toEqual({ key: mapsTo(s), samePool: false })
        }
  })
  it('found by running the generator (not in the design table): Leap Year Chance below 100% on a single leap year — on its own the same dates; with an active Jan/Feb Chance, the same fault', () => {
    for (const [y, useJulian] of [
      [2000, false],
      [1100, true],
      [1580, true],
    ]) {
      const one = { useJulian, minY: y, maxY: y }
      for (const leapChance of ['50', '75']) {
        expect(at({ ...one, leapChance })).toEqual({
          key: mapsTo({ ...one, leapChance }),
          samePool: true,
        })
        for (const janFebChance of CHANCES.slice(1)) {
          const s = { ...one, leapChance, janFebChance }
          expect(at(s)).toEqual({ key: mapsTo(s), samePool: false })
        }
      }
      // 100% is always met there, so it did nothing at all.
      const s = { ...one, leapChance: '100', janFebChance: '25' }
      expect(at(s)).toEqual({ key: mapsTo(s), samePool: true })
    }
  })
  it('a key with years past 10000 is one this build files with Julian on (up to 11582), and maps to itself', () => {
    const s = { minY: 10001, maxY: 11582, leapChance: '75', janFebChance: '25' }
    expect(at(s)).toEqual({ key: k(s), samePool: true })
  })
  it('a key it cannot read is null, never guessed', () => {
    for (const bad of [
      '',
      'random|random|random|1-10000|true', // five segments
      '10|false|written-mdy|25|random|random|1-10000|true', // Leap Year Chance has no 25
      '10|false|written-mdy|random|10|random|1-10000|true',
      '10|false|written-mdy|random|random|60|1-10000|true',
      '10|false|cursive|random|random|random|1-10000|true',
      '10|false|written-mdy|random|random|random|1-10000|maybe',
      '10|false|written-mdy|random|random|random|10000-1|true',
      '10|false|written-mdy|random|random|random|0-100|true',
      '10|false|written-mdy|random|random|random|1-10001|false', // past Julian off's cap
      '10|false|written-mdy|random|random|random|1-11583|true', // past Julian on's
      '10|false|written-mdy|random|random|random|1_10000|true',
      '10|false|written-mdy|random|random|random|01-100|true',
    ])
      expect(inEffectBestKey(bad)).toBe(null)
  })
})

// ── The generator, run ──────────────────────────────────────────────────────────────────────────
// One draw of the OLD generator under a seeded Math.random, and how many random numbers it used. A
// draw that fell back has made 2,000 failed attempts first, each using at least one number; a draw
// that did not has found its date within a handful (every filter here is met at least a fifth of the
// time when it can be met at all).
function drawCounting(rng, s) {
  const real = Math.random
  let used = 0
  Math.random = () => {
    used++
    return rng()
  }
  try {
    const q = oldRandomDate(
      s.minY,
      s.maxY,
      s.useJulian,
      s.leapChance,
      s.janFebChance,
      s.julianChance,
    )
    return { q, fellBack: used > 2000 }
  } finally {
    Math.random = real
  }
}
// The in-effect values as the old generator's arguments.
const asArgs = (s) => {
  const d = dateSettingsInEffect(s)
  return {
    ...s,
    leapChance: d.leapChance,
    janFebChance: d.janFebChance,
    julianChance: d.julianChance,
  }
}
const filtering = (s) => {
  const d = dateSettingsInEffect(s)
  return d.leapChance !== 'random' || d.janFebChance !== 'random' || d.julianChance !== 'random'
}

const RANGES = [
  [1900, 2100], // after 1582, leap years
  [1, 1000], // before 1582, leap years
  [1500, 1700], // includes 1582, leap years
  [1701, 1703], // after 1582, no leap year
  [1001, 1003], // before 1582, no leap year
  [1581, 1583], // includes 1582, no leap year
  [1582, 1582],
  [1100, 1100], // a leap year by the Julian rule only
  [1580, 1580], // a leap year by both rules
]

describe('inEffectBestKey against the old generator, every combination', () => {
  it('samePool exactly when no date fell back while a setting in effect was filtering — and where nothing fell back, the stored values drew the very same dates as the in-effect ones', () => {
    let classified = 0
    let fellBackSomewhere = 0
    for (const [minY, maxY] of RANGES)
      for (const useJulian of [true, false])
        for (const leapChance of LEAPS)
          for (const janFebChance of CHANCES)
            for (const julianChance of CHANCES) {
              const s = { ...base, minY, maxY, useJulian, leapChance, janFebChance, julianChance }
              const raw = mulberry32(minY * 7919 + maxY)
              const inEffect = mulberry32(minY * 7919 + maxY)
              let fell = false
              let identical = true
              for (let i = 0; i < 60; i++) {
                const a = drawCounting(raw, s)
                const b = drawCounting(inEffect, asArgs(s))
                fell ||= a.fellBack
                identical &&= a.q.y === b.q.y && a.q.m === b.q.m && a.q.d === b.q.d
              }
              const got = inEffectBestKey(`10|false|${rawTail(s)}`)
              expect(got, JSON.stringify(s)).not.toBe(null)
              expect(got.samePool, JSON.stringify(s)).toBe(!(fell && filtering(s)))
              if (!fell) expect(identical, JSON.stringify(s)).toBe(true)
              classified++
              if (fell) fellBackSomewhere++
            }
    expect(classified).toBe(RANGES.length * 2 * 4 * 5 * 5)
    expect(fellBackSomewhere).toBeGreaterThan(100) // the sweep reaches the fallback, often
  })
})

// The shares that tell two pools apart: dates in a leap year (by the calendar the date is in), dates in
// January or February among those, and Julian dates.
function shares(s, n, seed) {
  const rng = mulberry32(seed)
  let leap = 0
  let janFeb = 0
  let julian = 0
  for (let i = 0; i < n; i++) {
    const { q } = drawCounting(rng, s)
    const jul = s.useJulian && isJulianDate(q.y, q.m, q.d)
    const isL = s.useJulian && q.y < 1582 ? isLeapJulian(q.y) : isLeap(q.y)
    if (isL) {
      leap++
      if (q.m <= 2) janFeb++
    }
    if (jul) julian++
  }
  return { n, leap, janFeb, julian }
}
// Two proportions agree when they are within five standard errors of each other.
const agree = (x1, n1, x2, n2) => {
  if (n1 === 0 || n2 === 0) return true
  const p = (x1 + x2) / (n1 + n2)
  return Math.abs(x1 / n1 - x2 / n2) <= 5 * Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) + 1e-12
}
const samePools = (a, b) =>
  agree(a.leap, a.n, b.leap, b.n) &&
  agree(a.janFeb, a.leap, b.janFeb, b.leap) &&
  agree(a.julian, a.n, b.julian, b.n)

describe('the pools themselves, where a date fell back', () => {
  const N = 3000
  it.each([
    ['row 4', { minY: 1900, maxY: 2100, julianChance: '50' }],
    ['row 4, before 1582', { minY: 1, maxY: 1000, julianChance: '25' }],
    [
      'row 6',
      { minY: 1701, maxY: 1703, julianChance: '75', leapChance: '100', janFebChance: '50' },
    ],
    ['row 7', { useJulian: false, minY: 1701, maxY: 1703, leapChance: '75' }],
    ['row 7, Julian on', { minY: 1001, maxY: 1003, leapChance: '100', julianChance: '100' }],
  ])('%s (class a): the stored values drew the in-effect pool', (_row, set) => {
    const s = { ...base, ...set }
    expect(samePools(shares(s, N, 11), shares(asArgs(s), N, 12))).toBe(true)
    expect(inEffectBestKey(`m60|${rawTail(s)}`).samePool).toBe(true)
  })
  it.each([
    [
      'row 5, the reviewer’s case',
      { minY: 1900, maxY: 2100, julianChance: '100', leapChance: '100' },
    ],
    ['row 5, before 1582', { minY: 1, maxY: 1000, julianChance: '25', janFebChance: '100' }],
    ['row 5, 25%', { minY: 1900, maxY: 2100, julianChance: '25', leapChance: '100' }],
    ['row 8', { minY: 1581, maxY: 1583, leapChance: '100', julianChance: '100' }],
  ])('%s (class b): the stored values drew a different pool', (_row, set) => {
    const s = { ...base, ...set }
    expect(samePools(shares(s, N, 21), shares(asArgs(s), N, 22))).toBe(false)
    expect(inEffectBestKey(`m60|${rawTail(s)}`).samePool).toBe(false)
  })
  it('the reviewer’s case in numbers: Julian on, 1900-2100, Julian Chance 100%, Leap Year Chance 100% — no date was forced into a leap year; in effect, every one is', () => {
    const s = { ...base, minY: 1900, maxY: 2100, julianChance: '100', leapChance: '100' }
    const old = shares(s, N, 31)
    const now = shares(asArgs(s), N, 32)
    expect(now.leap).toBe(N)
    expect(old.leap / N).toBeLessThan(0.3) // the natural share: 49 leap years in 201
  })
})
