// ─────────────────────────────────────────────────────────────────────────
// engine/useAoxEngine.js — binds the pure aoxReducer to React.
//
// Same shape as useGameEngine: the reducer is pure, so this hook owns the impure
// inputs it can't compute — new dates (via the parent's genDate) and solve times
// (performance.now deltas from a per-question start stamp). It bakes the live run
// config (n / allowMistakes / oneByOne / saveStats / useJulian / bestKey) into the
// action payloads and returns the engine state + the derived correct weekday + the
// action callbacks AoxMode wires to its buttons.
//
// The solve-timer restarts whenever the engine bumps questionId (Begin, advancing
// to a freshly-shown question, or revealing a One-By-One date) — NOT on Back/Forward
// (browsing changes the date but must not reset the timer), matching AoxMode's old
// tStartRef discipline.
//
// Mode-untangle (Stage C, Step 6, Step 5).
// ─────────────────────────────────────────────────────────────────────────
import { useReducer, useRef, useEffect, useMemo } from 'react'
import { aoxReducer, initAox } from './aoxReducer.js'
import { activeWday } from './gameReducer.js'

export function useAoxEngine({ genDate, minY, maxY, useJulian, saveStats, n, allowMistakes, oneByOne, bestKey }) {
  const [state, dispatch] = useReducer(aoxReducer, undefined, () => initAox(genDate(minY, maxY)))

  const tStartRef = useRef(null)
  useEffect(() => {
    tStartRef.current = performance.now()
  }, [state.questionId])
  const elapsed = () => (tStartRef.current != null ? (performance.now() - tStartRef.current) / 1000 : null)

  const correct = useMemo(
    () => activeWday(state.date.y, state.date.m, state.date.d, useJulian),
    [state.date, useJulian],
  )

  // Actions are recreated each render (closing over the latest config); the timer is read from a
  // ref, so there's no stale-closure hazard.
  const newDate = () => genDate(minY, maxY)
  const run = () => ({ allowMistakes, oneByOne, bestKey, saveStats, useJulian })
  const begin = () => dispatch({ type: 'BEGIN', n })
  const continueRun = () => dispatch({ type: 'CONTINUE', nextDate: newDate(), oneByOne, useJulian })
  const answer = (idx) => dispatch({ type: 'ANSWER', idx, correct, elapsed: elapsed(), nextDate: newDate(), ...run() })
  const reveal = () => dispatch({ type: 'REVEAL', correct, elapsed: elapsed(), allowMistakes, oneByOne })
  const showCodes = () => dispatch({ type: 'SHOW_CODES', correct, elapsed: elapsed(), allowMistakes, oneByOne })
  const override = () => dispatch({ type: 'OVERRIDE', correct, elapsed: elapsed(), nextDate: newDate(), ...run() })
  const back = () => dispatch({ type: 'BACK', useJulian })
  const forward = () => dispatch({ type: 'FORWARD', useJulian })
  const reset = () => dispatch({ type: 'RESET', n, nextDate: newDate() })

  return { state, correct, begin, continueRun, answer, reveal, showCodes, override, back, forward, reset }
}
