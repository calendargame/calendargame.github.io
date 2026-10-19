// @vitest-environment jsdom
//
// presetDuplicate.dom — DUPLICATE PRESET (Round 26, Q5), store/presetControl's duplicatePreset, and
// the guard on what it copies.
//
// What a copy holds is ONE list, store/presetControl's DUPLICATE_RULES: every part of a preset —
// its four stores and the browsing session's per-preset parts — with one answer each. The last
// describe below is the guard that keeps that list whole: it fills a preset's every part, finds
// every key the device then holds for it, and fails on any key no part of the list owns. A new
// kind of per-preset key — a fifth store, or a store's own sync record beside its save — fails
// here until DUPLICATE_RULES says whether a copy carries it.
import { isSyncKey, syncKeyOf } from '../src/store/syncedDoc.js'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  usePresets,
  presetKey,
  copyName,
  makePresetRegistryDefaults,
  PRESET_STORE_KEYS,
  PRESET_REGISTRY_KEY,
} from '../src/store/presets.js'
import {
  createPreset,
  duplicatePreset,
  switchPreset,
  setPresetAmnesic,
  DUPLICATE_RULES,
} from '../src/store/presetControl.js'
import { amnesicModeOf } from '../src/store/amnesic.js'
import { openBrowsingSession, forgetBrowsingSession } from '../src/store/browsingSession.js'
import { writeSessionMode } from '../src/store/sessionMode.js'
import { writeSessionDedType } from '../src/store/sessionDedType.js'
import { writeSessionRound } from '../src/store/sessionRound.js'
import { writeSessionHistory } from '../src/store/sessionHistory.js'
import { parseTimesKey } from '../src/store/progressStorage.js'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'

const PLAYED = { played: 5, good: 3, streak: 2, best: 2, times: [1200, 900] }

function resetAll() {
  localStorage.clear()
  sessionStorage.clear()
  usePresets.setState(makePresetRegistryDefaults())
  useSettings.getState().resetToFactory()
  useModePrefs.getState().resetModePrefs()
  useProgress.getState().resetProgress()
  useUserDefaults.getState().clearDefaults()
  useSettings.setState({ amnesic: 'off' })
  localStorage.clear()
  sessionStorage.clear()
}
beforeEach(() => {
  vi.restoreAllMocks()
  resetAll()
})

// Settings, per-mode choices, saved defaults, and stats, all set away from their factory values
// on the preset that is on screen.
function setUpThisPreset() {
  useSettings.getState().setUseSystem(false)
  useSettings.getState().setManualTheme('nebula')
  useSettings.getState().setMinY(1700)
  useSettings.getState().setDefaultMode('blitz')
  useModePrefs.getState().setDedType('year')
  useModePrefs.getState().setBlitzPerQ(true)
  useModePrefs.getState().setBlitzSec(45)
  useProgress.getState().setModeStats('classic', PLAYED)
  useUserDefaults.getState().saveDefaults({
    settings: { ...useSettings.getState() },
    prefs: { flashMs: 800, blitzSec: 45, blitzQSec: 20, aoxN: '25' },
    amnesic: 'stats',
  })
}
const names = () => usePresets.getState().presets.map((p) => p.name)
const saved = (base, id) => JSON.parse(localStorage.getItem(presetKey(base, id)) ?? 'null')

describe('a copy\'s name — " (2)", or " (#)" counted on, to the next number no preset has', () => {
  const none = new Set()
  it('names a copy after its original', () => {
    expect(copyName('Speed', none)).toBe('Speed (2)')
    expect(copyName('Preset 1', none)).toBe('Preset 1 (2)')
    expect(copyName('Speed (2)', none)).toBe('Speed (3)')
    expect(copyName('Speed (9)', none)).toBe('Speed (10)')
    expect(copyName('Speed (2)', new Set(['Speed (3)', 'Speed (4)']))).toBe('Speed (5)')
    expect(copyName('Speed', new Set(['Speed (2)']))).toBe('Speed (3)')
  })
  it('counts on only from a whole number in brackets at the very end, after a space', () => {
    for (const [name, copy] of [
      ['Speed (0)', 'Speed (0) (2)'],
      ['Speed (02)', 'Speed (02) (2)'],
      ['Speed(2)', 'Speed(2) (2)'],
      ['Speed (2) ', 'Speed (2)  (2)'],
      ['Speed (x)', 'Speed (x) (2)'],
      ['(2)', '(2) (2)'],
      [' (2)', ' (3)'],
    ])
      expect(copyName(name, none), name).toBe(copy)
  })
  it('a number too big for an ordinary one still counts on by exactly one', () => {
    expect(copyName('Speed (99999999999999999999)', none)).toBe('Speed (100000000000000000000)')
  })
})

describe('Duplicate Preset', () => {
  it('copies the settings, the per-mode choices, the saved defaults, and the Amnesic value — not the stats', () => {
    openBrowsingSession()
    try {
      usePresets.getState().applyRegistry({
        ...usePresets.getState(),
        presets: [{ id: 1, name: 'Speed', amnesic: false }],
      })
      setUpThisPreset()
      setPresetAmnesic(1, 'full')
      const copy = duplicatePreset(1)
      expect(copy).toMatchObject({ name: 'Speed (2)' })
      // Not switched to, and placed right after its original.
      expect(usePresets.getState().activeId).toBe(1)
      expect(names()).toEqual(['Speed', 'Speed (2)'])
      expect(amnesicModeOf(copy.id)).toBe('full')
      // What it holds, seen by opening it.
      switchPreset(copy.id)
      expect(useSettings.getState()).toMatchObject({
        manualTheme: 'nebula',
        minY: 1700,
        defaultMode: 'blitz',
        useSystem: false,
      })
      expect(useModePrefs.getState()).toMatchObject({
        dedType: 'year',
        blitzPerQ: true,
        blitzSec: 45,
      })
      expect(useUserDefaults.getState().saved).toMatchObject({
        prefs: { flashMs: 800, blitzSec: 45, blitzQSec: 20, aoxN: '25' },
      })
      expect(useProgress.getState().stats.classic.played).toBe(0)
      expect(localStorage.getItem(presetKey(PRESET_STORE_KEYS.progress, copy.id))).toBeNull()
    } finally {
      forgetBrowsingSession()
    }
  })

  it('the saved Amnesic default goes across with the saved defaults', () => {
    setUpThisPreset()
    const copy = duplicatePreset(1)
    // (As saved: the live snapshot is the settings store's whole state, its setters included.)
    expect(saved(PRESET_STORE_KEYS.userDefaults, copy.id).state.saved).toEqual(
      JSON.parse(JSON.stringify(useUserDefaults.getState().saved)),
    )
    expect(saved(PRESET_STORE_KEYS.userDefaults, copy.id).state.saved.amnesicMode).toBe('stats')
  })

  it('the preset you are ON is copied as it is on screen, not as it was last saved', () => {
    setUpThisPreset()
    // A save the device refused would be held, not on disk: the copy takes what is live.
    useModePrefs.setState({ blitzSec: 30 }) // through the store, so persisted too…
    const copy = duplicatePreset(1)
    expect(saved(PRESET_STORE_KEYS.modePrefs, copy.id).state.blitzSec).toBe(30)
    expect(saved(PRESET_STORE_KEYS.modePrefs, copy.id).version).toBe(
      useModePrefs.persist.getOptions().version,
    )
  })

  it('a preset you are NOT on is copied as it is saved — in the shape it was saved in', () => {
    const other = createPreset('Other')
    switchPreset(other.id)
    setUpThisPreset()
    switchPreset(1)
    // An older build saved its settings at an older version: the copy keeps that, so the store's
    // own migration runs on it when it is opened, exactly as it would on the original.
    const old = { state: { ...SETTINGS_DEFAULTS, rotateDots: true, minY: 1650 }, version: 2 }
    delete old.state.dotRotation
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, other.id), JSON.stringify(old))
    const copy = duplicatePreset(other.id)
    expect(saved(PRESET_STORE_KEYS.settings, copy.id)).toEqual(old)
    expect(saved(PRESET_STORE_KEYS.modePrefs, copy.id).state).toEqual({
      ...MODE_PREFS_DEFAULTS,
      dedType: 'year',
      blitzPerQ: true,
      blitzSec: 45,
    })
    expect(names()).toEqual(['Preset 1', 'Other', 'Other (2)'])
    switchPreset(copy.id)
    expect(useSettings.getState().minY).toBe(1650)
    expect(useProgress.getState().stats.classic.played).toBe(0)
  })

  it('a store with nothing saved is not written: the copy has its factory values there, as the original does', () => {
    const fresh = createPreset('Fresh')
    const copy = duplicatePreset(fresh.id)
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(presetKey(base, copy.id)), base).toBeNull()
  })

  it('copies of copies count on, and the next free number is taken', () => {
    usePresets.getState().applyRegistry({
      ...usePresets.getState(),
      presets: [{ id: 1, name: 'Speed', amnesic: false }],
    })
    duplicatePreset(1)
    duplicatePreset(1)
    const second = usePresets.getState().presets[1]
    duplicatePreset(second.id)
    expect(names()).toEqual(['Speed', 'Speed (3)', 'Speed (4)', 'Speed (2)'])
  })

  it('an unknown preset is not copied', () => {
    const before = localStorage.getItem(PRESET_REGISTRY_KEY)
    expect(duplicatePreset(99)).toBe('unknown')
    expect(localStorage.getItem(PRESET_REGISTRY_KEY)).toBe(before)
  })

  it('a copy the device has no room for is refused whole — no store, no list entry, nothing held', () => {
    setUpThisPreset()
    const before = { ...localStorage }
    const registry = usePresets.getState()
    // The third write of the copy is refused: two of its stores are on the device by then.
    let writes = 0
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.includes('~p2') && ++writes === 3)
        throw new DOMException('no room', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    expect(duplicatePreset(1)).toBe('no-room')
    expect({ ...localStorage }).toEqual(before)
    expect(usePresets.getState().presets).toBe(registry.presets)
    expect(amnesicModeOf(2)).toBe('off')
  })

  it('…and so is one whose LIST ENTRY does not fit — the stores written for it are taken away again', () => {
    setUpThisPreset()
    const before = { ...localStorage }
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === PRESET_REGISTRY_KEY) throw new DOMException('no room', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    expect(duplicatePreset(1)).toBe('no-room')
    expect({ ...localStorage }).toEqual(before)
    expect(names()).toEqual(['Preset 1'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('THE GUARD: every per-preset key has an answer in DUPLICATE_RULES', () => {
  it('every per-preset store has one (also a compile-time `satisfies` — this is the runtime half)', () => {
    for (const name of Object.keys(PRESET_STORE_KEYS))
      expect(DUPLICATE_RULES, name).toHaveProperty(name)
  })

  it('a preset with every part filled holds no key that no part owns', () => {
    openBrowsingSession()
    try {
      const p = createPreset('Full').id
      switchPreset(p)
      // Every part of preset `p`, filled through the app's own doors.
      setUpThisPreset() // settings, modePrefs, progress, userDefaults
      setPresetAmnesic(p, 'stats') // the Amnesic value (a setting)…
      useProgress.getState().setModeStats('flash', PLAYED) // …and its session stats
      writeSessionMode(p, 'flash')
      writeSessionDedType(p, 'month')
      writeSessionRound(`${p}:saved`, 'blitz', { engine: {} })
      writeSessionHistory(`${p}:stats`, 'classic', '{"h":[]}')

      // Which part of preset `p` a key is — or null. (The ownership rule each part's own module
      // writes by: the four stores' keys and their solve-time chunks; and the session's.)
      const STORE_PARTS = Object.entries(PRESET_STORE_KEYS)
      const partOf = (area, key) => {
        // A doc's windows-in-sync key (store/syncedDoc) belongs to whatever its doc belongs to.
        if (area === 'local' && isSyncKey(key)) return partOf(area, key.slice(syncKeyOf('').length))
        if (area === 'local') {
          for (const [name, base] of STORE_PARTS) if (key === presetKey(base, p)) return name
          if (parseTimesKey(key)?.presetId === p) return 'progress'
          return null
        }
        if (key === presetKey(PRESET_STORE_KEYS.progress, p)) return 'sessionStats'
        if (parseTimesKey(key)?.presetId === p) return 'sessionStats'
        if (key === 'cg-session-mode-v1') return 'sessionPage'
        if (key === 'cg-session-dedtype-v1') return 'sessionDedType'
        if (key === 'cg-round-v2') return 'sessionRounds'
        if (key.startsWith(`cg-history-v1:${p}:`)) return 'sessionHistories'
        return null
      }
      // The keys that belong to no preset at all.
      const GLOBAL = {
        local: [PRESET_REGISTRY_KEY, syncKeyOf(PRESET_REGISTRY_KEY)],
        session: ['cg-browsing-session-v1', 'cg-session-preset-v1'],
      }
      const unowned = []
      const owned = new Set()
      for (const [area, storage] of [
        ['local', localStorage],
        ['session', sessionStorage],
      ])
        for (const key of Object.keys(storage)) {
          if (GLOBAL[area].includes(key)) continue
          // Preset 1's untouched keys are not this preset's business.
          if (area === 'local' && Object.values(PRESET_STORE_KEYS).includes(key)) continue
          const part = partOf(area, key)
          if (part === null || !(part in DUPLICATE_RULES)) unowned.push(`${area}: ${key}`)
          else owned.add(part)
        }
      expect(unowned).toEqual([])
      // …and the fill really did reach every part, or this would be a guard over nothing.
      expect([...owned].sort()).toEqual(Object.keys(DUPLICATE_RULES).sort())
    } finally {
      forgetBrowsingSession()
    }
  })
})
