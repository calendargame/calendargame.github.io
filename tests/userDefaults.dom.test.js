// @vitest-environment jsdom
//
// userDefaults.dom.test.js — the saved-personal-defaults store against REAL (jsdom)
// localStorage, end to end. Mirrors tests/dotRotation.dom.test.jsx's "settings store — every saved
// shape of Rotate Dots rehydrates through the migration" describe, one level deeper: this store's
// persisted `saved.settings` is a FULL SNAPSHOT of SettingsValues, not a live mirror of
// useSettings — so useSettings' own migrate (store/settings.ts), which only ever sees ITS OWN
// persisted blob at `cg-settings-v1`, can never reach in and fix a stale snapshot sitting inside
// `cg-userdefaults-v1`. This store needs — and has had since round 20, and extends in round 23 — the
// identical migration applied to that nested object. It is the store a settings migration has
// forgotten before, which is why every shape is walked here and not only the newest.
//
// The pure rewrite (`migrateDotRotation`) is unit-tested in settings.test.js (Node) and reused
// here rather than reimplemented, exactly as store/userDefaults.ts's own migrate does. This file
// proves the WIRING: stored `saved.settings` payloads actually reaching it via
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
// The settings snapshot as a pre-round-23 build saved it: no `dotRotation`, whatever it had instead.
const { dotRotation: _drop, ...PRE_Q6 } = SETTINGS_DEFAULTS

const store = (settings, version, amnesic = false) =>
  localStorage.setItem(
    'cg-userdefaults-v1',
    JSON.stringify({ state: { saved: { settings, prefs: PREFS, amnesic } }, version }),
  )
const stored = () => JSON.parse(localStorage.getItem('cg-userdefaults-v1'))

describe('userDefaults store — every saved shape of Rotate Dots rehydrates through the migration', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserDefaults.getState().clearDefaults()
  })
  afterEach(() => {
    localStorage.clear()
    useUserDefaults.getState().clearDefaults()
  })

  it('a v2 snapshot (round 20–22) with rotateDots: true loads as dotRotation: 90° CCW', async () => {
    store({ ...PRE_Q6, rotateDots: true, minY: 1600 }, 2)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.dotRotation).toBe('ccw90')
    // Everything else passed through untouched, and the old field name did not tag along.
    expect(saved.settings.minY).toBe(1600)
    expect(saved.settings).not.toHaveProperty('rotateDots')
    expect(saved.prefs).toEqual(PREFS)
    expect(saved.amnesic).toBe(false)
    // …and the rewrite reached DISK at once (zustand re-saves after a migration), at this version.
    expect(stored().version).toBe(3)
    expect(stored().state.saved.settings).not.toHaveProperty('rotateDots')
    expect(stored().state.saved.settings.dotRotation).toBe('ccw90')
  })

  it('a v2 snapshot with rotateDots: false lands on the factory Standard', async () => {
    store({ ...PRE_Q6, rotateDots: false }, 2, true)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings).not.toHaveProperty('rotateDots')
    expect(effectiveSettingsDefaults(saved).dotRotation).toBe('standard')
    // The migration only touches settings — amnesic rides through the same `merge` as ever.
    expect(saved.amnesic).toBe(true)
  })

  it('a v1 snapshot with the ORIGINAL dotOrientation "rows" loads as 90° CCW — the oldest shape still reaches today', async () => {
    store({ ...PRE_Q6, dotOrientation: 'rows' }, 1)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.dotRotation).toBe('ccw90')
    expect(saved.settings).not.toHaveProperty('dotOrientation')
  })

  it('a snapshot from BEFORE the setting existed (no field at all) forward-merges to Standard at read time', async () => {
    store(PRE_Q6, 1)
    await useUserDefaults.persist.rehydrate()
    expect(useUserDefaults.getState().saved.settings).not.toHaveProperty('dotRotation')
    expect(effectiveSettingsDefaults(useUserDefaults.getState().saved).dotRotation).toBe('standard')
  })

  it('nothing ever saved (saved: null) passes through the migration untouched', async () => {
    localStorage.setItem(
      'cg-userdefaults-v1',
      JSON.stringify({ state: { saved: null }, version: 2 }),
    )
    await useUserDefaults.persist.rehydrate()
    expect(useUserDefaults.getState().saved).toBeNull()
  })

  it('a current-version (v3) snapshot rehydrates unchanged — 45° survives', async () => {
    store({ ...SETTINGS_DEFAULTS, dotRotation: 'ccw45', dateFormat: 'numeric-ymd' }, 3)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.dotRotation).toBe('ccw45')
    expect(saved.settings.dateFormat).toBe('numeric-ymd')
  })

  // ★ THE OLDER-BUILD ROUND TRIP, as it really arrives. A pre-round-23 build that opens after this
  // one re-saves the snapshot under ITS version (2) — but keeps `saved` whole, so today's field is
  // still inside it, possibly beside a `rotateDots` of its own. Coming back, the current field wins.
  it('a snapshot an older build re-saved (v2, dotRotation still inside) keeps 45° — the current field wins', async () => {
    store({ ...SETTINGS_DEFAULTS, dotRotation: 'ccw45', rotateDots: false }, 2)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings.dotRotation).toBe('ccw45')
    expect(saved.settings).not.toHaveProperty('rotateDots')
  })

  // ★ THIS BUILD AS THE OLDER ONE. A future build that adds a rotation bumps the version; zustand
  // still runs this build's migrate on the mismatch, which screens the value it cannot draw.
  it('a NEWER-version snapshot with a rotation this build does not know falls back to Standard', async () => {
    store({ ...SETTINGS_DEFAULTS, dotRotation: 'ccw30' }, 99)
    await useUserDefaults.persist.rehydrate()
    const { saved } = useUserDefaults.getState()
    expect(saved.settings).not.toHaveProperty('dotRotation')
    expect(effectiveSettingsDefaults(saved).dotRotation).toBe('standard')
  })

  // The end-to-end payoff, not just the store-level shape: a stale saved snapshot must not make
  // Reset Settings / Full Reset silently revert Rotate Dots — the symptom round 20's ship-blocker
  // finding described. effectiveSettingsDefaults is the one function both call.
  it('effectiveSettingsDefaults reads the migrated rotation, not the factory Standard', async () => {
    store({ ...PRE_Q6, rotateDots: true }, 2)
    await useUserDefaults.persist.rehydrate()
    expect(effectiveSettingsDefaults(useUserDefaults.getState().saved).dotRotation).toBe('ccw90')
  })
})
