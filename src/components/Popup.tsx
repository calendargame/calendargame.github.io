import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MODAL_DIM_CLASS, MODAL_SCRIM_CLASS, trapModalTab } from './modalContract.js'
import { usePopupLayer } from './overlayStack.js'

// ─────────────────────────────────────────────────────────────────────────
// Popup — the shell every popup in the app is drawn in: the full-screen scrim, and every term of
// the modal contract that is not the card itself (components/modalContract lists them all).
//
// A caller renders it only while its popup is open and hands it the card:
//   {open && <Popup id="changelog" onDismiss={close}><div role="dialog" …>…</div></Popup>}
// The card is the caller's — its text, its buttons, its accessible name — and it must be a
// role="dialog", tabIndex={-1}, aria-modal element, because that is what this shell focuses.
//
// WHAT IT OWNS, so that no popup can skip a term or grow its own version of one:
//   • THE STACK ENTRY (components/overlayStack). Escape and Android Back close the TOP popup only,
//     through `onDismiss`; a popup under another one is left exactly as it was.
//   • THE SCRIM TAP. A tap on the scrim itself (never one that started on the card) is `onDismiss`
//     too — and the top scrim covers the whole screen, so the popup under it cannot be tapped.
//   • ONE DIM, HOWEVER MANY POPUPS ARE OPEN. Only the top popup's scrim paints it, so it always sits
//     directly under the card in front: the page is darkened once, and a popup that has another
//     over it is darkened with the page — it reads as waiting, not as a second live card. It is also
//     why src/main.tsx's status-bar tint is right for any depth: one dim's worth, always.
//   • FOCUS, BOTH WAYS. The top popup holds the keyboard: its dialog is focused when it opens, and
//     again whenever the popup above it closes without handing focus back inside it. On close,
//     focus returns to whatever held it when this popup opened — a control in the popup or the ⚙
//     panel underneath, or the button on the page that opened it — when that is still there to take
//     it. (A text box never is: opening anything blurs it first, overlayStack's keyboard rule, so
//     closing a popup can never put the soft keyboard back up.)
//   • THE TAB TRAP, on the scrim (modalContract's trapModalTab).
//   • THE [data-settings-modal] MARKER, which is how the test suite finds a popup's scrim. Nothing
//     in the app reads it: every "is a popup open?" question is asked of the stack.
//
// PORTALED TO #root, so a popup opened from inside the ⚙ panel escapes that card's clipping and its
// press-drag scope. Each portal is appended when its popup opens, so the newest popup is the last
// child and paints in front — the same order the stack holds.
// ─────────────────────────────────────────────────────────────────────────
export default function Popup({
  id,
  onDismiss,
  children,
}: {
  // Unique per popup INSTANCE across the whole app: it keys the stack entry.
  id: string
  // What Escape, Android Back and a tap on the scrim all call.
  onDismiss: () => void
  children: ReactNode
}) {
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const top = usePopupLayer(onDismiss, id)
  // Hand focus back on close. Declared after the stack entry on purpose: registering takes the
  // keyboard down first, so what is remembered here is never a text box.
  useLayoutEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected)
        opener.focus({ preventScroll: true })
    }
  }, [])
  // Take focus whenever this becomes the top popup and does not already hold it.
  useLayoutEffect(() => {
    const scrim = scrimRef.current
    if (!top || !scrim || scrim.contains(document.activeElement)) return
    scrim.querySelector<HTMLElement>('[role="dialog"]')?.focus()
  }, [top])
  return createPortal(
    <div
      ref={scrimRef}
      data-settings-modal
      role="presentation"
      className={top ? `${MODAL_SCRIM_CLASS} ${MODAL_DIM_CLASS}` : MODAL_SCRIM_CLASS}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
      onKeyDown={trapModalTab}
    >
      {children}
    </div>,
    document.getElementById('root')!,
  )
}
