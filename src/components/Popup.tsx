import { createPortal } from 'react-dom'
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MODAL_DIM_CLASS, MODAL_SCRIM_CLASS } from './modalContract.js'
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
//     selection dragged out of a box, a button press slid off to cancel it) closes nothing, neither
//     does one that started on the dim and was let go over the card — and neither does the press
//     that OPENED the popup, which started before there was a dim to start on.
//   • ONE DIM, HOWEVER MANY POPUPS ARE OPEN. Only the top popup's scrim paints it, so it always sits
//     directly under the card in front: the page is darkened once, and a popup that has another
//     over it is darkened with the page — it reads as waiting, not as a second live card.
//   • THE STATUS-BAR STRIP, which rides with that one dim: a solid sliver along the very top of the
//     top popup's scrim, in the colour the dimmed page already shows there. It is what the phone's
//     status bar takes its colour from while a popup is up. ★ The whole account — what iOS reads,
//     how that was finally established on a device, and the three attempts that fed it the wrong
//     thing — is the ★★ note above App's theme effect in src/main.tsx. Here it is only two rules:
//     the TOP popup draws it (so there is exactly one, at any depth), and a tap on it is a tap on
//     the dim (it takes no pointer events, so the tap lands on the dim itself).
//   • WHERE THE KEYBOARD MAY BE while this is the top popup: inside this scrim, held on its dialog,
//     with Tab walking the scrim's controls. That is all this shell SAYS (the `reach` it registers
//     with); components/overlayStack's "THE KEYBOARD'S REACH" is the one rule that acts on it, the
//     same for a popup, the ⚙ menu and a dropdown list — the dialog takes the keyboard as the popup
//     opens, focus that lands outside comes back, Tab and Shift+Tab wrap, and closing hands the
//     keyboard back to whatever had it (a control in the popup or the ⚙ menu underneath, the
//     button on the page that opened it).
//   • …AND FOCUS THAT LEAVES FOR NOWHERE COMES BACK TO THE DIALOG — the one part that is a
//     popup's alone. <body> holding focus is what "nowhere" means: a text box in the card that
//     blurs itself when Enter commits it, a press on the dim that is not a tap (a right-click, one
//     let go over the card), a control removed while it had the keyboard. Under the ⚙ menu or a
//     list that state is harmless — no key acts from there and the next Tab starts the walk — but
//     a popup is announced as a modal dialog, and a screen reader left on <body> is outside it.
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
  // What Escape, Android Back and a tap on the scrim all call. It may DECLINE, by returning false:
  // the popup then stays open (and after a real Back press takes a new place in the history, so
  // the next Back closes it — components/overlayStack's ★ above useRegistration).
  onDismiss: () => boolean | void
  // This popup belongs to the app, not to a screen or to the ⚙ panel: nothing that changes the
  // screen takes it away (components/overlayStack's isAppWidePopupOpen says what follows from that).
  appWide?: boolean
  children: ReactNode
}) {
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const dialog = () => scrimRef.current?.querySelector<HTMLElement>('[role="dialog"]') ?? null
  const top = usePopupLayer(onDismiss, id, appWide, {
    parts: () => [scrimRef.current],
    hold: dialog,
    walk: () => scrimRef.current,
  })
  // Did the press now in progress GO DOWN ON THIS POPUP'S DIM, and has it stayed off the card since?
  // Only such a press is a tap on the dim, and the click's own target cannot say so:
  //   • The click that ends a press is reported on the nearest element containing both ends of it —
  //     so a press that began on the card and was released over the dim, and one that began on the
  //     dim and was released over the card, both arrive as a click on the scrim.
  //   • ★ AND A PRESS THAT BEGAN BEFORE THIS POPUP WAS ON SCREEN ENDS ON ITS DIM TOO. A popup can open
  //     under a finger that is still down: the ⚙ gear and the top bar's lists act as the press goes
  //     DOWN, and what opens by itself (the storage warning as ⚙ opens, the storage-full notice the
  //     moment a save is refused) is then drawn under that finger. A phone sends the rest of such a
  //     tap — and the click that ends it — to whatever is under the finger NOW, which is this dim.
  //     Read as a tap, it closed the popup some twenty milliseconds after it opened, with "already
  //     shown" written down. That press never went down here, so it is not a tap here: ⚠ the note
  //     starts out as NO, and only a press going down on the dim makes it yes.
  // So each end is noted as it happens — where the press went down, then where it came up — and read
  // (and cleared) by the click.
  //   • Going DOWN starts the note afresh, so a press that never became a click (a scroll, a cancel,
  //     a right-click) cannot arm or disarm the next one.
  //   • A TOUCH reports where it came up as where it went down — the browser holds a finger's events
  //     on the element it landed on — so a tap on the dim that wanders a few pixels still ends "on
  //     the dim".
  // ★ THE DIM IS A CONTROL OF THE PRESS CONTROLLER (lib/pointerGestures — `data-press-surface`, its
  // "A SURFACE IS A CONTROL TOO"), exactly as a button is: a quick tap's click comes from the
  // browser, and a press held or moved about and lifted back on the dim is clicked by the controller
  // at the lift — an iPhone sends no click for one. Either way the click arrives here, after the
  // press's own pointerdown noted it, and is read the same.
  const tapOnDimRef = useRef(false)
  // Is this event ON THE DIM — the scrim's bare self? The status-bar strip lying along its top edge
  // is part of the dim (same colour, and nothing a player could tell apart from it), and it takes no
  // pointer events (index.css), so a press there lands on the scrim itself.
  const isDim = (e: { target: EventTarget; currentTarget: EventTarget }) =>
    e.target === e.currentTarget
  // ★ FOCUS THAT GOES NOWHERE COMES BACK TO THE DIALOG. No `focusin` reports that — nothing was
  // focused — so the stack's own rule never hears of it, and the keyboard is left on <body> behind
  // the scrim, with nothing on screen to say where it is. Two things can send it there, and each
  // has its own signal:
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
  //   • ON NOTHING, with this popup on top — and the dialog takes it. (The stack is asked at that
  //     moment, not the `top` this render saw: a second popup opening over this one takes focus
  //     before React has re-rendered this one as "no longer on top".)
  useLayoutEffect(() => {
    const scrim = scrimRef.current
    if (!scrim) return
    const toDialog = () => scrim.querySelector<HTMLElement>('[role="dialog"]')?.focus()
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
    document.addEventListener('focusout', letGo)
    const removals = new MutationObserver(lookWhenSettled)
    removals.observe(scrim, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('focusout', letGo)
      removals.disconnect()
      window.clearTimeout(look)
    }
  }, [id])
  return createPortal(
    <div
      ref={scrimRef}
      data-settings-modal
      data-press-surface
      role="presentation"
      className={top ? `${MODAL_SCRIM_CLASS} ${MODAL_DIM_CLASS}` : MODAL_SCRIM_CLASS}
      onPointerDown={(e) => {
        tapOnDimRef.current = isDim(e)
      }}
      onPointerUp={(e) => {
        if (!isDim(e)) tapOnDimRef.current = false
      }}
      onClick={(e) => {
        const tap = tapOnDimRef.current
        tapOnDimRef.current = false
        if (isDim(e) && tap) onDismiss()
      }}
    >
      {top && <div data-status-bar-dim className="status-bar-dim" />}
      {children}
    </div>,
    document.getElementById('root')!,
  )
}
