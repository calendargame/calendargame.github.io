import { describe, it, expect, beforeEach } from 'vitest'
import {
  useUserDefaults,
  effectiveSettingsDefaults,
  effectivePrefDefaults,
  effectiveAmnesicDefault,
  normalizeAoxN,
  prefsMatchDefaults,
} from '../src/store/userDefaults.js'
import { SETTINGS_DEFAULTS } from '../src/store/settings.js'
import { MODE_PREFS_DEFAULTS } from '../src/store/modePrefs.js'

// userDefaults.test.js — the saved-personal-defaults store (Session 11, Q7 "Save Defaults")
// and its pure helpers. Mirrors settings.test.js/modePrefs.test.js: locks the pure state
// contract (snapshot round-trip, null = factory semantics, the effective-defaults fallbacks,
// the aoxN normalization every comparison must route through). Persistence (localStorage
// 'cg-userdefaults-v1') is verified in-browser like the other stores. The App-level behavior
// (Reset Settings / Full Reset / the gear indicator honoring these values) is covered in
// tests/saveDefaults.dom.test.jsx.

const CUSTOM_SETTINGS = { ...SETTINGS_DEFAULTS, leapChance: '75', minY: 1600, useJulian: false }
// Every CUSTOM value diverges from MODE_PREFS_DEFAULTS (blitzQSec 15 ≠ the factory 10) so each
// comparison below genuinely proves saved-vs-factory, not an accidental equality.
const CUSTOM_PREFS = { flashMs: 800, blitzSec: 90, blitzQSec: 15, aoxN: '25' }
const FACTORY_PREFS = {
  flashMs: MODE_PREFS_DEFAULTS.flashMs,
  blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
  blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
  aoxN: MODE_PREFS_DEFAULTS.aoxN,
}
// Round-20 Q4 — diverges from the factory `false` the same way the settings/prefs fixtures above
// diverge from theirs, so a round-trip through it proves something rather than being a coincidence.
const CUSTOM_AMNESIC = true

describe('userDefaults store', () => {
  beforeEach(() => {
    // Reset to a known baseline (the store is a singleton).
    useUserDefaults.getState().clearDefaults()
  })

  it('starts with no saved defaults (null = factory semantics)', () => {
    expect(useUserDefaults.getState().saved).toBeNull()
  })

  it('saveDefaults round-trips a snapshot; clearDefaults returns to null', () => {
    useUserDefaults
      .getState()
      .saveDefaults({ settings: CUSTOM_SETTINGS, prefs: CUSTOM_PREFS, amnesic: CUSTOM_AMNESIC })
    const saved = useUserDefaults.getState().saved
    expect(saved.settings).toEqual(CUSTOM_SETTINGS)
    expect(saved.prefs).toEqual(CUSTOM_PREFS)
    expect(saved.amnesic).toBe(CUSTOM_AMNESIC)
    useUserDefaults.getState().clearDefaults()
    expect(useUserDefaults.getState().saved).toBeNull()
  })

  it('saveDefaults copies the snapshot — mutating the input never leaks into the store', () => {
    const settings = { ...CUSTOM_SETTINGS }
    const prefs = { ...CUSTOM_PREFS }
    useUserDefaults.getState().saveDefaults({ settings, prefs, amnesic: CUSTOM_AMNESIC })
    settings.leapChance = 'random'
    prefs.flashMs = 12345
    expect(useUserDefaults.getState().saved.settings.leapChance).toBe('75')
    expect(useUserDefaults.getState().saved.prefs.flashMs).toBe(800)
  })
})

describe('userDefaults pure helpers', () => {
  it('effectiveSettingsDefaults: factory when null, the saved panel when present', () => {
    expect(effectiveSettingsDefaults(null)).toBe(SETTINGS_DEFAULTS)
    const saved = { settings: CUSTOM_SETTINGS, prefs: CUSTOM_PREFS }
    expect(effectiveSettingsDefaults(saved)).toEqual(CUSTOM_SETTINGS)
  })

  it('effectivePrefDefaults: exactly the 4 capturable factory keys when null, saved prefs when present', () => {
    expect(effectivePrefDefaults(null)).toEqual(FACTORY_PREFS)
    expect(Object.keys(effectivePrefDefaults(null))).toHaveLength(4)
    const saved = { settings: CUSTOM_SETTINGS, prefs: CUSTOM_PREFS }
    expect(effectivePrefDefaults(saved)).toEqual(CUSTOM_PREFS)
  })

  // Round-20 Q4 — mirrors the two tests above: factory (false) when nothing is saved, the saved
  // value (in EITHER direction) when a snapshot exists.
  it('effectiveAmnesicDefault: factory (false) when null, the saved value when present', () => {
    expect(effectiveAmnesicDefault(null)).toBe(false)
    expect(
      effectiveAmnesicDefault({ settings: CUSTOM_SETTINGS, prefs: CUSTOM_PREFS, amnesic: true }),
    ).toBe(true)
    expect(
      effectiveAmnesicDefault({ settings: CUSTOM_SETTINGS, prefs: CUSTOM_PREFS, amnesic: false }),
    ).toBe(false)
  })

  it('a saved snapshot is FORWARD-MERGED over factory — fields a release adds after the save mean factory, never undefined', () => {
    // Simulate a snapshot persisted by an OLDER build: strip a field from each half. Without the
    // merge, the missing fields would come back undefined — permanently failing every at-defaults
    // comparison (gear stuck on "modified") and writing undefined into the live store on Reset.
    const { leapChance: _dropS, ...oldSettings } = CUSTOM_SETTINGS
    const { blitzQSec: _dropP, ...oldPrefs } = CUSTOM_PREFS
    const saved = { settings: oldSettings, prefs: oldPrefs }
    expect(effectiveSettingsDefaults(saved)).toEqual({
      ...CUSTOM_SETTINGS,
      leapChance: SETTINGS_DEFAULTS.leapChance, // the unsaved field falls back to factory
    })
    expect(effectivePrefDefaults(saved)).toEqual({
      ...CUSTOM_PREFS,
      blitzQSec: FACTORY_PREFS.blitzQSec,
    })
    // amnesic wasn't SPREAD onto `saved` at all here — the one-boolean equivalent of "a release adds
    // this field after the save": a build from before round-20 Q4 never wrote it, so `saved.amnesic`
    // is `undefined` rather than merely absent from an object spread. Must still read factory (false).
    expect(effectiveAmnesicDefault(saved)).toBe(false)
  })

  it('normalizeAoxN applies the AoX commit clamp (2–1000, non-numeric → 10)', () => {
    expect(normalizeAoxN('10')).toBe('10')
    expect(normalizeAoxN('007')).toBe('7') // transient leading zeros normalize
    expect(normalizeAoxN('1')).toBe('2') // clamp low
    expect(normalizeAoxN('5000')).toBe('1000') // clamp high
    expect(normalizeAoxN('')).toBe('10') // empty mid-typing → fallback
    expect(normalizeAoxN('abc')).toBe('10') // non-numeric → fallback
  })

  // ★ THE FALSY-ZERO PATH — pre-existing defect D5 in _settings_net_spec.md, PINNED AS-IS AND NOT
  // FIXED. This is a characterization test: every expectation below is what the app does TODAY,
  // and none of it is a claim that today's answer is the right one.
  //
  // WHAT IT IS. The clamp is `Math.max(2, Math.min(1000, parseInt(s) || 10))`. `parseInt('0')` is
  // 0, 0 is FALSY, so `|| 10` swallows it and '0' comes out as TEN — not as the 2 the low clamp
  // would give it, and not as the 2 that '1' beside it gets. Every other under-2 number DOES land
  // on 2, so the sequence −1 → 0 → 1 reads 2, 10, 2: the fallback punches a hole in the middle of
  // the clamp. Nothing covered '0' or a negative before this, in this file or anywhere.
  //
  // WHY IT IS WORTH A TEST RATHER THAN A FIX. It is reachable — the AoX run-length box accepts
  // digits and commits on blur/Enter/Escape (src/modes/AoxMode.tsx ~531), so typing 0 and tabbing
  // away really does produce an Ao10 — and it is exactly the shape of thing a later tidy-up
  // "corrects" in passing. `|| 10` → `?? 10`, or an explicit Number.isNaN check, moves '0' from
  // '10' to '2' silently and changes what thirteen call sites answer: prefsMatchDefaults on both sides
  // (store/userDefaults), AoxMode's run length, its freshness compare and its three commits, the
  // Save-Defaults and manager seeds and commits (components/SettingsPanel), and the defaults
  // card's dirty check, commit and slider value (components/DefaultsCard). Two of those coerce
  // straight to a number (`+normalizeAoxN(...)`), so the change would silently shorten a run.
  //
  // So: if this test goes red, the behaviour changed. That is either a deliberate decision the
  // owner made — in which case update the expectations here in the same commit — or an accident,
  // which is the whole reason the case exists.
  it('normalizeAoxN sends 0 to 10 rather than to 2, because 0 is falsy (defect D5, pinned not fixed)', () => {
    // The hole itself, and its neighbours on either side, so the discontinuity is the assertion
    // rather than a lone value that could be read as ordinary clamping.
    expect(normalizeAoxN('-1')).toBe('2') // below the floor → the floor
    expect(normalizeAoxN('0')).toBe('10') // …but zero is falsy, so it takes the FALLBACK
    expect(normalizeAoxN('1')).toBe('2') // and one is back to the floor
    // Every spelling of zero the box or a persisted snapshot can hold takes the same branch.
    expect(normalizeAoxN('00')).toBe('10')
    expect(normalizeAoxN('000')).toBe('10') // the leading-zero form '007' normalizes to 7
    expect(normalizeAoxN('-0')).toBe('10')
    expect(normalizeAoxN('0.9')).toBe('10') // parseInt stops at the dot → 0 → falsy
    // Negatives are otherwise ordinary: they are clamped, never sent to the fallback.
    expect(normalizeAoxN('-5')).toBe('2')
    expect(normalizeAoxN('-9999')).toBe('2')
  })

  it('prefsMatchDefaults compares the 4 prefs with aoxN normalized on BOTH sides', () => {
    expect(prefsMatchDefaults(FACTORY_PREFS, FACTORY_PREFS)).toBe(true)
    // A transient unclamped aoxN string must not read as a divergence its committed value lacks.
    expect(prefsMatchDefaults({ ...FACTORY_PREFS, aoxN: '010' }, FACTORY_PREFS)).toBe(true)
    // Each field diverging alone flips the answer.
    expect(prefsMatchDefaults({ ...FACTORY_PREFS, flashMs: 800 }, FACTORY_PREFS)).toBe(false)
    expect(prefsMatchDefaults({ ...FACTORY_PREFS, blitzSec: 90 }, FACTORY_PREFS)).toBe(false)
    expect(prefsMatchDefaults({ ...FACTORY_PREFS, blitzQSec: 15 }, FACTORY_PREFS)).toBe(false)
    expect(prefsMatchDefaults({ ...FACTORY_PREFS, aoxN: '25' }, FACTORY_PREFS)).toBe(false)
  })
})
