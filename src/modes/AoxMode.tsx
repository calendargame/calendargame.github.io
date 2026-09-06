// AoxMode — the Average-of-X screen: a timed run of N questions with averaging, its own Best
// standing, and the Allow Mistakes / One-By-One sub-modes. Extracted verbatim from main.tsx
// (Q1 phase 1); it was already a module-level sibling of App taking everything through props,
// so nothing about its behaviour changes by living here.
import { useEffect, useRef, useState } from 'react'
import type { ModeProps, FmtDate, GenDate } from './modeTypes.js'
import { FLASH_MS, useButtonFlash } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import { NUM_INPUT_CLASS, RESET_BTN_CLASS } from '../components/controlClasses.js'
import { fmtTime, truncTime, fmtAccuracyPct } from '../lib/modeFormat.js'
import { randomDate } from '../lib/dateGen.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import { NewBestStar } from '../components/primitives.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { calcAvg, calcLast, calcMed } from '../engine/stats.js'
import { reconcileAoxStanding, aoxBestEqual, emptyAoxBest } from '../engine/aoxBest.js'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import type { AoxBest } from '../store/progress.js'
import { useUserDefaults, effectivePrefDefaults, normalizeAoxN } from '../store/userDefaults.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import { useBackButton } from '../components/useBackButton.js'

// ============================================================
// AoxMode — the "average of N" run mode, FOLDED onto the shared useGameEngine (mode-untangle
// Step 5, redone). Like Blitz, the engine runs the per-question loop (answer / credit / stats /
// history / Override / Show Codes) and the COMPONENT owns the run layer: the run lifecycle
// (idle/running/done/failed), the Ao-N count, Best Average/Median (per config, with rollback),
// One-by-One, and the fail-on-mistake rule. The run's stats ARE the engine stats — good =
// credited solves, played = attempts, times = solve times, streak/best. The fold needs only
// two general engine flags: `complete` (the Nth solve credits without advancing) and
// `noAdvance` (a failing override of that solve stays put). See gameReducer.
function AoxMode({
  minY,
  maxY,
  visible,
  fmtDate,
  useJulian = false,
  genDate = randomDate,
  leapChance = 'random',
  janFebChance = 'random',
  julianChance = 'random',
  randomFormat = false,
  dateFormat = 'written-mdy',
  inputStyle = 'buttons',
  saveStats = true,
  settingsOpen,
  onFreshChange,
}: ModeProps & { fmtDate: FmtDate; genDate?: GenDate }) {
  const aoxN = useModePrefs((s) => s.aoxN),
    setAoxN = useModePrefs((s) => s.setAoxN) // persisted (mode-prefs store)
  // WHAT ESCAPE IN THE RUN-LENGTH BOX REVERTS TO (round 15, B6): the value the field held when the
  // keyboard entered it. A ref rather than state because nothing renders it — it is written on
  // focus and read on one keypress, and re-rendering the screen for it would be pure cost. See the
  // long note at the input for why the value has to be remembered at all.
  const aoxNAtFocusRef = useRef(aoxN)
  const allowMistakes = useModePrefs((s) => s.aoxAllowMistakes),
    setAllowMistakes = useModePrefs((s) => s.setAoxAllowMistakes) // persisted (mode-prefs store)
  const oneByOne = useModePrefs((s) => s.aoxOneByOne),
    setOneByOne = useModePrefs((s) => s.setAoxOneByOne) // persisted (mode-prefs store)
  const timingOff = useModePrefs((s) => s.aoxTimingOff),
    setTimingOff = useModePrefs((s) => s.setAoxTimingOff) // persisted; VISUAL-ONLY (Q8) — dims the LIVE mid-run trio, but a completed run always shows its result
  const [runPhase, setRunPhase] = useState('idle') // idle | running | done | failed (the RUN; the engine just runs the per-question loop)
  const [shown, setShown] = useState(false) // One-by-One: is the current date revealed? (always true for non-One-by-One while running)
  const n = +normalizeAoxN(aoxN) // the ONE 2–1000 clamp (store/userDefaults normalizeAoxN; junk → 10)
  // Best keying: bests are siloed per difficulty configuration. Dimensions: n, allowMistakes,
  // format (random→'random' bucket), leapChance, janFebChance, julianChance, year range,
  // useJulian — the SAME dimensions as Blitz/Sudden (and as How-to-Play documents). The original
  // app omitted julianChance here only (an inconsistency: it changes the Julian-date mix, a real
  // difficulty dimension when the range spans pre-1582); fixed C2 — store/progress.ts migrates
  // saved v1 keys so no recorded Best is orphaned.
  const bestKey = `${n}|${allowMistakes}|${randomFormat ? 'random' : dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`
  // saveStats:true ALWAYS → the run tracks + completes regardless of the global Save Stats
  // setting (which only dims the display + gates recording a Best). timingOff:false → solve
  // times are recorded for the average.
  const eng = useGameEngine({
    label: 'aox',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats: true,
    timingOff: false,
  })
  const { state, correct } = eng
  // Android Back closes AoX's Show-Codes panel (Q1) — see the same hook in the other modes.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const S = state.stats
  const doneCount = S.good // credited solves this run
  const isRunning = runPhase === 'running'
  const isLocked = runPhase === 'done' || runPhase === 'failed'
  const inBack = state.backDepth > 0
  // A live question RESOLVED AS A MISS (Allow Mistakes on): Reveal or Show Codes showed the answer
  // + counted a played miss (a plain wrong answer sets countedWrong but NOT revealed, so it stays
  // retryable — excluded). The grid is dimmed for it (the engine ignores answers on it).
  const resolvedMiss = isRunning && !inBack && state.revealed && state.countedWrong
  // Of those, which WAIT on a "Next" button vs auto-advance: SHOW CODES (calcPenaltyActive — set by
  // SHOW_CODES, never by REVEAL) always pauses so you can read the codes; a One-by-One Reveal also
  // pauses (One-by-One pauses between dates by design). A plain non-One-by-One Reveal does NOT wait
  // — onReveal flashes the answer then auto-advances (owner's call, C2: a reveal doesn't need to
  // pause when the run flows date-to-date on its own). (C2 Q4 + the reveal-flash refinement.)
  const awaitingNext = resolvedMiss && (state.calcPenaltyActive || oneByOne)

  // Per-config Best Average / Median (component-owned, like Blitz's Best Score). A run records
  // its Best on completion and keeps it RECONCILED while its stats move post-completion (a
  // back-browse / retro / live-reversal Override can retract or add a credit on the ended run):
  // standing (good ≥ n) → the pre-run floor improved by the current avg/median; not standing →
  // the floor restored. See the reconcile effect below (engine/aoxBest.ts owns the pure fold).
  // AoX all-time bests (avg/median, config-keyed) persist across reloads (Stage D1): from the
  // progress store. (bestNew markers + the rollback refs below stay local — per-session/ephemeral.)
  const bests = useProgress((s) => s.aoxBest),
    setBests = useProgress((s) => s.setAoxBest)
  const [bestNew, setBestNew] = useState<Record<string, { avg: boolean; med: boolean }>>({})
  const nextRunIdRef = useRef(1)
  const currentRunIdRef = useRef<number | null>(null)
  // Pending auto-advance after a non-One-by-One Reveal (flash the answer for FLASH_MS, then advance).
  // Held in a ref so reset / leaving the mode / unmount can cancel it before it fires.
  const revealAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelRevealAdvance = () => {
    if (revealAdvanceRef.current) {
      clearTimeout(revealAdvanceRef.current)
      revealAdvanceRef.current = null
    }
  }
  // The PRE-run Best record {key,best,runId}, latched once when this run records (completion with
  // Save Stats on) — the floor every post-completion reconcile starts from (see the effect below).
  const prevBestSnapRef = useRef<{ key: string; best: AoxBest; runId: number } | null>(null)
  const bestData = bests[bestKey] || emptyAoxBest()

  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse

  // The codes panel's close-animation freeze lives in MethodBreakdownSection (Q5, round 8).
  // AoX used to keep a private copy of it here; see the render below for what that cost.

  // Run completion + Best reconcile — ONE effect owns every Best write (mirrors Blitz's
  // timerDone effect). (a) The credited count reaching N completes the run: flip the phase and,
  // if the global Save Stats is on, LATCH the pre-run Best {key,best,runId} as this run's floor.
  // Latched once per run: a reversal can resume + re-complete the run, and re-latching then would
  // capture the run's own record as its floor (the stale-snapshot trap). The completing answer
  // used eng.answer(...,{complete}) so the engine stayed on the solve; re-entry is phase-guarded.
  // (b) From the latch on, every stats change re-reconciles the record under the key the run
  // RECORDED under (the panel's bestKey can move — settings stay editable while a run sits done):
  // still standing (good ≥ n) → the floor improved by the run's CURRENT avg/median; not standing
  // (an Override retracted a credit — back-browse Path 1, retro Path 5, or the live reversal) →
  // the floor restored, as if the run never completed. Before the C2 fix only the live-edge
  // reversal rolled back (rollbackBest, gated on !inBack), so a back-browse un-credit left a
  // FABRICATED Best standing on a run with fewer than n credits — and a mid-done settings change
  // (key moved) dodged even that. ★ markers: an improving write OR-folds into the key's marker
  // (a prior run's star survives); a write that only restores the floor clears it.
  // ⚠ The disables in this effect and the next are NEW at extraction time, not behaviour changes —
  // same cause as FlashMode's and DeductionMode's: main.tsx's dense one-line style meant the React
  // Compiler never analyzed this component (linting HEAD's main.tsx reports these rules ZERO
  // times), and a clean module makes it analyzable. The exhaustive-deps directives ALSO had to
  // move: in the original one-liner the closing brace, the dep array and the trailing directive
  // all shared a line, so one comment covered everything; prettier splits them, and a line
  // directive only covers the line it sits on. Q1 is a verbatim move, so these are repositioned
  // and annotated, never restructured. ▶ Queued for proper review as its own item.
  useEffect(() => {
    if (runPhase === 'running' && doneCount >= n) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunPhase('done')
      if (
        saveStats &&
        currentRunIdRef.current != null &&
        prevBestSnapRef.current?.runId !== currentRunIdRef.current
      )
        prevBestSnapRef.current = {
          key: bestKey,
          best: { ...(bests[bestKey] || emptyAoxBest()) },
          runId: currentRunIdRef.current,
        }
    }
    const snap = prevBestSnapRef.current
    if (!snap || snap.runId !== currentRunIdRef.current) return // this run hasn't recorded
    const { next, avgImp, medImp } = reconcileAoxStanding(snap.best, S.good, n, S.times, snap.runId)
    setBests((p) => {
      const cur = p[snap.key] || emptyAoxBest()
      if (aoxBestEqual(cur, next)) return p
      if (avgImp || medImp)
        setBestNew((b) => {
          const e = b[snap.key] || { avg: false, med: false }
          return { ...b, [snap.key]: { avg: e.avg || avgImp, med: e.med || medImp } }
        })
      else
        setBestNew((b) => {
          if (!(snap.key in b)) return b
          const nx = { ...b }
          delete nx[snap.key]
          return nx
        })
      return { ...p, [snap.key]: next }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPhase, doneCount, n, saveStats, S.good, S.times, setBests])

  // Reset the run if the panel is hidden mid-run (also cancel any pending reveal auto-advance).
  useEffect(() => {
    if (!visible && runPhase === 'running') {
      cancelRevealAdvance()
      eng.resetStats()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunPhase('idle')
      setShown(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // Settings reconcile now fires on the ⚙ popover CLOSE (Q2) — the useSettingsCloseEffect is below,
  // after reset() is defined (a RUNNING or ENDED run resets, an idle run regenerates its hidden date).

  // Freshness for App's isFullyReset (the random date is excluded). aoxN compares NORMALIZED
  // against its EFFECTIVE default — the saved personal default when one exists (Q7,
  // store/userDefaults) — so a Full Reset restoring a personal N still reads fresh; the other
  // config fields (Allow Mistakes, One-by-One, the visual-only timingOff — Q8) stay factory-fixed
  // (they aren't capturable, and Full Reset returns them to their launch constants).
  const defAoxN = useUserDefaults((s) => effectivePrefDefaults(s.saved).aoxN)
  const aoxIsFreshLocal =
    normalizeAoxN(aoxN) === normalizeAoxN(defAoxN) &&
    allowMistakes === false &&
    oneByOne === false &&
    timingOff === false &&
    runPhase === 'idle' &&
    shown === false &&
    S.played === 0 &&
    S.good === 0 &&
    S.streak === 0 &&
    S.best === 0 &&
    S.times.length === 0 &&
    state.stack.length === 0 &&
    state.forwardStack.length === 0 &&
    state.backDepth === 0 &&
    flash === null &&
    Object.keys(state.persistBtns).length === 0 &&
    state.calcOpen === false &&
    state.canOverrideCorrect === false &&
    Object.keys(bests).length === 0 &&
    Object.keys(bestNew).length === 0 &&
    state.pendingWrongOverride === null &&
    state.overrideUsedThisQ === false &&
    state.countedWrong === false
  useEffect(() => {
    onFreshChange?.(aoxIsFreshLocal)
  }, [aoxIsFreshLocal, onFreshChange])

  // Derived UI state.
  const dateVisible = isLocked || (isRunning && (!oneByOne || shown)) || inBack
  const revealLocked = !isRunning || state.calcOpen || (oneByOne && !shown) || inBack
  const backDisabled = state.stack.length === 0 || runPhase === 'idle' || runPhase === 'running'
  const fwdDisabled =
    state.forwardStack.length === 0 || runPhase === 'idle' || runPhase === 'running'
  const last = state.stack[state.stack.length - 1]
  // Override availability is NOT gated on the live `saveStats` — it's the SAME whether Save Stats
  // is on or off (owner's call, C2: gating it on saveStats made Override more forgiving when ON
  // than OFF, which is backwards). AoX feeds the engine saveStats:true (above), so every run
  // question IS scored (played always increments) → crediting via Override can't hit the
  // unscored-question 1/0 bug; the credit is simply invisible in practice mode (stats hidden, no
  // Best recorded). So Override is available whenever there's something to override — a wrong, a
  // Reveal, a Show Codes, a reversible correct, or a retro/pending target — regardless of Save
  // Stats. (Do NOT switch this to effectiveSaveStats — saveStatsThisQ is always true here.)
  const overrideAvail =
    !state.overrideUsedThisQ &&
    (state.countedWrong ||
      state.canOverrideCorrect ||
      (state.pendingWrongOverride != null && !last?.overrideUsed) ||
      eng.retroOverrideEligible)
  const codesDisabled = runPhase === 'idle' || (oneByOne && !shown && !inBack && !isLocked)
  // resolvedMiss dims the grid — a revealed/show-coded question the engine ignores answers on
  // (covers the brief non-One-by-One reveal flash before it auto-advances, the Show-Codes pause,
  // and the One-by-One reveal pause).
  const optionsDisabled =
    isLocked ||
    state.calcOpen ||
    resolvedMiss ||
    (oneByOne && !shown && !inBack) ||
    runPhase === 'idle' ||
    inBack
  const scoreDisplay = runPhase === 'idle' ? '0/0' : `${doneCount}/${S.played}`
  const accuracyDisplay = fmtAccuracyPct(doneCount, S.played)
  const date = state.date
  // The timing trio (Last/Average/Median) carries a VISUAL-ONLY hide toggle (Q8): tap any of the
  // three to blank them all. There is NO engine timingOff and NO reset arm — AoX always tracks
  // (saveStats:true above), so hiding can never desync. Hiding suppresses only the LIVE mid-run
  // trio; a COMPLETED run (runPhase "done") always shows its result regardless (the average is the
  // point of the run) — there the trio is a plain result readout, not a toggle. Save Stats off
  // drops the toggle, like the scoring trio. (Persisted as aoxTimingOff — excluded from the
  // defaults system.)
  //
  // ★ `timeHidden` is the USER'S hide toggle and nothing else (C1, round 16), so it is what feeds
  // `off` below; the scoring trio (untoggleable in AoX) carries no `off` at all. The Save-Stats fact
  // is `dimmed` on the panel: one flag, whole strip. See the three-signal note in StatPanel.
  const runComplete = runPhase === 'done'
  const timeHidden = timingOff && !runComplete
  const tFn = saveStats && !runComplete ? () => setTimingOff((v) => !v) : null

  // Handlers.
  const begin = () => {
    eng.resetStats()
    currentRunIdRef.current = nextRunIdRef.current++
    prevBestSnapRef.current = null
    setRunPhase('running')
    setShown(true)
  }
  const continueRun = () => {
    setShown(true)
    eng.restartTimer()
  } // One-by-One: reveal the already-loaded next date + start its solve timer
  const startOrContinue = () => {
    if (runPhase === 'idle') begin()
    else continueRun()
  }
  const submitDoW = (i: number) => {
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i })
    const willComplete = i === correct && !state.countedWrong && doneCount === n - 1 // the Nth credited solve completes the run
    const willAdvance = i === correct && !willComplete // a non-completing correct (first-try or late) advances
    eng.answer(i, { complete: willComplete })
    if (i !== correct && !allowMistakes) {
      eng.lockReveal()
      setRunPhase('failed')
    } // wrong + no mistakes → reveal the answer + fail the run
    else if (willAdvance && oneByOne) setShown(false) // One-by-One: hide the freshly-loaded next date until Continue
  }
  // Reveal. Allow Mistakes OFF → fail the run. Allow Mistakes ON → count a played miss + show the
  // answer; then continue the run. One-by-One pauses on a "Next" button (awaitingNext) so you see
  // the answer before the next hidden date. Non-One-by-One FLOWS: flash the answer for FLASH_MS so
  // it's visible (a same-render advance would batch the reveal away, painting nothing), then
  // auto-advance — the next date streams in on its own, like a correct answer. (C2 Q4 + the
  // reveal-flash refinement, owner 2026-06-13.)
  const onReveal = () => {
    eng.reveal()
    if (!allowMistakes) {
      setRunPhase('failed')
      return
    }
    if (oneByOne) return // One-by-One: pause on "Next" (awaitingNext) — see the answer, then Continue
    setFlashWithTimeout({ type: 'good', idx: correct }) // flash the revealed answer
    if (revealAdvanceRef.current) clearTimeout(revealAdvanceRef.current)
    revealAdvanceRef.current = setTimeout(() => {
      revealAdvanceRef.current = null
      eng.doNew()
    }, FLASH_MS)
  }
  // Show Codes (Allow Mistakes on) counts a miss + opens the panel; it always pauses on "Next"
  // (you need time to read the codes — calcPenaltyActive keeps awaitingNext true). Allow Mistakes
  // off fails the run. (C2 Q4 — Show Codes intentionally keeps the Next pause, unlike Reveal.)
  const onShowCodes = (open: boolean) => {
    eng.showCodes(open)
    if (open && !allowMistakes && isRunning) setRunPhase('failed')
  }
  // Advance past a show-coded / One-by-One-revealed miss (Allow Mistakes on) — the run continues.
  // Closes the codes panel if open, loads the next date (the miss was already counted), One-by-One
  // hides it until Continue. (Non-One-by-One Reveal auto-advances instead — see onReveal.) (C2 Q4.)
  const onNext = () => {
    if (state.calcOpen) eng.showCodes(false)
    eng.doNew()
    if (oneByOne) setShown(false)
  }
  const onOverride = () => {
    // A credit / completion via Override DURING the reveal-flash window must kill the pending
    // auto-advance — otherwise the stale doNew() fires ~FLASH_MS later and either SKIPS the
    // freshly-advanced question or, at the final question, re-opens the phantom-Q(N+1) overshoot the
    // completion hold closed. The other run-mutating handlers (reset, hidden, unmount) already cancel.
    cancelRevealAdvance()
    const reverseCompleting = state.canOverrideCorrect && !state.countedWrong && !inBack // Path 2: reverse the live completing solve
    const reverseToWrong =
      reverseCompleting && state.prevStatsSnapshot && !state.prevStatsSnapshot.wasWrong
    const retroToWrong =
      eng.retroOverrideEligible && last?.capsule?.snapshot && !last.capsule.snapshot.wasWrong // Path 5: retro-flip a correct entry to wrong
    const crediting = state.countedWrong || state.pendingWrongOverride != null // Path 3/4: credit a wrong
    // Crediting the CURRENT wrong (Path 3) when good is at N-1 is the run's COMPLETING solve →
    // credit but DON'T advance (stay on this question, locked), or the run would complete while
    // sitting on a phantom extra question (an Ao10 via Reveal+Override showed Q11). Mirrors a
    // normal final correct answer's `complete`. (C2 fix.)
    const completeViaOverride = state.countedWrong && doneCount === n - 1
    const toWrong = reverseToWrong || retroToWrong
    const failNow = toWrong && !allowMistakes
    if (state.countedWrong) setFlashWithTimeout({ type: 'good', idx: correct }) // crediting the current wrong → green flash
    eng.override({ noAdvance: !!((reverseCompleting && failNow) || completeViaOverride) }) // any Best impact reconciles in the effect above
    if (failNow)
      setRunPhase('failed') // a to-wrong override with no mistakes fails the run (bug #2 / unified rule)
    else if (crediting && runPhase === 'failed')
      setRunPhase('running') // crediting the wrong that failed the run resumes it (the completion effect then flips a completing one to done)
    else if (reverseCompleting && allowMistakes) setRunPhase('running') // Allow Mistakes on: reversing the completing solve resumes the run
  }
  const reset = () => {
    cancelRevealAdvance()
    eng.resetStats()
    setRunPhase('idle')
    setShown(false)
    setBestNew({})
    prevBestSnapRef.current = null
    currentRunIdRef.current = null
  }
  // Cancel a pending reveal auto-advance if the component unmounts mid-flash (Full Reset remount).
  useEffect(
    () => () => {
      if (revealAdvanceRef.current) clearTimeout(revealAdvanceRef.current)
    },
    [],
  )

  // On the ⚙ popover CLOSE (Q2), reconcile AoX against the new settings: a RUNNING or ENDED
  // (done/failed) run RESETS as if Reset was pressed — its recorded Best config is now stale, so the
  // run on screen always matches the current settings — while an idle run regenerates its (hidden)
  // next date. Deferred to close so adjusting several settings doesn't churn the run/date (and the
  // solve timer) per keystroke. (Replaces the old immediate prevAoxPopRef effect.) aoxN is in the
  // deps because Reset Settings can now restore the run length mid-run (round-6 Q7): the N field is
  // idle-locked (readOnly while running), so its only in-popover writer is Reset Settings, and a
  // reset that changes N (a Best-key dimension) must reconcile the run exactly as a panel change does.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [randomFormat, dateFormat, useJulian, minY, maxY, leapChance, janFebChance, julianChance, aoxN],
    () => {
      if (runPhase !== 'idle') reset()
      else eng.regenDate()
    },
  )

  const primaryBtn =
    runPhase === 'idle' ? (
      <button
        type="button"
        data-key="N"
        className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium"
        onClick={startOrContinue}
      >
        Begin
      </button>
    ) : isLocked ? (
      <button
        type="button"
        data-key="N"
        className={`col-span-1 ${RESET_BTN_CLASS}`}
        onClick={reset}
      >
        Reset
      </button>
    ) : awaitingNext ? (
      <button
        type="button"
        data-key="N"
        className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium"
        onClick={onNext}
      >
        Next
      </button>
    ) : !shown && oneByOne ? (
      <button
        type="button"
        data-key="N"
        className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium"
        onClick={startOrContinue}
      >
        Continue
      </button>
    ) : (
      <button
        type="button"
        data-key="N"
        className={`col-span-1 ${RESET_BTN_CLASS}`}
        onClick={reset}
      >
        Reset
      </button>
    )

  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      {/* dimmed = Save Stats off = nothing is being recorded: the whole strip dims and every value
          reads '—' (site-wide, every mode). The timing trio you hid yourself renders BLANK instead,
          from `timeHidden`, and taps the toggle (tFn) when Save Stats is on — derivations above. */}
      <StatPanel
        dimmed={!saveStats}
        stats={[
          { label: 'Score', value: scoreDisplay, fn: null },
          { label: 'Accuracy', value: accuracyDisplay, fn: null },
          { label: 'Streak', value: `${S.streak}/${S.best}`, fn: null },
          { label: 'Last', value: truncTime(calcLast(S.times)), off: timeHidden, fn: tFn },
          { label: 'Average', value: fmtTime(calcAvg(S.times)), off: timeHidden, fn: tFn },
          { label: 'Median', value: fmtTime(calcMed(S.times)), off: timeHidden, fn: tFn },
        ]}
      />
      {/* ⚠ EVERY TIME HERE IS WRAPPED IN `whitespace-nowrap`, and it is not decoration. A time of a
          minute or more now formats as "1m 2.34s" (lib/modeFormat — the em dash no longer hides a
          long one), and that space is a line-break opportunity the old "59.99s" never had.
          These four readouts sit in a flex-wrap row of shrinkable min-w-[125px] columns, so on a
          narrow phone a bare value would break across two lines mid-number and read as two numbers.
          The label may still wrap — "Best" / "Average:" is legible; "1m" / "2.34s" is not. */}
      <div className="mt-3 text-xs text-(--tx-300-60)">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[125px]">
            <div>
              Best Average: <span className="whitespace-nowrap">{fmtTime(bestData.avg)}</span>
              {bestNew[bestKey]?.avg && <NewBestStar />}
            </div>
            <div className="text-[11px] opacity-70">
              Median: <span className="whitespace-nowrap">{fmtTime(bestData.avgMed)}</span>
            </div>
          </div>
          <div className="min-w-[125px]">
            <div>
              Best Median: <span className="whitespace-nowrap">{fmtTime(bestData.med)}</span>
              {bestNew[bestKey]?.med && <NewBestStar />}
            </div>
            <div className="text-[11px] opacity-70">
              Average: <span className="whitespace-nowrap">{fmtTime(bestData.medAvg)}</span>
            </div>
          </div>
          {bestData.avgRoundId != null && bestData.medRoundId != null && (
            <span className="shrink-0 ml-auto">
              {bestData.avgRoundId === bestData.medRoundId ? 'Same Round' : 'Different Rounds'}
            </span>
          )}
        </div>
      </div>
      {/* items-stretch, NOT items-center (Q3 round-9) — this is the app's ONLY flex row that puts an
              <input> beside a <button>, and neither declares a height: each derives one from its own inner
              line box, and WebKit's machinery for a text control lands ~2px away from its machinery for a
              button. Under items-center that split rendered symmetrically — the box sitting ~1px proud
              above AND below its neighbors on the owner's iPhone. Matching class strings can't fix it
              (they already match exactly, which is why two earlier attempts failed): the row is made even
              by STRETCHING the shorter items to the tallest, not by arguing the derived heights agree.
              The wrapper below restates it so the input inherits the row's height through it; the 'Ao'
              span opts back out with self-center (a stretched span rides its text at the top). */}
      <div className="mt-3 flex items-stretch gap-2 flex-nowrap">
        {/* The run-length field (Q18): the shared boxed-numeric idiom (NUM_INPUT_CLASS) + the
                popup N field's validation trio — digits only while typing, blur and Enter
                normalize-commit with the shared clamp (normalizeAoxN), and ESCAPE DISCARDS.
                text-xs on the 'Ao' span too, so "Ao10" reads as one flush token.
                ★ ESCAPE DISCARDS — round 15 (B6), and it used to normalize-COMMIT like the other
                two. Escape now means one thing in every box you can type a NUMBER into, which the
                ⚙ Year Range boxes have meant since round 14 and the tap-to-type slider readouts
                since round 2: Enter keeps the edit and lets go, Escape throws it away and lets go,
                and the container is left for a second Escape. This field was the last NUMERIC one
                still committing the value it was asked to discard.
                ★ AND SINCE ROUND 17 IT REALLY IS EVERYWHERE YOU CAN TYPE. This note used to carve
                out the Lookup date field (components/LookupCard) as the one text box outside the
                contract — an open gap rather than a decision. The owner took the decision: that
                box captures its text on focus and discards back to it, so there is no exception
                left, here or in the How-to-Play guide.
                ⚠ THE DISCARD TARGET HAS TO BE REMEMBERED, because this box is not a mirror. The ⚙
                year boxes revert to minY/maxY — a committed value sitting right beside the text —
                but `aoxN` IS the stored pref: onChange writes it on every keystroke, so by the time
                Escape arrives the value the user is discarding BACK to no longer exists anywhere.
                aoxNAtFocusRef captures it on focus, which is the honest definition of "the edit"
                (an edit begins when the keyboard enters the box). Restoring an un-normalized
                capture is safe: the blur that follows normalizes it, exactly as it would have.
                ⚠ AND IT STOPS PROPAGATION, for the reason round 14 wrote down at the year boxes.
                App's Escape listener is a DOCUMENT keydown in the bubble phase that decides "is
                this press mine?" by asking what has focus; blur() below runs first, so without the
                stop it would find nothing focused and close the ⚙ panel on what the user meant as a
                field dismiss.
                ⚠ THE PATH IT WAS WRITTEN FOR IS NOW CLOSED, and this note is rewritten rather than
                left standing because a defensive line with a wrong reason attached is worse than
                none. Two orders were ever proposed. "Tab walks out of the panel" was always false —
                App intercepts plain Tab on a document keydown and, with no [data-settings-modal]
                up, preventDefaults it and sends focus to the mode selector (main.tsx), so Tab
                cannot leave the panel onto this screen at all. The one that WAS reachable is the
                opposite order: this field already holds focus, and THEN the ⚙ panel opens, because
                tapping a <button> does not move focus on iOS or Safari. Round 18 (1D) closed that
                one on the owner's report — opening ANY overlay now takes the keyboard down, in the
                app's open-overlay registry (dismissKeyboard inside pushOverlay,
                components/useBackButton) — so this box can no longer be holding an Escape while the
                panel is up, and no test on this screen can observe the stop any more.
                ⚠ SO WHY IT STAYS, plainly: it is one term of a contract shared by six boxes, and
                four of them — both ⚙ Year Range fields, the Save Defaults popup's N field, every
                tap-to-type readout — live INSIDE the panel, where the stop is reachable every time
                and is what keeps their Escape from slamming the panel shut (tests/settingsPanel.
                yearRange, tests/saveDefaults, tests/sliderValueEditor.dom pin it there). An Escape
                contract that holds in four boxes and not the other two is not a contract; it is a
                trap for whoever writes the seventh. The honest reading of this line today is "this
                box handled the press", which is true on every path, rather than "this box is
                defending the panel", which is no longer any path at all. */}
        <div className="flex items-stretch shrink-0">
          <span
            className={`self-center text-xs leading-none text-(--tx-200-80) ${runPhase !== 'idle' ? ' opacity-60' : ''}`}
          >
            Ao
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="AoX run length"
            readOnly={runPhase !== 'idle'}
            value={aoxN}
            onChange={(e) => {
              const v = e.target.value
              if (runPhase === 'idle' && (v === '' || /^\d*$/.test(v))) setAoxN(v)
            }}
            onFocus={() => {
              aoxNAtFocusRef.current = aoxN
            }}
            // ⚠ FUNCTIONAL UPDATERS, and that is what makes Escape work rather than a style choice.
            // These two commits used to close over the render's `aoxN`. Escape's revert writes the
            // store and then blurs in the SAME event, before this component has re-rendered — so a
            // closure-read commit would have re-committed the very text Escape just discarded. That
            // is precisely the bug round 14 found in the ⚙ year boxes, where the fix was flushSync;
            // here the store setter already takes an updater (store/modePrefs `resolve`), so
            // reading the live value is the smaller and more direct fix, and it is correct on the
            // blur and Enter paths independently of Escape.
            onBlur={() => setAoxN((v) => normalizeAoxN(v))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setAoxN((v) => normalizeAoxN(v))
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setAoxN(aoxNAtFocusRef.current)
                e.currentTarget.blur()
              }
            }}
            className={`${NUM_INPUT_CLASS} py-1 w-14 shrink-0 ${runPhase !== 'idle' ? ' opacity-60 pointer-events-none' : ''}`}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (runPhase === 'idle') setAllowMistakes((v) => !v)
          }}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${runPhase !== 'idle' ? ' opacity-60 pointer-events-none' : ''}`}
        >
          Allow Mistakes
        </button>
        <button
          type="button"
          onClick={() => {
            if (runPhase === 'idle') setOneByOne((v) => !v)
          }}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${oneByOne ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${runPhase !== 'idle' ? ' opacity-60 pointer-events-none' : ''}`}
        >
          One-by-One
        </button>
      </div>
      <div className="mt-4 rounded-2xl panel p-4">
        <div className="text-center relative">
          {(inBack || isLocked) && (
            <span className="absolute right-0 top-0 text-[11px] tabular-nums text-(--tx-300-60)">
              Q{state.stack.length + 1}
            </span>
          )}
          <div className="text-3xl font-bold">
            {dateVisible ? fmtDate(date.y, date.m, date.d, date._fmt) : '—'}
          </div>
        </div>
        <WeekdayAnswer
          key={state.gridEpoch}
          inputStyle={inputStyle}
          persistBtns={state.persistBtns}
          flash={flash}
          optionsDisabled={optionsDisabled}
          onPick={submitDoW}
        />
      </div>
      <div className="mt-4 rounded-2xl panel p-3 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {primaryBtn}
          <div className="col-span-1 flex gap-1">
            <button
              type="button"
              data-key="ArrowLeft"
              className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${backDisabled ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={eng.back}
            >
              <span style={{ position: 'relative', top: '-1.5px' }}>&lt;</span>
            </button>
            <button
              type="button"
              data-key="ArrowRight"
              className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${fwdDisabled ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={eng.forward}
            >
              <span style={{ position: 'relative', top: '-1.5px' }}>&gt;</span>
            </button>
          </div>
          <button
            type="button"
            data-key="R"
            className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealLocked ? 'opacity-60 pointer-events-none' : ''}`}
            onClick={onReveal}
          >
            Reveal
          </button>
          <button
            type="button"
            data-key="O"
            className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${!overrideAvail ? 'opacity-60 pointer-events-none' : ''}`}
            onClick={onOverride}
          >
            Override
          </button>
        </div>
        {/* Show Codes — the SHARED MethodBreakdownSection, exactly like the other four modes
                (Q5, round 8). AoX's gate isn't "is there a date" but "is the date SHOWABLE": the run
                is idle, or a One-by-One date is still hidden. Passing null then is how Blitz and Flash
                already spell the same thing, and it drives the disabled classes, the aria-disabled and
                the panel's closed state off one value. `codesDisabled` can only turn true in the same
                React update that clears calcOpen (reset / hidden-mid-run batch resetStats with the
                phase; onNext closes the panel before hiding the next date), so the section's
                date-removed auto-close never fires here — it is a backstop, not a path.
                What the fold FIXED: AoX's private freeze effect held only the DATE, so a format or
                Julian change during the close leaked into the sliding panel; and it cleared its
                was-open flag immediately, so tapping ">" inside the freeze window (Forward closes the
                panel AND changes the date) fell through to the live values and swapped the panel's
                contents while it was still visibly sliding shut. The shared effect freezes all four
                inputs and re-arms on a dep change via its closingRef. */}
        <MethodBreakdownSection
          date={codesDisabled && !inBack ? null : date}
          open={state.calcOpen}
          onOpenChange={onShowCodes}
          className=""
          contentClassName="mt-2 rounded-2xl thin px-4 pt-[3px] pb-1.5"
          useJulian={inBack ? (date?._jul ?? useJulian) : useJulian}
          displayedFormat={date?._fmt || dateFormat}
        />
      </div>
    </div>
  )
}

export default AoxMode
