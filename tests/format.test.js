import { describe, it, expect } from 'vitest'
import { MONTH, DAY, fmtYear, fmt, fmtPartial, numericFormatOf } from '../src/lib/format.js'

// format.test.js — the date-display layer: the MONTH/DAY name tables and the
// formatters that turn (y, m, d) into the visible string in each of the 5
// supported formats. Oracle values match the documented format conventions:
//   written-mdy  April 27, 1828   |  written-dmy  27 April 1828
//   numeric-mdy  4/27/1828        |  numeric-dmy  27.4.1828
//   numeric-ymd  1828-4-27
// Convention: numeric MDY uses /, DMY uses ., YMD uses -. Full year, no leading
// zeros, no ordinals.

describe('MONTH / DAY name tables', () => {
  it('MONTH has 12 entries, Jan..Dec', () => {
    expect(MONTH).toHaveLength(12)
    expect(MONTH[0]).toBe('January')
    expect(MONTH[11]).toBe('December')
    expect(MONTH[6]).toBe('July')
  })
  it('DAY has 7 entries, Sun..Sat (index = weekday number)', () => {
    expect(DAY).toHaveLength(7)
    expect(DAY[0]).toBe('Sunday')
    expect(DAY[6]).toBe('Saturday')
    expect(DAY[4]).toBe('Thursday')
  })
})

describe('fmtYear — year rendering', () => {
  it('AD years render as the plain number', () => {
    expect(fmtYear(1828)).toBe('1828')
    expect(fmtYear(1)).toBe('1')
    expect(fmtYear(10000)).toBe('10000')
  })
  it('non-positive years render as "N BC"', () => {
    expect(fmtYear(0)).toBe('0 BC')
    expect(fmtYear(-43)).toBe('43 BC')
  })
})

describe('fmt — full date in each of the 5 formats', () => {
  // One canonical date through every format.
  it('written-mdy (default)', () => {
    expect(fmt(1828, 4, 27, 'written-mdy')).toBe('April 27, 1828')
    expect(fmt(1828, 4, 27)).toBe('April 27, 1828') // default arg
  })
  it('written-dmy', () => {
    expect(fmt(1828, 4, 27, 'written-dmy')).toBe('27 April 1828')
  })
  it('numeric-mdy uses slashes', () => {
    expect(fmt(1828, 4, 27, 'numeric-mdy')).toBe('4/27/1828')
  })
  it('numeric-dmy uses dots', () => {
    expect(fmt(1828, 4, 27, 'numeric-dmy')).toBe('27.4.1828')
  })
  it('numeric-ymd uses dashes', () => {
    expect(fmt(1828, 4, 27, 'numeric-ymd')).toBe('1828-4-27')
  })
  it('no leading zeros on single-digit month/day', () => {
    expect(fmt(2024, 1, 5, 'numeric-mdy')).toBe('1/5/2024')
    expect(fmt(2024, 1, 5, 'numeric-dmy')).toBe('5.1.2024')
    expect(fmt(2024, 1, 5, 'numeric-ymd')).toBe('2024-1-5')
  })
  it('the canonical 7/4/1776 in every format', () => {
    expect(fmt(1776, 7, 4, 'written-mdy')).toBe('July 4, 1776')
    expect(fmt(1776, 7, 4, 'written-dmy')).toBe('4 July 1776')
    expect(fmt(1776, 7, 4, 'numeric-mdy')).toBe('7/4/1776')
    expect(fmt(1776, 7, 4, 'numeric-dmy')).toBe('4.7.1776')
    expect(fmt(1776, 7, 4, 'numeric-ymd')).toBe('1776-7-4')
  })
  it('BC years carry through every format', () => {
    expect(fmt(-43, 3, 15, 'written-mdy')).toBe('March 15, 43 BC')
    expect(fmt(-43, 3, 15, 'numeric-mdy')).toBe('3/15/43 BC')
    expect(fmt(-43, 3, 15, 'numeric-ymd')).toBe('43 BC-3-15')
  })
  it('an unknown formatId falls back to written-mdy', () => {
    expect(fmt(1828, 4, 27, 'nonsense')).toBe('April 27, 1828')
  })
})

describe('fmtPartial — Deduction placeholder for the missing piece', () => {
  // The missing piece ('day' | 'month' | 'year') is replaced by '__', the rest
  // honors the format.
  it('missing day', () => {
    expect(fmtPartial(1776, 7, 4, 'written-mdy', 'day')).toBe('July __, 1776')
    expect(fmtPartial(1776, 7, 4, 'numeric-mdy', 'day')).toBe('7/__/1776')
  })
  it('missing month (name vs number per format)', () => {
    expect(fmtPartial(1776, 7, 4, 'written-mdy', 'month')).toBe('__ 4, 1776')
    expect(fmtPartial(1776, 7, 4, 'numeric-mdy', 'month')).toBe('__/4/1776')
  })
  it('missing year', () => {
    expect(fmtPartial(1776, 7, 4, 'written-mdy', 'year')).toBe('July 4, __')
    expect(fmtPartial(1776, 7, 4, 'numeric-ymd', 'year')).toBe('__-7-4')
  })
  it('missing piece in each format ordering (day case)', () => {
    expect(fmtPartial(1776, 7, 4, 'written-dmy', 'day')).toBe('__ July 1776')
    expect(fmtPartial(1776, 7, 4, 'numeric-dmy', 'day')).toBe('__.7.1776')
    expect(fmtPartial(1776, 7, 4, 'numeric-ymd', 'day')).toBe('1776-7-__')
  })
})

describe('numericFormatOf — map any format to its numeric sibling', () => {
  it('MDY family -> numeric-mdy', () => {
    expect(numericFormatOf('written-mdy')).toBe('numeric-mdy')
    expect(numericFormatOf('numeric-mdy')).toBe('numeric-mdy')
  })
  it('DMY family -> numeric-dmy', () => {
    expect(numericFormatOf('written-dmy')).toBe('numeric-dmy')
    expect(numericFormatOf('numeric-dmy')).toBe('numeric-dmy')
  })
  it('YMD (and anything else) -> numeric-ymd', () => {
    expect(numericFormatOf('numeric-ymd')).toBe('numeric-ymd')
  })
})
