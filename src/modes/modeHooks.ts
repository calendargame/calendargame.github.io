// Shared mode-screen hooks, extracted verbatim from main.tsx (Q1 phase 1). These are the pieces of
// per-mode chrome deduped out of the five screens during the Stage-C mode-untangle: they move
// together because every screen uses some subset and none of them belongs to any one screen.
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../engine/gameReducer.js'
import type { GameEngine, FlashState } from './modeTypes.js'
import { calcLast, calcAvg, calcMed } from '../engine/stats.js'
import { fmtAccuracyPct, truncTime, fmtTime } from '../lib/modeFormat.js'

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
// The engine-state half of a mode's freshness check (stats all zero, no history, no live-question
// flags set) — identical across modes. Each mode ANDs its own fields (toggles/timers/bests) on top.
export function engineFresh(s: GameState) {
  return (
    s.stats.played === 0 &&
    s.stats.good === 0 &&
    s.stats.streak === 0 &&
    s.stats.best === 0 &&
    s.stats.times.length === 0 &&
    s.stack.length === 0 &&
    s.forwardStack.length === 0 &&
    s.backDepth === 0 &&
    s.locked === false &&
    s.revealed === false &&
    s.countedWrong === false &&
    s.canOverrideCorrect === false &&
    s.pendingWrongOverride === null &&
    s.overrideUsedThisQ === false &&
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
    const desync = S.good !== S.times.length
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
