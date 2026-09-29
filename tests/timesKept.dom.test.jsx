// @vitest-environment jsdom
//
// EVERY SOLVE TIME IS KEPT (round 23 Q3) — the player-visible half, on the real <App/>.
//
// The old 1,000-time cap trimmed the SAVED times while the correct-answer count kept growing. Two
// things a player could see followed from it, and this file pins both as they now behave:
//   • THE FALSE POPUP. "Enable and Reset Stats?" opens when `good` and the number of recorded times
//     disagree (modes/modeHooks). Past 1,000 timed answers they ALWAYS disagreed after a reload, so
//     hiding and re-showing timing offered to wipe a player's stats for nothing. With nothing
//     discarded the plain check is exact again; a save the old cap already trimmed carries the gap
//     as a one-time baseline (store/progress' v5 migration) that the check subtracts.
//   • THE NUMBER THAT MOVED ON RELOAD. In a visit the Mean averaged every time; after a reload it
//     averaged only the saved 1,000. A reload must never change a displayed number.
// The popup still has to fire for the case it exists for — an answer given while timing was hidden
// records no time — and that is pinned here too, on a trimmed save, so the baseline is proven not to
// have swallowed it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { App } from '../src/main.jsx'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { seedSaved, rehydrate, storageKeyFor } from './helpers/persistence.js'
import { createPreset, switchPreset } from '../src/store/presetControl.js'
import { readDate, correctDayName, statValue } from './helpers/modeScreen.jsx'

function mountApp() {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(<App />)
}
function unmountApp() {
  cleanup()
  document.getElementById('root')?.remove()
}
const answerCorrect = () =>
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: correctDayName(readDate()) }))
  })
// Tap a stat cell the way a player does — the cell is the button.
const tapStat = (label) =>
  act(() => {
    fireEvent.click(
      screen
        .getAllByRole('button')
        .find((b) => [...b.querySelectorAll('span')].some((s) => s.textContent.trim() === label)),
    )
  })
const enableReset = () => screen.queryByRole('dialog', { name: 'Enable and Reset Stats?' })

// A Classic save with `good` correct answers, `times` of them timed.
const classicSave = (stats, version) =>
  seedSaved(
    useProgress,
    { ...makeProgressDefaults(), stats: { ...makeProgressDefaults().stats, classic: stats } },
    version,
  )
const times = (n) => Array.from({ length: n }, (_, i) => 2 + (i % 50) / 10)

describe('every solve time is kept — the popup and the numbers a player sees', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().resetToFactory()
    useSettings.getState().setRandomFormat(false)
    useSettings.getState().setDateFormat('numeric-ymd')
    useSettings.getState().setMinY(1583)
    useSettings.getState().setMaxY(10000)
    useModePrefs.getState().resetModePrefs()
    useModePrefs.getState().setClassicTimingOff(false) // timing shown
  })
  afterEach(() => {
    unmountApp()
    vi.restoreAllMocks()
  })

  it('a save the OLD cap trimmed never offers the false "Enable and Reset Stats?"', async () => {
    classicSave({ played: 1500, good: 1500, streak: 5, best: 50, times: times(1000) }, 4)
    await rehydrate(useProgress)
    mountApp()
    tapStat('Last') // hide timing
    tapStat('Last') // …and show it again, with nothing answered in between
    expect(enableReset()).toBeNull()
    expect(statValue('Last')).toMatch(/s$/) // timing is simply back on
  })

  it('…and still opens it when an answer really was given while timing was hidden', async () => {
    classicSave({ played: 1500, good: 1500, streak: 5, best: 50, times: times(1000) }, 4)
    await rehydrate(useProgress)
    mountApp()
    tapStat('Last') // hide timing — the clock stops
    answerCorrect() // a credit with no time behind it
    tapStat('Last')
    expect(enableReset()).not.toBeNull()
  })

  // Past the old cap by ONE answer given in this visit: the old build saved 1,000 times beside
  // good = 1,001, and the very next reload opened the popup.
  it('a player crossing 1,000 timed answers: no false popup after a reload', async () => {
    classicSave({ played: 1000, good: 1000, streak: 5, best: 50, times: times(1000) }, 5)
    await rehydrate(useProgress)
    mountApp()
    answerCorrect() // the 1,001st timed answer
    unmountApp()
    await rehydrate(useProgress)
    mountApp()
    tapStat('Last')
    tapStat('Last')
    expect(enableReset()).toBeNull()
  })

  it('a reload never changes the Mean or the Median — they are all-time numbers', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // The OLDEST saved solve is a slow one, so a save that dropped it would move every number.
    const saved = [600, ...times(999)]
    classicSave({ played: 1000, good: 1000, streak: 5, best: 50, times: saved }, 5)
    await rehydrate(useProgress)
    mountApp()
    now = 90_000 // a 90-second solve — enough to move a 1,001-time Mean
    answerCorrect()
    const shown = { mean: statValue('Mean'), median: statValue('Median'), last: statValue('Last') }
    expect(shown.last).toBe('1m 30.00s')
    unmountApp()
    await rehydrate(useProgress)
    mountApp()
    expect({
      mean: statValue('Mean'),
      median: statValue('Median'),
      last: statValue('Last'),
    }).toEqual(shown)
  })

  // ★ THE BASELINE BELONGS TO THE COUNTS IT DESCRIBES, so wiping the counts wipes it. Reset Stats
  // (and Full Reset, and "Enable and Reset Stats") all land on the engine's blank stats, which carry
  // no `timesLost` — so the next hidden-timing answer after a reset is judged on its own again.
  it('Reset Stats clears the baseline with the counts', async () => {
    classicSave({ played: 1500, good: 1500, streak: 5, best: 50, times: times(1000) }, 4)
    await rehydrate(useProgress)
    mountApp()
    expect(useProgress.getState().stats.classic.timesLost).toBe(500)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset Stats' }))
    })
    act(() => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Reset Stats?' })).getByRole('button', {
          name: 'Reset Stats',
        }),
      )
    })
    expect(useProgress.getState().stats.classic).toEqual(makeProgressDefaults().stats.classic)
  })

  // Every preset owns its own saved stats, so each one's trimmed save is repaired when THAT preset
  // is first read — here preset 2's, on the switch that hydrates it.
  it("another preset's trimmed save is repaired when that preset is opened", () => {
    const p2 = createPreset('Second')
    const key = storageKeyFor(useProgress).replace(/~p\d+$/, '') + `~p${p2.id}`
    const stats = { played: 1400, good: 1300, streak: 1, best: 9, times: times(1000) }
    localStorage.setItem(
      key,
      JSON.stringify({
        state: {
          ...makeProgressDefaults(),
          stats: { ...makeProgressDefaults().stats, dedDay: stats },
        },
        version: 4,
      }),
    )
    switchPreset(p2.id)
    expect(useProgress.getState().stats.dedDay).toEqual({ ...stats, timesLost: 300 })
    expect(JSON.parse(localStorage.getItem(key)).version).toBe(5)
  })
})
