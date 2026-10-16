// @vitest-environment jsdom
//
// ONE CARD, ONE CALENDAR — on the screens (round 24).
//
// A date on or before October 4, 1582 has two weekdays, and the Julian Calendar setting can be
// switched while a date is on screen. The engine now stamps the calendar onto a card the first time
// anything judges it (tests/engine/cardCalendar holds the rule); this file drives the real <App/> in
// all five modes and asserts what the player sees: the highlighted answer and the calendar Show
// Codes works in are always the same one, whatever the setting says by then.
//
// The codes panel names its calendar ("Julian Calendar" / "Gregorian Calendar") under the codes, so
// that line is the observable for "which calendar did the codes use".
//
// The year range is pinned to 1000–1099: every date in it is before the reform, and the two calendars
// are six days apart there, so their weekdays ALWAYS differ — a case cannot pass by the two agreeing.
//
// ⚠ The setting is switched through the store, as the ⚙ menu's switch does. For Classic, Flash and
// Deduction that is the whole story (the screen keeps a date that has been answered). A MoX run or a
// Blitz round is RESET when the menu closes after such a switch, so in those two the switch could
// never land mid-round through the menu — the cases there pin that the screen reads the CARD and not
// the setting, which is the same wiring.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { wday, wdayJulian } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
// The one VISIBLE numeric-ymd date (the other mode screens stay mounted, display:none).
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
const visible = (els) => els.filter((el) => !isHidden(el))
const btn = (name) => {
  const hits = visible(screen.getAllByRole('button', { name }))
  if (hits.length !== 1) throw new Error(`expected one visible "${name}", found ${hits.length}`)
  return hits[0]
}
const press = (name) => act(() => fireEvent.click(btn(name)))
const key = (k) => act(() => fireEvent.keyDown(window, { key: k }))
const setJulian = (on) => act(() => useSettings.getState().setUseJulian(on))

const julianDay = ({ y, m, d }) => DAY[wdayJulian(y, m, d)]
const gregorianDay = ({ y, m, d }) => DAY[wday(y, m, d)]
// A day that is the answer in neither calendar.
const neitherDay = (date) => DAY.find((n) => n !== julianDay(date) && n !== gregorianDay(date))

// The weekday buttons wearing the answer's green, on the visible screen.
const greenDays = () =>
  DAY.filter((name) =>
    visible(screen.queryAllByRole('button', { name })).some((b) =>
      b.className.includes('btn-correct-persist'),
    ),
  )
// Which calendar the open codes panel says it worked in.
function codesCalendar() {
  const lines = visible(screen.queryAllByText(/^(Julian|Gregorian) Calendar$/))
  if (lines.length !== 1) throw new Error(`expected one open codes panel, found ${lines.length}`)
  return lines[0].textContent.split(' ')[0]
}
const score = () => {
  const label = visible(
    Array.from(document.querySelectorAll('span')).filter((s) => s.textContent.trim() === 'Score'),
  )[0]
  return label.parentElement.querySelector('[data-statval]').textContent.trim()
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
  const s = useSettings.getState()
  s.resetToFactory()
  s.setRandomFormat(false)
  s.setDateFormat('numeric-ymd')
  s.setMinY(1000)
  s.setMaxY(1099)
  useJulianRange.getState().applyJulianRange({ julianMinY: 1000, julianMaxY: 1099 })
  s.setUseJulian(true)
  useModePrefs.getState().resetToFactory?.()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  document.getElementById('root')?.remove()
})

describe('Classic — the reported defect', () => {
  it('drawn with Julian on, answered with it off, browsed back: the green and the codes agree', () => {
    mountApp()
    const date = readDate()
    expect(julianDay(date)).not.toBe(gregorianDay(date))
    setJulian(false) //                     the setting is switched with the date on screen…
    expect(readDate()).toEqual(date) //     …and Classic keeps the date
    press(gregorianDay(date)) //            answered: judged by the setting at the answer
    expect(score()).toBe('1/1')
    press('<') //                           browse back to it
    expect(readDate()).toEqual(date)
    expect(greenDays()).toEqual([gregorianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Gregorian')
    // Switching the setting again changes nothing about a date that has been answered.
    setJulian(true)
    expect(greenDays()).toEqual([gregorianDay(date)])
    expect(codesCalendar()).toBe('Gregorian')
  })

  it('the other way round — drawn with Julian off, answered with it on', () => {
    setJulian(false)
    mountApp()
    const date = readDate()
    setJulian(true)
    press(julianDay(date))
    expect(score()).toBe('1/1')
    setJulian(false)
    press('<')
    expect(greenDays()).toEqual([julianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Julian')
  })

  it('a date answered WRONG keeps the calendar it was judged in: Reveal and the codes after a switch', () => {
    mountApp()
    const date = readDate()
    press(neitherDay(date)) //   wrong, judged with Julian on
    setJulian(false)
    press('Reveal')
    expect(greenDays()).toEqual([julianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Julian')
  })

  it('…and the day that is right in the OTHER calendar is not accepted on it', () => {
    mountApp()
    const date = readDate()
    press(neitherDay(date))
    setJulian(false)
    press(gregorianDay(date)) //  right under the setting now, wrong for this card
    expect(readDate()).toEqual(date) // not advanced
    press(julianDay(date)) //     its own answer finishes it
    expect(readDate()).not.toEqual(date)
    expect(score()).toBe('0/1')
  })

  it('a date nobody has touched follows the setting as it stands', () => {
    mountApp()
    const date = readDate()
    setJulian(false)
    press('Show Codes') // the first judgement: Gregorian
    expect(greenDays()).toEqual([gregorianDay(date)])
    expect(codesCalendar()).toBe('Gregorian')
  })

  it('an Override after a switch marks the card’s own answer', () => {
    mountApp()
    const date = readDate()
    press(neitherDay(date)) //  wrong with Julian on
    press('New')
    setJulian(false)
    press('Override') //        credits the card behind the live one
    press('<')
    expect(readDate()).toEqual(date)
    expect(greenDays()).toEqual([julianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Julian')
  })
})

describe('Flash', () => {
  it('answered after a switch, then browsed back: the green and the codes agree', () => {
    mountApp()
    key('F')
    press('Begin')
    const date = readDate()
    setJulian(false)
    press(gregorianDay(date))
    expect(score()).toBe('1/1')
    setJulian(true)
    press('<')
    expect(greenDays()).toEqual([gregorianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Gregorian')
  })
})

describe('Blitz', () => {
  it('a round’s card reads in its own calendar when browsed to', () => {
    mountApp()
    key('B')
    press('Begin')
    const date = readDate()
    press(julianDay(date)) //   credited with Julian on
    expect(score()).toBe('1/1')
    setJulian(false)
    press('<')
    expect(readDate()).toEqual(date)
    expect(greenDays()).toEqual([julianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Julian')
  })
})

describe('MoX', () => {
  it('a run’s card reads in its own calendar when browsed to', () => {
    mountApp()
    key('A')
    press('Begin')
    const date = readDate()
    press(julianDay(date))
    expect(score()).toBe('1/1')
    setJulian(false)
    press('<')
    expect(readDate()).toEqual(date)
    expect(greenDays()).toEqual([julianDay(date)])
    press('Show Codes')
    expect(codesCalendar()).toBe('Julian')
  })
})

describe('Deduction', () => {
  it('a puzzle answered after a switch is still worked in the calendar it was built in', () => {
    mountApp()
    key('D')
    // The puzzle on screen was built with Julian on: the weekday it shows is a Julian one.
    setJulian(false)
    press('Show Codes') //  judged now — but a puzzle's calendar is the one it was built in
    expect(codesCalendar()).toBe('Julian')
    setJulian(true)
    expect(codesCalendar()).toBe('Julian')
  })
})
