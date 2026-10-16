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
// ★ ROUND 26 (Q10): each field also carries its COMPANION — the holder round's other number as it
// FINALLY stood (that round's streak high-water under Best Score, its score under Best Streak), and
// null exactly when there is no holder. The oracle reads it off the same per-round arrays, so a
// post-round Override that moves only the holder's OTHER number must move the companion too.
// The end-to-end reachability of the same bugs through the real UI is pinned in blitz.dom.
import { describe, it, expect } from 'vitest'
import {
  betterBlitzBest,
  reconcileBlitzBest,
  reconcileSuddenBest,
} from '../../src/engine/blitzBest.js'
import { mulberry32 } from '../helpers/rng.js'

// The oracle's holder: the index of the FIRST round whose value equals the max, or -1 when the max
// is 0 (nothing has ever been set — a 0 is never "a best").
const holderAt = (values) => {
  const max = Math.max(0, ...values)
  return max === 0 ? -1 : values.indexOf(max)
}
const holder = (values, ids) => {
  const i = holderAt(values)
  return i < 0 ? null : ids[i]
}
// A record as the oracle says it must read — undefined when nothing has ever scored.
const oracleRecord = (goods, hws, ids) => {
  const score = Math.max(0, ...goods)
  const streak = Math.max(0, ...hws)
  if (score === 0 && streak === 0) return undefined
  const s = holderAt(goods)
  const t = holderAt(hws)
  return {
    score,
    scoreStreak: s < 0 ? null : hws[s],
    scoreRoundId: holder(goods, ids),
    streak,
    streakScore: t < 0 ? null : goods[t],
    streakRoundId: holder(hws, ids),
  }
}
// A record written field by field: [value, companion, holder].
const rec = ([score, scoreStreak, scoreRoundId], [streak, streakScore, streakRoundId]) => ({
  score,
  scoreStreak,
  scoreRoundId,
  streak,
  streakScore,
  streakRoundId,
})

describe('blitzBest — reconcile unit cases', () => {
  it('records a new high tagged with the round id — each field with the round’s other number', () => {
    expect(reconcileBlitzBest(undefined, 3, 2, 11)).toEqual(rec([3, 2, 11], [2, 3, 11]))
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
    const pre = rec([2, 2, 10], [2, 2, 10])
    expect(reconcileBlitzBest(pre, 3, 3, 11)).toMatchObject({ score: 3, scoreRoundId: 11 })
    expect(reconcileBlitzBest(pre, 0, 0, 11)).toEqual(pre)
  })
  it('★ a rollback hands the record BACK to the round that set it (the round-id bug)', () => {
    // Round 10 set 5/5. Round 11 reached 6/6, then an Override pulled it to 4/4. The old fold left
    // { score: 5, scoreRoundId: 11 } — round 10's score credited to round 11.
    const pre = rec([5, 5, 10], [5, 5, 10])
    reconcileBlitzBest(pre, 6, 6, 11)
    expect(reconcileBlitzBest(pre, 4, 4, 11)).toEqual(pre)
    const sudden = { score: 5, roundId: 10 }
    expect(reconcileSuddenBest(sudden, 4, 11)).toEqual(sudden)
  })
  it('the two fields fall back independently — each keeps its OWN holder and companion', () => {
    const pre = rec([5, 2, 10], [2, 4, 9])
    // Round 11: score 4 (below), streak 3 (above).
    expect(reconcileBlitzBest(pre, 4, 3, 11)).toEqual(rec([5, 2, 10], [3, 4, 11]))
  })
  it('a tie does not take the record (the first round to reach a value keeps it, companion too)', () => {
    const pre = rec([5, 5, 10], [5, 5, 10])
    expect(reconcileBlitzBest(pre, 5, 5, 11)).toEqual(pre)
    expect(reconcileSuddenBest({ score: 5, roundId: 10 }, 5, 11)).toEqual({ score: 5, roundId: 10 })
  })
  it('the companion follows the round as it FINALLY stands: an Override that moves only its other number', () => {
    // Round 11 holds Best Streak (6) beside an earlier round's better score; flipping a miss between
    // two short chains raises its score and leaves its streak — so only the companion moves.
    const pre = rec([12, 3, 10], [4, 12, 10])
    expect(reconcileBlitzBest(pre, 9, 6, 11)).toEqual(rec([12, 3, 10], [6, 9, 11]))
    expect(reconcileBlitzBest(pre, 10, 6, 11)).toEqual(rec([12, 3, 10], [6, 10, 11]))
  })
  it('a record from before Round 26 (no companions saved): its fields keep "not recorded"', () => {
    const older = { score: 5, scoreRoundId: 10, streak: 4, streakRoundId: 10 }
    expect(reconcileBlitzBest(older, 3, 2, 11)).toEqual(rec([5, null, 10], [4, null, 10]))
    // …until a round beats a field, which then records its own.
    expect(reconcileBlitzBest(older, 6, 2, 11)).toEqual(rec([6, 2, 11], [4, null, 10]))
  })
  it('never mutates the pre-round record it is handed', () => {
    const pre = Object.freeze(rec([1, 1, 10], [1, 1, 10]))
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

// ── THE TIE CLAUSE (Round 26, review finding F5): two copies of one record that tie on a field AND
// name the same holder are the same round seen at two moments — and `b`, the later sighting, has
// that round's companion as it stands now. store/amnesic merges a stale copy another tab saved
// (`a`) with this page's own (`b`) through exactly this comparison.
describe('betterBlitzBest — the same round seen twice keeps the LATER companion', () => {
  it('a stale copy does not put an older companion back (the F5 case: Best Streak 8, score 10 → 11)', () => {
    const stale = rec([12, 3, 7], [8, 10, 21])
    const now = rec([12, 3, 7], [8, 11, 21])
    expect(betterBlitzBest(stale, now)).toEqual(now)
    expect(betterBlitzBest(stale, rec([12, 5, 7], [8, 10, 21]))).toEqual(
      rec([12, 5, 7], [8, 10, 21]),
    )
  })
  it('a tie between two DIFFERENT rounds keeps the first round’s companion, with its holder', () => {
    const first = rec([12, 3, 7], [8, 10, 21])
    expect(betterBlitzBest(first, rec([12, 9, 30], [8, 14, 30]))).toEqual(first)
  })
  it('no holder is no round: a tie between two holder-less fields is not the same round', () => {
    const a = rec([5, 2, null], [3, 4, null])
    expect(betterBlitzBest(a, rec([5, 9, null], [3, 9, null]))).toEqual(a)
  })
  it('a strict win takes value, companion, and holder; a record with no companion saved gives "not recorded"', () => {
    expect(betterBlitzBest(rec([5, 2, 1], [3, 4, 1]), rec([6, 1, 2], [3, 6, 2]))).toEqual(
      rec([6, 1, 2], [3, 4, 1]),
    )
    const older = { score: 6, scoreRoundId: 2, streak: 3, streakRoundId: 2 }
    expect(betterBlitzBest(rec([5, 2, 1], [3, 4, 1]), older)).toEqual(rec([6, null, 2], [3, 4, 1]))
  })
  it('fuzz: merging any EARLIER copy of a session’s record with the current one keeps the current companions on every same-round tie', () => {
    const rnd = mulberry32(326)
    for (let session = 0; session < 200; session++) {
      const seen = []
      let best
      for (let round = 1; round <= 8; round++) {
        const pre = best
        const id = 4000 + round
        let good = Math.floor(rnd() * 9)
        let hw = Math.floor(rnd() * (good + 1))
        for (let edit = 0; edit < 4; edit++) {
          best = reconcileBlitzBest(pre, good, hw, id)
          if (best) seen.push(best)
          // A post-round Override moves the score by one, and the streak only sometimes.
          good = Math.max(0, good + (rnd() < 0.5 ? -1 : 1))
          hw = Math.min(good, Math.max(0, hw + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0)))
        }
      }
      if (!best) continue
      for (const stale of seen) {
        const merged = betterBlitzBest(stale, best)
        if (
          stale.score === best.score &&
          stale.scoreRoundId === best.scoreRoundId &&
          best.scoreRoundId != null
        )
          expect(merged.scoreStreak).toBe(best.scoreStreak)
        if (
          stale.streak === best.streak &&
          stale.streakRoundId === best.streakRoundId &&
          best.streakRoundId != null
        )
          expect(merged.streakScore).toBe(best.streakScore)
      }
    }
  })
})
