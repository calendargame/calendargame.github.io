import * as React from 'react'
import { fmt, MONTH, DAY, numericFormatOf } from '../lib/format.js'
import { dim, wday, wdayJulian, isJulianDate, isGapDate } from '../lib/calendar.js'
import { MethodBreakdownSection, type CodeDate } from './MethodBreakdown.jsx'
import type { FormatId } from '../lib/format.js'

// A Lookup history entry: parsed date (y/m/d) + rendered label, weekday, full result.
// isGap marks an Oct 5-14, 1582 gap (Does Not Exist) entry.
export interface LookupEntry {
  id: string
  label: string
  weekday: string
  result: string
  y: number
  m: number
  d: number
  isGap?: boolean
}
interface LookupCardProps {
  history?: LookupEntry[]
  onAddHistory?: (entry: LookupEntry) => void
  onMoveHistory?: (id: string) => void
  onClearHistory?: () => void
  inputValue?: string
  onInputChange?: (value: string) => void
  outputValue?: string
  onOutputChange?: (value: string) => void
  calcDate?: CodeDate | null
  onCalcDateChange?: (date: CodeDate | null) => void
  selectedHistoryId?: string | null
  onSelectedHistoryIdChange?: (id: string | null) => void
  calcOpen?: boolean
  onCalcOpenChange?: (open: boolean) => void
  fmtDate?: (y: number, m: number, d: number) => string
  dateFormat?: FormatId
  useJulian?: boolean
}

// Unique id for a new history entry. At module scope it's outside React's render-purity rule
// (Date.now()/Math.random() are impure) — and it only ever runs from the Lookup event handler.
// Single source of truth: was previously duplicated inline at both add sites.
function makeEntryId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
// Stable empty-array fallback (module scope) so `entries` keeps a constant identity when
// history isn't an array — a fresh [] each render would change the memos/effects that read it.
const NO_ENTRIES: LookupEntry[] = []

// LookupCard — the Lookup-mode card: a numeric date input (format follows the
// active dateFormat), a scrollable history list (up to 10 before scrolling, with
// edge-fade indicators), and the shared Show Codes panel. All state is lifted to
// the parent and passed via props/callbacks, so this component is presentational
// + input-parsing only. Recognizes the Oct 5–14, 1582 gap ("Does Not Exist").
//
// Extracted from main.jsx in Stage C, Step 4f (verbatim). Uses module-level
// helpers now imported from lib/* (isLeap/dim/wday/numericFormatOf etc.) — no
// local duplicates.
export default function LookupCard({
  history = [],
  onAddHistory,
  onMoveHistory,
  onClearHistory,
  inputValue = '',
  onInputChange,
  outputValue = '',
  onOutputChange,
  calcDate,
  onCalcDateChange,
  selectedHistoryId,
  onSelectedHistoryIdChange,
  calcOpen = false,
  onCalcOpenChange,
  fmtDate,
  dateFormat = 'written-mdy',
  useJulian = false,
}: LookupCardProps) {
  const li = typeof inputValue === 'string' ? inputValue : String(inputValue ?? '')
  const sli = typeof onInputChange === 'function' ? onInputChange : () => {}
  const lo = typeof outputValue === 'string' ? outputValue : String(outputValue ?? '')
  const slo = typeof onOutputChange === 'function' ? onOutputChange : () => {}
  const cdv = calcDate ?? null
  const scd = typeof onCalcDateChange === 'function' ? onCalcDateChange : () => {}
  const sid = selectedHistoryId ?? null
  const ssid =
    typeof onSelectedHistoryIdChange === 'function' ? onSelectedHistoryIdChange : () => {}
  const cov = !!calcOpen
  // Lookup history scroll-state tracking. Three flags drive edge indicators:
  //   lookupHistoryScrolledFromTop → top fade + History header shadow (down)
  //   lookupHistoryAtBottom        → bottom fade + MethodBreakdown shadow (up)
  // Defaults: scrolledFromTop false, atBottom true. ResizeObserver covers the case
  // where the list grows from 9→10 entries while the user is viewing it.
  const lookupHistoryRef = React.useRef<HTMLUListElement>(null)
  const [lookupHistoryAtBottom, setLookupHistoryAtBottom] = React.useState(true)
  const [lookupHistoryScrolledFromTop, setLookupHistoryScrolledFromTop] = React.useState(false)
  React.useEffect(() => {
    const el = lookupHistoryRef.current
    if (!el) return
    const evaluate = () => {
      const noOverflow = el.scrollHeight <= el.clientHeight + 1
      setLookupHistoryAtBottom(noOverflow || el.scrollTop + el.clientHeight >= el.scrollHeight - 4)
      setLookupHistoryScrolledFromTop(!noOverflow && el.scrollTop > 0)
    }
    evaluate()
    el.addEventListener('scroll', evaluate, { passive: true })
    const ro = new ResizeObserver(evaluate)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', evaluate)
      ro.disconnect()
    }
  }, [history])
  // Codes-open is purely global state — it stays as-is when the user clicks through
  // history entries, only changing on (1) a manual toggle, (2) a brand-new lookup
  // via runLookup, or (3) MethodBreakdownSection's auto-close when the displayed
  // date becomes null (e.g., clicking a "Does Not Exist" gap entry). Earlier per-entry
  // tracking via calcOpenByEntry was removed because it made codes auto-close on
  // every history click that landed on an entry whose codes had never been opened.
  const sco = typeof onCalcOpenChange === 'function' ? (next: boolean) => onCalcOpenChange?.(!!next) : () => {}
  const lastLookupRef = React.useRef<string | null>(null)
  const lookupInputRef = React.useRef<HTMLInputElement>(null)
  // LookupCard uses module-level isLeap/dim/wday/numericFormatOf — no local duplicates.
  // Map any selected dateFormat to its corresponding Numeric format for input parsing.
  const numericFmtForInput = numericFormatOf(dateFormat)
  // Pattern + example based on which numeric format applies.
  const inputMeta = (() => {
    if (numericFmtForInput === 'numeric-mdy')
      return { label: 'm/d/y', example: '7/4/1776', sep: '/', orderType: 'mdy' }
    if (numericFmtForInput === 'numeric-dmy')
      return { label: 'd.m.y', example: '4.7.1776', sep: '.', orderType: 'dmy' }
    return { label: 'y-m-d', example: '1776-7-4', sep: '-', orderType: 'ymd' }
  })()
  // Clear the input when the format changes (silently keeping it would be confusing since it might no longer parse).
  // Use a ref to skip the initial mount so navigating to Lookup doesn't wipe the user's existing input.
  const prevFormatRef = React.useRef(dateFormat)
  React.useEffect(() => {
    if (prevFormatRef.current !== dateFormat) {
      sli('')
      slo('')
      ssid(null)
      scd(null)
      sco(false)
      lastLookupRef.current = null
      prevFormatRef.current = dateFormat
    }
    // Fire on dateFormat change only (the prevFormatRef guard also skips the initial mount). The
    // setters are re-created each render; excluding them keeps this from running every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFormat])
  function runLookup() {
    const s = li.trim()
    // Build regex based on the input format. Year accepts 1–5 digits, month/day 1–2 digits.
    const sepEsc = inputMeta.sep === '.' ? '\\.' : inputMeta.sep === '-' ? '-' : '/'
    let match: RegExpExecArray | null
    if (inputMeta.orderType === 'ymd')
      match = new RegExp(`^(\\d{1,5})${sepEsc}(\\d{1,2})${sepEsc}(\\d{1,2})$`).exec(s)
    else match = new RegExp(`^(\\d{1,2})${sepEsc}(\\d{1,2})${sepEsc}(\\d{1,5})$`).exec(s)
    if (!match) {
      ssid(null)
      slo(`Enter date as ${inputMeta.label}, e.g. ${inputMeta.example}`)
      lookupInputRef.current?.focus()
      return
    }
    let mm: number, dd: number, yy: number
    if (inputMeta.orderType === 'ymd') {
      yy = +match[1]
      mm = +match[2]
      dd = +match[3]
    } else if (inputMeta.orderType === 'mdy') {
      mm = +match[1]
      dd = +match[2]
      yy = +match[3]
    } else {
      dd = +match[1]
      mm = +match[2]
      yy = +match[3]
    }
    if (yy < 1 || yy > 10000) {
      ssid(null)
      slo('Year must be between 1 and 10000')
      lookupInputRef.current?.focus()
      return
    }
    if (mm < 1 || mm > 12) {
      ssid(null)
      slo('Month must be 1–12')
      lookupInputRef.current?.focus()
      return
    }
    const existing = entries.find((e) => e.y === yy && e.m === mm && e.d === dd)
    if (existing) {
      if (onMoveHistory) onMoveHistory(existing.id)
      slo(existing.result)
      ssid(existing.id)
      if (existing.isGap) {
        scd(null)
        sco(false)
      } else scd({ y: yy, m: mm, d: dd })
      lastLookupRef.current = s
      lookupInputRef.current?.blur()
      return
    }
    if (isGapDate(yy, mm, dd)) {
      const gapMsg =
        'October 5–14, 1582 never existed. When the Gregorian calendar was adopted, 10 days were skipped to correct accumulated calendar drift.'
      const displayDate = fmtDate ? fmtDate(yy, mm, dd) : `${MONTH[mm - 1]} ${dd}, ${yy}`
      const entry = {
        id: makeEntryId(),
        label: displayDate,
        weekday: 'Does Not Exist',
        result: gapMsg,
        y: yy,
        m: mm,
        d: dd,
        isGap: true,
      }
      lastLookupRef.current = s
      slo(gapMsg)
      scd(null)
      ssid(entry.id)
      sco(false)
      if (onAddHistory) onAddHistory(entry)
      lookupInputRef.current?.blur()
      return
    }
    const julian = useJulian && isJulianDate(yy, mm, dd)
    const maxd = dim(yy, mm, julian)
    if (dd < 1 || dd > maxd) {
      ssid(null)
      slo(`Day must be 1–${maxd} for ${MONTH[mm - 1]}`)
      lookupInputRef.current?.focus()
      return
    }
    const wd = julian ? wdayJulian(yy, mm, dd) : wday(yy, mm, dd)
    const d = DAY[wd]
    const displayDate = fmtDate ? fmtDate(yy, mm, dd) : `${MONTH[mm - 1]} ${dd}, ${yy}`
    const rt = `${displayDate} is a ${d}.`
    const entry = {
      id: makeEntryId(),
      label: displayDate,
      weekday: d,
      result: rt,
      y: yy,
      m: mm,
      d: dd,
    }
    lastLookupRef.current = s
    slo(rt)
    scd({ y: yy, m: mm, d: dd })
    ssid(entry.id)
    sco(false)
    if (onAddHistory) onAddHistory(entry)
    lookupInputRef.current?.blur()
  }
  function clearLookup() {
    sli('')
    slo('')
    scd(null)
    ssid(null)
    sco(false)
    lastLookupRef.current = null
  }
  // `entries` is `history` (stable per parent render) or the stable NO_ENTRIES const — never a
  // fresh [] — so the memos/effects that read it don't churn.
  const entries = Array.isArray(history) ? history : NO_ENTRIES
  React.useEffect(() => {
    if (!sid) return
    if (!entries.some((e) => e.id === sid)) {
      ssid(null)
      scd(null)
      slo('')
      sco(false)
    }
    // Orphaned-selection cleanup: fire on [entries, sid] only. The setters are prop-callback
    // wrappers re-created each render; listing them would re-run this every render to no effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sid])
  // Selecting a history entry never changes calcOpen directly. For non-gap entries,
  // codes-open simply stays as-is. For gap entries (Does Not Exist), calcDate becomes
  // null, which triggers MethodBreakdownSection's hasDate auto-close effect.
  // Selecting any history entry (by tap, click, or Enter via keyboard nav) populates the input
  // with that date — convenient for re-running a lookup or editing it. The input is always
  // numeric (per the input's contract; the displayed history label may be written), so
  // populate using the numeric form of the selected dateFormat regardless of how the
  // history row reads.
  const selEntry = (entry: LookupEntry) => {
    if (!entry) return
    ssid(entry.id)
    slo(entry?.result || '')
    if (entry.isGap) {
      scd(null)
      lastLookupRef.current = null
    } else {
      if (typeof entry.y === 'number') scd({ y: entry.y, m: entry.m, d: entry.d })
    }
    const renderedLabel =
      typeof entry.y === 'number' ? fmt(entry.y, entry.m, entry.d, numericFmtForInput) : entry.label
    if (typeof renderedLabel === 'string') sli(renderedLabel)
    if (document.activeElement) (document.activeElement as HTMLElement).blur()
  }
  const clearHist = () => {
    if (onClearHistory) onClearHistory()
    ssid(null)
    scd(null)
    slo('')
    sco(false)
    lastLookupRef.current = null
  }
  const displayNote = React.useMemo(() => {
    const selectedEntry = entries.find((e) => e.id === sid)
    if (
      selectedEntry &&
      !selectedEntry.isGap &&
      typeof selectedEntry.y === 'number' &&
      isJulianDate(selectedEntry.y, selectedEntry.m, selectedEntry.d)
    ) {
      const isJul = useJulian
      const wd = isJul
        ? wdayJulian(selectedEntry.y, selectedEntry.m, selectedEntry.d)
        : wday(selectedEntry.y, selectedEntry.m, selectedEntry.d)
      const displayDate = fmtDate
        ? fmtDate(selectedEntry.y, selectedEntry.m, selectedEntry.d)
        : `${MONTH[selectedEntry.m - 1]} ${selectedEntry.d}, ${selectedEntry.y}`
      return `${displayDate} is a ${DAY[wd]} (${isJul ? 'Julian' : 'Gregorian'}).`
    }
    return lo
  }, [sid, entries, useJulian, fmtDate, lo])
  const getEntryWeekday = (e: LookupEntry) => {
    if (e.isGap) return 'Does Not Exist'
    if (typeof e.y === 'number' && isJulianDate(e.y, e.m, e.d)) {
      const wd = useJulian ? wdayJulian(e.y, e.m, e.d) : wday(e.y, e.m, e.d)
      return DAY[wd]
    }
    return e.weekday
  }
  // History entries are stored as {y,m,d} so changing dateFormat re-renders labels live. fmtDate
  // itself closes over dateFormat (and is re-created when it changes), so it alone is the correct
  // dependency — listing dateFormat too is redundant.
  const renderedEntries = React.useMemo(
    () =>
      entries.map((e) => {
        if (e.isGap || typeof e.y !== 'number') return e
        return { ...e, label: fmtDate ? fmtDate(e.y, e.m, e.d) : e.label }
      }),
    [entries, fmtDate],
  )
  // Keyboard navigation for the Lookup card when no input has focus:
  //   ArrowDown/ArrowUp — move highlighted history entry; selecting populates input.
  //   Backspace/Delete  — clear the Lookup input box (matches the Clear button).
  // When an input IS focused, all keys pass through unchanged so typing & native cursor
  // handling (including ↑/↓ jumping cursor to start/end on single-line inputs) work normally.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null
      const inInput =
        ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      if (inInput) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (renderedEntries.length === 0) return
        e.preventDefault()
        const idx = renderedEntries.findIndex((x) => x.id === sid)
        const next =
          e.key === 'ArrowDown'
            ? Math.min(renderedEntries.length - 1, (idx < 0 ? -1 : idx) + 1)
            : Math.max(0, (idx < 0 ? renderedEntries.length : idx) - 1)
        selEntry(renderedEntries[next])
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Clear the Lookup input box (matching what the Clear button does), NOT the history.
        // Only fires when the input doesn't have focus — when it does, Backspace/Delete edit
        // the input character-by-character as normal.
        if (!li && !lo && !cdv) return
        e.preventDefault()
        clearLookup()
        return
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
    // Re-subscribe when the navigable list / selection / input change. clearLookup and selEntry
    // are body functions re-created each render but behavior-stable; excluding them avoids
    // re-subscribing the keydown listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedEntries, sid, li, lo, cdv])
  return (
    <div className="mt-1 space-y-4">
      <div className="rounded-2xl panel p-4 space-y-4">
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            ref={lookupInputRef}
            value={li}
            onChange={(e) => sli(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runLookup()
              }
            }}
            placeholder={`e.g., ${inputMeta.example}`}
            className="panel rounded-xl px-3 py-2 focus:outline-hidden focus-ring flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={runLookup}
            onMouseDown={(e) => e.preventDefault()}
            className="px-4 py-2 rounded-xl btn-solid text-sm font-medium"
          >
            Lookup
          </button>
          <button
            type="button"
            onClick={clearLookup}
            onMouseDown={(e) => e.preventDefault()}
            className="px-4 py-2 rounded-xl bg-zinc-700 text-white text-sm font-medium"
          >
            Clear
          </button>
        </div>
        {displayNote && <div className="text-sm text-purple-100/90">{displayNote}</div>}
        <p className="text-xs text-purple-100/90">
          Format: <b>{inputMeta.label}</b>
          <br />
          AD dates only, 1–10000
        </p>
      </div>
      <div className="rounded-2xl panel p-4 space-y-4">
        {/* History header: divider line below extends to full panel width via -mx-4
            + px-4 (so the line cuts edge-to-edge instead of stopping short at the
            parent's p-4). lookup-history-header class is for the box-shadow transition
            hook (see CSS). elev-shadow-down + the divider line together signal "fixed
            header above content scrolling below" — same pattern as the popover sticky
            footer's elev-shadow-up. */}
        <div
          className={`lookup-history-header -mx-4 px-4 pb-3 border-b border-purple-500/40 flex items-center justify-between text-[11px] uppercase tracking-wide text-purple-200/70${lookupHistoryScrolledFromTop ? ' elev-shadow-down' : ''}`}
        >
          <span>History</span>
          {entries.length > 0 && (
            <button type="button" onClick={clearHist} className="text-purple-200/70 font-medium">
              Clear History
            </button>
          )}
        </div>
        {renderedEntries.length > 0 ? (
          <ul
            ref={lookupHistoryRef}
            className={`space-y-2 overflow-y-auto overscroll-contain max-h-[440px]${lookupHistoryScrolledFromTop && !lookupHistoryAtBottom ? ' fade-scroll-both' : lookupHistoryScrolledFromTop ? ' fade-scroll-top' : !lookupHistoryAtBottom ? ' fade-scroll-bottom' : ''}`}
          >
            {renderedEntries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => selEntry(e)}
                  className={`w-full text-left px-3 py-2 rounded-xl panel flex items-center justify-between gap-3 text-xs transition ${sid === e.id ? 'border-l-2 border-l-purple-400 bg-purple-500/35' : 'hist-unsel hover:bg-purple-500/15'}`}
                >
                  <span className="block text-[13px] font-medium text-purple-100/90">
                    {e.label}
                  </span>
                  <span className="text-[12px] font-semibold text-purple-200/80">
                    {getEntryWeekday(e)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-purple-200/70">No lookups yet</p>
        )}
        {/* MethodBreakdownSection wrapper: -mx-4 + px-4 extends the existing border-t
            divider full-width across the panel (was previously stopping short at the
            parent's p-4). lookup-method-section class hooks the box-shadow transition.
            elev-shadow-up signals "fixed footer below content scrolling above." */}
        <MethodBreakdownSection
          date={cdv}
          className={`lookup-method-section -mx-4 px-4 pt-4 border-t border-purple-500/40${!lookupHistoryAtBottom ? ' elev-shadow-up' : ''}`}
          contentClassName="mt-3 rounded-2xl panel px-4 pt-[3px] pb-1.5"
          open={cov}
          onOpenChange={sco}
          useJulian={useJulian}
          displayedFormat={dateFormat}
        />
      </div>
    </div>
  )
}
