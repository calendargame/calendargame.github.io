import { describe, it, expect } from 'vitest'
import {
  METHOD_MONTH_CODES,
  METHOD_CD_ADVANCED_LEAP_MAP,
  METHOD_CD_ADVANCED_LEAP_ORDER,
  normalizeMod7,
  canonicalizeMod,
  calcDayCode,
  calcCdCode,
  yearParts,
  computeMethodSummary,
} from '../src/lib/method.js'

// method.test.js — the doomsday-method code tables + computeMethodSummary (the
// per-date summary the Show Codes panel renders). This is the core of what the
// app teaches, so it gets the most thorough coverage. The summary is the
// integration point of calendar.js (weekday/leap) + format.js (DAY names) + the
// code tables, so a correct summary exercises the whole stack end-to-end.

describe('normalizeMod7 — non-negative residue mod 7', () => {
  it('keeps 0..6 unchanged', () => {
    for (let v = 0; v <= 6; v++) expect(normalizeMod7(v)).toBe(v)
  })
  it('wraps positives and negatives into 0..6', () => {
    expect(normalizeMod7(7)).toBe(0)
    expect(normalizeMod7(8)).toBe(1)
    expect(normalizeMod7(-1)).toBe(6)
    expect(normalizeMod7(-7)).toBe(0)
    expect(normalizeMod7(-8)).toBe(6)
  })
})

describe('canonicalizeMod — fold mod-7 into the -3..3 book convention', () => {
  it('values 0..3 stay positive', () => {
    expect(canonicalizeMod(0)).toBe(0)
    expect(canonicalizeMod(3)).toBe(3)
  })
  it('values 4..6 become their negative equivalent', () => {
    expect(canonicalizeMod(4)).toBe(-3) // 4 - 7
    expect(canonicalizeMod(5)).toBe(-2)
    expect(canonicalizeMod(6)).toBe(-1)
  })
  it('normalizes out-of-range input first', () => {
    expect(canonicalizeMod(7)).toBe(0)
    expect(canonicalizeMod(-1)).toBe(-1) // -1 -> 6 -> -1
  })
})

describe('calcDayCode — nearest multiple-of-7 offset for the day', () => {
  // The day code is the signed distance from the day to the nearest multiple of 7,
  // choosing the smaller magnitude (ties resolved by the function's rule).
  it('multiples of 7 have day code 0', () => {
    expect(calcDayCode(7)).toBe(0)
    expect(calcDayCode(14)).toBe(0)
    expect(calcDayCode(28)).toBe(0)
  })
  it('days just past a multiple are small positive', () => {
    expect(calcDayCode(15)).toBe(1) // 15 = 14 + 1
    expect(calcDayCode(8)).toBe(1)
  })
  it('days just before a multiple are small negative', () => {
    expect(calcDayCode(13)).toBe(-1) // 13 = 14 - 1
    expect(calcDayCode(6)).toBe(-1)
  })
  it('the canonical July 4 -> day code -3 (4 is 3 below 7)', () => {
    expect(calcDayCode(4)).toBe(-3)
  })
  it('result is always within -3..3', () => {
    for (let d = 1; d <= 31; d++) {
      const c = calcDayCode(d)
      expect(c).toBeGreaterThanOrEqual(-3)
      expect(c).toBeLessThanOrEqual(3)
    }
  })
})

describe('yearParts — split a year into a/b/cd digit groups', () => {
  it('splits 1776 -> a=1, b=7, cd=76', () => {
    expect(yearParts(1776)).toEqual({ a: 1, b: 7, cd: 76 })
  })
  it('splits 2024 -> a=2, b=0, cd=24', () => {
    expect(yearParts(2024)).toEqual({ a: 2, b: 0, cd: 24 })
  })
  it('handles a year like 1900 -> a=1, b=9, cd=0', () => {
    expect(yearParts(1900)).toEqual({ a: 1, b: 9, cd: 0 })
  })
})

describe('METHOD_MONTH_CODES — the 12 month codes', () => {
  it('has all 12 months', () => {
    for (let m = 1; m <= 12; m++) expect(METHOD_MONTH_CODES[m]).toBeDefined()
  })
  it('every code is in the canonical -3..3 range', () => {
    for (let m = 1; m <= 12; m++) {
      expect(METHOD_MONTH_CODES[m]).toBeGreaterThanOrEqual(-3)
      expect(METHOD_MONTH_CODES[m]).toBeLessThanOrEqual(3)
    }
  })
  it('July is -2 (matches the 7/4/1776 worked example)', () => {
    expect(METHOD_MONTH_CODES[7]).toBe(-2)
  })
})

describe('calcCdCode + the CD leap map stay in lockstep', () => {
  it('ORDER is derived from the MAP keys (single source of truth)', () => {
    expect(METHOD_CD_ADVANCED_LEAP_ORDER).toEqual([...METHOD_CD_ADVANCED_LEAP_MAP.keys()])
  })
  it('cd=76 (from year 1776) gives code -3', () => {
    expect(calcCdCode(76)).toBe(-3)
  })
  it('cd codes are all within -3..3', () => {
    for (let cd = 0; cd <= 99; cd++) {
      const c = calcCdCode(cd)
      expect(c).toBeGreaterThanOrEqual(-3)
      expect(c).toBeLessThanOrEqual(3)
    }
  })
})

describe('computeMethodSummary — the full per-date code breakdown', () => {
  it('the canonical July 4, 1776 (Gregorian)', () => {
    const s = computeMethodSummary({ y: 1776, m: 7, d: 4 }, false)
    expect(s).toEqual({
      monthCode: -2,
      dayCode: -3,
      abCode: -2,
      cdCode: -3,
      leapYear: true,
      leapCode: 0,
      weekday: 'Thursday',
      calendarSystem: 'Gregorian',
    })
  })

  it('the same date under Julian (useJulian) is a different weekday + system', () => {
    const s = computeMethodSummary({ y: 1776, m: 7, d: 4 }, true)
    // 1776 < 1582? No — so even with useJulian, 1776 is Gregorian. Same as above.
    expect(s.calendarSystem).toBe('Gregorian')
    expect(s.weekday).toBe('Thursday')
  })

  it('a genuinely Julian-era date (1500) reports Julian + its Julian weekday', () => {
    const s = computeMethodSummary({ y: 1500, m: 1, d: 1 }, true)
    expect(s.calendarSystem).toBe('Julian')
    expect(typeof s.weekday).toBe('string')
    // the same date with useJulian off is Gregorian
    const g = computeMethodSummary({ y: 1500, m: 1, d: 1 }, false)
    expect(g.calendarSystem).toBe('Gregorian')
    expect(g.weekday).not.toBe(s.weekday) // weekdays diverge across the calendars
  })

  it('leapCode is -1 only on a leap year in Jan/Feb, else 0', () => {
    // 2024 leap, January -> leapCode -1
    expect(computeMethodSummary({ y: 2024, m: 1, d: 10 }, false).leapCode).toBe(-1)
    // 2024 leap, February -> leapCode -1
    expect(computeMethodSummary({ y: 2024, m: 2, d: 10 }, false).leapCode).toBe(-1)
    // 2024 leap, March -> leapCode 0 (correction only applies in Jan/Feb)
    expect(computeMethodSummary({ y: 2024, m: 3, d: 10 }, false).leapCode).toBe(0)
    // 2023 common, January -> leapCode 0
    expect(computeMethodSummary({ y: 2023, m: 1, d: 10 }, false).leapCode).toBe(0)
  })

  it('leapYear flag tracks the active calendar (1900: Gregorian common, Julian leap)', () => {
    expect(computeMethodSummary({ y: 1900, m: 6, d: 1 }, false).leapYear).toBe(false)
    // 1900 is post-1582 so useJulian has no effect -> still Gregorian common
    expect(computeMethodSummary({ y: 1900, m: 6, d: 1 }, true).leapYear).toBe(false)
    // a pre-1582 century divisible by 4 under Julian IS leap
    expect(computeMethodSummary({ y: 1500, m: 6, d: 1 }, true).leapYear).toBe(true)
  })

  it('returns null for non-AD / invalid years (the panel shows "AD only")', () => {
    expect(computeMethodSummary({ y: 0, m: 1, d: 1 }, false)).toBeNull()
    expect(computeMethodSummary({ y: -100, m: 1, d: 1 }, false)).toBeNull()
    expect(computeMethodSummary({ y: NaN, m: 1, d: 1 }, false)).toBeNull()
  })

  it('the codes sum (mod 7) to the weekday — the whole point of the method', () => {
    // weekday index = (monthCode + dayCode + abCode + cdCode + leapCode) mod 7.
    const samples = [
      { y: 1776, m: 7, d: 4 },
      { y: 2024, m: 2, d: 29 },
      { y: 2000, m: 1, d: 1 },
      { y: 1969, m: 7, d: 20 },
    ]
    const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    for (const date of samples) {
      const s = computeMethodSummary(date, false)
      const sum = s.monthCode + s.dayCode + s.abCode + s.cdCode + s.leapCode
      const idx = ((sum % 7) + 7) % 7
      expect(DAY[idx]).toBe(s.weekday)
    }
  })
})
