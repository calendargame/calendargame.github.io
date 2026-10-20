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
  normalizePresetName,
  readStoredRegistry,
  defaultPresetName,
  shortStockName,
  stockNumber,
  makePresetRegistryDefaults,
  PRESET_STORE_KEYS,
  FIRST_PRESET_ID,
  registrySpec,
} from '../src/store/presets.js'
import {
  createPreset,
  renamePreset,
  movePreset,
  switchPreset,
  deletePreset,
  setOpenInPreset,
  commitSessionPreset,
  setPresetAmnesic,
  activePreset,
  isPresetFactory,
  sweepDeletedPresetLeftovers,
} from '../src/store/presetControl.js'
import { openBrowsingSession, forgetBrowsingSession } from '../src/store/browsingSession.js'
import {
  door,
  createDoor,
  syncKeyOf,
  recordsKeyOf,
  docKeyOfSyncKey,
} from '../src/store/syncedDoc.js'
import { sessionPresetId, forgetSessionPreset } from '../src/store/sessionPreset.js'
import { writeSessionMode } from '../src/store/sessionMode.js'
import { writeSessionRound } from '../src/store/sessionRound.js'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress, makeProgressDefaults } from '../src/store/progress.js'
import { progressStateUnmarked } from '../src/store/progressDoc.js'
import { fileRoundResult } from '../src/store/screenPool.js'
import { newRoundId } from '../src/engine/roundId.js'
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
    amnesic: 'off',
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
    // …and nothing else but each one's SYNC KEY (store/syncedDoc: what lets windows open side by side
    // merge it - no older build reads or writes one), and the progress doc's RECORDS' KEY beside its own
    // (its Best records' newest versions: store/progressDoc). In particular no per-preset copy and no registry
    // entry: to an older build, a device on preset 1 that has never created a second one is a device
    // that has never heard of presets.
    expect(Object.keys(localStorage).sort()).toEqual([
      'cg-modeprefs-v1',
      'cg-progress-v1',
      'cg-settings-v1',
      'cg-sync-v1|cg-modeprefs-v1',
      'cg-sync-v1|cg-progress-v1',
      'cg-sync-v1|cg-progress-v1|rec',
      'cg-sync-v1|cg-settings-v1',
      'cg-sync-v1|cg-userdefaults-v1',
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
    // …and storage is byte-for-byte what it was, but for ONE new doc: materialising a registry wrote
    // nothing, because a default registry says nothing a missing one does not already say. The one
    // write is store/julianRange's pin — the Julian-on Year Range a preset that has none is given
    // the first time this build opens it, derived from its Julian-off range (1583-10000 here),
    // written once so nothing an older build does later can move it — with its sync key. New keys;
    // nothing that was there is rewritten.
    const after = { ...localStorage }
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(before), 'cg-julianrange-v1', 'cg-sync-v1|cg-julianrange-v1'].sort(),
    )
    for (const k of Object.keys(before)) expect(after[k]).toBe(before[k])
    expect(JSON.parse(after['cg-julianrange-v1'])).toMatchObject({
      state: { julianMinY: 1583, julianMaxY: 10000 },
      version: 1,
    })
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
    // Names are trimmed and never empty — and never cut: a name has no length limit.
    expect(
      normalizeRegistry({ presets: [{ id: 2, name: '   ' }], activeId: 2 }).presets[0].name,
    ).toBe('Preset 2')
    expect(normalizeRegistry({ presets: [{ id: 2, name: 7 }], activeId: 2 }).presets[0].name).toBe(
      'Preset 2',
    )
    const book = 'All work and no play. '.repeat(5_000)
    expect(
      normalizeRegistry({ presets: [{ id: 2, name: ` ${book}` }], activeId: 2 }).presets[0].name,
    ).toBe(book.trim())
  })

  it('a stock name is "Preset <number>" exactly, its short form "P<number>", and its number "<number>"', () => {
    expect(stockNumber('Preset 1')).toBe('1')
    expect(stockNumber('Preset 12')).toBe('12')
    expect(shortStockName('Preset 1')).toBe('P1')
    expect(shortStockName('Preset 12')).toBe('P12')
    expect(shortStockName('Preset 1000000')).toBe('P1000000')
    for (const id of [1, 2, 9, 10, 357]) {
      expect(shortStockName(defaultPresetName(id))).toBe(`P${id}`)
      expect(stockNumber(defaultPresetName(id))).toBe(`${id}`)
    }
    for (const notStock of [
      'Preset',
      'Preset ',
      'Preset 0',
      'Preset 01',
      'Preset 1 ',
      ' Preset 1',
      'Preset  1',
      'preset 1',
      'PRESET 1',
      'Presets 1',
      'Preset 1a',
      'Preset 1.5',
      'Preset -1',
      'My Preset 1',
      'Preset 1\nPreset 2',
      'P1',
      'Weekend',
      '',
    ])
      expect([shortStockName(notStock), stockNumber(notStock)], notStock).toEqual([null, null])
  })

  it('renaming trims, refuses to leave a preset nameless, and cuts nothing', () => {
    expect(renamePreset(1, '  Mornings  ')).toBe('renamed')
    expect(activePreset().name).toBe('Mornings')
    renamePreset(1, '   ')
    expect(activePreset().name).toBe('Preset 1')
    renamePreset(1, 'y'.repeat(80))
    expect(activePreset().name).toBe('y'.repeat(80))
    expect(renamePreset(99, 'nobody')).toBe('unknown')
  })

  // A name is empty when nothing in it would be DRAWN — not only when it has no characters. Each
  // name below is written as escapes so that what is in it can be read here, where it cannot be seen.
  const DRAWS_NOTHING = {
    'a zero-width space': '​',
    'a zero-width non-joiner and a zero-width joiner': '‌‍',
    'a word joiner': '⁠',
    // Between two zero-width spaces, so that trimming (which takes this one off an end) is not what
    // empties the name.
    'a byte-order mark': '​﻿​',
    'a soft hyphen': '­',
    'direction marks and overrides': '‎‏‪‮⁦⁩؜',
    'a variation selector on its own': '️',
    'a variation selector from the second set': '\u{E0100}',
    'control characters': '\u0001\u007F\u009F',
    'the Hangul filler': 'ㅤ',
    'the Hangul leading and vowel fillers': 'ᅟᅠ',
    'the half-width Hangul filler': 'ﾠ',
    'the blank Braille pattern': '⠀',
    'the combining grapheme joiner': '͏',
    'tag characters': '\u{E0020}\u{E007F}',
    'a no-break space': ' ',
    'invisible characters and spaces together': ' ​ ㅤ\t⠀ ﻿ ',
  }
  // …and each of these has something in it that is drawn, and is kept character for character.
  const KEPT_EXACTLY = {
    'a family joined by zero-width joiners': '\u{1F468}‍\u{1F469}‍\u{1F467}',
    'a flag (two regional indicators)': '\u{1F1EF}\u{1F1F5}',
    'a flag spelled with tag characters':
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'a letter with a combining accent': 'é',
    'a combining accent on its own': '́',
    'a zero-width joiner between two letters': 'a‍b',
    'a letter after a left-to-right mark': '‎a',
    'a letter between zero-width spaces': '​x​',
    'a heart with its variation selector': '❤️',
    'Hangul written with a filler': 'ᅟᅡ',
    'a Braille pattern with one dot': '⠁',
    // Format characters by category, and drawn all the same: they sit before the number they mark.
    'the Arabic number sign': '؀',
    'the Arabic end of ayah': '۝',
    'a single punctuation mark': '.',
    // A "space" to Unicode, and drawn as a stroke: the line an Ogham text is written along.
    'the Ogham space mark': '\u1680',
    'Ogham space marks round a letter': '\u1680\u1681\u1680',
  }

  it('a name with nothing visible in it is an empty name, and gets the default', () => {
    for (const [what, name] of Object.entries(DRAWS_NOTHING)) {
      expect(normalizePresetName(name, 3), what).toBe('Preset 3')
      // The same answer wherever a name is judged: a rename, a new preset, and a stored registry.
      renamePreset(1, 'Mornings')
      expect(renamePreset(1, name), what).toBe('renamed')
      expect(activePreset().name, what).toBe('Preset 1')
      expect(
        normalizeRegistry({ presets: [{ id: 2, name }], activeId: 2 }).presets[0].name,
        what,
      ).toBe('Preset 2')
    }
    const made = createPreset('​⠀')
    expect(made.name).toBe(defaultPresetName(made.id))
  })

  it('a name with anything visible in it is kept exactly, its invisible characters included', () => {
    for (const [what, name] of Object.entries(KEPT_EXACTLY)) {
      expect(normalizePresetName(name, 3), what).toBe(name)
      expect(renamePreset(1, name), what).toBe('renamed')
      expect(activePreset().name, what).toBe(name)
      expect(
        normalizeRegistry({ presets: [{ id: 2, name }], activeId: 2 }).presets[0].name,
        what,
      ).toBe(name)
    }
    // The Ogham space mark is kept at the ENDS of a name too, where a space would be trimmed: it
    // is something to see. The real spaces outside it still go.
    expect(normalizePresetName(' \u1680 a \u1680 ', 3)).toBe('\u1680 a \u1680')
    expect(normalizePresetName('\t\u00a0\u1680\ufeff\n', 3)).toBe('\u1680')
    // Every other space Unicode has is still trimmed from the ends, as it always was.
    expect(normalizePresetName('\u00a0\u2003\u3000\ufeff\u2028 a\u2029\u202f\u205f\u2000', 3)).toBe(
      'a',
    )
    // Outer spaces are trimmed as they always were, and nothing else about the name is touched.
    expect(normalizePresetName('  a‍b​  ', 3)).toBe('a‍b​')
  })

  it('a stored name with nothing visible in it is shown as the default, and the device is not rewritten for it', async () => {
    // An older build accepted such a name. Reading it writes nothing: the saved text is the same
    // text after the load, and the name is the default one only in what the app runs on.
    const saved = JSON.stringify({
      state: {
        presets: [{ id: 1, name: '​ㅤ', amnesic: false }],
        activeId: 1,
        nextId: 2,
        openInPreset: 'last',
      },
      version: 1,
    })
    localStorage.setItem('cg-presets-v1', saved)
    await usePresets.persist.rehydrate()
    expect(activePreset().name).toBe('Preset 1')
    expect(localStorage.getItem('cg-presets-v1')).toBe(saved)
  })

  it('a rename to the name a preset already has saves nothing', () => {
    // Entering a name's field and leaving it is exactly this, and a name can be a book.
    renamePreset(1, 'Mornings')
    const saved = localStorage.getItem('cg-presets-v1')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      expect(renamePreset(1, 'Mornings')).toBe('renamed')
      expect(renamePreset(1, '  Mornings ')).toBe('renamed') // the same name once trimmed
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
    expect(localStorage.getItem('cg-presets-v1')).toBe(saved)
  })

  it('a rename is tried on the device once, merged with what the device says, and the store then writes nothing more', () => {
    // An older build's tab has switched preset 2's Amnesic on since this page loaded (its whole-copy
    // save drops the sync envelope): the rename is merged with that, so the older tab's flag is carried.
    const p2 = createPreset('Timed')
    const stored = JSON.parse(localStorage.getItem('cg-presets-v1'))
    stored.state.presets[1].amnesic = true
    localStorage.setItem('cg-presets-v1', JSON.stringify({ state: stored.state, version: 1 }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      expect(renamePreset(p2.id, 'Sprints "quoted" 🎉')).toBe('renamed')
      const writes = setItem.mock.calls.filter(([key]) => key === 'cg-presets-v1')
      expect(writes).toHaveLength(1)
      expect(JSON.parse(writes[0][1]).state.presets[1]).toEqual({
        id: p2.id,
        name: 'Sprints "quoted" 🎉',
        amnesic: true,
      })
    } finally {
      setItem.mockRestore()
    }
    // the shape every build reads, with the windows-in-sync envelope beside it
    const saved = JSON.parse(localStorage.getItem('cg-presets-v1'))
    expect(Object.keys(saved).sort()).toEqual(['state', 'sync', 'version'])
    expect(saved.version).toBe(1)
  })

  it('trimming a book is one pass: a million spaces in the middle of a name cost nothing extra', () => {
    const name = `a${' '.repeat(1_000_000)}b`
    const started = performance.now()
    expect(normalizePresetName(`  ${name}  `, 3)).toBe(name)
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('only "no storage at all" is passed over when a rename is tried: any other failure is not hidden', () => {
    // The device refusing for room is 'no-room'; a browser with no storage renames in memory (the
    // next case). Anything else that goes wrong while saving is a fault, and surfaces as one —
    // exactly as it does for every other change to the preset list.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('the disk is on fire', 'UnknownError')
    })
    try {
      expect(() => renamePreset(1, 'Mornings')).toThrow('the disk is on fire')
      expect(activePreset().name).toBe('Preset 1')
    } finally {
      setItem.mockRestore()
    }
  })

  it('a browser that gives the app no storage at all still renames, in memory', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    try {
      expect(renamePreset(1, 'Mornings')).toBe('renamed')
      expect(activePreset().name).toBe('Mornings')
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  })

  it('a name of any length is stored whole, and comes back whole from the device', () => {
    // Forty-one emoji: the old ceiling of 40 string units fell in the MIDDLE of the twentieth, and
    // stored its first half. With no ceiling there is no cut, so there is no half to make.
    const emoji = '🎉'.repeat(41)
    renamePreset(1, emoji)
    expect(activePreset().name).toBe(emoji)
    expect(readStoredRegistry().presets[0].name).toBe(emoji)
    const book = 'All work and no play. '.repeat(5_000) + 'The end'
    renamePreset(1, book)
    expect(readStoredRegistry().presets[0].name).toBe(book)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE "OPEN IN" PIN (round 21) — an app-global registry field: which preset a fresh app open
// lands in. 'last' (the default, and the behaviour of every build before the pin) = the persisted activeId as-is;
// a preset id = that preset, whatever was active last time. Applied by usePresets' hydrate `merge`.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the "open in" pin', () => {
  beforeEach(resetAll)

  it('defaults to "last" and normalizes a garbage or dangling value back to it', () => {
    expect(makePresetRegistryDefaults().openInPreset).toBe('last')
    // An id that names no preset, a string, the absent key of a payload from before the pin — all collapse to 'last'.
    expect(normalizeRegistry({ presets: [{ id: 1, name: 'A' }], activeId: 1 }).openInPreset).toBe(
      'last',
    )
    expect(
      normalizeRegistry({ presets: [{ id: 1, name: 'A' }], activeId: 1, openInPreset: 9 })
        .openInPreset,
    ).toBe('last')
    expect(
      normalizeRegistry({ presets: [{ id: 1, name: 'A' }], activeId: 1, openInPreset: 'nope' })
        .openInPreset,
    ).toBe('last')
    // A pin that still names a live preset survives.
    expect(
      normalizeRegistry({
        presets: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ],
        activeId: 1,
        openInPreset: 2,
      }).openInPreset,
    ).toBe(2)
  })

  it('setOpenInPreset writes the registry and refuses an id that names no preset', async () => {
    createPreset('Timed') // preset 2
    expect(setOpenInPreset(2)).toBe(true)
    expect(usePresets.getState().openInPreset).toBe(2)
    expect(setOpenInPreset(2)).toBe(false) // already set — nothing to do
    expect(setOpenInPreset(99)).toBe(false) // no such preset
    expect(usePresets.getState().openInPreset).toBe(2)
    expect(setOpenInPreset('last')).toBe(true)
    expect(usePresets.getState().openInPreset).toBe('last')
  })

  it('a live pin becomes the active preset on the next cold start; "last" keeps the persisted activeId', async () => {
    createPreset('Timed') // preset 2
    switchPreset(2) // activeId on disk is now 2
    switchPreset(1) // …and now 1
    setOpenInPreset(2) // but the pin says open in 2
    let fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(2)
    expect(fresh.usePresets.getState().openInPreset).toBe(2)

    // Clear the pin — a cold start then honours whatever was active last (the behaviour before the pin existed).
    fresh.control.setOpenInPreset('last')
    fresh.control.switchPreset(1)
    fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(1)
    expect(fresh.usePresets.getState().openInPreset).toBe('last')
  })

  it('a RELOAD is not a fresh open: the pin is not applied, the preset you were on stays', async () => {
    createPreset('Timed') // preset 2
    setOpenInPreset(2) // pinned to 2, while on preset 1
    openBrowsingSession() // this browsing session is open (App's boot effect marks it)
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(1)
    expect(reloaded.usePresets.getState().openInPreset).toBe(2) // the pin itself is untouched
    // …and after a real close (the browser clears the session) the pin applies again.
    forgetBrowsingSession()
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(2)
  })

  // ★ "THE PRESET THIS SESSION IS ON" IS THE SESSION'S (store/sessionPreset). A fresh open writes
  // nothing permanent; the reload that follows reads the session's record.
  it('a fresh open the pin moved writes nothing permanent, and its reload stays where it landed', async () => {
    const disk = () => localStorage.getItem('cg-presets-v1')
    // A device with no registry gains none.
    commitSessionPreset()
    expect(disk()).toBeNull()
    createPreset('Timed')
    setOpenInPreset(2)
    const lastVisit = disk()
    expect(JSON.parse(lastVisit).state.activeId).toBe(1)
    sessionStorage.clear() // the app was closed
    const fresh = await reopenApp() // a fresh open: the pin lands it in 2
    expect(fresh.usePresets.getState().activeId).toBe(2)
    openBrowsingSession() // App's boot effect: the session is open…
    fresh.control.commitSessionPreset() // …and on preset 2
    expect(disk()).toBe(lastVisit) // the device still says the last visit ended on 1
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(2)
    // …and a real close forgets the session: 'last' is again what the device says.
    reloaded.control.setOpenInPreset('last') // (a registry write: it carries the preset you are on)
    expect(JSON.parse(disk()).state.activeId).toBe(2)
  })

  // The defect this replaced: the fresh open used to WRITE the registry so the reload could find
  // it, and a device full to the byte refused that write — the reload landed in the last visit's
  // preset.
  it('on a device too full to save the registry, a reload still lands where the pinned open did', async () => {
    createPreset('Timed')
    setOpenInPreset(2)
    sessionStorage.clear()
    const real = Storage.prototype.setItem
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === localStorage)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.call(this, key, value)
    })
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(2)
    openBrowsingSession()
    fresh.control.commitSessionPreset()
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(2)
    full.mockRestore()
  })

  it('a switch is on the session’s record at once; another tab’s switch does not move this tab’s reload', async () => {
    createPreset('B')
    openBrowsingSession()
    switchPreset(2)
    expect(sessionPresetId()).toBe(2)
    // Another tab (or the other site on this origin) switches to preset 1 and saves the registry —
    // a window of this build, through its own windows-in-sync door.
    const tab = createDoor({ storage: () => localStorage, tag: 'tab' }).countsStorage(
      registrySpec(null),
    )
    const theirs = tab.getItem('cg-presets-v1')
    tab.setItem('cg-presets-v1', { ...theirs, state: { ...theirs.state, activeId: 1 } })
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(2)
    // After a real close the session is gone, and "last" is whoever saved last.
    sessionStorage.clear()
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().activeId).toBe(1)
  })

  it('a session with nothing on record (an older build started it) reloads to the saved activeId', async () => {
    createPreset('B')
    switchPreset(2)
    openBrowsingSession()
    forgetSessionPreset()
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(2)
  })

  it('a record that names a preset deleted since falls back to the saved activeId', async () => {
    createPreset('B')
    createPreset('C')
    createPreset('D')
    switchPreset(3)
    openBrowsingSession()
    // An older tab, which had loaded all four, deletes preset 3 and lands on 2 (its whole copy, no
    // envelope; it lists D, made after C, so the delete is proven - design 8.1).
    const saved = JSON.parse(localStorage.getItem('cg-presets-v1'))
    saved.state.presets = saved.state.presets.filter((p) => p.id !== 3)
    saved.state.activeId = 2
    delete saved.sync
    localStorage.setItem('cg-presets-v1', JSON.stringify(saved))
    const reloaded = await reopenApp()
    expect(reloaded.usePresets.getState().activeId).toBe(2)
  })

  it('deleting the preset you are on puts its neighbour on the session’s record', () => {
    createPreset('B')
    switchPreset(2)
    deletePreset(2)
    expect(sessionPresetId()).toBe(1)
  })

  // ★ ANOTHER WINDOW DELETES THE PRESET THIS ONE IS ON (design-q1-q2.md v4, 8.3): the windows-in-sync
  // door hears of it, and this window moves to the neighbour, exactly as a delete made here moves it.
  it('a preset deleted in ANOTHER window: this one, if it was on it, moves to the neighbour; nothing is removed here', () => {
    vi.useFakeTimers()
    try {
      createPreset('B')
      createPreset('C')
      switchPreset(2)
      useSettings.getState().setSaveStats(false) // preset 2 holds a setting of its own
      const before = localStorage.getItem('cg-presets-v1')
      const saved = JSON.parse(before)
      // the other window's write (an older build's: the whole list, no envelope - it knew of preset 2)
      const after = JSON.stringify({
        state: {
          ...saved.state,
          presets: saved.state.presets.filter((p) => p.id !== 2),
          activeId: 1,
        },
        version: 1,
      })
      localStorage.setItem('cg-presets-v1', after)
      door.notice('cg-presets-v1', before, after)
      vi.runAllTimers()
      expect(usePresets.getState().presets.map((p) => p.id)).toEqual([1, 3])
      expect(usePresets.getState().activeId).toBe(3) // the one after it
      expect(sessionPresetId()).toBe(3)
      // ★ only this window's own session is touched: preset 2's saved keys were the deleting window's to remove
      expect(localStorage.getItem(presetKey('cg-settings-v1', 2))).not.toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deleting the pinned preset drops the pin back to "last"', async () => {
    createPreset('A') // 2
    createPreset('B') // 3
    setOpenInPreset(3)
    expect(usePresets.getState().openInPreset).toBe(3)
    deletePreset(3)
    expect(usePresets.getState().openInPreset).toBe('last')
    // A cold start after that opens on whatever is active, not a namespace nothing owns.
    const fresh = await reopenApp()
    expect(fresh.usePresets.getState().presets.map((p) => p.id)).toEqual([1, 2])
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
    // Preset 1's keys are exactly as they were; the only new entry is the registry itself.
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(base)).toBe(saved[base] ?? null)
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
  // registry (for this app the live PWA and the staging site are literally the same origin), so a
  // tab whose copy is stale would allocate an id the other tab already used and the two presets
  // would SHARE a namespace — merging two sets of a player's data. Neither case below fixes the
  // divergence, which nothing at allocation time can; together they make that MERGE impossible.
  it('skips an id whose saved data already exists on disk', () => {
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.progress, 2), '{"state":{},"version":3}')
    expect(createPreset().id).toBe(3)
  })

  // ⚠ THE HALF THE SKIP LOOP CANNOT SEE, and it is the likelier half of the two: a preset the other
  // tab has CREATED but never OPENED has no per-preset keys at all — createPreset writes the
  // registry and nothing else — so "are this id's keys on disk" answers NO for exactly the preset
  // most likely to be raced. The stored registry is what answers it, and it is read fresh at
  // allocation time rather than trusted from memory.
  it("takes the other tab's nextId from the STORED registry, not the one in memory", () => {
    // The other tab created preset 2 and left it unopened. It wrote the registry synchronously;
    // this tab's in-memory copy predates that write and still says the next id is 2.
    localStorage.setItem(
      'cg-presets-v1',
      JSON.stringify({
        state: {
          presets: [
            { id: 1, name: 'Preset 1', amnesic: false },
            { id: 2, name: 'Preset 2', amnesic: false },
          ],
          activeId: 1,
          nextId: 3,
        },
        version: 1,
      }),
    )
    expect(usePresets.getState().nextId).toBe(2) // this tab has not seen it…
    for (const base of Object.values(PRESET_STORE_KEYS))
      expect(localStorage.getItem(presetKey(base, 2))).toBe(null) // …and there is nothing to skip
    expect(createPreset().id).toBe(3)
  })

  // …and a stored registry that will not parse cannot break allocation: the read is a floor, not a
  // source of truth, so a corrupt or absent payload just leaves the in-memory answer standing.
  it('falls back to the in-memory nextId when the stored registry is unreadable', () => {
    localStorage.setItem('cg-presets-v1', '{"state":{"presets":[')
    expect(createPreset().id).toBe(2)
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
      expect(localStorage.getItem(base)).toBe(saved[base] ?? null)
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
      progressStateUnmarked(JSON.parse(localStorage.getItem(PRESET_STORE_KEYS.progress)).state)
        .stats.classic,
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
    // (Coming back to preset 1 pins its Julian-on Year Range, which it had never been given —
    // store/julianRange — so that key is preset 1's as it stands after the switch.)
    const preset1Now = {
      ...preset1,
      'cg-julianrange-v1': localStorage.getItem('cg-julianrange-v1'),
    }
    expect(deletePreset(p2.id)).toBe(true)
    for (const base of Object.values(PRESET_STORE_KEYS)) {
      expect(localStorage.getItem(presetKey(base, 2))).toBeNull() // gone
      expect(localStorage.getItem(base)).toBe(preset1Now[base]) // untouched
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

  // ★ THE WINDOWS-IN-SYNC KEYS GO WITH IT (design-q1-q2.md v4, 8.4): every doc's sync key, and the
  // progress doc's records' key beside it.
  it('deleting a preset removes its windows-in-sync keys with its docs — and nothing of anyone else’s', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset()
    fileRoundResult(
      usePresets.getState().activeId,
      'blitzBest',
      'k',
      newRoundId(),
      { score: 5, streak: 5 },
      null,
    )
    switchPreset(1)
    playOnThisPreset()
    const ofPreset = (id) =>
      Object.keys(localStorage).filter((k) => {
        const doc = docKeyOfSyncKey(k) ?? k
        return Object.values(PRESET_STORE_KEYS).some((b) => doc === presetKey(b, id))
      })
    expect(ofPreset(p2.id)).toEqual(
      expect.arrayContaining([
        syncKeyOf(presetKey(PRESET_STORE_KEYS.settings, p2.id)),
        recordsKeyOf(presetKey(PRESET_STORE_KEYS.progress, p2.id)),
      ]),
    )
    const mine = ofPreset(1).sort()
    expect(deletePreset(p2.id)).toBe(true)
    expect(ofPreset(p2.id)).toEqual([])
    expect(ofPreset(1).sort()).toEqual(mine)
  })

  it('the sync keys an older build’s delete leaves behind are swept at a cold open — only for a preset no list names, whose doc is gone', () => {
    const p2 = createPreset()
    switchPreset(p2.id)
    playOnThisPreset()
    switchPreset(1)
    // An older build deletes preset 3's four docs (it knows nothing of the sync keys), and preset 2
    // stays listed.
    const gone = presetKey(PRESET_STORE_KEYS.settings, 77)
    localStorage.setItem(syncKeyOf(gone), '{}')
    localStorage.setItem(recordsKeyOf(presetKey(PRESET_STORE_KEYS.progress, 77)), '{}')
    // (a doc still on the device keeps its sync key, whatever the lists say)
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.modePrefs, 78), '{"state":{},"version":1}')
    localStorage.setItem(syncKeyOf(presetKey(PRESET_STORE_KEYS.modePrefs, 78)), '{}')
    const listed = Object.keys(localStorage).filter((k) =>
      docKeyOfSyncKey(k)?.endsWith(`~p${p2.id}`),
    )
    usePresets.setState({ nextId: 100 }) // (77 and 78: ids the device has handed out)
    sweepDeletedPresetLeftovers()
    expect(localStorage.getItem(syncKeyOf(gone))).toBeNull()
    expect(localStorage.getItem(recordsKeyOf(presetKey(PRESET_STORE_KEYS.progress, 77)))).toBeNull()
    expect(
      localStorage.getItem(syncKeyOf(presetKey(PRESET_STORE_KEYS.modePrefs, 78))),
    ).not.toBeNull()
    for (const k of listed) expect(localStorage.getItem(k), k).not.toBeNull()
  })

  // (the review lane's LOWs) a Year Range left by an older build's delete takes its sync key with it in
  // the same sweep, not at the next cold open; and an older tab still on a preset a new window deleted,
  // writing its docs again, has them swept - its `gone` record says it is deleted for good.
  it('one sweep takes a deleted preset’s Year Range and its sync key; a deleted preset’s docs an older tab wrote again go too', () => {
    const p2 = createPreset()
    const p3 = createPreset()
    switchPreset(p3.id)
    playOnThisPreset()
    switchPreset(1)
    deletePreset(p3.id) // (a new window's delete: its `gone` record)
    // an older tab still on preset 3 writes its settings again; an older build's delete of preset 2 left
    // its Year Range and that doc's sync key
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, p3.id), '{"state":{},"version":4}')
    const range2 = presetKey(PRESET_STORE_KEYS.julianRange, p2.id)
    localStorage.setItem(range2, '{"state":{"julianMinY":1,"julianMaxY":11582},"version":1}')
    localStorage.setItem(syncKeyOf(range2), '{}')
    usePresets.setState({ presets: usePresets.getState().presets.filter((q) => q.id !== p2.id) })
    localStorage.setItem(
      'cg-presets-v1',
      JSON.stringify({
        state: { ...usePresets.getState(), presets: usePresets.getState().presets },
        version: 1,
      }),
    )
    sweepDeletedPresetLeftovers()
    expect(localStorage.getItem(range2)).toBeNull()
    expect(localStorage.getItem(syncKeyOf(range2))).toBeNull()
    expect(localStorage.getItem(presetKey(PRESET_STORE_KEYS.settings, p3.id))).toBeNull()
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ IS A PRESET FACTORY-FRESH? (round 22) — the question components/PresetManager's ✕ asks
// before deciding whether to show its confirmation at all.
//
// ⚠⚠ THE ASYMMETRY IS THE WHOLE SUBJECT, so it is what this block is organised around rather than
// "one case per store". A FALSE NEGATIVE costs a confirmation nobody needed. A FALSE POSITIVE
// deletes a player's data with no question asked and no way back. So the cases below are in two
// halves — the things that MUST read as factory (or the feature does nothing), and the longer list
// of things that MUST NOT (or the feature destroys something) — and that second half deliberately
// includes the places a preset can hide data that are NOT one of its four obvious keys: the parked
// permanent stats behind an amnesic session, the amnesic session itself, and a parked ended round.
describe('is a preset factory-fresh', () => {
  beforeEach(() => {
    resetAll()
    // isPresetFactory reads sessionStorage too (the amnesic session copy, the parked rounds), and
    // resetAll deliberately does not touch it — see the note in tests/helpers/settingsPanel. Here it
    // is part of the subject, so it goes back with everything else.
    sessionStorage.clear()
  })

  const other = (name) => createPreset(name).id
  const envelope = (state, version = 1) => JSON.stringify({ state, version })
  // The settings store's own saved-shape version, asked of the store rather than typed here.
  const CURRENT_SETTINGS_VERSION = useSettings.persist.getOptions().version
  // Every setting at its factory value, spelled the way the build before this one saved them: no
  // `dotRotation` key (that build had never heard of it).
  const SETTINGS_DEFAULTS_BEFORE_ROTATION = Object.fromEntries(
    Object.entries(SETTINGS_DEFAULTS).filter(([key]) => key !== 'dotRotation'),
  )

  // ── Must read as FACTORY ────────────────────────────────────────────────────────────────────

  it('a preset that has just been created is factory — it has no keys at all', () => {
    expect(isPresetFactory(other('Scratch'), true)).toBe(true)
  })

  it('so is the ACTIVE preset on a device nothing has ever been done on', () => {
    expect(isPresetFactory(usePresets.getState().activeId, true)).toBe(true)
  })

  // ★ THE CASE presetStorageInUse WOULD GET WRONG, and the reason this is a per-store VALUE
  // comparison rather than a "does any key exist" check. A store writes its key the first time
  // anything calls a setter, and plenty of those writes land back on the factory value — a toggle
  // flipped and flipped back, a mode screen mirroring blank stats on mount. Those presets have keys
  // and no data.
  it('keys that exist but hold the factory values are still factory', () => {
    const id = other('Visited')
    for (const base of Object.values(PRESET_STORE_KEYS))
      localStorage.setItem(presetKey(base, id), envelope({}))
    expect(isPresetFactory(id, true)).toBe(true)
    // …and the same with a settings payload that SPELLS EVERY VALUE OUT rather than omitting them,
    // which is what a real preset's key holds once anything has been saved into it. Taken from the
    // freshly-reset live store rather than from SETTINGS_DEFAULTS, so the case is not comparing the
    // check's own constant against itself; JSON.stringify drops the store's action functions, which
    // is exactly the shape `partialize` persists.
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, id),
      envelope(useSettings.getState()),
    )
    expect(isPresetFactory(id, true)).toBe(true)
  })

  // ⚠ THE OWNER'S DECIDED CALL: Amnesic is a statement about where stats WOULD go, and a preset
  // with none has lost nothing by being deleted. (It is a registry field, so it is outside
  // everything isPresetFactory reads — this case is what fails if that ever stops being true.)
  it('Amnesic on its own does not make a preset non-factory', () => {
    const id = other('Guest')
    setPresetAmnesic(id, 'full')
    expect(isPresetFactory(id, true)).toBe(true)
  })

  // ⚠ THE ONE ENTRY OF clearPresetStorage THAT IS DELIBERATELY NOT COUNTED. Every visit to a preset
  // writes its session page, and a full app close throws it away by itself — counting it would mean
  // any preset you had so much as looked at could never be deleted without a question, for a value
  // no player can miss.
  it('a session PAGE does not count — a preset you merely visited is still factory', () => {
    const id = other('Looked at')
    writeSessionMode(id, 'lookup')
    expect(isPresetFactory(id, true)).toBe(true)
  })

  // ⚠ NOR DOES A NAME, OR A POSITION, on the owner's own yardstick — "as if you pressed clear saved
  // defaults then full reset" leaves both exactly where they are, so a preset renamed and never
  // played in IS the state that recipe produces. The confirmation being skipped never mentioned a
  // name either, so nothing it would have warned about is withheld.
  it('renaming a preset, or moving it, does not make it non-factory', () => {
    const id = other('Scratch')
    renamePreset(id, 'Weekend')
    movePreset(id, -1)
    expect(isPresetFactory(id, true)).toBe(true)
  })

  // ── Must NOT read as factory ────────────────────────────────────────────────────────────────

  it('one ⚙ setting off its default is enough', () => {
    const id = other('Timed')
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, id), envelope({ saveStats: false }))
    expect(isPresetFactory(id, true)).toBe(false)
  })

  it('so is one mode-screen pref', () => {
    const id = other('Timed')
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.modePrefs, id), envelope({ blitzSec: 45 }))
    expect(isPresetFactory(id, true)).toBe(false)
  })

  it('so are stats, and so is a single all-time best', () => {
    const withStats = other('Played')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, withStats),
      envelope({ stats: { classic: PLAYED } }, 4),
    )
    expect(isPresetFactory(withStats, true)).toBe(false)
    const withBest = other('Raced')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, withBest),
      envelope({ aoxBest: { [AOX_KEY]: AOX_REC } }, 4),
    )
    expect(isPresetFactory(withBest, true)).toBe(false)
  })

  it('so is a saved-defaults snapshot, even one that saved the factory values', () => {
    const id = other('Tuned')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.userDefaults, id),
      envelope({ saved: { settings: {}, prefs: {}, amnesic: false } }, 2),
    )
    expect(isPresetFactory(id, true)).toBe(false)
  })

  // ★★ THE SHARPEST FALSE POSITIVE THE CHECK HAS TO CLOSE. While a preset is amnesic its live stats
  // are a zeroed sessionStorage copy and its REAL ones are parked in localStorage, untouched — so a
  // check that trusted "what this preset is showing" would call a preset holding 500 cards factory
  // and destroy both copies without a word (deleting clears the parked copy too).
  it('an AMNESIC preset with parked permanent stats is not factory', () => {
    const id = other('Guest')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, id),
      envelope({ stats: { classic: PLAYED } }, 4),
    )
    setPresetAmnesic(id, 'full')
    expect(isPresetFactory(id, true)).toBe(false)
  })

  // …and an amnesic preset's play is in its saved progress like any other's (one pool, store/amnesic):
  // until the close forgets it, it is data, and deleting takes it.
  it('an amnesic preset that has been played on is not factory either', () => {
    const id = other('Guest')
    setPresetAmnesic(id, 'full')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, id),
      envelope({ stats: { classic: PLAYED } }, 4),
    )
    expect(isPresetFactory(id, true)).toBe(false)
  })

  // A finished Blitz round or MoX run waiting on a preset's screen is a RESULT the player can still
  // see, and it is the one piece of per-preset data that lives in neither a store nor a namespaced
  // key (store/sessionRound).
  it('a parked ended round is not factory', () => {
    const id = other('Raced')
    writeSessionRound(id, 'blitz', { score: 12 })
    expect(isPresetFactory(id, true)).toBe(false)
    // …and the prefix scan is per preset: a neighbour's parked round says nothing about this one.
    expect(isPresetFactory(other('Clean'), true)).toBe(true)
  })

  // ★ A SAVED COPY IS JUDGED IN TODAY'S SHAPE — after the store's OWN migration, the one opening
  // the preset would run. A preset you are not on keeps the shape of the build that last saved it,
  // so every preset made before Rotate Dots became a three-way setting still holds
  // `rotateDots: false`. Compared unmigrated, that one leftover key made an untouched preset read
  // as "holds something", and deleting it asked a question it never used to.
  it('an untouched preset saved by the previous build (rotateDots: false) is still factory', () => {
    const id = other('From 2.26')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, id),
      envelope({ ...SETTINGS_DEFAULTS_BEFORE_ROTATION, rotateDots: false }, 3),
    )
    expect(isPresetFactory(id, true)).toBe(true)
    // …and the original two-way picker's upright value, from the build before that.
    const older = other('From 2.23')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, older),
      envelope({ dotOrientation: 'columns' }, 1),
    )
    expect(isPresetFactory(older, true)).toBe(true)
  })

  // …and the same goes for the stats: the previous build could leave a Best record of NOTHING
  // behind (a MoX record with no mean and no median — store/progress' dropEmptyBests), which is a
  // key in a Best map and nothing a player could miss.
  it('a preset whose only saved "best" is the empty record the previous build left is still factory', () => {
    const id = other('Emptied')
    const emptied = {
      avg: null,
      avgMed: null,
      avgRoundId: null,
      med: null,
      medAvg: null,
      medRoundId: null,
    }
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, id),
      envelope({ ...makeProgressDefaults(), aoxBest: { '10|false|x': emptied } }, 4),
    )
    expect(isPresetFactory(id, true)).toBe(true)
    // A record that holds a time is a record.
    const real = other('Recorded')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.progress, real),
      envelope({ ...makeProgressDefaults(), aoxBest: { '10|false|x': { ...emptied, avg: 2 } } }, 4),
    )
    expect(isPresetFactory(real, true)).toBe(false)
  })

  it('…but the same old shape holding a TURNED layout is a setting off its default', () => {
    const id = other('Turned')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, id),
      envelope({ rotateDots: true }, 3),
    )
    expect(isPresetFactory(id, true)).toBe(false)
  })

  // ⚠ WHAT THE MIGRATION DOES NOT EXCUSE. A key no version of the store knows is still a key the
  // defaults do not have; and a copy this build cannot vouch for — written by a NEWER build, or
  // carrying no version at all — asks, even when every value in it reads as factory. (The store's
  // migrate would squeeze a newer shape into one this build can draw, by dropping what it does not
  // recognise; "I dropped it" is not "it was empty".)
  it('a stray key, a newer build`s copy, and an unversioned copy all ask', () => {
    const stray = other('Stray')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, stray),
      envelope({ rotateDots: false }, CURRENT_SETTINGS_VERSION),
    )
    expect(isPresetFactory(stray, true)).toBe(false)
    const newer = other('Newer')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, newer),
      envelope({}, CURRENT_SETTINGS_VERSION + 1),
    )
    expect(isPresetFactory(newer, true)).toBe(false)
    const unversioned = other('Unversioned')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, unversioned),
      JSON.stringify({ state: {} }),
    )
    expect(isPresetFactory(unversioned, true)).toBe(false)
  })

  // ⚠ A PAYLOAD THIS BUILD CANNOT ACCOUNT FOR ASKS FIRST: an older build's field that still means
  // something after the migration (the original picker's 'rows' is a turned layout), and the
  // corrupt cases — nothing that cannot be understood is allowed to mean "empty".
  it('an old-shape or unreadable payload is never called factory', () => {
    const old = other('Old build')
    localStorage.setItem(
      presetKey(PRESET_STORE_KEYS.settings, old),
      envelope({ dotOrientation: 'rows' }),
    )
    expect(isPresetFactory(old, true)).toBe(false)
    const truncated = other('Truncated')
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, truncated), '{"state":{"save')
    expect(isPresetFactory(truncated, true)).toBe(false)
    const shapeless = other('Shapeless')
    localStorage.setItem(presetKey(PRESET_STORE_KEYS.settings, shapeless), '"a string"')
    expect(isPresetFactory(shapeless, true)).toBe(false)
  })

  // ── The ACTIVE preset is judged on the LIVE stores as well ──────────────────────────────────
  //
  // ★★ THE CASE THAT PROVES THE SECOND SOURCE IS REALLY READ, isolated by removing the key the
  // write just made: storage then says "nothing here", and only the live store knows otherwise.
  // That is not a contrivance — it is exactly the state of a browser that refuses localStorage (iOS
  // "Block All Cookies"), where NOTHING is ever written and a storage-only check would call a preset
  // that has been played in all session factory-fresh.
  it('the ACTIVE presets live stores count, even with its keys gone', () => {
    const id = usePresets.getState().activeId
    useSettings.getState().setSaveStats(false)
    localStorage.removeItem(presetKey(PRESET_STORE_KEYS.settings, id))
    expect(isPresetFactory(id, true)).toBe(false)
    useSettings.getState().setSaveStats(true)
    useProgress.getState().setModeStats('classic', PLAYED)
    for (const base of Object.values(PRESET_STORE_KEYS))
      localStorage.removeItem(presetKey(base, id))
    expect(isPresetFactory(id, true)).toBe(false)
  })

  // …and the live stores are the ACTIVE preset's alone, so they must not be consulted for anyone
  // else. Without this, playing in preset 1 would make every other preset look non-factory.
  it('the live stores say nothing about a preset you are not on', () => {
    const id = other('Clean')
    useSettings.getState().setSaveStats(false)
    useProgress.getState().setModeStats('classic', PLAYED)
    expect(isPresetFactory(id, true)).toBe(true)
    expect(isPresetFactory(usePresets.getState().activeId, true)).toBe(false)
  })

  // ★★ THE ONE THING NO STORE HOLDS: WHAT IS ON THE ACTIVE PRESET'S SCREENS (round 22's fixer). A
  // Blitz round or MoX run in progress is written nowhere — sessionStorage parks only ENDED ones — so
  // without this argument a preset with a live run on screen, and everything in storage at factory,
  // read as factory and was deleted run and all. The caller hands in src/main.tsx's aggregate of the
  // five screens' freshness reports; the UI cases in tests/presetManager.dom drive the real screens.
  it('the ACTIVE preset is not factory while any of its screens is not fresh', () => {
    const active = usePresets.getState().activeId
    expect(isPresetFactory(active, false)).toBe(false)
    expect(isPresetFactory(active, true)).toBe(true)
  })

  // …and the screens are the ACTIVE preset's alone, so they say nothing about any other.
  it('the screens say nothing about a preset you are not on', () => {
    expect(isPresetFactory(other('Clean'), false)).toBe(true)
  })

  it('an unknown id is factory — there is nothing anywhere under it', () => {
    expect(isPresetFactory(99, true)).toBe(true)
  })
})
