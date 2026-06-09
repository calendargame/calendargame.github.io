// @vitest-environment jsdom
//
// tests/dateGen.dom.test.jsx — C2 Part 3: fuzz the REAL date/puzzle generators across ALL settings.
//
// The engine fuzz feeds the reducer pre-made random dates, so it never exercises the actual generators
// (randomDate + makeDedPuzzle) or the date-generation settings (calendar system, leap / Jan-Feb /
// Julian chances, year range, random-format, and Deduction's ab-Cross / Jul-Cross / 1582-only toggles).
// Those settings don't touch SCORING, but C2 wants that proven: drive the generators across the whole
// settings space and assert every output is a REAL, ANSWERABLE question — valid y/m/d for its calendar
// (not a dropped 1582 gap day), a correct shown weekday, and an answer that is actually among the
// options. A generator that ever produced a malformed or unanswerable question would desync the engine
// (correctIndexOf returns -1, the tripwire's "answer not among options"). (jsdom env: importing
// main.tsx reads matchMedia at module scope.)
import { describe, it, expect } from 'vitest'
import { randomDate, makeDedPuzzle } from '../src/main.jsx'
import { dim, isGapDate, isJulianDate, wday, wdayJulian } from '../src/lib/calendar.js'
import { correctIndexOf } from '../src/engine/gameReducer.js'

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const realWday = (y, m, d, jul) => (jul && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d))

// A generated weekday question must be a real, answerable date.
function checkWeekday(q, lo, hi) {
  const v = []
  const jul = !!q._jul
  if (!Number.isInteger(q.y)) v.push(`y not integer (${q.y})`)
  else if (q.y < Math.max(1, lo) || q.y > hi) v.push(`y ${q.y} out of [${Math.max(1, lo)},${hi}]`)
  if (!(Number.isInteger(q.m) && q.m >= 1 && q.m <= 12)) v.push(`m out of 1-12 (${q.m})`)
  else if (!(Number.isInteger(q.d) && q.d >= 1 && q.d <= dim(q.y, q.m, jul)))
    v.push(`d ${q.d} not in 1-${dim(q.y, q.m, jul)} for ${q.y}-${q.m} (jul=${jul})`)
  else if (!jul && isGapDate(q.y, q.m, q.d)) v.push(`Gregorian gap day ${q.y}-${q.m}-${q.d}`)
  const wd = correctIndexOf(q, jul)
  if (!(Number.isInteger(wd) && wd >= 0 && wd <= 6)) v.push(`weekday index ${wd} not 0-6`)
  return v
}

// A generated Deduction puzzle (or null = couldn't build, which the component handles) must be real,
// have a correct shown weekday, distinct options, and an answer actually among the options.
function checkPuzzle(p) {
  if (p == null) return [] // null is a legitimate "no valid puzzle for this range/config"
  const v = []
  const jul = !!p._jul
  if (!(Number.isInteger(p.m) && p.m >= 1 && p.m <= 12)) v.push(`m out of 1-12 (${p.m})`)
  else if (!(Number.isInteger(p.d) && p.d >= 1 && p.d <= dim(p.y, p.m, jul)))
    v.push(`d ${p.d} not valid for ${p.y}-${p.m}`)
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

describe('date-generation fuzz — every setting yields a real, answerable question (C2 Part 3)', () => {
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
        const q = randomDate(lo, hi, julian, pick(rnd, CHANCES), pick(rnd, CHANCES), pick(rnd, CHANCES))
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
        const type = pick(rnd, ['day', 'month', 'year'])
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
        const p = makeDedPuzzle(type, lo, hi, opts)
        if (p != null) built[p.type]++
        const v = checkPuzzle(p)
        if (v.length) {
          violations.push(`${type} [${lo},${hi}] ${JSON.stringify(opts)} → ${JSON.stringify(p)} :: ${v.join('; ')}`)
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
})
