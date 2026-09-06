// dedPuzzle — the Deduction puzzle generator and its answer-grid data. Extracted verbatim from
// main.tsx (Q1 phase 1).
//
// Like dateGen, this had to come out BEFORE DeductionMode: the mode calls makeDedPuzzle, so
// leaving the generator in main.tsx would have made the extracted mode import main.tsx — a cycle,
// since main.tsx imports the modes. main.tsx re-exports makeDedPuzzle so
// tests/dateGen.dom.test.jsx keeps importing it from exactly where it always did; no test changes.
import { rint } from './dateGen.js'
import { colSpanClass } from './answerGrid.js'
import { rollFormat } from './modeFormat.js'
import { isGapDate, isJulianDate, isLeap, isLeapJulian, wday, wdayJulian } from './calendar.js'
import type { DatePart } from './format.js'
import type { DedPuzzle } from '../engine/gameReducer.js'
import type { DedOpts } from '../modes/modeTypes.js'

// Deduction option-count constants. YEAR_OPTION_DEFAULT (5) is the universal max for
// distinct-codes Year windows in normal Gregorian/Julian play (N=6+ collides). A Year
// window straddling Oct 15, 1582 collapses to 2 options (the +5 weekday shift across that
// boundary makes any longer window duplicate) — handled by windowYears length, not a const.
// DAY_OPTION_COUNT (7) is the standard Day window; the Oct 1582 left-side {1-4} case uses
// the literal-4 window [1,2,3,4] inline since that's the only valid layout there (codes
// 1-4 repeat at days 15-18).
const YEAR_OPTION_DEFAULT = 5,
  DAY_OPTION_COUNT = 7
// yearGridLayout(n) — the Year sub-mode's answer-grid geometry for an n-option puzzle, and the
// ONE source both the real grid and its invisible sizer strut render from (the strut used to
// hand-copy the n=5 classes, which is exactly how a copy drifts; it now CALLS this with
// YEAR_OPTION_DEFAULT — see the strut note in DeductionMode). n=5, the normal window, is two
// rows on a 6-column grid: three thirds over two halves. n=3 and the Oct-1582-straddle n=2 are
// plain equal columns and span nothing. Combined with ANSWER_GRID_GAP every one of those lands
// on the same column edges as Month's 2-col and Day's 3-col grids.
// NUMBERS FIRST, CLASSES DERIVED (sub-group 1B). The layout is decided ONCE, as `cols` and
// `spanFor` — plain integers — and `gridCls`/`colSpanFor` are read off them through
// answerGrid's colSpanClass. The hit-padding maths needs the integers and Tailwind needs the
// literal class names, and this is what stops those two from becoming two descriptions of the
// shape that can disagree. (Tailwind emits only classes it can SEE, so `grid-cols-${cols}`
// would ship nothing — the class side has to stay literal, which is why it is the derived one.)
const yearGridLayout = (n: number) => {
  const cols = n === 2 ? 2 : n === 5 ? 6 : 3
  const spanFor = (idx: number) => (n === 5 ? (idx < 3 ? 2 : 3) : 1)
  return {
    cols,
    spanFor,
    gridCls: cols === 2 ? 'grid-cols-2' : cols === 6 ? 'grid-cols-6' : 'grid-cols-3',
    colSpanFor: (idx: number) => colSpanClass(spanFor(idx)),
  }
}
// Month deduction boxes — 7 fixed boxes grouping months by shared doomsday code
// Each box: {label:displayed text, months:[month numbers in that box]}
const MONTH_BOXES_COMMON = [
  { label: 'Jan/Oct', months: [1, 10] }, // code 6
  { label: 'Feb/Mar/Nov', months: [2, 3, 11] }, // code 2
  { label: 'Apr/Jul', months: [4, 7] }, // code 5
  { label: 'May', months: [5] }, // code 0
  { label: 'Jun', months: [6] }, // code 3
  { label: 'Aug', months: [8] }, // code 1
  { label: 'Sep/Dec', months: [9, 12] }, // code 4
]
const MONTH_BOXES_LEAP = [
  { label: 'Oct', months: [10] }, // code 6
  { label: 'Mar/Nov', months: [3, 11] }, // code 2
  { label: 'Jan/Apr/Jul', months: [1, 4, 7] }, // code 5
  { label: 'May', months: [5] }, // code 0
  { label: 'Jun', months: [6] }, // code 3
  { label: 'Feb/Aug', months: [2, 8] }, // code 1
  { label: 'Sep/Dec', months: [9, 12] }, // code 4
]
// 1582-specific Month sub-mode box layouts (only used when useJulian=ON and yc=1582).
// 1582 has the Julian/Gregorian split: Jan-Sep + Oct1-4 use Julian (year code +1),
// Oct15+ + Nov + Dec use Gregorian (year code -2). The effective month code = month code + year code.
// Three day-ranges produce three layouts; only October's box position differs across them.
const MONTH_BOXES_1582_PRE = [
  // Days 1-4 of any month: Oct uses Julian
  { label: 'Jan/Oct/Nov', months: [1, 10, 11] }, // sum 0
  { label: 'Feb/Mar', months: [2, 3] }, // sum 3
  { label: 'Apr/Jul', months: [4, 7] }, // sum 6
  { label: 'May', months: [5] }, // sum 1
  { label: 'Jun', months: [6] }, // sum 4
  { label: 'Aug/Dec', months: [8, 12] }, // sum 2
  { label: 'Sep', months: [9] }, // sum 5
]
const MONTH_BOXES_1582_POST = [
  // Days 15-31: Oct uses Gregorian (joins Jun)
  { label: 'Jan/Nov', months: [1, 11] }, // sum 0
  { label: 'Feb/Mar', months: [2, 3] }, // sum 3
  { label: 'Apr/Jul', months: [4, 7] }, // sum 6
  { label: 'May', months: [5] }, // sum 1
  { label: 'Jun/Oct', months: [6, 10] }, // sum 4
  { label: 'Aug/Dec', months: [8, 12] }, // sum 2
  { label: 'Sep', months: [9] }, // sum 5
]
const MONTH_BOXES_1582_GAP = [
  // Days 5-14: Oct excluded entirely (gap days don't exist in Oct 1582)
  { label: 'Jan/Nov', months: [1, 11] }, // sum 0
  { label: 'Feb/Mar', months: [2, 3] }, // sum 3
  { label: 'Apr/Jul', months: [4, 7] }, // sum 6
  { label: 'May', months: [5] }, // sum 1
  { label: 'Jun', months: [6] }, // sum 4
  { label: 'Aug/Dec', months: [8, 12] }, // sum 2
  { label: 'Sep', months: [9] }, // sum 5
]
// ============================================================
// makeDedPuzzle — the PURE Deduction puzzle generator (mode-untangle Step 4).
//
// Returns a fresh puzzle {type,y,m,d,w,options,boxes?,_fmt,_jul,…} for the given sub-mode +
// year range, or null when a Year puzzle can't be built for the range (caller keeps the
// previous puzzle — App's "retain rather than show a degenerate puzzle"). This is App's old
// spawnDedWithRange body, lifted out so DeductionMode's shared-engine genDate can produce
// puzzles; App's spawnDedWithRange now delegates here (one source of truth). The side effects
// the old version had inline (setCalcPenalty, tStartRef) are the caller's concern now — the
// engine owns the per-question reset + solve timer. aw/dimFn are the local calendar helpers
// (mirrors App's activeWday/dimFn, keyed off the passed useJulian). The dead `pc` local of
// the original is dropped (it was never read). Generation logic is otherwise verbatim.
// ============================================================
function makeDedPuzzle(
  type: DatePart,
  lo: number,
  hi: number,
  {
    useJulian,
    leapChance,
    janFebChance,
    randomFormat,
    dateFormat,
    abCrossOnly,
    julCrossOnly,
    monthOnly1582,
  }: DedOpts,
): DedPuzzle | null {
  const aw = (y: number, m: number, d: number) =>
    useJulian && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)
  const dimFn = (y: number, m: number) => {
    const leap = useJulian && isJulianDate(y, m, 1) ? isLeapJulian(y) : isLeap(y)
    return m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31
  }
  // Decide leap preference once per question (not per attempt) so probabilities don't skew.
  const r = Math.random()
  let wantLeap = null
  if (leapChance === '100') wantLeap = true
  else if (leapChance === '75') wantLeap = r < 0.75
  else if (leapChance === '50') wantLeap = r < 0.5
  // Roll a separate random for Jan/Feb biasing (Option A semantics). Decide once per question.
  const rjf = Math.random()
  let wantJanFeb = null
  if (janFebChance === '100') wantJanFeb = true
  else if (janFebChance === '75') wantJanFeb = rjf < 0.75
  else if (janFebChance === '50') wantJanFeb = rjf < 0.5
  else if (janFebChance === '25') wantJanFeb = rjf < 0.25
  const isLeapForY = (yc: number) => {
    const jul = useJulian && isJulianDate(yc, 1, 1)
    return jul ? isLeapJulian(yc) : isLeap(yc)
  }
  const pickMonth = (isLeapY: boolean) => {
    if (wantJanFeb === null || !isLeapY) return rint(1, 12)
    return wantJanFeb ? rint(1, 2) : rint(3, 12)
  }
  const attachFmt = (o: DedPuzzle) => {
    o._fmt = randomFormat ? rollFormat() : dateFormat
    o._jul = useJulian
    return o
  }
  if (type === 'year') {
    const windowCrossesJulianBoundary = (a: number, b: number, m: number, d: number) => {
      if (!useJulian) return false
      if (a > b) return false
      const aIsJul = isJulianDate(a, m, d),
        bIsJul = isJulianDate(b, m, d)
      return aIsJul !== bIsJul
    }
    const julianBoundaryPair = (m: number, d: number) => {
      if (m === 10 && d >= 5 && d <= 14) return null // gap day
      if (m < 10 || (m === 10 && d <= 4)) return [1582, 1583]
      return [1581, 1582]
    }
    const windowCrossesAb = (a: number, b: number) => Math.floor(a / 100) !== Math.floor(b / 100)
    const validateDistinct = (years: number[], m: number, d: number) => {
      const wdays = []
      for (const y of years) {
        if (m === 2 && d === 29 && !isLeapForY(y)) continue // dead option, skip
        if (d > dimFn(y, m)) return false
        if (isGapDate(y, m, d)) return false
        wdays.push(aw(y, m, d))
      }
      return new Set(wdays).size === wdays.length
    }
    const inRange = (y: number) => y !== 0 && y >= Math.max(1, lo) && y <= hi
    const julCrossPossible =
      julCrossOnly && useJulian && inRange(1582) && (inRange(1581) || inRange(1583))
    const abCrossPossible =
      abCrossOnly && Math.floor(Math.max(1, lo) / 100) !== Math.floor(hi / 100)
    let enforce = null
    if (abCrossPossible && julCrossPossible) enforce = Math.random() < 0.5 ? 'ab' : 'jul'
    else if (abCrossPossible) enforce = 'ab'
    else if (julCrossPossible) enforce = 'jul'
    const trySpawn = () => {
      for (let attempt = 0; attempt < 3000; attempt++) {
        let yc = rint(Math.max(1, lo), hi)
        if (yc === 0) continue
        const isLeapY = isLeapForY(yc)
        if (wantLeap !== null && wantLeap !== isLeapY) continue
        const m = pickMonth(isLeapY)
        const D = dimFn(yc, m)
        if (D <= 0) continue
        const d = rint(1, D)
        if (isGapDate(yc, m, d)) continue
        let windowYears
        if (enforce === 'jul') {
          const pair = julianBoundaryPair(m, d)
          if (!pair || !inRange(pair[0]) || !inRange(pair[1])) continue
          if (m === 2 && d === 29) {
            const leaps = pair.filter((y) => isLeapForY(y))
            if (leaps.length === 0) continue
            yc = leaps[rint(0, leaps.length - 1)]
          } else {
            if (d > dimFn(pair[0], m) || d > dimFn(pair[1], m)) continue
            yc = pair[rint(0, 1)]
          }
          windowYears = pair.slice()
        } else if (enforce === 'ab') {
          const P = rint(0, YEAR_OPTION_DEFAULT - 1)
          const start = yc - P,
            end = start + YEAR_OPTION_DEFAULT - 1
          if (!inRange(start) || !inRange(end)) continue
          if (start <= 0 && end >= 0) continue
          if (!windowCrossesAb(start, end)) continue
          if (windowCrossesJulianBoundary(start, end, m, d)) continue
          windowYears = []
          for (let yy = start; yy <= end; yy++) windowYears.push(yy)
          if (m === 2 && d === 29) {
            const leaps = windowYears.filter((y) => isLeapForY(y))
            if (leaps.length === 0) continue
            yc = leaps[rint(0, leaps.length - 1)]
          }
        } else {
          const P = rint(0, YEAR_OPTION_DEFAULT - 1)
          const start = yc - P,
            end = start + YEAR_OPTION_DEFAULT - 1
          if (!inRange(start) || !inRange(end)) continue
          if (start <= 0 && end >= 0) continue
          if (windowCrossesJulianBoundary(start, end, m, d)) {
            const pair = julianBoundaryPair(m, d)
            if (!pair || !inRange(pair[0]) || !inRange(pair[1])) continue
            if (m === 2 && d === 29) {
              const leaps = pair.filter((y) => isLeapForY(y))
              if (leaps.length === 0) continue
              yc = leaps[rint(0, leaps.length - 1)]
            } else {
              if (d > dimFn(pair[0], m) || d > dimFn(pair[1], m)) continue
              yc = pair[rint(0, 1)]
            }
            windowYears = pair.slice()
          } else {
            windowYears = []
            for (let yy = start; yy <= end; yy++) windowYears.push(yy)
            if (m === 2 && d === 29) {
              const leaps = windowYears.filter((y) => isLeapForY(y))
              if (leaps.length === 0) continue
              yc = leaps[rint(0, leaps.length - 1)]
            }
          }
        }
        if (!validateDistinct(windowYears, m, d)) continue
        const w = aw(yc, m, d)
        return attachFmt({
          type: 'year',
          y: yc,
          m,
          d,
          w,
          options: windowYears,
          _abx: abCrossOnly,
          _julx: julCrossOnly,
        })
      }
      return null
    }
    // No fallback: the Year sub-mode playability contract (yearSubPossible) keeps this from
    // being called for an unbuildable range in normal play. null → caller retains the prior
    // puzzle (App) or supplies an init fallback (DeductionMode's hidden, unreachable Year engine).
    return trySpawn()
  }
  if (type === 'month') {
    const force1582 = monthOnly1582 && useJulian && 1582 >= lo && 1582 <= hi
    let yc = null
    if (force1582) {
      yc = 1582
    } else {
      for (let t = 0; t < 2000; t++) {
        const c = rint(lo, hi)
        if (c === 0) continue
        const il = isLeapForY(c)
        if (wantLeap !== null && wantLeap !== il) continue
        yc = c
        break
      }
      if (yc == null) {
        for (let t = 0; t < 600; t++) {
          const c = rint(lo, hi)
          if (c !== 0) {
            yc = c
            break
          }
        }
        if (yc == null) yc = lo > 0 ? lo : 1
      }
    }
    const isLeapY = isLeapForY(yc)
    const is1582Special = yc === 1582 && useJulian
    if (is1582Special) {
      const dCat = (() => {
        const rr = Math.random()
        if (rr < 4 / 31) return 'pre' // ~13% → days 1-4
        if (rr < 14 / 31) return 'gap' // ~32% → days 5-14 (October excluded from box layout)
        return 'post' // ~55% → days 15-31
      })()
      const boxes =
        dCat === 'pre'
          ? MONTH_BOXES_1582_PRE
          : dCat === 'gap'
            ? MONTH_BOXES_1582_GAP
            : MONTH_BOXES_1582_POST
      let pickFromBoxes = boxes
      if (wantJanFeb === true && isLeapY) {
        const filtered = boxes.filter((b) => b.months.includes(1) || b.months.includes(2))
        if (filtered.length > 0) pickFromBoxes = filtered
      } else if (wantJanFeb === false && isLeapY) {
        const filtered = boxes.filter((b) => !b.months.includes(1) && !b.months.includes(2))
        if (filtered.length > 0) pickFromBoxes = filtered
      }
      const box = pickFromBoxes[rint(0, pickFromBoxes.length - 1)]
      let m
      if (wantJanFeb === true && isLeapY) {
        const allowed = box.months.filter((mm) => mm === 1 || mm === 2)
        m =
          allowed.length > 0
            ? allowed[rint(0, allowed.length - 1)]
            : box.months[rint(0, box.months.length - 1)]
      } else if (wantJanFeb === false && isLeapY) {
        const allowed = box.months.filter((mm) => mm !== 1 && mm !== 2)
        m =
          allowed.length > 0
            ? allowed[rint(0, allowed.length - 1)]
            : box.months[rint(0, box.months.length - 1)]
      } else m = box.months[rint(0, box.months.length - 1)]
      let d
      if (m === 10) {
        if (dCat === 'pre') d = rint(1, 4)
        else d = rint(15, 31) // dCat='post' (gap is impossible here per box layout)
      } else {
        const D = dimFn(yc, m)
        if (dCat === 'pre') d = rint(1, Math.min(4, D))
        else if (dCat === 'gap') d = rint(5, Math.min(14, D))
        else d = rint(15, D)
      }
      const w = aw(yc, m, d)
      return attachFmt({
        type: 'month',
        y: yc,
        d,
        w,
        m,
        options: boxes.map((b) => b.label),
        boxes: boxes.map((b) => ({ ...b, months: [...b.months] })),
        _m1582: monthOnly1582,
      })
    }
    const boxes = isLeapY ? MONTH_BOXES_LEAP : MONTH_BOXES_COMMON
    let pickFromBoxes = boxes
    if (wantJanFeb === true && isLeapY) {
      const filtered = boxes.filter((b) => b.months.includes(1) || b.months.includes(2))
      if (filtered.length > 0) pickFromBoxes = filtered
    } else if (wantJanFeb === false && isLeapY) {
      const filtered = boxes.filter((b) => !b.months.includes(1) && !b.months.includes(2))
      if (filtered.length > 0) pickFromBoxes = filtered
    }
    const box = pickFromBoxes[rint(0, pickFromBoxes.length - 1)]
    let m
    if (wantJanFeb === true && isLeapY) {
      const allowed = box.months.filter((mm) => mm === 1 || mm === 2)
      m =
        allowed.length > 0
          ? allowed[rint(0, allowed.length - 1)]
          : box.months[rint(0, box.months.length - 1)]
    } else if (wantJanFeb === false && isLeapY) {
      const allowed = box.months.filter((mm) => mm !== 1 && mm !== 2)
      m =
        allowed.length > 0
          ? allowed[rint(0, allowed.length - 1)]
          : box.months[rint(0, box.months.length - 1)]
    } else m = box.months[rint(0, box.months.length - 1)]
    // Oct 1582 via this generic path (only reachable with useJulian OFF — is1582Special above
    // handles ON): the gap days 5-14 never existed, so draw uniformly from the 21 real days
    // (v 1-4 → d=v; v 5-21 → d=v+10 = 15-31). The standard boxes stay correct here — with
    // Julian off, all of 1582 is proleptic Gregorian (the 1582 special boxes encode the
    // Julian/Gregorian split, wrong for this state).
    const D = dimFn(yc, m)
    let d
    if (yc === 1582 && m === 10) {
      const v = rint(1, 21)
      d = v <= 4 ? v : v + 10
    } else d = rint(1, D)
    const w = aw(yc, m, d)
    return attachFmt({
      type: 'month',
      y: yc,
      d,
      w,
      m,
      options: boxes.map((b) => b.label),
      boxes: boxes.map((b) => ({ ...b, months: [...b.months] })),
      _m1582: monthOnly1582,
    })
  }
  if (type === 'day') {
    let yc = null
    for (let t = 0; t < 2000; t++) {
      const c = rint(lo, hi)
      if (c === 0) continue
      const il = isLeapForY(c)
      if (wantLeap !== null && wantLeap !== il) continue
      yc = c
      break
    }
    if (yc == null) {
      for (let t = 0; t < 600; t++) {
        const c = rint(lo, hi)
        if (c !== 0) {
          yc = c
          break
        }
      }
      if (yc == null) yc = lo > 0 ? lo : 1
    }
    const isLeapY = isLeapForY(yc)
    const m = pickMonth(isLeapY),
      D = dimFn(yc, m)
    // Oct 1582 special windows — UNCONDITIONAL (both calendar states): the gap days 5-14 never
    // existed (the app-wide contract — Lookup's "Does Not Exist", the guide's "always excluded"),
    // so the only valid Day layouts are {1-4} or a 7-window inside 15-31. Both are contiguous
    // real-day runs ≤7 wide, so weekday-distinctness holds under Gregorian math too (aw above
    // already keys the weekday off useJulian); a window straddling the gap would collide under
    // BOTH systems (Gregorian's +4 shift across the gap lands day 15 on day 1's weekday).
    const isOct1582Special = yc === 1582 && m === 10
    if (isOct1582Special) {
      const useLeft = Math.random() < 4 / 21
      if (useLeft) {
        const d = rint(1, 4)
        const w = aw(yc, m, d)
        return attachFmt({ type: 'day', y: yc, m, w, d, options: [1, 2, 3, 4] })
      } else {
        const span = DAY_OPTION_COUNT
        const P = rint(0, span - 1)
        const dLo = 15 + P,
          dHi = 25 + P
        const d = rint(dLo, dHi)
        const start = d - P
        const w = aw(yc, m, d)
        const opts = []
        for (let v = start; v < start + span; v++) opts.push(v)
        return attachFmt({ type: 'day', y: yc, m, w, d, options: opts })
      }
    }
    const span = Math.min(DAY_OPTION_COUNT, D)
    const P = rint(0, span - 1)
    const dLo = P + 1,
      dHi = D - (span - 1) + P
    const d = rint(dLo, dHi),
      w = aw(yc, m, d)
    const start = d - P,
      end = start + span - 1
    const opts = []
    for (let v = start; v <= end; v++) opts.push(v)
    return attachFmt({ type: 'day', y: yc, m, w, d, options: opts })
  }
  return null
}

export { YEAR_OPTION_DEFAULT, DAY_OPTION_COUNT, yearGridLayout, makeDedPuzzle }
