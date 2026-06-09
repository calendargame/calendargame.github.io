// tests/engine/blitzBest.test.js — C2 Part 2: the Blitz Best-record reconcile (the COMPONENT wrapper
// layer the pure-reducer fuzz never sees), tested directly + fuzzed against an independent oracle.
//
// reconcileBlitzBest / reconcileSuddenBest are the exact functions BlitzMode's `timerDone` effect calls
// (extracted from main.tsx), so this drives the real wrapper logic — no model, no drift — without the
// cost of rendering <App/>. The independent oracle: across a session of rounds (each reaching a peak
// good, then possibly overridden DOWN), the Best Score must always equal the MAX good any round
// actually reached. A reconcile/rollback bug — fabricating a Best, or (the C2 bug) dropping it below an
// earlier round when a later round is overridden down — breaks that equality. The end-to-end
// reachability of the same bug through the real UI is pinned by blitz.dom "Best Score cross-round
// rollback".
import { describe, it, expect } from 'vitest'
import { reconcileBlitzBest, reconcileSuddenBest } from '../../src/engine/blitzBest.js'

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('blitzBest — reconcile unit cases', () => {
  const EMPTY = { score: 0, streak: 0, scoreRoundId: null, streakRoundId: null }
  it('records a new high tagged with the round id', () => {
    const b = reconcileBlitzBest(EMPTY, 3, 2, 1, { score: 0, streak: 0 })
    expect(b).toMatchObject({ score: 3, streak: 2, scoreRoundId: 1, streakRoundId: 1 })
  })
  it('rolls a round back to its own dropped score when no earlier round stands', () => {
    let b = reconcileBlitzBest(EMPTY, 3, 3, 1, { score: 0, streak: 0 }) // round 1 → 3
    b = reconcileBlitzBest(b, 1, 1, 1, { score: 0, streak: 0 }) // round 1 overridden down to 1
    expect(b.score).toBe(1)
  })
  it('rolls back NO further than an earlier round (the C2 fix)', () => {
    // Round 1 reached 2; round 2 reached 3 (overwriting the record); round 2 is overridden down to 0.
    let b = reconcileBlitzBest(EMPTY, 2, 2, 1, { score: 0, streak: 0 }) // round 1 → 2
    b = reconcileBlitzBest(b, 3, 3, 2, { score: 2, streak: 2 }) // round 2 → 3 (fallback = round 1's 2)
    b = reconcileBlitzBest(b, 0, 0, 2, { score: 2, streak: 2 }) // round 2 overridden to 0
    expect(b.score).toBe(2) // NOT 0 — round 1's 2 still stands
    expect(b.streak).toBe(2)
  })
  it('a different round cannot roll back the current best', () => {
    let b = reconcileBlitzBest(EMPTY, 5, 5, 1, { score: 0, streak: 0 }) // round 1 → 5
    // round 2 reaches only 2; it must not touch round 1's best of 5
    b = reconcileBlitzBest(b, 2, 2, 2, { score: 5, streak: 5 })
    expect(b.score).toBe(5)
  })
})

describe('blitzBest — fuzz vs the independent max-round-good oracle', () => {
  // Drive the reconcile through random sessions of rounds; after every reconcile assert Best == the max
  // good any round actually reached (Best Streak == max engine-best). roundGoods holds each round's
  // CURRENT good — the last round's is mutable by overrides until the next Begin.
  function runSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best = { score: 0, streak: 0, scoreRoundId: null, streakRoundId: null }
    const roundGoods = []
    const roundBests = []
    let nextId = 1
    let sawRollback = false
    for (let r = 0; r < rounds; r++) {
      const roundId = nextId++
      const priorMaxGood = roundGoods.length ? Math.max(...roundGoods) : 0
      const priorMaxBest = roundBests.length ? Math.max(...roundBests) : 0
      const fallback = { score: priorMaxGood, streak: priorMaxBest }
      const peak = Math.floor(rnd() * 6) // this round reaches 0..5
      roundGoods.push(0)
      roundBests.push(0)
      const i = roundGoods.length - 1
      for (let g = 1; g <= peak; g++) {
        roundGoods[i] = g
        roundBests[i] = g // all-correct round: engine best-streak tracks good
        best = reconcileBlitzBest(best, g, g, roundId, fallback)
      }
      // 0+ override-downs of this round
      let cur = peak
      while (cur > 0 && rnd() < 0.6) {
        cur--
        if (cur < priorMaxGood) sawRollback = true
        roundGoods[i] = cur
        roundBests[i] = cur
        best = reconcileBlitzBest(best, cur, cur, roundId, fallback)
      }
      const trueMaxGood = Math.max(...roundGoods)
      const trueMaxBest = Math.max(...roundBests)
      expect(best.score, `seed ${seed} round ${r}: score`).toBe(trueMaxGood)
      expect(best.streak, `seed ${seed} round ${r}: streak`).toBe(trueMaxBest)
    }
    return sawRollback
  }

  it('per-round Best equals the max round good across 200 random sessions', () => {
    let sawRollback = false
    for (let seed = 1; seed <= 200; seed++) sawRollback = runSession(seed, 12) || sawRollback
    expect(sawRollback).toBe(true) // the runs actually exercised a below-an-earlier-round rollback
  })

  // Sudden-death (per-question) Best: score only, same independent oracle.
  function runSuddenSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best = { score: 0, roundId: null }
    const roundGoods = []
    let nextId = 1
    for (let r = 0; r < rounds; r++) {
      const roundId = nextId++
      const fallback = roundGoods.length ? Math.max(...roundGoods) : 0
      const peak = Math.floor(rnd() * 6)
      roundGoods.push(0)
      const i = roundGoods.length - 1
      for (let g = 1; g <= peak; g++) {
        roundGoods[i] = g
        best = reconcileSuddenBest(best, g, roundId, fallback)
      }
      let cur = peak
      while (cur > 0 && rnd() < 0.6) {
        cur--
        roundGoods[i] = cur
        best = reconcileSuddenBest(best, cur, roundId, fallback)
      }
      expect(best.score, `sudden seed ${seed} round ${r}`).toBe(Math.max(...roundGoods))
    }
  }
  it('sudden-death Best equals the max round good across 200 random sessions', () => {
    for (let seed = 1; seed <= 200; seed++) runSuddenSession(seed, 12)
  })
})
