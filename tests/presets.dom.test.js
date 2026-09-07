// @vitest-environment jsdom
//
// presets.dom.test.js — THE PRESET REGISTRY AND PER-PRESET STORAGE, against real (jsdom)
// localStorage, end to end.
//
// The behaviour net in tests/persistence.dom.test.jsx is the OTHER half of this gate and the two
// have opposite rules. That file may not name a localStorage key, because it pins what the app
// promises a player and must survive any namespacing scheme. THIS file is the one place that knows
// how the keys are spelled — it is testing the spelling — and one case below writes the four base
// strings out as LITERALS on purpose: "preset 1 keeps the existing key, unchanged" is the promise
// the whole design rests on, and a case that derived the key from the same constant it is checking
// would pass no matter what that constant said.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  usePresets,
  presetKey,
  normalizeRegistry,
  makePresetRegistryDefaults,
  PRESET_STORE_KEYS,
  FIRST_PRESET_ID,
  MAX_PRESET_NAME,
} from '../src/store/presets.js'
import {
  createPreset,
  renamePreset,
  movePreset,
  switchPreset,
  deletePreset,
  activePreset,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import { useUserDefaults } from '../src/store/userDefaults.js'

const PLAYED = { played: 5, good: 3, streak: 2, best: 2, times: [1200, 900] }
const AOX_KEY = '10|false|numeric-ymd|random|random|random|1583-10000|true'
const AOX_REC = { avg: 1.5, avgMed: 1.4, avgRoundId: 1, med: 1.4, medAvg: 1.5, medRoundId: 1 }

// A device that has never been played on and has never seen presets: nothing saved, one preset.
function resetAll() {
  localStorage.clear()
  usePresets.setState(makePresetRegistryDefaults())
  useSettings.getState().resetToFactory()
  useModePrefs.getState().resetModePrefs()
  useProgress.getState().resetProgress()
  useUserDefaults.getState().clearDefaults()
  localStorage.clear()
}

// Put something distinguishable in ALL FOUR kinds of saved data, through the stores' own setters —
// a payload the app never wrote would be no evidence about what a preset owns.
function playOnThisPreset({ minY = 1583, blitzSec = 45, theme = 'nebula' } = {}) {
  useSettings.getState().setMinY(minY)
  useSettings.getState().setUseSystem(false)
  useSettings.getState().setManualTheme(theme)
  useModePrefs.getState().setBlitzSec(blitzSec)
  useProgress.getState().setModeStats('classic', PLAYED)
  useProgress.getState().setAoxBest({ [AOX_KEY]: AOX_REC })
  useUserDefaults.getState().saveDefaults({
    settings: { ...useSettings.getState() },
    prefs: { flashMs: 800, blitzSec, blitzQSec: 20, aoxN: '25' },
  })
}

// What all four stores are holding right now, in one comparable shape.
const snapshotLive = () => ({
  minY: useSettings.getState().minY,
  manualTheme: useSettings.getState().manualTheme,
  blitzSec: useModePrefs.getState().blitzSec,
  classicPlayed: useProgress.getState().stats.classic.played,
  aoxBest: useProgress.getState().aoxBest[AOX_KEY],
  savedDefaults: useUserDefaults.getState().saved,
})

// A genuine cold start on whatever is in storage — the module registry is dropped, so every store
// (the registry included) is built again and hydrates from disk.
// ⚠ The handles it returns are NOT the statically-imported singletons the rest of this file uses.
async function reopenApp() {
  vi.resetModules()
  const [presets, control, settings, modePrefs, progress, userDefaults] = await Promise.all([
    import('../src/store/presets.js'),
    import('../src/store/presetControl.js'),
    import('../src/store/settings.js'),
    import('../src/store/modePrefs.js'),
    import('../src/store/progress.js'),
    import('../src/store/userDefaults.js'),
  ])
  return {
    usePresets: presets.usePresets,
    control,
    settings: settings.useSettings,
    modePrefs: modePrefs.useModePrefs,
    progress: progress.useProgress,
    userDefaults: userDefaults.useUserDefaults,
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ PRESET 1 IS THE EXISTING DATA. Not "preset 1 receives the existing data" — there is no copy
// step anywhere in this design, and these are the cases that say so.
describe('preset 1 is the data that was already there', () => {
  beforeEach(resetAll)

  // THE LITERALS CASE. The four strings below are the keys shipped builds have been writing since
  // before presets existed. If a future change makes this case fail, it has broken every device
  // that has ever played the game — and, because live and staging share one browser origin, it has
  // broken them in a way that only shows when an old build and a new one interleave.
  it('the four stores still write the four keys shipped builds have always written', () => {
    playOnThisPreset()
    expect(localStorage.getItem('cg-settings-v1')).not.toBeNull()
    expect(localStorage.getItem('cg-modeprefs-v1')).not.toBeNull()
    expect(localStorage.getItem('cg-progress-v1')).not.toBeNull()
    expect(localStorage.getItem('cg-userdefaults-v1')).not.toBeNull()
    // …and nothing else. In particular no per-preset copy and no registry entry: a device on
    // preset 1 that has never created a second one is byte-for-byte a device that has never heard
    // of presets.
    expect(Object.keys(localStorage).sort()).toEqual([
      'cg-modeprefs-v1',
      'cg-progress-v1',
      'cg-settings-v1',
      'cg-userdefaults-v1',
    ])
  })

  // The namespacing rule as an IDENTITY rather than a special case — the single expression a
  // reader can check the "no migration" claim against.
  it("preset 1's key is the base key itself; every other preset's is derived and distinct", () => {
    for (const base of Object.values(PRESET_STORE_KEYS)) {
      expect(presetKey(base, FIRST_PRESET_ID)).toBe(base)
      expect(presetKey(base, 2)).not.toBe(base)
      expect(presetKey(base, 2)).toContain(base)
      expect(presetKey(base, 2)).not.toBe(presetKey(base, 3))
    }
    // No namespaced key can ever collide with another store's base key.
    const bases = new Set(Object.values(PRESET_STORE_KEYS))
    for (const base of bases)
      for (const id of [2, 3, 9]) expect(bases.has(presetKey(base, id))).toBe(false)
  })

  // MATERIALISATION on a device that has never seen presets: exactly one preset, and NOTHING
  // touched. This is the case the whole "no migration" decision buys — there is no copy to
  // half-finish, so there is no state in which the device is partly migrated.
  it('a device that has never seen presets comes up as one preset, with its data untouched', async () => {
    playOnThisPreset()
    const before = { ...localStorage }
    localStorage.removeItem('cg-presets-v1') // belt and braces: no registry has ever been written
    const fresh = await reopenApp()
    const reg = fresh.usePresets.getState()
    // ⚠ `amnesic: false` is part of the claim, not noise: a device that has never seen presets
    // must come up with its stats PERMANENT, which is the behaviour every build before amnesic had.
    expect(reg.presets).toEqual([{ id: 1, name: 'Preset 1', amnesic: false }])
    expect(reg.activeId).toBe(1)
    // The data is all still there, read through the freshly-built stores…
    expect(fresh.settings.getState().minY).toBe(1583)
    expect(fresh.modePrefs.getState().blitzSec).toBe(45)
    expect(fresh.progress.getState().stats.classic).toEqual(PLAYED)
    expect(fresh.userDefaults.getState().saved.prefs.aoxN).toBe('25')
    // …and storage is byte-for-byte what it was. Materialising a registry wrote nothing, because a
    // default registry says nothing a missing one does not already say.
    expect({ ...localStorage }).toEqual(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the registry', () => {
  beforeEach(resetAll)

  it('survives a cold start once there is something to remember', async () => {
    const p2 = createPreset('Timed')
    switchPreset(p2.id)
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().presets).toEqual([
      { id: 1, name: 'Preset 1', amnesic: false },
      { id: 2, name: 'Timed', amnesic: false },
    ])
    expect(fresh.usePresets.getState().activeId).toBe(2)
  })

  // The registry is read from the same untrusted localStorage everything else is, and the stakes
  // are higher than anywhere else in the app: an activeId naming a preset that does not exist
  // would point the storage adapter at a namespace nothing owns, and the player would open a blank
  // app with their real data still on disk and no way to reach it.
  it('a corrupt or tampered registry is screened into something the app can open', () => {
    expect(normalizeRegistry(undefined)).toEqual(makePresetRegistryDefaults())
    expect(normalizeRegistry({ presets: [] })).toEqual(makePresetRegistryDefaults())
    expect(normalizeRegistry({ presets: 'nope' })).toEqual(makePresetRegistryDefaults())
    // An activeId naming nobody falls back to the first listed preset.
    expect(
      normalizeRegistry({ presets: [{ id: 4, name: 'A' }], activeId: 9, nextId: 5 }).activeId,
    ).toBe(4)
    // Duplicate and impossible ids are dropped; the first spelling of an id wins.
    expect(
      normalizeRegistry({
        presets: [
          { id: 2, name: 'A', amnesic: 'yes' },
          { id: 2, name: 'B' },
          { id: 0, name: 'C' },
          { id: 1.5, name: 'D' },
        ],
        activeId: 2,
        nextId: 3,
      }).presets,
      // ⚠ THE AMNESIC FLAG IS SCREENED TOO, and a truthy string is the case that matters: this
      // field decides which STORAGE AREA a preset's stats are read from, so a tampered payload
      // must not be able to point a preset at a session copy it never had. Only `true` is true.
    ).toEqual([{ id: 2, name: 'A', amnesic: false }])
    // ★ nextId is forced above every listed id whatever the payload claimed — the line that makes
    // "ids are never reused" true even after tampering, and the one deleting preset 1 rests on.
    expect(
      normalizeRegistry({ presets: [{ id: 7, name: 'A' }], activeId: 7, nextId: 2 }).nextId,
    ).toBe(8)
    expect(
      normalizeRegistry({ presets: [{ id: 7, name: 'A' }], activeId: 7, nextId: 99 }).nextId,
    ).toBe(99)
    // Names are trimmed, capped and never empty.
    expect(
      normalizeRegistry({ presets: [{ id: 2, name: '   ' }], activeId: 2 }).presets[0].name,
    ).toBe('Preset 2')
    expect(
      normalizeRegistry({ presets: [{ id: 2, name: 'x'.repeat(80) }], activeId: 2 }).presets[0]
        .name,
    ).toHaveLength(MAX_PRESET_NAME)
  })

  it('renaming trims, caps, and refuses to leave a preset nameless', () => {
    expect(renamePreset(1, '  Mornings  ')).toBe(true)
    expect(activePreset().name).toBe('Mornings')
    renamePreset(1, '   ')
    expect(activePreset().name).toBe('Preset 1')
    renamePreset(1, 'y'.repeat(80))
    expect(activePreset().name).toHaveLength(MAX_PRESET_NAME)
    expect(renamePreset(99, 'nobody')).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('creating a preset', () => {
  beforeEach(resetAll)

  it('adds it without opening it, and without touching the preset you are on', () => {
    playOnThisPreset()
    const saved = { ...localStorage }
    const p2 = createPreset()
    expect(p2).toEqual({ id: 2, name: 'Preset 2', amnesic: false })
    expect(usePresets.getState().presets).toHaveLength(2)
    expect(usePresets.getState().activeId).toBe(1) // creating is not opening
    // Preset 1's four keys are exactly as they were; the only new entry is the registry itself.
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(base)).toBe(saved[base])
    expect(useProgress.getState().stats.classic).toEqual(PLAYED)
  })

  // Ids are allocated forward and never reused, so a vacated namespace is never handed to a
  // different preset — which is what lets presetKey be a pure function of the id.
  it('never reuses the id of a deleted preset', () => {
    const p2 = createPreset()
    deletePreset(p2.id)
    expect(createPreset().id).toBe(3)
  })

  // MULTI-TAB, and it is reachable: two tabs on this origin each hold their own copy of the
  // registry, so a tab whose copy is stale would allocate an id the other tab already used and the
  // two presets would SHARE a namespace — merging two sets of a player's data. Skipping ids whose
  // keys already exist cannot fix the divergence, but it makes that outcome impossible.
  it('skips an id whose saved data already exists on disk', () => {
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.progress, 2), '{"state":{},"version":3}')
    expect(createPreset().id).toBe(3)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// REORDERING — the one operation that is a registry edit and NOTHING else, which is the whole of
// what these cases have to prove. Order is the array order (a separate `order` field was rejected
// on sight), ids are what storage keys are derived from, and movePreset never touches an id — so
// the claim is that a reorder moves presentation and not one byte of anybody's saved data.
describe('reordering presets', () => {
  beforeEach(resetAll)

  it('swaps a preset with its neighbour, in both directions, without renumbering anything', () => {
    createPreset('Timed')
    createPreset('Guest')
    expect(movePreset(1, 1)).toBe(true)
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Timed', 'Preset 1', 'Guest'])
    expect(movePreset(1, -1)).toBe(true)
    expect(usePresets.getState().presets.map((p) => p.name)).toEqual(['Preset 1', 'Timed', 'Guest'])
    expect(usePresets.getState().presets.map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('refuses the ends, and an id that names nothing', () => {
    createPreset('Timed')
    expect(movePreset(1, -1)).toBe(false) // already first
    expect(movePreset(2, 1)).toBe(false) // already last
    // An unknown id must not be treated as index −1 and then moved to a plausible-looking 0 — the
    // `from < 0` half of the bounds check is what stops exactly that.
    expect(movePreset(99, -1)).toBe(false)
    expect(movePreset(99, 1)).toBe(false)
    expect(usePresets.getState().presets.map((p) => p.id)).toEqual([1, 2])
  })

  it('moves no saved data, and leaves the active preset where it was', () => {
    playOnThisPreset()
    createPreset('Timed')
    const saved = { ...localStorage }
    movePreset(1, 1)
    // Every key byte-for-byte what it was, the registry excepted — which is the only thing a
    // reorder is entitled to rewrite.
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(base)).toBe(saved[base])
    expect(usePresets.getState().activeId).toBe(1)
    expect(useProgress.getState().stats.classic).toEqual(PLAYED)
    expect(activePreset().id).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SWITCHING — the operation the whole group exists to make safe.
describe('switching presets', () => {
  beforeEach(resetAll)

  // ★ ALL FOUR KINDS OF SAVED DATA MOVE. Not three: a switch that left one store behind would
  // share that one kind of data between presets, and it would look correct on every screen that
  // does not show it.
  it('opens a brand-new preset on the FACTORY values, leaving the old one on disk', () => {
    playOnThisPreset()
    const before = snapshotLive()
    const p2 = createPreset()
    expect(switchPreset(p2.id)).toBe(true)
    // ⚠ THE LEAK CASE. Preset 2 has no saved copy at all, so every value here comes from the
    // hydration rule rather than from storage: zustand's default merge would have left the whole
    // of `before` standing, and the first answered question would have made that clone permanent.
    expect(snapshotLive()).toEqual({
      minY: 1,
      manualTheme: 'dusk',
      blitzSec: 60,
      classicPlayed: 0,
      aoxBest: undefined,
      savedDefaults: null,
    })
    // Preset 1's saved copy was not read, written, moved or cleared.
    expect(
      JSON.parse(localStorage.getItem(PRESET_STORE_KEYS.progress)).state.stats.classic,
    ).toEqual(PLAYED)
    expect(before.manualTheme).toBe('nebula') // the theme is per-preset too — the owner was explicit
  })

  it('brings each preset back exactly as you left it', () => {
    playOnThisPreset({ minY: 1583, blitzSec: 45, theme: 'nebula' })
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset({ minY: 1900, blitzSec: 20, theme: 'light' })
    useProgress.getState().setModeStats('classic', { ...PLAYED, played: 99 })
    switchPreset(1)
    expect(snapshotLive().minY).toBe(1583)
    expect(snapshotLive().manualTheme).toBe('nebula')
    expect(snapshotLive().blitzSec).toBe(45)
    expect(snapshotLive().classicPlayed).toBe(5)
    expect(snapshotLive().savedDefaults.prefs.blitzSec).toBe(45)
    switchPreset(2)
    expect(snapshotLive().minY).toBe(1900)
    expect(snapshotLive().manualTheme).toBe('light')
    expect(snapshotLive().blitzSec).toBe(20)
    expect(snapshotLive().classicPlayed).toBe(99)
    // Each preset's SAVED PERSONAL DEFAULTS are its own — which is what makes a Full Reset inside a
    // preset land on that preset's saved values rather than on another preset's.
    expect(snapshotLive().savedDefaults.prefs.blitzSec).toBe(20)
    // Preset 2 wrote to its OWN namespaced keys, and never to preset 1's.
    for (const base of Object.values(PRESET_STORE_KEYS)) {
      expect(localStorage.getItem(presetKey(base, 2))).not.toBeNull()
      expect(localStorage.getItem(presetKey(base, 2))).not.toBe(localStorage.getItem(base))
    }
  })

  // ★★ THE SIGNAL THE SCREEN REMOUNT HANGS OFF. The five always-mounted mode screens and the guide
  // hold gameplay state no store reload can reach; leave them mounted across a switch and the next
  // answered question writes the old preset's stats into the new one — proven against the real
  // stores, 500 cards becoming 4. src/main.tsx therefore SUBSCRIBES to this registry and remounts
  // whenever activeId moves, which is why nothing here takes a remount callback. This case
  // subscribes exactly as App does and pins the two properties App depends on: the notification
  // lands SYNCHRONOUSLY (before the four stores are reloaded, so both halves reach React in one
  // commit), and it lands once per real change and never on a no-op.
  // ⚠ That the remount then actually happens, and that answering a question after it writes to the
  // incoming preset only, is the subject of tests/presetSwitch.dom — this file has no <App/>.
  it('announces the change synchronously, exactly once, and only when something changed', () => {
    const seen = []
    const unsub = usePresets.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId)
        // Read the settings store DURING the notification: it must still hold the outgoing preset's
        // value, which is what proves the subscriber runs before the rehydrations rather than after.
        seen.push({ to: s.activeId, minYAtNotify: useSettings.getState().minY })
    })
    try {
      useSettings.getState().setMinY(1583) // preset 1's value, distinguishable from the factory 1
      const p2 = createPreset()
      expect(switchPreset(p2.id)).toBe(true)
      expect(seen).toEqual([{ to: p2.id, minYAtNotify: 1583 }])
      expect(useSettings.getState().minY).toBe(1) // …and by the time switchPreset returns, preset 2's
      // Nothing to do → no announcement, and it says so.
      expect(switchPreset(p2.id)).toBe(false) // already active
      expect(switchPreset(99)).toBe(false) // no such preset
      renamePreset(p2.id, 'Renamed') // a registry write that must NOT throw away a run in progress
      expect(seen).toHaveLength(1)
    } finally {
      unsub()
    }
  })

  // ★ THE RELOAD ORDER IS A REQUIREMENT, NOT A LIST, and this is the case that says so.
  // store/progress' v1→v2 migration completes an AoX best's key from the LIVE julianChance setting.
  // Reload progress before settings and that live setting is still the preset you just LEFT, so the
  // record lands under a key belonging to no configuration the player can reach — a best that
  // vanishes on the switch, silently, and only for a save old enough to need the migration.
  it("an old saved best migrates under the NEW preset's setting, not the one you left", () => {
    useSettings.getState().setJulianChance('always') // preset 1's setting
    const p2 = createPreset()
    // Preset 2's own saved copies, written the way a previous release would have left them.
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, p2.id),
      JSON.stringify({ state: { julianChance: 'never' }, version: 1 }),
    )
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, p2.id),
      JSON.stringify({
        state: { aoxBest: { '10|false|numeric-ymd|random|random|1583-10000|true': AOX_REC } },
        version: 1,
      }),
    )
    switchPreset(p2.id)
    expect(Object.keys(useProgress.getState().aoxBest)[0]).toContain('never')
  })

  it('the preset you are on survives a cold start', async () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset({ minY: 1900, blitzSec: 20 })
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(2)
    expect(fresh.settings.getState().minY).toBe(1900)
    expect(fresh.progress.getState().stats.classic).toEqual(PLAYED)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('deleting a preset', () => {
  beforeEach(resetAll)

  it('removes ITS keys and nothing else', () => {
    playOnThisPreset()
    const preset1 = { ...localStorage }
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset({ minY: 1900 })
    switchPreset(1)
    expect(deletePreset(p2.id)).toBe(true)
    for (const base of Object.values(PRESET_STORE_KEYS)) {
      expect(localStorage.getItem(presetKey(base, 2))).toBeNull() // gone
      expect(localStorage.getItem(base)).toBe(preset1[base]) // untouched
    }
    expect(usePresets.getState().presets).toEqual([{ id: 1, name: 'Preset 1', amnesic: false }])
  })

  it('deleting the one you are on opens its neighbour, and that is a switch', () => {
    const p2 = createPreset()
    const p3 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset({ minY: 1900 })
    const moved = vi.fn()
    const unsub = usePresets.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) moved()
    })
    expect(deletePreset(p2.id)).toBe(true)
    unsub()
    expect(moved).toHaveBeenCalledTimes(1) // it IS a switch, so App's subscriber remounts the screens
    expect(usePresets.getState().activeId).toBe(p3.id) // the one after it
    expect(useSettings.getState().minY).toBe(1) // preset 3's factory values, not preset 2's
  })

  it('deleting one you are NOT on does not disturb the app at all', () => {
    playOnThisPreset()
    const p2 = createPreset()
    const moved = vi.fn()
    const unsub = usePresets.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) moved()
    })
    expect(deletePreset(p2.id)).toBe(true)
    unsub()
    expect(moved).not.toHaveBeenCalled() // nothing to remount — you are still on the preset you were
    expect(snapshotLive().minY).toBe(1583)
  })

  it('refuses the last preset, and an id that does not exist', () => {
    expect(deletePreset(1)).toBe(false)
    expect(deletePreset(99)).toBe(false)
    expect(usePresets.getState().presets).toHaveLength(1)
  })

  // ★★ THE SPECIAL CASE THAT NEEDS NO SPECIAL CODE — the payoff of presetKey(base, 1) === base.
  // Deleting preset 1 deletes the UN-NAMESPACED keys, which is exactly right: they are preset 1's
  // saved copy and nothing else's. The consequences are permanent and deliberate: a build that has
  // never heard of presets now opens factory-fresh (honest — that data really was deleted), and
  // slot 1 is vacant forever, because ids are allocated forward.
  it('deleting preset 1 clears the un-namespaced keys and vacates slot 1 for good', () => {
    playOnThisPreset()
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset({ minY: 1900, blitzSec: 20 })
    const moved = vi.fn()
    const unsub = usePresets.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) moved()
    })
    expect(deletePreset(1)).toBe(true)
    unsub()
    expect(moved).not.toHaveBeenCalled() // preset 2 was already the active one
    // The keys an ignorant build reads are gone…
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(base)).toBeNull()
    // …preset 2's are not, and the app is still on it.
    expect(usePresets.getState().activeId).toBe(2)
    expect(useSettings.getState().minY).toBe(1900)
    expect(localStorage.getItem(presetKey(PRESET_STORE_KEYS.progress, 2))).not.toBeNull()
    // …and no future preset is ever written into the vacated namespace.
    expect(createPreset().id).toBe(3)
  })
})
