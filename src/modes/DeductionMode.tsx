// DeductionMode — the puzzle screen (Day / Month / Year sub-modes, each its own engine silo).
// Extracted verbatim from main.tsx (Q1 phase 1); it was already a module-level sibling of App
// taking everything through props, so nothing about its behaviour changes by living here.
import { useEffect, useState } from 'react'
import type { ModeProps } from './modeTypes.js'
import {
  useButtonFlash,
  useStatsHideToggles,
  useChangeEffect,
  engineFresh,
  useResetStatsArm,
} from './modeHooks.js'
import { useSettingsCloseEffect } from '../components/useSettingsCloseEffect.js'
import {
  ANSWER_GRID_GAP,
  BASE_BTN,
  buttonStateClass,
  RESET_STATS_ARMED_CLASS,
  RESET_STATS_BTN_CLASS,
} from '../components/controlClasses.js'
import { YEAR_OPTION_DEFAULT, yearGridLayout, makeDedPuzzle } from '../lib/dedPuzzle.js'
import { answerGridHitPad, colSpanClass } from '../lib/answerGrid.js'
import { isJulianDate, wday, wdayJulian } from '../lib/calendar.js'
import { DAY, fmtPartial, fmtYear } from '../lib/format.js'
import type { FormatId, DatePart } from '../lib/format.js'
import { rollFormat, isTouch } from '../lib/modeFormat.js'
import type { DedPuzzle } from '../engine/gameReducer.js'
import StatPanel from '../components/StatPanel.jsx'
import { MethodBreakdownSection } from '../components/MethodBreakdown.jsx'
import { useModePrefs } from '../store/modePrefs.js'
import { useProgress } from '../store/progress.js'
import { useGameEngine } from '../engine/useGameEngine.js'
import { useBackButton } from '../components/useBackButton.js'

// ============================================================
// DeductionMode — the Deduction game mode on the shared engine (mode-untangle Step 4).
//
// Self-contained + always-mounted like ClassicMode/FlashMode/BlitzMode. Deduction has THREE
// independent sub-modes (Day/Month/Year), each with its OWN stats + history silo — modeled as
// THREE useGameEngine instances; `dedType` selects which is shown while the other two persist
// (exactly the per-silo behavior App had via statsByMode['deduction-*'] + dedStack[type]).
// The "correct" answer is a puzzle OPTION INDEX, not a weekday — the shared reducer handles
// that uniformly via correctIndexOf (puzzle entries carry `type`). Puzzles come from the pure
// makeDedPuzzle (module scope), passed as each engine's genDate. Chrome (stats strip /
// scoring+timing toggles / freshness / settings-regen) mirrors ClassicMode and gets folded
// into a shared shell in Step 6, once all modes' variations are known.
// ============================================================
function DeductionMode({
  visible,
  minY,
  maxY,
  useJulian,
  saveStats,
  dateFormat,
  randomFormat,
  leapChance,
  janFebChance,
  julianChance,
  settingsOpen,
  onFreshChange,
}: ModeProps) {
  const dedType = useModePrefs((s) => s.dedType),
    setDedType = useModePrefs((s) => s.setDedType) // persisted (mode-prefs store)
  const [abCrossOnly, setAbCrossOnly] = useState(false)
  const [julCrossOnly, setJulCrossOnly] = useState(false)
  const [monthOnly1582, setMonthOnly1582] = useState(false)
  const timingOff = useModePrefs((s) => s.dedTimingOff),
    setTimingOff = useModePrefs((s) => s.setDedTimingOff) // persisted; timing hidden by default (feeds all three engines)
  const scoringOff = useModePrefs((s) => s.dedScoringOff),
    setScoringOff = useModePrefs((s) => s.setDedScoringOff) // persisted; scoring shown by default

  // Per-sub-mode puzzle generators — close over the latest settings + toggles each render.
  const opts = {
    useJulian,
    leapChance,
    janFebChance,
    randomFormat,
    dateFormat,
    abCrossOnly,
    julCrossOnly,
    monthOnly1582,
  }
  // Year init can fail when the range can't build a distinct-window puzzle (yearSubPossible
  // false). Supply a minimal valid fallback so the (hidden, unreachable) Year engine stays
  // well-formed — it's never displayed in that state (the Year button is disabled).
  const yearFallback = (lo: number): DedPuzzle => {
    const y = Math.max(1, lo)
    const w = useJulian && isJulianDate(y, 1, 1) ? wdayJulian(y, 1, 1) : wday(y, 1, 1)
    return {
      type: 'year',
      y,
      m: 1,
      d: 1,
      w,
      options: [y],
      _fmt: randomFormat ? rollFormat() : dateFormat,
      _jul: useJulian,
      _abx: abCrossOnly,
      _julx: julCrossOnly,
    }
  }
  const genDay = (lo: number, hi: number): DedPuzzle => makeDedPuzzle('day', lo, hi, opts)!
  const genMonth = (lo: number, hi: number): DedPuzzle => makeDedPuzzle('month', lo, hi, opts)!
  const genYear = (lo: number, hi: number): DedPuzzle =>
    makeDedPuzzle('year', lo, hi, opts) || yearFallback(lo)

  // Lifetime stats persist per sub-mode (Stage D1): each silo hydrates from its own saved slice
  // on mount and mirrors changes back to the store.
  const dayEng = useGameEngine({
    label: 'dedDay',
    genDate: genDay,
    minY,
    maxY,
    useJulian,
    saveStats,
    timingOff,
    getInitialStats: () => useProgress.getState().stats.dedDay,
  })
  const monthEng = useGameEngine({
    label: 'dedMonth',
    genDate: genMonth,
    minY,
    maxY,
    useJulian,
    saveStats,
    timingOff,
    getInitialStats: () => useProgress.getState().stats.dedMonth,
  })
  const yearEng = useGameEngine({
    label: 'dedYear',
    genDate: genYear,
    minY,
    maxY,
    useJulian,
    saveStats,
    timingOff,
    getInitialStats: () => useProgress.getState().stats.dedYear,
  })
  const eng = dedType === 'month' ? monthEng : dedType === 'year' ? yearEng : dayEng
  const { state, correct, overrideAvail } = eng
  // Android Back closes the Show-Codes panel of the ACTIVE mode (Q1). Gated on `visible` so only
  // the on-screen mode registers (the others are mounted-but-hidden); `eng` is the active engine
  // (for Deduction it's the current silo), so this is one line per mode. See components/useBackButton.
  useBackButton(visible && state.calcOpen, () => eng.showCodes(false), 'codes')
  const setModeStats = useProgress((s) => s.setModeStats)
  useEffect(() => {
    setModeStats('dedDay', dayEng.state.stats)
  }, [dayEng.state.stats, setModeStats])
  useEffect(() => {
    setModeStats('dedMonth', monthEng.state.stats)
  }, [monthEng.state.stats, setModeStats])
  useEffect(() => {
    setModeStats('dedYear', yearEng.state.stats)
  }, [yearEng.state.stats, setModeStats])
  // One flash for the active grid (only one sub-mode visible at a time). setFlash is cleared
  // directly on sub-type switch (changeDedType), so it's destructured alongside the pulse setter.
  const { flash, setFlash, setFlashWithTimeout } = useButtonFlash() // green/red answer pulse
  // Hideable stats chrome shared with Classic/Flash — operates on the ACTIVE sub-mode's engine.
  const { timingArmed, statsArr, armedSpan, armedBtnRef } = useStatsHideToggles({
    eng,
    saveStats,
    visible,
    timingOff,
    setTimingOff,
    scoringOff,
    setScoringOff,
  })

  const fmtDatePartial = (
    y: number,
    m: number,
    d: number,
    storedFmt: FormatId | undefined,
    missing: DatePart,
  ) => fmtPartial(y, m, d, storedFmt || dateFormat, missing)
  // Day's column span for one option: a lone trailing option on the 3-column grid takes the whole
  // last row instead of hanging off to the left. Returns the SPAN, not the class — the class comes
  // from answerGrid's colSpanClass and the same number feeds the hit-padding maths (sub-group 1B).
  const centerLastSpan = (index: number, total: number) =>
    total > 0 && index === total - 1 && total % 3 === 1 ? 3 : 1
  // Can the range support a Year puzzle? Since the Q1 phase-1 split this screen is the only copy
  // in src — App's twin moved here with it. tests/dateGen.dom keeps a deliberately INDEPENDENT
  // model of this rule to drive its fuzz (the project's standing oracle rule: a reference model
  // that shares code with the implementation cannot disagree with it, and disagreement is the
  // whole point). Change the rule here and that model has to be changed to match, on purpose.
  const yearSubPossible = (() => {
    const lo = Math.max(1, minY),
      hi = maxY
    if (hi - lo + 1 >= 5) return true
    if (!useJulian) return false
    const has1581 = lo <= 1581 && hi >= 1581,
      has1582 = lo <= 1582 && hi >= 1582,
      has1583 = lo <= 1583 && hi >= 1583
    return (has1582 && has1583) || (has1581 && has1582)
  })()

  const optionsDisabled = state.locked || state.calcOpen || state.calcPenaltyActive
  const revealDisabled =
    (state.locked && state.revealed) || state.calcOpen || state.calcPenaltyActive
  // Deduction's answer buttons sit ONE text tier below the weekday grids (Q4 round-8): its
  // options are years / month names / day numbers, and up to six of them share a row, so
  // text-sm is the size that fits. Derived once here rather than appended per grid — Day and
  // Year used to append it and Month did not, which left Month's answers 4.2px taller (the
  // text-base/text-sm line-height gap) than the other two sub-modes, and made the two that
  // were right depend on which of two stacked text sizes CSS happened to emit last.
  const baseBtn = BASE_BTN.replace('text-base', 'text-sm')
  const idleBtn = 'surface-button'

  const changeDedType = (t: string) => {
    if (t === dedType) return
    setFlash(null)
    setDedType(t)
  } // each silo persists; just swap which shows
  const onAnswer = (i: number) => {
    setFlashWithTimeout({ type: i === correct ? 'good' : 'bad', idx: i, n: date.options.length })
    eng.answer(i)
  }
  // Override-after-wrong flashes green on the correct option, matching App's dedFlash branch.
  const onOverride = () => {
    if (state.countedWrong)
      setFlashWithTimeout({ type: 'good', idx: correct, n: date.options.length })
    eng.override()
  }

  // Auto-switch out of Year when a range/Julian change makes it unbuildable (mirrors App).
  useEffect(() => {
    if (dedType === 'year' && !yearSubPossible) setDedType('day')
  }, [dedType, yearSubPossible, setDedType]) // setDedType is a stable store setter
  // Auto-clear toggles when their prerequisites break (mirrors App's popover effect).
  //
  // ⚠ Both effects below disable set-state-in-effect, and both disables are NEW at extraction
  // time rather than behaviour changes — same cause as FlashMode's: inside main.tsx's dense
  // legacy style the React Compiler never analyzed this component, so the rule was silent
  // (verified: linting HEAD's main.tsx reported it ZERO times). A clean module makes the
  // component analyzable and the rule fires on byte-identical code. Q1 phase 1 is a VERBATIM
  // MOVE, so the pattern is preserved and annotated rather than restructured.
  // These two are the "a setting changed and made this sub-option impossible, so turn it off"
  // effects — genuine external-sync against the settings store, mirroring what App itself does
  // in its popover effect. ▶ Reviewed properly as its own queued item; do not let this comment
  // become the permanent answer.
  useEffect(() => {
    if (!useJulian) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (julCrossOnly) setJulCrossOnly(false)
      if (monthOnly1582) setMonthOnly1582(false)
    }
  }, [useJulian, julCrossOnly, monthOnly1582])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (julCrossOnly && (1581 < minY || 1583 > maxY)) setJulCrossOnly(false)
    if (monthOnly1582 && (1582 < minY || 1582 > maxY)) setMonthOnly1582(false)
    if (abCrossOnly && Math.floor(Math.max(1, minY) / 100) === Math.floor(maxY / 100))
      setAbCrossOnly(false)
  }, [minY, maxY, abCrossOnly, julCrossOnly, monthOnly1582])

  // Settings-change regen: regen ALL three engines' live puzzle (each no-ops on a burned or
  // browsed date), matching App's "regen the current + cleanse FRESH non-current" on a
  // format / random-format / leap / Jan-Feb / Julian-chance / range / calendar change.
  // Defer the global-settings regen to the ⚙ popover CLOSE (Q2). The cross-toggles below stay
  // immediate — they're mode-LOCAL (toggled outside the popover), so they'd never see a close transition.
  useSettingsCloseEffect(
    settingsOpen ?? false,
    [randomFormat, dateFormat, leapChance, janFebChance, julianChance, minY, maxY, useJulian],
    () => {
      dayEng.regenDate()
      monthEng.regenDate()
      yearEng.regenDate()
    },
  )
  // Toggle-change regen: a relevant Deduction toggle regens the ACTIVE engine's puzzle (the
  // toggles only render in their own sub-mode, so the active engine is always the right one).
  useChangeEffect([abCrossOnly, julCrossOnly, monthOnly1582], () => eng.regenDate())

  // Freshness — all three silos' engine state fresh + Deduction's toggles/UI at launch default
  // (dates are random, so excluded). Reported up so App's isFullyReset accounts for Deduction.
  const deductionIsFresh =
    engineFresh(dayEng.state) &&
    engineFresh(monthEng.state) &&
    engineFresh(yearEng.state) &&
    dedType === 'day' &&
    abCrossOnly === false &&
    julCrossOnly === false &&
    monthOnly1582 === false &&
    timingOff === true &&
    scoringOff === false &&
    timingArmed === false &&
    flash === null
  const { resetArmed, onResetTap, resetBtnRef } = useResetStatsArm(
    eng.resetStats,
    !engineFresh(state),
    visible,
  ) // Q2 two-tap confirm (resets the ACTIVE sub-type's silo)
  useEffect(() => {
    onFreshChange?.(deductionIsFresh)
  }, [deductionIsFresh, onFreshChange])
  const date = state.date as DedPuzzle
  // Flash-validity rule (Q13, the general form): a flash only renders on a grid with the
  // button count it was born in. Advancing on a correct (or an Override credit) can CHANGE
  // the layout — Year 2↔5 under both crosses, Day 7↔4 across Oct 1582 — and the carried
  // pulse would repaint on an unrelated button; deriving per commit suppresses it in the
  // SAME render the new layout appears (no timers, no race — the pending 550ms clear needs
  // nothing, setFlashWithTimeout already swaps it on the next answer). Same-count advances
  // keep the pulse: the designed feedback, as in the fixed 7-grid weekday modes.
  // deductionIsFresh above reads the RAW flash (a suppressed flash still owns a live timer).
  const gridFlash = flash && flash.n === date?.options.length ? flash : null
  // Codes-panel target mirrors App's deduction calcTarget: just the date fields (so
  // displayedFormat falls to the current dateFormat) + the puzzle's _jul snapshot.
  const calcTarget: { y: number; m: number; d: number; _jul?: boolean; _fmt?: FormatId } | null =
    date ? { y: date.y, m: date.m, d: date.d, _jul: date._jul } : null
  // cellDates for the Month 1582 codes panel (answer box groups months from both calendars).
  let cellDates = null
  if (date && date.type === 'month' && date.y === 1582 && date.boxes) {
    const box = correct >= 0 ? date.boxes[correct] : null
    if (box && Array.isArray(box.months) && box.months.length >= 2)
      cellDates = box.months.map((m) => ({ y: date.y, m, d: date.d }))
  }
  // Toggle enable conditions (mirror App's render gating).
  const abPossible = Math.floor(Math.max(1, minY) / 100) !== Math.floor(maxY / 100)
  const has1581 = 1581 >= minY && 1581 <= maxY,
    has1582 = 1582 >= minY && 1582 <= maxY,
    has1583 = 1583 >= minY && 1583 <= maxY
  const julPossible = useJulian && has1582 && (has1581 || has1583)
  const m1582Possible = useJulian && 1582 >= minY && 1582 <= maxY

  // THE CURRENT PUZZLE'S ANSWER-GRID SHAPE, AS NUMBERS (sub-group 1B). Columns, and one column
  // span per option — the single decision that the col-span class each button wears AND the hit
  // padding each one claims are both read off (lib/answerGrid). Unlike the weekday grid's fixed
  // 7-over-2, Deduction's shape moves with the sub-mode and with the PUZZLE (Year 2/3/5 options
  // over 2/3/6 columns, Day 7 or the Oct-1582 4), so it is derived per render from `date` rather
  // than once at module load. `yearLayout` is the same pure call the Year branch makes for its
  // grid-cols class; asking it twice for one n is free and keeps that branch reading normally.
  const yearLayout = date && date.type === 'year' ? yearGridLayout(date.options.length) : null
  const gridCols = yearLayout ? yearLayout.cols : date && date.type === 'day' ? 3 : 2
  const optionSpans = date
    ? date.options.map((_, i) =>
        yearLayout
          ? yearLayout.spanFor(i)
          : date.type === 'day'
            ? centerLastSpan(i, date.options.length)
            : i === date.options.length - 1
              ? 2 // Month's odd seventh box takes a full-width last row, as the weekday grid's Saturday does
              : 1,
      )
    : []
  const hitPad = answerGridHitPad(gridCols, optionSpans)

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
      <div className="mt-5">
        {/* Day/Month/Year trio pinned to exact page center (Q10): minmax(0,1fr) side tracks.
                Bare 1fr means minmax(auto,1fr) — on narrow screens an occupied side's min-w-20
                toggle can refuse to shrink below its floor, so that track outgrows the empty one
                and shoves the trio ~5px off center (Month/Year). A 0 minimum keeps the two side
                tracks always exactly equal; a too-wide toggle just bleeds into the page gutter. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
          <div className="flex justify-start">
            {dedType === 'year' &&
              (() => {
                const disabled = !abPossible
                const active = abCrossOnly && !disabled
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      setAbCrossOnly((v) => !v)
                    }}
                    className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${disabled ? ' opacity-60 pointer-events-none' : ''}`}
                  >
                    <i>ab</i> Cross
                  </button>
                )
              })()}
          </div>
          <div className="flex gap-2 items-center">
            {['day', 'month', 'year'].map((t) => {
              const disabled = t === 'year' && !yearSubPossible
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (disabled) return
                    changeDedType(t)
                  }}
                  className={`px-2 py-1.5 rounded-xl text-sm font-medium border min-w-16 ${dedType === t ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${disabled ? ' opacity-60 pointer-events-none' : ''}`}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              )
            })}
          </div>
          <div className="flex justify-end">
            {dedType === 'year' &&
              (() => {
                const disabled = !julPossible
                const active = julCrossOnly && !disabled
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      setJulCrossOnly((v) => !v)
                    }}
                    className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${disabled ? ' opacity-60 pointer-events-none' : ''}`}
                  >
                    Jul Cross
                  </button>
                )
              })()}
            {dedType === 'month' &&
              (() => {
                const disabled = !m1582Possible
                const active = monthOnly1582 && !disabled
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      setMonthOnly1582((v) => !v)
                    }}
                    className={`px-2 py-1 rounded-xl text-xs font-medium border min-w-20 ${active ? 'btn-solid border-transparent' : 'surface-toggle text-(--tx-100-80)'}${disabled ? ' opacity-60 pointer-events-none' : ''}`}
                  >
                    1582 Only
                  </button>
                )
              })()}
          </div>
        </div>
        <div className="mt-4 rounded-2xl panel p-4">
          <div className="text-center relative">
            {state.backDepth > 0 && (
              <span className="absolute right-0 top-0 text-[11px] tabular-nums text-(--tx-300-60)">
                Q{state.stack.length + 1}
              </span>
            )}
            <div className="text-3xl font-bold">
              {date ? fmtDatePartial(date.y, date.m, date.d, date._fmt, date.type) : '—'}
            </div>
            {date && (
              <div className="mt-1 text-lg text-(--tx-100)">
                Weekday: <span className="font-semibold">{DAY[date.w]}</span>
              </div>
            )}
          </div>
          {/* key=gridEpoch — Deduction's puzzle grids remount on reset, same snap-clean as the
                  weekday modes' keyed WeekdayAnswer (Q9; see its doc comment). */}
          <div key={state.gridEpoch} className="mt-4">
            {/* Both-crosses 2-option Year (Q14): overlay the real grid on an invisible inert
                    full-window sizer so the answer panel holds that layout's height — the New/‹›/
                    Reveal/Override row must not move a pixel as puzzles alternate 2↔5. The real
                    grid self-centers in that space (the 5-layout's visual centroid; top/bottom-
                    aligned reads as a dead band). A strut, not a calc(): it tracks the real button
                    metrics by construction. It is also DERIVED, not copied (Q4 round-9) — cell
                    COUNT from YEAR_OPTION_DEFAULT, grid + col-spans from yearGridLayout, gutter
                    from ANSWER_GRID_GAP, cell chrome from the same baseBtn the real buttons wear.
                    It used to hand-copy the n=5 classes, so every one of those was a place the two
                    could silently disagree; there is now no second set of classes to keep in sync.
                    abCrossOnly&&julCrossOnly is trustworthy (the auto-clear effects above drop a
                    stale toggle the moment its prerequisites break); any other 2-option Year (the
                    rare no-toggle Julian straddle) keeps the tight single-row layout. */}
            {date &&
              date.type === 'year' &&
              (() => {
                const N = date.options.length
                const { gridCls } = yearGridLayout(N)
                const reserve = abCrossOnly && julCrossOnly && N === 2
                const answerGrid = (
                  <div
                    className={`grid ${ANSWER_GRID_GAP} ${gridCls}${reserve ? ' col-start-1 row-start-1 self-center' : ''}`}
                    data-answer-grid="true"
                  >
                    {date.options.map((y, idx) => {
                      const ps = state.persistBtns[idx]
                      const isFlashing = !!(gridFlash && gridFlash.idx === idx)
                      const bCls = buttonStateClass(
                        ps,
                        isFlashing,
                        gridFlash?.type === 'good',
                        idleBtn,
                      )
                      const perLocked = !!ps
                      const shouldDim = optionsDisabled && !ps && !isFlashing
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (perLocked) return
                            onAnswer(idx)
                            if (isTouch) (document.activeElement as HTMLElement | null)?.blur()
                          }}
                          data-hit-pad={hitPad[idx]}
                          className={`${baseBtn} ${bCls} ${perLocked || optionsDisabled ? 'pointer-events-none' : ''} ${shouldDim ? 'opacity-60' : ''} ${colSpanClass(optionSpans[idx])}`}
                        >
                          {fmtYear(y)}
                        </button>
                      )
                    })}
                  </div>
                )
                if (!reserve) return answerGrid
                const sizer = yearGridLayout(YEAR_OPTION_DEFAULT)
                return (
                  <div className="grid">
                    <div
                      className={`col-start-1 row-start-1 invisible pointer-events-none grid ${ANSWER_GRID_GAP} ${sizer.gridCls}`}
                      aria-hidden="true"
                    >
                      {Array.from({ length: YEAR_OPTION_DEFAULT }, (_, i) => (
                        <div key={i} className={`${baseBtn} ${sizer.colSpanFor(i)}`}>
                          &nbsp;
                        </div>
                      ))}
                    </div>
                    {answerGrid}
                  </div>
                )
              })()}
            {date && date.type === 'month' && (
              <div className={`grid grid-cols-2 ${ANSWER_GRID_GAP}`} data-answer-grid="true">
                {date.options.map((mv, idx) => {
                  const last = colSpanClass(optionSpans[idx])
                  const ps = state.persistBtns[idx]
                  const isFlashing = !!(gridFlash && gridFlash.idx === idx)
                  const bCls = buttonStateClass(ps, isFlashing, gridFlash?.type === 'good', idleBtn)
                  const perLocked = !!ps
                  const shouldDim = optionsDisabled && !ps && !isFlashing
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (perLocked) return
                        onAnswer(idx)
                        if (isTouch) (document.activeElement as HTMLElement | null)?.blur()
                      }}
                      data-hit-pad={hitPad[idx]}
                      className={`${baseBtn} ${bCls} ${perLocked || optionsDisabled ? 'pointer-events-none' : ''} ${shouldDim ? 'opacity-60' : ''} ${last}`}
                    >
                      {mv}
                    </button>
                  )
                })}
              </div>
            )}
            {date && date.type === 'day' && (
              <div className={`grid grid-cols-3 ${ANSWER_GRID_GAP}`} data-answer-grid="true">
                {date.options.map((dv, idx) => {
                  const ps = state.persistBtns[idx]
                  const isFlashing = !!(gridFlash && gridFlash.idx === idx)
                  const bCls = buttonStateClass(ps, isFlashing, gridFlash?.type === 'good', idleBtn)
                  const perLocked = !!ps
                  const shouldDim = optionsDisabled && !ps && !isFlashing
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (perLocked) return
                        onAnswer(idx)
                        if (isTouch) (document.activeElement as HTMLElement | null)?.blur()
                      }}
                      data-hit-pad={hitPad[idx]}
                      className={`${baseBtn} ${bCls} ${perLocked || optionsDisabled ? 'pointer-events-none' : ''} ${shouldDim ? 'opacity-60' : ''} ${colSpanClass(optionSpans[idx])}`}
                    >
                      {dv}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
            date={calcTarget}
            open={state.calcOpen}
            onOpenChange={(open) => eng.showCodes(open)}
            className=""
            contentClassName="mt-2 rounded-2xl thin px-4 pt-[3px] pb-1.5"
            useJulian={calcTarget?._jul ?? useJulian}
            displayedFormat={calcTarget?._fmt || dateFormat}
            cellDates={cellDates}
          />
        </div>
      </div>
    </div>
  )
}

export default DeductionMode
