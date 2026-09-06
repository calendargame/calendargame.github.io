// tests/engine/runBreakdown.test.js — the run breakdown's two claims (sub-group 3C).
//
// CLAIM 1 (the point of the whole thing): THE ROWS RECONCILE EXACTLY WITH THE MEAN. The breakdown
// is not a report about the run, it is the run's own decomposition — so the multiset of row times
// must equal `stats.times` after ANY sequence of moves, and the row-derived mean must therefore be
// the same number the stat strip prints. Every case below re-asserts it through one shared helper,
// including all five Override paths, because Override is where this app's hardest bugs live and it
// is the only thing that can move a time from one card to another (or take one away).
//
// CLAIM 2: the rows are the run, in order, and each one says what it is — its number, its date, its
// time, and a mark when it earned nothing.
//
// The engine-level tripwire for claim 1 lives in checkGameInvariants ('times ledger'), which the
// fuzz survey drives across millions of generated games; these are the named, readable cases.
import { describe, it, expect } from 'vitest'
import { gameReducer, initEngine } from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { buildRunBreakdown } from '../../src/engine/runBreakdown.js'
import { calcAvg, calcMed } from '../../src/engine/stats.js'
import { wday } from '../../src/lib/calendar.js'

const D1 = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const D2 = { y: 2025, m: 6, d: 15, _fmt: 'numeric-ymd', _jul: false }
const D3 = { y: 2019, m: 3, d: 9, _fmt: 'numeric-ymd', _jul: false }
const D4 = { y: 2001, m: 11, d: 30, _fmt: 'numeric-ymd', _jul: false }
const cor = (d) => wday(d.y, d.m, d.d)
const wrong = (d) => (cor(d) + 1) % 7

// A run mode's context: Save Stats on and TIMING ON (tracking), which is what MoX and Blitz always
// feed the engine — solve times are the whole point of both.
const ctx = { useJulian: false, saveStats: true, tracking: true }
const answer = (s, idx, elapsed, nextDate, extra = {}) =>
  gameReducer(s, { type: 'ANSWER', idx, elapsed, nextDate, ...ctx, ...extra })
const reveal = (s, elapsed) => gameReducer(s, { type: 'REVEAL', elapsed, ...ctx })
const showCodes = (s, elapsed) =>
  gameReducer(s, { type: 'SHOW_CODES', open: true, elapsed, ...ctx })
const override = (s, nextDate, extra = {}) =>
  gameReducer(s, {
    type: 'OVERRIDE',
    useJulian: false,
    tracking: true,
    timingOff: false,
    nextDate,
    ...extra,
  })
const back = (s) => gameReducer(s, { type: 'BACK' })
const forward = (s) => gameReducer(s, { type: 'FORWARD', useJulian: false })

// ── The reconciliation assertion, used by every case ────────────────────────────────────────────
// Three things at once, and they are separable on purpose: the ledger is healthy (the engine's own
// tripwire agrees), the rows name exactly the pool's seconds, and the summary the popup PRINTS is
// therefore the same number the stat strip prints from `stats.times`. The last one is the claim a
// player could catch us on, and it is the one that would silently rot without this line.
const sorted = (a) => [...a].sort((x, y) => x - y)
function expectReconciles(state) {
  expect(checkGameInvariants(state, false)).toEqual([])
  const b = buildRunBreakdown(state)
  const rowTimes = b.rows.map((r) => r.time).filter((t) => t != null)
  expect(sorted(rowTimes)).toEqual(sorted(state.stats.times))
  expect(b.summary.mean).toBe(calcAvg(state.stats.times))
  expect(b.summary.median).toBe(calcMed(state.stats.times))
  // One row per card played — the same correspondence the card ledger asserts for the Q# badge.
  expect(b.rows).toHaveLength(state.stats.played)
  expect(b.summary.solves).toBe(state.stats.good)
  return b
}

describe('runBreakdown — a clean run', () => {
  it('lists every solve in order with its own time, and the rows ARE the mean', () => {
    let s = initEngine(D1)
    s = answer(s, cor(D1), 2, D2)
    s = answer(s, cor(D2), 4, D3)
    s = answer(s, cor(D3), 6, D4) //  the third solve advances; D4 is the fresh live card
    const b = expectReconciles(s)
    expect(b.rows.map((r) => r.n)).toEqual([1, 2, 3])
    expect(b.rows.map((r) => r.time)).toEqual([2, 4, 6])
    expect(b.rows.map((r) => r.question.d)).toEqual([D1.d, D2.d, D3.d])
    expect(b.rows.every((r) => r.credited && r.mark === null)).toBe(true)
    expect(b.summary).toMatchObject({
      solves: 3,
      cards: 3,
      mean: 4,
      median: 4,
      fastest: 2,
      slowest: 6,
      spread: 4,
    })
    expect([b.fastestIdx, b.slowestIdx]).toEqual([0, 2])
  })

  it('the fresh live card is not a row — nothing has been recorded for it', () => {
    const s = answer(initEngine(D1), cor(D1), 2, D2)
    const b = expectReconciles(s)
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0].question.d).toBe(D1.d)
  })

  it('accents nothing when every solve took the same time — there is nothing to tell apart', () => {
    let s = initEngine(D1)
    s = answer(s, cor(D1), 3, D2)
    s = answer(s, cor(D2), 3, D3)
    const b = expectReconciles(s)
    expect([b.fastestIdx, b.slowestIdx, b.summary.spread]).toEqual([null, null, null])
    expect(b.summary.fastest).toBe(3) //  the FIGURES are still real; only the accent is withheld
  })
})

describe('runBreakdown — the marks a card that earned nothing carries', () => {
  it('a wrong pick reads "wrong", and a late correct on the same card still earns nothing', () => {
    let s = initEngine(D1)
    s = answer(s, wrong(D1), 2, D2) //  wrong: burned, stays put
    s = answer(s, cor(D1), 5, D2) //   right on the second try: advances, credits nothing, times nothing
    const b = expectReconciles(s)
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0]).toMatchObject({ credited: false, mark: 'wrong', time: null })
    // ⚠ THE HOLE THAT IS NOT A BUG: a wrong-then-right records no time at all (the engine only
    // times a FIRST-TRY correct), so this row shows a dash. That is the honest reading — the card
    // contributed nothing to the mean — and "fixing" it would change what the mean is made of.
    expect(s.stats.times).toEqual([])
  })

  it('a revealed card reads "shown"', () => {
    let s = reveal(initEngine(D1), 2)
    s = gameReducer(s, { type: 'NEW', nextDate: D2, ...ctx })
    const b = expectReconciles(s)
    expect(b.rows[0]).toMatchObject({ credited: false, mark: 'shown', time: null })
  })

  it('a show-coded card reads "shown" too — the engine records no reason to tell them apart', () => {
    let s = showCodes(initEngine(D1), 2)
    s = gameReducer(s, { type: 'NEW', nextDate: D2, ...ctx })
    expect(expectReconciles(s).rows[0]).toMatchObject({ mark: 'shown' })
  })
})

describe('runBreakdown — Override moves the time and the row together (the five paths)', () => {
  it('PATH 3: crediting the live wrong gives that card the wrong answer’s time', () => {
    let s = answer(initEngine(D1), wrong(D1), 7, D2)
    expect(s.stats.times).toEqual([]) //  a wrong records nothing yet
    s = override(s, D2)
    const b = expectReconciles(s)
    expect(s.stats.times).toEqual([7])
    expect(b.rows[0]).toMatchObject({ credited: true, mark: null, time: 7 })
  })

  it('PATH 4: the retro credit lands on the PREVIOUS card, not the live one', () => {
    let s = answer(initEngine(D1), wrong(D1), 7, D2) //  D1 burned
    s = answer(s, cor(D1), 9, D2) //                     late correct advances to D2
    s = override(s, D3) //                               Path 4 credits D1 and advances
    const b = expectReconciles(s)
    expect(b.rows[0]).toMatchObject({ n: 1, credited: true, time: 7 })
    expect(b.rows.filter((r) => r.time != null)).toHaveLength(1)
  })

  it('PATH 5: the retro flip of the last entry credits it and gives it the time back', () => {
    let s = answer(initEngine(D1), cor(D1), 2, D2) //  a clean credit, so Path 5 will REVERSE it
    s = answer(s, wrong(D2), 5, D3)
    s = answer(s, cor(D2), 5, D3) //                   D2 is a late correct → pushed as a miss
    s = override(s, D4) //                             Path 5 flips D2 to credited with its 5s
    const b = expectReconciles(s)
    expect(b.rows.map((r) => r.time)).toEqual([2, 5])
    expect(b.rows.map((r) => r.credited)).toEqual([true, true])
  })

  it('PATH 5 in reverse: un-crediting a card takes its time out of the mean AND out of its row', () => {
    let s = answer(initEngine(D1), cor(D1), 2, D2) //  credited, 2s, pushed
    s = override(s, D3) //                             retro-flips D1 to a miss
    const b = expectReconciles(s)
    expect(s.stats.times).toEqual([])
    expect(b.rows[0]).toMatchObject({ credited: false, mark: 'override', time: null })
    expect(b.summary.mean).toBe(null)
  })

  it('PATH 2: reversing the HELD completing solve (MoX’s Nth) drops its time from both', () => {
    let s = answer(initEngine(D1), cor(D1), 2, D2)
    s = answer(s, cor(D2), 8, D3, { complete: true }) //  credited but held — no advance
    expect(expectReconciles(s).rows.map((r) => r.time)).toEqual([2, 8])
    s = override(s, D3, { noAdvance: true }) //           reverse the held solve
    const b = expectReconciles(s)
    expect(s.stats.times).toEqual([2])
    expect(b.rows.map((r) => r.time)).toEqual([2, null])
    expect(b.rows[1].mark).toBe('override')
  })

  it('PATH 1: a browse-back credit puts the time on the card being BROWSED, in its own place', () => {
    let s = answer(initEngine(D1), wrong(D1), 7, D2) //  D1 burned
    s = answer(s, cor(D1), 9, D2) //                     advances to D2 as a miss
    s = answer(s, cor(D2), 3, D3) //                     D2 credited, 3s
    s = back(s) //                                       browse to D2… then to D1
    s = back(s)
    s = override(s, D4) //                               Path 1 credits the browsed D1 with its 7s
    const b = expectReconciles(s)
    expect(b.rows.map((r) => r.n)).toEqual([1, 2])
    expect(b.rows.map((r) => r.time)).toEqual([7, 3]) //  in CARD order, not in pool order
    s = forward(s)
    s = forward(s)
    expect(expectReconciles(s).rows.map((r) => r.time)).toEqual([7, 3]) //  unchanged by the round trip
  })

  it('browsing back and forward never moves a single second', () => {
    let s = initEngine(D1)
    s = answer(s, cor(D1), 2, D2)
    s = answer(s, cor(D2), 6, D3)
    const before = expectReconciles(s)
    s = back(s)
    expect(expectReconciles(s).rows.map((r) => r.time)).toEqual([2, 6])
    s = back(s)
    expect(expectReconciles(s).rows.map((r) => r.time)).toEqual([2, 6])
    s = forward(s)
    s = forward(s)
    expect(expectReconciles(s)).toEqual(before)
  })
})

describe('runBreakdown — cards that were never played are never rows', () => {
  it('a card played with Save Stats OFF is neither counted nor listed', () => {
    let s = answer(initEngine(D1), cor(D1), 2, D2, { saveStats: false })
    expect(s.stats.played).toBe(0)
    const b = expectReconciles(s)
    expect(b.rows).toEqual([])
    expect(b.summary.mean).toBe(null)
  })

  it('a Blitz per-round timeout shows an answer without scoring it — and adds no row', () => {
    let s = answer(initEngine(D1), cor(D1), 2, D2)
    s = gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false }) //  the round clock died on D2
    const b = expectReconciles(s)
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0].question.d).toBe(D1.d)
  })

  it('a Blitz per-question timeout DOES score its card, so it is a row — marked, untimed', () => {
    const s = gameReducer(initEngine(D1), {
      type: 'TIMEOUT_MISS',
      useJulian: false,
      saveStats: true,
    })
    const b = expectReconciles(s)
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0]).toMatchObject({ credited: false, mark: 'shown', time: null })
  })
})
