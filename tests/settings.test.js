import { describe, it, expect, beforeEach } from 'vitest'
import { useSettings, SETTINGS_DEFAULTS } from '../src/store/settings.js'

// settings.test.js — the ⚙ settings store. The store is the structural beachhead
// for the mode-untangle, so its contract must be locked: (1) the 13 defaults,
// (2) setters accept BOTH a direct value AND a React-style functional updater,
// (3) resetSettings restores every default. Persistence (localStorage) is
// verified in-browser, not here, since jsdom/node localStorage timing differs
// from the real runtime — these tests cover the pure state contract.

describe('settings store', () => {
  beforeEach(() => {
    // Reset to a known baseline before each test (the store is a singleton).
    useSettings.getState().resetSettings()
  })

  it('exposes exactly the 13 documented defaults', () => {
    expect(Object.keys(SETTINGS_DEFAULTS)).toHaveLength(13)
    const s = useSettings.getState()
    expect(s.dateFormat).toBe('written-mdy')
    expect(s.randomFormat).toBe(true)
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

  it('resetSettings restores every default, even after several changes', () => {
    const g = useSettings.getState
    g().setDateFormat('numeric-dmy')
    g().setUseJulian((v) => !v)
    g().setMinY(1900)
    g().setSaveStats(false)
    g().setManualTheme('midnight')
    g().resetSettings()
    const s = g()
    for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
      expect(s[k]).toBe(v)
    }
  })
})
