// @vitest-environment jsdom
// unaskedSwap — A QUESTION REPLACED WITHOUT THIS WINDOW'S INPUT (design-q1-q2.md v4, 6.4; lib/
// unaskedSwap). Another window's change replaces the question on screen — here a date format changed
// there, which draws the waiting question again here, as a ⚙ close would. A press made for the
// question that went is never credited to the one that came, and never vanishes without a word:
//   • a press latched before the swap meets a grid that is gone — nothing is answered — and the
//     button under the finger in the new grid wears the cue (.press-void) for 350 ms, then fades;
//   • for 300 ms after the swap a tap or a key 0-9 answers nothing, and wears the cue the same way;
//   • after that, answers are taken as ever.
// And the rebuild on another window's stats (store/screenPool's rebaseEngine) is one engine's only:
// Deduction's other two sub-types keep their puzzles.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'
import { questionShape, statValue } from './helpers/modeScreen.jsx'
import { otherWindow } from './helpers/otherWindow.js'
import { useSettings, SETTINGS_DOC } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { SWAP_GUARD_MS, VOID_MS } from '../src/lib/unaskedSwap.js'
import { rebaseEngine } from '../src/store/screenPool.js'
import { activeDataId } from '../src/store/amnesic.js'

const touch = (type) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperty(e, 'pointerId', { value: 3 })
  Object.defineProperty(e, 'isPrimary', { value: true })
  Object.defineProperty(e, 'pointerType', { value: 'touch' })
  return e
}
const day = (name) => screen.getByRole('button', { name })
const changeFormatElsewhere = (W) => {
  W.save(SETTINGS_DOC, { dateFormat: 'numeric-dmy' })
  W.deliver()
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAppState()
  useSettings.getState().setRandomFormat(false)
  useSettings.getState().setDateFormat('numeric-ymd')
  useSettings.getState().setMinY(1583)
  useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  document.getElementById('root')?.remove()
  delete document.elementFromPoint
})

describe('a question replaced by another window’s change, under a press', () => {
  it('a press latched before the swap answers nothing, and the button under the finger wears the cue', () => {
    mountApp()
    const W = otherWindow()
    const before = day('Monday')
    act(() => before.dispatchEvent(touch('pointerdown')))
    changeFormatElsewhere(W)
    expect(questionShape()).toBe('numeric DMY') // the question went
    const now = day('Monday')
    expect(now).not.toBe(before) // …and the grid with it
    document.elementFromPoint = () => now
    act(() => document.dispatchEvent(touch('pointerup')))
    act(() => fireEvent.click(before)) // (whatever click a browser still sends for it)
    expect(statValue('Score')).toBe('0/0') // nothing answered
    expect(now.classList.contains('press-void')).toBe(true)
    act(() => vi.advanceTimersByTime(VOID_MS))
    expect(now.classList.contains('press-void')).toBe(false)
    act(() => vi.advanceTimersByTime(200))
    expect(now.classList.contains('press-void-fade')).toBe(false)
  })

  it('for a moment after the swap, a tap and a key 0-9 answer nothing and wear the cue; then answers count', () => {
    mountApp()
    const W = otherWindow()
    changeFormatElsewhere(W)
    tap(day('Tuesday'))
    expect(statValue('Score')).toBe('0/0')
    expect(day('Tuesday').classList.contains('press-void')).toBe(true)
    act(() => fireEvent.keyDown(window, { key: '3' }))
    expect(statValue('Score')).toBe('0/0')
    expect(day('Wednesday').classList.contains('press-void')).toBe(true)
    act(() => vi.advanceTimersByTime(SWAP_GUARD_MS))
    tap(day('Tuesday'))
    expect(statValue('Score')).not.toBe('0/0') // answered (right or wrong) — the guard is down
  })

  it('a change made HERE (a ⚙ close) is the player’s own: no guard, no cue', () => {
    mountApp()
    act(() => useSettings.getState().setDateFormat('numeric-dmy'))
    tap(day('Tuesday'))
    expect(statValue('Score')).not.toBe('0/0')
    expect(day('Tuesday').classList.contains('press-void')).toBe(false)
  })
})

describe('a rebuild on another window’s stats is one engine’s', () => {
  it('Deduction: the sub-type whose stats came in is rebuilt; the other two keep their puzzles', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'D' }))
    const puzzle = () =>
      [...document.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && el.textContent.includes('__'),
      ).textContent
    const dayPuzzle = puzzle()
    act(() => rebaseEngine(activeDataId(), 'dedMonth'))
    expect(puzzle()).toBe(dayPuzzle) // Day (on screen) untouched
    act(() => rebaseEngine(activeDataId(), 'dedDay'))
    expect(puzzle()).not.toBe(dayPuzzle)
  })
})
