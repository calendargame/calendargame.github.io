// bestRecords.rounds — A ROUND'S RESULT ON ITS BEST RECORD, as the round screens file it.
//
// A Blitz round and a MoX run no longer rebuild their record from a floor: each files its OWN figures - a
// round's score and best streak, a run's mean and median, or nothing once it stands no more - as an op on
// the record (modes/BlitzMode, modes/AoxMode, through store/screenPool's fileRoundResult), and the records'
// merge (store/syncRecords) keeps every round's figures beside it. This file holds one screen's rounds on
// one record to the rules the floors used to keep, against INDEPENDENT oracles - the record is the best any
// standing round reached, held by the first round to reach it, with that round's other number beside it -
// through random sessions of rounds ending, Overrides moving them either way, and rounds put back in play
// and ended again. (Several windows, and older builds, on one record: tests/syncedDoc.records.fuzz.)
import { describe, it, expect } from 'vitest'
import { toRec, fromRec } from '../src/store/bestRecords.js'
import { aoxRunResult } from '../src/engine/aoxBest.js'
import { calcAvg, calcMed } from '../src/engine/stats.js'
import { roundCentis } from '../src/lib/modeFormat.js'
import { mulberry32 } from './helpers/rng.js'
import { roundScreen as screen, ROUND_ID as ID } from './helpers/roundScreen.js'

const blitz = (score, streak) => ({ score, streak })

// The oracle's holder: the FIRST round whose value is the max - none when the max is 0 (a 0 is never a
// best).
const holderAt = (values) => {
  const max = Math.max(0, ...values)
  return max === 0 ? -1 : values.indexOf(max)
}
// A Blitz record as the oracle says it must read - undefined when no round holds anything.
function blitzOracle(goods, hws, ids) {
  const score = Math.max(0, ...goods)
  const streak = Math.max(0, ...hws)
  if (score === 0 && streak === 0) return undefined
  const s = holderAt(goods)
  const t = holderAt(hws)
  return {
    score,
    scoreStreak: s < 0 ? null : hws[s],
    scoreRoundId: s < 0 ? null : ids[s],
    streak,
    streakScore: t < 0 ? null : goods[t],
    streakRoundId: t < 0 ? null : ids[t],
  }
}
const rec = ([score, scoreStreak, scoreRoundId], [streak, streakScore, streakRoundId]) => ({
  score,
  scoreStreak,
  scoreRoundId,
  streak,
  streakScore,
  streakRoundId,
})

describe('Blitz: one round’s result on its record', () => {
  it('a new high is held by the round, each field with the round’s other number', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(5, 3))
    expect(s.record()).toEqual(rec([5, 3, ID(1)], [3, 5, ID(1)]))
  })
  it('a round that scores nothing leaves NO record behind (not a record of 0)', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(0, 0))
    expect(s.record()).toBeUndefined()
  })
  it('a round overridden back to 0 removes the record it had created', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(3, 3))
    s.file(ID(1), blitz(0, 0))
    expect(s.record()).toBeUndefined()
  })
  it('a round that drops falls back to the round that held the record before it — its holder too', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(5, 5))
    s.file(ID(2), blitz(8, 8))
    expect(s.record()).toEqual(rec([8, 8, ID(2)], [8, 8, ID(2)]))
    s.file(ID(2), blitz(2, 2))
    expect(s.record()).toEqual(rec([5, 5, ID(1)], [5, 5, ID(1)]))
  })
  it('the two fields fall back independently — each to its OWN holder and companion', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(9, 2))
    s.file(ID(2), blitz(4, 7))
    expect(s.record()).toEqual(rec([9, 2, ID(1)], [7, 4, ID(2)]))
    s.file(ID(2), blitz(4, 1))
    expect(s.record()).toEqual(rec([9, 2, ID(1)], [2, 9, ID(1)]))
  })
  it('a tie does not take the record: the first round to reach a value keeps it, companion too', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(5, 4))
    s.file(ID(2), blitz(5, 4))
    expect(s.record()).toEqual(rec([5, 4, ID(1)], [4, 5, ID(1)]))
  })
  it('the companion follows the round as it FINALLY stands: an Override that moves only its other number', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(10, 8))
    s.file(ID(2), blitz(12, 3))
    expect(s.record()).toEqual(rec([12, 3, ID(2)], [8, 10, ID(1)]))
    // an Override on round 2 lifts its streak to 4: Best Score's companion moves, the field stands
    s.file(ID(2), blitz(12, 4))
    expect(s.record()).toEqual(rec([12, 4, ID(2)], [8, 10, ID(1)]))
  })
  it('a round put back in play takes its result back whole, and files again when it ends', () => {
    const s = screen('blitzBest')
    s.file(ID(1), blitz(5, 5))
    s.file(ID(2), blitz(8, 8))
    s.file(ID(2), null) // resumed
    expect(s.record()).toEqual(rec([5, 5, ID(1)], [5, 5, ID(1)]))
    s.file(ID(2), blitz(9, 6)) // ended again
    expect(s.record()).toEqual(rec([9, 6, ID(2)], [6, 9, ID(2)]))
  })
  it('a record from before Round 26 (no companions saved): its fields keep "not recorded"', () => {
    const disk = { score: 5, streak: 3, scoreRoundId: ID(1), streakRoundId: ID(1) }
    const r = toRec('blitzBest', disk, 'load', 'blitzBest|k')
    expect(fromRec('blitzBest', r, false)).toEqual(rec([5, null, ID(1)], [3, null, ID(1)]))
  })
})

describe('Blitz: random sessions against the max-round oracle (value, holder, companion)', () => {
  // Per Round: every round all-correct (its best streak is its score), its score rising answer by
  // answer and then Overridden down any number of times before the next round begins.
  it('per-round Best equals the oracle across 200 random sessions', () => {
    let sawRollback = false
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed)
      const s = screen('blitzBest')
      const goods = []
      const ids = []
      for (let r = 0; r < 12; r++) {
        const id = ID(r + 1)
        const priorMax = Math.max(0, ...goods)
        const peak = Math.floor(rnd() * 6)
        goods.push(0)
        ids.push(id)
        const i = goods.length - 1
        for (let g = 1; g <= peak; g++) {
          goods[i] = g
          s.file(id, blitz(g, g))
          expect(s.record(), `seed ${seed} round ${r} +${g}`).toEqual(
            blitzOracle(goods, goods, ids),
          )
        }
        let cur = peak
        while (cur > 0 && rnd() < 0.6) {
          cur--
          if (cur < priorMax) sawRollback = true
          goods[i] = cur
          s.file(id, blitz(cur, cur))
          expect(s.record(), `seed ${seed} round ${r} -> ${cur}`).toEqual(
            blitzOracle(goods, goods, ids),
          )
        }
      }
    }
    expect(sawRollback).toBe(true) // a round really dropped below an earlier round's record
  })

  // Per Question with Allow Mistakes on: a wrong breaks the streak, so a round's score and its best
  // streak move independently - two oracles, and records held by two different rounds.
  it('per-Q + Allow Mistakes Best tracks BOTH oracles across 200 random sessions', () => {
    let sawSplit = false
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed)
      const s = screen('suddenAmBest')
      const goods = []
      const hws = []
      const ids = []
      for (let r = 0; r < 12; r++) {
        const id = ID(r + 1)
        let good = 0
        let streak = 0
        let hw = 0
        for (let q = Math.floor(rnd() * 10); q > 0; q--) {
          if (rnd() < 0.65) {
            good++
            streak++
            hw = Math.max(hw, streak)
          } else streak = 0
        }
        goods.push(good)
        hws.push(hw)
        ids.push(id)
        const i = goods.length - 1
        s.file(id, blitz(good, hw))
        expect(s.record(), `seed ${seed} round ${r}`).toEqual(blitzOracle(goods, hws, ids))
        while (rnd() < 0.4) {
          if (rnd() < 0.5 && good > 0) {
            good--
            if (hw > 0 && rnd() < 0.5) hw--
          } else {
            good++
            if (rnd() < 0.5) hw++
          }
          goods[i] = good
          hws[i] = hw
          s.file(id, blitz(good, hw))
          expect(s.record(), `seed ${seed} round ${r} (override)`).toEqual(
            blitzOracle(goods, hws, ids),
          )
        }
        const now = s.record()
        if (now && now.scoreRoundId !== now.streakRoundId) sawSplit = true
      }
    }
    expect(sawSplit).toBe(true) // a "Different Rounds" record was actually produced
  })

  // End -> Override that resumes (the result taken back whole) -> play on -> end again, any number of
  // times: the record is built from the rounds that have ENDED, at their final figures.
  it('Best survives end -> resume -> re-end cycles across 200 random sessions', () => {
    let sawResume = false
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed)
      const s = screen('blitzBest')
      const goods = []
      const ids = []
      for (let r = 0; r < 10; r++) {
        const id = ID(r + 1)
        let good = 0
        for (;;) {
          good += Math.floor(rnd() * 5)
          s.file(id, blitz(good, good))
          if (good > 0 && rnd() < 0.5) {
            s.file(id, null) // resumed: back in play
            sawResume = true
          } else break
        }
        goods.push(good)
        ids.push(id)
        expect(s.record(), `seed ${seed} round ${r}`).toEqual(blitzOracle(goods, goods, ids))
      }
    }
    expect(sawResume).toBe(true)
  })

  it('sudden death: the highest score, held by the first round to reach it, across 200 sessions', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed)
      const s = screen('suddenBest')
      const goods = []
      const ids = []
      const expected = () => {
        const i = holderAt(goods)
        return i < 0 ? undefined : { score: goods[i], roundId: ids[i] }
      }
      for (let r = 0; r < 12; r++) {
        const id = ID(r + 1)
        const peak = Math.floor(rnd() * 6)
        goods.push(0)
        ids.push(id)
        const i = goods.length - 1
        for (let g = 1; g <= peak; g++) {
          goods[i] = g
          s.file(id, { score: g })
          expect(s.record(), `sudden seed ${seed} round ${r} +${g}`).toEqual(expected())
        }
        for (let cur = peak; cur > 0 && rnd() < 0.6; ) {
          goods[i] = --cur
          s.file(id, { score: cur })
          expect(s.record(), `sudden seed ${seed} round ${r} -> ${cur}`).toEqual(expected())
        }
      }
    }
  })
})

// ── MoX ──────────────────────────────────────────────────────────────────────────────────────────
const run = (avg, avgMed, avgRoundId, med, medAvg, medRoundId) => ({
  avg,
  avgMed,
  avgRoundId,
  med,
  medAvg,
  medRoundId,
})

describe('MoX: a run’s result', () => {
  it('stands while the run has its n credits: its mean and median, to the hundredth', () => {
    expect(aoxRunResult(3, 3, [1.234, 2.345, 3.456])).toEqual({ avg: 2.35, med: 2.35 })
  })
  it('extra credits (good > n) still stand, at the run’s CURRENT figures', () => {
    expect(aoxRunResult(5, 3, [1, 2, 3, 4])).toEqual({ avg: 2.5, med: 2.5 })
  })
  it('a run short of its n holds nothing; nor does one with no times to measure', () => {
    expect(aoxRunResult(2, 3, [1, 2])).toBeNull()
    expect(aoxRunResult(3, 3, [])).toBeNull()
  })
})

describe('MoX: one run’s result on its record', () => {
  it('a new best for both metrics, held by the run, each with the run’s other figure', () => {
    const s = screen('aoxBest')
    s.file(ID(1), { avg: 2.5, med: 2.4 })
    expect(s.record()).toEqual(run(2.5, 2.4, ID(1), 2.4, 2.5, ID(1)))
  })
  it('a slower run does not displace either record', () => {
    const s = screen('aoxBest')
    s.file(ID(1), { avg: 2.5, med: 2.4 })
    s.file(ID(2), { avg: 2.9, med: 2.8 })
    expect(s.record()).toEqual(run(2.5, 2.4, ID(1), 2.4, 2.5, ID(1)))
  })
  it('the mean improves and the median does not: each metric from its own run, with its companion', () => {
    const s = screen('aoxBest')
    s.file(ID(1), { avg: 2.5, med: 2.4 })
    s.file(ID(2), { avg: 2.3, med: 2.6 })
    expect(s.record()).toEqual(run(2.3, 2.6, ID(2), 2.4, 2.5, ID(1)))
  })
  it('a tie at display precision is a tie: 2.504 and 2.496 are both 2.50, and the first run keeps it', () => {
    const s = screen('aoxBest')
    s.file(ID(1), { avg: 2.5, med: 2.5 })
    s.file(ID(2), aoxRunResult(2, 2, [2.504, 2.504]))
    s.file(ID(3), aoxRunResult(2, 2, [2.496, 2.496]))
    expect(s.record()).toEqual(run(2.5, 2.5, ID(1), 2.5, 2.5, ID(1)))
  })
  it('BUG PROOF (calcAvg noise): two runs that print the same Mean do not reassign the record', () => {
    const s = screen('aoxBest')
    s.file(ID(1), aoxRunResult(3, 3, [0.1, 0.2, 0.3]))
    s.file(ID(2), aoxRunResult(3, 3, [0.3, 0.1, 0.2]))
    expect(s.record().avgRoundId).toBe(ID(1))
  })
  it('a run that stops standing hands each metric to the best other run — or leaves none', () => {
    const s = screen('aoxBest')
    s.file(ID(1), { avg: 2.5, med: 2.4 })
    s.file(ID(2), { avg: 2.0, med: 2.1 })
    s.file(ID(2), null)
    expect(s.record()).toEqual(run(2.5, 2.4, ID(1), 2.4, 2.5, ID(1)))
    const t = screen('aoxBest')
    t.file(ID(1), { avg: 2.5, med: 2.4 })
    t.file(ID(1), null)
    expect(t.record()).toBeUndefined()
  })
})

describe('MoX: random sessions against the fastest-standing-run oracle', () => {
  // Independent oracle: the runs in the order they began; among those that RECORDED and STAND now, the
  // first to reach a strictly lower mean AT DISPLAY PRECISION holds Best Mean (with its own median beside
  // it), likewise the median. (calcAvg, calcMed and roundCentis are shared with the driver deliberately:
  // they are unit-tested on their own; what is under test is which run the record tracks.)
  function expectedBest(runs) {
    let a = null
    let m = null
    for (const r of runs) {
      if (!r.recorded || r.good < r.n) continue
      const av = calcAvg(r.times)
      const md = calcMed(r.times)
      if (av == null || md == null) continue
      const x = { aC: roundCentis(av), mC: roundCentis(md), rid: r.rid }
      if (!a || x.aC < a.aC) a = x
      if (!m || x.mC < m.mC) m = x
    }
    if (!a && !m) return undefined
    return run(a.aC / 100, a.mC / 100, a.rid, m.mC / 100, m.aC / 100, m.rid)
  }
  it('Best mean and median equal the oracle across 400 random edited sessions', () => {
    const seen = { retractBelowN: false, handedBack: false, recordRemoved: false }
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = mulberry32(seed)
      const s = screen('aoxBest')
      const runs = []
      const file = (r) => {
        const result = aoxRunResult(r.good, r.n, r.times)
        // (as AoxMode files: nothing until the run first stands; then every change, null included)
        if (r.filed === undefined && result === null) return
        if (JSON.stringify(result) === r.filed) return
        s.file(r.rid, result)
        r.filed = JSON.stringify(result)
      }
      for (let i = 0; i < 12; i++) {
        const n = 2 + Math.floor(rnd() * 4)
        const times = Array.from({ length: 1 + Math.floor(rnd() * n) }, () => 0.2 + rnd() * 3)
        const r = { recorded: rnd() < 0.85, good: n, n, times, rid: ID(i + 1) }
        runs.push(r)
        if (r.recorded) file(r)
        expect(s.record(), `seed ${seed} run ${i}`).toEqual(expectedBest(runs))
        for (let e = Math.floor(rnd() * 5); e > 0; e--) {
          const before = s.record()
          if (rnd() < 0.5) {
            r.good = Math.max(0, r.good - 1)
            if (r.times.length && rnd() < 0.7) r.times.splice(Math.floor(rnd() * r.times.length), 1)
            if (r.recorded && r.good < n) seen.retractBelowN = true
          } else {
            r.good += 1
            if (rnd() < 0.7) r.times.push(0.2 + rnd() * 3)
          }
          if (r.recorded) file(r)
          const after = s.record()
          if (before && !after) seen.recordRemoved = true
          if (before?.avgRoundId === r.rid && after && after.avgRoundId !== r.rid)
            seen.handedBack = true
          expect(after, `seed ${seed} run ${i} edit`).toEqual(expectedBest(runs))
        }
      }
    }
    // the sessions exercised the corners (no vacuous pass)
    expect(seen).toEqual({ retractBelowN: true, handedBack: true, recordRemoved: true })
  })
})
