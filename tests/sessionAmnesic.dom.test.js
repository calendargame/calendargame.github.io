// @vitest-environment jsdom
//
// sessionAmnesic.dom — WHERE EACH PRESET'S AMNESIC VALUE COMES FROM WHEN A PAGE LOADS, AND WHO CAN
// CHANGE IT.
//
// The value in force (Off / Stats Only / Full) is held for the BROWSING SESSION, per preset
// (store/sessionAmnesic); the one permanent thing is what a preset starts a fresh open on — the
// value in its saved defaults. This file pins the whole lifecycle of that:
//   • a fresh open reads each preset's saved default, and writes NOTHING permanent doing it;
//   • a reload and a preset switch keep the session's value; a real close returns to the default;
//   • the stored spellings — this build's two fields, an older build's boolean, a value this build
//     does not know — each read through the one reader, for the active preset and every other;
//   • the hand-over from an older build that was running a guest session when the app updated;
//   • two tabs each have their own value, and what the shared preset registry still does;
//   • the device full to the byte, which used to leave a preset amnesic past a real close.
// What the value DOES to saved progress is tests/amnesic.dom's; what the older builds were observed
// doing is tests/sessionAmnesic.olderBuilds'.
//
// ⚠ NO <App/> IS MOUNTED HERE. The app's own part in this is two calls in its boot effect — mark the
// browsing session open, put the values this page opened with on the session's record — and `boot`
// below makes exactly those two, so each case can say precisely which load it is modelling
// (tests/helpers/pageLoad argues the model).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  renamePreset,
  deletePreset,
  setPresetAmnesic,
  setOpenInPreset,
} from '../src/store/presetControl.js'
import { amnesicModeOf, commitSessionAmnesic } from '../src/store/sessionAmnesic.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'
import { useSettings } from '../src/store/settings.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults, effectiveAmnesicDefault } from '../src/store/userDefaults.js'
import { useStorageHealth } from '../src/store/storageHealth.js'
import { resetAppState } from './helpers/settingsPanel.jsx'
import { loadPage, closeApp } from './helpers/pageLoad.js'

const RECORD = 'cg-amnesic-v1'
const REGISTRY = 'cg-presets-v1'
const PREFS = { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '10' }
const defaultsKey = (id) => presetKey(PRESET_STORE_KEYS.userDefaults, id)
const progressKey = (id) => presetKey(PRESET_STORE_KEYS.progress, id)

// What src/main.tsx's boot effect does on every load (see the header).
const boot = () => {
  openBrowsingSession()
  commitSessionAmnesic()
}
const reload = () => {
  loadPage()
  boot()
}
const closeAndReopen = () => {
  closeApp()
  loadPage()
  boot()
}
// Everything on the device, every key — "a fresh open writes nothing permanent" is a claim about
// bytes.
const device = () => JSON.stringify(Object.entries({ ...localStorage }).sort())
// Save the ACTIVE preset's defaults with this Amnesic value — the ⚙ footer's own call.
const saveDefault = (amnesic) =>
  useUserDefaults.getState().saveDefaults({
    settings: { ...useSettings.getState() },
    prefs: PREFS,
    amnesic,
  })
// A saved-defaults snapshot put on the device as some OTHER build spelled it.
const seedDefaults = (id, amnesicFields) =>
  localStorage.setItem(
    defaultsKey(id),
    JSON.stringify({
      state: { saved: { settings: { ...useSettings.getState() }, prefs: PREFS, ...amnesicFields } },
      version: 3,
    }),
  )
const storedRegistry = () => JSON.parse(localStorage.getItem(REGISTRY)).state
const played = (n) => ({ played: n, good: n, streak: n, best: n, times: [] })

beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a fresh open: each preset starts on its saved default', () => {
  it('nothing saved: Off', () => {
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off')
  })

  for (const mode of ['off', 'stats', 'full'])
    it(`a default saved as ${mode} — for the preset you open in AND for one you are not on`, () => {
      const p2 = createPreset('Other')
      saveDefault(mode)
      switchPreset(p2.id)
      saveDefault(mode) // preset 2's own snapshot, under its own key
      switchPreset(1)
      closeAndReopen()
      expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual([mode, mode])
      expect(usePresets.getState().activeId).toBe(1)
    })

  it('each preset reads its OWN default, not the active one’s', () => {
    const p2 = createPreset('Guest')
    const p3 = createPreset('Practice')
    switchPreset(p2.id)
    saveDefault('full')
    switchPreset(p3.id)
    saveDefault('stats')
    switchPreset(1)
    closeAndReopen()
    expect([1, p2.id, p3.id].map(amnesicModeOf)).toEqual(['off', 'full', 'stats'])
  })

  // THE MIGRATION, where the stored copy actually reaches it: every spelling a snapshot can be in.
  for (const [label, fields, expected] of [
    ['an older build’s boolean, true', { amnesic: true }, 'full'],
    ['an older build’s boolean, false', { amnesic: false }, 'off'],
    ['a snapshot from before the setting existed', {}, 'off'],
    ['this build’s Stats Only', { amnesic: true, amnesicMode: 'stats' }, 'stats'],
    ['a value a newer build added', { amnesic: true, amnesicMode: 'bests-only' }, 'full'],
    ['a value a newer build added, boolean false', { amnesic: false, amnesicMode: 'x' }, 'full'],
    ['fields that disagree', { amnesic: true, amnesicMode: 'off' }, 'full'],
  ])
    it(`the saved spelling — ${label} — reads as ${expected}, for the active preset and another`, () => {
      const p2 = createPreset('Other')
      seedDefaults(1, fields)
      seedDefaults(p2.id, fields)
      closeAndReopen()
      expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual([expected, expected])
      // …and the active preset's own store reads its snapshot the same way (one reader).
      expect(effectiveAmnesicDefault(useUserDefaults.getState().saved)).toBe(expected)
    })

  it('an unreadable saved-defaults payload is "nothing saved": Off', () => {
    localStorage.setItem(defaultsKey(1), '{"state":{"saved":')
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off')
  })

  // ★ NOTHING PERMANENT IS WRITTEN BY OPENING THE APP — the write a full device used to refuse here
  // no longer exists.
  it('writes nothing permanent — not one byte of the device changes', () => {
    const p2 = createPreset('Guest')
    saveDefault('off')
    setPresetAmnesic(1, 'full')
    setPresetAmnesic(p2.id, 'stats')
    const before = device()
    closeAndReopen()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['off', 'off'])
    expect(device()).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('within the session', () => {
  it('a reload keeps every preset’s value — changed or not', () => {
    const p2 = createPreset('Guest')
    saveDefault('stats') // preset 1's default
    closeAndReopen() // …so preset 1 opens on Stats Only, untouched by anyone
    setPresetAmnesic(p2.id, 'full') // and preset 2 is changed by hand
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
  })

  it('a preset switch keeps it, both ways', () => {
    const p2 = createPreset('Guest')
    boot()
    setPresetAmnesic(1, 'stats')
    setPresetAmnesic(p2.id, 'full')
    switchPreset(p2.id)
    switchPreset(1)
    reload()
    switchPreset(p2.id)
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
  })

  it('a real close returns each preset to its saved default', () => {
    const p2 = createPreset('Guest')
    switchPreset(p2.id)
    saveDefault('full') // the guest preset is SAVED as Full
    switchPreset(1)
    closeAndReopen()
    setPresetAmnesic(1, 'full') // you lend your own preset out…
    setPresetAmnesic(p2.id, 'off') // …and play in the guest one yourself
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['full', 'off'])
    closeAndReopen()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['off', 'full'])
  })

  // ★ THE VALUE IN FORCE MOVES ONLY THROUGH setPresetAmnesic. The saved default is read once, at the
  // fresh open, and the reload that follows reads the session's record — so saving or clearing
  // defaults mid-session cannot move the setting under a guest, now or at the next reload.
  it('clearing the saved defaults mid-session does not turn a guest session off — nor does the reload after', () => {
    saveDefault('full')
    closeAndReopen() // opens on Full, by default — nobody touched the pill
    expect(amnesicModeOf(1)).toBe('full')
    useUserDefaults.getState().clearDefaults()
    expect(amnesicModeOf(1)).toBe('full')
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off') // the new default, at the next fresh open
  })

  it('saving a different default mid-session does not move the value in force either', () => {
    boot()
    setPresetAmnesic(1, 'full')
    useUserDefaults.setState({
      saved: { settings: { ...useSettings.getState() }, prefs: PREFS, amnesic: false },
    })
    reload()
    expect(amnesicModeOf(1)).toBe('full')
  })

  it('a new preset starts on Off, whatever the preset you made it from is on — and is on record', () => {
    boot()
    setPresetAmnesic(1, 'full')
    const p2 = createPreset('New')
    expect(amnesicModeOf(p2.id)).toBe('off')
    expect(JSON.parse(sessionStorage.getItem(RECORD))).toEqual({ 1: 'full', [p2.id]: 'off' })
  })

  it('a deleted preset’s value leaves the record', () => {
    const p2 = createPreset('Guest')
    closeAndReopen() // a page load: every listed preset is given its value, and it is put on record
    expect(JSON.parse(sessionStorage.getItem(RECORD))).toEqual({ 1: 'off', [p2.id]: 'off' })
    setPresetAmnesic(p2.id, 'full')
    deletePreset(p2.id)
    expect(JSON.parse(sessionStorage.getItem(RECORD))).toEqual({ 1: 'off' })
  })

  // ★ THE CHANGE ITSELF WRITES NOTHING PERMANENT: not the registry, not a setting, nothing.
  it('changing the value never writes to the device', () => {
    const p2 = createPreset('Guest')
    boot()
    const before = device()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    for (const mode of ['stats', 'full', 'off', 'full']) {
      setPresetAmnesic(1, mode)
      setPresetAmnesic(p2.id, mode)
    }
    expect(setItem.mock.contexts.filter((area) => area === window.localStorage)).toHaveLength(0)
    expect(device()).toBe(before)
  })

  it('a value in the record this build does not know reads as Full; a record that is not JSON is ignored', () => {
    boot()
    sessionStorage.setItem(RECORD, JSON.stringify({ 1: 'bests-only' }))
    loadPage()
    expect(amnesicModeOf(1)).toBe('full')
    sessionStorage.setItem(RECORD, '{"1":')
    loadPage()
    expect(amnesicModeOf(1)).toBe('off') // nothing on record, nothing saved, no older flag
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE DEVICE FULL TO THE BYTE. The value used to live on the permanent registry and be put back to
// its saved default by a WRITE at every fresh open. On a full device that write — one character
// longer — was refused and held only in memory; a reload dropped it and read the stale flag back,
// so the preset stayed amnesic past a real close. Now a fresh open writes nothing.
describe('a device full to the byte', () => {
  const realSetItem = Storage.prototype.setItem
  const refuseTheDevice = () =>
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === window.localStorage)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })

  it('★ a preset left amnesic is back on its saved default after a real close — and stays there through a reload', () => {
    // Yesterday: a guest played on Full, in this build or an older one — and the older build's flag
    // for it is still TRUE on the registry.
    createPreset('Guest')
    localStorage.setItem(
      REGISTRY,
      JSON.stringify({
        state: {
          ...storedRegistry(),
          presets: storedRegistry().presets.map((p) => ({ ...p, amnesic: true })),
        },
        version: 1,
      }),
    )
    useProgress.getState().setModeStats('classic', played(7))
    boot()
    setPresetAmnesic(1, 'full')
    useProgress.getState().setModeStats('classic', played(2)) // the guest's play
    const before = device()

    refuseTheDevice() // not one more character fits
    closeAndReopen() // the app is really closed, and opened again
    expect(amnesicModeOf(1)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(7) // your own numbers
    expect(useStorageHealth.getState().unsaved).toBe(false) // nothing was even attempted
    reload() // …and the reload that used to bring the stale flag back
    expect(amnesicModeOf(1)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(7)
    reload()
    expect(amnesicModeOf(1)).toBe('off')
    expect(device()).toBe(before)
  })

  it('a guest session started on a full device still survives a reload and still ends at a close', () => {
    useProgress.getState().setModeStats('classic', played(7))
    boot()
    refuseTheDevice()
    setPresetAmnesic(1, 'full') // the value is the session's: the full device is not asked
    useProgress.getState().setModeStats('classic', played(2))
    expect(useStorageHealth.getState().unsaved).toBe(false)
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    expect(useProgress.getState().stats.classic.played).toBe(2)
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(7)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE HAND-OVER FROM AN OLDER BUILD. A guest is playing in an amnesic preset when the app updates
// itself; the reload that follows is the first time this build runs, in a session it did not start.
// It has no record of its own — and the older build's flag on the registry is the truth about that
// session (tests/sessionAmnesic.olderBuilds has what the real build left).
describe('a load inside a session this build holds no value for', () => {
  // The device and the session as the older build's guest session leaves them.
  const olderGuestSession = () => {
    useProgress.getState().setModeStats('classic', played(7)) // the owner's saved stats
    createPreset('Other') // (so a registry is on the device at all)
    const reg = storedRegistry()
    localStorage.setItem(
      REGISTRY,
      JSON.stringify({
        state: { ...reg, presets: reg.presets.map((p) => ({ ...p, amnesic: p.id === 1 })) },
        version: 1,
      }),
    )
    sessionStorage.setItem('cg-browsing-session-v1', '1')
    sessionStorage.setItem(
      progressKey(1),
      JSON.stringify({
        state: {
          ...useProgress.getState(),
          stats: { ...useProgress.getState().stats, classic: played(2) },
        },
        version: 5,
      }),
    )
  }

  it('★ the update reload: the guest stays a guest, with the session’s numbers, and nothing permanent moves', () => {
    olderGuestSession()
    const before = device()
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    expect(amnesicModeOf(2)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(2) // the guest's session, carried over
    useProgress.getState().setModeStats('classic', played(3)) // …and the guest plays on
    expect(device()).toBe(before)
    // From here on the session has a record of its own.
    expect(JSON.parse(sessionStorage.getItem(RECORD))).toEqual({ 1: 'full', 2: 'off' })
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('off') // guest mode ends with the guest
    expect(useProgress.getState().stats.classic.played).toBe(7)
  })

  // The older flag can be stale (this build never writes it), so it is weighed against the saved
  // default and THE MORE AMNESIC OF THE TWO wins: a preset wrongly left amnesic loses nothing saved.
  for (const [flag, saved, expected] of [
    [true, 'off', 'full'],
    [true, 'stats', 'full'],
    [true, 'full', 'full'],
    [false, 'off', 'off'],
    [false, 'stats', 'stats'],
    [false, 'full', 'full'],
  ])
    it(`older flag ${flag}, saved default ${saved}: ${expected}`, () => {
      saveDefault(saved)
      createPreset('Other')
      const reg = storedRegistry()
      localStorage.setItem(
        REGISTRY,
        JSON.stringify({
          state: { ...reg, presets: reg.presets.map((p) => ({ ...p, amnesic: flag })) },
          version: 1,
        }),
      )
      sessionStorage.setItem('cg-browsing-session-v1', '1') // a reload, with no record
      loadPage()
      expect(amnesicModeOf(1)).toBe(expected)
    })

  it('on a FRESH open the older flag is not consulted at all — only the saved default', () => {
    createPreset('Other')
    const reg = storedRegistry()
    localStorage.setItem(
      REGISTRY,
      JSON.stringify({
        state: { ...reg, presets: reg.presets.map((p) => ({ ...p, amnesic: true })) },
        version: 1,
      }),
    )
    closeAndReopen()
    expect([amnesicModeOf(1), amnesicModeOf(2)]).toEqual(['off', 'off'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TWO TABS. localStorage is shared by every tab of the origin (and live and staging are two tabs of
// one origin); sessionStorage is each tab's own. jsdom has one of each, so a "tab" here is its own
// copy of sessionStorage, swapped in with a page load.
describe('two tabs', () => {
  let tabs
  let current
  const switchTab = (name) => {
    tabs.set(current, { ...sessionStorage })
    sessionStorage.clear()
    for (const [key, value] of Object.entries(tabs.get(name) ?? {}))
      sessionStorage.setItem(key, value)
    current = name
    loadPage() // this tab's page, as it reads the shared device and its own session
    boot()
  }
  beforeEach(() => {
    tabs = new Map()
    current = 'A'
    boot()
  })

  it('★ each tab has its own value: one tab’s guest session does not start, or end, in the other', () => {
    useProgress.getState().setModeStats('classic', played(7))
    setPresetAmnesic(1, 'full') // tab A: a guest
    useProgress.getState().setModeStats('classic', played(2))

    switchTab('B') // a second tab opens
    expect(amnesicModeOf(1)).toBe('off') // not a guest here
    expect(useProgress.getState().stats.classic.played).toBe(7)
    setPresetAmnesic(1, 'stats') // tab B: playing around
    setPresetAmnesic(1, 'off') // …and done

    switchTab('A') // tab A reloads
    expect(amnesicModeOf(1)).toBe('full') // still the guest's
    expect(useProgress.getState().stats.classic.played).toBe(2)
    switchTab('B')
    expect(amnesicModeOf(1)).toBe('off')
  })

  it('what the shared registry still does: the list, the names, the order, the last preset, and the Open in pin', () => {
    const p2 = createPreset('Timed') // tab A
    switchTab('B')
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Preset 1', 'Timed'])
    renamePreset(p2.id, 'Sprints') // tab B renames it, and pins it
    setOpenInPreset(p2.id)
    switchTab('A') // tab A reloads: it stays on the preset it was on, and sees the rename and the pin
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Preset 1', 'Sprints'])
    expect(usePresets.getState().openInPreset).toBe(p2.id)
    expect(usePresets.getState().activeId).toBe(1)
  })

  // ★ THE OLDER BUILDS' FLAG IS CARRIED, NEVER CHANGED. An older tab switches its guest session on
  // AFTER this page loaded; this page then writes the registry for a reason of its own. It must not
  // write back the `false` it read at load — that would end the older tab's guest session at its
  // next reload, and record the guest.
  it('★ a registry write here does not undo a guest session an OLDER tab started since this page loaded', () => {
    const p2 = createPreset('Guest')
    // The older tab's own write, straight onto the shared device.
    const reg = storedRegistry()
    localStorage.setItem(
      REGISTRY,
      JSON.stringify({
        state: { ...reg, presets: reg.presets.map((p) => ({ ...p, amnesic: p.id === p2.id })) },
        version: 1,
      }),
    )
    // This page: a rename, a new preset, a switch, a pin — every kind of registry write it makes.
    renamePreset(1, 'Mine')
    createPreset('Third')
    switchPreset(p2.id)
    setOpenInPreset(1)
    expect(storedRegistry().presets.map((p) => [p.name, p.amnesic])).toEqual([
      ['Mine', false],
      ['Guest', true],
      ['Third', false],
    ])
    // …and this build's own value for that preset was never touched by any of it.
    expect(amnesicModeOf(p2.id)).toBe('off')
  })

  it('and neither direction of this build’s own pill reaches the older flag', () => {
    createPreset('Guest')
    const before = localStorage.getItem(REGISTRY)
    setPresetAmnesic(1, 'full')
    setPresetAmnesic(1, 'off')
    setPresetAmnesic(2, 'stats')
    expect(localStorage.getItem(REGISTRY)).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a browser that refuses sessionStorage', () => {
  it('holds the values in memory for the page, and its next load is a fresh open', () => {
    saveDefault('stats')
    const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      loadPage()
      boot()
      expect(amnesicModeOf(1)).toBe('stats') // the saved default
      expect(setPresetAmnesic(1, 'full')).toBe(true)
      expect(amnesicModeOf(1)).toBe('full')
      loadPage() // nothing was kept, so this is a fresh open again
      boot()
      expect(amnesicModeOf(1)).toBe('stats')
    } finally {
      if (own) Object.defineProperty(window, 'sessionStorage', own)
      else delete window.sessionStorage
    }
  })
})
