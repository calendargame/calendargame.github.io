// @vitest-environment jsdom
//
// sessionHistory — round 23 Q11: the STORAGE half of a casual mode's parked history (store/
// sessionHistory), which never looks inside what it stores — so this file stores plain text. It pins
// the key (one slot per stats copy and silo, nothing crossing), the total budget (the other slots
// dropped longest-first to make room), a refused write never leaving an older copy behind, a browser
// that refuses sessionStorage outright, and the discards. What a parked history IS and what comes
// back from one is tests/engine/parkedHistory; the screens' wiring is tests/sessionHistory.dom.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readSessionHistory,
  writeSessionHistory,
  discardSessionHistory,
  discardSessionHistories,
  discardSessionHistoriesOf,
  hasSessionHistory,
  discardAllSessionHistories,
  TOTAL_BUDGET,
} from '../src/store/sessionHistory.js'

beforeEach(() => discardAllSessionHistories())
afterEach(() => vi.restoreAllMocks())

describe('one slot per (stats copy, silo)', () => {
  it('reads back what was written, and nothing crosses', () => {
    writeSessionHistory('1:saved', 'classic', 'A')
    expect(readSessionHistory('1:saved', 'classic')).toBe('A')
    expect(readSessionHistory('1:session', 'classic')).toBe(null)
    expect(readSessionHistory('2:saved', 'classic')).toBe(null)
    expect(readSessionHistory('1:saved', 'flash')).toBe(null)
  })
  it('a key no older build has ever read', () => {
    writeSessionHistory('1:saved', 'dedDay', 'A')
    expect(sessionStorage.getItem('cg-history-v1:1:saved:dedDay')).toBe('A')
  })
})

describe('the total budget', () => {
  it('makes room by dropping the OTHER slots, longest first — only as many as it must', () => {
    const third = Math.floor(TOTAL_BUDGET / 3)
    writeSessionHistory('1:saved', 'dedDay', 'd'.repeat(third))
    writeSessionHistory('1:saved', 'dedMonth', 'm'.repeat(100))
    writeSessionHistory('1:saved', 'dedYear', 'y'.repeat(third + 10))
    writeSessionHistory('1:saved', 'classic', 'c'.repeat(third + 10)) // one other must go
    expect(readSessionHistory('1:saved', 'dedYear')).toBe(null) // the longest
    expect(readSessionHistory('1:saved', 'dedDay')).not.toBe(null)
    expect(readSessionHistory('1:saved', 'dedMonth')).not.toBe(null)
    expect(readSessionHistory('1:saved', 'classic')).not.toBe(null)
  })
  it('re-parking a slot never counts its own old copy against it', () => {
    const half = Math.floor(TOTAL_BUDGET / 2)
    writeSessionHistory('1:saved', 'flash', 'f'.repeat(half))
    writeSessionHistory('1:saved', 'classic', 'a'.repeat(half))
    writeSessionHistory('1:saved', 'classic', 'b'.repeat(half))
    expect(readSessionHistory('1:saved', 'flash')).not.toBe(null)
  })
  it('never touches anything that is not a parked history', () => {
    sessionStorage.setItem('cg-round-v2', 'x'.repeat(TOTAL_BUDGET))
    writeSessionHistory('1:saved', 'classic', 'c'.repeat(TOTAL_BUDGET))
    expect(sessionStorage.getItem('cg-round-v2')).not.toBe(null)
    sessionStorage.removeItem('cg-round-v2')
  })
})

describe('failing safe', () => {
  it('a write the browser refuses removes the slot — an older copy never comes back instead', () => {
    writeSessionHistory('1:saved', 'classic', 'old')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => writeSessionHistory('1:saved', 'classic', 'new')).not.toThrow()
    vi.restoreAllMocks()
    expect(readSessionHistory('1:saved', 'classic')).toBe(null)
  })
  it('a browser that refuses sessionStorage outright: nothing throws, nothing is there', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => writeSessionHistory('1:saved', 'classic', 'A')).not.toThrow()
    expect(readSessionHistory('1:saved', 'classic')).toBe(null)
    expect(() => discardSessionHistory('1:saved', 'classic')).not.toThrow()
    expect(() => discardSessionHistories(1)).not.toThrow()
    expect(() => discardAllSessionHistories()).not.toThrow()
    expect(hasSessionHistory(1)).toBe(false)
  })
})

describe('discards', () => {
  it('one slot / one copy / one preset — and preset 1 never claims preset 11', () => {
    for (const id of ['1:saved', '1:session', '11:saved'])
      for (const silo of ['classic', 'flash']) writeSessionHistory(id, silo, 'A')
    discardSessionHistory('1:saved', 'flash')
    expect(readSessionHistory('1:saved', 'flash')).toBe(null)
    expect(readSessionHistory('1:saved', 'classic')).not.toBe(null)
    discardSessionHistoriesOf('1:session')
    expect(readSessionHistory('1:session', 'classic')).toBe(null)
    expect(readSessionHistory('1:saved', 'classic')).not.toBe(null)
    expect(hasSessionHistory(1)).toBe(true)
    discardSessionHistories(1)
    expect(hasSessionHistory(1)).toBe(false)
    expect(hasSessionHistory(11)).toBe(true)
  })
})
