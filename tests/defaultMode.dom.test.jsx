// @vitest-environment jsdom
//
// defaultMode.dom — round-21 Q3: the page a preset OPENS ON, and the per-preset SESSION page that
// survives a switch-and-return but not a full close.
//
// Three facts, driven through the real <App/>:
//   1. A cold open lands on the ACTIVE preset's `defaultMode` ⚙ setting (store/settings), not the
//      hard "classic" the app used to always start on.
//   2. During a session, switching away from a preset and back restores the page you left it on
//      (store/sessionMode). A preset you have never visited this session opens on its own
//      `defaultMode`.
//   3. Reset Settings restores `defaultMode` in the store but does NOT move the page you are on
//      now — it only decides where a preset OPENS.
//
// The "open in which preset" pin is a registry field and is exercised at store level in
// tests/presets.dom (it is applied by usePresets' hydrate `merge`, which a same-module DOM remount
// cannot re-run).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, act } from '@testing-library/react'
import { useSettings } from '../src/store/settings.js'
import { switchPreset, createPreset } from '../src/store/presetControl.js'
import {
  resetAppState,
  mountApp,
  currentMode,
  pressKey,
  openSettings,
  fireResetSettings,
} from './helpers/settingsPanel.jsx'

const open = (id) => act(() => switchPreset(id))
const setDefault = (mode) => act(() => useSettings.getState().setDefaultMode(mode))

describe('Q3 — a preset opens on its Default Mode', () => {
  beforeEach(() => resetAppState())
  afterEach(() => {
    cleanup()
    document.getElementById('root')?.remove()
  })

  it('a cold open lands on the active preset’s defaultMode, not a hard Classic', () => {
    setDefault('blitz') // persists to cg-settings-v1 synchronously
    mountApp()
    expect(currentMode()).toBe('Blitz')
  })

  it('defaultMode "guide" opens How to Play on a cold open', () => {
    setDefault('guide')
    mountApp()
    expect(currentMode()).toBe('How to Play')
  })

  it('a factory preset still opens on Classic', () => {
    mountApp()
    expect(currentMode()).toBe('Classic')
  })

  it('the page you left a preset on comes back when you switch away and return', () => {
    act(() => createPreset('Two')) // preset 2, factory (defaultMode classic)
    mountApp() // preset 1, factory → Classic
    expect(currentMode()).toBe('Classic')

    pressKey('H') // → How to Play; store/sessionMode now holds {1: 'guide'}
    expect(currentMode()).toBe('How to Play')

    open(2) // preset 2, never visited this session → its defaultMode (classic)
    expect(currentMode()).toBe('Classic')

    open(1) // back to preset 1 → the page it was left on
    expect(currentMode()).toBe('How to Play')
  })

  it('once a preset has been visited this session its session page wins over a later defaultMode change', () => {
    act(() => createPreset('Timed'))
    mountApp() // preset 1 → Classic
    open(2) // first visit to preset 2 this session — records its page (Classic)
    pressKey('B') // navigate preset 2 to Blitz
    expect(currentMode()).toBe('Blitz')
    setDefault('deduction') // change preset 2's defaultMode AFTER it has a session page
    open(1)
    open(2) // the session page (Blitz) wins; defaultMode only matters on a cold open
    expect(currentMode()).toBe('Blitz')
  })

  it('Reset Settings restores defaultMode in the store but does not move the current page', () => {
    setDefault('blitz')
    mountApp() // opens on Blitz
    expect(currentMode()).toBe('Blitz')
    pressKey('L') // navigate to Lookup
    expect(currentMode()).toBe('Lookup')
    // Move defaultMode off its (unsaved) value so Reset Settings has something to restore.
    setDefault('deduction')
    openSettings()
    fireResetSettings()
    // defaultMode is back to the factory 'classic' (nothing saved), but the page is untouched.
    expect(useSettings.getState().defaultMode).toBe('classic')
    expect(currentMode()).toBe('Lookup')
  })
})
