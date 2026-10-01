// tests/engine/blitzBest.test.js — the Blitz Best-record reconcile (the COMPONENT wrapper layer the
// pure-reducer fuzz never sees), tested directly + fuzzed against an independent oracle.
//
// reconcileBlitzBest / reconcileSuddenBest are the exact functions BlitzMode's `timerDone` effect calls,
// so this drives the real wrapper logic — no model, no drift — without the cost of rendering <App/>.
//
// ★ ROUND 23: THE RECORD IS REBUILT FROM THE PRE-ROUND RECORD ON EVERY CALL (like MoX's
// reconcileAoxStanding), and the oracle now checks WHO holds each field, not just the value. The old
// fold took the CURRENT record plus a numeric floor, and when an Override pulled a round back below
// the record it stood on the floor's VALUE with the ROUND'S id — so an earlier round's score came back
// credited to the round that had just lost it, which is a wrong Same Round tag and (now that ★ is
// derived from the id) a wrong ★. The independent oracles, across a session of rounds:
//   • Best Score == the MAX good any round actually reached; its id == the FIRST round to reach it
//     (a later round that only ties does not take the record — strict improvement);
//   • the same pair for Best Streak over each round's streak high-water;
//   • and no record at all while no round has ever scored.
// The end-to-end reachability of the same bugs through the real UI is pinned in blitz.dom.
import { describe, it, expect } from 'vitest'
import { reconcileBlitzBest, reconcileSuddenBest } from '../../src/engine/blitzBest.js'
import { mulberry32 } from '../helpers/rng.js'

// The oracle's holder: the id of the FIRST round whose value equals the max, or null when the max is
// 0 (nothing has ever been set — a 0 is never "a best").
const holder = (values, ids) => {
  const max = Math.max(0, ...values)
  return max === 0 ? null : ids[values.indexOf(max)]
}
// A record as the oracle says it must read — undefined when nothing has ever scored.
const oracleRecord = (goods, hws, ids) => {
  const score = Math.max(0, ...goods)
  const streak = Math.max(0, ...hws)
  if (score === 0 && streak === 0) return undefined
  return {
    score,
    streak,
    scoreRoundId: holder(goods, ids),
    streakRoundId: holder(hws, ids),
  }
}

describe('blitzBest — reconcile unit cases', () => {
  it('records a new high tagged with the round id', () => {
    expect(reconcileBlitzBest(undefined, 3, 2, 11)).toEqual({
      score: 3,
      streak: 2,
      scoreRoundId: 11,
      streakRoundId: 11,
    })
  })
  it('a round that scores nothing leaves NO record behind (not a record of 0)', () => {
    expect(reconcileBlitzBest(undefined, 0, 0, 11)).toBeUndefined()
    expect(reconcileSuddenBest(undefined, 0, 11)).toBeUndefined()
  })
  it('a round overridden back to 0 removes the record it had created', () => {
    // First reconcile: 3. Then the round is overridden down to 0 — the rebuild starts from the
    // pre-round record (none), so the result is "no record", exactly as if the round never scored.
    expect(reconcileBlitzBest(undefined, 3, 3, 11)).toBeDefined()
    expect(reconcileBlitzBest(undefined, 0, 0, 11)).toBeUndefined()
  })
  it('rolls back NO further than the record that stood before the round (the cross-round rollback fix)', () => {
    const pre = { score: 2, streak: 2, scoreRoundId: 10, streakRoundId: 10 }
    expect(reconcileBlitzBest(pre, 3, 3, 11)).toMatchObject({ score: 3, scoreRoundId: 11 })
    expect(reconcileBlitzBest(pre, 0, 0, 11)).toEqual(pre)
  })
  it('★ a rollback hands the record BACK to the round that set it (the round-id bug)', () => {
    // Round 10 set 5/5. Round 11 reached 6/6, then an Override pulled it to 4/4. The old fold left
    // { score: 5, scoreRoundId: 11 } — round 10's score credited to round 11.
    const pre = { score: 5, streak: 5, scoreRoundId: 10, streakRoundId: 10 }
    reconcileBlitzBest(pre, 6, 6, 11)
    expect(reconcileBlitzBest(pre, 4, 4, 11)).toEqual(pre)
    const sudden = { score: 5, roundId: 10 }
    expect(reconcileSuddenBest(sudden, 4, 11)).toEqual(sudden)
  })
  it('the two fields fall back independently — each keeps its OWN holder', () => {
    const pre = { score: 5, streak: 2, scoreRoundId: 10, streakRoundId: 9 }
    // Round 11: score 4 (below), streak 3 (above).
    expect(reconcileBlitzBest(pre, 4, 3, 11)).toEqual({
      score: 5,
      scoreRoundId: 10,
      streak: 3,
      streakRoundId: 11,
    })
  })
  it('a tie does not take the record (the first round to reach a value keeps it)', () => {
    const pre = { score: 5, streak: 5, scoreRoundId: 10, streakRoundId: 10 }
    expect(reconcileBlitzBest(pre, 5, 5, 11)).toEqual(pre)
    expect(reconcileSuddenBest({ score: 5, roundId: 10 }, 5, 11)).toEqual({ score: 5, roundId: 10 })
  })
  it('never mutates the pre-round record it is handed', () => {
    const pre = Object.freeze({ score: 1, streak: 1, scoreRoundId: 10, streakRoundId: 10 })
    expect(() => reconcileBlitzBest(pre, 4, 4, 11)).not.toThrow()
    expect(pre.score).toBe(1)
  })
})

describe('blitzBest — fuzz vs the independent max-round oracle (value AND holder)', () => {
  // Drive the reconcile through random sessions of rounds; after every reconcile assert the record
  // equals the oracle's. roundGoods holds each round's CURRENT good — the last round's is mutable by
  // overrides until the next Begin. `pre` is the record at Begin (prevRoundBestRef), the one thing the
  // component hands the reconcile besides the live stats.
  function runSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best
    const roundGoods = []
    const ids = []
    let sawRollback = false
    for (let r = 0; r < rounds; r++) {
      const roundId = 1000 + r * 7 // distinct, and deliberately NOT a 1-based counter
      const pre = best
      const priorMaxGood = Math.max(0, ...roundGoods)
      const peak = Math.floor(rnd() * 6) // this round reaches 0..5
      roundGoods.push(0)
      ids.push(roundId)
      const i = roundGoods.length - 1
      for (let g = 1; g <= peak; g++) {
        roundGoods[i] = g
        best = reconcileBlitzBest(pre, g, g, roundId) // all-correct round: best-streak tracks good
        expect(best, `seed ${seed} round ${r} +${g}`).toEqual(
          oracleRecord(roundGoods, roundGoods, ids),
        )
      }
      // 0+ override-downs of this round
      let cur = peak
      while (cur > 0 && rnd() < 0.6) {
        cur--
        if (cur < priorMaxGood) sawRollback = true
        roundGoods[i] = cur
        best = reconcileBlitzBest(pre, cur, cur, roundId)
        expect(best, `seed ${seed} round ${r} -> ${cur}`).toEqual(
          oracleRecord(roundGoods, roundGoods, ids),
        )
      }
    }
    return sawRollback
  }

  it('per-round Best equals the oracle across 200 random sessions', () => {
    let sawRollback = false
    for (let seed = 1; seed <= 200; seed++) sawRollback = runSession(seed, 12) || sawRollback
    expect(sawRollback).toBe(true) // the runs actually exercised a below-an-earlier-round rollback
  })

  // Sudden-death (per-question) Best: score only, same independent oracle.
  function runSuddenSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best
    const roundGoods = []
    const ids = []
    const expected = () => {
      const max = Math.max(0, ...roundGoods)
      return max === 0 ? undefined : { score: max, roundId: holder(roundGoods, ids) }
    }
    for (let r = 0; r < rounds; r++) {
      const roundId = 5000 + r * 3
      const pre = best
      const peak = Math.floor(rnd() * 6)
      roundGoods.push(0)
      ids.push(roundId)
      const i = roundGoods.length - 1
      for (let g = 1; g <= peak; g++) {
        roundGoods[i] = g
        best = reconcileSuddenBest(pre, g, roundId)
        expect(best, `sudden seed ${seed} round ${r} +${g}`).toEqual(expected())
      }
      let cur = peak
      while (cur > 0 && rnd() < 0.6) {
        cur--
        roundGoods[i] = cur
        best = reconcileSuddenBest(pre, cur, roundId)
        expect(best, `sudden seed ${seed} round ${r} -> ${cur}`).toEqual(expected())
      }
    }
  }
  it('sudden-death Best equals the oracle across 200 random sessions', () => {
    for (let seed = 1; seed <= 200; seed++) runSuddenSession(seed, 12)
  })

  // The RESUME-REVERT composite (Session 7): a round can provisionally END (the timerDone effect
  // reconciles a Best), then an Override credits the resolved question and RESUMES the round —
  // BlitzMode's resumeRound REVERTS the Best to the pre-round record (prevRoundBestRef), and the round
  // plays on to a higher peak before it RE-ends and reconciles again. Oracle: the record == the one
  // built from every round that has FULLY ended (a resumed round isn't ended, so its in-flight good
  // doesn't count until it re-ends).
  function runResumeSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best
    const endedGoods = [] // the FINAL good of each fully-ended round
    const ids = []
    let sawResume = false
    for (let r = 0; r < rounds; r++) {
      const roundId = 9000 + r
      const pre = best // snapshot at Begin — the revert target AND the rebuild base
      let good = 0
      let ended = false
      while (!ended) {
        good += Math.floor(rnd() * 5) // play a segment; a credit-resume keeps good (it only rises)
        best = reconcileBlitzBest(pre, good, good, roundId) // END this segment
        if (good > 0 && rnd() < 0.5) {
          best = pre // RESUME → revert the Best to the pre-round record; the round plays on
          sawResume = true
        } else {
          ended = true
        }
      }
      endedGoods.push(good)
      ids.push(roundId)
      expect(best, `resume seed ${seed} round ${r}`).toEqual(
        oracleRecord(endedGoods, endedGoods, ids),
      )
    }
    return sawResume
  }
  it('Best survives end→override→resume→re-end cycles across 200 random sessions', () => {
    let sawResume = false
    for (let seed = 1; seed <= 200; seed++) sawResume = runResumeSession(seed, 10) || sawResume
    expect(sawResume).toBe(true) // the runs actually exercised a resume-revert
  })
})

// ── The per-Q + Allow Mistakes map (suddenAmBest) reuses reconcileBlitzBest UNCHANGED ──
// These sessions model the sub-mode's event stream — a clean correct credits good and extends the
// streak, a wrong breaks the streak and burns the question (the retry-correct advances WITHOUT
// credit), a question-clock expiry ends the round — so good and the streak high-water move
// INDEPENDENTLY, unlike the all-correct per-round model above where best === good. The two fields
// have independent oracles (value and holder each), so a per-field regression breaks its own.
describe('blitzBest — per-Q + Allow Mistakes fuzz: two independent oracles', () => {
  function runPerQAmSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best
    const roundGoods = []
    const roundHws = []
    const ids = []
    let sawDivergence = false
    let sawSplitHolders = false
    for (let r = 0; r < rounds; r++) {
      const roundId = 70000 + r * 13
      const pre = best
      let good = 0
      let streak = 0
      let hw = 0
      const questions = Math.floor(rnd() * 10)
      for (let q = 0; q < questions; q++) {
        if (rnd() < 0.65) {
          good++
          streak++
          hw = Math.max(hw, streak)
        } else {
          streak = 0
        }
      }
      if (good !== hw) sawDivergence = true // the two oracles genuinely decouple in these runs
      roundGoods.push(good)
      roundHws.push(hw)
      ids.push(roundId)
      const i = roundGoods.length - 1
      best = reconcileBlitzBest(pre, good, hw, roundId)
      expect(best, `perQ-AM seed ${seed} round ${r}`).toEqual(
        oracleRecord(roundGoods, roundHws, ids),
      )
      // Post-round overrides re-run the reconcile on the shifted engine stats.
      while (rnd() < 0.4) {
        if (rnd() < 0.5 && good > 0) {
          good--
          if (hw > 0 && rnd() < 0.5) hw--
        } else {
          good++
          if (rnd() < 0.5) hw++
        }
        roundGoods[i] = good
        roundHws[i] = hw
        best = reconcileBlitzBest(pre, good, hw, roundId)
        expect(best, `perQ-AM seed ${seed} round ${r} (override)`).toEqual(
          oracleRecord(roundGoods, roundHws, ids),
        )
      }
      if (best && best.scoreRoundId !== best.streakRoundId) sawSplitHolders = true
    }
    return [sawDivergence, sawSplitHolders]
  }
  it('per-Q + AM Best tracks BOTH oracles across 200 random sessions', () => {
    let sawDivergence = false
    let sawSplit = false
    for (let seed = 1; seed <= 200; seed++) {
      const [d, s] = runPerQAmSession(seed, 12)
      sawDivergence ||= d
      sawSplit ||= s
    }
    expect(sawDivergence).toBe(true)
    expect(sawSplit).toBe(true) // a "Different Rounds" record was actually produced
  })

  // The RESUME-REVERT composite for this map: same component machinery (resumeRound reverts to the
  // pre-round record, the timerDone effect rebuilds), reached through its own ends.
  function runPerQAmResumeSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best
    const endedGoods = []
    const endedHws = []
    const ids = []
    let sawResume = false
    for (let r = 0; r < rounds; r++) {
      const roundId = 123000 + r
      const pre = best
      let good = 0
      let streak = 0
      let hw = 0
      let ended = false
      while (!ended) {
        const steps = Math.floor(rnd() * 5)
        for (let s = 0; s < steps; s++) {
          if (rnd() < 0.7) {
            good++
            streak++
            hw = Math.max(hw, streak)
          } else {
            streak = 0
          }
        }
        best = reconcileBlitzBest(pre, good, hw, roundId) // the segment ENDS provisionally
        if ((good > 0 || hw > 0) && rnd() < 0.5) {
          best = pre // Override rescue → resumeRound reverts to the pre-round record
          if (rnd() < 0.8) {
            good++
            streak++
            hw = Math.max(hw, streak)
          }
          sawResume = true
        } else {
          ended = true
        }
      }
      endedGoods.push(good)
      endedHws.push(hw)
      ids.push(roundId)
      const i = endedGoods.length - 1
      expect(best, `perQ-AM resume seed ${seed} round ${r}`).toEqual(
        oracleRecord(endedGoods, endedHws, ids),
      )
      while (good > 0 && rnd() < 0.5) {
        good--
        if (hw > 0 && rnd() < 0.5) hw--
        endedGoods[i] = good
        endedHws[i] = hw
        best = reconcileBlitzBest(pre, good, hw, roundId)
        expect(best, `perQ-AM resume seed ${seed} round ${r} (drop)`).toEqual(
          oracleRecord(endedGoods, endedHws, ids),
        )
      }
    }
    return sawResume
  }
  it('per-Q + AM Best survives end→override→resume→re-end cycles across 200 random sessions', () => {
    let sawResume = false
    for (let seed = 1; seed <= 200; seed++)
      sawResume = runPerQAmResumeSession(seed, 10) || sawResume
    expect(sawResume).toBe(true)
  })
})
