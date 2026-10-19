// @vitest-environment jsdom
//
// amnesicSetting.dom — EACH PRESET'S AMNESIC VALUE IS ONE OF ITS SETTINGS (design-q1-q2.md v4, 9; the
// owner's decision: "settings behave the same with presets").
// The value (Off / Stats Only / Full) is a field of the preset's settings doc (store/settings), and this
// file pins its whole lifecycle:
//   • a preset whose settings hold no value of their own is on its SAVED DEFAULT, and a load writes
//     nothing for it; the stored spellings read through the one reader, for every preset;
//   • the value stays - across a reload, a preset switch, AND a real close (9.6) - until somebody
//     changes it; changing it writes the setting and nothing else permanent;
//   • Save Defaults and Clear Saved Defaults never move the value a preset is on;
//   • a new preset is on its own saved default (none: Off), a duplicate on the original's value;
//   • another window's change of it comes in at once and does here what the pill does (9.2); an older
//     build's save, which drops the field, leaves it standing;
//   • the one hand-over (9.5): a v2.28-v2.29 tab's session record, read at the first load only;
//   • a full device, and a browser that refuses sessionStorage.
// What the value DOES to saved progress is tests/amnesic.dom's; what the older builds were observed
// doing with their own spellings is tests/amnesic.olderBuilds'.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePresets, presetKey, PRESET_STORE_KEYS } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  duplicatePreset,
  setPresetAmnesic,
} from '../src/store/presetControl.js'
import { amnesicModeOf, activeDataId } from '../src/store/amnesic.js'
import { openBrowsingSession } from '../src/store/browsingSession.js'
import { useSettings, SETTINGS_DOC, usePresetAmnesics } from '../src/store/settings.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { useStorageHealth } from '../src/store/storageHealth.js'
import { resetAppState } from './helpers/settingsPanel.jsx'
import { loadPage, closeApp } from './helpers/pageLoad.js'
import { otherWindow } from './helpers/otherWindow.js'

const HANDED_OVER = 'cg-amnesic-v1'
const PREFS = { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '10' }
const settingsKey = (id) => presetKey(PRESET_STORE_KEYS.settings, id)
const defaultsKey = (id) => presetKey(PRESET_STORE_KEYS.userDefaults, id)
const reload = () => {
  loadPage()
  openBrowsingSession()
}
const closeAndReopen = () => {
  closeApp()
  reload()
}
// Everything on the device, every key — "a load writes nothing" is a claim about bytes.
const device = () => JSON.stringify(Object.entries({ ...localStorage }).sort())
// The value as a preset's settings doc holds it (undefined: none of its own).
const storedField = (id) => JSON.parse(localStorage.getItem(settingsKey(id)) ?? '{}').state?.amnesic
// Save the ACTIVE preset's defaults with this Amnesic value — the ⚙ panel's own call.
const saveDefault = (amnesic) =>
  useUserDefaults.getState().saveDefaults({
    settings: { ...useSettings.getState() },
    prefs: PREFS,
    amnesic,
  })
// A saved-defaults snapshot put on the device as some build spelled it.
const seedDefaults = (id, amnesicFields) =>
  localStorage.setItem(
    defaultsKey(id),
    JSON.stringify({
      state: { saved: { settings: { ...useSettings.getState() }, prefs: PREFS, ...amnesicFields } },
      version: 3,
    }),
  )
const played = (n) => ({ played: n, good: n, streak: n, best: n, times: [] })

beforeEach(() => {
  resetAppState()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a preset whose settings hold no value of their own is on its saved default', () => {
  it('nothing saved: Off', () => {
    reload()
    expect(amnesicModeOf(1)).toBe('off')
  })

  for (const mode of ['stats', 'full'])
    it(`a default saved as ${mode} — for the preset you are on AND for one you are not`, () => {
      const p2 = createPreset()
      seedDefaults(1, { amnesic: true, amnesicMode: mode })
      seedDefaults(p2.id, { amnesic: true, amnesicMode: mode })
      localStorage.removeItem(settingsKey(1))
      reload()
      expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual([mode, mode])
    })

  it('each preset reads its OWN default, not the active one’s', () => {
    const p2 = createPreset()
    seedDefaults(p2.id, { amnesic: true, amnesicMode: 'stats' })
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['off', 'stats'])
  })

  for (const [label, fields, expected] of [
    ['this build’s two fields', { amnesic: true, amnesicMode: 'stats' }, 'stats'],
    ['an older build’s boolean, true', { amnesic: true }, 'full'],
    ['an older build’s boolean, false', { amnesic: false }, 'off'],
    ['a kind this build does not know', { amnesic: true, amnesicMode: 'later' }, 'full'],
  ])
    it(`the saved spelling — ${label} — reads as ${expected}, for the active preset and another`, () => {
      const p2 = createPreset()
      seedDefaults(1, fields)
      seedDefaults(p2.id, fields)
      localStorage.removeItem(settingsKey(1))
      reload()
      expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual([expected, expected])
    })

  it('a load writes nothing for it — not one byte of the device changes', () => {
    seedDefaults(1, { amnesic: true, amnesicMode: 'full' })
    localStorage.removeItem(settingsKey(1))
    const before = device()
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('full')
    expect(device()).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the value stays until somebody changes it', () => {
  it('a reload, a preset switch, and a REAL CLOSE all keep every preset’s value', () => {
    const p2 = createPreset()
    setPresetAmnesic(1, 'stats')
    setPresetAmnesic(p2.id, 'full')
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
    switchPreset(p2.id)
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
    switchPreset(1)
    closeAndReopen()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['stats', 'full'])
  })

  it('a real close ends the session’s numbers, and the preset is still on its value', () => {
    useProgress.getState().setModeStats('classic', played(7))
    setPresetAmnesic(1, 'full')
    useProgress.getState().setModeStats('classic', played(2)) // the guest's play
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('full')
    expect(useProgress.getState().stats.classic.played).toBe(0) // a new session
    setPresetAmnesic(1, 'off')
    expect(useProgress.getState().stats.classic.played).toBe(7) // your own, untouched
  })

  it('changing it writes the setting into the preset’s settings, and nothing else permanent', () => {
    const p2 = createPreset()
    useProgress.getState().setModeStats('classic', played(7))
    const others = () =>
      JSON.stringify(
        Object.entries({ ...localStorage })
          .filter(([k]) => !k.includes(PRESET_STORE_KEYS.settings))
          .sort(),
      )
    const before = others()
    setPresetAmnesic(1, 'stats')
    setPresetAmnesic(p2.id, 'full') // (a preset you are not on: into its own doc)
    expect([storedField(1), storedField(p2.id)]).toEqual(['stats', 'full'])
    expect(others()).toBe(before)
  })

  it('the value you are already on changes nothing; an unknown preset is refused', () => {
    setPresetAmnesic(1, 'stats')
    const before = device()
    expect(setPresetAmnesic(1, 'stats')).toBe(false)
    expect(setPresetAmnesic(99, 'full')).toBe(false)
    expect(device()).toBe(before)
  })

  it('a value in the settings this build does not know reads as Full', () => {
    const p2 = createPreset()
    for (const id of [1, p2.id]) {
      const key = settingsKey(id)
      const doc = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":4}')
      localStorage.setItem(
        key,
        JSON.stringify({ ...doc, state: { ...doc.state, amnesic: 'later' } }),
      )
    }
    reload()
    expect([amnesicModeOf(1), amnesicModeOf(p2.id)]).toEqual(['full', 'full'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the saved default never moves the value a preset is on', () => {
  it('Clear Saved Defaults on a preset that is on its saved Stats Only: it stays on Stats Only', () => {
    seedDefaults(1, { amnesic: true, amnesicMode: 'stats' })
    localStorage.removeItem(settingsKey(1))
    reload()
    expect(amnesicModeOf(1)).toBe('stats')
    useUserDefaults.getState().clearDefaults()
    expect(amnesicModeOf(1)).toBe('stats')
    expect(storedField(1)).toBe('stats') // written down before the default moved
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('stats')
  })

  it('saving a different default does not move the value in force either', () => {
    setPresetAmnesic(1, 'full')
    saveDefault('stats') // (a snapshot made elsewhere - the manager's own Save keeps it, say)
    expect(amnesicModeOf(1)).toBe('full')
    reload()
    expect(amnesicModeOf(1)).toBe('full')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('new presets', () => {
  it('a new preset is on its own saved default — Off — whatever the preset you made it from is on', () => {
    setPresetAmnesic(1, 'full')
    const p2 = createPreset()
    expect(amnesicModeOf(p2.id)).toBe('off')
    expect(storedField(p2.id)).toBeUndefined() // (nothing written for it)
  })

  it('a duplicate is on the original’s value', () => {
    setPresetAmnesic(1, 'stats')
    const copy = duplicatePreset(1)
    expect(amnesicModeOf(copy.id)).toBe('stats')
  })

  it('a deleted preset’s value goes with its settings', () => {
    const p2 = createPreset()
    setPresetAmnesic(p2.id, 'full')
    deletePreset(p2.id)
    expect(localStorage.getItem(settingsKey(p2.id))).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TWO WINDOWS (9.2). "Another window" is a second windows-in-sync door over the same device
// (tests/helpers/otherWindow), its storage events delivered by hand.
describe('another window', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('its change comes in at once and does here what the pill does: this window’s session starts', () => {
    useProgress.getState().setModeStats('classic', played(7))
    const data = activeDataId()
    const W = otherWindow()
    W.save(SETTINGS_DOC, { amnesic: 'full' })
    W.deliver()
    expect(amnesicModeOf(1)).toBe('full')
    expect(activeDataId()).not.toBe(data) // the screens remount on the copy now in use
    expect(useProgress.getState().stats.classic.played).toBe(0) // this window's own session
    // …and back, from there: your own numbers, untouched
    W.save(SETTINGS_DOC, { amnesic: 'off' })
    W.deliver()
    expect(amnesicModeOf(1)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(7)
  })

  it('an older build’s save of the settings drops the field — and the value stands', () => {
    setPresetAmnesic(1, 'stats')
    const W = otherWindow()
    W.olderSave(settingsKey(1), ({ amnesic: _dropped, ...state }) => ({ ...state, minY: 1600 }))
    W.deliver()
    expect(useSettings.getState().minY).toBe(1600) // its own change is taken
    expect(amnesicModeOf(1)).toBe('stats')
  })

  it('another window’s change for a preset this window is not on is seen in the lists here', () => {
    const p2 = createPreset()
    expect(usePresetAmnesics.getState().modes[p2.id]).toBe('off')
    localStorage.setItem(
      settingsKey(p2.id),
      JSON.stringify({ state: { amnesic: 'stats' }, version: 4 }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: settingsKey(p2.id) }))
    expect(usePresetAmnesics.getState().modes[p2.id]).toBe('stats')
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE HAND-OVER (9.5). A guest is playing in a v2.28.0-v2.29.x tab when it updates itself; the
// reload that follows is this build's first load, in a session the older build started - its record of
// each preset's value (`cg-amnesic-v1`) still there.
describe('the hand-over from a v2.28-v2.29 tab’s session', () => {
  const olderGuestSession = () => {
    useProgress.getState().setModeStats('classic', played(7)) // the owner's saved stats
    const p2 = createPreset('Other')
    // The guest's session copy, where that build kept it (and where this build's Full reads it).
    sessionStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, 1),
      JSON.stringify({
        state: { stats: { ...useProgress.getState().stats, classic: played(2) } },
        version: 5,
      }),
    )
    sessionStorage.setItem(HANDED_OVER, JSON.stringify({ 1: 'full', [p2.id]: 'off' }))
    sessionStorage.setItem('cg-browsing-session-v1', '1')
    return p2
  }

  it('★ the guest stays a guest, with the session’s numbers — the value written as the preset’s setting, the record gone', () => {
    const p2 = olderGuestSession()
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    expect(amnesicModeOf(p2.id)).toBe('off')
    expect(useProgress.getState().stats.classic.played).toBe(2) // the guest's session, carried over
    expect(storedField(1)).toBe('full')
    expect(storedField(p2.id)).toBeUndefined() // (the same as its own: nothing written)
    expect(sessionStorage.getItem(HANDED_OVER)).toBeNull()
    // …and it is a setting from here on: a real close keeps it
    closeAndReopen()
    expect(amnesicModeOf(1)).toBe('full')
  })

  it('at the first load only: a later load finds no record and changes nothing', () => {
    olderGuestSession()
    reload()
    setPresetAmnesic(1, 'off')
    sessionStorage.setItem('cg-browsing-session-v1', '1')
    const before = device()
    reload()
    expect(amnesicModeOf(1)).toBe('off')
    expect(device()).toBe(before)
  })

  it('a record that says what the preset is already on writes nothing', () => {
    useProgress.getState().setModeStats('classic', played(7))
    sessionStorage.setItem(HANDED_OVER, JSON.stringify({ 1: 'off' }))
    const before = device()
    reload()
    expect(device()).toBe(before)
    expect(sessionStorage.getItem(HANDED_OVER)).toBeNull()
  })

  it('a record value this build does not know is handed over as Full; a record that is not JSON is dropped', () => {
    sessionStorage.setItem(HANDED_OVER, JSON.stringify({ 1: 'later' }))
    reload()
    expect(amnesicModeOf(1)).toBe('full')
    setPresetAmnesic(1, 'off')
    sessionStorage.setItem(HANDED_OVER, '{not json')
    reload()
    expect(amnesicModeOf(1)).toBe('off')
    expect(sessionStorage.getItem(HANDED_OVER)).toBeNull()
  })

  it('the registry flag an older build kept is carried and never read', () => {
    createPreset('Other')
    const reg = JSON.parse(localStorage.getItem('cg-presets-v1')).state
    localStorage.setItem(
      'cg-presets-v1',
      JSON.stringify({
        state: { ...reg, presets: reg.presets.map((p) => ({ ...p, amnesic: true })) },
        version: 1,
      }),
    )
    closeAndReopen()
    expect([amnesicModeOf(1), amnesicModeOf(2)]).toEqual(['off', 'off'])
    expect(usePresets.getState().presets.every((p) => p.amnesic === true)).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a full device, and a browser that refuses sessionStorage', () => {
  it('a change the device refuses is in force here, held, and saved when there is room', () => {
    const realSetItem = Storage.prototype.setItem
    let full = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full && this === window.localStorage)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })
    setPresetAmnesic(1, 'full')
    expect(amnesicModeOf(1)).toBe('full')
    expect(useStorageHealth.getState().unsaved).toBe(true)
    full = false
    useSettings.getState().setMinY(1600) // any save that fits
    expect(storedField(1)).toBe('full')
    expect(useStorageHealth.getState().unsaved).toBe(false)
  })

  it('a browser that refuses sessionStorage still keeps the value: it is a setting', () => {
    const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      setPresetAmnesic(1, 'stats')
      expect(amnesicModeOf(1)).toBe('stats')
      loadPage()
      expect(amnesicModeOf(1)).toBe('stats')
    } finally {
      if (own) Object.defineProperty(window, 'sessionStorage', own)
      else delete window.sessionStorage
    }
  })
})
