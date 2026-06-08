import { useEffect, useRef } from 'react'

// Back-button manager for dismissable overlays (Q1 — Android hardware Back).
//
// Android (and any browser) always has a Back affordance; with no history handling, Back EXITS the
// whole app even when an overlay (the mode menu, ⚙ Settings, Show Codes, How-to-Play) is open —
// instead of just closing that overlay. iOS standalone has no system Back, so this only bites Android,
// but the fix is universal + harmless everywhere (desktop Back already works via real history).
//
// How it works: each open overlay pushes ONE history entry. Pressing Back fires `popstate`, which
// closes the TOP-most overlay (the browser already popped its entry). Closing an overlay via the UI
// instead removes its entry with a guarded `history.back()`, so the history stays in lockstep with
// what's actually open. When nothing is open, Back does its normal thing (leaves the app). A single
// module-level popstate listener drives a LIFO stack, so nested overlays close one at a time,
// newest-first.

type Entry = { id: string; close: () => void }
const stack: Entry[] = []
let ignorePop = false
let installed = false

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', () => {
    if (ignorePop) {
      ignorePop = false // this popstate came from our own history.back() in popOverlay — not a real Back
      return
    }
    // A real Back press: close the top-most overlay. The browser already popped its history entry, and
    // popping it from the stack HERE means the overlay's effect-cleanup popOverlay() finds it gone and
    // does NOT call history.back() again (which would over-pop). See useBackButton's cleanup below.
    const top = stack.pop()
    if (top) top.close()
  })
}

function pushOverlay(id: string, close: () => void) {
  install()
  if (typeof window === 'undefined' || stack.some((e) => e.id === id)) return
  stack.push({ id, close })
  window.history.pushState({ cgOverlay: id }, '')
}

function popOverlay(id: string) {
  if (typeof window === 'undefined') return
  const i = stack.findIndex((e) => e.id === id)
  if (i === -1) return // already removed by a real Back press → nothing to undo (avoids over-popping)
  stack.splice(i, 1)
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
