// @vitest-environment jsdom
//
// dateSettingsInEffect.dom — A DATE SETTING THAT IS NOT IN EFFECT DOES NOTHING TO THE DATES.
//
// Julian Chance only applies while the Julian Calendar setting is on AND the year range includes 1582
// (it is drawn "not in effect" otherwise). But the date generator used to be handed the setting as
// stored, whatever the range: on a range that does not include 1582, "want a Julian date" (or "want a
// modern one") can never be met, so after 2,000 failed draws the generator fell back to a draw with NO
// filter at all — dropping Leap Year Chance and Jan/Feb Chance with it. A player shown a lit Leap Year
// Chance of 100% on 1901-1904 got any of the four years, not the one leap year.
//
// The fix is at the root: the generator is handed the settings IN EFFECT (lib/dateConfig's
// dateSettingsInEffect), so a setting that cannot apply is never passed to it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  closeSettings,
} from './helpers/settingsPanel.jsx'
import { installSeededRandom } from './helpers/rng.js'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useProgress } from '../src/store/progress.js'
import { correctDayName } from './helpers/modeScreen.jsx'

function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
const shownDate = () =>
  [...document.querySelectorAll('div.text-3xl')].find((e) => !isHidden(e)).textContent.trim()

let restoreRandom
beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
  restoreRandom = installSeededRandom(20261016)
})
afterEach(() => {
  restoreRandom()
  cleanup()
  document.getElementById('root')?.remove()
})

it('Julian on, 1901-1904, Julian Chance 100% (not in effect there), Leap Year Chance 100%: every date is in 1904, the one leap year', () => {
  mountApp()
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setUseJulian(true)
    s.setMinY(1901)
    s.setMaxY(1904)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1901, julianMaxY: 1904 })
    s.setJulianChance('100')
    s.setLeapChance('100')
  })
  const years = []
  for (let i = 0; i < 40; i++) {
    tap(screen.getByRole('button', { name: 'New' }))
    years.push(Number(shownDate().split('-')[0]))
  }
  expect(years.filter((y) => y !== 1904)).toEqual([])
})

// ── The Bests filed under stored values before Round 26 (engine/bestPool) ────────────────────────
const setting = (fn) => act(() => fn(useSettings.getState()))
const readable = () =>
  setting((s) => {
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
  })
// Best Mean's value on the MoX screen ("1.50s" or the dash).
function bestMean() {
  const els = [...document.querySelectorAll('div')].filter(
    (e) => !isHidden(e) && e.textContent.trim().startsWith('Best Mean:'),
  )
  els.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
  return els[0]?.textContent.match(/Best Mean:\s*(—|\d+\.\d{2}s)/)?.[1] ?? null
}
const record = (avg) => ({ avg, avgMed: avg, avgRoundId: 7, med: avg, medAvg: avg, medRoundId: 7 })

describe('a MoX Best filed under a stored value', () => {
  it('that did nothing (Julian Chance with Julian off) shows whatever the dimmed setting holds, and changing it moves nothing', () => {
    const KEY = '10|false|numeric-ymd|random|random|50|1583-10000|false'
    mountApp()
    readable()
    setting((s) => {
      s.setUseJulian(false)
      s.setMinY(1583)
      s.setMaxY(10000)
      useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
    })
    act(() => useProgress.setState({ aoxBest: { [KEY]: record(1.5) } }))
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    const stored = JSON.stringify(useProgress.getState().aoxBest)
    for (const jc of ['random', '25', '50', '75', '100']) {
      setting((s) => s.setJulianChance(jc))
      expect(bestMean()).toBe('1.50s')
    }
    expect(JSON.stringify(useProgress.getState().aoxBest)).toBe(stored) // read, never rewritten
  })
  it('that the generator fault played on other dates (Julian on, 1900-2100, Julian Chance 50%, Leap Year Chance 100%) is never shown, and stays as it was', () => {
    const KEY = '10|false|numeric-ymd|100|random|50|1900-2100|true'
    mountApp()
    readable()
    setting((s) => {
      s.setUseJulian(true)
      s.setMinY(1900)
      s.setMaxY(2100)
      useJulianRange.getState().applyJulianRange({ julianMinY: 1900, julianMaxY: 2100 })
      s.setLeapChance('100')
      s.setJulianChance('50')
    })
    act(() => useProgress.setState({ aoxBest: { [KEY]: record(1.5) } }))
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    expect(bestMean()).toBe('—')
    for (const jc of ['random', '25', '100']) {
      setting((s) => s.setJulianChance(jc))
      expect(bestMean()).toBe('—')
    }
    expect(useProgress.getState().aoxBest).toEqual({ [KEY]: record(1.5) })
  })
})

describe('changing a setting that is not in effect never restarts a run', () => {
  const runGoing = () => screen.queryByRole('button', { name: 'Begin' }) === null
  const beginAndAnswer = () => {
    tap(screen.getByRole('button', { name: 'Begin' }))
    const [y, m, d] = shownDate().split('-').map(Number)
    tap(screen.getByRole('button', { name: correctDayName({ y, m, d }) }))
  }
  it('Jan/Feb Chance on a range with no leap year: the MoX run carries on; Leap Year Chance on a range with leap years resets it', () => {
    readable()
    setting((s) => {
      s.setUseJulian(false)
      s.setMinY(1701)
      s.setMaxY(1703)
      useJulianRange.getState().applyJulianRange({ julianMinY: 1701, julianMaxY: 1703 })
    })
    mountApp()
    act(() => void fireEvent.keyDown(window, { key: 'A' }))
    beginAndAnswer()
    openSettings()
    setting((s) => s.setJanFebChance('75'))
    closeSettings()
    expect(runGoing()).toBe(true)
    // The control case: the same visit to the panel with a setting that IS in effect, on a range with
    // leap years (moving to it resets the run, as a change of range does).
    openSettings()
    setting((s) => s.setMaxY(1710))
    closeSettings()
    expect(runGoing()).toBe(false)
    beginAndAnswer()
    openSettings()
    setting((s) => s.setLeapChance('75'))
    closeSettings()
    expect(runGoing()).toBe(false)
  })
})
