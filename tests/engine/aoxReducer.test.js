// Unit tests for the pure AoX reducer (Stage C, Step 6, Step 5).
// Deterministic: fixed Gregorian dates (so activeWday === wday) + explicit payloads. These
// mirror the AoX characterization (tests/aox.dom) at the reducer level — the two must agree,
// which is what makes wiring the reducer into AoxMode safe.
import { describe, it, expect } from 'vitest'
import { aoxReducer, initAox } from '../../src/engine/aoxReducer.js'
import { activeWday } from '../../src/engine/gameReducer.js'

// A pinned Gregorian date + its correct weekday index.
const D1 = { y: 2001, m: 1, d: 1, _fmt: 'numeric-ymd', _jul: false }
const D2 = { y: 2002, m: 2, d: 2, _fmt: 'numeric-ymd', _jul: false }
const D3 = { y: 2003, m: 3, d: 3, _fmt: 'numeric-ymd', _jul: false }
const cw = (d) => activeWday(d.y, d.m, d.d, false)

// Default run config for an answer/override (Ao2, no mistakes, not one-by-one).
const cfg = (over = {}) => ({ allowMistakes: false, oneByOne: false, bestKey: 'k', saveStats: true, ...over })

const begin = (s, n = 2) => aoxReducer(s, { type: 'BEGIN', n })
const answer = (s, idx, correct, nextDate, over = {}) =>
  aoxReducer(s, { type: 'ANSWER', idx, correct, elapsed: 1, nextDate, ...cfg(over) })

describe('aoxReducer — run lifecycle', () => {
  it('initAox is idle with empty stats', () => {
    const s = initAox(D1)
    expect(s.runPhase).toBe('idle')
    expect(s.times).toEqual([])
    expect(s.attempts).toBe(0)
    expect(s.bests).toEqual({})
  })

  it('BEGIN starts a running Ao2 on the idle date', () => {
    const s = begin(initAox(D1), 2)
    expect(s.runPhase).toBe('running')
    expect(s.displayN).toBe(2)
    expect(s.shown).toBe(true)
    expect(s.date).toEqual(D1)
  })

  it('a first-try correct records a solve, advances, and pushes a credited entry', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // correct on D1 → advance to D2
    expect(s.times.length).toBe(1)
    expect(s.attempts).toBe(1)
    expect(s.streak).toBe(1)
    expect(s.bestStreak).toBe(1)
    expect(s.runPhase).toBe('running')
    expect(s.date).toEqual(D2)
    expect(s.stack.length).toBe(1)
    expect(s.stack[0].hasCredit).toBe(true)
  })

  it('the Nth correct completes the run (done) and records a Best Average', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1
    s = answer(s, cw(D2), cw(D2), D3) // 2/2 → completes
    expect(s.runPhase).toBe('done')
    expect(s.times.length).toBe(2)
    expect(s.attempts).toBe(2)
    expect(s.date).toEqual(D2) // stays on the completing question (no advance)
    expect(s.bests.k.avg).not.toBeNull()
    expect(s.stack.length).toBe(1) // only the non-completing Q1 was pushed
  })

  it('RESET returns to idle but keeps the recorded bests (clears the stars)', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2)
    s = answer(s, cw(D2), cw(D2), D3) // done, best recorded
    const savedBest = s.bests.k.avg
    const r = aoxReducer(s, { type: 'RESET', n: 2, nextDate: D3 })
    expect(r.runPhase).toBe('idle')
    expect(r.times).toEqual([])
    expect(r.bests.k.avg).toBe(savedBest) // best value persists
    expect(r.bestNew).toEqual({}) // stars cleared
  })
})

describe('aoxReducer — mistakes', () => {
  it('Allow Mistakes OFF: a wrong fails the run and reveals the correct day', () => {
    let s = begin(initAox(D1), 3)
    const wrong = (cw(D1) + 1) % 7
    s = answer(s, wrong, cw(D1), D2) // wrong → fail
    expect(s.runPhase).toBe('failed')
    expect(s.attempts).toBe(1)
    expect(s.streak).toBe(0)
    expect(s.times.length).toBe(0)
    expect(s.persistBtns[cw(D1)]).toBe('correct') // correct revealed
    expect(s.persistBtns[wrong]).toBe('wrong-prev') // demoted (dim) once the green correct is marked
  })

  it('Allow Mistakes ON: a wrong keeps the run going; the late-correct earns no credit but advances', () => {
    let s = begin(initAox(D1), 3)
    const wrong = (cw(D1) + 1) % 7
    s = answer(s, wrong, cw(D1), D2, { allowMistakes: true }) // wrong, still running, same date
    expect(s.runPhase).toBe('running')
    expect(s.attempts).toBe(1)
    expect(s.date).toEqual(D1)
    s = answer(s, cw(D1), cw(D1), D2, { allowMistakes: true }) // late-correct: no credit, advance
    expect(s.times.length).toBe(0)
    expect(s.attempts).toBe(1)
    expect(s.date).toEqual(D2)
    expect(s.pendingWrongCredit).not.toBeNull() // armed for Override
  })
})

describe('aoxReducer — Override', () => {
  const override = (s, correct, over = {}) =>
    aoxReducer(s, { type: 'OVERRIDE', correct, elapsed: 1, nextDate: D3, ...cfg(over) })

  it('undoes a just-credited first-try solve (Path 3: canOverrideCorrect still set after advance)', () => {
    let s = begin(initAox(D1), 3)
    s = answer(s, cw(D1), cw(D1), D2, { allowMistakes: true }) // 1/1, advance to D2 (fresh live Q)
    expect(s.times.length).toBe(1)
    expect(s.canOverrideCorrect).toBe(true) // first-try-correct stays override-eligible across advance
    s = override(s, cw(D2), { allowMistakes: true }) // undo the credit; remove its entry; keep running
    expect(s.times.length).toBe(0) // credit undone
    expect(s.streak).toBe(0)
    expect(s.stack.length).toBe(0) // the credited entry was removed
    expect(s.runPhase).toBe('running')
    expect(s.date.y).toBe(D2.y) // live Q unchanged
  })

  it('credits a wrong on the current question and advances (Path 5)', () => {
    let s = begin(initAox(D1), 3)
    const wrong = (cw(D1) + 1) % 7
    s = answer(s, wrong, cw(D1), D2, { allowMistakes: true }) // 0/1, still running
    s = override(s, cw(D1), { allowMistakes: true }) // credit → advance
    expect(s.times.length).toBe(1)
    expect(s.streak).toBe(1)
    expect(s.date).toEqual(D3) // advanced (nextDate)
  })

  it('on a completed run, Override undoes the last solve and rolls back the Best (Path 3)', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1
    s = answer(s, cw(D2), cw(D2), D3) // 2/2 → done, best set
    expect(s.bests.k.avg).not.toBeNull()
    s = override(s, cw(D2)) // undo the completing solve (Allow Mistakes off → fail)
    expect(s.times.length).toBe(1)
    expect(s.runPhase).toBe('failed')
    expect(s.bests.k.avg).toBeNull() // best rolled back (this run had set it)
  })
})

describe('aoxReducer — Override sub-paths (gap coverage)', () => {
  const override = (s, correct, nextDate, over = {}) =>
    aoxReducer(s, { type: 'OVERRIDE', correct, elapsed: 1, nextDate, ...cfg(over) })
  const cont = (s, nextDate, over = {}) =>
    aoxReducer(s, { type: 'CONTINUE', nextDate, oneByOne: over.oneByOne ?? false, useJulian: false })

  it('Path 1 — back-browse override undoes a reviewed credited solve (times roll back, streak recalcs)', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1
    s = answer(s, cw(D2), cw(D2), D3) // 2/2 → done
    s = aoxReducer(s, { type: 'BACK', useJulian: false }) // review Q1 (credited)
    expect(s.inBackMode).toBe(true)
    expect(s.canOverrideCorrect).toBe(true)
    s = override(s, cw(D1), D3) // back-browse undo → roll times back to pre-Q1
    expect(s.times.length).toBe(0)
    expect(s.browseHasCredit).toBe(false)
    expect(s.overrideUsed).toBe(true)
  })

  it('Path 2 — One-By-One retro-flip of the most recent entry (right→wrong)', () => {
    let s = begin(initAox(D1), 3)
    s = answer(s, cw(D1), cw(D1), D2, { oneByOne: true }) // 1/1, advance; date hidden (One-By-One)
    expect(s.shown).toBe(false)
    s = cont(s, D2, { oneByOne: true }) // reveal D2 → clears canOverrideCorrect (now retro-eligible)
    expect(s.canOverrideCorrect).toBe(false)
    s = override(s, cw(D2), D3, { oneByOne: true }) // retro-flip the credited D1 entry
    expect(s.times.length).toBe(0) // credit rolled back
    const last = s.stack[s.stack.length - 1]
    expect(last.hasCredit).toBe(false)
    expect(Object.values(last.btns)).toContain('override-wrong')
  })

  it('Path 4 — pendingWrongCredit that COMPLETES the run finishes it (done + best)', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1 (need only one more)
    const wrong = (cw(D2) + 1) % 7
    s = answer(s, wrong, cw(D2), D3, { allowMistakes: true }) // wrong on D2, still running
    s = answer(s, cw(D2), cw(D2), D3, { allowMistakes: true }) // right → pendingWrongCredit, advance to D3
    expect(s.pendingWrongCredit).not.toBeNull()
    expect(s.times.length).toBe(1)
    s = override(s, cw(D3), D3, { allowMistakes: true }) // credit the previous → reaches N=2 → completes
    expect(s.runPhase).toBe('done')
    expect(s.times.length).toBe(2)
    expect(s.bests.k.avg).not.toBeNull()
  })

  it('Path 5 — override-after-wrong that COMPLETES the run finishes it (done + best)', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1 (one more completes)
    const wrong = (cw(D2) + 1) % 7
    s = answer(s, wrong, cw(D2), D3, { allowMistakes: true }) // wrong on D2, still running
    s = override(s, cw(D2), D3, { allowMistakes: true }) // credit it → reaches N=2 → completes
    expect(s.runPhase).toBe('done')
    expect(s.times.length).toBe(2)
    expect(s.bests.k.avg).not.toBeNull()
  })
})

describe('aoxReducer — Back/Forward', () => {
  it('Back is a no-op while running, works after the run ends, and Forward round-trips', () => {
    let s = begin(initAox(D1), 2)
    s = answer(s, cw(D1), cw(D1), D2) // 1/1, advance
    const stillRunning = aoxReducer(s, { type: 'BACK', useJulian: false })
    expect(stillRunning).toBe(s) // running → BACK no-ops
    s = answer(s, cw(D2), cw(D2), D3) // 2/2 → done
    const back = aoxReducer(s, { type: 'BACK', useJulian: false })
    expect(back.inBackMode).toBe(true)
    expect(back.date.y).toBe(D1.y) // back to the first question
    expect(back.forwardStack.length).toBe(1)
    const fwd = aoxReducer(back, { type: 'FORWARD', useJulian: false })
    expect(fwd.inBackMode).toBe(false)
    expect(fwd.date.y).toBe(D2.y) // forward to the completed last question
  })
})
