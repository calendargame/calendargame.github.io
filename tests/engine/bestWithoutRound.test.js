// tests/engine/bestWithoutRound.test.js — the floor a Best is rebuilt from is THE RECORD AS IT
// STANDS, LESS THIS ROUND (engine/blitzBest's blitzBestWithoutRound / suddenBestWithoutRound,
// engine/aoxBest's aoxBestWithoutRun).
//
// A round's Best is rebuilt on every reconcile from "the record before the round". That used to be a
// snapshot taken at Begin, which is right only while this round is the record's one writer — and a
// round restored after a reload wrote its own result over a better Best another tab had saved in
// between. Two things are pinned here:
//   1. WITH ONE WRITER NOTHING CHANGES: through any sequence of reconciles the rebased floor is
//      exactly the snapshot, so every result is the one the snapshot alone gave (fuzzed).
//   2. WITH ANOTHER WRITER, ITS RECORD STANDS: whatever another round put in the record is kept,
//      this round's own fields still fall back to what they were, and a field this round wins is
//      still won.
import { describe, it, expect } from 'vitest'
import {
  reconcileBlitzBest,
  reconcileSuddenBest,
  blitzBestWithoutRound,
  suddenBestWithoutRound,
} from '../../src/engine/blitzBest.js'
import { reconcileAoxStanding, aoxBestWithoutRun } from '../../src/engine/aoxBest.js'
import { mulberry32 } from '../helpers/rng.js'

const R = 500 // this round
const P = 100 // the round that held the record before it
const Q = 900 // another tab's round, saved while this one was parked

// A Blitz record: each field with its holder and its companion — the holder round's other number
// (Round 26, Q10; engine/blitzBest's header).
const blitz = ([score, scoreStreak, scoreRoundId], [streak, streakScore, streakRoundId]) => ({
  score,
  scoreStreak,
  scoreRoundId,
  streak,
  streakScore,
  streakRoundId,
})

describe('blitzBestWithoutRound', () => {
  const pre = blitz([5, 2, P], [3, 5, P])

  it('a record this round has not touched is the floor, exactly', () => {
    expect(blitzBestWithoutRound(pre, pre, R)).toEqual(pre)
  })
  it('a field this round holds goes back to what it was — value, companion, and holder', () => {
    const cur = blitz([7, 2, R], [3, 5, P])
    expect(blitzBestWithoutRound(pre, cur, R)).toEqual(pre)
    const both = blitz([7, 6, R], [6, 7, R])
    expect(blitzBestWithoutRound(pre, both, R)).toEqual(pre)
  })
  it('no record before the round, and nothing in it but this round’s: no floor', () => {
    const cur = blitz([7, 6, R], [6, 7, R])
    expect(blitzBestWithoutRound(undefined, cur, R)).toBeUndefined()
    expect(blitzBestWithoutRound(undefined, undefined, R)).toBeUndefined()
  })
  it('★ another round’s record stands — the floor is what the store holds now', () => {
    const other = blitz([9, 8, Q], [8, 9, Q])
    expect(blitzBestWithoutRound(pre, other, R)).toEqual(other)
    // …field by field: the other tab took the score, this round still holds the streak.
    const mixed = blitz([9, 4, Q], [6, 6, R])
    expect(blitzBestWithoutRound(pre, mixed, R)).toEqual(blitz([9, 4, Q], [3, 5, P]))
  })
  it('a record somebody else removed is gone — the snapshot does not bring it back', () => {
    expect(blitzBestWithoutRound(pre, undefined, R)).toBeUndefined()
  })
  it('a round with no id holds nothing (an old record’s null holder is not "this round")', () => {
    const legacy = blitz([5, null, null], [3, null, null])
    expect(blitzBestWithoutRound(undefined, legacy, null)).toEqual(legacy)
  })
  it('a record from before Round 26 (no companions saved): kept as "not recorded", never guessed', () => {
    const older = { score: 5, scoreRoundId: P, streak: 3, streakRoundId: P } // no companion keys
    expect(blitzBestWithoutRound(older, older, R)).toEqual(blitz([5, null, P], [3, null, P]))
    // …and a field this round held goes back to the older record's — with no companion either.
    expect(blitzBestWithoutRound(older, blitz([7, 4, R], [3, null, P]), R)).toEqual(
      blitz([5, null, P], [3, null, P]),
    )
  })
  it('never mutates what it is handed', () => {
    const cur = Object.freeze(blitz([7, 2, R], [3, 5, P]))
    blitzBestWithoutRound(Object.freeze({ ...pre }), cur, R)
  })
})

describe('suddenBestWithoutRound', () => {
  const pre = { score: 5, roundId: P }
  it('this round’s record goes back to the one before it; anyone else’s stands', () => {
    expect(suddenBestWithoutRound(pre, { score: 7, roundId: R }, R)).toEqual(pre)
    expect(suddenBestWithoutRound(undefined, { score: 7, roundId: R }, R)).toBeUndefined()
    expect(suddenBestWithoutRound(pre, pre, R)).toEqual(pre)
    expect(suddenBestWithoutRound(pre, { score: 9, roundId: Q }, R)).toEqual({
      score: 9,
      roundId: Q,
    })
    expect(suddenBestWithoutRound(pre, undefined, R)).toBeUndefined()
  })
})

describe('aoxBestWithoutRun', () => {
  const pre = { avg: 2.5, avgMed: 2.4, avgRoundId: P, med: 2.2, medAvg: 2.6, medRoundId: P }
  it('a metric this run holds goes back with its companion stat and its holder', () => {
    const cur = { ...pre, avg: 1.9, avgMed: 1.8, avgRoundId: R }
    expect(aoxBestWithoutRun(pre, cur, R)).toEqual(pre)
    const both = { avg: 1.9, avgMed: 1.8, avgRoundId: R, med: 1.8, medAvg: 1.9, medRoundId: R }
    expect(aoxBestWithoutRun(pre, both, R)).toEqual(pre)
    expect(aoxBestWithoutRun(undefined, both, R)).toBeUndefined()
  })
  it('★ another run’s record stands, metric by metric', () => {
    const other = { avg: 1.5, avgMed: 1.4, avgRoundId: Q, med: 1.4, medAvg: 1.5, medRoundId: Q }
    expect(aoxBestWithoutRun(pre, other, R)).toEqual(other)
    const mixed = { avg: 1.5, avgMed: 1.4, avgRoundId: Q, med: 1.8, medAvg: 1.9, medRoundId: R }
    expect(aoxBestWithoutRun(pre, mixed, R)).toEqual({
      avg: 1.5,
      avgMed: 1.4,
      avgRoundId: Q,
      med: 2.2,
      medAvg: 2.6,
      medRoundId: P,
    })
  })
  it('a record somebody else removed is gone, and an untouched one is the floor', () => {
    expect(aoxBestWithoutRun(pre, undefined, R)).toBeUndefined()
    expect(aoxBestWithoutRun(pre, pre, R)).toEqual(pre)
  })
})

// ── 1. ONE WRITER: the rebased floor IS the snapshot, through any sequence of reconciles ──────────
describe('with one writer, rebuilding from the store is rebuilding from the snapshot', () => {
  it('Blitz / per-Q + Allow Mistakes: 300 random rounds, each reconciled many times', () => {
    const rnd = mulberry32(2024)
    let stored // the record in the store, across rounds
    for (let round = 1; round <= 300; round++) {
      const pre = stored // snapshotted at Begin
      const edits = 1 + Math.floor(rnd() * 8)
      for (let e = 0; e < edits; e++) {
        const good = Math.floor(rnd() * 12)
        const streak = Math.floor(rnd() * (good + 1))
        const floor = blitzBestWithoutRound(pre, stored, round)
        expect(floor).toEqual(pre) // the claim
        stored = reconcileBlitzBest(floor, good, streak, round)
        expect(stored).toEqual(reconcileBlitzBest(pre, good, streak, round))
      }
    }
  })
  it('sudden death: 300 random rounds', () => {
    const rnd = mulberry32(7)
    let stored
    for (let round = 1; round <= 300; round++) {
      const pre = stored
      for (let e = 0; e < 1 + Math.floor(rnd() * 6); e++) {
        const good = Math.floor(rnd() * 12)
        const floor = suddenBestWithoutRound(pre, stored, round)
        expect(floor).toEqual(pre)
        stored = reconcileSuddenBest(floor, good, round)
      }
    }
  })
  it('MoX: 300 random runs, completed, retracted, and re-credited', () => {
    const rnd = mulberry32(99)
    let stored
    for (let run = 1; run <= 300; run++) {
      const pre = stored
      const n = 3
      for (let e = 0; e < 1 + Math.floor(rnd() * 8); e++) {
        const good = 2 + Math.floor(rnd() * 3) // sometimes short of n: the completion retracted
        const times = Array.from({ length: Math.min(good, n) }, () => 1 + rnd() * 3)
        const floor = aoxBestWithoutRun(pre, stored, run)
        expect(floor).toEqual(pre)
        stored = reconcileAoxStanding(floor, good, n, times, run)
        expect(stored).toEqual(reconcileAoxStanding(pre, good, n, times, run))
      }
    }
  })
})

// ── 2. ANOTHER WRITER: the reported case, end to end ──────────────────────────────────────────────
// The mode screens' protocol, as they run it (modes/BlitzMode's roundFloor, modes/AoxMode's Best
// effect): before every write the floor is re-read as the saved record less this round, AND IT
// REPLACES THE SNAPSHOT — so a record learned from another round is still known after this round
// has taken a field from it (the one saved record cannot hold both).
describe('a round restored after another tab saved a better Best does not write over it', () => {
  it('Blitz: the restored round’s mount reconcile, then Overrides on it', () => {
    let snap = blitz([5, 2, P], [3, 5, P]) // parked with the round
    let saved
    const reconcile = (good, streak) => {
      snap = blitzBestWithoutRound(snap, saved, R)
      saved = reconcileBlitzBest(snap, good, streak, R)
    }
    // This tab: round R ended on 7.
    saved = snap
    reconcile(7, 4)
    expect(saved.score).toBe(7)
    // The other tab then saved 9 — and this tab reloads onto that record, the round still parked
    // with the snapshot it began with.
    const theirs = blitz([9, 8, Q], [8, 9, Q])
    saved = theirs
    snap = blitz([5, 2, P], [3, 5, P])
    // What the restored round used to write at mount: its own result, from that snapshot.
    expect(reconcileBlitzBest(snap, 7, 4, R).score).toBe(7) // 9 → 7: the defect
    // What it writes now: nothing — the other round's record stands.
    reconcile(7, 4)
    expect(saved).toEqual(theirs)
    // An Override that lowers the restored round changes nothing either…
    reconcile(6, 3)
    expect(saved).toEqual(theirs)
    // …one that takes it past the other tab's record wins that field, as any round would…
    reconcile(11, 4)
    expect(saved).toEqual(blitz([11, 4, R], [8, 9, Q]))
    // …and its Undo hands the score back to the OTHER tab's round — not to the old snapshot's 5.
    reconcile(7, 4)
    expect(saved).toEqual(theirs)
  })

  it('MoX: a restored run slower than the other tab’s keeps that Best; a faster one takes it, and gives it back', () => {
    let snap = { avg: 3, avgMed: 3, avgRoundId: P, med: 3, medAvg: 3, medRoundId: P }
    const theirs = { avg: 1.5, avgMed: 1.5, avgRoundId: Q, med: 1.5, medAvg: 1.5, medRoundId: Q }
    let saved = theirs
    const reconcile = (good, times) => {
      snap = aoxBestWithoutRun(snap, saved, R)
      saved = reconcileAoxStanding(snap, good, 3, times, R)
    }
    expect(reconcileAoxStanding(snap, 3, 3, [2, 2, 2], R).avg).toBe(2) // the defect: 1.5 → 2
    reconcile(3, [2, 2, 2])
    expect(saved).toEqual(theirs)
    reconcile(3, [1, 1, 1]) // an Override makes the run faster than theirs
    expect(saved.avgRoundId).toBe(R)
    expect(saved.medRoundId).toBe(R)
    reconcile(2, [1, 1]) // …and retracting its completion gives the record back to their run
    expect(saved).toEqual(theirs)
  })
})
