// @vitest-environment jsdom
//
// blitzBest.olderBuilds — WHAT THE OLDER BUILDS ON THIS ORIGIN DO TO A BLITZ BEST AS ROUND 26 SAVES IT.
//
// Round 26 (Q10) gives each field of a Blitz Best its COMPANION — the holder round's other number
// (engine/blitzBest) — with no version bump, so v2.28.0, v2.29.0, and v2.29.2, which share this
// origin with this build, read and write the same records. They know a record as four fields. The
// rule this build holds them to: a companion they leave behind may be MISSING (this build then
// shows the dash, "not recorded"), never WRONG (a number that is not the holder round's).
// ★ THAT WAS RUN, NOT READ. tests/fixtures/olderBuilds/blitzBest-<build>.json is what the real app
// at each build (v2.28.0 389ebd1, v2.29.0 a54b9f1, v2.29.2 d3fd051) did when
// blitzBestDrive.dom.test.jsx.txt drove it over records and a parked round in this build's shapes.
// Round ids in the records are the builds' own (time-based), so they are compared by role, not
// by value.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { companion, reconcileBlitzBest } from '../src/engine/blitzBest.js'
import { useProgress } from '../src/store/progress.js'

const recorded = (build) =>
  JSON.parse(
    readFileSync(resolve(__dirname, `fixtures/olderBuilds/blitzBest-${build}.json`), 'utf8'),
  )
// The record the driver seeded: Best Score 5 (round 111, streak 3), Best Streak 4 (round 222,
// score 2).
const SEEDED = {
  score: 5,
  scoreStreak: 3,
  scoreRoundId: 111,
  streak: 4,
  streakScore: 2,
  streakRoundId: 222,
}
const hasCompanions = (rec) => 'scoreStreak' in rec || 'streakScore' in rec

describe.each(['v2.28.0', 'v2.29.0', 'v2.29.2'])('%s, as the real build behaved', (build) => {
  const seen = recorded(build)

  it('(i) a save that does not change the record keeps it whole, companions included', () => {
    expect(seen.classicAnswer.played).toBe(1) // the answer was saved…
    expect(seen.classicAnswer.record).toEqual(SEEDED) // …and the record with it, untouched
    expect(seen.roundBelow.score).toBe('1/2') // a round that beat neither field…
    expect(seen.roundBelow.record).toEqual(SEEDED) // …left it as it was
  })

  it('(ii) a round that takes a field writes four fields: BOTH companions go missing, never wrong', () => {
    const { score, record } = seen.takesScore
    expect(score).toBe('6/8')
    expect(record).toMatchObject({ score: 6, streak: 4, streakRoundId: 222 })
    expect(record.scoreRoundId).not.toBe(111)
    expect(hasCompanions(record)).toBe(false)
    // …which this build reads as "not recorded", and a round here records them again.
    expect([companion(record.scoreStreak), companion(record.streakScore)]).toEqual([null, null])
    const next = reconcileBlitzBest(record, 7, 2, 900)
    expect(next).toMatchObject({ score: 7, scoreStreak: 2, scoreRoundId: 900, streakScore: null })
  })

  it('(iii) an Override that hands the field back: four fields again — missing, never wrong', () => {
    const { score, record } = seen.handsBack
    expect(score).toBe('5/8')
    expect(record).toEqual({ score: 5, scoreRoundId: 111, streak: 4, streakRoundId: 222 })
  })

  // (iv) THE ONE WAY AN OLDER BUILD MAKES A COMPANION WRONG, and why this build stamps the rounds it
  // parks. A tab keeps its session when it moves between the test site and the live one, so an older
  // build can restore an ended round this build parked. The round holds Best Streak only; an Override
  // on a card behind the live one raises its score (5 → 6) and leaves its four older fields standing,
  // and the older build's own write compares only those four — so it keeps the companion that says 5.
  it('(iv) unstamped, the older build restores this build’s round and leaves a WRONG companion', () => {
    const { before, score, record, parkLeft } = seen.asParkedUnstamped
    expect(before.restored).toBe(true)
    expect(before.record.streakScore).toBe(5)
    expect(score).toBe('6/8') // the holder round's score is now 6…
    expect(record.streakRoundId).toBe(before.record.streakRoundId) // …it still holds Best Streak…
    expect(record.streakScore).toBe(5) // …and its companion still says 5: wrong
    expect(parkLeft).toBe(true)
  })

  it('(iv) stamped as this build parks it, the older build declines the round: the record stands', () => {
    const { before, begin, record, parkLeft } = seen.asParkedStamped
    expect(before.restored).toBe(false) // the screen came up idle…
    expect(begin).toBe(true)
    expect(parkLeft).toBe(false) // …and dropped the park, as it drops any round it cannot restore
    expect(record).toEqual(before.record) // the record this build saved, companions and all
    expect(record.streakScore).toBe(5)
  })
})

describe('this build', () => {
  it('keeps the progress envelope at version 5 — nothing about the companions is a migration', () => {
    expect(useProgress.persist.getOptions().version).toBe(5)
  })
})
