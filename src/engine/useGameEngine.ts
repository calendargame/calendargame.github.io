// ─────────────────────────────────────────────────────────────────────────
// engine/useGameEngine.ts — binds the pure gameReducer to React.
//
// The reducer is pure, so this hook owns the impure inputs it can't compute:
//   • new dates — via `genDate` passed in by the parent (exactly like AoxMode
//     receives `genDate={genDate}`), so all the year-range / format / calendar
//     settings stay baked into one place (App's genDate).
//   • solve times — `performance.now()` deltas from a per-question start stamp.
//
// It returns the engine state, the derived `correct` weekday + `overrideAvail`
// (mirroring App's gating), and the action callbacks the UI wires to buttons.
//
// Mode-untangle (Stage C, Step 6, sub-step 1c). Classic is the first consumer;
// Flash/Blitz/Deduction pass their own config when they move onto the engine.
//
// useReducer infers `dispatch: Dispatch<GameAction>` from the typed reducer, so
// every dispatch below is checked against the action union (Stage C, TypeScript).
// ─────────────────────────────────────────────────────────────────────────
import { useReducer, useRef, useEffect, useMemo } from 'react'
import { gameReducer, initEngine, correctIndexOf, effectiveSaveStats } from './gameReducer.js'
import type { Question, Stats } from './gameReducer.js'
import { checkGameInvariants } from './invariants.js'
import { captureError } from '../observability/sentry.js'

// genDate produces the next question for the active year range (the parent bakes in the
// format / leap / calendar settings — it's App's genDate, or makeDedPuzzle for Deduction).
export interface UseGameEngineOptions {
  genDate: (minY: number, maxY: number) => Question
  minY: number
  maxY: number
  useJulian: boolean
  saveStats: boolean
  timingOff: boolean
  // A short mode label ('classic', 'flash', …) attached to any tripwire report so it says WHICH mode
  // hit an impossible state. Optional — the stats/history context is reported either way.
  label?: string
  // Hydrate lifetime stats from saved progress on mount (Stage D1). A GETTER — read ONCE inside the
  // lazy reducer init (where genDate is already read), so the store access stays out of render and
  // the engine never re-hydrates mid-session. Omitted ⇒ blank stats (timed modes; post-Full-Reset remount).
  getInitialStats?: () => Stats
}

export function useGameEngine({
  genDate,
  minY,
  maxY,
  useJulian,
  saveStats,
  timingOff,
  label,
  getInitialStats,
}: UseGameEngineOptions) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    initEngine(genDate(minY, maxY), getInitialStats?.()),
  )

  // The solve-timer starts when a NEW question is shown (advance / New / Reset bump
  // questionId). Back/Forward change `date` to a browsed entry but leave questionId
  // untouched, so the timer is NOT reset while browsing — matching App's tStartRef.
  const tStartRef = useRef<number | null>(null)
  useEffect(() => {
    tStartRef.current = performance.now()
  }, [state.questionId])
  const elapsed = (): number | null =>
    tStartRef.current != null ? (performance.now() - tStartRef.current) / 1000 : null
  // Restart the solve timer without changing the question — AoX One-By-One reveals the next date
  // on Continue (the date was loaded earlier, hidden), so the solve time must run from the reveal,
  // not from when it loaded. Other modes never call it (the questionId effect covers them).
  const restartTimer = () => {
    tStartRef.current = performance.now()
  }

  // Tripwire: after every state change, verify the engine's invariants (see engine/invariants.ts).
  // A violation = an IMPOSSIBLE state that didn't crash (an impossible score, a desynced history, a
  // corrupt date) — the kind of silent bug we'd otherwise never hear about on real devices. Report
  // each unique violation ONCE per mounted engine (a Set guards against re-reporting it every render
  // → no Sentry spam). captureError is a no-op until the Sentry SDK loads (production only), so this
  // never fires in dev or tests; the fuzz survey (tests/engine/fuzz) is the dev-time catcher.
  const reportedInvariants = useRef<Set<string>>(new Set())
  useEffect(() => {
    const violations = checkGameInvariants(state, useJulian)
    for (const violation of violations) {
      if (reportedInvariants.current.has(violation)) continue
      reportedInvariants.current.add(violation)
      captureError(new Error(`Game invariant violated: ${violation}`), {
        tripwire: 'gameInvariant',
        mode: label,
        violation,
        stats: state.stats,
        backDepth: state.backDepth,
        forwardLen: state.forwardStack.length,
      })
    }
  }, [state, useJulian, label])

  const tracking = !timingOff // Classic: timing visible ⇒ record solve times into stats.times
  // The correct answer index — weekday for Classic/Flash/Blitz, puzzle option for Deduction
  // (correctIndexOf dispatches on whether state.date is a puzzle). Used for the answer flash.
  const correct = useMemo(() => correctIndexOf(state.date, useJulian), [state.date, useJulian])

  // Override availability — mirrors App's retroOverrideEligible / overrideAvail (Classic scope).
  const last = state.stack[state.stack.length - 1]
  const retroOverrideEligible =
    !state.locked &&
    !state.revealed &&
    !state.countedWrong &&
    !state.canOverrideCorrect &&
    state.pendingWrongOverride == null &&
    !!last &&
    !last.overrideUsed &&
    last.capsule?.snapshot != null
  // Gated on effectiveSaveStats (the per-question FROZEN Save-Stats), NOT the live `saveStats`:
  // a question processed (answer / Reveal / Show Codes) while Save Stats was OFF is never scored
  // (played not incremented), so it must stay override-LOCKED even after Save Stats is turned back
  // ON — else Path 3 would credit good+1 on played 0, an impossible 1/0 (good > played). Fix
  // 2026-06-06 (tests: classic.dom "Save Stats / Override availability"). saveStatsThisQ===null
  // (no stat action yet) falls back to the live setting, so fresh / Path-4 / Path-5 are unchanged.
  const overrideAvail =
    effectiveSaveStats(state, saveStats) &&
    (state.countedWrong ||
      state.canOverrideCorrect ||
      // pendingWrongOverride is void once its target entry was credited via back-browse Path 1
      // (overrideUsed) — else Forward+Override double-credits it (good>played). Fix 2026-06-06.
      (state.pendingWrongOverride != null && !last?.overrideUsed) ||
      retroOverrideEligible) &&
    !state.overrideUsedThisQ

  // Actions are recreated each render (they close over the latest settings, which is what we
  // want); they read the timer from a ref, so there's no stale-closure hazard.
  const newDate = () => genDate(minY, maxY)
  // `opts.complete` (AoX): credit this correct answer but don't advance — the run's last solve
  // stays on screen, locked + reversible. Other modes call answer(idx) → complete undefined.
  const answer = (idx: number, opts?: { complete?: boolean }) =>
    dispatch({
      type: 'ANSWER',
      idx,
      useJulian,
      elapsed: elapsed(),
      tracking,
      saveStats,
      nextDate: newDate(),
      complete: opts?.complete,
    })
  const reveal = () => dispatch({ type: 'REVEAL', useJulian, elapsed: elapsed(), saveStats })
  const showCodes = (open: boolean) =>
    dispatch({ type: 'SHOW_CODES', open, useJulian, elapsed: elapsed(), saveStats })
  const doNew = () => dispatch({ type: 'NEW', useJulian, saveStats, nextDate: newDate() })
  // `opts.noAdvance` (AoX): when an override reverses the run's completing solve and fails the run
  // (Allow Mistakes off), don't advance — stay on the question. Other modes call override().
  const override = (opts?: { noAdvance?: boolean }) =>
    dispatch({
      type: 'OVERRIDE',
      useJulian,
      tracking,
      timingOff,
      nextDate: newDate(),
      noAdvance: opts?.noAdvance,
    })
  const back = () => dispatch({ type: 'BACK' })
  const forward = () => dispatch({ type: 'FORWARD', useJulian })
  const resetStats = () => dispatch({ type: 'RESET', timingOff, nextDate: newDate() })
  // Regenerate the live date in place (timing/Save-Stats enable, or a date-setting change).
  const regenDate = () => dispatch({ type: 'REGEN_DATE', nextDate: newDate() })
  // Full reset of stats + history + the live question (timing-enable when a desync exists).
  const fullReset = () => dispatch({ type: 'RESET', timingOff: false, nextDate: newDate() })
  // Clear history + current-question state but KEEP stats (timed-mode "Reset" mid-round).
  const resetRound = () => dispatch({ type: 'RESET_ROUND' })
  // Show the answer + lock with NO stat change (Blitz per-round timeout).
  const lockReveal = () => dispatch({ type: 'LOCK_REVEAL', useJulian })
  // Count a played miss + show the answer (Blitz per-question timeout).
  const timeoutMiss = () => dispatch({ type: 'TIMEOUT_MISS', useJulian, saveStats })

  return {
    state,
    correct,
    overrideAvail,
    retroOverrideEligible,
    answer,
    reveal,
    showCodes,
    doNew,
    override,
    back,
    forward,
    resetStats,
    regenDate,
    fullReset,
    resetRound,
    lockReveal,
    timeoutMiss,
    restartTimer,
  }
}
