// @vitest-environment jsdom
//
// tests/dateGen.dom.test.jsx — fuzz the REAL date/puzzle generators across ALL settings.
//
// The engine fuzz feeds the reducer pre-made random dates, so it never exercises the actual generators
// (randomDate + makeDedPuzzle) or the date-generation settings (calendar system, leap / Jan-Feb /
// Julian chances, year range, random-format, and Deduction's ab-Cross / Jul-Cross / 1582-only toggles).
// Those settings don't touch SCORING, but that has to be proven: drive the generators across the whole
// settings space and assert every output is a REAL, ANSWERABLE question — valid y/m/d for its calendar
// (not a dropped 1582 gap day), a correct shown weekday, and an answer that is actually among the
// options. A generator that ever produced a malformed or unanswerable question would desync the engine
// (correctIndexOf returns -1, the tripwire's "answer not among options"). (jsdom env: importing
// main.tsx reads matchMedia at module scope.)
import { describe, it, expect } from 'vitest'
import { randomDate, makeDedPuzzle } from '../src/main.jsx'
import { dim, isGapDate, isJulianDate, wday, wdayJulian } from '../src/lib/calendar.js'
import { correctIndexOf } from '../src/engine/gameReducer.js'
import { mulberry32 } from './helpers/rng.js'

const realWday = (y, m, d, jul) =>
  jul && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)

// A generated weekday question must be a real, answerable date.
function checkWeekday(q, lo, hi) {
  const v = []
  const jul = !!q._jul
  if (!Number.isInteger(q.y)) v.push(`y not integer (${q.y})`)
  else if (q.y < Math.max(1, lo) || q.y > hi) v.push(`y ${q.y} out of [${Math.max(1, lo)},${hi}]`)
  if (!(Number.isInteger(q.m) && q.m >= 1 && q.m <= 12)) v.push(`m out of 1-12 (${q.m})`)
  else if (!(Number.isInteger(q.d) && q.d >= 1 && q.d <= dim(q.y, q.m, jul)))
    v.push(`d ${q.d} not in 1-${dim(q.y, q.m, jul)} for ${q.y}-${q.m} (jul=${jul})`)
  // Gap days (Oct 5-14, 1582) never existed under EITHER calendar state — the app-wide contract
  // (Lookup's "Does Not Exist", the How-to-Play guide) is unconditional, so the oracle is too.
  else if (isGapDate(q.y, q.m, q.d)) v.push(`gap day ${q.y}-${q.m}-${q.d} (never existed)`)
  const wd = correctIndexOf(q, jul)
  if (!(Number.isInteger(wd) && wd >= 0 && wd <= 6)) v.push(`weekday index ${wd} not 0-6`)
  return v
}

// A generated Deduction puzzle (or null = couldn't build, which the component handles) must be real
// (never a 1582 gap date — as answer or as a Day option — in either calendar state), have a correct
// shown weekday, distinct options, and an answer actually among the options.
function checkPuzzle(p) {
  if (p == null) return [] // null is a legitimate "no valid puzzle for this range/config"
  const v = []
  const jul = !!p._jul
  if (!(Number.isInteger(p.m) && p.m >= 1 && p.m <= 12)) v.push(`m out of 1-12 (${p.m})`)
  else if (!(Number.isInteger(p.d) && p.d >= 1 && p.d <= dim(p.y, p.m, jul)))
    v.push(`d ${p.d} not valid for ${p.y}-${p.m}`)
  else if (isGapDate(p.y, p.m, p.d)) v.push(`gap day ${p.y}-${p.m}-${p.d} (never existed)`)
  if (
    p.type === 'day' &&
    p.y === 1582 &&
    p.m === 10 &&
    !p.options.every((o) => !isGapDate(1582, 10, o))
  )
    v.push(`day options include gap days (${p.options})`)
  const rw = realWday(p.y, p.m, p.d, jul)
  if (p.w !== rw) v.push(`shown weekday ${p.w} != actual ${rw}`)
  const idx = correctIndexOf(p, jul)
  const optCount = p.type === 'month' ? p.boxes?.length : p.options?.length
  if (!(Number.isInteger(idx) && idx >= 0 && idx < optCount))
    v.push(`answer index ${idx} not in [0,${optCount}) (type ${p.type})`)
  if ((p.type === 'year' || p.type === 'day') && new Set(p.options).size !== p.options.length)
    v.push(`duplicate options (${p.type}: ${p.options})`)
  if (p.type === 'month' && idx >= 0) {
    const box = p.boxes[idx]
    if (!box || !Array.isArray(box.months) || !box.months.includes(p.m))
      v.push(`answer box does not contain month ${p.m}`)
  }
  return v
}

// The settings axes, sampled per iteration.
const RANGES = [
  [1, 3],
  [1, 1],
  [1, 5],
  [1583, 10000],
  [1580, 1585],
  [1582, 1582],
  [1581, 1583],
  [100, 200],
  [9990, 10000],
  [1500, 1700],
]
const CHANCES = ['random', 0, 0.5, 1]
const FORMATS = ['numeric-ymd', 'numeric-mdy', 'numeric-dmy', 'written-mdy', 'written-dmy']
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]

// The app NEVER asks for a Year puzzle from a range that can't hold one: DeductionMode computes
// yearSubPossible, disables the Year chip while it is false, and switches an already-selected Year
// to Day the moment it goes false (src/modes/DeductionMode.tsx). makeDedPuzzle relies on that —
// "No fallback: the Year sub-mode playability contract (yearSubPossible) keeps this from being
// called for an unbuildable range in normal play" (src/lib/dedPuzzle.ts) — so on an unbuildable
// range it just exhausts its 3000-attempt bound and returns null.
//
// ⚠ WHY THE FUZZ MUST RESPECT THIS (the intermittent-failure root cause). Without it, a third
// of the draws asked Year for ranges the app forbids: 7,351 of 60,000 calls returned null, and
// those calls alone burned 96.7% of the test's runtime — while asserting NOTHING, because
// checkPuzzle(null) returns [] by design. The test therefore cost ~4s of pure CPU for ~0.14s of
// actual checking, which under full-suite worker contention stretched past the 20s per-test budget
// and failed the run at random (reproduced 6 times in 10 consecutive full-suite runs; the test's
// own reported duration was 20.6-22.7s against 6.0s standalone). Restating the contract here is not
// a narrowing of coverage — it spends those 7,351 iterations on puzzles that actually get checked.
// Deliberately RESTATED rather than imported: a fuzz that fed itself from the implementation it
// probes could not notice the implementation drifting. The unbuildable side is pinned by its own
// test below, so the branch this skips is still covered — just at a bounded cost.
const yearSubPossible = (lo, hi, useJulian) => {
  const a = Math.max(1, lo)
  if (hi - a + 1 >= 5) return true
  if (!useJulian) return false
  const has1581 = a <= 1581 && hi >= 1581,
    has1582 = a <= 1582 && hi >= 1582,
    has1583 = a <= 1583 && hi >= 1583
  return (has1582 && has1583) || (has1581 && has1582)
}

describe('date-generation fuzz — every setting yields a real, answerable question', () => {
  it('randomDate produces only real, answerable weekday questions across all settings', () => {
    const rnd = mulberry32(12345)
    const dateRng = mulberry32(67890)
    const realRandom = Math.random
    Math.random = () => dateRng()
    try {
      const violations = []
      let count = 0
      for (let i = 0; i < 40000; i++) {
        const [lo, hi] = pick(rnd, RANGES)
        const julian = rnd() < 0.5
        const q = randomDate(
          lo,
          hi,
          julian,
          pick(rnd, CHANCES),
          pick(rnd, CHANCES),
          pick(rnd, CHANCES),
        )
        count++
        const v = checkWeekday(q, lo, hi)
        if (v.length) {
          violations.push(`[${lo},${hi}] jul=${julian} → ${JSON.stringify(q)} :: ${v.join('; ')}`)
          if (violations.length >= 5) break
        }
      }
      expect(violations, violations.slice(0, 5).join('\n')).toEqual([])
      expect(count).toBeGreaterThan(0)
    } finally {
      Math.random = realRandom
    }
  })

  it('makeDedPuzzle produces only real, answerable puzzles across all settings + toggles', () => {
    const rnd = mulberry32(2468)
    const dateRng = mulberry32(13579)
    const realRandom = Math.random
    Math.random = () => dateRng()
    try {
      const violations = []
      const built = { day: 0, month: 0, year: 0 }
      for (let i = 0; i < 60000; i++) {
        const [lo, hi] = pick(rnd, RANGES)
        const drawn = pick(rnd, ['day', 'month', 'year'])
        const opts = {
          useJulian: rnd() < 0.5,
          leapChance: pick(rnd, CHANCES),
          janFebChance: pick(rnd, CHANCES),
          randomFormat: rnd() < 0.5,
          dateFormat: pick(rnd, FORMATS),
          abCrossOnly: rnd() < 0.5,
          julCrossOnly: rnd() < 0.5,
          monthOnly1582: rnd() < 0.5,
        }
        // Exactly what the app does when the range can't hold a Year puzzle — DeductionMode's
        // `if (dedType === 'year' && !yearSubPossible) setDedType('day')`. See yearSubPossible above.
        const type = drawn === 'year' && !yearSubPossible(lo, hi, opts.useJulian) ? 'day' : drawn
        const p = makeDedPuzzle(type, lo, hi, opts)
        if (p != null) built[p.type]++
        const v = checkPuzzle(p)
        if (v.length) {
          violations.push(
            `${type} [${lo},${hi}] ${JSON.stringify(opts)} → ${JSON.stringify(p)} :: ${v.join('; ')}`,
          )
          if (violations.length >= 5) break
        }
      }
      expect(violations, violations.slice(0, 5).join('\n')).toEqual([])
      // Prove the fuzz actually built each puzzle type (not all null).
      expect(built.day).toBeGreaterThan(0)
      expect(built.month).toBeGreaterThan(0)
      expect(built.year).toBeGreaterThan(0)
    } finally {
      Math.random = realRandom
    }
  })

  // The other side of the yearSubPossible contract, pinned directly instead of being hammered by the
  // fuzz above (that was 96.7% of that test's runtime for zero assertions). When the app WOULD
  // have disabled the Year chip, makeDedPuzzle must fail CLEANLY: null, never a malformed or
  // unanswerable puzzle. A bounded sample is the right shape — the outcome is structural, not
  // probabilistic, so each configuration is exhausted-and-null on every attempt.
  it('an unbuildable Year range yields null, never a malformed puzzle', () => {
    const dateRng = mulberry32(24680)
    const realRandom = Math.random
    Math.random = () => dateRng()
    try {
      const unexpected = [] // anything built at all is the violation here
      let checked = 0
      for (const [lo, hi] of RANGES) {
        for (const useJulian of [false, true]) {
          if (yearSubPossible(lo, hi, useJulian)) continue
          for (const julCrossOnly of [false, true]) {
            for (let i = 0; i < 10; i++) {
              const p = makeDedPuzzle('year', lo, hi, {
                useJulian,
                leapChance: 'random',
                janFebChance: 'random',
                randomFormat: false,
                dateFormat: 'numeric-ymd',
                abCrossOnly: i % 2 === 0,
                julCrossOnly,
                monthOnly1582: false,
              })
              checked++
              if (p != null)
                unexpected.push(`[${lo},${hi}] jul=${useJulian} → ${JSON.stringify(p)}`)
            }
          }
        }
      }
      expect(unexpected, unexpected.slice(0, 5).join('\n')).toEqual([])
      // Prove the sweep found unbuildable configurations at all (not vacuously green).
      expect(checked).toBeGreaterThan(0)
    } finally {
      Math.random = realRandom
    }
  })

  // Targeted regression for the Oct 5-14 1582 gap-date leak: with useJulian OFF and the range
  // pinned to 1582, Deduction Day and Month must never produce a gap date as the answer, and Day's
  // October option windows must never include one. (Before the fix, both sub-modes' generic paths
  // could: Day drew d from an unrestricted window, Month drew d=rint(1,31).)
  it('Deduction Day/Month on [1582,1582] with Julian OFF never yields a gap date (answer or option)', () => {
    const dateRng = mulberry32(97531)
    const realRandom = Math.random
    Math.random = () => dateRng()
    try {
      const opts = {
        useJulian: false,
        leapChance: 'random',
        janFebChance: 'random',
        randomFormat: false,
        dateFormat: 'numeric-ymd',
        abCrossOnly: false,
        julCrossOnly: false,
        monthOnly1582: false,
      }
      const violations = []
      let oct1582Days = 0
      for (const type of ['day', 'month']) {
        for (let i = 0; i < 5000; i++) {
          const p = makeDedPuzzle(type, 1582, 1582, opts)
          if (p == null) continue
          if (p.type === 'day' && p.m === 10) oct1582Days++
          if (isGapDate(p.y, p.m, p.d)) violations.push(`${type} answer ${p.y}-${p.m}-${p.d}`)
          if (p.type === 'day' && p.m === 10 && p.options.some((o) => isGapDate(1582, 10, o)))
            violations.push(`day options ${p.options}`)
          if (violations.length >= 5) break
        }
      }
      expect(violations, violations.slice(0, 5).join('\n')).toEqual([])
      // Prove the loop actually reached October 1582 Day puzzles (not vacuously green).
      expect(oct1582Days).toBeGreaterThan(0)
    } finally {
      Math.random = realRandom
    }
  })
})
