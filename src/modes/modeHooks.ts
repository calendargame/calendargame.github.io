// Shared mode-screen hooks, extracted verbatim from main.tsx (the main.tsx split). These are the pieces of
// per-mode chrome deduped out of the five screens during the Stage-C mode-untangle: they move
// together because every screen uses some subset and none of them belongs to any one screen.
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { gameReducer } from '../engine/gameReducer.js'
import type { GameState, Question, Stats } from '../engine/gameReducer.js'
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
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'

// Timing constants. The codes panel's own timings (its slide duration and the CODES_CLOSE_MS
// freeze window derived from it) live in src/lib/accordionMotion.js and are consumed entirely
// inside components/MethodBreakdown — nothing in this file needs them (round 8).
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
// ★ DID THIS SILO'S STATS MOVE WHILE ITS TIMING WAS HIDDEN? — the "Enable and Reset Stats?" test.
// EXACT, because every credited, timed solve keeps its time: the only way a credit comes to have no
// time is an answer given while timing was hidden, which is precisely what the popup is for. The one
// correction is a save an OLD build trimmed to its newest 1,000 times — those credits had times
// once, and store/progress' v5 migration recorded how many as `timesLost`, so they never read as a
// mismatch. (Before the cap went, this check fired after every reload for anyone past 1,000 timed
// answers, offering to wipe their stats for nothing.)
export const timingMismatch = (S: Stats): boolean => S.good - (S.timesLost ?? 0) !== S.times.length

// Shared "hideable stats" chrome for the three non-timed modes (Classic, Flash, Deduction): the
// show/hide toggles, the "Enable and Reset Stats?" mismatch case, and the 6-box stats array for
// <StatPanel>. Both toggles (`timingOff` + `scoringOff`) are owned by the component and persisted in
// the mode-prefs store, so they're passed in with their setters (timingOff also feeds useGameEngine).
//
// ★ TURNING TIMING BACK ON IS ONE ACT ON EVERY ENGINE THE SWITCH COVERS (`timed`). A mode has ONE
// timing switch; Classic and Flash have one engine behind it, Deduction has three (its Day, Month
// and Year silos, each with its own stats and its own waiting puzzle). From the moment timing is
// shown a first-try answer records a solve time — in EVERY one of those silos, not just the one on
// screen — so each of them is settled by the same two rules:
//   • a silo whose stats moved while timing was hidden (timingMismatch) cannot be reconciled and
//     has to be RESET — which the player is asked about first ("Enable and Reset Stats?", a shared
//     ConfirmModal the mode component renders; this hook owns its open flag and its two handlers);
//   • every other silo follows the LIVE-QUESTION RULE (restoredEngine, below): its waiting question
//     is regenerated unless it has been used.
// So the check and the reset agree by construction: the popup opens when ANY covered silo is
// mismatched, and accepting it resets exactly the mismatched ones and regenerates the rest.
// (It used to look at, and act on, the engine on screen alone. In Deduction that left the other two
// sub-types holding a puzzle the player had already studied — its solve time would then start from
// whenever they next looked at it — and let timing come on over a hidden sub-type whose readouts
// and recorded times disagreed, the very state the popup exists to prevent.)
//
// Flash is the only mode that keeps something of its own about the waiting question (a running
// flash, a date left showing), so it passes onQuestionReplaced() — called when turning timing back
// on actually REPLACED that question, and never when the engine kept it — and onHide() (on
// mode-leave); Classic/Deduction omit them.
export function useStatsHideToggles({
  eng,
  timed,
  saveStats,
  visible,
  timingOff,
  setTimingOff,
  scoringOff,
  setScoringOff,
  onQuestionReplaced,
  onHide,
}: {
  // The engine on screen — the strip shows its stats.
  eng: GameEngine
  // EVERY engine this mode's timing switch covers, the one on screen included.
  timed: GameEngine[]
  saveStats: boolean
  visible: boolean
  timingOff: boolean
  setTimingOff: (v: boolean) => void
  scoringOff: boolean
  setScoringOff: (v: boolean) => void
  onQuestionReplaced?: () => void
  onHide?: () => void
}) {
  // timingOff + scoringOff are owned by the mode component (persisted in the mode-prefs store) and
  // passed in, so the hook holds no toggle state of its own — it just decides when the mismatch
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
  // Timing comes back on: each covered engine is reset (mismatched) or has its waiting question
  // regenerated (the engine keeps one that has been used). The screen's own teardown runs only when
  // a question really went — a reset always replaces it; a regeneration says whether it did.
  const showTiming = () => {
    for (const e of timed) {
      let replaced = true
      if (timingMismatch(e.state.stats)) e.fullReset()
      else replaced = e.regenDate()
      if (replaced) onQuestionReplaced?.()
    }
    setTimingOff(false)
  }
  const toggleTimingOff = () => {
    if (!saveStats) return
    if (!timingOff) {
      setTimingOff(true)
      return
    }
    // A covered silo's readouts and recorded times disagree — turning timing back on cannot
    // reconcile them, so it has to reset that silo's stats. Ask first (the popup renders from the
    // mode component).
    if (timed.some((e) => timingMismatch(e.state.stats))) setEnableResetOpen(true)
    else showTiming()
  }
  // Accept: the same act, now that the player has agreed to the reset it includes.
  const confirmEnableReset = () => {
    setEnableResetOpen(false)
    showTiming()
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
  // ★ `off` is YOUR toggle and NOTHING ELSE (round 16) — so scoringOff / timingOff go through
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

// "Reset Stats" confirm for the casual modes (Classic / Flash / Deduction). Round 21 replaced
// the two-tap in-place arm — button flips to "Reset Stats?" in rose, 3s window, click-outside
// disarm — with the shared ConfirmModal, opened from the mode component. `onResetTap` opens the
// popup; `confirmReset` runs `resetFn` (Classic/Deduction = eng.resetStats; Flash passes its own
// reset that also tears the live flash down). Still gated on `hasData`: a fully-fresh mode
// (engineFresh) has nothing to clear, so a tap is a harmless no-op and the popup never opens. The
// `S` keyboard shortcut routes through the same onClick via .click() (see the keyboard effect), so
// it opens the popup identically. Leaving the mode drops a pending confirm (the popup portals to
// #root, so a hidden mode's would otherwise sit over the visible one).
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

// The settings-popover-CLOSE counterpart of useChangeEffect — useSettingsCloseEffect — lives in
// components/useSettingsCloseEffect, because App is a caller too: it was never mode-specific, and a
// hook App depends on cannot live in the directory that exists to hold mode-screen code. The five
// screens import it from there.

/**
 * ★ SAVE STATS COMING BACK ON, IN A CASUAL MODE WHOSE TIMING IS SHOWN — the live-question rule's
 * third door, beside "turning timing back on" (useStatsHideToggles above) and a screen coming back
 * (restoredEngine below). The rule: a question the player has already looked at is regenerated the
 * moment a solve time could be recorded for it. With Save Stats off nothing is recorded, so a
 * question on screen then is one the player may study for as long as they like; with Save Stats back
 * on and timing shown, its first-try answer would put a time in the mean. So the screen asks for
 * the engine's one REGEN_DATE (`regenWaiting` — eng.regenDate for every question the screen has
 * waiting), which keeps a question that has been USED — answered wrong, revealed, shown its codes —
 * because that one records no time whatever the switch says (its Save Stats value froze at that
 * first action).
 *   • Timing hidden: nothing to do — no time is recorded there, and turning timing on later is the
 *     other door.
 *   • Save Stats going OFF: nothing to do — nothing can be recorded for the question any more.
 *   • WHEN: as the ⚙ panel closes, like every other setting that regenerates a question — the
 *     switch lives in the panel, nothing behind the panel can be answered while it is open, and the
 *     fresh question's clock then starts with the panel out of the way. Off and back on inside one
 *     visit to the panel is no change at all, and regenerates nothing.
 */
export function useSaveStatsOnRegen(
  settingsOpen: boolean,
  saveStats: boolean,
  timingOff: boolean,
  regenWaiting: () => void,
) {
  useSettingsCloseEffect(settingsOpen, [saveStats], () => {
    if (saveStats && !timingOff) regenWaiting()
  })
}

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
