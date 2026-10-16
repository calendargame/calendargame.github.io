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
  dimEither,
  isJulianOnlyDate,
  rangeHasLeapYear,
  rangeHasCommonYear,
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

// dimEither answers "is this a real date?" for a Lookup, where a pre-reform date can be read in
// EITHER calendar — so a day that exists in either one is a date. The only place the two rules
// disagree is February, and only before the reform can both apply.
describe('dimEither — days in month under any calendar the date can be read in', () => {
  it('agrees with dim everywhere the two leap rules cannot both apply', () => {
    for (const y of [1583, 1600, 1900, 2000, 2023, 2024])
      for (let m = 1; m <= 12; m++) expect(dimEither(y, m), `${y}-${m}`).toBe(dim(y, m))
  })
  it('pre-reform February takes the Julian 29th where Gregorian has only 28', () => {
    expect(dimEither(1500, 2)).toBe(29) // Julian leap (every /4), Gregorian century non-leap
    expect(dimEither(300, 2)).toBe(29)
    expect(dimEither(1200, 2)).toBe(29) // leap under both — same answer, different reason
    expect(dimEither(1501, 2)).toBe(28) // leap under neither
  })
  it('the rule ends with the Julian era, not with the year 1582', () => {
    // October 1582 straddles the reform and has 31 days under both calendars, so the whole month
    // counts as ambiguous without changing any answer. November is past it.
    expect(dimEither(1582, 10)).toBe(31)
    expect(dimEither(1582, 2)).toBe(28) // 1582 is leap under neither rule
    expect(dimEither(1584, 2)).toBe(29) // Gregorian leap, and the Julian rule no longer applies
    expect(dimEither(1700, 2)).toBe(28) // Julian WOULD say 29 — but 1700 is not a Julian-era year
  })
})

// isJulianOnlyDate — the dates the two calendars disagree about the EXISTENCE of. A date drawn with
// the Julian Calendar setting on can be one; with the setting off it must never be asked or judged
// as if the Gregorian calendar had it (engine/gameReducer's calendarOf and waitingDateMissing).
describe('isJulianOnlyDate — a day the Julian calendar has and the Gregorian one never did', () => {
  // The years the app can draw from that are leap by the Julian rule alone, before the reform.
  const JULIAN_ONLY_LEAP = [100, 200, 300, 500, 600, 700, 900, 1000, 1100, 1300, 1400, 1500]

  it('is exactly February 29 of the century years the Gregorian rule drops, and nothing else', () => {
    const found = []
    for (let y = 1; y <= 2400; y++)
      for (let m = 1; m <= 12; m++)
        for (let d = 1; d <= 31; d++) if (isJulianOnlyDate(y, m, d)) found.push(`${y}-${m}-${d}`)
    expect(found).toEqual(JULIAN_ONLY_LEAP.map((y) => `${y}-2-29`))
  })
  it('the day before and the day after are ordinary dates', () => {
    expect(isJulianOnlyDate(1500, 2, 28)).toBe(false)
    expect(isJulianOnlyDate(1500, 3, 1)).toBe(false)
    expect(isJulianOnlyDate(1500, 2, 30)).toBe(false) // not a date in either calendar
  })
  it('a leap day both calendars have is not one, and nor is anything after the reform', () => {
    expect(isJulianOnlyDate(1200, 2, 29)).toBe(false) // 1200 divides by 400
    expect(isJulianOnlyDate(1504, 2, 29)).toBe(false)
    expect(isJulianOnlyDate(1700, 2, 29)).toBe(false) // Julian would say leap — not a Julian-era year
    expect(isJulianOnlyDate(1900, 2, 29)).toBe(false)
  })
  it('holds before year 1 too (the same centuries, counted astronomically)', () => {
    expect(isJulianOnlyDate(-101, 2, 29)).toBe(true) //  101 BC = astronomical −100
    expect(isJulianOnlyDate(-401, 2, 29)).toBe(false) // 401 BC = astronomical −400
  })

  // ★ THE OTHER DIRECTION DOES NOT EXIST, which is why only "Julian switched OFF" ever has a waiting
  // date to replace: every date the Gregorian rules give a month is a date under the Julian setting
  // too. Walked, not argued — every day of every month the Gregorian calendar has, across the whole
  // range a year box accepts and a stretch BC, exists in the calendar the Julian setting reads it in
  // (Julian up to October 4, 1582; Gregorian after).
  it('no date the Gregorian calendar has is missing under the Julian setting', () => {
    const missing = []
    for (let y = -800; y <= 10000; y++) {
      if (y === 0) continue
      for (let m = 1; m <= 12; m++)
        for (let d = 1; d <= dim(y, m); d++) {
          if (isGapDate(y, m, d)) continue // the ten days neither setting ever draws
          if (d > dim(y, m, isJulianDate(y, m, d))) missing.push(`${y}-${m}-${d}`)
        }
    }
    expect(missing).toEqual([])
  })
  it('…while the Julian setting has exactly the Julian-only dates that the Gregorian one lacks', () => {
    const lacking = []
    for (let y = 1; y <= 1582; y++)
      for (let m = 1; m <= 12; m++)
        for (let d = 1; d <= dim(y, m, true); d++)
          if (isJulianDate(y, m, d) && d > dim(y, m)) lacking.push(`${y}-${m}-${d}`)
    expect(lacking).toEqual(JULIAN_ONLY_LEAP.map((y) => `${y}-2-29`))
    for (const y of JULIAN_ONLY_LEAP) {
      expect(isLeapJulian(y), `${y}`).toBe(true)
      expect(isLeap(y), `${y}`).toBe(false)
    }
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

describe('rangeHasCommonYear — is any year in [lo, hi] NOT a leap year?', () => {
  it('every range of two years or more has one (two years in a row are never both leap years)', () => {
    for (let y = 1; y < 10000; y += 97) expect(rangeHasCommonYear(y, y + 1, true)).toBe(true)
  })
  it('a single year: by its own calendar', () => {
    expect(rangeHasCommonYear(2024, 2024, false)).toBe(false)
    expect(rangeHasCommonYear(2023, 2023, false)).toBe(true)
    expect(rangeHasCommonYear(1100, 1100, true)).toBe(false) // Julian: 1100 is leap
    expect(rangeHasCommonYear(1100, 1100, false)).toBe(true) // Gregorian: it is not
    expect(rangeHasCommonYear(1700, 1700, true)).toBe(true) // after the reform: Gregorian
  })
  it('an empty range has none', () => {
    expect(rangeHasCommonYear(5, 4, false)).toBe(false)
  })
})
