import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  MODAL_SCRIM_CLASS,
  MODAL_CARD_SHADOW,
  trapModalTab,
  useModalEscape,
} from './modalContract.js'
import { useBackButton } from './useBackButton.js'
import { RESET_BTN_CLASS } from './controlClasses.js'

// ─────────────────────────────────────────────────────────────────────────
// ConfirmModal — the ONE shape every reset-style confirmation in the app now wears (Round 21, Q7).
//
// The owner rejected the split the app had grown — some reset actions asked with a popup, some with
// a two-tap in-place arm. Every one of them is a ConfirmModal now: Full Reset, Reset Settings, each
// casual mode's Reset Stats, Clear Saved Defaults, and the "Enable and Reset Stats?" desync case.
// (Deleting a preset is the sole exception and stays an in-card view-swap — it lives INSIDE the
// Manage Presets modal, and modalContract's per-modal document-level Escape listener cannot safely
// stack two simultaneous modals; components/PresetManager argues that at length.)
//
// It is the Clear-Saved-Defaults popup generalised: that popup was the template (createPortal to
// #root, the [data-settings-modal] scrim, the a11y contract, a rose-tier confirm), and pulling it
// into one component is what keeps all five call sites byte-identical in DOM and behaviour and puts
// the contract in one place instead of five.
//
// ★★ THERE IS NO CANCEL BUTTON, AS OF Q2 — ONE BUTTON ON THE CARD, AND IT IS THE DESTRUCTIVE ONE.
// The owner's words: "you can just tap outside or press esc so it's just a noise button." Round 21
// had already taken the standalone Close off every purely-informational popup (the Changelog, the
// resting defaults manager, the run breakdown) on exactly that argument; this finishes it for the
// confirm-style popups, where Cancel was doing nothing the scrim tap, Escape and Android Back do not
// already do — three dismiss routes this component OWNS and a fourth (the hardware Back stack) it
// registers. So a button that duplicated all four was spending the widest, most reachable control on
// the card to say "never mind".
// ⚠ `onCancel` IS NOT GOING ANYWHERE, and the prop name is still the honest one: it is what those
// three routes call, and dismissing this card HAS a meaning — the destructive act does not happen.
// Only the visible button went.
//
// THE FIVE MODAL-CONTRACT TERMS (see components/modalContract) — this component owns every one so a
// caller owes nothing but the copy:
//   1. FOCUS ON OPEN — the card is tabIndex={-1} role="dialog" aria-modal, focused by the effect
//      below, so a screen reader announces a modal and the keyboard starts inside it.
//   2. ESCAPE, CAPTURE PHASE — useModalEscape(open, onCancel, false). guardTextEntry is false: a
//      ConfirmModal has no text box, only the one button.
//   3. ANDROID BACK — useBackButton(open, onCancel, backButtonId). The id must be unique per
//      INSTANCE across the whole app (it keys the open-overlay registry).
//   4. THE TAB TRAP — trapModalTab on the scrim's onKeyDown. With one button the card lands on that
//      helper's ONE-CONTROL branch (first === last), so Tab wraps in place and the press is consumed
//      rather than walking out to the page under the scrim.
//   5. [data-settings-modal] ON THE SCRIM — the marker main.tsx reads to know a modal is up (the
//      status-bar scrim, the click-outside carve-out, the app-wide Tab shortcut's bail).
//
// ★ RENDERED ALWAYS-MOUNTED, RETURNS null WHILE CLOSED. Callers write `<ConfirmModal open={x} …/>`
// unconditionally so the hooks above keep a stable order; the portal itself only exists while
// `open`. The three modal-contract hooks each no-op internally when `open` is false, so calling
// them before the early return is free.
//
// The card geometry is the Clear popup's verbatim — `card rounded-2xl p-4 w-full max-w-[20rem]`
// (full padding, no inner scroll region, unlike MODAL_CARD_CLASS's py-4 scroller cards) plus
// MODAL_CARD_SHADOW. `body` is a ReactNode so a caller can pass a plain string or marked-up prose;
// it renders in the --tx-200-80 text tier the Clear popup used. The confirm button wears
// RESET_BTN_CLASS — the rose fill every destructive control in the app wears — and `confirmLabel`
// defaults to "Reset". It is `w-full` in a plain `pt-1` row, NOT a `flex-1` child of a flex row: the
// flex wrapper and the gap existed to divide the row between two buttons, and a one-child flex row
// is machinery that renders the same thing. The pt-1 stays — it is the extra breath between the
// prose and the action, on top of the card's own space-y-3, and it is unrelated to the pairing.
// ─────────────────────────────────────────────────────────────────────────
export default function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel = 'Reset',
  backButtonId,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
  body: ReactNode
  confirmLabel?: string
  backButtonId: string
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const titleId = `${backButtonId}-confirm-title`
  useEffect(() => {
    if (open) cardRef.current?.focus()
  }, [open])
  useModalEscape(open, onCancel, false)
  useBackButton(open, onCancel, backButtonId)
  if (!open) return null
  return createPortal(
    <div
      data-settings-modal
      role="presentation"
      className={MODAL_SCRIM_CLASS}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={trapModalTab}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={MODAL_CARD_SHADOW}
        className="card rounded-2xl p-4 w-full max-w-[20rem] space-y-3 focus:outline-hidden"
      >
        <div id={titleId} className="text-sm font-semibold text-(--tx-50)">
          {title}
        </div>
        <div className="text-xs text-(--tx-200-80)">{body}</div>
        <div className="pt-1">
          <button type="button" onClick={onConfirm} className={`w-full ${RESET_BTN_CLASS}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('root')!,
  )
}
