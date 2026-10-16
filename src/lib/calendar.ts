// ─────────────────────────────────────────────────────────────────────────
// calendar.js — pure calendar / day-of-week math
//
// The self-contained core of the date engine: leap-year rules, days-in-month,
// Julian Day Numbers, weekday computation, and the 1582 Julian↔Gregorian
// boundary helpers. These functions reference only each other and plain
// arithmetic — no app state, no React, no formatting (display helpers like
// fmt/fmtPartial stay in the app; they depend on the MONTH names).
//
// Conventions:
//   • toAstro maps historical years to astronomical ones before any modular
//     math: 1 BC → 0, 2 BC → -1, … so weekday/leap math stays continuous.
//   • Weekday results are 0=Sunday … 6=Saturday (index into the app's DAY array).
//   • Gregorian reform: dates ≤ Oct 4, 1582 are Julian; ≥ Oct 15, 1582 are
//     Gregorian; Oct 5–14, 1582 never existed (gap days).
//
// Extracted verbatim from main.jsx in Stage C, Step 1. Ordered dependency-first
// so the module loads cleanly under strict block scoping (no use-before-declare).
// ─────────────────────────────────────────────────────────────────────────
export const toAstro = (y: number): number => (y > 0 ? y : 1 - Math.abs(y))
export const isLeap = (y: number): boolean => {
  y = toAstro(y)
  return y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0)
}
export const isLeapJulian = (y: number): boolean => {
  y = toAstro(y)
  return y % 4 === 0
}
// dim — days-in-month. Optional julian param switches leap-year rule:
// off (default) uses Gregorian leap rule (isLeap); on uses Julian (every y%4===0).
// All non-Julian callers can omit the param and behavior is unchanged.
export const dim = (y: number, m: number, julian = false): number => {
  const leap = julian ? isLeapJulian(y) : isLeap(y)
  return m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
}
export function jdnGregorian(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12),
    y2 = y + 4800 - a,
    m2 = m - 3 + 12 * a
  return (
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045
  )
}
export const wday = (y: number, m: number, d: number): number =>
  (((jdnGregorian(toAstro(y), m, d) + 1) % 7) + 7) % 7
export function jdnJulian(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12),
    y2 = y + 4800 - a,
    m2 = m - 3 + 12 * a
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - 32083
}
export const wdayJulian = (y: number, m: number, d: number): number =>
  (((jdnJulian(toAstro(y), m, d) + 1) % 7) + 7) % 7
export const isJulianDate = (y: number, m: number, d: number): boolean =>
  y < 1582 || (y === 1582 && (m < 10 || (m === 10 && d <= 4)))
export const isGapDate = (y: number, m: number, d: number): boolean =>
  y === 1582 && m === 10 && d >= 5 && d <= 14
// Is this month one whose days can be read in EITHER calendar? Everything up to the reform can be:
// a pre-reform date has a real Julian reading AND a real proleptic-Gregorian one, and the two
// disagree about which dates even exist — Julian's every-fourth-year leap rule grants February 29
// to years like 1500 that Gregorian's century rule does not.
//
// MONTH-level rather than day-level on purpose: isJulianDate takes the day, and the day is the very
// thing dimEither below is being asked about ("how many days does this month have?"). October 1582
// is the only month with days on both sides of the reform, and it has 31 days under both calendars,
// so asking about its first day — "does this month START before the reform?" — is exact here, not an
// approximation. Not exported: dimEither is the only sound way to use it.
const isJulianEraMonth = (y: number, m: number): boolean => isJulianDate(y, m, 1)
// The highest day number this month has under ANY calendar it can be read in — i.e. the largest day
// that is a real date. Only February ever differs between the two leap rules, so this is dim's
// answer everywhere except the pre-reform Februaries, where it is the Julian 29 rather than the
// Gregorian 28. Lookup validates against this: a date that exists in either calendar is a date.
export const dimEither = (y: number, m: number): number =>
  isJulianEraMonth(y, m) ? Math.max(dim(y, m, true), dim(y, m)) : dim(y, m)
// Is this a date ONLY the Julian calendar has — a real day before the reform that the Gregorian
// calendar, projected back, never had? That is February 29 of a year the Julian every-fourth-year
// rule makes a leap year and the Gregorian century rule does not: 1500, 1400, 1300, 1100, 1000, 900,
// 700, … (and the same centuries BC). It is the one way the two calendars disagree about which dates
// EXIST, and it only runs this way round: every Gregorian leap year is a Julian one too, so there is
// no date before the reform that the Gregorian calendar has and the Julian one lacks
// (tests/calendar.test.js walks every day of every year to prove it).
// So such a date has exactly one reading — the Julian one. The engine reads it that way whatever the
// Julian Calendar setting says (engine/gameReducer's calendarOf), and a screen whose setting is off
// does not ask it at all (gameReducer's waitingDateMissing).
export const isJulianOnlyDate = (y: number, m: number, d: number): boolean =>
  isJulianDate(y, m, d) && d > dim(y, m) && d <= dim(y, m, true)
// ★ THE YEAR CAPS (Round 26, Q7) — the ONE home of the highest year a range, a year box, and Lookup
// accept. With the Julian Calendar setting off, 10000. With it on, 11582: years 10001-11582 are
// modern-calendar (Gregorian) years whose last four digits behave exactly like years 1-1582's under
// the modern calendar, because 10000 = 25 x 400 — so they drill the year-endings of 1-1582 the way a
// modern-calendar reader sees them, not the Julian reading a Julian-on player sees for those years.
// (isJulianDate / isGapDate test the exact year, so 11582 is never mistaken for 1582; method's
// yearParts takes the last four digits, which is exact for the same reason.)
export const YEAR_MAX_GREGORIAN = 10000
export const YEAR_MAX_JULIAN = 11582
export const yearMaxFor = (useJulian: boolean): number =>
  useJulian ? YEAR_MAX_JULIAN : YEAR_MAX_GREGORIAN
// Returns true if [lo,hi] contains at least one leap year, evaluated under the active calendar
// (Julian rule for years <1582 when useJulian is on; Gregorian rule otherwise). Used to lock the
// Leap Year Chance buttons when no leap year is reachable — without this, setting 50/75/100% would
// be silently ignored per date with no visible signal that the setting can't take effect.
// The range is bounded by the cap for the calendar setting it is asked under (yearMaxFor): with the
// setting off a range never walks past 10000.
export function rangeHasLeapYear(lo: number, hi: number, useJulian: boolean): boolean {
  lo = Math.max(1, lo)
  hi = Math.min(yearMaxFor(useJulian), hi)
  if (lo > hi) return false
  // Check every multiple of 4 in [lo,hi]. Non-multiples can't be leap years under either rule.
  const start = lo + ((4 - (lo % 4)) % 4)
  for (let y = start; y <= hi; y += 4) {
    if (y === 0) continue
    const inJulianRange = useJulian && y < 1582
    if (inJulianRange ? isLeapJulian(y) : isLeap(y)) return true
  }
  return false
}
// Returns true if [lo,hi] contains at least one COMMON year (not a leap year), by the same per-year rule
// as rangeHasLeapYear. Two years in a row are never both leap years, so only a single-year range can
// lack one — a leap year on its own (2000, or 1100 by the Julian rule). On such a range a Leap Year
// Chance below 100% asks for dates the range does not have, exactly as one above Random does on a
// range with no leap year (lib/dateConfig's leapChanceApplies).
export function rangeHasCommonYear(lo: number, hi: number, useJulian: boolean): boolean {
  lo = Math.max(1, lo)
  hi = Math.min(yearMaxFor(useJulian), hi)
  if (lo > hi) return false
  if (lo < hi) return true
  return !(useJulian && lo < 1582 ? isLeapJulian(lo) : isLeap(lo))
}
