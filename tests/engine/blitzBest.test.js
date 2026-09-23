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
import { mulberry32 } from '../helpers/rng.js'

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

  // The RESUME-REVERT composite (Session-7 Q2-A): a round can provisionally END (the timerDone effect
  // reconciles a Best), then an Override credits the resolved question and RESUMES the round — BlitzMode's
  // resumeRound REVERTS the Best to the pre-round snapshot (prevRoundBestRef), and the round plays on to a
  // higher peak before it RE-ends and reconciles again. This models that exact sequence at the pure-fn
  // level (the component state machine itself is pinned by blitz.dom:402-502) against the same independent
  // oracle: Best == the max good of every round that has FULLY ended (a resumed round isn't ended, so its
  // in-flight good doesn't count until it re-ends). reconcile uses cur = the post-revert (pre-round) Best
  // and fallback = the pre-round floor — exactly what resumeRound + the timerDone effect pass. (E.)
  function runResumeSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best = { score: 0, streak: 0, scoreRoundId: null, streakRoundId: null }
    const endedGoods = [] // the FINAL good of each fully-ended round
    let nextId = 1
    let sawResume = false
    for (let r = 0; r < rounds; r++) {
      const roundId = nextId++
      const preRound = { ...best } // snapshot at Begin — the revert target AND the reconcile floor
      const fallback = { score: preRound.score, streak: preRound.streak }
      let good = 0
      let ended = false
      while (!ended) {
        good += Math.floor(rnd() * 5) // play a segment; a credit-resume keeps good (it only rises)
        best = reconcileBlitzBest(best, good, good, roundId, fallback) // END this segment
        if (good > 0 && rnd() < 0.5) {
          best = { ...preRound } // RESUME → revert the Best to the pre-round snapshot; the round plays on
          sawResume = true
        } else {
          ended = true
        }
      }
      endedGoods.push(good)
      const trueMax = Math.max(0, ...endedGoods)
      expect(best.score, `resume seed ${seed} round ${r}: score`).toBe(trueMax)
      expect(best.streak, `resume seed ${seed} round ${r}: streak`).toBe(trueMax)
    }
    return sawResume
  }
  it('Best survives end→override→resume→re-end cycles across 200 random sessions', () => {
    let sawResume = false
    for (let seed = 1; seed <= 200; seed++) sawResume = runResumeSession(seed, 10) || sawResume
    expect(sawResume).toBe(true) // the runs actually exercised a resume-revert
  })
})

// ── C3a (Q15): the per-Q + Allow Mistakes map (suddenAmBest) reuses reconcileBlitzBest UNCHANGED ──
// These sessions model the NEW sub-mode's event stream — a clean correct credits good and extends
// the streak, a wrong breaks the streak and burns the question (the retry-correct advances WITHOUT
// credit), a question-clock expiry ends the round (played isn't reconciled) — so good and the
// streak high-water move INDEPENDENTLY, unlike the all-correct per-round model above where
// best === good. TWO independent oracles: Best Score == the max good any round reached, Best
// Streak == the max streak high-water any round reached; a reconcile bug on either FIELD (the maps
// share the reconcile, so a per-field regression is the realistic failure) breaks its equality.
describe('blitzBest — per-Q + Allow Mistakes fuzz (C3a): two independent oracles', () => {
  // Like runSession above: only the LAST round is override-mutable (the component re-runs the
  // reconcile on post-round overrides until the next Begin), and fallback = the Best standing at
  // Begin (prevRoundBestRef) = the max over all prior rounds.
  function runPerQAmSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best = { score: 0, streak: 0, scoreRoundId: null, streakRoundId: null }
    const roundGoods = []
    const roundHws = []
    let nextId = 1
    let sawDivergence = false
    for (let r = 0; r < rounds; r++) {
      const roundId = nextId++
      const fallback = {
        score: roundGoods.length ? Math.max(...roundGoods) : 0,
        streak: roundHws.length ? Math.max(...roundHws) : 0,
      }
      // Play the round: clean corrects and wrongs (a wrong = streak break + an uncredited
      // retry-correct advance) until the clock takes a question.
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
      const i = roundGoods.length - 1
      best = reconcileBlitzBest(best, good, hw, roundId, fallback)
      expect(best.score, `perQ-AM seed ${seed} round ${r}: score`).toBe(Math.max(...roundGoods))
      expect(best.streak, `perQ-AM seed ${seed} round ${r}: streak`).toBe(Math.max(...roundHws))
      // Post-round overrides re-run the reconcile on the shifted engine stats: a credit raises
      // good (a burned question judged right — the streak recompute can extend the high-water),
      // a flip drops it (and can drop the recomputed high-water).
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
        best = reconcileBlitzBest(best, good, hw, roundId, fallback)
        expect(best.score, `perQ-AM seed ${seed} round ${r} (override): score`).toBe(
          Math.max(...roundGoods),
        )
        expect(best.streak, `perQ-AM seed ${seed} round ${r} (override): streak`).toBe(
          Math.max(...roundHws),
        )
      }
    }
    return sawDivergence
  }
  it('per-Q + AM Best tracks BOTH oracles across 200 random sessions', () => {
    let sawDivergence = false
    for (let seed = 1; seed <= 200; seed++)
      sawDivergence = runPerQAmSession(seed, 12) || sawDivergence
    expect(sawDivergence).toBe(true)
  })

  // The RESUME-REVERT composite for the NEW map — the component machinery is shared with
  // per-round (resumeRound reverts to the pre-round snapshot, the timerDone effect re-reconciles),
  // but per-Q + AM reaches it through its own ends (Reveal / Show Codes / a timeout on a burned
  // question) and its rescue credits the resolved live question. Same independent oracles as
  // above over rounds that have FULLY ended, plus post-end override-downs that must never pull
  // either field below the pre-round fallback floor (the floor is inside the oracle: prior
  // rounds' values never drop).
  function runPerQAmResumeSession(seed, rounds) {
    const rnd = mulberry32(seed)
    let best = { score: 0, streak: 0, scoreRoundId: null, streakRoundId: null }
    const endedGoods = []
    const endedHws = []
    let nextId = 1
    let sawResume = false
    for (let r = 0; r < rounds; r++) {
      const roundId = nextId++
      const preRound = { ...best } // snapshot at Begin — the revert target AND the reconcile floor
      const fallback = { score: preRound.score, streak: preRound.streak }
      let good = 0
      let streak = 0
      let hw = 0
      let ended = false
      while (!ended) {
        const steps = Math.floor(rnd() * 5) // play a segment: corrects with occasional wrongs
        for (let s = 0; s < steps; s++) {
          if (rnd() < 0.7) {
            good++
            streak++
            hw = Math.max(hw, streak)
          } else {
            streak = 0
          }
        }
        best = reconcileBlitzBest(best, good, hw, roundId, fallback) // the segment ENDS provisionally
        if ((good > 0 || hw > 0) && rnd() < 0.5) {
          best = { ...preRound } // Override rescue → resumeRound reverts to the pre-round snapshot
          if (rnd() < 0.8) {
            good++ // the rescue credited the resolved live question (which extends the streak too)
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
      const i = endedGoods.length - 1
      expect(best.score, `perQ-AM resume seed ${seed} round ${r}: score`).toBe(
        Math.max(0, ...endedGoods),
      )
      expect(best.streak, `perQ-AM resume seed ${seed} round ${r}: streak`).toBe(
        Math.max(0, ...endedHws),
      )
      // Post-end override-downs on the just-ended round: the oracle (prior rounds stand) proves
      // the same-round rollback never falls below the pre-round floor.
      while (good > 0 && rnd() < 0.5) {
        good--
        if (hw > 0 && rnd() < 0.5) hw--
        endedGoods[i] = good
        endedHws[i] = hw
        best = reconcileBlitzBest(best, good, hw, roundId, fallback)
        expect(best.score, `perQ-AM resume seed ${seed} round ${r} (drop): score`).toBe(
          Math.max(0, ...endedGoods),
        )
        expect(best.streak, `perQ-AM resume seed ${seed} round ${r} (drop): streak`).toBe(
          Math.max(0, ...endedHws),
        )
      }
    }
    return sawResume
  }
  it('per-Q + AM Best survives end→override→resume→re-end cycles across 200 random sessions', () => {
    let sawResume = false
    for (let seed = 1; seed <= 200; seed++)
      sawResume = runPerQAmResumeSession(seed, 10) || sawResume
    expect(sawResume).toBe(true) // the runs actually exercised a resume-revert
  })
})
