import { use, type RefObject } from 'react'
import CustomSelect from './CustomSelect.jsx'
import { InOpenListContext } from './openListContext.js'
import { usePresets } from '../store/presets.js'
import type { Preset } from '../store/presets.js'
import { switchPreset } from '../store/presetControl.js'
import { useSessionAmnesic } from '../store/sessionAmnesic.js'
import { AMNESIC_SPOKEN } from '../store/amnesicMode.js'
import { watchNameCell } from '../lib/presetNameWidth.js'
import { nameAsDrawn } from '../lib/presetNameText.js'

// PresetSwitcher — the control that says which preset you are on and moves you to another one.
//
// ★★ IT IS A CustomSelect, NOT A NEW CONTROL, AND THAT IS THE WHOLE SPECIFICATION. The owner's
// words about the mode selector's press-drag ("swipe down") gesture: *"that's genuinely one of the
// most convenient parts of the whole site."* So this control reuses components/CustomSelect with
// `pressDrag` and inherits that gesture, its keyboard model, its Android-Back handling and its
// portaled panel wholesale.
// ⚠ WHY REUSE IS A HARD REQUIREMENT RATHER THAN A PREFERENCE, and it is the most expensive lesson
// in this component's history: that gesture FAILED TWICE on the owner's iPhone (round 11 cases
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
//   • RULE 4: How to Play documents everything observable, and this control puts a new observable
//     thing on screen — the switcher itself — and a new audible one, the spoken ", amnesic".
//     ✔ DONE: GuidePage's "Presets" section (Interface), plus the Accessibility bullets that name
//     this control and what it says of an amnesic preset.
//
// ── THE ONE THING THIS CONTROL DOES DIFFERENTLY FROM THE MODE SELECTOR ────────────────────────
//
// ★ IT MUST NOT SIZE ITSELF TO ITS LONGEST OPTION. CustomSelect's trigger renders EVERY option
// stacked in a one-cell grid (all but the selected one `invisible`), so its width is the width of
// the widest label. For a fixed list of seven mode names that is exactly right — the control is as
// wide as it needs to be and never moves. For PRESET names, sizing to content is wrong from BOTH
// directions: the names are PLAYER-TYPED, so a shrink-to-fit trigger would resize itself under the
// player's thumb on every rename, and a long enough name would widen the top bar for as long as
// that preset existed.
//
// ★★ ROUND 20 CHANGED WHO GIVES, AND PRESET_NAME_COL WITH IT. Rounds 18-19 fixed the width this cell
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
//   was needed once this cell stopped being a fixed constant.
//   THE FLOOR STAYS as the TRIGGER-GRID floor and a defensive one, AND ONLY THERE. The portaled
//   panel is `dropdownWidth="match-trigger"` — exactly this trigger's live rendered width — so a
//   menu row always has something to fill (the label cell is `flex-1` of a `w-full` row of that
//   panel), and a floor in the menu holds nothing open; in a row narrower than the floor it would
//   only push the name out past the row's edge, and make the row report more room than it has
//   (PresetOptionLabel drops it there). It binds in the trigger's own stacked grid, and it is still the
//   thing that stops a name cell collapsing toward bare content if the trigger is ever squeezed
//   toward its own minimum — kept as a "never smaller than this" rather than an "always exactly
//   this". `em`, not px or rem, for the reason it always was: the root font-size is FLUID
//   (index.css's clamp), so a px floor would be a fixed number of pixels holding a variable number
//   of characters, and `em` keeps the floor a fixed number of CHARACTERS at every root size
//   instead.
//
// ★★ THE TOP BAR'S WIDTH RULE (the owner's): the Mode button is exactly as wide as its longest mode
// name needs; THIS control fills what is left of the row; ITS LIST IS EXACTLY THIS CONTROL'S WIDTH —
// it hangs under the button as one column and can never reach over the Mode button. The panel is an
// overlay (`position:fixed`), so nothing it does can widen the bar either.
//
// ★★ A NAME MAY BE ANY LENGTH, AND WHAT DOES NOT FIT IS SHOWN WITH AN ELLIPSIS. Nothing limits what
// a player may call a preset (store/presets' normalizePresetName), so every place a name is shown
// has to cope with one that is too long for it: one line, cut with "…", never wrapping and never
// widening anything. PresetOptionLabel below is that, for every such place — this control's button,
// a row of its list, and the ⚙ menu's "Open in" and its list.
//   ★ AND THE APP KNOWS WHEN A NAME IS CUT, BY MEASURING THOSE SAME CELLS. Each cell
//   PresetOptionLabel draws wears `data-preset-name-cell` and hands itself to lib/presetNameWidth
//   (watchNameCell), which keeps the room a name has in each place current — the hidden copy of a
//   closed list included (CustomSelect's row gauge, drawn by the same row code as the open list).
//   components/PresetManager's rename field reads that to say, as a name is typed, the moment it
//   stops fitting. A row of the list is where a name has the least room: the rows are the ordinary
//   dropdown rows, the same as the mode selector's — the owner's ruling: no special treatment for
//   this list — and at the button's width a row spends more of it than the button does (the ✓
//   column, wider padding) on larger text.
//
// ── WHAT A PRESET LIST SAYS OF AN AMNESIC PRESET ──────────────────────────────────────────────
//
// ★ NOTHING IS DRAWN, AND SOMETHING IS SPOKEN. A preset's row used to carry a small "A" after its
// name; the owner dropped it (an arbitrary letter, and it cost every amnesic preset part of its
// name's width — "it doesn't make sense to require names to be shorter for amnesic presets"). What
// is temporary is marked on the page itself instead, where the numbers are: the dashed outline
// (index.css's .session-only) round the stats strip, and round the Best readouts too under Full. So a row is
// its name and nothing else, and the name has the whole cell.
// ★ A SCREEN READER STILL HEARS IT, for every preset in the list and not only the one you are on —
// the outline is on the screen you are looking at, and a list is where you choose where to go:
//     Full        "Weekend, amnesic"
//     Stats Only  "Weekend, amnesic, stats only"
// ", amnesic" is kept as it has always been said, and the two kinds are told apart by the words
// that follow it. Each preset's value is the session's (store/sessionAmnesic), and one subscription
// there answers for EVERY preset at once, including the ones you are not on.
// ⚠ IT IS SPOKEN AS ONE WHOLE PHRASE — "Weekend, amnesic", name included, in an `sr-only` element,
// with the visible name hidden from a screen reader beside it — rather than a ", amnesic" tail for
// the browser to join onto the name. A name assembled from several elements is joined by rules that
// differ by engine and by each piece's layout: Chromium puts a space between a block-level piece
// and its neighbour (the name is a flex item, the sr-only span is absolutely positioned), which
// read as "Weekend , amnesic"; and a join that trims each piece drops a leading space instead,
// which is "Weekendamnesic". One text node has nothing to join, so it reads the same everywhere.

// ★ THE FLOOR OF A PRESET NAME'S CELL IN THE TRIGGER: 4.5em. The trigger's own width is whatever
// main.tsx's row does not spend on the logo, the mode selector, the gear, and their gaps (the
// budget block above the bar's markup there has the arithmetic). It was 6em while the cell was a
// fixed width; round 21 widened the mode selector, and a 6em floor (~82px at text-sm) then exceeded
// the trigger's usable inner width at 360×800 (~69px), so a near-floor name ran UNDER the ▲▼ and
// the cell reported more room than it had. 4.5em (~61px at text-sm) sits inside the tightest usable
// width with margin. It is a MINIMUM, not a fixed width — on a roomier phone the cell block-fills
// well past it.
export const PRESET_NAME_COL = '4.5em'
// ★ ONE PRESET'S ROW, AS EVERY PRESET LIST IN THE APP DRAWS IT — this switcher's, and since round 23
// the ⚙ panel's "Open in" dropdown, which is the SAME control showing the SAME list (the
// owner's "learn it once"). Exported rather than copied so the two can never drift: a name that
// truncates here and overflows there, or an amnesic preset that one list forgets to announce, would
// be exactly the kind of disagreement this file's history keeps paying for.
// ⚠ `data-preset-name-cell` COMES ALONG TO "Open in" TOO, AND COUNTS THERE: lib/presetNameWidth
// measures every cell that wears it, so "Open in" and its list are places a name can be cut by
// drawing their names with this component, with nothing else to wire.
export function PresetOptionLabel({ preset: p }: { preset: Preset }) {
  const spoken = AMNESIC_SPOKEN[useSessionAmnesic((s) => s.modes[p.id] ?? 'off')]
  // ★ THE FLOOR IS THE TRIGGER'S, NOT THE LIST'S. In the trigger it is what keeps the name cell
  // from collapsing toward bare content. In a list row there is nothing for it to hold — the row's
  // label cell already fills the row — and in a row with less room than the floor it would push the
  // name out past the row's right edge, and make the cell report a width the row does not have to
  // lib/presetNameWidth, which would then call a name whole that the list is cutting. In the list
  // the cell is exactly the room the row gives it.
  const inOpenList = use(InOpenListContext)
  const drawn = nameAsDrawn(p.name)
  return (
    // The name cell (floor PRESET_NAME_COL, grows past it). `flex` makes it a block-level flex
    // container, so inside the trigger's grid cell AND inside a dropdown row it is the same box
    // with the same rules — one structure serving both, which is what stops the two from drifting.
    // Only `minWidth`, no `width`: the cell's width comes from filling whatever its ancestor chain
    // hands it (see the trigger's `w-full` below), never from the name in it. `data-preset-name-cell`
    // and the ref are how lib/presetNameWidth finds THIS exact element and hears when it changes size.
    <span
      className="flex items-center"
      style={inOpenList ? undefined : { minWidth: PRESET_NAME_COL }}
      data-preset-name-cell="true"
      ref={watchNameCell}
    >
      {/* `truncate` (overflow-hidden + ellipsis + nowrap) goes on the NAME, not on the cell: a
          flex container's own text-overflow never fires, because the ellipsis rule applies to a
          block box's inline content and this box's children are flex items. Put it here and a name
          longer than the cell shortens with a real "…" — which is the whole of how a long name is
          handled: nothing stops one being typed.
          ⚠ WHAT IS DRAWN IS nameAsDrawn, NOT THE RAW NAME: all of it for any name a slot could
          show, and only the start of a pasted book (lib/presetNameText says why a browser must
          never be handed the whole of one to lay out). */}
      <span className="truncate" aria-hidden={spoken ? true : undefined}>
        {drawn}
      </span>
      {spoken && <span className="sr-only">{`${drawn}, ${spoken}`}</span>}
    </span>
  )
}

export default function PresetSwitcher({
  // ⚠ REQUIRED, not optional, and that is the whole reason it exists (see the ⚠⚠ block above). Its
  // one job is to give App a handle on this control's wrapper so the ⚙ press-outside handler can
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
  // Ids are numbers; CustomSelect's contract is strings. The conversion is confined to the two
  // controls that list presets (this one and the ⚙ panel's "Open in") — String() on the way out,
  // Number() on the way back in, at the onChange — because a stringly-typed preset id escaping into
  // store/presetControl is how an `id` that never matches anything gets written.
  const options = presets.map((p) => ({
    value: String(p.id),
    label: <PresetOptionLabel preset={p} />,
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
      // amnesic" (for a preset on Full) rather than the bare "Preset, collapsed" it said while an aria-label was replacing
      // its content. That fix belongs to the shared component (the mode selector had the identical
      // gap — "Mode" without "Classic") and the argument is written out there; what matters here is
      // that the ", amnesic" this file renders sr-only is INSIDE the option label, which is why it
      // reaches the trigger's name for free.
      ariaLabel="Preset"
      showChevron
      pressDrag
      // The portaled menu is EXACTLY this trigger's width (the top bar's width rule, in the ★★
      // block above): this trigger already fills the row's leftover space (w-full inside main.tsx's
      // flex-1 min-w-0), and the list is that same column. The mode selector keeps 'content'.
      dropdownWidth="match-trigger"
      // The mode selector's trigger classes, CHARACTER FOR CHARACTER, plus two the mode selector
      // does NOT wear — the two controls sit side by side in the same bar, so anything that
      // differed without a reason would read as one of them being wrong, and these two have one.
      // ⚠ IT WAS pr-6 AGAINST THE MODE SELECTOR'S pr-9 WHEN THIS CONTROL WAS WRITTEN, and the top-bar
      // rebuild — the change that mounts it — cut the mode selector to pr-6 as well, to buy back the
      // width the bar was overflowing by at 360px (the measurement is in main.tsx's budget block, and
      // the ⚠⚠ note above records the same correction). The chevron is `absolute right-2` in both, so
      // 1.5rem of right padding leaves it ~9px of clearance and nothing else needs to know.
      // (`px-2.5` then `pr-6`: Tailwind emits pr-* after px-*, so the later rule wins.)
      // ⚠⚠ `w-full min-w-0` IS ROUND 20'S ADDITION, AND IT IS THE WHOLE MECHANISM — everything the
      // ★★ "who gives" block at the top of this file says about "an upstream size to fill" starts
      // HERE. `w-full` gives this trigger a DEFINITE width (100% of CustomSelect's
      // own wrapper div, which itself defaults to 100% of main.tsx's `flex-1 min-w-0` row item —
      // see the budget block above the bar's markup there), which is what lets the grid inside
      // (CustomSelect's stacked-option cell) fill it rather than shrink-wrap to the widest label.
      // `min-w-0` is NOT the flex-item fix it would be on a flex child (this button's own parent
      // is not a flex container) — it is here defensively, so a future wrapping change cannot
      // reintroduce a content-based floor on the one control that is supposed to have none. The
      // MODE SELECTOR deliberately keeps NEITHER class: it stays shrink-to-fit, exactly as before.
      className="panel rounded-xl px-2.5 py-2 pr-6 text-sm text-left w-full min-w-0"
    />
  )
}
