// ─────────────────────────────────────────────────────────────────────────
// tests/engine/arrayCopy.test.js — the reducer's copies of a state's arrays (engine/arrayCopy).
//
// Two things are held here:
//   1. `withoutLast` IS `slice(0, -1)` — the same elements, in the same order, in a new array — for
//      every length, and it leaves what it was given alone.
//   2. THE RULE ITSELF: no press makes the reducer `slice` a frozen array. Every state is frozen in
//      a development build and under test, and `slice` on a frozen array is the slow copy that
//      engine/arrayCopy measures. This is not a timing test (a timing is not a fact a suite can
//      hold): it watches `slice` itself while each kind of press is dispatched.
// That the engine does exactly what it did is not this file's to show — the fuzz survey
// (tests/engine/fuzz) holds every state it reaches to the reference model and the invariants.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { withoutLast } from '../../src/engine/arrayCopy.js'
import { deepFreeze } from '../../src/engine/freeze.js'
import {
  gameReducer,
  initEngine,
  correctIndexOf,
  calendarOf,
} from '../../src/engine/gameReducer.js'

describe('withoutLast', () => {
  it('is slice(0, -1): the same elements in the same order, at every length', () => {
    for (let n = 0; n <= 40; n++) {
      const cards = Array.from({ length: n }, (_, i) => ({ i }))
      const times = Array.from({ length: n }, (_, i) => i * 1.37 + 0.5)
      for (const list of [cards, times, Object.freeze([...cards]), Object.freeze([...times])]) {
        const got = withoutLast(list)
        const want = list.slice(0, -1)
        expect(got).toEqual(want)
        expect(got).toHaveLength(Math.max(0, n - 1))
        // The very same elements, not copies of them.
        got.forEach((element, i) => expect(element).toBe(list[i]))
      }
    }
  })

  it('makes a new, ordinary array every time, and leaves the one it was given alone', () => {
    const list = Object.freeze([{ a: 1 }, { a: 2 }, { a: 3 }])
    const first = withoutLast(list)
    const second = withoutLast(list)
    expect(first).not.toBe(list)
    expect(first).not.toBe(second)
    expect(list).toHaveLength(3)
    expect(Object.isFrozen(first)).toBe(false)
    first.push('more')
    expect(first).toHaveLength(3)
    expect(second).toHaveLength(2)
    // Nothing to drop is still a new array, never the one handed in.
    const empty = []
    expect(withoutLast(empty)).toEqual([])
    expect(withoutLast(empty)).not.toBe(empty)
  })
})

describe('the reducer never slices a frozen array on a press', () => {
  // Every call of `slice` on a FROZEN array while `press` runs, by the length of the array.
  const frozenSlices = (press) => {
    const original = Array.prototype.slice
    const seen = []
    Array.prototype.slice = function (...args) {
      if (Object.isFrozen(this)) seen.push(this.length)
      return original.apply(this, args)
    }
    try {
      press()
    } finally {
      Array.prototype.slice = original
    }
    return seen
  }
  const date = (i) => ({ y: 1900 + i, m: 1 + (i % 12), d: 1 + (i % 28) })
  const step = (state, action) => deepFreeze(gameReducer(state, action))
  const answer = (state, i, right) => {
    const correct = correctIndexOf(state.date, calendarOf(state.card, state.date, false))
    return step(state, {
      type: 'ANSWER',
      idx: right ? correct : (correct + 1) % 7,
      useJulian: false,
      elapsed: 1 + i / 10,
      tracking: true,
      saveStats: true,
      nextDate: date(i + 1),
    })
  }
  const next = (state, i) =>
    step(state, { type: 'NEW', nextDate: date(i + 1), useJulian: false, saveStats: true })
  // Six cards behind the one on screen: timed credits, and a miss among them.
  const played = () => {
    let state = deepFreeze(initEngine(date(0)))
    for (let i = 0; i < 6; i++) state = next(answer(state, i, i !== 3), i)
    expect(state.stack).toHaveLength(6)
    expect(state.stats.times.length).toBeGreaterThan(3)
    return state
  }
  const override = (i) => ({
    type: 'OVERRIDE',
    useJulian: false,
    tracking: true,
    nextDate: date(i),
  })

  it('the watch itself sees a slice of a frozen array, and no other', () => {
    expect(frozenSlices(() => Object.freeze([1, 2, 3]).slice(0, -1))).toEqual([3])
    expect(frozenSlices(() => [1, 2, 3].slice(0, -1))).toEqual([])
  })

  it('an answer, the next card, Back, Forward, and an Override on each card it can point at', () => {
    const state = played()
    const presses = {
      answer: (s) => answer(s, 7, true),
      'the next card': (s) => next(answer(s, 7, true), 7),
      Back: (s) => step(s, { type: 'BACK' }),
      Forward: (s) => step(step(s, { type: 'BACK' }), { type: 'FORWARD', useJulian: false }),
      'an Override on the newest card behind': (s) => step(s, override(8)),
      'that Override undone': (s) => step(step(s, override(8)), override(9)),
      'an Override on a browsed card': (s) =>
        step(step(step(s, { type: 'BACK' }), { type: 'BACK' }), override(8)),
      'an Override on the live card': (s) => step(answer(s, 7, false), override(8)),
    }
    for (const [what, press] of Object.entries(presses)) {
      let after
      expect(
        frozenSlices(() => (after = press(state))),
        what,
      ).toEqual([])
      // …and each of them did something: a press the reducer ignored would pass by doing nothing.
      expect(after, what).not.toBe(state)
    }
  })
})
