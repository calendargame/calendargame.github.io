import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings, SETTINGS_DEFAULTS, migrateDotOrientation } from '../src/store/settings.js'

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
    // Every preset opens on Classic until the player changes Default Mode (round-21 Q3).
    expect(s.defaultMode).toBe('classic')
    // Upright — the orientation the app icon, the launch PNGs and every screenshot already show.
    expect(s.rotateDots).toBe(false)
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

  it('applySettings applies a full 14-value snapshot in one shot (Q7 — Reset Settings → saved defaults)', () => {
    const snapshot = { ...SETTINGS_DEFAULTS, leapChance: '75', minY: 1600, useJulian: false }
    useSettings.getState().applySettings(snapshot)
    const s = useSettings.getState()
    for (const [k, v] of Object.entries(snapshot)) {
      expect(s[k]).toBe(v)
    }
  })
})

// Q3 (round 20): dotOrientation ('columns' | 'rows') collapsed to the boolean rotateDots. The pure
// rewrite is unit-tested here (Node); the wiring — that a stored v1 payload actually reaches this
// function via useSettings.persist.rehydrate() — is settings.dom.test.jsx's claim (needs jsdom
// localStorage), mirroring exactly how progress.test.js/progress.dom.test.js split the same concern
// for migrateAoxBestKeys.
describe('settings store — migrateDotOrientation (v1 → v2)', () => {
  it('rows becomes rotateDots: true — the turned/opt-in state', () => {
    expect(migrateDotOrientation({ dotOrientation: 'rows' })).toEqual({ rotateDots: true })
  })

  it('columns becomes rotateDots: false — the upright/factory state', () => {
    expect(migrateDotOrientation({ dotOrientation: 'columns' })).toEqual({ rotateDots: false })
  })

  it('drops the old field name entirely rather than carrying it forward alongside the new one', () => {
    const out = migrateDotOrientation({ dotOrientation: 'rows', dateFormat: 'written-mdy' })
    expect(out).not.toHaveProperty('dotOrientation')
    expect(out).toEqual({ dateFormat: 'written-mdy', rotateDots: true })
  })

  it('passes every other field through untouched', () => {
    const out = migrateDotOrientation({
      dotOrientation: 'columns',
      inputStyle: 'dots',
      minY: 1600,
      maxY: 1900,
    })
    expect(out).toEqual({ inputStyle: 'dots', minY: 1600, maxY: 1900, rotateDots: false })
  })
})
