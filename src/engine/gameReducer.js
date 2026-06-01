// ─────────────────────────────────────────────────────────────────────────
// engine/gameReducer.js — the shared game engine as a PURE reducer.
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
// SCOPE (mode-untangle Stage C, Step 6, sub-step 1b — CORE lifecycle):
//   NEW, ANSWER, REVEAL, SHOW_CODES, RESET — the Classic question loop, modeling the
//   per-question Save-Stats freeze and the timing (trackingOn) gate. OVERRIDE (5 paths)
//   and BACK/FORWARD land in the next increment. Timer/Blitz/Deduction specifics are
//   added when those modes move onto the engine.
// ─────────────────────────────────────────────────────────────────────────
import { isJulianDate, wday, wdayJulian } from '../lib/calendar.js'
import { computeHasCredit, markBtns, mkBtnsWithCorrect, entryWithGreen } from './answerButtons.js'

// Weekday index (0=Sun) honoring the active calendar (Julian vs Gregorian).
export const activeWday = (y, m, d, useJulian) =>
  useJulian && isJulianDate(y, m, d) ? wdayJulian(y, m, d) : wday(y, m, d)

const blankStats = () => ({ played: 0, good: 0, streak: 0, best: 0, times: [] })

// The launch / fresh-question engine state for a given starting date.
export const initEngine = (date) => ({
  date, //                          current question {y,m,d,_fmt,_jul}
  persistBtns: {}, //               answer-grid state {idx: 'correct'|'wrong-latest'|'wrong-prev'|'override-wrong'}
  stats: blankStats(), //           {played,good,streak,best,times}
  stack: [], //                     back-history (oldest→newest)
  forwardStack: [], //              forward-history (for redo after Back)
  backDepth: 0, //                  how many entries deep we've browsed
  locked: false, //                 grid locked (answered/revealed/browsing)
  revealed: false, //               correct answer shown
  countedWrong: false, //           this question has been "burned" (wrong / Reveal / Show Codes)
  canOverrideCorrect: false, //     a first-try-correct is reversible via Override
  pendingWrongOverride: null, //    {wrongTime,snapshot} — previous wrong reclaimable via Override
  overrideUsedThisQ: false, //      Override already fired for this live question
  calcOpen: false, //               Show Codes panel open
  calcPenaltyActive: false, //      codes were shown on this question (penalty applied)
  browseHasCredit: false, //        credit flag for the entry currently being browsed
  // Snapshots (were refs in App) — folded into state for atomic updates:
  prevStatsSnapshot: null, //       pre-answer stats, for Override rollback {played,good,streak,best,timesLen,wasWrong}
  wrongTime: null, //               solve time captured at a wrong answer (for retroactive credit)
  preCalcPenaltySnapshot: null, //  pre-penalty stats, for Path-4 rollback after Show Codes
  saveStatsThisQ: null, //          frozen Save-Stats value for this question (null until first stat action)
})

// The per-question frozen Save-Stats value (frozen on first stat-affecting action),
// else the live setting. Mirrors App's effectiveSaveStats / saveStatsThisQRef.
const effectiveSaveStats = (state, saveStats) =>
  state.saveStatsThisQ === null ? saveStats : state.saveStatsThisQ

// pushAndNext (Classic): push the just-finished question to history (only when it was
// answered AND Save Stats is on for it), then load nextDate and clear per-question state.
// pendingWrongOverride is armed when the finished question had been counted wrong.
const advance = (state, { nextDate, useJulian, finalBtns, saved }) => {
  const btns = finalBtns ?? state.persistBtns
  const wasAnswered = Object.keys(btns).length > 0
  let stack = state.stack
  if (wasAnswered && saved) {
    const capsule = {
      snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null,
      wrongTime: state.wrongTime,
    }
    stack = [
      ...state.stack,
      entryWithGreen(
        { ...state.date, btns, overrideUsed: false, capsule, hasCredit: computeHasCredit(btns) },
        useJulian,
      ),
    ]
  }
  const pendingWrongOverride = state.countedWrong
    ? { wrongTime: state.wrongTime, snapshot: state.preCalcPenaltySnapshot }
    : null
  return {
    ...state,
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
const snapshot = (stats, wasWrong) => ({
  played: stats.played,
  good: stats.good,
  streak: stats.streak,
  best: stats.best,
  timesLen: stats.times.length,
  wasWrong,
})

export function gameReducer(state, action) {
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
      const { idx, useJulian, elapsed, tracking, saveStats, nextDate } = action
      if (state.locked) return state
      const correct = activeWday(state.date.y, state.date.m, state.date.d, useJulian)
      const effective = effectiveSaveStats(state, saveStats)

      if (idx === correct) {
        let next = { ...state, saveStatsThisQ: effective }
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
          : { [correct]: 'correct' }
        return advance(next, { nextDate, useJulian, finalBtns, saved: effective })
      }

      // Wrong.
      let next = { ...state, saveStatsThisQ: effective, pendingWrongOverride: null }
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
      const correct = activeWday(state.date.y, state.date.m, state.date.d, useJulian)
      if (state.locked && !state.revealed && state.backDepth > 0) {
        return { ...state, persistBtns: mkBtnsWithCorrect(state.persistBtns, correct), revealed: true }
      }
      if (state.locked) return state
      const effective = effectiveSaveStats(state, saveStats)
      let next = { ...state, saveStatsThisQ: effective }
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
      const correct = activeWday(state.date.y, state.date.m, state.date.d, useJulian)
      const effective = effectiveSaveStats(state, saveStats)
      let next = { ...state, calcPenaltyActive: true, calcOpen: true, saveStatsThisQ: effective }
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
      }
    }

    default:
      return state
  }
}
