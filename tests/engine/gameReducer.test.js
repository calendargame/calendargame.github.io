// Unit tests for the pure game reducer — CORE lifecycle (Stage C, Step 6, sub-step 1b).
// Deterministic: a fixed Gregorian date (so activeWday === wday) and explicit payloads.
// These mirror the Classic characterization (tests/classic.dom) at the reducer level —
// the two must agree, which is what makes wiring the reducer into App (1c) safe.
import { describe, it, expect } from 'vitest'
import { gameReducer, initEngine } from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'

const DATE = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const NEXT = { y: 2025, m: 6, d: 15, _fmt: 'numeric-ymd', _jul: false }
const C = wday(2024, 1, 1) // the correct weekday index for the fixed date
const W = (C + 1) % 7 // a wrong index

// Default play context: Gregorian, Save Stats on, timing hidden (Classic default).
const ctx = { useJulian: false, saveStats: true, tracking: false }
const answer = (s, idx, extra = {}) => gameReducer(s, { type: 'ANSWER', idx, nextDate: NEXT, ...ctx, ...extra })
const reveal = (s, extra = {}) => gameReducer(s, { type: 'REVEAL', ...ctx, ...extra })
const showCodes = (s, open = true, extra = {}) => gameReducer(s, { type: 'SHOW_CODES', open, ...ctx, ...extra })
const neu = (s, extra = {}) => gameReducer(s, { type: 'NEW', nextDate: NEXT, ...ctx, ...extra })
const override = (s, extra = {}) =>
  gameReducer(s, { type: 'OVERRIDE', useJulian: false, tracking: false, timingOff: true, nextDate: NEXT, ...extra })
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
    expect(s.stack[0].capsule.snapshot).toEqual({
      played: 0, good: 0, streak: 0, best: 0, timesLen: 0, wasWrong: false,
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
    expect(s.preCalcPenaltySnapshot).toMatchObject({ played: 0, good: 0 })
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
