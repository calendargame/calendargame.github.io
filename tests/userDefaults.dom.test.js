// @vitest-environment jsdom
//
// userDefaults.dom.test.js — the saved-personal-defaults store against REAL (jsdom)
// localStorage, end to end. Mirrors tests/dotOrientation.dom.test.jsx's "settings store — v1
// dotOrientation payload rehydrates through the migration" describe exactly, one level deeper:
// this store's persisted `saved.settings` is a FULL SNAPSHOT of SettingsValues, not a live
// mirror of useSettings — so useSettings' own v1→v2 migrate (store/settings.ts), which only
// ever sees ITS OWN persisted blob at `cg-settings-v1`, can never reach in and fix a stale
// snapshot sitting inside `cg-userdefaults-v1`. This store needs — and, since round 20's fix,
// has — the identical migration applied to that nested object.
//
// The pure rewrite (`migrateDotOrientation`) is unit-tested in settings.test.js (Node) and
// reused here rather than reimplemented, exactly as store/userDefaults.ts's own migrate does.
// This file proves the WIRING: a stored v1 `saved.settings` payload actually reaching it via
// useUserDefaults.persist.rehydrate(), the same zustand entry point a real reload takes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useUserDefaults, effectiveSettingsDefaults } from '../src/store/userDefaults.js'
import { SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'

const PREFS = {
  flashMs: MODE_PREFS_DEFAULTS.flashMs,
  blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
  blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
  aoxN: MODE_PREFS_DEFAULTS.aoxN,
}

describe('userDefaults store — a v1 saved-snapshot with the old dotOrientation shape rehydrates through the migration', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserDefaults.getState().clearDefaults()
  })
  afterEach(() => {
    localStorage.clear()
    useUserDefaults.getState().clearDefaults()
  })

  it('saved.settings.dotOrientation "rows" loads as saved.settings.rotateDots: true', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = {
      state: {
        saved: {
          settings: { ...oldShape, dotOrientation: 'rows', minY: 1600 },
          prefs: PREFS,
          amnesic: false,
        },
      },
      version: 1,
    }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v1))
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.rotateDots).toBe(true)
    // Everything else passed through untouched, and the old field name did not tag along —
    // matching store/settings' own migration exactly, one level deeper.
    expect(saved.settings.minY).toBe(1600)
    expect(saved.settings).not.toHaveProperty('dotOrientation')
    expect(saved.prefs).toEqual(PREFS)
    expect(saved.amnesic).toBe(false)
  })

  it('saved.settings.dotOrientation "columns" loads as saved.settings.rotateDots: false', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = {
      state: {
        saved: {
          settings: { ...oldShape, dotOrientation: 'columns' },
          prefs: PREFS,
          amnesic: true,
        },
      },
      version: 1,
    }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v1))
    await useUserDefaults.persist.rehydrate()
    expect(useUserDefaults.getState().saved.settings.rotateDots).toBe(false)
    // The migration only touches settings — amnesic (round-20 Q4, itself already present on this
    // v1 payload here) rides through the same unconditional `merge` as every other field.
    expect(useUserDefaults.getState().saved.amnesic).toBe(true)
  })

  it('a v1 snapshot from BEFORE dotOrientation existed (neither field) leaves the store untouched — effectiveSettingsDefaults forward-merges it to factory at read time, same as a field a later release adds', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = {
      state: { saved: { settings: oldShape, prefs: PREFS, amnesic: false } },
      version: 1,
    }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v1))
    await useUserDefaults.persist.rehydrate()
    // The migrate step correctly no-ops (there is no old-shaped `dotOrientation` field for it to
    // rewrite) — the raw stored snapshot has no rotateDots key at all, exactly as it had no
    // dotOrientation key before it. It is effectiveSettingsDefaults' own forward-merge (proved
    // above the migration entirely, and again below) that supplies the factory value.
    expect(useUserDefaults.getState().saved.settings).not.toHaveProperty('rotateDots')
    expect(effectiveSettingsDefaults(useUserDefaults.getState().saved).rotateDots).toBe(false)
  })

  it('nothing ever saved (saved: null) passes through the migration untouched', async () => {
    const v1 = { state: { saved: null }, version: 1 }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v1))
    await useUserDefaults.persist.rehydrate()
    expect(useUserDefaults.getState().saved).toBeNull()
  })

  it('a current-version (v2) payload rehydrates unchanged — no migration re-fires', async () => {
    const v2 = {
      state: {
        saved: {
          settings: { ...SETTINGS_DEFAULTS, rotateDots: true, dateFormat: 'numeric-ymd' },
          prefs: PREFS,
          amnesic: false,
        },
      },
      version: 2,
    }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v2))
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.rotateDots).toBe(true)
    expect(saved.settings.dateFormat).toBe('numeric-ymd')
  })

  // The end-to-end payoff, not just the store-level shape: a stale pre-Q3 saved snapshot must no
  // longer make Reset Settings / Full Reset silently revert Dot Layout — the exact symptom the
  // ship-blocker finding described. effectiveSettingsDefaults is the one function both call.
  it('effectiveSettingsDefaults reads the migrated rotateDots, not the stale factory false', async () => {
    const { rotateDots: _drop, ...oldShape } = SETTINGS_DEFAULTS
    const v1 = {
      state: {
        saved: { settings: { ...oldShape, dotOrientation: 'rows' }, prefs: PREFS, amnesic: false },
      },
      version: 1,
    }
    localStorage.setItem('cg-userdefaults-v1', JSON.stringify(v1))
    await useUserDefaults.persist.rehydrate()
    expect(effectiveSettingsDefaults(useUserDefaults.getState().saved).rotateDots).toBe(true)
  })
})
