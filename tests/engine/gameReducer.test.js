// Unit tests for the pure game reducer — CORE lifecycle (Stage C, Step 6, sub-step 1b).
// Deterministic: a fixed Gregorian date (so activeWday === wday) and explicit payloads.
// These mirror the Classic characterization (tests/classic.dom) at the reducer level —
// the two must agree, which is what makes wiring the reducer into App (1c) safe.
import { describe, it, expect } from 'vitest'
import {
  gameReducer,
  initEngine,
  cardNumber,
  overrideTarget,
  overridePlan,
  liveCredited,
} from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { buildRunBreakdown } from '../../src/engine/runBreakdown.js'
import { calcAvg } from '../../src/engine/stats.js'

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
// The one button. No direction and no timing flag: what a press does is read off the card it
// points at (overridePlan); `hold` is the run modes' "credit the live card but stay on it".
const override = (s, extra = {}) =>
  gameReducer(s, {
    type: 'OVERRIDE',
    useJulian: false,
    tracking: false,
    nextDate: NEXT,
    ...extra,
  })
const back = (s) => gameReducer(s, { type: 'BACK' })
const forward = (s) => gameReducer(s, { type: 'FORWARD', useJulian: false })
// The correct / a wrong index for whatever date is on screen (the helpers above answer DATE's).
const cOf = (s) => wday(s.date.y, s.date.m, s.date.d)
const wOf = (s, k = 1) => (cOf(s) + k) % 7

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
    // The entry carries its Override record: never wrong (no wrongTime), never overridden — so its
    // materialised fields ARE its as-answered state, and nothing is stored twice.
    expect(s.stack[0].meta).toEqual({ wrongTime: null, answered: null })
    expect(s.card).toEqual({ wrongTime: null, answered: null }) // the fresh live card starts blank
  })

  it('wrong: counts as played, streak 0, marks the button, does NOT advance, records its wrongTime', () => {
    const s = answer(initEngine(DATE), W, { elapsed: 0.5 })
    expect(s.stats).toEqual({ played: 1, good: 0, streak: 0, best: 0, times: [] })
    expect(s.date).toBe(DATE) // not advanced
    expect(s.persistBtns).toEqual({ [W]: 'wrong-latest' })
    expect(s.countedWrong).toBe(true)
    expect(s.card.wrongTime).toBe(0.5) // what a crediting Override would contribute
    expect(overrideTarget(s)).toBe('live') // the burned card is the button's target
  })

  it('a second wrong on the same card keeps the FIRST wrong’s time', () => {
    let s = answer(initEngine(DATE), W, { elapsed: 0.5 })
    s = answer(s, (C + 2) % 7, { elapsed: 1.9 })
    expect(s.card.wrongTime).toBe(0.5)
  })

  it('correct after a wrong on the same question: no extra credit, advances, and that card is the retro target', () => {
    let s = answer(initEngine(DATE), W, { elapsed: 0.5 }) // 0/1, burned
    s = answer(s, C) // late-correct
    expect(s.stats).toEqual({ played: 1, good: 0, streak: 0, best: 0, times: [] }) // no credit
    expect(s.date).toBe(NEXT) // advanced
    expect(s.stack).toHaveLength(1) // the wrong-then-right entry was pushed…
    expect(s.stack[0].meta.wrongTime).toBe(0.5) // …carrying the time an Override would credit it with
    expect(overrideTarget(s)).toBe('retro') // …and the fresh live card points the button at it
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

  it('after a wrong answer: pushes the entry, advances, and the button points at the pushed card', () => {
    let s = answer(initEngine(DATE), W) // burned, not advanced
    s = neu(s)
    expect(s.stack).toHaveLength(1)
    expect(s.date).toBe(NEXT)
    expect(overridePlan(s)).toEqual({ target: 'retro', overridden: false, credits: true })
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

// ── OVERRIDE: which card the button points at, and a FIRST press on each ───────────────────────
// Round 23 Q6 replaced the five hand-written Override paths with one per-card toggle. A first press
// is still what those paths did, target by target — pinned here with the old paths' own numbers so
// the equivalence is checked rather than argued. The two deliberate differences are pinned too:
// the old Path 4 (credit the previous wrong) no longer moves play on, and the old Path 2 (take a
// held credit away) no longer advances off the card it just flipped.
describe('gameReducer — OVERRIDE (a first press, target by target)', () => {
  it('retro (was Path 5) — correct then Override: flips the just-answered entry to a miss (1/1 → 0/1)', () => {
    let s = answer(initEngine(DATE), C) // 1/1, advanced; stack[0] is the credited DATE entry
    expect(overridePlan(s)).toEqual({ target: 'retro', overridden: false, credits: false })
    const qid = s.questionId
    s = override(s) // the live card is untouched; the entry flips
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.stack[0].btns).toEqual({ [C]: 'override-wrong' })
    expect(s.stack[0].hasCredit).toBe(false)
    expect(s.stack[0].meta.answered).toEqual({
      btns: { [C]: 'correct' },
      hasCredit: true,
      solveTime: null,
    })
    expect(s.date).toBe(NEXT) // the live card stayed…
    expect(s.questionId).toBe(qid) // …and no new question was drawn
  })

  it('live (was Path 3) — wrong then Override: credits the burned card and advances (0/1 → 1/1)', () => {
    let s = answer(initEngine(DATE), W) // 0/1, burned, not advanced
    expect(overridePlan(s)).toEqual({ target: 'live', overridden: false, credits: true })
    s = override(s)
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1 })
    expect(s.date).toBe(NEXT) // advanced
    expect(s.stack).toHaveLength(1)
    expect(s.stack[0].btns).toEqual({ [C]: 'correct' })
    expect(s.stack[0].meta.answered.btns).toEqual({ [W]: 'wrong-prev', [C]: 'correct' }) // A kept, green synthesized
  })

  it('retro (was Path 4) — wrong-then-right then Override: credits the previous card and the live card STAYS', () => {
    let s = answer(initEngine(DATE), W) // 0/1
    s = answer(s, C) // late-correct: advances to NEXT
    const qid = s.questionId
    s = override(s, { nextDate: DATE }) // a date is offered… and not drawn
    expect(s.stats).toMatchObject({ played: 1, good: 1, streak: 1 })
    expect(s.date).toBe(NEXT) // ⚠ DELIBERATE CHANGE: the old Path 4 advanced with timing on
    expect(s.questionId).toBe(qid)
    expect(s.stack[0].hasCredit).toBe(true)
  })

  it('browsed (was Path 1) — Back to a correct answer then Override: takes the credit away (1/1 → 0/1)', () => {
    let s = answer(initEngine(DATE), C) // 1/1, advanced
    s = back(s) // browse the credited entry
    expect(overridePlan(s)).toEqual({ target: 'browsed', overridden: false, credits: false })
    s = override(s)
    expect(s.stats).toMatchObject({ played: 1, good: 0, streak: 0 })
    expect(s.persistBtns).toEqual({ [C]: 'override-wrong' })
    expect(s.browseHasCredit).toBe(false)
    expect(s.revealed).toBe(true) // the answer is on the grid — a browse Reveal cannot paint over it
    expect(reveal(s)).toBe(s)
  })

  it('live (was Path 2) — a HELD credit overridden: STAYS on the card as a resolved miss', () => {
    let s = answer(initEngine(DATE), C, { complete: true, elapsed: 0.5, tracking: true })
    expect(overridePlan(s)).toEqual({ target: 'live', overridden: false, credits: false })
    s = override(s, { tracking: true })
    expect(s.stats).toEqual({ played: 1, good: 0, streak: 0, best: 0, times: [] })
    expect(s.date).toBe(DATE) // ⚠ DELIBERATE CHANGE: never advances off the card it just flipped
    expect(s.persistBtns).toEqual({ [C]: 'override-wrong' })
    expect([s.locked, s.revealed, s.countedWrong]).toEqual([true, true, true])
    expect(s.liveSolveTime).toBe(null)
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('a pristine per-question timeout is not a target — the button points at the card before it', () => {
    let s = answer(initEngine(DATE), C) // one scored card behind
    s = gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true })
    expect(overrideTarget(s)).toBe('retro')
    // …and with nothing behind it, there is nothing to point at at all.
    const alone = gameReducer(initEngine(DATE), {
      type: 'TIMEOUT_MISS',
      useJulian: false,
      saveStats: true,
    })
    expect(overrideTarget(alone)).toBe(null)
    expect(override(alone)).toBe(alone) // no target → a no-op, same object
  })

  it('a card played with Save Stats OFF is never the live target', () => {
    const s = answer(initEngine(DATE), W, { saveStats: false })
    expect(overrideTarget(s)).toBe(null)
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

// The two general flags the run modes add. `complete` = credit-and-stay (MoX's last solve); `hold`
// = a crediting Override that stays on the live card instead of moving on (MoX's completing solve
// via Override, and a Blitz round / MoX run that stays ended). The one-question-loop modes never
// pass either, so their behavior is unchanged (regressions below).
describe('gameReducer — complete (MoX last solve) + hold (a crediting Override that stays)', () => {
  it('ANSWER complete: credits the correct answer but does NOT advance — marks, locks, stays, overridable', () => {
    const s = answer(initEngine(DATE), C, { complete: true, elapsed: 0.5, tracking: true })
    expect(s.stats).toEqual({ played: 1, good: 1, streak: 1, best: 1, times: [0.5] }) // credited
    expect(s.date).toBe(DATE) // stayed (NOT advanced to NEXT)
    expect(s.persistBtns).toEqual({ [C]: 'correct' }) // answer marked
    expect(s.locked).toBe(true) // run is over → grid locked
    expect(s.stack).toEqual([]) // not pushed — the completing solve is the live (reviewable) question
    expect(liveCredited(s)).toBe(true) // read straight off the grid — no flag to fall out of step
    expect(overrideTarget(s)).toBe('live')
  })

  it('ANSWER without complete still advances (regression: the other modes are unchanged)', () => {
    const s = answer(initEngine(DATE), C)
    expect(s.date).toBe(NEXT) // advanced
    expect(s.locked).toBe(false)
    expect(s.stack).toHaveLength(1)
  })

  it('OVERRIDE hold: credits the burned live card and STAYS on it — locked, the answer alone in green', () => {
    let s = answer(initEngine(DATE), W, { elapsed: 1.5 })
    s = override(s, { hold: true, tracking: true })
    expect(s.date).toBe(DATE) // stayed
    expect(s.stats).toEqual({ played: 1, good: 1, streak: 1, best: 1, times: [1.5] })
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect([s.locked, s.revealed, s.countedWrong]).toEqual([true, false, false])
    expect(liveCredited(s)).toBe(true)
    expect(s.liveSolveTime).toBe(1.5) // the wrong answer's time, frozen as this card's O time
    expect(s.card.oTime).toBe(1.5)
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('OVERRIDE without hold on the same card advances (the Classic/Blitz credit-and-move-on)', () => {
    let s = answer(initEngine(DATE), W, { elapsed: 1.5 })
    s = override(s, { tracking: true })
    expect(s.date).toBe(NEXT)
  })

  it('hold changes nothing about a press that does not credit the live card', () => {
    const held = answer(initEngine(DATE), C, { complete: true })
    expect(override(held, { hold: true })).toEqual(override(held))
    const retro = answer(initEngine(DATE), C)
    expect(override(retro, { hold: true })).toEqual(override(retro))
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

// ── Override ⇄ Undo: a PERMANENT two-state toggle on every scored card (round 23 Q6) ────────────
// The owner's rule: everything reads either Override or Undo — no locked Override any more — and a
// card remembers how you answered it, so an Undo reached by browsing back (or after a preset
// switch) shows your ORIGINAL red highlights. Every scored card holds two fixed states, A (as
// answered) and O (overridden); credited = A.credited XOR overridden. These pin that it really is
// a two-state switch: exact, unlimited, reachable from anywhere, and never drawing a date.
describe('gameReducer — Override ⇄ Undo, the per-card toggle', () => {
  const T = { tracking: true }
  // What "the same position" means across a full A → O → A cycle. Two things legitimately differ
  // and nothing else may: O's frozen time (card.oTime / meta.oTime) is recorded the first time O
  // credits and kept for every later flip — that IS the two-state guarantee — and a time put back
  // into the pool joins it at the end (the pool is a multiset; its order is not a card's).
  const same = (s) =>
    JSON.parse(
      JSON.stringify(s, (k, v) => (k === 'oTime' ? undefined : k === 'times' ? [...v].sort() : v)),
    )

  // Each target, as [label, the position before the first press, extra OVERRIDE payload].
  const TARGETS = [
    [
      'browsed',
      () => {
        let s = answer(initEngine(DATE), C, { tracking: true, elapsed: 1.25 })
        s = answer(s, wOf(s), { tracking: true, elapsed: 0.8 }) // the live card burned too
        return back(s)
      },
      {},
    ],
    ['live, crediting (hold)', () => answer(initEngine(DATE), W, { elapsed: 1.5 }), { hold: true }],
    [
      'live, un-crediting a held solve',
      () => answer(initEngine(DATE), C, { complete: true, tracking: true, elapsed: 2.5 }),
      {},
    ],
    ['retro', () => answer(initEngine(DATE), C, { tracking: true, elapsed: 1.25 }), {}],
  ]

  it.each(TARGETS)(
    '%s: seven presses alternate the WHOLE state between exactly two values, stats never drift',
    (_, pre, extra) => {
      const states = [pre()]
      for (let i = 0; i < 7; i++) states.push(override(states[i], { ...T, ...extra }))
      for (const s of states) expect(checkGameInvariants(s, false)).toEqual([])
      for (let i = 3; i < states.length; i += 2) expect(states[i]).toEqual(states[1]) // every O
      for (let i = 4; i < states.length; i += 2) expect(states[i]).toEqual(states[2]) // every A
      expect(same(states[2])).toEqual(same(states[0])) // …and A is where it started
      expect(states[1].stats.good).toBe(
        states[0].stats.good + (overridePlan(states[0]).credits ? 1 : -1),
      )
      for (const s of states) {
        expect(s.stats.played).toBe(states[0].stats.played) // a toggle never plays a card
        expect(s.questionId).toBe(states[0].questionId) //    …or draws one
      }
      // The label follows the card: O reads Undo, A reads Override.
      expect(overridePlan(states[1]).overridden).toBe(true)
      expect(overridePlan(states[2]).overridden).toBe(false)
    },
  )

  it('the original reds come back: wrong twice then right → Override → play on → browse to it → Undo', () => {
    const W2 = (C + 2) % 7
    let s = answer(initEngine(DATE), W)
    s = answer(s, W2)
    s = answer(s, C) // late correct → pushed as a miss, with its reds and a synthesized green
    const reds = { [W]: 'wrong-prev', [W2]: 'wrong-prev', [C]: 'correct' }
    expect(s.stack[0].btns).toEqual(reds)
    s = override(s) // retro: credits it
    expect(s.stack[0].btns).toEqual({ [C]: 'correct' })
    s = answer(s, cOf(s)) // play on — a whole new card after it
    s = back(s)
    s = back(s) // browse to it
    expect(s.persistBtns).toEqual({ [C]: 'correct' })
    expect(overridePlan(s)).toEqual({ target: 'browsed', overridden: true, credits: false }) // reads Undo
    const good = s.stats.good
    s = override(s) // Undo
    expect(s.persistBtns).toEqual(reds) // ★ byte-for-byte, the owner's sentence
    expect(s.browseHasCredit).toBe(false)
    expect(s.stats.good).toBe(good - 1)
    s = forward(s)
    s = forward(s) // …and the history card keeps them once you leave it
    expect(s.stack[0].btns).toEqual(reds)
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('the original TIME comes back: a 2.10s solve → Override → play on → browse back → Undo', () => {
    let s = answer(initEngine(DATE), C, { tracking: true, elapsed: 2.1 })
    s = override(s, T) // un-credit it: its time leaves the mean
    expect(s.stats.times).toEqual([])
    s = answer(s, cOf(s), { tracking: true, elapsed: 3.0 })
    s = back(s)
    s = back(s)
    s = override(s, T) // Undo
    expect(s.stats.times.sort()).toEqual([2.1, 3.0]) // A's own time — not its (null) wrongTime
    expect(calcAvg(s.stats.times)).toBeCloseTo(2.55, 10)
    expect(s.liveSolveTime).toBe(2.1)
  })

  it('a card toggled with timing hidden, then shown, keeps the time its O state first had (the freeze)', () => {
    let s = answer(initEngine(DATE), W, { elapsed: 1.5 })
    s = answer(s, C) // pushed as a miss with wrongTime 1.5
    s = override(s, { tracking: false }) // O credits with timing hidden → contributes nothing
    expect(s.stats.times).toEqual([])
    s = override(s, { tracking: true }) // Undo
    s = override(s, { tracking: true }) // Override again, timing now shown…
    expect(s.stats.times).toEqual([]) // …still nothing: O is ONE state, not one per press
    expect(s.stack[0].solveTime).toBe(null)
  })

  it('a mid-history toggle on a six-card run: every figure consistent, and toggling back restores the state', () => {
    let s = initEngine(DATE)
    const play = [
      (x) => answer(x, cOf(x), { tracking: true, elapsed: 1 }),
      (x) => answer(x, cOf(x), { tracking: true, elapsed: 2 }),
      (x) => answer(x, cOf(x), { tracking: true, elapsed: 3 }), // card 3 — the one we toggle
      (x) => answer(answer(x, wOf(x), { tracking: true, elapsed: 9 }), cOf(x)), // a miss
      (x) => answer(x, cOf(x), { tracking: true, elapsed: 5 }),
      (x) => answer(x, cOf(x), { tracking: true, elapsed: 6 }),
    ]
    for (const p of play) s = p(s)
    expect(s.stats).toMatchObject({ played: 6, good: 5, streak: 2, best: 3 })
    const before = s
    for (let i = 0; i < 4; i++) s = back(s) // on card 3
    expect(cardNumber(s)).toBe(3)
    s = override(s, T) // take card 3's credit away
    expect(s.stats).toMatchObject({ played: 6, good: 4, streak: 2, best: 2 }) // runs 1-2 and 5-6
    expect(s.stats.times.sort()).toEqual([1, 2, 5, 6])
    const rows = buildRunBreakdown(s, false).rows
    expect(rows.map((r) => r.credited)).toEqual([true, true, false, false, true, true])
    expect(rows.map((r) => r.time)).toEqual([1, 2, null, null, 5, 6])
    expect(rows[2].mark).toBe('override')
    expect(checkGameInvariants(s, false)).toEqual([])
    s = override(s, T) // and back
    for (let i = 0; i < 4; i++) s = forward(s)
    expect(same(s)).toEqual(same(before))
  })

  it('an advancing Override and its Undo never draw a date: the free re-roll is gone', () => {
    const OTHER = { y: 1999, m: 9, d: 9, _fmt: 'numeric-ymd', _jul: false }
    let s = answer(initEngine(DATE), W) // burned live card
    s = override(s) // credits it and moves on to NEXT — the one date this ever draws
    expect(s.date).toBe(NEXT)
    const qid = s.questionId
    for (let i = 0; i < 6; i++) {
      s = override(s, { nextDate: OTHER }) // Undo, Override, Undo, … — now on the history card
      expect(s.date).toBe(NEXT)
      expect(s.questionId).toBe(qid)
    }
  })

  it('Undo on the live card puts its flags back exactly as the answer left them', () => {
    // A Reveal-burned card (locked + revealed), credited with hold, then undone.
    let s = reveal(initEngine(DATE), { elapsed: 0.7 })
    const a = s
    s = override(s, { hold: true })
    expect([s.locked, s.revealed, s.countedWrong]).toEqual([true, false, false])
    s = override(s) // Undo — never navigates, hold or no hold
    expect(s.persistBtns).toEqual(a.persistBtns)
    expect([s.locked, s.revealed, s.countedWrong, s.calcPenaltyActive]).toEqual([
      a.locked,
      a.revealed,
      a.countedWrong,
      a.calcPenaltyActive,
    ])
    expect(s.date).toBe(DATE)
  })

  it('the Override record rides Back and Forward with its card — including the live card’s', () => {
    let s = answer(initEngine(DATE), C, { complete: true })
    s = override(s) // the live card in O (un-credited, held)
    const card = s.card
    s = gameReducer(s, { type: 'NEW', nextDate: NEXT, ...ctx }) // pushed into history in O
    expect(s.stack[0].meta.answered).toEqual({
      btns: { [C]: 'correct' },
      hasCredit: true,
      solveTime: null,
    }) // no live flags on a history card
    s = back(s) // browsing it: its record is the on-screen card's record
    expect(s.card.answered.hasCredit).toBe(true)
    s = forward(s)
    expect(s.stack[0].meta.answered).not.toBe(null)
    // …and the LIVE card's own record parks on the isLive entry, live flags and all.
    let l = answer(initEngine(DATE), C) // one card behind
    l = answer(l, cOf(l), { complete: true })
    l = override(l)
    const liveCard = l.card
    l = back(l)
    expect(l.forwardStack[0].isLive).toBe(true)
    expect(l.forwardStack[0].meta).toBe(liveCard)
    l = forward(l)
    expect(l.card).toBe(liveCard)
    expect(card.answered.live).toEqual({
      locked: true,
      revealed: false,
      countedWrong: false,
      calcPenaltyActive: false,
    })
  })

  it('the button is dimmed only when there is truly nothing to point at', () => {
    let s = initEngine(DATE)
    expect(overrideTarget(s)).toBe(null) // a fresh mode, no history
    s = answer(s, C)
    expect(overrideTarget(s)).toBe('retro') // one scored card → live on the fresh next question
    s = answer(s, cOf(s))
    s = override(s)
    s = override(s)
    expect(overrideTarget(s)).toBe('retro') // …and never dimmed again while history exists
    s = back(s)
    expect(overrideTarget(s)).toBe('browsed')
    s = forward(s)
    s = answer(s, wOf(s))
    expect(overrideTarget(s)).toBe('live')
  })

  it('a retro toggle counts a scored live miss behind the streak (the old retro paths dropped it)', () => {
    let s = answer(initEngine(DATE), C) // credit, streak 1
    s = gameReducer(s, { type: 'TIMEOUT_MISS', useJulian: false, saveStats: true }) // live scored miss
    expect(s.stats).toMatchObject({ played: 2, good: 1, streak: 0 })
    s = override(s) // retro: un-credit the card behind
    s = override(s) // Undo: credit it again
    expect(s.stats).toMatchObject({ played: 2, good: 1, streak: 0, best: 1 }) // not streak 1
  })

  it('RESET_ROUND re-bases the streak baseline, so a later toggle cannot drop a Best set before it', () => {
    let s = initEngine(DATE, { played: 10, good: 5, streak: 0, best: 2, times: [] })
    for (let i = 0; i < 4; i++) s = answer(s, cOf(s))
    expect(s.stats.best).toBe(4)
    s = gameReducer(s, { type: 'RESET_ROUND' })
    expect([s.bestFloor, s.streakCarry]).toEqual([4, 4])
    s = answer(s, cOf(s)) // streak 5, best 5
    s = override(s) // un-credit it: the run of 4 before the Reset still stands
    expect(s.stats).toMatchObject({ streak: 0, best: 4 })
    s = override(s) // and back
    expect(s.stats).toMatchObject({ streak: 5, best: 5 })
  })

  it('LOCK_REVEAL cannot paint over a locked (e.g. overridden) card', () => {
    const s = override(answer(initEngine(DATE), C, { complete: true }))
    expect(gameReducer(s, { type: 'LOCK_REVEAL', useJulian: false })).toBe(s)
  })

  it('REGEN_DATE never swaps the date under a credited live card, timed or not', () => {
    const held = answer(initEngine(DATE), C, { complete: true }) // tracking off → no time recorded
    expect(gameReducer(held, { type: 'REGEN_DATE', nextDate: NEXT })).toBe(held)
  })
})
