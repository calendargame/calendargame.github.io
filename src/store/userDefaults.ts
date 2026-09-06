import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetScopedStorage, mergeOverDefaults } from './presets.js'
import { SETTINGS_DEFAULTS } from './settings.js'
import type { SettingsValues } from './settings.js'
import { MODE_PREFS_DEFAULTS } from './modePrefs.js'

// userDefaults.ts — the user's saved PERSONAL DEFAULTS (Session 11, Q7 "Save Defaults").
//
// The ⚙ footer's Save Defaults button snapshots the full 14-value settings panel PLUS the four
// capturable mode-screen prefs (Flash reveal speed, both Blitz timer lengths, the AoX run length —
// deliberately NOT Blitz Per-Round/Per-Question, Deduction sub-type, Allow Mistakes, One-by-One,
// or the show/hide stat toggles). From then on those saved values — not the factory constants —
// are what "default" means everywhere: Reset Settings restores the saved panel values AND the four
// prefs (extended to the prefs in round-6 Q7 — it used to be panel-only), Full Reset does the same
// and additionally wipes stats/history and returns every non-capturable mode pref to factory, and
// the gear's "modified" bar lights when live state diverges from them.
//
// A THIRD store (not a settings-store v2) because the capture spans two stores — it belongs to
// neither — and because surviving Full Reset must be an explicit property: Full Reset deliberately
// does NOT clear this store (restoring "your" defaults requires them to outlive it); the only way
// back to factory is the ⚙ footer's "Clear saved defaults" link (clearDefaults) — the single clear
// affordance (Round-4 removed the Save Defaults popup's duplicate link), always reachable: at
// steady state live == saved dims + locks the Save Defaults button, but never the footer link.
//
// `saved` is null until the user saves (null = factory semantics everywhere, via the effective*
// helpers below). Same persist pattern as the other stores (localStorage 'cg-userdefaults-v1',
// versioned, partialize strips the actions).

// The four capturable mode-screen prefs. aoxN stays a STRING like the modePrefs field it mirrors;
// it is normalized (normalizeAoxN) at save time, and every comparison re-normalizes defensively —
// the live store can hold transient unclamped strings ('', '007') mid-typing.
export type PrefDefaults = {
  flashMs: number
  blitzSec: number
  blitzQSec: number
  aoxN: string
}
export type SavedDefaults = { settings: SettingsValues; prefs: PrefDefaults }
export type UserDefaultsState = {
  saved: SavedDefaults | null
  saveDefaults: (snapshot: SavedDefaults) => void
  clearDefaults: () => void
}

// The factory values of the four capturable prefs, in PrefDefaults shape (module constant — the
// effective helpers below return it for the null case and forward-merge under it otherwise).
const FACTORY_PREF_DEFAULTS: PrefDefaults = {
  flashMs: MODE_PREFS_DEFAULTS.flashMs,
  blitzSec: MODE_PREFS_DEFAULTS.blitzSec,
  blitzQSec: MODE_PREFS_DEFAULTS.blitzQSec,
  aoxN: MODE_PREFS_DEFAULTS.aoxN,
}

// The EFFECTIVE defaults — what "default" currently means: the saved personal values when they
// exist, the factory launch constants otherwise. Pure; App and the mode freshness checks compose
// these with the live stores. A saved snapshot is FORWARD-MERGED over the factory constants: a
// snapshot persisted before a release that adds a new settings/prefs field would otherwise yield
// `undefined` for it — permanently failing every at-defaults comparison (gear stuck on "modified")
// and writing `undefined` into the live store on Reset/Full Reset. Fields the saver never saw
// simply mean factory.
export const effectiveSettingsDefaults = (saved: SavedDefaults | null): SettingsValues =>
  saved ? { ...SETTINGS_DEFAULTS, ...saved.settings } : SETTINGS_DEFAULTS
export const effectivePrefDefaults = (saved: SavedDefaults | null): PrefDefaults =>
  saved ? { ...FACTORY_PREF_DEFAULTS, ...saved.prefs } : FACTORY_PREF_DEFAULTS

// The AoX run-length clamp — the rule's ONE home (Q18): the AoX run-length box's blur/Enter/Escape
// commits (modes/AoxMode), the Save Defaults and manage-defaults N fields (components/SettingsPanel)
// and the defaults card's own N field (components/DefaultsCard) all call it — plus prefsMatchDefaults
// just below, which re-normalizes both sides. 2–1000, non-numeric → 10.
export const normalizeAoxN = (s: string): string =>
  String(Math.max(2, Math.min(1000, parseInt(s) || 10)))

// Do the live values of the four capturable prefs match the (effective) defaults? aoxN is
// normalized on BOTH sides so a transient unclamped string never reads as a divergence its
// committed value doesn't have.
export const prefsMatchDefaults = (live: PrefDefaults, def: PrefDefaults): boolean =>
  live.flashMs === def.flashMs &&
  live.blitzSec === def.blitzSec &&
  live.blitzQSec === def.blitzQSec &&
  normalizeAoxN(live.aoxN) === normalizeAoxN(def.aoxN)

export const useUserDefaults = create<UserDefaultsState>()(
  persist(
    (set) => ({
      saved: null,
      // Shallow-copy the snapshot so no live object is shared into the persisted store.
      saveDefaults: (snapshot) =>
        set({ saved: { settings: { ...snapshot.settings }, prefs: { ...snapshot.prefs } } }),
      clearDefaults: () => set({ saved: null }),
    }),
    {
      // The localStorage key, unchanged — preset 1 IS the existing saved defaults. Enumerated in
      // store/presets so a preset delete can remove exactly its four keys; the adapter beside it
      // sends presets 2, 3, 4… to a namespaced one. Each preset therefore has its OWN saved
      // personal defaults, which is what makes a Full Reset inside a preset land on THAT preset's
      // saved values rather than on some other preset's.
      name: PRESET_STORE_KEYS.userDefaults,
      storage: presetScopedStorage<Pick<UserDefaultsState, 'saved'>>(),
      version: 1,
      // Persist only the snapshot, never the action functions.
      partialize: (state) => ({ saved: state.saved }),
      // Hydration replaces the snapshot rather than patching it over memory. Sharpest here of the
      // four: without it, opening a preset that has never saved defaults would leave the LAST
      // preset's snapshot standing, and a Full Reset inside the new preset would restore another
      // preset's settings. See mergeOverDefaults.
      merge: mergeOverDefaults(() => ({ saved: null })),
    },
  ),
)
