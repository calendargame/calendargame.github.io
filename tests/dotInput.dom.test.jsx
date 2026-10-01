// @vitest-environment jsdom
//
// 7-dot day-of-week input (Settings → Input → Dots) — DOM tests. The dot LAYOUT/positions and the
// drag-to-select gesture are layout/pointer behaviour jsdom can't verify (no layout engine) — those
// are proven on-device. What jsdom CAN lock, and does here: with inputStyle='dots' the weekday answer
// grid renders seven UNLABELLED circle buttons that (a) carry the day name as an aria-label, (b) stay
// in DOM order Sun..Sat as direct children of [data-answer-grid] — which the keyboard 0–9 path
// (children[idx]) and number-answering depend on — and (c) submit to the engine exactly like the
// labelled buttons. Plus: the Settings → Input toggle flips the setting in weekday modes and is
// locked (value preserved) in Deduction.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'
import { mountApp, openSettings, pickerLockState, resetAppState } from './helpers/settingsPanel.jsx'
// The live Classic date is the only leaf <div> whose text is a numeric-ymd date (the always-mounted
// hidden modes show "—"). Pinned numeric-ymd + Gregorian range make it trivially parseable.
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()),
  )
  if (els.length !== 1) throw new Error(`expected exactly one ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const wrongName = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
// A dot's accessible name is its aria-label (= the day name), so the same getByRole query works for
// both layouts; getByRole excludes the display:none mode panels, so only the visible mode is matched.
const dayBtn = (name) => screen.getByRole('button', { name })
const ctrl = (name) => screen.getByRole('button', { name })
function dayState(name) {
  const c = dayBtn(name).className
  if (c.includes('btn-correct-persist')) return 'correct'
  if (c.includes('btn-wrong-persist')) return 'wrong-latest'
  if (c.includes('btn-wrong-dim')) return 'wrong-prev'
  if (c.includes('btn-override-wrong')) return 'override-wrong'
  return 'idle'
}
// ⚠ Reads the value through its OWN marker, [data-statval] — the auto-fit target StatPanel puts on
// the value span — and NOT "the cell's last span". A cell can carry a trailing screen-reader-only
// span (the "Off" that names a blanked group, round 16), and last-span would read that instead of
// the value. The marker names the one element that IS the readout, so it cannot drift again.
function statValue(label) {
  const btn = screen
    .getAllByRole('button')
    .find((b) => Array.from(b.querySelectorAll('span')).some((s) => s.textContent.trim() === label))
  if (!btn) throw new Error(`stat cell "${label}" not found`)
  return btn.querySelector('[data-statval]').textContent.trim()
}
function pressNewAndRead() {
  fireEvent.click(ctrl('New'))
  return readDate()
}

describe('7-dot input (Dots layout)', () => {
  beforeEach(() => {
    resetAppState()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useSettings.getState().setInputStyle('dots')
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('renders 7 unlabelled circle buttons in DOM order Sun..Sat as direct children of the answer grid', () => {
    mountApp()
    pressNewAndRead()
    const grid = dayBtn('Sunday').parentElement
    expect(grid.getAttribute('data-answer-grid')).toBe('true')
    expect(grid.className).toContain('dot-cluster')
    const kids = Array.from(grid.children)
    expect(kids).toHaveLength(7)
    kids.forEach((b, i) => {
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('aria-label')).toBe(DAY[i]) // DOM order Sun..Sat (keyboard children[idx])
      expect(b.className).toContain('dot-btn')
      expect(b.textContent).toBe('') // no text / numbers inside the dots
    })
  })

  it('clicking the correct dot credits the engine (Score + Streak 1/1), same as the buttons layout', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(correctName(date)))
    // A correct answer advances to a fresh date (grid clears), so the credit is the proof, not a
    // lingering green dot; the wrong-answer test below covers the dot's persist colouring.
    expect(statValue('Score')).toBe('1/1')
    expect(statValue('Streak')).toBe('1/1')
  })

  it('clicking a wrong dot marks it wrong and does not advance', () => {
    mountApp()
    const date = pressNewAndRead()
    fireEvent.click(dayBtn(wrongName(date)))
    expect(statValue('Score')).toBe('0/1')
    expect(dayState(wrongName(date))).toBe('wrong-latest')
    expect(readDate()).toEqual(date) // wrong answer stays on the same question
  })
})

describe('Settings → Input toggle', () => {
  beforeEach(() => {
    resetAppState()
  })
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The picker is a radiogroup of two radios (round-8 a11y pass), and the LOCK lives on that
  // GROUP element — not on the pills. Round-9 moved the pills into a PillTray housing (⚙ pickers
  // are all trays now), so a pill's parentElement is the tray, and reading the dim off it would
  // silently stop testing anything. Ask the panel helper for the lock instead — it answers the
  // group's question, in the terms the user meets it in.

  it('flips inputStyle between Buttons and Dots in a weekday mode, and is not locked', () => {
    mountApp() // opens in Classic (a weekday mode)
    openSettings('key') // open the ⚙ popover
    expect(useSettings.getState().inputStyle).toBe('buttons')
    fireEvent.click(screen.getByRole('radio', { name: 'Dots' }))
    expect(useSettings.getState().inputStyle).toBe('dots')
    fireEvent.click(screen.getByRole('radio', { name: 'Buttons' }))
    expect(useSettings.getState().inputStyle).toBe('buttons')
    expect(pickerLockState('Input').offered).toBe(true)
    expect(screen.getByRole('radio', { name: 'Buttons' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Dots' }).getAttribute('aria-checked')).toBe('false')
  })

  it('is locked (dimmed, value preserved) in Deduction', () => {
    useSettings.getState().setInputStyle('buttons')
    mountApp()
    act(() => {
      fireEvent.keyDown(window, { key: 'D' }) // switch to Deduction
    })
    openSettings('key') // open the ⚙ popover
    expect(pickerLockState('Input').offered).toBe(false)
    // The PillTray onChange guard keeps the value even if a click is dispatched at a segment.
    fireEvent.click(screen.getByRole('radio', { name: 'Dots' }))
    expect(useSettings.getState().inputStyle).toBe('buttons')
  })
})
