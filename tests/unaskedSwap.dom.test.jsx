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
// Deduction's other two sub-types keep their puzzles, and a hidden screen's rebuild guards nothing on
// the screen on display.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
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
  // ★ …AND ITS GUARD IS THAT SCREEN'S: every mode screen stays mounted, and a hidden one rebuilt (its
  // stats came in from another window) must not void a press on the one on display.
  it('a hidden screen rebuilt: the screen on display takes its answers at once, with no cue', () => {
    mountApp() // on Classic
    act(() => rebaseEngine(activeDataId(), 'flash'))
    tap(day('Tuesday'))
    expect(statValue('Score')).not.toBe('0/0')
    expect(day('Tuesday').classList.contains('press-void')).toBe(false)
  })

  // ★ THE REBUILD IS THE ENGINE'S, NOT THE SCREEN'S (store/screenPool): the screen is not remounted,
  // so what it holds that is not the engine stays — here a "Reset Stats?" question the player has
  // open, which then resets the stats as they now are, the other window's answer with them.
  it('a "Reset Stats?" question open over the screen stays open through the rebuild, and resets what is there now', () => {
    mountApp()
    tap(day('Tuesday'))
    act(() => vi.advanceTimersByTime(1000))
    expect(statValue('Score')).toMatch(/\/1$/)
    tap(screen.getByRole('button', { name: 'Reset Stats' }))
    const question = () => screen.queryByRole('dialog', { name: 'Reset Stats?' })
    expect(question()).not.toBeNull()
    const W = otherWindow()
    W.progress().answer('classic', true, 2)
    W.deliver()
    expect(statValue('Score')).toMatch(/\/2$/) // rebuilt on both windows' answers…
    expect(question()).not.toBeNull() // …with the question still open
    tap(within(question()).getByRole('button', { name: 'Reset Stats' }))
    expect(statValue('Score')).toBe('0/0')
  })

  it('the screen on display rebuilt: its answers are guarded for a moment, with the cue', () => {
    mountApp()
    act(() => rebaseEngine(activeDataId(), 'classic'))
    tap(day('Tuesday'))
    expect(statValue('Score')).toBe('0/0')
    expect(day('Tuesday').classList.contains('press-void')).toBe(true)
  })

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
