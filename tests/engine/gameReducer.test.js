// Unit tests for the pure game reducer — CORE lifecycle (Stage C, Step 6, sub-step 1b).
// Deterministic: a fixed Gregorian date (so activeWday === wday) and explicit payloads.
// These mirror the Classic characterization (tests/classic.dom) at the reducer level —
// the two must agree, which is what makes wiring the reducer into App (1c) safe.
import { describe, it, expect } from 'vitest'
import { gameReducer, initEngine, cardNumber } from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'

const DATE = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const NEXT = { y: 2025, m: 6, d: 15, _fmt: 'numeric-ymd', _jul: false }
const C = wday(2024, 1, 1) // the correct weekday index for the fixed date
const W = (C + 1) % 7 // a wrong index

// Default play context: Gregorian, Save Stats on, timing hidden (Classic default).
const ctx = { useJulian: false, saveStats: true, tracking: false }
const answer = (s, idx, extra = {}) =>
  gameReducer(s, { type: 'ANSWER', idx, nextDate: NEXT, ...ctx, ...extra })
const reveal = (s, extra = {}) => gameReducer(s, { type: 'REVEAL', ...ctx, ...extra })
const showCodes = (s, open = true, extra = {}) =>
  gameReducer(s, { type: 'SHOW_CODES', open, ...ctx, ...extra })
const neu = (s, extra = {}) => gameReducer(s, { type: 'NEW', nextDate: NEXT, ...ctx, ...extra })
const override = (s, extra = {}) =>
  gameReducer(s, {
    type: 'OVERRIDE',
    useJulian: false,
    tracking: false,
    timingOff: true,
    nextDate: NEXT,
    ...extra,
  })
const back = (s) => gameReducer(s, { type: 'BACK' })
const forward = (s) => gameReducer(s, { type: 'FORWARD', useJulian: false })

describe('gameReducer — initial state', () => {
  it('starts at a clean slate', () => {
    const s = initEngine(DATE)
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
    expect(s.date).toBe(DATE)
    expect(s.stack).toEqual([])
    expect(s.countedWrong).toBe(false)
    expect(s.locked).toBe(false)
  })
})

describe('gameReducer — ANSWER', () => {
  it('first-try correct: credits 1/1/streak 1, advances, pushes a credited history entry', () => {
    const s = answer(initEngine(DATE), C)
    expect(s.stats).toEqual({ played: 1, good: 1, streak: 1, best: 1, times: [] })
    expect(s.date).toBe(NEXT) // advanced
    expect(s.persistBtns).toEqual({}) // fresh grid
    expect(s.stack).toHaveLength(1)
    expect(s.stack[0].hasCredit).toBe(true)
    expect(s.stack[0].btns).toEqual({ [C]: 'correct' })
    // The history entry carries the pre-answer snapshot (so Override can reverse it later).
    // contributedTime is null here — timing is hidden (tracking off), so no solve time was recorded.
    expect(s.stack[0].capsule.snapshot).toEqual({
      played: 0,
      good: 0,
      streak: 0,
      best: 0,
      timesLen: 0,
      wasWrong: false,
      contributedTime: null,
    })
    expect(s.pendingWrongOverride).toBe(null)
  })

  it('wrong: counts as played, streak 0, marks the button, does NOT advance, arms snapshot', () => {
    const s = answer(initEngine(DATE), W, { elapsed: 0.5 })
    expect(s.stats).toEqual({ played: 1, good: 0, streak: 0, best: 0, times: [] })
    expect(s.date).toBe(DATE) // not advanced
    expect(s.persistBtns).toEqual({ [W]: 'wrong-latest' })
    expect(s.countedWrong).toBe(true)
    expect(s.wrongTime).toBe(0.5)
    expect(s.prevStatsSnapshot.wasWrong).toBe(true)
  })

  it('correct after a wrong on the same question: no extra credit, advances, arms pendingWrongOverride', () => {
    let s = answer(initEngine(DATE), W) // 0/1, burned
    s = answer(s, C) // late-correct
    expect(s.stats).toEqual({ played: 1, good: 0, streak: 0, best: 0, times: [] }) // no credit
    expect(s.date).toBe(NEXT) // advanced
    expect(s.pendingWrongOverride).not.toBe(null) // Path 4 armed
    expect(s.stack).toHaveLength(1) // the wrong-then-right entry was pushed
  })

  it('builds streak across correct answers; a wrong resets current but keeps best', () => {
    let s = answer(initEngine(DATE), C) // 1/1, streak 1
    s = answer({ ...s, date: DATE }, C) // 2/2, streak 2  (reset date so C is correct again)
    expect(s.stats).toMatchObject({ played: 2, good: 2, streak: 2, best: 2 })
    s = answer({ ...s, date: DATE }, W) // wrong → 2/3, streak 0, best 2
    expect(s.stats).toMatchObject({ played: 3, good: 2, streak: 0, best: 2 })
  })

  it('with timing on, a correct answer records the solve time', () => {
    const s = answer(initEngine(DATE), C, { tracking: true, elapsed: 1.5 })
    expect(s.stats.times).toEqual([1.5])
    expect(s.stats).toMatchObject({ played: 1, good: 1 })
  })

  it('with Save Stats off, a wrong answer is not counted and the freeze is recorded', () => {
    const s = answer(initEngine(DATE), W, { saveStats: false })
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] }) // not counted
    expect(s.countedWrong).toBe(true) // question state still progresses
    expect(s.persistBtns).toEqual({ [W]: 'wrong-latest' })
    expect(s.saveStatsThisQ).toBe(false) // frozen
  })

  it('does nothing while locked', () => {
    const locked = { ...initEngine(DATE), locked: true }
    expect(answer(locked, C)).toBe(locked)
  })
})

describe('gameReducer — REVEAL', () => {
  it('burns a fresh question: played 1, streak 0, shows the answer, locks', () => {
    const s = reveal(initEngine(DATE))
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(s.locked).toBe(true)
    expect(s.revealed).toBe(true)
    expect(s.countedWrong).toBe(true)
  })

  it('is penalty-free on an unanswered back-browsed entry', () => {
    const browsing = { ...initEngine(DATE), locked: true, backDepth: 1 }
    const s = reveal(browsing)
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] }) // no penalty
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(s.revealed).toBe(true)
  })
})

describe('gameReducer — SHOW_CODES', () => {
  it('opening on a fresh question applies the penalty and reveals the answer', () => {
    const s = showCodes(initEngine(DATE), true)
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(s.calcOpen).toBe(true)
    expect(s.calcPenaltyActive).toBe(true)
    expect(s.countedWrong).toBe(true)
  })

  it('closing just hides the panel (no stat change)', () => {
    const open = showCodes(initEngine(DATE), true)
    const closed = showCodes(open, false)
    expect(closed.calcOpen).toBe(false)
    expect(closed.stats).toEqual(open.stats)
  })
})

describe('gameReducer — NEW', () => {
  it('from a fresh unanswered question: regenerates, no history push, stats untouched', () => {
    const s = neu(initEngine(DATE))
    expect(s.date).toBe(NEXT)
    expect(s.stack).toEqual([])
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
  })

  it('after a wrong answer: pushes the entry, advances, arms pendingWrongOverride', () => {
    let s = answer(initEngine(DATE), W) // burned, not advanced
    s = neu(s)
    expect(s.stack).toHaveLength(1)
    expect(s.date).toBe(NEXT)
    expect(s.pendingWrongOverride).not.toBe(null)
  })
})

describe('gameReducer — RESET', () => {
  it('clears stats + history; keeps the (unburned) date when timing is hidden', () => {
    let s = answer(initEngine(DATE), C) // 1/1, now on NEXT, unburned
    s = gameReducer(s, { type: 'RESET', timingOff: true, nextDate: DATE })
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
    expect(s.stack).toEqual([])
    expect(s.date).toBe(NEXT) // kept (unburned + timing hidden)
  })

  it('regenerates the date when the current question was burned', () => {
    let s = answer(initEngine(DATE), W) // burned (countedWrong), still on DATE
    s = gameReducer(s, { type: 'RESET', timingOff: true, nextDate: NEXT })
    expect(s.date).toBe(NEXT) // regenerated
    expect(s.stats.played).toBe(0)
  })
})

describe('gameReducer — OVERRIDE', () => {
  it('Path 5 (correct then Override): retro-flips the just-answered entry to wrong (1/1 → 0/1)', () => {
    let s = answer(initEngine(DATE), C) // 1/1, advanced; stack[0] is the credited DATE entry
    s = override(s) // live Q untouched → Path 5 flips the entry
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.stack[0].btns).toEqual({ [C]: 'override-wrong' })
    expect(s.stack[0].hasCredit).toBe(false)
    expect(s.overrideUsedThisQ).toBe(true)
  })

  it('Path 3 (wrong then Override): credits the wrong answer and advances (0/1 → 1/1)', () => {
    let s = answer(initEngine(DATE), W) // 0/1, burned, not advanced
    s = override(s)
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1 })
    expect(s.date).toBe(NEXT) // advanced
    expect(s.stack).toHaveLength(1)
    expect(s.stack[0].overrideUsed).toBe(true)
  })

  it('Path 4 (wrong-then-right then Override): credits the previous question; live Q stays (timing off)', () => {
    let s = answer(initEngine(DATE), W) // 0/1
    s = answer(s, C) // late-correct: advances to NEXT, arms pendingWrongOverride
    s = override(s)
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1 })
    expect(s.date).toBe(NEXT) // not advanced again (timing off)
    expect(s.stack[0].hasCredit).toBe(true)
  })

  it('Path 1 (Back to a correct answer then Override): undoes the credit (1/1 → 0/1)', () => {
    let s = answer(initEngine(DATE), C) // 1/1, advanced
    s = back(s) // browse the credited entry; canOverrideCorrect restored
    expect(s.canOverrideCorrect).toBe(true)
    s = override(s) // delta-undo
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.persistBtns).toEqual({ [C]: 'override-wrong' })
  })

  it('Path 2 (live canOverrideCorrect, timing off): undoes a correct in place without advancing', () => {
    // Path 2 isn't reached in normal Classic flow (advance clears canOverrideCorrect); exercise it directly.
    const armed = {
      ...initEngine(DATE),
      canOverrideCorrect: true,
      prevStatsSnapshot: { played: 5, good: 5, streak: 5, best: 6, timesLen: 0, wasWrong: false },
      stats: { played: 6, good: 6, streak: 6, best: 6, times: [] },
    }
    const s = override(armed)
    expect(s.stats).toMatchObject({ played: 6, good: 5, streak: 0 }) // played u+1, good kept, streak 0
    expect(s.countedWrong).toBe(true)
    expect(s.locked).toBe(false) // timing-off branch leaves the live Q open
    expect(s.date).toBe(DATE) // not advanced
  })
})

describe('gameReducer — BACK / FORWARD', () => {
  it('Back then Forward round-trips without changing stats', () => {
    let s = answer(initEngine(DATE), C) // 1/1, on NEXT; stack=[DATE]
    s = back(s)
    expect(s.backDepth).toBe(1)
    expect(s.stack).toHaveLength(0)
    expect(s.forwardStack).toHaveLength(1)
    expect(s.date.y).toBe(DATE.y) // viewing the prior question
    expect(s.stats).toMatchObject({ played: 1, good: 1 }) // browsing doesn't change stats

    s = forward(s)
    expect(s.backDepth).toBe(0)
    expect(s.forwardStack).toHaveLength(0)
    expect(s.stack).toHaveLength(1) // prior question pushed back
    expect(s.date.y).toBe(NEXT.y) // back at the live edge
    expect(s.stats).toMatchObject({ played: 1, good: 1 })
  })

  it('Back is a no-op with empty history', () => {
    const s = initEngine(DATE)
    expect(back(s)).toBe(s)
  })
})

describe('gameReducer — LOCK_REVEAL / TIMEOUT_MISS (Blitz timeouts)', () => {
  it('LOCK_REVEAL shows the answer + locks, with NO stat change (per-round timeout)', () => {
    const s = gameReducer(initEngine(DATE), { type: 'LOCK_REVEAL', useJulian: false })
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(s.locked).toBe(true)
    expect(s.revealed).toBe(true)
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] }) // no stat
    expect(s.countedWrong).toBe(false) // no Override path opens
  })

  it('TIMEOUT_MISS counts a played miss + shows the answer (per-question timeout)', () => {
    const s = gameReducer(initEngine(DATE), {
      type: 'TIMEOUT_MISS',
      useJulian: false,
      saveStats: true,
    })
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(s.countedWrong).toBe(false) // distinct from REVEAL — no Override path
  })
})

describe('gameReducer — REGEN_DATE', () => {
  const regen = (s) => gameReducer(s, { type: 'REGEN_DATE', nextDate: NEXT })

  it('swaps a fresh live date in place (no history push, no stat change)', () => {
    const s = regen(initEngine(DATE))
    expect(s.date).toBe(NEXT)
    expect(s.stack).toEqual([])
    expect(s.stats).toEqual({ played: 0, good: 0, streak: 0, best: 0, times: [] })
    expect(s.questionId).toBe(1) // bumped → solve-timer restarts
  })

  it('keeps a burned date (wrong / Reveal / Show Codes)', () => {
    const burned = answer(initEngine(DATE), W) // countedWrong, still on DATE
    expect(regen(burned).date).toBe(DATE)
  })

  it('never regenerates while browsing history', () => {
    let s = answer(initEngine(DATE), C) // advance → stack has the prior Q
    s = back(s) // backDepth > 0
    expect(regen(s).date).toBe(s.date) // unchanged
  })
})

describe('gameReducer — RESET_ROUND', () => {
  it('clears history + current-question state but keeps stats and date', () => {
    let s = answer(initEngine(DATE), C) // 1/1, advanced; stack has one entry
    s = answer({ ...s, date: DATE }, W) // wrong on the new Q → countedWrong, stack still has 1
    const kept = s.stats
    s = gameReducer(s, { type: 'RESET_ROUND' })
    expect(s.stats).toBe(kept) // stats survive
    expect(s.stack).toEqual([])
    expect(s.countedWrong).toBe(false)
    expect(s.persistBtns).toEqual({})
    expect(s.date).toBe(DATE) // date kept
  })
})

// Q9: gridEpoch — the grid-remount key. The UI keys every answer grid on it, so a bump REMOUNTS
// the grid and the cleared colors snap to idle (no green fade). It must bump on the TWO resets
// ONLY: a bump on advance / REGEN_DATE would remount mid-flash and restart the keyframes.
describe('gameReducer — gridEpoch (Q9: bumps on the two resets only)', () => {
  it('starts at 0', () => {
    expect(initEngine(DATE).gridEpoch).toBe(0)
  })

  it('RESET bumps it — carried across the initEngine spread, not re-zeroed', () => {
    let s = { ...answer(initEngine(DATE), C), gridEpoch: 4 }
    s = gameReducer(s, { type: 'RESET', timingOff: true, nextDate: NEXT })
    expect(s.gridEpoch).toBe(5)
  })

  it('RESET_ROUND bumps it', () => {
    let s = answer(initEngine(DATE), C)
    s = gameReducer(s, { type: 'RESET_ROUND' })
    expect(s.gridEpoch).toBe(1)
  })

  it('no other action bumps it (answer/advance, New, regen, Reveal, Show Codes, Override, Back/Forward, timeouts)', () => {
    let s = answer(initEngine(DATE), W) // wrong — stays
    s = answer(s, C) // late-correct — advances
    s = neu(s) // NEW — advances again
    s = gameReducer(s, { type: 'REGEN_DATE', nextDate: DATE }) // regen in place
    s = reveal(s) // burn
    s = showCodes(s) // read-only review (already revealed)
    s = override(s) // Path 3 — credits + advances
    s = back(s) // browse back
    s = forward(s) // return to the live edge
    s = gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true }) // counted miss + lock
    s = gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false }) // per-round timeout mark
    expect(s.gridEpoch).toBe(0)
  })
})

// The two general flags AoX adds (Stage C, Step 5 fold). `complete` = credit-and-stay (the run's
// last solve); `noAdvance` = override-without-advancing (the failing reversal of that solve). The
// one-question-loop modes never pass either, so their behavior is unchanged (regressions below).
describe('gameReducer — complete (AoX last solve) + noAdvance (AoX failing override)', () => {
  it('ANSWER complete: credits the correct answer but does NOT advance — marks, locks, stays, reversible', () => {
    const s = answer(initEngine(DATE), C, { complete: true, elapsed: 0.5, tracking: true })
    expect(s.stats).toEqual({ played: 1, good: 1, streak: 1, best: 1, times: [0.5] }) // credited
    expect(s.date).toBe(DATE) // stayed (NOT advanced to NEXT)
    expect(s.persistBtns).toEqual({ [C]: 'correct' }) // answer marked
    expect(s.locked).toBe(true) // run is over → grid locked
    expect(s.stack).toEqual([]) // not pushed — the completing solve is the live (reviewable) question
    expect(s.canOverrideCorrect).toBe(true) // still reversible via Override
    expect(s.prevStatsSnapshot).not.toBe(null)
  })

  it('ANSWER without complete still advances (regression: the other modes are unchanged)', () => {
    const s = answer(initEngine(DATE), C)
    expect(s.date).toBe(NEXT) // advanced
    expect(s.locked).toBe(false)
    expect(s.stack).toHaveLength(1)
  })

  it('OVERRIDE noAdvance: reverses the completing solve without advancing (run fails in place)', () => {
    let s = answer(initEngine(DATE), C, { complete: true, elapsed: 0.5, tracking: true })
    s = gameReducer(s, {
      type: 'OVERRIDE',
      useJulian: false,
      tracking: true,
      timingOff: false,
      noAdvance: true,
      nextDate: NEXT,
    })
    expect(s.stats.good).toBe(0) // credit reversed
    expect(s.stats.played).toBe(1) // the attempt still counts
    expect(s.date).toBe(DATE) // stayed — the component marks the run failed
  })

  it('OVERRIDE without noAdvance (timing on) advances after reversing (the Classic/Blitz path is intact)', () => {
    let s = answer(initEngine(DATE), C, { complete: true, elapsed: 0.5, tracking: true })
    s = gameReducer(s, {
      type: 'OVERRIDE',
      useJulian: false,
      tracking: true,
      timingOff: false,
      nextDate: NEXT,
    })
    expect(s.date).toBe(NEXT) // advanced
  })
})

// ── The lifetime card number — historyBase / cardNumber (the Q# badge) ─────────────────────────
// The badge beside the Score box is the card's LIFETIME number, not its 1-based slot in the
// in-session history stack. The two disagreed by exactly the prior-session total: a continuous
// mode HYDRATES `played` at mount (initEngine's initialStats) while `stack` deliberately starts
// empty, so a player 500 cards in pressed < and read "Q1" beside "471/501".
//
// `historyBase` closes it with no new persisted data: it records what `played` was when the stack
// was last emptied, and the number is base + stack.length + 1. The cases below pin the four ways
// the base is established (blank / hydrated / RESET / RESET_ROUND) plus the two ways the count
// must NOT move — a Save-Stats-off card (neither counted nor pushed) and browsing.
describe('gameReducer — historyBase / cardNumber (the Q# badge)', () => {
  // A prior-session record the in-session stack cannot reconstruct — the owner's reported case.
  const HYDRATED = { played: 500, good: 471, streak: 0, best: 12, times: [] }

  it('a blank engine bases at 0 — the number is the old stack formula, unchanged', () => {
    const s = initEngine(DATE)
    expect(s.historyBase).toBe(0)
    expect(cardNumber(s)).toBe(s.stack.length + 1)
    expect(cardNumber(s)).toBe(1)
  })

  it('hydrated stats base the count at the prior-session played total', () => {
    const s = initEngine(DATE, HYDRATED)
    expect(s.historyBase).toBe(500)
    expect(cardNumber(s)).toBe(501) // the live card is the 501st, beside a Score of 471/500
  })

  it('the number tracks played across a play + a browse round trip', () => {
    let s = initEngine(DATE, HYDRATED)
    s = answer(s, C) // credited + advanced → 472/501
    expect(s.stats.played).toBe(501)
    expect(cardNumber(s)).toBe(502) // the fresh live card is the 502nd
    s = back(s) // browse to the card just played
    expect(cardNumber(s)).toBe(501) // …which IS the 501st — it agrees with played
    s = forward(s)
    expect(cardNumber(s)).toBe(502)
  })

  it('RESET re-bases to 0 along with the stats it zeroes', () => {
    let s = answer(initEngine(DATE, HYDRATED), C)
    s = gameReducer(s, { type: 'RESET', timingOff: true, nextDate: NEXT })
    expect(s.historyBase).toBe(0)
    expect(cardNumber(s)).toBe(1)
  })

  it("RESET_ROUND re-bases to the KEPT played total (Flash's round Reset)", () => {
    let s = answer(initEngine(DATE, HYDRATED), C) // played 501, one history entry
    s = gameReducer(s, { type: 'RESET_ROUND' }) // history wiped, stats survive
    expect(s.stats.played).toBe(501)
    expect(s.historyBase).toBe(501)
    expect(cardNumber(s)).toBe(502) // the next card is still the 502nd, not the 1st
  })

  it('a card played with Save Stats OFF is neither counted nor numbered', () => {
    const s = answer(initEngine(DATE, HYDRATED), C, { saveStats: false })
    expect(s.stats.played).toBe(500) // not counted
    expect(s.stack).toEqual([]) // not pushed
    expect(cardNumber(s)).toBe(501) // …so the next card is STILL the 501st
  })

  it('Override never moves the number — it never moves played', () => {
    let s = answer(initEngine(DATE, HYDRATED), C) // 472/501, live card is the 502nd
    expect(cardNumber(s)).toBe(502)
    s = override(s) // Path 5: retro-flip the credit away — played untouched
    expect(s.stats.played).toBe(501)
    expect(cardNumber(s)).toBe(502)
  })
})

// ── Override ⇄ Undo (round 23 Q6) ───────────────────────────────────────────────────────────────
// Where the Override button used to go inert after use, it now reads Undo and puts back EXACTLY the
// state the Override replaced; then it reads Override again, as many times as you like. The engine
// half is one full-state capsule filed by OVERRIDE and spent by UNDO, discarded by every other
// action in one choke point (the exported gameReducer wrapper). So the pins below are whole-object:
// for EVERY path and branch, undo(override(s)) must deep-equal s — not "the stats match", the state.
describe('gameReducer — Override ⇄ Undo', () => {
  const undo = (s) => gameReducer(s, { type: 'UNDO' })
  // Timing ON (the advancing branches) with times tracked, so the pool/ledger are exercised too.
  const ovr = (s, extra = {}) => override(s, { tracking: true, timingOff: false, ...extra })
  const T = { tracking: true, elapsed: 1.25 }
  const credited = () => answer(initEngine(DATE), C, T) // 1/1 with a time, advanced to NEXT
  const burned = () => answer(initEngine(DATE), W, T) // 0/1, wrong on DATE, stays
  const held = () => answer(initEngine(DATE), C, { ...T, complete: true }) // AoX held completing solve
  const pending = () => answer(burned(), C) // late correct → advanced, Path 4 armed

  // Every path and branch of the OVERRIDE case, as [label, pre-state, dispatch].
  const CASES = [
    ['Path 1 — back-browse flip', () => back(credited()), (s) => ovr(s)],
    ['Path 2 — live reversal, advances', held, (s) => ovr(s)],
    ['Path 2 — live reversal, stays (noAdvance)', held, (s) => ovr(s, { noAdvance: true })],
    ['Path 2 — live reversal, stays (timing off)', held, (s) => ovr(s, { timingOff: true })],
    ['Path 3 — credit the burned question, advances', burned, (s) => ovr(s)],
    [
      'Path 3 — credit the burned question, held (noAdvance)',
      burned,
      (s) => ovr(s, { noAdvance: true }),
    ],
    ['Path 4 — retro-credit the previous wrong, advances', pending, (s) => ovr(s)],
    [
      'Path 4 — retro-credit the previous wrong, stays (timing off)',
      pending,
      (s) => ovr(s, { timingOff: true }),
    ],
    ['Path 5 — retro-flip the last entry', credited, (s) => ovr(s)],
    // The two degenerate returns — unreachable through overrideAvail, but they still file a capsule.
    [
      'Path 4 — spent target (skip branch)',
      () => {
        let s = pending()
        s = back(s) // browse onto the previous wrong
        s = ovr(s) // Path 1 credits it — overrideUsed rides FORWARD onto the entry
        s = forward(s) // back at the live edge: pending re-armed from liveState, target spent
        return s
      },
      (s) => ovr(s),
    ],
    ['no path matched (fall-through)', () => initEngine(DATE), (s) => ovr(s)],
  ]

  it.each(CASES)(
    '%s: undo(override(s)) deep-equals s, and both states are healthy',
    (_, pre, go) => {
      const s0 = pre()
      expect(s0.undoCapsule).toBe(null)
      const s1 = go(s0)
      expect(s1.undoCapsule).not.toBe(null) //  the Override filed a capsule…
      expect(s1).not.toEqual(s0) //              …and did something
      expect(checkGameInvariants(s1, false)).toEqual([])
      const s2 = undo(s1)
      expect(s2).toEqual(s0) //                  exactly the pre-Override state, capsule slot included
      expect(checkGameInvariants(s2, false)).toEqual([])
    },
  )

  it.each(CASES)('%s: O→U→O→U→O deep-equals a single O (toggling never drifts)', (_, pre, go) => {
    const once = go(pre())
    let s = pre()
    s = go(s)
    s = undo(s)
    s = go(s)
    s = undo(s)
    s = go(s)
    expect(s).toEqual(once)
  })

  it('the capsule survives the advancing branches (advance() spreads it through)', () => {
    const s = ovr(burned())
    expect(s.date).toBe(NEXT) // advanced…
    expect(s.undoCapsule.date).toBe(DATE) // …and the capsule still holds the burned question
    expect(undo(s).questionId).toBe(s.questionId - 1) // Undo steps the question id back with it
    expect(undo(s).gridEpoch).toBe(s.gridEpoch) // no Override path remounts the grids
  })

  it('a capsule never nests — it has no undo slot of its own', () => {
    const s = ovr(burned())
    expect('undoCapsule' in s.undoCapsule).toBe(false)
  })

  it('UNDO with no capsule is a no-op (same object)', () => {
    const s = burned()
    expect(undo(s)).toBe(s)
    const fresh = initEngine(DATE)
    expect(undo(fresh)).toBe(fresh)
  })

  it('OVERRIDE while a capsule is pending is refused (same object) — never files over the first', () => {
    const s = ovr(credited()) // Path 5 filed a capsule
    expect(ovr(s)).toBe(s)
  })

  // ⚠ THE LOAD-BEARING SAFETY PROPERTY: the window between an Override and its Undo contains zero
  // gameplay. Every action that is not OVERRIDE/UNDO discards the capsule — including the no-op ones.
  describe('every other action discards the capsule', () => {
    const J = { useJulian: false }
    const OTHER = [
      ['NEW', { type: 'NEW', nextDate: NEXT, useJulian: false, saveStats: true }],
      ['ANSWER (correct)', { type: 'ANSWER', idx: C, ...ctx, elapsed: null, nextDate: NEXT }],
      ['ANSWER (wrong)', { type: 'ANSWER', idx: W, ...ctx, elapsed: null, nextDate: NEXT }],
      ['REVEAL', { type: 'REVEAL', ...J, elapsed: null, saveStats: true }],
      ['SHOW_CODES open', { type: 'SHOW_CODES', open: true, ...J, elapsed: null, saveStats: true }],
      [
        'SHOW_CODES close',
        { type: 'SHOW_CODES', open: false, ...J, elapsed: null, saveStats: true },
      ],
      ['RESET', { type: 'RESET', timingOff: false, nextDate: NEXT }],
      ['REGEN_DATE', { type: 'REGEN_DATE', nextDate: NEXT }],
      ['LOCK_REVEAL', { type: 'LOCK_REVEAL', ...J }],
      ['TIMEOUT_MISS', { type: 'TIMEOUT_MISS', ...J, saveStats: true }],
      ['RESET_ROUND', { type: 'RESET_ROUND' }],
      ['BACK', { type: 'BACK' }],
      ['FORWARD', { type: 'FORWARD', ...J }],
      ['an unknown action', { type: 'NOT_AN_ACTION' }],
    ]
    // Two capsule-carrying states: one at the live edge after a Path 5 (history behind, fresh live Q)
    // and one where the Override LEFT the player on a locked question (Path 3 held) — so the no-op
    // variants (ANSWER on a locked grid, FORWARD with nothing ahead) are covered too.
    const carriers = [
      ['after Path 5', () => ovr(credited())],
      ['after a Path 3 hold (locked)', () => ovr(burned(), { noAdvance: true })],
    ]
    for (const [where, make] of carriers) {
      it.each(OTHER)(`${where}: %s`, (_, action) => {
        const s = make()
        expect(s.undoCapsule).not.toBe(null)
        expect(gameReducer(s, action).undoCapsule).toBe(null)
      })
    }
  })
})
