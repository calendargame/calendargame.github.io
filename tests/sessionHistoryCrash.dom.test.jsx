// @vitest-environment jsdom
//
// A SCREEN THAT CRASHES FORGETS WHAT IT PARKED.
//
// A parked history (store/sessionHistory) is restored at the screen's next mount and outlives a
// reload — so a history that somehow broke its screen would come back after the error card's Reload
// and break it again, for the rest of the browsing session. The mode's error boundary therefore drops
// that mode's parks the moment it catches (src/main.tsx's forgetCrashedHistory, through
// ModeErrorBoundary's onCrash). The saved stats are untouched: the screen comes back with them and a
// fresh question.
// The same goes for everything else a screen restores at mount: an ended Blitz round / MoX run
// (store/sessionRound) and How to Play's place (store/sessionGuide). Those three are the sharper
// case — a screen that crashes on its FIRST render never mounted, so none of its own effects (the
// ones that would have retired the park) ever runs.
//
// The crash is manufactured in a component every mode screen renders (the Q# badge), switched on by a
// flag, so the screen that re-renders next is the one that crashes — and, for the guide, in the
// panel every guide section renders.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { ModeErrorBoundary } from '../src/ErrorBoundary.tsx'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'
import { readSessionHistory } from '../src/store/sessionHistory.js'
import { readSessionRound } from '../src/store/sessionRound.js'
import { readGuidePlace, writeGuidePlace } from '../src/store/sessionGuide.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'

const crash = vi.hoisted(() => ({ on: false, guide: false }))
vi.mock('../src/components/CardNumber.jsx', () => ({
  default: () => {
    if (crash.on) throw new Error('the Q# badge crashed (test)')
    return null
  },
}))
vi.mock('../src/components/Expander.jsx', async (original) => {
  const { default: Expander } = await original()
  return {
    default: (props) => {
      if (crash.guide) throw new Error('a guide panel crashed (test)')
      return Expander(props)
    },
  }
})

const hide = () =>
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
const ctrl = (name) => screen.getByRole('button', { name })
const answerRight = () => tap(ctrl(correctDayName(readDate())))

beforeEach(() => {
  crash.on = false
  crash.guide = false
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

// A RELOAD: the page goes away and comes back with sessionStorage exactly as it stood.
const reloadPage = (app) => {
  const session = Array.from({ length: sessionStorage.length }, (_, i) => {
    const k = sessionStorage.key(i)
    return [k, sessionStorage.getItem(k)]
  })
  app.unmount()
  cleanup()
  document.getElementById('root')?.remove()
  sessionStorage.clear()
  for (const [k, v] of session) sessionStorage.setItem(k, v)
  return mountApp()
}
const pressKey = (key) => act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })))
const errorCard = () => screen.queryByText('This mode hit an unexpected error.')

describe('a timed screen that crashes while restoring its parked round', () => {
  const pin = () =>
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setMinY(1583)
      s.setMaxY(10000)
    })
  // The date on the screen that is SHOWING: Classic's own question is still in the page, hidden.
  const shown = (el) => !el.closest('[style*="display: none"]')
  const answerShownRight = () => {
    const [date] = [...document.querySelectorAll('div')].filter(
      (el) => el.children.length === 0 && /^\d+-\d+-\d+$/.test(el.textContent.trim()) && shown(el),
    )
    const [y, m, d] = date.textContent.trim().split('-').map(Number)
    tap(ctrl(correctDayName({ y, m, d })))
  }

  it('Blitz: the round is dropped as the crash is caught, so the next Reload comes back idle', () => {
    resetAppState()
    let app = mountApp()
    pin()
    pressKey('B')
    tap(ctrl('Begin'))
    answerShownRight()
    tap(ctrl('Reveal')) // the round ends, and is parked for the session
    expect(readSessionRound('1:saved', 'blitz')).not.toBe(null)

    crash.on = true
    app = reloadPage(app) // the restored round's screen crashes on its FIRST render
    expect(errorCard()).toBeInTheDocument()
    expect(readSessionRound('1:saved', 'blitz')).toBe(null)

    crash.on = false
    reloadPage(app) // the error card's Reload
    expect(errorCard()).toBe(null)
    expect(ctrl('Begin')).toBeInTheDocument() // idle: nothing came back to crash again
  })

  it('MoX: the run is dropped as the crash is caught, so the next Reload comes back idle', () => {
    resetAppState()
    act(() => useModePrefs.getState().setAoxN('2'))
    let app = mountApp()
    pin()
    pressKey('A')
    tap(ctrl('Begin'))
    answerShownRight()
    answerShownRight() // the run completes, and is parked for the session
    expect(readSessionRound('1:saved', 'aox')).not.toBe(null)

    crash.on = true
    app = reloadPage(app)
    expect(errorCard()).toBeInTheDocument()
    expect(readSessionRound('1:saved', 'aox')).toBe(null)

    crash.on = false
    reloadPage(app)
    expect(errorCard()).toBe(null)
    expect(ctrl('Begin')).toBeInTheDocument()
  })
})

describe('How to Play crashing on its first render', () => {
  it('drops the place it was restoring, which it never mounted to retire itself', () => {
    resetAppState()
    writeGuidePlace({ open: 'overview', y: 320 })
    crash.guide = true
    const app = mountApp() // the guide is always mounted, so it crashes here, behind Classic
    expect(readGuidePlace()).toBe(null)

    crash.guide = false
    reloadPage(app)
    pressKey('H')
    expect(errorCard()).toBe(null)
    // …and it opens as it does with no place: every section closed.
    const headers = [...document.querySelectorAll('[aria-controls^="guide-panel-"]')]
    expect(headers.length).toBeGreaterThan(1)
    expect(headers.every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true)
  })
})
