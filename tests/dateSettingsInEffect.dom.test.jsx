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
import { it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import { resetAppState, mountApp, tap } from './helpers/settingsPanel.jsx'
import { installSeededRandom } from './helpers/rng.js'
import { useSettings } from '../src/store/settings.js'

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

// ⚠ PINNED AS FAILING, ON PURPOSE, UNTIL THE FIX LANDS: on the code of this commit the generator falls
// back and 1901, 1902, and 1903 come up too. `it.fails` keeps the gate green while recording the defect;
// the commit that hands the generator the settings in effect turns it into a plain `it`.
it.fails(
  'Julian on, 1901-1904, Julian Chance 100% (not in effect there), Leap Year Chance 100%: every date is in 1904, the one leap year',
  () => {
    mountApp()
    act(() => {
      const s = useSettings.getState()
      s.setRandomFormat(false)
      s.setDateFormat('numeric-ymd')
      s.setUseJulian(true)
      s.setMinY(1901)
      s.setMaxY(1904)
      s.setJulianChance('100')
      s.setLeapChance('100')
    })
    const years = []
    for (let i = 0; i < 40; i++) {
      tap(screen.getByRole('button', { name: 'New' }))
      years.push(Number(shownDate().split('-')[0]))
    }
    expect(years.filter((y) => y !== 1904)).toEqual([])
  },
)
