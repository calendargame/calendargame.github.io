import { describe, it, expect, beforeEach } from 'vitest'
import { useModePrefs, MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'

// modePrefs.test.js — the per-mode setup store (Stage D follow-up). Mirrors settings.test.js.
// Locks the contract: (1) launch defaults; (2) each setter updates its value, leaves the others
// alone, and supports a React-style functional updater (mirrors the components' setX(v=>!v));
// (3) resetModePrefs restores FRESH defaults. Persistence (localStorage) is verified in-browser,
// like the other two stores, since jsdom/node storage timing differs from the runtime.

describe('modePrefs store', () => {
  beforeEach(() => {
    useModePrefs.getState().resetModePrefs()
  })

  it('starts at the launch defaults', () => {
    const s = useModePrefs.getState()
    for (const k of Object.keys(MODE_PREFS_DEFAULTS)) {
      expect(s[k]).toEqual(MODE_PREFS_DEFAULTS[k])
    }
  })

  it('a setter updates its value and leaves the others at default', () => {
    useModePrefs.getState().setBlitzSec(30)
    const s = useModePrefs.getState()
    expect(s.blitzSec).toBe(30)
    expect(s.blitzQSec).toBe(MODE_PREFS_DEFAULTS.blitzQSec)
    expect(s.flashMs).toBe(MODE_PREFS_DEFAULTS.flashMs)
  })

  it('setters accept direct values AND functional updaters', () => {
    useModePrefs.getState().setBlitzPerQ(true)
    expect(useModePrefs.getState().blitzPerQ).toBe(true)
    useModePrefs.getState().setBlitzPerQ((v) => !v) // functional toggle, like setPerQ(v=>!v)
    expect(useModePrefs.getState().blitzPerQ).toBe(false)
    useModePrefs.getState().setAoxN('5')
    expect(useModePrefs.getState().aoxN).toBe('5')
    useModePrefs.getState().setClassicTimingOff((v) => !v) // toggle, like the show/hide stat buttons
    expect(useModePrefs.getState().classicTimingOff).toBe(false) // default true -> false
  })

  it('resetModePrefs restores fresh launch defaults', () => {
    const s = useModePrefs.getState()
    s.setFlashMs(2000)
    s.setAoxOneByOne(true)
    s.setDedType('year')
    s.setClassicTimingOff(false)
    s.resetModePrefs()
    const r = useModePrefs.getState()
    expect(r.flashMs).toBe(MODE_PREFS_DEFAULTS.flashMs)
    expect(r.aoxOneByOne).toBe(MODE_PREFS_DEFAULTS.aoxOneByOne)
    expect(r.dedType).toBe(MODE_PREFS_DEFAULTS.dedType)
    expect(r.classicTimingOff).toBe(MODE_PREFS_DEFAULTS.classicTimingOff)
  })
})
