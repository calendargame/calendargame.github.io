// @vitest-environment jsdom
//
// julianRange.dom — THE YEAR RANGE USED WHILE THE JULIAN CALENDAR SETTING IS ON, in its own
// per-preset key (store/julianRange, Round 26 Q7), against real (jsdom) localStorage.
//
// The rules: a preset with no pair has one derived from its Julian-off pair the first time it is
// opened (the standard 1-10000 becomes 1-11582, any other range is copied) and PINNED — written once —
// so nothing done later to the Julian-off pair moves it; a usable saved pair is the pair, for good.
// The key is one of the preset's keys: deleted with it, counted in "is it factory?", copied by
// Duplicate Preset, counted in the storage reading, and swept when an older build's delete leaves
// it behind.
import { describe, it, expect, beforeEach } from 'vitest'
import { usePresets, makePresetRegistryDefaults, presetKey } from '../src/store/presets.js'
import {
  createPreset,
  switchPreset,
  deletePreset,
  duplicatePreset,
  isPresetFactory,
  sweepDeletedPresetLeftovers,
} from '../src/store/presetControl.js'
import { useSettings } from '../src/store/settings.js'
import { useModePrefs } from '../src/store/modePrefs.js'
import { useProgress } from '../src/store/progress.js'
import {
  useUserDefaults,
  effectiveJulianRangeDefaults,
  effectiveSettingsDefaults,
} from '../src/store/userDefaults.js'
import {
  useJulianRange,
  deriveJulianRange,
  readJulianRange,
  JULIAN_RANGE_DEFAULTS,
} from '../src/store/julianRange.js'
import { readStorageUsage } from '../src/store/storageUsage.js'

const KEY = 'cg-julianrange-v1' // spelled out: this file tests the spelling
const SETTINGS = 'cg-settings-v1'
const saved = (id) => {
  const raw = localStorage.getItem(presetKey(KEY, id))
  return raw === null ? null : JSON.parse(raw)
}
const pair = () => {
  const { julianMinY, julianMaxY } = useJulianRange.getState()
  return [julianMinY, julianMaxY]
}
// A preset's settings as an older build (or this one) saved them: the 16 values, version 4.
const writeSettings = (id, values) =>
  localStorage.setItem(
    presetKey(SETTINGS, id),
    JSON.stringify({ state: { ...useSettings.getState(), ...values }, version: 4 }),
  )

function resetAll() {
  localStorage.clear()
  usePresets.setState(makePresetRegistryDefaults())
  useSettings.getState().resetToFactory()
  useModePrefs.getState().resetModePrefs()
  useProgress.getState().resetProgress()
  useUserDefaults.getState().clearDefaults()
  useJulianRange.getState().applyJulianRange({ ...JULIAN_RANGE_DEFAULTS })
  localStorage.clear()
}
beforeEach(resetAll)

describe('the rule', () => {
  it('derives 1-11582 from the standard 1-10000, and copies any other range', () => {
    expect(deriveJulianRange({ minY: 1, maxY: 10000 })).toEqual({
      julianMinY: 1,
      julianMaxY: 11582,
    })
    expect(deriveJulianRange({ minY: 1900, maxY: 2100 })).toEqual({
      julianMinY: 1900,
      julianMaxY: 2100,
    })
    expect(deriveJulianRange({ minY: 1, maxY: 9999 })).toEqual({ julianMinY: 1, julianMaxY: 9999 })
    expect(deriveJulianRange({ minY: 2, maxY: 10000 })).toEqual({
      julianMinY: 2,
      julianMaxY: 10000,
    })
  })
  it('a saved pair is usable only as two whole years, 1 <= min <= max <= 11582', () => {
    expect(readJulianRange({ julianMinY: 1, julianMaxY: 11582 })).toEqual({
      julianMinY: 1,
      julianMaxY: 11582,
    })
    for (const bad of [
      null,
      'x',
      {},
      { julianMinY: 0, julianMaxY: 5 },
      { julianMinY: 5, julianMaxY: 4 },
      { julianMinY: 1, julianMaxY: 11583 },
      { julianMinY: 1.5, julianMaxY: 4 },
      { julianMinY: '1', julianMaxY: 4 },
    ])
      expect(readJulianRange(bad)).toBe(null)
  })
})

describe('first open: derived and pinned', () => {
  it('a preset with no pair gets one from its Julian-off range, written once, and an edit to that range afterwards does not move it', () => {
    const p = createPreset()
    writeSettings(p.id, { minY: 1900, maxY: 2100 })
    expect(saved(p.id)).toBe(null)
    switchPreset(p.id)
    expect(pair()).toEqual([1900, 2100])
    expect(saved(p.id)).toMatchObject({ state: { julianMinY: 1900, julianMaxY: 2100 }, version: 1 })
    // The Julian-off range moves (here, or in an older tab) — the pinned pair does not.
    writeSettings(p.id, { minY: 1500, maxY: 1700 })
    switchPreset(1)
    switchPreset(p.id)
    expect(useSettings.getState().minY).toBe(1500)
    expect(pair()).toEqual([1900, 2100])
  })
  it('a factory preset pins 1-11582', () => {
    const p = createPreset()
    switchPreset(p.id)
    expect(pair()).toEqual([1, 11582])
    expect(saved(p.id).state).toEqual(JULIAN_RANGE_DEFAULTS)
  })
  it('a pair set to 1-10000 stays 1-10000 — the one remedy the changelog offers sticks', () => {
    const p = createPreset()
    switchPreset(p.id)
    useJulianRange.getState().setJulianMaxY(10000)
    switchPreset(1)
    switchPreset(p.id)
    expect(pair()).toEqual([1, 10000])
  })
  it('an unusable saved pair is derived again, never guessed', () => {
    const p = createPreset()
    writeSettings(p.id, { minY: 1700, maxY: 1800 })
    localStorage.setItem(
      presetKey(KEY, p.id),
      JSON.stringify({ state: { julianMinY: 9, julianMaxY: 3 }, version: 1 }),
    )
    switchPreset(p.id)
    expect(pair()).toEqual([1700, 1800])
    expect(saved(p.id).state).toEqual({ julianMinY: 1700, julianMaxY: 1800 })
  })
})

describe('one of the preset’s keys', () => {
  it('goes with the preset when it is deleted', () => {
    const p = createPreset()
    switchPreset(p.id)
    expect(saved(p.id)).not.toBe(null)
    switchPreset(1)
    deletePreset(p.id)
    expect(saved(p.id)).toBe(null)
  })
  it('is factory when absent or 1-11582, and holds something otherwise', () => {
    const p = createPreset()
    expect(isPresetFactory(p.id, true)).toBe(true) // absent
    switchPreset(p.id)
    switchPreset(1)
    expect(isPresetFactory(p.id, true)).toBe(true) // pinned 1-11582
    localStorage.setItem(
      presetKey(KEY, p.id),
      JSON.stringify({ state: { julianMinY: 1, julianMaxY: 10000 }, version: 1 }),
    )
    expect(isPresetFactory(p.id, true)).toBe(false)
  })
  it('is copied by Duplicate Preset', () => {
    const p = createPreset()
    switchPreset(p.id)
    useJulianRange.getState().applyJulianRange({ julianMinY: 300, julianMaxY: 11000 })
    const copy = duplicatePreset(p.id) // the preset you are on: as it is on screen
    expect(saved(copy.id).state).toEqual({ julianMinY: 300, julianMaxY: 11000 })
    switchPreset(1)
    const copy2 = duplicatePreset(p.id) // a preset you are not on: as it is saved
    expect(saved(copy2.id).state).toEqual({ julianMinY: 300, julianMaxY: 11000 })
  })
  it('is counted in the storage reading, under its preset', () => {
    const p = createPreset()
    switchPreset(p.id)
    const text = localStorage.getItem(presetKey(KEY, p.id))
    const row = readStorageUsage(localStorage).rows.find(
      (r) => r.kind === 'preset' && r.presetId === p.id,
    )
    expect(row.chars).toBeGreaterThanOrEqual((presetKey(KEY, p.id) + text).length)
  })
  it('left behind by a delete that did not know it (an older build’s), it is swept at a cold open — and only then if no list names the preset', () => {
    const p = createPreset()
    switchPreset(p.id)
    switchPreset(1)
    localStorage.setItem(
      presetKey(KEY, 99),
      JSON.stringify({ state: JULIAN_RANGE_DEFAULTS, version: 1 }),
    )
    sweepDeletedPresetLeftovers()
    expect(saved(99)).toBe(null)
    expect(saved(p.id)).not.toBe(null) // a listed preset's stays
  })
})

describe('saved defaults', () => {
  it('a snapshot with the pair gives the pair; one without derives it from the snapshot’s own range', () => {
    const settings = { ...effectiveSettingsDefaults(null), minY: 1500, maxY: 1600 }
    const base = {
      prefs: { flashMs: 800, blitzSec: 60, blitzQSec: 10, aoxN: '10' },
      amnesic: false,
    }
    expect(effectiveJulianRangeDefaults(null)).toEqual(JULIAN_RANGE_DEFAULTS)
    expect(effectiveJulianRangeDefaults({ ...base, settings })).toEqual({
      julianMinY: 1500,
      julianMaxY: 1600,
    })
    expect(
      effectiveJulianRangeDefaults({
        ...base,
        settings: { ...settings, julianMinY: 2, julianMaxY: 11000 },
      }),
    ).toEqual({ julianMinY: 2, julianMaxY: 11000 })
    // …and the settings half never carries the pair into the settings store.
    expect(
      Object.keys(
        effectiveSettingsDefaults({
          ...base,
          settings: { ...settings, julianMinY: 2, julianMaxY: 3 },
        }),
      ),
    ).not.toContain('julianMinY')
  })
})
