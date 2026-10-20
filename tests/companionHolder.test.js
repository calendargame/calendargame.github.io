// companionHolder — A COMPANION IS ITS HOLDER'S, OR UNKNOWN (design-q1-q2.md v5, 4.1; the review lane's
// (c)). This build writes, beside each companion in the doc, the id of the round it belongs to
// (store/bestRecords' fromRec, `…Of`); a reader believes a companion only when that id is the field's holder
// (engine/blitzBest's companionOf - the door's reader and the screen's alike). v2.26.0 SPREADS a record when
// one of its rounds beats a field, keeping the old holder's companion, and its id, beside the new holder.
import { describe, it, expect } from 'vitest'
import { toRec, fromRec } from '../src/store/bestRecords.js'
import { bestOfBlitz, bestOfAox } from '../src/engine/bestPool.js'
import { COUNTER_ROUND_ID } from '../src/store/syncRecords.js'

const A = COUNTER_ROUND_ID + 100 // a round this build played
const B = COUNTER_ROUND_ID + 200 // a round a v2.26.0 tab played
const written = fromRec(
  'blitzBest',
  toRec(
    'blitzBest',
    { score: 9, scoreStreak: 4, scoreRoundId: A, streak: 6, streakScore: 7, streakRoundId: A },
    'load',
    'k',
  ),
  true,
  true,
)

describe('the doc writes each companion beside its holder, and a reader believes it only there', () => {
  it('this build writes the holder id beside each companion (the doc only - the store is told what it believes)', () => {
    expect(written).toMatchObject({ scoreStreakOf: A, streakScoreOf: A })
    const forStore = fromRec('blitzBest', toRec('blitzBest', written, 'load', 'k'), false)
    expect(forStore).not.toHaveProperty('scoreStreakOf')
  })

  it('a v2.26.0 spread keeps the old companion beside a new holder: unknown, to the door and to the screen', () => {
    // (its round B beat Best Score: { ...cur, score, scoreRoundId })
    const spread = { ...written, score: 11, scoreRoundId: B }
    const rec = toRec('blitzBest', spread, 'load', 'k')
    expect(rec.f.score).toMatchObject({ v: 11, id: B, c: null })
    expect(rec.f.streak).toMatchObject({ v: 6, id: A, c: 7 }) // the untouched field's is still its own
    const shown = bestOfBlitz([spread])
    expect(shown.scoreStreak).toBeNull()
    expect(shown.streakScore).toBe(7)
  })

  it('a record with no holder id beside its companion (an older build’s fresh one) is believed as written', () => {
    const fresh = {
      score: 5,
      scoreStreak: 3,
      scoreRoundId: B,
      streak: 3,
      streakScore: 5,
      streakRoundId: B,
    }
    expect(toRec('blitzBest', fresh, 'load', 'k').f.score.c).toBe(3)
    expect(bestOfBlitz([fresh]).scoreStreak).toBe(3)
  })

  it('MoX the same: the mean’s median and the median’s mean', () => {
    const run = { avg: 2.5, avgMed: 2.4, avgRoundId: A, med: 2.4, medAvg: 2.5, medRoundId: A }
    const doc = fromRec('aoxBest', toRec('aoxBest', run, 'load', 'k'), true, true)
    expect(doc).toMatchObject({ avgMedOf: A, medAvgOf: A })
    const spread = { ...doc, avg: 2.1, avgRoundId: B }
    expect(toRec('aoxBest', spread, 'load', 'k').f.avg.c).toBeNull()
    expect(bestOfAox([spread]).avgMed).toBeNull()
    expect(bestOfAox([spread]).medAvg).toBe(2.5)
  })
})
