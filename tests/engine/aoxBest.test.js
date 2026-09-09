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
// from the run that set it — computed by a plain ordered min-scan, no reconcile, no floor. The
// comparison (and the stored value) is at DISPLAY precision — rounded to hundredths, exactly what
// fmtTime prints — not raw float, because that's the whole fix this file exists to pin: a raw `<`
// used to plant a ★ on a difference no player could ever see (BUG PROOF cases below). A reconcile
// bug — a fabricated Best standing after its credit was retracted, a rollback dropping below an
// earlier run, or a comparison drifting back to raw precision — breaks the equality. End-to-end
// reachability through the real UI is pinned by aox.dom batch 9 (back-browse retract, cross-run
// floor, mid-done key move).
import { describe, it, expect } from 'vitest'
import {
  reconcileAoxBest,
  reconcileAoxStanding,
  aoxBestEqual,
  emptyAoxBest,
} from '../../src/engine/aoxBest.js'
import { calcAvg, calcMed } from '../../src/engine/stats.js'
import { roundCentis } from '../../src/lib/modeFormat.js'
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

  // ★ BUG PROOF (this is the defect this file exists to fix). Before the fix, reconcileAoxBest
  // compared `avg < cur.avg` at raw float precision, but Best Mean / Mean are only ever DISPLAYED
  // through fmtTime, which rounds to hundredths. So a run whose raw average is a hair below the
  // stored record — pure division noise, invisible on screen — used to plant a ★ on a "new best"
  // that read IDENTICALLY to the old one. 2.129999999999999 is genuinely < 2.13 at raw float
  // precision (proving the old `<` really would have fired), but both round to "2.13s".
  it('BUG PROOF: a raw-only difference that displays identically does NOT register as an improvement', () => {
    const cur = reconcileAoxBest(emptyAoxBest(), 2.13, 2.13, 1).next
    expect(cur.avg).toBe(2.13)
    const { next, avgImp, medImp } = reconcileAoxBest(cur, 2.129999999999999, 2.129999999999999, 2)
    expect(avgImp).toBe(false)
    expect(medImp).toBe(false)
    expect(next).toEqual(cur) // untouched — no phantom ★, no reassigned round id
  })

  // The companion, real-improvement case: a run that is faster at DISPLAY precision (not just raw
  // float noise) still correctly registers — the fix narrows the comparison, it doesn't disable it.
  it('a genuine improvement at display precision still registers', () => {
    const cur = reconcileAoxBest(emptyAoxBest(), 2.13, 2.13, 1).next
    const { next, avgImp, medImp } = reconcileAoxBest(cur, 2.12, 2.12, 2) // one whole hundredth faster
    expect(avgImp).toBe(true)
    expect(medImp).toBe(true)
    expect(next.avg).toBe(2.12)
    expect(next.avgRoundId).toBe(2)
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

  // ★ BUG PROOF, end-to-end through the real caller. Two different Ao3s that print the identical
  // "2.13s" Mean — calcAvg's division genuinely lands them on opposite sides of 2.13 at raw float
  // precision ([2.10, 2.15, 2.14] → 2.1300000000000003; [2.08, 2.15, 2.15] → 2.126666666666667, which
  // IS raw-less-than the first). Before the fix the second run's post-completion reconcile would have
  // overwritten the record (and its round id) for a difference that never appears on screen.
  it('BUG PROOF (via calcAvg noise): two runs that print the same Mean do not reassign the record', () => {
    expect(calcAvg([2.1, 2.15, 2.14])).toBeGreaterThan(calcAvg([2.08, 2.15, 2.15])) // the raw ordering
    const floor = reconcileAoxStanding(emptyAoxBest(), 3, 3, [2.1, 2.15, 2.14], 1).next
    expect(floor.avg).toBe(2.13) // stored at display precision
    const { next, avgImp } = reconcileAoxStanding(floor, 3, 3, [2.08, 2.15, 2.15], 2)
    expect(avgImp).toBe(false)
    expect(next.avg).toBe(2.13)
    expect(next.avgRoundId).toBe(1) // record stays with run 1 — run 2 never actually beat it on screen
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
  // currently STAND (good ≥ their n, stats computable), the first to reach a strictly-lower avg AT
  // DISPLAY PRECISION holds the Best Mean (+ its own median as avgMed + its run id), likewise for
  // the median. A plain ordered min-scan over each run's CURRENT stats — no reconcile, no floor, no
  // snapshot. (calcAvg/calcMed are shared with the driver deliberately: they're independently
  // unit-tested primitives; the logic under test is the reconcile/floor protocol, not the averaging.)
  //
  // "At display precision" — not raw float — because that's what reconcileAoxBest itself now does
  // (see its header comment): Best Mean/Median are only ever shown through fmtTime, which rounds to
  // hundredths, so the oracle rounds through the SAME roundCentis (also independently unit-tested, in
  // modeFormat.test.js) before comparing, and returns the ROUNDED value — matching what reconcileAoxBest
  // stores. Reusing roundCentis here isn't reusing the logic under test: what's under test is the
  // reconcile/floor protocol (does the record track the right run, does rollback restore the right
  // floor), not whether roundCentis itself rounds correctly.
  function expectedBest(runs) {
    let avgCentis = null,
      avg = null,
      avgMed = null,
      avgRoundId = null
    let medCentis = null,
      med = null,
      medAvg = null,
      medRoundId = null
    for (const r of runs) {
      if (!r.recorded || r.good < r.n) continue
      const a = calcAvg(r.times),
        m = calcMed(r.times)
      if (a == null || m == null) continue
      const aC = roundCentis(a),
        mC = roundCentis(m)
      if (avgCentis == null || aC < avgCentis) {
        avgCentis = aC
        avg = aC / 100
        avgMed = mC / 100
        avgRoundId = r.rid
      }
      if (medCentis == null || mC < medCentis) {
        medCentis = mC
        med = mC / 100
        medAvg = aC / 100
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
