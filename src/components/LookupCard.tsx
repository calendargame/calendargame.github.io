import * as React from 'react'
import { fmt, MONTH, DAY, numericFormatOf } from '../lib/format.js'
import { dim, dimEither, wday, wdayJulian, isJulianDate, isGapDate } from '../lib/calendar.js'
import { MethodBreakdownSection, type CodeDate } from './MethodBreakdown.jsx'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import type { FormatId } from '../lib/format.js'
// The history entry's persisted shape lives with the store that versions and migrates it
// (store/progress) — it is {id, y, m, d, isGap?} and nothing else. Everything shown on screen is
// derived from those inputs by entryLabel/entryReadings below, against the LIVE Date Format. The
// store also guarantees the date is REAL (normalizeLookupEntries), which is what lets the readings
// treat "this calendar has no such date" as a fact about the calendar rather than about the data.
import type { LookupEntry } from '../store/progress.js'

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

// The standing prompt in the result slot before anything has been looked up. RENDER-TIME ONLY —
// it must never be written into the lookupOutput state, which App reads as "" to decide the Full
// Reset button is dimmed/locked (isFullyReset); storing the hint would silently unlock it.
const LOOKUP_HINT = 'Enter a date to see its weekday.'
// The Oct 5–14, 1582 answer, deliberately SHORT: it shares the result slot with the date line above
// it and the full story (why ten days vanished when the Gregorian calendar was adopted) is already
// told in the How-to-Play guide's Julian Calendar section — one canonical copy, not two.
const GAP_MSG = 'October 5–14, 1582 never existed — 10 days skipped in the Gregorian switch.'
// What a calendar reads when the date is not one of its dates. ONE string for two situations that
// are the same statement at different scopes, which is why they share the words: a gap entry exists
// in NO calendar (nothing follows it, so it stands alone), and a pre-reform February 29 like 1500
// exists in Julian but not in Gregorian (the label beside it — "Gregorian:" / "G:" — is what scopes
// it there). Inventing a second phrase for the second case would split one idea into two.
const NO_READING = 'Does Not Exist'

// ── Derived-from-the-entry helpers ──────────────────────────────────────────────────────────
// A history entry stores INPUTS only ({id, y, m, d, isGap?}); its label and its weekday reading(s)
// are computed here, at paint time, from the live Date Format setting. That is what makes a format
// change re-render the whole card consistently — the answer slot above and every row below move
// together, because there is only one source of truth for all of them.

// The formatted date, exactly as the history row and the answer slot both show it.
const entryLabel = (e: LookupEntry, fmtDate?: (y: number, m: number, d: number) => string) =>
  fmtDate ? fmtDate(e.y, e.m, e.d) : `${MONTH[e.m - 1]} ${e.d}, ${e.y}`

// One calendar's answer for a date, in both the spelled-out form the answer slot uses and the
// compact form a history row has room for.
interface Reading {
  label: string // 'Julian' | 'Gregorian', or '' when there is only one calendar and naming it is noise
  shortLabel: string // the row's form of the same: 'J' | 'G' | ''
  weekday: string // the weekday name, or NO_READING where this calendar has no such date
  shortWeekday: string // the row's form: 'Wed' — see entryRowReadings for why rows abbreviate
}
const reading = (
  label: string,
  shortLabel: string,
  exists: boolean,
  dayIndex: number,
): Reading => ({
  label,
  shortLabel,
  weekday: exists ? DAY[dayIndex] : NO_READING,
  // Three letters is the whole abbreviation rule (Sunday → Sun). NO_READING is left intact: it is a
  // statement about the date, not a weekday, and "Doe" would be nonsense.
  shortWeekday: exists ? DAY[dayIndex].slice(0, 3) : NO_READING,
})

// Every reading a date has, in the order they are shown.
//
// Before the reform a date is genuinely AMBIGUOUS — it has a real Julian reading and a real
// proleptic-Gregorian one — so the card shows BOTH and lets the user see the disagreement, rather
// than picking one behind their back from the Julian Calendar setting. That is what makes the
// entries derivable at all: with no calendar chosen there is nothing per-entry left to freeze, and
// a stored date can never be re-read as a different (or impossible) one when the setting changes.
// The 12 pre-reform February 29ths that only Julian's leap rule grants are the sharp end of it:
// they read as a real Julian weekday and NO_READING under Gregorian, instead of silently borrowing
// March 1's weekday. After the reform there is one reading and it needs no label. Gap dates have
// none — they are neither calendar's date, which is what the slot's GAP_MSG says.
const entryReadings = (e: LookupEntry): Reading[] => {
  if (e.isGap) return []
  if (!isJulianDate(e.y, e.m, e.d)) return [reading('', '', true, wday(e.y, e.m, e.d))]
  return [
    reading('Julian', 'J', e.d <= dim(e.y, e.m, true), wdayJulian(e.y, e.m, e.d)),
    reading('Gregorian', 'G', e.d <= dim(e.y, e.m), wday(e.y, e.m, e.d)),
  ]
}

// The history row's readings, on ONE line, middot-separated.
//
// MEASURED, not guessed (375px, the narrowest phone this has to survive; the numbers are the real
// rendered widths): a row gives its two spans 272.4px between them, the widest ambiguous-era date
// label is 117.1px ("September 24, 1444", written format), and a two-reading line with full weekday
// names runs to 161.1px — 290.1px in total, which overflows by 5.8px. Wrapping is not the answer:
// it would give this one scrolling list two different row heights, which reads far worse than a
// shorter word. So rows abbreviate — 'J: Wed · G: Sun' — landing the worst case at 214.5px, and the
// worst NO_READING row ("February 29, 1300" + 'J: Mon · G: Does Not Exist') at 255.7px. The
// spelled-out form lives in the answer slot directly above, so the compact form has somewhere to be
// learned from. A row with only ONE reading keeps the full weekday: nothing is competing for the
// space, and abbreviating it would change every ordinary row for nothing.
const entryRowReadings = (e: LookupEntry): string =>
  e.isGap
    ? NO_READING
    : entryReadings(e)
        .map((r) => (r.label ? `${r.shortLabel}: ${r.shortWeekday}` : r.weekday))
        .join(' · ')

// Which calendar Show Codes works in. The answer slot shows both readings now, so the Julian
// Calendar setting no longer decides what a date IS — but the codes panel teaches ONE method and
// the setting is still what picks it. The one thing it must not do is teach a method for a date
// that the picked calendar does not have: February 29, 1500 is Julian-only, so with the setting off
// the panel would otherwise walk the user through a Gregorian date that never happened and land on
// March 1's codes. So follow the setting wherever both readings are real, and follow reality where
// only one is. (Gregorian's leap years are a subset of Julian's, so "not in Gregorian" implies "in
// Julian" for any date that passed validation — the true branch is the only one reality allows.)
const codesUseJulian = (date: CodeDate | null, useJulian: boolean): boolean => {
  if (!date || !isJulianDate(date.y, date.m, date.d)) return useJulian
  return date.d <= dim(date.y, date.m) ? useJulian : true
}

// LookupCard — the Lookup-mode card: a numeric date input (format follows the
// active dateFormat), a three-line answer slot, a history list that scrolls once it
// runs out of screen (with edge-fade indicators), and the shared Show Codes panel.
// All state is lifted to the parent and passed via props/callbacks, so this
// component is presentational + input-parsing only, and it OWNS no rendered text:
// labels and weekdays are all derived from the stored {y,m,d} against the live
// Date Format. A pre-reform date shows BOTH calendars' readings rather than one
// chosen by the Julian Calendar setting, which now reaches only the codes panel
// (codesUseJulian). Recognizes the Oct 5–14, 1582 gap ("Does Not Exist").
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
  // Lookup history scroll-state — the shared useScrollEdgeState (components/scrollRegion,
  // the settings-recipe edge listener). This region has BOTH boundary surfaces, one per edge,
  // and hands the hook a ref to each: the History header above the list and the Show Codes
  // section below it. Their shadows are continuous (--shade, round 10 item B) — the hook writes
  // each element's strength from the list's distance to that edge — so neither is derived from a
  // flag at the JSX any more. The two returned flags now drive ONE thing each:
  //   lookupHistoryScrolledFromTop → the list's top fade mask
  //   lookupHistoryAtBottom        → the list's bottom fade mask
  // `history` stands in as the hook's active key: the <ul> only exists with entries, so a
  // history change re-attaches the listener to a freshly (re)mounted list; the hook's
  // ResizeObserver covers the list being resized under the user — which now happens on every
  // screen-size change too, since the list's height is measured rather than capped.
  const lookupHistoryRef = React.useRef<HTMLUListElement>(null)
  const historyHeaderRef = React.useRef<HTMLDivElement>(null)
  const methodSectionRef = React.useRef<HTMLDivElement>(null)
  const { scrolledFromTop: lookupHistoryScrolledFromTop, atBottom: lookupHistoryAtBottom } =
    useScrollEdgeState(lookupHistoryRef, history, historyHeaderRef, methodSectionRef)
  // Codes-open is purely global state — it stays as-is when the user clicks through
  // history entries, only changing on (1) a manual toggle, (2) a brand-new lookup
  // via runLookup, or (3) MethodBreakdownSection's auto-close when the displayed
  // date becomes null (e.g., clicking a "Does Not Exist" gap entry). Earlier per-entry
  // tracking via calcOpenByEntry was removed because it made codes auto-close on
  // every history click that landed on an entry whose codes had never been opened.
  const sco =
    typeof onCalcOpenChange === 'function'
      ? (next: boolean) => onCalcOpenChange?.(!!next)
      : () => {}
  const lookupInputRef = React.useRef<HTMLInputElement>(null)
  // ★ WHAT ESCAPE IN THE DATE BOX DISCARDS BACK TO (round 17), and why it needs remembering.
  // This box is not a MIRROR of a stored value the way the ⚙ Year Range boxes are: those revert to
  // minY/maxY, a committed year sitting right beside the text. Here `inputValue` IS the text and
  // onChange overwrites it on every keystroke, so by the time Escape arrives the thing being
  // discarded back to exists nowhere — the same shape, and the same reason, as the AoX run-length
  // box's aoxNAtFocusRef (modes/AoxMode). Reverting to something convenient instead (empty, or the
  // last committed lookup) would be a different promise from the one every other field makes.
  // TWO THINGS SET THE BASELINE, and both of them are "the edit starts here":
  //   • the keyboard ENTERING the box — onFocus, below;
  //   • the CARD ITSELF writing the box — writeInput, below.
  // The second is load-bearing rather than tidy. Lookup and Clear both preventDefault their
  // mousedown, so a press on either leaves the keyboard exactly where it was: without it, pressing
  // Clear and then Escape would resurrect the very text Clear had just thrown away. The other two
  // card-writes (a Date Format change, picking a history row) reach it for the same reason.
  const lookupAtFocusRef = React.useRef('')
  // Every write to the box the CARD makes rather than the user. User typing goes straight to sli
  // (onChange) — it is the edit, not a new baseline for it — and everything else comes through
  // here, so the discard target can never drift from what is actually in the box.
  const writeInput = (v: string) => {
    sli(v)
    lookupAtFocusRef.current = v
  }
  // LookupCard uses module-level isLeap/dim/wday/numericFormatOf — no local duplicates.
  // Map any selected dateFormat to its corresponding Numeric format for input parsing.
  const numericFmtForInput = numericFormatOf(dateFormat)
  // Pattern + example based on which numeric format applies.
  const inputMeta = (() => {
    if (numericFmtForInput === 'numeric-mdy')
      return { label: 'm/d/y', example: '3/14/1592', sep: '/', orderType: 'mdy' }
    if (numericFmtForInput === 'numeric-dmy')
      return { label: 'd.m.y', example: '14.3.1592', sep: '.', orderType: 'dmy' }
    return { label: 'y-m-d', example: '1592-3-14', sep: '-', orderType: 'ymd' }
  })()
  // `entries` is `history` (stable per parent render) or the stable NO_ENTRIES const — never a
  // fresh [] — so the memos/effects that read it don't churn. Declared here, above the first
  // effect that reads it, rather than beside its heaviest consumer further down.
  const entries = Array.isArray(history) ? history : NO_ENTRIES
  // A Date Format change RE-FORMATS the card; it does not reset it. The selection survives,
  // because every string on screen — the answer line and every history row alike — is derived
  // from the stored {y,m,d} against the live format, so they all re-render in the new format
  // together. (That is the contract the How-to-Play guide and the changelog both state out loud;
  // clearing the selection here used to break it by making the answer line VANISH on a format
  // change rather than update.) The input is the one thing that has to be rewritten, since it is
  // always NUMERIC and its separator and field order just changed. With nothing selected there is
  // no date to rewrite, so the box is cleared instead — half-typed text in the old format would
  // no longer parse — along with any error message, which names the old format and is now wrong.
  // A ref, not a dep, so the initial mount doesn't wipe an input the user arrived with.
  const prevFormatRef = React.useRef(dateFormat)
  React.useEffect(() => {
    if (prevFormatRef.current === dateFormat) return
    prevFormatRef.current = dateFormat
    const selected = entries.find((e) => e.id === sid)
    if (selected) {
      writeInput(fmt(selected.y, selected.m, selected.d, numericFmtForInput))
      return
    }
    writeInput('')
    slo('')
    // Fire on dateFormat change only (the prevFormatRef guard also skips the initial mount). The
    // setters are re-created each render; excluding them keeps this from running every render,
    // and `entries`/`sid` are read at fire time on purpose — they are inputs to the rewrite, not
    // triggers for it.
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
    // The day check, on the EITHER-calendar rule: a date is real if it exists in a calendar this
    // date can be read in, so pre-reform February keeps Julian's 29th. It runs BEFORE the history
    // match on purpose — the match short-circuited ahead of it until now, which meant a date the
    // app refuses to CREATE became answerable the moment an entry for it happened to be stored:
    // same input, same settings, opposite outcome depending on the contents of a list. Validate
    // first, then look for a match, and the two answers cannot diverge. (The gap days pass this
    // check like any other October day — October has 31 of them in both calendars — and are picked
    // out below, which is where their "never existed" answer belongs.)
    const maxd = dimEither(yy, mm)
    if (dd < 1 || dd > maxd) {
      ssid(null)
      slo(`Day must be 1–${maxd} for ${MONTH[mm - 1]}`)
      lookupInputRef.current?.focus()
      return
    }
    // Every SUCCESSFUL path below clears lookupOutput and selects the entry instead: what is on
    // screen is derived from the selection (see selectedEntry), so lookupOutput is now purely the
    // transient "couldn't answer" message — leaving a stale error behind it would be dead state.
    // Matching on y/m/d alone is exactly right: an entry carries no calendar of its own to
    // disagree with, because the card shows every calendar the date can be read in.
    const existing = entries.find((e) => e.y === yy && e.m === mm && e.d === dd)
    if (existing) {
      if (onMoveHistory) onMoveHistory(existing.id)
      slo('')
      ssid(existing.id)
      if (existing.isGap) {
        scd(null)
        sco(false)
      } else scd({ y: yy, m: mm, d: dd })
      lookupInputRef.current?.blur()
      return
    }
    if (isGapDate(yy, mm, dd)) {
      const entry = { id: makeEntryId(), y: yy, m: mm, d: dd, isGap: true }
      slo('')
      scd(null)
      ssid(entry.id)
      sco(false)
      if (onAddHistory) onAddHistory(entry)
      lookupInputRef.current?.blur()
      return
    }
    const entry = { id: makeEntryId(), y: yy, m: mm, d: dd }
    slo('')
    scd({ y: yy, m: mm, d: dd })
    ssid(entry.id)
    sco(false)
    if (onAddHistory) onAddHistory(entry)
    lookupInputRef.current?.blur()
  }
  function clearLookup() {
    writeInput('')
    slo('')
    scd(null)
    ssid(null)
    sco(false)
  }
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
  // history row reads. The answer follows from the selection itself (selectedEntry), so
  // this only has to clear any error message the selection replaces.
  const selEntry = (entry: LookupEntry) => {
    if (!entry) return
    ssid(entry.id)
    slo('')
    if (entry.isGap) {
      scd(null)
    } else {
      scd({ y: entry.y, m: entry.m, d: entry.d })
    }
    writeInput(fmt(entry.y, entry.m, entry.d, numericFmtForInput))
    if (document.activeElement) (document.activeElement as HTMLElement).blur()
  }
  const clearHist = () => {
    if (onClearHistory) onClearHistory()
    ssid(null)
    scd(null)
    slo('')
    sco(false)
  }
  // The answer slot's subject: the selected entry, whose date line and reading lines are derived
  // fresh below. With nothing selected the slot falls back to the live output (which is now only
  // ever an error message or "") and then to the standing hint.
  const selectedEntry = React.useMemo(
    () => entries.find((e) => e.id === sid) ?? null,
    [entries, sid],
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
        if (entries.length === 0) return
        e.preventDefault()
        const idx = entries.findIndex((x) => x.id === sid)
        const next =
          e.key === 'ArrowDown'
            ? Math.min(entries.length - 1, (idx < 0 ? -1 : idx) + 1)
            : Math.max(0, (idx < 0 ? entries.length : idx) - 1)
        selEntry(entries[next])
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Clear the Lookup input box (matching what the Clear button does), NOT the history.
        // Only fires when the input doesn't have focus — when it does, Backspace/Delete edit
        // the input character-by-character as normal.
        // The guard asks "is there anything for Clear to undo?" — and since the answer sentence
        // now comes from the SELECTION rather than from lookupOutput, `sid` is part of that
        // question (lookupOutput holds an error message or nothing at all).
        if (!li && !lo && !cdv && !sid) return
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
  }, [entries, sid, li, lo, cdv])
  return (
    // The Lookup screen is a FIT-TO-SCREEN column, not a growing page: this root fills the height
    // its wrapper was given (main.tsx), the top card keeps its natural size, and the history panel
    // absorbs whatever is left — so the list scrolls INSIDE the panel and the page itself never
    // does. (space-y-4 → gap-4 because the root is a flex column now; and the old mt-1 is gone —
    // it used to margin-collapse into the wrapper's mt-5 and would have become a real 4px gap the
    // moment that wrapper turned into a flex container.)
    <div className="flex flex-col gap-4 flex-auto min-h-0">
      <div className="rounded-2xl panel p-4 space-y-4 shrink-0">
        <div className="flex flex-wrap items-stretch gap-2">
          {/* The date input wears the site-wide interactive-border rule (Q7 round-7): inputs are
              controls you act on, so it carries border surface-tray — the sbtn-bd tier its
              Lookup/Clear button neighbors share — never the container .panel it once borrowed
              (geometry unchanged: .panel's own 1px border became the explicit border token).
              text-base is DELIBERATE and states the tier out loud: this is the page's primary
              text-entry field, a size up from the compact text-sm steppers elsewhere, and it kept
              that size only by inheriting the root font. Same rendered size as before (1rem /
              line-height 1.5 is exactly what it inherited) — now it can't drift by accident.
              appearance-none (Q4 round-8) is the same kind of statement for behaviour: the box
              declares its own border, background and radius, so appearance:auto would be a false
              declaration that also leaves iOS's native inner shadow and focus treatment live. */}
          {/* ★ THE ESCAPE CONTRACT, AND THE GAP IT CLOSED (round 17 — the owner's call). This box
              is now on the same rule as every other typing surface in the app: Enter keeps the edit
              and lets go, Escape throws it away and lets go. Nothing in src/ or in How to Play
              names an exception any more, because there is no longer one.
              ⚠ THIS COMMENT USED TO SAY ENTER KEEPS FOCUS. IT NEVER DID — read runLookup: every
              exit path calls lookupInputRef.current?.blur() on success and .focus() on a refusal,
              so Enter has always meant "commit and let go" here, exactly as it does everywhere
              else, and the box only holds on when it has an error to show you. The claim was
              written while documenting this field as the app's Escape exception, and it was wrong
              on the day it was written; the owner caught it. Enter's behaviour is UNCHANGED by
              round 17 — only the description of it is.
              ⚠ ESCAPE REVERTS TO THE BASELINE, NOT TO EMPTY — see lookupAtFocusRef above for what
              sets that baseline and why it has to be captured rather than derived.
              ⚠ NO flushSync, AND THAT IS THE ONE PLACE THE ⚙ YEAR-BOX PRECEDENT DOES NOT CARRY.
              The year boxes need it because they commit ON BLUR: their revert and their blur landed
              in one React batch, so the commit still read the pre-revert text and re-committed the
              value Escape was discarding. This input has NO onBlur at all — blurring it commits
              nothing — so there is no commit to lose the race to, and forcing a synchronous render
              here would be cargo cult.
              ⚠ IT STOPS PROPAGATION, the same term the year boxes carry (round 14) and the AoX run
              length repeated (round 15) — but read the next paragraph before believing the reason
              that used to be written here. App's Escape listener (main.tsx) is a document keydown in
              the BUBBLE phase that asks "does a text input have focus?" to decide the press is not
              its own; blur() below has already run by then, so without the stop it would find
              nothing focused and close the ⚙ panel on a press meant for this box.
              ⚠ THAT ORDER IS NO LONGER REACHABLE FROM THIS BOX. It required the keyboard to be
              ALREADY here when the panel opened — true on iOS and Safari, where tapping the gear
              does not move focus — and round 18 (1D) closed it on the owner's report: opening ANY
              overlay now takes the keyboard down, once, in the app's open-overlay registry
              (dismissKeyboard inside pushOverlay, components/useBackButton). The stop stays because
              it is one term of a contract six boxes share and four of them — both Year Range
              fields, the Save Defaults N field, every tap-to-type readout — sit INSIDE the panel,
              where it is reachable every time; the argument in full is at the AoX run-length box
              (modes/AoxMode), which lost the same path on the same day. Nothing else is lost by
              stopping it — VERIFIED rather than
              assumed: App's other keydown listener (the letter/mode map, on window) returns early
              for any INPUT and has no Escape branch at all; this card's own document listener bails
              the same way; CustomSelect's Escape is a React handler on its own trigger, which Tab
              moves focus to, so it can never be waiting on a press from in here; and the four
              settings-modal handlers are CAPTURE phase, so they have already run and cannot be
              stopped by anything here anyway (the two that can coexist with a focused text field
              carve one out themselves). */}
          <input
            ref={lookupInputRef}
            value={li}
            onChange={(e) => sli(e.target.value)}
            onFocus={() => {
              lookupAtFocusRef.current = li
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runLookup()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                writeInput(lookupAtFocusRef.current)
                e.currentTarget.blur()
              }
            }}
            placeholder={`e.g., ${inputMeta.example}`}
            className="appearance-none border surface-tray rounded-xl px-3 py-2 text-base focus:outline-hidden focus-ring flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={runLookup}
            onMouseDown={(e) => e.preventDefault()}
            className="px-4 py-2 rounded-xl btn-solid text-sm font-medium"
          >
            Lookup
          </button>
          {/* Clear is the row's NEUTRAL solid, deliberately not the brand fill Lookup wears. The
              grey now comes from --nbtn-bg (Q4 round-8, index.css) instead of a raw zinc utility,
              so a theme can reach it; text-white stays because this fill is a raw colour, not one
              of the theme-aware surfaces that set their own text colour. (Naming the retired
              utility in prose would re-emit its dead rule — the v4 scanner reads comments too.) */}
          <button
            type="button"
            onClick={clearLookup}
            onMouseDown={(e) => e.preventDefault()}
            className="px-4 py-2 rounded-xl bg-(--nbtn-bg) text-white text-sm font-medium"
          >
            Clear
          </button>
        </div>
        {/* The answer slot is ALWAYS rendered, at a constant THREE-line height, so the card below it
            never jumps. Three EXPLICIT ROWS, not a sentence that happens to wrap: row 1 is always
            the formatted date, rows 2–3 the reading(s) — one for a post-reform date (the third row
            stays empty), one per calendar for an ambiguous one. The old two-line reserve held a
            sentence whose line count depended on the font, the width, the month name and the
            weekday length, so it survived by tuning; rows make the height a property of the
            structure instead. Measured at 375px, where the slot is 310px wide: the longest line
            that can land here is 'Gregorian: Does Not Exist' at 156.7px, so no reading line can
            wrap on any phone this app supports, and the gap message below is the same two lines it
            has always been. min-h-15 (3.75rem) is three text-sm line boxes and, being a scale
            utility, tracks the fluid root font instead of freezing a pixel height.
            TOP-ALIGNED, never centred: the date and the first reading then land in the same place
            every time and only the unused third row varies. Centring would drift the whole block
            with its content — exactly the instability round 8 removed. Errors and the empty-state
            hint are plain text in the same slot; the hint takes the dimmer tone. */}
        <div
          className={`text-sm min-h-15 ${selectedEntry || lo ? 'text-(--tx-100-90)' : 'text-(--tx-200-70)'}`}
        >
          {selectedEntry ? (
            <>
              <div>{entryLabel(selectedEntry, fmtDate)}</div>
              {selectedEntry.isGap ? (
                <div>{GAP_MSG}</div>
              ) : (
                entryReadings(selectedEntry).map((r) => (
                  <div key={r.label}>{r.label ? `${r.label}: ${r.weekday}` : r.weekday}</div>
                ))
              )}
            </>
          ) : (
            lo || LOOKUP_HINT
          )}
        </div>
        <p className="text-xs text-(--tx-100-90)">
          Format: <b>{inputMeta.label}</b>
          <br />
          AD dates only, 1–10000
        </p>
      </div>
      {/* The history panel takes its natural height and SHRINKS to fit when the column runs out
          of room (min-h-0 lets it; the <ul> inside absorbs the shrink and scrolls) — it does not
          grow, so with one entry the card still hugs its content instead of stretching to the
          bottom of the screen. space-y-4 → gap-4 now that it's a flex column. */}
      <div className="rounded-2xl panel py-4 gap-4 flex flex-col min-h-0">
        {/* History panel on the shared scroll-region recipe (Q5 round-7,
            components/scrollRegion): the panel owns py-4 only, and every child carries its
            own px-4 — for the scrolling <ul> below that puts the 1rem right padding INSIDE
            the scroller, the text-free lane the iOS scrollbar paints in. Content widths are
            unchanged; the pre-Q5 p-4 parent plus -mx-4 counter-margins on the header and
            method section produced the same geometry with the lane OUTSIDE the scroller. */}
        {/* History header: with the panel padding vertical-only, the header's own px-4 spans
            the full panel width, so its divider line cuts edge-to-edge on its own.
            elev-shadow-down + the divider line together signal "fixed header above content
            scrolling below" — same pattern as the popover sticky footer's elev-shadow-up. The
            class is UNCONDITIONAL: strength comes from the --shade the edge hook writes onto
            this element, so there is no toggle and no transition (round 10 item B). The
            lookup-history-header class survives as the stable name for this boundary surface —
            it is what the tests select — and no longer as a CSS transition hook.
            THE COUNT is INSIDE the History span, not a third flex child: the row is
            justify-between, so a third child would redistribute the whole header. As inline text
            at the row's own 11px tier it shares the line box the header already had, and
            whitespace-nowrap is what keeps that true at every width — a wrap is the one way this
            could grow the header, and a header that changes height under a shadow it casts onto
            the list below is exactly the reflow worth designing out (the same by-construction rule
            the history rows below follow). It appears from the SECOND entry on (a "(1)" beside
            a list you can see has one row is noise) and stops at the cap, where it simply reads
            (100). Dimmer than the label it follows — --tx-300-60 is the footnote tier, a step down
            from the header's own --tx-200-70 in every theme — so it reads as a detail about the
            heading rather than part of it. */}
        <div
          ref={historyHeaderRef}
          className="lookup-history-header elev-shadow-down shrink-0 px-4 pb-3 border-b border-(--bd-500-40) flex items-center justify-between text-[11px] uppercase tracking-wide text-(--tx-200-70)"
        >
          <span className="whitespace-nowrap">
            History
            {entries.length > 1 && (
              <span className="text-(--tx-300-60)">{` (${entries.length})`}</span>
            )}
          </span>
          {entries.length > 0 && (
            <button type="button" onClick={clearHist} className="text-(--tx-200-70) font-medium">
              Clear History
            </button>
          )}
        </div>
        {/* The list is the part that gives: it takes the room the header and the method section
            below it don't need, and scrolls past that. It used to carry a fixed 440-pixel
            max-height — one number, too tall on a small phone and leaving screen unused on a big
            one, and the fluid-root font system had no way to scale it. Measured layout replaces
            it; tests/heightGuard.test.js keeps pixel heights from creeping back. */}
        {entries.length > 0 ? (
          <ul
            ref={lookupHistoryRef}
            className={`${SCROLL_REGION_CLASS} space-y-2 flex-auto min-h-0 ${scrollFadeClass(lookupHistoryScrolledFromTop, lookupHistoryAtBottom)}`}
          >
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => selEntry(e)}
                  // The unselected arm used to also carry `hist-unsel`, a custom class that reset
                  // border-left-color to --panel-bd. It was a pure no-op in both directions:
                  // .panel's `border` shorthand already sets that exact colour, and the
                  // border-l-(--acc) it existed to undo is only ever on the OTHER arm. It was
                  // written while the whole selected treatment was invisible (the cascade-layer
                  // regression — see the ★★ block in src/index.css), which is how a rule that
                  // undoes nothing came to look necessary. Both the class and its CSS are gone.
                  className={`w-full text-left px-3 py-2 rounded-xl panel flex items-center justify-between gap-3 text-xs transition ${sid === e.id ? 'border-l-2 border-l-(--acc) bg-(--hist-sel)' : 'hover:bg-(--hist-hov)'}`}
                >
                  {/* Every row is exactly one line tall, by construction rather than by fitting:
                      the readings never wrap and never shrink (a two-reading line is the whole
                      point of the row), and the date label is the side that gives — truncate ends
                      it with an ellipsis instead of pushing the readings out of the panel. The
                      measurement in entryRowReadings says nothing reachable actually needs the
                      truncation; it is here so that a row's height can never depend on its
                      content, which in a scrolling list is the failure worth designing out. */}
                  <span className="block min-w-0 truncate text-[13px] font-medium text-(--tx-100-90)">
                    {entryLabel(e, fmtDate)}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-(--tx-200-80)">
                    {entryRowReadings(e)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 text-sm text-(--tx-200-70)">No lookups yet</p>
        )}
        {/* MethodBreakdownSection wrapper: its px-4 spans the vertical-only-padded panel
            full-width, so the existing border-t divider cuts edge-to-edge on its own.
            elev-shadow-up signals "fixed footer below content scrolling above" — unconditional
            like the header's, and driven by the same hook writing --shade onto this element
            through the ref below. lookup-method-section is the boundary surface's stable name
            (the tests select it), no longer a transition hook. */}
        <MethodBreakdownSection
          ref={methodSectionRef}
          date={cdv}
          className="lookup-method-section elev-shadow-up shrink-0 px-4 pt-4 border-t border-(--bd-500-40)"
          contentClassName="mt-3 rounded-2xl panel px-4 pt-[3px] pb-1.5"
          open={cov}
          onOpenChange={sco}
          useJulian={codesUseJulian(cdv, useJulian)}
          displayedFormat={dateFormat}
        />
      </div>
    </div>
  )
}
