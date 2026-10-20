// lib/dateLineFit.ts — THE DATE ON THE CARD IS ONE LINE, AT ONE SIZE PER CARD, IN THE DEVICE'S OWN
// FONT (Round 26, Q7).
//
// ★ THE RULE. Every mode's big date (components/DateLine) is drawn at index.css's .date-line size,
// 1.875rem — unless the WIDEST DATE THE CARD CAN SHOW would not fit its room at that size, in which
// case every date on that card is drawn at the largest size at which that widest date does fit.
// One size per card, never per date, and the line keeps its 2.25rem height whatever the size — so
// nothing round it moves from one date to the next.
//
// ★ WHY IT IS MEASURED, NOT A CONSTANT (lib/textFit, which does the watching, says more). The first
// cut of this rule was "1.875rem or the card's width over 10.97em" — a tenth over WebKit on Windows —
// and in the CI runner's DejaVu Sans the widest date ran 24px out of a 280-wide card.
//
// ★ WHAT IS MEASURED: THE WIDEST DATE THE CARD CAN DRAW UNDER THE SETTINGS IN EFFECT — its SHAPES.
// Every string the card can show is one of its formats (lib/format's fmt), or — Deduction — the same
// with one piece missing (fmtPartial), for some month, some day that month can have, and some year
// the card can draw: one inside the Year Range in effect (the pair the Julian Calendar setting
// picks), or one a date the mode still holds was drawn in before the range changed. So a card's
// shapes are each of its formats, each month, whole and (Deduction) with each piece missing, with
// the day the WIDEST that month can have and the year the WIDEST the card can draw — each widest as
// the font draws digits, measured (lib/textFit's digitWidths and widestNumberIn: worked out digit by
// digit, so a range of 1900 to 2100 is sized for four digits, and 1 to 11582 for the widest of
// 10000 to 11582, never for five of the widest digit). No real date is wider than its month's
// shape, so a size at which every shape fits is a size at which every date does — and every shape
// is a date the card can draw (or, for February 29, as wide as one), so the size is never smaller
// than it must be (Round 26 review: it was sized for five-digit years whatever the range, so a
// card whose years have four digits drew its date smaller than it need be). The shapes come from the app's own formatters, so a format added or
// changed is measured without anyone remembering to.
// What a card can show is DateLine's to say (its data-date-shapes, spelled by dateLineShapes below:
// its formats, its years, and "partial"); this file reads it. It changes with the settings and with
// what the mode holds — never with the date being shown — so the size changes only when they do.
import { fmt, fmtPartial, MONTH, type DatePart, type FormatId } from './format.js'
import { FORMAT_IDS } from './modeFormat.js'
import {
  makeRuler,
  setRows,
  widestRow,
  digitWidths,
  widestNumberIn,
  largestFit,
  watchTextRoom,
  refitTextRoom,
} from './textFit.js'

const PIECES: DatePart[] = ['day', 'month', 'year']
// The most days each month can have: 29 in February, for a leap year (a Julian one included).
const MOST_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
// A span of years in a card's spelling ("1-11582"), or one year a held date was drawn in ("12000").
const SPAN = /^(\d+)-(\d+)$/
const YEAR = /^-?\d+$/

// A card's shapes, from DateLine's "written-mdy numeric-ymd 1-11582 partial" spelling, in a font
// whose digits are `widths` wide.
const shapeCache = new Map<string, string[]>()
function shapesOf(spelling: string, widths: readonly number[]): string[] {
  const key = `${spelling}|${widths.join(' ')}`
  const known = shapeCache.get(key)
  if (known) return known
  const words = spelling.split(' ').filter(Boolean)
  const partial = words.includes('partial')
  const years: number[] = []
  const formats: FormatId[] = []
  for (const word of words) {
    const span = SPAN.exec(word)
    // (years are drawn from 1 up — lib/calendar — so a span reaching below is read from 1)
    if (span) {
      const [lo, hi] = [Math.max(1, +span[1]), +span[2]]
      if (lo <= hi) years.push(widestNumberIn(lo, hi, widths))
    } else if (YEAR.test(word)) years.push(+word)
    else if (word !== 'partial') formats.push(word as FormatId)
  }
  const shapes = [
    ...new Set(
      formats.flatMap((format) =>
        MONTH.flatMap((_, i) => {
          const day = widestNumberIn(1, MOST_DAYS[i], widths)
          return years.flatMap((y) => [
            fmt(y, i + 1, day, format),
            ...(partial ? PIECES.map((p) => fmtPartial(y, i + 1, day, format, p)) : []),
          ])
        }),
      ),
    ),
  ]
  shapeCache.set(key, shapes)
  return shapes
}

let ruler: HTMLElement | null = null

function fit(line: HTMLElement, room: number): void {
  ruler ??= makeRuler(line.className)
  ruler.style.fontSize = ''
  const full = parseFloat(getComputedStyle(ruler).fontSize)
  setRows(ruler, shapesOf(line.dataset.dateShapes ?? '', digitWidths(ruler)))
  const scale = largestFit(room, (s) => {
    ruler!.style.fontSize = `${full * s}px`
    return widestRow(ruler!)
  })
  line.style.fontSize = scale < 1 ? `${full * scale}px` : ''
}

/** Watch a date line (components/DateLine's layout effect): returns what stops it. */
export const fitDateLine = (line: HTMLElement | null) =>
  watchTextRoom(line, (room) => fit(line!, room))
/** The shapes a line can show have changed (DateLine's `shapes`). */
export const refitDateLine = (line: HTMLElement): void => refitTextRoom(line)

/**
 * What a card can show, spelled for components/DateLine's `shapes` (and so for its data-date-shapes):
 *   • every format a date on it can carry — the one Date Format sets, all five while Random Format is
 *     on, and the format of every date the mode holds (one browsed back to keeps the format it was
 *     drawn in) — in FORMAT_IDS' order, so the same set is always spelled the same way;
 *   • the Year Range in effect, `minY`-`maxY` (the pair the Julian Calendar setting picks — each mode
 *     is handed it);
 *   • and each year a held date was drawn in that the range no longer holds (a date drawn before the
 *     range changed, still on the card or in its history), in order.
 */
export function dateLineShapes(
  held: readonly ({ _fmt?: FormatId; y?: number } | null | undefined)[],
  dateFormat: FormatId,
  randomFormat: boolean,
  minY: number,
  maxY: number,
): string {
  const formats = new Set(held.map((date) => date?._fmt ?? dateFormat))
  const outside = new Set<number>()
  for (const date of held)
    if (date?.y != null && (date.y < minY || date.y > maxY)) outside.add(date.y)
  return [
    ...FORMAT_IDS.filter((f) => randomFormat || f === dateFormat || formats.has(f)),
    `${minY}-${maxY}`,
    ...[...outside].sort((a, b) => a - b),
  ].join(' ')
}
