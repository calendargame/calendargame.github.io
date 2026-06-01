// ─────────────────────────────────────────────────────────────────────────
// engine/useGameEngine.js — binds the pure gameReducer to React.
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
// ─────────────────────────────────────────────────────────────────────────
import { useReducer, useRef, useEffect, useMemo } from 'react'
import { gameReducer, initEngine, activeWday } from './gameReducer.js'

export function useGameEngine({ genDate, minY, maxY, useJulian, saveStats, timingOff }) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => initEngine(genDate(minY, maxY)))

  // The solve-timer starts when a NEW question is shown (advance / New / Reset bump
  // questionId). Back/Forward change `date` to a browsed entry but leave questionId
  // untouched, so the timer is NOT reset while browsing — matching App's tStartRef.
  const tStartRef = useRef(null)
  useEffect(() => {
    tStartRef.current = performance.now()
  }, [state.questionId])
  const elapsed = () => (tStartRef.current != null ? (performance.now() - tStartRef.current) / 1000 : null)

  const tracking = !timingOff // Classic: timing visible ⇒ record solve times into stats.times
  const correct = useMemo(
    () => activeWday(state.date.y, state.date.m, state.date.d, useJulian),
    [state.date, useJulian],
  )

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
  const overrideAvail =
    saveStats &&
    (state.countedWrong ||
      state.canOverrideCorrect ||
      state.pendingWrongOverride != null ||
      retroOverrideEligible) &&
    !state.overrideUsedThisQ

  // Actions are recreated each render (they close over the latest settings, which is what we
  // want); they read the timer from a ref, so there's no stale-closure hazard.
  const newDate = () => genDate(minY, maxY)
  const answer = (idx) =>
    dispatch({ type: 'ANSWER', idx, useJulian, elapsed: elapsed(), tracking, saveStats, nextDate: newDate() })
  const reveal = () => dispatch({ type: 'REVEAL', useJulian, elapsed: elapsed(), saveStats })
  const showCodes = (open) => dispatch({ type: 'SHOW_CODES', open, useJulian, elapsed: elapsed(), saveStats })
  const doNew = () => dispatch({ type: 'NEW', useJulian, saveStats, nextDate: newDate() })
  const override = () => dispatch({ type: 'OVERRIDE', useJulian, tracking, timingOff, nextDate: newDate() })
  const back = () => dispatch({ type: 'BACK' })
  const forward = () => dispatch({ type: 'FORWARD', useJulian })
  const resetStats = () => dispatch({ type: 'RESET', timingOff, nextDate: newDate() })
  // Regenerate the live date in place (timing/Save-Stats enable, or a date-setting change).
  const regenDate = () => dispatch({ type: 'REGEN_DATE', nextDate: newDate() })
  // Full reset of stats + history + the live question (timing-enable when a desync exists).
  const fullReset = () => dispatch({ type: 'RESET', timingOff: false, nextDate: newDate() })
  // Clear history + current-question state but KEEP stats (timed-mode "Reset" mid-round).
  const resetRound = () => dispatch({ type: 'RESET_ROUND' })

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
  }
}
