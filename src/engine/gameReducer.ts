// ─────────────────────────────────────────────────────────────────────────
// engine/gameReducer.ts — the shared game engine as a PURE reducer.
//
// (state, action) => state. No React, no app state, no side effects: the impure
// inputs the original handlers computed inline — the next random date (genDate)
// and solve times (performance.now()) — are supplied by the caller in the action
// payload. Calendar lookups are pure, so the reducer does them directly.
//
// Folding the old App snapshot refs (prevStatsSnapshot / wrongTime /
// preCalcPenaltySnapshot) into state makes every transition atomic, which removes
// the lazy-mutator + stale-setState hazards documented in main.jsx WHILE keeping
// behavior identical — proven by the Classic characterization tests (tests/classic.dom).
//
// This is the engine ALL FIVE modes run on (Classic/Flash/Blitz/Deduction directly;
// AoX via the same hook + a component run/Best layer). The full action set lives here:
// the question loop (NEW/ANSWER/REVEAL/SHOW_CODES/RESET), the 5-path OVERRIDE, the
// Back/Forward history nav, the date regen (REGEN_DATE), and the timed-mode helpers
// (RESET_ROUND/LOCK_REVEAL/TIMEOUT_MISS + the ANSWER `complete` / OVERRIDE `noAdvance`
// flags AoX uses).
//
// TYPES (Stage C, TypeScript — the keystone): `GameState` is the full engine state;
// `GameAction` is a discriminated union on `type`, so every `case` is exhaustively
// checked and each action's payload is validated at the dispatch site. A question is a
// discriminated union too — `Question = WeekdayQuestion | DedPuzzle` — which lets
// `correctIndexOf` narrow by `type` with no casts. History entries are `StackEntry`
// (a question plus answer/override bookkeeping).
// ─────────────────────────────────────────────────────────────────────────
import { isJulianDate, wday, wdayJulian } from '../lib/calendar.js'
import { computeStreaks } from './streak.js'
import { computeHasCredit, markBtns, mkBtnsWithCorrect, entryWithGreen } from './answerButtons.js'
import type { ButtonState, Btns } from './answerButtons.js'
import type { FormatId } from '../lib/format.js'

// ── Question / history-entry types ───────────────────────────────────────────
// A plain weekday question: pick the day-of-week for this date. `type` is absent
// (the discriminant) so the union below narrows weekday-vs-puzzle by its presence.
export interface WeekdayQuestion {
  type?: undefined
  y: number
  m: number
  d: number
  _fmt?: FormatId //  the date-format this question was generated in
  _jul?: boolean //   the calendar system (Julian/Gregorian) at generation
}
// One of a Deduction puzzle's answer boxes (Month sub-mode): a label + the months it covers.
export interface DedBox {
  label: string
  months: number[]
}
// A Deduction puzzle: the weekday `w` is shown and the player picks the hidden piece. The
// three sub-modes are a discriminated union because their `options` differ in kind — Day/Year
// answer by a numeric option (a day number / a year), while Month answers by a box, so its
// `options` hold the box LABELS (strings) and the answer resolves through `boxes`. The `_*`
// flags record the generation settings active at spawn.
interface BasePuzzle {
  y: number
  m: number
  d: number
  w: number //         the shown weekday index (0=Sun)
  _fmt?: FormatId
  _jul?: boolean
}
export interface DayPuzzle extends BasePuzzle {
  type: 'day'
  options: number[] //   the day-number choices
}
export interface MonthPuzzle extends BasePuzzle {
  type: 'month'
  options: string[] //   the box labels (e.g. 'Jan/Oct'); the answer is the box, resolved via `boxes`
  boxes: DedBox[]
  _m1582?: boolean
}
export interface YearPuzzle extends BasePuzzle {
  type: 'year'
  options: number[] //   the year choices
  _abx?: boolean
  _julx?: boolean
}
export type DedPuzzle = DayPuzzle | MonthPuzzle | YearPuzzle
// A question is either a weekday prompt or a Deduction puzzle (discriminated on `type`).
export type Question = WeekdayQuestion | DedPuzzle

// The pre-answer stats snapshot used to roll back an Override (Path 2/4 read every field).
export interface Snapshot {
  played: number
  good: number
  streak: number
  best: number
  timesLen: number
  wasWrong: boolean
}
// The pre-penalty snapshot taken when Show Codes first burns a question (no `wasWrong`).
export interface PreCalcSnapshot {
  played: number
  good: number
  streak: number
  best: number
  timesLen: number
}
// A previous wrong answer reclaimable via Override on the NEXT question (Path 4).
export interface PendingWrongOverride {
  wrongTime: number | null
  snapshot: PreCalcSnapshot | null
}
// A history entry's rollback capsule: the stats snapshot + solve time captured for it.
export interface Capsule {
  snapshot: Snapshot | null
  wrongTime: number | null
}
// The live question's full state, stashed on the forward-stack so FORWARD can restore it.
export interface LiveState {
  locked: boolean
  revealed: boolean
  countedWrong: boolean
  canOverrideCorrect: boolean
  pendingWrongOverride: PendingWrongOverride | null
  calcPenaltyActive: boolean
  preCalcPenaltySnapshot: PreCalcSnapshot | null
  saveStatsFrozen: boolean | null
}
// The answer/override bookkeeping a question carries once it's in the back/forward history.
export interface EntryMeta {
  btns?: Btns
  overrideUsed?: boolean
  capsule?: Capsule
  hasCredit?: boolean
  isLive?: boolean
  liveState?: LiveState
}
// A history entry: a question plus its bookkeeping.
export type StackEntry = Question & EntryMeta

// The running score/time stats.
export interface Stats {
  played: number
  good: number
  streak: number
  best: number
  times: number[]
}

// ── The full engine state ────────────────────────────────────────────────────
export interface GameState {
  date: Question //                 current question {y,m,d,_fmt,_jul} (or a Deduction puzzle)
  questionId: number //             bumps on every advance / RESET — the hook resets the solve-timer on this, NOT on raw date changes (Back/Forward change date but must not reset the timer)
  persistBtns: Btns //              answer-grid state {idx: 'correct'|'wrong-latest'|'wrong-prev'|'override-wrong'}
  stats: Stats //                   {played,good,streak,best,times}
  stack: StackEntry[] //            back-history (oldest→newest)
  forwardStack: StackEntry[] //     forward-history (for redo after Back)
  backDepth: number //              how many entries deep we've browsed
  locked: boolean //                grid locked (answered/revealed/browsing)
  revealed: boolean //              correct answer shown
  countedWrong: boolean //          this question has been "burned" (wrong / Reveal / Show Codes)
  canOverrideCorrect: boolean //    a first-try-correct is reversible via Override
  pendingWrongOverride: PendingWrongOverride | null // previous wrong reclaimable via Override
  overrideUsedThisQ: boolean //     Override already fired for this live question
  calcOpen: boolean //              Show Codes panel open
  calcPenaltyActive: boolean //     codes were shown on this question (penalty applied)
  browseHasCredit: boolean //       credit flag for the entry currently being browsed
  // Snapshots (were refs in App) — folded into state for atomic updates:
  prevStatsSnapshot: Snapshot | null //       pre-answer stats, for Override rollback
  wrongTime: number | null //                 solve time captured at a wrong answer (for retroactive credit)
  preCalcPenaltySnapshot: PreCalcSnapshot | null // pre-penalty stats, for Path-4 rollback after Show Codes
  saveStatsThisQ: boolean | null //           frozen Save-Stats value for this question (null until first stat action)
}

// ── The action set (discriminated union on `type`) ───────────────────────────
// Each action carries the impure inputs the reducer can't compute (the next date,
// the solve time) plus the per-dispatch settings (useJulian / saveStats / timing).
export type GameAction =
  | { type: 'NEW'; nextDate: Question; useJulian: boolean; saveStats: boolean }
  | {
      type: 'ANSWER'
      idx: number
      useJulian: boolean
      elapsed: number | null
      tracking: boolean
      saveStats: boolean
      nextDate: Question
      complete?: boolean
    }
  | { type: 'REVEAL'; useJulian: boolean; elapsed: number | null; saveStats: boolean }
  | { type: 'SHOW_CODES'; open: boolean; useJulian: boolean; elapsed: number | null; saveStats: boolean }
  | { type: 'RESET'; timingOff: boolean; nextDate: Question }
  | { type: 'REGEN_DATE'; nextDate: Question }
  | { type: 'LOCK_REVEAL'; useJulian: boolean }
  | { type: 'TIMEOUT_MISS'; useJulian: boolean; saveStats: boolean }
  | { type: 'RESET_ROUND' }
  | {
      type: 'OVERRIDE'
      useJulian: boolean
      tracking: boolean
      timingOff: boolean
      nextDate: Question
      noAdvance?: boolean
    }
  | { type: 'BACK' }
  | { type: 'FORWARD'; useJulian: boolean }

// Weekday index (0=Sun) honoring the active calendar (Julian vs Gregorian).
export const activeWday = (y: number, m: number, d: number, useJulian: boolean): number =>
  useJulian && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)

// The correct answer index for a question. This is what makes the one shared engine serve
// BOTH weekday modes and Deduction: a Deduction puzzle resolves by its own options/answer —
// year: options.indexOf(y); month: the box whose months include m; day: options.indexOf(d) —
// while a plain weekday question resolves by activeWday on (y,m,d). Mirrors App's
// getDedCorrectIdx / dedCorrectIdxFor and the same dispatch in answerButtons.entryWithGreen.
// Weekday entries have no `type`, so this is byte-identical to the old direct activeWday call
// for Classic/Flash/Blitz. (Month always carries `boxes` from makeDedPuzzle, so it resolves
// through them — the old boxless `options.indexOf(m)` fallback was dead and is gone.)
export const correctIndexOf = (e: Question, useJulian: boolean): number => {
  if (e.type === 'year') return e.options.findIndex((y) => y === e.y)
  if (e.type === 'month') return e.boxes.findIndex((b) => b.months.includes(e.m))
  if (e.type === 'day') return e.options.findIndex((d) => d === e.d)
  return activeWday(e.y, e.m, e.d, useJulian)
}

// Build a single-entry answer map. (A computed-key object literal would widen its value to
// `string`, which isn't assignable to Btns, so we assign through a typed local.)
const oneBtn = (idx: number, s: ButtonState): Btns => {
  const b: Btns = {}
  b[idx] = s
  return b
}

// A stack / forward entry carries the question's date-or-puzzle fields PLUS bookkeeping (btns,
// capsule, hasCredit, isLive, liveState). Strip the bookkeeping to recover just the date/puzzle
// fields — so FORWARD restores a clean `date` that still keeps Deduction's puzzle fields
// (type/options/w/…), not only y/m/d/_fmt/_jul. For weekday entries the result is exactly
// {y,m,d,_fmt,_jul}, identical to the previous explicit field pick.
const stripEntryMeta = ({ btns, overrideUsed, capsule, hasCredit, isLive, liveState, ...date }: StackEntry): Question =>
  date

const blankStats = (): Stats => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })

// The launch / fresh-question engine state for a given starting date.
export const initEngine = (date: Question): GameState => ({
  date,
  questionId: 0,
  persistBtns: {},
  stats: blankStats(),
  stack: [],
  forwardStack: [],
  backDepth: 0,
  locked: false,
  revealed: false,
  countedWrong: false,
  canOverrideCorrect: false,
  pendingWrongOverride: null,
  overrideUsedThisQ: false,
  calcOpen: false,
  calcPenaltyActive: false,
  browseHasCredit: false,
  prevStatsSnapshot: null,
  wrongTime: null,
  preCalcPenaltySnapshot: null,
  saveStatsThisQ: null,
})

// The per-question frozen Save-Stats value (frozen on first stat-affecting action),
// else the live setting. Mirrors App's effectiveSaveStats / saveStatsThisQRef.
const effectiveSaveStats = (state: GameState, saveStats: boolean): boolean =>
  state.saveStatsThisQ === null ? saveStats : state.saveStatsThisQ

// pushAndNext (Classic): push the just-finished question to history (only when it was
// answered AND Save Stats is on for it), then load nextDate and clear per-question state.
// pendingWrongOverride is armed when the finished question had been counted wrong.
const advance = (
  state: GameState,
  { nextDate, useJulian, finalBtns, saved }: { nextDate: Question; useJulian: boolean; finalBtns?: Btns; saved: boolean },
): GameState => {
  const btns = finalBtns ?? state.persistBtns
  const wasAnswered = Object.keys(btns).length > 0
  let stack = state.stack
  if (wasAnswered && saved) {
    const capsule: Capsule = {
      snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null,
      wrongTime: state.wrongTime,
    }
    const pushed = entryWithGreen(
      { ...state.date, btns, overrideUsed: false, capsule, hasCredit: computeHasCredit(btns) },
      useJulian,
    )
    // pushed is built from a non-null literal, so it's always defined — the guard just satisfies the type.
    if (pushed) stack = [...state.stack, pushed]
  }
  // Deduction never arms pendingWrongOverride (App's runDeductionRound, unlike pushAndNext,
  // doesn't), so a wrong-then-right on a puzzle is reclaimed by Path 5 (retro-flip the just-
  // pushed entry), not Path 4. Gate on the finished question being a puzzle (date.type set).
  const isDeductionQ = !!(state.date && state.date.type)
  const pendingWrongOverride: PendingWrongOverride | null =
    state.countedWrong && !isDeductionQ
      ? { wrongTime: state.wrongTime, snapshot: state.preCalcPenaltySnapshot }
      : null
  return {
    ...state,
    questionId: state.questionId + 1,
    stack,
    forwardStack: [],
    date: nextDate,
    persistBtns: {},
    revealed: false,
    locked: false,
    calcPenaltyActive: false,
    calcOpen: false,
    overrideUsedThisQ: false,
    backDepth: 0,
    pendingWrongOverride,
    countedWrong: false,
    wrongTime: null,
    prevStatsSnapshot: null,
    preCalcPenaltySnapshot: null,
    canOverrideCorrect: false,
    saveStatsThisQ: null,
  }
}

// A pre-answer stats snapshot used to roll back an Override.
const snapshot = (stats: Stats, wasWrong: boolean): Snapshot => ({
  played: stats.played,
  good: stats.good,
  streak: stats.streak,
  best: stats.best,
  timesLen: stats.times.length,
  wasWrong,
})

// Recompute {curStreak,bestStreak} from the full credit-history. `middle` (when given)
// is the currently-browsed/live question's credit, inserted between the back-stack and
// the (de-reversed, non-live) forward-stack — matching App's recalcStreak / inline copies.
const streaksFromStacks = (
  stack: StackEntry[],
  forwardStack: StackEntry[],
  middle?: boolean,
): { curStreak: number; bestStreak: number } => {
  const history = [
    ...stack.map((e) => !!e.hasCredit),
    ...(middle === undefined ? [] : [middle]),
    ...forwardStack
      .slice()
      .reverse()
      .filter((e) => !e.isLive)
      .map((e) => !!e.hasCredit),
  ]
  return computeStreaks(history)
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    // ── NEW ────────────────────────────────────────────────────────────────
    // Advance to a fresh question (the "New" button / doNew→pushAndNext).
    case 'NEW': {
      const { nextDate, useJulian, saveStats } = action
      return advance(state, { nextDate, useJulian, saved: effectiveSaveStats(state, saveStats) })
    }

    // ── ANSWER ───────────────────────────────────────────────────────────────
    // Click a weekday (submitDoW). Correct → credit (first try) + advance. Wrong →
    // mark, burn the question, no advance. `elapsed` is the solve time (component-timed);
    // `tracking` is trackingOn() (record times only when timing is visible).
    case 'ANSWER': {
      const { idx, useJulian, elapsed, tracking, saveStats, nextDate, complete } = action
      if (state.locked) return state
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)

      if (idx === correct) {
        const next: GameState = { ...state, saveStatsThisQ: effective }
        if (!state.countedWrong) {
          next.prevStatsSnapshot = snapshot(state.stats, false)
          next.canOverrideCorrect = true
          next.pendingWrongOverride = null
          let stats = state.stats
          if (elapsed != null && tracking && effective) {
            stats = { ...stats, times: [...stats.times, elapsed] }
          }
          if (effective) {
            const streak = stats.streak + 1
            stats = {
              ...stats,
              played: stats.played + 1,
              good: stats.good + 1,
              streak,
              best: Math.max(stats.best, streak),
            }
          }
          next.stats = stats
        }
        const finalBtns = state.countedWrong
          ? mkBtnsWithCorrect(state.persistBtns, correct)
          : oneBtn(correct, 'correct')
        // `complete` (AoX's Nth/last solve): credit the answer but DON'T advance — mark the grid,
        // lock it, and STAY on the question so it can be reviewed + reversed via Override (Path 2).
        // canOverrideCorrect / prevStatsSnapshot from the credit above are preserved. Only AoX
        // passes `complete`; the one-question-loop modes always advance after a correct.
        if (complete && !state.countedWrong) {
          return { ...next, persistBtns: finalBtns, locked: true }
        }
        return advance(next, { nextDate, useJulian, finalBtns, saved: effective })
      }

      // Wrong.
      const next: GameState = { ...state, saveStatsThisQ: effective, pendingWrongOverride: null }
      if (!state.countedWrong) {
        next.wrongTime = elapsed
        next.prevStatsSnapshot = snapshot(state.stats, true)
      }
      next.persistBtns = markBtns(state.persistBtns, idx, 'wrong-latest')
      if (!state.countedWrong && effective) {
        next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      next.canOverrideCorrect = false
      return next
    }

    // ── REVEAL ───────────────────────────────────────────────────────────────
    // Show the correct answer. On an unanswered back-browsed entry it's penalty-free;
    // otherwise it burns the question (counts as played, streak reset) and locks.
    case 'REVEAL': {
      const { useJulian, elapsed, saveStats } = action
      const correct = correctIndexOf(state.date, useJulian)
      if (state.locked && !state.revealed && state.backDepth > 0) {
        return { ...state, persistBtns: mkBtnsWithCorrect(state.persistBtns, correct), revealed: true }
      }
      if (state.locked) return state
      const effective = effectiveSaveStats(state, saveStats)
      const next: GameState = { ...state, saveStatsThisQ: effective }
      if (!state.countedWrong) {
        next.wrongTime = elapsed
        next.prevStatsSnapshot = null
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      next.countedWrong = true
      next.canOverrideCorrect = false
      next.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      next.locked = true
      next.revealed = true
      return next
    }

    // ── SHOW_CODES ─────────────────────────────────────────────────────────────
    // Toggle the codes panel. Opening on a live (non-back-browsed-unanswered) question
    // applies the penalty (counts as played, reveals the answer) — applyCalcPenalty.
    case 'SHOW_CODES': {
      const { open, useJulian, elapsed, saveStats } = action
      if (!open) return { ...state, calcOpen: false }
      // Penalty-free when viewing an unanswered back entry.
      if (state.locked && !state.revealed && state.backDepth > 0) {
        return { ...state, calcOpen: true }
      }
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)
      const next: GameState = { ...state, calcPenaltyActive: true, calcOpen: true, saveStatsThisQ: effective }
      const firstPenalty = !state.countedWrong && !state.revealed
      if (firstPenalty) {
        next.wrongTime = elapsed
        next.prevStatsSnapshot = null
        next.preCalcPenaltySnapshot = {
          played: state.stats.played,
          good: state.stats.good,
          streak: state.stats.streak,
          best: state.stats.best,
          timesLen: state.stats.times.length,
        }
        if (effective) next.stats = { ...state.stats, played: state.stats.played + 1, streak: 0 }
      }
      if (state.backDepth === 0) next.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      if (!state.revealed) next.revealed = true
      if (!state.countedWrong) {
        next.countedWrong = true
        next.canOverrideCorrect = false
      }
      return next
    }

    // ── RESET ────────────────────────────────────────────────────────────────
    // Reset Stats: clear stats + history + per-question state. The date is regenerated
    // when timing is visible OR the current question was burned; otherwise kept (you
    // haven't used it yet). `nextDate` is supplied for the regen case.
    case 'RESET': {
      const { timingOff, nextDate } = action
      const regen = !timingOff || state.countedWrong || state.revealed
      return {
        ...initEngine(regen ? nextDate : state.date),
        questionId: state.questionId + 1,
      }
    }

    // ── REGEN_DATE ───────────────────────────────────────────────────────────────
    // Swap the live date in place — no history push, no stat change. Used by
    // performTimingOn (enabling timing/Save Stats) and by regenDecisionFor (a format /
    // leap / year-range setting change). A BURNED date (wrong/Reveal/Show Codes) is kept
    // — you haven't used it yet only when it's fresh — and a browsed entry (backDepth>0)
    // is never regenerated. Bumps questionId so the solve-timer restarts (matches
    // performTimingOn setting tStartRef).
    case 'REGEN_DATE': {
      const { nextDate } = action
      if (state.countedWrong || state.revealed || state.backDepth > 0) return state
      return { ...state, date: nextDate, questionId: state.questionId + 1 }
    }

    // ── LOCK_REVEAL ──────────────────────────────────────────────────────────────
    // Show the correct answer + lock, WITHOUT any stat change — Blitz's per-round timeout
    // (the round ended on the clock; the unanswered live question isn't counted, App just
    // marks the answer and locks). Distinct from REVEAL, which counts a played miss.
    case 'LOCK_REVEAL': {
      const { useJulian } = action
      const correct = correctIndexOf(state.date, useJulian)
      return { ...state, persistBtns: mkBtnsWithCorrect(state.persistBtns, correct), locked: true, revealed: true }
    }

    // ── TIMEOUT_MISS ─────────────────────────────────────────────────────────────
    // Blitz per-question (sudden-death) timeout: count a played miss (no `countedWrong`, so
    // no Override path opens) + show the answer. The round-over lock is the component's
    // (!active disables the grid). Distinct from LOCK_REVEAL (no stat) + REVEAL (countedWrong).
    case 'TIMEOUT_MISS': {
      const { useJulian, saveStats } = action
      const correct = correctIndexOf(state.date, useJulian)
      const effective = effectiveSaveStats(state, saveStats)
      const stats = effective ? { ...state.stats, played: state.stats.played + 1, streak: 0 } : state.stats
      return {
        ...state,
        saveStatsThisQ: effective,
        stats,
        persistBtns: mkBtnsWithCorrect(state.persistBtns, correct),
        canOverrideCorrect: false,
        pendingWrongOverride: null,
      }
    }

    // ── RESET_ROUND ──────────────────────────────────────────────────────────────
    // Clear the history + the current question's transient state but KEEP stats and the
    // current date — App's arm() for the timed modes (Flash/Blitz "Reset" while a round is
    // live). Stats survive (unlike RESET); the timer machinery itself is component-owned.
    case 'RESET_ROUND': {
      return {
        ...state,
        persistBtns: {},
        stack: [],
        forwardStack: [],
        backDepth: 0,
        locked: false,
        revealed: false,
        countedWrong: false,
        canOverrideCorrect: false,
        pendingWrongOverride: null,
        overrideUsedThisQ: false,
        calcOpen: false,
        calcPenaltyActive: false,
        browseHasCredit: false,
        prevStatsSnapshot: null,
        wrongTime: null,
        preCalcPenaltySnapshot: null,
        saveStatsThisQ: null,
      }
    }

    // ── OVERRIDE ───────────────────────────────────────────────────────────────
    // The 5-path override (App's most complex function), Classic scope. Only ever
    // dispatched when overrideAvail (Save Stats on + a path armed + not used this Q), so
    // stat updates apply unconditionally here. Paths are checked 1→5; first match wins.
    case 'OVERRIDE': {
      const { useJulian, tracking, timingOff, nextDate, noAdvance } = action
      const correct = correctIndexOf(state.date, useJulian)
      const s0: GameState = { ...state, overrideUsedThisQ: true } // setOverrideUsedThisQ(true) at top

      // PATH 1 — browsing-back: delta-adjust stats for the browsed entry, recalc streak.
      if (state.backDepth > 0 && state.canOverrideCorrect && state.prevStatsSnapshot) {
        const u = state.prevStatsSnapshot
        const newHC = !!u.wasWrong
        const times = [...state.stats.times]
        let stats: Stats
        let persistBtns: Btns
        if (u.wasWrong) {
          if (state.wrongTime != null && tracking) times.push(state.wrongTime)
          stats = { ...state.stats, good: state.stats.good + 1, times }
          persistBtns = oneBtn(correct, 'correct')
        } else {
          const tIdx = typeof u.timesLen === 'number' ? u.timesLen : null
          const cut = tIdx != null && tIdx < times.length ? [...times.slice(0, tIdx), ...times.slice(tIdx + 1)] : times
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          persistBtns = oneBtn(correct, 'override-wrong')
        }
        const { curStreak, bestStreak } = streaksFromStacks(state.stack, state.forwardStack, newHC)
        return {
          ...s0,
          stats: { ...stats, streak: curStreak, best: bestStreak },
          persistBtns,
          browseHasCredit: newHC,
          prevStatsSnapshot: null,
          wrongTime: null,
          canOverrideCorrect: false,
        }
      }

      // PATH 2 — live first-try-correct reversal (or a wrong-then-right reloaded via Back).
      if (state.canOverrideCorrect && state.prevStatsSnapshot) {
        const u = state.prevStatsSnapshot
        const times = state.stats.times.slice(0, u.timesLen)
        let stats: Stats
        if (u.wasWrong) {
          if (state.wrongTime != null && tracking) times.push(state.wrongTime)
          const streak = u.streak + 1
          stats = { ...state.stats, played: u.played + 1, good: u.good + 1, streak, best: Math.max(u.best, streak), times }
        } else {
          stats = { ...state.stats, played: u.played + 1, good: u.good, streak: 0, times }
        }
        let s: GameState = { ...s0, stats, prevStatsSnapshot: null, wrongTime: null, canOverrideCorrect: false, countedWrong: true }
        if (u.wasWrong && s.stack.length) {
          const last = s.stack[s.stack.length - 1]
          const wd = correctIndexOf(last, useJulian)
          s = { ...s, stack: [...s.stack.slice(0, -1), { ...last, btns: oneBtn(wd, 'correct'), overrideUsed: true }] }
        }
        // `noAdvance` (AoX): reversing the completing solve fails the run (Allow Mistakes off) —
        // stay on the question instead of advancing, so the component can lock it as failed.
        if (!timingOff && !noAdvance) {
          s = advance(s, { nextDate, useJulian, saved: true })
          if (s.stack.length)
            s = { ...s, stack: [...s.stack.slice(0, -1), { ...s.stack[s.stack.length - 1], overrideUsed: true }] }
        } else {
          s = { ...s, locked: false, revealed: false, calcPenaltyActive: false, calcOpen: false }
        }
        return s
      }

      // PATH 3 — override after a wrong / Reveal / Show Codes on this question: give credit,
      // recalc streak, advance.
      if (state.countedWrong) {
        const times = [...state.stats.times]
        if (state.wrongTime != null && tracking) times.push(state.wrongTime)
        let s: GameState = {
          ...s0,
          stats: { ...state.stats, good: state.stats.good + 1, times },
          wrongTime: null,
          prevStatsSnapshot: null,
          countedWrong: false,
          canOverrideCorrect: false,
          locked: false,
          revealed: false,
          calcPenaltyActive: false,
          calcOpen: false,
        }
        const { curStreak, bestStreak } = streaksFromStacks(s.stack, s.forwardStack, true)
        s = { ...s, stats: { ...s.stats, streak: curStreak, best: bestStreak } }
        s = advance(s, { nextDate, useJulian, finalBtns: oneBtn(correct, 'correct'), saved: true })
        if (s.stack.length)
          s = { ...s, stack: [...s.stack.slice(0, -1), { ...s.stack[s.stack.length - 1], overrideUsed: true }] }
        return { ...s, pendingWrongOverride: null }
      }

      // PATH 4 — pendingWrongOverride: retroactively credit the PREVIOUS question.
      if (state.pendingWrongOverride != null) {
        const { wrongTime, snapshot: snap } = state.pendingWrongOverride
        const last = state.stack[state.stack.length - 1]
        if (!last) return { ...s0, pendingWrongOverride: null, preCalcPenaltySnapshot: null }
        const times = snap ? state.stats.times.slice(0, snap.timesLen) : [...state.stats.times]
        if (wrongTime != null && tracking) times.push(wrongTime)
        const stats = snap
          ? { ...state.stats, played: snap.played + 1, good: snap.good + 1, times }
          : { ...state.stats, good: state.stats.good + 1, times }
        const wd = correctIndexOf(last, useJulian)
        const newStack = [...state.stack.slice(0, -1), { ...last, btns: oneBtn(wd, 'correct'), overrideUsed: true, hasCredit: true }]
        const { curStreak, bestStreak } = streaksFromStacks(newStack, state.forwardStack)
        let s: GameState = {
          ...s0,
          stats: { ...stats, streak: curStreak, best: bestStreak },
          stack: newStack,
          pendingWrongOverride: null,
          preCalcPenaltySnapshot: null,
        }
        if (!timingOff) {
          s = advance(s, { nextDate, useJulian, saved: true })
          if (s.stack.length)
            s = { ...s, stack: [...s.stack.slice(0, -1), { ...s.stack[s.stack.length - 1], overrideUsed: true }] }
        } else {
          // Live Q untouched — re-arm Override for its own future state (mirrors App).
          s = { ...s, overrideUsedThisQ: false }
        }
        return s
      }

      // PATH 5 — retro-override of the most recent history entry, live Q untouched.
      const target = state.stack[state.stack.length - 1]
      const cap = target?.capsule // guarded read: undefined when the stack is empty
      const retroEligible =
        !state.locked &&
        !state.revealed &&
        !state.countedWrong &&
        !state.canOverrideCorrect &&
        state.pendingWrongOverride == null &&
        state.stack.length > 0 &&
        !target.overrideUsed &&
        cap?.snapshot != null
      if (retroEligible && cap && cap.snapshot) {
        const u = cap.snapshot
        const wd = correctIndexOf(target, useJulian)
        const times = [...state.stats.times]
        let stats: Stats
        let newLast: StackEntry
        if (u.wasWrong) {
          if (cap.wrongTime != null && tracking) times.push(cap.wrongTime)
          stats = { ...state.stats, good: state.stats.good + 1, times }
          newLast = { ...target, btns: oneBtn(wd, 'correct'), overrideUsed: true, hasCredit: true }
        } else {
          const tIdx = typeof u.timesLen === 'number' ? u.timesLen : null
          const cut = tIdx != null && tIdx < times.length ? [...times.slice(0, tIdx), ...times.slice(tIdx + 1)] : times
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          newLast = { ...target, btns: oneBtn(wd, 'override-wrong'), overrideUsed: true, hasCredit: false }
        }
        const newStack = [...state.stack.slice(0, -1), newLast]
        const { curStreak, bestStreak } = streaksFromStacks(newStack, state.forwardStack)
        return { ...s0, stats: { ...stats, streak: curStreak, best: bestStreak }, stack: newStack }
      }

      // No path matched (shouldn't happen — overrideAvail gates dispatch). No-op beyond the
      // overrideUsedThisQ flag, matching App's override() falling through.
      return s0
    }

    // ── BACK ───────────────────────────────────────────────────────────────────
    // Step back one history entry. The current view is pushed onto forwardStack (the live
    // question is tagged isLive + carries its full liveState so Forward can restore it).
    case 'BACK': {
      const prev = state.stack[state.stack.length - 1]
      if (!prev) return state
      const fwdHC = state.backDepth === 0 ? computeHasCredit(state.persistBtns) : state.browseHasCredit
      const fwdCapsule: Capsule = { snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null, wrongTime: state.wrongTime }
      const fwdEntry: StackEntry =
        state.backDepth === 0
          ? {
              isLive: true,
              ...state.date,
              btns: { ...state.persistBtns },
              overrideUsed: state.overrideUsedThisQ,
              capsule: fwdCapsule,
              liveState: {
                locked: state.locked,
                revealed: state.revealed,
                countedWrong: state.countedWrong,
                canOverrideCorrect: state.canOverrideCorrect,
                pendingWrongOverride: state.pendingWrongOverride,
                calcPenaltyActive: state.calcPenaltyActive,
                preCalcPenaltySnapshot: state.preCalcPenaltySnapshot ? { ...state.preCalcPenaltySnapshot } : null,
                saveStatsFrozen: state.saveStatsThisQ,
              },
              hasCredit: fwdHC,
            }
          : { ...state.date, btns: { ...state.persistBtns }, overrideUsed: state.overrideUsedThisQ, capsule: fwdCapsule, hasCredit: fwdHC }
      const wasAnswered = prev.btns && Object.keys(prev.btns).length > 0
      const wasRevealed = !!(prev.btns && Object.values(prev.btns).includes('correct'))
      const cap: Partial<Capsule> = prev.capsule || {}
      return {
        ...state,
        calcOpen: false,
        forwardStack: [...state.forwardStack, fwdEntry],
        stack: state.stack.slice(0, -1),
        date: prev,
        persistBtns: wasAnswered ? prev.btns ?? {} : {},
        locked: true,
        revealed: wasRevealed,
        countedWrong: false,
        pendingWrongOverride: null,
        calcPenaltyActive: false,
        prevStatsSnapshot: cap.snapshot || null,
        wrongTime: cap.wrongTime ?? null,
        preCalcPenaltySnapshot: null,
        canOverrideCorrect: cap.snapshot != null && !(prev.overrideUsed || false),
        overrideUsedThisQ: prev.overrideUsed || false,
        backDepth: state.backDepth + 1,
        browseHasCredit: prev.hasCredit ?? computeHasCredit(prev.btns),
        saveStatsThisQ: true,
      }
    }

    // ── FORWARD ──────────────────────────────────────────────────────────────────
    // Step forward one entry. The current browsed view is pushed back onto the stack; the
    // restored entry is either the live question (full liveState) or another saved entry.
    case 'FORWARD': {
      const { useJulian } = action
      const fwd = state.forwardStack[state.forwardStack.length - 1]
      if (!fwd) return state
      const capsule: Capsule = { snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null, wrongTime: state.wrongTime }
      const pushed = entryWithGreen(
        { ...state.date, btns: { ...state.persistBtns }, overrideUsed: state.overrideUsedThisQ, capsule, hasCredit: state.browseHasCredit },
        useJulian,
      )
      const base: GameState = {
        ...state,
        calcOpen: false,
        stack: pushed ? [...state.stack, pushed] : [...state.stack],
        forwardStack: state.forwardStack.slice(0, -1),
        backDepth: Math.max(0, state.backDepth - 1),
        date: stripEntryMeta(fwd),
      }
      if (fwd.isLive) {
        const ls: Partial<LiveState> = fwd.liveState || {}
        const fc: Partial<Capsule> = fwd.capsule || {}
        return {
          ...base,
          persistBtns: fwd.btns || {},
          locked: !!ls.locked,
          revealed: !!ls.revealed,
          countedWrong: !!ls.countedWrong,
          canOverrideCorrect: !!ls.canOverrideCorrect,
          pendingWrongOverride: ls.pendingWrongOverride || null,
          calcPenaltyActive: !!ls.calcPenaltyActive,
          preCalcPenaltySnapshot: ls.preCalcPenaltySnapshot || null,
          overrideUsedThisQ: fwd.overrideUsed || false,
          prevStatsSnapshot: fc.snapshot || null,
          wrongTime: fc.wrongTime ?? null,
          browseHasCredit: fwd.hasCredit ?? false,
          saveStatsThisQ: ls.saveStatsFrozen === undefined ? null : ls.saveStatsFrozen,
        }
      }
      const fwdAnswered = fwd.btns && Object.keys(fwd.btns).length > 0
      const fwdRevealed = !!(fwd.btns && Object.values(fwd.btns).includes('correct'))
      const cap: Partial<Capsule> = fwd.capsule || {}
      return {
        ...base,
        persistBtns: fwdAnswered ? fwd.btns ?? {} : {},
        locked: true,
        revealed: fwdRevealed,
        countedWrong: false,
        pendingWrongOverride: null,
        calcPenaltyActive: false,
        preCalcPenaltySnapshot: null,
        prevStatsSnapshot: cap.snapshot || null,
        wrongTime: cap.wrongTime ?? null,
        canOverrideCorrect: cap.snapshot != null && !(fwd.overrideUsed || false),
        overrideUsedThisQ: fwd.overrideUsed || false,
        browseHasCredit: fwd.hasCredit ?? computeHasCredit(fwd.btns),
        saveStatsThisQ: true,
      }
    }

    default:
      return state
  }
}
