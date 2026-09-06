// BlitzMode — the countdown screen: Per Round and Per Question timing, the Allow Mistakes
// sudden-death variant, and Best Score/Streak with round-id rollback. Extracted verbatim from
// main.tsx (Q1 phase 1); it was already a module-level sibling of App taking everything through
// props, so nothing about its behaviour changes by living here.
import { useEffect, useRef, useState } from 'react'
import type { ModeProps, FmtDate, GenDate } from './modeTypes.js'
import { useButtonFlash } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import { RESET_BTN_CLASS } from '../components/controlClasses.js'
import {
  fmtTime,
  truncTime,
  fmtBlitzT,
  fmtAccuracyPct,
  SLIDER_READOUT_WIDEST,
} from '../lib/modeFormat.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import RunBreakdown from '../components/RunBreakdown.jsx'
import CardNumber from '../components/CardNumber.jsx'
import SliderValueEditor from '../components/SliderValueEditor.jsx'
import BlitzBestRow from '../components/BlitzBestRow.jsx'
import { NewBestStar } from '../components/primitives.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { calcAvg, calcLast, calcMed } from '../engine/stats.js'
import { buildRunBreakdown } from '../engine/runBreakdown.js'
import { reconcileBlitzBest, reconcileSuddenBest } from '../engine/blitzBest.js'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import type { BlitzBest, SuddenBest } from '../store/progress.js'
import { useUserDefaults, effectivePrefDefaults } from '../store/userDefaults.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import { useBackButton } from '../components/useBackButton.js'

// ============================================================
// BlitzMode — the Blitz game mode on the shared engine (mode-untangle Step 3).
//
// Self-contained + always-mounted. KEY INSIGHT: App resets stats on every blitz Begin,
// so the engine `S` already IS the round score — Blitz needs NO reducer changes. BlitzMode
// = the engine + a countdown (Per Round `blitzSec` / Per Question `qSec`) + Best Score/
// Streak tracking. Begin = engine.resetStats() (fresh round) + start timer; answering uses
// the engine; a round ends on the clock or on a wrong with Allow Mistakes off (either
// timing sub-mode — the two toggles are fully independent, C3a). Best is reconciled in an
// effect when a round ends (set to max, tagged with the round id) and ROLLED BACK there
// too when an Override drops the round that set it.
// ============================================================
function BlitzMode({
  visible,
  genDate,
  minY,
  maxY,
  useJulian,
  saveStats,
  dateFormat,
  randomFormat,
  inputStyle = 'buttons',
  dotOrientation = 'columns',
  leapChance,
  janFebChance,
  julianChance,
  fmtDate,
  settingsOpen,
  clockPaused,
  onFreshChange,
}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }) {
  const perQ = useModePrefs((s) => s.blitzPerQ),
    setPerQ = useModePrefs((s) => s.setBlitzPerQ) // persisted (mode-prefs store)
  const allowMistakes = useModePrefs((s) => s.blitzAllowMistakes),
    setAllowMistakes = useModePrefs((s) => s.setBlitzAllowMistakes) // persisted (mode-prefs store)
  const timingOff = useModePrefs((s) => s.blitzTimingOff),
    setTimingOff = useModePrefs((s) => s.setBlitzTimingOff) // persisted; VISUAL-ONLY (Q8) — blanks the timing trio, the engine clock never stops (no arm/reset)
  const [active, setActive] = useState(false)
  const [timerDone, setTimerDone] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false) // the round breakdown popup (components/RunBreakdown) — ephemeral, dies with the round
  const [showTimerDate, setShowTimerDate] = useState(false)
  const blitzSec = useModePrefs((s) => s.blitzSec),
    setBlitzSec = useModePrefs((s) => s.setBlitzSec) // persisted (mode-prefs store)
  const qSec = useModePrefs((s) => s.blitzQSec),
    setQSec = useModePrefs((s) => s.setBlitzQSec) // persisted (mode-prefs store)
  const [, setBlitzRemain] = useState(60)
  const [, setQRemain] = useState(5)
  const blitzStartRef = useRef<number | null>(null),
    blitzPausedAtRef = useRef<number | null>(null),
    blitzPausedAccRef = useRef(0),
    blitzRemainRef = useRef(60)
  const blitzBarRef = useRef<HTMLSpanElement | null>(null),
    blitzTimeRef = useRef<HTMLSpanElement | null>(null)
  const qDeadlineRef = useRef<number | null>(null),
    qPausedAtRef = useRef<number | null>(null),
    qPausedAccRef = useRef(0)
  const suddenBarRef = useRef<HTMLSpanElement | null>(null),
    suddenTimeRef = useRef<HTMLSpanElement | null>(null)
  // Blitz all-time bests persist across reloads (Stage D1): from the progress store — per-round
  // (blitzBest), per-Q sudden death (suddenBest), and per-Q + Allow Mistakes (suddenAmBest, C3a).
  // (The "new best ★" markers below stay local — they're per-session UI, not persisted.)
  const blitzBest = useProgress((s) => s.blitzBest),
    setBlitzBest = useProgress((s) => s.setBlitzBest)
  const suddenBest = useProgress((s) => s.suddenBest),
    setSuddenBest = useProgress((s) => s.setSuddenBest)
  const suddenAmBest = useProgress((s) => s.suddenAmBest),
    setSuddenAmBest = useProgress((s) => s.setSuddenAmBest)
  const [blitzBestNew, setBlitzBestNew] = useState<
      Record<string, { score: boolean; streak: boolean }>
    >({}),
    [suddenBestNew, setSuddenBestNew] = useState<Record<string, boolean>>({})
  const [suddenAmBestNew, setSuddenAmBestNew] = useState<
    Record<string, { score: boolean; streak: boolean }>
  >({})
  const currentRoundIdRef = useRef<number | null>(null),
    nextRoundIdRef = useRef(1)
  // The FULL Best records that stood BEFORE the current round (snapshotted at Begin), serving two
  // jobs from one snapshot: (a) the reconcile's cross-round rollback FLOOR — a later Override that
  // drops THIS round's score must not pull Best below the earlier round it overwrote (mirrors
  // AoX's prevBestSnapRef; C2 — cross-round Best rollback); (b) the resume-REVERT — when an
  // Override credits a misclick and RESUMES the round, the Best the interrupted round provisionally
  // saved is rolled back wholesale to these records (it re-saves only when the round genuinely
  // ends). (C2 Q2-A.)
  const prevRoundBestRef = useRef<{
    blitzBk: string
    suddenBk: string
    blitz?: BlitzBest
    sudden?: SuddenBest
    suddenAm?: BlitzBest
  }>({ blitzBk: '', suddenBk: '' })
  // saveStats:true ALWAYS (like AoX): the round tracks internally regardless of the global Save
  // Stats toggle, which now gates only the DISPLAY (a dimmed strip of "—"), whether a Best is recorded,
  // and whether Override shows while off. Always-tracking keeps the misclick-rescue credit
  // integrity-safe in practice mode (good ≤ played — played is always incremented on the wrong),
  // so an unscored question can't hit the good>played landmine. (C2 Q2-B; was `saveStats`.)
  const eng = useGameEngine({
    label: 'blitz',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats: true,
    timingOff: false,
  }) // Blitz: timing always tracked
  const { state, correct, overrideAvail: engOverrideAvail } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode (Q1). Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/useBackButton.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const S = state.stats
  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse

  // A round ended by a player ACTION (not the clock) is RESUMABLE via Override — credit the
  // resolved question + continue. countedWrong is set by a wrong answer, a Reveal, OR a Show
  // Codes; a TIMER end on a pristine question (LOCK_REVEAL / TIMEOUT_MISS) does NOT set it, so
  // the clock simply running out is correctly NOT resumable. One deliberate corner (per-Q +
  // Allow Mistakes, C3a): a wrong answer leaves the round running with countedWrong SET, so a
  // timeout on that burned question ends the round with countedWrong still true — that end IS
  // resumable (crediting the wrong resumes with a fresh question clock, exactly what a
  // judged-correct answer would have granted before the expiry; owner-ratified). So "reveal or
  // show codes then override" continues the round, same as a misclick (owner's call, C2 —
  // override is uniform). The resume reverts the interrupted round's provisionally-saved Best
  // (see resumeRound). One source of truth for both the resume (onOverride) and any
  // round-end-resumable check.
  const resumableEnd = timerDone && state.countedWrong
  // Override availability is uniform — NOT gated on the live `saveStats` (owner's call, C2: gating
  // it made Override more forgiving when Save Stats is ON than OFF, which is backwards). Blitz
  // always-tracks internally (saveStats:true above), so engOverrideAvail (which uses the frozen
  // effective save-stats, always true here) is correct in both states; the credit is just
  // invisible in practice mode (stats dimmed, no Best recorded).
  const overrideAvail = engOverrideAvail

  // The per-config Best silo keys. blitzBk leads with an m/n Allow-Mistakes marker (both
  // per-round variants share the one blitzBest map); suddenBk has NO AM segment — for
  // per-question, AM-ness is the MAP split (suddenBest = sudden death, suddenAmBest = Allow
  // Mistakes on, C3a), because the two record shapes differ (score-only vs score+streak).
  const blitzBk = `${allowMistakes ? 'm' : 'n'}${blitzSec}|${randomFormat ? 'random' : dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`
  const suddenBk = `${qSec}|${randomFormat ? 'random' : dateFormat}|${leapChance}|${janFebChance}|${julianChance}|${minY}-${maxY}|${useJulian}`

  const resetTimerBars = () => {
    if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
    if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
  }
  const stopRound = () => {
    blitzStartRef.current = null
    blitzPausedAtRef.current = null
    blitzPausedAccRef.current = 0
    qDeadlineRef.current = null
    qPausedAtRef.current = null
    qPausedAccRef.current = 0
  }
  const endRound = () => {
    // Stamp the EXACT remaining time at this instant into blitzRemainRef BEFORE stopRound() nulls
    // blitzStartRef, so a later Override-resume continues from the true remaining rather than the
    // last rAF frame's value (up to a frame stale, always in the player's favor). Per-Round only —
    // the per-Question resume starts a fresh qSec, so it carries nothing. On a clock-expiry end the
    // remaining is already ~0, so this is a no-op there. (F: Blitz resume sub-frame timer drift.)
    if (!perQ && blitzStartRef.current != null) {
      const t = (performance.now() - blitzStartRef.current - blitzPausedAccRef.current) / 1000
      blitzRemainRef.current = Math.max(0, blitzSec - t)
    }
    setActive(false)
    setShowTimerDate(true)
    setTimerDone(true)
    stopRound()
  }

  // Countdown loop (Per Round drains blitzRemain; Per Question drains qRemain). On 0 the
  // round ends — per-round timeout shows the answer with no stat (lockReveal); per-Q
  // timeout counts a miss (timeoutMiss). Gated off while the rotate-back overlay pauses the
  // clock (Q11) so the round can't drain — or expire — behind the overlay.
  useEffect(() => {
    if (!active || clockPaused) return
    let raf = 0
    const loop = () => {
      const now = performance.now()
      if (!perQ && blitzStartRef.current != null) {
        const t = (now - blitzStartRef.current - blitzPausedAccRef.current) / 1000
        const r = Math.max(0, blitzSec - t)
        blitzRemainRef.current = r
        const sx = Math.max(0, Math.min(1, r / blitzSec))
        if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(' + sx + ')'
        if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(r)
        setBlitzRemain(r)
        if (r <= 0.001) {
          eng.lockReveal()
          endRound()
          return
        }
      }
      if (perQ && qDeadlineRef.current != null) {
        const r = Math.max(0, (qDeadlineRef.current + qPausedAccRef.current - now) / 1000)
        const sx = qSec > 0 ? Math.max(0, Math.min(1, r / qSec)) : 1
        if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(' + sx + ')'
        if (suddenTimeRef.current) suddenTimeRef.current.textContent = Math.ceil(r) + 's'
        setQRemain(r)
        if (r <= 0.001) {
          eng.timeoutMiss()
          endRound()
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endRound is behavior-stable (closes over only stable setters + ref writes); excluded so its identity change doesn't restart the countdown
  }, [active, perQ, blitzSec, qSec, eng, clockPaused])

  // Rotate-overlay clock freeze (Q11). The countdown math above ALREADY carries pause
  // bookkeeping — blitzPausedAcc is subtracted from the round's elapsed, qPausedAcc extends
  // the question deadline (designed in with the clocks, dormant until now) — and this effect
  // is what engages it: while the rotate-back overlay covers the app (clockPaused), stamp the
  // pause start; on rotate-back (the cleanup) fold the paused span into the accumulators so
  // both clocks resume exactly where they stopped. The rAF loop is gated off while paused
  // (nothing visible to draw, and the round must not expire behind the overlay). Both
  // sub-modes' refs are stamped unconditionally — the idle one's accumulator is reset by
  // begin/freshQClock/resumeRound before its clock ever reads it; the null-guards make the
  // fold a no-op if the round was torn down mid-pause (stopRound nulls the stamps).
  useEffect(() => {
    if (!clockPaused) return
    const at = performance.now()
    blitzPausedAtRef.current = at
    qPausedAtRef.current = at
    return () => {
      const dt = performance.now() - at
      if (blitzPausedAtRef.current != null) {
        blitzPausedAtRef.current = null
        blitzPausedAccRef.current += dt
      }
      if (qPausedAtRef.current != null) {
        qPausedAtRef.current = null
        qPausedAccRef.current += dt
      }
    }
  }, [clockPaused])

  // Arm a FRESH per-question clock for the question now on screen — one home for the stamp
  // (deadline = now + qSec, pause bookkeeping cleared, display reset). Every per-Q advance
  // grants one: Begin, a correct answer, an in-round Override credit that advanced (C3a), and
  // the Override-rescue resume.
  const freshQClock = () => {
    qDeadlineRef.current = performance.now() + qSec * 1000
    qPausedAccRef.current = 0
    qPausedAtRef.current = null
    setQRemain(qSec)
  }
  const begin = () => {
    eng.resetStats() // fresh round (S→0, history clear, new date)
    currentRoundIdRef.current = nextRoundIdRef.current++
    // Snapshot the FULL Best records standing before this round (per the active config) — the
    // reconcile floor + the resume-revert target.
    prevRoundBestRef.current = {
      blitzBk,
      suddenBk,
      blitz: blitzBest[blitzBk],
      sudden: suddenBest[suddenBk],
      suddenAm: suddenAmBest[suddenBk],
    }
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    if (!perQ) {
      blitzStartRef.current = performance.now()
      blitzPausedAccRef.current = 0
      blitzPausedAtRef.current = null
      setBlitzRemain(blitzSec)
      blitzRemainRef.current = blitzSec
    } else freshQClock()
    resetTimerBars()
  }
  const onAnswer = (i: number) => {
    if (!active) return
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i })
    eng.answer(i)
    if (i === correct) {
      if (perQ) freshQClock()
      // per-round: round continues; engine already advanced to the next date
    } else {
      // Wrong: ends the round only when Allow Mistakes is off (either timing sub-mode). With
      // AM on the component does NOTHING — the engine has marked the wrong, counted played,
      // broken the streak, and stayed on the question: per-round keeps its countdown, and
      // per-Q keeps the SAME draining question clock (no refresh) until a correct answer or an
      // Override credit advances (C3a).
      if (!allowMistakes) {
        eng.lockReveal()
        endRound()
      }
    }
  }
  // Resume a round that an Override just RESCUED. A player action (a wrong answer, a Reveal, or
  // a Show Codes — or, in per-Q + Allow Mistakes, the clock expiring on a question already
  // answered wrong; see resumableEnd) ended the round (the clock stopped, the Best was
  // provisionally saved by the timerDone effect) and crediting that resolved question via
  // Override continues the round instead of leaving it dead. Two halves: (1) revert the active
  // sub-mode's Best to the pre-round record (it re-saves only when the round genuinely ends) +
  // clear its ★ — safe to branch on the live prefs, the toggles are idle-locked; (2) restart
  // the clock — Per Round continues the countdown WHERE IT STOPPED (blitzStart = now − elapsed,
  // so the remaining time = blitzRemainRef), Per Question starts a fresh per-question timer on
  // the (already-advanced) next date. Restores the pre-rewrite behavior the Blitz mode-untangle
  // dropped (original 7176a50 did exactly this). (C2 Q2-A.)
  const resumeRound = () => {
    const snap = prevRoundBestRef.current
    if (!perQ) {
      setBlitzBest((prev) => {
        const nx = { ...prev }
        if (snap.blitz) nx[snap.blitzBk] = snap.blitz
        else delete nx[snap.blitzBk]
        return nx
      })
      setBlitzBestNew((p) => {
        if (!(snap.blitzBk in p)) return p
        const nx = { ...p }
        delete nx[snap.blitzBk]
        return nx
      })
    } else if (allowMistakes) {
      setSuddenAmBest((prev) => {
        const nx = { ...prev }
        if (snap.suddenAm) nx[snap.suddenBk] = snap.suddenAm
        else delete nx[snap.suddenBk]
        return nx
      })
      setSuddenAmBestNew((p) => {
        if (!(snap.suddenBk in p)) return p
        const nx = { ...p }
        delete nx[snap.suddenBk]
        return nx
      })
    } else {
      setSuddenBest((prev) => {
        const nx = { ...prev }
        if (snap.sudden) nx[snap.suddenBk] = snap.sudden
        else delete nx[snap.suddenBk]
        return nx
      })
      setSuddenBestNew((p) => {
        if (!(snap.suddenBk in p)) return p
        const nx = { ...p }
        delete nx[snap.suddenBk]
        return nx
      })
    }
    setActive(true)
    setTimerDone(false)
    setShowTimerDate(false)
    if (!perQ) {
      blitzStartRef.current = performance.now() - (blitzSec - blitzRemainRef.current) * 1000
      blitzPausedAccRef.current = 0
      blitzPausedAtRef.current = null
    } else freshQClock()
  }
  // Override-to-wrong is a mistake: flipping a CORRECT answer to wrong (a live first-try
  // reversal, or retro-flipping the most-recent correct history entry) ends the round when
  // Allow Mistakes is off — exactly like a real wrong answer (bug #1); with AM on the round
  // keeps going in either timing sub-mode (C3a). Wrong→credit overrides (countedWrong /
  // pendingWrongOverride) are corrections and never end the round. Detect the to-wrong
  // direction from the same fields the reducer reads.
  const onOverride = () => {
    // A round ended by an action (wrong / Reveal / Show Codes — see `resumableEnd` above) is
    // RESUMABLE: crediting the resolved question via Override continues the round instead of
    // leaving it dead, and resumeRound reverts the interrupted round's provisional Best. Captured
    // BEFORE override mutates state. (C2 Q2-A + the uniform-override extension.)
    let flipToWrong = false
    if (state.canOverrideCorrect && state.prevStatsSnapshot)
      flipToWrong = !state.prevStatsSnapshot.wasWrong
    else if (eng.retroOverrideEligible) {
      const last = state.stack[state.stack.length - 1]
      flipToWrong = !!(last?.capsule?.snapshot && !last.capsule.snapshot.wasWrong)
    }
    if (state.countedWrong) setFlashWithTimeout({ type: 'good', idx: correct })
    eng.override() // credit (Path 3/4/5); the round then resumes (rescue) or the timerDone effect reconciles
    if (resumableEnd) resumeRound()
    else if (active && flipToWrong && !allowMistakes) endRound()
    else if (active && perQ && (state.countedWrong || state.pendingWrongOverride != null)) {
      // The override ADVANCED the live question (Path 3 credits this burned question and
      // advances; Path 4 credits the previous wrong and advances — overrideAvail already
      // excludes the spent-target Path-4 no-op) — a new date must never inherit the old date's
      // drained clock, exactly as a correct answer refreshes it (C3a). `state` here is the
      // PRE-dispatch snapshot (the same idiom flipToWrong reads above), and the three branches
      // are mutually exclusive: a retro flip requires neither field set, so it correctly
      // leaves the live question's clock draining.
      freshQClock()
    }
  }
  const onReveal = () => {
    eng.reveal()
    endRound()
  }
  // Opening Show Codes during an active round ends the round (so Best Score is recorded and
  // the countdown stops), exactly like Reveal — bug #3. The original applyCalcPenalty ended
  // the round for an active timer; the Blitz migration dropped it (bare eng.showCodes).
  const onShowCodes = (open: boolean) => {
    eng.showCodes(open)
    if (open && active) endRound()
  }
  const resetRound = () => {
    eng.resetStats()
    setActive(false)
    setTimerDone(false)
    setBreakdownOpen(false) //  the breakdown belongs to the round being cleared
    setShowTimerDate(false)
    stopRound()
    resetTimerBars()
  } // App's arm (resets stats for blitz)

  // Leaving the mode mid-round ABANDONS the round (the original App discarded an active round
  // on switch-away; AoX resets a hidden running run and Flash stops a live flash the same way —
  // this teardown was missed in the Blitz migration). Without it the hidden rAF countdown kept
  // draining behind display:none: a per-question timeout would count a phantom MISS in absentia,
  // and the round would end + reconcile a Best for play the user walked away from. The ended
  // (timerDone) state DOES survive a detour, like AoX's done run. (C2 fix; pinned in blitz.dom.)
  // ⚠ Both directives below are repositioned, not new behaviour — same cause as the other
  // extracted modes: in main.tsx's one-line style the call, the closing brace and the dep array
  // shared a line, so a single trailing directive covered all of it. Prettier splits them and a
  // line directive only covers its own line. The set-state disable is new for the reason recorded
  // in FlashMode: the React Compiler never analyzed this component inside main.tsx, so the rule
  // was silent there. Q1 is a verbatim move; ▶ queued for proper review as its own item.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible && active) resetRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // On the ⚙ popover CLOSE (Q2), reconcile Blitz against the new settings: an ACTIVE round OR an
  // ENDED round (timerDone) RESETS as if Reset was pressed — its config (and any recorded Best) is now
  // stale. This RESTORES the documented "a settings change ends an active Blitz round" behavior the
  // mode-untangle dropped (BlitzMode had no settings effect; AoX does this via its own close-effect)
  // AND applies the ended-round reset so the round on screen always matches the current settings. Idle
  // has no live round/date to reconcile. Deferred to close (batched, no per-keystroke churn). The two
  // timer lengths are in the deps because Reset Settings can now restore them mid-round (round-6 Q7):
  // the sliders are idle-locked, so the only in-popover writer of blitzSec/qSec is Reset Settings, and a
  // reset that lands a fresh timer must reconcile the running/ended round exactly as a panel change does.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [
      randomFormat,
      dateFormat,
      useJulian,
      minY,
      maxY,
      leapChance,
      janFebChance,
      julianChance,
      blitzSec,
      qSec,
    ],
    () => {
      if (active || timerDone) resetRound()
    },
  )

  // Reconcile Best when a round is over: set to max(S) tagged with the round id, and roll
  // back when an Override has dropped the score of the round that set the Best. Runs on
  // S changes while timerDone (covers both round-end and post-round override). Three-way by
  // sub-mode (safe on live prefs — the toggles are idle-locked): per-round → blitzBest;
  // per-Q + Allow Mistakes → suddenAmBest, the SAME BlitzBest shape + reconcile (C3a);
  // per-Q sudden death → suddenBest (score only).
  useEffect(() => {
    if (!timerDone) return
    if (!saveStats) return // practice mode (Save Stats off): the round plays + tracks internally but records NO Best (C2 Q2-B — now that the engine always tracks, gate the Best here like AoX does)
    const rid = currentRoundIdRef.current
    if (!perQ) {
      setBlitzBest((prev) => {
        const cur = prev[blitzBk] ?? {
          score: 0,
          streak: 0,
          scoreRoundId: null,
          streakRoundId: null,
        }
        const fb = prevRoundBestRef.current
        const next = reconcileBlitzBest(cur, S.good, S.best, rid, {
          score: fb.blitz?.score ?? 0,
          streak: fb.blitz?.streak ?? 0,
        })
        if (
          next.score === cur.score &&
          next.streak === cur.streak &&
          next.scoreRoundId === cur.scoreRoundId &&
          next.streakRoundId === cur.streakRoundId
        )
          return prev
        const scoreUp = next.score > cur.score,
          streakUp = next.streak > cur.streak
        if (scoreUp || streakUp)
          setBlitzBestNew((p) => {
            const e = p[blitzBk] || { score: false, streak: false }
            return { ...p, [blitzBk]: { score: e.score || scoreUp, streak: e.streak || streakUp } }
          })
        return { ...prev, [blitzBk]: next }
      })
    } else if (allowMistakes) {
      setSuddenAmBest((prev) => {
        const cur = prev[suddenBk] ?? {
          score: 0,
          streak: 0,
          scoreRoundId: null,
          streakRoundId: null,
        }
        const fb = prevRoundBestRef.current
        const next = reconcileBlitzBest(cur, S.good, S.best, rid, {
          score: fb.suddenAm?.score ?? 0,
          streak: fb.suddenAm?.streak ?? 0,
        })
        if (
          next.score === cur.score &&
          next.streak === cur.streak &&
          next.scoreRoundId === cur.scoreRoundId &&
          next.streakRoundId === cur.streakRoundId
        )
          return prev
        const scoreUp = next.score > cur.score,
          streakUp = next.streak > cur.streak
        if (scoreUp || streakUp)
          setSuddenAmBestNew((p) => {
            const e = p[suddenBk] || { score: false, streak: false }
            return { ...p, [suddenBk]: { score: e.score || scoreUp, streak: e.streak || streakUp } }
          })
        return { ...prev, [suddenBk]: next }
      })
    } else {
      setSuddenBest((prev) => {
        const cur = prev[suddenBk] ?? { score: 0, roundId: null }
        const next = reconcileSuddenBest(
          cur,
          S.good,
          rid,
          prevRoundBestRef.current.sudden?.score ?? 0,
        )
        if (next.score === cur.score && next.roundId === cur.roundId) return prev
        if (next.score > cur.score) setSuddenBestNew((p) => ({ ...p, [suddenBk]: true }))
        return { ...prev, [suddenBk]: next }
      })
    }
  }, [
    timerDone,
    saveStats,
    S.good,
    S.best,
    perQ,
    allowMistakes,
    blitzBk,
    suddenBk,
    setBlitzBest,
    setSuddenBest,
    setSuddenAmBest,
  ])

  // Both toggles are bare idle-gated flips — fully independent since C3a (the old auto-off
  // coupling died with the sudden-death-only per-Q). The idle lock (also mirrored by the
  // pointer-events dim on the buttons) is what makes the live-prefs branching above safe.
  const togglePerQ = () => {
    if (active || timerDone) return
    setPerQ((v) => !v)
  }
  const toggleAllowMistakes = () => {
    if (active || timerDone) return
    setAllowMistakes((v) => !v)
  }

  // Freshness for App's isFullyReset. The two timer lengths compare against their EFFECTIVE
  // defaults — the saved personal defaults when they exist (Q7, store/userDefaults); the
  // excluded config (perQ, allowMistakes, the visual-only timingOff — Q8) stays factory-fixed
  // (not capturable), so each compares to its launch constant (Full Reset returns them all).
  const defBlitzSec = useUserDefaults((s) => effectivePrefDefaults(s.saved).blitzSec)
  const defBlitzQSec = useUserDefaults((s) => effectivePrefDefaults(s.saved).blitzQSec)
  const blitzIsFresh =
    state.stats.played === 0 &&
    state.stats.good === 0 &&
    state.stats.streak === 0 &&
    state.stats.best === 0 &&
    state.stats.times.length === 0 &&
    state.stack.length === 0 &&
    state.forwardStack.length === 0 &&
    state.backDepth === 0 &&
    state.locked === false &&
    state.revealed === false &&
    state.countedWrong === false &&
    state.canOverrideCorrect === false &&
    state.pendingWrongOverride === null &&
    state.overrideUsedThisQ === false &&
    state.calcOpen === false &&
    active === false &&
    timerDone === false &&
    breakdownOpen === false &&
    showTimerDate === false &&
    perQ === false &&
    allowMistakes === true &&
    timingOff === false &&
    blitzSec === defBlitzSec &&
    qSec === defBlitzQSec &&
    Object.keys(blitzBest).length === 0 &&
    Object.keys(suddenBest).length === 0 &&
    Object.keys(suddenAmBest).length === 0 &&
    flash === null
  useEffect(() => {
    onFreshChange?.(blitzIsFresh)
  }, [blitzIsFresh, onFreshChange])

  const shouldShowTimerDate = active || showTimerDate
  const optionsDisabled = !active || state.locked || state.calcOpen || state.calcPenaltyActive
  const timerBlocksReveal = !shouldShowTimerDate
  const revealDisabled =
    (state.locked && state.revealed) ||
    state.calcOpen ||
    state.calcPenaltyActive ||
    timerBlocksReveal ||
    timerDone
  const timerBusy = active
  // Streak is hidden only in per-Q sudden death: there a wrong ends the round, so streak
  // always equals score. With Allow Mistakes on it behaves exactly like per-round (C3a).
  const showStreak = !perQ || allowMistakes
  // The timing trio (Last/Mean/Median) carries a VISUAL-ONLY hide toggle (Q8): tap any of the
  // three to blank them all. Unlike Classic/Flash/Deduction there is NO engine timingOff and NO
  // "Enable and Reset Stats?" arm — Blitz always tracks (saveStats:true above), so hiding can never
  // desync (structurally desync-proof). (Persisted as blitzTimingOff — excluded from the defaults
  // system.) Save Stats off drops the toggle, exactly as it does for the scoring trio.
  //
  // ★ `off` is the USER'S hide toggle and nothing else (C1, round 16) — so it is `timeHidden`
  // below and NOT a `!saveStats` term, and the scoring trio (Score/Accuracy/Streak — untoggleable,
  // the score IS the mode) carries no `off` at all. The Save-Stats fact is `dimmed` on the panel
  // below: one flag, whole strip.
  //
  // ★★ HIDING QUIETS ONLY A ROUND THAT IS STILL GOING. An ENDED round (`timerDone`) shows its
  // times and drops the toggle — the same guard AoX carries on a completed run, and Blitz was the
  // one mode missing it, so its time boxes stayed tappable on a screen where AoX's were already
  // inert. Two sibling modes disagreeing about the same screen.
  //
  // WHY `timerDone` IS THE SIGNAL, and it is worth being exact because Blitz names nothing
  // "complete". `setTimerDone(true)` has exactly ONE writer — endRound() — and EVERY way a round
  // can finish routes through it, in BOTH timing sub-modes: the Per Round countdown hitting 0, any
  // single question's Per Question clock hitting 0, a wrong answer with Allow Mistakes off, Reveal,
  // Show Codes, opening ⚙ mid-round, and an override-to-wrong with Allow Mistakes off. So there is
  // no per-sub-mode branch to write here: one flag already means "this round is over" everywhere.
  // It is also the flag the Best-reconcile effect gates on, which is what makes it AoX's 'done'
  // rather than AoX's 'failed' — a Blitz round that ends on a wrong in sudden death still RECORDS
  // its result, so it is a finished round, not an abandoned one. (AoX's 'failed' records nothing
  // and is correctly still hideable there.)
  //
  // ⚠ BOTH HALVES MOVE TOGETHER — dropping `fn` while leaving `off: timingOff` would be a trap, not
  // half a fix. Tapping a time box is the ONLY writer of blitzTimingOff in the whole app (it is
  // excluded from the defaults system and survives Reset Settings; only Full Reset clears it), so a
  // player who had hidden the trio would end a round facing three blank boxes and no way to reveal
  // the round's own times without resetting the round away. Masking the pref on this screen and
  // taking the toggle with it is one coherent state: the ended strip is a plain result readout.
  // The pref itself is never written here — resume an ended round via Override (resumeRound clears
  // timerDone) and the hide the player chose is back, untouched.
  //
  // ⚠ With Save Stats OFF the whole strip is dimmed to '—' and `tFn` was already null; an ended
  // round now reads '—' there rather than blank, because `timeHidden` goes false. That is the
  // dimmed strip's uniform statement and it is exactly what AoX does in the same state.
  const timeHidden = timingOff && !timerDone
  const tFn = saveStats && !timerDone ? () => setTimingOff((v) => !v) : null
  // ── THE ROUND BREAKDOWN (sub-group 3C) ──────────────────────────────────────────────────────
  // The same panel MoX opens, on the same gesture and for the same reason: an ENDED round's stat
  // strip is already inert (the line above drops `tFn` on `timerDone`, and the scoring boxes never
  // had one), so tapping anywhere on it opens the round solve-by-solve. It fell out of the MoX work
  // for the price of these three lines because Blitz's Begin is a full engine RESET — so the round's
  // history IS the whole engine history, and the times ledger's carried-in count is 0, which is what
  // makes the rows add up to the strip's Mean exactly.
  // ⚠ `timerDone` is the right flag and it is NOT AoX's 'failed': every way a Blitz round can end
  // routes through endRound(), and a round that ends on a wrong answer in sudden death still RECORDS
  // its result. It is a finished round, not an abandoned one. (The long argument is in the timing
  // note directly above.) Gated on `saveStats` for the reason MoX is: a dimmed strip reading '—'
  // must not be a door to the numbers it is declining to show.
  //
  // ⚠ AND ON `visible`, which is not paranoia — it is the one guard the mode's own display:none
  // cannot supply. The popup PORTALS to #root, so it sits outside this screen's hidden wrapper: a
  // round left finished on screen and then a keyboard mode-switch (the shortcut keys still fire while
  // the panel is up) would leave this card floating over a different mode. Gating availability on
  // `visible` unmounts it with the screen it belongs to, which also pops its overlay registration.
  const breakdownAvail = timerDone && saveStats && visible
  const breakdownShown = breakdownOpen && breakdownAvail
  const statsArr = [
    { label: 'Score', value: `${S.good}/${S.played}`, fn: null },
    { label: 'Accuracy', value: fmtAccuracyPct(S.good, S.played), fn: null },
    ...(showStreak ? [{ label: 'Streak', value: `${S.streak}/${S.best}`, fn: null }] : []),
    { label: 'Last', value: truncTime(calcLast(S.times)), off: timeHidden, fn: tFn },
    { label: 'Mean', value: fmtTime(calcAvg(S.times)), off: timeHidden, fn: tFn },
    { label: 'Median', value: fmtTime(calcMed(S.times)), off: timeHidden, fn: tFn },
  ]
  const date = state.date
  const dateText = shouldShowTimerDate ? fmtDate(date.y, date.m, date.d, date._fmt) : '—'
  const bScore = blitzBest[blitzBk],
    sScore = suddenBest[suddenBk],
    saScore = suddenAmBest[suddenBk]
  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      {/* dimmed = Save Stats off = nothing is being recorded (whole strip, every value '—'); the
          timing trio you hid yourself renders BLANK while the round is going, from `off` in
          statsArr — an ended round shows its times and takes no taps at all (timeHidden/tFn
          above). See StatPanel. */}
      <StatPanel
        stats={statsArr}
        dimmed={!saveStats}
        onActivate={breakdownAvail ? () => setBreakdownOpen(true) : null}
        activateLabel="Show round breakdown"
      />
      {/* Mounted only while up — see the component header, and the twin site in modes/AoxMode. */}
      {breakdownShown && (
        <RunBreakdown
          onClose={() => setBreakdownOpen(false)}
          data={buildRunBreakdown(state)}
          fmtDate={fmtDate}
          title="Round breakdown"
        />
      )}
      {!perQ && <BlitzBestRow rec={bScore} newFlags={blitzBestNew[blitzBk]} />}
      {perQ && allowMistakes && <BlitzBestRow rec={saScore} newFlags={suddenAmBestNew[suddenBk]} />}
      {perQ && !allowMistakes && (
        <div className="mt-3 text-xs text-(--tx-300-60)">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[125px]">
              Best Score: {sScore?.score ?? '—'}
              {suddenBestNew[suddenBk] && <NewBestStar />}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={toggleAllowMistakes}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border ${allowMistakes ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${active || timerDone ? ' opacity-60 pointer-events-none' : ''}`}
        >
          Allow Mistakes
        </button>
        <button
          type="button"
          onClick={togglePerQ}
          className={`flex-1 px-2 py-1 rounded-xl text-xs font-medium border btn-solid border-transparent ${active || timerDone ? ' opacity-60 pointer-events-none' : ''}`}
        >
          {perQ ? 'Per Question' : 'Per Round'}
        </button>
      </div>
      <div className="mt-3">
        {!perQ ? (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="10"
              max="300"
              step="5"
              value={blitzSec}
              onChange={(e) => {
                const v = +e.target.value
                setBlitzSec(v)
                if (!active) {
                  setBlitzRemain(v)
                  blitzRemainRef.current = v
                  if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(v)
                  if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
              disabled={active || timerDone}
              style={
                {
                  '--rng-fill': Math.round(((blitzSec - 10) / 290) * 100) + '%',
                } as React.CSSProperties
              }
              className="flex-1 disabled:opacity-40"
            />
            <SliderValueEditor
              value={blitzSec}
              min={10}
              max={300}
              snap={5}
              disabled={active || timerDone}
              inputMode="numeric"
              label="Blitz round timer"
              format={fmtBlitzT}
              toText={String}
              widest={SLIDER_READOUT_WIDEST}
              onCommit={(v) => {
                setBlitzSec(v)
                if (!active) {
                  setBlitzRemain(v)
                  blitzRemainRef.current = v
                  if (blitzTimeRef.current) blitzTimeRef.current.textContent = fmtBlitzT(v)
                  if (blitzBarRef.current) blitzBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="1"
              max="30"
              step="0.5"
              value={qSec}
              onChange={(e) => {
                const v = +e.target.value
                setQSec(v)
                if (!active) {
                  setQRemain(v)
                  if (suddenTimeRef.current) suddenTimeRef.current.textContent = v + 's'
                  if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
              disabled={active || timerDone}
              style={
                { '--rng-fill': Math.round(((qSec - 1) / 29) * 100) + '%' } as React.CSSProperties
              }
              className="flex-1 disabled:opacity-40"
            />
            <SliderValueEditor
              value={qSec}
              min={1}
              max={30}
              snap={0.5}
              disabled={active || timerDone}
              inputMode="decimal"
              label="Blitz question timer"
              format={(v) => v + 's'}
              toText={String}
              widest={SLIDER_READOUT_WIDEST}
              onCommit={(v) => {
                setQSec(v)
                if (!active) {
                  setQRemain(v)
                  if (suddenTimeRef.current) suddenTimeRef.current.textContent = v + 's'
                  if (suddenBarRef.current) suddenBarRef.current.style.transform = 'scaleX(1)'
                }
              }}
            />
          </div>
        )}
      </div>
      <div className="mt-5">
        {!perQ && (
          <div className="mb-3">
            <div className="text-center text-xs tabular-nums text-(--tx-200-80) mb-1">
              <span ref={blitzTimeRef}>{fmtBlitzT(blitzSec)}</span>
            </div>
            <div className="bar">
              <span ref={blitzBarRef} style={{ width: '100%' }}></span>
            </div>
          </div>
        )}
        {perQ && (
          <div className="mb-3">
            <div className="text-center text-xs tabular-nums text-(--tx-200-80) mb-1">
              <span ref={suddenTimeRef}>{qSec}s</span>
            </div>
            <div className="bar">
              <span ref={suddenBarRef} style={{ width: '100%' }}></span>
            </div>
          </div>
        )}
        <div className="mt-4 rounded-2xl panel p-4">
          <div className="text-center relative">
            <CardNumber state={state} show={state.backDepth > 0} />
            <div className="text-3xl font-bold">{dateText}</div>
          </div>
          <WeekdayAnswer
            key={state.gridEpoch}
            inputStyle={inputStyle}
            dotOrientation={dotOrientation}
            persistBtns={state.persistBtns}
            flash={flash}
            optionsDisabled={optionsDisabled}
            onPick={onAnswer}
          />
        </div>
        <div className="mt-4 rounded-2xl panel p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {active || timerDone ? (
              <button
                type="button"
                data-key="N"
                className={`col-span-1 ${RESET_BTN_CLASS}`}
                onClick={resetRound}
              >
                Reset
              </button>
            ) : (
              <button
                type="button"
                data-key="N"
                className="col-span-1 px-3 py-2 rounded-xl btn-solid text-sm font-medium"
                onClick={begin}
              >
                Begin
              </button>
            )}
            <div className="col-span-1 flex gap-1">
              <button
                type="button"
                data-key="ArrowLeft"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${timerBusy || state.stack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.back}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&lt;</span>
              </button>
              <button
                type="button"
                data-key="ArrowRight"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${timerBusy || state.forwardStack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.forward}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&gt;</span>
              </button>
            </div>
            <button
              type="button"
              data-key="R"
              className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled ? 'opacity-60 pointer-events-none' : ''}`}
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
          <MethodBreakdownSection
            date={shouldShowTimerDate ? date : null}
            open={state.calcOpen}
            onOpenChange={onShowCodes}
            className=""
            contentClassName="mt-2 rounded-2xl thin px-4 pt-[3px] pb-1.5"
            useJulian={state.backDepth > 0 ? (date?._jul ?? useJulian) : useJulian}
            displayedFormat={date?._fmt || dateFormat}
          />
        </div>
      </div>
    </div>
  )
}

export default BlitzMode
