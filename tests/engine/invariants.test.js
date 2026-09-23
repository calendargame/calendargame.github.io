// Unit tests for the engine invariant checker (engine/invariants.ts). The production tripwires
// (useGameEngine) AND the fuzz survey both rely on this, so it must (a) PASS healthy states and
// (b) CATCH each impossible state. This file pins both directions.
import { describe, it, expect } from 'vitest'
import { checkGameInvariants, checkStatsInvariants } from '../../src/engine/invariants.js'
import { initEngine, gameReducer } from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'

const DATE = { y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const NEXT = { y: 2025, m: 6, d: 15, _fmt: 'numeric-ymd', _jul: false }
const C = wday(2024, 1, 1) // correct weekday index for DATE
const join = (arr) => arr.join(' | ')

describe('checkStatsInvariants — passes healthy stats', () => {
  it('blank', () =>
    expect(
      checkStatsInvariants({ played: 0, good: 0, streak: 0, best: 0, times: [] }, 'stats'),
    ).toEqual([]))
  it('a normal consistent score', () =>
    expect(
      checkStatsInvariants({ played: 5, good: 3, streak: 2, best: 3, times: [1, 2, 3] }, 'stats'),
    ).toEqual([]))
})

describe('checkStatsInvariants — catches impossible scores', () => {
  it('good > played', () =>
    expect(
      join(checkStatsInvariants({ played: 1, good: 2, streak: 1, best: 1, times: [] }, 'stats')),
    ).toContain('good(2) > played(1)'))
  it('streak > good', () =>
    expect(
      join(checkStatsInvariants({ played: 5, good: 2, streak: 3, best: 2, times: [] }, 'stats')),
    ).toContain('streak(3) > good(2)'))
  it('best > good', () =>
    expect(
      join(checkStatsInvariants({ played: 5, good: 2, streak: 1, best: 3, times: [] }, 'stats')),
    ).toContain('best(3) > good(2)'))
  it('negative count', () =>
    expect(
      join(checkStatsInvariants({ played: -1, good: 0, streak: 0, best: 0, times: [] }, 'stats')),
    ).toContain('played'))
  it('non-integer count', () =>
    expect(
      join(checkStatsInvariants({ played: 1.5, good: 0, streak: 0, best: 0, times: [] }, 'stats')),
    ).toContain('played'))
  it('more times than credits', () =>
    expect(
      join(
        checkStatsInvariants({ played: 3, good: 1, streak: 1, best: 1, times: [1, 2] }, 'stats'),
      ),
    ).toContain('times.length(2) > good(1)'))
  it('a non-finite time', () =>
    expect(
      join(
        checkStatsInvariants({ played: 2, good: 2, streak: 2, best: 2, times: [1, NaN] }, 'stats'),
      ),
    ).toContain('non-finite'))
  it('a negative time', () =>
    expect(
      join(
        checkStatsInvariants({ played: 2, good: 2, streak: 2, best: 2, times: [1, -3] }, 'stats'),
      ),
    ).toContain('non-finite/negative'))
  it('stats not an object', () =>
    expect(join(checkStatsInvariants(null, 'stats'))).toContain('not an object'))
})

describe('checkGameInvariants — healthy engine states', () => {
  it('a fresh engine is healthy', () =>
    expect(checkGameInvariants(initEngine(DATE), false)).toEqual([]))
  it('stays healthy after a correct answer', () => {
    const s = gameReducer(initEngine(DATE), {
      type: 'ANSWER',
      idx: C,
      useJulian: false,
      elapsed: null,
      tracking: false,
      saveStats: true,
      nextDate: NEXT,
    })
    expect(checkGameInvariants(s, false)).toEqual([])
  })
})

describe('checkGameInvariants — catches structural corruption', () => {
  it('backDepth out of lockstep with forwardStack', () =>
    expect(join(checkGameInvariants({ ...initEngine(DATE), backDepth: 2 }, false))).toContain(
      'backDepth(2) != forwardStack.length(0)',
    ))
  it('a corrupt month', () =>
    expect(
      join(checkGameInvariants({ ...initEngine(DATE), date: { y: 2024, m: 13, d: 1 } }, false)),
    ).toContain('month out of 1-12'))
  it('a corrupt day', () =>
    expect(
      join(checkGameInvariants({ ...initEngine(DATE), date: { y: 2024, m: 1, d: 99 } }, false)),
    ).toContain('day out of 1-31'))
  it('a Deduction puzzle whose correct answer is not among its options', () => {
    const bad = { type: 'day', y: 2024, m: 1, d: 15, w: 1, options: [1, 2, 3] } // d=15 not selectable
    expect(join(checkGameInvariants({ ...initEngine(DATE), date: bad }, false))).toContain(
      'not among its options',
    )
  })
})

// ── The card-number ledger (sub-group 3A) ─────────────────────────────────────────────────────
// The Q# badge is `historyBase + stack.length + 1`, which is only a LIFETIME number because the
// engine keeps one exact correspondence: every history entry is exactly one increment of `played`.
// That is a true impossibility if it ever breaks, so it belongs here — the fuzz then proves it
// across millions of generated games instead of it resting on an argument in a comment.
describe('checkGameInvariants — the card-number ledger', () => {
  it('holds on a fresh engine, hydrated or blank', () => {
    expect(checkGameInvariants(initEngine(DATE), false)).toEqual([])
    const hydrated = { played: 40, good: 30, streak: 2, best: 9, times: [] }
    expect(checkGameInvariants(initEngine(DATE, hydrated), false)).toEqual([])
  })

  it('holds through a played card and a browse back onto it', () => {
    const hydrated = { played: 40, good: 30, streak: 2, best: 9, times: [] }
    let s = gameReducer(initEngine(DATE, hydrated), {
      type: 'ANSWER',
      idx: C,
      useJulian: false,
      elapsed: null,
      tracking: false,
      saveStats: true,
      nextDate: NEXT,
    })
    expect(checkGameInvariants(s, false)).toEqual([])
    s = gameReducer(s, { type: 'BACK' }) // the live card is now the isLive forward entry
    expect(checkGameInvariants(s, false)).toEqual([])
  })

  it('catches a base that drifted from played (the badge would lie about the score)', () => {
    const s = { ...initEngine(DATE), historyBase: 3 } // 3 + 0 history + 0 live != played 0
    expect(join(checkGameInvariants(s, false))).toContain('card ledger')
  })

  it('catches a history entry with no played behind it', () => {
    const s = { ...initEngine(DATE), stack: [{ ...DATE, btns: { 0: 'correct' } }] }
    expect(join(checkGameInvariants(s, false))).toContain('card ledger')
  })

  it('catches a non-integer base', () => {
    expect(join(checkGameInvariants({ ...initEngine(DATE), historyBase: 1.5 }, false))).toContain(
      'historyBase',
    )
  })
})

// ── The per-card Override record (round 23 Q6) ─────────────────────────────────────────────────
// Every scored card holds two fixed states — A (as answered) and O (overridden) — and its credit is
// A.credited XOR overridden. A card in O stores its A in `meta.answered`; these tripwires catch a
// record that has come apart from the card it describes, which is the one way a toggle could
// silently stack credit or strand a time.
describe('checkGameInvariants — the per-card Override record', () => {
  const ov = (s, extra = {}) =>
    gameReducer(s, {
      type: 'OVERRIDE',
      useJulian: false,
      tracking: true,
      nextDate: NEXT,
      ...extra,
    })
  const answer = (s, idx, extra = {}) =>
    gameReducer(s, {
      type: 'ANSWER',
      idx,
      useJulian: false,
      elapsed: 0.5,
      tracking: true,
      saveStats: true,
      nextDate: NEXT,
      ...extra,
    })
  const W = (C + 1) % 7
  // A history card in O (credited — the wrong answer's time frozen as its oTime), and a live one.
  const retroCredited = () => ov(answer(answer(initEngine(DATE), W), C))
  const liveUncredited = () => ov(answer(initEngine(DATE), C, { complete: true }))
  const tail = (s) => s.stack[s.stack.length - 1]
  const withTail = (s, patch) => ({
    ...s,
    stack: [...s.stack.slice(0, -1), { ...tail(s), ...patch }],
  })

  it('real toggles leave healthy records — history, live, browsed and parked', () => {
    expect(checkGameInvariants(retroCredited(), false)).toEqual([])
    expect(checkGameInvariants(liveUncredited(), false)).toEqual([])
    const one = answer(initEngine(DATE), C) // a card behind, then the live card held and overridden
    const held = answer(one, wday(one.date.y, one.date.m, one.date.d), { complete: true })
    const parked = gameReducer(ov(held), { type: 'BACK' })
    expect(parked.forwardStack[0].meta.answered.live).toBeDefined()
    expect(parked.forwardStack[0].isLive).toBe(true)
    expect(checkGameInvariants(parked, false)).toEqual([])
  })

  it('1 — an overridden card whose credit is not the opposite of its as-answered credit', () => {
    const s = retroCredited()
    const bad = withTail(s, {
      meta: { ...tail(s).meta, answered: { ...tail(s).meta.answered, hasCredit: true } },
    })
    expect(join(checkGameInvariants(bad, false))).toContain('credit is not the opposite')
  })

  it('2 — an overridden card whose grid is not the answer alone', () => {
    const s = retroCredited()
    expect(
      join(checkGameInvariants(withTail(s, { btns: { [C]: 'override-wrong' } }), false)),
    ).toContain('grid')
    const two = withTail(s, { btns: { [C]: 'correct', [W]: 'wrong-prev' } })
    expect(join(checkGameInvariants(two, false))).toContain('grid')
    // …the live card is checked the same way.
    const live = { ...liveUncredited(), persistBtns: { [C]: 'correct' } }
    expect(join(checkGameInvariants(live, false))).toContain('grid')
  })

  it('3 — an uncredited state holding a time, on the card or in its stored as-answered state', () => {
    const s = liveUncredited()
    const a = { ...s.card.answered, hasCredit: false, solveTime: 0.5 }
    const bad = { ...s, card: { ...s.card, answered: a } }
    expect(join(checkGameInvariants(bad, false))).toContain('uncredited')
  })

  it('4 — a credited overridden card contributing anything but its frozen O time', () => {
    const s = retroCredited()
    const bad = withTail(s, { meta: { ...tail(s).meta, oTime: 9 } })
    expect(join(checkGameInvariants(bad, false))).toContain('frozen O time')
  })

  it('5 — live flags on a history card, or none on the live one', () => {
    const s = retroCredited()
    const a = {
      ...tail(s).meta.answered,
      live: { locked: true, revealed: true, countedWrong: true, calcPenaltyActive: false },
    }
    const bad = withTail(s, { meta: { ...tail(s).meta, answered: a } })
    expect(join(checkGameInvariants(bad, false))).toContain('live flags')
    const l = liveUncredited()
    const { live, ...rest } = l.card.answered
    expect(live).toBeDefined()
    expect(
      join(checkGameInvariants({ ...l, card: { ...l.card, answered: rest } }, false)),
    ).toContain('live flags')
  })

  it('7 — a timed-out card credited or overridden', () => {
    const s = retroCredited() // its tail is an overridden credit…
    const bad = withTail(s, { meta: { ...tail(s).meta, timedOut: true } }) // …that the clock timed out
    expect(join(checkGameInvariants(bad, false))).toContain('timed-out')
    const t = gameReducer(initEngine(DATE), {
      type: 'TIMEOUT_MISS',
      useJulian: false,
      saveStats: true,
    })
    expect(checkGameInvariants(t, false)).toEqual([]) // the real thing is healthy
  })

  // The shape an older build's migrated blob once reached: a credited O still carrying the codes
  // penalty its as-answered state had, so the first Undo lost it (second review round, F2).
  it('6 — an overridden live card not wearing the overridden flags, on screen or parked', () => {
    const credited = ov(answer(initEngine(DATE), W), { hold: true }) // a held credited O
    expect(checkGameInvariants(credited, false)).toEqual([])
    expect(join(checkGameInvariants({ ...credited, calcPenaltyActive: true }, false))).toContain(
      'overridden shape',
    )
    const miss = liveUncredited()
    expect(join(checkGameInvariants({ ...miss, locked: false }, false))).toContain(
      'overridden shape',
    )
    const one = answer(initEngine(DATE), C) // a card behind, so there is somewhere to browse to
    const parked = gameReducer(ov(answer(one, W), { hold: true }), { type: 'BACK' }) // W is wrong for NEXT too
    expect(checkGameInvariants(parked, false)).toEqual([])
    const f0 = parked.forwardStack[0]
    const bad = {
      ...parked,
      forwardStack: [{ ...f0, liveState: { ...f0.liveState, revealed: true } }],
    }
    expect(join(checkGameInvariants(bad, false))).toContain('overridden shape')
  })
})
