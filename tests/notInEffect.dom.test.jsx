// @vitest-environment jsdom
//
// notInEffect.dom — A SETTING THAT IS NOT IN EFFECT IS STILL A SETTING, AND CHANGING IT DOES NOTHING
// ELSE (Round 26, the sweep: "dimmed means not in effect right now, not locked").
//
// For every control drawn not in effect — outlined, kept, still changeable — the owner's rule, held on
// the mounted app: a tap, an arrow key, and a press-drag release each change the stored value; the
// change lights the ⚙ button's bar like any other; and it restarts nothing: the waiting question is
// the same one, a MoX run and a Blitz round under way survive the menu closing, and the Best key does
// not move. The faded lock (Amnesic while Save Stats is off) is the other state, held separately.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  closeSettings,
  picker,
  pickPill,
  pickerChosen,
  otherPillName,
  arrowPicker,
  expectNotInEffect,
  expectLock,
  pressDragFromGear,
  offers,
  typeYear,
  commitYear,
  toggleSwitch,
} from './helpers/settingsPanel.jsx'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { correctDayName } from './helpers/modeScreen.jsx'

function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const shownDate = () =>
  [...document.querySelectorAll('div.date-line')].find((e) => !isHidden(e)).textContent.trim()
const setting = (fn) => act(() => fn(useSettings.getState()))
const mode = (key) => act(() => void fireEvent.keyDown(window, { key }))
const roundGoing = () => screen.queryByRole('button', { name: 'Begin' }) === null
const answerRight = () => {
  const [y, m, d] = shownDate().split('-').map(Number)
  tap(screen.getByRole('button', { name: correctDayName({ y, m, d }) }))
}

// Save the settings as they stand as this preset's defaults (the 16, the Julian-on Year Range, and
// the factory mode prefs) — what Save Defaults would capture.
function saveDefaultsAsTheyAre() {
  const s = useSettings.getState()
  const j = useJulianRange.getState()
  const p = useModePrefs.getState()
  useUserDefaults.getState().saveDefaults({
    settings: {
      ...Object.fromEntries(Object.keys(SETTINGS_DEFAULTS).map((k) => [k, s[k]])),
      julianMinY: j.julianMinY,
      julianMaxY: j.julianMaxY,
    },
    prefs: { flashMs: p.flashMs, blitzSec: p.blitzSec, blitzQSec: p.blitzQSec, aoxN: p.aoxN },
    amnesic: 'off',
  })
}

beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
  setting((s) => {
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
  })
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

// Each picker not in effect, the state that takes it out of effect (set before the app mounts, so
// the screen opens on it), and its reason. Date Format is out of effect on the weekday pages only;
// the date shown is then in a random format, so it is read by shape rather than parsed.
const PICKERS = [
  {
    name: 'Leap Year Chance',
    reason: 'Not in use: your year range has no leap year.',
    arrange: () =>
      useJulianRange.getState().applyJulianRange({ julianMinY: 1700, julianMaxY: 1703 }),
    stored: () => useSettings.getState().leapChance,
  },
  {
    name: 'Jan/Feb Chance on Leap Years',
    reason: 'Not in use: your year range has no leap year.',
    arrange: () =>
      useJulianRange.getState().applyJulianRange({ julianMinY: 1700, julianMaxY: 1703 }),
    stored: () => useSettings.getState().janFebChance,
  },
  {
    name: 'Julian Chance',
    reason: 'Not in use: your year range does not include 1582.',
    arrange: () =>
      useJulianRange.getState().applyJulianRange({ julianMinY: 1900, julianMaxY: 2100 }),
    stored: () => useSettings.getState().julianChance,
  },
  {
    name: 'Julian Chance',
    reason: 'Not in use while Julian Calendar is off.',
    arrange: () => {
      setting((s) => {
        s.setUseJulian(false)
        s.setMinY(1583)
      })
    },
    stored: () => useSettings.getState().julianChance,
  },
  {
    name: 'Rotate Dots',
    reason: 'Not in use while Input is Buttons.',
    arrange: () => {},
    stored: () => useSettings.getState().dotRotation,
  },
  {
    name: 'Date Format',
    reason: 'Practice dates ignore this while Random Format is on.',
    arrange: () => setting((s) => s.setRandomFormat(true)),
    stored: () => useSettings.getState().dateFormat,
  },
]

describe.each(PICKERS)('$name — $reason', ({ name, reason, arrange, stored }) => {
  it('a tap, an arrow key, and a press-drag release each change the stored value; the gear lights; the waiting question stays', () => {
    arrange()
    saveDefaultsAsTheyAre() // so the gear starts dark, and a change is what lights it
    mountApp()
    const waiting = shownDate()
    openSettings()
    expectNotInEffect(name, reason)
    expect(offers().gear).toBe(false)
    // A tap.
    const first = stored()
    pickPill(name, otherPillName(name))
    const second = stored()
    expect(second).not.toBe(first)
    expect(offers().gear).toBe(true)
    // An arrow key, from the pill the tap put the keyboard on.
    expect(arrowPicker(name, 'ArrowRight').prevented).toBe(true)
    const third = stored()
    expect(third).not.toBe(second)
    closeSettings()
    expect(shownDate()).toBe(waiting) // nothing was redrawn
    // A press-drag from the ⚙ button, released on a pill (the gesture opens the menu on the press).
    pressDragFromGear(() =>
      within(picker(name))
        .getAllByRole('radio')
        .find((b) => b.getAttribute('aria-checked') !== 'true'),
    )
    expect(stored()).not.toBe(third)
    closeSettings()
    expect(shownDate()).toBe(waiting)
  })

  it('a MoX run and a Blitz round under way carry on through the change, and the Best key stays', () => {
    arrange()
    useModePrefs.getState().setAoxN('5')
    mountApp()
    for (const key of ['A', 'B']) {
      mode(key)
      tap(screen.getByRole('button', { name: 'Begin' }))
      if (name !== 'Date Format') answerRight() // a random-format date is not parsed here
      openSettings()
      pickPill(name, otherPillName(name))
      closeSettings()
      expect(roundGoing()).toBe(true)
    }
    // The Best keys: nothing filed under anything new — the in-effect key did not move. (Nothing has
    // been filed at all: neither the run nor the round has ended.)
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(useProgress.getState().blitzBest).toEqual({})
  })
})

describe('the Year Range pair not in use', () => {
  it('outlined, described, typed into and saved — and the run carries on', () => {
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
    mountApp()
    mode('A')
    tap(screen.getByRole('button', { name: 'Begin' }))
    answerRight()
    openSettings()
    const box = screen.getByRole('textbox', { name: 'Latest Year, Julian Off' })
    expect(box.className).toContain('tray-dormant')
    expect(document.getElementById(box.getAttribute('aria-describedby')).textContent).toBe(
      'Not in use while Julian Calendar is on.',
    )
    expect(box.getAttribute('aria-disabled')).toBe(null)
    typeYear('max', '2000', 'off')
    commitYear('max', 'enter', 'off')
    expect(useSettings.getState().maxY).toBe(2000)
    expect(offers().gear).toBe(true)
    closeSettings()
    expect(roundGoing()).toBe(true)
    // …and the pair in use is drawn as usual.
    openSettings()
    const live = screen.getByRole('textbox', { name: 'Latest Year, Julian On' })
    expect(live.className).toContain('surface-tray')
    expect(live.hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('Input and Rotate Dots in Deduction', () => {
  it('changeable there, and the waiting puzzle stays', () => {
    mountApp()
    mode('D')
    const puzzle = () =>
      [...document.querySelectorAll('div')]
        .find((e) => e.children.length === 0 && e.textContent.includes('__') && !isHidden(e))
        .textContent.trim()
    const waiting = puzzle()
    openSettings()
    expectNotInEffect('Input', 'Not in use in Deduction.')
    pickPill('Input', 'Dots')
    expect(useSettings.getState().inputStyle).toBe('dots')
    expectNotInEffect('Rotate Dots', 'Not in use in Deduction.')
    pickPill('Rotate Dots', '90° CCW')
    expect(useSettings.getState().dotRotation).toBe('ccw90')
    expectNotInEffect('Julian Chance', 'Not in use in Deduction.')
    pickPill('Julian Chance', '50%')
    expect(useSettings.getState().julianChance).toBe('50')
    closeSettings()
    expect(puzzle()).toBe(waiting)
  })
})

describe('the one lock that stays: Amnesic while Save Stats is off', () => {
  it('faded and refused, with a MoX run under way — nothing happens', () => {
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
    mountApp()
    mode('A')
    tap(screen.getByRole('button', { name: 'Begin' }))
    answerRight()
    openSettings()
    toggleSwitch('Save Stats')
    expectLock('Amnesic', true)
    pickPill('Amnesic', 'Full')
    expect(pickerChosen('Amnesic')).toEqual(['Off'])
    closeSettings()
    expect(roundGoing()).toBe(true)
  })
})
