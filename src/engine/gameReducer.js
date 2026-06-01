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
import { computeStreaks } from './streak.js'
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

// Recompute {curStreak,bestStreak} from the full credit-history. `middle` (when given)
// is the currently-browsed/live question's credit, inserted between the back-stack and
// the (de-reversed, non-live) forward-stack — matching App's recalcStreak / inline copies.
const streaksFromStacks = (stack, forwardStack, middle) => {
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

    // ── OVERRIDE ───────────────────────────────────────────────────────────────
    // The 5-path override (App's most complex function), Classic scope. Only ever
    // dispatched when overrideAvail (Save Stats on + a path armed + not used this Q), so
    // stat updates apply unconditionally here. Paths are checked 1→5; first match wins.
    case 'OVERRIDE': {
      const { useJulian, tracking, timingOff, nextDate } = action
      const correct = activeWday(state.date.y, state.date.m, state.date.d, useJulian)
      const s0 = { ...state, overrideUsedThisQ: true } // setOverrideUsedThisQ(true) at top

      // PATH 1 — browsing-back: delta-adjust stats for the browsed entry, recalc streak.
      if (state.backDepth > 0 && state.canOverrideCorrect && state.prevStatsSnapshot) {
        const u = state.prevStatsSnapshot
        const newHC = !!u.wasWrong
        const times = [...state.stats.times]
        let stats
        let persistBtns
        if (u.wasWrong) {
          if (state.wrongTime != null && tracking) times.push(state.wrongTime)
          stats = { ...state.stats, good: state.stats.good + 1, times }
          persistBtns = { [correct]: 'correct' }
        } else {
          const tIdx = typeof u.timesLen === 'number' ? u.timesLen : null
          const cut = tIdx != null && tIdx < times.length ? [...times.slice(0, tIdx), ...times.slice(tIdx + 1)] : times
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          persistBtns = { [correct]: 'override-wrong' }
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
        let stats
        if (u.wasWrong) {
          if (state.wrongTime != null && tracking) times.push(state.wrongTime)
          const streak = u.streak + 1
          stats = { ...state.stats, played: u.played + 1, good: u.good + 1, streak, best: Math.max(u.best, streak), times }
        } else {
          stats = { ...state.stats, played: u.played + 1, good: u.good, streak: 0, times }
        }
        let s = { ...s0, stats, prevStatsSnapshot: null, wrongTime: null, canOverrideCorrect: false, countedWrong: true }
        if (u.wasWrong && s.stack.length) {
          const last = s.stack[s.stack.length - 1]
          const wd = activeWday(last.y, last.m, last.d, useJulian)
          s = { ...s, stack: [...s.stack.slice(0, -1), { ...last, btns: { [wd]: 'correct' }, overrideUsed: true }] }
        }
        if (!timingOff) {
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
        let s = {
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
        s = advance(s, { nextDate, useJulian, finalBtns: { [correct]: 'correct' }, saved: true })
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
        const wd = activeWday(last.y, last.m, last.d, useJulian)
        const newStack = [...state.stack.slice(0, -1), { ...last, btns: { [wd]: 'correct' }, overrideUsed: true, hasCredit: true }]
        const { curStreak, bestStreak } = streaksFromStacks(newStack, state.forwardStack)
        let s = {
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
      const retroEligible =
        !state.locked &&
        !state.revealed &&
        !state.countedWrong &&
        !state.canOverrideCorrect &&
        state.pendingWrongOverride == null &&
        state.stack.length > 0 &&
        !state.stack[state.stack.length - 1].overrideUsed &&
        state.stack[state.stack.length - 1].capsule?.snapshot != null
      if (retroEligible) {
        const target = state.stack[state.stack.length - 1]
        const u = target.capsule.snapshot
        const wd = activeWday(target.y, target.m, target.d, useJulian)
        const times = [...state.stats.times]
        let stats
        let newLast
        if (u.wasWrong) {
          if (target.capsule.wrongTime != null && tracking) times.push(target.capsule.wrongTime)
          stats = { ...state.stats, good: state.stats.good + 1, times }
          newLast = { ...target, btns: { [wd]: 'correct' }, overrideUsed: true, hasCredit: true }
        } else {
          const tIdx = typeof u.timesLen === 'number' ? u.timesLen : null
          const cut = tIdx != null && tIdx < times.length ? [...times.slice(0, tIdx), ...times.slice(tIdx + 1)] : times
          stats = { ...state.stats, good: Math.max(0, state.stats.good - 1), times: cut }
          newLast = { ...target, btns: { [wd]: 'override-wrong' }, overrideUsed: true, hasCredit: false }
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
      const fwdCapsule = { snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null, wrongTime: state.wrongTime }
      const fwdEntry =
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
      const cap = prev.capsule || {}
      return {
        ...state,
        calcOpen: false,
        forwardStack: [...state.forwardStack, fwdEntry],
        stack: state.stack.slice(0, -1),
        date: prev,
        persistBtns: wasAnswered ? prev.btns : {},
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
      const capsule = { snapshot: state.prevStatsSnapshot ? { ...state.prevStatsSnapshot } : null, wrongTime: state.wrongTime }
      const pushed = entryWithGreen(
        { ...state.date, btns: { ...state.persistBtns }, overrideUsed: state.overrideUsedThisQ, capsule, hasCredit: state.browseHasCredit },
        useJulian,
      )
      const base = {
        ...state,
        calcOpen: false,
        stack: [...state.stack, pushed],
        forwardStack: state.forwardStack.slice(0, -1),
        backDepth: Math.max(0, state.backDepth - 1),
        date: { y: fwd.y, m: fwd.m, d: fwd.d, _fmt: fwd._fmt, _jul: fwd._jul },
      }
      if (fwd.isLive) {
        const ls = fwd.liveState || {}
        const fc = fwd.capsule || {}
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
      const cap = fwd.capsule || {}
      return {
        ...base,
        persistBtns: fwdAnswered ? fwd.btns : {},
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
