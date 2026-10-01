import * as React from 'react'
import Expander from './Expander.jsx'
import { computeMethodSummary } from '../lib/method.js'
import { ACCORDION_MS_FLOOR, CODES_CLOSE_MS } from '../lib/accordionMotion.js'
import type { FormatId } from '../lib/format.js'

// MethodBreakdownSection — the "Show Codes" panel. The file's ONE export (beside the CodeDate
// shape its callers pass): every consumer mounts the section, never the body inside it.
//
// MethodExplanation, module-local, renders the five code cells (Month / Day / ab / cd / Leap)
// plus the calendar-system line for a date, ordered to match the date format's
// reading order. When given cellDates (Deduction 1582 month cell spanning both
// calendars) it collapses each code across interpretations, slash-joining any
// that differ. MethodBreakdownSection is the Show/Hide-Codes toggle that wraps it
// in an Expander, with the freeze contract that holds the panel's inputs steady
// for CODES_CLOSE_MS while it slides shut. Shared by App, AoxMode, and LookupCard.
//
// Extracted from main.jsx in Stage C, Step 4g (verbatim). Round 8 folded AoxMode's
// hand-rolled copy of the toggle + freeze onto this component, so all SIX codes panels
// (Classic, Blitz, Flash, Deduction, AoX, Lookup) are now literally this one implementation.

// The Show/Hide Codes toggle's className. Every one of the six sites reaches it through this
// component, so the six can no longer drift — which they had (round 8 found AoX's inline
// copy missing the aria-disabled and cursor-not-allowed the other five carried; round 8
// removed that copy outright). Module-local: nothing outside this file renders the button.
// `border border-transparent` completes the button's RENDERED height. It is a solid fill, so it
// carries no visible border, but every control it is measured against does (Reveal / Override /
// New wear `border surface-button`, the settings tier's toggles and pill housings a 1px border),
// and a border counts toward rendered height — without it this button sits 2px shorter than its
// tier everywhere it is not stretched by a grid row. (Round-4's lesson, applied at four other
// sites; NOT pushed down into .btn-solid itself, because the date-format segments are deliberately
// borderless inside their own concentric housing.)
const CODES_BTN_CLASS =
  'w-full px-4 py-2 rounded-xl btn-solid border border-transparent text-sm font-medium'
// Appended while there is no date to show codes for. Pairs with aria-disabled on the button, so
// the visual and the accessible state can never disagree.
const CODES_BTN_DISABLED_CLASS = 'opacity-60 cursor-not-allowed pointer-events-none'

// The minimal date a code panel reads (the question's y/m/d). Callers pass richer
// objects (full questions / puzzles); only these three fields are consumed.
export interface CodeDate {
  y: number
  m: number
  d: number
}
// The per-date code summary shape, taken from computeMethodSummary's inferred return.
type MethodSummary = NonNullable<ReturnType<typeof computeMethodSummary>>

// Module-local, exactly like CODES_BTN_CLASS above: until round 8 AoxMode imported this
// directly to hand-roll its own toggle, and that import was its last one — the fold left the
// export behind with no consumer anywhere in the repo. Nothing outside this file renders the
// codes body; it is reached only through MethodBreakdownSection, which owns the freeze contract
// that keeps the body's inputs steady while the panel slides shut. Exporting it again would be
// re-opening the door that let the six panels drift apart in the first place.
function MethodExplanation({
  date,
  useJulian = false,
  displayedFormat = 'written-mdy',
  cellDates = null,
}: {
  date?: CodeDate | null
  useJulian?: boolean
  displayedFormat?: FormatId
  cellDates?: CodeDate[] | null
}) {
  // Plain computation (no useMemo): computeMethodSummary is pure + cheap and only runs while
  // the codes panel is open. Letting the React Compiler own the memoization removes a manual dep
  // array that under-specified `date` (it listed date?.y/m/d, not the object the call reads).
  const summaries: MethodSummary[] =
    cellDates && cellDates.length > 0
      ? cellDates
          .map((cd) => computeMethodSummary(cd, true))
          .filter((s): s is MethodSummary => s != null)
      : date
        ? [computeMethodSummary(date, useJulian)].filter((s): s is MethodSummary => s != null)
        : []
  if (summaries.length === 0)
    return (
      <div className="text-sm text-(--tx-100-80)">Show Codes is only supported for AD dates.</div>
    )
  // Collapse-when-same: gather each code's values across all interpretations,
  // dedup via Set (preserves insertion order), and join with slashes if 2+ unique.
  const joinDedup = (vals: Array<string | number>) => {
    const s = [...new Set(vals.map((v) => String(v)))]
    return s.join('/')
  }
  const monthCode = joinDedup(summaries.map((s) => s.monthCode))
  const dayCode = joinDedup(summaries.map((s) => s.dayCode))
  const abCode = joinDedup(summaries.map((s) => s.abCode))
  const cdCode = joinDedup(summaries.map((s) => s.cdCode))
  const leapValue = joinDedup(summaries.map((s) => String(s.leapCode)))
  const calendarText = joinDedup(summaries.map((s) => s.calendarSystem)) + ' Calendar'
  const codeMap: Record<string, { label: string; italic: boolean; value: string }> = {
    Month: { label: 'Month', italic: false, value: monthCode },
    Day: { label: 'Day', italic: false, value: dayCode },
    ab: { label: 'ab', italic: true, value: abCode },
    cd: { label: 'cd', italic: true, value: cdCode },
    Leap: { label: 'Leap', italic: false, value: leapValue },
  }
  // Order the codes left-to-right matching the date format's reading order.
  // After both year and month appear, Leap is placed.
  const fmt = displayedFormat || 'written-mdy'
  let order: string[]
  if (fmt === 'numeric-ymd') order = ['ab', 'cd', 'Month', 'Leap', 'Day']
  else if (fmt === 'written-dmy' || fmt === 'numeric-dmy')
    order = ['Day', 'Month', 'ab', 'cd', 'Leap']
  else order = ['Month', 'Day', 'ab', 'cd', 'Leap'] // written-mdy, numeric-mdy, fallback
  const codes = order.map((k) => codeMap[k])
  return (
    <div>
      <div className="grid grid-cols-5 gap-2 text-center text-sm">
        {codes.map((c, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="text-[11px] text-(--tx-200-80)">
              {c.italic ? <i>{c.label}</i> : c.label}
            </div>
            <div className="font-semibold tabular-nums text-(--tx-50)">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] text-(--tx-300-60)">{calendarText}</div>
    </div>
  )
}

export function MethodBreakdownSection({
  date,
  open: controlledOpen,
  onOpenChange,
  className,
  contentClassName,
  useJulian = false,
  displayedFormat = 'written-mdy',
  cellDates = null,
}: {
  date?: CodeDate | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Both are REQUIRED: every call site states its own wrapper and panel classes (the wrapper is
  // "" in the game modes and a stable name in Lookup), so a default here would be unreachable
  // code that only invites a future site to skip the decision.
  className: string
  contentClassName: string
  useJulian?: boolean
  displayedFormat?: FormatId
  cellDates?: CodeDate[] | null
}) {
  // The panel's DOM id, for the button's aria-controls. useId, not a prop: all six codes
  // panels are mounted at once (the game modes are display:none, never unmounted), so a
  // caller-supplied id would be one more thing six sites must agree to keep unique.
  const panelId = React.useId()
  const isControlled = typeof controlledOpen === 'boolean' && typeof onOpenChange === 'function'
  const [internalOpen, setInternalOpen] = React.useState(false)
  // Frozen values for the codes panel — kept in lockstep so MethodExplanation sees a
  // self-consistent snapshot during the close animation (no prop leaks during the
  // CODES_CLOSE_MS window). ALL FOUR are frozen, not just the date: format and Julian can
  // change under a settings edit made while the panel is sliding shut.
  const [frozenDate, setFrozenDate] = React.useState(date)
  const [frozenDisplayedFormat, setFrozenDisplayedFormat] = React.useState(displayedFormat)
  const [frozenCellDates, setFrozenCellDates] = React.useState(cellDates)
  const [frozenUseJulian, setFrozenUseJulian] = React.useState(useJulian)
  // Latest-value refs so the close-timeout reads the freshest values when it fires after
  // CODES_CLOSE_MS. Synced in a post-commit effect (no dep array = every commit) rather than
  // during render — the compiler's refs rule forbids writing refs in render, and the timeout
  // always fires long after a commit, so post-commit freshness is exactly what it needs.
  const latestDateRef = React.useRef(date)
  const latestDisplayedFormatRef = React.useRef(displayedFormat)
  const latestCellDatesRef = React.useRef(cellDates)
  const latestUseJulianRef = React.useRef(useJulian)
  React.useEffect(() => {
    latestDateRef.current = date
    latestDisplayedFormatRef.current = displayedFormat
    latestCellDatesRef.current = cellDates
    latestUseJulianRef.current = useJulian
  })
  const wasOpenRef = React.useRef(isControlled ? !!controlledOpen : false)
  // closingRef is true between the moment the panel begins closing and the moment the
  // CODES_CLOSE_MS timer fires. While true, dep changes (e.g. user clicks Forward inside
  // that window after Hide Codes) re-arm the timer rather than falling into the else branch,
  // which would otherwise snap frozen values to the live ones mid-animation — visible as the
  // panel's contents changing while the panel is still sliding shut. (AoX's now-deleted
  // private copy of this effect lacked the ref and shipped exactly that bug.)
  const closingRef = React.useRef(false)
  const key = date ? `${date.y}-${date.m}-${date.d}` : ''
  React.useEffect(() => {
    // Auto-close the uncontrolled panel on a date change — a reaction to a prop change with no
    // render-time equivalent that preserves the exact close timing the tests lock in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isControlled) setInternalOpen(false)
  }, [key, isControlled])
  const hasDate = !!date
  React.useEffect(() => {
    if (hasDate) return
    // Date removed: close the panel. Controlled → notify the parent (a side effect that must
    // live in an effect); uncontrolled → reset our own open state.
    if (isControlled) {
      if (controlledOpen) onOpenChange?.(false)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInternalOpen(false)
    }
  }, [hasDate, isControlled, controlledOpen, onOpenChange])
  const open = hasDate ? (isControlled ? !!controlledOpen : internalOpen) : false
  const toggle = () => {
    if (!hasDate) return
    if (isControlled) onOpenChange?.(!open)
    else setInternalOpen((v) => !v)
  }
  // Content-derived key for cellDates so identity-unstable inline-built arrays in the
  // Deduction parent don't fire this effect on every parent render.
  const cellDatesKey = cellDates ? cellDates.map((c) => `${c.y}-${c.m}-${c.d}`).join('|') : ''
  // === Freeze contract ===
  // While the codes panel is open, all four inputs to MethodExplanation (date,
  // displayedFormat, cellDates, useJulian) track their live values. When the panel
  // transitions from open→closed, all four are HELD at their current values for
  // CODES_CLOSE_MS (= ACCORDION_MS_FLOOR + buffer; the Expander below is handed that
  // same floor as its durationMs, so the hold provably outlasts the slide), then
  // released to the latest values after the close completes.
  // Callers that mutate any of the four inputs MUST batch setCalcOpen(false) into
  // the same React update; otherwise this effect fires once with (open=true,
  // newInputs) and updates the frozen values immediately, defeating the freeze.
  // Mutators that honor this contract: pushAndNext, goBack, goForward,
  // runDeductionRound, sctn, the dedType useEffect, handleResetStats, the blitz
  // config-change effect.
  // LOSING THE DATE IS A CLOSE, and the effect below takes no shortcut for it: the derived `open`
  // above already folds in hasDate, so a date going away (Reset Stats, Lookup selecting a gap
  // entry) arrives as open=false and takes the same hold-then-release path. A HOLD, not an
  // immediate release: the panel may be mid-slide when the date disappears, and releasing on the
  // spot would swap the codes for the "AD dates only" line in full view. Until round 11 this
  // effect opened with `if (!date) return`, which wedged the machine — React ran the previous
  // run's cleanup, clearing the pending release timer, and armed nothing in its place, so
  // closingRef stayed true and the snapshot stayed on the departed date until the next open. It
  // never SHOWED, because a dateless panel is forced closed: correct by accident, a downstream
  // guard covering for a stuck machine. tests/methodBreakdown.dom pins both halves.
  /* The freeze effect below is a genuine timer mechanism: it mirrors frozen←live while the panel
     is open and, on close, HOLDS the frozen snapshot for CODES_CLOSE_MS before releasing it to the
     latest values. The synchronous setState (mirror-while-open / immediate-when-not-animating) has
     no render-time equivalent for a *timed* state release, and the deps intentionally use
     cellDatesKey (a content-stable proxy) instead of the identity-unstable cellDates array. */
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  React.useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      closingRef.current = false
      setFrozenDate(date)
      setFrozenDisplayedFormat(displayedFormat)
      setFrozenCellDates(cellDates)
      setFrozenUseJulian(useJulian)
      return
    }
    if (wasOpenRef.current || closingRef.current) {
      wasOpenRef.current = false
      closingRef.current = true
      const t = setTimeout(() => {
        closingRef.current = false
        setFrozenDate(latestDateRef.current)
        setFrozenDisplayedFormat(latestDisplayedFormatRef.current)
        setFrozenCellDates(latestCellDatesRef.current)
        setFrozenUseJulian(latestUseJulianRef.current)
      }, CODES_CLOSE_MS)
      return () => clearTimeout(t)
    } else {
      setFrozenDate(date)
      setFrozenDisplayedFormat(displayedFormat)
      setFrozenCellDates(cellDates)
      setFrozenUseJulian(useJulian)
    }
  }, [open, date, displayedFormat, useJulian, cellDatesKey])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  return (
    <div className={className}>
      <button
        type="button"
        data-key="C"
        onClick={toggle}
        className={`${CODES_BTN_CLASS} ${!hasDate ? CODES_BTN_DISABLED_CLASS : ''}`}
        aria-disabled={!hasDate}
        // The same disclosure contract the guide's accordion headers got in round 7 and
        // this toggle did not: state announced, and a pointer at the region it opens. `open`
        // already folds in hasDate, so a disabled toggle reports itself collapsed.
        aria-expanded={open}
        aria-controls={panelId}
      >
        {open ? 'Hide Codes' : 'Show Codes'}
      </button>
      {/* durationMs is stated, not inherited: the codes panel runs the accordion duration
          FLOOR — the same value the guide's distance-scaled formula returns for every panel
          this size — and CODES_CLOSE_MS is derived from that floor. Passing it makes the
          agreement explicit rather than a coincidence of two literals (round 8); the
          .expander var fallback in index.css is now pure defense and never a live path. */}
      <Expander open={open && hasDate} durationMs={ACCORDION_MS_FLOOR}>
        <div id={panelId} className={contentClassName}>
          <MethodExplanation
            date={frozenDate}
            useJulian={frozenUseJulian}
            displayedFormat={frozenDisplayedFormat}
            cellDates={frozenCellDates}
          />
        </div>
      </Expander>
    </div>
  )
}
