// @vitest-environment jsdom
//
// amnesic.dom — A PRESET THAT DOES NOT WRITE ITS STATS DOWN, in its two kinds.
//
// ★★ THE CLAIMS THIS FILE EXISTS TO PROVE, and each is deliberately expressible in one sentence:
//   FULL        — WHILE A PRESET IS ON FULL, NOTHING WRITES ITS PERMANENT COPY. Not a byte.
//   STATS ONLY  — WHILE A PRESET IS ON STATS ONLY, THE ONLY THING WRITTEN TO ITS PERMANENT COPY IS A
//                 BEST. Its stats do not move by a byte, and a Best set in the session is there for
//                 good the moment it is set.
// Everything else here — the zero start, the discard on every change, the guest handing the phone
// over — is a consequence of those two sentences, and every case that asserts them does so as a BYTE
// COMPARISON of what is on disk rather than field by field. A field-by-field check would pass a
// re-serialisation that quietly rewrote something the case did not think to look at, which is exactly
// the failure mode: the bug this feature could have shipped is not "the numbers are wrong", it is
// "the numbers were replaced by a session's".
//
// ⚠ WHY A MOUNTED APP IS PART OF THE GATE. The store-level cases below can prove where bytes go;
// they cannot prove the thing that has already cost this app once. The five mode screens are ALWAYS
// MOUNTED, hydrate their stats ONCE at mount and mirror them back on every change, so repointing
// storage underneath them without a remount leaves the stores right and the screens a copy behind —
// and the very next answered question writes the copy behind over the copy that is live. It was
// reproduced against the real stores: a device with 500 cards ended up holding 4. Changing the
// Amnesic value repoints exactly that storage, so nothing short of a mounted app, a change, and an
// answered question can catch the regression. ★ IF SOMEONE DELETES src/main.tsx's subscription to
// the session's Amnesic values, or narrows it back from store/amnesic's activeDataId to activeId
// alone, "the session starts at zero on screen" is the case that goes red — and nothing else in the
// suite would.
//
// ⚠ THIS FILE MAY COMPOSE A STORAGE KEY, on tests/presetSwitch.dom's precedent and for the same
// kind of reason: it has to read the SAME preset's two copies — the parked permanent one and the
// session one — at the same moment, and tests/helpers/persistence's observation-based resolver can
// only ever answer for wherever the store is pointed right now. It composes them by CALLING the
// real presetKey, so it pins nothing about spelling; that is tests/presets.dom's job.
//
// What a parked ROUND does across a change is tests/amnesicRound.dom's; where each preset's value
// comes from when a page loads (a reload, a real close, an older build, another tab, a full device)
// is tests/sessionAmnesic.dom's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup, act, within } from '@testing-library/react'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  AMNESIC_CLEARS,
  activeDataId,
  activeBestsId,
  dataIdOf,
  bestsIdOf,
  keepsLookups,
  discardSessionStats,
  discardParkedStats,
} from '../src/store/amnesic.js'
import { amnesicModeOf, commitSessionAmnesic } from '../src/store/sessionAmnesic.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'
import { AMNESIC_MODES } from '../src/store/amnesicMode.js'
import { seedSealed } from './helpers/progressWorld.js'
import { loadPage, closeApp } from './helpers/pageLoad.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { useStorageHealth } from '../src/store/storageHealth.js'
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
  expectLock,
  offers,
  tap,
  fireFullReset,
  fireResetSettings,
} from './helpers/settingsPanel.jsx'
import { statValue, readDate, correctDayName } from './helpers/modeScreen.jsx'

// ── The two copies of one preset's saved progress ─────────────────────────────────────────────

const statsKey = (presetId) => presetKey(PRESET_STORE_KEYS.progress, presetId)
// THE PARKED COPY — the permanent one on the device. The whole raw string, because "nothing touched
// it" is a claim about bytes.
const parked = (presetId = 1) => localStorage.getItem(statsKey(presetId))
// The session copy, which the browser throws away when the app closes.
const session = (presetId = 1) => sessionStorage.getItem(statsKey(presetId))
// The other three stores' saved copies, as raw strings — the KEEPS half of the split, which must be
// untouched by all of this because store/amnesic only ever repoints progress.
const keptCopies = (presetId = 1) =>
  Object.fromEntries(
    ['settings', 'modePrefs', 'userDefaults'].map((id) => [
      id,
      localStorage.getItem(presetKey(PRESET_STORE_KEYS[id], presetId)),
    ]),
  )
const BESTS = ['blitzBest', 'suddenBest', 'suddenAmBest', 'aoxBest']
// The permanent copy WITH ITS BESTS TAKEN OUT, as text — what Stats Only may never change. And, as
// the stronger form of the same claim, the stats exactly as they are spelled inside the stored text.
const parkedMinusBests = (presetId = 1) => {
  const envelope = JSON.parse(parked(presetId))
  for (const key of BESTS) delete envelope.state[key]
  return JSON.stringify(envelope)
}
const parkedStatsText = (presetId = 1) => {
  const text = parked(presetId)
  const stats = JSON.stringify(JSON.parse(text).state.stats)
  expect(text).toContain(stats) // the stored text spells its stats exactly this way
  return stats
}
const parkedBests = (presetId = 1) => {
  const { state } = JSON.parse(parked(presetId))
  return Object.fromEntries(BESTS.map((key) => [key, state[key]]))
}
// Everything on the device, every key — for "not one permanent byte moved".
const device = () => JSON.stringify(Object.entries({ ...localStorage }).sort())

// Set a preset's Amnesic value the way the ⚙ pill does: one call. act() because src/main.tsx's
// subscription runs synchronously inside it and, with the app mounted, remounts the mode screens;
// the store-level describes below have no app and the boundary costs them nothing.
const setAmnesic = (mode, id = usePresets.getState().activeId) =>
  act(() => setPresetAmnesic(id, mode))

// Put real, distinguishable values in every one of the five persisted progress values, through the
// store's own setters — a payload the app never wrote would be no evidence about what it saves.
const AOX_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
const statsOf = (n) => ({
  classic: { played: n, good: n, streak: n, best: n, times: [900, 1100] },
  flash: { played: 2, good: 1, streak: 0, best: 1, times: [1500] },
})
const BLITZ_REC = (n) => ({
  score: n,
  scoreStreak: n,
  scoreRoundId: 1,
  streak: n,
  streakScore: n,
  streakRoundId: 1,
})
const bestsOf = (n) => ({
  blitzBest: { '60|false': BLITZ_REC(n) },
  suddenBest: { '10|false': { score: n, roundId: 1 } },
  suddenAmBest: { '10|true': BLITZ_REC(n) },
  aoxBest: {
    [AOX_KEY]: { avg: n, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: n, medRoundId: 1 },
  },
})
function recordStats(n) {
  const p = useProgress.getState()
  p.setModeStats('classic', statsOf(n).classic)
  p.setModeStats('flash', statsOf(n).flash)
}
function recordBests(n) {
  const p = useProgress.getState()
  const b = bestsOf(n)
  p.setBlitzBest(b.blitzBest)
  p.setSuddenBest(b.suddenBest)
  p.setSuddenAmBest(b.suddenAmBest)
  p.setAoxBest(b.aoxBest)
}
function recordEverything(n = 7) {
  recordStats(n)
  recordBests(n)
}

// Re-read the progress store from wherever it is now pointed — what a switch does, and the store-
// level stand-in for the progress half of a reload.
// ⚠ THE BODY IS BRACED, AND THAT IS NOT A STYLE CHOICE. zustand's rehydrate() returns a THENABLE,
// and React's act() given a thenable switches to ASYNC mode: it hands back a thenable of its own
// and leaves the act queue open until that is awaited. Returning it from this arrow would therefore
// poison every LATER render in the file — <App/> would mount into an act queue nothing ever flushes
// and render nothing at all, with no error anywhere. (That is not hypothetical; it cost this file
// an hour.)
const relaunch = () => {
  act(() => {
    useProgress.persist.rehydrate()
  })
}
// A RELOAD and A REAL CLOSE of the whole page (tests/helpers/pageLoad), braced for the same reason.
// ⚠ A store-level case has no <App/>, so it runs the app's boot effect itself — `boot`, the two
// calls src/main.tsx makes on every load: the browsing session is marked open (which is what makes
// the next load a RELOAD rather than a fresh open), and the values this page opened with are put on
// the session's record. A case that mounts the app gets both from the mount.
const boot = () => {
  openBrowsingSession()
  commitSessionAmnesic()
}
const reloadPage = () => {
  act(() => {
    loadPage()
    boot()
  })
}
const closeAndReopen = () => {
  act(() => {
    closeApp()
    loadPage()
    boot()
  })
}

// The five persisted progress values as the store currently holds them — the readout every "started
// at zero" / "came back exactly" claim is made against.
const liveProgress = () => {
  const s = useProgress.getState()
  return Object.fromEntries(Object.keys(makeProgressDefaults()).map((k) => [k, s[k]]))
}
const liveBests = () => Object.fromEntries(BESTS.map((key) => [key, useProgress.getState()[key]]))
const ZERO = makeProgressDefaults()
const NO_BESTS = Object.fromEntries(BESTS.map((key) => [key, {}]))

describe('Full: an amnesic preset never writes its saved progress down', () => {
  beforeEach(() => resetAppState())

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE INVARIANT, AS ONE SENTENCE AND ONE COMPARISON — of EVERY permanent key, not just one.
  it('THE INVARIANT: while a preset is on Full, not one permanent byte changes', () => {
    recordEverything(7)
    const untouched = device()
    expect(parked()).not.toBeNull() // else the comparison below would be vacuous

    setAmnesic('full')
    // Everything the app can do to saved progress, in one go: play, set a new best, and the most
    // destructive write there is.
    recordEverything(99)
    useProgress.getState().resetProgress()
    recordEverything(1234)
    relaunch()

    expect(device()).toBe(untouched)
    // …and it is not that nothing was written at all — the session copy caught every one of them.
    expect(JSON.parse(session()).state.stats.classic.played).toBe(1234)
    expect(JSON.parse(session()).state.blitzBest['60|false'].score).toBe(1234)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE RULE, both halves, and the second half is the banned one: leaving DISCARDS, it never
  // merges. A merge is the 500-cards-becomes-4 shape — two sets of numbers and a write picking the
  // wrong one — and the owner ruled it out, so the case asserts the saved copy comes back byte for
  // byte rather than merely "at least as big as it was".
  it('Full parks the saved progress and starts at zero; Off discards the session and brings it back', () => {
    recordEverything(7)
    const before = parked()
    const saved = liveProgress()

    setAmnesic('full')
    expect(liveProgress()).toEqual(ZERO) // every value, not just the score

    recordEverything(99)
    expect(useProgress.getState().stats.classic.played).toBe(99)

    setAmnesic('off')
    expect(liveProgress()).toEqual(saved)
    expect(parked()).toBe(before)
    // The session copy is gone, so going to Full again cannot resurrect it.
    expect(session()).toBeNull()
    setAmnesic('full')
    expect(liveProgress()).toEqual(ZERO)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // WHAT EACH VALUE FORGETS, KEY BY KEY — the declarative list in store/amnesic is the feature's
  // definition, so it gets asserted as a list rather than through whichever value a case wrote.
  it('AMNESIC_CLEARS: Stats Only names the stats and nothing else; Full names every saved value', () => {
    expect(AMNESIC_CLEARS.stats).toEqual(['stats'])
    expect([...AMNESIC_CLEARS.full].sort()).toEqual(Object.keys(ZERO).sort())
  })
  for (const mode of ['stats', 'full'])
    it(`every value ${mode} clears starts the session at its factory value, and every other keeps its saved one`, () => {
      recordEverything(7)
      const saved = liveProgress()
      // Guard against a stale entry: each key must actually be carrying something to forget.
      for (const key of Object.keys(ZERO)) expect(saved[key]).not.toEqual(ZERO[key])

      setAmnesic(mode)
      for (const key of Object.keys(ZERO))
        expect(useProgress.getState()[key]).toEqual(
          AMNESIC_CLEARS[mode].includes(key) ? ZERO[key] : saved[key],
        )
    })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // WHAT IT KEEPS. The split is STATS, NOT CONFIGURATION, and it holds by construction rather than
  // by an exclusion list — store/amnesic only ever repoints the progress store — so this is the
  // case that would catch that construction being widened by accident.
  for (const mode of ['stats', 'full'])
    it(`${mode}: keeps every setting, the mode setup, and the saved defaults — and keeps writing them down`, () => {
      useSettings.getState().setUseSystem(false)
      useSettings.getState().setManualTheme('nebula')
      useModePrefs.getState().setBlitzSec(45)
      useUserDefaults.getState().saveDefaults({
        settings: { ...useSettings.getState() },
        prefs: { flashMs: 1500, blitzSec: 45, blitzQSec: 10, aoxN: '12' },
        amnesic: 'off',
      })
      const kept = keptCopies()

      setAmnesic(mode)
      // Still on screen…
      expect(useSettings.getState().manualTheme).toBe('nebula')
      expect(useModePrefs.getState().blitzSec).toBe(45)
      expect(useUserDefaults.getState().saved.prefs.aoxN).toBe('12')
      // …and still on the DEVICE, unchanged by the change of value.
      expect(keptCopies()).toEqual(kept)

      // A setting changed DURING an amnesic session is still permanent: amnesia is about stats.
      useSettings.getState().setManualTheme('midnight')
      expect(JSON.parse(keptCopies().settings).state.manualTheme).toBe('midnight')
      // The value itself is the session's, and stays until somebody changes it or the app is closed.
      expect(amnesicModeOf(1)).toBe(mode)
    })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // CLOSING THE APP. Nothing in the app detects a close; the browser ends the session and the copy
  // goes with it. This is that, in the only shape jsdom can state it honestly — the session area is
  // emptied, which is exactly what the browser does — and what matters is what is left behind.
  it('closing the app takes the session with it and leaves the parked copy untouched', () => {
    recordEverything(7)
    const before = device()
    setAmnesic('full')
    recordEverything(99)
    expect(session()).not.toBeNull()

    closeAndReopen()

    // The preset has no saved default, so the next open finds it on Off — with what was saved.
    expect(amnesicModeOf(1)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(7)
    expect(device()).toBe(before)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A RELOAD IS NOT A CLOSE, which is the honest half of the promise and the half the How-to-Play
  // section spells out: the browser decides when a session ends, and a refresh does not end one.
  it('a reload keeps the session going — only a close ends it', () => {
    boot()
    setAmnesic('full')
    recordEverything(42)
    reloadPage()
    expect(amnesicModeOf(1)).toBe('full')
    expect(useProgress.getState().stats.classic.played).toBe(42)
    expect(useProgress.getState().blitzBest['60|false'].score).toBe(42)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it('is per preset — and changing one you are not on touches nothing you can see', () => {
    recordEverything(7)
    const p2 = createPreset()
    setAmnesic('full', p2.id)

    // Readable for every preset, not just the open one — what a preset list speaks.
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['off', 'full'])
    // Nothing moved on the preset that is actually open.
    expect(useProgress.getState().stats.classic.played).toBe(7)

    act(() => switchPreset(p2.id))
    recordEverything(3)
    expect(parked(p2.id)).toBeNull() // preset 2 never wrote a permanent copy at all
    expect(JSON.parse(session(p2.id)).state.stats.classic.played).toBe(3)

    // Leaving and coming back is NOT a change: you never closed the app, so the session survives.
    act(() => switchPreset(1))
    expect(useProgress.getState().stats.classic.played).toBe(7)
    act(() => switchPreset(p2.id))
    expect(useProgress.getState().stats.classic.played).toBe(3)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Deleting a preset removes exactly its keys — which means BOTH areas, or a deleted preset
  // leaves a session copy behind under a namespace nothing owns. Its Amnesic value goes too.
  it('deleting a preset takes its session copy and its Amnesic value with it', () => {
    const p2 = createPreset()
    setAmnesic('full', p2.id)
    act(() => switchPreset(p2.id))
    recordEverything(5)
    expect(session(p2.id)).not.toBeNull()

    act(() => switchPreset(1))
    act(() => deletePreset(p2.id))
    expect(session(p2.id)).toBeNull()
    expect(amnesicModeOf(p2.id)).toBe('off')
    expect(sessionStorage.getItem('cg-amnesic-v1')).not.toContain(`"${p2.id}"`)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A browser that allows localStorage but refuses sessionStorage. The two areas fail
  // independently, so the amnesic branch must degrade to memory-only for the session rather than
  // fall back to the permanent copy — which would be the one failure mode the whole feature exists
  // to prevent, reached by a browser setting.
  for (const mode of ['stats', 'full'])
    it(`${mode}: survives a sessionStorage that refuses, without the stats ever reaching the device`, () => {
      recordEverything(7)
      const before = parkedMinusBests()
      const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError')
        },
      })
      try {
        setAmnesic(mode)
        recordStats(99)
        expect(useProgress.getState().stats.classic.played).toBe(99) // in memory, for the session
        expect(parkedMinusBests()).toBe(before) // and never on the device
      } finally {
        if (own) Object.defineProperty(window, 'sessionStorage', own)
        else delete window.sessionStorage
      }
      // Off again still lands on the parked copy.
      setAmnesic('off')
      expect(useProgress.getState().stats.classic.played).toBe(7)
    })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The remount trigger, as the value src/main.tsx compares. Stated here rather than only through
  // the mounted app because it is the thing a future edit is most likely to narrow back.
  it('activeDataId is different for every preset and for every one of the three values', () => {
    const ids = new Set()
    for (const mode of AMNESIC_MODES) {
      setAmnesic(mode)
      ids.add(activeDataId())
      expect(activeDataId()).toBe(dataIdOf(1, mode))
    }
    expect(ids.size).toBe(3)

    // …and does NOT move for a write that changes no data: creating a preset, or changing ANOTHER
    // preset's value, must never throw away the run the player is in.
    const here = activeDataId()
    const p2 = createPreset()
    expect(activeDataId()).toBe(here)
    setAmnesic('stats', p2.id)
    expect(activeDataId()).toBe(here)
    act(() => switchPreset(p2.id))
    expect(activeDataId()).toBe(dataIdOf(p2.id, 'stats'))
  })

  // The BESTS a round is parked against: one permanent copy shared by Off and Stats Only, and the
  // session's under Full (tests/amnesicRound.dom is what that rule is for).
  it('activeBestsId: Off and Stats Only share the permanent bests; Full has the session’s', () => {
    expect(bestsIdOf(1, 'off')).toBe(bestsIdOf(1, 'stats'))
    expect(bestsIdOf(1, 'full')).not.toBe(bestsIdOf(1, 'off'))
    expect(bestsIdOf(2, 'off')).not.toBe(bestsIdOf(1, 'off'))
    for (const mode of AMNESIC_MODES) {
      setAmnesic(mode)
      expect(activeBestsId()).toBe(bestsIdOf(1, mode))
    }
  })

  it('a lookup is kept under Off and Stats Only, and is the session’s under Full', () => {
    expect(AMNESIC_MODES.map(keepsLookups)).toEqual([true, true, false])
  })

  // A corrupt parked payload gives the session NOTHING rather than being laundered into it — an
  // envelope that cannot be parsed cannot be trusted to say which numbers are whose.
  for (const mode of ['stats', 'full'])
    it(`${mode}: a corrupt parked payload gives a fresh session rather than a guess — and is left alone`, () => {
      recordEverything(7)
      const corrupt = '{"state":{"stats":' // a truncated write
      localStorage.setItem(statsKey(1), corrupt)
      setAmnesic(mode)
      expect(liveProgress()).toEqual(ZERO)
      // Play on it, set a best: the unreadable permanent copy is not overwritten with either.
      recordEverything(5)
      expect(parked()).toBe(corrupt)
    })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// STATS ONLY — "I can mess around and not worry about my score but I can still store a new best."
describe('Stats Only: the stats are the session’s, the Bests are the permanent ones', () => {
  beforeEach(() => resetAppState())

  it('starts every stat at zero and shows the Bests you already had', () => {
    recordEverything(7)
    const untouched = device()
    setAmnesic('stats')
    expect(useProgress.getState().stats).toEqual(ZERO.stats)
    expect(liveBests()).toEqual(bestsOf(7))
    expect(device()).toBe(untouched) // reading them moved nothing
  })

  // ★★ THE INVARIANT, as a byte comparison: every permanent key but the progress key is identical,
  // and the progress key is identical once its four Best maps are set aside — including how its
  // stats are SPELLED in the stored text.
  it('THE INVARIANT: a whole session of play and new bests changes the permanent Bests and NOTHING else', () => {
    recordEverything(7)
    const others = () =>
      JSON.stringify(
        Object.entries({ ...localStorage })
          .filter(([k]) => k !== statsKey(1))
          .sort(),
      )
    const [otherKeys, minusBests, statsText] = [others(), parkedMinusBests(), parkedStatsText()]

    setAmnesic('stats')
    recordStats(99) // the session's play
    recordBests(50) // every Best beaten
    recordStats(100)
    useProgress.getState().setModeStats('classic', ZERO.stats.classic) // Reset Stats, in the session
    recordStats(3)
    relaunch()
    recordBests(60)

    expect(others()).toBe(otherKeys)
    expect(parkedMinusBests()).toBe(minusBests)
    expect(parkedStatsText()).toBe(statsText)
    // …and the Bests are the session's newest, on the device already.
    expect(parkedBests()).toEqual(bestsOf(60))
    // The session copy holds the stats and NO Best: there is one copy of the Bests, the permanent one.
    const kept = JSON.parse(session()).state
    expect(kept.stats.classic.played).toBe(3)
    for (const key of BESTS) expect(kept).not.toHaveProperty(key)
  })

  it('a save that moves no Best does not write the permanent copy at all', () => {
    recordEverything(7)
    setAmnesic('stats')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      recordStats(8)
      recordStats(9)
      const toDevice = setItem.mock.contexts.filter((area) => area === window.localStorage)
      expect(toDevice).toHaveLength(0)
    } finally {
      setItem.mockRestore()
    }
  })

  // ★ BESTS ARE PERMANENT — across everything that ends or interrupts a session.
  it('a Best set in the session survives a reload', () => {
    boot()
    recordEverything(7)
    setAmnesic('stats')
    recordStats(20)
    recordBests(50)
    reloadPage()
    expect(amnesicModeOf(1)).toBe('stats')
    expect(liveBests()).toEqual(bestsOf(50))
    expect(useProgress.getState().stats.classic.played).toBe(20) // a reload keeps the session too
  })

  it('a Best set in the session survives a real close — and the session’s stats do not', () => {
    recordEverything(7)
    const stats = parkedStatsText()
    setAmnesic('stats')
    recordStats(20)
    recordBests(50)
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off') // no saved default: back to Off
    expect(liveBests()).toEqual(bestsOf(50)) // kept for good
    expect(useProgress.getState().stats.classic.played).toBe(7) // your own, exactly as they were
    expect(parkedStatsText()).toBe(stats)
    expect(session()).toBeNull()
  })

  it('a Best set in the session survives a preset switch and back', () => {
    recordEverything(7)
    const p2 = createPreset()
    setAmnesic('stats')
    recordStats(20)
    recordBests(50)
    act(() => switchPreset(p2.id))
    expect(liveProgress()).toEqual(ZERO) // preset 2 is its own preset
    act(() => switchPreset(1))
    expect(liveBests()).toEqual(bestsOf(50))
    expect(useProgress.getState().stats.classic.played).toBe(20) // and the session is still going
  })

  it('a Best set in the session survives a guest’s interlude on Full, and nothing of the guest’s joins it', () => {
    recordEverything(7)
    setAmnesic('stats')
    recordBests(50)
    const before = device()
    setAmnesic('full') // the guest
    expect(liveBests()).toEqual(NO_BESTS) // sees none of them
    recordEverything(999) // …and beats every one
    expect(device()).toBe(before)
    setAmnesic('stats')
    expect(liveBests()).toEqual(bestsOf(50))
    expect(device()).toBe(before)
  })

  it('a Best taken back in the session (an Override, a Reset of a record) is taken back for good too', () => {
    recordEverything(7)
    setAmnesic('stats')
    recordBests(50)
    useProgress.getState().setBlitzBest({}) // the round that set it was overridden away
    expect(parkedBests().blitzBest).toEqual({})
    expect(parkedBests().aoxBest).toEqual(bestsOf(50).aoxBest)
  })

  it('a preset with no saved copy yet: the first Best of a Stats Only session creates one holding only Bests', () => {
    localStorage.removeItem(statsKey(1)) // a preset nothing has ever been saved for
    setAmnesic('stats')
    recordStats(5)
    expect(parked()).toBeNull() // playing wrote nothing permanent
    recordBests(9)
    expect(Object.keys(JSON.parse(parked()).state).sort()).toEqual([...BESTS].sort())
    setAmnesic('off')
    expect(liveProgress()).toEqual({ ...ZERO, ...bestsOf(9) })
  })

  // ★ NO PATH CAN LOSE A PERMANENT BEST. The store's Best maps are written back only when they are
  // known to have started as the permanent copy's own.
  it('a session copy that will not load starts the session again — and the permanent Bests are still there', () => {
    recordEverything(7)
    setAmnesic('stats')
    recordStats(20)
    sessionStorage.setItem(statsKey(1), '{"state":') // the session copy, truncated
    relaunch()
    expect(liveBests()).toEqual(bestsOf(7)) // not blanked by the failed load…
    expect(useProgress.getState().stats).toEqual(ZERO.stats)
    useProgress.getState().setSuddenBest({ '10|false': { score: 8, roundId: 2 } })
    // …so the next Best is added to the records, never written over them.
    expect(parkedBests()).toEqual({
      ...bestsOf(7),
      suddenBest: { '10|false': { score: 8, roundId: 2 } },
    })
  })

  it('a permanent copy that turns unreadable mid-session is never written over', () => {
    recordEverything(7)
    setAmnesic('stats')
    const corrupt = '{"state":{"stats":'
    localStorage.setItem(statsKey(1), corrupt) // another page's write, cut short
    recordBests(50)
    recordBests(51)
    expect(parked()).toBe(corrupt)
  })

  it('another page’s newer permanent stats are kept when a Best is saved', () => {
    recordEverything(7)
    setAmnesic('stats')
    // Another tab on this origin, on Off, plays on — and saves 500 cards to the same permanent key.
    const theirs = JSON.parse(parked())
    theirs.state.stats.classic = { played: 500, good: 400, streak: 2, best: 30, times: [1, 2, 3] }
    localStorage.setItem(statsKey(1), JSON.stringify(theirs))
    recordBests(50)
    expect(JSON.parse(parked()).state.stats.classic.played).toBe(500)
    expect(parkedBests()).toEqual(bestsOf(50))
  })

  // A full device: the Best is held for the permanent place it was for (store/storageHealth) — read
  // back from there, and saved when room appears.
  it('a Best the device refuses is held for the permanent copy, and saved when there is room', () => {
    recordEverything(7)
    setAmnesic('stats')
    const realSetItem = Storage.prototype.setItem
    let full = true
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full && this === window.localStorage)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })
    try {
      recordBests(50)
      expect(useStorageHealth.getState().unsaved).toBe(true)
      expect(parkedBests()).toEqual(bestsOf(7)) // not on the device yet…
      setAmnesic('off')
      expect(liveBests()).toEqual(bestsOf(50)) // …but it is what the permanent copy holds, to this page
      full = false
      useProgress.getState().setModeStats('flash', statsOf(1).flash) // any save that fits
      expect(parkedBests()).toEqual(bestsOf(50))
      expect(useStorageHealth.getState().unsaved).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SIX CHANGES. One rule covers them all — the session's copy is discarded, then everything is
// read again — and this is that rule checked pair by pair, on what is on screen (the store) and on
// what is on the device.
// ★ THE PERMANENT COPY HAS OTHER WRITERS. Another tab on Off (the live site beside the staging
// one: two tabs of one origin) saves the WHOLE copy on every answer, from the Best maps it loaded.
// What this page does about a record of its own that the copy no longer agrees with:
//   • the copy holds a DIFFERENT record for that set-up → the better of the two is kept, by the
//     mode's own ordering, whoever saved last;
//   • the copy holds NO record there → it was reset (there, by a Full Reset there, by the preset
//     being deleted there), and it is not brought back.
describe('Stats Only: this page’s Bests and another tab’s saves of the permanent copy', () => {
  const KEY = 'cg-progress-v1'
  const REC = (score) => ({
    score,
    scoreStreak: score,
    scoreRoundId: score,
    streak: score,
    streakScore: score,
    streakRoundId: score,
  })
  const onDevice = (key = KEY) => JSON.parse(localStorage.getItem(key)).state
  const answer = (n) =>
    useProgress.getState().setModeStats('classic', { ...ZERO.stats.classic, played: n, good: n })
  // What another tab's save looks like from here: the text is on the device, and the browser says so.
  const otherTab = (key, text) => {
    if (text === null) localStorage.removeItem(key)
    else localStorage.setItem(key, text)
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: text, storageArea: localStorage }),
    )
  }
  // The other tab saves: the copy AS IT LOADED IT (`loaded`), with one more answer of its own and
  // whatever it did to the Bests.
  const otherTabSaves = (loaded, bests = {}) => {
    const copy = JSON.parse(loaded)
    copy.state.stats.classic.played += 1
    copy.state.blitzBest = { ...copy.state.blitzBest, ...bests }
    otherTab(KEY, JSON.stringify(copy))
    return copy.state.stats
  }
  let loaded
  beforeEach(() => {
    resetAppState()
    recordEverything(7)
    useProgress.getState().setBlitzBest({ old: REC(4) })
    loaded = parked() // …what both tabs loaded
    setAmnesic('stats')
    // This page's Bests: one for a set-up that had none, and a better one where a record stood.
    useProgress.getState().setBlitzBest((b) => ({ ...b, mine: REC(9), old: REC(8) }))
    expect(onDevice().blitzBest).toEqual({ old: REC(8), mine: REC(9) })
  })

  it('a save that never knew of a better record puts the older one back — and this page’s next answer keeps the better', () => {
    const theirStats = otherTabSaves(loaded)
    expect(onDevice().blitzBest.old).toEqual(REC(4)) // put back…
    answer(1) // …until this page next saves anything at all
    expect(onDevice().blitzBest.old).toEqual(REC(8))
    expect(onDevice().stats).toEqual(theirStats) // the other tab's answer is untouched
  })

  it('the other tab’s own new Best is kept beside it', () => {
    otherTabSaves(loaded, { theirs: REC(6) })
    answer(1)
    expect(onDevice().blitzBest).toMatchObject({ old: REC(8), theirs: REC(6) })
  })

  // "Theirs stands" used to be the rule whenever the copy held anything but what this page loaded:
  // a worse record saved later replaced this page's better one for good at its next reload.
  it('a WORSE record the other tab saved later does not replace this page’s — the better is kept', () => {
    otherTabSaves(loaded, { old: REC(6) })
    answer(1)
    expect(onDevice().blitzBest.old).toEqual(REC(8))
  })

  it('…field by field: each of the two records keeps what it is better at', () => {
    // The other tab's record is an OLDER BUILD's — no companions — so the field it wins has none.
    otherTabSaves(loaded, { old: { score: 12, streak: 5, scoreRoundId: 77, streakRoundId: 77 } })
    answer(1)
    expect(onDevice().blitzBest.old).toEqual({
      score: 12,
      scoreStreak: null,
      scoreRoundId: 77,
      streak: 8,
      streakScore: 8,
      streakRoundId: 8,
    })
  })

  // ★ ROUND 26 (Q10, review finding F5): A COMPANION MOVED BY AN OVERRIDE, AND A STALE SAVE IN
  // BETWEEN. This page's record for a round changes only its companion (an Override after the round
  // ended raised that round's score; its Best Streak did not move), then another tab saves the copy
  // it loaded BEFORE that — the old companion is back on the device, under the same holder and the
  // same streak. This page's next save must put its own back: the two records are the same round
  // seen twice, and this page's is the later sighting.
  it('★ a companion this page moved is not lost to a stale save of the same round', () => {
    const before = localStorage.getItem(KEY) // a copy holding old: REC(8), as a second tab loads it
    useProgress.getState().setBlitzBest((b) => ({ ...b, old: { ...REC(8), streakScore: 9 } }))
    expect(onDevice().blitzBest.old.streakScore).toBe(9)
    otherTab(KEY, before) // the other tab saves what it loaded
    expect(onDevice().blitzBest.old.streakScore).toBe(8)
    answer(1)
    expect(onDevice().blitzBest.old).toEqual({ ...REC(8), streakScore: 9 })
  })
  it('★ …and the same for MoX: a run’s companion stat this page moved survives a stale save', () => {
    // Run 5 holds Best Mean; run 6 holds Best Median. An Override moves run 5's median, not its mean.
    const RUN = { avg: 3.5, avgMed: 3.4, avgRoundId: 5, med: 3, medAvg: 3.6, medRoundId: 6 }
    useProgress.getState().setAoxBest({ k: RUN })
    const before = localStorage.getItem(KEY)
    useProgress.getState().setAoxBest({ k: { ...RUN, avgMed: 3.3 } })
    otherTab(KEY, before)
    answer(1)
    expect(onDevice().aoxBest.k).toEqual({ ...RUN, avgMed: 3.3 })
  })

  it('a BETTER record the other tab saved stands — until this page beats it again', () => {
    otherTabSaves(loaded, { old: REC(11) })
    answer(1)
    expect(onDevice().blitzBest.old).toEqual(REC(11))
    useProgress.getState().setBlitzBest((b) => ({ ...b, old: REC(12) }))
    expect(onDevice().blitzBest.old).toEqual(REC(12)) // and now this page's is
  })

  it('each Best map by its own ordering: a MoX record is better when it is FASTER', () => {
    const RUN = (t, id) => ({
      avg: t,
      avgMed: t,
      avgRoundId: id,
      med: t,
      medAvg: t,
      medRoundId: id,
    })
    useProgress.getState().setAoxBest({ k: RUN(3.5, 1) })
    const mine = localStorage.getItem(KEY)
    const slower = JSON.parse(mine)
    slower.state.aoxBest.k = RUN(4.25, 2)
    otherTab(KEY, JSON.stringify(slower))
    answer(1)
    expect(onDevice().aoxBest.k).toEqual(RUN(3.5, 1))
    const quicker = JSON.parse(mine)
    quicker.state.aoxBest.k = RUN(2.75, 3)
    otherTab(KEY, JSON.stringify(quicker))
    answer(2)
    expect(onDevice().aoxBest.k).toEqual(RUN(2.75, 3))
  })

  it('a record the copy cannot be read as is left exactly as it is', () => {
    otherTabSaves(loaded, { old: 'not a record' })
    answer(1)
    expect(onDevice().blitzBest.old).toBe('not a record')
  })

  // ── A record that is GONE was reset: it is not brought back ─────────────────────────────────
  it('a Best another tab RESET is not brought back by this page’s next answer', () => {
    const theirs = JSON.parse(localStorage.getItem(KEY)) // it loaded the copy with this page's Bests
    delete theirs.state.blitzBest.mine
    otherTab(KEY, JSON.stringify(theirs)) // …and the player reset that one there
    answer(1)
    expect(Object.keys(onDevice().blitzBest)).toEqual(['old'])
    // …nor does it come back over a lower record earned there afterwards.
    theirs.state.blitzBest.mine = REC(2)
    otherTab(KEY, JSON.stringify(theirs))
    answer(2)
    expect(onDevice().blitzBest.mine).toEqual(REC(2))
  })

  it('…until this page sets a new one, which is saved like any other', () => {
    const theirs = JSON.parse(localStorage.getItem(KEY))
    delete theirs.state.blitzBest.mine
    otherTab(KEY, JSON.stringify(theirs))
    answer(1)
    useProgress.getState().setBlitzBest((b) => ({ ...b, mine: REC(10) }))
    expect(onDevice().blitzBest.mine).toEqual(REC(10))
  })

  it('a Full Reset in another tab is not undone: the main key is not created again', () => {
    otherTab(KEY, null)
    answer(1)
    answer(2)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('a preset another tab DELETED gets no key back — not even for a Best set this minute', () => {
    setAmnesic('off')
    const two = createPreset('two')
    switchPreset(two.id)
    const KEY2 = `${KEY}~p${two.id}`
    setAmnesic('stats')
    useProgress.getState().setBlitzBest({ mine: REC(9) })
    expect(onDevice(KEY2).blitzBest).toEqual({ mine: REC(9) })
    // The other tab deletes the preset: its keys go, and the registry no longer lists it.
    const registry = JSON.parse(localStorage.getItem('cg-presets-v1'))
    registry.state.presets = registry.state.presets.filter((preset) => preset.id !== two.id)
    registry.state.activeId = 1
    otherTab(KEY2, null)
    otherTab('cg-presets-v1', JSON.stringify(registry))
    answer(1)
    expect(localStorage.getItem(KEY2)).toBeNull()
    useProgress.getState().setBlitzBest((b) => ({ ...b, mine: REC(10), fresh: REC(3) }))
    expect(localStorage.getItem(KEY2)).toBeNull()
  })

  it('a Best this page took back stays taken back', () => {
    useProgress.getState().setBlitzBest(({ mine: _gone, ...rest }) => rest) // an Override undid it
    expect(Object.keys(onDevice().blitzBest)).toEqual(['old'])
    otherTabSaves(loaded)
    answer(1)
    expect(Object.keys(onDevice().blitzBest)).toEqual(['old'])
  })

  it('with nobody else writing, an answer still costs the permanent copy nothing', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    answer(1)
    answer(2)
    const permanent = writes.mock.calls.filter(
      ([key], i) => key === KEY && writes.mock.contexts[i] === localStorage,
    )
    expect(permanent).toHaveLength(0)
    writes.mockRestore()
  })
})

describe('changing the value mid-session: all six ordered pairs', () => {
  beforeEach(() => resetAppState())

  const pairs = AMNESIC_MODES.flatMap((from) =>
    AMNESIC_MODES.filter((to) => to !== from).map((to) => [from, to]),
  )
  it('there are six', () => expect(pairs).toHaveLength(6))

  for (const [from, to] of pairs)
    it(`${from} → ${to}`, () => {
      // You, with saved progress of 7s.
      recordEverything(7)
      setAmnesic(from)
      // A session on `from`: play, and beat every Best.
      recordStats(99)
      recordBests(50)
      // What that left PERMANENTLY, by what each value keeps where:
      const permanent = {
        ...ZERO,
        stats: { ...ZERO.stats, ...statsOf(from === 'off' ? 99 : 7) },
        ...bestsOf(from === 'full' ? 7 : 50),
      }
      expect(JSON.parse(parked()).state).toEqual(permanent)
      const before = device()
      const statsBefore = parkedStatsText()

      setAmnesic(to)

      // 1. THE CHANGE ITSELF WRITES NOTHING PERMANENT — nothing is carried across, ever.
      expect(device()).toBe(before)
      // 2. THE SESSION COPY IS GONE, whichever way it went.
      expect(session()).toBeNull()
      // 3. WHAT IS ON SCREEN: the saved progress on Off; a zero start for everything the new value
      //    keeps in the session, and the permanent value for everything it does not.
      expect(liveProgress()).toEqual(
        to === 'off'
          ? permanent
          : to === 'stats'
            ? { ...ZERO, ...bestsOf(from === 'full' ? 7 : 50) }
            : ZERO,
      )
      // 4. AND BACK TO OFF FROM THERE, after more play in the new session: exactly what was
      //    permanent — no session is ever merged in.
      if (to === 'off') return
      recordStats(1234)
      setAmnesic('off')
      expect(liveProgress().stats).toEqual(permanent.stats)
      expect(parkedStatsText()).toBe(statsBefore)
    })

  it('the value you are already on changes nothing and discards nothing', () => {
    setAmnesic('stats')
    recordStats(20)
    expect(setPresetAmnesic(1, 'stats')).toBe(false)
    expect(useProgress.getState().stats.classic.played).toBe(20)
    expect(setPresetAmnesic(99, 'full')).toBe(false) // no such preset
  })
})

// ── With the real <App/> mounted ──────────────────────────────────────────────────────────────

// Everything a preset needs before its Classic question can be READ and ANSWERED: a fixed
// numeric-ymd format so the date on screen is parseable, and a Gregorian-only range so plain wday()
// is the right answer. (The same three lines tests/presetSwitch.dom pins for the same reason; they
// are per-preset setup, so each file states them where its own presets are stood up.)
const pinReadableQuestions = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
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

describe('changing the Amnesic value with the app running', () => {
  beforeEach(() => resetAppState())
  afterEach(unmount)

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE CASE THIS FILE EXISTS FOR. Without the remount the strip would still read 3/3 after the
  // change — the store would be right and the screen a copy behind — and the next answered question
  // would write 4 into the session while the player watched their real total tick up.
  for (const mode of ['stats', 'full'])
    it(`${mode}: answering straight after the change writes to the session only`, () => {
      mountApp()
      pinReadableQuestions()
      pressNew()
      playCorrect(3)
      expect(statValue('Score')).toBe('3/3')
      const before = device()

      setAmnesic(mode)
      pressNew()
      expect(statValue('Score')).toBe('0/0') // the screen moved, not just the store

      answerCorrectly()
      expect(statValue('Score')).toBe('1/1')
      expect(JSON.parse(session()).state.stats.classic.played).toBe(1)
      // The permanent copy was not merely still correct — it was never rewritten. (Classic sets no
      // Best, so under Stats Only too not one byte may move.)
      expect(device()).toBe(before)
    })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE WHOLE CASUAL STRIP IS THE SESSION'S UNDER STATS ONLY — the best-streak figure included
  // (the second number of Streak). It is a stat, not one of the round modes' Bests.
  it('Stats Only: the casual strip starts from zero, best streak included, and is gone on a real close', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    expect(statValue('Streak')).toBe('3/3')
    const before = device()

    setAmnesic('stats')
    pressNew()
    expect([statValue('Score'), statValue('Accuracy'), statValue('Streak')]).toEqual([
      '0/0',
      '—',
      '0/0',
    ])
    playCorrect(5)
    expect(statValue('Streak')).toBe('5/5') // a longer streak than the saved best of 3…
    expect(device()).toBe(before) // …and it is not saved

    unmount()
    closeAndReopen()
    mountApp()
    pressNew()
    expect(statValue('Score')).toBe('3/3')
    expect(statValue('Streak')).toBe('3/3') // the saved best streak, never the session's 5
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The six changes again, on the SCREEN: what the strip shows the moment after, and that the next
  // answer lands in the right copy.
  for (const from of AMNESIC_MODES)
    for (const to of AMNESIC_MODES.filter((mode) => mode !== from))
      it(`${from} → ${to}: the strip, and the answer after it`, () => {
        mountApp()
        pinReadableQuestions()
        pressNew()
        playCorrect(3) // yours: 3/3, saved
        if (from !== 'off') {
          setAmnesic(from)
          pressNew()
          playCorrect(2) // the session's: 2/2
          expect(statValue('Score')).toBe('2/2')
        }
        const before = device()

        setAmnesic(to)
        pressNew()
        expect(statValue('Score')).toBe(to === 'off' ? '3/3' : '0/0') // never 5/5, never the old 2/2
        answerCorrectly()
        expect(statValue('Score')).toBe(to === 'off' ? '4/4' : '1/1')
        if (to !== 'off') expect(device()).toBe(before)
        else expect(JSON.parse(parked()).state.stats.classic.played).toBe(4)
      })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★ FULL RESET CLEARS THE PARKED COPY TOO, and this case exists because the opposite shipped
  // first and the owner caught it: "doesn't full reset reset everything that amnesic does and
  // more?" It does. Leaving the parked stats alone made the wipe RESURRECTABLE — Full Reset, then
  // go back to Off, and the destroyed stats came back. The invariant is about CONTAMINATION (a
  // session's numbers overwriting the real ones); an erase cannot contaminate, so a deliberate
  // destructive command sits outside it. See store/amnesic's discardParkedStats.
  for (const mode of ['stats', 'full'])
    it(`★ Full Reset inside a preset on ${mode} clears the PARKED copy too — no resurrection`, () => {
      mountApp()
      pinReadableQuestions()
      pressNew()
      playCorrect(3)
      act(() => recordBests(9))
      expect(parked()).not.toBe(null)

      setAmnesic(mode)
      pressNew()
      playCorrect(2)
      openSettings('key')
      fireFullReset()

      // The session is blank, as on any preset…
      expect(statValue('Score')).toBe('0/0')
      expect(liveBests()).toEqual(NO_BESTS)
      // …and going back to Off does NOT bring the old numbers back, which is the whole point.
      // (This preset's saved default is Off, so Full Reset — which restores the saved Amnesic value
      // with the rest of the settings — has already put it back there, and wiped the one copy.)
      expect(amnesicModeOf(1)).toBe('off')
      setAmnesic('off')
      expect(statValue('Score')).toBe('0/0')
      expect(liveBests()).toEqual(NO_BESTS)
      expect(JSON.parse(parked()).state).toEqual(ZERO)
    })

  // …and in a preset SAVED as amnesic, Full Reset leaves it amnesic — so the permanent copy is the
  // one BEHIND the session, and it has to go too (discardParkedStats).
  for (const mode of ['stats', 'full'])
    it(`★ Full Reset in a preset whose saved default is ${mode} removes the permanent copy behind the session`, () => {
      mountApp()
      pinReadableQuestions()
      pressNew()
      playCorrect(3)
      act(() => recordBests(9))
      setAmnesic(mode)
      act(() =>
        useUserDefaults.getState().saveDefaults({
          settings: { ...useSettings.getState() },
          prefs: { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '10' },
          amnesic: mode,
        }),
      )
      pressNew()
      playCorrect(2)
      openSettings('key')
      fireFullReset()

      expect(amnesicModeOf(1)).toBe(mode) // still its saved default
      expect(statValue('Score')).toBe('0/0')
      expect(liveBests()).toEqual(NO_BESTS)
      expect(parked()).toBeNull() // nothing left to come back
      setAmnesic('off')
      expect(statValue('Score')).toBe('0/0')
      expect(liveBests()).toEqual(NO_BESTS)
    })

  it('Full Reset on a preset that is on Off is unchanged — the parked copy is the only copy', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    openSettings('key')
    fireFullReset()
    expect(statValue('Score')).toBe('0/0')
  })

  // RESET STATS under Stats Only is the session's reset: it clears the strip, and neither your
  // saved stats nor a Best.
  it('Stats Only: Reset Stats clears the session’s strip and nothing permanent', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    act(() => recordBests(9))
    setAmnesic('stats')
    pressNew()
    playCorrect(2)
    const before = device()
    tap(ctrl('Reset Stats'))
    tap(
      within(screen.getByRole('dialog', { name: 'Reset Stats?' })).getByRole('button', {
        name: 'Reset Stats',
      }),
    )
    expect(statValue('Score')).toBe('0/0')
    expect(device()).toBe(before)
    expect(liveBests()).toEqual(bestsOf(9))
  })

  // ★ …AND THE POPUP SAYS SO. It used to promise "clears this mode's stats and all-time bests for
  // the preset you are on" under all three values — true only under Off.
  it.each([
    ['off', /^Clears this mode's stats and all-time bests for the preset you are on\./, null],
    ['stats', /^Clears this mode's stats for this session — the numbers on screen\./, 'Stats Only'],
    ['full', /^Clears this mode's stats for this session — the numbers on screen\./, 'Full'],
  ])(
    'the "Reset Stats?" popup is true for the value the preset is on: %s',
    (mode, opens, label) => {
      mountApp()
      pinReadableQuestions()
      setAmnesic(mode)
      pressNew()
      playCorrect(1)
      tap(ctrl('Reset Stats'))
      const text = screen.getByRole('dialog', { name: 'Reset Stats?' }).textContent
      const body = text.replace(/^Reset Stats\?/, '').replace(/Reset Stats$/, '')
      expect(body).toMatch(opens)
      expect(body).toMatch(/The other modes keep theirs, and no other preset is touched\.$/)
      if (label)
        expect(body).toContain(
          `This preset's Amnesic is on ${label}, so its saved stats are set aside and are not touched`,
        )
      else expect(body).not.toMatch(/Amnesic/)
    },
  )

  // RESET SETTINGS restores the saved Amnesic value — which is a change like any other.
  it('Reset Settings puts a preset on Stats Only back on its saved default, and the session is discarded', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    setAmnesic('stats')
    pressNew()
    playCorrect(2)
    const before = device()
    openSettings('key')
    fireResetSettings()
    expect(amnesicModeOf(1)).toBe('off')
    expect(session()).toBeNull()
    // (Reset Settings rewrote the settings; the saved PROGRESS did not move.)
    expect(parked()).toBe(JSON.parse(before).find(([k]) => k === statsKey(1))[1])
    expect(useProgress.getState().stats.classic.played).toBe(3)
  })
})

describe('the Amnesic pill in the ⚙ panel', () => {
  beforeEach(() => resetAppState())
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
  // of what was counted lasts.
  it('is independent of Save Stats — the value is kept whatever the switch does', () => {
    openPanel()
    pickPill('Amnesic', 'Stats Only')
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), pickerChosen('Amnesic')]).toEqual(['Off', ['Stats Only']])
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), pickerChosen('Amnesic')]).toEqual(['On', ['Stats Only']])
  })

  // The app's established "dimmed means disabled", asserted as the whole lock every picker has
  // (drawn unavailable, announced, inert, no tab stop) — and the value is exactly where it was left.
  it('dims and locks while Save Stats is off, keeping its value', () => {
    openPanel()
    pickPill('Amnesic', 'Full')
    toggleSwitch('Save Stats')

    expectLock('Amnesic', true)
    pickPill('Amnesic', 'Off') // a press behind the dim
    expect(pickerChosen('Amnesic')).toEqual(['Full'])
    expect(amnesicModeOf(1)).toBe('full')

    toggleSwitch('Save Stats')
    expectLock('Amnesic', false)
    expect(pickerChosen('Amnesic')).toEqual(['Full'])
  })

  // ★★ IT LIGHTS THE GEAR. The gear's bar, Reset Settings' dim and Save Defaults' dim are ONE
  // expression (main.tsx's settingsAtDefaults), and the Amnesic value is one of its terms: leaving
  // it out once left Save Defaults dimmed and INERT whenever Amnesic was the only thing a player had
  // changed. Every offer that lights here really acts on the value.
  for (const label of ['Stats Only', 'Full'])
    it(`${label} lights the gear ON ITS OWN, and offers all three footer buttons with it`, () => {
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

  // ⚠ The value does not ride the settings store's own write path. resetToFactory() rewrites all 16
  // ⚙ values in one `set` with no rehydration and no screen remount — which is precisely the failure
  // mode store/amnesic refuses to expose this value to — so it cannot reach Amnesic. (The ⚙ PANEL's
  // Reset Settings is a different function, App's own, and it restores Amnesic deliberately.)
  it('the settings store’s own factory reset cannot change it', () => {
    openPanel()
    pickPill('Amnesic', 'Full')
    act(() => useSettings.getState().resetToFactory())
    expect(amnesicModeOf(1)).toBe('full')
  })
})

// Belt and braces for the file's own hygiene: nothing above may leave a session copy behind for the
// next file in this worker. resetAppState does this for every case, and this is the statement of it.
afterEach(() => {
  for (const preset of usePresets.getState().presets) discardSessionStats(preset.id)
})

// ── THE PERMANENT COPY'S SEALED SOLVE-TIME CHUNKS ARE OUT OF REACH TOO ────────────────────────
//
// A long history of solve times is kept in chunk keys beside the main one (store/progressStorage),
// under the SAME names in either storage area. So the invariant has a second half: while a preset is
// amnesic, nothing reads, lists or deletes a chunk of its PERMANENT copy — the session works on the
// session area and on nothing else. Asserted on the calls themselves (a spy on the storage area) and
// on the bytes (every permanent key, chunks included, is unchanged).
describe('an amnesic preset cannot reach its permanent solve-time chunks', () => {
  const FAMILY = 'cg-times-v1'
  const long = (n) => ({
    played: n,
    good: n,
    streak: 3,
    best: 40,
    times: Array.from({ length: n }, (_, i) => 2 + (i % 977) / 100),
  })
  const seedPermanent = () => {
    const state = { ...makeProgressDefaults() }
    state.stats = { ...state.stats, classic: long(3000) }
    seedSealed({ put: (k, v) => localStorage.setItem(k, v) }, state)
    relaunch()
  }
  // The permanent progress, whole: the main key and every chunk key.
  const permanentBytes = () =>
    JSON.stringify(
      Object.entries({ ...localStorage })
        .filter(([k]) => k.startsWith('cg-progress-v1') || k.startsWith(FAMILY))
        .sort(),
    )
  const chunkBytes = () =>
    JSON.stringify(
      Object.entries({ ...localStorage })
        .filter(([k]) => k.startsWith(FAMILY))
        .sort(),
    )
  // Every call that touches a permanent chunk, and every listing of the permanent area's keys.
  const watchPermanent = () => {
    const seen = []
    const isLocal = (area) => area === window.localStorage
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const real = Storage.prototype[method]
      vi.spyOn(Storage.prototype, method).mockImplementation(function (key, ...rest) {
        if (isLocal(this) && String(key).startsWith(FAMILY)) seen.push(`${method} ${key}`)
        return real.call(this, key, ...rest)
      })
    }
    const realKey = Storage.prototype.key
    vi.spyOn(Storage.prototype, 'key').mockImplementation(function (i) {
      if (isLocal(this)) seen.push(`key ${i}`)
      return realKey.call(this, i)
    })
    return seen
  }
  beforeEach(() => resetAppState())
  afterEach(() => vi.restoreAllMocks())

  it('the sealed save loads whole — every time, read through the real store', () => {
    seedPermanent()
    expect(useProgress.getState().stats.classic.times).toHaveLength(3000)
    expect('timesLost' in useProgress.getState().stats.classic).toBe(false)
    expect('sealed' in useProgress.getState().stats.classic).toBe(false)
  })

  it('★ Full: no read, no listing, no delete of a permanent chunk — and not a byte moves', () => {
    seedPermanent()
    const untouched = permanentBytes()
    const seen = watchPermanent()

    setAmnesic('full')
    expect(useProgress.getState().stats.classic.times).toHaveLength(0) // the session starts at zero
    useProgress.getState().setModeStats('classic', long(1500)) // a guest with a long session
    useProgress.getState().setModeStats('classic', long(1501))
    relaunch() // a reload: the session copy is read back
    expect(useProgress.getState().stats.classic.times).toHaveLength(1501)
    useProgress.getState().setModeStats('classic', makeProgressDefaults().stats.classic) // Reset Stats
    useProgress.getState().resetProgress()
    recordEverything(5)
    relaunch()

    expect(seen).toEqual([])
    expect(permanentBytes()).toBe(untouched)

    // Off again: the session is thrown away, the saved times come back, every one.
    setAmnesic('off')
    expect(useProgress.getState().stats.classic.times).toHaveLength(3000)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(FAMILY)
  })

  // Under Stats Only a Best IS written into the permanent main key — beside the sealed layout, not
  // through it: the stats in that text, with their sealed-chunk record, go back exactly as they came.
  it('★ Stats Only: a Best is saved without one chunk being read, listed, written, or deleted', () => {
    seedPermanent()
    const [chunks, minusBests, statsText] = [chunkBytes(), parkedMinusBests(), parkedStatsText()]
    expect(JSON.parse(parked()).state.stats.classic.sealed).toBeDefined() // it IS a sealed save
    const seen = watchPermanent()

    setAmnesic('stats')
    expect(useProgress.getState().stats.classic.times).toHaveLength(0)
    useProgress.getState().setModeStats('classic', long(1500))
    recordBests(50)
    relaunch()
    recordBests(60)

    expect(seen).toEqual([])
    expect(chunkBytes()).toBe(chunks)
    expect(parkedMinusBests()).toBe(minusBests)
    expect(parkedStatsText()).toBe(statsText)
    expect(parkedBests()).toEqual(bestsOf(60))

    // Off again: every saved time is still there, and so is the Best.
    vi.restoreAllMocks()
    setAmnesic('off')
    expect(useProgress.getState().stats.classic.times).toHaveLength(3000)
    expect(liveBests()).toEqual(bestsOf(60))
  })

  it('Full Reset’s wipe of the parked copy takes its chunks with it — the one deliberate exception', () => {
    seedPermanent()
    setAmnesic('full')
    discardParkedStats(1)
    expect(Object.keys(localStorage).filter((k) => k.startsWith(FAMILY))).toEqual([])
    expect(parked()).toBeNull()
  })
})
