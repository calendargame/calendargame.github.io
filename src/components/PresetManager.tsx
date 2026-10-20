import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import {
  BOTTOM_EDGE_BAND_PX,
  SCROLL_REGION_CLASS,
  readFadeDepthPx,
  scrollBandIntoView,
  scrollEdgeGaps,
  scrollFadeClass,
  useScrollEdgeState,
} from './scrollRegion.js'
import { MODAL_CARD_CLASS } from './modalContract.js'
import { NOT_OFFERED_BTN_CLASS, RESET_BTN_CLASS } from './controlClasses.js'
import QuotedName from './QuotedName.jsx'
import CustomSelect from './CustomSelect.jsx'
import { NameCutBeforeNumber, PresetOptionLabel } from './PresetSwitcher.jsx'
import { usePresets, normalizePresetName } from '../store/presets.js'
import { useRemoteEpoch } from '../store/syncedDoc.js'
import type { Preset } from '../store/presets.js'
import { useAmnesicModeOf } from '../store/amnesic.js'
import { AMNESIC_SPOKEN } from '../store/amnesicMode.js'
import {
  createPreset,
  deletePreset,
  duplicatePreset,
  isPresetFactory,
  movePreset,
  renamePreset,
} from '../store/presetControl.js'
import { isCutSomewhere, useNameRooms } from '../lib/presetNameWidth.js'
import { copyNumberOf, nameAsDrawn } from '../lib/presetNameText.js'
import {
  targetIndexForCenter,
  stepsToReorder,
  previewShift,
  averageRowHeight,
  clampDragCenter,
  edgeFadeInset,
  autoScrollDirection,
} from '../lib/presetReorder.js'
import { bandDirection, scrollDelta } from '../lib/pointerGestures.js'
import { scrollBoxTo } from '../lib/appScroll.js'

// ============================================================
// PresetManager — the card behind the ⚙ menu's "Manage Presets" button: make a preset, rename one,
// move one up or down the list, delete one.
//
// ── WHY IT IS A ⚙ MODAL AND NOT PART OF THE SWITCHER ─────────────────────────────────────────
//
// ★ THE SWITCHER IS FOR CHOOSING, THIS IS FOR EDITING, AND MERGING THEM WAS REJECTED ON TWO COUNTS.
// The obvious alternative was a "Manage…" row at the foot of components/PresetSwitcher's dropdown.
//   • It would need a SENTINEL option value threaded through CustomSelect's onChange, which is
//     `switchPreset(Number(v))` today — one line whose whole virtue is that it cannot mean anything
//     but "open this preset". A row that looked like a preset and was not is the shape of bug that
//     ends with switchPreset called on an id nothing owns.
//   • The dropdown lives in the FIXED top bar and CustomSelect measures its panel ONCE per open
//     from the trigger's viewport rect (the caller contract at the top of that file). A panel that
//     could grow a rename field and a confirmation step is a panel that changes height while it is
//     open, which is exactly the thing that contract says it does not survive.
// The ⚙ panel is where every other thing you do TO your saved data already lives — Save Defaults,
// the defaults manager, Clear Saved Defaults, Reset Settings, Full Reset — and it already has a
// popup idiom with a shared contract. So this is one more user of that contract, not a new style:
// the same shell (components/Popup), the same card, the same tokens.
//
// ── ⚠⚠ THE CONFIRMATION IS A VIEW OF THIS CARD, NOT A POPUP ON TOP OF ONE ─────────────────────
//
// Deleting a preset that holds anything asks first (a preset that holds nothing skips the question
// — see the ★ further down), and the ask REPLACES this card's body rather than opening a second
// dialog over it. The question is about a row of this list, so it is answered where the list was:
// one card, one place to look, and stepping back out of the question lands on the list again with
// nothing to re-open. (It is a choice, not a limit. The app stacks popups properly —
// components/overlayStack — and the storage-full notice does open over this card.)
//
// ★★ AND IT IS A VIEW YOU CAN DISMISS BACK OUT OF — THE LADDER. There is no Cancel button (the
// owner's rule, app-wide: tapping outside or pressing Escape already says it), so every dismiss
// route has to mean "never mind" here too: while a delete is pending, a dismiss returns to the
// LIST, and a second dismiss closes the card. It is the ladder the rename field below has always
// had (the first Escape belongs to the name being typed, the second to the card), applied to the
// other view.
// ⚠ WHICH IS WHY `pendingDeleteId` IS A PROP AND NOT THIS COMPONENT'S OWN STATE. A ladder is a
// decision about a DISMISS, and the dismiss handlers belong to the caller (components/SettingsPanel
// gives the popup its onDismiss and registers the question as its own entry in the stack, so that
// Escape and Android Back have something to close that is not the whole card) — so the flag they
// branch on is held there, beside them, and handed down. Everything about DRAWING the two views is
// still this component's, focus included.
// ⚠ THE DIALOG'S ACCESSIBLE NAME THEREFORE CHANGES WITH THE VIEW, and both titles are FIXED
// STRINGS — "Presets" and "Delete this preset?". The preset's name is in the confirmation's BODY
// and deliberately not in its title: the Changelog popup paid for that lesson (see the ★ at its
// heading row in components/SettingsPanel), where an id placed one element too high made the
// dialog's name change on every deploy. A landmark that renames itself per row is the same defect.
//
// ── WHAT EACH CONTROL ACTUALLY DOES, and where the honesty is owed ───────────────────────────
//
// ★ NEW PRESET STARTS FROM FACTORY DEFAULTS, NOT FROM A COPY OF THE ONE YOU ARE ON (the owner's
// call). Nothing here implements that: store/presetControl's createPreset allocates an id whose
// keys hold nothing, and store/presets' mergeOverDefaults is what turns "no saved copy" into the
// factory values instead of a clone of whatever was in memory. This button is the call.
// ★ AND IT DOES NOT SWITCH TO WHAT IT MAKES, which is createPreset's documented contract rather
// than an omission here: creating and opening are separate acts, so making a preset cannot yank a
// player out of the round they are in. The new row appears at the foot of the list; the switcher in
// the top bar is how you go to it.
//
// ★ DUPLICATE (Round 26, Q5) SITS BESIDE IT, AND IS A DROPDOWN OF THE PRESETS: one tap opens the
// list, one tap on a preset makes a copy of it — every setting, the saved defaults, the per-mode
// setup, and the Amnesic value, none of the stats, Bests, or times (store/presetControl's
// DUPLICATE_RULES is the one list of what goes across). The copy is named after its original with
// " (2)" (" (#)" counts on — store/presets' copyName), lands DIRECTLY AFTER its original, and the
// list scrolls to it; like New Preset it does not switch you into it.
//   • THE LIST IS components/CustomSelect's, as a MENU (its `menuLabel`): the button always says
//     "Duplicate" and no row is checked, because choosing is an act, not a setting. Its rows are
//     the same rows as every other preset list (PresetSwitcher's PresetOptionLabel), so a name
//     reads the same here as in the top bar — a stock name drawn short there is short here — and
//     an amnesic preset is announced the same way. The list is as wide as its longest name needs
//     (CustomSelect's 'content'), so it is never the place a name has the least room.
//   • A COPY THE DEVICE HAS NO ROOM FOR IS NOT MADE, and the card says so under the two buttons
//     ("This device has no room to save a copy of that preset, so none was made."), through the
//     same live region as the rename notes. Nothing is half-made (duplicatePreset). The note goes
//     at the next New Preset or Duplicate, at a delete — which may be what made the room — or with
//     the card.
//
// ★★ A NAME MAY BE ANY LENGTH, AND THE FIELD NEVER REFUSES OR ALTERS WHAT IS TYPED. The rename
// field is a plain text box: whatever is typed, pasted, composed by an input method, or dictated
// goes in exactly as the browser put it there, and is saved as it is (store/presets'
// normalizePresetName only trims the outer spaces and names an empty one). It used to refuse the
// keystroke that would not fit where names are shown; the owner replaced that with a note.
// ★ THE NOTE ("Some places will show this name cut short.") sits under the field while the text in
// it does not fit the narrowest place a preset name is shown — the top bar's control, a row of its
// list, "Open in", or a row of its list (lib/presetNameWidth measures the real cells, each in its
// own font). It is DRAWN FROM THE TEXT AND THE ROOMS, with no flag behind it: it appears at the
// exact character that stops fitting, goes at the one that fits again, follows a rotation or a
// resize while the field is open, and is there at once for a stored name that is already too long
// when its field is entered. The name is shown with an ellipsis in those places either way
// (components/PresetSwitcher); nothing here measures on a commit, so entering and leaving a field
// changes nothing.
// ★ IT IS SAID ONCE EACH TIME IT APPEARS, to a screen reader, through the card's one polite live
// region (below, after the list) — which holds the note's words exactly while the note is on
// screen, so staying on through further typing announces nothing more. The visible copy is hidden
// from a screen reader so the words are not met twice.
// ★ A NAME TOO BIG FOR THE DEVICE TO SAVE IS NOT SAVED, AND THE ROW SAYS SO. With no limit on a
// name, a pasted book can be more than the device has room for. store/presetControl's renamePreset
// refuses that rename whole — nothing half-written, the stored name untouched — and the field goes
// back to the name that IS saved, with a second note under it ("This device has no room to save
// that name, so it was not changed."), said through the same live region. (Why it is refused
// rather than held like other saves the device turns down: store/presets' applyRegistryIfRoom.)
// ★ …ON EVERY WAY OF LEAVING THE BOX, AND IN ONE PLACE: UNDER THE ROW. A rename is attempted when
// the box loses the keyboard, whatever took it (ONE attempt per edit — Enter only leaves the box),
// so the note has to survive whatever that was:
//   • it is NOT cleared by a box being entered — the tap that takes the keyboard to another row's
//     box is the very thing that caused it. It goes when the player next TYPES in a name box (they
//     have moved on), when its row is deleted, and with the card;
//   • A TAP ON THE DIM THAT HAS JUST HAD A NAME REFUSED DOES NOT ALSO CLOSE THE CARD. It would
//     take the note down with it before it was drawn. The tap is spent on the news — the card
//     stays, the note is under its row — and the next tap closes the card as usual. It is the
//     card's own ladder again (the delete question, the first Escape in a name box): a dismiss
//     that has something to answer for first answers for it. That is why there is no second
//     surface for this message: the card never goes while it is unseen.
//   • BACK IS A WAY OF LEAVING THE BOX TOO (Q17, Round 26). Android's Back, a browser's Back, a
//     back-swipe: "leave", and leaving keeps what was typed — it used to close the card under the
//     box with nothing attempted, and the name was silently gone. So Back leaves the box exactly as
//     a tap elsewhere does (the caller's dismiss asks leaveNameBoxRef, below) and then closes the
//     card; and if that rename was refused, the Back is spent on the news instead — the card stays,
//     the note is under its row, and the next Back closes it. (components/overlayStack's ★ above
//     useRegistration is how a popup stays after a Back.)
//   • ESCAPE IN THE BOX IS THE ONE DISCARD: the desktop convention for an edit, and what How to
//     Play has always said ("Esc throws it away"). Nothing is attempted, so there is nothing to
//     refuse and nothing to say; a second Escape closes the card.
//
// ★★ MOVING IS A DEDICATED DRAG HANDLE, AS OF ROUND 20 — REPLACING THE ↑/↓ PAIR THIS COMMENT
// USED TO ARGUE AGAINST A DRAG FOR. The owner's call, made explicit rather than re-litigated here:
// no arrow buttons, one control that is both a pointer/touch drag and a keyboard reorder action.
// The two prior pointer gestures that passed in Chromium and failed on the owner's iPhone (round
// 11's mode selector) were a DIFFERENT SHAPE of gesture in a different part of this app — press,
// drag across an open surface, release wherever — and neither reason they failed is a reason a
// dedicated handle has to fail the same way:
//   • THE GESTURE NEVER STARTS ANYWHERE BUT THE HANDLE. The mode selector's failure mode was a
//     press ambiguous between "open a menu" and "start scrolling/panning", decided differently by
//     iOS than by Chromium. This list is inside a scroll region (components/scrollRegion), and the
//     one thing that keeps a drag from fighting that scroller is that only ONE small element per
//     row — never the row, never the name field, never the list itself — ever attaches a drag
//     listener at all. Touching anywhere else is unconditionally an ordinary scroll or tap.
//   • touch-action:none IS DECLARED ON THAT ONE ELEMENT, and nowhere wider (below), which is the
//     platform's own opt-out of exactly the ambiguity that broke the mode selector — told to the
//     browser, not inferred from timing.
//   • THE MECHANISM IS NATIVE POINTER EVENTS WITH EXPLICIT CAPTURE (setPointerCapture on
//     pointerdown), rather than a bespoke touch/mouse pair. ⚠ THIS IS THE FIRST USE OF BROWSER
//     CAPTURE IN THIS APP — a claim that it shares "the same primitive" as lib/pointerGestures
//     stood here until it was checked against that file: pointerGestures latches its own gesture
//     with a plain module-scope `pointerId` variable and DOCUMENT-level listeners, never the
//     browser's own capture API. What the two genuinely share is the GUARD, not the mechanism —
//     "only the primary contact of a left-button mouse, or any primary touch/pen, may start a
//     gesture" is copied verbatim from CustomSelect's pressDrag (see beginDrag below) — and that
//     part IS accurate. Capture was chosen here anyway, over pointerGestures' pattern, because
//     THIS gesture is scoped to one small element rather than the whole document — capture keeps
//     onPointerMove/Up attached to the handle itself with no listener to install or tear down at
//     the document level, which pointerGestures' document-wide reach genuinely needs and this
//     control does not.
// None of that is a promise the drag will read as smooth ON DEVICE — it cannot be, from here (see
// lib/presetReorder for what the mechanism actually does, and PROJECT.md's standing rule that a
// gesture is device-verified or it is not verified at all). It is the argument for why this design
// has a real chance where a plain "onPointerMove sets a translateY" implementation would not.
//
// ★ THE ARITHMETIC ITSELF IS lib/presetReorder's, kept OUT of this component on purpose — jsdom has
// no layout engine, so the "which slot is the pointer over" decision has to be provable against
// fabricated numbers, independent of any real render. This file only wires real pointer/keyboard
// events to it and to store/presetControl's movePreset, which is completely unchanged by this
// round: a drag commits, once, at the finger lift, as the same ±1 adjacent-swap calls the keyboard
// path (and the old buttons before it) already made one at a time. See movePreset's own comment for
// why that single primitive is enough for both.
//
// ★ DELETING IS PERMANENT AND THE CARD SAYS SO IN THOSE WORDS — WHEN THERE IS SOMETHING TO SAY IT
// ABOUT. The question is SKIPPED for a preset that is still bit-identical to a new one:
// every ⚙ setting at its factory value, no stats or bests, no saved defaults, no parked round.
// Nothing is permanent about deleting a preset that holds nothing, so the confirmation would be a
// tap spent on a non-decision. The test is store/presetControl's isPresetFactory — deliberately
// written so that it can only ever be WRONG in the direction of asking — and it is read at the
// press, never rendered from (see pressDelete below for why the ✕ looks identical either way).
// For the preset you are ON it also takes the screens into account (`screensFresh`): a round or run
// in progress, or an ended one still showing, is something to lose even though no store holds it.
// For every preset that does hold something, everything below is unchanged. Two cases are real and
// both are handled out loud rather than hidden:
//   • THE ACTIVE PRESET. deletePreset opens the neighbour, which IS a switch — so the screens are
//     cleared by src/main.tsx's registry subscription, a round or run in progress included. The
//     confirmation says that in advance, because it is the one consequence a player would otherwise
//     meet as a surprise.
//   • THE LAST REMAINING PRESET. deletePreset REFUSES it (the app cannot render "no presets", and
//     "delete everything" is what Full Reset is for), so the control is withheld in the app's own
//     three-statement convention — drawn unavailable, announced unavailable, and inert in its own
//     handler — plus a line under the list saying why, because a dim on its own states a fact and
//     not a reason.
// ⚠ WHAT THE CARD DELIBERATELY DOES NOT MENTION is that deleting preset 1 vacates the un-namespaced
// storage keys forever, so a build that has never heard of presets would open factory-fresh
// afterwards. It is true (store/presetControl's deletePreset argues it in full) and it is not
// something a player can observe from inside this app, so putting it in a confirmation would be
// spending a reader's attention on a fact that cannot help them decide.
// ============================================================

// What the note under a name's field says while that name does not fit everywhere it is shown. True
// wherever it is cut — one place or all of them — so it says "some places", not which.
const CUT_SHORT_NOTE = 'Some places will show this name cut short.'
// What it says instead when the device had no room to save the name just typed. True of a device
// that is full and of a name that is simply enormous alike.
const NO_ROOM_NOTE = 'This device has no room to save that name, so it was not changed.'
// What it says under the New Preset / Duplicate row when the device had no room for a copy.
const NO_ROOM_FOR_COPY_NOTE =
  'This device has no room to save a copy of that preset, so none was made.'

// THE ROW'S TWO ICONS — DeleteIcon (the ✕) and ReorderHandleIcon (the grip) — both inline SVG drawn
// in currentColor, the house pattern (W5Logo, GuidePage's dot diagram): no icon font, no external
// asset, and always the colour of the text around them.
// ⚠ BOTH ARE aria-hidden, AND NEITHER NEEDS A NAME OF ITS OWN: the control that renders each one
// carries an aria-label, which REPLACES an element's content for a screen reader. (That is the
// opposite of the ✓ and A markers below, which are bare spans with no name of their own and
// therefore need hiding plus an sr-only word.)
//
// ★ THE ✕ IS DRAWN, NOT TYPED. It used to be the character "✕" in the button's text, and a
// character sits where its font's metrics put it: on its line's baseline, inside a line box, with
// whatever space that font leaves above and below the ink — which is not the middle of the button,
// and is a different "not the middle" in each font a device falls back to. Two strokes in a square
// viewBox have no baseline and no font: the button centres the square (DELETE_BTN_CLASS is a
// centring flex box) and the cross is centred in the square by construction. Sized in em, so it
// stays in step with the row's text tier on the app's fluid root font-size.
function DeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-[1em]" aria-hidden="true" focusable="false">
      <path
        d="M3 3 13 13M13 3 3 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

// The grip: three plain horizontal bars, rounded ends, no arrowheads — iOS's own native system
// reorder icon, shown to the owner and approved. A Unicode "hamburger" / "equals" character renders
// as three bars of inconsistent weight and spacing across engines, which is the same reason the ✕
// above is drawn.
// `held` is true on the row being dragged: the bars then sit on a patch of the card's own colour
// (index.css's .held-ink says what that is for).
function ReorderHandleIcon({ held }: { held: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      className={held ? HELD_INK_CLASS : undefined}
    >
      <line
        x1="3"
        y1="4"
        x2="13"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="8"
        x2="13"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="12"
        x2="13"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── THE ROW, LEFT TO RIGHT ON SCREEN: ✕ · name · ✓ · grip ───────────────────────────────────────
//
// ★ THE iPHONE REORDER-LIST CONVENTION, AND THE REASON IS A MIS-TAP, NOT LOOKS. The grip and the ✕
// used to sit side by side at the right edge. The grip is the control a thumb reaches for over and
// over; the ✕ is the destructive one, and a preset that holds nothing deletes on the spot with no
// question to catch a slip. A frequently-grabbed handle beside a destructive button is how a
// reorder becomes a delete. So they are at opposite ends — the ✕ at the LEFT edge, the grip at the
// RIGHT edge where the thumb already is — with the name between them and the current-preset mark
// after the name.
//
// ★★ THE ORDER IN THE MARKUP IS DIFFERENT, ON PURPOSE: name · ✓ · grip · ✕ — the ✕ LAST. The
// markup order is the order Tab walks and the order a screen reader reads, and the on-screen order
// would make "Delete <the first preset>" the first thing the keyboard lands on in this popup: one
// Tab and one Enter from opening it, a preset that holds nothing would be gone, unasked. So the
// row reads its name first, then the handle that moves it, and the destructive control comes last;
// each cell is PLACED in its on-screen column by class (ROW_COL below), which is what lets the two
// orders differ. The same slip is why nothing destructive ever takes the keyboard on open: the
// popup focuses its card, never a control.
//
// THE ✕ KEEPS ITS BUTTON CHROME (the owner's ask): a boxed control says "tap". `shrink-0` because
// the NAME is the thing that gives way when the card is narrow — a control that shrank to a sliver
// would be the wrong casualty. The surface is `surface-toggle`, the same no-fill interactive tier
// Manage Presets and the View/Clear Saved Defaults pair wear: pressing it does not always delete (a
// preset that holds anything asks first), and the rose fill is kept for the button that commits a
// deletion — the confirmation's own Delete.
// IT IS A CENTRING BOX: `self-stretch` makes it exactly as tall as the name box beside it (the row's
// track), and the flex centring puts the icon in the middle of that — both ways, in every font.
// ⚠ TOUCH SIZE IS A DEVICE-ONLY QUESTION. At the card's ~288px of content it lands near 28×30px, the
// ⚙ panel's existing control tier (its On/Off switches are px-3 py-1.5 text-xs) and not a new,
// smaller one — but jsdom lays nothing out, so only the owner's iPhone can say whether it is
// comfortable.
const DELETE_BTN_CLASS =
  'shrink-0 self-stretch flex items-center justify-center px-2 rounded-xl text-xs border surface-toggle text-(--tx-100-80)'
// THE GRIP HAS NO BUTTON CHROME AT ALL — no border, no fill — the other half of the owner's call: a
// bare ≡ says "drag", where a boxed one reads as one more thing to tap. What it keeps is everything
// a control needs that is not decoration: a hit area wider and taller than its 14px glyph
// (`self-stretch` takes the row's full height, px-3 gives it ~38px of width), a grab cursor for a
// mouse, and the popup's FOCUS RING for the keyboard route (index.css, "THE KEYBOARD FOCUS RING" —
// drawn on whatever the keyboard is on in a popup, so the grip asks for nothing): it is
// Tab-reachable and its ↑/↓ move a preset, and with no border or fill of its own there is nothing
// else that could show the keyboard is on it. A GRAB draws none, though the press focuses the grip
// from script (beginDrag says why it has to): the ring is for the keyboard, and lib/keyboardFocus
// knows a press from a key whatever focuses afterwards.
// The glyph is quieter than the text (--tx-200-80) because it is furniture until it is held.
const GRIP_CLASS =
  'shrink-0 self-stretch flex items-center justify-center px-3 rounded-xl text-(--tx-200-80) cursor-grab'
// Each cell's on-screen column in the row's four-column grid, all on the first row track — the
// placement that lets the markup order (above) differ from the order on screen.
const ROW_COL = {
  delete: 'col-start-1 row-start-1',
  name: 'col-start-2 row-start-1',
  current: 'col-start-3 row-start-1',
  grip: 'col-start-4 row-start-1',
} as const

// ── THE ROW IN THE HAND ─────────────────────────────────────────────────────────────────────────
//
// ★ WHAT A DRAGGED ROW LOOKS LIKE: ITS PARTS, MOVING TOGETHER — NOT A SLAB. All of it travels (✕,
// name, ✓, grip: a ✕ left behind beside a gap would read as belonging to nothing), but only the two
// pieces that are boxes at rest are drawn lifted: the ✕ button and the name box each get the
// "picked up" shadow. The ✓ and the grip have no box at rest and are given none in the hand — they
// ride along as the bare marks they are. What this replaced drew ONE rounded surface behind the
// whole row, the empty stretch between the name and the grip included; the owner found a lifted
// shape with nothing in most of it strange, and it is gone.
//
// Three classes, all index.css's, worn only by the row being dragged:
//   • HELD_PIECE_CLASS — on the ✕ button and the name box. Their resting fill is a see-through
//     tint over the card; in the hand the same tint is laid over the card's own solid colour, so
//     the piece looks exactly as it did and the row passing underneath cannot show through it.
//   • HELD_SHADOW_CLASS — the lift itself, on two empty boxes drawn in the ✕'s and the name's own
//     grid cells (heldShadows, in the row). Separate boxes, behind everything in the row, because a
//     shadow on the pieces themselves falls on the piece beside it: the two are 4px apart and the
//     shadow spreads 12, so whichever was painted second would smudge the other's edge.
//   • HELD_INK_CLASS — on the ✓ and the grip's bars: a patch
//     of the card's colour exactly behind the mark, invisible against the card. It is what stops a
//     row sliding past underneath from drawing its own grip THROUGH this one for the tenth of a
//     second the two cross. It is not a surface — it has no edge, no shadow and no size beyond the
//     mark — and it never covers anything at rest: lib/presetReorder's targetIndexForCenter keeps
//     the dragged row at least half a row from every other, which is further than the patch
//     reaches.
// The list's scroll region, reaching one card gap (space-y-3 = 0.75rem) past its rows above and
// below — the ★ note at listRef, in the component, says what for. The four numbers are one fact:
// the padding, the margins that cancel it, the cap's extra 1.5rem, and --fade-reach, which tells the
// region's edge fades (index.css) where the rows stop inside it.
const LIST_REACH_CLASS = '-my-3 py-3 [--fade-reach:0.75rem] max-h-[calc(45vh_+_1.5rem)]'
const HELD_PIECE_CLASS = 'held-piece'
const HELD_SHADOW_CLASS = 'held-shadow'
const HELD_INK_CLASS = 'held-ink'

// FOUR PROPS. The first two are the same one fact: which preset the delete confirmation is asking
// about, or null while the list is showing. Nothing in this card dismisses itself — it has no Close
// and its confirmation has no Cancel — so the caller (components/SettingsPanel) owns the open flag
// and what a dismiss means, exactly as it does for the other popups. The dismiss routes LADDER
// through this value (the header comment argues why it therefore lives with them and not here), so
// the card both reads it to pick its view and writes it when the ✕ poses the question or the Delete
// button answers it.
// The third, `screensFresh`, is src/main.tsx's aggregate of the five mode screens' freshness reports,
// passed straight through to isPresetFactory at the ✕ (pressDelete below says why it is needed).
// The fourth, `leaveNameBoxRef`, is the caller's handle on the one thing its dismiss has to do
// first: leave a name box that still has the keyboard, attempting the rename as every way of
// leaving does, and say whether the device refused it (the ★ "Back is a way of leaving the box
// too" note above). This card fills it in; the caller only calls it.
// What a row says after its name for a preset that forgets — spoken, not drawn (components/PresetSwitcher
// argues both halves). Its own component, so each row subscribes to its own preset's value
// (store/amnesic's useAmnesicModeOf).
function AmnesicSpoken({ presetId }: { presetId: number }) {
  const spoken = AMNESIC_SPOKEN[useAmnesicModeOf(presetId)]
  return spoken ? <span className="sr-only">{spoken}</span> : null
}

export default function PresetManager({
  pendingDeleteId,
  setPendingDeleteId,
  screensFresh,
  leaveNameBoxRef,
}: {
  pendingDeleteId: number | null
  setPendingDeleteId: (id: number | null) => void
  screensFresh: boolean
  leaveNameBoxRef: RefObject<(() => boolean) | null>
}) {
  // Two narrow subscriptions, the same pair components/PresetSwitcher takes and for the same
  // reason: `presets` is replaced wholesale by applyRegistry (so reference equality is a correct
  // change signal) and `activeId` is the one scalar this card renders a mark for. Everything this
  // card does writes through store/presetControl and lands back here as a new list.
  const livePresets = usePresets((s) => s.presets)
  // ★ WHILE A ROW IS BEING DRAGGED, ANOTHER WINDOW'S CHANGE TO THE LIST WAITS FOR THE DROP
  // (design-q1-q2.md v4, 6.7). The drag's whole model is the rows' places measured at the grab
  // (DragState's slotMidpoints, below), and another window can change the list at any moment (the
  // windows-in-sync door brings in its new preset, its rename, its reorder): shown mid-drag, that
  // change would move rows out from under the finger. So the rows a drag shows are its own (`rows`):
  // the list at the grab, and every change made HERE since (a key pressed on the held grip) — and
  // the store, which always holds the merged list, is what the drop moves and what shows after it.
  const [drag, setDrag] = useState<DragState | null>(null)
  const presets = drag?.rows ?? livePresets
  const remoteRegistry = useRemoteEpoch((s) => s.registry)
  const activeId = usePresets((s) => s.activeId)

  // ── The rename in flight ────────────────────────────────────────────────────────────────────
  //
  // ★ ONE PENDING EDIT, HELD AS {id, text}, NOT A MIRROR PER ROW. Only one field can hold the
  // keyboard, so a per-row array would be N−1 values that are always equal to the store and one
  // that is not — and the moment they can disagree, "which is the real name" has two answers. This
  // shape makes it unrepresentable: a row shows `editing.text` if it is THE row and `p.name`
  // otherwise, so a preset that is not being typed into can only ever show what is saved.
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const editingText = (id: number, name: string) => (editing?.id === id ? editing.text : name)

  // ★ THE NOTE UNDER THE FIELD BEING TYPED INTO — whether its text, saved as it stands, would be
  // shown cut short somewhere (the ★ note above this component). Nothing is stored for it: it is
  // worked out from the pending text and the rooms on every render, and the rooms re-render this
  // card when they change.
  // ⚠ IT IS ASKED ABOUT THE NAME THE TEXT WOULD BECOME, not the raw text: a space typed after a
  // name that just fits is trimmed on saving and must not raise the note, and an emptied box is
  // about to be "Preset N" again.
  const nameRooms = useNameRooms()
  const cutRowId =
    editing && isCutSomewhere(normalizePresetName(editing.text, editing.id), nameRooms)
      ? editing.id
      : null

  // ★ THE ROW WHOSE LAST RENAME THE DEVICE HAD NO ROOM TO SAVE (the ★ notes above this component).
  // Set by the attempt that was refused; cleared by the next keystroke in any name box. Unlike the
  // note above it IS remembered — it is about something that happened, not about the text in the
  // box, which has already gone back to the saved name. A row that has since been deleted has no
  // note to show, so the id is only ever read through the list.
  const [refusedRenameId, setRefusedRenameId] = useState<number | null>(null)
  const noRoomRowId = presets.some((p) => p.id === refusedRenameId) ? refusedRenameId : null
  // ★ A NAME WAS REFUSED JUST NOW — by the tap now in progress, or by the Back being answered —
  // what stops that same tap, if it is on the dim, from closing the card over the note (the scrim
  // listener below reads it and spends it), and what tells the caller's dismiss the same thing for
  // a Back (leaveNameBoxRef, below). Dropped at every press, which comes before the keyboard leaves
  // the box, so it can only ever be about the press that is still going on.
  const refusedJustNow = useRef(false)

  // The delete confirmation's subject, resolved from the id the caller holds. An ID and not the
  // preset object: the registry can be rewritten under this card (another row renamed, one moved),
  // and a captured object would go stale where an id is resolved fresh on every render.
  const pendingDelete = presets.find((p) => p.id === pendingDeleteId) ?? null

  // ★ THIS CARD RE-FOCUSES ITSELF WHEN ITS VIEW CHANGES. The popup shell (components/Popup) puts
  // the keyboard on the dialog when the popup opens; what it cannot see is the swap between this
  // card's two views, which removes the control that had the keyboard (the row's ✕ on the way in,
  // the Delete button on the way out) while the popup neither opens nor closes. Left alone, the
  // symptom is silent: press ✕, and the keyboard is on <body> behind a scrim with a destructive
  // button on it. The dependency is the VIEW, so it covers both directions — into the confirmation
  // and back out of it. (It also runs once on mount, where the shell has already focused the same
  // element and it changes nothing.)
  // ⚠ IT DOES NOT COVER THE SKIPPED DELETE, because nothing it watches changes there — the view
  // stays the list from start to finish. That route removes the very row whose ✕ has the keyboard,
  // so pressDelete refocuses the card itself; see the note there.
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    cardRef.current?.focus()
  }, [pendingDeleteId])
  // ★ THE TAP ON THE DIM, HEARD BEFORE THE POPUP SHELL HEARS IT (the ★ "on every way of leaving the
  // box" note above this component). The shell closes the card on a click on its dim
  // (components/Popup); this listens on the same element in the capture phase, so it runs first:
  //   1. a name box that still has the keyboard gives it up here. Most browsers have already
  //      taken it away at the press; one that leaves it in the box when something that is not a
  //      control is tapped has not, and the edit must be attempted before the card can go;
  //   2. if that attempt — here or at the press — was refused, the click goes no further. The
  //      shell never sees it, the card stays, and the note is under its row.
  // Native listeners, because the click has to be stopped on its way DOWN to the dim, and React
  // hears every event from the root. Only this card's own dismiss-by-tap is touched: Escape and
  // Back do not come this way.
  useEffect(() => {
    const scrim = cardRef.current?.closest('[data-settings-modal]')
    if (!scrim) return
    const outsideCard = (e: Event) =>
      !(e.target instanceof Node && cardRef.current?.contains(e.target))
    const onPress = () => {
      refusedJustNow.current = false
    }
    const onClick = (e: Event) => {
      if (!outsideCard(e)) return
      const box = document.activeElement
      if (box instanceof HTMLInputElement && cardRef.current?.contains(box)) box.blur()
      if (!refusedJustNow.current) return
      refusedJustNow.current = false
      e.stopPropagation()
    }
    scrim.addEventListener('pointerdown', onPress, true)
    scrim.addEventListener('click', onClick, true)
    return () => {
      scrim.removeEventListener('pointerdown', onPress, true)
      scrim.removeEventListener('click', onClick, true)
    }
  }, [])
  // ★ THE WAY OUT OF A NAME BOX, FOR THE CALLER'S DISMISS (the ★ "Back is a way of leaving the box
  // too" note above). A box that still has the keyboard gives it up — which attempts the rename,
  // through the box's own onBlur, exactly as a tap elsewhere would — and the answer is whether the
  // device refused it. No box with the keyboard: nothing to leave, nothing refused. (A dismiss by a
  // tap on the dim never needs this: the listener above has already left the box, and stopped the
  // tap itself if the rename was refused. Escape never needs it either: Escape in a box is the
  // box's own key, and with no box in use there is nothing pending.)
  useEffect(() => {
    leaveNameBoxRef.current = () => {
      const box = document.activeElement
      if (!(box instanceof HTMLInputElement) || !cardRef.current?.contains(box)) return false
      refusedJustNow.current = false
      box.blur()
      const refused = refusedJustNow.current
      refusedJustNow.current = false
      return refused
    }
    return () => {
      leaveNameBoxRef.current = null
    }
  }, [leaveNameBoxRef])
  // The list's scroll region, on the app's shared recipe (components/scrollRegion) — the same
  // treatment the Changelog popup's list wears, for the same reason: a bare max-height clips with
  // nothing to say that anything scrolls, which is worse than the overflow it hides. `active` is
  // the LIST VIEW being up, so the confirmation view rests the indicators instead of leaving the
  // last measured fade painted on a region that is no longer mounted.
  // ★ THE REGION REACHES ACROSS THE GAP ON EITHER SIDE OF IT (LIST_REACH_CLASS, below), so that a
  // row held at the list's first or last slot keeps its shadow. A scroll region clips at its own
  // edge, and that edge used to be the first row's top and the last row's bottom: the lift's shadow
  // (index.css .held-shadow — it spreads 12px, 3px lower than it is high) was cut off flat under a
  // row held in the last slot. The region is given the card's own row gap as padding above and
  // below, and pulled back out by the same amount, so every row is exactly where it was and the
  // box that clips is one gap taller each way — room that was empty already. The wrapper is a
  // `flow-root` so those two negative margins stay inside it instead of collapsing into the card's
  // spacing; the height cap grows by the two paddings, so a long list shows the same 45vh of rows.
  // ★ AND NOTHING ELSE MAY EVER SHOW IN THAT REACH. It is empty at an end of the list — which is
  // the only place a held row's shadow needs it — but a list that is scrolled has rows passing
  // through it, and they used to be drawn there: slivers of the next row in the gap above New
  // Preset, rows running up under the description. So an edge with rows past it hides its reach
  // whole and feathers from where the rows stop (--fade-reach, in LIST_REACH_CLASS; index.css),
  // exactly as the list looked before it reached anywhere; and the held row is kept inside the
  // band the rows occupy (dragFrame takes the reach off both bounds), so the reach is only ever
  // used by the shadow.
  const listRef = useRef<HTMLDivElement | null>(null)
  const { scrolledFromTop, atBottom } = useScrollEdgeState(listRef, pendingDelete === null)

  // One ref per row, keyed by the preset's ID rather than its index — an index is exactly what a
  // reorder changes, and a ref keyed by the wrong thing would measure the wrong row on the NEXT
  // drag's pointerdown. The callback ref on the row adds/removes its own entry, so a deleted
  // preset's detached node cannot linger in the map.
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  // ★ BRING A PRESET'S ROW INTO THE PART OF THE LIST THAT IS ON SCREEN AND CLEAR OF ITS EDGE FADES —
  // the least scroll that does it (components/scrollRegion's scrollBandIntoView, the same call
  // Lookup's history and the dropdown cursor make). The list is unlimited, so a row can be changed
  // while it is — or as it becomes — out of view, and two things here do exactly that: a keyboard
  // move (the row leaves, and the focus ring with it) and the cut-short note growing the row being
  // typed into (on the last row in view, the note opened below the visible edge). The row's
  // position is its rect against the list's, plus how far the list is scrolled: content coordinates.
  const revealRow = (id: number) => {
    const list = listRef.current
    const row = rowRefs.current.get(id)
    if (!list || !row) return
    const rect = row.getBoundingClientRect()
    const top = rect.top - list.getBoundingClientRect().top - list.clientTop + list.scrollTop
    scrollBandIntoView(list, top, rect.height)
  }
  // A row a note has just appeared under. A layout effect: the scroll lands in the frame that
  // draws the note.
  useLayoutEffect(() => {
    if (cutRowId !== null) revealRow(cutRowId)
  }, [cutRowId])
  useLayoutEffect(() => {
    if (noRoomRowId !== null) revealRow(noRoomRowId)
  }, [noRoomRowId])
  // ── Renaming ────────────────────────────────────────────────────────────────────────────────

  // Attempt the rename that is pending. store/presetControl's renamePreset normalizes (outer spaces
  // trimmed, and a name that is empty or has nothing visible in it falls back to "Preset N"), so
  // this deliberately does NOT pre-screen the text: one place decides what a name may be, and it
  // is the store's.
  // ★ ITS ONE CALLER IS THE BOX LOSING THE KEYBOARD (onBlur), so an edit is attempted exactly once,
  // whatever ended it: a tap elsewhere, Tab, the window going away — and Enter, which does nothing
  // but leave the box. (Enter used to attempt it itself and THEN leave, and the blur attempted it
  // a second time with the text it still remembered: a refused book was tried twice.)
  // ⚠ A RENAME THE DEVICE HAS NO ROOM TO SAVE DID NOT HAPPEN: the pending text is dropped like any
  // other finished edit, so the box shows the name that is saved, and the row says why.
  const commitRename = () => {
    if (!editing) return
    const outcome = renamePreset(editing.id, editing.text)
    setEditing(null)
    if (outcome !== 'no-room') return
    setRefusedRenameId(editing.id)
    refusedJustNow.current = true
  }

  // ⚠ THE ESCAPE DISCARD MUST BE FLUSHED BEFORE THE BLUR, and this is the ⚙ Year Range boxes' bug
  // verbatim (round 14 — see the ★ at those inputs in components/SettingsPanel). Clearing `editing`
  // and blurring in one handler puts both in ONE React batch, so the onBlur that fires next still
  // closes over the PRE-discard `editing` and commits the very text Escape was throwing away. Only
  // unusual names would have shown it — a discarded "Weekend" simply saves as "Weekend" — which is
  // exactly how the year-box version survived unnoticed for so long. flushSync lands the discard
  // first, so the blur that follows runs against a render where `editing` is null and
  // commitRename's own guard returns.
  // ⚠ THE CARD STAYS OPEN: Escape closes the top open layer (components/overlayStack) only when no
  // text box has the keyboard, which is what leaves this press to the field. A second Escape, with
  // nothing focused, dismisses the card: the app's dismissal ladder.
  const discardRename = (el: HTMLInputElement) => {
    flushSync(() => setEditing(null))
    el.blur()
  }

  // ── Creating ────────────────────────────────────────────────────────────────────────────────

  // ⚠ NO AUTO-FOCUS ON THE NEW ROW'S NAME FIELD, and it is a decision rather than an omission.
  // Focusing a text box raises the soft keyboard, and lib/textEntry's rule 2 says the app takes the
  // keyboard DOWN when an overlay opens — a create that immediately put it back up would be this
  // card fighting an app-wide rule. The row is there to tap.
  // ⚠ flushSync SO THE SCROLL LANDS ON THE ROW THAT WAS JUST ADDED: createPreset appends, and on a
  // list long enough to scroll the new row is below the fold with nothing to say it arrived. The
  // flush commits the row before the scroll reads scrollHeight. DEVICE-ONLY: jsdom reports every
  // dimension as 0, so the suite can prove the preset was created and can prove nothing about
  // whether it came into view.
  const addPreset = () => {
    setCopyRefused(false)
    flushSync(() => {
      createPreset()
    })
    const el = listRef.current
    if (el) scrollBoxTo(el, el.scrollHeight)
  }

  // ── Duplicating ─────────────────────────────────────────────────────────────────────────────

  // Whether the last copy asked for was refused for room (NO_ROOM_FOR_COPY_NOTE). Remembered, like
  // a refused rename: it is news about something that happened.
  const [copyRefused, setCopyRefused] = useState(false)
  // ★ THE COPY LANDS UNDER ITS ORIGINAL AND THE LIST GOES TO IT — the least scroll that shows it
  // clear of the edge fades (revealRow), so a copy of a row near the foot of a long list does not
  // arrive out of sight. flushSync for the reason addPreset has it: the row must be in the list
  // before it is measured.
  const copyPreset = (sourceId: number) => {
    const made = flushSync(() => duplicatePreset(sourceId))
    setCopyRefused(made === 'no-room')
    if (typeof made === 'object') revealRow(made.id)
  }

  // ── Deleting ────────────────────────────────────────────────────────────────────────────────

  // The last preset cannot go (store/presetControl's deletePreset refuses it), and this is the one
  // boolean the whole withholding treatment below hangs off — the class that DRAWS it unavailable,
  // the attribute that ANNOUNCES it, and the handler guard that makes it INERT. Three statements of
  // one fact, which is the app's convention (controlClasses' NOT_OFFERED_BTN_CLASS argues why all
  // three are needed and why it is aria-disabled rather than `disabled`).
  const canDelete = presets.length > 1
  // ★ THE DELETE ITSELF, WITH EXACTLY TWO WAYS IN — the confirmation's Delete button, and the ✕ on a
  // preset that holds nothing (below). Both land here, so "the skip does everything the
  // confirmation did" is true by construction rather than by a reader comparing two handlers.
  // Clearing the pending id is a provable no-op on the skip route (the ✕ exists only in the LIST
  // view, which only renders while nothing is pending) — it is here because deleting and leaving no
  // question standing are one act, not because that route can reach it.
  const removePreset = (id: number) => {
    deletePreset(id)
    setPendingDeleteId(null)
    setCopyRefused(false)
  }
  const confirmDelete = () => {
    if (pendingDelete) removePreset(pendingDelete.id)
    else setPendingDeleteId(null)
  }
  // ★★ THE ✕: ASK, UNLESS THERE IS NOTHING TO ASK ABOUT (the owner's words — "if it's completely
  // factory with no stats or anything, like as if you pressed clear saved defaults then full reset,
  // then we don't need a confirmation when deleting that preset"). A preset whose four stores are
  // all still at their factory values, with no parked round and no amnesic session behind it — and,
  // for the preset you are on, with every mode screen still at its launch state — holds
  // nothing a player could miss, so the question would be a tap spent on a non-decision — the same
  // reasoning that dims Reset Settings when nothing diverges, applied to a confirmation.
  // ⚠ THE JUDGEMENT IS store/presetControl's, NOT THIS COMPONENT'S, and it has to be: "what does a
  // preset hold" must be answered by the same file that knows what deleting one REMOVES, or the two
  // could disagree — and the direction that disagreement goes wrong is a silent, unasked delete.
  // isPresetFactory's own comment argues why it cannot say "factory" about a preset that is not.
  // ⚠ READ AT THE PRESS, never rendered from — nothing about the ✕ changes appearance, because the
  // control's PROMISE is unchanged ("delete this preset") and a row that advertised which of two
  // routes it would take would be asking the player to care about a distinction that exists to save
  // them a tap. It also could not be honest as a render: the answer moves with storage this card
  // does not subscribe to.
  // ⚠⚠ `screensFresh` IS NOT OPTIONAL INFORMATION. A MoX run seven questions in, or a Blitz round
  // with the clock running under this card (opening ⚙ does not stop or end a round), exists on the
  // active preset's screen and nowhere else — and deleting the active preset remounts that screen.
  // The storage half of the judgement cannot see it; the screens' own reports can.
  // ⚠ AND THE SKIP REFOCUSES THE CARD, because the ✕ that had the keyboard goes with its row and a
  // removed element leaves focus on <body> — behind the scrim, outside the Tab trap. The CARD rather
  // than a neighbouring row's ✕, for two reasons: it is exactly where the confirm route leaves the
  // keyboard (the effect above focuses the list's card when the question closes), so the skip stays
  // "the same act with the question removed" for a keyboard or screen-reader user too; and a ✕ that
  // inherited focus would turn a held Enter — which repeats a button's click — into a run of deletes
  // the player never aimed at. Focusing it now, before the delete commits, is safe: the list view's
  // card element survives the re-render (only a row leaves), so the ref still names it.
  const pressDelete = (id: number) => {
    if (!canDelete) return
    if (!isPresetFactory(id, screensFresh)) {
      setPendingDeleteId(id)
      return
    }
    cardRef.current?.focus()
    removePreset(id)
  }

  // ── Reordering (drag + keyboard) ────────────────────────────────────────────────────────────
  //
  // ★ ONE DRAG STATE, HELD AS AN OBJECT OR null, FOR THE SAME REASON `editing` ABOVE IS ONE
  // VALUE — only one row can be mid-drag at a time, so a per-row array would be N−1 rows always
  // at rest and one that might disagree with the others. Every row's transform and every pointer
  // handler below reads this one value directly rather than juggling several booleans.
  //
  // ★★ EVERY VERTICAL NUMBER IN IT IS IN THE LIST'S CONTENT COORDINATES (round 23) — 0 at the
  // top of the scrollable content, not of the screen — except the two pointer readings, which are
  // viewport y because that is what a pointer event reports. It used to be viewport y throughout,
  // which was only correct while the list could not scroll mid-drag. Unlimited presets make a
  // list taller than its region the ordinary case, and the drag now scrolls it (the edge auto-scroll
  // below), so "where is the row" has to be measured against the content, which is what the row's
  // own transform is relative to. `startScrollTop` is what turns a pointer delta into a content
  // delta: every pixel the list has scrolled since the grab is a pixel the pointer has effectively
  // travelled through the list.
  //
  // `slotMidpoints[i]` is the vertical center the row THAT STARTED AT INDEX i occupies in the
  // content — captured ONCE, from a getBoundingClientRect() on every row, and never re-measured
  // mid-drag. That is lib/presetReorder's contract for targetIndexForCenter and previewShift, and it
  // is correct for the whole gesture only because nothing moves in the DOM's actual flow while a
  // drag is in flight (that file's own header comment argues why the model commits once, at the
  // finger-lift, rather than rewriting the list live) — and, since the numbers are content
  // coordinates, a scroll does not move them either.
  //
  // `pointerId` latches the gesture the same way lib/pointerGestures and CustomSelect's pressDrag
  // latch theirs: onPointerMove/onPointerUp/onPointerCancel below all ignore any pointer id but
  // the one that started this drag, so a second finger landing on the handle mid-drag can neither
  // hijack it nor restart it.
  type DragState = {
    id: number
    // The rows this drag shows (★ at `presets`, above), and the count of other windows' changes to
    // the list as it last took them.
    rows: Preset[]
    remoteAt: number
    pointerId: number
    startIndex: number
    previewIndex: number
    slotMidpoints: number[]
    halfRow: number
    startPointerY: number
    pointerY: number
    startScrollTop: number
    transformY: number
    // How deep the list's edge fades are (index.css's --fade-h), read once at the grab: the dragged
    // row is kept out from under them (dragFrame).
    fadeDepth: number
    // How far the list's region reaches past its rows at either end (LIST_REACH_CLASS's padding, in
    // px), read at the same moment: the band the rows are shown in is the region less this.
    reach: number
  }
  // (`drag` itself is declared with `presets`, near the top: the rows shown depend on it.)
  // The same value, readable from the auto-scroll loop below — a rAF callback closes over the render
  // that started it, so it needs a ref to see the drag as it is NOW. Written only through applyDrag,
  // so the two can never disagree.
  const dragRef = useRef<DragState | null>(null)
  const applyDrag = (next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }
  // The list changed under a drag: a change made here (no other window's arrived with it) is shown at
  // once; one another window made waits for the drop.
  useLayoutEffect(() => {
    const d = dragRef.current
    if (!d || d.rows === livePresets) return
    applyDrag(
      d.remoteAt === remoteRegistry
        ? { ...d, rows: livePresets }
        : { ...d, remoteAt: remoteRegistry },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePresets, remoteRegistry])

  // ★ WHERE THE DRAGGED ROW IS DRAWN, for a pointer at viewport y `pointerY` — the one place the
  // pointer, the list's scroll position and lib/presetReorder's clamp meet. The row follows the
  // finger exactly, EXCEPT that clampDragCenter keeps it between the first and last slot (the fix
  // for the row escaping the list, over the description above it and past the foot below) and
  // wholly inside the part of the list that is on screen AND clear of the list's edge fades (so a
  // long list never clips the row out of the hand, and the fade at a scrolling edge never
  // dissolves it — lib/presetReorder's edgeFadeInset says how the two bounds are pulled in). "On
  // screen" is the band the rows are shown in: the region less its reach at either end.
  const dragFrame = (d: DragState, pointerY: number): DragState => {
    const list = listRef.current
    const scrollTop = list?.scrollTop ?? 0
    const clientHeight = list?.clientHeight ?? 0
    const gaps = scrollEdgeGaps(scrollTop, list?.scrollHeight ?? 0, clientHeight)
    const startCenter = d.slotMidpoints[d.startIndex]
    const wanted = startCenter + (pointerY - d.startPointerY) + (scrollTop - d.startScrollTop)
    const center = clampDragCenter(
      wanted,
      d.slotMidpoints,
      scrollTop + d.reach + edgeFadeInset(gaps.top, 0, d.fadeDepth),
      scrollTop +
        clientHeight -
        d.reach -
        edgeFadeInset(gaps.bottom, BOTTOM_EDGE_BAND_PX, d.fadeDepth),
      d.halfRow,
    )
    return {
      ...d,
      pointerY,
      transformY: center - startCenter,
      previewIndex: targetIndexForCenter(center, d.slotMidpoints),
    }
  }

  // ★ THE EDGE AUTO-SCROLL — hold the row near the top or bottom of the list and the list scrolls
  // toward it, which is the only way a row can travel further than one screenful now that there is
  // no limit on how many presets there are. Same band and same speed curve as the ⚙ panel's
  // press-drag auto-scroll (lib/pointerGestures' bandDirection / scrollDelta), so the app has one
  // feel for "drag to the edge and it scrolls"; lib/presetReorder's autoScrollDirection adds the one
  // rule a reorder needs on top (a band only counts in the direction the finger has travelled).
  // A rAF loop rather than pointermove, because a finger held still at the edge sends no events and
  // the list must keep scrolling anyway. It exists only while a drag does, and it scrolls only a
  // list that has somewhere to scroll — a short list (or a layout-free test environment) never moves.
  // After each step it re-draws the row at once, from the new scrollTop, so the row stays glued to
  // the finger in the same frame the content moved under it (waiting for the resulting scroll event
  // would draw it a frame late — a visible shiver while the list runs).
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    let raf = 0
    let prevTs: number | null = null
    const tick = (ts: number) => {
      const d = dragRef.current
      const list = listRef.current
      if (d && list && list.scrollHeight > list.clientHeight + 1) {
        const r = list.getBoundingClientRect()
        const dir = autoScrollDirection(
          d.pointerY,
          d.startPointerY,
          bandDirection(d.pointerY, r.top, r.bottom),
        )
        if (dir !== 0) {
          const dt = prevTs == null ? 0 : ts - prevTs
          prevTs = ts
          scrollBoxTo(
            list,
            list.scrollTop +
              dir * scrollDelta(dt, dir < 0 ? d.pointerY - r.top : r.bottom - d.pointerY),
          )
          applyDrag(dragFrame(d, d.pointerY))
        } else prevTs = null
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Keyed on whether a drag exists, not on the drag itself: the loop reads the live one through
    // dragRef, so restarting it on every pointermove would only reset its frame clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  const beginDrag = (p: Preset, index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    // Mirrors CustomSelect's pressDrag guard verbatim (same primitive, same reasoning, see that
    // file's onPointerDown): only the primary contact of a left-button mouse — or any primary
    // touch/pen — may start a gesture, so a second finger or a right-click cannot.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Native capture: once set, this exact element keeps receiving THIS pointerId's move/up
    // events even after the finger drifts off it, which is what lets onPointerMove stay attached
    // to the handle itself rather than to `window`. Optional-chained because jsdom has no
    // implementation to call.
    // ⚠ ALSO try/catch'd, matching this app's own idiom for a browser call that can throw rather
    // than quietly no-op (store/amnesicWindow's storage area, lib/presetNameWidth's canvas guard,
    // the windows-in-sync door's own localStorage try — this is the same shape of defensiveness applied
    // to a browser API instead of storage). setPointerCapture throws `NotFoundError` for a pointer
    // id the browser does not currently recognise as active; the drag has already been armed by
    // the guard above (which refused anything but a genuine primary press), so a throw here is not
    // a reason to abandon the gesture — it only means capture did not take, and the drag continues
    // on whatever ambient bubbling still reaches this handler. Never observed from a real press;
    // guarded anyway; the identical reasoning is below at releasePointerCapture.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture refused — the gesture still proceeds on ordinary event bubbling */
    }
    // Keeps the browser from also starting a touch-scroll/pan of the list underneath — belt and
    // suspenders with the handle's own touch-action:none.
    // ⚠⚠ AND IT TAKES THE ELEMENT'S OWN FOCUS-ON-POINTERDOWN WITH IT, VERIFIED ON A REAL BROWSER
    // RATHER THAN ASSUMED — jsdom has no notion of "default browser behaviour" for a pointerdown
    // to suppress, so this could not have been caught by the suite; only a real Chromium instance
    // showed it: preventDefault on pointerdown ALSO cancels the browser's own "focus this on press"
    // behaviour for anything that is not a native form control, which a `role="button"` div is not
    // exempt from. Without the explicit focus() below, a real drag (mouse or touch) would end with
    // the handle un-focused — silently breaking the "focus survives a reorder" accessibility claim
    // for every route EXCEPT the keyboard one. Calling focus() here is unaffected by preventDefault
    // — only the browser's OWN implicit behaviour was ever suppressed, never a programmatic call.
    // …and it is a POINTER's focus, so no keyboard ring is drawn for it (GRIP_CLASS).
    e.currentTarget.focus()
    e.preventDefault()
    // Every row's center, converted from the viewport to the list's content coordinates (the ★★
    // above): minus the list's own top, plus how far it is already scrolled.
    const list = listRef.current
    const listTop = list?.getBoundingClientRect().top ?? 0
    const scrollTop = list?.scrollTop ?? 0
    const slotMidpoints = presets.map((preset) => {
      const rect = rowRefs.current.get(preset.id)?.getBoundingClientRect()
      return rect ? (rect.top + rect.bottom) / 2 - listTop + scrollTop : 0
    })
    const ownRect = rowRefs.current.get(p.id)?.getBoundingClientRect()
    applyDrag({
      id: p.id,
      rows: presets,
      remoteAt: remoteRegistry,
      pointerId: e.pointerId,
      startIndex: index,
      previewIndex: index,
      slotMidpoints,
      halfRow: ownRect ? ownRect.height / 2 : 0,
      startPointerY: e.clientY,
      pointerY: e.clientY,
      startScrollTop: scrollTop,
      transformY: 0,
      // NaN where no stylesheet is served (jsdom): no fade there, so no inset — and no reach.
      fadeDepth: readFadeDepthPx() || 0,
      reach: (list && parseFloat(getComputedStyle(list).paddingTop)) || 0,
    })
  }

  // ⚠ BOTH POINTER HANDLERS READ THE DRAG THROUGH dragRef, NOT THE RENDERED `drag`. A handler's
  // `drag` is whatever the last render saw, and a move or a lift can arrive before the render that
  // follows the press has happened — the handler would then see no drag at all and drop the event
  // (verified in real Chromium: a press and its first moves dispatched in one task moved nothing).
  // The ref is written in the same breath as the state (applyDrag), so it is never behind.
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    applyDrag(dragFrame(d, e.clientY))
  }

  // A scroll the drag did not cause itself — a mouse wheel turned mid-drag, say — moves the content
  // under a row that is glued to the pointer, so the row is re-drawn from the new scrollTop exactly
  // as a pointer move would re-draw it. (The auto-scroll above re-draws in the same frame it
  // scrolls, so its own scroll events arrive here with nothing left to change.)
  const onListScroll = () => {
    const d = dragRef.current
    if (d) applyDrag(dragFrame(d, d.pointerY))
  }

  // One handler for both a real release and a system-cancelled gesture (the pointer became a
  // scroll, the app was backgrounded mid-press) — stepsToReorder is computed from wherever the
  // preview currently sits either way, so a cancelled drag still lands where it was visually
  // headed rather than silently reverting.
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    // Same try/catch as setPointerCapture above and for the identical reason: releasing a capture
    // that was never actually granted (the throw above, or a capture the browser already dropped
    // on its own — losing capture mid-gesture is a real, documented case, not hypothetical) would
    // otherwise abort this handler BEFORE the reorder below ever runs, turning a harmless capture
    // hiccup into a dropped drop.
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* nothing to release */
    }
    for (const step of stepsToReorder(d.startIndex, d.previewIndex)) movePreset(d.id, step)
    applyDrag(null)
  }

  // The keyboard path — unchanged in spirit from the ↑/↓ buttons it replaces, just moved onto the
  // handle. movePreset is already bounds-checked and silently a no-op at either end, so there is
  // nothing here to guard (matching the design's own call not to grow a disabled visual state the
  // handle never had). preventDefault keeps the arrow keys from also scrolling the modal's own
  // scroll region (components/scrollRegion) in addition to, or instead of, moving the row.
  // ★ THE LIST FOLLOWS THE ROW. A moved row can land outside the part of the list that is on screen
  // — in a list of thirty, a few presses carried the row, and the ring that says where the keyboard
  // is, out of sight. flushSync commits the move first, so revealRow measures the row where it now
  // is.
  const onHandleKeyDown = (p: Preset) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    flushSync(() => movePreset(p.id, e.key === 'ArrowUp' ? -1 : 1))
    revealRow(p.id)
  }

  // The live transform for the row at `index`/`id` — the dragged row tracks the pointer exactly,
  // with zero lag; every other row gets the pure "make room" nudge from previewShift. Both are 0
  // whenever no drag is in flight, which is also what keeps the CSS transition below inert except
  // while a drag is actually reshuffling the list.
  const rowTransform = (id: number, index: number): number => {
    if (!drag) return 0
    if (id === drag.id) return drag.transformY
    return previewShift(
      index,
      drag.startIndex,
      drag.previewIndex,
      averageRowHeight(drag.slotMidpoints),
    )
  }

  // ── The confirmation view ───────────────────────────────────────────────────────────────────
  if (pendingDelete) {
    // Whether the player is standing in the preset they are about to delete, which changes what
    // happens to the SCREEN and is therefore its own sentence rather than a clause. The neighbour
    // that will open is the one deletePreset picks — the row after, or the row before when this is
    // the last — and it is named, because "you will be moved" without saying where is the half of
    // the truth that helps least.
    const index = presets.findIndex((p) => p.id === pendingDelete.id)
    const successor = presets[index + 1] ?? presets[index - 1]
    return (
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-manager-title"
        className={`${MODAL_CARD_CLASS} px-4`}
      >
        <div id="preset-manager-title" className="text-sm font-semibold text-(--tx-50)">
          Delete this preset?
        </div>
        <div className="text-xs text-(--tx-200-80)">
          <QuotedName name={pendingDelete.name} strong /> and everything in it go for good: its
          stats, its all-time bests, its per-mode setup, every ⚙ setting it holds, and its saved
          defaults. No other preset is touched, and this cannot be undone.
        </div>
        {pendingDelete.id === activeId && (
          <div className="text-xs text-(--tx-200-80)">
            You are on this preset, so deleting it opens <QuotedName name={successor.name} strong />{' '}
            and clears the screen — a MoX run or Blitz round in progress included.
          </div>
        )}
        {/* ONE BUTTON, AND IT IS THE DESTRUCTIVE ONE — the way back to the list is every
            dismiss route this card has (tap outside, Escape, Android Back), which is the ladder the
            header comment argues. It is `w-full` in a plain pt-1 row rather than a `flex-1` child of
            a flex row: the wrapper and its gap existed to divide the row between two buttons, and a
            one-child flex row renders the same thing with more machinery. Identical markup to
            components/ConfirmModal's single confirm, which is the point — this view is not a
            ConfirmModal (see the header) but it must not LOOK like a different promise. */}
        <div className="pt-1">
          <button type="button" onClick={confirmDelete} className={`w-full ${RESET_BTN_CLASS}`}>
            Delete
          </button>
        </div>
      </div>
    )
  }

  // ── The list view ───────────────────────────────────────────────────────────────────────────
  //
  // The card owns py-4 only and each block carries its own px-4, so the scroller's right padding is
  // the text-free lane the iOS overlay scrollbar paints in — the ⚙ popover's reference treatment,
  // which the Changelog popup already copies.
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preset-manager-title"
      className={MODAL_CARD_CLASS}
    >
      <div id="preset-manager-title" className="px-4 text-sm font-semibold text-(--tx-50)">
        Presets
      </div>
      <div className="px-4 text-xs text-(--tx-200-80)">
        Each preset keeps its own stats, bests, settings, and theme. Everything the ⚙ menu does —
        its settings, Reset Settings, Full Reset — reaches only the preset you are on.
      </div>
      <div className="flow-root">
        <div
          ref={listRef}
          onScroll={onListScroll}
          className={`${SCROLL_REGION_CLASS} ${LIST_REACH_CLASS} space-y-2 ${scrollFadeClass(scrolledFromTop, atBottom)}`}
        >
          {presets.map((p, i) => {
            // This row is the one in the hand (HELD_PIECE_CLASS, above the component, says what
            // that changes about how it is drawn).
            const held = drag?.id === p.id
            // A copy's number, kept whole where its name is drawn cut (the ★ at the name box) — drawn
            // so only while the box is not being typed in.
            const copyNumber = copyNumberOf(p.name)
            const drawnCut = copyNumber !== '' && editing?.id !== p.id
            return (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(p.id, el)
                  else rowRefs.current.delete(p.id)
                }}
                style={{
                  transform: `translateY(${rowTransform(p.id, i)}px)`,
                  position: held ? 'relative' : undefined,
                  zIndex: held ? 10 : undefined,
                }}
                // Only a row that is NOT the one being dragged transitions — the dragged row must
                // track the pointer with zero lag (lib/presetReorder's own reasoning for why the live
                // half is a raw pointer delta), while every other row's previewShift nudge gets its
                // "sliding to make room" feel from this transition alone, no JS animation of its own.
                // Absent outside a drag entirely, so the list's normal re-renders (a rename, a create)
                // never pick up a stray transition.
                className={drag && !held ? 'transition-transform duration-150 ease-out' : undefined}
              >
                {/* THE ROW IS A GRID, NOT A FLEX ROW — four columns, ✕ · name · ✓ · grip on
              screen (both orders are argued at DELETE_BTN_CLASS above), and a SECOND ROW that only
              the cut-short note ever occupies, placed under the name box in the name's own column.
              As a flex row the note had to live outside it with a hand-tuned indent; the ✕ in
              front of the name is a width no fixed indent can know, so the grid does the lining up
              instead. `items-center` works per row track, so the note appearing never moves the
              controls above it. */}
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-1">
                  {/* THE LIFT, while THIS row is the one being dragged: one shadow box behind the ✕
                and one behind the name box, in those pieces' own cells and of their own size
                (HELD_SHADOW_CLASS, above the component, says why the shadow is not on the pieces).
                Decoration only, and only mid-drag — the row's real cells follow, in the order the
                ★★ above the row's class constants argues. */}
                  {held && (
                    <>
                      <div
                        aria-hidden="true"
                        className={`${ROW_COL.delete} self-stretch rounded-xl ${HELD_SHADOW_CLASS}`}
                      />
                      <div
                        aria-hidden="true"
                        className={`${ROW_COL.name} self-stretch rounded-xl ${HELD_SHADOW_CLASS}`}
                      />
                    </>
                  )}
                  {/* THE NAME, AS A TEXT BOX — the rename IS the field, with no edit mode to enter and
                no pencil to find. It always holds the STORED name, whole, however long (the box
                scrolls sideways); it has no `maxLength` and its onChange takes the text as it comes.
                ⚠ IT NAMES ITSELF "Preset name" AND NOTHING MORE, deliberately. A textbox's VALUE is
                read out with it, so the row's own name is already spoken and a label carrying it as
                well ("Name of Weekend") would say it twice and would change under the typing. The
                two controls beside it have no value to be read, which is why they name the preset
                and this does not.
                ⚠ SELECT-ALL ON ENTRY COMES FOR FREE and must not be added here: lib/textEntry
                installs it once, at the document, precisely so that the seventh box in the app —
                this one — gets the rule without a call site remembering it.
                ★ A COPY'S NAME, WHILE THE BOX IS NOT BEING TYPED IN, IS DRAWN CUT BEFORE ITS NUMBER
                (Round 26 review): a box shows its text from the start and clips the rest, so a long
                name and its "(2)" copy read the same, letter for letter, to the box's edge. Over a
                box that is not being typed in, holding a copy's name, the name is DRAWN as every
                preset list draws it (PresetSwitcher's NameCutBeforeNumber) and the box's own text
                is clear (text-transparent) — the box itself is untouched: its value is the whole
                name, which is what a screen reader reads and what the caret meets the moment the
                box takes the keyboard, when the drawing goes. The drawing shares the box's grid cell
                and has its padding and border width, so its letters stand where the box's own
                would; it comes after the box in the row, so the row's cells keep their order. */}
                  <input
                    type="text"
                    aria-label="Preset name"
                    value={editingText(p.id, p.name)}
                    onFocus={() => {
                      // Seed the pending edit from the SAVED name.
                      // ⚠ THE GUARD IS NOT REDUNDANT, AND THE CASE IT COVERS IS NOT MOVING BETWEEN ROWS.
                      // Leaving a field always blurs it first, and the blur commits and clears `editing`,
                      // so an ordinary tab or tap arrives here with nothing pending — the guard is silent
                      // for every route inside the app. What it is for is the WINDOW regaining focus: a
                      // browser re-fires `focus` on the element that already had it when you come back
                      // from another app or another tab, and without this line that return would silently
                      // throw away a half-typed name. iOS does it every time you switch away and back,
                      // which is the likeliest way anyone would ever meet it.
                      if (editing?.id !== p.id) setEditing({ id: p.id, text: p.name })
                    }}
                    onChange={(e) => {
                      setEditing({ id: p.id, text: e.target.value })
                      // The player is typing a name again: what the last attempt could not save has
                      // been said. (Not on FOCUS — the box that takes the keyboard is what caused
                      // the attempt, and would wipe the note before it was drawn.)
                      setRefusedRenameId(null)
                    }}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      // A key pressed while an input method is composing belongs to the input method:
                      // Enter there picks the composed text and Escape abandons it, and neither is a
                      // verdict on the rename. (229 is the same statement from Safari, which ends the
                      // composition before it reports the key.)
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return
                      if (e.key === 'Enter') {
                        // Leaving the box is what keeps the name (commitRename's one caller).
                        e.preventDefault()
                        e.currentTarget.blur()
                      } else if (e.key === 'Escape') {
                        discardRename(e.currentTarget)
                      }
                    }}
                    className={`${ROW_COL.name} min-w-0 appearance-none rounded-xl border surface-tray px-2 py-1.5 text-xs ${drawnCut ? 'text-transparent' : ''} ${held ? HELD_PIECE_CLASS : ''}`}
                  />
                  {drawnCut && (
                    <span
                      className={`${ROW_COL.name} self-stretch pointer-events-none flex min-w-0 items-center border border-transparent px-2 py-1.5 text-xs`}
                    >
                      <NameCutBeforeNumber name={nameAsDrawn(p.name)} number={copyNumber} />
                    </span>
                  )}
                  {/* THE CURRENT-PRESET MARK, after the name, in a reserved fixed-width slot so every
                name box ends at the same x whether the row is marked or not — the same reason
                CustomSelect gives its ✓ column a width of its own. aria-hidden + an sr-only word,
                the idiom every quiet marker in this app uses (the footer's Changelog dot, the
                run breakdown's ✓), because a bare ✓ is a glyph rather than an accessible name. */}
                  <span className={`${ROW_COL.current} w-3 text-center text-xs text-(--tx-200-80)`}>
                    {p.id === activeId && (
                      <>
                        <span aria-hidden="true" className={held ? HELD_INK_CLASS : undefined}>
                          ✓
                        </span>
                        <span className="sr-only">Current preset</span>
                      </>
                    )}
                  </span>
                  {/* WHICH OF THESE FORGET — spoken, not drawn (components/PresetSwitcher argues both
                halves: the letter that used to sit here is gone, and with it the column that kept
                every name box that much narrower). Worth hearing at the moment you are deciding
                what to delete; read-only here — Amnesic is set in ⚙ → Stats, and only for the
                preset you are on. sr-only is positioned out of flow, so it is not a grid cell and
                takes no track. */}
                  <AmnesicSpoken presetId={p.id} />
                  {/* THE REORDER GRIP — one control that is both a pointer/touch drag (pointerdown →
                pointermove → pointerup/cancel, wired to lib/presetReorder's pure arithmetic above)
                AND a keyboard reorder action (ArrowUp/ArrowDown). No disabled visual at either end
                — matching the design decision recorded above the handlers: movePreset already
                no-ops there silently.
                ⚠ A DIV WITH role="button", NOT A <button> — deliberately, and it is not a visual
                choice (GRIP_CLASS covers that half). lib/pointerGestures' global press-drag
                controller latches onto ANY element a bare `closest('button')` finds — that is
                literally its TARGET_SELECTOR — so a real <button> here would ALSO be swept into that
                separate, document-level gesture system on every press, two independent
                pointer-capture mechanisms reacting to the same pointerdown. A div the tag-name
                selector cannot match is invisible to that system by construction, the same way
                withheld controls elsewhere in this app are kept out of it by a selector rather than
                by coordination (see that file's own gestureTarget comment). The accessible name
                carries the CURRENT POSITION so a screen reader announces a new value after a
                keyboard move: a changed name on a still-FOCUSED element is announced as it changes,
                with nothing else to wire. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Reorder ${nameAsDrawn(p.name)}, position ${i + 1} of ${presets.length}`}
                    className={`${ROW_COL.grip} ${GRIP_CLASS}`}
                    style={{ touchAction: 'none' }}
                    onPointerDown={beginDrag(p, i)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={onHandleKeyDown(p)}
                  >
                    <ReorderHandleIcon held={held} />
                  </div>
                  {/* THE ✕ — LAST in the markup, FIRST on screen (ROW_COL; the ★★ above the row's class
                constants says why the two orders differ). */}
                  <button
                    type="button"
                    aria-label={`Delete ${nameAsDrawn(p.name)}`}
                    aria-disabled={!canDelete || undefined}
                    onClick={() => pressDelete(p.id)}
                    className={`${ROW_COL.delete} ${DELETE_BTN_CLASS} ${canDelete ? '' : NOT_OFFERED_BTN_CLASS} ${held ? HELD_PIECE_CLASS : ''}`}
                  >
                    <DeleteIcon />
                  </button>
                  {/* THE ROW'S NOTES (the ★ notes above this component) — "not saved", for the row
                whose rename the device had no room for; and "cut short", for the row being typed
                into while its text would be shown cut short somewhere. Each is its own line (a row
                can have both: its box entered again, holding a saved name that is too long). They
                take the grid's second row, starting under the name box (column 2) and running to
                the row's end. Same visual tier as the "cannot be deleted" note below: a small fact
                about what the app is doing with this row. aria-hidden: a screen reader is told
                through the card's live region, once, and would otherwise meet the words twice. */}
                  {(noRoomRowId === p.id || cutRowId === p.id) && (
                    <div className="col-start-2 col-span-4 row-start-2 pl-1 pt-1 text-[0.6875rem] text-(--tx-300-60)">
                      {noRoomRowId === p.id && <div aria-hidden="true">{NO_ROOM_NOTE}</div>}
                      {cutRowId === p.id && <div aria-hidden="true">{CUT_SHORT_NOTE}</div>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* THE CARD'S LIVE REGION — always here, so that what is ADDED to it is what a screen reader
          hears: a note's words the moment that note appears, and nothing while it stays. Each note
          is its own element, so one arriving beside the other is said by itself. Polite: it waits
          for whatever is being read (the letter just typed) to finish. */}
      <div aria-live="polite" className="sr-only">
        {noRoomRowId !== null && <p>{NO_ROOM_NOTE}</p>}
        {cutRowId !== null && <p>{CUT_SHORT_NOTE}</p>}
        {copyRefused && <p>{NO_ROOM_FOR_COPY_NOTE}</p>}
      </div>
      {/* The reason behind the dimmed ✕, shown only while it is dimmed. A withheld control states
          THAT it is unavailable; nothing about it can state WHY, and "the last one won't delete" is
          a rule a player would otherwise have to discover by pressing. It sits under the list
          rather than in it so that it reads as a fact about the set, not about that one row. */}
      {!canDelete && (
        <div className="px-4 text-[0.6875rem] text-(--tx-300-60)">
          There is always at least one preset, so this one cannot be deleted. Full Reset is how you
          empty it.
        </div>
      )}
      <div className="px-4 pt-1 flex gap-2">
        {/* NEW PRESET is the constructive act, so it wears btn-solid — the same violet fill Save
            Defaults and every Begin button wear, and the same reason rose is left to the two
            destructive controls. Round 21 removed a standalone Close beside it (the scrim tap,
            Escape and Android Back already dismiss the whole card); since Round 26 it shares the
            row, half and half, with DUPLICATE — the ★ note at the top of this file. */}
        <button
          type="button"
          onClick={addPreset}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl btn-solid border border-transparent text-sm font-medium"
        >
          New Preset
        </button>
        {/* DUPLICATE — a dropdown of the presets (CustomSelect as a MENU). The no-fill toggle
            surface with the select's ▲▼, so it reads as a list to open beside the button that
            acts at once. Its wrapper is the row's flex item (CustomSelect's own div takes no
            class) and its trigger fills it. */}
        <div className="flex-1 min-w-0">
          <CustomSelect
            value=""
            menuLabel="Duplicate"
            onChange={(v) => copyPreset(Number(v))}
            options={presets.map((p) => ({
              value: String(p.id),
              label: <PresetOptionLabel preset={p} />,
            }))}
            ariaLabel="Preset to duplicate"
            showChevron
            className="w-full px-3 py-2 pr-6 rounded-xl border surface-toggle text-sm font-medium text-(--tx-100-80)"
          />
        </div>
      </div>
      {copyRefused && (
        <div aria-hidden="true" className="px-4 text-[0.6875rem] text-(--tx-300-60)">
          {NO_ROOM_FOR_COPY_NOTE}
        </div>
      )}
    </div>
  )
}
