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
//
// ⚠ "PATH 1…5" BELOW ARE HISTORICAL NAMES. Until round 23 Q6 the Override was five hand-written
// paths; it is now ONE per-card toggle (gameReducer's OVERRIDE, targeted by overrideTarget). Each
// regression keeps the name of the path it was found in because that is how the bug was reported,
// and each still drives the same sequence against the toggle: Path 1 is today's 'browsed' target,
// Paths 2/3 are the 'live' target (taking a held credit away / crediting a burned card), and Paths
// 4/5 are the 'retro' target (the card just behind a fresh live question).
import { describe, it, expect } from 'vitest'
import { gameReducer, initEngine, liveCredited } from '../../src/engine/gameReducer.js'
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
const showCodesOpen = (s) =>
  gameReducer(s, { type: 'SHOW_CODES', open: true, ...ctx, elapsed: null })
const answerAt = (s, idx, nextDate) =>
  gameReducer(s, { type: 'ANSWER', idx, ...ctx, tracking: false, elapsed: null, nextDate })
const answerTimed = (s, idx, elapsed, nextDate) =>
  gameReducer(s, { type: 'ANSWER', idx, ...ctx, tracking: true, elapsed, nextDate })
const answerComplete = (s, idx) =>
  gameReducer(s, {
    type: 'ANSWER',
    idx,
    ...ctx,
    tracking: false,
    elapsed: null,
    nextDate: D2,
    complete: true,
  })
// The one button (round 23 Q6: a per-card toggle — no direction, no timing flag; see gameReducer).
const override = (s, nextDate, extra = {}) =>
  gameReducer(s, { type: 'OVERRIDE', ...ctx, tracking: false, nextDate, ...extra })

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
    s = gameReducer(s, {
      type: 'ANSWER',
      idx: C,
      ...ctx,
      elapsed: null,
      tracking: false,
      complete: true,
    })
    expect(s.stats).toMatchObject({ good: 1, streak: 1, best: 1 })
    s = override(s, D2) // takes the held credit away (the card stays on screen as a miss)
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
    s = neu(s, D3) // return to D2 + advance (D2 pushed as a miss)
    s = override(s, D3) // the retro toggle: credit D2 (the old Path 4)
    // Both Q1 and D2 are now credits. The old Path 4 set good = snap.good+1 = 1 while history held 2
    // credits → streak/best 2 > good 1. Since round 23 there is no snapshot to be stale — a toggle
    // moves good by exactly one, read off the card — and good reflects both.
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
    s = forward(s) // return to live D2, still held
    s = override(s, D3) // the live toggle: take D2's credit away → must keep Q1's (good 2→1, NOT →0)
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
// (a scored miss → trailing 0, a scored live credit → +1) into the recompute — since round 23 that
// fold is part of the one credit sequence every toggle recomputes from (gameReducer creditSequence).
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
// review, not a burn. A completing solve credits good but stays on the question (locked + reversible);
// the SHOW_CODES penalty assumed an UNANSWERED live question, so it counted a
// phantom played + reset the streak + cleared the credit flag while good kept the credit — desyncing
// good from the reconstructable credit history (good > credits), and (on the next advance) recording
// the credited solve as a miss. Found by the new aox-strong strong-oracle profile (the EXACT oracle,
// extended to the AoX-complete surface). Fixed in gameReducer SHOW_CODES (penalty-free on a credited
// live card — liveCredited, which replaced the old canOverrideCorrect flag — like the back-browse review).
describe('score-integrity regressions (C2 fuzz fix — Show Codes on a held complete, 2026-06-08)', () => {
  it('Show Codes on a held completing solve does not burn it (good stays a real credit)', () => {
    let s = initEngine(D1)
    s = answerComplete(s, C) // D1 first-try correct, HELD as a completing solve → good 1, reversible
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1, best: 1 })
    expect(liveCredited(s)).toBe(true)
    s = showCodesOpen(s) // review the codes on the finished solve
    // No burn: stats untouched, the credit stays reversible, the panel opened.
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1, best: 1 }) // was 1/2 streak 0 (burned)
    expect(liveCredited(s)).toBe(true) // still a credit, still the Override target (was burned)
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
  const lockReveal = (s) => gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false })
  const timeoutMiss = (s) =>
    gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true })

  it('an Override after a per-round timeout (LOCK_REVEAL) never pushes the unplayed question', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // D1 wrong → played 1, good 0, countedWrong
    s = answerAt(s, cOf(D1), D2) // D1 right (late) → advance to D2; D1 pushed as a miss
    s = lockReveal(s) // Blitz per-round timeout: shows D2's answer WITHOUT counting it as played
    s = override(s, D3) // the retro toggle credits D1 (it used to credit AND advance past D2)
    s = neu(s, D3) // …and moving on past D2 anyway
    // D2 was never played, so it must NOT enter history — pushing it added a PHANTOM miss that left
    // streak(1) ≠ the polluted stack's trailing run (0).
    expect(s.stats.good).toBe(1) // D1 credited
    expect(s.stack).toHaveLength(1) // only D1 — the LOCK_REVEAL'd D2 is NOT recorded (was a phantom)
    expect(checkStrongScoreOracle(s)).toEqual([]) // good/best/streak all consistent with history
  })

  it('reviewing the codes on a per-round-timeout question keeps it unplayed (no phantom on advance)', () => {
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2) // D1 wrong
    s = answerAt(s, cOf(D1), D2) // D1 right (late) → advance to D2
    s = lockReveal(s) // D2 per-round timeout (shown, never played)
    s = showCodesOpen(s) // review the codes on D2 — must stay read-only (NOT mark D2 as "scored")
    s = override(s, D3) // credit D1
    s = neu(s, D3) // advance past D2
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
    s = gameReducer(s, {
      type: 'ANSWER',
      idx: C,
      ...ctx,
      tracking: false,
      elapsed: null,
      nextDate: D2,
      complete: false,
    })
    expect(s.stats).toEqual(before) // unchanged — was wrongly credited to good 1 without the lock
    expect(checkStrongScoreOracle(s)).toEqual([])
  })
})

describe('score-integrity regressions (C2 Session-6 — TIMEOUT_MISS engine-consistency guards)', () => {
  const timeoutMiss = (s) => gameReducer(s, { type: 'TIMEOUT_MISS', ...ctx })

  it('TIMEOUT_MISS on a LOCKED question is a no-op (the question is already resolved)', () => {
    // A per-question timeout can only hit the active live question in the app (the round ends with
    // it), but the ENGINE must not rely on the component for that: a resolved/locked question must
    // not take another stat. ANSWER already guards on `locked`; TIMEOUT_MISS now does too.
    const locked = gameReducer(initEngine(D1), { type: 'LOCK_REVEAL', useJulian: false })
    expect(locked.locked).toBe(true)
    const s = timeoutMiss(locked)
    expect(s).toEqual(locked) // identical state — no played increment, no flag churn
  })

  it('TIMEOUT_MISS on an already-burned (countedWrong) question does not count played AGAIN', () => {
    // The wrong answer already took the question's played increment; a timeout resolving the same
    // question must not double-count it (played is one-per-question, like every other stat path).
    const wrong = answerAt(initEngine(D1), wOf(D1), D2) // burned: played 1, streak 0
    expect(wrong.stats.played).toBe(1)
    expect(wrong.countedWrong).toBe(true)
    const s = timeoutMiss(wrong)
    expect(s.stats.played).toBe(1) // NOT 2
    expect(s.locked).toBe(true) // still resolves the question (locks + reveals)
    expect(s.revealed).toBe(true)
  })
})

// The Session-6 flip-flop, which the independent reference model caught (ref-full seed 10000013):
// a held completing solve overridden to a miss, advanced past, then overridden AGAIN back to a
// credit. Under the old one-override-per-question contract that second credit was a bug and was
// blocked. Round 23 Q6 made it the SPECIFIED behaviour — the owner's rule is that every card can be
// toggled back, forever — and what makes it safe is that the second press is no longer a new
// credit at all: it is the card returning to the state it was answered in, with that state's OWN
// time (not its wrongTime, which a held first-try solve never had). This pins exactly that.
describe('score-integrity regressions (the Session-6 flip-flop, now the specified toggle)', () => {
  it('a reversed held credit, advanced past, toggles back to its own credit and time — and no further', () => {
    let s = gameReducer(initEngine(D1), {
      type: 'ANSWER',
      idx: cOf(D1),
      ...ctx,
      tracking: true,
      elapsed: 1.2,
      nextDate: D2,
      complete: true,
    })
    expect(s.stats).toMatchObject({ played: 1, good: 1, times: [1.2] })
    s = override(s, D2) // take it away: it stays on screen as a miss
    expect(s.stats).toMatchObject({ played: 1, good: 0, times: [] })
    s = neu(s, D3) // advance past it — it enters history in its overridden state
    expect(s.stats.played).toBe(1)
    const flips = []
    for (let i = 0; i < 6; i++) {
      s = override(s, D3) // Undo, Override, Undo, …
      flips.push([s.stats.good, s.stats.times.join()])
      expect(checkStrongScoreOracle(s)).toEqual([])
    }
    // Exactly two positions, and the credited one carries the card's own 1.2s — never more.
    expect(flips).toEqual([
      [1, '1.2'],
      [0, ''],
      [1, '1.2'],
      [0, ''],
      [1, '1.2'],
      [0, ''],
    ])
  })
})

describe('hydration score integrity — Best/Streak survive Override after a load-from-prior-session (2026-06-20)', () => {
  // The continuous modes (Classic/Flash/Deduction) HYDRATE lifetime stats on mount but NOT the history
  // behind them, so the in-session stack is EMPTY while `best`/`streak` carry a prior-session record.
  // Before the fix, all 5 OVERRIDE paths recomputed streak/best from the empty stack via
  // streaksFromStacks and COLLAPSED both to the current in-session run — the owner-reported bug "best
  // streak gets reset to match the current streak". `good`/`played`/`times` were always safe
  // (incremental, never recomputed). The fix folds the hydrated baseline into the recompute:
  // `bestFloor` (= hydrated best, a high-water floor the recompute can't drop below) + `streakCarry`
  // (= hydrated trailing streak, prepended as leading credits so a corrected miss continues the prior
  // run). These pin that a hydrated record survives every Override route; the hydrated-start fuzz
  // dimension (fuzzHarness) is the broad net. A blank start (carry/floor 0) is unaffected — covered above.
  const hydrate = () => initEngine(D1, { played: 50, good: 50, streak: 5, best: 50, times: [] })

  it('Path 3 (credit a live wrong): best floor held at 50, streak carried to 6 (was 1/1)', () => {
    let s = hydrate()
    s = answerAt(s, wOf(D1), D2) // wrong → streak 0, played 51, good 50
    s = override(s, D2) // Path 3: credit the corrected miss → it continues the prior run
    expect(s.stats.best).toBe(50) // floor held (was collapsing to 1)
    expect(s.stats.streak).toBe(6) // 5 prior + this corrected (was collapsing to 1)
    expect(s.stats.good).toBe(51) // good was always safe (incremental)
    expect(s.stats.played).toBe(51)
  })

  it('Path 4 (retro-credit the previous wrong): best 50, streak 6 (was 1/1)', () => {
    let s = hydrate()
    s = answerAt(s, wOf(D1), D2) // wrong (played 51, good 50, streak 0, countedWrong)
    s = neu(s, D3) // advance; live D3 fresh
    s = override(s, D3) // the retro toggle: credit the previous wrong (it never advances)
    expect(s.stats.best).toBe(50)
    expect(s.stats.streak).toBe(6)
    expect(s.stats.good).toBe(51)
    expect(s.stats.played).toBe(51)
  })

  it('Path 5 (retro-reverse a correct): best floor held at 50 even as the run breaks (was 0/0)', () => {
    let s = hydrate()
    s = answerAt(s, cOf(D1), D2) // correct → good 51, streak 6, best 50; advance, pushes the correct
    s = override(s, D2) // Path 5: retro-flip the last correct to wrong
    expect(s.stats.best).toBe(50) // the prior record survives (was collapsing to 0)
    expect(s.stats.streak).toBe(0) // the latest is now wrong → trailing 0
    expect(s.stats.good).toBe(50) // the in-session credit removed
    expect(s.stats.played).toBe(51)
  })

  it('a blank start is unchanged — best/streak still recompute exactly from the in-session history', () => {
    // Same Path-3 sequence with NO hydration: carry/floor are 0, so the recompute is byte-identical
    // to before the fix (best == the in-session run). Guards against the fix altering blank behavior.
    let s = initEngine(D1)
    s = answerAt(s, wOf(D1), D2)
    s = override(s, D2)
    expect(s.stats.best).toBe(1)
    expect(s.stats.streak).toBe(1)
    expect(s.stats.good).toBe(1)
  })
})
