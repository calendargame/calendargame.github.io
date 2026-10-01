import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PRESET_STORE_KEYS, presetKey, presetScopedStorage, mergeOverDefaults } from './presets.js'
import { readItem } from './storageHealth.js'
import type { FormatId } from '../lib/format.js'
import { isDotRotation, type DotRotation } from '../lib/dotLayout.js'

// settings.js — the ⚙ Settings store (Stage C, Steps 5a + 5b).
//
// Holds the 16 values that live in the Settings popover (13 at the Stage-C extraction; the Input
// style was added Session 10, the Rotate Dots setting in batch group 3, `defaultMode` in
// round-21 Q3). Originally these were useState hooks inside App; centralizing them
// is the structural groundwork
// for (a) saved-progress and (b) splitting the fused game modes apart later,
// since the modes can read settings from here instead of receiving them all as
// threaded props.
//
// Step 5b — PERSISTENCE: the store is wrapped in Zustand's `persist` middleware,
// so the 16 settings save to the device (localStorage key 'cg-settings-v1') and
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

// defaultMode — the page a preset OPENS ON (round-21 Q3). One of the seven entries of the bar's
// mode CustomSelect (main.tsx MODE_LABELS): the five practice modes, Lookup, and How to Play
// ('guide'). It is a per-preset ⚙ setting like the fifteen above it — persisted here, captured by
// Save Defaults (SavedDefaults.settings is a full SettingsValues snapshot, so it rides along with
// no extra wiring) and restored by Reset Settings / Full Reset. It only takes EFFECT on a cold
// open or a preset switch — main.tsx reads it then via readStoredDefaultMode below and calls
// switchMode; nothing else consults it. The app-global "open in which preset" pin is a SEPARATE
// thing and lives on the registry (store/presets' openInPreset), not here — this store is
// per-preset and cannot hold a global.
export type DefaultMode = 'classic' | 'flash' | 'blitz' | 'deduction' | 'aox' | 'lookup' | 'guide'
export const DEFAULT_MODE_VALUES: readonly DefaultMode[] = [
  'classic',
  'flash',
  'blitz',
  'deduction',
  'aox',
  'lookup',
  'guide',
]
export const isDefaultMode = (v: unknown): v is DefaultMode =>
  typeof v === 'string' && (DEFAULT_MODE_VALUES as readonly string[]).includes(v)
// `dotRotation` — Settings → Display → Rotate Dots, a three-way pill: Standard / 45° CCW / 90° CCW
// (round 23). ITS HISTORY, because two older shapes of it are still out there in saved data and
// migrateDotRotation below reads both: it launched as `dotOrientation: 'columns' | 'rows'` (a
// two-option picker), became the boolean `rotateDots` in round 20 (Q3 — two named options were
// always an on/off shape), and became this when 45° was added. Its type, DotRotation, lives in
// lib/dotLayout, the geometry file, because every geometry table there is indexed by it directly.

// The 16 settings values, then the full store (values + setters). Each setter takes a direct
// value OR a React-style functional updater (prev => next), matching App's setX(v=>!v) call sites.
export type SettingsValues = {
  randomFormat: boolean
  dateFormat: FormatId
  inputStyle: InputStyle
  dotRotation: DotRotation
  defaultMode: DefaultMode
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
  setDotRotation: (v: Updater<DotRotation>) => void
  setDefaultMode: (v: Updater<DefaultMode>) => void
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
  // Launches Standard — the orientation the app icon, the launch PNGs and every screenshot already
  // show. Both turns are opt-in.
  dotRotation: 'standard',
  // Every preset opens on Classic until the player picks otherwise — the behaviour the app has
  // always had (main.tsx's `mode` useState was hard-coded to "classic"). An absent key on a
  // pre-Q3 payload merges to exactly this, so v2→v3 needs no migrate function.
  defaultMode: 'classic',
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
// SETTINGS_DEFAULTS rather than listed, so the "16" every comment in this file quotes cannot drift
// from the code: add a setting to SETTINGS_DEFAULTS and it is persisted by construction. ⚠ 16 here
// counts the STORE's settings only. The Save Defaults snapshot is 21 (these 16 + 4 mode prefs + the
// preset's amnesic flag) and the gear's "modified" comparison is 22 or 21 — both counted in
// main.tsx, at resetSettings and settingsAtDefaults respectively. Do not carry this number over.
// ⚠ THE COMPARISON IS NOT A SUBSET OF THE SNAPSHOT, and round 15 is what changed that: it is 20 or
// 19 of the snapshot's 21 (a dormant theme value is always excluded) PLUS the ⚙ panel's two Year
// Range TEXT BOXES, which live in components/useYearRangeMirrors and are stored nowhere. So a year
// that has been TYPED but not committed counts as "modified" while there is nothing to save for it.
// (Round-22 Q5 closed the gap the other way — amnesic was in the snapshot and NOT in the
// comparison, which left Save Defaults unreachable for an amnesic-only change.)
const PERSISTED_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsValues)[]

// The two shapes the Rotate Dots setting was saved in before today's `dotRotation` (its history is
// at SettingsValues above). Typed `unknown` because they are read off saved data, never trusted.
export type LegacyDotFields = { dotOrientation?: unknown; rotateDots?: unknown }

// ★ THE ROTATE DOTS MIGRATION — every saved shape the setting has ever had, onto today's
// `dotRotation`, in ONE pure step. Exported and reused by store/userDefaults (whose Save Defaults
// snapshot is a full SettingsValues of its own, which this store's `migrate` can never reach), so
// the two stores cannot disagree about what the rewrite does; tested directly, like progress.ts's
// `migrateAoxBestKeys`.
//   • Both legacy fields are ALWAYS dropped: nothing reads them, and PERSISTED_KEYS (derived from
//     SETTINGS_DEFAULTS) would never re-persist them anyway.
//   • A valid `dotRotation` already present WINS over any legacy field — a payload this build
//     wrote and an older build then re-saved while keeping the unknown field (store/userDefaults'
//     snapshot is persisted whole, so there it survives; see that store's `version` note).
//   • Otherwise a legacy "turned" — `rotateDots: true`, or the original picker's 'rows' — becomes
//     'ccw90', the one turn that existed before 45° did. Anything else becomes NO KEY AT ALL rather
//     than an explicit 'standard': an absent key is exactly what `mergeOverDefaults` (and
//     userDefaults' `effectiveSettingsDefaults`) turn into the factory value, so writing one would
//     only be a second statement of the default.
//   • ⚠ AN UNRECOGNISED `dotRotation` IS DROPPED too, and that is this build being the OLDER build
//     for once: a future build that adds a fourth rotation will bump `version`, and zustand runs
//     `migrate` on ANY version mismatch — newer included — so this screen is what turns a value this
//     build cannot draw into the factory Standard instead of an undefined lookup in DOT_CELLS.
export function migrateDotRotation(
  state: Partial<SettingsValues> & LegacyDotFields,
): Partial<SettingsValues> {
  const { dotOrientation, rotateDots, dotRotation, ...rest } = state
  if (isDotRotation(dotRotation)) return { ...rest, dotRotation }
  return rotateDots === true || dotOrientation === 'rows' ? { ...rest, dotRotation: 'ccw90' } : rest
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setRandomFormat: (v) => set((s) => ({ randomFormat: resolve(v, s.randomFormat) })),
      setDateFormat: (v) => set((s) => ({ dateFormat: resolve(v, s.dateFormat) })),
      setInputStyle: (v) => set((s) => ({ inputStyle: resolve(v, s.inputStyle) })),
      setDotRotation: (v) => set((s) => ({ dotRotation: resolve(v, s.dotRotation) })),
      setDefaultMode: (v) => set((s) => ({ defaultMode: resolve(v, s.defaultMode) })),
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
      // ⚠⚠ WHAT THIS IS: a FACTORY reset. It overwrites all 16 settings with SETTINGS_DEFAULTS,
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
      // Apply a full 16-value snapshot in one shot — the values half of what App's Reset Settings
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
      // ⚠ THIS STORE IS WHERE THAT PROMISE IS AT ITS WEAKEST, and it is worth stating here rather
      // than leaving to be rediscovered: the live site and staging share this origin, so an OLD
      // build and this one really do interleave on this key. The key they agree about is identical;
      // the PAYLOAD is only as complete as the older build's own `partialize`. For Rotate Dots, in
      // both directions:
      //   • AN OLDER BUILD WRITES, THIS ONE READS: its payload carries `rotateDots` (or, older
      //     still, `dotOrientation`) under its OWN older `version`, so this build's `migrate` below
      //     catches it on the next boot here, and a turned layout comes back as 90° — the only turn
      //     those builds knew. A build from before the setting existed writes neither field, and
      //     that boot reads the factory Standard.
      //   • THIS BUILD WRITES, AN OLDER ONE READS (`dotRotation`, version 4): the older build finds
      //     no `rotateDots` and draws its factory UPRIGHT layout — FAIL-SAFE, never a wrong turn and
      //     never a crash, because it ignores the unknown field outright. But zustand runs that
      //     build's `migrate` on the version mismatch and then RE-SAVES at once through its own
      //     `partialize`, which drops `dotRotation`; so after an older build has merely OPENED, this
      //     build reads the player's choice back as Standard. Bounded (one setting reverts; nothing
      //     is mis-attributed, no stats are involved) and reachable only from a pre-round-23 tab
      //     still open on the same origin. A legacy `rotateDots` mirror written beside `dotRotation`
      //     would soften it for 90° alone, and would be a shim kept forever for a window that closes
      //     the moment both sites update — so there is none.
      // It is the price of one key serving more than one build in flight, argued in full in
      // store/presets' header.
      name: PRESET_STORE_KEYS.settings,
      // …and this is what makes presets 2, 3, 4… land somewhere else. The `name` above never
      // changes; the adapter rewrites it to the ACTIVE preset's key at each read and each write.
      // See store/presets for why that beat swapping the name on every switch.
      storage: presetScopedStorage<Partial<SettingsState>>(),
      // v2 = `dotOrientation` LEFT the shape for the boolean `rotateDots` (Q3, round 20).
      // v3 = `defaultMode` JOINED the shape (round-21 Q3). It needs no rewrite: an absent key on an
      // older payload is exactly what `mergeOverDefaults` turns into the factory 'classic', which
      // is the pre-Q3 behaviour.
      // v4 = `rotateDots` LEFT the shape for the three-way `dotRotation` (round 23).
      version: 4,
      // Saved-shape migration, run once at hydrate whenever the stored version DIFFERS — older OR
      // newer, since that is when zustand calls it. Deliberately not gated on the number:
      // migrateDotRotation is a pure, idempotent rewrite keyed on the SHAPE it finds, and it also
      // screens a newer build's unknown rotation back to the factory, which a `version < 4` gate
      // would skip (see its header). `migrate` runs BEFORE `merge` below, so by the time the
      // unscreened persisted-spread in `merge` sees this object it already carries today's shape —
      // `merge` itself needs no special-casing, for the reason progress.ts's aoxBest migration
      // argues in full.
      migrate: (persisted) =>
        persisted && typeof persisted === 'object'
          ? migrateDotRotation(persisted as Partial<SettingsValues> & LegacyDotFields)
          : (persisted as Partial<SettingsValues>),
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

// ★ THE defaultMode OF ANY PRESET, read straight off ITS namespaced settings key rather than
// through the live store (which is only ever the ACTIVE preset's — persist scopes it via
// store/presets' presetScopedStorage). The mirror of store/userDefaults' storedAmnesicDefault, and
// it exists for the same reason: on a mid-session preset switch, store/presetControl's switchPreset
// writes the registry (firing main.tsx's remount subscription) BEFORE it rehydrates the four
// per-preset stores, so at the instant the subscription reads the incoming preset's opening page
// the live useSettings still holds the OUTGOING preset's values. This reads the incoming preset's
// own payload instead (through store/storageHealth, so a save the device refused still counts).
// main.tsx's cold-open effect uses it too, for one code path.
//
// Reads the persist envelope directly — the same `{ state: {...} }` shape store/presets'
// readStoredRegistry and store/userDefaults' storedAmnesicDefault parse. Only `state.defaultMode`
// is consulted, which no migration step touches, so none is reproduced here. An absent, unreadable,
// malformed or out-of-range value is treated as the factory 'classic' — the pre-Q3 behaviour, and
// the correct landing for a payload that cannot be trusted to say where it wanted to open.
// ⚠ The ACTIVE preset's key is the un-namespaced base key (presetKey's identity), so this one path
// covers it too — no special case.
export const readStoredDefaultMode = (presetId: number): DefaultMode => {
  try {
    const raw = readItem(window.localStorage, presetKey(PRESET_STORE_KEYS.settings, presetId))
    if (raw === null) return 'classic'
    const envelope: unknown = JSON.parse(raw)
    const state =
      envelope && typeof envelope === 'object' ? (envelope as { state?: unknown }).state : null
    const v =
      state && typeof state === 'object' ? (state as { defaultMode?: unknown }).defaultMode : null
    return isDefaultMode(v) ? v : 'classic'
  } catch {
    return 'classic'
  }
}
