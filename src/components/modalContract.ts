import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// ─────────────────────────────────────────────────────────────────────────
// components/modalContract — what it takes to be a POPUP in this app, in one place.
//
// The app has one popup idiom and its users are: the ⚙ Settings popups (Save Defaults, the defaults
// manager, the Changelog, Manage Presets), the run breakdown that the MoX/Blitz stat strip opens on
// a finished run, the storage-full notice, and the shared components/ConfirmModal that every
// reset-style confirmation reuses (Full Reset, Reset Settings, Clear Saved Defaults, each casual
// mode's Reset Stats, and the "Enable and Reset Stats?" desync case). Every one of them is a card
// inside components/Popup, and Popup is where the contract is kept — so a popup cannot skip a term
// or keep its own copy of one.
//
// THE CONTRACT:
//   1. THE CARD is role="dialog", tabIndex={-1}, aria-modal="true" and named by aria-labelledby.
//      This is the one term a caller writes: the card is its own.
//   2. FOCUS — the top popup holds the keyboard from the moment it opens, so a screen reader
//      announces a modal and Tab starts inside it; closing it hands focus back to where it was.
//   3. ESCAPE, ANDROID BACK AND A TAP ON THE SCRIM each dismiss the TOP popup and nothing under it.
//      Escape and Back are components/overlayStack's, the app's one stack of open things.
//   4. THE TAB TRAP — trapModalTab below, on the scrim, so Tab cycles the popup's own controls and
//      wraps at the ends instead of walking into the page underneath.
//   5. ONE DIM — only the top popup's scrim darkens the page, however many are open.
// What an open popup blocks beyond that — the keyboard shortcuts that reach into the page under
// the scrim, and which ones are deliberately left live — is src/main.tsx's keydown handler's to
// say, and it asks the stack.
// ─────────────────────────────────────────────────────────────────────────

// The scrim: full-screen, above everything, centring its card. components/Popup is its only user.
export const MODAL_SCRIM_CLASS = 'fixed inset-0 z-[60] flex items-center justify-center px-4'
// The dim, worn by the TOP popup's scrim alone (term 5).
export const MODAL_DIM_CLASS = 'bg-black/40'
// The card: the popover's own surface language, py-4 only — horizontal padding belongs to the rows
// and to any inner scroll region, so the scroller's right padding is the text-free lane the iOS
// overlay scrollbar paints in (components/scrollRegion). focus:outline-hidden because term 2 focuses
// it programmatically and a focus ring on a whole dialog is noise, not information.
export const MODAL_CARD_CLASS =
  'card rounded-2xl py-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden'
// The same card for a popup with no inner scroll region — the confirmations and the storage-full
// notice: padded all round, since there is no scrollbar lane to keep clear.
export const MODAL_PLAIN_CARD_CLASS =
  'card rounded-2xl p-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden'
// The card's elevation. An inline style rather than a class because that is how the popups have
// always spelled it; sharing the literal is the point.
export const MODAL_CARD_SHADOW = { boxShadow: '0 0 8px rgba(0,0,0,0.12)' } as const

// Term 4 — the focus trap. Goes on the SCRIM's onKeyDown, so it sees every Tab inside the popup.
// Plain Tab / Shift+Tab traverse natively in the middle and WRAP at the ends; focus never escapes to
// the page under the scrim. Two degenerate cases, both handled:
//   • ONE control — first === last, so Tab wraps in place.
//   • ZERO controls — the run breakdown, the Changelog popup and the storage-full notice are cards
//     whose only content is text. There is nothing to cycle, so the press is consumed and focus is
//     pinned on the dialog card itself (it is tabIndex={-1} and was focused on open) rather than
//     allowed to walk out to the page under the scrim.
// "Controls" are everything Tab can land on: buttons, inputs, and an element made a tab stop by
// hand (the preset manager's reorder grip is a div with tabIndex={0}).
// stopPropagation keeps the press from the app-wide Tab shortcut (which would open the mode selector
// behind the popup); that shortcut's own handler also bails while a popup is open, for presses that
// start outside this tree.
export const trapModalTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'Tab') return
  e.stopPropagation()
  const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]'))
  if (f.length === 0) {
    const card = e.currentTarget.querySelector<HTMLElement>('[role="dialog"]')
    if (card) {
      e.preventDefault()
      card.focus()
    }
    return
  }
  const first = f[0],
    last = f[f.length - 1],
    ae = document.activeElement
  if (e.shiftKey) {
    if (ae === first || !e.currentTarget.contains(ae)) {
      e.preventDefault()
      last.focus()
    }
  } else if (ae === last || !e.currentTarget.contains(ae)) {
    e.preventDefault()
    first.focus()
  }
}
