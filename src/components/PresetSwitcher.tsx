import type { RefObject } from 'react'
import CustomSelect from './CustomSelect.jsx'
import { usePresets, shortStockName, stockNumber, defaultPresetName } from '../store/presets.js'
import type { Preset } from '../store/presets.js'
import { switchPreset } from '../store/presetControl.js'
import { useAmnesicModeOf } from '../store/amnesic.js'
import { AMNESIC_SPOKEN } from '../store/amnesicMode.js'
import { stockNameForm, useNameRooms, watchNameCell } from '../lib/presetNameWidth.js'
import { copyNumberOf, nameAsDrawn } from '../lib/presetNameText.js'

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
// ★★ THIS CONTROL TAKES WHAT THE BAR HAS LEFT, AND ITS NAME CELL TAKES WHAT THE CONTROL HAS. In
// main.tsx's row this control alone is `flex-1 min-w-0` and every other control is `shrink-0` (the
// budget block above the bar's markup there has the arithmetic, and why the switcher is the one
// that gives). The trigger's `w-full` below hands that width down, and everything inside fills it
// one layer at a time: CustomSelect's grid, its stacked cells, and the name cell (`display:flex`,
// no width of its own). So a name cell is EXACTLY the room its control really has — in the
// trigger and in a list row alike — and a name longer than that is cut with an ellipsis inside it.
//   ★ THE CONTROL HAS A FLOOR, THOUGH ITS NAME CELL HAS NONE (Round 26, the owner's ruling for the
//   narrowest screens): main.tsx's wrapper never lets this control be narrower than its arrows
//   plus one digit — so a stock name drawn as its bare number shows whole here up to "9" — and
//   the Mode button gives way instead (main.tsx's budget block has the rule and the arithmetic).
//   ⚠ THE CELL HAS NO FLOOR, AND MUST NOT BE GIVEN ONE. It carried a least width (4.5em) from the
//   days it was a fixed column, kept "defensively". The cell fills its control at every size, so
//   the floor never held anything open; all it could do was bind where the control was NARROWER
//   than the floor — a narrow, tall phone — and there it pushed the cell out past the control's
//   own inside: the name ran under the ▲▼ and was clipped with no ellipsis, and the cell reported
//   room it did not have to lib/presetNameWidth.
//
// ★★ THE TOP BAR'S WIDTH RULE (the owner's): the Mode button is exactly as wide as its longest mode
// name needs; THIS control fills what is left of the row; ITS LIST IS EXACTLY THIS CONTROL'S WIDTH —
// it hangs under the button as one column, not reaching over the Mode button. The panel is an
// overlay (`position:fixed`), so nothing it does can widen the bar either.
//   ★ WITH ONE LEAST WIDTH, FOR THE NARROWEST SCREENS (a decision made for the owner, his to
//   overrule). On a phone narrow and tall enough the bar leaves this control so little that a list
//   of its width has rows with no room for a name at all — blank rows, each just a ✓ — and even
//   "P1" is cut. Blank rows are worse than a list a little wider than its control. So the list is
//   never narrower than one standard row needs to show the short form of a two-digit preset
//   ("P10") whole: ShortStockNameRoom below is that label, and CustomSelect's `leastRowLabel`
//   measures the row that holds it. Where that is wider than the control the list starts at the
//   control's left edge and reaches a little way over the Mode button; everywhere else (360 wide
//   and up, on an ordinary phone) the list is the control's width to the pixel, as before. The
//   rows keep their one shape; "Open in" is the same list and takes the same least, which its wide
//   control never reaches.
//
// ★★ A NAME MAY BE ANY LENGTH, AND WHAT DOES NOT FIT IS SHOWN WITH AN ELLIPSIS. Nothing limits what
// a player may call a preset (store/presets' normalizePresetName), so every place a name is shown
// has to cope with one that is too long for it: one line, cut with "…", never wrapping and never
// widening anything. PresetOptionLabel below is that, for every such place — this control's button,
// a row of its list, the ⚙ menu's "Open in" and its list, and the list Manage Presets' Duplicate
// opens.
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
// ★★ A STOCK NAME THAT WOULD BE CUT IS DRAWN SHORT: "Preset 1" → "P1" → "1" (the owner's rule, and
// its second step his too: "you can just show the plain number. And if it still can't fit that,
// then leave it at the ... there's no reason to optimize past that"). A stock name is one that
// reads exactly "Preset <number>" (store/presets' shortStockName and stockNumber — the default
// names, and any name typed to read the same). On a narrow phone the default name does not fit a
// row of its own list, and "Pres…" says less than "P1"; on the narrowest, "P1" does not fit the
// control, and "1" still says which preset it is.
//   • ONE ANSWER FOR THE WHOLE APP. If ANY stock name among the presets would be cut in ANY place a
//     name is shown, EVERY stock name is drawn short in EVERY such place; and if any one's "P" form
//     would be cut too, every one is drawn as its bare number. Otherwise all are drawn in full. So
//     the button and its list always agree, a list never mixes "Preset 1" with "P10" or "P1" with
//     "10", and "Open in" matches the top bar.
//   • WHERE EVEN THE BARE NUMBER IS CUT, NOTHING MORE IS DONE: it is cut like any other name, with
//     the ellipsis. (In the top bar that is past "9": the control's floor is its arrows and one
//     digit — the ★ "the control has a floor" note above.)
//   • IT FOLLOWS THE SCREEN, WITH NOTHING REMEMBERED. The answer is worked out from the full names,
//     their "P" forms, and the rooms as they are now (lib/presetNameWidth's stockNameForm) — never
//     from what is drawn — so a rotation or a wider window brings the longer forms straight back.
//     What is drawn cannot feed back into it: a name cell's width comes from its control, never
//     from the text in it.
//   • DRAWN ONLY. The stored name is never changed. The rename field shows it in full, every
//     sentence that quotes it quotes it in full, and a screen reader hears it in full — the short
//     form is hidden from one, with the real name beside it.
//   • A name the player typed that reads "P1" (or "1") beside a stock "Preset 1" drawn that way
//     gives two rows that read alike. Names were never required to differ (two presets may both be
//     called "Weekend"), so this is that same case and gets no machinery of its own.
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
// that follow it. Each preset's value is a field of its settings (store/settings), and store/amnesic's
// useAmnesicModeOf answers for EVERY preset, including the ones you are not on.
// ⚠ IT IS SPOKEN AS ONE WHOLE PHRASE — "Weekend, amnesic", name included, in an `sr-only` element,
// with the visible name hidden from a screen reader beside it (the same element a stock name drawn
// short is spoken from: "Preset 1", or "Preset 1, amnesic") — rather than a ", amnesic" tail for
// the browser to join onto the name. A name assembled from several elements is joined by rules that
// differ by engine and by each piece's layout: Chromium puts a space between a block-level piece
// and its neighbour (the name is a flex item, the sr-only span is absolutely positioned), which
// read as "Weekend , amnesic"; and a join that trims each piece drops a leading space instead,
// which is "Weekendamnesic". One text node has nothing to join, so it reads the same everywhere.

// ★ WHAT A PRESET LIST MUST ALWAYS HAVE ROOM FOR IN A ROW: the short form of any two-digit stock
// name ("P10" … "P99") — handed to CustomSelect as `leastRowLabel` by both preset lists (the ★
// "one least width" note above). Every one of the ninety is stacked in one cell, so the cell is as
// wide as the WIDEST of them in whatever font the row is set in — digits are not all one width in
// every font, and nothing here guesses which is widest. Never seen: CustomSelect lays it out in a
// hidden row to measure it. Built from the same two functions that name a preset and shorten the
// name, so it cannot disagree with what a row actually draws.
const TWO_DIGIT_SHORT_NAMES = Array.from(
  { length: 90 },
  (_, i) => shortStockName(defaultPresetName(i + 10))!,
)
export function ShortStockNameRoom() {
  return (
    <span className="grid">
      {TWO_DIGIT_SHORT_NAMES.map((name) => (
        <span key={name} className="col-start-1 row-start-1">
          {name}
        </span>
      ))}
    </span>
  )
}

// ★ ONE PRESET'S ROW, AS EVERY PRESET LIST IN THE APP DRAWS IT — this switcher's, and since round 23
// the ⚙ panel's "Open in" dropdown, which is the SAME control showing the SAME list (the
// owner's "learn it once"). Exported rather than copied so the two can never drift: a name that
// truncates here and overflows there, or an amnesic preset that one list forgets to announce, would
// be exactly the kind of disagreement this file's history keeps paying for.
// ⚠ `data-preset-name-cell` COMES ALONG TO "Open in" TOO, AND COUNTS THERE: lib/presetNameWidth
// measures every cell that wears it, so "Open in" and its list are places a name can be cut by
// drawing their names with this component, with nothing else to wire.
export function PresetOptionLabel({ preset: p }: { preset: Preset }) {
  const amnesic = AMNESIC_SPOKEN[useAmnesicModeOf(p.id)]
  // The app-wide answer (the ★★ "drawn short" block above): every cell asks the same question in
  // the same render, and stockNameForm answers it once.
  const form = stockNameForm(
    usePresets((s) => s.presets),
    useNameRooms(),
  )
  const short =
    form === 'full' ? null : form === 'short' ? shortStockName(p.name) : stockNumber(p.name)
  // The stored name, as much of it as is ever drawn or said (lib/presetNameText).
  const full = nameAsDrawn(p.name)
  const drawn = short === null ? full : nameAsDrawn(short)
  // A copy's number (" (2)"), kept whole where the cell cuts the name (the ★ below). A stock name
  // drawn short has none: "Preset 1 (2)" is not a stock name.
  const number = short === null ? copyNumberOf(p.name) : ''
  // What a screen reader is given IN PLACE OF what is drawn — only when the two differ: an amnesic
  // preset has its words after its name, a stock name drawn short is said in full, and a copy's
  // name drawn in two pieces is said as the one name it is (pieces of a name are joined by rules
  // that differ by engine — the ⚠ "one whole phrase" note above).
  const spoken = amnesic ? `${full}, ${amnesic}` : short !== null || number !== '' ? full : null
  return (
    // The name cell. `flex` makes it a block-level flex container, so inside the trigger's grid
    // cell AND inside a dropdown row it is the same box with the same rules — one structure
    // serving both, which is what stops the two from drifting. It has no width and no least width
    // of its own (the ⚠ "no floor" note above): it is exactly as wide as what holds it, never as
    // wide as the name in it. `data-preset-name-cell` and the ref are how lib/presetNameWidth
    // finds THIS exact element and hears when it changes size.
    <span className="flex items-center" data-preset-name-cell="true" ref={watchNameCell}>
      {/* `truncate` (overflow-hidden + ellipsis + nowrap) goes on the NAME, not on the cell: a
          flex container's own text-overflow never fires, because the ellipsis rule applies to a
          block box's inline content and this box's children are flex items. Put it here and a name
          longer than the cell shortens with a real "…" — which is the whole of how a long name is
          handled: nothing stops one being typed.
          ⚠ WHAT IS DRAWN IS nameAsDrawn, NOT THE RAW NAME: all of it for any name a slot could
          show, and only the start of a pasted book (lib/presetNameText says why a browser must
          never be handed the whole of one to lay out). */}
      {number === '' ? (
        <span className="truncate" aria-hidden={spoken !== null ? true : undefined}>
          {drawn}
        </span>
      ) : (
        // ★ A COPY'S NAME IS CUT BEFORE ITS NUMBER, NEVER THROUGH IT (Round 26): "A rather long
        // preset na… (2)", so a copy of a long name can still be told from its original. Two
        // pieces in one line: the name, which gives way and is cut with "…" exactly as any name
        // is, and the number, which keeps its size — `whitespace-pre` keeps the space before its
        // bracket, which a flex item would otherwise drop from the start of its line. On a cell
        // too narrow for the number and an ellipsis together, the number is cut too, after
        // leaving the name an em — about an ellipsis' width — so a cut there still shows "…".
        // `min-w-0`: the pair shrinks with the cell instead of holding it open.
        <span className="flex min-w-0" aria-hidden="true">
          <span className="truncate">{drawn.slice(0, drawn.length - number.length)}</span>
          <span className="shrink-0 overflow-hidden text-ellipsis whitespace-pre max-w-[calc(100%-1em)]">
            {number}
          </span>
        </span>
      )}
      {spoken !== null && <span className="sr-only">{spoken}</span>}
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
      leastRowLabel={<ShortStockNameRoom />}
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
