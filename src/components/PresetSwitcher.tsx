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
// wide as it needs to be and never moves. For PRESET names, sizing to content is wrong from BOTH
// directions: the names are PLAYER-TYPED, so a shrink-to-fit trigger would resize itself under the
// player's thumb on every rename, and (before round 20 Q6) a long enough name would permanently
// widen the top bar for as long as that preset existed.
//
// ★★ Q6 CHANGED WHO GIVES, AND PRESET_NAME_COL WITH IT. Rounds 18-19 fixed the width this cell
// bore so it could never widen the bar; round 20 gave this control FIRST CLAIM on the bar's own
// slack instead — main.tsx's row puts `flex-1 min-w-0` on THIS control alone, and every other
// control keeps `shrink-0` (see the budget block above the bar's markup there for the arithmetic
// and why the switcher is the one that gives). PRESET_NAME_COL followed the same turn: it went
// from the ONE fixed width every option's name cell wore to a MINIMUM one, applied via `minWidth`
// rather than `width` below. Everything that used to make the cell exactly PRESET_NAME_COL wide
// now makes it AT LEAST that wide, and the rest is ordinary block-fill: this cell
// (`display:flex`, no width of its own) sits inside a chain of boxes that each default to 100% of
// their own parent once something upstream hands them a definite size to fill — the trigger's
// `w-full` below is that upstream size, and CustomSelect's grid, its grid-item cells, and this
// cell each just inherit it one layer at a time. NOTHING IN CustomSelect NEEDED TO CHANGE for
// that half of the chain — its className is entirely this file's to set, which is the whole
// reason `w-full` on the trigger below is enough on its own.
//   ⚠ THE ONE PLACE CustomSelect DID need a matching change is the DROPDOWN rows, which are a
//   structurally different flex row (not the trigger's stacked grid) and would NOT have picked up
//   the same fill by construction — see that file's option-row rendering for the fix and why it
//   was needed to keep the amnesic marker's column alignment once this cell stopped being a fixed
//   constant.
//   THE FLOOR STAYS because the menu does not always have something to grow against: the portaled
//   dropdown panel is `width:max-content` (see the ⚠ below), so nothing forces a SHORT name's row
//   wide, and PRESET_NAME_COL is what stops it collapsing toward bare content — the same number
//   the whole cell used to be pinned to, kept now as a "never smaller than this" rather than an
//   "always exactly this". `em`, not px or rem, for the reason it always was: the root font-size
//   is FLUID (index.css's clamp), so a px floor would be a fixed number of pixels holding a
//   variable number of characters, and `em` keeps the floor a fixed number of CHARACTERS at every
//   root size instead — 6em is roomier in the dropdown's larger text tier than in the trigger's
//   `text-sm` automatically, with no second constant.
//
// ⚠ NOTE WHAT IS *STILL NOT CONSTRAINED* BY THE BAR: the portaled dropdown panel. It is an overlay
// (`width:max-content`, `maxWidth:90vw`) that answers to the viewport, not to the bar, so nothing
// it does can widen the bar itself.
//
// ⚠⚠ TWO MECHANISMS STILL BOUND A NAME, BUT THEY NO LONGER AGREE BY CONSTRUCTION THE WAY TWO FIXED
// CONSTANTS DID. store/presets' MAX_PRESET_NAME is now a generous, DEVICE-INDEPENDENT ceiling for
// names this app never watched get typed — a stored payload, an old build, a tampered value (the
// full argument is at that constant). The cap that actually governs ordinary TYPING is measured
// LIVE, against THIS control's own rendered cell, and lives one level up from either file: see
// lib/presetNameWidth. `PRESET_NAME_CELL_SELECTOR`, exported below beside PRESET_NAME_COL, is the
// DOM hook that measurement reads — components/PresetManager's rename field is mounted in a
// completely different part of the tree (a ⚙ modal, not the fixed top bar), so it cannot reach
// this cell through React props or context; it reads the live element the same way this app
// already reaches across an unrelated component boundary elsewhere (main.tsx's
// `[data-settings-modal]`, the game's `[data-key="..."]` shortcuts).
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

// ★ THE FLOOR OF A PRESET NAME'S CELL — pre-Q6 this was the ONLY number the whole control was
// measured from (the trigger's exact width, and MAX_PRESET_NAME derived from it); post-Q6 the
// trigger's width is no longer this file's to state at all — it is whatever main.tsx's row does
// not spend on the logo, the mode selector, the gear and their gaps, and THAT arithmetic now lives
// at the budget block above the bar's markup in src/main.tsx, measured in a real layout engine the
// same way this constant always was.
//   WHAT'S LEFT HERE IS JUST THE FLOOR: 6em, unchanged in value from the old fixed width, kept for
// continuity (it is the number this control has always rendered a name at, at minimum) rather than
// picked afresh. At text-sm that is ≈82px — comfortably inside even the tightest budget main.tsx
// records (the switcher's floor has never been the constraint the bar's fit turned on; the logo,
// mode selector and gear's combined chrome was) — and the dropdown's larger text tier renders the
// same 6em roomier still, automatically, with no second constant.
export const PRESET_NAME_COL = '6em'
// The DOM hook lib/presetNameWidth reads to learn this control's LIVE rendered cell width — see
// the ⚠⚠ block above. Scoped to `[data-select-trigger]` (the trigger button CustomSelect marks
// with that attribute for `pressDrag`) so it can only ever match one of the seven cells STACKED IN
// THE TRIGGER, never a row in the portaled dropdown (which carries a DIFFERENT attribute,
// `data-select-group`, on an entirely separate portaled element) — an ambiguity that would matter
// if the switcher's own menu happened to be open at the same moment the rename field is measuring,
// which the ⚙ Presets modal and this control's dropdown can, in fact, both be open at once (the
// same exclusion that lets pressing this trigger with the ⚙ panel open open the menu instead of
// closing the panel — see the click-outside note near the top of this file). All seven stacked
// cells share the exact same rendered width regardless of which is the visible one (that sharing
// is the whole "stack every option in one grid cell" trick CustomSelect's trigger already relies
// on), so matching the FIRST one in document order is exactly as correct as matching the selected
// one, without needing to also filter for `aria-hidden="false"`.
export const PRESET_NAME_CELL_SELECTOR = '[data-select-trigger] [data-preset-name-cell]'

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
      // The name cell (floor PRESET_NAME_COL, grows past it — see the ⚠⚠ block above). `flex`
      // makes it a block-level flex container, so inside the trigger's grid cell AND inside a
      // dropdown row it is the same box with the same rules — one structure serving both, which is
      // what stops the two from drifting. No `width` any more, only `minWidth`: the cell's actual
      // width now comes from filling whatever its ancestor chain hands it (see the trigger's
      // `w-full` below), and `data-preset-name-cell` is the hook lib/presetNameWidth's live
      // measurement reads off THIS exact element via PRESET_NAME_CELL_SELECTOR.
      <span
        className="flex items-center"
        style={{ minWidth: PRESET_NAME_COL }}
        data-preset-name-cell="true"
      >
        {/* `truncate` (overflow-hidden + ellipsis + nowrap) goes on the NAME, not on the cell: a
            flex container's own text-overflow never fires, because the ellipsis rule applies to a
            block box's inline content and this box's children are flex items. Put it here and the
            name shortens with a real "…" while the marker beside it stays put.
            ⚠⚠ THE ELLIPSIS STAYS UNCONDITIONALLY, even with a live typing-time cap in front of it
            (lib/presetNameWidth) — argued at length in components/PresetManager, where that cap is
            actually applied. Short version: a typing-time cap can only promise "fit under THESE
            conditions at the moment typed", never "fits forever" — the live site and staging share
            one origin with proven build-skew bugs already, the switcher's own width can change
            after typing (a rotation, a text-size accessibility setting, a viewport resize), and a
            canvas measurement is not bit-for-bit identical to this element's own DOM layout. This
            is the safety net that makes all three survivable instead of an overflowing name. */}
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
      // ⚠ ariaLabel names the trigger AND the listbox, and the two are named DIFFERENTLY on
      // purpose — CustomSelect's doing, not this call site's. The listbox is "Preset". The TRIGGER
      // composes this label with the selected option's own text, so it announces "Preset, Weekend,
      // amnesic" rather than the bare "Preset, collapsed" it said while an aria-label was replacing
      // its content. That fix belongs to the shared component (the mode selector had the identical
      // gap — "Mode" without "Classic") and the argument is written out there; what matters here is
      // that the ", amnesic" this file renders sr-only is INSIDE the option label, which is why it
      // reaches the trigger's name for free.
      ariaLabel="Preset"
      showChevron
      pressDrag
      // The mode selector's trigger classes, CHARACTER FOR CHARACTER, plus two the mode selector
      // does NOT wear — the two controls sit side by side in the same bar, so anything that
      // differed without a reason would read as one of them being wrong, and these two have one.
      // ⚠ IT WAS pr-6 AGAINST THE MODE SELECTOR'S pr-9 WHEN THIS CONTROL WAS WRITTEN, and the top-bar
      // rebuild — the change that mounts it — cut the mode selector to pr-6 as well, to buy back the
      // width the bar was overflowing by at 360px (the measurement is in main.tsx's budget block, and
      // the ⚠⚠ note above records the same correction). The chevron is `absolute right-2` in both, so
      // 1.5rem of right padding leaves it ~9px of clearance and nothing else needs to know.
      // (`px-2.5` then `pr-6`: Tailwind emits pr-* after px-*, so the later rule wins.)
      // ⚠⚠ `w-full min-w-0` IS THE Q6 ADDITION, AND IT IS THE WHOLE MECHANISM — everything the
      // ⚠⚠ block above this file's PRESET_NAME_CELL_SELECTOR export says about "an upstream size
      // to fill" starts HERE. `w-full` gives this trigger a DEFINITE width (100% of CustomSelect's
      // own wrapper div, which itself defaults to 100% of main.tsx's `flex-1 min-w-0` row item —
      // see the budget block above the bar's markup there), which is what lets the grid inside
      // (CustomSelect's stacked-option cell) fill it rather than shrink-wrap to the widest label.
      // `min-w-0` is NOT the flex-item fix it would be on a flex child (this button's own parent
      // is not a flex container) — it is here defensively, so a future wrapping change cannot
      // reintroduce a content-based floor on the one control that is supposed to have none. The
      // MODE SELECTOR deliberately keeps NEITHER class: it stays shrink-to-fit, exactly as before.
      className="panel rounded-xl px-2.5 py-2 pr-6 text-sm focus:outline-hidden focus-ring text-left w-full min-w-0"
    />
  )
}
