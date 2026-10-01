// dateGen — the weekday-question generator. Extracted verbatim from main.tsx (the main.tsx split).
//
// It had to come out BEFORE the mode screens that use it: AoxMode defaults `genDate` to
// randomDate and DeductionMode reaches for the puzzle generator, so leaving these in main.tsx
// would have made every extracted mode import main.tsx — a cycle, since main.tsx imports the
// modes. main.tsx re-exports randomDate so tests/dateGen.dom.test.jsx keeps importing it from
// exactly where it always did; no test file changes.
import { isGapDate, isJulianDate, isLeap, isLeapJulian } from './calendar.js'
import type { WeekdayQuestion } from '../engine/gameReducer.js'

const rint = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
function randomDate(
  lo: number,
  hi: number,
  julian = false,
  leapChance = 'random',
  janFebChance = 'random',
  julianChance = 'random',
): WeekdayQuestion {
  // Decide leap-year preference based on leapChance setting
  const r = Math.random()
  let wantLeap = null
  if (leapChance === '100') wantLeap = true
  else if (leapChance === '75') wantLeap = r < 0.75
  else if (leapChance === '50') wantLeap = r < 0.5
  // janFebChance / julianChance — Option A semantics: the listed % is the exact
  // final probability that the output matches the bias. 'random' means no biasing
  // (natural distribution under the year range + leap settings). On non-'random' values,
  // we roll a separate Math.random() up front so the bias decision is independent of
  // leap. On hit, force toward the bias; on miss, force away. This guarantees the final
  // percentage equals the chosen value rather than (chance × 1 + (1-chance) × natural).
  const rjf = Math.random()
  let wantJanFeb = null
  if (janFebChance === '100') wantJanFeb = true
  else if (janFebChance === '75') wantJanFeb = rjf < 0.75
  else if (janFebChance === '50') wantJanFeb = rjf < 0.5
  else if (janFebChance === '25') wantJanFeb = rjf < 0.25
  // julianChance only applies when the Use Julian Calendar toggle is on; if julian=false,
  // every date is treated as Gregorian regardless of year, so biasing is meaningless.
  const rjul = Math.random()
  let wantJulian = null
  if (julian) {
    if (julianChance === '100') wantJulian = true
    else if (julianChance === '75') wantJulian = rjul < 0.75
    else if (julianChance === '50') wantJulian = rjul < 0.5
    else if (julianChance === '25') wantJulian = rjul < 0.25
  }
  // Try preference-respecting attempts first; fall back to no preference if year range has no leap years
  for (let attempts = 0; attempts < 2000; attempts++) {
    const y = rint(lo, hi)
    if (y === 0) continue
    // Per-date leap check: only apply Julian leap rule if the year actually falls in the Julian period.
    // Without this, useJulian=on caused isLeapJulian to be applied to post-1582 years, which disagrees with
    // dimFn / isJulianDate / the codes panel — manifesting as e.g. 1900 being treated as a leap year for
    // wantLeap/forceJanFeb purposes while the codes panel correctly reports Gregorian non-leap.
    const inJulianRange = julian && y < 1582
    const isLeapY = inJulianRange ? isLeapJulian(y) : isLeap(y)
    if (wantLeap !== null && wantLeap !== isLeapY) continue
    let m
    if (wantJanFeb !== null && isLeapY) {
      // On leap years, force toward (or away from) Jan/Feb based on the rolled bias.
      // Non-leap years are unaffected — Jan/Feb chance only applies on leap years.
      m = wantJanFeb ? rint(1, 2) : rint(3, 12)
    } else {
      m = rint(1, 12)
    }
    const isJul = julian && isJulianDate(y, m, 1)
    const maxD =
      m === 2
        ? (isJul ? isLeapJulian(y) : isLeap(y))
          ? 29
          : 28
        : [4, 6, 9, 11].includes(m)
          ? 30
          : 31
    const d = rint(1, maxD)
    if (isGapDate(y, m, d)) continue
    // Julian-chance bias is checked against the final (y,m,d) since year 1582 contains
    // both Julian (Jan-Sep + Oct 1-4) and Gregorian (Oct 15+ + Nov + Dec) dates.
    if (wantJulian !== null) {
      const isJ = isJulianDate(y, m, d)
      if (wantJulian !== isJ) continue
    }
    return { y, m, d }
  }
  // Silent fallback: no leap-preference / janFeb / julian filter
  for (;;) {
    const y = rint(lo, hi)
    if (y === 0) continue
    const m = rint(1, 12)
    const isJul = julian && isJulianDate(y, m, 1)
    const maxD =
      m === 2
        ? (isJul ? isLeapJulian(y) : isLeap(y))
          ? 29
          : 28
        : [4, 6, 9, 11].includes(m)
          ? 30
          : 31
    const d = rint(1, maxD)
    if (isGapDate(y, m, d)) continue
    return { y, m, d }
  }
}

export { rint, randomDate }
