// @vitest-environment jsdom
//
// Flash mode — characterization tests (Stage C, Step 6, Step 2). Locks TODAY's Flash
// behavior so migrating it onto the shared engine (like Classic) is provably identical.
//
// Flash = the engine + a brief-reveal TIMER: Begin flashes the date for ~flashMs, then
// hides it ("…") and you answer from memory; answering ends the flash and advances. The
// timer is driven by setTimeout + requestAnimationFrame, so these tests use fake timers.
//
// Flash is still rendered inline by App (not yet migrated), so we drive the real <App/>,
// switch to Flash via the keyboard shortcut, and assert on what shows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}

// Switch to Flash via the global keyboard shortcut ('F' → flash).
function switchToFlash() {
  act(() => {
    fireEvent.keyDown(window, { key: 'F' })
  })
}

// True if `el` is inside a display:none subtree (AoX + the always-mounted ClassicMode are
// display:none in Flash mode, but their dates are still in the DOM).
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) {
    if (n.style && n.style.display === 'none') return true
  }
  return false
}

// The visible Flash date (numeric-ymd, pinned). Excludes the hidden AoX/Classic dates.
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1)
    throw new Error(`expected one visible ymd date, found ${els.length}: ${els.map((e) => e.textContent)}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}

// The big date display's current text (date or "—" or "…"), visible copy only.
function dateDisplayText() {
  const el = Array.from(document.querySelectorAll('div.text-3xl')).find((e) => !isHidden(e))
  return el ? el.textContent.trim() : null
}

const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
const dayBtn = (name) => screen.getByRole('button', { name })
const ctrl = (name) => screen.getByRole('button', { name })
const isDisabled = (btn) => btn.className.includes('pointer-events-none')

function statCell(label) {
  const btn = screen
    .getAllByRole('button')
    .find((b) => Array.from(b.querySelectorAll('span')).some((s) => s.textContent.trim() === label))
  if (!btn) throw new Error(`stat cell "${label}" not found`)
  return btn
}
const statValue = (label) => {
  const spans = statCell(label).querySelectorAll('span')
  return spans[spans.length - 1].textContent.trim()
}

describe('Flash — characterization (batch 1: the brief-reveal flow)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('idle: shows Begin, the date is hidden ("—"), Score 0/0', () => {
    mountApp()
    switchToFlash()
    expect(ctrl('Begin')).toBeInTheDocument()
    expect(dateDisplayText()).toBe('—')
    expect(statValue('Score')).toBe('0/0')
  })

  it('Begin reveals the date and swaps the primary button to Reset', () => {
    mountApp()
    switchToFlash()
    act(() => {
      fireEvent.click(ctrl('Begin'))
    })
    // During the reveal window the date is visible (a numeric-ymd date, not — or …).
    expect(dateDisplayText()).toMatch(/^\d+-\d+-\d+$/)
    expect(ctrl('Reset')).toBeInTheDocument()
  })

  it('after the reveal window elapses, the date hides to "…"', () => {
    mountApp()
    switchToFlash()
    act(() => {
      fireEvent.click(ctrl('Begin'))
    })
    act(() => {
      vi.advanceTimersByTime(600) // past the default 500ms reveal
    })
    expect(dateDisplayText()).toBe('…')
  })

  it('answering correctly during the reveal scores 1/1 and returns to idle (Begin, hidden date)', () => {
    mountApp()
    switchToFlash()
    act(() => {
      fireEvent.click(ctrl('Begin'))
    })
    const date = readDate()
    act(() => {
      fireEvent.click(dayBtn(correctName(date)))
    })
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Accuracy')).toBe('100.0%')
    expect(ctrl('Begin')).toBeInTheDocument() // back to idle
    expect(dateDisplayText()).toBe('—')
  })

  it('answering wrong scores 0/1 and arms Override', () => {
    mountApp()
    switchToFlash()
    act(() => {
      fireEvent.click(ctrl('Begin'))
    })
    const date = readDate()
    act(() => {
      fireEvent.click(dayBtn(wrongName(date)))
    })
    expect(statValue('Score')).toBe('0/1')
    expect(isDisabled(ctrl('Override'))).toBe(false)
  })
})

describe('Flash — characterization (batch 2: Reveal, Override, consecutive rounds)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useSettings.getState().resetSettings()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    document.getElementById('root')?.remove()
  })

  function begin() {
    act(() => {
      fireEvent.click(ctrl('Begin'))
    })
  }
  function click(name) {
    act(() => {
      fireEvent.click(dayBtn(name))
    })
  }

  it('Reveal during a flash shows the answer, counts as a miss (0/1), and reveals the date', () => {
    mountApp()
    switchToFlash()
    begin()
    const date = readDate()
    act(() => {
      fireEvent.click(ctrl('Reveal'))
    })
    expect(statValue('Score')).toBe('0/1')
    expect(statValue('Streak')).toBe('0/0')
    // The correct day is shown and the date becomes visible again (no longer "…").
    expect(dayBtn(correctName(date)).className).toContain('btn-correct-persist')
    expect(dateDisplayText()).toMatch(/^\d+-\d+-\d+$/)
  })

  it('Override after a wrong answer credits it and returns to idle (0/1 → 1/1)', () => {
    mountApp()
    switchToFlash()
    begin()
    const date = readDate()
    click(wrongName(date))
    expect(statValue('Score')).toBe('0/1')
    act(() => {
      fireEvent.click(ctrl('Override'))
    })
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
    expect(ctrl('Begin')).toBeInTheDocument() // advanced back to idle
  })

  it('consecutive flashes accumulate score and streak', () => {
    mountApp()
    switchToFlash()
    begin()
    click(correctName(readDate())) // 1/1
    begin()
    click(correctName(readDate())) // 2/2
    expect(statValue('Score')).toBe('2/2')
    expect(statValue('Streak')).toBe('2/2')
  })
})
