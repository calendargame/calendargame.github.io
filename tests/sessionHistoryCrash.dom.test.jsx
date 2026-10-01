// @vitest-environment jsdom
//
// A CASUAL MODE SCREEN THAT CRASHES FORGETS WHAT IT PARKED.
//
// A parked history (store/sessionHistory) is restored at the screen's next mount and outlives a
// reload — so a history that somehow broke its screen would come back after the error card's Reload
// and break it again, for the rest of the browsing session. The mode's error boundary therefore drops
// that mode's parks the moment it catches (src/main.tsx's forgetCrashedHistory, through
// ModeErrorBoundary's onCrash). The saved stats are untouched: the screen comes back with them and a
// fresh question.
//
// The crash is manufactured in a component every mode screen renders (the Q# badge), switched on by a
// flag, so the screen that re-renders next is the one that crashes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { ModeErrorBoundary } from '../src/ErrorBoundary.tsx'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'
import { readSessionHistory } from '../src/store/sessionHistory.js'
import { useSettings } from '../src/store/settings.js'

const crash = vi.hoisted(() => ({ on: false }))
vi.mock('../src/components/CardNumber.jsx', () => ({
  default: () => {
    if (crash.on) throw new Error('the Q# badge crashed (test)')
    return null
  },
}))

const hide = () =>
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
const ctrl = (name) => screen.getByRole('button', { name })
const answerRight = () => tap(ctrl(correctDayName(readDate())))

beforeEach(() => {
  crash.on = false
  vi.spyOn(console, 'error').mockImplementation(() => {}) // React and the boundary both log the crash
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

describe('ModeErrorBoundary', () => {
  it('calls onCrash once when its screen crashes, and shows the error card', () => {
    const onCrash = vi.fn()
    const Boom = () => {
      throw new Error('boom')
    }
    render(
      <ModeErrorBoundary mode="Classic" active onCrash={onCrash}>
        <Boom />
      </ModeErrorBoundary>,
    )
    expect(onCrash).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This mode hit an unexpected error.')).toBeInTheDocument()
  })
})

describe('a crashed casual screen', () => {
  it('drops its own parked history — and only its own — so the Reload comes back clean', () => {
    resetAppState()
    const app = mountApp()
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
      s.setMaxY(10000)
    })
    tap(ctrl('New'))
    answerRight()
    answerRight()
    hide() // every casual screen has parked
    expect(readSessionHistory('1:saved', 'classic')).not.toBe(null)
    expect(readSessionHistory('1:saved', 'flash')).not.toBe(null)

    crash.on = true
    tap(ctrl('New')) // Classic re-renders — and crashes
    expect(screen.getByText('This mode hit an unexpected error.')).toBeInTheDocument()
    expect(readSessionHistory('1:saved', 'classic')).toBe(null)
    expect(readSessionHistory('1:saved', 'flash')).not.toBe(null) // Flash did not crash

    // The error card's Reload: the page goes away (the crashed screen is gone, so it parks nothing)
    // and comes back.
    crash.on = false
    hide()
    const session = Array.from({ length: sessionStorage.length }, (_, i) => {
      const k = sessionStorage.key(i)
      return [k, sessionStorage.getItem(k)]
    })
    app.unmount()
    cleanup()
    document.getElementById('root')?.remove()
    sessionStorage.clear()
    for (const [k, v] of session) sessionStorage.setItem(k, v)
    mountApp()
    expect(statValue('Score')).toBe('2/2') // the saved stats were never at risk
    // …and the history that crashed did not come back: Back, on the screen that is showing, is dimmed.
    const shown = (el) => {
      for (let n = el; n; n = n.parentElement) if (n.style?.display === 'none') return false
      return true
    }
    const [backButton] = [...document.querySelectorAll('button[data-key="ArrowLeft"]')].filter(
      shown,
    )
    expect(backButton.className).toContain('pointer-events-none')
  })
})
