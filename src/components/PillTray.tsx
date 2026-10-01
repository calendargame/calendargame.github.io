import type { ReactNode } from 'react'
import { usePillGroupLock } from './pillGroupLock.js'

// PillTray — the ⚙ Settings panel's segmented picker: one "concentric housing" tray of
// mutually-exclusive pill segments. Extracted from the Date Format groups (Round-3, rebuilt
// FLUSH Round-4) when the Theme rows adopted the same idiom (round-8), so the recipe below
// lives in ONE place instead of being re-typed per group. Round-9 made it the treatment for
// EVERY picker in the panel — Input and the three chance rows joined — so the housing now
// MEANS something: it is what says "pick exactly one of these". THE PICKER RULE that decides
// which controls get a tray is stated once, at the Display section — which lives in
// components/SettingsPanel since round 14, not main.tsx.
//
// THE CONCENTRIC HOUSING IDIOM (why these exact classes):
// The container draws the whole frame (border + surface-tray, NO padding, NO overflow-hidden)
// and each borderless segment carries a CONCENTRIC radius — calc(var(--radius-xl) - 1px), the
// housing's rounded-xl minus its 1px border — so a selected btn-solid segment's fill arc traces
// the housing's inner edge exactly. (Equal radii offset by the border diverge ~0.41px at 45°,
// leaving a hairline tray-colored crescent at every flush corner — visible at 3x device pixel
// ratio.) Pressing a segment reads exactly like pressing an On/Off switch — the panel's only
// other control — a clean flush accent fill with no visible seam, and uniform rounding on all
// four corners even where a corner isn't
// flush. Unselected segments are transparent — the tray surface shows through, visible on its
// own only in the 2px gap-0.5 seams between segments. Still RING-SAFE: with no overflow-hidden
// the inset press-drag ring follows each segment's own radius instead of being clipped square
// (the Round-2 defect that unfused the originals). Height sits at the popover one-height control
// tier: segment text-xs + py-1.5 (~27.7px) + the housing's 1px top/bottom borders ≈ 29.7px —
// identical to the On/Off switch buttons beside it, which are the same text-xs + py-1.5 inside
// their own 1px border. That is the whole tier; no other padding may sneak in.
//
// PURELY PRESENTATIONAL: the tray owns the segments' radio semantics (role="radio" +
// aria-checked) but NOT the group's. The caller wraps it in a PillGroup (components/PillGroup),
// which supplies role="radiogroup" + the accessible name + the keyboard contract + the lock —
// and the group is the CHOICE, not the tray: where two trays read and write one setting (the
// Written/Numeric date formats, and the two theme rows while Use System is off) ONE PillGroup
// spans both, because a group whose radios are all unchecked while the real selection sits in a
// sibling group tells assistive tech something false. Which is also why `ariaLabel` exists below:
// two trays inside one group can repeat a visible label ('MDY' appears in both date-format
// trays), and radios in a group must be tellable apart by name.
//
// THE TAB STOP is per GROUP, not per tray (round 9): the pill holding the group's value is
// tabbable and every other pill is not, so two trays sharing one setting still add up to ONE tab
// stop and the arrows walk straight from one into the other. PillGroup appoints that pill and
// drives that walk; the full contract is documented there. What the tray owns is the SEGMENT half
// of the same contract — an activated radio takes focus (see onClick), which is what puts the
// keyboard inside a group in the first place.
//
// WIDTH: flex-1 segments split the tray evenly. flex items are min-width:auto, so an over-long
// label pushes the tray WIDER rather than truncating — there is no truncation fallback, so a
// label that doesn't fit BREAKS the panel instead of degrading. The tightest tray shipped is a
// five-step chance row, where "Random" gets a fifth of the panel; every tray is nonetheless
// roomier per label than the gap-separated row it replaced, because a ~2px gap-0.5 seam stands
// in for a ~6px gap-1.5 plus the two 1px button borders it used to separate. Budget for new
// labels: "Random" at five segments, checked on the narrowest realistic phone (~375px CSS
// width, where the fluid root font bottoms out and the panel interior is ~297px).
//
// Generic in the option value so call sites pass their store's own union type (FormatId, a
// theme id) with no cast at either end.

// The bordered housing. No padding and no overflow-hidden — both would break the flush fill
// and the press-drag ring (see the idiom note above).
const TRAY_CLASS = 'flex gap-0.5 border surface-tray rounded-xl'
// One segment: borderless, flex-1, concentric radius, popover control tier.
const SEGMENT_CLASS =
  'flex-1 px-1.5 py-1.5 rounded-[calc(var(--radius-xl)-1px)] text-xs font-medium'
const SEGMENT_ON_CLASS = 'btn-solid'
const SEGMENT_OFF_CLASS = 'text-(--tx-100-80) hover:bg-(--stgl-hov)'

export interface PillTrayOption<T extends string> {
  value: T
  label: ReactNode
  // Accessible name, when the visible label alone would be ambiguous inside its radiogroup. It
  // must CONTAIN the visible label ('MDY' → 'Written MDY'), so speaking the visible word still
  // activates the right pill for voice control (WCAG 2.5.3 Label in Name).
  ariaLabel?: string
}

export function PillTray<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: PillTrayOption<T>[]
}) {
  // The lock is the GROUP's — one boolean on the enclosing PillGroup drives its dim, this
  // aria-disabled, the onChange guard below and the tab stops, instead of the caller hand-syncing
  // a class to a prop at every locked picker. The guard matters on its own: a click dispatched
  // past the dim's pointer-events-none (a synthetic event, a stray AT activation) must not change
  // the value.
  const disabled = usePillGroupLock()
  return (
    <div className={TRAY_CLASS}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          aria-disabled={disabled || undefined}
          // Never a tab stop on its own — a CONSTANT -1, which is also what keeps it constant to
          // React, so React writes it once and never contends with the group that hands out the
          // one 0. Which segment gets that 0 is a group-scope question (the group's value may sit
          // in a sibling tray); PillGroup's layout effect answers it and owns this attribute from
          // then on.
          tabIndex={-1}
          onClick={(e) => {
            if (disabled) return
            // Activating a radio MOVES FOCUS TO IT — the other half of the radio-group pattern,
            // and the group's only working entry path while Tab is bound elsewhere (PillGroup
            // documents both). Explicit because Safari, on macOS and iOS alike, does not focus a
            // <button> when it is clicked: without this, "click a pill, then arrow along the
            // setting" — which the guide and the changelog both promise — was true on Chrome and
            // Firefox and silently dead on Safari. Nothing is drawn either way (index.css:
            // button:focus{outline:none}), so this moves no pixel. preventScroll because the pill
            // is already under the finger; the popover must not jump to re-reveal it.
            e.currentTarget.focus({ preventScroll: true })
            onChange(o.value)
          }}
          className={`${SEGMENT_CLASS} ${o.value === value ? SEGMENT_ON_CLASS : SEGMENT_OFF_CLASS}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
