// @vitest-environment jsdom
//
// amnesic.dom — WHAT AMNESIC DOES TO SAVED PROGRESS (design-amnesic-close.md; store/amnesic).
//
// ★★ THE OWNER'S RULES, each a describe below:
//   1. WHILE PLAYING, AMNESIC CHANGES NOTHING. Every answer, round, and Best goes into the one saved pool
//      and syncs like any other; turning the pill never changes a number on screen (the dashed outline is
//      the one thing it changes - tests/sessionOnlyOutline).
//   2. AT THE APP'S CLOSE (every window of it closed; a reload is not a close), per preset, going by that
//      preset's value AT THE CLOSE, for what was played on it since its Amnesic was last switched on from
//      Off (or since the app opened, whichever is later):
//        Off         everything is kept;
//        Stats Only  those answers' stats are forgotten - score, accuracy, streak, best streak, solve
//                    times - and any new Bests are kept;
//        Full        those, and the Bests set in that time: the previous holders come back exactly.
//      What was played before the switch-on is never touched, and an Override of it inside the window is a
//      correction the close keeps.
//   3. LOOKUP is never affected - and nor is any setting, the mode setup, or the saved defaults.
// Every "came back exactly" is a comparison of the WHOLE value (every stat and every record, holders and
// companions), never field by field.
//
// What makes a close a close - the Web Locks, the session counter, a tab back from the back-forward cache -
// is tests/amnesicClose's; here a close is tests/helpers/pageLoad's closeApp (the opener's own forget). What
// a close does to a round on screen and to the round modes' Bests, played through the screens, is
// tests/amnesicRound.dom's; where each preset's value comes from is tests/amnesicSetting.dom's; what an
// older build on this origin does is tests/amnesic.olderBuilds'.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, fireEvent } from '@testing-library/react'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import { amnesicModeOf } from '../src/store/amnesic.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'
import { AMNESIC_MODES } from '../src/store/amnesicMode.js'
import { readSessionCounter } from '../src/store/amnesicWindow.js'
import { seedSealed } from './helpers/progressWorld.js'
import { otherWindow } from './helpers/otherWindow.js'
import { loadPage, closeApp } from './helpers/pageLoad.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  duplicatePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useJulianRange } from '../src/store/julianRange.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useLookupHistory } from '../src/store/lookupHistory.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { fileRoundResult } from '../src/store/screenPool.js'
import { newRoundId } from '../src/engine/roundId.js'
import {
  resetAppState,
  mountApp,
  openSettings,
  switchRow,
  toggleSwitch,
  switchState,
  caption,
  picker,
  pickPill,
  pickerChosen,
  pickerPills,
  expectNotInEffect,
  offers,
  tap,
  fireFullReset,
  fireResetSettings,
} from './helpers/settingsPanel.jsx'
import { statValue, readDate, correctDayName } from './helpers/modeScreen.jsx'

// ── The saved progress, and everything that is not it ─────────────────────────────────────────

const statsKey = (presetId) => presetKey(PRESET_STORE_KEYS.progress, presetId)
const BESTS = ['blitzBest', 'suddenBest', 'suddenAmBest', 'aoxBest']
// A stored state as the app's values: each record without the tag that names its values (`w`) and the
// holder ids written beside its companions (`…Of`, store/bestRecords: the doc's, for its reader), each
// mode's stats without the door's tag and write mark (`w`, `wl`) or a silo's Amnesic anchor (`a`) -
// store/progressDoc.
const recordValues = ({
  w: _w,
  scoreStreakOf: _s,
  streakScoreOf: _k,
  avgMedOf: _a,
  medAvgOf: _m,
  ...rec
}) => rec
const valuesOf = (state) => {
  const out = {}
  out.stats = Object.fromEntries(
    Object.entries(state.stats ?? {}).map(([k, { w: _w, wl: _wl, a: _a, ...v }]) => [k, v]),
  )
  for (const key of BESTS)
    out[key] = Object.fromEntries(
      Object.entries(state[key] ?? {}).map(([k, rec]) => [k, recordValues(rec)]),
    )
  return out
}
// The saved progress of a preset, as the device holds it - and as the app's store holds it.
const savedProgress = (presetId = 1) =>
  valuesOf(JSON.parse(localStorage.getItem(statsKey(presetId))).state)
const liveProgress = () => valuesOf(useProgress.getState())
// Everything the device holds that is NOT saved progress, the Amnesic value itself, or the app session's
// counter (store/amnesicClose writes it at every close): the settings with their Amnesic fields set aside,
// the mode setup, the saved defaults, the Lookup list, the registry - what the forget may never touch.
const notProgress = () =>
  JSON.stringify(
    Object.entries({ ...localStorage })
      .filter(([k]) => !k.includes(PRESET_STORE_KEYS.progress) && k !== 'cg-session-v1')
      .map(([k, v]) => {
        if (!k.startsWith(PRESET_STORE_KEYS.settings)) return [k, v]
        const { amnesic: _a, amnesicOn: _o, ...state } = JSON.parse(v).state
        return [k, JSON.stringify(state)]
      })
      .filter(([k]) => !k.startsWith('cg-sync-v1|cg-settings'))
      .sort(),
  )

// Set a preset's Amnesic value the way the ⚙ pill does: one call.
const setAmnesic = (mode, id = usePresets.getState().activeId) =>
  act(() => setPresetAmnesic(id, mode))

// PLAY, as the screens record it: ONE ANSWER AT A TIME (a mode's mirror saves after every answer - two at
// once would be a whole-slice change, which is how an Override is saved, not an answer).
const answer = (key, right, time = null) => {
  const s = useProgress.getState().stats[key]
  const streak = right ? s.streak + 1 : 0
  useProgress.getState().setModeStats(key, {
    ...s,
    played: s.played + 1,
    good: s.good + (right ? 1 : 0),
    streak,
    best: Math.max(s.best, streak),
    times: right && time !== null ? [...s.times, time] : s.times,
  })
}
const play = (n, key = 'classic') => {
  for (let i = 0; i < n; i++) answer(key, i % 4 !== 3, i % 4 !== 3 ? 1 + (i % 7) / 10 : null)
}
// ROUNDS, as the round screens file them (store/screenPool's fileRoundResult: a round's own figures on
// its Best record - a Blitz score and best streak, a MoX mean and median), one round per map scoring
// `n`, its id drawn as the screens draw one (engine/roundId: after every Reset's bound).
// (The store's whole-map setters are a seed or a copy, never a round - store/progressDoor.)
const AOX_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
function recordBests(n) {
  const id = usePresets.getState().activeId
  const filed = [
    fileRoundResult(id, 'blitzBest', '60|false', newRoundId(), { score: n, streak: n }, null),
    fileRoundResult(id, 'suddenBest', '10|false', newRoundId(), { score: n }, null),
    fileRoundResult(id, 'suddenAmBest', '10|true', newRoundId(), { score: n, streak: n }, null),
    fileRoundResult(id, 'aoxBest', AOX_KEY, newRoundId(), { avg: 10 - n / 10, med: 1.4 }, null),
  ]
  expect(filed.every(Boolean)).toBe(true)
}
// A history before the window: stats in two modes, and every kind of Best.
const recordBefore = () => {
  play(7)
  play(3, 'flash')
  recordBests(5)
}

// A RELOAD and A REAL CLOSE of the whole page (tests/helpers/pageLoad). ⚠ THE BODY IS BRACED: zustand's
// rehydrate() returns a thenable, and an act() handed one goes async and leaves its queue open - every
// later render in the file would then mount into a queue nothing flushes.
// (A store-level case has no <App/>, so it marks the browsing session open itself - what makes the next
// load a reload rather than a fresh open; a case that mounts the app gets it from the mount.)
const reloadPage = () => {
  act(() => {
    loadPage()
    openBrowsingSession()
  })
}
const closeAndReopen = () => {
  act(() => {
    closeApp()
    loadPage()
    openBrowsingSession()
  })
}

beforeEach(() => resetAppState())
afterEach(() => vi.restoreAllMocks())

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. WHILE PLAYING, AMNESIC CHANGES NOTHING
describe('while playing, Amnesic changes nothing', () => {
  it('turning the pill, in every order, moves no number and writes no byte of the progress', () => {
    recordBefore()
    const live = liveProgress()
    const bytes = localStorage.getItem(statsKey(1))
    const pairs = AMNESIC_MODES.flatMap((a) => AMNESIC_MODES.map((b) => [a, b]))
    expect(pairs).toHaveLength(9)
    for (const [a, b] of pairs) {
      setAmnesic(a)
      setAmnesic(b)
      expect(liveProgress()).toEqual(live)
      expect(localStorage.getItem(statsKey(1))).toBe(bytes)
    }
  })

  for (const mode of ['stats', 'full'])
    it(`${mode}: play goes into the one saved pool, as under Off`, () => {
      recordBefore()
      setAmnesic(mode)
      play(5)
      play(2, 'dedYear')
      recordBests(9)
      expect(liveProgress().stats.classic.played).toBe(12)
      expect(liveProgress().blitzBest['60|false'].score).toBe(9)
      expect(savedProgress()).toEqual(liveProgress())
    })

  for (const mode of ['stats', 'full'])
    it(`${mode}: a reload keeps everything - only a close is a close`, () => {
      recordBefore()
      setAmnesic(mode)
      play(5)
      recordBests(9)
      const live = liveProgress()
      reloadPage()
      reloadPage()
      expect(amnesicModeOf(1)).toBe(mode)
      expect(liveProgress()).toEqual(live)
    })

  describe('another window', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('sees play on Full as it sees any play, and its own play there is the same session’s', () => {
      recordBefore()
      const before = liveProgress()
      setAmnesic('full')
      const W = otherWindow()
      W.progress().answer('classic', true, 2.5) // that window's play…
      W.deliver()
      expect(useProgress.getState().stats.classic.played).toBe(8) // …is here at once
      play(2)
      closeAndReopen()
      expect(liveProgress()).toEqual(before) // one session: both windows' play goes at its close
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. AT THE CLOSE
describe('at the close, by the value at the close', () => {
  const run = (mode) => {
    recordBefore()
    const before = liveProgress()
    setAmnesic(mode)
    play(6)
    play(2, 'flash')
    play(3, 'dedMonth')
    recordBests(9)
    const after = liveProgress()
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe(mode) // (a setting: it stays)
    return { before, after }
  }

  it('Off keeps everything', () => {
    const { after } = run('off')
    expect(liveProgress()).toEqual(after)
    expect(savedProgress()).toEqual(after)
  })

  it('Stats Only forgets the stats - score, accuracy, streak, best streak, solve times - and keeps the new Bests', () => {
    const { before, after } = run('stats')
    const want = { ...after, stats: before.stats }
    expect(liveProgress()).toEqual(want)
    expect(savedProgress()).toEqual(want)
  })

  it('Full forgets the stats and the Bests: everything is exactly as it stood at the switch-on', () => {
    const { before } = run('full')
    expect(liveProgress()).toEqual(before)
    expect(savedProgress()).toEqual(before)
  })

  it('Full: a Best first set inside the window leaves no record at all', () => {
    setAmnesic('full')
    recordBests(4)
    closeAndReopen()
    expect(liveProgress()).toEqual(valuesOf(makeProgressDefaults()))
  })

  // ONLY THE VALUE AT THE CLOSE DECIDES; the window starts at the last switch-on from Off, and Stats Only
  // ↔ Full is no switch-on.
  for (const [path, keeps] of [
    [['stats', 'off'], 'all'],
    [['full', 'off'], 'all'],
    [['full', 'stats'], 'bests'],
    [['stats', 'full'], 'none'],
  ])
    it(`${path.join(' → ')}: the value at the close decides`, () => {
      recordBefore()
      const before = liveProgress()
      setAmnesic(path[0])
      play(4)
      recordBests(8)
      setAmnesic(path[1])
      play(2) // (still the same window, unless the value is now Off)
      const after = liveProgress()
      closeAndReopen()
      const want =
        keeps === 'all' ? after : keeps === 'bests' ? { ...after, stats: before.stats } : before
      expect(liveProgress()).toEqual(want)
    })

  it('off and on again: only what was played after the last switch-on goes', () => {
    setAmnesic('stats')
    play(3) // the first window's
    setAmnesic('off')
    play(2) // played on Off
    const kept = liveProgress()
    setAmnesic('full')
    play(4) // the window open at the close
    closeAndReopen()
    expect(liveProgress()).toEqual(kept)
  })

  it('every session is a window of its own: a close forgets that session’s play, and the next one starts again', () => {
    recordBefore()
    const before = liveProgress()
    setAmnesic('full')
    play(3)
    closeAndReopen()
    expect(liveProgress()).toEqual(before)
    play(2) // the next session, still on Full: "since the app opened"
    reloadPage()
    expect(liveProgress().stats.classic.played).toBe(9)
    closeAndReopen()
    expect(liveProgress()).toEqual(before)
    // …and a session closed on Off keeps its play, even after a window of Full in it
    play(2)
    setAmnesic('off')
    const kept = liveProgress()
    closeAndReopen()
    expect(liveProgress()).toEqual(kept)
  })

  it('is per preset: each preset is forgotten by its own value, the one you are not on as well', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    play(2) // preset 2, before its switch-on
    const kept2 = liveProgress()
    setAmnesic('full')
    play(3)
    switchPreset(1)
    play(4) // preset 1, on Off
    const kept1 = liveProgress()
    closeAndReopen() // (on preset 1: preset 2 is forgotten from its own doc)
    expect(liveProgress()).toEqual(kept1)
    expect(savedProgress(p2.id)).toEqual(kept2)
    switchPreset(p2.id)
    expect(liveProgress()).toEqual(kept2)
  })

  it('Reset Stats inside the window stands; the close forgets only what came after it', () => {
    recordBefore()
    setAmnesic('stats')
    play(3)
    useProgress.getState().setModeStats('classic', makeProgressDefaults().stats.classic) // Reset Stats
    const reset = liveProgress()
    play(2)
    closeAndReopen()
    expect(liveProgress()).toEqual(reset)
  })

  it('Full Reset inside the window stands; nothing from before it comes back', () => {
    recordBefore()
    setAmnesic('full')
    play(3)
    useProgress.getState().resetProgress() // (the progress half of Full Reset)
    play(2)
    recordBests(3)
    closeAndReopen()
    expect(liveProgress()).toEqual(valuesOf(makeProgressDefaults()))
  })

  // A DUPLICATE copies the settings - the Amnesic value with them - and none of the progress
  // (store/presetControl's duplicatePreset): it starts empty, on the original's value, and its own play
  // is forgotten by that value like any preset's.
  it('a duplicate made in the window starts empty on the original’s value, and its play goes by it', () => {
    play(2) // the original's, before the switch-on
    const kept = liveProgress()
    setAmnesic('full')
    play(3)
    const copy = duplicatePreset(1)
    expect(amnesicModeOf(copy.id)).toBe('full')
    switchPreset(copy.id)
    expect(liveProgress()).toEqual(valuesOf(makeProgressDefaults()))
    play(4)
    recordBests(6)
    switchPreset(1)
    closeAndReopen()
    expect(liveProgress()).toEqual(kept)
    expect(savedProgress(copy.id)).toEqual(valuesOf(makeProgressDefaults()))
  })

  it('a deleted preset owes nothing, and is not brought back', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    setAmnesic('full')
    play(3)
    switchPreset(1)
    deletePreset(p2.id)
    closeAndReopen()
    expect(localStorage.getItem(statsKey(p2.id))).toBeNull()
    expect(readSessionCounter()).toEqual({ n: 0, pending: [] }) // (nothing was owed)
  })

  it('never touches Lookup, a setting, the mode setup, or the saved defaults', () => {
    recordBefore()
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings: { ...useSettings.getState() },
        prefs: { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '10' },
        amnesic: 'off',
      }),
    )
    setAmnesic('full')
    play(2)
    act(() => {
      useSettings.getState().setMinY(1700) // a setting changed inside the window…
      useLookupHistory.getState().setHistory([{ id: '1999-1-1', y: 1999, m: 1, d: 1 }]) // …a lookup
    })
    const others = notProgress()
    closeAndReopen()
    expect(notProgress()).toBe(others)
    expect(useSettings.getState().minY).toBe(1700)
    expect(useLookupHistory.getState().history).toHaveLength(1)
  })

  // The session moves at a close that forgets, and only then: a close with every preset on Off owes
  // nothing and writes nothing (store/amnesicClose).
  it('moves the session at a close that forgets, and writes nothing at one that owes nothing', () => {
    closeAndReopen()
    expect(localStorage.getItem('cg-session-v1')).toBeNull()
    setAmnesic('stats')
    closeAndReopen()
    reloadPage()
    expect(readSessionCounter()).toEqual({ n: 1, pending: [] })
    setAmnesic('off')
    closeAndReopen()
    expect(readSessionCounter()).toEqual({ n: 1, pending: [] })
  })

  // ★ A FORGET THE DEVICE REFUSES (it is full): the forgotten state is already this window's, the writes
  // are held like any save, and the close is written down as OWED, so the next window to open runs it
  // again - it is idempotent - until it lands.
  it('a forget the device refuses is owed, and run again until it lands', () => {
    recordBefore()
    const before = liveProgress()
    setAmnesic('full')
    play(4)
    recordBests(9)
    const realSetItem = Storage.prototype.setItem
    let full = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full && this === window.localStorage && String(key).includes(PRESET_STORE_KEYS.progress))
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })
    act(() => closeApp())
    expect(readSessionCounter()).toEqual({ n: 1, pending: [{ presetId: 1, e: '0:1', full: true }] })
    expect(liveProgress()).toEqual(before) // this window already shows the forgotten state
    act(() => {
      loadPage() // (a page that never got its writes down: the device still holds the window's play)
    })
    expect(savedProgress().stats.classic.played).toBe(11)
    full = false
    closeAndReopen() // the next open runs the owed forget again
    expect(readSessionCounter()).toEqual({ n: 2, pending: [] })
    expect(savedProgress()).toEqual(before)
    expect(liveProgress()).toEqual(before)
  })
})

// ── A FORGET THAT CUTS THROUGH SEALED SOLVE-TIME CHUNKS ───────────────────────────────────────
// A long history of solve times is kept in sealed chunk keys beside the main one (store/progressStorage).
// The forget shortens a mode's times to what its anchor kept; the codec re-derives the chunks from that,
// as for a Reset: the chunks of the times kept are the ones that were there, and the ones sealed inside
// the window go from the device (store/progressStorage's rule e).
describe('a forget that cuts through sealed solve-time chunks', () => {
  const FAMILY = 'cg-times-v1'
  const long = (n) => ({
    played: n,
    good: n,
    streak: 3,
    best: 40,
    times: Array.from({ length: n }, (_, i) => 2 + (i % 977) / 100),
  })
  const chunkBytes = () =>
    JSON.stringify(
      Object.entries({ ...localStorage })
        .filter(([k]) => k.startsWith(FAMILY))
        .sort(),
    )

  it('puts the times back exactly, and the chunks with them', () => {
    const state = { ...makeProgressDefaults() }
    state.stats = { ...state.stats, classic: long(3000) }
    seedSealed({ put: (k, v) => localStorage.setItem(k, v) }, state)
    act(() => {
      useProgress.persist.rehydrate()
    })
    expect(useProgress.getState().stats.classic.times).toHaveLength(3000)
    const times = useProgress.getState().stats.classic.times
    const chunks = chunkBytes()
    setAmnesic('stats')
    for (let i = 0; i < 600; i++) answer('classic', true, 3 + (i % 50) / 10)
    expect(chunkBytes()).not.toBe(chunks) // more were sealed inside the window
    closeAndReopen()
    expect(useProgress.getState().stats.classic.times).toEqual(times)
    expect(useProgress.getState().stats.classic.played).toBe(3000)
    expect(chunkBytes()).toBe(chunks) // the window's chunks gone (store/progressStorage's rule e)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ── With the real <App/> mounted ──────────────────────────────────────────────────────────────

// Everything a preset needs before its Classic question can be READ and ANSWERED: a fixed numeric-ymd
// format so the date on screen is parseable, and a Gregorian-only range so plain wday() is the right
// answer. (The same lines tests/presetSwitch.dom pins for the same reason.)
const pinReadableQuestions = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
    useJulianRange.getState().applyJulianRange({ julianMinY: 1583, julianMaxY: 10000 })
  })
const ctrl = (name) => screen.getByRole('button', { name })
const pressNew = () => tap(ctrl('New'))
const answerCorrectly = () => tap(screen.getByRole('button', { name: correctDayName(readDate()) }))
function playCorrect(n) {
  for (let i = 0; i < n; i++) {
    answerCorrectly()
    if (i < n - 1) pressNew()
  }
}
const unmount = () => {
  cleanup()
  document.getElementById('root')?.remove()
}
// A REAL CLOSE with the app on screen: it goes, the opener runs the close, and the app is drawn again.
const closeAppOnScreen = () => {
  unmount()
  act(() => {
    closeApp()
    loadPage()
  })
  mountApp()
}
const strip = () => [statValue('Score'), statValue('Accuracy'), statValue('Streak')]

describe('with the app running', () => {
  afterEach(unmount)

  it('the strip never moves when the pill turns, and an answer on any value counts at once', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    const seen = strip()
    for (const mode of ['stats', 'full', 'off', 'full', 'stats']) {
      setAmnesic(mode)
      expect(strip()).toEqual(seen)
    }
    pressNew()
    answerCorrectly()
    expect(statValue('Score')).toBe('4/4')
    expect(useProgress.getState().stats.classic.played).toBe(4)
  })

  for (const mode of ['stats', 'full'])
    it(`${mode}: the close takes the window’s answers off the strip - best streak and all - before it is drawn`, () => {
      mountApp()
      pinReadableQuestions()
      pressNew()
      playCorrect(3)
      const seen = strip()
      setAmnesic(mode)
      pressNew()
      playCorrect(5)
      expect(statValue('Streak')).toBe('8/8')
      closeAppOnScreen()
      expect(strip()).toEqual(seen)
    })

  // ★ AN OVERRIDE IS PLAY IN THE WINDOW ONLY FOR A CARD PLAYED IN IT. On a card from before the switch-on
  // it is a correction: the anchor takes it too (engine/gameReducer's statsAtCard, store/progressDoor's
  // correcting), so the close keeps it - and still forgets the window's own answers.
  it('Full: an Override of a card from before the switch-on is a correction, and the close keeps it', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3) // 3/3 on Off; the third card is the one the button points at
    setAmnesic('full')
    tap(ctrl('Override')) // the third card's credit taken away: a correction, made inside the window
    expect(statValue('Score')).toBe('2/3')
    pressNew()
    playCorrect(2) // the window's own: 4/5
    expect(statValue('Score')).toBe('4/5')
    closeAppOnScreen()
    expect(strip()).toEqual(['2/3', '66.7%', '0/2'])
  })

  it('Full: an Override of a card played in the window goes with the window', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    const seen = strip()
    setAmnesic('full')
    pressNew()
    playCorrect(2)
    tap(ctrl('Override')) // the window's own last card
    expect(statValue('Score')).toBe('4/5')
    closeAppOnScreen()
    expect(strip()).toEqual(seen)
  })

  it('the "Reset Stats?" popup says the same on every value: the stats are the saved ones', () => {
    mountApp()
    pinReadableQuestions()
    const bodies = []
    for (const mode of ['off', 'stats', 'full']) {
      setAmnesic(mode)
      pressNew()
      playCorrect(1)
      tap(ctrl('Reset Stats'))
      const dialog = screen.getByRole('dialog', { name: 'Reset Stats?' })
      bodies.push(dialog.textContent)
      act(() => fireEvent.keyDown(document.body, { key: 'Escape' })) // (the dismiss)
    }
    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).toMatch(
      /Clears this mode's stats and all-time bests for the preset you are on\./,
    )
    expect(bodies[0]).not.toMatch(/Amnesic|session/)
  })

  for (const mode of ['stats', 'full'])
    it(`${mode}: Full Reset inside the window clears everything, and the close brings nothing back`, () => {
      mountApp()
      pinReadableQuestions()
      pressNew()
      playCorrect(3)
      act(() => recordBests(9))
      setAmnesic(mode)
      pressNew()
      playCorrect(2)
      openSettings('key')
      fireFullReset()
      expect(statValue('Score')).toBe('0/0')
      expect(amnesicModeOf(1)).toBe('off') // (its saved default: Full Reset puts the settings back)
      closeAppOnScreen()
      expect(statValue('Score')).toBe('0/0')
      expect(liveProgress()).toEqual(valuesOf(makeProgressDefaults()))
    })

  it('Reset Settings puts the value back on its saved default - Off - and the close then keeps the play', () => {
    mountApp()
    pinReadableQuestions()
    setAmnesic('full')
    pressNew()
    playCorrect(2)
    openSettings('key')
    fireResetSettings()
    expect(amnesicModeOf(1)).toBe('off')
    closeAppOnScreen()
    expect(statValue('Score')).toBe('2/2')
  })
})

describe('the Amnesic pill in the ⚙ panel', () => {
  afterEach(unmount)

  const openPanel = () => {
    mountApp()
    openSettings('key')
  }

  it('is one picker of exactly Off, Stats Only, and Full, directly under Save Stats', () => {
    openPanel()
    expect(pickerPills('Amnesic').map((pill) => pill.textContent)).toEqual([
      'Off',
      'Stats Only',
      'Full',
    ])
    expect(pickerChosen('Amnesic')).toEqual(['Off'])
    // "Directly below" as the DOM states it: Save Stats' row, then this picker's caption, then the
    // picker — adjacent siblings, which is the only form of that claim jsdom can make honestly (it
    // has no layout engine and cannot see order on screen).
    expect(switchRow('Save Stats').nextElementSibling).toBe(caption('Amnesic'))
    expect(caption('Amnesic').nextElementSibling).toBe(picker('Amnesic'))
  })

  it('sets the value of the preset it is on, each of the three ways', () => {
    openPanel()
    for (const [label, mode] of [
      ['Stats Only', 'stats'],
      ['Full', 'full'],
      ['Off', 'off'],
    ]) {
      pickPill('Amnesic', label)
      expect(pickerChosen('Amnesic')).toEqual([label])
      expect(amnesicModeOf(1)).toBe(mode)
    }
  })

  // ⚠ ORTHOGONAL, NOT EXCLUSIVE. Save Stats says whether a question counts, Amnesic says how much
  // of what was counted lasts past the close.
  it('is independent of Save Stats — the value is kept whatever the switch does', () => {
    openPanel()
    pickPill('Amnesic', 'Stats Only')
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), pickerChosen('Amnesic')]).toEqual(['Off', ['Stats Only']])
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), pickerChosen('Amnesic')]).toEqual(['On', ['Stats Only']])
  })

  // The owner's rule, "dimmed means not in effect, not locked": with Save Stats off nothing new is
  // counted, so the picker is NOT IN EFFECT - striped, its reason on every radio - and still changes the
  // value (which changes nothing on screen).
  it('is not in effect while Save Stats is off, and still changes the value', () => {
    openPanel()
    pickPill('Amnesic', 'Full')
    toggleSwitch('Save Stats')
    expectNotInEffect('Amnesic', 'Not in use while Save Stats is off.')
    pickPill('Amnesic', 'Off')
    expect(pickerChosen('Amnesic')).toEqual(['Off'])
    expect(amnesicModeOf(1)).toBe('off')
    toggleSwitch('Save Stats')
    expectNotInEffect('Amnesic', null)
    expect(pickerChosen('Amnesic')).toEqual(['Off'])
  })

  // ★★ IT LIGHTS THE GEAR. The gear's bar, Reset Settings' dim and Save Defaults' dim are ONE
  // expression (main.tsx's settingsAtDefaults), and the Amnesic value is one of its terms: leaving
  // it out once left Save Defaults dimmed and INERT whenever Amnesic was the only thing a player had
  // changed. Every offer that lights here really acts on the value.
  for (const label of ['Stats Only', 'Full'])
    it(`${label} lights the gear ON ITS OWN, and offers all three trio buttons with it`, () => {
      openPanel()
      const none = { gear: false, saveDefaults: false, resetSettings: false, fullReset: false }
      const all = { gear: true, saveDefaults: true, resetSettings: true, fullReset: true }
      expect(offers()).toEqual(none)
      pickPill('Amnesic', label)
      expect(offers()).toEqual(all)
      // …and back to Off clears every one of them, so the term is a comparison against the
      // preset's default rather than a latch.
      pickPill('Amnesic', 'Off')
      expect(offers()).toEqual(none)
    })

  // ⚠ The value does not ride the settings store's own write path: resetToFactory() rewrites the ⚙
  // values in one `set`, and the Amnesic value is not one of them. (The ⚙ PANEL's Reset Settings is a
  // different function, App's own, and it restores Amnesic deliberately.)
  it('the settings store’s own factory reset cannot change it', () => {
    openPanel()
    pickPill('Amnesic', 'Full')
    act(() => useSettings.getState().resetToFactory())
    expect(amnesicModeOf(1)).toBe('full')
  })
})
