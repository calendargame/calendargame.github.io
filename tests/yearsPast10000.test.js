// tests/yearsPast10000.test.js — YEARS 10001-11582, which a range reaches with the Julian Calendar
// setting on (Round 26, Q7), checked against oracles that share no code with lib/calendar.
//
// The claim: they are modern-calendar (Gregorian) years, and because 10000 = 25 x 400 each one
// repeats year (y - 10000) of the modern calendar exactly — weekdays, leap years, month lengths, and
// the codes the method teaches. They are never Julian, never the 1582 gap, never "Julian only".
import { describe, it, expect } from 'vitest'
import {
  wday,
  isLeap,
  dim,
  dimEither,
  isJulianDate,
  isGapDate,
  isJulianOnlyDate,
  rangeHasLeapYear,
  rangeHasCommonYear,
  yearMaxFor,
  YEAR_MAX_GREGORIAN,
  YEAR_MAX_JULIAN,
} from '../src/lib/calendar.js'
import { computeMethodSummary, yearParts, normalizeMod7 } from '../src/lib/method.js'
import { DAY } from '../src/lib/format.js'

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate() // the platform's own calendar
// Every day from December 31, 9999 to December 31, 11582, in order.
function* days() {
  yield [9999, 12, 31]
  for (let y = 10000; y <= YEAR_MAX_JULIAN; y++)
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= daysIn(y, m); d++) yield [y, m, d]
}

describe('the caps', () => {
  it('10000 with the Julian Calendar setting off, 11582 with it on', () => {
    expect([YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN]).toEqual([10000, 11582])
    expect([yearMaxFor(false), yearMaxFor(true)]).toEqual([10000, 11582])
  })
})

describe('O1: every weekday, 9999-12-31 to 11582-12-31', () => {
  it('equals the platform calendar (JavaScript Date, UTC) and a plain one-day-at-a-time walk', () => {
    let walk = wday(9999, 12, 31)
    expect(walk).toBe(new Date(Date.UTC(9999, 11, 31)).getUTCDay())
    let first = true
    const wrong = []
    for (const [y, m, d] of days()) {
      if (!first) walk = (walk + 1) % 7
      first = false
      const w = wday(y, m, d)
      if (w !== walk || w !== new Date(Date.UTC(y, m - 1, d)).getUTCDay())
        wrong.push(`${y}-${m}-${d}`)
    }
    expect(wrong).toEqual([])
  })
})

describe('O2: year y + 10000 repeats year y of the modern calendar, for y in 1-1582', () => {
  it('weekday of every day, leap year, and month lengths', () => {
    const wrong = []
    for (let y = 1; y <= 1582; y++) {
      if (isLeap(y + 10000) !== isLeap(y)) wrong.push(`leap ${y}`)
      for (let m = 1; m <= 12; m++) {
        if (dim(y + 10000, m) !== dim(y, m)) wrong.push(`dim ${y}-${m}`)
        for (let d = 1; d <= dim(y, m); d++)
          if (wday(y + 10000, m, d) !== wday(y, m, d)) wrong.push(`${y}-${m}-${d}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('O3: the codes for every date past 10000', () => {
  it('the summary says Gregorian, the codes add up to the weekday, and every field is year (y - 10000)’s with Julian off', () => {
    const wrong = []
    for (const [y, m, d] of days()) {
      if (y <= 10000) continue
      const s = computeMethodSummary({ y, m, d }, true)
      const sum = normalizeMod7(s.monthCode + s.dayCode + s.abCode + s.cdCode + s.leapCode)
      const twin = computeMethodSummary({ y: y - 10000, m, d }, false)
      if (s.calendarSystem !== 'Gregorian' || DAY[sum] !== s.weekday) wrong.push(`${y}-${m}-${d}`)
      else if (JSON.stringify(s) !== JSON.stringify(twin)) wrong.push(`twin ${y}-${m}-${d}`)
    }
    expect(wrong).toEqual([])
  })
})

describe('O4: never Julian, never the gap, never a date only the Julian calendar has', () => {
  it('every date 1583-11582', () => {
    const wrong = []
    for (let y = 1583; y <= YEAR_MAX_JULIAN; y++)
      for (let m = 1; m <= 12; m++) {
        if (dimEither(y, m) !== dim(y, m)) wrong.push(`dimEither ${y}-${m}`)
        for (let d = 1; d <= dim(y, m); d++)
          if (isJulianDate(y, m, d) || isGapDate(y, m, d) || isJulianOnlyDate(y, m, d))
            wrong.push(`${y}-${m}-${d}`)
      }
    expect(wrong).toEqual([])
    expect(isGapDate(11582, 10, 10)).toBe(false) // October 10, 11582 is an ordinary day
  })
})

describe('O5: the year’s parts, by hand', () => {
  it.each([
    [11582, { a: 1, b: 5, cd: 82 }],
    [10000, { a: 0, b: 0, cd: 0 }],
    [10432, { a: 0, b: 4, cd: 32 }],
  ])('%i', (y, parts) => expect(yearParts(y)).toEqual(parts))
})

describe('O9: the leap-year questions are bounded by the cap for the setting they are asked under', () => {
  it('Julian on reaches 11582; Julian off stops at 10000 and does not walk on', () => {
    expect(rangeHasLeapYear(10001, 11582, true)).toBe(true)
    expect(rangeHasLeapYear(10001, 11582, false)).toBe(false) // clamps to 10000: nothing left
    expect(rangeHasLeapYear(10001, 10003, true)).toBe(false)
    expect(rangeHasLeapYear(10004, 10004, true)).toBe(true)
    expect(rangeHasCommonYear(10004, 10004, true)).toBe(false)
    expect(rangeHasCommonYear(10001, 11582, false)).toBe(false)
  })
})
