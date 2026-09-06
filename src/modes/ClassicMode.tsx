// ClassicMode — the untimed weekday screen. Extracted verbatim from main.tsx (Q1 phase 1); it was
// already a module-level sibling of App taking everything through props, so nothing about its
// behaviour changes by living here.
import { useEffect } from 'react'
import type { ModeProps, GenDate, FmtDate } from './modeTypes.js'
import { useButtonFlash, useStatsHideToggles, engineFresh, useResetStatsArm } from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import { RESET_STATS_ARMED_CLASS, RESET_STATS_BTN_CLASS } from '../components/controlClasses.js'
import WeekdayAnswer from '../components/WeekdayAnswer.jsx'
import StatPanel from '../components/StatPanel.jsx'
import CardNumber from '../components/CardNumber.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import { useBackButton } from '../components/useBackButton.js'

// ============================================================
// ClassicMode — the Classic game mode, on the shared engine (mode-untangle Step 1c).
//
// Self-contained + always-mounted (display:none when inactive), exactly like AoxMode:
// it owns ALL of Classic's state via useGameEngine (the pure reducer) plus its own
// display toggles (timing/scoring hide, the timing-desync two-tap) and the transient
// button flash. App no longer renders Classic inline — it just mounts <ClassicMode/>
// and passes the settings down (like it does for AoxMode). This is the first mode
// carved out of App's fused rendering; Flash/Blitz/Deduction follow onto the same engine.
// ============================================================
function ClassicMode({
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
  onFreshChange,
}: ModeProps & { genDate: GenDate; fmtDate: FmtDate }) {
  const timingOff = useModePrefs((s) => s.classicTimingOff),
    setTimingOff = useModePrefs((s) => s.setClassicTimingOff) // persisted; timing hidden by default (feeds the engine)
  const scoringOff = useModePrefs((s) => s.classicScoringOff),
    setScoringOff = useModePrefs((s) => s.setClassicScoringOff) // persisted; scoring shown by default
  // Lifetime stats persist across reloads (Stage D1): hydrate from saved progress on mount,
  // then mirror every stats change back to the store (which caps the solve-times window).
  const eng = useGameEngine({
    label: 'classic',
    genDate,
    minY,
    maxY,
    useJulian,
    saveStats,
    timingOff,
    getInitialStats: () => useProgress.getState().stats.classic,
  })
  const { state, correct, overrideAvail } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode (Q1). Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/useBackButton.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const setModeStats = useProgress((s) => s.setModeStats)
  useEffect(() => {
    setModeStats('classic', state.stats)
  }, [state.stats, setModeStats])
  const { flash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse
  // Hideable stats chrome (show/hide toggles + two-tap "Enable and Reset Stats?" arm + the 6-box
  // stats strip), shared with Flash/Deduction via useStatsHideToggles.
  const { timingArmed, statsArr, armedSpan, armedBtnRef } = useStatsHideToggles({
    eng,
    saveStats,
    visible,
    timingOff,
    setTimingOff,
    scoringOff,
    setScoringOff,
  })
  const optionsDisabled = state.locked || state.calcOpen || state.calcPenaltyActive
  const revealDisabled =
    (state.locked && state.revealed) || state.calcOpen || state.calcPenaltyActive

  const onAnswer = (i: number) => {
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i })
    eng.answer(i)
  }
  // Override Path 3 (override-after-wrong) flashes green on the correct button, matching App.
  const onOverride = () => {
    if (state.countedWrong) setFlashWithTimeout({ type: 'good', idx: correct })
    eng.override()
  }

  // regenDecisionFor (App's popover effect, Classic slice): a format / leap / Jan-Feb /
  // Julian-chance / year-range change regens an UNANSWERED live date; a useJulian toggle
  // keeps it (live useJulian flows through to the answer + codes). REGEN_DATE no-ops on a
  // burned or browsed date, so we just fire it on the relevant changes.
  // Defer the live-date regen to the ⚙ popover CLOSE (Q2) — batched, no per-keystroke timer churn.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [randomFormat, dateFormat, leapChance, janFebChance, julianChance, minY, maxY],
    () => eng.regenDate(),
  )
  // Freshness — engine state at launch default + Classic's own toggle/flash fields. Reported up
  // via onFreshChange so App's isFullyReset (Full Reset dim/lock) accounts for Classic.
  const classicIsFresh =
    engineFresh(state) &&
    timingOff === true &&
    scoringOff === false &&
    timingArmed === false &&
    flash === null
  const { resetArmed, onResetTap, resetBtnRef } = useResetStatsArm(
    eng.resetStats,
    !engineFresh(state),
    visible,
  ) // Q2 two-tap confirm
  useEffect(() => {
    onFreshChange?.(classicIsFresh)
  }, [classicIsFresh, onFreshChange])
  const date = state.date
  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      {/* dimmed = Save Stats off = nothing is being recorded: the whole strip dims and every value
          reads '—'. A group you turned off yourself renders BLANK instead, from `off` inside
          statsArr — two facts, two flags. See the three-signal note in components/StatPanel. */}
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
      <div className="mt-5">
        <div className="mt-4 rounded-2xl panel p-4">
          <div className="text-center relative">
            <CardNumber state={state} show={state.backDepth > 0} />
            <div className="text-3xl font-bold">{fmtDate(date.y, date.m, date.d, date._fmt)}</div>
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
            <button
              type="button"
              data-key="N"
              className="col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium"
              onClick={() => eng.doNew()}
            >
              New
            </button>
            <div className="col-span-1 flex gap-1">
              <button
                type="button"
                data-key="ArrowLeft"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.stack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.back}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&lt;</span>
              </button>
              <button
                type="button"
                data-key="ArrowRight"
                className={`flex-1 px-1 py-2 rounded-xl border surface-button text-sm font-medium flex items-center justify-center ${state.forwardStack.length === 0 ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={eng.forward}
              >
                <span style={{ position: 'relative', top: '-1.5px' }}>&gt;</span>
              </button>
            </div>
            <button
              type="button"
              data-key="R"
              className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${revealDisabled ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={eng.reveal}
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
            date={date}
            open={state.calcOpen}
            onOpenChange={(open) => eng.showCodes(open)}
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

export default ClassicMode
