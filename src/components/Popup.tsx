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
//     selection dragged out of a box, a button press slid off to cancel it) closes nothing, and
//     neither does one that started on the dim and was let go over the card.
//   • ONE DIM, HOWEVER MANY POPUPS ARE OPEN. Only the top popup's scrim paints it, so it always sits
//     directly under the card in front: the page is darkened once, and a popup that has another
//     over it is darkened with the page — it reads as waiting, not as a second live card.
//   • THE STATUS-BAR STRIP, which rides with that one dim: a solid sliver along the very top of the
//     top popup's scrim, in the colour the dimmed page already shows there. It is what the phone's
//     status bar takes its colour from while a popup is up. ★ The whole account — what iOS reads,
//     how that was finally established on a device, and the three attempts that fed it the wrong
//     thing — is the ★★ note above App's theme effect in src/main.tsx. Here it is only two rules:
//     the TOP popup draws it (so there is exactly one, at any depth), and a tap on it is a tap on
//     the dim.
//   • FOCUS, BOTH WAYS. The top popup holds the keyboard: its dialog is focused when it opens, and
//     again whenever the popup above it closes without handing focus back inside it. On close,
//     focus returns to whatever held it when this popup opened — a control in the popup or the ⚙
//     panel underneath, or the button on the page that opened it — when that is still there to take
//     it. (A text box never is: opening anything blurs it first, overlayStack's keyboard rule, so
//     closing a popup can never put the soft keyboard back up.)
//   • …AND IT KEEPS THE KEYBOARD WHILE IT IS ON TOP. Focus that lands anywhere outside the top
//     popup — Tab pressed with nothing focused, which the browser walks into the page behind the
//     dim; a screen behind it focusing itself — is brought straight back to the dialog. So is focus
//     that leaves for NOWHERE, which is what <body> holding it means: a text box in the card that
//     blurs itself when Enter commits it, a press on the dim that is not a tap (a right-click, one
//     let go over the card), a control removed while it had the keyboard.
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
  // Was EITHER END of the press now in progress on the CARD? The click that ends a press is reported
  // on the nearest element containing both ends of it — so a press that began on the card and was
  // released over the dim, and one that began on the dim and was released over the card, both arrive
  // as a click on the scrim, indistinguishable from a tap there by its target alone. The press's own
  // two ends are what tell them apart, so each is noted as it happens — where the press went down,
  // then where it came up — and read (and cleared) by the click.
  //   • Going DOWN starts the note afresh, so a press that never became a click (a scroll, a cancel,
  //     a right-click) cannot disarm the next tap on the dim.
  //   • A TOUCH reports where it came up as where it went down — the browser holds a finger's events
  //     on the element it landed on — so a tap on the dim that wanders a few pixels still ends "on
  //     the dim", and a finger that travels further than a tap is not sent as a click at all.
  const pressOnCardRef = useRef(false)
  // Is this event ON THE DIM — the scrim itself, or the status-bar strip lying along its top edge
  // (which is part of the dim: same colour, and nothing a player could tell apart from it)?
  const isDim = (e: { target: EventTarget; currentTarget: EventTarget }) =>
    e.target === e.currentTarget ||
    (e.target instanceof Element && e.target.hasAttribute('data-status-bar-dim'))
  // ★ KEEP THE KEYBOARD WHILE ON TOP: focus arriving anywhere outside this popup comes back to its
  // dialog. The stack is asked at the moment of the event, not the `top` this render saw: when a
  // second popup opens over this one, it takes focus before React has re-rendered this one as "no
  // longer on top", and a rule read off the render would pull the keyboard back down from it.
  // ⚠ DECLARED BEFORE the hand-back effect below, and the order is load-bearing: cleanups run in
  // declaration order, so on close this listener is gone before focus is handed back to the opener
  // — which is outside the popup, and would otherwise be pulled straight back into a card that is
  // about to be removed.
  // ★ …AND FOCUS THAT GOES NOWHERE COMES BACK TOO. No `focusin` reports that — nothing was focused
  // — so the listener above never hears of it, and the keyboard is left on <body> behind the scrim:
  // outside the Tab trap, with nothing on screen to say where it is. Two things can send it there,
  // and each has its own signal:
  //   • SOMETHING LET GO OF IT — a text box blurring itself, a press on something that cannot hold
  //     focus. That is a `focusout` with no element taking over.
  //   • THE CONTROL THAT HAD IT WAS REMOVED — a tap-to-type readout closing on Escape. Some engines
  //     send a `focusout` for that and some send nothing at all, so the card's own tree is watched.
  // ⚠ NEITHER SIGNAL IS ACTED ON AS IT ARRIVES. Both can arrive while the browser is half-way
  // through handing focus from one control to the next — the box being left blurs, commits and is
  // redrawn before the box being entered has focus — and for that moment nothing holds focus
  // either. Focusing the dialog then CANCELS the hand-over: measured in a real browser, a tap from
  // one text box to another landed on the dialog instead. So a signal only asks for a look once the
  // browser is done (the next task), and the look is at where focus IS:
  //   • ON SOMETHING — a text box, a reorder grip that focused itself, a readout's input focused
  //     as it appeared, a box that kept the keyboard while the WINDOW lost focus — and this stands
  //     aside. It only ever acts when nothing holds focus, so it cannot fight a control for it.
  //   • ON NOTHING, with this popup on top — and the dialog takes it.
  useLayoutEffect(() => {
    const scrim = scrimRef.current
    if (!scrim) return
    const toDialog = () => scrim.querySelector<HTMLElement>('[role="dialog"]')?.focus()
    const keep = (e: FocusEvent) => {
      if (!isTopPopup(id) || !(e.target instanceof Node) || scrim.contains(e.target)) return
      toDialog()
    }
    let look = 0
    const lookWhenSettled = () => {
      window.clearTimeout(look)
      look = window.setTimeout(() => {
        const active = document.activeElement
        if (isTopPopup(id) && (active === null || active === document.body)) toDialog()
      })
    }
    const letGo = (e: FocusEvent) => {
      if (e.relatedTarget === null) lookWhenSettled()
    }
    document.addEventListener('focusin', keep)
    document.addEventListener('focusout', letGo)
    const removals = new MutationObserver(lookWhenSettled)
    removals.observe(scrim, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('focusin', keep)
      document.removeEventListener('focusout', letGo)
      removals.disconnect()
      window.clearTimeout(look)
    }
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
        pressOnCardRef.current = !isDim(e)
      }}
      onPointerUp={(e) => {
        if (!isDim(e)) pressOnCardRef.current = true
      }}
      onClick={(e) => {
        const onCard = pressOnCardRef.current
        pressOnCardRef.current = false
        if (isDim(e) && !onCard) onDismiss()
      }}
      onKeyDown={trapModalTab}
    >
      {top && <div data-status-bar-dim className="status-bar-dim" />}
      {children}
    </div>,
    document.getElementById('root')!,
  )
}
