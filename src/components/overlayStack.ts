import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { dismissKeyboard, opensKeyboard } from '../lib/textEntry.js'

// components/overlayStack — THE APP'S ONE STACK OF OPEN THINGS, and every rule about closing them.
//
// Everything a player can open and dismiss registers HERE and nowhere else: the mode menu and every
// other dropdown list, ⚙ Settings, every popup (the ⚙ popups, each confirmation, the run breakdown,
// the storage-full notice), Show Codes and How-to-Play. So this module holds the only answer to
// "what is open, and in what order" — and the three dismiss gestures, the dim and the keyboard all
// read that one answer:
//   • BACK (Android hardware Back, a browser's Back, a back-swipe) closes the TOP entry.
//   • ESCAPE closes the top LAYER — one press, one layer, newest first.
//   • A PRESS OUTSIDE closes the top layer only, never the one under it as well.
//   • THE DIM is painted by the top popup alone, so two popups never darken the page twice.
//   • OPENING anything takes the soft keyboard down (dismissKeyboard, in pushOverlay).
// There used to be one registry (Back) and three rules that each kept their own idea of what was
// open — a document Escape listener per popup, a press-outside listener per layer, a scrim per
// popup, and a DOM query for "is a popup up". Each was right alone and they disagreed the moment two
// things were open at once: one Escape closed a popup AND the popup under it, one tap outside closed
// a dropdown AND the ⚙ panel it was in, and two scrims dimmed the page twice.
//
// THREE KINDS OF ENTRY, one hook each (below):
//   • a PAGE STATE — Show Codes, How-to-Play. Part of the page rather than a layer over it, so only
//     Back closes it: Escape and a press pass straight through to the layers (useBackButton).
//   • a LAYER with no scrim — ⚙ Settings, an open dropdown list, and the preset manager's delete
//     question (a second view of its card). Back and Escape close it, and a press anywhere is handed
//     to it while it is the top layer, for it to judge inside from outside (useLayer).
//   • a POPUP — it owns the whole screen behind a scrim. Back and Escape close it; a press is its
//     scrim's business, so nothing under it is ever told about one (usePopupLayer; components/Popup
//     is its only caller, and draws the scrim).
//
// ── BACK ──────────────────────────────────────────────────────────────────────────────────────
// Everywhere WITH a Back affordance (Android hardware Back, desktop browsers, any Safari/Chrome
// tab), Back with something open should close it — not exit the whole app. So each open entry
// pushes ONE history entry: pressing Back fires `popstate`, which closes the TOP-most entry (the
// browser already popped its history entry). Closing something via the UI instead steps BACK past
// its entry with a guarded traversal (popOverlay — batched, so overlays closing together step back
// together) — the entry itself survives as a dead forward entry (a traversal cannot delete; see the
// bounce below) — keeping position in lockstep with what's open. When nothing is open, Back does
// its normal thing (leaves the app). A single module-level popstate listener drives the stack, so
// nested overlays close one at a time, newest-first. In a browser tab the entries help beyond the
// hardware button — a back-swipe closes the overlay instead of leaving the site.
//
// The iOS INSTALLED app (home-screen PWA) is the deliberate exception (IOS_STANDALONE below). It
// has no Back affordance to serve, yet iOS home-screen apps honor edge swipes over the history
// stack: a back-swipe would "close" an overlay as a page-slide off a stale snapshot, and every UI
// close leaves a DEAD forward entry the next forward-swipe navigates into (the dead-navigation
// ping-pong), entries accumulating all session. Apple provides no gesture opt-out for home-screen
// web apps (w3c/manifest#1041, open since 2022; overscroll-behavior / touch-action never reach
// the system gesture), so the root-cause fix is to never CREATE entries there: pushOverlay skips
// pushState and popOverlay skips the traversal — pure stack bookkeeping — leaving the history at
// ONE entry forever, which makes both swipe directions inert (nothing to traverse to). Overlays
// still close via X / tap-outside / Esc, exactly as before. Android, desktop, and the iOS Safari
// TAB keep the old behavior byte-identical.

type Press = (e: PointerEvent) => void
type Entry = {
  id: string
  close: () => void
  // Escape closes it — every layer and popup; false for a page state.
  escape: boolean
  // A popup: it sits behind a scrim that owns every press, and it is what the dim follows.
  modal: boolean
  // A popup that belongs to the APP rather than to a screen or to the ⚙ panel (the storage-full
  // notice): nothing that changes the screen takes it away. See isAppWidePopupOpen.
  appWide: boolean
  // A scrim-less layer's own press handler, called for a press anywhere while it is the top layer.
  press: Press | null
}

const stack: Entry[] = []
let ignorePop = false
// ★ THE ENTRY THIS PAGE LOADED ON MAY ALREADY BE AN OVERLAY'S. A reload keeps the session history
// and the place in it — so a page reloaded while something was open starts life sitting ON that
// thing's marker entry, with nothing open (a new page has an empty stack). If the next thing to
// open pushed an entry of its own, the old one would be left behind it for good: a dead entry that
// costs one Back press which does nothing. How to Play made that a steady leak, because it comes
// back open after a reload (store/sessionMode) and so pushed again every time — one more dead Back
// press per reload — and Show Codes, which a casual mode also brings back open, did the same.
// So the first overlay to open after such a load TAKES THE ENTRY OVER instead (replaceState in
// pushOverlay): the history is exactly as long as it was, and Back closes that overlay and lands
// on the page's own entry. Read once, here, at import — before anything can have opened — and
// dropped by the first open or the first traversal, after which the place is no longer the one the
// page loaded on.
let onLoadedOverlayEntry = typeof window !== 'undefined' && !!window.history.state?.cgOverlay
// The newest entry that answers `is` — every rule in this file is "the top one of some kind".
const topWhere = (is: (entry: Entry) => boolean): Entry | undefined => {
  for (let i = stack.length - 1; i >= 0; i--) if (is(stack[i])) return stack[i]
  return undefined
}

// Who is listening for the stack changing — the popups (each asks "am I the top one?", which
// decides which scrim paints the dim) and App (which asks "is any popup up?", for the status bar).
// Both read through useSyncExternalStore below, so every reader re-renders in the same pass.
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const notify = () => {
  for (const listener of listeners) listener()
}

// The id of the top POPUP, or null while none is open. Layers and page states above it do not
// count: a dropdown cannot open over a popup, and Show Codes is not something a scrim sits under.
const topPopupId = (): string | null => topWhere((entry) => entry.modal)?.id ?? null
// Is any popup open? The plain function is for an event handler deciding what a key press may
// reach (src/main.tsx's shortcuts); the hook is for rendering.
export const isPopupOpen = () => topPopupId() !== null
export const usePopupOpen = () => useSyncExternalStore(subscribe, isPopupOpen)
// Is THIS the top popup, as the stack stands this instant? For a popup's own event handlers, which
// can run between the stack changing and React re-rendering the popups to match (components/Popup's
// focus rule); rendering reads the same answer through usePopupLayer.
export const isTopPopup = (id: string) => topPopupId() === id
// ★ IS AN APP-WIDE POPUP OPEN? Every other popup belongs to something the keyboard can replace: a ⚙
// popup is a child of the panel, and a mode screen's popup shows only while its screen does — which
// is why a mode letter, H and G are allowed with one of THOSE up (src/main.tsx's keyboard handler):
// the press takes the popup away with what it replaces. An app-wide popup stays whatever the screen
// does, so the same press would change the page BEHIND a popup that is still up — and a page behind
// a popup is inert. While one is open those keys do nothing; the popup is closed first.
export const isAppWidePopupOpen = () => stack.some((entry) => entry.appWide)

// iOS home-screen detection. `navigator.standalone` is a WebKit-only property (undefined on every
// other engine) that is true exactly in the installed-app case being starved. Deliberately NOT
// display-mode:standalone alone — that also matches Android installs, which NEED the entries for
// hardware Back. Should navigator.standalone ever fail an on-device check on a future iOS, the
// fallback detection is matchMedia('(display-mode: standalone)').matches AND an iOS platform
// check.
const IOS_STANDALONE =
  typeof navigator !== 'undefined' &&
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// The module-level popstate listener, attached at import time rather than lazily on the first
// overlay: dead forward entries survive a same-tab reload, so the dead-entry bounce below must be
// armed even before any overlay has opened in this page load.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    onLoadedOverlayEntry = false // a traversal: wherever this is, it is not where the page loaded
    if (ignorePop) {
      ignorePop = false // this popstate came from our own unwind (or bounce) — not a real Back
      return
    }
    // A real Back press: close the top-most overlay. The browser already popped its history entry,
    // and popping it from the stack HERE means the overlay's effect-cleanup popOverlay() finds it
    // gone and does NOT step back again (which would over-pop). See useRegistration's cleanup
    // below.
    const top = stack.pop()
    if (top) {
      notify()
      top.close()
      return
    }
    // Nothing is open, yet the entry landed on carries our marker: the user moved FORWARD onto the
    // dead entry of an already-closed overlay (a UI close backs past its entry but cannot delete
    // it). Bounce straight back — guarded, so the resulting popstate is swallowed above — instead
    // of parking the user where Back would need two presses. Unreachable under IOS_STANDALONE in
    // the steady state (no entries are ever created there), and left ungated on purpose: it also
    // self-heals entries left in the session history by a build from before the installed app
    // stopped creating them.
    if (event.state?.cgOverlay) {
      ignorePop = true
      window.history.back()
    }
  })
}

// ── ESCAPE AND A PRESS OUTSIDE ─────────────────────────────────────────────────────────────────
// One window listener each, attached once at import like the popstate listener above, and both in
// the CAPTURE phase: they are app-wide rules, and a component that stops a bubble must not be able
// to switch one off (lib/textEntry's listeners argue the same).
//
// ESCAPE closes the top layer and stops there — capture + stopPropagation, so the press is spent
// and nothing under that layer, and no other handler in the app, sees it.
//   • A TEXT BOX OWNS ITS OWN ESCAPE. Every box in the app discards its edit on Escape, so while
//     one has the keyboard the press is left alone to reach it — the dismissal ladder's innermost
//     rung: the first Escape gives the field back, the second, with nothing being typed, closes the
//     layer. The test is lib/textEntry's opensKeyboard, so a slider (which keeps focus after an
//     adjust and has no Escape meaning of its own) never swallows the dismiss.
//   • A HELD KEY IS ONE PRESS. Auto-repeat would otherwise peel every open layer in a second.
//   • A PAGE STATE IS SKIPPED, not a blocker: Show Codes can be opened by its key while ⚙ is open,
//     and Escape must still close the panel.
//
// A PRESS is handed to the top layer and to no other. It is `pointerdown` — one event per press
// for mouse, touch and pen alike. The older mousedown + touchstart pair reports one tap TWICE (the
// touch, then the mouse event the browser synthesises after it), and the second report would be
// read against a stack the first had already changed: one tap, two layers closed.
// A popup on top ends the search: its scrim covers the screen and answers its own taps, so the ⚙
// panel underneath is never asked whether a press on that scrim was "outside" it.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing) return
      if (opensKeyboard(document.activeElement)) return
      const top = topWhere((entry) => entry.escape)
      if (!top) return
      e.preventDefault()
      e.stopPropagation()
      top.close()
    },
    true,
  )
  window.addEventListener(
    'pointerdown',
    (e) => topWhere((entry) => entry.modal || entry.press !== null)?.press?.(e),
    true,
  )
}

function pushOverlay(entry: Entry) {
  if (typeof window === 'undefined' || stack.some((e) => e.id === entry.id)) return
  stack.push(entry)
  notify()
  // ★ OPENING AN OVERLAY TAKES THE KEYBOARD DOWN (round 18). The owner's rule, verbatim: "when the
  // keyboard is open, doing anything at all should close it". What he reported was AoX — focus the
  // run-length box, then open ⚙ Settings or the mode menu, and the keyboard just stays up over the
  // thing you opened.
  // THE ROOT CAUSE IS PLATFORM, NOT THIS APP: pressing a <button> does not move focus on iOS or
  // Safari, so the gear tap leaves the caret exactly where it was and the overlay opens UNDER a
  // keyboard. Desktop Chrome hides the bug because the button takes focus there and the box blurs
  // on its own — which is also why the fix is the RIGHT one and not a papering-over: it makes every
  // platform do what Chrome already did.
  // ⚠ AND THIS IS THE SEAM, not the five openers. Every overlay in the app already registers here
  // (see the note at the top of this file) — so this line is the rule stated once, for the overlays
  // that exist and the ones that do not yet, where patching openers is five edits today and a
  // forgotten sixth tomorrow.
  // ⚠ IT BELONGS TO THE OPENING, NOT TO BEING OPEN, and the difference is the whole reason it lives
  // down here beside the stack.push rather than up in the hook. Every box in the ⚙ panel is INSIDE
  // an overlay, so a version that asked "is an overlay up?" on each render would take the keyboard
  // off a year box mid-word and make the panel untypeable. Sitting after the already-registered
  // guard keeps the two facts one decision: a call that does not add an entry is not an opening and
  // must do nothing at all. tests/textEntryFocus pins that scope against exactly that mistake.
  // ⚠ AND IT KEEPS THE EDIT, because each box's blur is its OWN contract and this only runs it. The
  // five that commit on blur (both year boxes, both AoX run-length fields, every tap-to-type
  // readout) normalize-commit; the Lookup date box has no onBlur at all, so its text is simply left
  // standing. Either way opening something is not a discard — Escape is the discard, everywhere.
  dismissKeyboard()
  if (IOS_STANDALONE) return
  // Its history entry: a new one — or, for the first overlay to open on a page that loaded onto a
  // previous load's marker entry, that entry taken over (see onLoadedOverlayEntry).
  if (onLoadedOverlayEntry) window.history.replaceState({ cgOverlay: entry.id }, '')
  else window.history.pushState({ cgOverlay: entry.id }, '')
  onLoadedOverlayEntry = false
}

// ⚠⚠ OVERLAYS THAT CLOSE TOGETHER UNWIND TOGETHER — ONE TRAVERSAL, ONE IGNORED popstate. This used
// to call history.back() once per closing overlay, each marked by setting the one `ignorePop` flag.
// That is only sound for ONE overlay at a time, and several routinely close in a single commit: G,
// or any mode letter, shuts the whole ⚙ panel with whatever is open inside it — and the preset
// manager's delete question makes that THREE entries ('settings', 'presets', 'presets-delete').
// Browsers do not agree on what three back() calls in one task mean:
//   • CHROMIUM RUNS ALL THREE, each with its own popstate (measured in a real browser). The first
//     cleared the flag; the second, arriving on the 'settings' entry with nothing registered, was
//     taken for the dead-entry bounce below and went back ONCE MORE — a fourth traversal, off the
//     app's own first entry: the app navigated away on a key press. (Two entries never showed it,
//     because the second popstate lands on a marker-less entry and does nothing — which is why
//     the third entry is what made it reachable.)
//   • jsdom COALESCES them into one traversal and one popstate, which is how the suite missed it,
//     and it leaves two dead entries behind. A counter in place of the flag would be right for the
//     first engine and would EAT the user's next real Back press in the second.
// One `history.go(-n)` is a single traversal in every engine, with exactly one popstate, so exactly
// one ignore is always right. The closes are gathered in a microtask: every cleanup of one React
// commit runs synchronously before it, so a whole panel's worth lands in one count, and nothing a
// user does can come in between. (A traversal was never synchronous anyway — history.back() only
// queues one — so deferring the call moves nothing a user could observe.)
let pendingUnwind = 0
const flushUnwind = () => {
  const n = pendingUnwind
  pendingUnwind = 0
  ignorePop = true
  window.history.go(-n) // step back past every entry the closed overlays pushed (one popstate, ignored)
}

function popOverlay(id: string) {
  if (typeof window === 'undefined') return
  const i = stack.findIndex((e) => e.id === id)
  if (i === -1) return // already removed by a real Back press → nothing to undo (avoids over-popping)
  stack.splice(i, 1)
  notify()
  if (IOS_STANDALONE) return // no entry was pushed for this overlay → no history to unwind
  if (pendingUnwind++ === 0) queueMicrotask(flushUnwind)
}

// Register `id` as open while `isOpen` is true. `id` must be stable + unique per INSTANCE across
// the whole app — use useId() for repeated components (dropdowns).
// `close` and `press` are read through refs, so a caller's inline arrow never re-registers.
//
// ⚠ LAYOUT EFFECTS, NOT PASSIVE ONES. Which scrim paints the dim is read off the stack, so the
// stack has to be right before the frame that shows the change is painted: registered a frame late,
// a second popup would open undimmed over a still-dimmed first one, and closing it would leave one
// frame with no dim at all. Updates made from a layout effect are rendered before the browser paints.
function useRegistration(
  isOpen: boolean,
  close: () => void,
  id: string,
  escape: boolean,
  modal: boolean,
  press: Press | null,
  appWide = false,
) {
  // Held in refs, updated POST-COMMIT (writing a ref during render trips the React-Compiler-strict
  // react-hooks/refs rule). The registered closures read them lazily, when the gesture arrives.
  const closeRef = useRef(close)
  const pressRef = useRef(press)
  useLayoutEffect(() => {
    closeRef.current = close
    pressRef.current = press
  })
  const pressed = press !== null
  useLayoutEffect(() => {
    if (!isOpen) return
    pushOverlay({
      id,
      close: () => closeRef.current(),
      escape,
      modal,
      appWide,
      press: pressed ? (e) => pressRef.current?.(e) : null,
    })
    return () => popOverlay(id)
  }, [isOpen, id, escape, modal, pressed, appWide])
}

// A PAGE STATE (Show Codes, How-to-Play): Back closes it, and nothing else here does.
export function useBackButton(isOpen: boolean, close: () => void, id: string) {
  useRegistration(isOpen, close, id, false, false, null)
}

// A LAYER with no scrim (⚙ Settings, a dropdown list, the preset manager's delete question): Back
// and Escape close it. `onPress` is told about every press on the page while this is the top
// layer, and decides for itself what counts as outside; a layer that is a view of a popup's own
// card passes none, and the press is its popup's scrim's to answer.
export function useLayer(isOpen: boolean, close: () => void, id: string, onPress?: Press) {
  useRegistration(isOpen, close, id, true, false, onPress ?? null)
}

// A POPUP, open for as long as its component is mounted (components/Popup, the only caller).
// Returns whether it is the TOP popup — the one that paints the dim and holds the keyboard.
// `appWide`: it belongs to no screen and no panel (isAppWidePopupOpen argues what that changes).
export function usePopupLayer(close: () => void, id: string, appWide: boolean) {
  useRegistration(true, close, id, true, true, null, appWide)
  return useSyncExternalStore(subscribe, () => isTopPopup(id))
}
