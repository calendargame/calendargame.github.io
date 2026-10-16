// @vitest-environment jsdom
//
// julianOnlyDate.dom — A DATE ONLY THE JULIAN CALENDAR HAS IS NEVER ASKED, OR JUDGED, WITH THE JULIAN
// CALENDAR SETTING OFF.
//
// February 29, 1500 is a real day in the Julian calendar and no day at all in the Gregorian one. With
// the Julian Calendar setting on it can be drawn; Classic and Flash keep an untouched date when the
// setting is switched (its answer simply follows the setting); so the date used to stay on screen
// with the setting off and be judged as a Gregorian date that never existed — the weekday of March 1
// came out as "correct". The same date could come back after a reload, when the setting had been
// switched off while the page was away.
//
// The rule, on the mounted app (the engine's half is tests/engine/cardCalendar; the calendar's is
// tests/calendar):
//   • the ⚙ panel closing on a setting switched OFF replaces a waiting date the Gregorian calendar
//     does not have — and only that one: an ordinary date is kept, as before, either way round;
//   • a date that has been USED is a Julian card for good and stays, with its Julian answer;
//   • a parked question comes back the same way: replaced if the setting is now off, kept otherwise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  pressKey,
  openSettings,
  closeSettings,
} from './helpers/settingsPanel.jsx'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { dim, wday, wdayJulian } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

// ── The visible screen (every mode is mounted; one is shown) ─────────────────────────────────────
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const shownDate = () =>
  [...document.querySelectorAll('div.text-3xl')].find((e) => !isHidden(e)).textContent.trim()
const ctrl = (name) => screen.getByRole('button', { name })
const dayState = (name) => {
  const c = ctrl(name).className
  return c.includes('btn-correct-persist') ? 'correct' : c.includes('btn-wrong') ? 'wrong' : 'idle'
}

// ── Drawing the date ─────────────────────────────────────────────────────────────────────────────
// The year range is 1496-1500 and every draw in a leap year falls in January or February (Jan/Feb
// Chance 100%), so with the generator's dice pinned high the next date is February 29, 1500 — which
// only exists while the Julian Calendar setting is on — and with them pinned low it is an ordinary
// April day of 1497. The dice are real again as soon as the date is drawn.
// ⚠ THE RANGE HOLDS A LEAP YEAR IN BOTH CALENDARS (1496) ON PURPOSE: Jan/Feb Chance then applies with
// the setting on and off alike (lib/dateConfig's janFebChanceApplies), so switching the setting alone
// changes no date setting IN EFFECT, which is the case this file is about. (On the single year 1500,
// switching the setting off also takes Jan/Feb Chance out of effect — 1500 is no leap year in the
// Gregorian calendar — and that, like any change to a setting in effect, regenerates a waiting date.)
const LEAP_DAY = '1500-2-29'
const JL = DAY[wdayJulian(1500, 2, 29)] // its weekday, in the one calendar that has it
const NEVER = DAY[wday(1500, 2, 29)] //    what the old reading called right: the weekday of March 1
const setting = (fn) => act(() => fn(useSettings.getState()))
function pin1500() {
  setting((s) => {
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1496)
    s.setMaxY(1500)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1496, julianMaxY: 1500 })
    s.setLeapChance('random')
    s.setJanFebChance('100')
    s.setUseJulian(true)
  })
}
function drawWith(dice, press) {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(dice)
  try {
    press()
  } finally {
    spy.mockRestore()
  }
}
const newLeapDay = () => drawWith(0.9999, () => tap(ctrl('New')))
const newOrdinaryDay = () => drawWith(0.25, () => tap(ctrl('New')))
// The Julian Calendar setting, switched inside one visit to the ⚙ panel — the way a player does it.
function switchJulian(on) {
  openSettings()
  setting((s) => s.setUseJulian(on))
  const whileOpen = shownDate()
  closeSettings()
  return whileOpen
}

// ── A reload: pagehide, then the page simply stops (tests/sessionHistory.dom argues the model) ───
function reloadApp(app, whileAway) {
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
  const atPagehide = Array.from({ length: sessionStorage.length }, (_, i) => {
    const k = sessionStorage.key(i)
    return [k, sessionStorage.getItem(k)]
  })
  app.unmount()
  cleanup()
  document.getElementById('root')?.remove()
  sessionStorage.clear()
  for (const [k, v] of atPagehide) sessionStorage.setItem(k, v)
  if (whileAway) act(whileAway)
  return mountApp()
}

let app
beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
  app = mountApp()
  pin1500()
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

it('the fixture: the dice draw February 29, 1500, and the old "correct" day is not its weekday', () => {
  newLeapDay()
  expect(shownDate()).toBe(LEAP_DAY)
  expect(NEVER).toBe(DAY[wday(1500, 3, 1)])
  expect(NEVER).not.toBe(JL)
})

describe('Classic — the Julian Calendar setting switched in the ⚙ panel', () => {
  it('OFF over February 29, 1500: the date is replaced as the panel closes, by one the calendar has', () => {
    newLeapDay()
    expect(switchJulian(false)).toBe(LEAP_DAY) // deferred to the close, like every date setting
    const [y, m, d] = shownDate().split('-').map(Number)
    expect(shownDate()).not.toBe(LEAP_DAY)
    expect(y).toBeGreaterThanOrEqual(1496)
    expect(y).toBeLessThanOrEqual(1500)
    expect(d).toBeLessThanOrEqual(dim(y, m))
    // …and nothing was scored or pushed into history by the swap.
    expect(ctrl('Reveal').className).not.toContain('pointer-events-none')
  })

  it('OFF over an ordinary date keeps it — an untouched date just follows the setting', () => {
    newOrdinaryDay()
    const waiting = shownDate()
    expect(waiting).toMatch(/^1497-4-\d+$/)
    switchJulian(false)
    expect(shownDate()).toBe(waiting)
    // …and its answer is now the Gregorian one.
    const [y, m, d] = waiting.split('-').map(Number)
    tap(ctrl('Reveal'))
    expect(dayState(DAY[wday(y, m, d)])).toBe('correct')
  })

  it('ON keeps whatever is waiting (no date the Gregorian calendar has is missing from the Julian one)', () => {
    setting((s) => s.setUseJulian(false))
    newOrdinaryDay()
    const waiting = shownDate()
    switchJulian(true)
    expect(shownDate()).toBe(waiting)
  })

  it('off and back on inside one visit to the panel is no change at all: the leap day stays', () => {
    newLeapDay()
    openSettings()
    setting((s) => s.setUseJulian(false))
    setting((s) => s.setUseJulian(true))
    closeSettings()
    expect(shownDate()).toBe(LEAP_DAY)
  })

  it.each([
    ['answered wrong', () => tap(ctrl(NEVER))],
    ['revealed', () => tap(ctrl('Reveal'))],
    ['shown its codes', () => tap(ctrl('Show Codes'))],
  ])('a leap day already %s stays, and stays the Julian day it was judged as', (_n, use) => {
    newLeapDay()
    use()
    switchJulian(false)
    expect(shownDate()).toBe(LEAP_DAY)
    if (dayState(JL) !== 'correct') tap(ctrl('Reveal'))
    expect(dayState(JL)).toBe('correct')
    expect(dayState(NEVER)).not.toBe('correct')
  })

  it('a date setting changed in the same visit regenerates once, into the new settings', () => {
    newLeapDay()
    openSettings()
    setting((s) => {
      s.setUseJulian(false)
      s.setMinY(1600)
      s.setMaxY(1600)
      useJulianRange.getState().applyJulianRange({ julianMinY: 1600, julianMaxY: 1600 })
    })
    closeSettings()
    expect(shownDate()).toMatch(/^1600-/)
  })
})

describe('Classic — a waiting question that comes back after a reload', () => {
  // Classic's timing is hidden by default, so the waiting question comes back as it was.
  it('the setting switched OFF while the page was away: February 29, 1500 is replaced', () => {
    newLeapDay()
    app = reloadApp(app, () => useSettings.getState().setUseJulian(false))
    const [y, m, d] = shownDate().split('-').map(Number)
    expect(shownDate()).not.toBe(LEAP_DAY)
    expect(y).toBeGreaterThanOrEqual(1496)
    expect(d).toBeLessThanOrEqual(dim(y, m))
  })
  it('the setting untouched: the same leap day returns', () => {
    newLeapDay()
    app = reloadApp(app)
    expect(shownDate()).toBe(LEAP_DAY)
  })
  it('the setting switched OFF over an ordinary date: the same date returns', () => {
    newOrdinaryDay()
    const waiting = shownDate()
    app = reloadApp(app, () => useSettings.getState().setUseJulian(false))
    expect(shownDate()).toBe(waiting)
  })
  it('a leap day answered wrong before the reload returns, still a Julian card', () => {
    newLeapDay()
    tap(ctrl(NEVER))
    app = reloadApp(app, () => useSettings.getState().setUseJulian(false))
    expect(shownDate()).toBe(LEAP_DAY)
    tap(ctrl('Reveal'))
    expect(dayState(JL)).toBe('correct')
  })
})

describe('Flash — the date being flashed', () => {
  beforeEach(() => pressKey('F'))
  const begin = (dice) => drawWith(dice, () => tap(ctrl('Begin')))

  it('OFF over February 29, 1500: the flash ends with the question it belonged to', () => {
    begin(0.9999)
    expect(shownDate()).toBe(LEAP_DAY)
    switchJulian(false)
    // The question went, so everything that belonged to it went: the screen is idle again, and the
    // next Begin flashes a date the calendar has.
    expect(shownDate()).toBe('—')
    tap(ctrl('Begin'))
    expect(shownDate()).toMatch(/^1(49[6-9]|500)-\d+-\d+$/)
    expect(shownDate()).not.toBe(LEAP_DAY)
  })
  it('OFF over an ordinary date: the flash carries on with the same question', () => {
    begin(0.25)
    const flashed = shownDate()
    expect(flashed).toMatch(/^1497-4-\d+$/)
    switchJulian(false)
    expect(shownDate()).toBe(flashed)
  })
})
