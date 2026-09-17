// @vitest-environment jsdom
//
// Tests for the useGameEngine hook (Stage C, Step 6, 1c) — the React binding around the
// pure reducer. The reducer's transitions are exhaustively covered in gameReducer.test.js;
// these verify the wiring: mount generates a date, action callbacks dispatch with the right
// payloads, and the derived `correct` / `overrideAvail` reflect state.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGameEngine } from '../../src/engine/useGameEngine.js'
import { gameReducer, initEngine } from '../../src/engine/gameReducer.js'
import { wday } from '../../src/lib/calendar.js'

// A deterministic genDate (fixed Gregorian date — value doesn't matter for these checks).
const genDate = () => ({ y: 2024, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false })
const C = wday(2024, 1, 1)
const W = (C + 1) % 7
const opts = {
  genDate,
  minY: 1583,
  maxY: 10000,
  useJulian: false,
  saveStats: true,
  timingOff: true,
}

describe('useGameEngine', () => {
  it('mounts with a generated question and the derived correct weekday', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    expect(result.current.state.date.y).toBe(2024)
    expect(result.current.correct).toBe(C)
    expect(result.current.overrideAvail).toBe(false)
  })

  it('answer(correct) credits and advances; history grows', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(C))
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1, streak: 1 })
    expect(result.current.state.stack).toHaveLength(1)
  })

  it('answer(wrong) burns the question and arms Override', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(W))
    expect(result.current.state.countedWrong).toBe(true)
    expect(result.current.overrideAvail).toBe(true)
    act(() => result.current.override())
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 }) // Path 3 credit
  })

  it('reset clears stats and history', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(C))
    act(() => result.current.resetStats())
    expect(result.current.state.stats).toMatchObject({ played: 0, good: 0 })
    expect(result.current.state.stack).toEqual([])
  })
})

// ── Override ⇄ Undo — the hook's half (round 23 Q6) ─────────────────────────────────────────────
describe('useGameEngine — Override ⇄ Undo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('undoAvail is the capsule: Override → Undo available, Override locked; Undo → the reverse', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(W))
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.undoAvail).toBe(false)
    act(() => result.current.override())
    expect(result.current.overrideAvail).toBe(false)
    expect(result.current.undoAvail).toBe(true)
    act(() => result.current.undo())
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.undoAvail).toBe(false)
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 0 })
  })

  // An advancing Override restarted the solve clock for the question it moved to. Its Undo returns
  // to a question the player has been looking at all along — a restarted clock there would record
  // only the seconds since the Undo (think → Override → Undo → answer = a free fast time).
  it('an Undo across an ADVANCING Override hands the question back its own solve clock', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { result } = renderHook(() => useGameEngine({ ...opts, timingOff: false }))
    now = 1000
    act(() => result.current.answer(W)) // burn the first question
    now = 2000
    act(() => result.current.answer(C)) // late correct → advance (clock starts at 2 s), Path 4 armed
    now = 22000 // twenty seconds on the fresh question
    act(() => result.current.override()) // Path 4 credits the previous wrong and ADVANCES
    const advancedId = result.current.state.questionId
    now = 23000
    act(() => result.current.undo()) // back onto the fresh question
    expect(result.current.state.questionId).toBe(advancedId - 1)
    now = 24000
    act(() => result.current.answer(C))
    // The recorded time is the full 22 s since that question appeared — not the 1 s since the Undo.
    expect(result.current.state.stats.times.at(-1)).toBe(22)
  })

  it('a parked state never mounts with an Undo pending (nor a legacy blob without the field)', () => {
    let s = gameReducer(initEngine(genDate()), {
      type: 'ANSWER',
      idx: W,
      useJulian: false,
      elapsed: 1,
      tracking: true,
      saveStats: true,
      nextDate: genDate(),
    })
    s = gameReducer(s, {
      type: 'OVERRIDE',
      useJulian: false,
      tracking: true,
      timingOff: false,
      nextDate: genDate(),
    })
    expect(s.undoCapsule).not.toBe(null)
    const parked = renderHook(() => useGameEngine({ ...opts, getInitialState: () => s }))
    expect(parked.result.current.state.undoCapsule).toBe(null)
    expect(parked.result.current.undoAvail).toBe(false)
    expect(parked.result.current.state.stats).toEqual(s.stats) // …and the rest of the round is intact
    const { undoCapsule, ...legacy } = s
    const old = renderHook(() => useGameEngine({ ...opts, getInitialState: () => legacy }))
    expect(old.result.current.state.undoCapsule).toBe(null)
  })
})
