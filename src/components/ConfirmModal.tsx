import type { ReactNode } from 'react'
import Popup from './Popup.js'
import { MODAL_CARD_SHADOW, MODAL_PLAIN_CARD_CLASS } from './modalContract.js'
import { RESET_BTN_CLASS } from './controlClasses.js'

// ─────────────────────────────────────────────────────────────────────────
// ConfirmModal — the ONE shape every reset-style confirmation in the app wears.
//
// The owner rejected the split the app had grown — some reset actions asked with a popup, some with
// a two-tap in-place arm. Every one of them is a ConfirmModal now: Full Reset, Reset Settings, each
// casual mode's Reset Stats, Clear Saved Defaults, and the "Enable and Reset Stats?" desync case.
// (Deleting a preset is the sole exception: its question is a second VIEW of the Manage Presets card
// rather than a popup over it — components/PresetManager says why that reads better there.)
//
// It is a title, a body and one button inside components/Popup, which owns the scrim and every
// shared term of the popup contract (components/modalContract) — so a caller owes nothing but the
// copy, and every call site is identical in DOM and behaviour.
//
// ★★ THERE IS NO CANCEL BUTTON — ONE BUTTON ON THE CARD, AND IT IS THE DESTRUCTIVE ONE.
// The owner's words: "you can just tap outside or press esc so it's just a noise button." The
// purely-informational popups (the Changelog, the resting defaults manager, the run breakdown) had
// already lost their standalone Close on exactly that argument; a Cancel here was doing nothing the
// scrim tap, Escape and Android Back do not already do, while spending the widest, most reachable
// control on the card to say "never mind".
// ⚠ `onCancel` IS NOT GOING ANYWHERE, and the prop name is still the honest one: it is what those
// three routes call, and dismissing this card HAS a meaning — the destructive act does not happen.
// Only the visible button went.
//
// ★ RENDERED ALWAYS-MOUNTED, DRAWS NOTHING WHILE CLOSED. Callers write `<ConfirmModal open={x} …/>`
// unconditionally; the Popup inside exists only while `open`, and it is the Popup that is the stack
// entry, so a closed confirmation costs nothing and registers nothing.
//
// `id` names the popup in the app's stack of open things and must be unique per INSTANCE across the
// whole app; the title's element id is derived from it. `body` is a ReactNode so a caller can pass
// a plain string or marked-up prose; it renders in the --tx-200-80 text tier. The confirm button
// wears RESET_BTN_CLASS — the rose fill every destructive control in the app wears — and
// `confirmLabel` defaults to "Reset". It is `w-full` in a plain `pt-1` row, NOT a `flex-1` child of
// a flex row: a one-child flex row is machinery that renders the same thing. The pt-1 is the extra
// breath between the prose and the action, on top of the card's own space-y-3.
// ─────────────────────────────────────────────────────────────────────────
export default function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel = 'Reset',
  id,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
  body: ReactNode
  confirmLabel?: string
  id: string
}) {
  if (!open) return null
  const titleId = `${id}-confirm-title`
  return (
    <Popup id={id} onDismiss={onCancel}>
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={MODAL_CARD_SHADOW}
        className={MODAL_PLAIN_CARD_CLASS}
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
    </Popup>
  )
}
