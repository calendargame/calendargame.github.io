// Regression tests for the score-integrity bugs the C2 fuzz survey found + fixed (2026-06-06).
// Each is a focused, app-reachable sequence that produced an IMPOSSIBLE score (streak/best > good)
// before the fix — and slipped past the earlier good≤played checks. The fuzz (tests/engine/fuzz) is
// the broad net; these pin the exact scenarios so a future regression names itself.
//
// Root cause (all in one family): a history entry's `hasCredit` ("earned a point") was inferred from
// the answer grid, but REVEAL / Show Codes / timeout / a reversed-to-wrong Override all leave a clean
// 'correct' on the grid WITHOUT crediting good. A later Override that recomputes the streak from
// history then counted those false credits. Fixed in gameReducer.advance (hasCredit gated on
// !revealed && !countedWrong) + Path 2's best/btns revert + TIMEOUT_MISS marking revealed.
import { describe, it, expect } from 'vitest'
import { gameReducer, initEngine } from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'

const D1 = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const D2 = { y: 2024, m: 2, d: 2, _fmt: 'numeric-ymd', _jul: false }
const D3 = { y: 2024, m: 3, d: 3, _fmt: 'numeric-ymd', _jul: false }
const C = wday(2024, 1, 1) // correct weekday index for D1
const ctx = { useJulian: false, saveStats: true }
const cOf = (d) => wday(d.y, d.m, d.d) // the correct weekday index for a date
const wOf = (d) => (cOf(d) + 1) % 7 // a wrong index for a date
const reveal = (s) => gameReducer(s, { type: 'REVEAL', ...ctx, elapsed: null })
const neu = (s, nextDate) => gameReducer(s, { type: 'NEW', ...ctx, nextDate })
const back = (s) => gameReducer(s, { type: 'BACK' })
const forward = (s) => gameReducer(s, { type: 'FORWARD', useJulian: false })
const showCodesOpen = (s) => gameReducer(s, { type: 'SHOW_CODES', open: true, ...ctx, elapsed: null })
const answerAt = (s, idx, nextDate) =>
  gameReducer(s, { type: 'ANSWER', idx, ...ctx, tracking: false, elapsed: null, nextDate })
const answerTimed = (s, idx, elapsed, nextDate) =>
  gameReducer(s, { type: 'ANSWER', idx, ...ctx, tracking: true, elapsed, nextDate })
const answerComplete = (s, idx) =>
  gameReducer(s, { type: 'ANSWER', idx, ...ctx, tracking: false, elapsed: null, nextDate: D2, complete: true })
const override = (s, nextDate, extra = {}) =>
  gameReducer(s, { type: 'OVERRIDE', ...ctx, tracking: false, timingOff: true, nextDate, ...extra })

describe('score-integrity regressions (C2 fuzz fixes, 2026-06-06)', () => {
  it('a Reveal-miss is NOT recorded in history as a credit', () => {
    // Reveal (give up) then New: good stayed 0, so the pushed entry must NOT be a credit.
    const s = neu(reveal(initEngine(D1)), D2)
    expect(s.stats.good).toBe(0)
    expect(s.stack).toHaveLength(1)
    expect(s.stack[0].hasCredit).toBe(false) // was wrongly true → inflated a later streak recompute
  })

  it('two Reveal-misses + a back-browse Override never inflate streak/best past good', () => {
    let s = initEngine(D1)
    s = neu(reveal(s), D2) // Q1: reveal-miss, pushed
    s = neu(reveal(s), D3) // Q2: reveal-miss, pushed
    s = back(s) // browse Q2
    s = override(s, D3) // credit Q2
    // Q2 is now the only credit; Q1 stays a miss. good=1, streak=1, best=1 — NOT the buggy 2/2.
    expect(s.stats).toMatchObject({ played: 2, good: 1, streak: 1, best: 1 })
    expect(s.stats.streak).toBeLessThanOrEqual(s.stats.good)
    expect(s.stats.best).toBeLessThanOrEqual(s.stats.good)
  })

  it('reversing a completing (AoX) solve reverts best too, not just good/streak', () => {
    // Answer correct as a completing solve (stays on screen, reversible), then Override to flip it
    // to wrong. good/streak/best must ALL revert to 0 — best must not stay stranded at 1.
    let s = initEngine(D1)
    s = gameReducer(s, { type: 'ANSWER', idx: C, ...ctx, elapsed: null, tracking: false, complete: true })
    expect(s.stats).toMatchObject({ good: 1, streak: 1, best: 1 })
    s = override(s, D2, { noAdvance: true })
    expect(s.stats.good).toBe(0)
    expect(s.stats.best).toBe(0)
    expect(s.stats.best).toBeLessThanOrEqual(s.stats.good)
  })
})

// Three more app-reachable score-integrity bugs the C1 expanded fuzz (new weighting profiles) found
// + fixed (2026-06-07). Two are one family — a reversed first-try-correct removed its solve time by a
// stale ABSOLUTE index (`timesLen`), which a prior reversal had shifted, stranding a time
// (times.length > good); fixed by removing the time by VALUE (gameReducer.dropContributedTime). The
// third is Path 4 restoring `good` from a stale snapshot, clobbering a credit earned since (streak/
// best > good); fixed by incrementing the live `good` (and the now-dead snapshot was removed).
describe('score-integrity regressions (C1 expanded-fuzz fixes, 2026-06-07)', () => {
  it('two back-browse Path-1 reversals never strand a solve time (times.length ≤ good)', () => {
    let s = initEngine(D1)
    s = answerTimed(s, cOf(D1), 1.5, D2) // Q1 correct, records 1.5 → good 1, times [1.5]
    s = answerTimed(s, cOf(D2), 2.5, D3) // Q2 correct, records 2.5 → good 2, times [1.5, 2.5]
    expect(s.stats.times).toEqual([1.5, 2.5])
    s = back(s) // browse Q2
    s = back(s) // browse Q1 (oldest)
    s = override(s, D3) // Path 1: reverse Q1 → good 2→1, drop 1.5 → times [2.5]
    s = forward(s) // back to Q2
    s = override(s, D3) // Path 1: reverse Q2 → good 1→0; must drop 2.5 even though the array shrank
    expect(s.stats.good).toBe(0)
    expect(s.stats.times).toEqual([]) // was stranded at [2.5] — the stale index 1 missed it
    expect(s.stats.times.length).toBeLessThanOrEqual(s.stats.good)
  })

  it('a Path-5 retro reversal after an earlier removal never strands a solve time', () => {
    let s = initEngine(D1)
    s = answerTimed(s, cOf(D1), 1.0, D2) // Q1 → good 1, times [1.0]
    s = answerTimed(s, cOf(D2), 2.0, D3) // Q2 → good 2, times [1.0, 2.0]
    s = back(s)
    s = back(s) // browse Q1
    s = override(s, D3) // Path 1: reverse Q1 → good 1, drop 1.0 → times [2.0]
    s = forward(s)
    s = forward(s) // return to the live edge; stack = [Q1 miss, Q2 credit]
    s = override(s, D3) // Path 5: retro-reverse Q2 → good 0; must drop 2.0
    expect(s.stats.good).toBe(0)
    expect(s.stats.times).toEqual([]) // was stranded at [2.0]
    expect(s.stats.times.length).toBeLessThanOrEqual(s.stats.good)
  })

  it('a back-browse credit earned before a Path-4 override is not clobbered (streak/best ≤ good)', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // Q1 wrong (creditable later) → played 1, good 0
    s = neu(s, D2) // push Q1, advance to D2
    s = showCodesOpen(s) // burn D2 — captures a snapshot at good 0 (the stale one)
    s = back(s) // browse Q1 (D2's snapshot rides along in liveState)
    s = override(s, D2) // Path 1: credit Q1 → good 0→1 (the drift)
    s = neu(s, D3) // return to D2 + advance → arms Path 4 with the STALE good-0 snapshot
    s = override(s, D3) // Path 4: credit D2
    // Both Q1 and D2 are now credits. The old form set good = snap.good+1 = 1 while history held 2
    // credits → streak/best 2 > good 1. Now good reflects both.
    expect(s.stats).toMatchObject({ played: 2, good: 2, streak: 2, best: 2 })
    expect(s.stats.streak).toBeLessThanOrEqual(s.stats.good)
    expect(s.stats.best).toBeLessThanOrEqual(s.stats.good)
  })

  it('a back-browse credit is not wiped by a Path-2 live reversal (best ≤ good)', () => {
    // Found only by the deeper sweep (aox-complete profile, ~4900 sequences in). A completing (AoX)
    // solve stays live + reversible; a back-browse Path-1 credit then raises good; reversing the live
    // solve via Path 2 must drop only THAT solve's credit (good 2→1), not restore good to the live
    // solve's stale pre-answer snapshot (u.good 0), which wiped the browse credit while its history
    // entry kept hasCredit=true → a later best recompute counted the phantom (best > good).
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // Q1 wrong (creditable later)
    s = neu(s, D2) // push Q1, advance to D2
    s = answerComplete(s, cOf(D2)) // D2 first-try correct, stays live + reversible → good 1
    s = back(s) // browse Q1 (D2 saved live with its good-0 snapshot)
    s = override(s, D2) // Path 1: credit Q1 → good 1→2 (the browse credit)
    s = forward(s) // return to live D2 (restores canOverrideCorrect + the stale good-0 snapshot)
    s = override(s, D3) // Path 2: reverse D2 → must keep Q1's credit (good 2→1, NOT →0)
    expect(s.stats.good).toBe(1)
    expect(s.stats.best).toBeLessThanOrEqual(s.stats.good)
    expect(s.stats.streak).toBeLessThanOrEqual(s.stats.good)
    expect(s.stack[s.stack.length - 1].hasCredit).toBe(true) // Q1 stays a real credit
  })
})
