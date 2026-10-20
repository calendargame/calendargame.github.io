// @vitest-environment jsdom
// focusedBoxRemote — A BOX THAT ONLY HAS THE KEYBOARD HOLDS NOTHING OF THE PLAYER'S (Round 26, windows in
// sync; the review lane's finding). Another window can change a value while this window's box for it is
// focused - the player tapped it and went to the other window. Nothing typed here: the box follows the
// change, and leaving it (a tap away, Enter, or Escape) writes nothing back. What was typed stays the
// player's, as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, screen, fireEvent, cleanup } from '@testing-library/react'
import { useYearRangeMirrors } from '../src/components/useYearRangeMirrors.js'
import { resetAppState, mountApp } from './helpers/settingsPanel.jsx'
import { useModePrefs } from '../src/store/modePrefs.js'

describe('a ⚙ Year Range box', () => {
  const mount = () => {
    const minInput = document.createElement('input')
    const maxInput = document.createElement('input')
    document.body.append(minInput, maxInput)
    const calls = []
    const hook = renderHook(
      ({ minY }) =>
        useYearRangeMirrors(
          minY,
          10000,
          (v) => calls.push(v),
          () => {},
          { current: minInput },
          { current: maxInput },
          10000,
        ),
      { initialProps: { minY: 1 } },
    )
    return { ...hook, minInput, calls }
  }
  afterEach(() => document.body.replaceChildren())

  it('focused with nothing typed: another window’s change shows, and leaving it writes nothing', () => {
    const { result, rerender, minInput, calls } = mount()
    minInput.focus()
    rerender({ minY: 1500 }) // the other window's change arrives
    expect(result.current.min.value).toBe('1500')
    act(() => result.current.min.commit()) // a tap away
    expect(calls).toEqual([])
  })

  it('a year being typed is kept through another window’s change, and committed', () => {
    const { result, rerender, minInput, calls } = mount()
    minInput.focus()
    act(() => result.current.min.setValue('19'))
    rerender({ minY: 1500 })
    expect(result.current.min.value).toBe('19')
    act(() => result.current.min.commit())
    expect(calls).toEqual([19])
  })
})

describe('the MoX run-length box', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAppState()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })
  const field = () => screen.getByRole('textbox', { name: 'MoX run length' })

  it('focused with nothing typed, another window’s change stands through Escape', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'A' }))
    act(() => field().focus())
    act(() => useModePrefs.getState().setAoxN('12')) // the other window's change arrives
    expect(field().value).toBe('12')
    act(() => fireEvent.keyDown(field(), { key: 'Escape' }))
    expect(useModePrefs.getState().aoxN).toBe('12')
  })

  it('a length typed and then thrown away with Escape goes back to the other window’s', () => {
    mountApp()
    act(() => fireEvent.keyDown(window, { key: 'A' }))
    act(() => field().focus())
    act(() => useModePrefs.getState().setAoxN('12'))
    act(() => fireEvent.change(field(), { target: { value: '30' } }))
    act(() => fireEvent.keyDown(field(), { key: 'Escape' }))
    expect(useModePrefs.getState().aoxN).toBe('12')
  })
})
