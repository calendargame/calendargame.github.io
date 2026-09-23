// ─────────────────────────────────────────────────────────────────────────
// engine/useGameEngine.ts — binds the pure gameReducer to React.
//
// The reducer is pure, so this hook owns the impure inputs it can't compute:
//   • new dates — via `genDate` passed in by the parent (exactly like AoxMode
//     receives `genDate={genDate}`), so all the year-range / format / calendar
//     settings stay baked into one place (App's genDate).
//   • solve times — `performance.now()` deltas from a per-question start stamp.
//
// It returns the engine state, the derived `correct` weekday, the Override button's whole state
// (`overrideAvail`, `undoAvail` = which word it reads, `overridePlan` = what a press would do to
// which card), and the action callbacks the UI wires to buttons.
//
// Mode-untangle (Stage C, Step 6, sub-step 1c). Classic is the first consumer;
// Flash/Blitz/Deduction pass their own config when they move onto the engine.
//
// useReducer infers `dispatch: Dispatch<GameAction>` from the typed reducer, so
// every dispatch below is checked against the action union (Stage C, TypeScript).
// ─────────────────────────────────────────────────────────────────────────
import { useReducer, useRef, useEffect, useMemo } from 'react'
import {
  gameReducer,
  initEngine,
  correctIndexOf,
  effectiveSaveStats,
  overridePlan,
} from './gameReducer.js'
import type { Question, Stats } from './gameReducer.js'
import { migrateEngineState } from './engineMigration.js'
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
  // Round-21 Q11: seed the reducer with a PARKED round instead of a fresh question. A GETTER, read
  // ONCE inside the lazy init — the timed modes (Blitz / MoX) pass one that returns their ended
  // round's engine state from store/sessionRound, keyed by the ACTIVE preset, so the remount a
  // preset switch causes lands the incoming preset's OWN ended round back on screen. Returns null
  // (or is omitted) ⇒ a fresh question, exactly as before. When it returns a state, genDate is not
  // called and getInitialStats is ignored — the parked state already carries its stats.
  // ⚠ `unknown`, not GameState, and that is the point: a parked blob may have been written by an
  // OLDER build in an older shape, so the lazy init brings every one of them forward through
  // engine/engineMigration before the reducer ever sees it.
  getInitialState?: () => unknown
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
  getInitialState,
}: UseGameEngineOptions) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => {
    const parked = getInitialState?.()
    // ★ THE ONE RESTORE DOOR. Every parked round/run comes through engine/engineMigration, which
    // brings a blob written by an older build (v2.25.0's one-override-per-question engine, or
    // 44dd83f's whole-state undo capsule) into today's per-card shape, and passes a state already in
    // today's shape through untouched. Nothing downstream needs to know which build wrote it.
    if (parked) return migrateEngineState(parked, useJulian)
    return initEngine(genDate(minY, maxY), getInitialStats?.())
  })

  // The solve-timer starts when a NEW question is shown (advance / New / Reset bump
  // questionId). Back/Forward change `date` to a browsed entry but leave questionId
  // untouched, so the timer is NOT reset while browsing — matching App's tStartRef.
  // ★ questionId ONLY EVER MOVES FORWARD, which is what lets this effect have no exceptions in it.
  // An Override moves it in exactly one case — it credited the live card and moved play on to a
  // fresh question, which earns a fresh clock like any other advance — and an Undo never moves it at
  // all: it flips a card, it does not step back through play. (Round 23's first cut needed a
  // hand-back ref here, because its Undo rewound an advancing Override; the per-card toggle removed
  // the rewind, so it removed the ref with it.)
  const tStartRef = useRef<number | null>(null)
  useEffect(() => {
    tStartRef.current = performance.now()
  }, [state.questionId])
  const elapsed = (): number | null =>
    tStartRef.current != null ? (performance.now() - tStartRef.current) / 1000 : null
  // Restart the solve timer without changing the question — AoX One-by-One reveals the next date
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

  // ── THE OVERRIDE BUTTON (round 23 Q6: one permanent per-card toggle) ────────────────────────
  // What a press would do, and to which card, from the ONE selector the reducer itself acts on
  // (gameReducer's overridePlan) — so the word on the button and the flip the press makes can never
  // be told different stories. null ⇔ there is no card to point at.
  const plan = overridePlan(state)
  // OFFERED when there is a card AND Save Stats was on for the card on screen — the per-question
  // FROZEN Save-Stats (effectiveSaveStats), NOT the live `saveStats`: a question processed (answer /
  // Reveal / Show Codes) while Save Stats was OFF is never scored (played not incremented), so it
  // must stay un-overridable even after Save Stats is turned back ON — else crediting it would put
  // good+1 on a played of 0, an impossible 1/0. Fix 2026-06-06 (tests: classic.dom "Save Stats /
  // Override availability"). saveStatsThisQ === null (no stat action yet) falls back to the live
  // setting, which is also what dims the button on a fresh question in a casual mode with Save Stats
  // off. Blitz and MoX feed the engine saveStats:true always, so for them this reads simply "is
  // there a card to toggle".
  const overrideAvail = effectiveSaveStats(state, saveStats) && plan !== null
  // THE WORD IT READS: Undo when the card it points at is already overridden, Override otherwise.
  // A label and nothing else — one press, one flip, whichever way the card currently sits.
  const undoAvail = overrideAvail && plan !== null && plan.overridden

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
  // The one button's press — Override and Undo alike, because the card decides which it is.
  // `opts.hold` (the run modes): a press that CREDITS the live card stays on it, locked, instead of
  // moving play on — MoX's completing solve, and a Blitz round / MoX run that stays ended. The other
  // modes call override().
  const override = (opts?: { hold?: boolean }) =>
    dispatch({
      type: 'OVERRIDE',
      useJulian,
      tracking,
      nextDate: newDate(),
      hold: opts?.hold,
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
    undoAvail,
    overridePlan: plan,
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
