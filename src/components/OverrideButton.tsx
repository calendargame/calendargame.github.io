// OverrideButton — the Override ⇄ Undo control at the end of every mode's action row (round 23 Q6).
//
// ONE BUTTON, TWO MEANINGS, AND IT CAN ONLY EVER MEAN ONE. Where an Override used to leave the button
// greyed out, it now reads Undo and puts back exactly what that Override changed; then it reads
// Override again, as many times as the player likes. The two can never be offered at once: the
// engine's `overrideAvail` is already false in every state an Override leaves behind (see
// engine/useGameEngine — and the fuzz asserts it every step), which is precisely where `undoAvail`
// is true. So the label follows `undoAvail`, and the button is inert only when neither is available.
//
// It was the same markup in all five mode screens; the toggle would have made it the same five
// ternaries too, so the markup, the label rule and the inert rule live here and each mode supplies
// only its two handlers (a timed mode's handlers also carry the round/run half of the reversal).
// `data-key="O"` stays on the one element: App's keyboard handler clicks whatever the button
// currently is, so the O key follows the label for free.
const OverrideButton = ({
  overrideAvail,
  undoAvail,
  onOverride,
  onUndo,
}: {
  overrideAvail: boolean
  undoAvail: boolean
  onOverride: () => void
  onUndo: () => void
}) => (
  <button
    type="button"
    data-key="O"
    className={`col-span-1 px-3 py-2 rounded-xl border surface-button text-sm font-medium text-center ${undoAvail || overrideAvail ? '' : 'opacity-60 pointer-events-none'}`}
    onClick={undoAvail ? onUndo : onOverride}
  >
    {undoAvail ? 'Undo' : 'Override'}
  </button>
)

export default OverrideButton
