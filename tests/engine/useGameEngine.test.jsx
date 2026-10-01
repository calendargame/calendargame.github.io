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
import { restoreParkedEngine } from '../../src/engine/parkedEngine.js'
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
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 }) // the live wrong, credited
  })

  it('reset clears stats and history', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(C))
    act(() => result.current.resetStats())
    expect(result.current.state.stats).toMatchObject({ played: 0, good: 0 })
    expect(result.current.state.stack).toEqual([])
  })
})

// ── Override ⇄ Undo — the hook's half (round 23: one permanent per-card toggle) ───────────────
describe('useGameEngine — Override ⇄ Undo', () => {
  afterEach(() => vi.restoreAllMocks())

  // The gate and the label, from the one selector: `overrideAvail` = there is a card to point at and
  // Save Stats was on for the card on screen; `overridden` = that card is overridden RIGHT NOW (the
  // word the button reads). There is no "used it once" state left, so the two alternate forever and
  // the button is never locked.
  it('the label follows the card it points at, and the toggle never runs out', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(W))
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.overridden).toBe(false)
    expect(result.current.overridePlan).toMatchObject({
      target: 'live',
      overridden: false,
      credits: true,
    })
    // Crediting the live wrong advances, so the card it flipped is now the history tail — and the
    // button points at it (target 'retro') and reads Undo, on a question the player has not touched.
    act(() => result.current.override())
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.overridden).toBe(true)
    expect(result.current.overridePlan).toMatchObject({ target: 'retro', overridden: true })
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 })
    for (let i = 0; i < 3; i++) {
      act(() => result.current.override()) // Undo
      expect(result.current.overridden).toBe(false)
      expect(result.current.state.stats).toMatchObject({ played: 1, good: 0 })
      act(() => result.current.override()) // Override again
      expect(result.current.overridden).toBe(true)
      expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 })
    }
  })

  // The word tells the truth about the card whether or not the press is on offer (second review
  // round, F9): it used to be ANDed with the gate, so with Save Stats off an overridden card's dimmed
  // button read "Override" — and "Undo" again the moment Save Stats came back, though nothing changed.
  it('a dimmed button still reads Undo for an overridden card', () => {
    const { result, rerender } = renderHook((p) => useGameEngine(p), { initialProps: opts })
    act(() => result.current.answer(C))
    act(() => result.current.override()) // retro: card 1 overridden away
    expect(result.current.overridden).toBe(true)
    rerender({ ...opts, saveStats: false }) // the fresh live card falls back to the live setting
    expect(result.current.overrideAvail).toBe(false) // dimmed…
    expect(result.current.overridden).toBe(true) // …and still saying Undo, because the card is
    rerender(opts)
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.overridden).toBe(true)
  })

  // Spec test 8 — the dim rule, at the gate: dimmed ONLY when there is genuinely no card to point at.
  it('dimmed only with no card to point at: fresh mode yes, ever after no', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    expect(result.current.overrideAvail).toBe(false) // a fresh question, nothing behind it
    expect(result.current.overridePlan).toBe(null)
    act(() => result.current.answer(C)) // one scored card → the fresh next question has a target
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.overridePlan).toMatchObject({ target: 'retro' })
    act(() => result.current.doNew()) // …and it stays offered through anything short of a Reset
    expect(result.current.overrideAvail).toBe(true)
    act(() => result.current.back())
    expect(result.current.overrideAvail).toBe(true)
    act(() => result.current.resetStats())
    expect(result.current.overrideAvail).toBe(false) // history gone ⇒ nothing to point at
  })

  // Save Stats OFF for the card on screen dims the button even with history behind it — a question
  // that was never scored must not be creditable (good > played). The gate reads the FROZEN value.
  it('Save Stats off for the card on screen dims it', () => {
    const { result, rerender } = renderHook((p) => useGameEngine(p), { initialProps: opts })
    act(() => result.current.answer(C))
    expect(result.current.overrideAvail).toBe(true)
    rerender({ ...opts, saveStats: false })
    expect(result.current.overrideAvail).toBe(false) // nothing frozen yet ⇒ the live setting decides
    act(() => result.current.answer(W)) // burned with Save Stats off: never scored, never creditable
    rerender({ ...opts, saveStats: true })
    expect(result.current.overrideAvail).toBe(false)
  })

  // ★ questionId only ever moves FORWARD, which is why the hook's timer effect has no exceptions in
  // it. A toggle on a past card leaves the live question — and its clock — exactly where they were:
  // think for 20 s, toggle a past card, then answer, and the recorded time is the full 20 s. (Round
  // 23's first cut rewound an advancing Override and needed a clock hand-back ref here to stop
  // think → Override → Undo → answer recording only the seconds since the Undo.)
  it('a toggle on a past card leaves the live question its own solve clock', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { result } = renderHook(() => useGameEngine({ ...opts, timingOff: false }))
    now = 1000
    act(() => result.current.answer(W)) // burn the first question
    now = 2000
    act(() => result.current.answer(C)) // late correct → advance; the fresh question's clock starts
    const freshId = result.current.state.questionId
    now = 22000 // twenty seconds of thinking on the fresh question
    act(() => result.current.override()) // credits the card BEHIND it — no advance, no new clock
    expect(result.current.state.questionId).toBe(freshId)
    act(() => result.current.override()) // …and back again
    expect(result.current.state.questionId).toBe(freshId)
    now = 24000
    act(() => result.current.answer(C))
    expect(result.current.state.stats.times.at(-1)).toBe(22)
  })

  // ★ A SOLVE TIME IS RECORDED ON THE 0.1 ms GRID (round 23). performance.now() is already
  // clamped to 0.1 ms in Chrome (1 ms in Safari), but the SUBTRACTION of two such readings is not:
  // 126913.4 − 123456.7 is 3456.699999999997 in floating point, which printed into the save as
  // 3.456699999999997 — 17 characters of float noise per time. Every solve time is kept now, so the
  // hook snaps the difference back onto the grid the browser measured on: the value, the save and a
  // reload all hold the same short number (3.4567), and nothing the browser actually measured is lost.
  it('records the solve time on the 0.1 ms grid, free of subtraction noise', () => {
    let now = 123456.7
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { result } = renderHook(() => useGameEngine({ ...opts, timingOff: false }))
    now = 126913.4
    expect((126913.4 - 123456.7) / 1000).not.toBe(3.4567) // the noise this test exists for
    act(() => result.current.answer(C))
    expect(result.current.state.stats.times).toEqual([3.4567])
    expect(JSON.stringify(result.current.state.stats.times)).toBe('[3.4567]')
  })

  // THE ONE RESTORE DOOR: every parked blob comes through engine/parkedEngine's restoreParkedEngine,
  // which the timed modes call at their parked read (and engine/parkedHistory for the casual ones);
  // the hook seeds from whatever it returns. The door's own rules live in engine/parkedEngine.test.js;
  // this asserts the hook is wired to it: a parked state mounts as the engine's first state, scored
  // and toggleable, and a blob the door refuses mounts a fresh question instead.
  it('a parked state comes through the restore door and is the first state — still toggleable', () => {
    let scored = gameReducer(initEngine(genDate()), {
      type: 'ANSWER',
      idx: W,
      useJulian: false,
      elapsed: 1,
      tracking: true,
      saveStats: true,
      nextDate: genDate(),
    })
    scored = gameReducer(scored, {
      type: 'OVERRIDE',
      useJulian: false,
      tracking: true,
      nextDate: genDate(),
    }) // the wrong card credited: play moved on, and the card behind it reads Undo
    const blob = JSON.parse(JSON.stringify(scored))
    const { result } = renderHook(() =>
      useGameEngine({ ...opts, getInitialState: () => restoreParkedEngine(blob, false, 'test') }),
    )
    expect(result.current.state).toEqual(blob)
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 })
    expect(result.current.overridden).toBe(true)
    act(() => result.current.override())
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 0 })
    expect(result.current.overridden).toBe(false)
  })

  it('a blob the door refuses mounts a fresh question', () => {
    const { result } = renderHook(() =>
      useGameEngine({
        ...opts,
        getInitialState: () => restoreParkedEngine({ stack: 'nope' }, false, 'test'),
      }),
    )
    expect(result.current.state.stats).toMatchObject({ played: 0, good: 0 })
    expect(result.current.state.stack).toEqual([])
  })
})
