// @vitest-environment jsdom
//
// presetSwitch.dom — SWITCHING PRESETS WITH THE REAL <App/> MOUNTED.
//
// ★★ WHY THIS FILE IS NOT PART OF tests/presets.dom. That file proves the SAVED data moves: it
// drives the stores directly, and every case it can write is true of a store layer with no app on
// top of it. The bug this whole sub-group exists to prevent lives exactly where that file cannot
// look. The five mode screens and the guide are ALWAYS MOUNTED; each hydrates its stats ONCE, at
// mount, and mirrors them back on every change. Repoint storage underneath them without remounting
// and the stores are right, the screens are wrong, and the very NEXT answered question writes the
// OUTGOING preset's numbers into the INCOMING one. It was reproduced against the real stores: a
// device with 500 cards ended up holding 4. Nothing short of a mounted app, a switch, and an
// answered question can catch it — so that is what these cases do.
//
// ⚠ THE ONE CASE THAT MATTERS MOST is "answering immediately after a switch writes to the incoming
// preset only". If a future change deletes src/main.tsx's registry subscription — the line that
// turns an activeId change into the six remount-key bumps — that case is what goes red. Everything
// else in the suite stays green, which is precisely how the bug shipped the first time.
//
// ⚠ THIS FILE MAY COMPOSE A STORAGE KEY, unlike tests/persistence.dom, and for a reason rather than
// out of convenience: it has to read TWO presets' saved copies at the same moment, and the
// observation-based helper there can only ever answer for the ACTIVE one. It composes them by
// CALLING the real presetKey rather than by writing strings, so it pins nothing about spelling —
// that is tests/presets.dom's job.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
// ⚠ <App/> is NOT imported here: tests/helpers/settingsPanel's mountApp owns that import, and a
// second static one would only be a second name for the same module singleton. The blocked-storage
// case at the foot of the file deliberately imports its OWN fresh copy — that is the whole point of
// it, and it says so there.
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  createPreset,
  movePreset,
  renamePreset,
  switchPreset,
  deletePreset,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useProgress } from '../src/store/progress.js'
import { resetAppState, mountApp, tap, documentTheme } from './helpers/settingsPanel.jsx'
import { statValue, readDate, correctDayName } from './helpers/modeScreen.jsx'
import { isOffered } from './helpers/offered.js'
import { blockStorage } from './helpers/persistence.js'

// ── Driving a preset ──────────────────────────────────────────────────────────────────────────

// Everything a preset needs before its Classic question can be READ and ANSWERED: a fixed
// numeric-ymd format so the date on screen is parseable, and a Gregorian-only year range so plain
// wday() is the right answer. Every preset starts from FACTORY defaults, so this is per-preset
// setup, not once-per-file setup — a switch that did NOT carry the settings across is the whole
// point, and pinning them again on the far side is how these cases stay readable.
const pinReadableQuestions = () =>
  act(() => {
    const s = useSettings.getState()
    s.setRandomFormat(false)
    s.setDateFormat('numeric-ymd')
    s.setMinY(1583)
    s.setMaxY(10000)
  })

// A theme this preset can be recognised by on sight — the owner asked that the theme be per-preset
// too, so it doubles as the settings store's readout at the App level.
const wearTheme = (name) =>
  act(() => {
    useSettings.getState().setUseSystem(false)
    useSettings.getState().setManualTheme(name)
  })

const ctrl = (name) => screen.getByRole('button', { name })
const pressNew = () => tap(ctrl('New'))

// Answer the question currently on screen, correctly. Returns the date it answered, so a case can
// say which question was live at that moment.
function answerCorrectly() {
  const date = readDate()
  tap(screen.getByRole('button', { name: correctDayName(date) }))
  return date
}

// Play `n` correct answers in Classic, each on a fresh question.
function playCorrect(n) {
  for (let i = 0; i < n; i++) {
    answerCorrectly()
    if (i < n - 1) pressNew()
  }
}

// ── Reading what is SAVED, for a named preset ─────────────────────────────────────────────────

const savedFor = (storeId, presetId) => {
  const raw = localStorage.getItem(presetKey(PRESET_STORE_KEYS[storeId], presetId))
  return raw === null ? null : JSON.parse(raw)
}
const savedClassicPlayed = (presetId) =>
  savedFor('progress', presetId)?.state?.stats?.classic?.played
// The whole saved copy of a preset, as the four raw strings on disk — the shape "nothing touched
// it" is asserted in, because a re-serialisation that changed one field would still compare equal
// field by field if the case only checked the fields it happened to think of.
const rawCopyOf = (presetId) =>
  Object.fromEntries(
    Object.keys(PRESET_STORE_KEYS).map((id) => [
      id,
      localStorage.getItem(presetKey(PRESET_STORE_KEYS[id], presetId)),
    ]),
  )

// Open a preset the way the UI group's switcher will: one call, no callback. The act() boundary is
// the test harness's, not the app's — src/main.tsx's registry subscription runs synchronously
// inside the switch and React commits the reload and the remount together.
const openPreset = (id) => act(() => switchPreset(id))

describe('switching presets, with the app running', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE CASE THIS SUB-GROUP EXISTS FOR.
  it('answering a question straight after a switch writes to the INCOMING preset only', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)
    expect(statValue('Score')).toBe('3/3')
    expect(savedClassicPlayed(1)).toBe(3)
    const preset1BeforeTheSwitch = rawCopyOf(1)

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    pressNew()

    // THE SCREEN MOVED. Without the remount the strip would still read 3/3 here — the stores would
    // be right and the screen would be a preset behind.
    expect(statValue('Score')).toBe('0/0')

    // THE NEXT ANSWERED QUESTION IS THE MOMENT THE BUG BIT. One correct answer must make preset 2
    // read 1, not 4 — and must not touch preset 1 at all.
    answerCorrectly()
    expect(statValue('Score')).toBe('1/1')
    expect(savedClassicPlayed(p2.id)).toBe(1)
    expect(savedClassicPlayed(1)).toBe(3)
    // …and preset 1's saved copy is not merely still correct, it was never rewritten.
    expect(rawCopyOf(1)).toEqual(preset1BeforeTheSwitch)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it('shows the incoming preset everywhere at once — stats and the theme it wears', () => {
    mountApp()
    pinReadableQuestions()
    wearTheme('nebula')
    pressNew()
    playCorrect(2)
    expect(statValue('Score')).toBe('2/2')
    expect(documentTheme()).toBe('nebula')

    const p2 = createPreset()
    openPreset(p2.id)
    // A brand-new preset has no saved copy at all, so both readouts come from the FACTORY values.
    // The theme one is the owner's explicit ask — "I don't even want the theme setting to be
    // global" — and it is the one readout a store-level case cannot see.
    expect(statValue('Score')).toBe('0/0')
    expect(documentTheme()).toBe('light')

    wearTheme('midnight')
    expect(documentTheme()).toBe('midnight')
    openPreset(1)
    expect(statValue('Score')).toBe('2/2')
    expect(documentTheme()).toBe('nebula')
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  it('brings the outgoing preset back exactly as it was left', () => {
    mountApp()
    pinReadableQuestions()
    wearTheme('nebula')
    pressNew()
    playCorrect(3)
    const preset1 = rawCopyOf(1)

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    pressNew()
    playCorrect(1)
    expect(savedClassicPlayed(p2.id)).toBe(1)

    openPreset(1)
    expect(statValue('Score')).toBe('3/3')
    expect(documentTheme()).toBe('nebula')
    // Coming back re-mirrors preset 1's stats from the screens that just remounted — the values it
    // writes must be the values it read, so the saved copy is unchanged field for field.
    expect(savedFor('progress', 1).state).toEqual(JSON.parse(preset1.progress).state)
    expect(savedFor('settings', 1).state).toEqual(JSON.parse(preset1.settings).state)
    // And preset 2's copy sat untouched the whole time it was closed.
    expect(savedClassicPlayed(p2.id)).toBe(1)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A RUN IN PROGRESS IS NOT SAVED DATA, so it does not travel and it does not come back. The
  // observable is Classic's history: after one answered question Back is offered and Override is
  // armed; on the far side of a switch both must be dead, because the screen is a new one.
  it('a run in progress does not survive the switch — in either direction', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    const answered = answerCorrectly()
    expect(isOffered(ctrl('<'))).toBe(true) // history has something in it
    expect(isOffered(ctrl('Override'))).toBe(true) // the just-answered question can be flipped

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    pressNew()
    expect(isOffered(ctrl('<'))).toBe(false)
    expect(isOffered(ctrl('Override'))).toBe(false)
    expect(statValue('Score')).toBe('0/0')

    // Back on preset 1 the STATS return from disk, but the run does not: a fresh, unanswered
    // question, with nothing behind it.
    openPreset(1)
    pinReadableQuestions()
    pressNew()
    expect(statValue('Score')).toBe('1/1')
    expect(isOffered(ctrl('<'))).toBe(false)
    expect(isOffered(ctrl('Override'))).toBe(false)
    expect(readDate()).not.toEqual(answered)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Deleting the preset you are ON is a switch to its neighbour, so it must land the same way. It
  // reaches the screens through the same registry subscription, which is the point of hanging the
  // remount off activeId rather than off one function's argument list.
  it('deleting the preset you are on lands on the neighbour, remounted', () => {
    mountApp()
    pinReadableQuestions()
    wearTheme('nebula')
    pressNew()
    playCorrect(2)

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    pressNew()
    playCorrect(4)
    expect(statValue('Score')).toBe('4/4')

    act(() => deletePreset(p2.id))
    expect(usePresets.getState().activeId).toBe(1)
    expect(statValue('Score')).toBe('2/2')
    expect(documentTheme()).toBe('nebula')
    // Preset 2's saved copy went with it, and preset 1's did not.
    expect(savedFor('progress', p2.id)).toBeNull()
    expect(savedClassicPlayed(1)).toBe(2)

    // …and the screen it left behind is a live one: the next answer credits PRESET 1.
    answerCorrectly()
    expect(statValue('Score')).toBe('3/3')
    expect(savedClassicPlayed(1)).toBe(3)
  })

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Creating, renaming and REORDERING rewrite the registry too. None of the three moves the active
  // preset or repoints its storage, so none of them may throw away the run the player is in the
  // middle of — and the cheap way to get this wrong is to remount on any registry write at all.
  // (What makes it right is that main.tsx's subscription compares store/amnesic's activeDataId,
  // which is deliberately blind to names and to order.)
  it('creating a preset does not disturb the one you are playing', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    answerCorrectly()
    const live = readDate() // Classic advances on a correct answer, so this is where the run is now
    act(() => createPreset('Second'))
    expect(readDate()).toEqual(live) // same question, still answered
    expect(statValue('Score')).toBe('1/1')
    expect(isOffered(ctrl('Override'))).toBe(true) // the run is intact, not restarted
  })

  it('renaming and reordering do not disturb it either', () => {
    // The two operations sub-group 4C added to the manager. A reorder is the one registry write
    // that changes NOTHING about which bytes the screens are reading, so a remount here would be
    // pure loss — a player tidying their list mid-run would lose the run to a cosmetic change.
    mountApp()
    pinReadableQuestions()
    const second = createPreset('Second')
    pressNew()
    answerCorrectly()
    const live = readDate()
    act(() => renamePreset(second.id, 'Renamed'))
    act(() => movePreset(second.id, -1)) // …and now the active preset is second in the list
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Renamed', 'Preset 1'])
    expect(usePresets.getState().activeId).toBe(1)
    expect(readDate()).toEqual(live)
    expect(statValue('Score')).toBe('1/1')
    expect(isOffered(ctrl('Override'))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// STORAGE THAT REFUSES. Presets added a store (the registry) and a storage adapter that asks it a
// question on every read and write, so "the app still boots when localStorage throws" is a promise
// the preset work could newly have broken.
//
// ⚠ THE BLOCK MUST BE INSTALLED BEFORE THE MODULE GRAPH LOADS to mean anything: persist resolves
// its storage adapter once, when the store is created, so a block installed afterwards is a block
// no store ever sees. Hence resetModules + a fresh import inside the block, which is the ordering a
// real private-mode launch has. (The store-level half of this — a blocked cold start leaving every
// store on its launch values — is tests/persistence.dom's, and it passes the preset work unedited,
// which is itself the assertion that nothing about presets changed it.)
describe('a browser that refuses localStorage', () => {
  let restore = null
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
    restore?.()
    restore = null
  })

  it('still boots — and presets still ISOLATE, in memory, for the session', async () => {
    restore = blockStorage()
    vi.resetModules()
    // Imported with no #root in the document, so main.jsx's real-build auto-mount stays skipped and
    // this case owns the only copy of the app.
    const [{ App: FreshApp }, control, settings] = await Promise.all([
      import('../src/main.jsx'),
      import('../src/store/presetControl.js'),
      import('../src/store/settings.js'),
    ])
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<FreshApp />)

    // ⚠ THE STATIC IMPORTS AT THE TOP OF THIS FILE ARE THE WRONG SINGLETONS IN HERE — the module
    // graph was reset, so this app is running on the copies imported above. Hence the local
    // versions of the two fixtures.
    const pinHere = () =>
      act(() => {
        const s = settings.useSettings.getState()
        s.setRandomFormat(false)
        s.setDateFormat('numeric-ymd')
        s.setMinY(1583)
        s.setMaxY(10000)
      })
    const wearHere = (name) =>
      act(() => {
        settings.useSettings.getState().setUseSystem(false)
        settings.useSettings.getState().setManualTheme(name)
      })

    // "Still on screen" is asked of a VISIBLE control, not of the app's heading — since the
    // top-bar rebuild that heading is sr-only, so it cannot distinguish a painted app from a
    // rendered-but-blank one. The preset switcher is the apt one here: it is the control this
    // whole file is about, and it re-reads the registry on every switch.
    const switcher = () => screen.getByRole('button', { name: /^Preset,/ })
    expect(switcher()).toBeInTheDocument()

    // ★★ THE CLAIM, AND IT USED TO BE MERELY "NOTHING THREW". Every per-preset store is memory-only
    // for this session — zustand attaches `api.persist` only when a storage exists, so all four
    // have none — and the version of reloadPresetStores that SKIPPED those stores made this the one
    // browser where switching preset did nothing at all: the registry moved, the screens remounted,
    // and preset 2 opened wearing preset 1's score and preset 1's theme, then accumulated the
    // session's answers onto them. Nothing reaches disk here, so nothing is permanently lost; what
    // was broken is the whole promise a preset makes. A case that asked only `not.toThrow` passed
    // throughout.
    pinHere()
    wearHere('nebula')
    pressNew()
    playCorrect(2)
    expect(statValue('Score')).toBe('2/2')
    expect(documentTheme()).toBe('nebula')

    const p2 = control.createPreset()
    act(() => control.switchPreset(p2.id))
    expect(switcher()).toBeInTheDocument()
    // A preset with no saved copy is a preset holding the FACTORY values, which is what a browser
    // that saves nothing has for every preset but the one in memory.
    expect(statValue('Score')).toBe('0/0')
    expect(documentTheme()).toBe(settings.SETTINGS_DEFAULTS.lightTheme)

    // …and the same in the other direction: playing here must not reach back into preset 1, and
    // returning must not find preset 1 wearing what preset 2 did.
    pinHere()
    wearHere('midnight')
    pressNew()
    playCorrect(1)
    expect(statValue('Score')).toBe('1/1')
    act(() => control.switchPreset(1))
    expect(statValue('Score')).toBe('0/0') // preset 1's numbers were never SAVED, so they are gone
    expect(documentTheme()).toBe(settings.SETTINGS_DEFAULTS.lightTheme)

    expect(() => act(() => control.deletePreset(p2.id))).not.toThrow()
    expect(switcher()).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FULL RESET AND A PRESET SWITCH NOW SHARE ONE DISCARD (src/main.tsx's remountScreens), so the two
// have to be checked against each other: the shared half must still do everything Full Reset needs,
// and the switch must NOT have inherited the half that writes defaults.
describe('the switch and Full Reset share a discard without sharing a wipe', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  // The dangerous inheritance in the other direction: if a switch ever picked up resetSettings /
  // resetProgress it would wipe the preset it just opened. This is the case that would catch it.
  it('a switch never writes defaults over the preset it opens', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(2)

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    wearTheme('midnight')
    pressNew()
    playCorrect(5)
    const preset2 = rawCopyOf(2)

    openPreset(1)
    openPreset(p2.id)
    expect(statValue('Score')).toBe('5/5')
    expect(documentTheme()).toBe('midnight')
    expect(savedFor('progress', 2).state).toEqual(JSON.parse(preset2.progress).state)
    expect(savedFor('settings', 2).state).toEqual(JSON.parse(preset2.settings).state)
  })

  // And Full Reset still clears the preset you are ON and only that one — the shared discard did
  // not quietly widen its reach.
  it('Full Reset inside a preset leaves every other preset alone', () => {
    mountApp()
    pinReadableQuestions()
    pressNew()
    playCorrect(3)

    const p2 = createPreset()
    openPreset(p2.id)
    pinReadableQuestions()
    pressNew()
    playCorrect(2)
    expect(savedClassicPlayed(p2.id)).toBe(2)

    act(() => useProgress.getState().resetProgress())
    expect(savedClassicPlayed(p2.id)).toBe(0)
    expect(savedClassicPlayed(1)).toBe(3) // the preset you are not on is untouched
  })
})
