// ─────────────────────────────────────────────────────────────────────────
// format.js — date display: month/day names + the date-string formatters
//
// The presentation layer for dates: the MONTH / DAY / DAY_LETTER name tables and the
// helpers that turn a (year, month, day) triple into the visible string in
// each supported format. Pure string work — no calendar math (that lives in
// calendar.js) and no app state.
//
// Extracted from main.jsx in Stage C, Step 2. Ordered so each definition
// precedes its first textual use; fmt/fmtPartial reference MONTH and fmtYear
// at call time, so they always see the module's bindings.
// ─────────────────────────────────────────────────────────────────────────
export const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// The ONE-LETTER weekday, index-aligned with DAY (0 = Sunday), for places too narrow for a name —
// today the run breakdown's rows (components/RunBreakdown). U M T W R F S: the M-T-W-R-F school
// timetable convention, which spends R on Thursday so it never collides with Tuesday's T, and U on
// Sunday so it never collides with Saturday's S. Every letter is therefore distinct, which is the
// whole requirement — a lone letter that could mean two days is no label at all. Defined once here,
// beside the names it abbreviates, because the owner's parked Mini-mode idea (PROJECT.md's Super
// Backlog) is on record with exactly this array for its seven answer buttons, and a second copy
// would be a second place to disagree. How to Play's key (the Stats section's breakdown notes) is
// rendered FROM this array and DAY, so it cannot drift — though its prose names R and U by hand.
// ⚠ A letter is never the accessible form: whoever renders one also renders DAY[i] for a screen
// reader, because "R" read aloud means nothing.
export const DAY_LETTER = ['U', 'M', 'T', 'W', 'R', 'F', 'S']
// The five reachable date-format IDs, and the three date pieces a Deduction puzzle can hide.
// Shared across the app (date objects stamp a _fmt: FormatId; settings store the active one).
export type FormatId = 'written-mdy' | 'written-dmy' | 'numeric-mdy' | 'numeric-dmy' | 'numeric-ymd'
export type DatePart = 'day' | 'month' | 'year'
export const fmtYear = (y: number): string => (y > 0 ? String(y) : `${Math.abs(y)} BC`)
// fmt: takes a single format ID. The 5 reachable formats:
//   written-mdy  → April 27, 1828
//   written-dmy  → 27 April 1828
//   numeric-mdy  → 4/27/1828
//   numeric-dmy  → 27.4.1828
//   numeric-ymd  → 1828-4-27
// Convention: numeric MDY uses /, DMY uses ., YMD uses -. Year always full, no leading zeros, no ordinals.
export const fmt = (
  y: number,
  m: number,
  d: number,
  formatId: FormatId = 'written-mdy',
): string => {
  const yr = fmtYear(y)
  switch (formatId) {
    case 'written-dmy':
      return `${d} ${MONTH[m - 1]} ${yr}`
    case 'numeric-mdy':
      return `${m}/${d}/${yr}`
    case 'numeric-dmy':
      return `${d}.${m}.${yr}`
    case 'numeric-ymd':
      return `${yr}-${m}-${d}`
    case 'written-mdy':
    default:
      return `${MONTH[m - 1]} ${d}, ${yr}`
  }
}
// Partial-date display for Deduction. `missing` is one of 'day' | 'month'
// | 'year' and substitutes a fixed-width 2-underscore placeholder for that
// piece while honoring the active formatId for the rest. The placeholder
// is uniform across all pieces and formats — the sub-mode label already
// tells the user what's missing, so a short uniform marker reads fastest.
export const fmtPartial = (
  y: number,
  m: number,
  d: number,
  formatId: FormatId,
  missing: DatePart,
): string => {
  const PH = '__'
  const dPart = missing === 'day' ? PH : String(d)
  const mNamePart = missing === 'month' ? PH : MONTH[m - 1]
  const mNumPart = missing === 'month' ? PH : String(m)
  const yPart = missing === 'year' ? PH : fmtYear(y)
  switch (formatId) {
    case 'written-dmy':
      return `${dPart} ${mNamePart} ${yPart}`
    case 'numeric-mdy':
      return `${mNumPart}/${dPart}/${yPart}`
    case 'numeric-dmy':
      return `${dPart}.${mNumPart}.${yPart}`
    case 'numeric-ymd':
      return `${yPart}-${mNumPart}-${dPart}`
    case 'written-mdy':
    default:
      return `${mNamePart} ${dPart}, ${yPart}`
  }
}
// Helper: maps any format ID to its corresponding numeric format ID.
// Used by Lookup input parsing and DEPLOY_TS (which always render numeric).
export const numericFormatOf = (fid: FormatId): FormatId => {
  if (fid === 'written-mdy' || fid === 'numeric-mdy') return 'numeric-mdy'
  if (fid === 'written-dmy' || fid === 'numeric-dmy') return 'numeric-dmy'
  return 'numeric-ymd'
}
