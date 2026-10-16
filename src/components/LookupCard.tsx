import * as React from 'react'
import { fmt, MONTH, DAY, numericFormatOf } from '../lib/format.js'
import {
  dim,
  dimEither,
  wday,
  wdayJulian,
  isJulianDate,
  isGapDate,
  yearMaxFor,
  YEAR_MAX_GREGORIAN,
  YEAR_MAX_JULIAN,
} from '../lib/calendar.js'
import { MethodBreakdownSection, type CodeDate } from './MethodBreakdown.jsx'
import {
  SCROLL_REGION_CLASS,
  scrollFadeClass,
  useScrollEdgeState,
  useWindowedRows,
} from './scrollRegion.js'
import { isPageCovered } from './overlayStack.js'
import {
  makeRuler,
  setRows,
  widestRow,
  widestDigit,
  largestFit,
  watchTextRoom,
  refitTextRoom,
} from '../lib/textFit.js'
import { shortcutActed } from '../lib/keyboardFocus.js'
import type { FormatId } from '../lib/format.js'
// The history entry's persisted shape lives with the store that versions and migrates it
// (store/lookupHistory) — it is {id, y, m, d, isGap?} and nothing else. Everything shown on screen
// is derived from those inputs by entryLabel/entryReadings below, against the LIVE Date Format. The
// store also guarantees the date is REAL (normalizeLookupEntries), which is what lets the readings
// treat "this calendar has no such date" as a fact about the calendar rather than about the data.
// ⚠ `history` ARRIVES ALREADY MERGED (round 20): the caller combines the shared permanent list
// with this browsing session's amnesic-suppressed overflow (store/lookupHistory's `mergeForDisplay`)
// before it ever reaches this component, so nothing here needs to know two buckets exist.
import type { LookupEntry } from '../store/lookupHistory.js'

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
  // The Date Format the box's text was last written in (null: none yet), and its setter — kept by
  // the caller with the rest of the screen, because it has to outlive this card (see the
  // format-change rule in the component).
  inputFormat?: string | null
  onInputFormatChange?: (format: FormatId) => void
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
// …and the HISTORY ROW's word for it beside a calendar's letter: "G: none" (the owner's wording,
// Round 26 — "G: Does Not Exist" was the row that ran out of room first). The answer slot above, and
// every row's name for a screen reader (rowName), still say it in full. A gap entry has no letter
// to stand beside, so its row says NO_READING in full, as before.
const ROW_NO_READING = 'none'

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
  shortWeekday: string // the row's form: 'Wed', or ROW_NO_READING — see entryRowReadings
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
  // Three letters is the whole abbreviation rule (Sunday → Sun). A missing date is not cut to three
  // letters ("Doe" would be nonsense): it is a statement about the date, not a weekday, so the row
  // has its own short word for it, ROW_NO_READING.
  shortWeekday: exists ? DAY[dayIndex].slice(0, 3) : ROW_NO_READING,
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
// Rows abbreviate where a date has two readings — 'J: Wed · G: Sun', 'J: Mon · G: none' — so a row
// is one line on a narrow phone; the spelled-out form lives in the answer slot directly above, so
// the compact form has somewhere to be learned from. A row with only ONE reading keeps the full
// weekday: nothing is competing for the space. Wrapping is not the answer: it would give this one
// scrolling list two different row heights. Whether a row FITS is not left to these words being
// short enough in some font: the rows are sized to their room in the device's own font
// (fitRows, below).
const rowReading = (shortLabel: string, shortWeekday: string) => `${shortLabel}: ${shortWeekday}`
const entryRowReadings = (e: LookupEntry): string =>
  e.isGap
    ? NO_READING
    : entryReadings(e)
        .map((r) => (r.label ? rowReading(r.shortLabel, r.shortWeekday) : r.weekday))
        .join(' · ')
// The row's name for a screen reader: its date and its readings, spelled out as the answer slot
// spells them ("Julian: Monday, Gregorian: Does Not Exist") — "J: Mon · G: none" read aloud is a
// string of letters, and the row's words are only short because a screen is narrow.
const rowName = (e: LookupEntry, fmtDate?: (y: number, m: number, d: number) => string) =>
  `${entryLabel(e, fmtDate)}: ${
    e.isGap
      ? NO_READING
      : entryReadings(e)
          .map((r) => (r.label ? `${r.label}: ${r.weekday}` : r.weekday))
          .join(', ')
  }`

// ★ THE ROWS ARE SIZED TO THEIR ROOM, IN THE DEVICE'S OWN FONT (Round 26). A row is one line by
// construction, and its date is never cut: where the WIDEST ROW THE LIST CAN HOLD would not fit the
// list at full size, every row's text is drawn smaller by the one scale at which it does
// (--lookup-fit, set on the list; lib/textFit measures and watches). The widest row is found from
// SHAPES, not from the entries saved: for the Date Format in use, each kind of row a date can
// make — a date before the 1582 reform (a year of at most four digits, two readings), one after it
// (a year of up to five, one full weekday), and the ten dates the reform skipped (NO_READING) —
// with every month, and every digit written as the font's widest. So looking a date up never
// changes the size, and no date anyone can look up is cut, whatever the font. (Measured before
// this: "February 29, 1300 — J: Mon · G: Does Not Exist" was cut below ~375px wide at a full root,
// and wider with the iPhone's font.)
// ⚠ A FIT NEVER CHANGES A ROW'S HEIGHT: each text's line height is pinned at its full-size value
// (the row's text-xs line height, 4/3 of the size), so a fitted row is exactly as tall as an
// unfitted one. That is not tidiness. useWindowedRows draws the rows out of view as their count
// times ONE measured row's pitch, and measures again only when the list's own box resizes — and a
// fit can arrive without that (a Date Format change, a font that finishes loading). A row whose
// height followed its text would leave the spacers at the old pitch, and the rows would jump as
// the list scrolled. (It is also textFit's rule: a fit sizes text inside a box that does not move.)
const ROW_CLASS =
  'w-full text-left px-3 py-2 rounded-xl panel flex items-center justify-between gap-3 text-xs transition'
// The selected row's edge is the widest a row's frame gets, so it is the frame measured.
const ROW_SELECTED_CLASS = 'border-l-2 border-l-(--acc) bg-(--hist-sel)'
// The root's scale, pinned to a standard phone (13px and 12px at its 16.458px root), times the fit;
// each line height is the full size's, never the fit's (the ⚠ above).
const ROW_LABEL_CLASS =
  'block min-w-0 truncate text-[length:calc(13rem/16.458*var(--lookup-fit,1))] leading-[calc(13rem/16.458*4/3)] font-medium text-(--tx-100-90)'
const ROW_READINGS_CLASS =
  'shrink-0 whitespace-nowrap text-[length:calc(12rem/16.458*var(--lookup-fit,1))] leading-[calc(12rem/16.458*4/3)] font-semibold text-(--tx-200-80)'

type RowKind = { labels: string[]; readings: string[] }
const SHORT_DAYS = DAY.map((d) => d.slice(0, 3))
const TOP_YEAR = Math.max(YEAR_MAX_GREGORIAN, YEAR_MAX_JULIAN)
const rowKinds = (fmtDate?: (y: number, m: number, d: number) => string): RowKind[] => {
  const label = (y: number, m: number, d: number) => entryLabel({ id: '', y, m, d }, fmtDate)
  const months = MONTH.map((_, i) => i + 1)
  return [
    {
      labels: months.map((m) => label(1000, m, 10)),
      readings: SHORT_DAYS.flatMap((j) =>
        [...SHORT_DAYS, ROW_NO_READING].map((g) => `${rowReading('J', j)} · ${rowReading('G', g)}`),
      ),
    },
    { labels: months.map((m) => label(TOP_YEAR, m, 10)), readings: [...DAY] },
    {
      labels: Array.from({ length: 10 }, (_, i) => label(1582, 10, 5 + i)),
      readings: [NO_READING],
    },
  ]
}

// Two rulers (lib/textFit): one for a single text in a row's type, one for whole rows.
let textRuler: HTMLElement | null = null
let rowRuler: HTMLElement | null = null
const rowElement = (label: string, readings: string) => {
  const row = document.createElement('div')
  row.className = `${ROW_CLASS} ${ROW_SELECTED_CLASS}`
  for (const [className, text] of [
    [ROW_LABEL_CLASS, label],
    [ROW_READINGS_CLASS, readings],
  ]) {
    const span = document.createElement('span')
    span.className = className
    span.textContent = text
    row.append(span)
  }
  return row
}
const widestText = (texts: string[], className: string): string => {
  textRuler!.className = className
  setRows(textRuler!, texts)
  const widths = [...textRuler!.children].map((r) => r.getBoundingClientRect().width)
  return texts[widths.indexOf(Math.max(...widths))]
}
// Fit the list `ul` (its content width `room`) to the widest row its kinds can make. A row is its
// two texts side by side, so its widest is the widest label beside the widest readings of its kind;
// those rows are then measured whole, in a row's own frame, at each scale tried.
function fitRows(ul: HTMLElement, room: number, kinds: RowKind[]): void {
  textRuler ??= makeRuler(ROW_LABEL_CLASS)
  rowRuler ??= makeRuler()
  textRuler.className = ROW_LABEL_CLASS
  const digit = widestDigit(textRuler)
  const widest = kinds.map((k) => ({
    label: widestText(
      k.labels.map((l) => l.replace(/\d/g, digit)),
      ROW_LABEL_CLASS,
    ),
    readings: widestText(k.readings, ROW_READINGS_CLASS),
  }))
  rowRuler.replaceChildren(...widest.map((w) => rowElement(w.label, w.readings)))
  const scale = largestFit(room, (s) => {
    rowRuler!.style.setProperty('--lookup-fit', String(s))
    return widestRow(rowRuler!)
  })
  if (scale < 1) ul.style.setProperty('--lookup-fit', String(scale))
  else ul.style.removeProperty('--lookup-fit')
}

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

// The history list — every lookup ever made on this device, newest first, with no limit.
//
// THE LIST IS THE PART OF THE PAGE THAT GIVES: it takes the room the heading above it does not need,
// and scrolls past that (measured flex layout, never a pixel max-height — tests/heightGuard).
//
// ★ IT IS WINDOWED (components/scrollRegion's useWindowedRows). Only the rows in and near view are
// drawn; two blank spacers stand in for the rest, so the list is exactly as tall as if every row
// were there and a history of thousands scrolls like one of ten. Everything a row needs is derived
// from its entry, so a row scrolled away and drawn again is the same row.
//   • SELECTION is the caller's (an id), not the DOM's — it is true of a row whether or not that
//     row is drawn, which is what lets a reload come back to a selected row far down the list.
//   • THE SELECTED ROW IS BROUGHT INTO VIEW when the selection changes (arrowing through the list,
//     a new lookup landing at the top) and centred when the list first appears with one selected.
//   • aria-setsize / aria-posinset tell a screen reader the row's place in the WHOLE list, which it
//     could otherwise only count from the rows that happen to be drawn.
//   • The two edge fades are the shared recipe's (useScrollEdgeState) and read the full height.
// `entries` stands in as the edge hook's active key, so the listener re-attaches whenever the list
// changes; its extent observer covers the list being resized under the user — a screen-size change,
// or Show Codes opening in the card above and taking the list's room.
// There are NO boundary surfaces: the list is not framed by lines or shadows, as on every other
// page — the fades already say "there is more this way".
function LookupHistoryList({
  entries,
  selectedId,
  onSelect,
  fmtDate,
}: {
  entries: LookupEntry[]
  selectedId: string | null
  onSelect: (entry: LookupEntry) => void
  fmtDate?: (y: number, m: number, d: number) => string
}) {
  const listRef = React.useRef<HTMLUListElement>(null)
  const { scrolledFromTop, atBottom } = useScrollEdgeState(listRef, entries)
  // The kinds of row this list can hold, in the Date Format in use — kept current for the fit, and
  // a change of them (a Date Format change) fits the list again before the frame is drawn.
  const kinds = rowKinds(fmtDate)
  const kindsKey = kinds.map((k) => k.labels.join('|')).join('/')
  const kindsRef = React.useRef(kinds)
  React.useLayoutEffect(() => {
    kindsRef.current = kinds
  })
  React.useLayoutEffect(
    () =>
      watchTextRoom(listRef.current, (room) => fitRows(listRef.current!, room, kindsRef.current)),
    [],
  )
  React.useLayoutEffect(() => {
    if (listRef.current) refitTextRoom(listRef.current)
  }, [kindsKey])
  const selectedIndex = selectedId === null ? -1 : entries.findIndex((e) => e.id === selectedId)
  const { start, end, padTop, padBottom } = useWindowedRows(
    listRef,
    entries.length,
    selectedIndex,
    selectedId,
  )
  return (
    <ul
      ref={listRef}
      className={`${SCROLL_REGION_CLASS} pb-px flex-auto min-h-0 ${scrollFadeClass(scrolledFromTop, atBottom)}`}
    >
      {padTop > 0 && <li aria-hidden="true" role="presentation" style={{ height: padTop }} />}
      {entries.slice(start, end).map((e, i) => {
        const index = start + i
        return (
          // mt-2 on every row but the list's first is the gap between rows — a margin on the row
          // itself rather than a space-y utility on the list, which would also space the spacers.
          <li
            key={e.id}
            data-row={index}
            aria-setsize={entries.length}
            aria-posinset={index + 1}
            className={index > 0 ? 'mt-2' : undefined}
          >
            <button
              type="button"
              aria-label={rowName(e, fmtDate)}
              onClick={() => onSelect(e)}
              className={`${ROW_CLASS} ${selectedId === e.id ? ROW_SELECTED_CLASS : 'hover:bg-(--hist-hov)'}`}
            >
              {/* Every row is exactly one line tall: the readings never wrap, and the date label
                  is the side that would give — truncate would end it with an ellipsis rather
                  than push the readings out of the panel. fitRows (above) sizes the rows so that
                  no row any date can make needs it, in any font; it stays so that a row's height
                  can never depend on its content — which a scrolling list wants anyway, and a
                  WINDOWED one requires: the undrawn rows are stood in for by their count times
                  one row's height. */}
              <span className={ROW_LABEL_CLASS}>{entryLabel(e, fmtDate)}</span>
              <span className={ROW_READINGS_CLASS}>{entryRowReadings(e)}</span>
            </button>
          </li>
        )
      })}
      {padBottom > 0 && <li aria-hidden="true" role="presentation" style={{ height: padBottom }} />}
    </ul>
  )
}

// LookupCard — the Lookup-mode card: a numeric date input (format follows the
// active dateFormat) with the note saying what it takes, a three-line answer slot
// with the shared Show Codes panel right under it, and a history list that scrolls
// once it runs out of screen (with edge-fade indicators).
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
  inputFormat = null,
  onInputFormatChange,
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
  // The highest year the box accepts (the Julian Calendar setting's cap).
  const yearMax = yearMaxFor(useJulian)
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
  // The second is load-bearing rather than tidy. Lookup and Clear both carry data-keep-focus (the
  // press controller, lib/pointerGestures, cancels their mousedown and makes its own presses of them
  // without moving focus), so a press on either leaves the keyboard exactly where it was: without it, pressing
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
  // ★ "CHANGED" MEANS: THE LIVE FORMAT IS NOT THE ONE THE BOX'S TEXT WAS WRITTEN IN (`inputFormat`,
  // which the caller keeps with the rest of the screen). So the rule is ONE rule for every way the
  // two can come to differ — the setting changed with this card on screen, or while it was away
  // (another page, and the card remounts), or the player opened another PRESET with its own Date
  // Format (the screen is the app's, not a preset's — store/sessionLookup). It used to remember the
  // format in a ref of its own, seeded at mount, so a card that came back under a different format
  // kept old-format text in the box, where it no longer parsed. The first time the card is ever on
  // screen there is no text yet (`inputFormat` null): the format is noted and nothing is touched.
  React.useEffect(() => {
    if (inputFormat === dateFormat) return
    onInputFormatChange?.(dateFormat)
    if (inputFormat === null) return
    const selected = entries.find((e) => e.id === sid)
    if (selected) {
      writeInput(fmt(selected.y, selected.m, selected.d, numericFmtForInput))
      return
    }
    writeInput('')
    slo('')
    // Fire at mount and on a dateFormat change. The setters are re-created each render; excluding
    // them keeps this from running every render, and `entries`/`sid`/`inputFormat` are read at fire
    // time on purpose — they are inputs to the rewrite, not triggers for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFormat])
  // A lookup the card cannot answer: the message takes the answer slot, and NOTHING OF THE PREVIOUS
  // DATE STAYS UNDER IT — not its selection, and not its Show Codes panel, which used to stay open
  // beneath the error, still explaining the date before. The box keeps the keyboard so the text can
  // be fixed without reaching for it again.
  const refuse = (message: string) => {
    ssid(null)
    scd(null)
    sco(false)
    slo(message)
    lookupInputRef.current?.focus()
  }
  function runLookup() {
    const s = li.trim()
    // Build regex based on the input format. Year accepts 1–5 digits, month/day 1–2 digits.
    const sepEsc = inputMeta.sep === '.' ? '\\.' : inputMeta.sep === '-' ? '-' : '/'
    let match: RegExpExecArray | null
    if (inputMeta.orderType === 'ymd')
      match = new RegExp(`^(\\d{1,5})${sepEsc}(\\d{1,2})${sepEsc}(\\d{1,2})$`).exec(s)
    else match = new RegExp(`^(\\d{1,2})${sepEsc}(\\d{1,2})${sepEsc}(\\d{1,5})$`).exec(s)
    if (!match) return refuse(`Enter date as ${inputMeta.label}, e.g. ${inputMeta.example}`)
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
    // The highest year is the Julian Calendar setting's (lib/calendar's caps): 11582 with it on,
    // 10000 with it off. Typing is what is refused — a date past 10000 already in the history (one
    // looked up with the setting on) stays there, and a tap on it still shows it.
    if (yy < 1 || yy > yearMax) return refuse(`Year must be between 1 and ${yearMax}`)
    if (mm < 1 || mm > 12) return refuse('Month must be 1–12')
    // The day check, on the EITHER-calendar rule: a date is real if it exists in a calendar this
    // date can be read in, so pre-reform February keeps Julian's 29th. It runs BEFORE the history
    // match on purpose — the match short-circuited ahead of it until now, which meant a date the
    // app refuses to CREATE became answerable the moment an entry for it happened to be stored:
    // same input, same settings, opposite outcome depending on the contents of a list. Validate
    // first, then look for a match, and the two answers cannot diverge. (The gap days pass this
    // check like any other October day — October has 31 of them in both calendars — and are picked
    // out below, which is where their "never existed" answer belongs.)
    const maxd = dimEither(yy, mm)
    if (dd < 1 || dd > maxd) return refuse(`Day must be 1–${maxd} for ${MONTH[mm - 1]}`)
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
  // ★ THEY ARE PAGE SHORTCUTS, AND THEY STAND ASIDE LIKE THE REST OF THEM — one rule for these and
  // for the game keys (components/overlayStack's isPageCovered; src/main.tsx's keyboard handler asks
  // the same question for its own):
  //   • A POPUP OR THE ⚙ MENU IS OPEN ⇒ the page behind it is out of reach. These keys used to act
  //     straight through one: in Manage Presets, ↓ on a reorder grip moved the preset AND the Lookup
  //     selection behind the dim (and selecting blurs whatever has the keyboard, so the grip lost it
  //     too), Backspace emptied the card under any popup — and under the ⚙ menu all four still did.
  //   • ONE THAT ACTS SAYS SO (lib/keyboardFocus's shortcutActed), as the game keys do: using a
  //     shortcut is not finding your way round by keyboard, so it puts the focus ring out.
  //   • A CONTROL ALREADY USED THE KEY ⇒ it is not also a shortcut. An open dropdown list walks its
  //     options with ↑/↓ and says so by preventing the key's default; this listener sits on the
  //     document, after every control's own handler, so it can see that and leave the press alone.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isPageCovered()) return
      const ae = document.activeElement as HTMLElement | null
      const inInput =
        ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      if (inInput) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (entries.length === 0) return
        e.preventDefault()
        shortcutActed()
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
        shortcutActed()
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
          {/* The date input wears the site-wide interactive-border rule (round 7): inputs are
              controls you act on, so it carries border surface-tray — the sbtn-bd tier its
              Lookup/Clear button neighbors share — never the container .panel it once borrowed
              (geometry unchanged: .panel's own 1px border became the explicit border token).
              text-base is DELIBERATE and states the tier out loud: this is the page's primary
              text-entry field, a size up from the compact text-sm steppers elsewhere, and it kept
              that size only by inheriting the root font. Same rendered size as before (1rem /
              line-height 1.5 is exactly what it inherited) — now it can't drift by accident.
              appearance-none (round 8) is the same kind of statement for behaviour: the box
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
              ⚠ NOTHING ELSE ANSWERS THIS PRESS. Escape also closes the top open layer
              (components/overlayStack), but that rule stands aside whenever a text box has the
              keyboard — and opening any layer takes the keyboard away from this box first, so the
              two can never be waiting on the same press. */}
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
                writeInput(lookupAtFocusRef.current)
                e.currentTarget.blur()
              }
            }}
            placeholder={`e.g., ${inputMeta.example}`}
            className="appearance-none border surface-tray rounded-xl px-3 py-2 text-base flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={runLookup}
            data-keep-focus
            className="px-4 py-2 rounded-xl btn-solid text-sm font-medium"
          >
            Lookup
          </button>
          {/* Clear is the row's NEUTRAL solid, deliberately not the brand fill Lookup wears. The
              grey now comes from --nbtn-bg (round 8, index.css) instead of a raw zinc utility,
              so a theme can reach it; text-white stays because this fill is a raw colour, not one
              of the theme-aware surfaces that set their own text colour. (Naming the retired
              utility in prose would re-emit its dead rule — the v4 scanner reads comments too.) */}
          <button
            type="button"
            onClick={clearLookup}
            data-keep-focus
            className="px-4 py-2 rounded-xl bg-(--nbtn-bg) text-white text-sm font-medium"
          >
            Clear
          </button>
        </div>
        {/* What the box takes, DIRECTLY UNDER THE BOX IT DESCRIBES. It belongs to the input — it is
            the answer to "how do I type this?" — so it stays with it, above the answer, rather than
            at the foot of the card, where Show Codes opening under the answer carried it a whole
            codes panel away from the box. */}
        <p className="text-xs text-(--tx-100-90)">
          Format: <b>{inputMeta.label}</b>
          <br />
          AD dates only, 1–{yearMax}
        </p>
        {/* The answer slot is ALWAYS rendered, at a constant THREE-line height, so nothing under it
            ever jumps — not Show Codes, and not the history list (which would otherwise shift under
            the very row being tapped whenever the answer changed length). Three EXPLICIT ROWS, not a
            sentence that happens to wrap: the formatted date, then the reading(s) — one for a
            post-reform date, one per calendar for an ambiguous one. The old two-line reserve held a
            sentence whose line count depended on the font, the width, the month name and the
            weekday length, so it survived by tuning; rows make the height a property of the
            structure instead. Measured at 375px, where the slot is 310px wide: the longest line
            that can land here is 'Gregorian: Does Not Exist' at 156.7px, so no reading line can
            wrap on any phone this app supports, and the gap message below is the same two lines it
            has always been. min-h-15 (3.75rem) is three text-sm line boxes and, being a scale
            utility, tracks the fluid root font instead of freezing a pixel height.
            ★ BOTTOM-ALIGNED: the text sits at the FOOT of the slot, on top of Show Codes, and the
            rows it does not need are left above it. Show Codes explains the answer, so the two
            belong together — top-aligned, an ordinary two-line answer left its spare third row as a
            blank line between the weekday and the button that explains it. The weekday (the last
            row, the thing that was asked for) lands in the same place every time, and the spare
            space reads as the break between the input above and the answer below. Never CENTRED:
            that would drift both ends of the block with its content. Errors and the empty-state
            hint are plain text in the same slot; the hint takes the dimmer tone. */}
        <div
          className={`text-sm min-h-15 flex flex-col justify-end ${selectedEntry || lo ? 'text-(--tx-100-90)' : 'text-(--tx-200-70)'}`}
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
            <div>{lo || LOOKUP_HINT}</div>
          )}
        </div>
        {/* Show Codes, DIRECTLY UNDER THE ANSWER IT EXPLAINS — the same full-width
            button and the same thin inset panel every game mode puts under its controls, where it
            used to sit walled off at the foot of the history panel. This card is shrink-0, so
            opening the codes grows it and the history panel below gives up the room (it is the
            column's min-h-0 flex child, and its list scrolls). lookup-method-section is a stable
            NAME only, not a style hook: it is what the tests select the section by. */}
        <MethodBreakdownSection
          date={cdv}
          className="lookup-method-section"
          open={cov}
          onOpenChange={sco}
          useJulian={codesUseJulian(cdv, useJulian)}
          displayedFormat={dateFormat}
        />
      </div>
      {/* The history panel takes its natural height and SHRINKS to fit when the column runs out
          of room (min-h-0 lets it; the <ul> inside absorbs the shrink and scrolls) — it does not
          grow, so with one entry the card still hugs its content instead of stretching to the
          bottom of the screen. Opening Show Codes in the card above is one of the things that
          takes that room. space-y-4 → gap-4 now that it's a flex column. */}
      {/* ⚠ pb-px ON THE LIST AND THE 1px TAKEN BACK HERE (Round 26) — the ⚙ menu's scroll-end fix
          (components/SettingsPanel), measured here too: the list's height is fractional (what the
          column has left) while the furthest scroll position is a whole pixel, so scrolled to the
          end, up to a pixel of the last row's bottom border stayed under the list's edge (0.02 to
          0.9px at 360 wide, Chromium and WebKit). A pixel of padding at the list's end keeps it
          inside, and the panel's bottom padding is a rem less that same pixel, so the last row
          sits where it did. tests/browser/settingsScrollEnd sweeps it. */}
      <div className="rounded-2xl panel pt-4 pb-[calc(var(--spacing)*4_-_1px)] gap-4 flex flex-col min-h-0">
        {/* History panel on the shared scroll-region recipe (round 7,
            components/scrollRegion): the panel owns py-4 only, and every child carries its
            own px-4 — for the scrolling <ul> below that puts the 1rem right padding INSIDE
            the scroller, the text-free lane the iOS scrollbar paints in. Content widths are
            unchanged; the older p-4 parent plus -mx-4 counter-margins on the header and
            method section produced the same geometry with the lane OUTSIDE the scroller. */}
        {/* The History heading row: a PLAIN heading since round 23 — no divider line and no
            shadow under it; the list's own top fade is what marks content scrolled past it, as on
            every other page. The panel padding is vertical-only, so the row carries its own px-4,
            and the panel's gap-4 alone spaces it from the list. lookup-history-header is a stable
            NAME only, not a style hook: it is what the tests select this row by.
            THE COUNT is INSIDE the History span, not a third flex child: the row is
            justify-between, so a third child would redistribute the whole header. As inline text
            at the row's own tier it shares the line box the header already had, and
            whitespace-nowrap is what keeps that true at every width — a wrap is the one way this
            could grow the header, and a heading that changes height shoves the whole list below it
            down, exactly the reflow worth designing out (the same by-construction rule
            the history rows follow). It appears from the SECOND entry on (a "(1)" beside
            a list you can see has one row is noise) and counts the whole list, however long.
            Dimmer than the label it follows — --tx-300-60 is the footnote tier, a step down
            from the header's own --tx-200-70 in every theme — so it reads as a detail about the
            heading rather than part of it. */}
        <div className="lookup-history-header shrink-0 px-4 flex items-center justify-between text-[calc(11rem/16.458)] uppercase tracking-wide text-(--tx-200-70)">
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
        {entries.length > 0 ? (
          <LookupHistoryList
            entries={entries}
            selectedId={sid}
            onSelect={selEntry}
            fmtDate={fmtDate}
          />
        ) : (
          <p className="px-4 text-sm text-(--tx-200-70)">No lookups yet</p>
        )}
      </div>
    </div>
  )
}
