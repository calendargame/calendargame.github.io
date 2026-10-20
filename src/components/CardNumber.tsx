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

// The number's type, shared with its sizer so the room kept for it is set exactly as it is. On the
// root's scale, pinned to a standard phone (Round 26 review): 11px at the 16.458px root of a 390×844
// iPhone, where it was tuned, and the same share of the root everywhere else — it was a fixed 11px,
// so on a small screen's 12px root it stood larger than the text round the card, and on a large one
// smaller. (tests/textSizeGuard: no text size in pixels.)
const CARD_NUMBER_TYPE = 'text-[calc(11rem/16.458)] tabular-nums'
const CARD_NUMBER_CLASS = `absolute right-0 top-0 ${CARD_NUMBER_TYPE} text-(--tx-300-60)`

// ★ THE CORNER IS KEPT FOR AS MANY DIGITS AS THE COUNT HAS NOW (the owner's ruling; components/DateLine
// keeps the date out of it, by the same inset on both sides). The room is CardNumberSizer: "Q" and a run
// of each digit `digits` long, one per line, invisible and of no height, in the number's own type — as wide
// as the widest of them in the device's font, so as wide as any number of that many digits. `digits` is
// the digit count of the HIGHEST number the badge can show now (gameReducer's topCardNumber), so the
// number never needs more room than it has, and the date stays as large as it can be: it gives a little
// only at the moment the count gains a digit (Q9 to Q10, Q99 to Q100), and never from one question to the
// next otherwise. (Where the date would not reach the corner anyway - a card wider than the widest date
// and its corner - keeping it costs the date nothing: it is drawn at full size, centred, either way.)
const sizerText = (digits: number) =>
  [...'0123456789'].map((d) => `Q${d.repeat(digits)}`).join('\n')

export const CardNumberSizer = ({ digits }: { digits: number }) => (
  <span
    aria-hidden
    className={`${CARD_NUMBER_TYPE} h-0 overflow-clip invisible whitespace-pre text-left`}
  >
    {sizerText(digits)}
  </span>
)

const CardNumber = ({ state, show }: { state: GameState; show: boolean }) => {
  if (!show) return null
  return <span className={CARD_NUMBER_CLASS}>Q{cardNumber(state)}</span>
}

export default CardNumber
