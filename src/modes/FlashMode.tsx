// FlashMode — the brief-reveal timed weekday screen. Extracted verbatim from main.tsx (Q1 phase 1);
// it was already a module-level sibling of App taking everything through props, so nothing about its
// behaviour changes by living here.
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ModeProps, GenDate, FmtDate } from './modeTypes.js'
import { useButtonFlash, useStatsHideToggles, engineFresh, useResetStatsArm } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import {
  RESET_BTN_CLASS,
  RESET_STATS_ARMED_CLASS,
  RESET_STATS_BTN_CLASS,
} from '../components/controlClasses.js'
import { fmtFlashT, SLIDER_READOUT_WIDEST } from '../lib/modeFormat.js'
import { useUserDefaults, effectivePrefDefaults } from '../store/userDefaults.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import CardNumber from '../components/CardNumber.jsx'
import SliderValueEditor from '../components/SliderValueEditor.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import { useBackButton } from '../components/useBackButton.js'

// ============================================================
// FlashMode — the Flash game mode on the shared engine (mode-untangle Step 2).
//
// Self-contained + always-mounted like ClassicMode/AoxMode. Reuses useGameEngine for ALL
// engine behavior (answer/override/stats/history); adds only Flash's brief-reveal TIMER:
// Begin advances to a fresh date + reveals it for flashMs, then it hides ("…") and you
// answer from memory; answering, Reveal, or Override ends the flash. The timer (setTimeout
// + rAF + the bar) is component-owned side-effect — the pure reducer never sees it.
// (Chrome — stats strip, toggles, freshness, settings-regen — currently mirrors
// ClassicMode; that duplication gets factored into a shared shell in Step 6, once all
// modes' variations are known.)
// ============================================================
function FlashMode({
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
  const [active, setActive] = useState(false)
  const [flashPhase, setFlashPhase] = useState('dash') // dash (idle) | show (revealing) | hide ("…")
  const [showTimerDate, setShowTimerDate] = useState(false) // keep the date visible after Reveal
  const flashMs = useModePrefs((s) => s.flashMs),
    setFlashMs = useModePrefs((s) => s.setFlashMs) // persisted (mode-prefs store)
  // Idle countdown label starts at the persisted speed, not a hardcoded 500 (which showed a
  // stale "0.5s" after a reload with a saved speed, and would break flashIsFresh below when a
  // Full Reset remount lands on a personal default speed).
  const [flashRemainMs, setFlashRemainMs] = useState(flashMs)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashDeadlineRef = useRef<number | null>(null)
  const flashBarRef = useRef<HTMLSpanElement | null>(null)
  const timingOff = useModePrefs((s) => s.flashTimingOff),
    setTimingOff = useModePrefs((s) => s.setFlashTimingOff) // persisted; timing shown by default (feeds the engine)
  const scoringOff = useModePrefs((s) => s.flashScoringOff),
    setScoringOff = useModePrefs((s) => s.setFlashScoringOff) // persisted; scoring shown by default
  // Lifetime stats persist across reloads (Stage D1): hydrate on mount, mirror changes to the store.
  const eng = useGameEngine({
    label: 'flash',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats,
    timingOff,
    getInitialStats: () => useProgress.getState().stats.flash,
  })
  const { state, correct, overrideAvail } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode (Q1). Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/useBackButton.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const setModeStats = useProgress((s) => s.setModeStats)
  useEffect(() => {
    setModeStats('flash', state.stats)
  }, [state.stats, setModeStats])
  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse

  const resetFlashBar = () => {
    if (flashBarRef.current) {
      flashBarRef.current.style.transition = 'none'
      flashBarRef.current.style.transform = 'scaleX(1)'
    }
  }
  const startFlashBar = (ms: number) => {
    requestAnimationFrame(() => {
      if (!flashBarRef.current) return
      const s = flashBarRef.current
      s.style.transition = 'none'
      s.style.transform = 'scaleX(1)'
      s.getBoundingClientRect()
      s.style.transition = `transform ${ms}ms linear`
      s.style.transform = 'scaleX(0)'
    })
  }
  const endFlashPhase = useCallback(() => {
    setFlashPhase('hide')
    flashDeadlineRef.current = null
    setFlashRemainMs(0)
    flashTimerRef.current = null
  }, [])
  const stopFlash = () => {
    clearTimeout(flashTimerRef.current ?? undefined)
    flashTimerRef.current = null
    setFlashPhase('dash')
    flashDeadlineRef.current = null
    setFlashRemainMs(flashMs)
    resetFlashBar()
  }
  // Keep the idle countdown label + bar in step with a store-driven flashMs change that BYPASSES
  // the slider's onChange sync — Reset Settings restoring the saved/factory Flash speed while Flash
  // sits idle (round-6 Q7). flashRemainMs is a local mirror seeded from flashMs; a live flash owns it via
  // the rAF countdown (and stopFlash re-seeds it on teardown), so this only re-seeds at rest. Keyed
  // on flashMs alone — the slider path already synced, so a re-sync there is an idempotent no-op.
  //
  // ⚠ set-state-in-effect is disabled here, and the disable is NEW at extraction time — it is not a
  // behaviour change. In main.tsx this effect was one dense line and the React Compiler never
  // analyzed the component, so the rule was silent (verified: linting HEAD's main.tsx reports the
  // rule ZERO times). Extracting the component into a clean module makes it analyzable, and the
  // rule fires for the first time on code that is byte-identical. Q1 phase 1 is a VERBATIM MOVE, so
  // the pattern is preserved exactly and suppressed with this note rather than restructured —
  // restructuring live timer logic inside a "pure move" is precisely what Q1 forbids. The pattern
  // itself is a defensible external-sync (mirroring a store-driven settings change into a local
  // countdown mirror while at rest), which is why MethodBreakdown.tsx carries the same disable.
  // ▶ The newly-surfaced findings from all five mode extractions are queued for review as their
  // own item — do NOT let this comment become the permanent answer.
  useEffect(() => {
    if (!active && flashPhase === 'dash') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlashRemainMs(flashMs)
      resetFlashBar()
    }
  }, [flashMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // freezeFlash — Show-Codes-during-the-flash teardown. Unlike stopFlash (which RESETS the
  // bar to 100% + number to full for the idle state), this FREEZES the countdown in place:
  // it cancels the auto-hide timer, stops the rAF number countdown (setActive(false)), and
  // pins the bar at its current rendered scale so the bar and number freeze TOGETHER. The
  // date stays shown. (The original applyCalcPenalty froze the number but missed the bar's
  // CSS transition — bug #4. This completes the freeze.)
  const freezeFlash = () => {
    clearTimeout(flashTimerRef.current ?? undefined)
    flashTimerRef.current = null
    flashDeadlineRef.current = null
    if (flashBarRef.current) {
      const t = getComputedStyle(flashBarRef.current).transform
      flashBarRef.current.style.transition = 'none'
      flashBarRef.current.style.transform = t
    }
    setActive(false)
    setShowTimerDate(true)
    setFlashPhase('dash')
  }

  // rAF countdown of the reveal-time label while showing (cosmetic; matches App's loop).
  // Gated off while the rotate-back overlay pauses the clock (Q11) so the frozen number
  // can't tick behind the overlay.
  useEffect(() => {
    if (!(active && flashPhase === 'show') || clockPaused) return
    let raf = 0
    const loop = () => {
      const now = performance.now()
      if (flashDeadlineRef.current) setFlashRemainMs(Math.max(0, flashDeadlineRef.current - now))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, flashPhase, clockPaused])

  // Rotate-overlay clock freeze (Q11): a LIVE flash (phase "show", deadline armed) must not
  // burn its reveal window behind the rotate-back overlay. Pause = freezeFlash's bar-pinning
  // trick WITHOUT the teardown: cancel the auto-hide timer, remember the remaining ms, pin the
  // bar mid-sweep (the rAF number loop above is gated off while paused, so bar + number freeze
  // together). Rotate-back (the cleanup) re-arms deadline/timer for exactly the remaining time
  // and resumes the bar sweep from its pinned scale — the same rAF-then-transition shape as
  // startFlashBar, from the pinned position instead of scaleX(1). Every other state (idle,
  // hide, ended, frozen) has no armed deadline — nothing to pause; the remain null-guard makes
  // the resume a no-op if the flash was somehow torn down mid-pause. No interaction can reach
  // the mode while the overlay is up (fixed z-100 cover), so the refs can't shift under a pause.
  const flashPausedRemainRef = useRef<number | null>(null)
  useEffect(() => {
    if (!clockPaused || flashDeadlineRef.current == null) return
    flashPausedRemainRef.current = Math.max(0, flashDeadlineRef.current - performance.now())
    clearTimeout(flashTimerRef.current ?? undefined)
    flashTimerRef.current = null
    flashDeadlineRef.current = null
    const bar = flashBarRef.current // captured once: the node we pin IS the node we resume (and the cleanup must not re-read a ref)
    if (bar) {
      const t = getComputedStyle(bar).transform
      bar.style.transition = 'none'
      bar.style.transform = t
    }
    return () => {
      const rem = flashPausedRemainRef.current
      flashPausedRemainRef.current = null
      if (rem == null) return
      flashDeadlineRef.current = performance.now() + rem
      setFlashRemainMs(rem)
      flashTimerRef.current = setTimeout(endFlashPhase, Math.max(50, rem)) // same ≥50ms floor as begin()
      requestAnimationFrame(() => {
        if (!bar) return
        bar.getBoundingClientRect()
        bar.style.transition = `transform ${rem}ms linear`
        bar.style.transform = 'scaleX(0)'
      })
    }
  }, [clockPaused, endFlashPhase])

  const begin = () => {
    eng.doNew() // advance to a fresh date to reveal
    setActive(true)
    setShowTimerDate(false)
    setFlashPhase('show')
    clearTimeout(flashTimerRef.current ?? undefined)
    const now = performance.now()
    flashDeadlineRef.current = now + flashMs
    setFlashRemainMs(flashMs)
    flashTimerRef.current = setTimeout(endFlashPhase, Math.max(50, flashMs))
    startFlashBar(flashMs)
  }
  const onAnswer = (i: number) => {
    if (!active) return
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i })
    eng.answer(i)
    if (i === correct) {
      setActive(false)
      stopFlash()
    } // a correct answer ends the flash
  }
  // Reveal during a live flash FREEZES the countdown (bar + number) in place, exactly like
  // Show Codes — the date stays shown and the answer is revealed. Outside a live flash
  // (browsing history / idle) it keeps the plain reset-to-idle teardown.
  const onReveal = () => {
    eng.reveal()
    if (active) freezeFlash()
    else {
      setActive(false)
      setShowTimerDate(true)
      stopFlash()
    }
  }
  // Opening Show Codes mid-flash freezes the countdown (bar + number) and keeps the date
  // shown, then applies the codes penalty — bug #4. Closing it (or opening on a non-live
  // entry) is the normal toggle.
  const onShowCodes = (open: boolean) => {
    if (open && active) freezeFlash()
    eng.showCodes(open)
  }
  const onOverride = () => {
    const wasActive = active
    if (state.countedWrong) setFlashWithTimeout({ type: 'good', idx: correct })
    eng.override()
    if (wasActive) {
      setActive(false)
      stopFlash()
    }
  }
  const resetRound = () => {
    eng.resetRound()
    setActive(false)
    setShowTimerDate(false)
    stopFlash()
  } // primary "Reset" while live (= App arm)

  // Hideable stats chrome shared with Classic/Deduction. Flash supplies its flash-timer teardown:
  // afterTimingEnabled (re-enabling timing while a flash is live stops it + hides its date) and
  // onHide (leaving the mode stops a live flash). Classic/Deduction pass neither (no timer).
  const { timingArmed, statsArr, armedSpan, armedBtnRef } = useStatsHideToggles({
    eng,
    saveStats,
    visible,
    timingOff,
    setTimingOff,
    scoringOff,
    setScoringOff,
    afterTimingEnabled: () => {
      if (active) {
        setActive(false)
        stopFlash()
      }
      setShowTimerDate(false)
    },
    onHide: () => {
      if (active) {
        setActive(false)
        stopFlash()
      }
    },
  })

  // Defer the live-date regen to the ⚙ popover CLOSE (Q2) — batched, no per-keystroke timer churn.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [randomFormat, dateFormat, leapChance, janFebChance, julianChance, minY, maxY],
    () => eng.regenDate(),
  )

  // Freshness for App's isFullyReset (Flash owns its state now): engine fresh + Flash's own
  // fields. flashMs (and the idle countdown mirror) compare against the EFFECTIVE default —
  // the saved personal default when one exists (Q7, store/userDefaults).
  const defFlashMs = useUserDefaults((s) => effectivePrefDefaults(s.saved).flashMs)
  const flashIsFresh =
    engineFresh(state) &&
    timingOff === false &&
    scoringOff === false &&
    timingArmed === false &&
    flash === null &&
    active === false &&
    flashPhase === 'dash' &&
    showTimerDate === false &&
    flashMs === defFlashMs &&
    flashRemainMs === defFlashMs
  useEffect(() => {
    onFreshChange?.(flashIsFresh)
  }, [flashIsFresh, onFreshChange])

  const shouldShowTimerDate = active || showTimerDate
  const flashHiding = active && flashPhase === 'hide'
  // Browsing back reviews RESOLVED history — never a peek at the live (memory-game) question —
  // so the hidden-date gate below must not swallow it: the browsed date shows, and Reveal +
  // Show Codes work read-only on it, matching Classic. (The gate used to hide all three while
  // browsing — the grid's green/red marks rendered but the date itself read "—" with the
  // review tools dead while Override stayed ENABLED on the invisible question. An original-app
  // wart, contradicting How-to-Play's "Back — the answer is shown". C2 fix; Back is disabled
  // while a flash is active, so inBack never overlaps a live flash.)
  const inBack = state.backDepth > 0
  const optionsDisabled = !active || state.locked || state.calcOpen || state.calcPenaltyActive
  // Reveal is available whenever a date is on screen — including DURING the flash (matching
  // Show Codes, which keys off shouldShowTimerDate). Was wrongly locked in the "show" phase
  // via `!showTimerDate&&!flashHiding`; `!shouldShowTimerDate` enables it — bug #5.
  const revealDisabled =
    (state.locked && state.revealed) ||
    state.calcOpen ||
    state.calcPenaltyActive ||
    (!shouldShowTimerDate && !inBack)
  const onResetStats = () => {
    eng.resetStats()
    if (active) {
      setActive(false)
      stopFlash()
    }
    setShowTimerDate(false)
  }
  const { resetArmed, onResetTap, resetBtnRef } = useResetStatsArm(
    onResetStats,
    !engineFresh(state),
    visible,
  ) // Q2 two-tap confirm (Flash reset also tears the live flash down)
  const date = state.date
  const dateText =
    shouldShowTimerDate || inBack
      ? flashHiding
        ? '…'
        : fmtDate(date.y, date.m, date.d, date._fmt)
      : '—'
  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      {/* dimmed = Save Stats off = nothing is being recorded (whole strip, every value '—'); a group
          you turned off yourself renders BLANK, from `off` inside statsArr. See StatPanel. */}
      <StatPanel
        stats={statsArr}
        dimmed={!saveStats}
        armedSpan={armedSpan}
        armedBtnRef={armedBtnRef}
      />
      <div className="mt-3">
        <button
          type="button"
          data-key="S"
          ref={resetBtnRef}
          className={resetArmed ? RESET_STATS_ARMED_CLASS : RESET_STATS_BTN_CLASS}
          onClick={onResetTap}
        >
          {resetArmed ? 'Reset Stats?' : 'Reset Stats'}
        </button>
      </div>
      {/* Slider readout width (six of the SEVEN SliderValueEditor sites — 3 mode-screen + 3
              timer rows in the Save Defaults popup; the seventh, that popup's AoX run-length row,
              struts its own "1000"): each editor mounts the shared SLIDER_READOUT_WIDEST string as
              an always-on invisible strut, the only in-flow child of its readout cell, so the cell
              locks to the widest POSSIBLE readout AS MEASURED IN THE DEVICE'S OWN FONT — Round-4's
              hand-measured arbitrary width was Segoe UI's 3.18em, but iOS's SF Pro renders wider, and
              the overflow wrapped at the space. Widest string = fmtBlitzT(175) "2m 55s": only the
              Blitz round timer (10–300s, step 5) ever formats "Xm YZs", and any two-digit
              remainder out-measures the 300 cap's "5m 0s" (one more digit, tabular-nums);
              fmtFlashT tops out at "5.0s", the per-question timer at "29.5s". */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="100"
            max="5000"
            step="100"
            value={flashMs}
            onChange={(e) => {
              const v = +e.target.value
              setFlashMs(v)
              if (!active) {
                setFlashRemainMs(v)
                resetFlashBar()
              }
            }}
            disabled={active}
            style={
              {
                '--rng-fill': Math.round(((flashMs - 100) / 4900) * 100) + '%',
              } as React.CSSProperties
            }
            className="flex-1 disabled:opacity-40"
          />
          <SliderValueEditor
            value={flashMs}
            min={100}
            max={5000}
            snap={100}
            disabled={active}
            inputMode="decimal"
            label="Flash speed"
            format={fmtFlashT}
            toText={(v) => String(v / 1000)}
            fromText={(n) => n * 1000}
            widest={SLIDER_READOUT_WIDEST}
            onCommit={(v) => {
              setFlashMs(v)
              if (!active) {
                setFlashRemainMs(v)
                resetFlashBar()
              }
            }}
          />
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-3">
          <div className="text-center text-xs tabular-nums text-(--tx-200-80) mb-1">
            {fmtFlashT(flashRemainMs)}
          </div>
          <div className="bar">
            <span ref={flashBarRef} style={{ width: '100%' }}></span>
          </div>
        </div>
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
            {active ? (
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
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${active || state.stack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.back}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&lt;</span>
              </button>
              <button
                type="button"
                data-key="ArrowRight"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${active || state.forwardStack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
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
            date={shouldShowTimerDate || inBack ? date : null}
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

export default FlashMode
