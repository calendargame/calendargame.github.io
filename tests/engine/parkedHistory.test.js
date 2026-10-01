// parkedHistory — round 23: what a casual mode's parked history IS and what comes back from one
// (engine/parkedHistory). Pinned here on its own: the parked text (the engine, without the saved
// times), the restore (only the exact state the saved stats support, and only through the one engine
// restore door — engine/parkedEngine), what it refuses and reports, and the budget cut — the oldest cards forgotten, every
// score and number exact. The storage half is tests/sessionHistory, the screens' wiring
// tests/sessionHistory.dom, and the round trip over millions of reachable states tests/engine/fuzz
// (reload-ref / reload-trim).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { captureError } from '../../src/observability/sentry.js'
vi.mock('../../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
import {
  parkedText,
  fittedParkedText,
  restoreParkedText,
  parkedFlag,
} from '../../src/engine/parkedHistory.js'
import {
  gameReducer,
  initEngine,
  correctIndexOf,
  cardNumber,
  forgetOldestCards,
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'

// A weekday question with a fixed, valid date (the reducer never looks at anything else).
let n = 0
const q = () => {
  n++
  return { y: 1900 + (n % 200), m: 1 + (n % 12), d: 1 + (n % 28), _fmt: 'numeric-ymd', _jul: false }
}
// Play `cards` answers (every third one wrong first, then right) with timing tracked, then Back `back`
// times — a history with credits, misses, times and a browsed position.
function play(cards, back = 0, start = initEngine(q())) {
  let s = start
  for (let i = 0; i < cards; i++) {
    const c = correctIndexOf(s.date, false)
    const base = { type: 'ANSWER', useJulian: false, tracking: true, saveStats: true }
    if (i % 3 === 0) s = gameReducer(s, { ...base, idx: (c + 1) % 7, elapsed: 1.5, nextDate: q() })
    s = gameReducer(s, { ...base, idx: c, elapsed: 2.25 + i / 10, nextDate: q() })
  }
  for (let i = 0; i < back; i++) s = gameReducer(s, { type: 'BACK' })
  return s
}
const plain = (s) => JSON.parse(JSON.stringify(s))
// What a screen with no fields of its own parks beside its engine.
const SCREEN = { config: '' }

beforeEach(() => vi.mocked(captureError).mockClear())

describe('park → restore: the exact state comes back', () => {
  it('a browsed-back history, with the screen fields, over the same saved stats', () => {
    const s = play(12, 3)
    const back = restoreParkedText(
      parkedText(s, { ui: { showTimerDate: true }, config: 'a|b' }),
      s.stats,
      false,
      'flash',
    )
    expect(back.engine).toEqual(plain(s))
    expect(back.ui).toEqual({ showTimerDate: true })
    expect(back.config).toBe('a|b')
    expect(parkedFlag(back.ui, 'showTimerDate')).toBe(true)
    expect(parkedFlag(back.ui, 'somethingElse')).toBe(false)
    expect(parkedFlag({ showTimerDate: 'yes' }, 'showTimerDate')).toBe(false) // only a real true
    expect(parkedFlag(undefined, 'showTimerDate')).toBe(false)
    expect(captureError).not.toHaveBeenCalled()
  })
  it('the saved times are NOT parked — the pool that comes back is the saved one handed in', () => {
    const s = play(5)
    expect(JSON.parse(parkedText(s, SCREEN)).engine.stats).not.toHaveProperty('times')
    expect(
      restoreParkedText(parkedText(s, SCREEN), s.stats, false, 'classic').engine.stats.times,
    ).toEqual(s.stats.times)
  })
  it('nothing parked → null', () => {
    expect(restoreParkedText(null, play(1).stats, false, 'classic')).toBe(null)
  })
})

describe('restore: only the state the saved stats support', () => {
  it('saved stats that moved on (another writer) → null, silently', () => {
    const s = play(6)
    const later = play(1, 0, s).stats
    expect(restoreParkedText(parkedText(s, SCREEN), later, false, 'classic')).toBe(null)
    expect(
      restoreParkedText(parkedText(s, SCREEN), { ...s.stats, best: 99 }, false, 'classic'),
    ).toBe(null)
    expect(captureError).not.toHaveBeenCalled()
  })
  it('a saved pool the cards do not name, second for second → null, and reported', () => {
    const s = play(6)
    const other = { ...s.stats, times: s.stats.times.map((t) => t + 1) }
    expect(restoreParkedText(parkedText(s, SCREEN), other, false, 'classic')).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({
      where: 'restore-parked-engine',
      mode: 'classic',
      reason: 'breaks an engine invariant',
    })
  })
  it('a tampered ledger → null, and reported', () => {
    const s = play(6)
    expect(
      restoreParkedText(parkedText({ ...s, historyBase: 3 }, SCREEN), s.stats, false, 'dedDay'),
    ).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['not JSON', '{"engine":', 'restore-parked-history'],
    ['JSON that is not a parked history', '42', 'restore-parked-engine'],
    [
      'an engine with no history',
      '{"engine":{"date":{"y":2000,"m":1,"d":1}}}',
      'restore-parked-engine',
    ],
  ])('%s → null, and one report', (_, text, where) => {
    expect(restoreParkedText(text, play(1).stats, false, 'classic')).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({ where })
  })
})

describe('the budget cut: the NEWEST cards are kept, every score and number exact', () => {
  it('forgetOldestCards moves nothing the player can see', () => {
    const s = play(40, 5)
    const cut = forgetOldestCards(s, 17)
    expect(cut.stack).toEqual(s.stack.slice(17))
    expect(cut.stats).toBe(s.stats)
    expect(cardNumber(cut)).toBe(cardNumber(s))
    expect(checkGameInvariants(cut, false)).toEqual([])
    expect(forgetOldestCards(s, 0)).toBe(s)
    expect(forgetOldestCards(s, 999).stack).toEqual([])
  })
  it('a text past its budget keeps its newest cards, fits, and restores over the same stats', () => {
    const s = play(4200)
    const budget = 500_000
    expect(parkedText(s, SCREEN).length).toBeGreaterThan(budget)
    const text = fittedParkedText(s, SCREEN, budget)
    expect(text.length).toBeLessThanOrEqual(budget)
    const back = restoreParkedText(text, s.stats, false, 'classic').engine
    expect(back.stack.length).toBeLessThan(s.stack.length)
    expect(back.stack.length).toBeGreaterThan(2000)
    expect(back.stack.at(-1)).toEqual(plain(s.stack.at(-1)))
    expect(back.historyBase + back.stack.length).toBe(s.historyBase + s.stack.length)
    expect(cardNumber(back)).toBe(cardNumber(s))
    // …and a press on the oldest card still there lands on the same scores both ways.
    let a = back
    while (a.stack.length) a = gameReducer(a, { type: 'BACK' })
    let b = s
    for (let i = 0; i < back.stack.length; i++) b = gameReducer(b, { type: 'BACK' })
    const press = { type: 'OVERRIDE', useJulian: false, tracking: true, nextDate: q() }
    expect(gameReducer(a, press).stats).toEqual(gameReducer(b, press).stats)
  })
  it('a text within its budget is parked whole', () => {
    const s = play(30)
    expect(fittedParkedText(s, SCREEN, 500_000)).toBe(parkedText(s, SCREEN))
  })
  it('nothing left to cut and still too long → null (the caller parks nothing)', () => {
    const s = play(3, 3) // browsed to the oldest: every card is out of the cut's reach
    expect(s.stack.length).toBe(0)
    expect(fittedParkedText(s, SCREEN, 100)).toBe(null)
  })
})
