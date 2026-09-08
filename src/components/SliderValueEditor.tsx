import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { commitSliderText } from '../lib/sliderValue.js'

// SliderValueEditor — the tap-to-type value readout beside every timer slider (Round-2).
//
// Display mode renders the readout the sliders always had (tabular-nums text-xs, right-aligned)
// as a button; tapping it swaps in a small text input seeded with the current value, auto-focused
// — and the app-wide entry rule (lib/textEntry) highlights that seed, so typing replaces it
// outright. The validation trio is the
// AoX-N field's, adapted to numbers-with-units (lib/sliderValue):
//   • onChange — permissive regex only (digits, plus one '.' OR ',' when inputMode is decimal:
//     iOS/Android decimal keypads in comma-locales only offer ',', so rejecting it would silently
//     turn a typed "2,5" into "25" — commitSliderText normalizes the comma before parsing);
//   • commit on blur/Enter — parse → convert to internal units → snap to the slider's grid →
//     clamp into range; empty/junk reverts to the current value;
//   • Escape — revert WITHOUT committing, and STOP PROPAGATION: the document-level settings/popup
//     Escape handlers skip presses while a text input holds focus, but this input unmounts on the
//     revert — without the stop the same native event would bubble on and slam the panel shut on
//     what the user meant as a typing dismiss. This was the app's FIRST discard-on-Escape field
//     (round 2); round 15 (B6) brought the last two NUMERIC ones — the AoX popup field and the AoX
//     screen's own run-length box — onto the same contract, and round 17 brought the Lookup date
//     box (components/LookupCard), the one field that was never numeric and the last one outside
//     it. Escape therefore means "throw this edit away" in every box you can type into, with no
//     exception left to name: these readouts, both ⚙ Year Range boxes, the Save Defaults popup's N
//     field, the AoX screen's run length, and the Lookup date box.
//
// Width + zero shift (Q4 round-8): the cell is a `relative inline-block` whose ONLY in-flow child
// is an always-mounted invisible block strut holding `widest`, so the cell locks to the widest
// POSSIBLE readout measured in the device's OWN font — identical across sites and constant at
// runtime (Round-4's hand-measured arbitrary width was Segoe UI's 3.18em; iOS's SF Pro renders
// "2m 55s" wider, and the overflow wrapped at the space). NOTE — every RETIRED utility below is
// described rather than written out: Tailwind v4's scanner reads .tsx comments as plain text
// (verified by probe), so spelling a dead class here would resurrect its rule in the shipped CSS.
// Only classes something still wears are named. BOTH live controls are taken OUT of flow on top
// of that strut, so neither can ever contribute to the cell's size:
//   • the display button is `absolute inset-0` — its border box is the strut box exactly. Its
//     `accent` (dirty) variant (Q5 round-6) wears the btn-solid pill via px-1 -mx-1, the
//     footer-link ring idiom: the fill bleeds 4px past the digits while the padding cancels back
//     to a CONTENT box equal to the strut, so the digits themselves never move.
//   • the edit input is `.svalue-input` (index.css, beside .surface-tray) — the same idiom on both
//     axes, inset outward by its own 1px border + 1×--spacing padding so its CONTENT box also
//     equals the strut. It therefore fits the full widest string exactly (the AoX Run Length site
//     types up to "1000"), and the digits hold still through the tap-to-type swap.
// Round-7 instead left the input IN flow and CANCELLED its extra geometry with a negative
// block margin; Chrome netted that to zero, the owner's iPhone did not, and the horizontal half
// was never handled at all. Nothing here relies on intrinsic input sizing any more, so the old
// w-full / min-w-0 / size={1} collapses are gone with it (those two utilities are safe to name —
// other elements still wear them).
//
// The user always types SECONDS — Flash converts ×1000 to ms via fromText; milliseconds are never
// exposed (the readout label is already seconds everywhere). The ONE non-seconds site is the
// defaults manager's AoX run-length row (Q5 round-6), which types a plain count: it passes
// `editLabel` to replace the default "(seconds)"-suffixed input name. `disabled` mirrors the
// slider's own condition (mid-round lock); pointer-events-none + the aria flag rather than the
// disabled attribute so the readout keeps its exact resting look (the plain span never dimmed).
// The input wears `surface-tray` (stgl-bg + sbtn-bd — the interactive-control surface every
// editable box shares, Q7 round-7; the display state stays borderless bare text) for its colours;
// .svalue-input owns the geometry.
export default function SliderValueEditor({
  value,
  min,
  max,
  snap,
  disabled = false,
  accent = false,
  inputMode,
  label,
  editLabel,
  format,
  toText,
  fromText,
  widest,
  onCommit,
}: {
  value: number // current value, internal units (ms for Flash, seconds for the Blitz timers)
  min: number // commit clamp, internal units (matches the slider's range)
  max: number
  snap: number // the typed-value snap grid, internal units (100ms / 5s / 0.5s)
  disabled?: boolean
  accent?: boolean // dirty state (the defaults cards, Q5 round-6): the readout wears the btn-solid pill
  inputMode: 'decimal' | 'numeric'
  label: string // accessible name base, e.g. "Flash speed"
  editLabel?: string // input accessible name override for non-seconds values (defaults to `${label} (seconds)`)
  format: (v: number) => string // display text, e.g. fmtFlashT → "2.0s"
  toText: (v: number) => string // edit seed, unit-less user text, e.g. 2000 → "2"
  fromText?: (n: number) => number // typed number → internal units (Flash: s ×1000 → ms)
  widest: string // the widest possible readout string (the shared SLIDER_READOUT_WIDEST, declared in src/lib/modeFormat.ts), mounted as the width strut so the row never shifts
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState<string | null>(null) // null = display mode
  const inputRef = useRef<HTMLInputElement | null>(null)
  // If the slider locks mid-edit (a round starts via keyboard), drop the edit — the slider's
  // value is frozen, so a late commit would contradict the lock. Guarded render-phase reset
  // (the React "adjusting state when a prop changes" pattern): React re-renders before the
  // commit, so the input never paints a frame in the locked state.
  if (disabled && text !== null) setText(null)
  const editing = text !== null && !disabled
  // Focus the input the moment it mounts, so the tap that opened the editor also puts the keyboard
  // in it.
  // ⚠ IT USED TO select() ON THE NEXT LINE, and that line is GONE rather than moved: round 18 made
  // "entering a box highlights everything in it" an app-wide rule for every typing surface in the
  // app (lib/textEntry, installed once by App), and this focus() trips it like any other. Two
  // statements of one policy is the duplication that lets them drift, and the app-wide one is the
  // one that is also right on a phone — it re-selects on the click that completes a tap, which a
  // bare select() here never did.
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])
  // The cell from the width note above: the in-flow strut sizes it, the live control overlays it.
  const cell = (control: ReactNode) => (
    <span className="relative inline-block shrink-0">
      <span aria-hidden="true" className="block invisible whitespace-nowrap tabular-nums text-xs">
        {widest}
      </span>
      {control}
    </span>
  )
  if (!editing)
    return cell(
      <button
        type="button"
        aria-label={`Edit ${label}`}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setText(toText(value))
        }}
        className={`absolute inset-0 whitespace-nowrap tabular-nums text-xs text-right ${accent ? ' btn-solid rounded-md px-1 -mx-1' : ''}${disabled ? ' pointer-events-none' : ''}`}
      >
        {format(value)}
      </button>,
    )
  const re = inputMode === 'decimal' ? /^\d*[.,]?\d*$/ : /^\d*$/
  const commit = () => {
    const v = commitSliderText(text, { min, max, snap, fromText })
    if (v !== null) onCommit(v)
    setText(null)
  }
  return cell(
    <input
      ref={inputRef}
      type="text"
      inputMode={inputMode}
      aria-label={editLabel ?? `${label} (seconds)`}
      value={text}
      onChange={(e) => {
        if (re.test(e.target.value)) setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur() // commit runs once, in onBlur
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          setText(null) // revert; the input unmounts (no blur fires on removal)
        }
      }}
      className="svalue-input surface-tray text-right tabular-nums text-xs focus:outline-hidden focus-ring"
    />,
  )
}
