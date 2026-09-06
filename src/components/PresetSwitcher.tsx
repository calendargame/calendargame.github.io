import { type RefObject } from 'react'
import CustomSelect from './CustomSelect.jsx'
import { usePresets } from '../store/presets.js'
import { switchPreset } from '../store/presetControl.js'

// PresetSwitcher — the control that says which preset you are on and moves you to another one.
//
// ★★ IT IS A CustomSelect, NOT A NEW CONTROL, AND THAT IS THE WHOLE SPECIFICATION. The owner's
// words about the mode selector's press-drag ("swipe down") gesture: *"that's genuinely one of the
// most convenient parts of the whole site."* So this control reuses components/CustomSelect with
// `pressDrag` and inherits that gesture, its keyboard model, its Android-Back handling and its
// portaled panel wholesale.
// ⚠ WHY REUSE IS A HARD REQUIREMENT RATHER THAN A PREFERENCE, and it is the most expensive lesson
// in this component's history: that gesture FAILED TWICE on the owner's iPhone (round 11, Q8 cases
// A and B) while passing in Chromium every time, and was cured in round 12 only by DELETING the
// close-on-scroll logic outright — the platform reason is written out at the top of CustomSelect.
// A second control with its own gesture would be a second chance to re-derive that bug. Nothing in
// this file touches CustomSelect's gesture handling; it passes `pressDrag` and gets out of the way.
//
// ⚠ AND IT SATISFIES CustomSelect's CALLER CONTRACT ONLY IN FIXED CHROME. The panel is
// position:fixed and measured ONCE per open, from the trigger's viewport rect, and nothing
// re-measures it while a scroller moves. This control is designed for the fixed top bar, beside the
// mode selector. Mounting it inside a SCROLLING region would need repositioning written and tested
// against that case first — see the contract at the top of CustomSelect, which says so at length.
//
// ── ⚠⚠ WHAT MOUNTING THIS OWES, and it is not just placing the element ────────────────────────
// Written here rather than left to be rediscovered, because both items are invisible until they
// are wrong and neither has a test that can notice on its own:
//   • THE ⚙ CLICK-OUTSIDE HANDLER (src/main.tsx) MUST LEARN ABOUT THIS TRIGGER. It closes the
//     settings popover on any press outside three regions, one of which is the mode selector's
//     wrapper (`modeSelectRef`) — and that exclusion is exactly why pressing the mode trigger with
//     the panel open opens the menu instead of slamming the panel shut underneath the gesture.
//     A generic `[role="listbox"]` clause already covers the open PANEL of any select, so only the
//     TRIGGER is uncovered. The fix is the same shape: give this control a `wrapperRef` prop
//     forwarded to CustomSelect's own `wrapperRef`, and add it to that handler's exclusions.
//     ✔ BOTH DONE by the top-bar rebuild, which is the change that mounts this: the prop is
//     declared below (and is REQUIRED, not optional — an exclusion a caller can silently forget is
//     the bug it exists to prevent), App passes `presetSelectRef`, and that ref is now the handler's
//     fourth exclusion. tests/topBar.dom pins the behaviour, not the wiring: press this trigger with
//     the ⚙ panel open and the panel must still be open.
//   • RULE 4: How to Play documents everything observable, and this control puts TWO new observable
//     things on screen — the switcher itself, and the "A". Neither can be documented honestly
//     before the bar that hosts them exists (where it sits, what it replaced), so the guide section
//     belongs to the change that mounts it, not to this one.
//     ✔ DONE by that same change: GuidePage's "Presets" section (Interface), plus the two
//     Accessibility bullets that name this control and its ", amnesic".
//
// ── THE ONE THING THIS CONTROL DOES DIFFERENTLY FROM THE MODE SELECTOR ────────────────────────
//
// ★ IT MUST NOT SIZE ITSELF TO ITS LONGEST OPTION. CustomSelect's trigger renders EVERY option
// stacked in a one-cell grid (all but the selected one `invisible`), so its width is the width of
// the widest label. For a fixed list of seven mode names that is exactly right — the control is as
// wide as it needs to be and never moves. For PRESET names it is wrong, and not subtly: the names
// are PLAYER-TYPED, so one long name would permanently widen the top bar for as long as that preset
// exists, shoving the gear and the mode selector toward the edge of a 360px phone that has no slack
// to give (the bar's own overflow at that width is a known defect this round is fixing).
//   THE FIX IS ONE CONSTANT, `PRESET_NAME_COL` BELOW: every option's label is a FIXED-WIDTH cell,
//   so the trigger's shrink-to-fit width is the same number whatever the names are, and a name too
//   wide for the cell truncates with an ellipsis instead of pushing. Two mechanisms, not one, and
//   both are needed: a CHARACTER cap (store/presets' MAX_PRESET_NAME) bounds what a player can type,
//   and the fixed cell + `truncate` bound the PIXELS — a character cap cannot do that on its own in
//   a proportional font, where twelve W's are nearly twice twelve i's.
//
// ⚠ NOTE WHAT IS *NOT* CONSTRAINED: the portaled dropdown panel. It is an overlay
// (`width:max-content`, `maxWidth:90vw`) that answers to the viewport, not to the bar, so nothing
// it does can widen anything. Its rows carry the same fixed cell anyway — not to contain the panel,
// but because that shared width is what makes the amnesic markers line up as a COLUMN (below).
//
// ── THE AMNESIC MARKER ────────────────────────────────────────────────────────────────────────
//
// ★ Preset.amnesic lives on the REGISTRY (store/presets argues why at length), which is exactly
// what makes this marker cheap: one subscription to the presets list answers for EVERY preset at
// once, including the ones you are not on. There is nothing to derive and no second source to keep
// in step — if it were a ⚙ setting instead, a switcher could only ever have answered for the
// active preset, because a preset's settings are not loaded until you open it.
//
// ⚠ IT IS A LETTER PLUS A WORD, NEVER A LETTER ALONE. A bare "A" is not an accessible name — it is
// a glyph a screen reader reads as the indefinite article. So the letter is `aria-hidden` and an
// `sr-only` sibling carries the real word, exactly the idiom the ⚙ footer's Changelog dot uses.
// ⚠ THE COMMA IN ", amnesic" IS LOAD-BEARING, and the Changelog dot paid for that lesson: the
// name-from-content algorithm TRIMS each child's text before joining, so a leading space is dropped
// and "Weekend" + "amnesic" would be announced as "Weekendamnesic". A printing separator is the
// only one that survives the join.
// ⚠ NOTHING ABOUT IT IS CONVEYED BY COLOUR — it is a glyph, dimmed by OPACITY rather than tinted.
// That is not only an a11y rule here, it is a correctness one: the dropdown panel paints a light
// frosted background and hardcodes `color:#1a1a1a` on its rows in EVERY theme, while the trigger
// wears the theme's own text colour. A themed colour token on this marker would read correctly in
// the bar and be invisible on the panel in the three dark themes. Inheriting `currentColor` and
// dimming with opacity is the one treatment that is right in both places.

// ★ THE WIDTH OF A PRESET NAME, and the single number the whole control is measured from.
//
// THE ARITHMETIC (a PAPER measurement — see the warning under it). At the narrowest phone width the
// app supports, 360px, the bar's inner wrapper is `max-w-[30rem] px-4`, so its content box is
// 360 − 2×1rem ≈ 329px at that viewport's fluid root size (~15.6px; index.css clamps it). What is
// already spoken for on that line, all at text-sm (0.875rem ≈ 13.7px):
//     ⚙ gear         px-2.5 + 1px borders + a ~1em glyph          ≈  46-48px
//     gap-2                                                       ≈   8px
//     mode selector  px-2.5 + pr-9 + "How to Play" (the widest)   ≈ 120-122px
//     W5Logo         24px + its gap-2                             ≈  32px
//     the row's own gap-2 between the two groups                  ≈   8px
//   329 − (48 + 8 + 122 + 32 + 8) ≈ 111px, and the same sum with slightly narrower glyph metrics
//   comes out at ~122px. That range brackets the ~122px the earlier scoping pass measured for the
//   wordmark this control replaces, from the other direction, which is the only cross-check
//   available without a device.
// SPENDING IT: the trigger is `px-2.5 pr-6`, i.e. 0.625rem + 1.5rem = 2.125rem ≈ 33px of chrome
// (the chevron itself sits at right-2 and is ~7px wide, so 1.5rem leaves it ~9px of clearance).
//   111px − 33px ≈ 78px of name, and 6em at text-sm is 6 × 13.7 ≈ 82px. In the system UI stack an
//   average mixed-case character advances ≈ 0.5em, so 6em is TWELVE characters — which is where
//   store/presets' MAX_PRESET_NAME is pinned, so that a typical name never truncates anywhere and
//   the ellipsis is left as the safety net for wide glyphs it is meant to be. Total trigger width:
//   6 × 0.875rem + 2.125rem = 7.375rem ≈ 115px.
//
// WHY `em` AND NOT px OR rem. The root font-size is FLUID (index.css:
// `clamp(0.75rem, min(0.95rem + 0.4vw, 1.95vh), 1.1875rem)`), so a px width would be a fixed number
// of pixels holding a variable number of characters — the one thing this cell must not be. In `em`
// the cell is a fixed number of CHARACTERS at every root size, which is what the cap above means.
// It also makes the cell 0.875rem-wide in the trigger and 15px-wide in the dropdown rows (the panel
// runs a larger text tier) automatically, so the rows are always a little roomier than the trigger
// — a name that fits the bar certainly fits the menu, for free, with no second constant.
//
// ⚠⚠ THE BLOCK ABOVE IS ARITHMETIC — jsdom has no layout engine, so no test in this repo can
// confirm a single number in it. THE BAR IT LANDED IN HAS SINCE BEEN MEASURED, in a real layout
// engine, and the outcome is recorded at the budget block above the bar's markup in src/main.tsx.
// Three corrections to the estimates above, kept here rather than silently rewritten, because the
// gap between an estimate and a measurement is the useful part:
//   • the wordmark this control replaced was 135.05px, not the ~122px the scoping pass guessed;
//   • the trigger measures 117.03px, not ~115 (the estimate omitted the `panel` border, 1px a side);
//   • the row it sits in no longer wears gap-2 or pr-9 — the rebuild cut both to buy the space, so
//     the "already spoken for" table above describes the OLD bar, and main.tsx's block the new one.
// At 360×800 the finished row leaves 22.70px of slack, and at the tightest a 360-wide viewport can
// get (a root font of 16.64px, reached at ~853px of height) it still leaves 2.24px. So this cell is
// not the thing under pressure any more.
// ⚠ THAT WAS DESKTOP CHROMIUM. Glyph advances and the system UI stack differ on iOS, so ONLY THE
// OWNER'S IPHONE CAN CONFIRM THE FIT. If the bar overflows at 360px there, this constant is the one
// to turn — and MAX_PRESET_NAME must move with it, or the cap starts promising characters the
// control cannot show.
export const PRESET_NAME_COL = '6em'

export default function PresetSwitcher({
  // ⚠ REQUIRED, not optional, and that is the whole reason it exists (see the ⚠⚠ block above). Its
  // one job is to give App a handle on this control's wrapper so the ⚙ click-outside handler can
  // treat a press on this trigger as "inside". An optional prop would let a future call site mount
  // the switcher with the exclusion silently missing — and the symptom (the ⚙ panel slamming shut
  // under the finger that opened this menu) looks like a gesture bug, not like a forgotten prop.
  wrapperRef,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  // Two narrow subscriptions rather than one wide one. `presets` is the list itself (replaced
  // wholesale by applyRegistry, so reference equality is a correct change signal), `activeId` the
  // one scalar the trigger reads. Both come from the REGISTRY, which is global by construction —
  // it is the thing that says which preset you are on, so it cannot live inside a preset.
  const presets = usePresets((s) => s.presets)
  const activeId = usePresets((s) => s.activeId)
  // Ids are numbers; CustomSelect's contract is strings. The conversion is confined to this file —
  // String() on the way out, Number() on the way back in — because a stringly-typed preset id
  // escaping into store/presetControl is how an `id` that never matches anything gets written.
  const options = presets.map((p) => ({
    value: String(p.id),
    label: (
      // The fixed-width name cell (see PRESET_NAME_COL). `flex` makes it a block-level flex
      // container, so inside the trigger's grid cell AND inside a dropdown row it is the same box
      // with the same rules — one structure serving both, which is what stops the two from drifting.
      <span className="flex items-center" style={{ width: PRESET_NAME_COL }}>
        {/* `truncate` (overflow-hidden + ellipsis + nowrap) goes on the NAME, not on the cell: a
            flex container's own text-overflow never fires, because the ellipsis rule applies to a
            block box's inline content and this box's children are flex items. Put it here and the
            name shortens with a real "…" while the marker beside it stays put. */}
        <span className="truncate">{p.name}</span>
        {p.amnesic && (
          <>
            {/* ml-auto is the right-alignment: it eats the cell's leftover space, so the marker sits
                on the cell's right edge and — because every cell is the same width — the markers
                line up as a column down the menu. shrink-0 keeps the name, never the marker, as the
                thing that gives way when a name is too long. */}
            <span
              aria-hidden="true"
              className="ml-auto shrink-0 pl-1.5 text-[0.8em] font-semibold leading-none opacity-70"
            >
              A
            </span>
            <span className="sr-only">, amnesic</span>
          </>
        )}
      </span>
    ),
  }))
  return (
    <CustomSelect
      wrapperRef={wrapperRef}
      value={String(activeId)}
      // switchPreset is the WHOLE call: it rewrites the registry, rehydrates all four per-preset
      // stores in the same synchronous turn, and — because src/main.tsx subscribes to the registry
      // — remounts the six always-mounted screens. Re-picking the preset you are already on returns
      // false and does nothing, which is why there is no guard here; CustomSelect closes the menu on
      // any choice either way. Nothing else belongs on this line: a component that had to remember
      // a second step would be the 500-cards-becomes-4 bug waiting for someone to forget it.
      onChange={(v) => switchPreset(Number(v))}
      options={options}
      // ⚠ ariaLabel is passed to the trigger AND to the listbox, and on the trigger an aria-label
      // REPLACES the content — so a screen reader hears "Preset, collapsed" without the active
      // preset's name, exactly as the mode selector announces "Mode" without "Classic". That is a
      // real gap and it is the SHARED component's, not this call site's: matching the mode selector
      // is the requirement here, and fixing it in one control and not the other would leave the two
      // announcing differently. Flagged for a change that fixes CustomSelect for both at once.
      ariaLabel="Preset"
      showChevron
      pressDrag
      // The mode selector's trigger classes, with ONE deliberate difference: pr-6 where it wears
      // pr-9. The chevron is `absolute right-2` in both, so the glyph lands in exactly the same
      // place; the 12px the mode selector leaves as slack between its text and that glyph is space
      // this control spends on the name instead, and it can afford to because its text truncates
      // rather than pushes. (`px-2.5` then `pr-6` is the same pattern the mode selector already
      // relies on: Tailwind emits pr-* after px-*, so the later rule wins.)
      className="panel rounded-xl px-2.5 py-2 pr-6 text-sm focus:outline-hidden focus-ring text-left"
    />
  )
}
