// Shared mode-screen hooks, extracted verbatim from main.tsx (Q1 phase 1). These are the pieces of
// per-mode chrome deduped out of the five screens during the Stage-C mode-untangle: they move
// together because every screen uses some subset and none of them belongs to any one screen.
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { gameReducer } from '../engine/gameReducer.js'
import type { GameState, Question } from '../engine/gameReducer.js'
import type { GameEngine, FlashState } from './modeTypes.js'
import { calcLast, calcAvg, calcMed } from '../engine/stats.js'
import { fittedParkedText, restoreParkedText } from '../engine/parkedHistory.js'
import type { ParkedScreen, RestoredHistory } from '../engine/parkedHistory.js'
import { fmtAccuracyPct, truncTime, fmtTime } from '../lib/modeFormat.js'
import { usePresets } from '../store/presets.js'
import { activeDataId } from '../store/amnesic.js'
import { useProgress } from '../store/progress.js'
import {
  SLOT_BUDGET,
  readSessionHistory,
  writeSessionHistory,
  discardSessionHistory,
} from '../store/sessionHistory.js'
import type { HistorySilo } from '../store/sessionHistory.js'

// Timing constants. The codes panel's own timings (its slide duration and the CODES_CLOSE_MS
// freeze window derived from it) live in src/lib/accordionMotion.js and are consumed entirely
// inside components/MethodBreakdown — nothing in this file needs them (Q5, round 8).
export const FLASH_MS = 550 // green/red button flash duration (ms)
// Button-pulse flash (the green/red pulse on an answered option) — transient UI, not engine
// state. Every mode component owns one; this hook is the single copy. Latest-timeout pattern
// so rapid answers each get the full FLASH_MS before clearing. `setFlash` is exposed for the
// few sites that clear it directly (e.g. Deduction's sub-type switch).
export function useButtonFlash() {
  const [flash, setFlash] = useState<FlashState | null>(null)
  const flashClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setFlashWithTimeout = (val: FlashState) => {
    setFlash(val)
    if (flashClearRef.current) clearTimeout(flashClearRef.current)
    flashClearRef.current = setTimeout(() => {
      setFlash(null)
      flashClearRef.current = null
    }, FLASH_MS)
  }
  return { flash, setFlash, setFlashWithTimeout }
}
// The engine-state half of a mode's freshness check (stats all zero, and engineUntouched below) —
// identical across modes. Each mode ANDs its own fields (toggles/timers/bests) on top.
export function engineFresh(s: GameState) {
  return (
    s.stats.played === 0 &&
    s.stats.good === 0 &&
    s.stats.streak === 0 &&
    s.stats.best === 0 &&
    s.stats.times.length === 0 &&
    engineUntouched(s)
  )
}
// Nothing played on this engine since it was made, whatever stats it hydrated: no history, and a live
// question nobody has touched (no flags set, nothing on the card: never wrong, never overridden).
// Such an engine holds only the question it is waiting on — which useParkedHistory still parks (with
// timing hidden that question comes back), marked as holding no play.
function engineUntouched(s: GameState) {
  return (
    s.stack.length === 0 &&
    s.forwardStack.length === 0 &&
    s.backDepth === 0 &&
    s.locked === false &&
    s.revealed === false &&
    s.countedWrong === false &&
    s.card.wrongTime === null &&
    s.card.answered === null &&
    s.calcOpen === false &&
    s.calcPenaltyActive === false
  )
}
// Shared "hideable stats" chrome for the three non-timed modes (Classic, Flash, Deduction): the
// show/hide toggles, the "Enable and Reset Stats?" desync case, and the 6-box stats array for
// <StatPanel>. Re-enabling timing follows App's original rule: OFF→just hide; ON with no
// desync→regen the live date; ON with a desync (stats moved while hidden)→confirm→full reset. That
// last branch was a two-tap arm rendered INSIDE <StatPanel>; Q7 (round 21) made it the shared
// ConfirmModal, opened from the mode component — this hook now just owns the open flag and the
// confirm/cancel handlers. Both toggles (`timingOff` + `scoringOff`) are owned by the component and
// persisted in the mode-prefs store, so they're passed in with their setters (timingOff also feeds
// useGameEngine). Flash is the only mode with a live timer to tear down, so it passes
// afterTimingEnabled() (on re-enable) and onHide() (on mode-leave); Classic/Deduction omit them.
export function useStatsHideToggles({
  eng,
  saveStats,
  visible,
  timingOff,
  setTimingOff,
  scoringOff,
  setScoringOff,
  afterTimingEnabled,
  onHide,
}: {
  eng: GameEngine
  saveStats: boolean
  visible: boolean
  timingOff: boolean
  setTimingOff: (v: boolean) => void
  scoringOff: boolean
  setScoringOff: (v: boolean) => void
  afterTimingEnabled?: () => void
  onHide?: () => void
}) {
  // timingOff + scoringOff are owned by the mode component (persisted in the mode-prefs store) and
  // passed in, so the hook holds no toggle state of its own — it just decides when the desync
  // confirm opens and builds the stats strip from them.
  const S = eng.state.stats
  // "Enable and Reset Stats?" — the ConfirmModal open flag. `closeEnableReset` is the cancel path;
  // `confirmEnableReset` is the accept path.
  const [enableResetOpen, setEnableResetOpen] = useState(false)
  const closeEnableReset = () => setEnableResetOpen(false)
  // Drop a pending confirm the moment the mode goes hidden OR Save Stats goes off — both make the
  // popup meaningless, and it portals to #root so a hidden mode's would otherwise sit over the
  // visible one. React's "adjust state when a prop changes" pattern — compare-and-set during
  // render, NOT a setState-in-effect (which would be a cascading render and would leave the popup
  // up for one extra commit after the mode hides). It converges: once false the guard is false.
  if (enableResetOpen && (!visible || !saveStats)) setEnableResetOpen(false)
  const toggleScoringOff = () => {
    if (!saveStats) return
    setScoringOff(!scoringOff)
  } // scoringOff is the current (prop) value
  const toggleTimingOff = () => {
    if (!saveStats) return
    if (!timingOff) {
      setTimingOff(true)
      return
    }
    // ★ EXACT, because every credited, timed solve keeps its time (round 23 Q3): the only way a
    // credit comes to have no time is an answer given while timing was hidden, which is precisely
    // what this popup is for. The one correction is a save an OLD build trimmed to its newest 1,000
    // times — those credits had times once, and store/progress' v5 migration recorded how many as
    // `timesLost`, so they never read as a desync. (Before the cap went, this check fired after
    // every reload for anyone past 1,000 timed answers, offering to wipe their stats for nothing.)
    const desync = S.good - (S.timesLost ?? 0) !== S.times.length
    if (!desync) {
      eng.regenDate()
      if (afterTimingEnabled) afterTimingEnabled()
      setTimingOff(false)
      return
    }
    // The readouts and the recorded times disagree — turning timing back on cannot reconcile, so
    // it has to reset this mode's stats. Ask first (the popup renders from the mode component).
    setEnableResetOpen(true)
  }
  // Accept: the full reset the reconcile needs, then flip timing on and run the mode's teardown —
  // the exact body the old two-tap's confirming tap ran.
  const confirmEnableReset = () => {
    setEnableResetOpen(false)
    eng.fullReset()
    if (afterTimingEnabled) afterTimingEnabled()
    setTimingOff(false)
  }
  // The mode's teardown (onHide — Flash's live-flash stopper) IS a real side effect, so it stays
  // in an effect. [visible]-only: onHide is re-created each render and listing it would re-fire the
  // teardown every render. (Dropping the pending confirm is handled above, during render.)
  useEffect(() => {
    if (!visible && onHide) onHide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
  const sLast = calcLast(S.times),
    sAvg = calcAvg(S.times),
    sMed = calcMed(S.times)
  // ★ `off` is YOUR toggle and NOTHING ELSE (C1, round 16) — so scoringOff / timingOff go through
  // untouched. The two used to be wrapped as `scoringOff || !saveStats` and `timingOff || !saveStats`,
  // which folded two unrelated facts into one bit: turning Save Stats off then struck through and
  // dashed EVERY box, so your per-group choices disappeared underneath the global one. They were
  // never lost — both flags persist and come back — but you could not SEE them, and so you could not
  // predict what a tap would do. The Save-Stats half of those expressions is now `dimmed`, passed to
  // StatPanel by each screen; see the three-signal note at the top of StatPanel.tsx.
  //
  // The FUNCTIONS keep their `saveStats` gate: with nothing being recorded there is nothing to hide,
  // so the cells go non-interactive (`fn: null`) rather than offering a toggle that would say nothing.
  const sFn = saveStats ? toggleScoringOff : null
  const tFn = saveStats ? toggleTimingOff : null
  const statsArr = [
    { label: 'Score', value: `${S.good}/${S.played}`, off: scoringOff, fn: sFn },
    { label: 'Accuracy', value: fmtAccuracyPct(S.good, S.played), off: scoringOff, fn: sFn },
    { label: 'Streak', value: `${S.streak}/${S.best}`, off: scoringOff, fn: sFn },
    { label: 'Last', value: truncTime(sLast), off: timingOff, fn: tFn },
    { label: 'Mean', value: fmtTime(sAvg), off: timingOff, fn: tFn },
    { label: 'Median', value: fmtTime(sMed), off: timingOff, fn: tFn },
  ]
  return { statsArr, enableResetOpen, confirmEnableReset, closeEnableReset }
}

// "Reset Stats" confirm for the casual modes (Classic / Flash / Deduction). Q7 (round 21) replaced
// the two-tap in-place arm — button flips to "Reset Stats?" in rose, 3s window, click-outside
// disarm — with the shared ConfirmModal, opened from the mode component. `onResetTap` opens the
// popup; `confirmReset` runs `resetFn` (Classic/Deduction = eng.resetStats; Flash passes its own
// reset that also tears the live flash down). Still gated on `hasData`: a fully-fresh mode
// (engineFresh) has nothing to clear, so a tap is a harmless no-op and the popup never opens. The
// `S` keyboard shortcut routes through the same onClick via .click() (see the keyboard effect), so
// it opens the popup identically. Leaving the mode drops a pending confirm (the popup portals to
// #root, so a hidden mode's would otherwise sit over the visible one). (Q2 / Q7.)
export function useResetStatsConfirm(resetFn: () => void, hasData: boolean, visible: boolean) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const closeConfirm = () => setConfirmOpen(false)
  const onResetTap = () => {
    if (!hasData) return // nothing to clear → no-op (don't open the popup)
    setConfirmOpen(true)
  }
  const confirmReset = () => {
    setConfirmOpen(false)
    resetFn()
  }
  // Leaving the mode drops a pending confirm — the popup portals to #root, so a hidden mode's
  // would otherwise sit over the visible one. Compare-and-set during render (React's "adjust
  // state when a prop changes"), NOT a setState-in-effect: the popup must be gone in the same
  // commit the mode hides. Converges: once false the guard is false.
  if (confirmOpen && !visible) setConfirmOpen(false)
  return { confirmOpen, onResetTap, closeConfirm, confirmReset }
}
// Run fn() whenever any value in `deps` changes — skipping the initial mount. The generic
// "react to a settings/toggle change" effect the modes use to regen an unanswered live date
// (the engine's regenDate no-ops on a burned/browsed date). fn is read through a ref so the
// latest closure runs without having to list it (or the engine) in the dependency array.
export function useChangeEffect(deps: React.DependencyList, fn: () => void) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }) // keep the latest fn (post-commit), not during render (refs rule)
  const firstRef = useRef(true)
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false
      return
    }
    fnRef.current()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

// The settings-popover-CLOSE counterpart of useChangeEffect — useSettingsCloseEffect — moved to
// components/useSettingsCloseEffect in round 11 (Q7), when App became a caller too: it was never
// mode-specific, and a hook App depends on cannot live in the directory the phase-1 split exists to
// push mode-screen code INTO. The five screens import it from there.

// ★ THE STATS COPY THIS SCREEN WAS MOUNTED ON — store/amnesic's activeDataId ("1:saved" /
// "1:session"), read ONCE at mount and never again. Every parked round (store/sessionRound) and
// parked history (store/sessionHistory) a screen reads, writes or discards is keyed by it, so a round
// or a history is only ever parked against — and restored against — the copy it was PLAYED on.
// Fixed for the life of the mount is exactly right, not a shortcut: any change of copy
// (a preset switch, an Amnesic toggle) remounts every mode screen (src/main.tsx's subscription on
// activeDataId), so a mount's engine never belongs to any other copy.
export function useMountedDataId(): string {
  const [dataId] = useState(() => activeDataId(usePresets.getState()))
  return dataId
}

// ── A CASUAL MODE'S HISTORY, KEPT FOR THE BROWSING SESSION ────────────────────────────────────────
// The halves a Classic / Flash / Deduction engine needs: the read at mount, the park, and the one
// function that tells every mounted casual screen to park. The whole design — when a history is
// written, what retires it, the size budgets — is argued in store/sessionHistory (the storage) and
// engine/parkedHistory (the engine).

// What a screen says about the question it would draw RIGHT NOW, for the restore to judge the parked
// one against.
interface LiveQuestion {
  // Is this mode's timing shown (not hidden) at this mount?
  timingShown: boolean
  // The date settings a question drawn now is drawn under — the same values, spelled the same way,
  // that the screen parks as `config` (and that its settings-close effect regenerates on).
  config: string
  // Draw one.
  newDate: () => Question
}

/**
 * This (stats copy, silo)'s parked history, restored over the silo's SAVED stats — the very stats the
 * engine would otherwise hydrate from (getInitialStats) — or null to start from those stats as
 * before. Read ONCE, in a screen's useState initializer, before its engine and any of its own fields
 * the snapshot carries (a screen's fields can decide what its engine draws — Deduction's filters —
 * so the two are read here and the engine's first state is settled separately, below).
 */
export function readParkedHistory(
  dataId: string,
  silo: HistorySilo,
  useJulian: boolean,
): RestoredHistory | null {
  return restoreParkedText(
    readSessionHistory(dataId, silo),
    useProgress.getState().stats[silo],
    useJulian,
    silo,
  )
}

/**
 * The engine's FIRST STATE from a restored history (useGameEngine's getInitialState) — null when
 * nothing was restored.
 *
 * ★ THE LIVE-QUESTION RULE (the owner's, and it holds for a reload, a preset switch and an Amnesic
 * interlude alike). The history comes back exactly; the question that was WAITING comes back only
 * when nothing could be gained from having seen it:
 *   • it is REGENERATED when a time could still be recorded for it — timing is shown in this mode
 *     NOW (it may have been toggled since the park), and the question is unanswered with no wrong
 *     answer, Reveal or Show Codes. The engine's clock starts again at every mount, so the same
 *     question returning there would hand the player a solve time that left out however long they
 *     had already looked at it;
 *   • otherwise THE SAME QUESTION RETURNS — timing hidden records no time, and a question already
 *     answered wrong, revealed or shown its codes records none either — including on a screen with
 *     no history at all;
 *   • and an unanswered question drawn under DIFFERENT date settings is regenerated too (the settings
 *     are shared by a preset's two stats copies, so a guest can change them under a parked history) —
 *     which is only what changing those settings does to a question on screen.
 * All three are ONE engine action, REGEN_DATE: the rule the app already had for "turning timing back
 * on" and for a date-setting change — it keeps a question that has been used, and reaches the live
 * question even when the history came back browsed to an earlier card (gameReducer). This function
 * only decides whether to ask.
 */
export function restoredEngine(back: RestoredHistory | null, live: LiveQuestion): GameState | null {
  if (!back) return null
  if (!live.timingShown && back.config === live.config) return back.engine
  return gameReducer(back.engine, { type: 'REGEN_DATE', nextDate: live.newDate() })
}

// Every mounted casual engine's park, and whether its screen is the one in use.
const parkers = new Set<{ inUse: () => boolean; park: () => void }>()

/**
 * Park every mounted casual history NOW — each under the stats copy its screen was mounted on.
 * src/main.tsx calls it at the two moments a screen is about to go away without the player asking
 * for a clean start: the page being hidden (a reload, the background), and the stats copy underneath
 * the screens being swapped (a preset switch, an Amnesic toggle).
 * ★ THE SCREEN IN USE PARKS LAST. store/sessionHistory holds every history together to one budget,
 * and each write makes room for itself by dropping others — so the last one written is the one that
 * always survives, and that has to be the history the player is looking at, not whichever screen
 * happened to mount last.
 */
export function parkCasualHistories(): void {
  const all = [...parkers]
  for (const p of all) if (!p.inUse()) p.park()
  for (const p of all) if (p.inUse()) p.park()
}

/**
 * Register this engine (and the screen's own fields beside it) to be parked by parkCasualHistories,
 * and retire its slot whenever the engine itself is RESET.
 *   `inUse`  — is this the engine the player is looking at (the visible screen; for Deduction, the
 *              sub-type on show)?
 *   `screen` — what is parked beside the engine: the screen's on/off fields and the date settings a
 *              question is drawn under here right now (engine/parkedHistory's ParkedScreen).
 *   `settingsOpen` — is the ⚙ panel open? A date setting changed in the panel reaches the question on
 *              screen only when the panel CLOSES (each screen's useSettingsCloseEffect), so while it
 *              is open the question on screen still belongs to the settings as they were when it
 *              opened — and those are the ones parked with it.
 * EVERY engine parks, played-in or not: with timing hidden the question on screen must come back too,
 * and that includes a screen nobody has answered anything on. The slot is marked with whether it
 * holds anything beyond that waiting question (store/sessionHistory).
 * ⚠ NOTHING IS PARKED ON UNMOUNT — store/sessionHistory argues why — so the cleanup only withdraws
 * the registration.
 * The latest state is held in a ref written after every commit, so a park writes what was last on
 * screen, never a render that did not commit.
 */
export function useParkedHistory(
  dataId: string,
  silo: HistorySilo,
  state: GameState,
  inUse: boolean,
  screen: ParkedScreen,
  settingsOpen: boolean,
): void {
  const latest = useRef({ state, inUse, screen })
  useEffect(() => {
    const config = settingsOpen ? latest.current.screen.config : screen.config
    latest.current = { state, inUse, screen: { ...screen, config } }
  })
  useEffect(() => {
    const parker = {
      inUse: () => latest.current.inUse,
      park: () => {
        const { state: s, screen: sc } = latest.current
        const text = fittedParkedText(s, sc, SLOT_BUDGET)
        if (text === null) return discardSessionHistory(dataId, silo)
        const holdsPlay = !engineUntouched(s) || Object.values(sc.ui ?? {}).some(Boolean)
        writeSessionHistory(dataId, silo, text, holdsPlay)
      },
    }
    parkers.add(parker)
    return () => {
      parkers.delete(parker)
    }
  }, [dataId, silo])
  // ★ A RESET RETIRES THE PARK IN THE SAME BREATH. Reset Stats, "Enable and Reset Stats" and Flash's
  // Reset all clear the engine's history, and `gridEpoch` moves on exactly those (gameReducer). A
  // park standing from an earlier hide describes the history that was just cleared; nothing may
  // bring it back, so it goes now rather than waiting to be overwritten by the next park.
  useChangeEffect([state.gridEpoch], () => discardSessionHistory(dataId, silo))
}
