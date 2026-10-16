// @vitest-environment jsdom
//
// freeze — AN ENGINE STATE IS NEVER CHANGED IN PLACE, and this is what makes that a fact instead of a
// habit (engine/freeze). engine/invariants remembers which history cards have passed its calendar
// tripwires by object identity, which is sound only while no card, and no history array, is ever
// written into. A frozen state turns any such write into a throw at the line that tried it.
//
// Three things are pinned here: what deepFreeze freezes (everything under the value, and nothing it
// has frozen before is walked again); that every door into the engine works on frozen states — the
// reducer's every action, the restore door, forgetting the oldest cards (the fuzz survey holds the
// same over millions of sequences, freezing every state it makes); and that the hook hands out frozen
// states in development and under test, so a screen that wrote into one would be caught by the suite.
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { deepFreeze } from '../../src/engine/freeze.js'
import {
  gameReducer,
  initEngine,
  correctIndexOf,
  forgetOldestCards,
} from '../../src/engine/gameReducer.js'
import { checkGameInvariants } from '../../src/engine/invariants.js'
import { restoreParkedEngine } from '../../src/engine/parkedEngine.js'
import { useGameEngine } from '../../src/engine/useGameEngine.js'

const q = (i) => ({
  y: 1990 + i,
  m: 1 + (i % 12),
  d: 1 + (i % 28),
  _fmt: 'numeric-ymd',
})
const right = (s) => correctIndexOf(s.date, false)
const wrong = (s) => (right(s) + 1) % 7

// Is everything reachable from `v` frozen?
function everythingFrozen(v) {
  if (typeof v !== 'object' || v === null) return true
  return Object.isFrozen(v) && Object.values(v).every(everythingFrozen)
}

describe('deepFreeze', () => {
  it('freezes the value and everything under it, and returns the same object', () => {
    const v = { a: { b: [{ c: 1 }, { d: { e: 2 } }] }, n: 3, s: 'x', z: null }
    expect(deepFreeze(v)).toBe(v)
    expect(everythingFrozen(v)).toBe(true)
  })
  it('leaves what is not an object alone', () => {
    for (const v of [1, 'x', null, undefined, true]) expect(deepFreeze(v)).toBe(v)
  })
  it('a write into a frozen state throws — an entry, its grid, a history array, the times', () => {
    let s = deepFreeze(initEngine(q(0)))
    s = deepFreeze(
      gameReducer(s, {
        type: 'ANSWER',
        idx: right(s),
        useJulian: false,
        elapsed: 1.5,
        tracking: true,
        saveStats: true,
        nextDate: q(1),
      }),
    )
    expect(() => (s.stack[0].hasCredit = false)).toThrow(TypeError)
    expect(() => (s.stack[0].btns[3] = 'wrong-latest')).toThrow(TypeError)
    expect(() => (s.stack[0].meta.jul = true)).toThrow(TypeError)
    expect(() => s.stack.push(s.stack[0])).toThrow(TypeError)
    expect(() => (s.stack[0] = { ...s.stack[0] })).toThrow(TypeError)
    expect(() => s.stats.times.push(9)).toThrow(TypeError)
    expect(() => (s.stats.good = 99)).toThrow(TypeError)
    expect(() => (s.date.y = 1)).toThrow(TypeError)
    expect(() => (s.card.wrongTime = 1)).toThrow(TypeError)
  })
  it('is incremental: what an earlier state froze is shared, not walked again — and the new parts are frozen', () => {
    let s = deepFreeze(initEngine(q(0)))
    const dispatch = (a) =>
      (s = deepFreeze(gameReducer(s, { useJulian: false, saveStats: true, ...a })))
    for (let i = 1; i <= 5; i++)
      dispatch({ type: 'ANSWER', idx: right(s), elapsed: i, tracking: true, nextDate: q(i) })
    const before = s
    dispatch({ type: 'ANSWER', idx: wrong(s), elapsed: 1, tracking: true, nextDate: q(9) })
    expect(s).not.toBe(before)
    expect(s.stack).toBe(before.stack) // a wrong answer leaves the history where it was
    expect(everythingFrozen(s)).toBe(true)
    // ⚠ The contract the skip rests on: deepFreeze is the ONLY thing that freezes engine data. An
    // object frozen by hand over an unfrozen child is taken at its word, child and all.
    const byHand = Object.freeze({ child: { n: 1 } })
    deepFreeze(byHand)
    expect(Object.isFrozen(byHand.child)).toBe(false)
  })
})

describe('every door into the engine works on a frozen state, and returns one that can be frozen', () => {
  // One of every action, each applied to a state frozen all the way down. A case that wrote into
  // its input instead of returning new objects would throw here.
  it('the reducer — every action, browsing included', () => {
    let s = deepFreeze(initEngine(q(0)))
    const D = (a) => {
      s = deepFreeze(gameReducer(s, { useJulian: false, saveStats: true, tracking: true, ...a }))
      expect(checkGameInvariants(s, false)).toEqual([])
    }
    D({ type: 'ANSWER', idx: right(s), elapsed: 1.1, nextDate: q(1) }) //      a clean credit
    D({ type: 'ANSWER', idx: wrong(s), elapsed: 0.7, nextDate: q(2) }) //      a miss…
    D({ type: 'OVERRIDE', nextDate: q(2) }) //                                 …credited, moves on
    D({ type: 'OVERRIDE', nextDate: q(3) }) //                                 Undo, on the card behind
    D({ type: 'REVEAL', elapsed: 2 })
    D({ type: 'OVERRIDE', nextDate: q(3), hold: true }) //                     held on the live card
    D({ type: 'OVERRIDE', nextDate: q(3), hold: true }) //                     and undone
    D({ type: 'NEW', nextDate: q(4) })
    D({ type: 'SHOW_CODES', open: true, elapsed: 3 })
    D({ type: 'SHOW_CODES', open: false, elapsed: null })
    D({ type: 'BACK' })
    D({ type: 'BACK' })
    D({ type: 'OVERRIDE', nextDate: q(5) }) //                                 a browsed card
    D({ type: 'REVEAL', elapsed: 1 })
    D({ type: 'REGEN_DATE', nextDate: q(6) }) //                               the live card waits ahead
    D({ type: 'FORWARD' })
    D({ type: 'NEW', nextDate: q(7) }) //                                      from mid-browse
    D({ type: 'REGEN_DATE', nextDate: q(8) })
    D({ type: 'ANSWER', idx: right(s), elapsed: 1, nextDate: q(9), complete: true })
    D({ type: 'NEW', nextDate: q(10) })
    D({ type: 'LOCK_REVEAL' })
    D({ type: 'NEW', nextDate: q(11) })
    D({ type: 'TIMEOUT_MISS' })
    D({ type: 'RESET_ROUND' })
    D({ type: 'ANSWER', idx: right(s), elapsed: 1, nextDate: q(12) })
    D({ type: 'RESET', timingOff: true, nextDate: q(13) })
    expect(everythingFrozen(s)).toBe(true)
  })

  it('forgetting the oldest cards, and the restore door — a blob this build parked', () => {
    let s = deepFreeze(initEngine(q(0)))
    for (let i = 1; i <= 4; i++)
      s = deepFreeze(
        gameReducer(s, {
          type: 'ANSWER',
          idx: i === 2 ? wrong(s) : right(s),
          useJulian: false,
          elapsed: i,
          tracking: true,
          saveStats: true,
          nextDate: q(i),
        }),
      )
    const fewer = deepFreeze(forgetOldestCards(s, 1))
    expect(fewer.stack).toHaveLength(s.stack.length - 1)
    expect(checkGameInvariants(fewer, false)).toEqual([])

    const blob = deepFreeze(JSON.parse(JSON.stringify(s)))
    expect(restoreParkedEngine(blob, false, 'classic')).toBe(blob)
  })
})

describe('useGameEngine, in development and under test', () => {
  const opts = {
    genDate: () => q(3),
    minY: 1583,
    maxY: 10000,
    useJulian: false,
    saveStats: true,
    timingOff: false,
    play: 'question',
  }
  it('the first state and every state after an action are frozen all the way down', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    expect(everythingFrozen(result.current.state)).toBe(true)
    act(() => result.current.answer(wrong(result.current.state)))
    act(() => result.current.override())
    act(() => result.current.back())
    expect(result.current.state.stack).toHaveLength(0)
    expect(result.current.state.forwardStack).toHaveLength(1)
    expect(everythingFrozen(result.current.state)).toBe(true)
    expect(() => (result.current.state.forwardStack[0].btns = {})).toThrow(TypeError)
  })
  it('…including one seeded from saved stats and one seeded from a parked state', () => {
    const saved = { played: 3, good: 2, streak: 1, best: 2, times: [1.5, 2.5] }
    const hydrated = renderHook(() => useGameEngine({ ...opts, getInitialStats: () => saved }))
    expect(everythingFrozen(hydrated.result.current.state)).toBe(true)
    const parked = gameReducer(initEngine(q(1)), {
      type: 'REVEAL',
      useJulian: false,
      elapsed: 1,
      saveStats: true,
    })
    const restored = renderHook(() => useGameEngine({ ...opts, getInitialState: () => parked }))
    expect(restored.result.current.state).toBe(parked)
    expect(everythingFrozen(parked)).toBe(true)
  })
})
