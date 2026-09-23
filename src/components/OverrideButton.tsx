import { useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// OverrideButton — the Override ⇄ Undo control at the end of every mode's action row (round 23 Q6).
//
// ONE BUTTON, ONE PRESS, AND THE CARD DECIDES WHAT IT MEANS. Every scored date remembers how you
// answered it plus whether it has been overridden, so the button simply reads the date it points at
// (the live one, the one you have browsed to, or the one you just finished): it says Undo when that
// date is currently overridden and Override when it is not, and a press flips it the other way.
// There is no "used it once" state left anywhere — the same date can be toggled as many times as
// the player likes, today or after browsing back to it tomorrow.
//
// `avail` is false in one situation only: there is genuinely no date to point at (a fresh mode with
// no history behind it — or, in the casual modes, Save Stats off for the date on screen). The word
// follows `overridden`; the two are computed together from the engine's one selector
// (engine/useGameEngine → gameReducer's overridePlan), so the label can never disagree with the flip.
//
// It was the same markup in all five mode screens; the toggle would have made it the same five
// ternaries too, so the markup, the label rule and the inert rule live here and each mode supplies
// only its handler (a timed mode's handler also carries the round/run half of the flip).
// `data-key="O"` stays on the one element: App's keyboard handler clicks whatever the button
// currently is, so the O key follows the label for free.
//
// ── ⚠⚠ THE DOUBLE-TAP GUARD, AND WHY A TOGGLE NEEDS ONE THAT A ONE-SHOT BUTTON DID NOT ────────
//
// A double-tap on this button used to be harmless: the first tap overrode, the second landed on a
// control that had just gone inert, and nothing happened. Now the second tap lands on UNDO — so one
// double-tap overrides and takes it straight back, with a flicker of the other label in between,
// leaving the player believing the button does nothing. Nothing is lost (tap again and it overrides)
// but on a phone a quick second contact is ordinary, while "undo what I did a tenth of a second ago"
// is not — so the fast one is read as the accident it almost always is, and ignored.
//
// ★ A PRESS INSIDE A SHORT WINDOW OF THE LAST ACCEPTED ONE IS IGNORED, IN BOTH DIRECTIONS.
// Symmetric because the hazard is: Override→Undo and Undo→Override are the same two taps in the
// other order, and a rule that covered one of them would be a rule nobody could state.
// ★ 350 ms, AND THE NUMBER IS THE PLATFORM'S RATHER THAN A TASTE: WebKit and Blink both treat two
// taps inside ~300 ms as one double-tap gesture, so 300 is the shortest window that covers what the
// device itself calls a double tap; the extra 50 covers the frame the new label needs to be painted
// before anyone could have read it. It is far under any deliberate second press — you have to SEE
// the button say Undo before choosing to press it — so the toggle stays as unlimited as Q6 promised.
//
// ⚠ IT GUARDS TAPS AND CLICKS ONLY — NOT THE KEYBOARD, and that is a decision, not an oversight. A
// press arrives here from three places: a finger or mouse; the O shortcut (src/main.tsx clicks this
// element by its `data-key`); and assistive technology. Only the first can be an accident of
// physical contact. The keyboard route is already safe from the repeat case — App's handler drops
// every `e.repeat` keydown — and a person who presses O twice on purpose means it both times, with
// no gesture in between to mistake it for. Guarding that would be adding a delay to a route that
// never had the problem.
// ⚠ TWO SIGNALS SAY "A FINGER OR A MOUSE DID THIS", and the second is not belt-and-braces, it is the
// platform-independent one. `detail` is the click COUNT the browser attaches to a pointer-driven
// click (0 for a programmatic .click() and for keyboard activation), which is the direct answer —
// but it is one engine's convention away from being wrong, and a guard that silently stops guarding
// is the worst failure this could have. So a recent pointerdown ON THIS BUTTON counts too: every
// real tap or click fires one, no keyboard or programmatic activation ever does. The window for it
// is generous (a press can be held), and it is harmless if it lingers — the only thing it can do is
// make the NEXT press eligible for a guard that still requires two presses inside 350 ms.
// ⚠ performance.now(), not Date.now(): a monotonic clock cannot be dragged by the device's own clock
// changing under a long session, and it is the clock the rest of this app times play with.
const DOUBLE_PRESS_MS = 350
const POINTER_PRESS_MS = 1000

const OverrideButton = ({
  avail,
  overridden,
  onToggle,
}: {
  avail: boolean
  overridden: boolean
  onToggle: () => void
}) => {
  // The last press this button ACTED on, and the last pointerdown it saw. −Infinity so the first
  // press of a mount is never inside either window, however long the page has been open.
  const lastPressRef = useRef(-Infinity)
  const lastPointerRef = useRef(-Infinity)
  const press = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const now = performance.now()
    const fromPointer = e.detail > 0 || now - lastPointerRef.current < POINTER_PRESS_MS
    if (fromPointer && now - lastPressRef.current < DOUBLE_PRESS_MS) return
    lastPressRef.current = now
    onToggle()
  }
  return (
    <button
      type="button"
      data-key="O"
      className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${avail ? '' : 'opacity-60 pointer-events-none'}`}
      onPointerDown={() => {
        lastPointerRef.current = performance.now()
      }}
      onClick={press}
    >
      {overridden ? 'Undo' : 'Override'}
    </button>
  )
}

export default OverrideButton
