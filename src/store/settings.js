import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// settings.js — the ⚙ Settings store (Stage C, Steps 5a + 5b).
//
// Holds the 13 values that live in the Settings popover. Previously these were
// 13 useState hooks inside App; centralizing them is the structural groundwork
// for (a) saved-progress and (b) splitting the fused game modes apart later,
// since the modes can read settings from here instead of receiving them all as
// threaded props.
//
// Step 5b — PERSISTENCE: the store is wrapped in Zustand's `persist` middleware,
// so the 13 settings save to the device (localStorage key 'cg-settings-v1') and
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

// The launch defaults — single source of truth, reused by resetSettings().
export const SETTINGS_DEFAULTS = {
  randomFormat: true,
  dateFormat: 'written-mdy',
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
const resolve = (next, prev) => (typeof next === 'function' ? next(prev) : next)

// The set of keys we persist — exactly the data values (not the setters).
const PERSISTED_KEYS = Object.keys(SETTINGS_DEFAULTS)

export const useSettings = create(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setRandomFormat: (v) => set((s) => ({ randomFormat: resolve(v, s.randomFormat) })),
      setDateFormat: (v) => set((s) => ({ dateFormat: resolve(v, s.dateFormat) })),
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
      // Reset every setting to its launch default in one shot. (App's resetSettings
      // also resets minInputVal/maxInputVal, which live outside this store.) Because
      // the store is persisted, this also overwrites the saved copy back to defaults.
      resetSettings: () => set(() => ({ ...SETTINGS_DEFAULTS })),
    }),
    {
      name: 'cg-settings-v1', // localStorage key (versioned for future migrations)
      version: 1,
      // Persist only the data values, never the setter functions.
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])),
    },
  ),
)
