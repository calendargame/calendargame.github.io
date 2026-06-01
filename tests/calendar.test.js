import { describe, it, expect } from 'vitest'
import {
  toAstro,
  isLeap,
  isLeapJulian,
  dim,
  jdnGregorian,
  wday,
  jdnJulian,
  wdayJulian,
  isJulianDate,
  isGapDate,
  rangeHasLeapYear,
} from '../src/lib/calendar.js'

// calendar.test.js — the foundational date math. Every assertion is checked
// against a KNOWN-CORRECT oracle (real historical weekdays, documented leap-year
// rules, the 1582 Gregorian reform), not against "whatever the code returns" —
// so these tests actually pin behavior rather than rubber-stamp it.

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

describe('toAstro — historical → astronomical year numbering', () => {
  // Astronomical numbering has a year 0 (= 1 BC); 2 BC = -1, etc. AD years unchanged.
  it('leaves AD years unchanged', () => {
    expect(toAstro(2024)).toBe(2024)
    expect(toAstro(1)).toBe(1)
  })
  it('maps 1 BC to 0', () => {
    expect(toAstro(-1)).toBe(0)
  })
  it('maps 2 BC to -1, 100 BC to -99', () => {
    expect(toAstro(-2)).toBe(-1)
    expect(toAstro(-100)).toBe(-99)
  })
})

describe('isLeap — Gregorian leap-year rule', () => {
  it('divisible by 4 is leap', () => {
    expect(isLeap(2024)).toBe(true)
    expect(isLeap(2020)).toBe(true)
  })
  it('not divisible by 4 is common', () => {
    expect(isLeap(2023)).toBe(false)
    expect(isLeap(2019)).toBe(false)
  })
  it('century years are NOT leap unless divisible by 400', () => {
    expect(isLeap(1900)).toBe(false) // /100 but not /400
    expect(isLeap(1800)).toBe(false)
    expect(isLeap(2100)).toBe(false)
    expect(isLeap(2000)).toBe(true) // /400
    expect(isLeap(1600)).toBe(true)
  })
  it('handles BC (astronomical) years', () => {
    // 1 BC = astronomical 0, divisible by 400 -> leap
    expect(isLeap(-1)).toBe(true)
    // 5 BC = astronomical -4, divisible by 4, not century -> leap
    expect(isLeap(-5)).toBe(true)
    // 2 BC = astronomical -1 -> common
    expect(isLeap(-2)).toBe(false)
  })
})

describe('isLeapJulian — Julian leap-year rule (every 4th year, no century exception)', () => {
  it('every year divisible by 4 is leap — including centuries', () => {
    expect(isLeapJulian(1900)).toBe(true) // Julian: leap (differs from Gregorian!)
    expect(isLeapJulian(1800)).toBe(true)
    expect(isLeapJulian(1500)).toBe(true)
    expect(isLeapJulian(2000)).toBe(true)
  })
  it('non-multiples of 4 are common', () => {
    expect(isLeapJulian(1901)).toBe(false)
    expect(isLeapJulian(1583)).toBe(false)
  })
  it('1900 is the canonical Julian-vs-Gregorian divergence', () => {
    expect(isLeapJulian(1900)).toBe(true)
    expect(isLeap(1900)).toBe(false)
  })
})

describe('dim — days in month', () => {
  it('31-day months', () => {
    for (const m of [1, 3, 5, 7, 8, 10, 12]) expect(dim(2023, m)).toBe(31)
  })
  it('30-day months', () => {
    for (const m of [4, 6, 9, 11]) expect(dim(2023, m)).toBe(30)
  })
  it('February: 28 common, 29 leap (Gregorian)', () => {
    expect(dim(2023, 2)).toBe(28)
    expect(dim(2024, 2)).toBe(29)
    expect(dim(1900, 2)).toBe(28) // Gregorian century non-leap
    expect(dim(2000, 2)).toBe(29) // Gregorian /400 leap
  })
  it('February under Julian rule (julian=true)', () => {
    expect(dim(1900, 2, true)).toBe(29) // Julian: 1900 IS leap
    expect(dim(1500, 2, true)).toBe(29)
    expect(dim(1901, 2, true)).toBe(28)
  })
})

describe('wday — Gregorian weekday (0=Sun … 6=Sat)', () => {
  // Oracle weekdays from independent sources (proleptic Gregorian).
  const cases = [
    [1776, 7, 4, 'Thursday'], // US Independence
    [2000, 1, 1, 'Saturday'], // Y2K
    [1970, 1, 1, 'Thursday'], // Unix epoch
    [2024, 2, 29, 'Thursday'], // a leap day
    [1, 1, 1, 'Monday'], // proleptic Gregorian year 1
    [2026, 5, 31, 'Sunday'], // a "today"-era date
  ]
  for (const [y, m, d, name] of cases) {
    it(`${y}-${m}-${d} is ${name}`, () => {
      expect(DAY[wday(y, m, d)]).toBe(name)
    })
  }
  it('returns an integer 0..6 for arbitrary dates', () => {
    const w = wday(1969, 7, 20) // moon landing
    expect(Number.isInteger(w)).toBe(true)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(6)
  })
})

describe('wdayJulian — Julian weekday', () => {
  // Oct 4, 1582 (Julian) was a Thursday; the next day was Oct 15 (Gregorian), a Friday.
  it('Oct 4, 1582 (Julian) is Thursday', () => {
    expect(DAY[wdayJulian(1582, 10, 4)]).toBe('Thursday')
  })
  it('differs from Gregorian for a pre-reform date', () => {
    // For the same calendar-date label, Julian and Gregorian weekdays diverge.
    const j = wdayJulian(1500, 1, 1)
    const g = wday(1500, 1, 1)
    expect(j).not.toBe(g)
  })
})

describe('jdnGregorian / jdnJulian — Julian Day Numbers', () => {
  it('JDN increments by exactly 1 per day', () => {
    expect(jdnGregorian(2024, 1, 2) - jdnGregorian(2024, 1, 1)).toBe(1)
    expect(jdnJulian(1500, 6, 16) - jdnJulian(1500, 6, 15)).toBe(1)
  })
  it('the 1582 reform: Oct 15 Gregorian == Oct 5 Julian (10-day jump, consecutive days)', () => {
    // Oct 4 Julian and Oct 15 Gregorian were consecutive calendar days in history.
    expect(jdnGregorian(1582, 10, 15) - jdnJulian(1582, 10, 4)).toBe(1)
  })
  it('JDN is monotonic across a month boundary', () => {
    expect(jdnGregorian(2024, 3, 1) - jdnGregorian(2024, 2, 29)).toBe(1)
  })
})

describe('isJulianDate — which dates use the Julian calendar', () => {
  it('everything on/before Oct 4, 1582 is Julian', () => {
    expect(isJulianDate(1582, 10, 4)).toBe(true)
    expect(isJulianDate(1582, 9, 30)).toBe(true)
    expect(isJulianDate(1000, 1, 1)).toBe(true)
    expect(isJulianDate(1, 1, 1)).toBe(true)
  })
  it('everything on/after Oct 15, 1582 is Gregorian (not Julian)', () => {
    expect(isJulianDate(1582, 10, 15)).toBe(false)
    expect(isJulianDate(1582, 11, 1)).toBe(false)
    expect(isJulianDate(1583, 1, 1)).toBe(false)
    expect(isJulianDate(2024, 1, 1)).toBe(false)
  })
  it('year 1582 is mixed: Jan–Sep + Oct 1–4 Julian, Oct 15+ Gregorian', () => {
    expect(isJulianDate(1582, 1, 1)).toBe(true)
    expect(isJulianDate(1582, 10, 1)).toBe(true)
    expect(isJulianDate(1582, 10, 4)).toBe(true)
    expect(isJulianDate(1582, 12, 31)).toBe(false)
  })
})

describe('isGapDate — Oct 5–14, 1582 never existed', () => {
  it('the 10 skipped days are gap dates', () => {
    for (let d = 5; d <= 14; d++) expect(isGapDate(1582, 10, d)).toBe(true)
  })
  it('Oct 4 and Oct 15, 1582 are NOT gap dates (they bracket the gap)', () => {
    expect(isGapDate(1582, 10, 4)).toBe(false)
    expect(isGapDate(1582, 10, 15)).toBe(false)
  })
  it('the gap is only in Oct 1582 — same day numbers in other months/years are fine', () => {
    expect(isGapDate(1582, 9, 10)).toBe(false)
    expect(isGapDate(1581, 10, 10)).toBe(false)
    expect(isGapDate(1583, 10, 10)).toBe(false)
    expect(isGapDate(2024, 10, 10)).toBe(false)
  })
})

describe('rangeHasLeapYear — is any leap year reachable in [lo, hi]?', () => {
  it('true when the range clearly contains leap years (Gregorian)', () => {
    expect(rangeHasLeapYear(2020, 2030, false)).toBe(true) // 2020,2024,2028
  })
  it('false for an all-common Gregorian span', () => {
    // 1700–1703: 1700 is a Gregorian century non-leap; 1701-1703 not /4. None leap.
    expect(rangeHasLeapYear(1700, 1703, false)).toBe(false)
  })
  it('Julian rule reaches leap years a Gregorian range would not (PRE-1582 only)', () => {
    // The Julian rule only applies to years < 1582 (the reform year). 1500 is a
    // Julian-era century: leap under Julian (every /4), NOT leap under Gregorian.
    // So a range whose only /4 year is 1500 has a leap year iff useJulian is on.
    expect(rangeHasLeapYear(1500, 1503, true)).toBe(true) // Julian: 1500 is leap
    expect(rangeHasLeapYear(1500, 1503, false)).toBe(false) // Gregorian: 1500 not leap
  })
  it('post-1582 years always use the Gregorian rule, even with useJulian on', () => {
    // 1700 is AFTER the reform, so the Julian rule does NOT apply there: 1700 is a
    // Gregorian century non-leap regardless of the useJulian flag. (Documents the
    // y < 1582 guard in rangeHasLeapYear.)
    expect(rangeHasLeapYear(1700, 1703, true)).toBe(false)
    expect(rangeHasLeapYear(1700, 1703, false)).toBe(false)
  })
  it('single-year ranges', () => {
    expect(rangeHasLeapYear(2024, 2024, false)).toBe(true)
    expect(rangeHasLeapYear(2023, 2023, false)).toBe(false)
  })
})
