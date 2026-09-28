import type { BlitzBest } from '../store/progress.js'
import { isNewBest } from '../engine/roundId.js'
import { NewBestStar } from './primitives.jsx'

// BlitzBestRow — the two-field Best Score / Best Streak row with ★ new-best flags and the
// Same Round / Different Rounds tag, shared by the two BlitzBest-shaped records: per-round
// (blitzBest) and per-question + Allow Mistakes (suddenAmBest, C3a). The tag renders only
// once BOTH round ids exist: same id = one exceptional round set both, different = two
// strong ones. (Per-question sudden death keeps its own score-only row — different shape.)
// Each ★ is DERIVED, never stored: a field is starred exactly when the round on screen (`roundId`,
// null when there is none) is the round that set it — engine/roundId's isNewBest, the one rule MoX
// uses too (round 23 Q4).
function BlitzBestRow({ rec, roundId }: { rec?: BlitzBest; roundId: number | null }) {
  const showTag = rec && rec.scoreRoundId != null && rec.streakRoundId != null
  return (
    <div className="mt-3 text-xs text-(--tx-300-60)">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[125px]">
          Best Score: {rec?.score ?? '—'}
          {isNewBest(rec?.scoreRoundId, roundId) && <NewBestStar />}
        </div>
        <div className="min-w-[125px]">
          Best Streak: {rec?.streak ?? '—'}
          {isNewBest(rec?.streakRoundId, roundId) && <NewBestStar />}
        </div>
        {showTag && (
          <span className="shrink-0 ml-auto">
            {rec.scoreRoundId === rec.streakRoundId ? 'Same Round' : 'Different Rounds'}
          </span>
        )}
      </div>
    </div>
  )
}

export default BlitzBestRow
