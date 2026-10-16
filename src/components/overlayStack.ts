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
//   • THE KEYBOARD STAYS IN WHAT IS OPEN. While a popup, the ⚙ menu or a dropdown list is open the
//     page behind it is out of the keyboard's reach — no key acts on it and focus cannot be on it
//     ("THE KEYBOARD'S REACH", below, and isPageCovered).
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
// its entry with a guarded traversal (settle — one traversal however many overlays closed together)
// — the entry itself survives as a dead forward entry (a traversal cannot delete) — keeping position
// in lockstep with what's open. Every marker entry records HOW DEEP it is (entryDepth, below), which
// is what lets one rule keep that lockstep everywhere: the place in the history is never left
// deeper than the newest thing still open. When nothing is open, Back does
// its normal thing (leaves the app) — including when the page was reloaded with things open that
// did not come back, and so stands on their entries (leaveIfOwed, below). A single module-level popstate listener drives the stack, so
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
// Where the keyboard may be while an entry is the top one covering the page. Three live readers
// (they are asked when a key or a focus change arrives, never at render):
export type Reach = {
  // Every element the keyboard may be INSIDE. A popup: its scrim. The ⚙ menu: the whole top bar —
  // its card, its gear, and the two lists beside the gear, which stay usable over it. A dropdown
  // list: its button and its list.
  parts: () => (Element | null)[]
  // Where the keyboard is PUT when it has to be put somewhere inside: the popup's dialog, the
  // menu's card, the list's button.
  hold: () => HTMLElement | null
  // The element whose controls Tab WALKS, wrapping at the ends — the popup's scrim, the menu's
  // whole top bar (the two lists' buttons and the gear, then the card's own controls: everything
  // that stays usable over the open menu has to be somewhere the keyboard can get to). null where
  // Tab is the layer's own key: an open list closes on it.
  walk: () => HTMLElement | null
}
type Entry = {
  id: string
  close: () => void
  // Escape closes it — every layer and popup; false for a page state.
  escape: boolean
  // A popup: it sits behind a scrim that owns every press, and it is what the dim follows.
  modal: boolean
  // It COVERS THE PAGE — every popup, the ⚙ menu and every dropdown list: this is where the
  // keyboard may be while it is the newest such thing open ("THE KEYBOARD'S REACH", below). null for
  // what does not cover it: a page state, and a layer that is only another view of a popup's card.
  reach: Reach | null
  // What had the keyboard when this opened, to be given it back when this closes. Covering entries
  // only; never a text box (opening anything takes the keyboard off one first).
  returnTo: HTMLElement | null
  // A popup that belongs to the APP rather than to a screen or to the ⚙ panel (the storage-full
  // notice): nothing that changes the screen takes it away. See isAppWidePopupOpen.
  appWide: boolean
  // A scrim-less layer's own press handler, called for a press anywhere while it is the top layer.
  press: Press | null
  // Which history entry is its own: how many overlay entries deep (see entryDepth).
  depth: number
}

const stack: Entry[] = []
let ignorePop = false
// ★ HOW DEEP THE HISTORY ENTRY WE ARE STANDING ON IS — 0 on the page's own entry, n on the n-th
// overlay entry above it. Every marker entry is written with its depth ({cgOverlay, cgDepth}), so
// this is read straight off the entry: at import (a reload lands wherever the last page was) and on
// every traversal. A marker an older build wrote carries no depth and counts as 1 — "at least one
// overlay entry deep", which is all that can be known of it and all settle() needs.
const depthOf = (state: unknown): number => {
  const marker = state as { cgOverlay?: unknown; cgDepth?: unknown } | null
  if (!marker?.cgOverlay) return 0
  return typeof marker.cgDepth === 'number' && marker.cgDepth >= 1 ? marker.cgDepth : 1
}
let entryDepth = typeof window !== 'undefined' ? depthOf(window.history.state) : 0
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
// ⚠ AND WHEN THE PAGE WAS RELOADED WITH TWO THINGS OPEN, the entry taken over is the SECOND one
// deep, and the first is still underneath it — owned by nothing. Taking over the newest entry alone
// left that one behind: closing the overlay landed on it, and the next Back was a press that did
// nothing. The overlay that takes the entry over keeps the entry's own depth, and settle() steps
// past everything under it that nothing owns.
let onLoadedOverlayEntry = entryDepth > 0
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
// Is any popup open? The plain function is for an event handler (src/main.tsx's Tab and G, whose
// answers differ for a popup and for the ⚙ menu); the hook is for rendering.
export const isPopupOpen = () => topPopupId() !== null
export const usePopupOpen = () => useSyncExternalStore(subscribe, isPopupOpen)
// ── THE KEYBOARD'S REACH ───────────────────────────────────────────────────────────────────────
// ★ ONE RULE: WHILE ANYTHING COVERS THE PAGE — a popup, the ⚙ menu, an open dropdown list — THE
// KEYBOARD BELONGS TO THE NEWEST SUCH THING, AND THE PAGE BEHIND IT CANNOT BE REACHED BY IT. The
// stack is the only thing that knows what is open, so the whole rule is kept here, in four parts
// that all read the same fact (the top entry with a `reach`):
//   1. THE PAGE'S OWN KEYS DO NOTHING (isPageCovered). They are window-wide shortcuts, not keys
//      sent to a focused control — the answer keys (0–9), the Game Actions (N, R, O, C, S, ← and
//      →) and Tab's "open the mode selector" in src/main.tsx's handler, and Lookup's ↑ / ↓ /
//      Backspace / Delete in components/LookupCard's — so keeping focus off the page (parts 2–4)
//      cannot stop them, and each of those handlers asks this one question instead.
//   2. FOCUS IS TAKEN OFF THE PAGE WHEN THE LAYER OPENS, and given back when it closes
//      (pushOverlay, handBack). Without this a button on the page that had the keyboard kept it:
//      press New, open ⚙ with G, and Space or Enter pressed New again behind the menu.
//   3. FOCUS THAT ARRIVES OUTSIDE COMES STRAIGHT BACK (the focusin listener below) — a screen
//      behind focusing itself, a script, a browser walking Tab somewhere this did not expect.
//   4. TAB AND SHIFT+TAB WALK THE LAYER'S OWN CONTROLS AND WRAP AT THE ENDS (the keydown listener
//      below) — every step of it the stack's own — so neither can walk out into the page.
// WHY NOT THE `inert` ATTRIBUTE on what is covered, which gives 2–4 for nothing: it also takes the
// POINTER and the SCROLL away from whatever wears it, and under the ⚙ menu and a list those belong
// to the page still — a tap outside closes the menu AND lands on what was tapped, and the page
// scrolls under an open list (components/CustomSelect's dismiss rule, an owner's decision). Only a
// popup's scrim already blocks both, and a rule that is one thing under a popup and another under a
// menu is two rules. So this is the keyboard's rule and it touches nothing else.
// WHAT IT DELIBERATELY LEAVES ALONE is argued where the keys are handled (src/main.tsx): the mode
// letters, H and G replace or close what is open rather than reach behind it. And a control inside
// the layer keeps its own keys — the arrows along a setting's options, Escape, typing.
const topCover = (): Entry | undefined => topWhere((entry) => entry.reach !== null)
export const isPageCovered = () => topCover() !== undefined
const within = (reach: Reach, el: Element | null) =>
  el !== null && reach.parts().some((part) => part !== null && part.contains(el))
// Putting the keyboard somewhere on the stack's own account — as a layer opens, when stray focus is
// pulled back, when a closed layer hands it back — never scrolls anything: the player did not ask
// to be moved. (A Tab step is the opposite case and scrolls its target into view: see the listener.)
const focusOn = (el: HTMLElement | null) => el?.focus({ preventScroll: true })
// Where focus is, when it is on something: null for nothing, <body>, or an element already removed.
const focused = (): HTMLElement | null => {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body && active.isConnected
    ? active
    : null
}
// Every control Tab can land on inside `walk`, in the order Tab reaches them. "On screen" is asked
// the way src/main.tsx's key handler asks it (offsetParent): a control in a display:none branch is
// not a stop. A control marked aria-disabled IS one — it is announced as unavailable, which a
// keyboard or screen-reader user can only hear by landing on it.
const TAB_STOPS = 'button,input,select,textarea,a[href],[tabindex]'
const tabStops = (walk: HTMLElement) =>
  Array.from(walk.querySelectorAll<HTMLElement>(TAB_STOPS)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement | HTMLInputElement).disabled &&
      el.offsetParent !== null,
  )
// ★ EVERY OPEN DROPDOWN LIST CLOSES — for the keys that replace or close what is on screen (a mode
// letter, H, G: src/main.tsx). A list in the top bar belongs to no screen and no menu, so nothing
// those keys do takes it away: it used to stay open over the new page, still holding the keyboard,
// or under a ⚙ menu that Escape then closed first. A list is the one covering layer with nothing for
// Tab to walk (Reach's `walk`), which is how it is told from the menu and from a popup.
export function closeLists(): void {
  for (const entry of [...stack])
    if (entry.reach && !entry.modal && entry.reach.walk() === null) entry.close()
}
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
    const from = entryDepth
    entryDepth = depthOf(event.state)
    if (ignorePop) {
      // This popstate came from our own settle() — not a real Back. Settle once more from where it
      // landed: something else may have closed while the traversal was on its way, and a marker
      // with no depth (an older build's) can have another like it underneath.
      ignorePop = false
      settle()
      leaveIfOwed()
      return
    }
    // A real Back press: close the top-most overlay. The browser already popped its history entry,
    // and popping it from the stack HERE means the overlay's effect-cleanup popOverlay() finds it
    // gone and does NOT step back again (which would over-pop) — it still hands the keyboard back.
    // See useRegistration's cleanup below.
    const top = stack.pop()
    if (top) {
      notify()
      top.close()
    } else if (entryDepth < from) {
      // …or a real Back press with NOTHING open (see leaveIfOwed): the press is still owed.
      backOwed = true
    }
    // …and wherever that landed, do not stay on an entry nothing owns (settle, below): the entry of
    // an overlay that is already closed — moved FORWARD onto, or left underneath the one this Back
    // just closed by a reload with two things open.
    settle()
    leaveIfOwed()
  })
}

// ── A BACK PRESS THAT CLOSED NOTHING IS STILL A BACK PRESS ─────────────────────────────────────
// A page reloaded with something open starts on that thing's entry (onLoadedOverlayEntry, above).
// When what was open does not come back after a reload — the ⚙ menu, a popup — nothing is open and
// the page is still one or more overlay entries deep. Back from there used to step down onto the
// page's own entry and stop: the press was spent, and nothing on the screen had changed. With
// nothing open, Back means what it means on any page — leave — so the press is passed on: once the
// place has settled on the page's own entry, one more step back is taken on the player's behalf.
// HOW A BACK PRESS IS TOLD FROM A FORWARD ONE: both arrive as the same event, with nothing open in
// either case when the entry is a dead one — but Back lands on a SHALLOWER entry than it left and
// Forward on a deeper one, and every entry carries its depth. (Two markers an older build left
// carry no depth and read the same, so a press between them is not passed on: it settles onto the
// page as before.)
// ⚠ ONLY EVER FROM THE PAGE'S OWN ENTRY, and only as a plain history.back() that nothing waits for:
// if there is a page before this one the app is left, and if there is none (the app was the first
// thing in the tab) the call does nothing at all — no popstate comes, so no flag is left standing.
let backOwed = false
function leaveIfOwed() {
  if (!backOwed || ignorePop) return // a settle is still on its way: it comes back through here
  backOwed = false
  if (entryDepth === 0 && stack.length === 0) window.history.back()
}

// ── THE PLACE IN THE HISTORY NEVER SITS DEEPER THAN THE NEWEST THING STILL OPEN ────────────────
// The one rule that keeps the history and the stack in lockstep, run after everything that can part
// them — an overlay closed from the UI (popOverlay), a Back press (above), and the popstate of the
// traversal this itself asked for. If the entry we are on is deeper than the entry of the top open
// overlay (0 with nothing open), the entries in between belong to nothing: step back past all of
// them in ONE guarded traversal, whose popstate the listener above swallows. Three things were
// separate cases before this was one rule, and each could leave a Back press that did nothing:
//   • a UI close — it steps back past the closed overlay's entry (and, in the same step, past any
//     dead one under it);
//   • the dead-entry bounce — Forward onto the leftover entry of a closed overlay snaps straight
//     back, however many such entries the move crossed;
//   • a reload with two things open — the overlay that came back took over the newest entry, and
//     the older one under it was left for the player to press Back through.
// ⚠ ONE TRAVERSAL IN FLIGHT AT A TIME. `ignorePop` is a single flag, so a second traversal asked for
// before the first one's popstate arrives would be answered by a popstate nothing was waiting for —
// taken for a real Back, and closing something. So while one is in flight this does nothing, and the
// listener settles again when it lands, from the depth it actually landed on.
// Never forwards: an overlay whose own entry is ahead of where we stand (its opening raced a
// traversal) is simply closed by the next Back, which is the right answer too.
// Ungated by IOS_STANDALONE on purpose: no entry is ever created there, so there is nothing to step
// past in the steady state — and an entry left in the session history by a build from before the
// installed app stopped creating them still heals itself.
function settle() {
  if (ignorePop) return
  const owned = stack.length ? stack[stack.length - 1].depth : 0
  if (entryDepth <= owned) return
  ignorePop = true
  window.history.go(owned - entryDepth)
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
//   • A PAGE STATE IS SKIPPED, not a blocker: with Show Codes open, Escape must still close the
//     layer that is open with it.
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
  // THE KEYBOARD'S REACH, part 4 — TAB. Capture, like Escape, so no control inside can switch it
  // off; and it stops nothing else, so whatever listens for Tab (lib/keyboardFocus) still hears it.
  // ★ EVERY STEP IS TAKEN HERE, none left to the browser. The middle steps used to be the browser's
  // own, and browsers do not agree on what Tab stops at: desktop Safari skips every button unless a
  // system setting says otherwise, so the walk there would have covered the text boxes and nothing
  // else. The order is the document's — the layer's controls as they are written, which is also the
  // order a screen reader reads them in (nothing in the app carries a positive tabindex).
  //   • From a control: to the next one in the direction of travel, wrapping at the ends.
  //   • From anything else — the menu's card, nothing at all: Tab goes to the first control
  //     after where the keyboard is (the first of all, from outside the walk), Shift+Tab to the
  //     last one before it. A control INSIDE the focused element counts as after it, never before.
  //   • A control that will not take focus (hidden some way the test above does not see) is passed
  //     over for the next.
  //   • A layer with NO control (the Changelog, the run breakdown, the storage-full notice — text
  //     only) keeps the keyboard on what it holds.
  // ★ AND THE STEP SCROLLS ITS TARGET INTO VIEW — a plain focus(), unlike every other focus this
  // file places. The player asked to go there. Without it the wrap from the last control of a long
  // list to the first landed on a control scrolled out of sight: nothing on screen wore the ring,
  // and the next key typed went into a box nobody could see.
  // Ctrl/Alt/⌘ + Tab are the browser's and the system's.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const reach = topCover()?.reach
      const walk = reach?.walk()
      if (!reach || !walk) return
      e.preventDefault()
      const stops = tabStops(walk)
      const active = focused()
      const at = active && walk.contains(active) ? active : null
      const beyond = (stop: HTMLElement): boolean => {
        if (!at || stop === at) return false
        const where = at.compareDocumentPosition(stop)
        return e.shiftKey
          ? (where & Node.DOCUMENT_POSITION_PRECEDING) !== 0 && !stop.contains(at)
          : (where & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      }
      // The controls in the order this press would try them: those further on in the direction of
      // travel, nearest first, then round from the other end.
      const ahead = stops.filter(beyond)
      const round = stops.filter((stop) => !beyond(stop) && stop !== at)
      const order = e.shiftKey ? [...ahead.reverse(), ...round.reverse()] : [...ahead, ...round]
      for (const stop of order) {
        stop.focus()
        if (document.activeElement === stop) return
      }
      if (!at) focusOn(reach.hold())
    },
    true,
  )
  // THE KEYBOARD'S REACH, part 3 — focus that lands outside the top covering layer comes back to
  // it. The stack is read as the event arrives, so a layer that has just opened or closed is
  // already (or no longer) the one asked.
  document.addEventListener('focusin', (e) => {
    const reach = topCover()?.reach
    if (reach && e.target instanceof Element && !within(reach, e.target)) focusOn(reach.hold())
  })
}

function pushOverlay(opened: Omit<Entry, 'depth' | 'returnTo'>): Entry | null {
  if (typeof window === 'undefined' || stack.some((e) => e.id === opened.id)) return null
  // Its history entry: a new one, one deeper than where we stand — or, for the first overlay to
  // open on a page that loaded onto a previous load's marker entry, that entry taken over at the
  // depth it already has (see onLoadedOverlayEntry). The iOS installed app writes no history, so an
  // overlay there owns the entry it opened on.
  const takeOver = onLoadedOverlayEntry || IOS_STANDALONE
  const entry: Entry = { ...opened, returnTo: null, depth: takeOver ? entryDepth : entryDepth + 1 }
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
  // THE KEYBOARD'S REACH, part 2 — a layer that covers the page TAKES THE KEYBOARD AS IT OPENS,
  // unless the keyboard is already inside it (a list's button, focused by the press that opened
  // it; the gear). What had it is remembered, to be given it back when this closes (handBack) —
  // unless that is the very element this layer holds the keyboard ON (a list's own button): then
  // nothing is being handed over, and there will be nothing to hand back.
  // After the line above, on purpose: what is remembered is then never a text box, so closing a
  // layer can never put the soft keyboard back up.
  if (entry.reach) {
    const had = focused()
    const hold = entry.reach.hold()
    entry.returnTo = had === hold ? null : had
    if (!within(entry.reach, had)) focusOn(hold)
  }
  if (IOS_STANDALONE) return entry
  const marker = { cgOverlay: entry.id, cgDepth: entry.depth }
  if (takeOver) window.history.replaceState(marker, '')
  else window.history.pushState(marker, '')
  entryDepth = entry.depth
  onLoadedOverlayEntry = false
  return entry
}

// THE KEYBOARD'S REACH, part 2, the other half — a covering layer that has closed GIVES THE
// KEYBOARD BACK. Run when the layer's own component lets go of it (useRegistration's cleanup), which
// every way of closing reaches — its own controls, Escape, a press outside, Back, the screen behind
// it being replaced — and by which time React has removed what it drew.
//   • Only when the keyboard was left with the layer: still on something inside it, or on nothing
//     because what held it has just been removed. Focus already somewhere else — the press that
//     closed a menu has focused what it pressed — is left where it is.
//   • To what had it when the layer opened — the control that opened a popup, the button on the
//     page that was last pressed, the top-bar button the keyboard was on when G opened the ⚙ menu
//     over it — if that is still there, and within reach of whatever still covers the page. (The
//     last of those is inside the menu's own reach, which is the whole top bar, and used not to
//     count: Tab into the menu and Escape out left the keyboard on nothing.) A list remembered
//     nothing to give back (pushOverlay): a tap outside one must not pull the keyboard back onto
//     its button.
//   • Otherwise to the layer now on top, if there is one: a popup that was waiting under the one
//     just closed takes the keyboard again.
function handBack(closed: Entry) {
  if (!closed.reach) return
  const active = focused()
  if (active && !within(closed.reach, active)) return
  const reach = topCover()?.reach
  const from = closed.returnTo
  const back = from?.isConnected ? from : null
  if (back && (!reach || within(reach, back))) focusOn(back)
  else if (reach && !within(reach, active)) focusOn(reach.hold())
}

// ⚠⚠ OVERLAYS THAT CLOSE TOGETHER UNWIND TOGETHER — ONE TRAVERSAL, ONE IGNORED popstate. This once
// called history.back() once per closing overlay, each marked by setting the one `ignorePop` flag.
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
// one ignore is always right — and settle() (above) asks for exactly one, to wherever the newest
// thing still open is. The closes are gathered in a microtask: every cleanup of one React commit
// runs synchronously before it, so a whole panel's worth is gone from the stack before the one
// settle runs, and nothing a user does can come in between. (A traversal was never synchronous
// anyway — history.back() only queues one — so deferring the call moves nothing a user could
// observe.)
let settleQueued = false
const settleQueuedCloses = () => {
  settleQueued = false
  settle()
}

function popOverlay(entry: Entry) {
  const i = stack.indexOf(entry)
  if (i !== -1) {
    stack.splice(i, 1)
    notify()
  }
  handBack(entry)
  if (i === -1) return // already removed by a real Back press → nothing to undo (avoids over-popping)
  if (IOS_STANDALONE) return // no entry was pushed for this overlay → no history to unwind
  if (settleQueued) return
  settleQueued = true
  queueMicrotask(settleQueuedCloses)
}

// Register `id` as open while `isOpen` is true. `id` must be stable + unique per INSTANCE across
// the whole app — use useId() for repeated components (dropdowns).
// `close`, `press` and `reach` are read through refs, so a caller's inline arrow never re-registers.
//
// ⚠ LAYOUT EFFECTS, NOT PASSIVE ONES. Which scrim paints the dim is read off the stack, so the
// stack has to be right before the frame that shows the change is painted: registered a frame late,
// a second popup would open undimmed over a still-dimmed first one, and closing it would leave one
// frame with no dim at all. Updates made from a layout effect are rendered before the browser paints.
// ★ A POPUP'S CLOSE MAY DECLINE, BY RETURNING false — "something had to be answered first, and the
// player has to see the answer" (the one case: components/SettingsPanel's preset manager, when
// leaving a name box on the way out tried a rename the device had no room to save, and the note
// under its row has to be read). Escape and a tap on the dim simply leave such a popup where it
// is. A real BACK press is different: the browser has already stepped off the popup's history
// entry, and this stack had already taken the popup off before asking it to close — so a popup
// that stays registers itself again, with a history entry of its own, and the next Back closes
// it. (Declining is a popup's business only: layers and page states close when asked.)
type Close = () => boolean | void

function useRegistration(
  isOpen: boolean,
  close: Close,
  id: string,
  escape: boolean,
  modal: boolean,
  reach: Reach | null,
  press: Press | null,
  appWide = false,
) {
  // Held in refs, updated POST-COMMIT (writing a ref during render trips the React-Compiler-strict
  // react-hooks/refs rule). The registered closures read them lazily, when the gesture arrives.
  const closeRef = useRef(close)
  const pressRef = useRef(press)
  const reachRef = useRef(reach)
  useLayoutEffect(() => {
    closeRef.current = close
    pressRef.current = press
    reachRef.current = reach
  })
  const pressed = press !== null
  const covers = reach !== null
  useLayoutEffect(() => {
    if (!isOpen) return
    // The entry this registration holds now — replaced if a declined close re-registers it.
    let entry: Entry | null = null
    const opened: Omit<Entry, 'depth' | 'returnTo'> = {
      id,
      close: () => {
        if (closeRef.current() !== false || !entry || stack.includes(entry)) return
        entry = pushOverlay(opened) ?? entry
      },
      escape,
      modal,
      reach: covers
        ? {
            parts: () => reachRef.current?.parts() ?? [],
            hold: () => reachRef.current?.hold() ?? null,
            walk: () => reachRef.current?.walk() ?? null,
          }
        : null,
      appWide,
      press: pressed ? (e) => pressRef.current?.(e) : null,
    }
    entry = pushOverlay(opened)
    if (!entry) return
    return () => {
      if (entry) popOverlay(entry)
    }
  }, [isOpen, id, escape, modal, covers, pressed, appWide])
}

// A PAGE STATE (Show Codes, How-to-Play): Back closes it, and nothing else here does.
export function useBackButton(isOpen: boolean, close: () => void, id: string) {
  useRegistration(isOpen, close, id, false, false, null, null)
}

// A LAYER with no scrim (⚙ Settings, a dropdown list, the preset manager's delete question): Back
// and Escape close it. `onPress` is told about every press on the page while this is the top
// layer, and decides for itself what counts as outside; a layer that is a view of a popup's own
// card passes none, and the press is its popup's scrim's to answer.
// `reach`: where the keyboard may be while this layer is the top one covering the page ("THE
// KEYBOARD'S REACH", above) — the ⚙ menu and every dropdown list pass one. The delete question
// passes none: it is its popup's own card, and the popup's reach already holds the keyboard there.
export function useLayer(
  isOpen: boolean,
  close: () => void,
  id: string,
  onPress?: Press,
  reach?: Reach,
) {
  useRegistration(isOpen, close, id, true, false, reach ?? null, onPress ?? null)
}

// A POPUP, open for as long as its component is mounted (components/Popup, the only caller).
// Returns whether it is the TOP popup — the one that paints the dim and holds the keyboard.
// `close` may decline by returning false (the ★ above useRegistration).
// `appWide`: it belongs to no screen and no panel (isAppWidePopupOpen argues what that changes).
// `reach`: its scrim, and the dialog in it — every popup covers the page.
export function usePopupLayer(close: Close, id: string, appWide: boolean, reach: Reach) {
  useRegistration(true, close, id, true, true, reach, null, appWide)
  return useSyncExternalStore(subscribe, () => isTopPopup(id))
}
