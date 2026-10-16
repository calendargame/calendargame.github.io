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
// ★ WHAT IS MEASURED: THE WIDEST SHAPE, NOT A LIST OF DATES. Every string the card can show is one
// of its formats (lib/format's fmt), or — Deduction — the same with one piece missing (fmtPartial),
// for some month, with the year at most five digits (lib/calendar's caps) and the day and a numeric
// month at most two. So a card's SHAPES are each of its formats, each month, whole and (Deduction)
// with each piece missing, with every digit written as the font's WIDEST DIGIT, measured. No real
// date is wider than its widest shape whatever the font (proportional figures included), so a size
// at which every shape fits is a size at which every date does. The shapes come from the app's own
// formatters, so a format added or changed is measured without anyone remembering to.
// Which formats a card can show is DateLine's to say (its data-date-shapes); this file reads it.
import { fmt, fmtPartial, MONTH, type DatePart, type FormatId } from './format.js'
import { YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN } from './calendar.js'
import { FORMAT_IDS } from './modeFormat.js'
import {
  makeRuler,
  setRows,
  widestRow,
  widestDigit,
  largestFit,
  watchTextRoom,
  refitTextRoom,
} from './textFit.js'

const TOP_YEAR = Math.max(YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN)
const PIECES: DatePart[] = ['day', 'month', 'year']

// A card's shapes, digits as 0s, from DateLine's "written-mdy numeric-ymd partial" spelling.
const shapeCache = new Map<string, string[]>()
function shapesOf(spelling: string): string[] {
  const known = shapeCache.get(spelling)
  if (known) return known
  const words = spelling.split(' ')
  const partial = words.includes('partial')
  const formats = words.filter((w) => w !== 'partial') as FormatId[]
  const shapes = [
    ...new Set(
      formats.flatMap((format) =>
        MONTH.flatMap((_, i) => [
          fmt(TOP_YEAR, i + 1, 10, format),
          ...(partial ? PIECES.map((p) => fmtPartial(TOP_YEAR, i + 1, 10, format, p)) : []),
        ]),
      ),
    ),
  ].map((shape) => shape.replace(/\d/g, '0'))
  shapeCache.set(spelling, shapes)
  return shapes
}

let ruler: HTMLElement | null = null

function fit(line: HTMLElement, room: number): void {
  ruler ??= makeRuler(line.className)
  ruler.style.fontSize = ''
  const full = parseFloat(getComputedStyle(ruler).fontSize)
  const digit = widestDigit(ruler)
  setRows(
    ruler,
    shapesOf(line.dataset.dateShapes ?? '').map((shape) => shape.replace(/0/g, digit)),
  )
  const scale = largestFit(room, (s) => {
    ruler!.style.fontSize = `${full * s}px`
    return widestRow(ruler!)
  })
  line.style.fontSize = scale < 1 ? `${full * scale}px` : ''
}

/** Watch a date line (components/DateLine's layout effect): returns what stops it. */
export const fitDateLine = (line: HTMLElement | null) =>
  watchTextRoom(line, (room) => fit(line!, room))
/** The shapes a line can show have changed (DateLine's `formats`). */
export const refitDateLine = (line: HTMLElement): void => refitTextRoom(line)

/**
 * Every format a date on a card can carry (components/DateLine's `formats`): the one Date Format
 * sets — all five while Random Format is on — and the format of every date the mode holds (one
 * browsed back to keeps the format it was drawn in). In FORMAT_IDS' order, so the same set is
 * always spelled the same way.
 */
export function dateLineFormats(
  held: readonly ({ _fmt?: FormatId } | null | undefined)[],
  dateFormat: FormatId,
  randomFormat: boolean,
): FormatId[] {
  const formats = new Set(held.map((date) => date?._fmt ?? dateFormat))
  return FORMAT_IDS.filter((f) => randomFormat || f === dateFormat || formats.has(f))
}
