import type { BlitzBest } from '../store/progress.js'
import { companion } from '../engine/blitzBest.js'
import { isNewBest } from '../engine/roundId.js'
import { EM_DASH } from '../lib/modeFormat.js'
import { NewBestStar } from './primitives.jsx'
import { BestColumn, BestLine, BestSubLine } from './BestReadout.jsx'

// BlitzBestRow — the two-field Best Score / Best Streak row with ★ new-best flags and the
// Same Round / Different Rounds tag, shared by the two BlitzBest-shaped records: per-round
// (blitzBest) and per-question + Allow Mistakes (suddenAmBest). The tag renders only
// once BOTH round ids exist: same id = one exceptional round set both, different = two
// strong ones. (Per-question sudden death keeps its own score-only row — different shape.) The tag
// is given the longer wording's room and is left out where the line has none — BestLine says how.
// Each ★ is DERIVED, never stored: a field is starred exactly when the round on screen (`roundId`,
// null when there is none) is the round that set it — engine/roundId's isNewBest, the one rule MoX
// uses too (round 23).
// The row it sits in — and whether it is marked as the session's — is components/BestReadout,
// which components/StatPanel renders round whatever a mode hands it as `bests`.
// ★ THE SMALL LINES (Round 26, Q10, like MoX's): under Best Score, that round's best streak; under
// Best Streak, that round's score (engine/blitzBest's companions). So whether one round set both can
// be read on any screen, including the narrow ones the tag is left off: when each small line matches
// the other Best, one round set both. A Best from before Round 26 recorded no companion, and shows
// the dash until it is beaten — read out as "not recorded", never guessed. Always drawn, record or
// not, so the row is one height whatever it holds.
function BlitzBestRow({ rec, roundId }: { rec?: BlitzBest; roundId: number | null }) {
  const showTag = rec && rec.scoreRoundId != null && rec.streakRoundId != null
  return (
    <BestLine
      tag={
        showTag
          ? {
              wording: rec.scoreRoundId === rec.streakRoundId ? 'Same Round' : 'Different Rounds',
              longest: 'Different Rounds',
            }
          : null
      }
    >
      <BestColumn>
        <div>
          Best Score: {rec?.score ?? EM_DASH}
          {isNewBest(rec?.scoreRoundId, roundId) && <NewBestStar />}
        </div>
        <BestSubLine>Streak: {companionText(rec, rec?.scoreStreak)}</BestSubLine>
      </BestColumn>
      <BestColumn>
        <div>
          Best Streak: {rec?.streak ?? EM_DASH}
          {isNewBest(rec?.streakRoundId, roundId) && <NewBestStar />}
        </div>
        <BestSubLine>Score: {companionText(rec, rec?.streakScore)}</BestSubLine>
      </BestColumn>
    </BestLine>
  )
}

// A small line's value: the number, or the dash — with no record (as the Best above it reads), or for a
// record that did not record this companion, which a screen reader hears as "not recorded".
function companionText(rec: BlitzBest | undefined, value: unknown) {
  const n = companion(value)
  if (n !== null) return n
  if (!rec) return EM_DASH
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">not recorded</span>
    </>
  )
}

export default BlitzBestRow
