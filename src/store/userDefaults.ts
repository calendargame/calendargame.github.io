import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetKey, presetDoc, mergeOverDefaults } from './presets.js'
import type { PresetDocSpec } from './presets.js'
import { cyrb53, canonicalJson } from './syncStamp.js'
import { readItem } from './storageHealth.js'
import { SETTINGS_DEFAULTS, migrateDotRotation } from './settings.js'
import type { SettingsValues, LegacyDotFields } from './settings.js'
import { MODE_PREFS_DEFAULTS } from './modePrefs.js'
import { readAmnesicMode, storedAmnesic } from './amnesicMode.js'
import type { AmnesicMode, StoredAmnesic } from './amnesicMode.js'
import { deriveJulianRange, readJulianRange } from './julianRange.js'
import type { JulianRangeValues } from './julianRange.js'

// userDefaults.ts — the user's saved PERSONAL DEFAULTS (Session 11, "Save Defaults").
//
// The ⚙ panel's Save Defaults button snapshots the full 16-value settings panel PLUS the four
// capturable mode-screen prefs (Flash reveal speed, both Blitz timer lengths, the AoX run length —
// deliberately NOT Blitz Per-Round/Per-Question, Deduction sub-type, Allow Mistakes, One-by-One,
// or the show/hide stat toggles) PLUS, since round 20, the active preset's Amnesic setting (Off,
// Stats Only or Full) at the moment of saving. From then on those saved values — not the factory
// constants — are what "default" means everywhere: Reset Settings restores the saved panel values
// AND the four prefs (extended to the prefs in round 6 — it used to be panel-only) AND the saved
// Amnesic setting,
// Full Reset does the same (it delegates its ENTIRE settings restore to resetSettings, Amnesic
// included — see main.tsx's resetSettings) and additionally wipes stats/history and returns every
// non-capturable mode pref to factory, and the gear's "modified" bar lights when live state
// diverges from the panel + prefs — AMNESIC INCLUDED as of round 22.
// ⚠ THAT LAST CLAUSE USED TO READ "NEVER for Amnesic", on the reasoning that the flag is a property
// of the preset rather than a settings value. The premise was right and the conclusion was a BUG:
// the gear's bar, Reset Settings' dim and Save Defaults' dim are one expression (main.tsx's
// settingsAtDefaults), so excluding Amnesic from it left Save Defaults dimmed and INERT whenever
// Amnesic was the only thing a player had changed — making "Amnesic: on" impossible to capture into
// the very snapshot this file says captures it. It is compared there now, against
// effectiveAmnesicDefault below, and every offer that lights as a result genuinely acts on it.
// ★ THE SAVED AMNESIC SETTING IS ALSO WHAT A FRESH APP OPEN STARTS EACH PRESET ON
// (store/sessionAmnesic): the setting itself is held for the browsing session only, and this
// snapshot is the one permanent thing that says what it should be the next time the app is opened.
//
// A THIRD store (not a settings-store v2) because the capture spans two stores — it belongs to
// neither — and because surviving Full Reset must be an explicit property: Full Reset deliberately
// does NOT clear this store (restoring "your" defaults requires them to outlive it); the only way
// back to factory is the ⚙ panel's "Clear Saved Defaults" button (clearDefaults) — the single clear
// affordance (Round-4 removed the Save Defaults popup's duplicate link), always reachable: at
// steady state live == saved dims + locks the Save Defaults button, but never Clear Saved Defaults
// (which dims only while nothing is saved).
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
// The Amnesic setting of the ACTIVE PRESET at the moment of saving (round 20; three-way since
// round 24). Owner's explicit, confirmed decision: Save Defaults captures it, and Reset Settings /
// Full Reset restore it along with everything else — even though pressing either mid-guest-session
// for an unrelated reason will then silently put Amnesic back to whatever was saved. See
// effectiveAmnesicDefault below and main.tsx's resetSettings for the restore.
// ⚠ A SNAPSHOT IS HANDED IN WITH THE VALUE AND SAVED IN ITS TWO-FIELD SPELLING (store/amnesicMode's
// StoredAmnesic — the boolean an older build on this origin acts on, and the three-way value beside
// it). Nothing reads either field directly: effectiveAmnesicDefault is the way in.
// ★ THE SNAPSHOT'S `settings` CARRIES THE JULIAN-ON YEAR RANGE TOO (Round 26, Q7): the 16 settings
// plus `julianMinY` / `julianMaxY` (store/julianRange). There, and not in a store-shaped field of its
// own, because that is the one place every older build's write keeps it: the defaults manager
// passes `saved.settings` through and the store shallow-copies it, so the two extra keys ride along.
// The one older-build write that drops them is a fresh Save Defaults there, which saves its 16 —
// and then the pair is derived at READ from that snapshot's own range (effectiveJulianRangeDefaults),
// which is right: the older build saved "the range". Never written back on a read.
export type SavedSettings = SettingsValues & Partial<JulianRangeValues>
export type DefaultsSnapshot = {
  settings: SavedSettings
  prefs: PrefDefaults
  amnesic: AmnesicMode
}
export type SavedDefaults = { settings: SavedSettings; prefs: PrefDefaults } & StoredAmnesic
export type UserDefaultsState = {
  saved: SavedDefaults | null
  saveDefaults: (snapshot: DefaultsSnapshot) => void
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
// (The settings store's 16 only: the snapshot's Julian-on pair is effectiveJulianRangeDefaults'.)
const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsValues)[]
export const effectiveSettingsDefaults = (saved: SavedDefaults | null): SettingsValues => {
  if (!saved) return SETTINGS_DEFAULTS
  const merged: SettingsValues = { ...SETTINGS_DEFAULTS, ...saved.settings }
  return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, merged[k]])) as SettingsValues
}
// The effective Julian-on Year Range — the snapshot's pair when it has a usable one, otherwise the
// pair derived from the snapshot's own Julian-off range (store/julianRange's rule); factory derives
// 1-11582.
export const effectiveJulianRangeDefaults = (saved: SavedDefaults | null): JulianRangeValues =>
  readJulianRange(saved?.settings) ?? deriveJulianRange(effectiveSettingsDefaults(saved))
export const effectivePrefDefaults = (saved: SavedDefaults | null): PrefDefaults =>
  saved ? { ...FACTORY_PREF_DEFAULTS, ...saved.prefs } : FACTORY_PREF_DEFAULTS
// The effective Amnesic default — same "nothing saved = factory" rule as the two helpers above, and
// factory is Off (a brand-new preset is never amnesic — see presetControl's createPreset). The
// snapshot's stored spelling goes through store/amnesicMode's readAmnesicMode, the one reader of
// every stored copy of the setting: a snapshot an older build saved carries only the boolean (true
// reads as Full), one from before round 20 carries neither field (Off), and a value this build does
// not recognise reads as Full. Named rather than inlined for the same reason the other two are — a
// second reading of `saved` somewhere else is exactly how a caller added later could disagree with
// this one about what "nothing saved" restores to.
export const effectiveAmnesicDefault = (saved: SavedDefaults | null): AmnesicMode =>
  readAmnesicMode(saved)

// ★ THE AMNESIC DEFAULT FOR ANY PRESET, read straight off ITS namespaced userDefaults key rather
// than through the live store (which is only ever the ACTIVE preset's — persist scopes it via
// store/presets' presetDoc). store/sessionAmnesic is the one caller: this is what every
// preset's Amnesic setting starts a fresh app open on, because the setting is a SESSION value —
// guest mode is temporary by construction, so a preset left on Stats Only or Full is back to its
// saved default the next time the app is opened.
//
// Reads the persist envelope directly — the same `{ state: {...} }` shape store/presets'
// readStoredRegistry parses, and for the same reason: a store pointed at one preset cannot answer
// for another. Only the snapshot's Amnesic fields are consulted, which the Rotate Dots migration
// (the only rewrite this store has) never touches, so no migration step is reproduced here. An
// absent, unreadable or malformed payload is treated as "nothing saved" →
// effectiveAmnesicDefault(null) → Off, which is the intended fallback: a preset manually set
// amnesic with NO saved defaults reverts to Off on every reopen (owner-confirmed — guest mode is
// temporary by default).
// ⚠ The ACTIVE preset's key is the un-namespaced base key (presetKey's identity), so this one path
// covers it too — no special case, and no divergence from effectiveAmnesicDefault(saved) for it.
export const storedAmnesicDefault = (presetId: number): AmnesicMode => {
  try {
    const raw = readItem(window.localStorage, presetKey(PRESET_STORE_KEYS.userDefaults, presetId))
    if (raw === null) return effectiveAmnesicDefault(null)
    const envelope: unknown = JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    const saved =
      state && typeof state === 'object'
        ? ((state as { saved?: SavedDefaults | null }).saved ?? null)
        : null
    return effectiveAmnesicDefault(saved)
  } catch {
    return effectiveAmnesicDefault(null)
  }
}

// The AoX run-length clamp — the rule's ONE home: the AoX run-length box's blur/Enter/Escape
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

// This store's launch value, as a FACTORY — the one the `merge` below composes and the one
// store/presetControl reloads a memory-only browser to. Named rather than written inline at both
// so "no saved copy means no personal defaults" has a single home; a second literal is exactly how
// a preset switch and a cold start would come to disagree about what a fresh preset holds.
export const makeUserDefaultsDefaults = (): Pick<UserDefaultsState, 'saved'> => ({ saved: null })

// ★ THROUGH THE WINDOWS-IN-SYNC DOOR, as ONE slice (`saved`) WITH ITS OWN VERSION TAG INSIDE (design 4):
// `saved.w`, the hash of the snapshot's own values. Older builds carry a field they do not know
// through their edits of the snapshot and drop it when they save a new one; so a snapshot whose tag
// still names its values is one a new build wrote and nobody has changed since - however old a
// version of it an older tab still holds, the newest stands - and one whose tag does not (or that
// has none) is an older build's own save. The tag never reaches the store.
const tagOf = (v: Record<string, unknown>): string => {
  const own = Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'w'))
  return cyrb53(canonicalJson(own))
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const untagged = (v: unknown): unknown =>
  isObject(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'w')) : v
// ★ THIS STORE NEEDS ITS OWN COPY OF EVERY SETTINGS MIGRATION, and has twice been the one a migration
// forgot: `saved.settings` is a FULL SettingsValues SNAPSHOT — not a live copy of that store — so
// useSettings' own migration (which only ever sees ITS OWN doc at `cg-settings-v1`) can never reach in
// here. Without this step a snapshot saved under an older shape keeps it forever: the unscreened
// top-level spread in `merge` below carries the stale nested object through byte-for-byte on every
// hydrate, `effectiveSettingsDefaults`' spread never finds a `dotRotation` key to override the factory
// Standard with, and Reset Settings / Full Reset (which both write `effectiveSettingsDefaults(saved)`
// straight into the live store) silently revert the player's SAVED Rotate Dots choice — forever,
// since `commitManageDefaults` (components/SettingsPanel) then carries the same stale shape forward on
// every subsequent Manage-Defaults edit-and-save.
// v2 = `dotOrientation` → the boolean `rotateDots` (round 20), as store/settings' v1→v2.
// v3 = `rotateDots` → the three-way `dotRotation` (round 23), as store/settings' v3→v4.
//   ⚠ AN OLDER BUILD READING A v3 SNAPSHOT is fail-safe AND lossless here, unlike the live settings
//   key: it finds no `rotateDots`, so its Reset Settings lands on its factory upright layout; and
//   although it re-saves at once (zustand's migrate-then-save on the version mismatch), its
//   `partialize` keeps `saved` WHOLE, so `dotRotation` rides through untouched and this build reads
//   it back intact.
// ⚠ THE AMNESIC SETTING BECAME THREE-WAY WITH NO VERSION OF ITS OWN, and needs none: nothing is
// rewritten. Its stored spelling is read by shape on every use (effectiveAmnesicDefault), a snapshot
// is written in the new spelling only when the player saves one, and that spelling still carries the
// boolean an older build acts on (store/amnesicMode).
// The migration is the same pure, idempotent, shape-keyed migrateDotRotation store/settings runs on
// its own top level, reached one level deeper: into `saved.settings`. Reused rather than
// reimplemented, so the two stores can never disagree about what the rewrite does (including its
// screen of a newer build's unknown rotation). It runs as a doc saved at another version is READ
// (the door's `migrate`), and screens every snapshot on its way to the store besides. A snapshot with
// no `saved` (nothing ever saved) passes through unchanged.
const migrateSaved = (saved: unknown): unknown =>
  isObject(saved) && isObject(saved.settings)
    ? {
        ...saved,
        settings: migrateDotRotation(saved.settings as Partial<SettingsValues> & LegacyDotFields),
      }
    : saved
export const USER_DEFAULTS_DOC: PresetDocSpec = {
  kind: 'userDefaults',
  base: PRESET_STORE_KEYS.userDefaults,
  version: 3,
  defaultOf: (x) => (x === 'saved' ? null : undefined),
  regs: () => ['saved'],
  migrate: (docState) =>
    'saved' in docState ? { ...docState, saved: migrateSaved(docState.saved) } : docState,
  toSlices: (state) => ({
    saved: isObject(state.saved)
      ? { ...(untagged(state.saved) as object), w: tagOf(state.saved) }
      : state.saved,
  }),
  fromSlices: (slices) =>
    slices.saved === undefined ? {} : { saved: migrateSaved(untagged(slices.saved)) },
  sliceState: (docState) => ({ saved: docState.saved }),
  docState: (slices) => ({ saved: slices.saved }),
  patchOf: (now) => ({ saved: migrateSaved(untagged(now.saved)) }),
  tagged: (x, v) => x === 'saved' && isObject(v) && typeof v.w === 'string' && v.w === tagOf(v),
}
const USER_DEFAULTS_DOOR = presetDoc<Pick<UserDefaultsState, 'saved'>>(USER_DEFAULTS_DOC)

export const useUserDefaults = create<UserDefaultsState>()(
  persist(
    (set) => ({
      saved: null,
      // Shallow-copy the snapshot so no live object is shared into the persisted store. The Amnesic
      // value is saved in its two-field spelling (store/amnesicMode's storedAmnesic).
      saveDefaults: (snapshot) =>
        set({
          saved: {
            settings: { ...snapshot.settings },
            prefs: { ...snapshot.prefs },
            ...storedAmnesic(snapshot.amnesic),
          },
        }),
      clearDefaults: () => set({ saved: null }),
    }),
    {
      // The localStorage key, unchanged — preset 1 IS the existing saved defaults. Enumerated in
      // store/presets so a preset delete can remove exactly its four keys; the adapter beside it
      // sends presets 2, 3, 4… to a namespaced one. Each preset therefore has its OWN saved
      // personal defaults, which is what makes a Full Reset inside a preset land on THAT preset's
      // saved values rather than on some other preset's.
      name: PRESET_STORE_KEYS.userDefaults,
      storage: USER_DEFAULTS_DOOR,
      // (its shape history and its migration are at USER_DEFAULTS_DOC above: the door reads every
      // doc in today's shape, so the persisted state the store is handed is always this version's)
      version: 3,
      // Persist only the snapshot, never the action functions.
      partialize: (state) => ({ saved: state.saved }),
      // Hydration replaces the snapshot rather than patching it over memory. Sharpest here of the
      // four: without it, opening a preset that has never saved defaults would leave the LAST
      // preset's snapshot standing, and a Full Reset inside the new preset would restore another
      // preset's settings. See mergeOverDefaults.
      merge: mergeOverDefaults(makeUserDefaultsDefaults),
    },
  ),
)
USER_DEFAULTS_DOOR.attach(useUserDefaults)
