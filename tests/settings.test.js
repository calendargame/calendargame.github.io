import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings, SETTINGS_DEFAULTS, migrateDotRotation } from '../src/store/settings.js'

// settings.test.js — the ⚙ settings store. The store is the structural beachhead
// for the mode-untangle, so its contract must be locked: (1) the 16 defaults,
// (2) setters accept BOTH a direct value AND a React-style functional updater,
// (3) resetToFactory restores every default. Persistence (localStorage) is
// verified in-browser, not here, since jsdom/node localStorage timing differs
// from the real runtime — these tests cover the pure state contract.

describe('settings store', () => {
  beforeEach(() => {
    // Reset to a known baseline before each test (the store is a singleton).
    useSettings.getState().resetToFactory()
  })

  it('exposes exactly the 16 documented defaults', () => {
    expect(Object.keys(SETTINGS_DEFAULTS)).toHaveLength(16)
    const s = useSettings.getState()
    expect(s.dateFormat).toBe('written-mdy')
    expect(s.inputStyle).toBe('buttons')
    // Every preset opens on Classic until the player changes Default Mode (round 21).
    expect(s.defaultMode).toBe('classic')
    // Standard — the orientation the app icon, the launch PNGs and every screenshot already show.
    expect(s.dotRotation).toBe('standard')
    expect(s.randomFormat).toBe(false) // launches OFF (Round-2): newcomers see ONE consistent format
    expect(s.useJulian).toBe(true)
    expect(s.julianChance).toBe('random')
    expect(s.minY).toBe(1)
    expect(s.maxY).toBe(10000)
    expect(s.leapChance).toBe('random')
    expect(s.janFebChance).toBe('random')
    expect(s.saveStats).toBe(true)
    expect(s.useSystem).toBe(true)
    expect(s.darkTheme).toBe('dusk')
    expect(s.lightTheme).toBe('light')
    expect(s.manualTheme).toBe('dusk')
  })

  it('setters accept a direct value', () => {
    useSettings.getState().setDateFormat('numeric-ymd')
    expect(useSettings.getState().dateFormat).toBe('numeric-ymd')
    useSettings.getState().setMinY(1583)
    expect(useSettings.getState().minY).toBe(1583)
  })

  it('setters accept a React-style functional updater (prev => next)', () => {
    // This is the drop-in contract that let App keep setUseJulian(v=>!v) verbatim.
    expect(useSettings.getState().useJulian).toBe(true)
    useSettings.getState().setUseJulian((v) => !v)
    expect(useSettings.getState().useJulian).toBe(false)
    useSettings.getState().setUseJulian((v) => !v)
    expect(useSettings.getState().useJulian).toBe(true)
  })

  it('setters are independent — changing one does not disturb others', () => {
    useSettings.getState().setLeapChance('75')
    const s = useSettings.getState()
    expect(s.leapChance).toBe('75')
    expect(s.janFebChance).toBe('random') // untouched
    expect(s.dateFormat).toBe('written-mdy') // untouched
  })

  it('resetToFactory restores every default, even after several changes', () => {
    const g = useSettings.getState
    g().setDateFormat('numeric-dmy')
    g().setUseJulian((v) => !v)
    g().setMinY(1900)
    g().setSaveStats(false)
    g().setManualTheme('midnight')
    g().resetToFactory()
    const s = g()
    for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
      expect(s[k]).toBe(v)
    }
  })

  it('applySettings applies a full 14-value snapshot in one shot (Reset Settings → saved defaults)', () => {
    const snapshot = { ...SETTINGS_DEFAULTS, leapChance: '75', minY: 1600, useJulian: false }
    useSettings.getState().applySettings(snapshot)
    const s = useSettings.getState()
    for (const [k, v] of Object.entries(snapshot)) {
      expect(s[k]).toBe(v)
    }
  })
})

// ★ THE ROTATE DOTS MIGRATION (round 23) — every saved shape the setting has had, onto today's
// three-way `dotRotation`, in one pure step. Unit-tested here (Node); the WIRING — that stored
// payloads actually reach it through useSettings.persist.rehydrate(), and that store/userDefaults'
// snapshot gets the same rewrite — is tests/dotRotation.dom's and tests/userDefaults.dom's (both
// need jsdom localStorage), mirroring how progress.test.js/progress.dom.test.js split the same
// concern for migrateAoxBestKeys.
describe('settings store — migrateDotRotation', () => {
  it("round 20's boolean: rotateDots true becomes 90° CCW — the only turn that existed then", () => {
    expect(migrateDotRotation({ rotateDots: true })).toEqual({ dotRotation: 'ccw90' })
  })

  it('rotateDots false becomes NO key — the merge supplies the factory Standard', () => {
    expect(migrateDotRotation({ rotateDots: false })).toEqual({})
  })

  it('the original picker: dotOrientation "rows" becomes 90° CCW, "columns" becomes no key', () => {
    expect(migrateDotRotation({ dotOrientation: 'rows' })).toEqual({ dotRotation: 'ccw90' })
    expect(migrateDotRotation({ dotOrientation: 'columns' })).toEqual({})
  })

  it('drops both legacy field names, always — even when they disagree or ride beside a current value', () => {
    const out = migrateDotRotation({
      dotOrientation: 'rows',
      rotateDots: false,
      dateFormat: 'numeric-ymd',
    })
    expect(out).not.toHaveProperty('dotOrientation')
    expect(out).not.toHaveProperty('rotateDots')
    // Either legacy "turned" signal is enough — they were never both written by one build.
    expect(out).toEqual({ dateFormat: 'numeric-ymd', dotRotation: 'ccw90' })
  })

  it('a valid dotRotation already present wins over any legacy field', () => {
    // A payload this build wrote that an older build then re-saved with its own field beside it.
    expect(migrateDotRotation({ dotRotation: 'ccw45', rotateDots: true })).toEqual({
      dotRotation: 'ccw45',
    })
    for (const v of ['standard', 'ccw45', 'ccw90']) {
      expect(migrateDotRotation({ dotRotation: v })).toEqual({ dotRotation: v })
    }
  })

  it("an unrecognised dotRotation is dropped — a newer build's value this build cannot draw falls back to Standard", () => {
    expect(migrateDotRotation({ dotRotation: 'ccw30' })).toEqual({})
    expect(migrateDotRotation({ dotRotation: 45 })).toEqual({})
    expect(migrateDotRotation({ dotRotation: null, rotateDots: true })).toEqual({
      dotRotation: 'ccw90',
    })
  })

  it('passes every other field through untouched, and is idempotent', () => {
    const once = migrateDotRotation({
      rotateDots: true,
      inputStyle: 'dots',
      minY: 1600,
      maxY: 1900,
    })
    expect(once).toEqual({ inputStyle: 'dots', minY: 1600, maxY: 1900, dotRotation: 'ccw90' })
    expect(migrateDotRotation(once)).toEqual(once)
  })
})
