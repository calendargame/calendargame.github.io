// @vitest-environment jsdom
// olderBuilds.settingsDoor — AN OLDER BUILD'S REAL SAVES OF THE SETTINGS DOCS, MET BY THE
// WINDOWS-IN-SYNC DOOR (design-q1-q2.md v4, 10: "Settings, mode prefs: the prev-value rule; drops
// unknown fields on save", "Saved defaults: tag inside `saved` carried by edits, dropped by Save
// Defaults").
// The older builds' writes are the ones they really made (tests/fixtures/olderBuilds/sync-<build>.json,
// recorded by tests/fixtures/olderBuilds/syncDrive.dom.test.jsx.txt running each build): a ⚙ change
// (Save Stats off), a mode-setup change (Flash speed 1000), and a Save Defaults. Each lands here as
// that build's whole-doc save over a doc this window changed in the meantime: the older tab's change
// is taken, and this window's newer change to a field the older tab did not touch stands.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from '@testing-library/react'
import { otherWindow } from './helpers/otherWindow.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useUserDefaults } from '../src/store/userDefaults.js'
import { PRESET_STORE_KEYS } from '../src/store/presets.js'

const BUILDS = ['v2.26.0', 'v2.27.3', 'v2.28.0', 'v2.29.0']
const recorded = (build) =>
  JSON.parse(readFileSync(resolve(__dirname, `fixtures/olderBuilds/sync-${build}.json`), 'utf8'))
const firstSet = (writes, key) => writes.find((w) => w.op === 'set' && w.key === key).value
const device = (key) => JSON.parse(localStorage.getItem(key))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe.each(BUILDS)('%s’s own saves, over a doc a new window changed', (build) => {
  const seen = recorded(build)

  it('⚙ settings: its Save Stats change is taken; this window’s newer Year Range stands', () => {
    act(() => useSettings.getState().setMaxY(9000))
    const W = otherWindow()
    const older = firstSet(seen.settingsSet, PRESET_STORE_KEYS.settings)
    expect(older.state.maxY).toBe(10000) // (the range that build loaded with)
    W.write(PRESET_STORE_KEYS.settings, JSON.stringify(older))
    W.deliver()
    expect(useSettings.getState().saveStats).toBe(false)
    expect(useSettings.getState().maxY).toBe(9000)
    // …and the device says so once this window next saves - in this build's shape (v2.26.0 wrote its
    // own, at version 3: it is read the way a load reads it, migrated)
    act(() => useSettings.getState().setMinY(1600))
    const now = device(PRESET_STORE_KEYS.settings)
    expect(now.version).toBe(4)
    expect(now.state).toMatchObject({ saveStats: false, maxY: 9000, minY: 1600 })
    expect(now.state).not.toHaveProperty('rotateDots')
  })

  it('the mode setup: its Flash speed is taken; this window’s newer Blitz timer stands', () => {
    act(() => useModePrefs.getState().setBlitzSec(30))
    const W = otherWindow()
    const older = firstSet(seen.prefsSet, PRESET_STORE_KEYS.modePrefs)
    W.write(PRESET_STORE_KEYS.modePrefs, JSON.stringify(older))
    W.deliver()
    expect(useModePrefs.getState().flashMs).toBe(1000)
    expect(useModePrefs.getState().blitzSec).toBe(30)
  })

  it('saved defaults: its Save Defaults (a snapshot with no tag) is taken', () => {
    act(() =>
      useUserDefaults.getState().saveDefaults({
        settings: { ...useSettings.getState() },
        prefs: { flashMs: 900, blitzSec: 60, blitzQSec: 10, aoxN: '10' },
        amnesic: 'off',
      }),
    )
    expect(device(PRESET_STORE_KEYS.userDefaults).state.saved.w).toEqual(expect.any(String))
    const W = otherWindow()
    const older = firstSet(seen.saveDefaults, PRESET_STORE_KEYS.userDefaults)
    W.write(PRESET_STORE_KEYS.userDefaults, JSON.stringify(older))
    W.deliver()
    expect(useUserDefaults.getState().saved.settings.saveStats).toBe(false)
    expect(useUserDefaults.getState().saved.prefs).toEqual(older.state.saved.prefs)
  })
})
