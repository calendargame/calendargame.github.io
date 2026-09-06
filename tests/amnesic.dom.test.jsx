// @vitest-environment jsdom
//
// amnesic.dom — A PRESET THAT NEVER WRITES ITS STATS DOWN.
//
// ★★ THE ONE CLAIM THIS FILE EXISTS TO PROVE, and it is deliberately expressible in one sentence:
// WHILE A PRESET IS AMNESIC, NOTHING WRITES ITS PERMANENT STATS. Everything else here — the zero
// start, the discard on the way back, the guest handing the phone over — is a consequence of that
// sentence, and every case that asserts it does so as a BYTE COMPARISON of the payload on disk
// rather than field by field. A field-by-field check would pass a re-serialisation that quietly
// rewrote something the case did not think to look at, which is exactly the failure mode: the bug
// this feature could have shipped is not "the numbers are wrong", it is "the numbers were replaced
// by a session's".
//
// ⚠ WHY A MOUNTED APP IS PART OF THE GATE. The store-level cases below can prove where bytes go;
// they cannot prove the thing that has already cost this app once. The five mode screens are ALWAYS
// MOUNTED, hydrate their stats ONCE at mount and mirror them back on every change, so repointing
// storage underneath them without a remount leaves the stores right and the screens a copy behind —
// and the very next answered question writes the copy behind over the copy that is live. It was
// reproduced against the real stores: a device with 500 cards ended up holding 4. Turning Amnesic
// on repoints exactly that storage, so nothing short of a mounted app, a toggle, and an answered
// question can catch the regression. ★ IF SOMEONE DELETES src/main.tsx's registry subscription, or
// narrows it back from store/amnesic's activeDataId to activeId alone, "the session starts at zero
// on screen" is the case that goes red — and nothing else in the suite would.
//
// ⚠ THIS FILE MAY COMPOSE A STORAGE KEY, on tests/presetSwitch.dom's precedent and for the same
// kind of reason: it has to read the SAME preset's two copies — the parked permanent one and the
// session one — at the same moment, and tests/helpers/persistence's observation-based resolver can
// only ever answer for wherever the store is pointed right now. It composes them by CALLING the
// real presetKey, so it pins nothing about spelling; that is tests/presets.dom's job.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, act } from '@testing-library/react'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  AMNESIC_CLEARS,
  isAmnesic,
  activeDataId,
  discardSessionStats,
} from '../src/store/amnesic.js'
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
import {
  resetAppState,
  mountApp,
  openSettings,
  settingSwitch,
  switchState,
  switchRow,
  toggleSwitch,
  drawnUnavailable,
  isOffered,
  tap,
} from './helpers/settingsPanel.jsx'
import { statValue, readDate, correctDayName } from './helpers/modeScreen.jsx'

// ── The two copies of one preset's stats ──────────────────────────────────────────────────────

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

// Turn a preset amnesic (or not) the way the ⚙ switch does: one call. act() because src/main.tsx's
// registry subscription runs synchronously inside it and, with the app mounted, remounts six
// screens; the store-level describes below have no app and the boundary costs them nothing.
const setAmnesic = (on, id = usePresets.getState().activeId) => act(() => setPresetAmnesic(id, on))

// Put real, distinguishable stats in every one of the six persisted progress values, through the
// store's own setters — a payload the app never wrote would be no evidence about what it saves.
const AOX_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
function recordEverything(n = 7) {
  const p = useProgress.getState()
  p.setModeStats('classic', { played: n, good: n, streak: n, best: n, times: [900, 1100] })
  p.setModeStats('flash', { played: 2, good: 1, streak: 0, best: 1, times: [1500] })
  p.setBlitzBest({ '60|false': { score: n, streak: n, scoreRoundId: 1, streakRoundId: 1 } })
  p.setSuddenBest({ '10|false': { score: n, roundId: 1 } })
  p.setSuddenAmBest({ '10|true': { score: n, streak: n, scoreRoundId: 1, streakRoundId: 1 } })
  p.setAoxBest({
    [AOX_KEY]: { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 },
  })
  p.setLookupHistory([{ id: 'a', y: 2000, m: 1, d: 1 }])
}

// Re-read the progress store from wherever it is now pointed — the store-level stand-in for the
// app opening again. It is the same call store/presetControl makes on a switch.
// ⚠ THE BODY IS BRACED, AND THAT IS NOT A STYLE CHOICE. zustand's rehydrate() returns a THENABLE,
// and React's act() given a thenable switches to ASYNC mode: it hands back a thenable of its own
// and leaves the act queue open until that is awaited. Returning it from this arrow would therefore
// poison every LATER render in the file — <App/> would mount into an act queue nothing ever flushes
// and render nothing at all, with no error anywhere. (That is not hypothetical; it cost this file
// an hour. presetControl's own callers are safe by luck — switchPreset returns a boolean, so act
// never sees the thenable.)
const relaunch = () => {
  act(() => {
    useProgress.persist.rehydrate()
  })
}

// The six persisted progress values as the store currently holds them — the readout every "started
// at zero" / "came back exactly" claim is made against.
const liveProgress = () => {
  const s = useProgress.getState()
  return Object.fromEntries(Object.keys(makeProgressDefaults()).map((k) => [k, s[k]]))
}

describe('an amnesic preset never writes its stats down', () => {
  beforeEach(() => resetAppState())

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE INVARIANT, AS ONE SENTENCE AND ONE COMPARISON.
  it('THE INVARIANT: while Amnesic is on, the permanent stats payload never changes', () => {
    recordEverything(7)
    const untouched = parked()
    expect(untouched).not.toBeNull() // else the comparison below would be vacuous

    setAmnesic(true)
    // Everything the app can do to stats, in one go: play, set a new best, look a date up, and the
    // most destructive write there is.
    recordEverything(99)
    useProgress.getState().setLookupHistory([{ id: 'b', y: 1900, m: 3, d: 4 }])
    useProgress.getState().resetProgress()
    recordEverything(1234)

    expect(parked()).toBe(untouched)
    // …and it is not that nothing was written at all — the session copy caught every one of them.
    expect(JSON.parse(session()).state.stats.classic.played).toBe(1234)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE TOGGLE RULE, both halves, and the second half is the banned one: OFF discards, it never
  // merges. A merge is the 500-cards-becomes-4 shape — two sets of numbers and a write picking the
  // wrong one — and the owner ruled it out, so the case asserts the saved copy comes back byte for
  // byte rather than merely "at least as big as it was".
  it('ON parks the saved stats and starts at zero; OFF discards the session and brings them back', () => {
    recordEverything(7)
    const before = parked()
    const saved = liveProgress()

    setAmnesic(true)
    expect(liveProgress()).toEqual(makeProgressDefaults()) // every value, not just the score

    recordEverything(99)
    expect(useProgress.getState().stats.classic.played).toBe(99)

    setAmnesic(false)
    expect(liveProgress()).toEqual(saved)
    expect(parked()).toBe(before)
    // The session copy is gone, so turning Amnesic on again cannot resurrect it.
    expect(session()).toBeNull()
    setAmnesic(true)
    expect(liveProgress()).toEqual(makeProgressDefaults())
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // WHAT IT FORGETS, KEY BY KEY — the declarative list in store/amnesic is the feature's definition,
  // so it gets asserted as a list rather than through whichever value a case happened to write.
  it('every value named in AMNESIC_CLEARS starts the session at its factory value', () => {
    recordEverything(7)
    const defaults = makeProgressDefaults()
    // Guard against a dead entry: each listed key must genuinely be one of the persisted values, or
    // the list is naming something that was renamed out from under it.
    for (const key of AMNESIC_CLEARS) expect(Object.keys(defaults)).toContain(key)
    // …and against a stale one: each must actually have been carrying something to forget.
    for (const key of AMNESIC_CLEARS) expect(useProgress.getState()[key]).not.toEqual(defaults[key])

    setAmnesic(true)
    for (const key of AMNESIC_CLEARS) expect(useProgress.getState()[key]).toEqual(defaults[key])
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // WHAT IT KEEPS. The split is STATS, NOT CONFIGURATION, and it holds by construction rather than
  // by an exclusion list — store/amnesic only ever repoints the progress store — so this is the
  // case that would catch that construction being widened by accident.
  it('keeps every setting, the mode setup and the saved defaults — and keeps writing them down', () => {
    useSettings.getState().setUseSystem(false)
    useSettings.getState().setManualTheme('nebula')
    useModePrefs.getState().setBlitzSec(45)
    useUserDefaults.getState().saveDefaults({
      settings: { ...useSettings.getState() },
      prefs: { flashMs: 1500, blitzSec: 45, blitzQSec: 10, aoxN: '12' },
    })
    const kept = keptCopies()

    setAmnesic(true)
    // Still on screen…
    expect(useSettings.getState().manualTheme).toBe('nebula')
    expect(useModePrefs.getState().blitzSec).toBe(45)
    expect(useUserDefaults.getState().saved.prefs.aoxN).toBe('12')
    // …and still on the DEVICE, unchanged by the toggle.
    expect(keptCopies()).toEqual(kept)

    // A setting changed DURING an amnesic session is still permanent: amnesia is about stats.
    useSettings.getState().setManualTheme('midnight')
    expect(JSON.parse(keptCopies().settings).state.manualTheme).toBe('midnight')
    // The amnesic flag itself survives too — it is a property of the preset, so a preset stays
    // amnesic until somebody turns it off.
    expect(isAmnesic(usePresets.getState(), 1)).toBe(true)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // CLOSING THE APP. Nothing in the app detects a close; the browser ends the session and the copy
  // goes with it. This is that, in the only shape jsdom can state it honestly — the session area is
  // emptied, which is exactly what the browser does — and what matters is what is left behind.
  it('closing the app takes the session with it and leaves the parked stats untouched', () => {
    recordEverything(7)
    const before = parked()
    setAmnesic(true)
    recordEverything(99)
    expect(session()).not.toBeNull()

    sessionStorage.clear() // the close
    relaunch() // …and the next launch reads storage again

    expect(liveProgress()).toEqual(makeProgressDefaults())
    expect(parked()).toBe(before)
    // Still amnesic on the way back in — the switch is not something a close resets.
    expect(isAmnesic(usePresets.getState(), 1)).toBe(true)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A RELOAD IS NOT A CLOSE, which is the honest half of the promise and the half the How-to-Play
  // section spells out: the browser decides when a session ends, and a refresh does not end one.
  it('a reload keeps the session going — only a close ends it', () => {
    setAmnesic(true)
    recordEverything(42)
    relaunch()
    expect(useProgress.getState().stats.classic.played).toBe(42)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it('is per preset — and flipping one you are not on touches nothing you can see', () => {
    recordEverything(7)
    const p2 = createPreset()
    setAmnesic(true, p2.id)

    // The state a preset UI needs for its "A" marker: readable for every preset, not just the open
    // one. This is the whole of what group 4 has to read.
    expect(usePresets.getState().presets.map((p) => [p.id, p.amnesic])).toEqual([
      [1, false],
      [p2.id, true],
    ])
    // Nothing moved on the preset that is actually open.
    expect(useProgress.getState().stats.classic.played).toBe(7)

    act(() => switchPreset(p2.id))
    recordEverything(3)
    expect(parked(p2.id)).toBeNull() // preset 2 never wrote a permanent copy at all
    expect(JSON.parse(session(p2.id)).state.stats.classic.played).toBe(3)

    // Leaving and coming back is NOT a toggle: you never closed the app, so the session survives.
    act(() => switchPreset(1))
    expect(useProgress.getState().stats.classic.played).toBe(7)
    act(() => switchPreset(p2.id))
    expect(useProgress.getState().stats.classic.played).toBe(3)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Deleting a preset removes exactly its keys — which now means BOTH areas, or a deleted preset
  // leaves a session copy behind under a namespace nothing owns.
  it('deleting a preset takes its session copy with it', () => {
    const p2 = createPreset()
    setAmnesic(true, p2.id)
    act(() => switchPreset(p2.id))
    recordEverything(5)
    expect(session(p2.id)).not.toBeNull()

    act(() => switchPreset(1))
    act(() => deletePreset(p2.id))
    expect(session(p2.id)).toBeNull()
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A browser that allows localStorage but refuses sessionStorage. The two areas fail
  // independently, so the amnesic branch must degrade to memory-only for the session rather than
  // fall back to the permanent copy — which would be the one failure mode the whole feature exists
  // to prevent, reached by a browser setting.
  it('survives a sessionStorage that refuses, without ever falling back to the device', () => {
    recordEverything(7)
    const before = parked()
    const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      setAmnesic(true)
      recordEverything(99)
      expect(useProgress.getState().stats.classic.played).toBe(99) // in memory, for the session
      expect(parked()).toBe(before) // and never on the device
    } finally {
      if (own) Object.defineProperty(window, 'sessionStorage', own)
      else delete window.sessionStorage
    }
    // The flag is still the preset's, and turning it off still lands on the parked copy.
    setAmnesic(false)
    expect(useProgress.getState().stats.classic.played).toBe(7)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The remount trigger, as the value src/main.tsx compares. Stated here rather than only through
  // the mounted app because it is the thing a future edit is most likely to narrow back.
  it('activeDataId moves when the preset changes AND when its amnesia does', () => {
    const before = activeDataId(usePresets.getState())
    setAmnesic(true)
    const amnesicNow = activeDataId(usePresets.getState())
    expect(amnesicNow).not.toBe(before)

    // …and does NOT move for a registry write that changes no data: creating a preset must never
    // throw away the run the player is in.
    createPreset()
    expect(activeDataId(usePresets.getState())).toBe(amnesicNow)
  })

  // A corrupt parked payload seeds NOTHING rather than being laundered into the session — an
  // envelope that cannot be parsed cannot be trusted to say which stats are whose.
  it('a corrupt parked payload gives a fresh session rather than a guess', () => {
    recordEverything(7)
    localStorage.setItem(statsKey(1), '{"state":{"stats":') // a truncated write
    setAmnesic(true)
    expect(liveProgress()).toEqual(makeProgressDefaults())
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

describe('turning Amnesic on with the app running', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE CASE THIS FILE EXISTS FOR. Without the remount the strip would still read 3/3 after the
  // toggle — the store would be right and the screen a copy behind — and the next answered question
  // would write 4 into the session while the player watched their real total tick up.
  it('answering straight after the toggle writes to the session only', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    expect(statValue('Score')).toBe('3/3')
    const before = parked()
    const kept = keptCopies()

    setAmnesic(true)
    pressNew()
    expect(statValue('Score')).toBe('0/0') // the screen moved, not just the store

    answerCorrectly()
    expect(statValue('Score')).toBe('1/1')
    expect(JSON.parse(session()).state.stats.classic.played).toBe(1)
    // The permanent copy was not merely still correct — it was never rewritten.
    expect(parked()).toBe(before)
    expect(keptCopies()).toEqual(kept)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // …and the way back, which is the half a guest actually exercises: they hand the phone over and
  // the owner's numbers are on screen again, unchanged, with nothing of the guest's added in.
  it('turning it off puts the real stats back on screen with nothing merged in', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    const before = parked()

    setAmnesic(true)
    pressNew()
    playCorrect(2)
    expect(statValue('Score')).toBe('2/2')

    setAmnesic(false)
    expect(statValue('Score')).toBe('3/3') // 3, not 5 — the session is discarded, never merged
    expect(parked()).toBe(before)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★ FULL RESET CLEARS THE PARKED COPY TOO, and this case exists because the opposite shipped
  // first and the owner caught it: "doesn't full reset reset everything that amnesic does and
  // more?" It does. Leaving the parked stats alone made the wipe RESURRECTABLE — Full Reset, then
  // turn Amnesic off, and the destroyed stats came back. The invariant is about CONTAMINATION (a
  // session's numbers overwriting the real ones); an erase cannot contaminate, so a deliberate
  // destructive command sits outside it. See store/amnesic's discardParkedStats.
  it('★ Full Reset inside an amnesic preset clears the PARKED stats too — no resurrection', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    expect(parked()).not.toBe(null)

    setAmnesic(true)
    pressNew()
    playCorrect(2)
    openSettings('key')
    tap(screen.getByRole('button', { name: /Full Reset/i }))
    tap(screen.getByRole('button', { name: /Confirm/i }))

    // The session is blank, as on any preset...
    expect(statValue('Score')).toBe('0/0')
    // ...and turning Amnesic off does NOT bring the old numbers back, which is the whole point.
    setAmnesic(false)
    expect(statValue('Score')).toBe('0/0')
  })

  it('Full Reset on a NON-amnesic preset is unchanged — the parked copy is the only copy', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    openSettings('key')
    tap(screen.getByRole('button', { name: /Full Reset/i }))
    tap(screen.getByRole('button', { name: /Confirm/i }))
    expect(statValue('Score')).toBe('0/0')
  })
})

describe('the Amnesic switch in the ⚙ panel', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  const openPanel = () => {
    mountApp()
    openSettings('key')
  }

  it('sits directly under Save Stats and reads the preset it is on', () => {
    openPanel()
    // "Directly below" as the DOM states it: the two rows are adjacent siblings, which is the only
    // form of that claim jsdom can make honestly (it has no layout engine and cannot see order on
    // screen).
    expect(switchRow('Save Stats').nextElementSibling).toBe(switchRow('Amnesic'))
    expect(switchState('Amnesic')).toBe('Off')
    toggleSwitch('Amnesic')
    expect(switchState('Amnesic')).toBe('On')
    expect(isAmnesic(usePresets.getState(), 1)).toBe(true)
  })

  // ⚠ ORTHOGONAL, NOT EXCLUSIVE. Two independent switches: Save Stats says whether a question
  // counts, Amnesic says whether what was counted lasts. A three-way picker was proposed and killed.
  it('is independent of Save Stats — both can be off, or on, in any combination', () => {
    openPanel()
    toggleSwitch('Amnesic')
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), switchState('Amnesic')]).toEqual(['Off', 'On'])
    toggleSwitch('Save Stats')
    expect([switchState('Save Stats'), switchState('Amnesic')]).toEqual(['On', 'On'])
  })

  // The app's established "dimmed means disabled", and both halves are asserted: DRAWN unavailable
  // (the dim reaches the row, so the label greys with its control) and actually INERT (a tap behind
  // the dim changes nothing).
  it('dims and locks while Save Stats is off, keeping its value', () => {
    openPanel()
    toggleSwitch('Amnesic')
    toggleSwitch('Save Stats')

    expect(drawnUnavailable(settingSwitch('Amnesic'))).toBe(true)
    expect(isOffered(settingSwitch('Amnesic'))).toBe(false)
    toggleSwitch('Amnesic') // a press behind the dim
    expect(switchState('Amnesic')).toBe('On')
    expect(isAmnesic(usePresets.getState(), 1)).toBe(true)

    // Turning Save Stats back on releases the lock and the value is exactly where it was left.
    toggleSwitch('Save Stats')
    expect(drawnUnavailable(settingSwitch('Amnesic'))).toBe(false)
    expect(isOffered(settingSwitch('Amnesic'))).toBe(true)
    expect(switchState('Amnesic')).toBe('On')
  })

  // It is a property of the PRESET, not one of the ⚙ settings — so it is absent from the Save
  // Defaults snapshot and never lights the gear's "modified" line. Stated as a test because the
  // row's placement in the panel is exactly what would make a reader assume otherwise.
  it('never lights the gear, and Reset Settings cannot flip it', () => {
    openPanel()
    toggleSwitch('Amnesic')
    expect(
      screen.getByRole('button', { name: /^Settings/ }).getAttribute('aria-label'),
    ).not.toMatch(/modified/)
    act(() => useSettings.getState().resetToFactory())
    expect(isAmnesic(usePresets.getState(), 1)).toBe(true)
  })
})

// Belt and braces for the file's own hygiene: nothing above may leave a session copy behind for the
// next file in this worker. resetAppState does this for every case, and this is the statement of it.
afterEach(() => {
  for (const preset of usePresets.getState().presets) discardSessionStats(preset.id)
})
