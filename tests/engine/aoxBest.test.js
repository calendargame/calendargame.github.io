// tests/engine/aoxBest.test.js — C2 Part 1: the AoX Best Mean/Median reconcile (the COMPONENT
// wrapper layer the pure-reducer fuzz never sees), tested directly + fuzzed against an independent
// oracle.
//
// reconcileAoxBest / reconcileAoxStanding are the exact functions AoxMode's reconcile effect calls
// (extracted from main.tsx), driven by the component protocol: when a run completes with Save Stats
// on, AoxMode latches the PRE-run Best as the run's floor and writes reconcileAoxStanding(floor,
// standing stats); every post-completion stats change (a back-browse / retro / live-reversal
// Override retracting or adding a credit on the ended run) re-fires the same write. So this drives
// the real wrapper logic — no model, no drift — without the cost of rendering <App/>. The
// independent oracle: across a session of runs, the Best Mean must always equal the MINIMUM
// average among STANDING runs (recorded, currently holding ≥ n credits, taken at their CURRENT
// stats), the Best Median the minimum median, and each metric's companion stat + run id must come
// from the run that set it — computed by a plain ordered min-scan, no reconcile, no floor. A
// reconcile bug — a fabricated Best standing after its credit was retracted, or a rollback dropping
// below an earlier run — breaks the equality. End-to-end reachability through the real UI is pinned
// by aox.dom batch 9 (back-browse retract, cross-run floor, mid-done key move).
import { describe, it, expect } from 'vitest'
import {
  reconcileAoxBest,
  reconcileAoxStanding,
  aoxBestEqual,
  emptyAoxBest,
} from '../../src/engine/aoxBest.js'
import { calcAvg, calcMed } from '../../src/engine/stats.js'
import { mulberry32 } from '../helpers/rng.js'

describe('aoxBest — reconcile unit cases', () => {
  it('records a new best for both metrics, tagged with the run id', () => {
    const { next, avgImp, medImp } = reconcileAoxBest(emptyAoxBest(), 2.5, 2.0, 7)
    expect(next).toEqual({
      avg: 2.5,
      avgMed: 2.0,
      avgRoundId: 7,
      med: 2.0,
      medAvg: 2.5,
      medRoundId: 7,
    })
    expect(avgImp).toBe(true)
    expect(medImp).toBe(true)
  })

  it('a slower run does not displace either record', () => {
    let cur = reconcileAoxBest(emptyAoxBest(), 2.0, 2.0, 1).next
    const { next, avgImp, medImp } = reconcileAoxBest(cur, 3.0, 3.0, 2) // both slower
    expect(next).toEqual(cur)
    expect(avgImp).toBe(false)
    expect(medImp).toBe(false)
  })

  it('avg improves but median does not: companion stats track each from its own run', () => {
    // Run 1: avg 5, med 2 (the median champion). Run 2: avg 3 (faster avg), med 8 (slower median).
    let cur = reconcileAoxBest(emptyAoxBest(), 5, 2, 1).next
    const { next, avgImp, medImp } = reconcileAoxBest(cur, 3, 8, 2)
    expect(avgImp).toBe(true)
    expect(medImp).toBe(false)
    expect(next).toEqual({
      avg: 3, // run 2's faster average
      avgMed: 8, // run 2's own median travels with it
      avgRoundId: 2,
      med: 2, // run 1 still holds the median record
      medAvg: 5, // run 1's own average travels with it
      medRoundId: 1,
    })
  })

  it('a tie does not displace the earlier record (strict improvement only)', () => {
    let cur = reconcileAoxBest(emptyAoxBest(), 2.0, 2.0, 1).next
    const { next, avgImp, medImp } = reconcileAoxBest(cur, 2.0, 2.0, 2) // exact tie
    expect(avgImp).toBe(false)
    expect(medImp).toBe(false)
    expect(next.avgRoundId).toBe(1)
    expect(next.medRoundId).toBe(1)
  })
})

describe('aoxBest — standing reconcile (the post-completion protocol)', () => {
  it('standing (good ≥ n): the floor improved by the CURRENT avg/median', () => {
    const floor = reconcileAoxBest(emptyAoxBest(), 5, 5, 1).next // an earlier run's record
    const { next, avgImp } = reconcileAoxStanding(floor, 2, 2, [2.0, 4.0], 2)
    expect(avgImp).toBe(true)
    expect(next.avg).toBe(3.0) // (2+4)/2 beats 5
    expect(next.avgRoundId).toBe(2)
  })

  it('not standing (good < n): the floor unchanged — the completion was retracted', () => {
    const floor = reconcileAoxBest(emptyAoxBest(), 5, 5, 1).next
    const { next, avgImp, medImp } = reconcileAoxStanding(floor, 1, 2, [0.1], 2) // 1 credit left of n=2
    expect(next).toEqual(floor) // NOT the (faster) 0.1 — the run no longer stands
    expect(avgImp).toBe(false)
    expect(medImp).toBe(false)
  })

  it('an empty floor + a retracted run stays empty (no fabricated record)', () => {
    const { next } = reconcileAoxStanding(emptyAoxBest(), 1, 2, [0.1], 1)
    expect(next).toEqual(emptyAoxBest())
  })

  it('extra credits (good > n) still stand, at the run’s CURRENT stats', () => {
    // A post-end Override credited a miss: good 3 on an Ao2, times grew — the standing avg moved.
    const { next } = reconcileAoxStanding(emptyAoxBest(), 3, 2, [1.0, 2.0, 6.0], 1)
    expect(next.avg).toBe(3.0)
    expect(next.med).toBe(2.0)
  })

  it('degenerate: no times → no computable stats → the floor unchanged', () => {
    const floor = reconcileAoxBest(emptyAoxBest(), 5, 5, 1).next
    expect(reconcileAoxStanding(floor, 2, 2, [], 2).next).toEqual(floor)
  })

  it('a standing move SLOWER than the floor reverts to the floor (tie keeps the earlier run)', () => {
    const floor = reconcileAoxBest(emptyAoxBest(), 3, 3, 1).next
    // This run recorded 2.0 earlier, then an un-credit removed its fastest time → standing 4.0.
    const { next } = reconcileAoxStanding(floor, 2, 2, [4.0, 4.0], 2)
    expect(next.avg).toBe(3) // the earlier run's record stands; 2.0 no longer exists anywhere
    expect(next.avgRoundId).toBe(1)
  })

  it('aoxBestEqual: field-wise equality', () => {
    const a = reconcileAoxBest(emptyAoxBest(), 2, 3, 1).next
    expect(aoxBestEqual(a, { ...a })).toBe(true)
    expect(aoxBestEqual(a, { ...a, avgRoundId: 9 })).toBe(false)
    expect(aoxBestEqual(emptyAoxBest(), emptyAoxBest())).toBe(true)
  })
})

describe('aoxBest — fuzz vs the independent min-standing-run oracle', () => {
  // Independent oracle: scan the runs in chronological order; among those that RECORDED and
  // currently STAND (good ≥ their n, stats computable), the first to reach a strictly-lower avg
  // holds the Best Mean (+ its own median as avgMed + its run id), likewise for the median.
  // A plain ordered min-scan over each run's CURRENT stats — no reconcile, no floor, no snapshot.
  // (calcAvg/calcMed are shared with the driver deliberately: they're independently unit-tested
  // primitives; the logic under test is the reconcile/floor protocol, not the averaging.)
  function expectedBest(runs) {
    let avg = null,
      avgMed = null,
      avgRoundId = null
    let med = null,
      medAvg = null,
      medRoundId = null
    for (const r of runs) {
      if (!r.recorded || r.good < r.n) continue
      const a = calcAvg(r.times),
        m = calcMed(r.times)
      if (a == null || m == null) continue
      if (avg == null || a < avg) {
        avg = a
        avgMed = m
        avgRoundId = r.rid
      }
      if (med == null || m < med) {
        med = m
        medAvg = a
        medRoundId = r.rid
      }
    }
    return { avg, avgMed, avgRoundId, med, medAvg, medRoundId }
  }

  // Drive the reconcile through random sessions exactly as AoxMode's effect does: a run completes
  // with good = n and 1..n recorded times; if Save Stats is on it LATCHES the pre-run Best as its
  // floor and reconciles; then 0..4 post-end Override edits each retract a credit (sometimes
  // dropping its time) or add one (sometimes pushing a time), re-firing the same reconcile against
  // the SAME floor. An unrecorded run's edits must leave the Best untouched. After every write the
  // store must equal the oracle.
  function runSession(seed, runCount, coverage) {
    const rnd = mulberry32(seed)
    let best = emptyAoxBest()
    const runs = [] // every run's CURRENT {recorded, good, n, times, rid}
    let nextRid = 1
    for (let r = 0; r < runCount; r++) {
      const rid = nextRid++
      const n = 2 + Math.floor(rnd() * 4) // Ao-n, 2..5
      const timeCount = 1 + Math.floor(rnd() * n) // credited solves with recorded times (≤ good)
      const times = Array.from({ length: timeCount }, () => 0.2 + rnd() * 3)
      const recorded = rnd() < 0.85 // global Save Stats at completion
      const run = { recorded, good: n, n, times, rid }
      runs.push(run)
      let floor = null
      if (recorded) {
        floor = { ...best } // the latch: the pre-run Best, taken once
        best = reconcileAoxStanding(floor, run.good, n, run.times, rid).next
        expect(best, `seed ${seed} run ${r} record`).toEqual(expectedBest(runs))
      }
      // Post-end Override edits on the ended run (back-browse Path 1 / retro Path 5 / Path 4).
      const edits = Math.floor(rnd() * 5)
      for (let e = 0; e < edits; e++) {
        if (rnd() < 0.5) {
          // Retract a credit; the entry's contributed time (if it had one) goes with it.
          run.good = Math.max(0, run.good - 1)
          if (run.times.length && rnd() < 0.7)
            run.times.splice(Math.floor(rnd() * run.times.length), 1)
          if (run.recorded && run.good < n) coverage.retractBelowN = true
        } else {
          // Credit a miss; its wrongTime (when tracked) joins the pool.
          run.good += 1
          if (rnd() < 0.7) run.times.push(0.2 + rnd() * 3)
          if (run.recorded && run.good >= n) coverage.postEndImproveChance = true
        }
        if (run.recorded) {
          const prev = best
          best = reconcileAoxStanding(floor, run.good, n, run.times, rid).next
          if (
            !aoxBestEqual(prev, best) &&
            floor.avg != null &&
            aoxBestEqual(best, floor) &&
            run.good < n
          )
            coverage.floorRestore = true
        }
        expect(best, `seed ${seed} run ${r} edit ${e}`).toEqual(expectedBest(runs))
      }
    }
  }

  it('Best avg/median equals the min standing run across 400 random edited sessions', () => {
    const coverage = { retractBelowN: false, postEndImproveChance: false, floorRestore: false }
    for (let seed = 1; seed <= 400; seed++) runSession(seed, 12, coverage)
    // The sessions actually exercised the C2 corners (no vacuous pass):
    expect(coverage.retractBelowN).toBe(true) // a recorded run dropped below n credits
    expect(coverage.floorRestore).toBe(true) // …and the write restored a NON-EMPTY earlier floor
    expect(coverage.postEndImproveChance).toBe(true) // a standing run's stats moved post-end
  })
})
