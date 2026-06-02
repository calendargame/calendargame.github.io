// ─────────────────────────────────────────────────────────────────────────
// engine/aoxReducer.js — the AoX game engine as a PURE reducer.
//
// AoX is a genuinely different game from the one-question-loop modes (Classic/
// Flash/Blitz/Deduction): it's a timed RUN of N solves with averaging — it
// completes on the Nth solve (instead of advancing), fails on a mistake (when
// Allow Mistakes is off), supports One-By-One (date hidden until revealed), and
// records a per-config Best Average / Best Median (rolled back when an Override
// undoes the run that set it). So rather than forcing it onto the shared
// gameReducer (which would put AoX-specific run logic into the shared engine),
// AoX gets its OWN clean reducer, built the same way — pure (state, action) =>
// state — and SHARING every genuinely-common building block: the answer-button
// helpers (answerButtons.js), the streak math (streak.js — replacing AoX's old
// inline copies), the time-stat helpers (stats.js), and activeWday (gameReducer).
//
// This is a faithful structural extraction of AoxMode's proven handlers
// (handleCorrect/handleWrong/handleOverride/goBack/goForward/advanceDate/…): the
// component's refs (prevTimesSnap / prevStreakSnap / prevBestSnap / wrongTime /
// nextRoundId / bestRef) are folded INTO state so every transition is atomic and
// unit-testable, while behavior stays identical (proven by tests/aox.dom).
//
// Impure inputs the reducer can't compute — the next random date (genDate) and
// solve times (performance.now) — arrive via the action payload, same as the
// shared engine. `correct` and `elapsed` are supplied by the hook.
//
// Mode-untangle (Stage C, Step 6, Step 5).
// ─────────────────────────────────────────────────────────────────────────
import { activeWday } from './gameReducer.js'
import { computeStreaks } from './streak.js'
import { computeHasCredit, markBtns, mkBtnsWithCorrect, entryWithGreen } from './answerButtons.js'
import { calcMed } from './stats.js'

// The launch / idle engine state for a given starting date.
export const initAox = (date) => ({
  date, //                  current question {y,m,d,_fmt,_jul}
  questionId: 0, //         bumps when a fresh solve-timer should start (the hook resets tStart on this); NOT on back/forward
  persistBtns: {}, //       answer-grid state {idx: 'correct'|'wrong-latest'|'wrong-prev'|'override-wrong'}
  runPhase: 'idle', //      'idle' | 'running' | 'done' | 'failed'
  displayN: 10, //          the run size N, frozen at Begin
  shown: false, //          date revealed (One-By-One hides it until Continue)
  inBackMode: false, //     browsing run history
  stack: [], //             back-history (oldest→newest)
  forwardStack: [], //      forward-history (redo after Back)
  times: [], //             solve times (one per credited solve); times.length === credited count
  streak: 0,
  bestStreak: 0,
  attempts: 0, //           questions attempted this run (played)
  codesOpen: false,
  canOverrideCorrect: false,
  pendingWrongCredit: null, // {wrongTime,prevDate,prevBtns,correctIdx} — a wrong-then-right reclaimable via Override
  overrideUsed: false, //   Override already fired for this question (re-armed on advance)
  browseHasCredit: false, // credit flag for the entry currently being browsed
  questionCounted: false, // this question already counted toward attempts (wrong / reveal / codes)
  bests: {}, //             {[bestKey]: {avg,avgMed,avgRoundId,med,medAvg,medRoundId}} — per-config records (persist across Reset)
  bestNew: {}, //           {[bestKey]: {avg,med}} — "new best!" star flags (cleared on Reset)
  nextRoundId: 1, //        monotonic id stamped on a best, so an Override rollback only lowers a best THIS run set
  // Snapshots (were refs in AoxMode) — folded into state for atomic updates:
  prevTimesSnap: null, //   times array before the current solve (Override rolls back to it)
  prevStreakSnap: null, //  {streak,bestStreak} before the current solve
  prevBestSnap: null, //    {key,best} captured when a best was set (Override restores it)
  wrongTime: null, //       solve time captured at a wrong/reveal/codes (for retroactive credit)
})

// Full-history streak recalc, sharing computeStreaks (replaces AoxMode's two inline cs/bs loops).
// `middle` (when given) is the currently-browsed entry's credit, between the back-stack and the
// de-reversed non-live forward-stack — exactly AoxMode's history-array shape.
const recalc = (stack, forwardStack, middle) => {
  const history = [
    ...stack.map((e) => !!e.hasCredit),
    ...(middle === undefined ? [] : [middle]),
    ...forwardStack.slice().reverse().filter((e) => !e.isLive).map((e) => !!e.hasCredit),
  ]
  return computeStreaks(history)
}

// Restore a best snapshot when an Override undoes the run that set it (AoxMode's repeated
// "if prevBestSnap.key===bestKey: bestRef=prev; clear star; prevBestSnap=null" block).
const rollbackBest = (state, bestKey) => {
  if (!(state.prevBestSnap && state.prevBestSnap.key === bestKey)) return state
  const bestNew = { ...state.bestNew }
  delete bestNew[bestKey]
  return { ...state, bests: { ...state.bests, [bestKey]: state.prevBestSnap.best }, bestNew, prevBestSnap: null }
}

// Run completion: compute this run's Average + Median, update the per-config best (+ star + the
// rollback snapshot). Mirrors advanceDate's completing block (and the identical block in the
// pendingWrongCredit completing path). Gated by saveStats at the call site.
const applyBest = (state, times, bestKey) => {
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const med = calcMed(times)
  const roundId = state.nextRoundId
  const prev = state.bests[bestKey] || { avg: null, avgMed: null, avgRoundId: null, med: null, medAvg: null, medRoundId: null }
  const avgImp = prev.avg == null || avg < prev.avg
  const medImp = prev.med == null || med < prev.med
  const next = {
    avg: avgImp ? avg : prev.avg,
    avgMed: avgImp ? med : prev.avgMed,
    avgRoundId: avgImp ? roundId : prev.avgRoundId,
    med: medImp ? med : prev.med,
    medAvg: medImp ? avg : prev.medAvg,
    medRoundId: medImp ? roundId : prev.medRoundId,
  }
  let bestNew = state.bestNew
  if (avgImp || medImp) {
    const e = state.bestNew[bestKey] || { avg: false, med: false }
    bestNew = { ...state.bestNew, [bestKey]: { avg: e.avg || avgImp, med: e.med || medImp } }
  }
  return {
    ...state,
    nextRoundId: roundId + 1,
    bests: { ...state.bests, [bestKey]: next },
    bestNew,
    prevBestSnap: { key: bestKey, best: { ...prev } },
  }
}

// advanceDate: end the current question. Completing (times.length >= N) → run done (+ best,
// unless saveStats off); else load nextDate, clear the grid, re-arm Override, and start the
// next solve's timer (immediately when not One-By-One; on the next Continue otherwise).
// prevTimesSnap / prevStreakSnap are intentionally NOT cleared here — they must survive to the
// next question so an Override-after-correct can still roll back.
const advance = (state, { times, streak, bestStreak, oneByOne, bestKey, nextDate, saveStats }) => {
  const completing = times.length >= state.displayN
  const base = { ...state, wrongTime: null, codesOpen: false, questionCounted: false, streak, bestStreak }
  if (!completing) {
    const s = { ...base, date: nextDate, persistBtns: {}, overrideUsed: false, prevBestSnap: null }
    if (oneByOne) return { ...s, shown: false }
    return { ...s, shown: true, questionId: state.questionId + 1 }
  }
  if (!saveStats) return { ...base, runPhase: 'done' }
  return applyBest({ ...base, runPhase: 'done' }, times, bestKey)
}

// handleCorrect: a correct weekday click. After a wrong on the same question (questionCounted)
// it earns NO credit but arms pendingWrongCredit + pushes the wrong entry, then advances. A
// first-try correct records the solve time, pushes a credited entry (unless completing), and
// advances/completes.
const handleCorrect = (state, { idx, elapsed, oneByOne, bestKey, nextDate, saveStats }) => {
  if (state.questionCounted) {
    const prevBtns = { ...state.persistBtns }
    for (const k in prevBtns) if (prevBtns[k] === 'wrong-latest') prevBtns[k] = 'wrong-prev'
    prevBtns[idx] = 'correct'
    const s = {
      ...state,
      pendingWrongCredit: { wrongTime: state.wrongTime, prevDate: { ...state.date }, prevBtns, correctIdx: idx },
      canOverrideCorrect: false,
      prevTimesSnap: null,
      prevStreakSnap: null,
      stack: [
        ...state.stack,
        { ...state.date, btns: prevBtns, overrideUsed: state.overrideUsed, capsule: { snapshot: null, streakSnap: state.prevStreakSnap ? { ...state.prevStreakSnap } : null, wrongTime: state.wrongTime }, hasCredit: false },
      ],
      forwardStack: [],
    }
    return advance(s, { times: s.times, streak: s.streak, bestStreak: s.bestStreak, oneByOne, bestKey, nextDate, saveStats })
  }
  const dt = elapsed != null ? elapsed : 0
  const newTimes = [...state.times, dt]
  const completing = newTimes.length >= state.displayN
  const ns = state.streak + 1
  const nb = Math.max(state.bestStreak, ns)
  let s = {
    ...state,
    pendingWrongCredit: null,
    prevTimesSnap: [...state.times],
    prevStreakSnap: { streak: state.streak, bestStreak: state.bestStreak },
    canOverrideCorrect: true,
    times: newTimes,
    attempts: state.attempts + 1,
  }
  if (completing) s.persistBtns = mkBtnsWithCorrect(state.persistBtns, idx)
  else {
    s.stack = [
      ...state.stack,
      { ...state.date, btns: { [idx]: 'correct' }, overrideUsed: state.overrideUsed, capsule: { snapshot: [...state.times], streakSnap: { streak: state.streak, bestStreak: state.bestStreak }, wrongTime: state.wrongTime }, hasCredit: true },
    ]
    s.forwardStack = []
  }
  return advance(s, { times: newTimes, streak: ns, bestStreak: nb, oneByOne, bestKey, nextDate, saveStats })
}

// handleWrong: a wrong weekday click. Counts the attempt (once), zeroes the streak, marks the
// red guess. With Allow Mistakes off it also reveals the correct day and fails the run.
const handleWrong = (state, { idx, correct, elapsed, allowMistakes }) => {
  let persistBtns = markBtns(state.persistBtns, idx, 'wrong-latest')
  let runPhase = state.runPhase
  if (!allowMistakes) {
    persistBtns = mkBtnsWithCorrect(persistBtns, correct)
    runPhase = 'failed'
  }
  return {
    ...state,
    wrongTime: elapsed != null ? elapsed : null,
    attempts: state.questionCounted ? state.attempts : state.attempts + 1,
    questionCounted: true,
    prevStreakSnap: { streak: state.streak, bestStreak: state.bestStreak },
    streak: 0,
    canOverrideCorrect: false,
    prevTimesSnap: null,
    pendingWrongCredit: null,
    persistBtns,
    runPhase,
  }
}

export function aoxReducer(state, action) {
  switch (action.type) {
    // ── RESET ─────────────────────────────────────────────────────────────────
    // The Reset button / visibility-loss. Back to idle on a fresh date. Bests + the round-id
    // counter persist (Reset never wipes records); the "new best!" stars clear.
    case 'RESET':
      return {
        ...initAox(action.nextDate),
        displayN: action.n,
        bests: state.bests,
        nextRoundId: state.nextRoundId,
        questionId: state.questionId + 1,
      }

    // ── BEGIN ─────────────────────────────────────────────────────────────────
    // Start a run from idle: the idle date becomes Q1, the timer starts.
    case 'BEGIN':
      if (state.runPhase !== 'idle') return state
      return { ...state, runPhase: 'running', displayN: action.n, shown: true, questionId: state.questionId + 1 }

    // ── CONTINUE ────────────────────────────────────────────────────────────────
    // Continue from back-browsing (rebuild the run history, load a fresh date), or reveal a
    // hidden One-By-One date. (Begin's idle case is its own action.)
    case 'CONTINUE': {
      const { nextDate, oneByOne, useJulian } = action
      if (state.inBackMode) {
        const dispCapsule = { snapshot: state.prevTimesSnap ? [...state.prevTimesSnap] : null, streakSnap: state.prevStreakSnap ? { ...state.prevStreakSnap } : null, wrongTime: state.wrongTime }
        const dispEntry = entryWithGreen({ ...state.date, btns: { ...state.persistBtns }, overrideUsed: state.overrideUsed, capsule: dispCapsule, hasCredit: state.browseHasCredit }, useJulian)
        const insertions = [dispEntry]
        for (let i = state.forwardStack.length - 1; i >= 1; i--) {
          const { isLive: _il, ...rest } = state.forwardStack[i]
          insertions.push(rest)
        }
        const s = {
          ...state,
          stack: [...state.stack, ...insertions],
          inBackMode: false,
          forwardStack: [],
          date: nextDate,
          persistBtns: {},
          codesOpen: false,
          wrongTime: null,
          canOverrideCorrect: false,
          questionCounted: false,
          pendingWrongCredit: null,
          overrideUsed: false,
        }
        if (oneByOne) return { ...s, shown: false }
        return { ...s, shown: true, questionId: state.questionId + 1 }
      }
      if (state.runPhase === 'running' && !state.shown) {
        return { ...state, shown: true, wrongTime: null, canOverrideCorrect: false, questionCounted: false, pendingWrongCredit: null, questionId: state.questionId + 1 }
      }
      return state
    }

    // ── ANSWER ────────────────────────────────────────────────────────────────
    case 'ANSWER': {
      const { idx, correct, elapsed, allowMistakes, oneByOne, bestKey, nextDate, saveStats } = action
      if (state.runPhase !== 'running' || state.codesOpen || state.inBackMode) return state
      if (oneByOne && !state.shown) return state
      if (idx === correct) return handleCorrect(state, { idx, elapsed, oneByOne, bestKey, nextDate, saveStats })
      return handleWrong(state, { idx, correct, elapsed, allowMistakes })
    }

    // ── REVEAL ────────────────────────────────────────────────────────────────
    // Show the correct day: counts a played miss, zeroes the streak, fails the run when Allow
    // Mistakes is off. (Reveal is gated off while a One-By-One date is still hidden.)
    case 'REVEAL': {
      const { elapsed, allowMistakes, correct, oneByOne } = action
      if (state.runPhase !== 'running' || state.codesOpen || state.inBackMode) return state
      if (oneByOne && !state.shown) return state
      return {
        ...state,
        wrongTime: elapsed != null ? elapsed : null,
        persistBtns: mkBtnsWithCorrect(state.persistBtns, correct),
        streak: 0,
        canOverrideCorrect: false,
        prevTimesSnap: null,
        prevStreakSnap: null,
        pendingWrongCredit: null,
        attempts: state.questionCounted ? state.attempts : state.attempts + 1,
        questionCounted: true,
        runPhase: allowMistakes ? state.runPhase : 'failed',
      }
    }

    // ── SHOW_CODES ──────────────────────────────────────────────────────────────
    // Toggle the codes panel. While browsing / done it's a free toggle. Otherwise opening it is
    // a penalty identical to Reveal (count a miss, reveal the answer, fail when no Allow Mistakes).
    case 'SHOW_CODES': {
      const { elapsed, allowMistakes, correct, oneByOne } = action
      if (state.inBackMode || state.runPhase === 'done') return { ...state, codesOpen: !state.codesOpen }
      const isLocked = state.runPhase === 'done' || state.runPhase === 'failed'
      const codesDisabled = state.runPhase === 'idle' || (oneByOne && !state.shown && !state.inBackMode && !isLocked)
      if (codesDisabled) return state
      let s = { ...state }
      if (!state.codesOpen) {
        s.wrongTime = elapsed != null ? elapsed : null
        s.canOverrideCorrect = false
        s.prevTimesSnap = null
        s.prevStreakSnap = null
        s.pendingWrongCredit = null
        s.streak = 0
        if (!allowMistakes) s.runPhase = 'failed'
        if (!state.questionCounted) s.attempts = state.attempts + 1
        s.questionCounted = true
        s.persistBtns = mkBtnsWithCorrect(state.persistBtns, correct)
      }
      s.codesOpen = !state.codesOpen
      return s
    }

    // ── BACK ────────────────────────────────────────────────────────────────────
    // Step back one entry (only available once the run has ended). The current view is pushed to
    // the forward stack carrying its capsule (so Forward restores override-eligibility exactly).
    case 'BACK': {
      const { useJulian } = action
      if (state.stack.length === 0 || state.runPhase === 'idle' || state.runPhase === 'running') return state
      const prevEntry = state.stack[state.stack.length - 1]
      const fwdHC = !state.inBackMode ? computeHasCredit(state.persistBtns) : state.browseHasCredit
      const fwdEntry = {
        ...state.date,
        btns: { ...state.persistBtns },
        overrideUsed: state.overrideUsed,
        capsule: { snapshot: state.prevTimesSnap ? [...state.prevTimesSnap] : null, streakSnap: state.prevStreakSnap ? { ...state.prevStreakSnap } : null, wrongTime: state.wrongTime, canOverrideCorrect: state.canOverrideCorrect, questionCounted: state.questionCounted, pendingWrongCredit: state.pendingWrongCredit },
        isLive: !state.inBackMode,
        hasCredit: fwdHC,
      }
      const cap = prevEntry.capsule || {}
      const prevWday = activeWday(prevEntry.y, prevEntry.m, prevEntry.d, useJulian)
      return {
        ...state,
        codesOpen: false,
        forwardStack: [...state.forwardStack, fwdEntry],
        stack: state.stack.slice(0, -1),
        date: { ...prevEntry },
        inBackMode: true,
        prevTimesSnap: cap.snapshot || null,
        prevStreakSnap: cap.streakSnap || null,
        wrongTime: cap.wrongTime ?? null,
        canOverrideCorrect: cap.snapshot != null && !(prevEntry.overrideUsed || false),
        overrideUsed: prevEntry.overrideUsed || false,
        persistBtns: prevEntry.btns ?? { [prevWday]: 'correct' },
        pendingWrongCredit: null,
        questionCounted: false,
        browseHasCredit: prevEntry.hasCredit ?? computeHasCredit(prevEntry.btns),
      }
    }

    // ── FORWARD ──────────────────────────────────────────────────────────────────
    case 'FORWARD': {
      const { useJulian } = action
      const fwd = state.forwardStack[state.forwardStack.length - 1]
      if (!fwd) return state
      const capsule = { snapshot: state.prevTimesSnap ? [...state.prevTimesSnap] : null, streakSnap: state.prevStreakSnap ? { ...state.prevStreakSnap } : null, wrongTime: state.wrongTime }
      const pushed = entryWithGreen({ ...state.date, btns: { ...state.persistBtns }, overrideUsed: state.overrideUsed, capsule, hasCredit: state.browseHasCredit }, useJulian)
      const base = { ...state, codesOpen: false, forwardStack: state.forwardStack.slice(0, -1), stack: [...state.stack, pushed] }
      if (fwd.isLive) {
        const fc = fwd.capsule || {}
        return {
          ...base,
          date: { y: fwd.y, m: fwd.m, d: fwd.d, _fmt: fwd._fmt, _jul: fwd._jul },
          persistBtns: fwd.btns || {},
          overrideUsed: fwd.overrideUsed || false,
          canOverrideCorrect: !!fc.canOverrideCorrect,
          questionCounted: !!fc.questionCounted,
          pendingWrongCredit: fc.pendingWrongCredit || null,
          prevTimesSnap: fc.snapshot || null,
          prevStreakSnap: fc.streakSnap || null,
          wrongTime: fc.wrongTime ?? null,
          inBackMode: false,
          browseHasCredit: fwd.hasCredit ?? false,
        }
      }
      const cap = fwd.capsule || {}
      return {
        ...base,
        date: { y: fwd.y, m: fwd.m, d: fwd.d, _fmt: fwd._fmt, _jul: fwd._jul },
        persistBtns: fwd.btns || {},
        pendingWrongCredit: null,
        questionCounted: false,
        prevTimesSnap: cap.snapshot || null,
        prevStreakSnap: cap.streakSnap || null,
        wrongTime: cap.wrongTime ?? null,
        canOverrideCorrect: cap.snapshot != null && !(fwd.overrideUsed || false),
        overrideUsed: fwd.overrideUsed || false,
        browseHasCredit: fwd.hasCredit ?? computeHasCredit(fwd.btns),
      }
    }

    // ── OVERRIDE ──────────────────────────────────────────────────────────────────
    // AoX's 5-path override (by design back-browse + retro are right→wrong only; see AoxMode):
    //   1. browsing-back undo (first-try-correct viewed via Back) → roll back times, recalc streak
    //   2. retro-flip the most recent stack entry right→wrong (live Q untouched)
    //   3. live first-try-correct reversal → undo credit; fail / continue / regen-last per state
    //   4. pendingWrongCredit → credit the previous wrong-then-right question
    //   5. running/failed wrong on this question → credit it + advance (failed→running)
    case 'OVERRIDE': {
      const { allowMistakes, oneByOne, bestKey, nextDate, useJulian, correct, elapsed, saveStats } = action

      // PATH 1 — browsing-back undo (right→wrong only).
      if (state.inBackMode && state.canOverrideCorrect && state.prevTimesSnap != null) {
        const newHC = false
        const { curStreak, bestStreak } = recalc(state.stack, state.forwardStack, newHC)
        let s = { ...state, overrideUsed: true, times: state.prevTimesSnap, browseHasCredit: newHC, streak: curStreak, bestStreak, prevTimesSnap: null, prevStreakSnap: null, canOverrideCorrect: false }
        return rollbackBest(s, bestKey)
      }
      if (state.inBackMode) return state

      // PATH 2 — retro-flip the most recent stack entry (right→wrong).
      const last = state.stack[state.stack.length - 1]
      const retroEligible =
        state.runPhase === 'running' &&
        Object.keys(state.persistBtns).length === 0 &&
        !state.codesOpen &&
        !state.canOverrideCorrect &&
        state.pendingWrongCredit == null &&
        state.stack.length > 0 &&
        !last.overrideUsed &&
        last.capsule?.snapshot != null
      if (retroEligible) {
        let s = rollbackBest({ ...state, overrideUsed: true, times: last.capsule.snapshot }, bestKey)
        const wd = activeWday(last.y, last.m, last.d, useJulian)
        const newLast = { ...last, btns: { [wd]: 'override-wrong' }, overrideUsed: true, hasCredit: false }
        const newStack = [...state.stack.slice(0, -1), newLast]
        const { curStreak, bestStreak } = recalc(newStack, state.forwardStack)
        return { ...s, stack: newStack, streak: curStreak, bestStreak }
      }

      // PATH 3 — live first-try-correct reversal.
      if (state.canOverrideCorrect && state.prevTimesSnap != null) {
        const prevTimes = state.prevTimesSnap
        const wasLastQ = prevTimes.length >= state.displayN - 1
        let s = rollbackBest({ ...state, overrideUsed: true, times: prevTimes, streak: 0 }, bestKey)
        if (state.prevStreakSnap) s.bestStreak = state.prevStreakSnap.bestStreak
        s = { ...s, prevTimesSnap: null, prevStreakSnap: null, canOverrideCorrect: false, questionCounted: true, pendingWrongCredit: null, stack: state.stack.slice(0, -1), codesOpen: false, wrongTime: null }
        if (!allowMistakes) {
          return { ...s, runPhase: 'failed' }
        }
        if (wasLastQ) {
          const r = { ...s, persistBtns: {}, runPhase: 'running', codesOpen: false, questionCounted: false, overrideUsed: false, date: nextDate }
          return oneByOne ? { ...r, shown: false } : { ...r, shown: true, questionId: state.questionId + 1 }
        }
        return { ...s, persistBtns: {}, runPhase: 'running', questionId: state.questionId + 1 }
      }

      // PATH 4 — pendingWrongCredit: credit the previous wrong-then-right question.
      if (state.pendingWrongCredit != null) {
        const { wrongTime, prevDate, prevBtns: _pb, correctIdx } = state.pendingWrongCredit
        const dt = wrongTime != null ? wrongTime : elapsed != null ? elapsed : 0
        const newTimes = [...state.times, dt]
        const preStreak = state.prevStreakSnap?.streak ?? 0
        const ns = preStreak + 1
        const nb = Math.max(state.bestStreak, ns)
        const greenOnly = { [correctIdx ?? correct]: 'correct' }
        let s = { ...state, overrideUsed: true, pendingWrongCredit: null, times: newTimes, streak: ns, bestStreak: nb, canOverrideCorrect: false, prevTimesSnap: null, prevStreakSnap: null }
        if (newTimes.length >= state.displayN) {
          s = saveStats ? applyBest(s, newTimes, bestKey) : s
          s = { ...s, stack: state.stack.slice(0, -1), persistBtns: greenOnly, runPhase: 'done' }
          if (prevDate) s.date = { ...prevDate }
          return s
        }
        s.stack = state.stack.length ? [...state.stack.slice(0, -1), { ...state.stack[state.stack.length - 1], btns: greenOnly, overrideUsed: true }] : state.stack
        return s
      }

      // PATH 5 — override after a wrong on this question (running/failed): credit + advance.
      if (state.runPhase === 'running' || state.runPhase === 'failed') {
        const dt = state.wrongTime != null ? state.wrongTime : elapsed != null ? elapsed : 0
        const preStreak = state.prevStreakSnap?.streak ?? 0
        const newTimes = [...state.times, dt]
        const ns = preStreak + 1
        const nb = Math.max(state.bestStreak, ns)
        let s = {
          ...state,
          overrideUsed: true,
          wrongTime: null,
          prevTimesSnap: null,
          prevStreakSnap: null,
          times: newTimes,
          codesOpen: false,
          canOverrideCorrect: false,
          pendingWrongCredit: null,
          stack: [...state.stack, { ...state.date, btns: { [correct]: 'correct' }, overrideUsed: true, capsule: { snapshot: null, streakSnap: null, wrongTime: null }, hasCredit: true }],
          runPhase: 'running',
        }
        const completing = newTimes.length >= state.displayN
        if (completing) s.persistBtns = mkBtnsWithCorrect(s.persistBtns, correct)
        return advance(s, { times: newTimes, streak: ns, bestStreak: nb, oneByOne, bestKey, nextDate, saveStats })
      }

      return state
    }

    default:
      return state
  }
}
