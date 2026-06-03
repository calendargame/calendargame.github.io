// ─────────────────────────────────────────────────────────────────────────
// engine/answerButtons.js — pure helpers for answer-grid button state and the
// history entries built from it.
//
// `btns` is a map { buttonIndex: state } where state is one of:
//   'correct' | 'wrong-latest' | 'wrong-prev' | 'override-wrong'.
//
// Shared by App (Classic/Flash/Blitz/Deduction handlers), AoxMode, and the game
// reducer — ONE copy. Pure (no app state, no React). Extracted from main.jsx in
// the mode-untangle (Stage C, Step 6) so the engine and the mode components can
// both import them (the reducer can't import from main.jsx — that'd be circular).
// ─────────────────────────────────────────────────────────────────────────
import { isJulianDate, wday, wdayJulian } from '../lib/calendar.js'
import type { DatePart } from '../lib/format.js'

// A single answer-grid button's state, and the index→state map for a question.
export type ButtonState = 'correct' | 'wrong' | 'wrong-latest' | 'wrong-prev' | 'override-wrong'
export type Btns = Record<string, ButtonState>
// A history/answer entry as far as these helpers read it: a weekday date (y/m/d), or a Deduction
// puzzle (type/options/boxes). The reducer's full Entry type is a superset; extra fields pass through.
export type EntryLike = {
  y: number
  m: number
  d: number
  btns?: Btns
  type?: DatePart
  options?: (number | string)[] //  numbers for Day/Year, box-label strings for Month
  boxes?: Array<{ months?: number[] }>
  _jul?: boolean
}

// Does this answer state count as a credited (fully-correct) question?
// True iff a 'correct' is present and no wrong markings remain.
export const computeHasCredit = (btns: Btns | null | undefined): boolean => {
  if (!btns) return false
  const vals = Object.values(btns)
  return (
    vals.length > 0 &&
    vals.includes('correct') &&
    !vals.some((v) => v === 'wrong-latest' || v === 'wrong-prev')
  )
}

// Set button `idx` to `state`, demoting any existing 'wrong-latest' to 'wrong-prev'
// (so only the newest wrong shows bright red; older ones dim).
export const markBtns = (btns: Btns, idx: number, state: ButtonState): Btns => {
  const next = { ...btns }
  for (const k in next) {
    if (next[k] === 'wrong-latest') next[k] = 'wrong-prev'
  }
  next[idx] = state
  return next
}

// markBtns(..., 'correct'): mark idx correct, demoting prior wrongs.
export const mkBtnsWithCorrect = (btns: Btns, idx: number): Btns => markBtns(btns, idx, 'correct')

// Augment a history entry's btns with a synthesized green on the correct answer
// when the entry has a wrong but no correct. Also downgrades any 'wrong-latest' to
// 'wrong-prev' so the dim-when-green-present rendering applies to all reds in the
// augmented entry. The synthesized green honors the entry's _jul snapshot (calendar
// system at generation), with fallbackJulian used when the snapshot is missing.
// For deduction entries (entry.type set), the correct index is derived per sub-mode:
// year uses options.indexOf(y); month uses boxes.findIndex by m (or options.indexOf
// when no boxes); day uses options.indexOf(d). Non-deduction entries use
// wday/wdayJulian on (y,m,d).
export const entryWithGreen = <T extends EntryLike>(
  entry: T | null | undefined,
  fallbackJulian: boolean,
): T | null | undefined => {
  if (!entry) return entry
  const btns: Btns = entry.btns || {}
  const vals = Object.values(btns)
  const hasCorrect = vals.includes('correct')
  if (hasCorrect) return entry
  const hasWrong = vals.some((v) => v === 'wrong' || v === 'wrong-latest' || v === 'wrong-prev')
  if (!hasWrong) return entry
  let correctIdx = -1
  if (entry.type) {
    if (entry.type === 'year' && entry.options)
      correctIdx = entry.options.findIndex((yy) => yy === entry.y)
    else if (entry.type === 'month') {
      if (entry.boxes) correctIdx = entry.boxes.findIndex((b) => b.months && b.months.includes(entry.m))
      else if (entry.options) correctIdx = entry.options.findIndex((mm) => mm === entry.m)
    } else if (entry.type === 'day' && entry.options)
      correctIdx = entry.options.findIndex((dd) => dd === entry.d)
  } else {
    const useJul = (entry._jul != null ? entry._jul : fallbackJulian) && isJulianDate(entry.y, entry.m, entry.d)
    correctIdx = useJul ? wdayJulian(entry.y, entry.m, entry.d) : wday(entry.y, entry.m, entry.d)
  }
  if (correctIdx < 0) return entry
  const newBtns = { ...btns }
  for (const k in newBtns) {
    if (newBtns[k] === 'wrong-latest') newBtns[k] = 'wrong-prev'
  }
  newBtns[correctIdx] = 'correct'
  // Only `btns` is swapped — every other field passes through untouched, so the result is still
  // the same shape T. (TS can't verify a generic spread equals T, hence the asserted return.)
  return { ...entry, btns: newBtns } as T
}
