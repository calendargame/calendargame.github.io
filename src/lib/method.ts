// ─────────────────────────────────────────────────────────────────────────
// method.js — the "doomsday method" code tables + the per-date code summary
//
// The numbers a learner actually computes in their head: the month code, the
// day code, the ab/cd year codes, the leap correction, and the weekday they
// add up to. computeMethodSummary() bundles all of it for one date and is the
// single entry point the codes panel (MethodBreakdown / MethodExplanation)
// renders from. The maps + small helpers above it are its building blocks.
//
// Depends on the lower layers: calendar.js for the leap/Julian rules and the
// weekday math, format.js for the DAY name table. No app state, no React.
//
// Extracted from main.jsx in Stage C, Step 3. Ordered dependency-first so it
// compiles cleanly under strict block scoping (no use-before-declare) and
// needs no Babel shim.
// ─────────────────────────────────────────────────────────────────────────
import { isLeap, isLeapJulian, isJulianDate, wday, wdayJulian } from './calendar.js'
import { DAY } from './format.js'

// Month codes use canonical (-3 to 3) representation matching ab/cd convention.
// Values >3 are written as their negative equivalent (mod 7): 4→-3, 5→-2, 6→-1.
// Calculation is unaffected since results mod 7 at the end. Display values match
// what users learn from the book.
export const METHOD_MONTH_CODES: Record<number, number> = {
  1: -1,
  2: 2,
  3: 2,
  4: -2,
  5: 0,
  6: 3,
  7: -2,
  8: 1,
  9: -3,
  10: -1,
  11: 2,
  12: -3,
}
export const METHOD_AB_ADVANCED_MAP = {
  even: new Map([
    [0, 0],
    [1, -2],
    [2, 3],
    [3, 1],
    [4, 0],
    [5, -2],
    [6, 3],
    [7, 1],
    [8, 0],
    [9, -2],
  ]),
  odd: new Map([
    [0, 3],
    [1, 1],
    [2, 0],
    [3, -2],
    [4, 3],
    [5, 1],
    [6, 0],
    [7, -2],
    [8, 3],
    [9, 1],
  ]),
}
export const METHOD_CD_ADVANCED_LEAP_MAP = new Map([
  [0, 0],
  [4, -2],
  [8, 3],
  [12, 1],
  [16, -1],
  [20, -3],
  [24, 2],
  [28, 0],
  [32, -2],
  [36, 3],
  [40, 1],
  [44, -1],
  [48, -3],
  [52, 2],
  [56, 0],
  [60, -2],
  [64, 3],
  [68, 1],
  [72, -1],
  [76, -3],
  [80, 2],
  [84, 0],
  [88, -2],
  [92, 3],
  [96, 1],
])
// ORDER is derived from MAP.keys() so the two stay in lockstep — single source of truth.
export const METHOD_CD_ADVANCED_LEAP_ORDER = [...METHOD_CD_ADVANCED_LEAP_MAP.keys()]
export const METHOD_CD_ADVANCED_ZERO_YEARS = new Set([
  0, 6, 17, 23, 28, 34, 45, 51, 56, 62, 73, 79, 84, 90,
])
export const JULIAN_AB_MAP = new Map([
  [0, -2],
  [1, -3],
  [2, 3],
  [3, 2],
  [4, 1],
  [5, 0],
  [6, -1],
  [7, -2],
  [8, -3],
  [9, 3],
  [10, 2],
  [11, 1],
  [12, 0],
  [13, -1],
  [14, -2],
  [15, -3],
])
export const normalizeMod7 = (v: number): number => ((v % 7) + 7) % 7
export const canonicalizeMod = (v: number): number => {
  const m = normalizeMod7(v)
  return m > 3 ? m - 7 : m
}
export function calcDayCode(d: number): number {
  const lo = Math.floor(d / 7) * 7,
    hi = lo + 7,
    fl = d - lo,
    fu = d - hi
  return Math.abs(fu) <= Math.abs(fl) ? fu : fl
}
export function calcCdCode(cd: number): number {
  if (METHOD_CD_ADVANCED_ZERO_YEARS.has(cd)) return 0
  let b = METHOD_CD_ADVANCED_LEAP_ORDER[0]
  for (const y of METHOD_CD_ADVANCED_LEAP_ORDER) {
    if (y > cd) break
    b = y
  }
  return canonicalizeMod((METHOD_CD_ADVANCED_LEAP_MAP.get(b) ?? 0) + (cd - b))
}
// The last four digits: exact for every year the app draws, 10001-11582 included — 10000 = 25 x 400,
// so year y + 10000 has year y's Gregorian codes (lib/calendar's YEAR_MAX_JULIAN).
export function yearParts(y: number): { a: number; b: number; cd: number } {
  const f = ((y % 10000) + 10000) % 10000
  return { a: Math.floor(f / 1000), b: Math.floor((f % 1000) / 100), cd: f % 100 }
}
// leapCode is the calculation contribution for leap correction (matches the
// framing of the other numeric codes in the codes panel): -1 only when it's
// a leap year AND month is January or February (where the leap correction
// applies in the day-of-week calculation), 0 otherwise. leapYear boolean is
// kept in the return object too in case future code needs the underlying state.
export function computeMethodSummary(
  { y, m, d }: { y: number; m: number; d: number },
  useJulian = false,
) {
  if (!Number.isFinite(y) || y <= 0) return null
  const mc = METHOD_MONTH_CODES[m] ?? null
  if (mc == null) return null
  const p = yearParts(y)
  const julian = useJulian && isJulianDate(y, m, d)
  const abCode = julian
    ? (JULIAN_AB_MAP.get(p.a * 10 + p.b) ?? 0)
    : ((p.a % 2 === 0 ? METHOD_AB_ADVANCED_MAP.even : METHOD_AB_ADVANCED_MAP.odd).get(p.b) ?? 0)
  const leapYear = julian ? isLeapJulian(y) : isLeap(y)
  const leapCode = leapYear && (m === 1 || m === 2) ? -1 : 0
  const weekday = DAY[julian ? wdayJulian(y, m, d) : wday(y, m, d)]
  return {
    monthCode: mc,
    dayCode: calcDayCode(d),
    abCode,
    cdCode: calcCdCode(p.cd),
    leapYear,
    leapCode,
    weekday,
    calendarSystem: julian ? 'Julian' : 'Gregorian',
  }
}
