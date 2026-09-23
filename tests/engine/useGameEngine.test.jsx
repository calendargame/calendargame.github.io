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

// ── Override ⇄ Undo — the hook's half (round 23 Q6: one permanent per-card toggle) ───────────────
describe('useGameEngine — Override ⇄ Undo', () => {
  afterEach(() => vi.restoreAllMocks())

  // The gate and the label, from the one selector: `overrideAvail` = there is a card to point at and
  // Save Stats was on for the card on screen; `undoAvail` = that card is overridden RIGHT NOW. There
  // is no "used it once" state left, so the two alternate forever and the button is never locked.
  it('the label follows the card it points at, and the toggle never runs out', () => {
    const { result } = renderHook(() => useGameEngine(opts))
    act(() => result.current.answer(W))
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.undoAvail).toBe(false)
    expect(result.current.overridePlan).toMatchObject({
      target: 'live',
      overridden: false,
      credits: true,
    })
    // Crediting the live wrong advances, so the card it flipped is now the history tail — and the
    // button points at it (target 'retro') and reads Undo, on a question the player has not touched.
    act(() => result.current.override())
    expect(result.current.overrideAvail).toBe(true)
    expect(result.current.undoAvail).toBe(true)
    expect(result.current.overridePlan).toMatchObject({ target: 'retro', overridden: true })
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 })
    for (let i = 0; i < 3; i++) {
      act(() => result.current.override()) // Undo
      expect(result.current.undoAvail).toBe(false)
      expect(result.current.state.stats).toMatchObject({ played: 1, good: 0 })
      act(() => result.current.override()) // Override again
      expect(result.current.undoAvail).toBe(true)
      expect(result.current.state.stats).toMatchObject({ played: 1, good: 1 })
    }
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

  // THE ONE RESTORE DOOR: every parked blob comes through engine/engineMigration, so a round parked
  // by an older build (here v2.25.0's shape: a history entry locked by `overrideUsed` + its capsule,
  // and the dead top-level flags) mounts healthy, scored and TOGGLEABLE. The migration's own exact
  // per-shape expectations live in engine/engineMigration.test.js; this asserts the door is wired.
  it('a legacy parked blob comes through the migration door and is toggleable', () => {
    const scored = gameReducer(initEngine(genDate()), {
      type: 'ANSWER',
      idx: W,
      useJulian: false,
      elapsed: 1,
      tracking: true,
      saveStats: true,
      nextDate: genDate(),
    })
    // Hand-built v2.25.0: the wrong card was overridden to a credit and play moved on, so the entry
    // carries hasCredit + overrideUsed + a capsule, and the fresh live card carries the dead flags.
    // ⚠ `card` is dropped deliberately — the old shape has no such key, and its presence is exactly
    // what tells the migration a blob is already current (so leaving it in would test nothing).
    const { card: _drop, ...base } = scored
    const legacy = {
      ...base,
      stats: { played: 1, good: 1, streak: 1, best: 1, times: [1] },
      stack: [
        {
          ...genDate(),
          btns: { [C]: 'correct' },
          hasCredit: true,
          solveTime: 1,
          overrideUsed: true,
          capsule: { snapshot: { contributedTime: null }, wrongTime: 1 },
        },
      ],
      persistBtns: {},
      locked: false,
      revealed: false,
      countedWrong: false,
      saveStatsThisQ: null,
      liveSolveTime: null,
      wrongTime: null,
      overrideUsedThisQ: false,
      prevStatsSnapshot: null,
      canOverrideCorrect: false,
      pendingWrongOverride: null,
      undoCapsule: null,
    }
    const { result } = renderHook(() => useGameEngine({ ...opts, getInitialState: () => legacy }))
    const s = result.current.state
    expect(s.card).toEqual({ wrongTime: null, answered: null }) // today's shape, not the old flags
    expect(s.stack[0].meta.answered).not.toBe(null) // …and the card comes back OVERRIDDEN
    expect(s.stats).toMatchObject({ played: 1, good: 1 })
    expect(result.current.undoAvail).toBe(true) // the button reads Undo on it, years later
    act(() => result.current.override())
    expect(result.current.state.stats).toMatchObject({ played: 1, good: 0 })
    expect(result.current.undoAvail).toBe(false)
  })
})
