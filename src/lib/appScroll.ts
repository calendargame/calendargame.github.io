// lib/appScroll — THE ONE DOOR FOR EVERY SCROLL THE APP MAKES ITSELF.
//
// WHY A DOOR. lib/pointerGestures treats a touch during which something holding the pressed control
// scrolled as a scroll, and presses nothing (its header's ★ "a touch that scrolled anything"). That
// rule is about the PERSON's finger: iOS can end a touch that scrolled an inner region in a plain
// pointerup on the very control it began on. A scroll the APP makes while a finger rests on a control
// — How to Play's opening glide, the guide's scroll back as a section closes, the Shift+Tab rest under
// the bar (lib/barLine), a list keeping its selected row in view, a screen sent back to the top — is
// not the person scrolling, and must never cost them the press. So every scroll position the app
// writes goes through here, and the controller is told the moment it lands: it takes the box's new
// place as where that box "stood at the press", so only movement the app did NOT make counts.
// tests/appScrollGuard keeps every write in src here (a raw `scrollTop =`, `scrollTo(`, `scrollBy(`,
// or `scrollIntoView(` anywhere else fails the suite).
//
// Synchronous by construction: a write moves the box at once, and the listener re-reads the box at
// once, inside the same call — so there is no frame in which the app's move can be mistaken for the
// finger's. (A browser reports the scroll EVENT a frame later; that is pointerGestures' movedSince.)

type Listener = (box: Element) => void
const listeners = new Set<Listener>()

// Subscribe to the app's own scrolls. Returns the unsubscribe. (pointerGestures, once per install.)
export function onAppScroll(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const told = (box: Element) => {
  for (const fn of listeners) fn(box)
}

// Put `box`'s vertical scroll at `top` (the browser clamps it to what the box can scroll).
export function scrollBoxTo(box: Element, top: number): void {
  box.scrollTop = top
  told(box)
}

// Send the window itself back to its top-left corner (the page's own scroller, which in this app never
// scrolls by design — a reset that makes sure of it).
export function scrollWindowHome(): void {
  window.scrollTo(0, 0)
  told(document.scrollingElement ?? document.documentElement)
}
