// WeekdayAnswer — the Sun..Sat answer grid shared by the four weekday mode screens. Extracted
// verbatim from main.tsx (Q1 phase 1).
import type { InputStyle } from '../store/settings.js'
import type { ButtonState } from '../engine/answerButtons.js'
import type { FlashState } from '../modes/modeTypes.js'
import { DAY } from '../lib/format.js'
import { DOT_CELL } from '../lib/dotLayout.js'
import { answerGridHitPad, colSpanClass } from '../lib/answerGrid.js'
import { isTouch } from '../lib/modeFormat.js'
import { buttonStateClass, BASE_BTN, ANSWER_GRID_GAP } from './controlClasses.js'

// The labelled grid's shape, as NUMBERS — two columns, one span per day, and the last (Saturday)
// spanning both so the odd seventh option is a full-width row. Both the col-span class each button
// wears and the hit padding each one claims are derived from this one array (lib/answerGrid), so
// the layout and its hit areas cannot disagree; the shape is fixed, so both are computed once at
// module load rather than per render. ⚠ WEEKDAY_COLS and the `grid-cols-2` literal in the grid's
// className below are the same fact stated twice — Tailwind only emits classes it can see in the
// source, so the class cannot be built from the number. They sit two lines apart for that reason,
// and tests/answerHitArea.dom re-derives the padding from the RENDERED classes to catch a drift.
const WEEKDAY_COLS = 2
const WEEKDAY_SPANS = DAY.map((_, i) => (i === DAY.length - 1 ? 2 : 1))
const WEEKDAY_HIT_PAD = answerGridHitPad(WEEKDAY_COLS, WEEKDAY_SPANS)

// WeekdayAnswer — the Sun..Sat answer grid shared by the four weekday modes (Classic/Flash/Blitz/
// AoX), in EITHER the classic labelled-button layout or the logo's 7-dot layout (Settings → Input;
// Deduction has its own puzzle grid, not a weekday answer). Both layouts share the per-option state
// derivation (persist colour / flash / lock / dim) and the same release-aware onClick (the global
// pointer controller makes every button press-drag-release + makes a data-answer-grid drag-to-select).
// DOM order is always Sun..Sat so the keyboard 0–9 path (children[idx]) works in both; the dot layout
// only repositions visually via DOT_CELL. idleClass is 'surface-button' for both (matches every
// weekday grid). The buttons branch matches the prior inline grids — Classic/Flash/Blitz verbatim,
// and AoX now also blurs the answer on touch like the others (harmless: just drops focus after a
// tap) — so behaviour, and the DOM tests that drive it, are unchanged. The dots are unlabelled
// circles (aria-label carries the accessible day name) sized + positioned by the .dot-box/
// .dot-cluster/.dot-btn CSS (index.css). Every caller keys the grid on state.gridEpoch (Q9):
// RESET / RESET_ROUND bump it, so a reset REMOUNTS the grid and the cleared colors SNAP to idle
// — .surface-button's hover transition would otherwise fade the green away (remounted elements
// never transition from a predecessor's styles; reorder/useLayoutEffect alone proven insufficient).
// Deduction keys its own puzzle-grid wrapper the same way.
//
// HIT AREAS ARE BIGGER THAN THE SHAPES (sub-group 1B), and the two layouts reach that differently
// because their spacing is different. The labelled buttons carry data-hit-pad, whose value names the
// sides that may claim half of the ANSWER_GRID_GAP gutter beside them (lib/answerGrid decides which;
// index.css draws the invisible ::after). The dots need no attribute at all: their cluster has NO
// gutter — it is a square 3×3 place-items:center grid — so "half the space between two dots" is
// exactly "the rest of my own cell", which .dot-btn::after states once for all seven. Both stop at
// the outer edge, and in the dot layout the two empty cells stay dead on purpose: they, and the
// space around either grid, are where a press slides to CANCEL.
function WeekdayAnswer({
  inputStyle,
  persistBtns,
  flash,
  optionsDisabled,
  onPick,
}: {
  inputStyle: InputStyle
  persistBtns: Record<string, ButtonState | undefined>
  flash: FlashState | null
  optionsDisabled: boolean
  onPick: (i: number) => void
}) {
  const opt = (i: number) => {
    const ps = persistBtns[i]
    const isFlashing = !!(flash && flash.idx === i)
    const bCls = buttonStateClass(ps, isFlashing, flash?.type === 'good', 'surface-button')
    const perLocked = !!ps
    const shouldDim = optionsDisabled && !ps && !isFlashing
    // pointer-events-none ONLY when the whole grid is inert (codes open / browsing back / inactive). A
    // perLocked (already-answered) button stays hit-testable so it still highlights as you drag over it
    // (Q4) — the onClick guard below blocks any re-answer, so it can't be re-selected.
    const inert = optionsDisabled
    const onClick = () => {
      if (perLocked) return
      onPick(i)
      if (isTouch) (document.activeElement as HTMLElement | null)?.blur()
    }
    return { bCls, inert, shouldDim, onClick }
  }
  if (inputStyle === 'dots') {
    return (
      <div className="mt-4 dot-box">
        <div className="dot-cluster" data-answer-grid="true">
          {DAY.map((nm, i) => {
            const o = opt(i)
            return (
              <button
                key={nm}
                type="button"
                aria-label={nm}
                onClick={o.onClick}
                style={{ gridRow: DOT_CELL[i].r, gridColumn: DOT_CELL[i].c }}
                className={`dot-btn ${o.bCls} ${o.inert ? 'pointer-events-none' : ''} ${o.shouldDim ? 'opacity-60' : ''}`}
              />
            )
          })}
        </div>
      </div>
    )
  }
  return (
    <div className={`mt-4 grid grid-cols-2 ${ANSWER_GRID_GAP}`} data-answer-grid="true">
      {DAY.map((nm, i) => {
        const o = opt(i)
        const last = colSpanClass(WEEKDAY_SPANS[i])
        return (
          <button
            key={nm}
            type="button"
            onClick={o.onClick}
            data-hit-pad={WEEKDAY_HIT_PAD[i]}
            className={`${BASE_BTN} ${o.bCls} ${o.inert ? 'pointer-events-none' : ''} ${o.shouldDim ? 'opacity-60' : ''} ${last}`}
          >
            {nm}
          </button>
        )
      })}
    </div>
  )
}

export default WeekdayAnswer
