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
import { checkStrongScoreOracle } from './fuzzHarness.js'

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

// The C1 DEEPER-fuzz fix (2026-06-08): an EXACT score oracle (good == reconstructed credits, plus
// best + clean-edge streak — not just the inequalities) on the Classic/Deduction fuzz surface caught
// a streak bug the inequalities couldn't: a back-browse Override credits an OLDER entry while a
// more-recent LIVE question is a scored MISS — but the streak recompute (streaksFromStacks) EXCLUDES
// the live question, so it counted the streak PAST that miss (streak stayed ≤ good, so it slipped the
// good≤played / streak≤good checks). The inflated streak then inflated `best` via the next correct
// answer's Math.max. Fixed in gameReducer Path 1 by folding the live question's true contribution
// (liveStreakContribution: a scored miss → trailing 0, a scored live credit → +1) into the recompute.
describe('score-integrity regressions (C1 deeper-fuzz fix, 2026-06-08)', () => {
  it('a back-browse Override does not count the streak past a more-recent live MISS', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // Q1 wrong (creditable later) → played 1, good 0
    s = neu(s, D2) // push Q1 (miss), advance to D2
    s = reveal(s) // burn D2 = a scored MISS, still LIVE (not advanced)
    s = back(s) // browse Q1; the live D2-miss parks in forwardStack as isLive
    s = override(s, D3) // Path 1: credit Q1 — must NOT count the streak past the live D2 miss
    expect(s.stats).toMatchObject({ good: 1, streak: 0, best: 1 }) // was streak 1 (live miss skipped)
    s = neu(s, D3) // advance the D2 miss into history; at a clean edge the streak stays 0
    expect(s.stats).toMatchObject({ played: 2, good: 1, streak: 0, best: 1 })
    expect(s.stats.streak).toBeLessThanOrEqual(s.stats.good)
  })

  it('a streak inflated past a live miss does not later inflate best (downstream of the same bug)', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // Q1 wrong
    s = neu(s, D2) // push Q1 miss, at D2
    s = reveal(s) // burn D2 (scored miss, still live)
    s = back(s) // browse Q1
    s = override(s, D3) // credit Q1; streak must be 0 (live D2 miss), not 1
    s = neu(s, D3) // advance the D2 miss → clean edge, streak 0
    s = answerAt(s, cOf(D3), D1) // answer D3 correct → streak 1 (NOT 2); best stays the true max run = 1
    expect(s.stats).toMatchObject({ good: 2, streak: 1, best: 1 }) // was best 2 (inflated by the bad streak)
    expect(s.stats.best).toBeLessThanOrEqual(s.stats.good)
  })
})

// The C2 fuzz fix (2026-06-08): opening Show Codes on a HELD completing (AoX) solve must be a read-only
// review, not a burn. A completing solve credits good but stays on the question (locked + reversible,
// canOverrideCorrect); the SHOW_CODES penalty assumed an UNANSWERED live question, so it counted a
// phantom played + reset the streak + cleared the credit flag while good kept the credit — desyncing
// good from the reconstructable credit history (good > credits), and (on the next advance) recording
// the credited solve as a miss. Found by the new aox-strong strong-oracle profile (the EXACT oracle,
// extended to the AoX-complete surface). Fixed in gameReducer SHOW_CODES (penalty-free when
// canOverrideCorrect, like the back-browse review).
describe('score-integrity regressions (C2 fuzz fix — Show Codes on a held complete, 2026-06-08)', () => {
  it('Show Codes on a held completing solve does not burn it (good stays a real credit)', () => {
    let s = initEngine(D1)
    s = answerComplete(s, C) // D1 first-try correct, HELD as a completing solve → good 1, reversible
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1, best: 1 })
    expect(s.canOverrideCorrect).toBe(true)
    s = showCodesOpen(s) // review the codes on the finished solve
    // No burn: stats untouched, the credit stays reversible, the panel opened.
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1, best: 1 }) // was 1/2 streak 0 (burned)
    expect(s.canOverrideCorrect).toBe(true) // still reversible (was cleared)
    expect(s.countedWrong).toBe(false) // not burned (was true)
    expect(s.calcOpen).toBe(true)
  })

  it('advancing after a reviewed completing solve records it as a credit, not a phantom miss', () => {
    let s = initEngine(D1)
    s = answerComplete(s, C) // held credit → good 1
    s = showCodesOpen(s) // review (penalty-free)
    s = neu(s, D2) // advance the completing solve into history
    // The credited solve enters history AS a credit — good == reconstructable credits, no phantom.
    expect(s.stats.good).toBe(1)
    expect(s.stack[s.stack.length - 1].hasCredit).toBe(true) // was false (revealed/countedWrong → mislabelled)
    expect(s.stats.good).toBeLessThanOrEqual(s.stats.played)
  })
})

// Two more C2 fuzz fixes (2026-06-08), found by the new timed-strong strong-oracle profile — the
// Blitz timeout surface (LOCK_REVEAL = per-round timeout, no stat; TIMEOUT_MISS = per-question miss).
// Both are the recurring family: a question that LOOKS answered (a synthesized 'correct' grid) but was
// never PLAYED leaks into the credit history and desyncs the streak from `good`. Pinned at the engine
// level — both require a countdown to expire, impractical to drive through the rAF timer in jsdom;
// the reducer drives the exact reachable action sequence (the strong oracle confirms full consistency).
describe('score-integrity regressions (C2 timed-mode fuzz fixes, 2026-06-08)', () => {
  // helpers (timingOff:false so Override Path 4 actually advances; the file's `override` uses timingOff:true)
  const lockReveal = (s) => gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false })
  const timeoutMiss = (s) => gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true })
  const overrideAdvance = (s, nextDate) =>
    gameReducer(s, { type: 'OVERRIDE', ...ctx, tracking: false, timingOff: false, nextDate })

  it('a Path-4 override after a per-round timeout (LOCK_REVEAL) does not push the unplayed question', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // D1 wrong → played 1, good 0, countedWrong
    s = answerAt(s, cOf(D1), D2) // D1 right (late) → advance to D2, arm pendingWrongOverride; D1 pushed as a miss
    s = lockReveal(s) // Blitz per-round timeout: shows D2's answer WITHOUT counting it as played
    s = overrideAdvance(s, D3) // Path 4: credit D1 + advance past D2
    // D2 was never played, so it must NOT enter history — pushing it added a PHANTOM miss that left
    // streak(1) ≠ the polluted stack's trailing run (0).
    expect(s.stats.good).toBe(1) // D1 credited
    expect(s.stack).toHaveLength(1) // only D1 — the LOCK_REVEAL'd D2 is NOT recorded (was a phantom)
    expect(checkStrongScoreOracle(s)).toEqual([]) // good/best/streak all consistent with history
  })

  it('reviewing the codes on a per-round-timeout question keeps it unplayed (no phantom on advance)', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // D1 wrong
    s = answerAt(s, cOf(D1), D2) // D1 right (late) → advance to D2, arm pendingWrongOverride
    s = lockReveal(s) // D2 per-round timeout (shown, never played)
    s = showCodesOpen(s) // review the codes on D2 — must stay read-only (NOT mark D2 as "scored")
    s = overrideAdvance(s, D3) // Path 4: credit D1 + advance past D2
    // Without the review-only-on-revealed fix, Show Codes set saveStatsThisQ on D2, defeating the
    // advance scored-gate → D2 got pushed as a phantom miss.
    expect(s.stack).toHaveLength(1) // still only D1
    expect(checkStrongScoreOracle(s)).toEqual([])
  })

  it('a per-question timeout (TIMEOUT_MISS) locks the grid so the resolved question cannot be answered', () => {
    let s = initEngine(D1)
    s = timeoutMiss(s) // sudden-death timeout: played 1, a miss, answer shown — and the round is OVER
    expect(s.locked).toBe(true) // resolved → locked (was unlocked, leaving the question answerable)
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    const before = s.stats
    // Answering the resolved question must be a no-op — else it credits good (0→1) and advance pushes
    // it to history as a REVEALED non-credit, so good (1) > reconstructable credits (0).
    s = gameReducer(s, { type: 'ANSWER', idx: C, ...ctx, tracking: false, elapsed: null, nextDate: D2, complete: false })
    expect(s.stats).toEqual(before) // unchanged — was wrongly credited to good 1 without the lock
    expect(checkStrongScoreOracle(s)).toEqual([])
  })
})
