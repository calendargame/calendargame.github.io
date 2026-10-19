// @vitest-environment jsdom
// dedTypeWindow — THE DEDUCTION SUB-TYPE IN FORCE IS THIS WINDOW'S (store/sessionDedType; design-q1-q2.md
// v4, 6.7). A choice made here writes this window's sub-type and the shared one (store/modePrefs'
// `dedType`); another window's choice changes the shared one only - nothing moves on screen here; a
// reload keeps this window's; a fresh open starts from the shared one, the last chosen anywhere.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { otherWindow } from './helpers/otherWindow.js'
import { loadPage, closeApp } from './helpers/pageLoad.js'
import { useModePrefs, MODE_PREFS_DOC } from '../src/store/modePrefs.js'
import { readSessionDedType } from '../src/store/sessionDedType.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'

const unmount = () => {
  cleanup()
  document.getElementById('root')?.remove()
}
const toDeduction = () => act(() => fireEvent.keyDown(window, { key: 'D' }))
// The sub-type button that reads as chosen.
const chosen = () =>
  ['Day', 'Month', 'Year'].find((name) =>
    screen
      .getAllByRole('button', { name, exact: true })
      .some((b) => b.className.includes('btn-solid')),
  )
const pick = (name) =>
  act(() =>
    fireEvent.click(
      screen.getAllByRole('button', { name, exact: true }).find((b) => !b.closest('[hidden]')),
    ),
  )

beforeEach(() => {
  vi.useFakeTimers()
  resetAppState()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  unmount()
})

describe('the Deduction sub-type in force is this window’s', () => {
  it('a choice here writes this window’s sub-type and the shared one', () => {
    mountApp()
    toDeduction()
    expect(chosen()).toBe('Day')
    pick('Month')
    expect(chosen()).toBe('Month')
    expect(readSessionDedType(1)).toBe('month')
    expect(useModePrefs.getState().dedType).toBe('month')
  })

  it('another window’s choice changes the shared one only — nothing moves on screen here', () => {
    mountApp()
    toDeduction()
    pick('Month')
    const W = otherWindow()
    W.save(MODE_PREFS_DOC, { dedType: 'day' })
    W.deliver()
    expect(useModePrefs.getState().dedType).toBe('day') // the shared choice moved…
    expect(chosen()).toBe('Month') // …and this window stays where the player is
  })

  it('a reload keeps this window’s; a fresh open starts from the last one chosen anywhere', () => {
    mountApp()
    toDeduction()
    pick('Month')
    const W = otherWindow()
    W.save(MODE_PREFS_DOC, { dedType: 'day' })
    W.deliver()
    unmount()
    act(() => {
      loadPage()
      openBrowsingSession()
    })
    mountApp()
    toDeduction()
    expect(chosen()).toBe('Month')
    unmount()
    act(() => {
      closeApp()
      loadPage()
      openBrowsingSession()
    })
    mountApp()
    toDeduction()
    expect(chosen()).toBe('Day')
  })
})
