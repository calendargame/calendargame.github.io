import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetScopedStorage, mergeOverDefaults } from './presets.js'
import type { FormatId } from '../lib/format.js'

// settings.js — the ⚙ Settings store (Stage C, Steps 5a + 5b).
//
// Holds the 14 values that live in the Settings popover (13 at the Stage-C extraction; the Input
// style was added Session 10). Originally these were useState hooks inside App; centralizing them
// is the structural groundwork
// for (a) saved-progress and (b) splitting the fused game modes apart later,
// since the modes can read settings from here instead of receiving them all as
// threaded props.
//
// Step 5b — PERSISTENCE: the store is wrapped in Zustand's `persist` middleware,
// so the 14 settings save to the device (localStorage key 'cg-settings-v1') and
// restore on reload. Only the data values are persisted (partialize strips the
// setter functions); Zustand merges the saved values over the fresh store on
// load, so the setters always come from the live code, never from storage. The
// versioned key lets us migrate cleanly if the settings shape ever changes.
//
// DROP-IN CONTRACT: each setter accepts EITHER a direct value OR a functional
// updater (prev => next) — exactly like a React useState setter — so the call
// sites in App that do setUseJulian(v=>!v) keep working verbatim. App binds the
// store fields/setters to the SAME local names it used before, so the ~200 read
// sites and the big settingsAtDefaults / isFullyReset boolean expressions are
// untouched.
//
// NOT in this store (intentionally): minInputVal / maxInputVal — those are
// transient text-input mirror strings, not persisted settings; they stay as
// local useState in App.

// The day-of-week answer input layout: the classic labelled buttons, or the logo's 7-dot grid
// (Settings → Input). Stored as an enum (not a boolean) so more layouts can be added later.
export type InputStyle = 'buttons' | 'dots'

// The 14 settings values, then the full store (values + setters). Each setter takes a direct
// value OR a React-style functional updater (prev => next), matching App's setX(v=>!v) call sites.
export type SettingsValues = {
  randomFormat: boolean
  dateFormat: FormatId
  inputStyle: InputStyle
  useJulian: boolean
  minY: number
  maxY: number
  leapChance: string
  janFebChance: string
  julianChance: string
  saveStats: boolean
  useSystem: boolean
  darkTheme: string
  lightTheme: string
  manualTheme: string
}
type Updater<T> = T | ((prev: T) => T)
export type SettingsState = SettingsValues & {
  setRandomFormat: (v: Updater<boolean>) => void
  setDateFormat: (v: Updater<FormatId>) => void
  setInputStyle: (v: Updater<InputStyle>) => void
  setUseJulian: (v: Updater<boolean>) => void
  setMinY: (v: Updater<number>) => void
  setMaxY: (v: Updater<number>) => void
  setLeapChance: (v: Updater<string>) => void
  setJanFebChance: (v: Updater<string>) => void
  setJulianChance: (v: Updater<string>) => void
  setSaveStats: (v: Updater<boolean>) => void
  setUseSystem: (v: Updater<boolean>) => void
  setDarkTheme: (v: Updater<string>) => void
  setLightTheme: (v: Updater<string>) => void
  setManualTheme: (v: Updater<string>) => void
  /** ⚠ FACTORY reset — restores SETTINGS_DEFAULTS unconditionally. This is NOT the ⚙ panel's
   *  Reset Settings button, which lands on the user's SAVED personal defaults. Read the warning
   *  at the implementation below before calling this from anywhere outside the test suite. */
  resetToFactory: () => void
  applySettings: (values: SettingsValues) => void
}

// The launch defaults — single source of truth, reused by resetToFactory().
// randomFormat launches OFF (Round-2, 2026-07-12, owner-ratified): a newcomer sees one
// consistent format (Written MDY) instead of five rotating ones; Random stays one tap away.
export const SETTINGS_DEFAULTS: SettingsValues = {
  randomFormat: false,
  dateFormat: 'written-mdy',
  inputStyle: 'buttons',
  useJulian: true,
  minY: 1,
  maxY: 10000,
  leapChance: 'random',
  janFebChance: 'random',
  julianChance: 'random',
  saveStats: true,
  useSystem: true,
  darkTheme: 'dusk',
  lightTheme: 'light',
  manualTheme: 'dusk',
}

// resolve(next, prev): support React-style functional updaters.
const resolve = <T>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : (next as T)

// The set of keys we persist — exactly the data values (not the setters). DERIVED from
// SETTINGS_DEFAULTS rather than listed, so the "14" every comment in this file quotes cannot drift
// from the code: add a setting to SETTINGS_DEFAULTS and it is persisted by construction. ⚠ 14 here
// counts the STORE's settings only. The Save Defaults snapshot is 18 (these 14 + 4 mode prefs) and
// the gear's "modified" comparison is 19 or 18 — both counted in main.tsx, at resetSettings and
// settingsAtDefaults respectively. Do not carry this number over to them.
// ⚠ THE COMPARISON IS NOT A SUBSET OF THE SNAPSHOT, and round 15 is what changed that: it is 17 or
// 16 of the snapshot's 18 (a dormant theme value is always excluded) PLUS the ⚙ panel's two Year
// Range TEXT BOXES, which live in components/useYearRangeMirrors and are stored nowhere. So a year
// that has been TYPED but not committed counts as "modified" while there is nothing to save for it.
const PERSISTED_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsValues)[]

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setRandomFormat: (v) => set((s) => ({ randomFormat: resolve(v, s.randomFormat) })),
      setDateFormat: (v) => set((s) => ({ dateFormat: resolve(v, s.dateFormat) })),
      setInputStyle: (v) => set((s) => ({ inputStyle: resolve(v, s.inputStyle) })),
      setUseJulian: (v) => set((s) => ({ useJulian: resolve(v, s.useJulian) })),
      setMinY: (v) => set((s) => ({ minY: resolve(v, s.minY) })),
      setMaxY: (v) => set((s) => ({ maxY: resolve(v, s.maxY) })),
      setLeapChance: (v) => set((s) => ({ leapChance: resolve(v, s.leapChance) })),
      setJanFebChance: (v) => set((s) => ({ janFebChance: resolve(v, s.janFebChance) })),
      setJulianChance: (v) => set((s) => ({ julianChance: resolve(v, s.julianChance) })),
      setSaveStats: (v) => set((s) => ({ saveStats: resolve(v, s.saveStats) })),
      setUseSystem: (v) => set((s) => ({ useSystem: resolve(v, s.useSystem) })),
      setDarkTheme: (v) => set((s) => ({ darkTheme: resolve(v, s.darkTheme) })),
      setLightTheme: (v) => set((s) => ({ lightTheme: resolve(v, s.lightTheme) })),
      setManualTheme: (v) => set((s) => ({ manualTheme: resolve(v, s.manualTheme) })),
      // ⚠⚠ WHAT THIS IS: a FACTORY reset. It overwrites all 14 settings with SETTINGS_DEFAULTS,
      // unconditionally, ignoring anything the user has saved.
      // ⚠⚠ WHAT THIS IS NOT: the ⚙ panel's "RESET SETTINGS" BUTTON. That button is App's own
      // resetSettings in main.tsx, which restores the user's EFFECTIVE defaults — their SAVED
      // personal defaults (Q7, store/userDefaults) when a snapshot exists, factory only when none
      // does — and additionally restores the two year-range text mirrors and the four capturable
      // mode prefs. Until round 15 this action was itself called `resetSettings`, so the two
      // differed by nothing but their file; the rename is the whole of the fix, and the paragraph
      // below is why it was worth touching sixteen test files to get.
      //   → REACHING FOR THIS ONE FROM APP CODE SILENTLY REVERTS THE WHOLE SAVED-DEFAULTS FEATURE:
      //     the user's saved snapshot survives in its own store, so nothing looks broken, but
      //     "reset" quietly stops meaning what the feature promises. Use applySettings(values) with
      //     effectiveSettingsDefaults instead — that is what App does.
      //   ★ NO APP CODE CALLS THIS. Its only consumers are the test suite's per-case store cleanup
      //     — 51 call sites across 16 files under tests/, one of them tests/helpers/settingsPanel's
      //     resetAppState() — where factory-reset is exactly the wanted semantic.
      // Because the store is persisted, this also overwrites the saved copy back to factory.
      resetToFactory: () => set(() => ({ ...SETTINGS_DEFAULTS })),
      // Apply a full 14-value snapshot in one shot — the values half of what App's Reset Settings
      // and Full Reset restore (the user's SAVED personal defaults via store/userDefaults; the
      // factory SETTINGS_DEFAULTS only when none are saved). This, not resetToFactory above, is the
      // action app code should reach for. Persisted like any set, so the applied values become the
      // stored copy.
      applySettings: (values) => set(() => ({ ...values })),
    }),
    {
      // The localStorage key (versioned for future migrations). It lives in store/presets now, with
      // the other three, because DELETING a preset has to remove exactly its four keys and nothing
      // else — which is only checkable if one place can enumerate them. ⚠ THE STRING IS UNCHANGED,
      // and that is the whole preset design in one line: preset 1 does not receive the existing
      // saved settings, preset 1 IS them.
      name: PRESET_STORE_KEYS.settings,
      // …and this is what makes presets 2, 3, 4… land somewhere else. The `name` above never
      // changes; the adapter rewrites it to the ACTIVE preset's key at each read and each write.
      // See store/presets for why that beat swapping the name on every switch.
      storage: presetScopedStorage<Partial<SettingsState>>(),
      version: 1,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<SettingsState>,
      // Hydration REPLACES the settings; it does not patch the saved copy over whatever is in
      // memory. Identical to zustand's default merge at a cold start (where memory already holds
      // SETTINGS_DEFAULTS); the difference shows on a preset switch, where the default would let a
      // preset that has never saved a given setting inherit the last preset's value — including the
      // theme, which would be visible on screen. Argued in full at mergeOverDefaults.
      merge: mergeOverDefaults(() => SETTINGS_DEFAULTS),
    },
  ),
)
