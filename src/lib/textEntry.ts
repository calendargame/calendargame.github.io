// lib/textEntry.ts — what counts as a box you can type into, and the two APP-WIDE rules that hold
// for every one of them. Both rules are stated HERE, once, and nowhere else.
//
// The boxes, all six of them: the two ⚙ Year Range fields (components/SettingsPanel), the AoX run
// length — which exists TWICE, as the mode screen's own box (modes/AoxMode) and as the Save
// Defaults popup's (components/DefaultsCard) — the Lookup date box (components/LookupCard), and
// the tap-to-type slider readout (components/SliderValueEditor), which is one component covering
// seven sites. Every one of them holds a SETTING that already has a value in it.
//
// ── RULE 1: ENTERING A BOX SELECTS EVERYTHING IN IT ───────────────────────────────────────────
// The owner's ask, verbatim: "when you click/tap into any of them, everything inside is already
// highlighted and I can just start typing without having to delete or move my cursor". It follows
// from what these boxes ARE: each one shows the value the setting is currently on, so entering one
// always means replacing that value, never appending to it. Nothing in the app wants a caret
// parked mid-number.
//
// ⚠ WHY ONE DELEGATED LISTENER AND NOT SIX onFocus PROPS. The six boxes do not share a component —
// SliderValueEditor is one of the six, not a base class for the other five, which are hand-written
// <input>s in four different files. A shared handler would therefore have to be spread into those
// four JSX sites, and TWO of them (AoxMode, LookupCard) already own an onFocus that captures the
// Escape discard target, so the spread would have to be composed with theirs by hand at each site.
// That is exactly the shape this project rejects: it works today and the seventh box, whenever it
// is written, forgets. A document-level listener is the one seam where "a text box just took
// focus" can be answered for boxes that exist AND boxes that do not yet. Same idiom, same
// argument, as the module-level popstate listener in components/useBackButton.
//
// ⚠ AND WHY IT TAKES THREE EVENTS RATHER THAN ONE — the iOS half, and the reason a focus-only
// implementation would be the version that merely works in Chromium. A selection made during
// `focus` does not survive a TAP on WebKit: focus fires first, and the caret placement that is the
// tap's own default action lands after it and collapses the selection to wherever the finger was.
// So the rule is carried by three:
//   • focusin — selects. This is the whole story for a Tab, for a press-drag release onto a
//     [data-drag-focus] year box (lib/pointerGestures), and for the programmatic focus that mounts
//     a SliderValueEditor's input.
//   • pointerdown — ARMS, and only when the box does NOT already hold focus. Focus has not moved
//     yet at pointerdown, so "activeElement is not this box" is precisely the test for "this press
//     is what will enter it". That condition is the whole reason a SECOND tap inside a box you are
//     already typing in still does what a second tap should: place the caret.
//   • click — re-selects the armed box. It is the LAST event of the tap, so it lands after
//     WebKit's caret placement, and it is a user gesture, which is the other thing iOS wants
//     before it will honour a programmatic selection.
// The click leg bails when the selection is NOT collapsed, so a deliberate drag-select — press
// inside the text, drag across part of it, release — survives untouched. It is the one pointer
// gesture that carries an intent finer than "I am entering this box", and a collapsed selection is
// how the DOM says the gesture was an ordinary tap (the same test lib/selectionGuard makes for the
// guide's header drags).
// ⚠ DEVICE-ONLY TRUTH: jsdom has no WebKit caret placement to fight. The suite can prove the
// WIRING — which event selects, which one arms, which one bails — and cannot prove that the
// selection SURVIVES a real tap on the owner's iPhone. Only the phone can say that. If it ever
// says no, the next thing to try is a re-select on `touchend`, not a setTimeout.
//
// ── RULE 2: OPENING AN OVERLAY TAKES THE KEYBOARD DOWN ────────────────────────────────────────
// dismissKeyboard() at the foot of this file, called from ONE place — pushOverlay in
// components/useBackButton, which is where the app already learns that an overlay opened. The
// argument for that seam is written there, beside the call.

// The <input> types that are NOT typing targets: none of them raises a soft keyboard, and none of
// them is a thing you can be halfway through typing into. Everything else is — including the types
// this app has no site for today (email, number, date), which is why this is a deny-list: a box
// added later is a typing target by default rather than by remembering to list it.
const NON_TEXT_INPUT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

// The <input> types whose TEXT SELECTION API is defined. HTML's common input-element APIs apply
// select() to text, search, url, tel and password only; on email and number select() is specified
// to do nothing at all. So this is an allow-list where the one above is a deny-list, and the two
// are genuinely different questions rather than a duplication: "is the keyboard up?" is a strictly
// broader set than "can I highlight what is inside?". Every box the app actually has is `text`.
const SELECTABLE_INPUT = new Set(['text', 'search', 'url', 'tel', 'password'])

// Would this element have a soft keyboard up? Used by dismissKeyboard alone.
export function opensKeyboard(el: EventTarget | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT.has(el.type)
}

// Can this element's whole value be highlighted? Used by the select-all rule alone.
export function isSelectableField(
  el: EventTarget | null | undefined,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && SELECTABLE_INPUT.has(el.type)
}

// The armed box from the pointerdown leg: the field a press is about to ENTER, held until the
// click that completes that same press consumes it. Cleared by every click, so it can never leak
// into a later gesture even if the press it belongs to is cancelled.
let armed: HTMLInputElement | HTMLTextAreaElement | null = null

const onFocusIn = (e: FocusEvent) => {
  if (isSelectableField(e.target)) e.target.select()
}
const onPointerDown = (e: PointerEvent) => {
  const t = e.target
  armed = isSelectableField(t) && document.activeElement !== t ? t : null
}
const onClick = (e: MouseEvent) => {
  const el = armed
  armed = null
  if (el === null || e.target !== el || document.activeElement !== el) return
  if (el.selectionStart !== el.selectionEnd) return // a drag-select is a finer intent — leave it
  el.select()
}

// Install rule 1, and hand back the teardown. Called from App exactly the way its neighbour
// lib/pointerGestures is (one line, one effect, cleanup on unmount) — the two are the same kind of
// thing, a set of document-level listeners that state an app-wide input rule, and they should be
// installed the same way rather than one of them latching itself on forever.
// It is NOT an import-time side effect of this file, so a component test that renders a single box
// in isolation gets the plain browser behaviour unless it asks for the app's policy by name.
export function installSelectAllOnEntry() {
  // All three in the CAPTURE phase. Several of these boxes stop propagation on their own events
  // (the Escape contract does it on keydown, and the guide and the ⚙ panel both stop presses they
  // consider theirs), and an app-wide rule must not be switchable off by a component that happens
  // to stop a bubble.
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onClick, true)
    armed = null
  }
}

// Rule 2, as one sentence: whatever has the keyboard, put it down. Scoped to typing targets on
// purpose — blurring a focused BUTTON would be gratuitous (no keyboard is up) and would break the
// focus management around it, CustomSelect's return-focus-to-the-trigger most of all.
export function dismissKeyboard() {
  if (typeof document === 'undefined') return
  const ae = document.activeElement
  if (opensKeyboard(ae)) ae.blur()
}
