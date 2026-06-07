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
    expect(checkStatsInvariants({ played: 0, good: 0, streak: 0, best: 0, times: [] }, 'stats')).toEqual([]))
  it('a normal consistent score', () =>
    expect(
      checkStatsInvariants({ played: 5, good: 3, streak: 2, best: 3, times: [1, 2, 3] }, 'stats'),
    ).toEqual([]))
})

describe('checkStatsInvariants — catches impossible scores', () => {
  it('good > played', () =>
    expect(join(checkStatsInvariants({ played: 1, good: 2, streak: 1, best: 1, times: [] }, 'stats'))).toContain(
      'good(2) > played(1)',
    ))
  it('streak > good', () =>
    expect(join(checkStatsInvariants({ played: 5, good: 2, streak: 3, best: 2, times: [] }, 'stats'))).toContain(
      'streak(3) > good(2)',
    ))
  it('best > good', () =>
    expect(join(checkStatsInvariants({ played: 5, good: 2, streak: 1, best: 3, times: [] }, 'stats'))).toContain(
      'best(3) > good(2)',
    ))
  it('negative count', () =>
    expect(join(checkStatsInvariants({ played: -1, good: 0, streak: 0, best: 0, times: [] }, 'stats'))).toContain(
      'played',
    ))
  it('non-integer count', () =>
    expect(join(checkStatsInvariants({ played: 1.5, good: 0, streak: 0, best: 0, times: [] }, 'stats'))).toContain(
      'played',
    ))
  it('more times than credits', () =>
    expect(join(checkStatsInvariants({ played: 3, good: 1, streak: 1, best: 1, times: [1, 2] }, 'stats'))).toContain(
      'times.length(2) > good(1)',
    ))
  it('a non-finite time', () =>
    expect(join(checkStatsInvariants({ played: 2, good: 2, streak: 2, best: 2, times: [1, NaN] }, 'stats'))).toContain(
      'non-finite',
    ))
  it('a negative time', () =>
    expect(join(checkStatsInvariants({ played: 2, good: 2, streak: 2, best: 2, times: [1, -3] }, 'stats'))).toContain(
      'non-finite/negative',
    ))
  it('stats not an object', () => expect(join(checkStatsInvariants(null, 'stats'))).toContain('not an object'))
})

describe('checkGameInvariants — healthy engine states', () => {
  it('a fresh engine is healthy', () => expect(checkGameInvariants(initEngine(DATE), false)).toEqual([]))
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
    expect(join(checkGameInvariants({ ...initEngine(DATE), date: { y: 2024, m: 13, d: 1 } }, false))).toContain(
      'month out of 1-12',
    ))
  it('a corrupt day', () =>
    expect(join(checkGameInvariants({ ...initEngine(DATE), date: { y: 2024, m: 1, d: 99 } }, false))).toContain(
      'day out of 1-31',
    ))
  it('a Deduction puzzle whose correct answer is not among its options', () => {
    const bad = { type: 'day', y: 2024, m: 1, d: 15, w: 1, options: [1, 2, 3] } // d=15 not selectable
    expect(join(checkGameInvariants({ ...initEngine(DATE), date: bad }, false))).toContain('not among its options')
  })
})
