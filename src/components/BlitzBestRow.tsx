import type { BlitzBest } from '../store/progress.js'
import { isNewBest } from '../engine/roundId.js'
import { NewBestStar } from './primitives.jsx'
import { BestColumn, BestLine } from './BestReadout.jsx'

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
        Best Score: {rec?.score ?? '—'}
        {isNewBest(rec?.scoreRoundId, roundId) && <NewBestStar />}
      </BestColumn>
      <BestColumn>
        Best Streak: {rec?.streak ?? '—'}
        {isNewBest(rec?.streakRoundId, roundId) && <NewBestStar />}
      </BestColumn>
    </BestLine>
  )
}

export default BlitzBestRow
