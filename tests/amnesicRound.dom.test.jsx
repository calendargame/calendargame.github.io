// @vitest-environment jsdom
//
// amnesicRound.dom — THE ROUND MODES (Blitz and MoX) UNDER AMNESIC (design-amnesic-close.md; store/amnesic).
//
// ★ THE OWNER'S RULES, as they reach a round:
//   • while playing, Amnesic changes nothing: a round played on any value counts in the one pool - its Best
//     is on screen and on the device the moment it ends - and turning the pill never changes the round on
//     screen or a Best;
//   • at the app's close (a reload is not one), going by the value AT THE CLOSE, for what was played since
//     the value was last switched on from Off: Stats Only keeps a new Best; Full puts back the Best that
//     stood before, exactly - its holders, its companion numbers, its ★ round;
//   • so Stats Only and Full differ only here, in the modes with Bests (How to Play says so).
// What a close does to the casual strips (Classic, Flash, Deduction) is tests/amnesic.dom's; what makes the
// close a close (the Web Locks) is tests/amnesicClose's.
//
// The rest of the file pins how a finished round itself lives, on every value alike: it is the screen's,
// for one browsing session - a reload keeps it, a close drops it - and it comes back only over the setup it
// was played under; a run keeps the length it was begun at; round ids never repeat across loads; a
// practice round stays a practice round.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import { setPresetAmnesic } from '../src/store/presetControl.js'
import { amnesicModeOf } from '../src/store/amnesic.js'
import { loadPage, closeApp } from './helpers/pageLoad.js'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import {
  resetAppState,
  mountApp,
  tap,
  openSettings,
  fireResetSettings,
} from './helpers/settingsPanel.jsx'
import { wday } from '../src/lib/calendar.js'
import { DAY } from '../src/lib/format.js'

function isHidden(el) {
  for (let n = el; n; n = n.parentElement) if (n.style && n.style.display === 'none') return true
  return false
}
function readDate() {
  const els = Array.from(document.querySelectorAll('div')).filter(
    (e) => e.children.length === 0 && /^-?\d+-\d+-\d+$/.test(e.textContent.trim()) && !isHidden(e),
  )
  if (els.length !== 1) throw new Error(`expected one visible ymd date, found ${els.length}`)
  const [y, m, d] = els[0].textContent.trim().split('-').map(Number)
  return { y, m, d }
}
function statValue(label) {
  const labelSpan = Array.from(document.querySelectorAll('span')).find(
    (s) => s.textContent.trim() === label && !isHidden(s),
  )
  if (!labelSpan) throw new Error(`stat "${label}" not found on the visible screen`)
  return labelSpan.parentElement.querySelector('[data-statval]').textContent.trim()
}
const correctName = ({ y, m, d }) => DAY[wday(y, m, d)]
const ctrl = (name) => screen.getByRole('button', { name })
const press = (key) => act(() => fireEvent.keyDown(window, { key }))
const pinReadable = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
  })
// The ⚙ pill, as one call.
const setAmnesic = (mode, id = usePresets.getState().activeId) =>
  act(() => setPresetAmnesic(id, mode))
const statsKey = (id = 1) => presetKey(PRESET_STORE_KEYS.progress, id)
const permanent = (id = 1) => JSON.parse(localStorage.getItem(statsKey(id)) ?? 'null')?.state
// A Best record as the app's values: without the tag that names its values (`w`) and the holder ids
// written beside its companions (store/bestRecords: the doc's, for its reader).
const recordValues = (rec) => {
  if (!rec) return rec
  const { w: _w, scoreStreakOf: _s, streakScoreOf: _k, avgMedOf: _a, medAvgOf: _m, ...values } = rec
  return values
}
function finishBlitz(n) {
  tap(ctrl('Begin'))
  for (let i = 0; i < n; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
  tap(ctrl('Reveal'))
}
function finishMox(n) {
  tap(ctrl('Begin'))
  for (let i = 0; i < n; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
}
const onlyKey = (o) => {
  const k = Object.keys(o)
  if (k.length !== 1) throw new Error('expected one Best key, found ' + k.length)
  return k[0]
}
const unmount = () => {
  cleanup()
  document.getElementById('root')?.remove()
}
// A RELOAD: the page goes away and comes back with every storage area intact — localStorage AND
// sessionStorage — and every store re-read from it, exactly as a real reload re-reads them.
const reload = () => {
  unmount()
  act(() => {
    loadPage()
  })
  mountApp()
}
// A REAL CLOSE, then an open (tests/helpers/pageLoad): sessionStorage is gone, and the opener runs the
// close - Amnesic's forget - before the app is drawn.
const closeAndReopen = () => {
  unmount()
  act(() => {
    closeApp()
    loadPage()
  })
  mountApp()
}
const bestLine = (label) =>
  Array.from(document.querySelectorAll('div')).find(
    (el) => !isHidden(el) && new RegExp(`^\\s*${label}:`).test(el.firstChild?.nodeValue ?? ''),
  ).textContent

const BLITZ = [
  { name: 'Blitz, Per Round', perQ: false, am: false, field: 'blitzBest' },
  { name: 'Blitz, Per Question sudden death', perQ: true, am: false, field: 'suddenBest' },
  { name: 'Blitz, Per Question + Allow Mistakes', perQ: true, am: true, field: 'suddenAmBest' },
]
const toBlitz = (v) => {
  act(() => {
    useModePrefs.getState().setBlitzPerQ(v.perQ)
    useModePrefs.getState().setBlitzAllowMistakes(v.am)
  })
  press('B')
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('while playing, a round counts in the one pool on every value', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  for (const v of BLITZ)
    for (const mode of ['stats', 'full'])
      it(`${v.name}, ${mode}: the new Best is on screen and on the device the moment the round ends`, () => {
        mountApp()
        pinReadable()
        toBlitz(v)
        finishBlitz(2) // an Off round: Best 2
        tap(ctrl('Reset'))
        const key = onlyKey(useProgress.getState()[v.field])
        setAmnesic(mode)
        expect(useProgress.getState()[v.field][key].score).toBe(2) // shown, to be beaten
        finishBlitz(4)
        expect(useProgress.getState()[v.field][key].score).toBe(4)
        expect(permanent()[v.field][key].score).toBe(4)
        expect(bestLine('Best Score')).toContain('★')
      })

  it('MoX, Full: Best Mean and Best Median are on the device the moment the run completes', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    press('A')
    setAmnesic('full')
    finishMox(2)
    const record = Object.values(permanent().aoxBest)[0]
    expect(record.avg).toEqual(expect.any(Number))
    expect(record.med).toEqual(expect.any(Number))
    expect(bestLine('Best Mean')).toContain('★')
  })

  it('turning the pill, every value in turn, leaves the round on screen, its ★, and the device as they are', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4)
    const device = localStorage.getItem(statsKey())
    for (const mode of ['stats', 'full', 'off', 'full', 'stats', 'off']) {
      setAmnesic(mode)
      expect(statValue('Score')).toBe('4/5')
      expect(bestLine('Best Score')).toContain('★')
      expect(localStorage.getItem(statsKey())).toBe(device)
    }
  })

  it('…and a MoX run, with its breakdown', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    press('A')
    finishMox(2)
    const device = localStorage.getItem(statsKey())
    for (const mode of ['full', 'stats', 'off']) {
      setAmnesic(mode)
      expect(statValue('Score')).toBe('2/2')
      expect(bestLine('Best Mean')).toContain('★')
      expect(localStorage.getItem(statsKey())).toBe(device)
    }
    tap(ctrl('Show mean breakdown'))
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('Save Stats off still means nothing is recorded, on any value', () => {
    mountApp()
    pinReadable()
    press('B')
    act(() => useSettings.getState().setSaveStats(false))
    for (const mode of ['stats', 'full']) {
      setAmnesic(mode)
      const before = localStorage.getItem(statsKey())
      finishBlitz(4)
      tap(ctrl('Reset'))
      expect(useProgress.getState().blitzBest).toEqual({})
      expect(localStorage.getItem(statsKey())).toBe(before)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AT THE CLOSE: Stats Only keeps a new Best, Full puts back the one before - and what stood before the
// switch-on is never touched.
describe('at the close: Stats Only keeps a new Best, Full puts the one before back exactly', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  for (const v of BLITZ)
    for (const mode of ['stats', 'full'])
      it(`${v.name}, ${mode}`, () => {
        mountApp()
        pinReadable()
        toBlitz(v)
        finishBlitz(2) // before the switch-on: Best 2
        tap(ctrl('Reset'))
        const key = onlyKey(useProgress.getState()[v.field])
        const before = recordValues(permanent()[v.field][key])
        setAmnesic(mode)
        finishBlitz(3)
        tap(ctrl('Reset'))
        finishBlitz(5) // beaten twice inside the window
        const set = recordValues(permanent()[v.field][key])
        expect(set.score).toBe(5)
        closeAndReopen()
        expect(amnesicModeOf(1)).toBe(mode) // a setting: it stays
        const now = mode === 'stats' ? set : before
        expect(recordValues(permanent()[v.field][key])).toEqual(now)
        expect(recordValues(useProgress.getState()[v.field][key])).toEqual(now)
        toBlitz(v)
        expect(ctrl('Begin')).toBeInTheDocument() // the round itself went with the session
        expect(bestLine('Best Score')).toContain(String(now.score))
        expect(bestLine('Best Score')).not.toContain('★')
      })

  it('Full: a Best first set inside the window leaves no record at all', () => {
    mountApp()
    pinReadable()
    press('B')
    setAmnesic('full')
    finishBlitz(3)
    expect(Object.keys(permanent().blitzBest)).toHaveLength(1)
    closeAndReopen()
    expect(permanent().blitzBest).toEqual({})
    expect(useProgress.getState().blitzBest).toEqual({})
  })

  it('Full, MoX: Best Mean and Best Median come back as they stood, run and all', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    press('A')
    finishMox(2) // a run before the switch-on (its record's key)…
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().aoxBest)
    // …and a SLOW record planted there, which any run beats (seconds; a round id from before)
    const slow = { avg: 999, avgMed: 999, avgRoundId: 7, med: 999, medAvg: 999, medRoundId: 7 }
    act(() => useProgress.setState({ aoxBest: { [key]: slow } }))
    const before = recordValues(permanent().aoxBest[key])
    setAmnesic('full')
    finishMox(2) // a faster run
    expect(recordValues(permanent().aoxBest[key])).not.toEqual(before)
    closeAndReopen()
    expect(recordValues(permanent().aoxBest[key])).toEqual(before)
  })

  it('Stats Only, MoX: the faster run’s Best is kept', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    press('A')
    setAmnesic('stats')
    finishMox(2)
    const key = onlyKey(useProgress.getState().aoxBest)
    const set = recordValues(permanent().aoxBest[key])
    closeAndReopen()
    expect(recordValues(permanent().aoxBest[key])).toEqual(set)
  })

  // ONLY THE VALUE AT THE CLOSE DECIDES, and the window starts at the switch-on from Off: Stats Only ↔
  // Full moves no start.
  for (const [label, path, kept] of [
    ['Full, then Stats Only at the close: the Best is kept', ['full', 'stats'], true],
    ['Stats Only, then Full at the close: the Best goes', ['stats', 'full'], false],
    ['Full, then Off at the close: the Best is kept', ['full', 'off'], true],
  ])
    it(label, () => {
      mountApp()
      pinReadable()
      press('B')
      finishBlitz(2)
      tap(ctrl('Reset'))
      const key = onlyKey(useProgress.getState().blitzBest)
      setAmnesic(path[0])
      finishBlitz(4)
      tap(ctrl('Reset'))
      setAmnesic(path[1])
      closeAndReopen()
      expect(permanent().blitzBest[key].score).toBe(kept ? 4 : 2)
    })

  it('Full, off and on again: only the Best set after the last switch-on goes', () => {
    mountApp()
    pinReadable()
    press('B')
    setAmnesic('full')
    finishBlitz(2) // in the first window
    tap(ctrl('Reset'))
    setAmnesic('off')
    finishBlitz(3) // on Off
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().blitzBest)
    const before = recordValues(permanent().blitzBest[key])
    setAmnesic('full')
    finishBlitz(6) // in the window that is open at the close
    closeAndReopen()
    expect(recordValues(permanent().blitzBest[key])).toEqual(before)
  })

  it('a reload is not a close: the round stays on screen and the Best stands - until the close', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(2)
    setAmnesic('full')
    tap(ctrl('Reset'))
    finishBlitz(4)
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    expect(ctrl('Reset')).toBeInTheDocument() // Blitz, with the ended round still up
    expect(statValue('Score')).toBe('4/5')
    expect(Object.values(permanent().blitzBest)[0].score).toBe(4)
    closeAndReopen()
    expect(Object.values(permanent().blitzBest)[0].score).toBe(2)
  })

  // ★ AN OVERRIDE IS PLAY IN THE WINDOW ONLY FOR A ROUND PLAYED IN IT. On a round from before the switch-on
  // it is a correction: the anchor takes it too, so Full's forget keeps it (store/screenPool's Filed - the
  // window a round was first filed in, parked with it - and store/syncRecords' `re`).
  it('Full: an Override of a round played in the window goes with the window', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(2)
    tap(ctrl('Reset'))
    const key = onlyKey(useProgress.getState().blitzBest)
    const before = recordValues(permanent().blitzBest[key])
    setAmnesic('full')
    finishBlitz(3)
    tap(ctrl('Override')) // credits the revealed card: 4, back in play…
    tap(ctrl('Reveal')) // …and ended again
    expect(permanent().blitzBest[key].score).toBe(4)
    closeAndReopen()
    expect(recordValues(permanent().blitzBest[key])).toEqual(before)
  })

  it('Full: an Override of a round from before the switch-on is a correction, and the close keeps it', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(3) // an Off round, still on screen
    setAmnesic('full')
    tap(ctrl('Override')) // corrected: 4
    tap(ctrl('Reveal'))
    expect(Object.values(permanent().blitzBest)[0].score).toBe(4)
    reload() // (the round comes back with the window it was first filed in)
    tap(ctrl('Override')) // and once more, after a reload: 5
    tap(ctrl('Reveal'))
    expect(Object.values(permanent().blitzBest)[0].score).toBe(5)
    tap(ctrl('Reset'))
    finishBlitz(7) // a round of the window's own
    closeAndReopen()
    const record = Object.values(permanent().blitzBest)[0]
    expect(record.score).toBe(5) // the correction stands; the window's round is gone
  })

  it('an Override on the finished round moves its Best, and Stats Only keeps that too', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(3) // saved Best: 3
    tap(ctrl('Reset'))
    setAmnesic('stats')
    finishBlitz(3) // ties it: the record stays with the earlier round
    expect(Object.values(permanent().blitzBest)[0].score).toBe(3)
    expect(bestLine('Best Score')).not.toContain('★')
    tap(ctrl('Override')) // credits the revealed card: 4, and the round is back in play
    tap(ctrl('Reveal'))
    expect(Object.values(permanent().blitzBest)[0].score).toBe(4)
    expect(bestLine('Best Score')).toContain('★')
    closeAndReopen()
    expect(Object.values(permanent().blitzBest)[0].score).toBe(4)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A FINISHED ROUND IS THE SCREEN'S, FOR ONE BROWSING SESSION — whatever the Amnesic value.
// ── It comes back only over the configuration it was played under ─────────────────────────────
// The ⚙ settings and the per-mode setup can move while a finished round is parked (another tab on this
// origin, between a reload's two loads). Restored over a different one, the round reconciled against
// settings it was never played on — and each of these changed a saved Best (round 23's review). A round
// that no longer matches is not restored: the screen is idle, and every saved Best is as the round left it.
describe('a parked round comes back only over the setup it was played under', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  const moved = (edit) => {
    unmount()
    act(edit) // (moved while the page was away)
    mountApp()
  }

  it('MoX: a raised run length — the Best is not taken away', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const before = JSON.stringify(permanent().aoxBest)
    moved(() => useModePrefs.getState().setAoxN('5'))
    press('A')
    expect(JSON.stringify(permanent().aoxBest)).toBe(before)
    expect(ctrl('Begin')).toBeInTheDocument() // a Mo2 run is not shown as a Mo5 one
  })

  it('MoX: One-by-One flipped — the run is not restored into the other sub-mode', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const before = JSON.stringify(permanent().aoxBest)
    moved(() => useModePrefs.getState().setAoxOneByOne(true))
    press('A')
    expect(JSON.stringify(permanent().aoxBest)).toBe(before)
    expect(ctrl('Begin')).toBeInTheDocument()
  })

  for (const [label, edit] of [
    ['Per Question', () => useModePrefs.getState().setBlitzPerQ(true)],
    [
      'Per Question + Allow Mistakes off',
      () => {
        useModePrefs.getState().setBlitzPerQ(true)
        useModePrefs.getState().setBlitzAllowMistakes(false)
      },
    ],
    ['Allow Mistakes off', () => useModePrefs.getState().setBlitzAllowMistakes(false)],
    ['a different round length', () => useModePrefs.getState().setBlitzSec(30)],
    ['the shared Julian range', () => useJulianRange.getState().setJulianMinY(1900)],
  ])
    it(`Blitz: ${label} — no Best appears in a sub-mode never played, and no round is resumed`, () => {
      mountApp()
      pinReadable()
      press('B')
      finishBlitz(4)
      const before = JSON.stringify(permanent())
      moved(edit)
      press('B')
      expect(ctrl('Begin')).toBeInTheDocument()
      expect(JSON.stringify(permanent())).toBe(before)
    })

  it('a setup changed and put back: the round still comes back, untouched', () => {
    mountApp()
    pinReadable()
    press('B')
    finishBlitz(4)
    const before = JSON.stringify(permanent())
    moved(() => {
      useModePrefs.getState().setBlitzPerQ(true)
      useModePrefs.getState().setBlitzPerQ(false)
    })
    press('B')
    expect(statValue('Score')).toBe('4/5')
    expect(JSON.stringify(permanent())).toBe(before)
  })
})

// The same rule from inside one page: Reset Settings can move the run length under a MoX run that is
// still on screen (the run resets when the ⚙ panel closes). The run's own arithmetic uses the length
// it was BEGUN at, so nothing happens to it — or to its Best — in between.
describe('MoX: a run keeps the length it was begun at', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  it('Reset Settings with a finished run on screen does not take its Best away', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    const key = onlyKey(useProgress.getState().aoxBest)
    const record = JSON.stringify(useProgress.getState().aoxBest[key])
    openSettings('gear')
    fireResetSettings() // the run length goes back to 10 while the Mo2 run is still up
    expect(useModePrefs.getState().aoxN).toBe('10')
    expect(JSON.stringify(useProgress.getState().aoxBest[key])).toBe(record)
  })

  it('Reset Settings with a run in progress does not complete it early', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    act(() => {
      useUserDefaults.getState().saveDefaults({
        settings: { ...useSettings.getState() },
        prefs: { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '2' },
        amnesic: 'off',
      })
    })
    press('A')
    act(() => useModePrefs.getState().setAoxN('5'))
    tap(ctrl('Begin'))
    for (let i = 0; i < 3; i++) tap(screen.getByRole('button', { name: correctName(readDate()) }))
    openSettings('gear')
    fireResetSettings() // the saved run length (2) comes back under a Mo5 run holding 3 solves
    expect(useModePrefs.getState().aoxN).toBe('2')
    expect(useProgress.getState().aoxBest).toEqual({}) // 3 solves are not a finished Mo2
  })
})

// A config with no Best has no key — after a run that created one is retracted, exactly as Blitz.
describe('MoX: a retracted run with no earlier Best leaves no record behind', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('Override on the completing solve removes the record the run created', () => {
    mountApp()
    pinReadable()
    press('A')
    act(() => useModePrefs.getState().setAoxN('2'))
    finishMox(2)
    expect(Object.keys(useProgress.getState().aoxBest)).toHaveLength(1)
    tap(ctrl('Override')) // the held completing solve, overridden to a miss: the run no longer stands
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
  })
})

describe('round ids are never reused across screen loads (what the ★ rule rests on)', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  it('a best score and a best streak set on two different loads read "Different Rounds"', () => {
    // Per Round, Allow Mistakes on (the factory setup). Both rounds are the FIRST round of their
    // load, which the old per-screen counter numbered 1 — so the tag read "Same Round".
    const wrong = ({ y, m, d }) => DAY[(wday(y, m, d) + 1) % 7]
    const answer = (right) =>
      tap(screen.getByRole('button', { name: (right ? correctName : wrong)(readDate()) }))
    mountApp()
    pinReadable()
    press('B')
    // Round A: ✓ ✓ ✗ (retry ✓, no credit) ✓ ✓ → score 4, best streak 2.
    tap(ctrl('Begin'))
    answer(true)
    answer(true)
    answer(false)
    answer(true)
    answer(true)
    answer(true)
    tap(ctrl('Reveal'))
    const a = Object.values(useProgress.getState().blitzBest)[0]
    expect([a.score, a.streak]).toEqual([4, 2])
    tap(ctrl('Reset'))
    closeAndReopen()
    press('B')
    // Round B: ✓ ✓ ✓ → score 3 (A keeps the score), best streak 3 (B takes the streak).
    tap(ctrl('Begin'))
    answer(true)
    answer(true)
    answer(true)
    tap(ctrl('Reveal'))
    const b = Object.values(useProgress.getState().blitzBest)[0]
    expect([b.score, b.streak]).toEqual([4, 3])
    expect(b.scoreRoundId).toBe(a.scoreRoundId)
    expect(b.streakRoundId).not.toBe(a.scoreRoundId)
    // The tag on the visible Blitz screen (the guide mentions both phrases too, hidden).
    const tag = Array.from(document.querySelectorAll('span')).find(
      (e) => /^(Same Round|Different Rounds)$/.test(e.textContent) && !isHidden(e),
    )
    expect(tag.textContent).toBe('Different Rounds')
  })
})

// ── A PRACTICE ROUND STAYS A PRACTICE ROUND ─────────────────────────────────────────────────────
// Whether a round counts was settled as it FIRST ended and is parked with it (recordedRef in both
// screens): with Save Stats turned on while a practice round (played with it OFF) waits parked, the
// round comes back exactly as it was left, and records nothing — not on its return, and not when an
// Override puts it back in play and it ends again with the switch on.
describe('a parked practice round is not recorded when Save Stats is turned on', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)
  const setSaveStats = (on) => act(() => useSettings.getState().setSaveStats(on))

  it('Blitz: the practice round comes back, and the Bests are still empty', () => {
    mountApp()
    pinReadable()
    setSaveStats(false)
    press('B')
    finishBlitz(3) // ended on an internally-tracked 3, in practice mode
    expect(useProgress.getState().blitzBest).toEqual({})
    setSaveStats(true)
    reload()
    expect(statValue('Score')).toBe('3/4') // the round is back on screen
    expect(useProgress.getState().blitzBest).toEqual({})
    expect(permanent().blitzBest).toEqual({})
    tap(ctrl('Override')) // credits the revealed card → the round is back in play
    tap(ctrl('Reveal')) // …and ends a second time, with Save Stats on: still the practice round
    expect(statValue('Score')).toBe('4/5')
    expect(useProgress.getState().blitzBest).toEqual({})
    expect(permanent().blitzBest).toEqual({})
  })

  it('MoX: the practice run comes back, and the Bests are still empty', () => {
    mountApp()
    pinReadable()
    act(() => useModePrefs.getState().setAoxN('2'))
    setSaveStats(false)
    press('A')
    finishMox(2)
    expect(useProgress.getState().aoxBest).toEqual({})
    setSaveStats(true)
    reload()
    expect(statValue('Score')).toBe('2/2')
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
    // (Bare clicks, not two taps: the button reads a second TAP inside 350 ms as a double-tap.)
    act(() => fireEvent.click(ctrl('Override'))) // the completing solve → a miss: the run fails
    expect(statValue('Score')).toBe('1/2')
    act(() => fireEvent.click(ctrl('Undo'))) // …and completes again, with Save Stats on
    expect(statValue('Score')).toBe('2/2')
    expect(useProgress.getState().aoxBest).toEqual({})
    expect(permanent().aoxBest).toEqual({})
  })
})
