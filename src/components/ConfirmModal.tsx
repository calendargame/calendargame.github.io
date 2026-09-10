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
// #root, the [data-settings-modal] scrim, the a11y contract, Cancel + a rose-tier confirm), and
// pulling it into one component is what keeps all five call sites byte-identical in DOM and
// behaviour and puts the contract in one place instead of five.
//
// THE FIVE MODAL-CONTRACT TERMS (see components/modalContract) — this component owns every one so a
// caller owes nothing but the copy:
//   1. FOCUS ON OPEN — the card is tabIndex={-1} role="dialog" aria-modal, focused by the effect
//      below, so a screen reader announces a modal and the keyboard starts inside it.
//   2. ESCAPE, CAPTURE PHASE — useModalEscape(open, onCancel, false). guardTextEntry is false: a
//      ConfirmModal has no text box, only two buttons.
//   3. ANDROID BACK — useBackButton(open, onCancel, backButtonId). The id must be unique per
//      INSTANCE across the whole app (it keys the open-overlay registry).
//   4. THE TAB TRAP — trapModalTab on the scrim's onKeyDown; Tab cycles Cancel ⇄ confirm and wraps.
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
// defaults to "Reset"; both buttons are `flex-1`.
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
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-xl text-sm font-medium border surface-toggle text-(--tx-100-80)"
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={`flex-1 ${RESET_BTN_CLASS}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('root')!,
  )
}
