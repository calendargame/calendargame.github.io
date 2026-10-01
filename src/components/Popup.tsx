import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MODAL_DIM_CLASS, MODAL_SCRIM_CLASS, trapModalTab } from './modalContract.js'
import { isTopPopup, usePopupLayer } from './overlayStack.js'

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
//   • THE SCRIM TAP. A tap on the scrim itself is `onDismiss` too — and the top scrim covers the
//     whole screen, so the popup under it cannot be tapped. A tap is a press that both STARTS and
//     ENDS on the scrim: a press that started on the card and was let go over the dim (a text
//     selection dragged out of a box, a button press slid off to cancel it) closes nothing.
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
//   • …AND IT KEEPS THE KEYBOARD WHILE IT IS ON TOP. Focus that lands anywhere outside the top
//     popup — Tab pressed with nothing focused, which the browser walks into the page behind the
//     dim; a screen behind it focusing itself — is brought straight back to the dialog.
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
  appWide = false,
  children,
}: {
  // Unique per popup INSTANCE across the whole app: it keys the stack entry.
  id: string
  // What Escape, Android Back and a tap on the scrim all call.
  onDismiss: () => void
  // This popup belongs to the app, not to a screen or to the ⚙ panel: nothing that changes the
  // screen takes it away (components/overlayStack's isAppWidePopupOpen says what follows from that).
  appWide?: boolean
  children: ReactNode
}) {
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const top = usePopupLayer(onDismiss, id, appWide)
  // Did the press now in progress start on the CARD? The click that ends a press is reported on the
  // nearest element containing both ends of it — so a press that began on the card and was released
  // over the dim arrives as a click on the scrim, indistinguishable from a tap there by its target
  // alone. The press's own start is what tells them apart, so it is noted as the press goes down
  // and read (and cleared) by the click.
  const pressBeganOnCardRef = useRef(false)
  // ★ KEEP THE KEYBOARD WHILE ON TOP: focus arriving anywhere outside this popup comes back to its
  // dialog. The stack is asked at the moment of the event, not the `top` this render saw: when a
  // second popup opens over this one, it takes focus before React has re-rendered this one as "no
  // longer on top", and a rule read off the render would pull the keyboard back down from it.
  // ⚠ DECLARED BEFORE the hand-back effect below, and the order is load-bearing: cleanups run in
  // declaration order, so on close this listener is gone before focus is handed back to the opener
  // — which is outside the popup, and would otherwise be pulled straight back into a card that is
  // about to be removed.
  useLayoutEffect(() => {
    const keep = (e: FocusEvent) => {
      const scrim = scrimRef.current
      if (!scrim || !isTopPopup(id) || !(e.target instanceof Node) || scrim.contains(e.target))
        return
      scrim.querySelector<HTMLElement>('[role="dialog"]')?.focus()
    }
    document.addEventListener('focusin', keep)
    return () => document.removeEventListener('focusin', keep)
  }, [id])
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
      onPointerDown={(e) => {
        pressBeganOnCardRef.current = e.target !== e.currentTarget
      }}
      onClick={(e) => {
        const beganOnCard = pressBeganOnCardRef.current
        pressBeganOnCardRef.current = false
        if (e.target === e.currentTarget && !beganOnCard) onDismiss()
      }}
      onKeyDown={trapModalTab}
    >
      {children}
    </div>,
    document.getElementById('root')!,
  )
}
