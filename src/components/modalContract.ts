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
//   4. TAB CYCLES the popup's own controls and wraps at the ends instead of walking into the page
//      underneath. A popup with NO control — the run breakdown, the Changelog and the storage-full
//      notice are text only — keeps the keyboard on its dialog card.
//   5. ONE DIM — only the top popup's scrim darkens the page, however many are open.
// Terms 2, 3 (Escape, Back) and 4 are not a popup's own: they are components/overlayStack's, the
// app's one stack of open things, and the keyboard half ("THE KEYBOARD'S REACH" there) is the same
// rule for a popup, the ⚙ menu and a dropdown list. What an open popup leaves live — the mode
// letters, H and G — is src/main.tsx's keydown handler's to say, and it asks the stack.
// ─────────────────────────────────────────────────────────────────────────

// The scrim: full-screen, above everything, centring its card. components/Popup is its only user.
export const MODAL_SCRIM_CLASS = 'fixed inset-0 z-[60] flex items-center justify-center px-4'
// The dim, worn by the TOP popup's scrim alone (term 5).
export const MODAL_DIM_CLASS = 'bg-black/40'
// The card: the popover's own surface language — its fill and border (.card), and the FLOATING
// shadow every surface that floats above the page wears (.float-shadow, index.css's three shadow
// roles). py-4 only — horizontal padding belongs to the rows and to any inner scroll region, so
// the scroller's right padding is the text-free lane the iOS overlay scrollbar paints in
// (components/scrollRegion). It draws no focus ring although term 2 focuses it — a ring on a whole
// dialog is noise, not information; index.css's keyboard-ring rule leaves a role="dialog" out by
// name.
export const MODAL_CARD_CLASS = 'card float-shadow rounded-2xl py-4 w-full max-w-[20rem] space-y-3'
// The same card for a popup with no inner scroll region — the confirmations and the storage-full
// notice: padded all round, since there is no scrollbar lane to keep clear.
export const MODAL_PLAIN_CARD_CLASS =
  'card float-shadow rounded-2xl p-4 w-full max-w-[20rem] space-y-3'
