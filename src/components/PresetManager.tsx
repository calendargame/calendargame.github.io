import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { SCROLL_REGION_CLASS, scrollFadeClass, useScrollEdgeState } from './scrollRegion.js'
import { MODAL_CARD_CLASS, MODAL_CARD_SHADOW } from './modalContract.js'
import { NOT_OFFERED_BTN_CLASS, RESET_BTN_CLASS } from './controlClasses.js'
import { usePresets, MAX_PRESET_NAME } from '../store/presets.js'
import type { Preset } from '../store/presets.js'
import { createPreset, deletePreset, movePreset, renamePreset } from '../store/presetControl.js'
import { capCandidateToSwitcherWidth } from '../lib/presetNameWidth.js'
import {
  targetIndexForCenter,
  stepsToReorder,
  previewShift,
  averageRowHeight,
} from '../lib/presetReorder.js'

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
// modal idiom with a shared contract. So this is the FIFTH user of that contract, not a fifth
// style: components/modalContract's five terms, the same scrim, the same card, the same tokens.
//
// ── ⚠⚠ THE CONFIRMATION IS A VIEW OF THIS CARD, NOT A MODAL ON TOP OF ONE ─────────────────────
//
// Deleting asks first, and the ask REPLACES this card's body rather than opening a second dialog
// over it. That is a deliberate refusal to invent nested modals, and the reason is mechanical:
// modalContract's Escape term is a DOCUMENT-level capture listener registered per open modal, and
// `stopPropagation` does not stop a second listener on the SAME node — so with two of them mounted
// one Escape would close both, the inner dismiss taking the outer with it. Android Back (LIFO) and
// the Tab trap would each need their own answer too, and every one of those answers would be new
// machinery serving one button. The four modals that predate this one are mutually exclusive BY
// CONSTRUCTION and have never had to answer any of it. One card with two views keeps it that way:
// one Escape, one Back entry, one trap, one scrim.
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
// ★★ RENAMING IS CAPPED AT THE INPUT, AND — SINCE Q6, ROUND 20 — BY WIDTH RATHER THAN BY COUNT.
// It used to be a character count, twice over (a `maxLength` for the browser's own enforcement,
// plus a `slice` in onChange for the paste-shaped write maxLength does not cover). That worked only
// because the switcher's display cell was ALSO a fixed count of characters; once the cell became
// flexible (components/PresetSwitcher), a character cap stopped answering the question that
// actually matters — "will this fit the switcher, RIGHT NOW, on THIS device" — so onChange now
// calls lib/presetNameWidth's capCandidateToSwitcherWidth on every keystroke, which measures the
// candidate against the switcher's LIVE rendered cell width (a real canvas measurement against a
// real DOM element in another part of the tree entirely — see that file for the mechanism and why
// it is not a React prop or a store) and trims to the longest prefix that fits, exactly the shape
// `maxLength` gives a paste. `nameWidthCapped` is what that trim sets, and it drives the small
// WIDTH-language note below the field ("That's as long as this name can display.") rather than a
// character count, because a character count is no longer the true reason.
// ⚠ `maxLength={MAX_PRESET_NAME}` STAYS ON THE ELEMENT, as a SEPARATE, coarser backstop — the
// store's own hard ceiling (store/presets argues why it is now a generous, device-independent
// number rather than a pixel-tuned one), reached only if the width cap somehow fails to fire (a
// browser with canvas disabled, say). In ordinary use the width cap is reached first, well under
// it. Layering them is the same "no one cut alone covers every case" reasoning this field always
// used, just with a different pair of cuts.
//
// ★★ MOVING IS A DEDICATED DRAG HANDLE, AS OF Q7 ROUND 20 — REPLACING THE ↑/↓ PAIR THIS COMMENT
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
// ★ DELETING IS PERMANENT AND THE CARD SAYS SO IN THOSE WORDS. Two cases are real and both are
// handled out loud rather than hidden:
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

// The row glyphs, named here rather than written inline — the row below is dense enough that a
// bare arrow or ✕ in the markup would read as decoration rather than as the control it labels.
// ⚠ NEITHER IS aria-hidden AND NEITHER NEEDS TO BE: every control carrying one also carries an
// aria-label, and an aria-label REPLACES an element's content for a screen reader, so the glyph is
// already unspoken. (That is the opposite of the ✓ and A markers below, which are bare spans with
// no name of their own and therefore do need hiding plus an sr-only word.)
// ⚠ TWO OF THE ORIGINAL THREE ARE GONE, AS OF Q7 ROUND 20: MOVE_UP ('↑') and MOVE_DOWN ('↓') named
// the old reorder buttons this round removed. The SAME reasoning that put them here — name a glyph
// rather than write it inline, once a row is dense enough for a bare character to read as
// decoration — is why the handle that replaced them gets a name too (ReorderHandleIcon below); it
// just cannot be a one-line string constant, because "three plain rounded bars" is markup, not text.
const DELETE_GLYPH = '✕'

// THE REORDER HANDLE'S GLYPH — three plain horizontal bars, rounded ends, no arrowheads: iOS's own
// native system reorder icon, shown to the owner and approved before this round began. An inline
// SVG rather than a Unicode "hamburger"/"equals" character, which renders as three bars of
// inconsistent weight and spacing across engines — this app never uses icon fonts (see W5Logo,
// GuidePage's dot diagrams for the house pattern: raw <svg>, stroke/fill: currentColor so it always
// matches the surrounding text colour, no external asset).
// aria-hidden="true" here for the identical reason DELETE_GLYPH above needs none of its own: the
// element that renders this always carries its own aria-label (the row's current position, at the
// handle below), which replaces this SVG for a screen reader — so the glyph is already unspoken,
// and the attribute is belt-and-suspenders, matching every other icon in the app.
function ReorderHandleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
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

// A row's small square controls — the handle and ✕, now two rather than the original three.
// `shrink-0` because the NAME is the thing that gives way when the card is narrow — a control that
// shrank to a sliver would be the wrong casualty. The surface is `surface-toggle`, the same no-fill
// interactive tier the modal Cancel buttons wear: neither of these two is a destructive act on its
// own (the ✕ only OPENS the confirmation, exactly as the footer's "Clear Saved Defaults" link opens
// its own; the handle's two actions are a reorder, not a delete), so neither wears the rose fill.
// The handle wears this SAME token rather than inventing its own sizing, for the visual consistency
// the ✕ beside it already relies on — even though the handle is a role="button" div and not a
// <button>, matching classNames is what makes the row still read as one control tier.
// ⚠ TOUCH SIZE IS A DEVICE-ONLY QUESTION. At the card's ~288px of content these land near 30×26px,
// which is the ⚙ panel's existing control tier (its On/Off switches are px-3 py-1.5 text-xs) and
// not a new, smaller one — but jsdom lays nothing out, so only the owner's iPhone can say whether
// two of them side by side are comfortable, and whether the handle is easy to grab precisely rather
// than easy to miss. If either is not, the fix is a taller row (py-2) or a wider handle, not a
// narrower name cell.
const ROW_BTN_CLASS =
  'shrink-0 px-2 py-1.5 rounded-xl text-xs border surface-toggle text-(--tx-100-80)'

// No props: since round 21 (Q5) removed the standalone Close button, nothing in this card
// dismisses itself. The caller (components/SettingsPanel) owns the open flag and wires the scrim
// tap, capture-phase Escape and Android Back — the same three routes as the other four modals.
export default function PresetManager() {
  // Two narrow subscriptions, the same pair components/PresetSwitcher takes and for the same
  // reason: `presets` is replaced wholesale by applyRegistry (so reference equality is a correct
  // change signal) and `activeId` is the one scalar this card renders a mark for. Everything this
  // card does writes through store/presetControl and lands back here as a new list.
  const presets = usePresets((s) => s.presets)
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

  // ★ WHETHER THE MOST RECENT KEYSTROKE HAD TO BE TRIMMED, for the width-language note beside the
  // field (below). One flag, not one per row, for the identical reason `editing` itself is one
  // value: only one field can hold the keyboard, so only one field can ever be the one this is
  // about. Reset wherever `editing` itself resets — a fresh row, a commit, a discard — so the note
  // can never survive past the field it was about.
  const [nameWidthCapped, setNameWidthCapped] = useState(false)

  // The delete confirmation's subject, or null while the list is showing. An ID and not the preset
  // object: the registry can be rewritten under this card (another row renamed, one moved), and a
  // captured object would go stale where an id is resolved fresh on every render.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const pendingDelete = presets.find((p) => p.id === pendingDeleteId) ?? null

  // ★ THIS CARD FOCUSES ITSELF, which is modalContract's term 1 and the ONE term this modal takes
  // off its call site (components/SettingsPanel declares the other four modals' focus effects in a
  // row and says at that spot why this one is missing). The reason is the two views: each renders
  // its OWN dialog element, so the term is not "focus the card when the modal opens" but "focus the
  // card whenever the card is replaced" — and the replacement is a fact only this component has.
  // Split across two owners, the second half is the half that gets forgotten, and the symptom is
  // silent: press ✕, and the keyboard is on <body> behind a scrim with a destructive button on it.
  // The dependency is the VIEW, not the mount, so it covers both directions — into the confirmation
  // and back out of it.
  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    cardRef.current?.focus()
  }, [pendingDeleteId])

  // The list's scroll region, on the app's shared recipe (components/scrollRegion) — the same
  // treatment the Changelog popup's list wears, for the same reason: a bare max-height clips with
  // nothing to say that anything scrolls, which is worse than the overflow it hides. `active` is
  // the LIST VIEW being up, so the confirmation view rests the indicators instead of leaving the
  // last measured fade painted on a region that is no longer mounted.
  const listRef = useRef<HTMLDivElement | null>(null)
  const { scrolledFromTop, atBottom } = useScrollEdgeState(listRef, pendingDelete === null)

  // ── Renaming ────────────────────────────────────────────────────────────────────────────────

  // Commit whatever is pending. store/presetControl's renamePreset normalizes (trim, cap, and an
  // empty or whitespace-only name falls back to "Preset N"), so this deliberately does NOT
  // pre-screen the text: one place decides what a name may be, and it is the store's.
  const commitRename = () => {
    if (!editing) return
    renamePreset(editing.id, editing.text)
    setEditing(null)
    setNameWidthCapped(false)
  }

  // ⚠ THE ESCAPE DISCARD MUST BE FLUSHED BEFORE THE BLUR, and this is the ⚙ Year Range boxes' bug
  // verbatim (round 14 — see the ★ at those inputs in components/SettingsPanel). Clearing `editing`
  // and blurring in one handler puts both in ONE React batch, so the onBlur that fires next still
  // closes over the PRE-discard `editing` and commits the very text Escape was throwing away. Only
  // unusual names would have shown it — a discarded "Weekend" simply saves as "Weekend" — which is
  // exactly how the year-box version survived unnoticed for so long. flushSync lands the discard
  // first, so the blur that follows runs against a render where `editing` is null and
  // commitRename's own guard returns.
  // ⚠ AND IT STOPS PROPAGATION, for the second half of that same fix: App's panel-level Escape
  // handler is a document keydown in the BUBBLE phase that decides "is this press mine?" by asking
  // what has focus — and this field has already blurred by then, so without the stop it would take
  // the whole ⚙ panel down on what the user meant as a discard. The MODAL's Escape handler is
  // capture-phase and runs first, where the field still holds focus and modalContract's
  // `guardTextEntry` bails — which is precisely what leaves this press to the field. A second
  // Escape, with nothing focused, reaches that handler and dismisses the card: the app's dismissal
  // ladder, unchanged.
  const discardRename = (el: HTMLInputElement) => {
    flushSync(() => {
      setEditing(null)
      setNameWidthCapped(false)
    })
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
    flushSync(() => {
      createPreset()
    })
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // ── Deleting ────────────────────────────────────────────────────────────────────────────────

  // The last preset cannot go (store/presetControl's deletePreset refuses it), and this is the one
  // boolean the whole withholding treatment below hangs off — the class that DRAWS it unavailable,
  // the attribute that ANNOUNCES it, and the handler guard that makes it INERT. Three statements of
  // one fact, which is the app's convention (controlClasses' NOT_OFFERED_BTN_CLASS argues why all
  // three are needed and why it is aria-disabled rather than `disabled`).
  const canDelete = presets.length > 1
  const confirmDelete = () => {
    if (pendingDelete) deletePreset(pendingDelete.id)
    setPendingDeleteId(null)
  }

  // ── Reordering (drag + keyboard) ────────────────────────────────────────────────────────────
  //
  // ★ ONE DRAG STATE, HELD AS AN OBJECT OR null, FOR THE SAME REASON `editing` ABOVE IS ONE
  // VALUE — only one row can be mid-drag at a time, so a per-row array would be N−1 rows always
  // at rest and one that might disagree with the others. Every row's transform and every pointer
  // handler below reads this one value directly rather than juggling several booleans.
  //
  // `slotMidpoints[i]` is the vertical center the row THAT STARTED AT INDEX i occupied at the
  // moment the drag began — captured ONCE, from a getBoundingClientRect() on every row, and never
  // re-measured mid-drag. That is lib/presetReorder's contract for targetIndexForCenter and
  // previewShift, and it is correct for the whole gesture only because nothing moves in the DOM's
  // actual flow while a drag is in flight (that file's own header comment argues why the model
  // commits once, at the finger-lift, rather than rewriting the list live).
  //
  // `pointerId` latches the gesture the same way lib/pointerGestures and CustomSelect's pressDrag
  // latch theirs: onPointerMove/onPointerUp/onPointerCancel below all ignore any pointer id but
  // the one that started this drag, so a second finger landing on the handle mid-drag can neither
  // hijack it nor restart it.
  type DragState = {
    id: number
    pointerId: number
    startIndex: number
    previewIndex: number
    slotMidpoints: number[]
    startPointerY: number
    transformY: number
  }
  const [drag, setDrag] = useState<DragState | null>(null)

  // One ref per row, keyed by the preset's ID rather than its index — an index is exactly what a
  // reorder changes, and a ref keyed by the wrong thing would measure the wrong row on the NEXT
  // drag's pointerdown. The callback ref below adds/removes its own entry, so a deleted preset's
  // detached node cannot linger in the map.
  const rowRefs = useRef(new Map<number, HTMLDivElement>())

  const beginDrag = (p: Preset, index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    // Mirrors CustomSelect's pressDrag guard verbatim (same primitive, same reasoning, see that
    // file's onPointerDown): only the primary contact of a left-button mouse — or any primary
    // touch/pen — may start a gesture, so a second finger or a right-click cannot.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Native capture: once set, this exact element keeps receiving THIS pointerId's move/up
    // events even after the finger drifts off it, which is what lets onPointerMove stay attached
    // to the handle itself rather than to `window`. Optional-chained because jsdom has no
    // implementation to call — there is nothing DOM-layout-dependent about the guard above it,
    // which is what the unit tests below actually exercise.
    // ⚠ ALSO try/catch'd, matching this app's own idiom for a browser call that can throw rather
    // than quietly no-op (store/amnesic's openSessionStorage, lib/presetNameWidth's canvas guard,
    // presetScopedStorage's own localStorage try — this is the same shape of defensiveness applied
    // to a browser API instead of storage). setPointerCapture throws `NotFoundError` for a pointer
    // id the browser does not currently recognise as active; the drag has already been armed above
    // (the guard on line 377 already refused anything but a genuine primary press), so a throw here
    // is not a reason to abandon the gesture — it only means capture did not take, and the drag
    // continues on whatever ambient bubbling still reaches this handler. Never observed from a real
    // press in this round's device-stand-in testing; guarded anyway; the identical reasoning is
    // below at releasePointerCapture.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture refused — the gesture still proceeds on ordinary event bubbling */
    }
    // Keeps the browser from also starting a touch-scroll/pan of the list underneath — belt and
    // suspenders with the handle's own touch-action:none.
    // ⚠⚠ AND IT TAKES THE ELEMENT'S OWN FOCUS-ON-POINTERDOWN WITH IT, VERIFIED ON A REAL BROWSER
    // RATHER THAN ASSUMED — jsdom has no notion of "default browser behaviour" for a pointerdown
    // to suppress, so this could not have been caught by the suite above; only a real Chromium
    // instance (this round's on-device stand-in, see the file header) showed it: preventDefault on
    // pointerdown ALSO cancels the browser's own "focus this on press" behaviour for anything that
    // is not a native form control, which a `role="button"` div is not exempt from. Without the
    // explicit focus() below, a real drag (mouse or touch) would end with the handle un-focused —
    // silently breaking the "focus survives a reorder" accessibility claim above for every route
    // EXCEPT the keyboard one (Tab already focuses it, so the tests above never exercised a press
    // starting from unfocused). Calling focus() here is unaffected by preventDefault — only the
    // browser's OWN implicit behaviour was ever suppressed, never a programmatic call.
    e.currentTarget.focus()
    e.preventDefault()
    const slotMidpoints = presets.map((preset) => {
      const rect = rowRefs.current.get(preset.id)?.getBoundingClientRect()
      return rect ? (rect.top + rect.bottom) / 2 : 0
    })
    setDrag({
      id: p.id,
      pointerId: e.pointerId,
      startIndex: index,
      previewIndex: index,
      slotMidpoints,
      startPointerY: e.clientY,
      transformY: 0,
    })
  }

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const transformY = e.clientY - drag.startPointerY
    // The dragged row's CURRENT center — its start center plus how far it has moved — never the
    // raw pointer position, per targetIndexForCenter's contract.
    const currentCenter = drag.slotMidpoints[drag.startIndex] + transformY
    setDrag({
      ...drag,
      transformY,
      previewIndex: targetIndexForCenter(currentCenter, drag.slotMidpoints),
    })
  }

  // One handler for both a real release and a system-cancelled gesture (the pointer became a
  // scroll, the app was backgrounded mid-press) — stepsToReorder is computed from wherever the
  // preview currently sits either way, so a cancelled drag still lands where it was visually
  // headed rather than silently reverting.
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
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
    for (const step of stepsToReorder(drag.startIndex, drag.previewIndex)) movePreset(drag.id, step)
    setDrag(null)
  }

  // The keyboard path — unchanged in spirit from the ↑/↓ buttons it replaces, just moved onto the
  // handle. movePreset is already bounds-checked and silently a no-op at either end, so there is
  // nothing here to guard (matching the design's own call not to grow a disabled visual state the
  // handle never had). preventDefault keeps the arrow keys from also scrolling the modal's own
  // scroll region (components/scrollRegion) in addition to, or instead of, moving the row.
  const onHandleKeyDown = (p: Preset) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      movePreset(p.id, -1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      movePreset(p.id, 1)
    }
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
        style={MODAL_CARD_SHADOW}
        className={`${MODAL_CARD_CLASS} px-4`}
      >
        <div id="preset-manager-title" className="text-sm font-semibold text-(--tx-50)">
          Delete this preset?
        </div>
        <div className="text-xs text-(--tx-200-80)">
          <b>{pendingDelete.name}</b> and everything in it go for good: its stats, its all-time
          bests, its Lookup history, its per-mode setup, every ⚙ setting it holds, and its saved
          defaults. No other preset is touched, and this cannot be undone.
        </div>
        {pendingDelete.id === activeId && (
          <div className="text-xs text-(--tx-200-80)">
            You are on this preset, so deleting it opens <b>{successor.name}</b> and clears the
            screen — a Blitz round or MoX run in progress included.
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPendingDeleteId(null)}
            className="flex-1 px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
          >
            Cancel
          </button>
          <button type="button" onClick={confirmDelete} className={`flex-1 ${RESET_BTN_CLASS}`}>
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
      style={MODAL_CARD_SHADOW}
      className={MODAL_CARD_CLASS}
    >
      <div id="preset-manager-title" className="px-4 text-sm font-semibold text-(--tx-50)">
        Presets
      </div>
      <div className="px-4 text-xs text-(--tx-200-80)">
        Each preset keeps its own stats, bests, settings and theme. Everything the ⚙ menu does — its
        settings, Reset Settings, Full Reset — reaches only the preset you are on.
      </div>
      <div
        ref={listRef}
        className={`${SCROLL_REGION_CLASS} max-h-[45vh] space-y-2 ${scrollFadeClass(scrolledFromTop, atBottom)}`}
      >
        {presets.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) rowRefs.current.set(p.id, el)
              else rowRefs.current.delete(p.id)
            }}
            style={{
              transform: `translateY(${rowTransform(p.id, i)}px)`,
              position: drag?.id === p.id ? 'relative' : undefined,
              zIndex: drag?.id === p.id ? 10 : undefined,
            }}
            // Only a row that is NOT the one being dragged transitions — the dragged row must
            // track the pointer with zero lag (lib/presetReorder's own reasoning for why the live
            // half is a raw pointer delta), while every other row's previewShift nudge gets its
            // "sliding to make room" feel from this transition alone, no JS animation of its own.
            // Absent outside a drag entirely, so the list's normal re-renders (a rename, a create)
            // never pick up a stray transition.
            className={
              drag && drag.id !== p.id ? 'transition-transform duration-150 ease-out' : undefined
            }
          >
            <div
              className={`flex items-center gap-1 ${
                // A small lift while THIS row is the one being dragged — existing shadow token
                // (index.css's elev-shadow-down, the app's one "elevated above the surface" cue,
                // reused rather than a bespoke box-shadow) plus a hair of scale. Both device-only
                // to confirm: jsdom lays nothing out, so only the owner's iPhone can say whether
                // this reads as "lifted" rather than merely "shifted".
                drag?.id === p.id ? 'elev-shadow-down rounded-xl scale-[1.02]' : ''
              }`}
            >
              {/* THE CURRENT-PRESET MARK, in a reserved fixed-width slot so every name box starts at
                the same x whether the row is marked or not — the same reason CustomSelect gives its
                ✓ column a width of its own. aria-hidden + an sr-only word, the idiom every quiet
                marker in this app uses (the switcher's "A", the footer's Changelog dot), because a
                bare ✓ is a glyph rather than an accessible name. */}
              <span className="w-3 shrink-0 text-center text-xs text-(--tx-200-80)">
                {p.id === activeId && (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span className="sr-only">Current preset</span>
                  </>
                )}
              </span>
              {/* THE NAME, AS A TEXT BOX — the rename IS the field, with no edit mode to enter and no
                pencil to find.
                ⚠ IT NAMES ITSELF "Preset name" AND NOTHING MORE, deliberately. A textbox's VALUE is
                read out with it, so the row's own name is already spoken and a label carrying it as
                well ("Name of Weekend") would say it twice and would change under the typing. The
                three BUTTONS beside it have no value to be read, which is why they name the preset
                and this does not.
                ⚠ SELECT-ALL ON ENTRY COMES FOR FREE and must not be added here: lib/textEntry
                installs it once, at the document, precisely so that the seventh box in the app —
                this one — gets the rule without a call site remembering it. */}
              <input
                type="text"
                aria-label="Preset name"
                maxLength={MAX_PRESET_NAME}
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
                  // lib/presetNameWidth — measures the candidate against the SWITCHER's live cell
                  // width (a different, separately-mounted control), not this field's own room, and
                  // trims to the longest prefix that fits when it does not. See that file and the ★★
                  // note above for the mechanism and why the cap moved here from a character count.
                  const { text, capped } = capCandidateToSwitcherWidth(e.target.value)
                  setEditing({ id: p.id, text })
                  setNameWidthCapped(capped)
                }}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    discardRename(e.currentTarget)
                  }
                }}
                className="min-w-0 flex-1 appearance-none rounded-xl border surface-tray px-2 py-1.5 text-xs focus:outline-hidden focus-ring"
              />
              {/* The amnesic marker, the SAME letter the switcher shows and in a reserved slot for
                the same reason the ✓ above is: every row's buttons line up whether or not the row
                is marked. It is read-only here — Amnesic is flipped in ⚙ → Stats, and only for the
                preset you are on — so this is purely the answer to "which of these forget", which
                is worth knowing at the moment you are deciding what to delete.
                ⚠ DIMMED BY OPACITY, NEVER TINTED, and inheriting currentColor: components/
                PresetSwitcher argues it (a themed colour token would read correctly in one of the
                two places this letter appears and be invisible in the other). */}
              <span className="w-3 shrink-0 text-center">
                {p.amnesic && (
                  <>
                    <span aria-hidden="true" className="text-[0.8em] font-semibold opacity-70">
                      A
                    </span>
                    <span className="sr-only">Amnesic</span>
                  </>
                )}
              </span>
              {/* THE REORDER HANDLE — one control that is both a pointer/touch drag (pointerdown
                → pointermove → pointerup/cancel, wired to lib/presetReorder's pure arithmetic
                above) AND a keyboard reorder action (ArrowUp/ArrowDown), replacing the two ↑/↓
                buttons this round removed. No disabled visual at either end — matching the design
                decision recorded above the handlers: movePreset already no-ops there silently.
                ⚠ A DIV WITH role="button", NOT A <button> — deliberately, and it is not merely a
                visual-tier choice (ROW_BTN_CLASS's own comment covers that half). lib/
                pointerGestures' global press-drag controller latches onto ANY element a bare
                `closest('button')` finds — that is literally its TARGET_SELECTOR — so a real
                <button> here would ALSO be swept into that separate, document-level gesture
                system on every press, two independent pointer-capture mechanisms reacting to the
                same pointerdown. A div the tag-name selector cannot match is invisible to that
                system by construction, the same way withheld controls elsewhere in this app are
                kept out of it by a selector rather than by coordination (see that file's own
                gestureTarget comment). The accessible name carries the CURRENT POSITION so a
                screen reader announces a new value after a keyboard move — this app uses no
                aria-live (SettingsPanel's Check-for-updates button argues why), so a changed name
                on a still-FOCUSED element is what gets announced, which is exactly what point 4 of
                the brief that built this exists to prove rather than assume. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Reorder ${p.name}, position ${i + 1} of ${presets.length}`}
                className={ROW_BTN_CLASS}
                style={{ touchAction: 'none' }}
                onPointerDown={beginDrag(p, i)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onHandleKeyDown(p)}
              >
                <ReorderHandleIcon />
              </div>
              <button
                type="button"
                aria-label={`Delete ${p.name}`}
                aria-disabled={!canDelete || undefined}
                onClick={() => {
                  if (canDelete) setPendingDeleteId(p.id)
                }}
                className={`${ROW_BTN_CLASS} ${canDelete ? '' : NOT_OFFERED_BTN_CLASS}`}
              >
                {DELETE_GLYPH}
              </button>
            </div>
            {/* THE WIDTH-CAP NOTE — WIDTH LANGUAGE, NEVER A CHARACTER COUNT, because a character
              count is no longer the true reason a keystroke stopped landing (lib/presetNameWidth,
              and the ★★ note above this component). Shown only for the row currently being typed
              into, only while its most recent keystroke actually had to be trimmed — it disappears
              the moment a backspace brings the candidate back under budget, on the same `capped`
              flag that trim reports. Same visual tier as the "cannot be deleted" note below, for
              the same reason: a small fact about why a control just did what it did. */}
            {editing?.id === p.id && nameWidthCapped && (
              <div className="pl-4 pt-1 text-[11px] text-(--tx-300-60)">
                That&apos;s as long as this name can display.
              </div>
            )}
          </div>
        ))}
      </div>
      {/* The reason behind the dimmed ✕, shown only while it is dimmed. A withheld control states
          THAT it is unavailable; nothing about it can state WHY, and "the last one won't delete" is
          a rule a player would otherwise have to discover by pressing. It sits under the list
          rather than in it so that it reads as a fact about the set, not about that one row. */}
      {!canDelete && (
        <div className="px-4 text-[11px] text-(--tx-300-60)">
          There is always at least one preset, so this one cannot be deleted. Full Reset is how you
          empty it.
        </div>
      )}
      <div className="px-4 pt-1">
        {/* NEW PRESET is the constructive act, so it wears btn-solid — the same violet fill Save
            Defaults and every Begin button wear, and the same reason rose is left to the two
            destructive controls. It fills the row: round 21 (Q5) removed the standalone Close
            beside it — the scrim tap, Escape and Android Back already dismiss the whole card, and
            the owner wanted the real estate back. */}
        <button
          type="button"
          onClick={addPreset}
          className="w-full px-3 py-2 rounded-xl btn-solid border border-transparent text-sm font-medium"
        >
          New Preset
        </button>
      </div>
    </div>
  )
}
