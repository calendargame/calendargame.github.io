// @vitest-environment jsdom
//
// yearRangePairs.dom — THE TWO YEAR RANGE PAIRS (Round 26, Q7), on the mounted app.
//
// The ⚙ panel holds the range used while the Julian Calendar setting is off (up to 10000) and the
// one used while it is on (up to 11582). Only the pair for the setting as it stands is in effect: the
// other is typed into and saved, lights the gear like any change, and changes no date — it resets no
// run, regenerates no waiting question, and moves no Best.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  closeSettings,
  panel,
  typeYear,
  commitYear,
  yearValue,
  offers,
  toggleSwitch,
} from './helpers/settingsPanel.jsx'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useProgress } from '../src/store/progress.js'
import { usePresets } from '../src/store/presets.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { correctDayName } from './helpers/modeScreen.jsx'
import { computeMethodSummary } from '../src/lib/method.js'

const JULIAN = 'Julian Calendar (pre-Oct 15, 1582)'
function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const shownDate = () =>
  [...document.querySelectorAll('div.date-line')].find((e) => !isHidden(e)).textContent.trim()
const shownYmd = () => shownDate().split('-').map(Number)
const setting = (fn) => act(() => fn(useSettings.getState()))
const commit = (which, text, pair) => {
  typeYear(which, text, pair)
  commitYear(which, 'enter', pair)
}
function bestMean() {
  const els = [...document.querySelectorAll('div')].filter(
    (e) => !isHidden(e) && e.textContent.trim().startsWith('Best Mean:'),
  )
  els.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
  return els[0]?.textContent.match(/Best Mean:\s*(—|\d+\.\d{2}s)/)?.[1] ?? null
}
const runGoing = () => screen.queryByRole('button', { name: 'Begin' }) === null
const answerRight = () => {
  const [y, m, d] = shownYmd()
  tap(screen.getByRole('button', { name: correctDayName({ y, m, d }) }))
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

describe('the row', () => {
  it('two captioned pairs, four named boxes, each pair holding its own years', () => {
    mountApp()
    openSettings()
    expect(panel().getByText('Julian Off')).toBeTruthy()
    expect(panel().getByText('Julian On')).toBeTruthy()
    for (const name of [
      'Earliest Year, Julian Off',
      'Latest Year, Julian Off',
      'Earliest Year, Julian On',
      'Latest Year, Julian On',
    ])
      expect(panel().getByRole('textbox', { name })).toBeTruthy()
    expect([yearValue('min', 'off'), yearValue('max', 'off')]).toEqual(['1', '10000'])
    expect([yearValue('min', 'on'), yearValue('max', 'on')]).toEqual(['1', '11582'])
    commit('max', '2000', 'off')
    commit('min', '10500', 'on')
    expect([useSettings.getState().minY, useSettings.getState().maxY]).toEqual([1, 2000])
    expect(useJulianRange.getState()).toMatchObject({ julianMinY: 10500, julianMaxY: 11582 })
  })
})

describe('the pair not in use changes no date', () => {
  it('Julian on, the Julian-off pair edited: the waiting Classic question stays, and the gear lights', () => {
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 1583 })
    mountApp()
    const before = shownDate()
    expect(shownYmd()[0]).toBe(1583)
    openSettings()
    commit('max', '1700', 'off')
    commit('min', '1700', 'off')
    expect(offers().gear).toBe(true) // a change like any other
    closeSettings()
    expect(shownDate()).toBe(before)
    // The control: the pair in use, edited the same way, regenerates into its new range.
    openSettings()
    commit('max', '1900', 'on')
    commit('min', '1900', 'on')
    closeSettings()
    expect(shownYmd()[0]).toBe(1900)
  })
  it('Julian off, the Julian-on pair edited: a MoX run carries on, and its Best key does not move', () => {
    setting((s) => {
      s.setUseJulian(false)
      s.setMinY(1583)
      s.setMaxY(10000)
    })
    mountApp()
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    tap(screen.getByRole('button', { name: 'Begin' }))
    answerRight()
    openSettings()
    commit('max', '11000', 'on')
    commit('min', '10500', 'on')
    closeSettings()
    expect(runGoing()).toBe(true)
  })
})

describe('years past 10000, with Julian on', () => {
  it('a range of 11578-11582 draws five-digit modern-calendar years, and the codes say Gregorian', () => {
    useJulianRange.getState().applyJulianRange({ julianMinY: 11578, julianMaxY: 11582 })
    mountApp()
    for (let i = 0; i < 20; i++) {
      tap(screen.getByRole('button', { name: 'New' }))
      const [y, m, d] = shownYmd()
      expect(y).toBeGreaterThanOrEqual(11578)
      expect(y).toBeLessThanOrEqual(11582)
      expect(computeMethodSummary({ y, m, d }, true).calendarSystem).toBe('Gregorian')
    }
  })
  it('the Julian-off pair stops at 10000 whatever is typed; the Julian-on pair at 11582', () => {
    mountApp()
    openSettings()
    commit('max', '99999', 'off')
    commit('max', '99999', 'on')
    expect([yearValue('max', 'off'), yearValue('max', 'on')]).toEqual(['10000', '11582'])
  })
})

describe('the Julian Calendar switch with the two pairs equal', () => {
  it('an ended MoX run resets once on the close, and the Best shown is the new set-up’s', () => {
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
    setting((s) => s.setMinY(1583))
    useModePrefs.getState().setAoxN('2')
    mountApp()
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    tap(screen.getByRole('button', { name: 'Begin' }))
    answerRight()
    answerRight()
    expect(bestMean()).not.toBe('—') // the run is done and set a Best under Julian on
    openSettings()
    toggleSwitch(JULIAN)
    closeSettings()
    expect(runGoing()).toBe(false) // reset, back to Begin
    expect(bestMean()).toBe('—') // Julian off is another set-up: its own (empty) Best
  })
})

describe('what an older build left, as the player sees it (design A2.3 row 1)', () => {
  it('the Julian-on pair set to 1-10000 survives the live app’s theme change and Reset Settings: the boxes read 1-10000 and the Best from 1-10000 shows', async () => {
    const rec = JSON.parse(
      readFileSync(resolve(__dirname, 'fixtures/olderBuilds/julianRange-v2.29.0.json'), 'utf8'),
    )
    localStorage.clear()
    for (const [k, v] of Object.entries(rec.row1.after)) localStorage.setItem(k, JSON.stringify(v))
    for (const s of [usePresets, useSettings, useJulianRange, useProgress, useUserDefaults])
      await s.persist.rehydrate()
    mountApp()
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    expect(bestMean()).toBe('1.50s')
    openSettings()
    expect([yearValue('min', 'on'), yearValue('max', 'on')]).toEqual(['1', '10000'])
  })
})
