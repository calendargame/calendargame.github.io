import { create } from 'zustand'

// settings.js — the ⚙ Settings store (Stage C, Step 5a).
//
// Holds the 13 values that live in the Settings popover. Previously these were
// 13 useState hooks inside App; centralizing them is the structural groundwork
// for (a) Stage D saved-progress (one persist() wrapper away) and (b) splitting
// the fused game modes apart later, since the modes can read settings from here
// instead of receiving them all as threaded props.
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

export const useSettings = create((set) => ({
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
  // also resets minInputVal/maxInputVal, which live outside this store.)
  resetSettings: () => set(() => ({ ...SETTINGS_DEFAULTS })),
}))
