// The small shared presentation helpers the mode screens and App both use: the date-format roll,
// the touch probe, and the time / accuracy formatters. Extracted verbatim from main.tsx (Q1 phase
// 1) so the five mode screens can move into their own modules.
import type { FormatId } from './format.js'

// FORMAT_IDS / rollFormat live at module scope so App's genDate and every mode
// component can stamp a date's ._fmt at generation time.
export const FORMAT_IDS: FormatId[] = [
  'written-mdy',
  'written-dmy',
  'numeric-mdy',
  'numeric-dmy',
  'numeric-ymd',
]
export const rollFormat = () => FORMAT_IDS[Math.floor(Math.random() * FORMAT_IDS.length)]
export const isTouch =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    matchMedia('(pointer:coarse)').matches)
export const fmtBlitzT = (s: number) => {
  const sec = Math.ceil(s)
  if (sec < 60) return sec + 's'
  const m = Math.floor(sec / 60),
    r = sec % 60
  return m + 'm ' + r + 's'
}
export const fmtFlashT = (ms: number) => (ms / 1000).toFixed(1) + 's'
// The ONE readout-width strut string shared by six of the SEVEN SliderValueEditor sites (3
// mode-screen + 3 timer rows in the Save Defaults popup; the seventh — the defaults manager's
// AoX run-length row — is a plain count, not a time, and carries its own "1000" strut): the
// widest value ANY timer readout can display, derivation at the first site (FlashMode). One
// const = all six of those columns identical, constant at runtime.
export const SLIDER_READOUT_WIDEST = fmtBlitzT(175) /* "2m 55s" */
// Time display follows WCA convention (regulation 9f1): individual single times
// (Last) are truncated to hundredths — the third decimal is dropped, never rounded.
// Averages, medians, and bests are rounded to nearest hundredth (toFixed(2)).
// truncTime drops the third decimal; fmtTime rounds via toFixed(2).
//
// ★ A TIME IS ALWAYS RENDERED AS A TIME — there is no ceiling and no special case, and the em dash
// therefore means ONE thing: `t == null`, nothing recorded. Both formatters used to return the dash
// for `t >= 60` as well, so a 62-second solve and an empty stat box drew the same picture — while
// StatPanel's three-signal contract (see the header there, and tests/statBoxSignals.dom.test.jsx)
// documents the dash as "there is no data YET, but there could be". Two facts, one glyph: exactly
// the collapse C1 spent a round pulling apart everywhere else on that strip. And a long solve is
// the one a player most wants to see. A third "too long to count" state was designed and REJECTED —
// one rule with no exception beats a good exception.
//
// THE SHAPE. Under a minute is unchanged ("9.30s"). A minute or more borrows the minutes shape this
// module already owns (fmtBlitzT → "2m 55s"): "1m 2.34s". An hour or more extends it the same way,
// "1h 2m 3.45s", and hours never roll over into days — a "3d" would be a third shape to learn for a
// number nobody will ever read, and 73h is unambiguous. Every unit below the largest one present is
// always shown, zeros included ("1h 0m 4.00s"), because dropping a zero minute would turn 1h 4s
// into something that reads as 1h 4m. Seconds are NOT zero-padded ("1m 2.34s", never "1m 02.34s"):
// fmtBlitzT is the repo's minutes format and it does not pad, and two minute shapes that differ by
// one character is the kind of near-duplicate this codebase exists to avoid.
//
// ⚠ TRAP — QUANTIZE FIRST, THEN SPLIT. Rounding after the split prints "1m 60.00s" for 119.999.
// Both formatters therefore reduce the time to whole HUNDREDTHS first (each in its own WCA way) and
// hand fmtCentis an integer, which is the only thing that can be split without disagreeing with the
// decimals it prints. 59.999 rounds up across the boundary and reads "1m 0.00s"; the same input
// TRUNCATED stays "59.99s". Both are correct and they differ — that is the regulation working.
//
// ⚠ TRAP — THE STRING NOW CONTAINS A SPACE, which is a line-break opportunity where the old times
// had none. Every site that renders one must say so: StatPanel's value cell carries
// `whitespace-nowrap` (it covers all six boxes in all five modes) and AoX's four Best readouts wrap
// their value in a nowrap span. A non-breaking space inside the string was considered and rejected:
// it would make these strings silently unequal to fmtBlitzT's visually identical output, and every
// test and text-extraction path would have to know which of the two it was looking at.
const EM_DASH = '—'
// Whole hundredths of a second → the largest unit the value needs and every smaller one.
// Integer in, so `c % 6000` and `c % 100` cannot disagree with the printed decimals.
const fmtCentis = (c: number) => {
  const s = `${Math.floor((c % 6000) / 100)}.${String(c % 100).padStart(2, '0')}s`
  const m = Math.floor(c / 6000) % 60
  const h = Math.floor(c / 360000)
  return h ? `${h}h ${m}m ${s}` : m ? `${m}m ${s}` : s
}
// The ROUNDED quantizer, read off the string `toFixed(2)` itself produces rather than computed as
// Math.round(t * 100), because the two really do disagree and fmtTime's job is to print exactly what
// it printed before the minutes shape existed. The proof case is on the boundary this change added:
// (59.995).toFixed(2) is "59.99" — 59.995's double is a hair BELOW the decimal — while
// 59.995 * 100 is 5999.500000000001, which rounds UP to 6000. Math.round would therefore turn a
// 59.99s solve into "1m 0.00s". truncTime needs no such helper: Math.floor(t * 100) IS its old
// expression's numerator, so its own float behaviour (0.29 * 100 = 28.999999999999996, so 0.29
// truncates to "0.28s" — WCA truncation, floating point, and this app agreeing to be pessimistic)
// is carried over untouched.
const roundCentis = (t: number) => {
  const [whole, frac] = t.toFixed(2).split('.')
  return Number(whole) * 100 + Number(frac)
}
export const truncTime = (t: number | null) =>
  t == null ? EM_DASH : fmtCentis(Math.floor(t * 100))
export const fmtTime = (t: number | null) => (t == null ? EM_DASH : fmtCentis(roundCentis(t)))
// WCA-consistent accuracy formatter: when there's at least one wrong answer, floor (truncate) the
// percentage so we never display "100.0%" for 9999/10000 (which rounds up under toFixed). Pure 100%
// displays normally. Same philosophy as truncTime (regulation 9f1) — never inflate the user's result.
export const fmtAccuracyPct = (good: number, played: number) => {
  if (!played) return EM_DASH
  const pct = (good / played) * 100
  if (good < played && pct >= 99.95) return '99.9%'
  return `${pct.toFixed(1)}%`
}
// calcAvg / calcLast / calcMed → src/engine/stats.js, imported at top (shared by the mode strips).
export const blockMinus = (e: React.KeyboardEvent) => {
  if (e.key === '-' || e.key === 'Subtract' || e.key === 'Minus') e.preventDefault()
}
export const blockMinusBI = (e: React.FormEvent<HTMLInputElement> & { data?: string | null }) => {
  if (e.data && e.data.includes('-')) e.preventDefault()
}
