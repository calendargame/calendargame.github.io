import { useEffect, useRef } from 'react'
import { dismissKeyboard } from '../lib/textEntry.js'

// The app's OPEN-OVERLAY REGISTRY, and the two things it does with the fact that an overlay opened
// (Q1 — Android hardware Back; round-7 Q3 — starving the iOS PWA swipe-history; round 18 — taking
// the keyboard down).
//
// ⚠ THE NAME UNDERSELLS IT, and that matters now that a second consumer has arrived. Every
// dismissable overlay in the app registers HERE and nowhere else — the mode menu, ⚙ Settings and
// its four popups, every ⚙ dropdown, Show Codes, How-to-Play — so this module holds the only
// complete answer to "what is open, and in what order". Back-button handling is what it has always
// DONE with that answer; it is not the reason the registry exists. See dismissKeyboard's call in
// pushOverlay for the second thing it does with it.
//
// Everywhere WITH a Back affordance (Android hardware Back, desktop browsers, any Safari/Chrome
// tab), Back with an overlay open (the mode menu, ⚙ Settings, Show Codes, How-to-Play) should
// close that overlay — not exit the whole app. So each open overlay pushes ONE history entry:
// pressing Back fires `popstate`, which closes the TOP-most overlay (the browser already popped
// its entry). Closing an overlay via the UI instead steps BACK past its entry with a guarded
// `history.back()` — the entry itself survives as a dead forward entry (history.back() cannot
// delete; see the bounce below) — keeping position in lockstep with what's open. When nothing is
// open, Back does its normal thing (leaves the app). A single module-level popstate listener
// drives a LIFO stack, so nested overlays close one at a time, newest-first. In a browser tab the
// entries help beyond the hardware button — a back-swipe closes the overlay instead of leaving
// the site.
//
// The iOS INSTALLED app (home-screen PWA) is the deliberate exception (IOS_STANDALONE below). It
// has no Back affordance to serve, yet iOS home-screen apps honor edge swipes over the history
// stack: a back-swipe would "close" an overlay as a page-slide off a stale snapshot, and every UI
// close leaves a DEAD forward entry the next forward-swipe navigates into (the dead-navigation
// ping-pong), entries accumulating all session. Apple provides no gesture opt-out for home-screen
// web apps (w3c/manifest#1041, open since 2022; overscroll-behavior / touch-action never reach
// the system gesture), so the root-cause fix is to never CREATE entries there: pushOverlay skips
// pushState and popOverlay skips history.back() — pure stack bookkeeping — leaving the history at
// ONE entry forever, which makes both swipe directions inert (nothing to traverse to). Overlays
// still close via X / tap-outside / Esc, exactly as before. Android, desktop, and the iOS Safari
// TAB keep the old behavior byte-identical.

type Entry = { id: string; close: () => void }
const stack: Entry[] = []
let ignorePop = false

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
    if (ignorePop) {
      ignorePop = false // this popstate came from our own history.back() — not a real Back
      return
    }
    // A real Back press: close the top-most overlay. The browser already popped its history entry,
    // and popping it from the stack HERE means the overlay's effect-cleanup popOverlay() finds it
    // gone and does NOT call history.back() again (which would over-pop). See useBackButton's
    // cleanup below.
    const top = stack.pop()
    if (top) {
      top.close()
      return
    }
    // Nothing is open, yet the entry landed on carries our marker: the user moved FORWARD onto the
    // dead entry of an already-closed overlay (a UI close backs past its entry but cannot delete
    // it). Bounce straight back — guarded, so the resulting popstate is swallowed above — instead
    // of parking the user where Back would need two presses. Unreachable under IOS_STANDALONE in
    // the steady state (no entries are ever created there), and left ungated on purpose: it also
    // self-heals entries a pre-Q3 build left in the session history.
    if (event.state?.cgOverlay) {
      ignorePop = true
      window.history.back()
    }
  })
}

function pushOverlay(id: string, close: () => void) {
  if (typeof window === 'undefined' || stack.some((e) => e.id === id)) return
  stack.push({ id, close })
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
  if (!IOS_STANDALONE) window.history.pushState({ cgOverlay: id }, '')
}

function popOverlay(id: string) {
  if (typeof window === 'undefined') return
  const i = stack.findIndex((e) => e.id === id)
  if (i === -1) return // already removed by a real Back press → nothing to undo (avoids over-popping)
  stack.splice(i, 1)
  if (IOS_STANDALONE) return // no entry was pushed for this overlay → no history to unwind
  ignorePop = true
  window.history.back() // remove the one history entry this overlay pushed (its popstate is ignored)
}

// Register `id` as an open overlay while `isOpen` is true; Back (or `popOverlay`) calls `close`.
// `id` must be stable + unique per overlay INSTANCE — use useId() for repeated components (dropdowns).
// `close` is read through a ref so changing its identity each render never re-runs the effect.
export function useBackButton(isOpen: boolean, close: () => void, id: string) {
  // Hold the latest `close` in a ref, updated POST-COMMIT (writing a ref during render trips the
  // React-Compiler-strict react-hooks/refs rule). The registered closure reads it lazily, on Back.
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!isOpen) return
    pushOverlay(id, () => closeRef.current())
    return () => popOverlay(id)
  }, [isOpen, id])
}
