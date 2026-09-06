// CardNumber — the small Q# label at the top-right of the date card, in every mode that has one.
//
// It was the same five lines of markup copied into all five mode screens, each recomputing the
// number inline as `state.stack.length + 1`. That duplication is exactly why the number could be
// wrong in three modes at once: there was no single place to fix. Now the markup AND the number
// live here, and the modes state only WHEN the badge is visible — the one thing that genuinely
// differs between them (four show it while browsing back; AoX also shows it on a finished run's
// summary, where the whole run is being reviewed).
//
// The number itself is the engine's (cardNumber), not this component's: it is a fact about the
// game, it is asserted by the engine's invariants, and the badge must never be able to drift from
// the Score box it sits beside. `absolute` positions it against the card's `relative` centre wrapper
// — the wrapper stays with each mode's date markup, since only the badge is shared.
import type { GameState } from '../engine/gameReducer.js'
import { cardNumber } from '../engine/gameReducer.js'

const CARD_NUMBER_CLASS = 'absolute right-0 top-0 text-[11px] tabular-nums text-(--tx-300-60)'

const CardNumber = ({ state, show }: { state: GameState; show: boolean }) =>
  show ? <span className={CARD_NUMBER_CLASS}>Q{cardNumber(state)}</span> : null

export default CardNumber
