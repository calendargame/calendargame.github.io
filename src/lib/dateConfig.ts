// ─────────────────────────────────────────────────────────────────────────
// lib/dateConfig.ts — WHICH DATE SETTINGS ARE IN EFFECT, and what that means for the Bests.
//
// ★ ONE DEFINITION OF "IN EFFECT". A date setting is in effect when it can change which dates are
// drawn; one that cannot is drawn "not in effect" in the ⚙ panel (outlined, still changeable). The
// rule lives here and nowhere else, and everything downstream of the stored settings reads its
// output, never the stored values:
//   1. the generator (App's genDate, and Deduction's puzzles) is handed the settings in effect;
//   2. every "did a date setting change?" comparison — the run and round resets, a waiting
//      question's regeneration, the parked screens' `config` — compares the settings in effect;
//   3. the MoX and Blitz Best keys are built from them;
//   4. the ⚙ panel's "not in effect" look asks the same three questions (leapChanceApplies,
//      janFebChanceApplies, julianChanceApplies).
// So a setting that is not in effect is absent from all four at once: changing it never restarts a
// round, never regenerates a date, and never changes which Bests show — by construction.
//
// ★★ WHY THE GENERATOR HAS TO BE HANDED THEM (the defect this fixed, Round 26). lib/dateGen rolls each
// filter once per date and retries a draw that fails one; after 2,000 failed draws it falls back to a
// draw with NO filter at all. Handed a Julian Chance the year range cannot use (Julian on, a range
// that does not include 1582), "want a Julian date" (or "want a modern one") can never be met, so a
// share of dates — all of them at 100% on a modern range — fell back, and Leap Year Chance and
// Jan/Feb Chance were silently ignored on exactly those dates. The mirror images: a Leap Year Chance
// a range with no leap year cannot use made the fallback ignore an ACTIVE Julian Chance, and one
// below 100% on a single leap year (every date is in a leap year) made it ignore an active Jan/Feb
// Chance. Nothing is wrong with the generator's arithmetic; it was asked for what the settings could
// not give.
//
// ★★ THE BESTS THAT HISTORY LEAVES BEHIND (inEffectBestKey, below). Best keys used to hold the stored
// values, dimmed or not, so one set-up's Bests can sit under several keys. Most of those records were
// played on exactly the dates the in-effect set-up draws (the stored value did nothing), and they keep
// showing: the Best shown is the best over every record whose key maps to the in-effect one and was
// played on the same dates (engine/bestPool — a read-only union; nothing stored is rewritten, moved,
// or merged). The only records that stop showing are the ones the fault above played on DIFFERENT
// dates; they stay on the device, and Full Reset is still the only thing that removes them.
// ─────────────────────────────────────────────────────────────────────────
import { rangeHasCommonYear, rangeHasLeapYear, yearMaxFor } from './calendar.js'
import { FORMAT_IDS } from './modeFormat.js'
import type { FormatId } from './format.js'

// The stored date settings a draw is made from (the settings store's names).
export interface DateSettings {
  randomFormat: boolean
  dateFormat: FormatId
  useJulian: boolean
  minY: number
  maxY: number
  leapChance: string
  janFebChance: string
  julianChance: string
}
// …and the same settings as they act. `format` is 'random' while Random Format is on (practice
// dates ignore Date Format then); a chance that cannot apply is 'random' (no bias), which is what
// the generator would do with it if it were not handed one at all.
export interface DateSettingsInEffect {
  format: FormatId | 'random'
  minY: number
  maxY: number
  useJulian: boolean
  leapChance: string
  janFebChance: string
  julianChance: string
}

// Does Leap Year Chance apply? Only on a range with BOTH a leap year and a common year in it — counted
// by the calendar each year is drawn in (calendar's rangeHasLeapYear / rangeHasCommonYear, the
// generator's own per-year rule): with no leap year it can never be met, and on a single leap year
// every date is in a leap year whatever it says.
export const leapChanceApplies = (minY: number, maxY: number, useJulian: boolean): boolean =>
  rangeHasLeapYear(minY, maxY, useJulian) && rangeHasCommonYear(minY, maxY, useJulian)
// Does Jan/Feb Chance on Leap Years apply? On any range with a leap year in it (it acts only on the
// dates in leap years, and can always be met there).
export const janFebChanceApplies = (minY: number, maxY: number, useJulian: boolean): boolean =>
  rangeHasLeapYear(minY, maxY, useJulian)
// Does Julian Chance apply? Only with the Julian Calendar setting on AND a range that includes 1582
// (the one year with dates in both calendars): before it every date is Julian, after it none is, so
// there is nothing to bias.
export const julianChanceApplies = (minY: number, maxY: number, useJulian: boolean): boolean =>
  useJulian && minY <= 1582 && maxY >= 1582

// THE YEAR RANGE IN EFFECT (Round 26, Q7): the ⚙ panel holds two pairs, one used while the Julian
// Calendar setting is off (the settings store's minY / maxY, capped at 10000) and one used while it
// is on (store/julianRange, capped at 11582). The pair not in use reaches nothing: App hands every
// screen this one, so editing the other pair cannot regenerate, reset, or move a Best.
export interface JulianPair {
  julianMinY: number
  julianMaxY: number
}
export const yearRangeInEffect = (
  useJulian: boolean,
  off: { minY: number; maxY: number },
  on: JulianPair,
): { minY: number; maxY: number } =>
  useJulian ? { minY: on.julianMinY, maxY: on.julianMaxY } : { minY: off.minY, maxY: off.maxY }

// The settings in effect. `s.minY` / `s.maxY` are the Julian-off pair; given the Julian-on pair too,
// the range is the one in use (yearRangeInEffect). Without it — a stored Best key, whose own range is
// the one it was played on — `s`'s range is taken as it is.
export function dateSettingsInEffect(
  s: DateSettings,
  julianPair?: JulianPair,
): DateSettingsInEffect {
  const { minY, maxY } = julianPair ? yearRangeInEffect(s.useJulian, s, julianPair) : s
  return {
    format: s.randomFormat ? 'random' : s.dateFormat,
    minY,
    maxY,
    useJulian: s.useJulian,
    leapChance: leapChanceApplies(minY, maxY, s.useJulian) ? s.leapChance : 'random',
    janFebChance: janFebChanceApplies(minY, maxY, s.useJulian) ? s.janFebChance : 'random',
    julianChance: julianChanceApplies(minY, maxY, s.useJulian) ? s.julianChance : 'random',
  }
}

// THE SETTINGS A DATE IS DRAWN UNDER, AS ONE STRING — every comparison and every key is built from it.
// The Julian Calendar setting is NOT in it: Classic and Flash keep a waiting date across a switch of
// it (its answer follows the setting), so the screens that care append it themselves — the run modes'
// Best keys and Deduction's puzzles (built in a calendar).
// ⚠ THE SPELLING IS SAVED DATA. `format|leap|janFeb|julian|min-max`, then `|useJulian`, is the tail of
// every MoX and Blitz Best key on every device; inEffectBestKey below parses exactly this. Never
// reorder or respell it.
export const dateDrawKey = (d: DateSettingsInEffect): string =>
  `${d.format}|${d.leapChance}|${d.janFebChance}|${d.julianChance}|${d.minY}-${d.maxY}`
// The six-segment tail a Best key ends in.
export const bestKeyTail = (d: DateSettingsInEffect): string => `${dateDrawKey(d)}|${d.useJulian}`

// ── THE BESTS FILED UNDER STORED VALUES (history, frozen) ─────────────────────────────────────────
// inEffectBestKey(rawKey) reads the six-segment tail of a stored MoX or Blitz Best key and answers:
//   • key — the in-effect key that set-up maps to (its head segments — run length, Allow Mistakes, the
//     timer — untouched);
//   • samePool — were the record's rounds played on exactly the dates the in-effect set-up draws?
// null for a key it cannot read (a segment it does not know) — never guessed.
//
// ★ IT DESCRIBES WHAT THE GENERATOR DID BEFORE ROUND 26 — so it is history, and it is FROZEN: it must
// keep answering for the records those builds wrote (and that older builds still on this origin keep
// writing: they still have the fault) whatever becomes of the generator. tests/dateConfig.test.js holds
// it to a verbatim copy of that generator, run against every combination it classifies.
//
// How that generator treated a stored value that does not apply (lib/dateGen):
//   • a want that is ALWAYS met — Jan/Feb Chance on a range with no leap year (never asked), Julian
//     Chance with Julian off (never rolled), Julian Chance 100% on a range entirely before 1582 (every
//     date is Julian) — did nothing at all;
//   • a want that can NEVER be met — Leap Year Chance not Random on a range with no leap year (or
//     50-75% on a single leap year), Julian Chance 25-100% on a range entirely after 1582, 25-75% on
//     one entirely before it — sent that share of dates to the fallback, which drops EVERY filter.
// The fallback's draw is exactly the unfiltered draw, so it changed the dates only when some setting
// that DOES apply was filtering them. Hence the one rule:
//     samePool  ⇔  not (some date fell back  AND  a setting in effect was filtering).
// (A range with no leap year can still hold a mix of calendars only inside 1581-1583, so the leap side
// of the fault needs one of those tiny ranges and an active Julian Chance — or a single leap year and
// an active Jan/Feb Chance.)
const LEAP_VALUES = new Set(['random', '50', '75', '100'])
const CHANCE_VALUES = new Set(['random', '25', '50', '75', '100'])
const FORMATS = new Set<string>(['random', ...FORMAT_IDS])
const YEAR = /^[1-9]\d*$/
export interface InEffectBestKey {
  key: string
  samePool: boolean
}
export function inEffectBestKey(rawKey: string): InEffectBestKey | null {
  const parts = rawKey.split('|')
  if (parts.length < 6) return null
  const head = parts.slice(0, -6)
  const [format, leapChance, janFebChance, julianChance, range, julian] = parts.slice(-6)
  if (!FORMATS.has(format) || !LEAP_VALUES.has(leapChance)) return null
  if (!CHANCE_VALUES.has(janFebChance) || !CHANCE_VALUES.has(julianChance)) return null
  if (julian !== 'true' && julian !== 'false') return null
  const ends = range.split('-')
  if (ends.length !== 2 || !YEAR.test(ends[0]) || !YEAR.test(ends[1])) return null
  const minY = Number(ends[0])
  const maxY = Number(ends[1])
  const useJulian = julian === 'true'
  if (minY > maxY || maxY > yearMaxFor(useJulian)) return null
  const inEffect = dateSettingsInEffect({
    randomFormat: format === 'random',
    dateFormat: format === 'random' ? FORMAT_IDS[0] : (format as FormatId),
    useJulian,
    minY,
    maxY,
    leapChance,
    janFebChance,
    julianChance,
  })
  // Did some share of dates fall back? "Want a leap year" with none in the range, "want a common year"
  // on a single leap year, "want a Julian date" after 1582, "want a modern one" before it.
  const fellBack =
    (leapChance !== 'random' &&
      (!rangeHasLeapYear(minY, maxY, useJulian) ||
        (!rangeHasCommonYear(minY, maxY, useJulian) && leapChance !== '100'))) ||
    (useJulian &&
      !julianChanceApplies(minY, maxY, useJulian) &&
      julianChance !== 'random' &&
      !(maxY < 1582 && julianChance === '100'))
  // …and was a setting in effect filtering the dates the fallback then drew without it?
  const filtering =
    inEffect.leapChance !== 'random' ||
    inEffect.janFebChance !== 'random' ||
    inEffect.julianChance !== 'random'
  return {
    key: [...head, bestKeyTail(inEffect)].join('|'),
    samePool: !(fellBack && filtering),
  }
}
