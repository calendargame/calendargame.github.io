// ─────────────────────────────────────────────────────────────────────────
// engine/useGameEngine.ts — binds the pure gameReducer to React.
//
// The reducer is pure, so this hook owns the impure inputs it can't compute:
//   • new dates — via `genDate` passed in by the parent (exactly like AoxMode
//     receives `genDate={genDate}`), so all the year-range / format / calendar
//     settings stay baked into one place (App's genDate).
//   • solve times — `performance.now()` deltas from a per-question start stamp, snapped onto the
//     0.1 ms grid (engine/stats' solveTimeFromMs).
//
// It returns the engine state, the calendar the card on screen is read in (`julian`) and its
// `correct` answer in that calendar, the Override button's whole state
// (`overrideAvail` = is the press on offer, `overridden` = which word it reads, `overridePlan` = what
// a press would do to which card), and the action callbacks the UI wires to buttons.
//
// Mode-untangle (Stage C, Step 6, sub-step 1c). Classic is the first consumer;
// Deduction/Flash/Blitz pass their own config when they move onto the engine.
//
// useReducer infers `dispatch: Dispatch<GameAction>` from the typed reducer, so
// every dispatch below is checked against the action union (Stage C, TypeScript).
// ─────────────────────────────────────────────────────────────────────────
import { useReducer, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  gameReducer,
  initEngine,
  calendarOf,
  correctIndexOf,
  effectiveSaveStats,
  overridePlan,
  regenReplaces,
} from './gameReducer.js'
import type { GameAction, GameState, Question, Stats } from './gameReducer.js'
import { deepFreeze } from './freeze.js'
import { checkGameInvariants } from './invariants.js'
import { solveTimeFromMs } from './stats.js'
import { usePlayerBusy } from '../lib/playerBusy.js'
import { inUnasked, noteUnaskedSwap, swapScreenOf } from '../lib/unaskedSwap.js'
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
  // What this engine's question is to the player right now, as its SCREEN sees it — the mode's half
  // of "is the player busy" (lib/playerBusy); the engine supplies the rest below.
  //   'live'      a round, a run or a flash is under way on the page being shown (Blitz, MoX, Flash);
  //   'question'  a casual question is on the page being shown (Classic, Deduction);
  //   'idle'      neither: another page is the one shown, or nothing has been begun.
  play: 'live' | 'question' | 'idle'
  // The engine's silo ('classic', 'flash', 'dedDay', …, 'aox', 'blitz'): attached to any tripwire report
  // so it says WHICH mode hit an impossible state, and the screen an unasked swap of its question is
  // noted for (lib/unaskedSwap's swapScreenOf).
  label: string
  // Hydrate lifetime stats from saved progress on mount (Stage D1). A GETTER — read ONCE inside the
  // lazy reducer init (where genDate is already read), so the store access stays out of render and
  // the engine never re-hydrates mid-session. Omitted ⇒ blank stats (timed modes; post-Full-Reset remount).
  getInitialStats?: () => Stats
  // Seed the reducer with a PARKED engine instead of a fresh question. A GETTER, read ONCE inside the
  // lazy init. Two kinds of screen pass one: the timed modes (MoX / Blitz) return their ENDED round
  // from store/sessionRound, so the remount a preset switch causes lands the incoming copy's own
  // ended round back on screen; the casual modes (Classic / Deduction / Flash) return the history
  // they last parked (store/sessionHistory), with the waiting question settled by modes/modeHooks'
  // restoredEngine. Returns null (or is omitted) ⇒ a fresh question. When it returns a state, genDate
  // is not called and getInitialStats is ignored — the parked state already carries its stats (a
  // casual history is only accepted when they ARE the saved stats getInitialStats would have read).
  // ⚠ A GameState, already checked: the raw blob (which an unknown build on this origin may have
  // written) goes through engine/parkedEngine's restoreParkedEngine in the MODE, at its parked
  // read, because only the mode can drop its own half of the snapshot along with an unreadable engine.
  getInitialState?: () => GameState | null
  // THE ENGINE'S DATA EPOCH (store/screenPool's useScreenEpoch): when it moves, the engine is
  // rebuilt in place on getInitialStats — the saved stats as they now are (gameReducer's HYDRATE) —
  // because another window's answers to its silo came in. Every casual engine passes its own; the
  // round engines (MoX, Blitz) have none, their stats being the round's.
  epoch?: number
}

// ★ IN DEVELOPMENT AND UNDER TEST, EVERY STATE THE HOOK HANDS OUT IS FROZEN, all the way down
// (engine/freeze argues why): a screen, a hook or a store that wrote into an engine state — or into
// the saved stats and the question objects a state is built from — throws on the spot, instead of
// quietly breaking what rests on states never changing in place (engine/invariants' memory of the
// cards it has checked, first of all). `import.meta.env.DEV` is the literal `false` in a production
// build, so there the reducer below is gameReducer itself, the first state is returned as it is
// made, and engine/freeze is not in the bundle.
// What it costs a development build, measured on a 1,000-card history: some 15–50 µs a dispatch (a
// press copies the history array, and each slot of the copy is asked whether it is frozen) — the
// same order as the invariant walk that already runs after every dispatch, and nothing a person can
// perceive. (The reducer's own copies cost a frozen array nothing extra: engine/arrayCopy.)
const engineReducer: (state: GameState, action: GameAction) => GameState = import.meta.env.DEV
  ? (state, action) => deepFreeze(gameReducer(state, action))
  : gameReducer

export function useGameEngine({
  genDate,
  minY,
  maxY,
  useJulian,
  saveStats,
  timingOff,
  play,
  label,
  getInitialStats,
  getInitialState,
  epoch,
}: UseGameEngineOptions) {
  const [state, dispatch] = useReducer(engineReducer, undefined, () => {
    const first = getInitialState?.() ?? initEngine(genDate(minY, maxY), getInitialStats?.())
    return import.meta.env.DEV ? deepFreeze(first) : first
  })
  // The rebuild an epoch move asks for, in the commit it moves in (a layout effect: no frame shows
  // the old stats beside the new).
  const epochSeen = useRef(epoch)
  useLayoutEffect(() => {
    if (epoch === epochSeen.current) return
    epochSeen.current = epoch
    dispatch({
      type: 'HYDRATE',
      nextDate: genDate(minY, maxY),
      stats: getInitialStats?.(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

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
  // On the 0.1 ms grid (engine/stats' solveTimeFromMs): the subtraction's float noise removed, every
  // digit the browser measured kept — so the recorded time, the saved one and a reload's all agree.
  const elapsed = (): number | null =>
    tStartRef.current != null ? solveTimeFromMs(performance.now() - tStartRef.current) : null
  // Restart the solve timer without changing the question — AoX One-by-One reveals the next date
  // on Continue (the date was loaded earlier, hidden), so the solve time must run from the reveal,
  // not from when it loaded. Other modes never call it (the questionId effect covers them).
  const restartTimer = () => {
    tStartRef.current = performance.now()
  }
  // ★ IS THE PLAYER BUSY WITH THIS QUESTION RIGHT NOW? (lib/playerBusy — the one definition,
  // reported from here for every mode.) A round, run or flash under way always is. A casual question
  // is while the clock above is one the player is being timed on: the WAITING question — the card on
  // screen, or the one parked at the front of the forward stack while an older card is browsed — has
  // not been judged yet (it carries no calendar stamp: its first answer, Reveal or Show Codes is
  // still to come, and that is the moment a time is taken), and that time would be recorded.
  const waiting = state.backDepth === 0 ? state.card : state.forwardStack[0].meta
  usePlayerBusy(
    play === 'live'
      ? 'live'
      : play === 'question' &&
          !timingOff &&
          effectiveSaveStats(state, saveStats) &&
          waiting.jul === undefined
        ? 'clock'
        : null,
  )

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
  // THE CALENDAR THE CARD ON SCREEN IS READ IN (gameReducer's calendarOf): the one it was judged in
  // once anything has judged it — live or browsed to — and the Julian Calendar setting as it stands
  // for a date nobody has touched. The mode hands it to its codes panel, so the codes always arrive
  // at the answer the grid marks.
  const julian = calendarOf(state.card, state.date, useJulian)
  // The correct answer index in that calendar — weekday for Classic/Flash/Blitz, puzzle option for
  // Deduction (correctIndexOf dispatches on whether state.date is a puzzle). Used for the answer
  // flash.
  const correct = useMemo(() => correctIndexOf(state.date, julian), [state.date, julian])

  // ── THE OVERRIDE BUTTON (one permanent per-card toggle) ──────────────────────────────────────
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
  // off. MoX and Blitz feed the engine saveStats:true always, so for them this reads simply "is
  // there a card to toggle".
  const overrideAvail = effectiveSaveStats(state, saveStats) && plan !== null
  // THE WORD IT READS: Undo when the card it points at is already overridden, Override otherwise —
  // a fact about the CARD, so it is NOT gated on `overrideAvail`: a dimmed button still says which
  // state its date is in. (It was ANDed with the gate once, and with Save Stats off an overridden
  // card's dimmed button read "Override", then "Undo" again when Save Stats came back — a label that
  // changed with nothing about the card changing.) A label and nothing else — one press, one flip,
  // whichever way the card currently sits.
  const overridden = plan?.overridden ?? false

  // Actions are recreated each render (they close over the latest settings, which is what we
  // want); they read the timer from a ref, so there's no stale-closure hazard.
  const newDate = () => genDate(minY, maxY)
  // ★ A QUESTION REPLACED BY A REACTION THIS WINDOW DID NOT ASK FOR (another window's change: inside
  // lib/unaskedSwap's `unasked`) is an UNASKED SWAP — said here, by the actions that replace one, so
  // the grids remount and the answers are guarded (lib/unaskedSwap).
  const swapped = () => {
    if (inUnasked()) noteUnaskedSwap(swapScreenOf(label))
  }
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
  const doNew = () => {
    dispatch({ type: 'NEW', useJulian, saveStats, nextDate: newDate() })
    swapped()
  }
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
  const resetStats = () => {
    dispatch({ type: 'RESET', timingOff, nextDate: newDate() })
    swapped()
  }
  // Regenerate the waiting question in place (timing/Save-Stats enable, or a date-setting change) —
  // and say whether it WENT: the engine keeps a question that has been used (gameReducer's
  // regenReplaces, the rule REGEN_DATE itself applies), and a screen holding something that belongs
  // to the waiting question — Flash's running flash — drops it only when the question did go.
  const regenDate = (): boolean => {
    const replaces = regenReplaces(state)
    dispatch({ type: 'REGEN_DATE', nextDate: newDate() })
    if (replaces) swapped()
    return replaces
  }
  // Full reset of stats + history + the live question (timing-enable when a desync exists).
  const fullReset = () => {
    dispatch({ type: 'RESET', timingOff: false, nextDate: newDate() })
    swapped()
  }
  // Clear history + current-question state but KEEP stats (timed-mode "Reset" mid-round).
  const resetRound = () => {
    dispatch({ type: 'RESET_ROUND' })
    swapped()
  }
  // Show the answer + lock with NO stat change (Blitz per-round timeout).
  const lockReveal = () => dispatch({ type: 'LOCK_REVEAL', useJulian })
  // Count a played miss + show the answer (Blitz per-question timeout).
  const timeoutMiss = () => dispatch({ type: 'TIMEOUT_MISS', useJulian, saveStats })

  return {
    state,
    julian,
    correct,
    overrideAvail,
    overridden,
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
