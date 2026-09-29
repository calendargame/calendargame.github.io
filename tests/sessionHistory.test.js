// @vitest-environment jsdom
//
// sessionHistory — round 23 Q11: the store that parks a casual mode's history for the reload that may
// follow (store/sessionHistory). This file pins the store on its own: what is parked (the engine,
// without the saved times), what a restore accepts (only the exact state the saved stats support,
// through the one engine restore door), what it refuses and reports, and the size budgets — the
// oldest cards forgotten to fit, the other slots dropped longest-first, a refused write never leaving
// an older copy behind. The screens' wiring is pinned in tests/sessionHistory.dom, and the round trip
// over millions of reachable states in tests/engine/fuzz (reload-ref / reload-trim).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureError } from '../src/observability/sentry.js'
vi.mock('../src/observability/sentry.js', () => ({ captureError: vi.fn() }))
import {
  parkSessionHistory,
  restoreSessionHistory,
  discardSessionHistory,
  discardSessionHistories,
  discardSessionHistoriesOf,
  hasSessionHistory,
  discardAllSessionHistories,
  SLOT_BUDGET,
  TOTAL_BUDGET,
} from '../src/store/sessionHistory.js'
import { gameReducer, initEngine, correctIndexOf, cardNumber } from '../src/engine/gameReducer.js'
import { checkGameInvariants } from '../src/engine/invariants.js'

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
    s = gameReducer(s, { ...base, idx: c, elapsed: 2.25, nextDate: q() })
  }
  for (let i = 0; i < back; i++) s = gameReducer(s, { type: 'BACK' })
  return s
}
const KEY = (dataId, silo) => `cg-history-v1:${dataId}:${silo}`

beforeEach(() => {
  discardAllSessionHistories()
  vi.mocked(captureError).mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('park → restore: the exact state comes back', () => {
  it('a browsed-back history, over the same saved stats', () => {
    const s = play(12, 3)
    parkSessionHistory('1:saved', 'classic', s, { showTimerDate: true })
    const back = restoreSessionHistory('1:saved', 'classic', s.stats, false)
    expect(back.engine).toEqual(JSON.parse(JSON.stringify(s)))
    expect(back.ui).toEqual({ showTimerDate: true })
    expect(captureError).not.toHaveBeenCalled()
  })
  it('the saved times are NOT parked — the restore puts the saved pool back', () => {
    const s = play(5)
    parkSessionHistory('1:saved', 'classic', s)
    const parked = JSON.parse(sessionStorage.getItem(KEY('1:saved', 'classic')))
    expect(parked.engine.stats).not.toHaveProperty('times')
    // …so the pool that comes back can only be the saved one handed in.
    expect(restoreSessionHistory('1:saved', 'classic', s.stats, false).engine.stats.times).toEqual(
      s.stats.times,
    )
  })
  it('nothing parked → null', () => {
    expect(restoreSessionHistory('1:saved', 'classic', play(1).stats, false)).toBe(null)
  })
  it('keyed by stats copy and silo: nothing crosses', () => {
    const s = play(4)
    parkSessionHistory('1:saved', 'classic', s)
    expect(restoreSessionHistory('1:session', 'classic', s.stats, false)).toBe(null)
    expect(restoreSessionHistory('2:saved', 'classic', s.stats, false)).toBe(null)
    expect(restoreSessionHistory('1:saved', 'flash', s.stats, false)).toBe(null)
    expect(restoreSessionHistory('1:saved', 'classic', s.stats, false)).not.toBe(null)
  })
})

describe('restore: only the state the saved stats support', () => {
  it('saved stats that moved on (another writer) → null, silently', () => {
    const s = play(6)
    parkSessionHistory('1:saved', 'classic', s)
    const later = play(1, 0, s).stats
    expect(restoreSessionHistory('1:saved', 'classic', later, false)).toBe(null)
    expect(restoreSessionHistory('1:saved', 'classic', { ...s.stats, best: 99 }, false)).toBe(null)
    expect(captureError).not.toHaveBeenCalled()
  })
  it('a saved pool the cards do not name in play order → null, and reported', () => {
    const s = play(6)
    parkSessionHistory('1:saved', 'classic', s)
    const swapped = { ...s.stats, times: [...s.stats.times].reverse().map((t, i) => t + i) }
    expect(restoreSessionHistory('1:saved', 'classic', swapped, false)).toBe(null)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({
      where: 'restore-parked-history',
      mode: 'classic',
    })
  })
  it('a tampered ledger → null, and reported', () => {
    const s = play(6)
    sessionStorage.setItem(
      KEY('1:saved', 'classic'),
      JSON.stringify({ engine: { ...s, historyBase: 3, stats: { ...s.stats, times: undefined } } }),
    )
    expect(restoreSessionHistory('1:saved', 'classic', s.stats, false)).toBe(null)
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
    sessionStorage.setItem(KEY('1:saved', 'classic'), text)
    expect(restoreSessionHistory('1:saved', 'classic', play(1).stats, false)).toBe(null)
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureError).mock.calls[0][1]).toMatchObject({ where })
  })
})

describe('the size budgets', () => {
  it('a history past its slot budget keeps its NEWEST cards — scores and numbering exact', () => {
    const s = play(4200)
    expect(JSON.stringify(s).length).toBeGreaterThan(SLOT_BUDGET)
    parkSessionHistory('1:saved', 'classic', s)
    const text = sessionStorage.getItem(KEY('1:saved', 'classic'))
    expect(text.length).toBeLessThanOrEqual(SLOT_BUDGET)
    const back = restoreSessionHistory('1:saved', 'classic', s.stats, false).engine
    expect(back.stack.length).toBeLessThan(s.stack.length)
    expect(back.stack.length).toBeGreaterThan(2000)
    expect(back.stack.at(-1)).toEqual(JSON.parse(JSON.stringify(s.stack.at(-1))))
    expect(back.historyBase + back.stack.length).toBe(s.historyBase + s.stack.length)
    expect(cardNumber(back)).toBe(cardNumber(s))
    expect(checkGameInvariants(back, false)).toEqual([])
    // …and a press on the oldest card still there lands on the same scores both ways.
    const toBottom = (x) => {
      while (x.stack.length) x = gameReducer(x, { type: 'BACK' })
      return x
    }
    const press = { type: 'OVERRIDE', useJulian: false, tracking: true, nextDate: q() }
    const a = gameReducer(toBottom(back), press)
    let b = s
    for (let i = 0; i < back.stack.length; i++) b = gameReducer(b, { type: 'BACK' })
    b = gameReducer(b, press)
    expect(a.stats).toEqual(b.stats)
  })
  it('all histories together stay under the total budget — the others go, longest first', () => {
    const big = play(3000)
    const mid = play(1500)
    const small = play(40)
    parkSessionHistory('1:saved', 'dedDay', mid)
    parkSessionHistory('1:saved', 'dedMonth', small)
    parkSessionHistory('1:saved', 'dedYear', big)
    parkSessionHistory('1:saved', 'classic', big) // this one needs room: the longest other goes
    const len = (s) => sessionStorage.getItem(KEY('1:saved', s))?.length ?? 0
    expect(len('dedYear')).toBe(0)
    expect(len('dedDay')).toBeGreaterThan(0)
    expect(len('dedMonth')).toBeGreaterThan(0)
    expect(len('classic') + len('dedDay') + len('dedMonth')).toBeLessThanOrEqual(TOTAL_BUDGET)
  })
  it('a write the browser refuses removes the slot — an older copy never comes back instead', () => {
    const old = play(3)
    parkSessionHistory('1:saved', 'classic', old)
    const quota = new DOMException('full', 'QuotaExceededError')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota
    })
    expect(() => parkSessionHistory('1:saved', 'classic', play(2, 0, old))).not.toThrow()
    vi.restoreAllMocks()
    expect(sessionStorage.getItem(KEY('1:saved', 'classic'))).toBe(null)
  })
  it('a browser that refuses sessionStorage outright: nothing throws, nothing restores', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const s = play(2)
    expect(() => parkSessionHistory('1:saved', 'classic', s)).not.toThrow()
    expect(restoreSessionHistory('1:saved', 'classic', s.stats, false)).toBe(null)
    expect(() => discardSessionHistories(1)).not.toThrow()
    expect(hasSessionHistory(1)).toBe(false)
  })
})

describe('discards', () => {
  it('one slot / one copy / one preset — and preset 1 never claims preset 11', () => {
    const s = play(2)
    for (const id of ['1:saved', '1:session', '11:saved'])
      for (const silo of ['classic', 'flash']) parkSessionHistory(id, silo, s)
    discardSessionHistory('1:saved', 'flash')
    expect(sessionStorage.getItem(KEY('1:saved', 'flash'))).toBe(null)
    expect(sessionStorage.getItem(KEY('1:saved', 'classic'))).not.toBe(null)
    discardSessionHistoriesOf('1:session')
    expect(sessionStorage.getItem(KEY('1:session', 'classic'))).toBe(null)
    expect(hasSessionHistory(1)).toBe(true)
    discardSessionHistories(1)
    expect(hasSessionHistory(1)).toBe(false)
    expect(hasSessionHistory(11)).toBe(true)
  })
})
